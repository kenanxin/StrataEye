import { createWorkflowClient, createWorkflowCoordinator } from './workflow-client.mjs';
import { renderKnowledgeEvidence } from './knowledge-evidence.mjs';
import { adviceSourceLabel, adviceNotice } from './advice-presentation.mjs';
let activeController = null;
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
  const context = node.agent_id === 'A2' ? (node.output?.reviewed_workflows || []).map(item => `<li>已审核工作流 ${escapeHtml(item.workflow_run_id)} · CSV ${escapeHtml(item.record_id)} · 审核版本 ${escapeHtml(item.review_version)} / 修订 ${escapeHtml(item.review_revision ?? '未知')} · ${escapeHtml(item.reviewed_at)} · 源模型 ${escapeHtml(item.source_model?.name || '未知')} / ${escapeHtml(item.source_model?.mode || '未知')} · ${escapeHtml(item.evidence_id)}</li>`).join('') : '';
  const proposal = result.plan_versions?.at(-1);
  const rag = ['A2', 'A3'].includes(node.agent_id) ? renderKnowledgeEvidence(proposal?.knowledge_retrieval || result.nodes.find(item => item.agent_id === 'A2')?.output?.knowledge_retrieval, proposal?.advice?.evidence_ids) : '';
  target.innerHTML = `
    <div><span>${escapeHtml(node.agent_id)} · ${escapeHtml(node.name)}</span><b>${escapeHtml(STATUS_LABELS[node.status] || node.status)}</b></div>
    <p>${escapeHtml(node.output_summary || node.reason || '暂无输出')}</p>
    <ul>${evidence || '<li>当前节点没有额外输入证据。</li>'}</ul>
    ${node.agent_id === 'A2' ? `<p>已审核工作流检索上下文 · 与相似CSV示例分别展示；实际引用见当前保存方案</p><ul>${context || '<li>本版无已审核工作流上下文。</li>'}</ul>` : ''}
    ${rag}
    <footer><span>运行 ${escapeHtml(result.workflow_run_id)}</span><span>实测 ${escapeHtml(node.elapsed_ms)} ms · 下一动作 ${escapeHtml(result.next_action)}</span></footer>`;
}

function renderRun(result, selectedAgent) {
  const rail = element('multiAgentRail');
  if (!rail) return;
  rail.querySelectorAll('[data-agent-id]').forEach((button) => {
    const node = result.nodes.find((item) => item.agent_id === button.dataset.agentId);
    if (!node) return;
    button.dataset.status = node.status;
    button.querySelector('em').textContent = STATUS_LABELS[node.status] || node.status;
    button.classList.toggle('selected', node.agent_id === selectedAgent);
  });
  const firstRelevant = result.nodes.find(node => node.agent_id === selectedAgent) || result.nodes.find((node) => ['waiting_human', 'needs_attention'].includes(node.status))
    || [...result.nodes].reverse().find((node) => node.status === 'success')
    || result.nodes[0];
  if (firstRelevant) {
    rail.querySelectorAll('[data-agent-id]').forEach(button => button.classList.toggle('selected',button.dataset.agentId===firstRelevant.agent_id));
    renderDetail(firstRelevant, result);
  }
  element('multiAgentSource').textContent = `${result.workflow_run_id} · r${result.revision} · ${result.algorithm.predicted_class} · CSV ${result.algorithm.record_id}`;
  const advice = result.plan_versions?.at(-1)?.advice;
  element('multiAgentBoundary').textContent = `${result.safety?.statement || '候选方案须人工确认'} · A3来源 ${adviceSourceLabel(advice)} · ${adviceNotice(advice)} · 原CSV记录复用，无新测量证据`;
  return firstRelevant?.agent_id;
}

export function setupMultiAgentWorkflow({ authFetch, getCurrentPayload, client, coordinator: sharedCoordinator, getCurrentRole = () => 'expert' } = {}) {
  activeController?.destroy();
  const button = element('runMultiAgentWorkflow');
  const source = element('multiAgentSource');
  if (!button) return;
  const coordinator=sharedCoordinator || createWorkflowCoordinator({client:client || createWorkflowClient({authFetch})});
  const cleanups=[];
  let selectedAgent=null,selectedRun=null;
  function render(snapshot) {
    button.textContent=snapshot.loading ? '读取保存事件…' : '刷新已保存研判';
    button.disabled=snapshot.pending || snapshot.loading;
    button.hidden=!['enterprise','regulator','expert','viewer','super_admin'].includes(getCurrentRole());
    if (snapshot.run) {
      if (selectedRun!==snapshot.run.workflow_run_id) selectedAgent=null;
      selectedRun=snapshot.run.workflow_run_id;
      selectedAgent=renderRun(snapshot.run,selectedAgent);
      const monitoringRecord=getCurrentPayload?.()?.model_output?.record_id;
      if (monitoringRecord && monitoringRecord!==snapshot.run.algorithm.record_id) source.textContent+=' · 与当前监测记录不同';
    } else {
      selectedAgent=null;selectedRun=null;
      element('multiAgentRail')?.querySelectorAll('[data-agent-id]').forEach(node=>{node.dataset.status='waiting';node.querySelector('em').textContent='等待读取';node.classList.remove('selected');});
      element('multiAgentDetail').innerHTML='<p>暂无保存研判；企业端可启动预警协同。读取中请等待服务器返回。</p>';
      source.textContent='暂无保存事件';
    }
    if (snapshot.error) source.textContent=`智能体服务不可用：${snapshot.error.message} · 请刷新后重试`;
  }
  const refresh=async()=>{try{await coordinator.refresh();}catch(_){/* coordinator exposes typed error */}};
  button.addEventListener('click',refresh);cleanups.push(()=>button.removeEventListener('click',refresh));
  element('multiAgentRail')?.querySelectorAll('[data-agent-id]').forEach(button=>{
    const select=()=>{selectedAgent=button.dataset.agentId;render(coordinator.getSnapshot());};
    button.addEventListener('click',select);cleanups.push(()=>button.removeEventListener('click',select));
  });
  cleanups.push(coordinator.subscribe(render));render(coordinator.getSnapshot());
  if (!coordinator.getSnapshot().initialized) refresh();
  const controller={destroy(){cleanups.forEach(cleanup=>cleanup());if(!sharedCoordinator)coordinator.destroy();}};
  activeController=controller;
  return controller;
}
