const STATUS_LABELS = {
  success: '完成', waiting_human: '待人工确认', needs_attention: '资源异常', skipped: '条件跳过', running: '运行中',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function element(id) { return document.getElementById(id); }

function renderDetail(node, result) {
  const target = element('multiAgentDetail');
  if (!target || !node) return;
  const evidence = (node.input_evidence || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  target.innerHTML = `
    <div><span>${escapeHtml(node.agent_id)} · ${escapeHtml(node.name)}</span><b>${escapeHtml(STATUS_LABELS[node.status] || node.status)}</b></div>
    <p>${escapeHtml(node.output_summary || node.reason || '暂无输出')}</p>
    <ul>${evidence || '<li>当前节点没有额外输入证据。</li>'}</ul>
    <footer><span>运行 ${escapeHtml(result.workflow_run_id)}</span><span>实测 ${escapeHtml(node.elapsed_ms)} ms · 下一动作 ${escapeHtml(result.next_action)}</span></footer>`;
}

function renderRun(result) {
  const rail = element('multiAgentRail');
  if (!rail) return;
  rail.querySelectorAll('[data-agent-id]').forEach((button) => {
    const node = result.nodes.find((item) => item.agent_id === button.dataset.agentId);
    if (!node) return;
    button.dataset.status = node.status;
    button.querySelector('em').textContent = STATUS_LABELS[node.status] || node.status;
    button.onclick = () => {
      rail.querySelectorAll('[data-agent-id]').forEach((item) => item.classList.remove('selected'));
      button.classList.add('selected');
      renderDetail(node, result);
    };
  });
  const firstRelevant = result.nodes.find((node) => ['waiting_human', 'needs_attention'].includes(node.status))
    || [...result.nodes].reverse().find((node) => node.status === 'success')
    || result.nodes[0];
  rail.querySelector(`[data-agent-id="${firstRelevant.agent_id}"]`)?.click();
  element('multiAgentSource').textContent = `${result.algorithm.model.toUpperCase()} · ${result.algorithm.predicted_class} · ${result.algorithm.record_id}`;
  element('multiAgentBoundary').textContent = result.safety.statement;
}

export function setupMultiAgentWorkflow({ authFetch, getCurrentPayload }) {
  const button = element('runMultiAgentWorkflow');
  const source = element('multiAgentSource');
  if (!button) return;

  authFetch('/api/multi-agent/status', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const status = await response.json();
      source.textContent = status.available ? '六智能体后端已就绪 · XGBoost适配器' : '智能体服务不可用';
    })
    .catch(() => { source.textContent = '智能体服务不可用'; });

  button.addEventListener('click', async () => {
    const current = getCurrentPayload();
    const recordId = current?.provenance?.record_id || current?.model_output?.record_id;
    if (!recordId) {
      source.textContent = '真实记录尚未就绪，不能启动研判';
      return;
    }
    button.disabled = true;
    button.textContent = '服务器研判中…';
    source.textContent = `提交真实记录 ${recordId}`;
    try {
      const response = await authFetch('/api/multi-agent/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_id: recordId }), cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderRun(await response.json());
    } catch (error) {
      source.textContent = '智能体服务不可用';
      const detail = element('multiAgentDetail');
      if (detail) detail.innerHTML = '<div><span>执行失败</span><b>未生成结果</b></div><p>服务器未返回有效状态，页面没有使用模拟数据填充成功结果。请确认登录状态和Render服务后重试。</p>';
      console.warn('Multi-agent workflow unavailable:', error);
    } finally {
      button.disabled = false;
      button.textContent = '重新运行六智能体研判';
    }
  });
}
