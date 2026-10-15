import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createKnowledgeRetrievalService } = require('../server/knowledge-retrieval-service.js');

test('retrieval is deterministic, versioned, attributed and spans matching domains', () => {
  const service = createKnowledgeRetrievalService();
  const query = '顶板 支护 刚度 位移 矿压 复查 工单 人工';
  const result = service.retrieve({ query, limit: 6 });
  assert.deepEqual(result, service.retrieve({ query, limit: 6 }));
  assert.equal(result.method, 'char_bigram_tfidf_cosine');
  assert.equal(result.status, 'matched');
  assert.ok(new Set(result.chunks.map(c => c.domain)).size >= 3);
  for (const chunk of result.chunks) {
    assert.match(chunk.id, /^knowledge:/);
    assert.equal(chunk.content_sha256, createHash('sha256').update(chunk.text).digest('hex'));
    assert.ok(chunk.title && chunk.locator && chunk.source_kind);
    if (chunk.source_url) assert.match(chunk.source_url, /^https:\/\//);
    assert.ok(chunk.score > 0 && chunk.score <= 1);
  }
});
test('no match stays empty, query budgets and invalid limits are handled explicitly', () => {
  const service = createKnowledgeRetrievalService();
  for (const query of ['', '量子薯片xyz']) assert.equal(service.retrieve({ query }).status, 'no_match');
  assert.ok(service.retrieve({ query: '支护'.repeat(2000) }).query.length <= 1000);
  assert.throws(() => service.retrieve({ query: '支护', limit: 100 }), TypeError);
  assert.throws(() => service.retrieve({ query: null }), TypeError);
});
test('exact corpus is frozen and calls cannot mutate subsequent retrievals', () => {
  const service = createKnowledgeRetrievalService();
  const first = service.retrieve({ query: '支护 刚度 位移' });
  first.chunks[0].text = 'malicious';
  assert.notEqual(service.retrieve({ query: '支护 刚度 位移' }).chunks[0].text, 'malicious');
  assert.throws(() => createKnowledgeRetrievalService({ catalog: { version: 'x', chunks: [{ id: 'bad', text: 'bad' }] } }), TypeError);
});
