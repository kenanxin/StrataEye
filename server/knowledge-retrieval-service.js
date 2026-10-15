'use strict';
const { createHash } = require('node:crypto');
const defaultCatalog = require('../data/knowledge/cross-domain-v1.json');

function terms(text) {
  const tokens = String(text).normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]+|[a-z]+/gu) || [];
  return tokens.flatMap(token => /^[a-z]+$/.test(token) ? [token] : Array.from({ length: Math.max(0, token.length - 1) }, (_, i) => token.slice(i, i + 2)));
}
function createKnowledgeRetrievalService({ catalog = defaultCatalog } = {}) {
  if (!catalog || typeof catalog.version !== 'string' || !Array.isArray(catalog.chunks)) throw new TypeError('Versioned knowledge catalog is required');
  const ids = new Set();
  const chunks = structuredClone(catalog.chunks).map(chunk => {
    if (!/^knowledge:[a-z0-9:-]+$/.test(chunk.id) || ids.has(chunk.id) || !chunk.text || chunk.text.length > 1200 || !chunk.title || !chunk.domain || !chunk.locator || !chunk.source_kind
      || (chunk.source_url !== null && !/^https:\/\//.test(chunk.source_url))) throw new TypeError('Invalid knowledge chunk or source');
    ids.add(chunk.id);
    return { ...chunk, content_sha256: createHash('sha256').update(chunk.text).digest('hex') };
  });
  const catalogVersion = catalog.version;
  const disclaimer = String(catalog.description || '');
  const documentTerms = chunks.map(c => terms(`${c.title} ${(c.tags || []).join(' ')} ${c.text}`));
  const frequency = new Map();
  documentTerms.forEach(tokens => new Set(tokens).forEach(token => frequency.set(token, (frequency.get(token) || 0) + 1)));
  const idf = token => Math.log((1 + chunks.length) / (1 + (frequency.get(token) || 0))) + 1;
  function vector(tokens) {
    const counts = new Map();
    tokens.filter(t => frequency.has(t)).forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
    let norm = 0;
    for (const [token, count] of counts) { const v = (1 + Math.log(count)) * idf(token); counts.set(token, v); norm += v * v; }
    norm = Math.sqrt(norm) || 1;
    return new Map([...counts].map(([t, v]) => [t, v / norm]));
  }
  const vectors = documentTerms.map(vector);
  return {
    retrieve({ query = '', limit = 4 } = {}) {
      if (typeof query !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 6) throw new TypeError('query must be text and limit must be an integer from 1 to 6');
      query = query.slice(0, 1000);
      const q = vector(terms(query));
      const ranked = chunks.map((chunk, i) => ({ ...chunk, score: Number(Math.min(1, [...q].reduce((sum, [t, w]) => sum + w * (vectors[i].get(t) || 0), 0)).toFixed(6)) }))
        .filter(chunk => chunk.score >= 0.025).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'en'));
      // At most one first-pass hit per domain; remaining slots retain relevance order.
      const selected = [], domains = new Set();
      for (const chunk of ranked) if (!domains.has(chunk.domain) && selected.length < limit) { selected.push(chunk); domains.add(chunk.domain); }
      for (const chunk of ranked) if (selected.length < limit && !selected.some(c => c.id === chunk.id)) selected.push(chunk);
      return { method: 'char_bigram_tfidf_cosine', catalog_version: catalogVersion, status: selected.length ? 'matched' : 'no_match', query,
        disclaimer, chunks: structuredClone(selected) };
    },
  };
}
module.exports = { createKnowledgeRetrievalService };
