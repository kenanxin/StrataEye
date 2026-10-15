import { escapeKnowledgeHtml as escape, renderKnowledgeEvidence } from './knowledge-evidence.mjs';
import { adviceSourceLabel, adviceNotice, requestAdvice } from './advice-presentation.mjs';

export function setupSupportSimulation({ authFetch, role, onFrame = () => {}, onFocus = () => false, renderChart = () => {}, disposeChart = () => {} }) {
  const el = id => document.getElementById(id);
  const root = el('supportSimulationLab');
  if (!root) return { destroy() {} };
  root.hidden = false;
  let data = null, destroyed = false, revision = 0, pending = false, marking = false;
  const listeners = [];
  const canExplain = ['enterprise', 'expert', 'super_admin'].includes(role);
  const canFocus = role === 'enterprise';
  const listen = (id, event, fn) => { el(id).addEventListener(event, fn); listeners.push(() => el(id).removeEventListener(event, fn)); };
  function selection() { const item = data?.cases.find(c => c.id === el('supportCase').value); return item ? { item, frame: item.frames[Number(el('supportStep').value)] } : null; }
  function renderFrame() {
    const selected = selection(); if (!selected) return;
    revision++;
    const { item, frame } = selected;
    el('supportStepLabel').textContent = `${frame.step} / ${item.frames.length - 1}`;
    el('supportForce').textContent = frame.support_force_kn.toFixed(2);
    el('supportDisplacement').textContent = frame.support_displacement_mm.toFixed(3);
    el('supportParameters').textContent = `载荷 ${frame.load_kn_per_m.toFixed(1)} kN/m · 支护刚度 ${item.spring_stiffness_mn_per_m} MN/m。梁长 ${data.parameters.length_m} m、条带宽 ${data.parameters.width_m} m；端部为简支，中心为模拟支护点。`;
    el('supportAdvice').innerHTML = ''; el('supportKnowledge').innerHTML = '';
    el('supportAdviceStatus').textContent = canExplain ? '当前工况尚未生成解释；切换工况或加载步后，旧解释自动清除。' : '可查看模拟曲线；辅助解释由企业或智库人员发起。';
    renderChart(item, frame.step);
    if (marking) onFrame({ ...frame, case_id: item.id, object_id: data.object_id });
  }
  listen('supportCase', 'change', renderFrame); listen('supportStep', 'input', renderFrame);
  listen('supportFocus', 'click', () => {
    const selected = selection(); if (!selected) return;
    marking = true;
    const ready = onFocus({ ...selected.frame, case_id: selected.item.id, object_id: data.object_id });
    el('supportSceneStatus').textContent = ready ? '三维中已标记模拟关联支护点；后续滑动加载步仅更新标签，不自动移动镜头。' : '井下场景尚未就绪，请稍后再点击定位；曲线和研究解释仍可使用。';
    if (ready) el('threeContainer')?.scrollIntoView({ behavior: 'auto', block: 'center' });
  });
  listen('supportClear', 'click', () => { marking = false; onFrame(null); el('supportSceneStatus').textContent = '三维模拟标记已移除，曲线和研究解释保留。'; });
  listen('supportExplain', 'click', async () => {
    const selected = selection(); if (!selected || pending || !canExplain) return;
    pending = true; el('supportExplain').disabled = true;
    const requestRevision = revision;
    el('supportAdviceStatus').textContent = '正在检索资料并生成解释…';
    try {
      const result = await requestAdvice(authFetch, '/api/roof-risk/support-simulation/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ case_id: selected.item.id, step: selected.frame.step }) }, {
        onWait: () => { if (!destroyed && requestRevision === revision) el('supportAdviceStatus').textContent = 'DeepSeek仍在处理，请稍候；数据和曲线正常，无需重复点击。'; },
      });
      if (destroyed || requestRevision !== revision) return;
      el('supportAdviceStatus').textContent = `来源：${adviceSourceLabel(result.advice)}${result.advice.source === 'deepseek' ? ' + RAG' : ''} · ${adviceNotice(result.advice)} · 模拟研究解释，未创建工单或完成审批`;
      el('supportAdvice').innerHTML = `<div class="support-lab-proposal"><p>${escape(result.advice.summary)}</p><ul>${result.advice.recommendations.map(text => `<li>${escape(text)}</li>`).join('')}</ul><div class="support-lab-chain">${(result.chain || []).map(node => `<span title="${escape(node.summary)}">${escape(node.agent_id)} · ${escape(({ success: '已处理', waiting_human: '待人工', skipped: '未执行' })[node.status] || node.status)}</span>`).join('')}</div></div>`;
      el('supportKnowledge').innerHTML = renderKnowledgeEvidence(result.retrieval, result.advice.evidence_ids);
    } catch (error) {
      if (!destroyed && requestRevision === revision) el('supportAdviceStatus').textContent = `解释暂不可用：${error.message}。当前曲线不受影响，可稍后重试。`;
    } finally { pending = false; if (!destroyed) el('supportExplain').disabled = !canExplain || !data; }
  });
  const ready = (async () => {
    try {
      const response = await authFetch('/api/roof-risk/support-simulation', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (destroyed) return;
      data = payload;
      el('supportCase').innerHTML = data.cases.map(item => `<option value="${escape(item.id)}">${escape(item.label)} · ${escape(item.spring_stiffness_mn_per_m)} MN/m</option>`).join('');
      el('supportCase').value = data.cases[0].id;
      el('supportCase').disabled = false; el('supportStep').disabled = false;
      el('supportExplain').disabled = !canExplain;
      el('supportFocus').disabled = !canFocus; el('supportClear').disabled = !canFocus;
      el('supportSceneStatus').textContent = canFocus ? '点击定位查看模拟关联设备；未定位时不影响原三维场景。' : '本端可查看模拟研究；三维定位请使用企业端。';
      el('supportSource').textContent = `${data.version} · 求解器 ${data.provenance.solver_source_sha256.slice(0, 12)} · 工况 ${data.artifact_sha256.slice(0, 12)} · 预计算，非在线实测`;
      renderFrame();
    } catch (error) { if (!destroyed) el('supportAdviceStatus').textContent = `模拟工况加载失败：${error.message}，请刷新后重试。`; }
  })();
  return { ready, destroy() { destroyed = true; revision++; listeners.forEach(fn => fn()); onFrame(null); disposeChart(); } };
}
