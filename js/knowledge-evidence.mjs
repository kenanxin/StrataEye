export function escapeKnowledgeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
export function renderKnowledgeEvidence(retrieval, citedIds = []) {
  const escape = escapeKnowledgeHtml;
  if (!retrieval?.chunks?.length) return '<p class="knowledge-empty">未检索到相关资料，请补充可使用的资料；当前建议需人工复核。</p>';
  const cited = new Set(citedIds);
  const retrievedDomains=[...new Set(retrieval.chunks.map(c=>c.domain).filter(Boolean))];
  const citedDomains=[...new Set(retrieval.chunks.filter(c=>cited.has(c.id)).map(c=>c.domain).filter(Boolean))];
  const sourceLabels = { official_notice_paraphrase: '官方通知转述', research_abstract_paraphrase: '研究摘要转述', textbook_paraphrase: '教材转述', project_implementation_note: '项目实现说明' };
  return `<p class="knowledge-method">跨域RAG · 字符TF-IDF检索 · ${escape(retrieval.catalog_version)} · 检索命中不等于已证实原因</p><div class="knowledge-domains"><span>检索领域：${retrievedDomains.map(escape).join(' / ')}</span><strong>建议实际引用领域：${citedDomains.length?citedDomains.map(escape).join(' / '):'暂无；请核对建议来源'}</strong></div>` + retrieval.chunks.map(chunk => {
    const https = /^https:\/\//.test(chunk.source_url || '');
    return `<article class="knowledge-card"><div><strong>${escape(chunk.title)}</strong><span>${cited.has(chunk.id) ? '本建议已引用' : '检索命中 · 未引用'}</span></div>
      <p>${escape(chunk.text)}</p><small>${escape(chunk.domain)} · ${escape(sourceLabels[chunk.source_kind] || chunk.source_kind)} · ${escape(chunk.locator)}</small>
      <footer>${https ? `<a href="${escape(chunk.source_url)}" target="_blank" rel="noopener noreferrer">查看原始出处 ↗</a>` : '<span>项目实现说明，非外部规范</span>'}<code>${escape(chunk.id)} · ${escape(chunk.content_sha256?.slice(0, 12))}</code></footer></article>`;
  }).join('');
}
