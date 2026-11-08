let activeController = null;
const STATUS_LABELS = { success: '完成', failed: '失败' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function element(id) { return document.getElementById(id); }

function toolChips(node) {
  const counts = (node.tool_calls || []).reduce((acc, call) => {
    acc[call.tool] = (acc[call.tool] || 0) + 1;
    return acc;
  }, {});
  const entries = Object.entries(counts);
  if (!entries.length) return '';
  return `<div class="agent-llm-tools">${entries.map(([tool, count]) => `<i>${escapeHtml(tool)}${count > 1 ? ` ×${count}` : ''}</i>`).join('')}</div>`;
}

function nodeCard(node) {
  const warning = node.output?._validation_warning
    ? `<p class="agent-llm-warn">校验警告：${escapeHtml(node.output._validation_warning)}</p>` : '';
  const output = node.output
    ? `<details><summary>结构化输出</summary>${warning}<pre>${escapeHtml(JSON.stringify(node.output, null, 1))}</pre></details>`
    : '';
  return `<article class="agent-llm-node" data-status="${escapeHtml(node.status)}">
    <header><b>${escapeHtml(node.agent_id)}</b><span>${escapeHtml(node.name)}</span><em>${escapeHtml(STATUS_LABELS[node.status] || node.status)}</em><i>${escapeHtml(node.elapsed_ms)} ms</i></header>
    ${toolChips(node)}
    <p>${escapeHtml(node.output_summary || '')}</p>
    ${output}
  </article>`;
}

export function setupAgentLlmWorkflow({ authFetch, getCurrentRecordId = () => null } = {}) {
  activeController?.destroy();
  const button = element('runAgentLlmWorkflow');
  const source = element('agentLlmSource');
  const result = element('agentLlmResult');
  if (!button || !authFetch) return;
  const cleanups = [];
  let timer = null;

  async function request(path, body) {
    const init = { cache: 'no-store' };
    if (body) Object.assign(init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const response = await authFetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.detail || payload?.error?.message || `HTTP ${response.status}`);
    return payload;
  }

  async function checkHealth() {
    try {
      const health = await request('/api/agent-llm/health');
      source.textContent = `智能体服务在线 · camel ${health.camel_version || '?'} · DeepSeek ${health.deepseek_configured ? '已配置' : '未配置'}`;
    } catch (error) {
      source.textContent = `智能体服务离线：${error.message}`;
    }
  }

  async function run() {
    const recordId = getCurrentRecordId();
    if (!recordId) { source.textContent = '当前无监测记录，无法运行'; return; }
    button.disabled = true;
    const startedAt = Date.now();
    timer = setInterval(() => {
      source.textContent = `LLM 六智能体研判运行中 · ${Math.round((Date.now() - startedAt) / 1000)} s（约 1–2 分钟）`;
    }, 1000);
    result.innerHTML = '<p>正在运行 A1 → A2 → A3 → A5 → A4 → A6 管线，A1/A2/A3 会真实调用工具……</p>';
    try {
      const run = await request('/api/agent-llm/runs', { record_id: recordId });
      const ok = run.nodes.filter((node) => node.status === 'success').length;
      const toolCalls = run.nodes.reduce((sum, node) => sum + (node.tool_calls?.length || 0), 0);
      source.textContent = `${run.workflow_run_id} · ${run.model} · 总耗时 ${(run.elapsed_ms / 1000).toFixed(1)} s`;
      result.innerHTML = `<p class="agent-llm-summary">记录 ${escapeHtml(run.record_id)} · 成功 ${ok}/${run.nodes.length} 节点 · 工具调用 ${toolCalls} 次</p>${run.nodes.map(nodeCard).join('')}`;
    } catch (error) {
      source.textContent = '运行失败';
      result.innerHTML = `<p class="agent-llm-warn">${escapeHtml(error.message)}</p>`;
    } finally {
      clearInterval(timer);
      button.disabled = false;
    }
  }

  button.addEventListener('click', run);
  cleanups.push(() => { button.removeEventListener('click', run); clearInterval(timer); });
  checkHealth();
  const controller = { destroy() { cleanups.forEach((cleanup) => cleanup()); } };
  activeController = controller;
  return controller;
}
