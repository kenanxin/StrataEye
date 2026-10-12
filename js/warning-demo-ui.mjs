import { DEMO_ACTIONS, DEMO_STATES, createSavedDemoReadAdapter, demoStatusView } from './warning-demo-state.mjs';
export { demoStatusView } from './warning-demo-state.mjs';
import { createWorkflowClient, createWorkflowCoordinator } from './workflow-client.mjs';
import {
  createEvidencePreview,
  createWarningDemoMediaStore,
  revokeEvidencePreviews,
  validateEvidenceFiles,
} from './warning-demo-media.mjs';

const ACTION_ROLES = Object.freeze({
  START_DEMO: 'enterprise', ACKNOWLEDGE: 'enterprise', SUBMIT_DISPOSAL: 'enterprise', RESET: 'enterprise',
  REJECT: 'regulator', APPROVE: 'regulator', ARCHIVE: 'expert',
  UPDATE_RESOURCES: 'enterprise', REPROCESS: 'enterprise', APPROVE_MEMORY: 'expert',
});

const STEP_ORDER = ['alert_triggered', 'disposal_in_progress', 'pending_review', 'changes_requested', 'verified', 'archived'];
let activeController = null;

export function canRolePerformDemoAction(role, action) {
  return ACTION_ROLES[action] === role;
}

export function validateDisposalDraft(draft = {}) {
  const photos = Array.isArray(draft.photos) ? draft.photos : [];
  if (![draft.measures, draft.workOrder, draft.responsiblePerson, draft.completedAt].every((value) => String(value || '').trim()) || !photos.length) {
    return { valid: false, code: 'DISPOSAL_INCOMPLETE', message: '请完整填写处置措施、工单、负责人、完成时间并上传至少一张照片' };
  }
  return { valid: true, code: null, message: '' };
}

export function getWarningDemoAdviceContext(serverClosedLoop = {}, explicitState = null) {
  const snapshot = explicitState ? null : activeController?.getSnapshot?.();
  if (snapshot?.error || snapshot?.loading || (snapshot?.selectedId && !snapshot.run)) return { workflow_unavailable: true, selected_run_id: snapshot.selectedId, message: snapshot.error?.message || '读取中' };
  const state = explicitState || activeController?.store?.getState?.();
  if (!state || state.status === DEMO_STATES.READY) return serverClosedLoop;
  return {
    demo_event_id: state.eventId,
    demo_status: state.status,
    demo_status_label: demoStatusView(state.status).label,
    enterprise_work_order: state.disposal.workOrder || '',
    enterprise_measures: state.disposal.measures || '',
    evidence_photo_count: state.disposal.photos.length,
    regulator_decision: state.review.decision,
    regulator_opinion: state.review.opinion || '',
    rectification_deadline: state.review.deadline || '',
    server_closed_loop: serverClosedLoop,
  };
}

function element(id) {
  return globalThis.document?.getElementById(id) || null;
}

function setText(id, value) {
  const target = element(id);
  if (target) target.textContent = value ?? '--';
}

function formatTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}

function localDateTimeValue() {
  const date = new Date(Date.now() - (new Date().getTimezoneOffset() * 60000));
  return date.toISOString().slice(0, 16);
}

function showDialog(dialog) {
  if (dialog && !dialog.open) dialog.showModal?.();
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close?.();
}

function renderTimeline(id, timeline = []) {
  const container = element(id);
  if (!container) return;
  container.replaceChildren();
  if (!timeline.length) {
    const empty = document.createElement('p');
    empty.textContent = '保存事件启动后将在此记录完整处置时间线。';
    container.append(empty);
    return;
  }
  [...timeline].reverse().forEach((item) => {
    const row = document.createElement('p');
    const time = document.createElement('time');
    const actor = document.createElement('b');
    const detail = document.createElement('span');
    time.textContent = formatTime(item.at);
    actor.textContent = `${item.role} · ${item.actor}`;
    detail.textContent = item.detail;
    row.append(time, actor, detail);
    container.append(row);
  });
}

function renderSavedPlan(id, run, unavailable) {
  const container = element(id);
  if (!container) return;
  container.replaceChildren();
  const paragraph = text => { const row = document.createElement('p'); row.textContent = text; container.append(row); };
  const plan = unavailable ? null : run?.plan_versions?.at(-1);
  if (!plan?.advice) { paragraph(unavailable ? '当前保存方案不可用，请刷新后再确认。' : '当前事件没有保存的候选方案。'); return; }
  const advice = plan.advice;
  paragraph(`当前保存候选方案 · ${run.workflow_run_id} · 第 ${plan.version} 版 · ${plan.approved ? '企业已确认' : '待企业确认'}`);
  paragraph(`来源：${advice.source === 'deepseek' ? 'DeepSeek' : 'rule'}${advice.fallback_reason ? ` · 降级原因：${advice.fallback_reason}` : ''}`);
  paragraph(advice.summary);
  const recommendations = document.createElement('ol');
  (advice.recommendations || []).slice(0, 6).forEach(text => { const row = document.createElement('li'); row.textContent = text; recommendations.append(row); });
  container.append(recommendations);
  paragraph(`${advice.source === 'deepseek' ? 'DeepSeek实际引用' : '规则建议实际引用'}证据 ID：${(advice.evidence_ids || []).join('、') || '无'}`);
  paragraph('检索上下文 · 已审核工作流（与相似CSV示例、建议实际引用分别展示）');
  const context = plan.retrieved_context || [];
  if (!context.length) paragraph('本版未检索到已审核工作流。');
  context.slice(0, 20).forEach(item => paragraph(`已审核工作流 ${item.workflow_run_id} · CSV ${item.record_id} · 审核版本 ${item.review_version} / 修订 ${item.review_revision ?? '未知'} · ${formatTime(item.reviewed_at)} · 源模型 ${item.source_model?.name || '未知'} / ${item.source_model?.mode || '未知'} · 案例引用 ID ${item.evidence_id}`));
}

function renderRail(state) {
  const rail = element('warningDemoRail');
  if (!rail) return;
  const currentIndex = STEP_ORDER.indexOf(state.status);
  const rejected = state.timeline.some((item) => item.type === DEMO_ACTIONS.REJECT);
  rail.querySelectorAll('[data-demo-step]').forEach((node) => {
    const step = node.dataset.demoStep;
    const index = STEP_ORDER.indexOf(step);
    node.classList.remove('active', 'done');
    if (step === 'changes_requested' && !rejected && state.status !== DEMO_STATES.CHANGES_REQUESTED) return;
    if (step === state.status) node.classList.add('active');
    else if (currentIndex > index || state.status === DEMO_STATES.ARCHIVED) node.classList.add('done');
  });
  rail.querySelectorAll('i').forEach((connector, index) => {
    connector.classList.toggle('done', currentIndex > index || state.status === DEMO_STATES.ARCHIVED);
  });
}

function renderEvidenceList(container, records, { editable = false, onRemove = null } = {}) {
  if (!container) return [];
  const previewUrls = [];
  container.replaceChildren();
  if (!records.length) {
    const empty = document.createElement('p');
    empty.textContent = '尚未上传现场照片';
    container.append(empty);
    return previewUrls;
  }
  records.forEach((record) => {
    const figure = document.createElement('figure');
    const image = document.createElement('img');
    const caption = document.createElement('figcaption');
    const preview = createEvidencePreview(record);
    if (preview) {
      previewUrls.push(preview);
      image.src = preview;
    }
    image.alt = `现场证据：${record.name}`;
    image.width = 160;
    image.height = 120;
    image.loading = 'lazy';
    caption.textContent = `${record.name} · ${Number.isFinite(Number(record.size)) ? (Number(record.size) / 1024).toFixed(0) + ' KB' : '大小未提供'}`;
    caption.textContent += ' · 浏览器本地照片';
    if (preview) figure.append(image, caption);
    else {
      const missing = document.createElement('p');
      missing.textContent = '本浏览器没有原图，仅显示服务器保存的照片元数据。请在原上传浏览器查看。';
      figure.append(caption, missing);
    }
    if (editable && onRemove) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = record.storage_source === 'browser-local' ? '删除本地原图' : '移除草稿照片';
      remove.setAttribute('aria-label', `${remove.textContent} ${record.name}`);
      remove.addEventListener('click', () => onRemove(record.id));
      figure.append(remove);
    }
    container.append(figure);
  });
  return previewUrls;
}

async function responseJson(response, label) {
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return response.json();
}

export async function setupWarningDemo(options = {}) {
  activeController?.destroy?.();
  const user = options.user || {};
  const authFetch = options.authFetch;
  const ownedCoordinator = !options.coordinator;
  const coordinator = options.coordinator || createWorkflowCoordinator({ client: options.client || createWorkflowClient({ authFetch }) });
  const selectionClient = options.client;
  const store = createSavedDemoReadAdapter(() => coordinator.getSnapshot());
  const media = options.media || createWarningDemoMediaStore();
  let evidenceRecords = [];
  let sourceData = null;
  let comparisonData = null;
  let similarCases = null;
  let shownAlertRevision = null;
  let previewUrls = [];
  let destroyed = false;
  let selectedIdentity = null;
  let mediaSequence = 0;
  let listSequence = 0;
  let riskSequence = 0;
  const cleanups = [];

  function listen(id, eventName, handler) {
    const target = element(id);
    if (!target) return;
    target.addEventListener(eventName, handler);
    cleanups.push(() => target.removeEventListener(eventName, handler));
  }

  async function loadEvidence() {
    const runId = coordinator.getSnapshot().run?.workflow_run_id;
    const sequence = ++mediaSequence;
    if (!runId) { evidenceRecords = []; renderPhotos(store.getState()); return; }
    let records;
    try { records = await media.list(runId); } catch (_) { records = []; }
    if (destroyed || sequence !== mediaSequence || runId !== coordinator.getSnapshot().run?.workflow_run_id) return;
    evidenceRecords = records;
    renderPhotos(store.getState());
  }

  function renderPhotos(state) {
    revokeEvidencePreviews(previewUrls);
    previewUrls = [];
    const editable = user.role === 'enterprise' && [DEMO_STATES.DISPOSAL_IN_PROGRESS, DEMO_STATES.CHANGES_REQUESTED].includes(state.status);
    const runId = coordinator.getSnapshot().run?.workflow_run_id;
    const savedPhotos = state.disposal.photos || [];
    const records = [...savedPhotos.map(metadata => ({ ...metadata, ...evidenceRecords.find(item => item.id === metadata.id) })), ...evidenceRecords.filter(item => !savedPhotos.some(photo => photo.id === item.id))];
    previewUrls.push(...renderEvidenceList(element('enterprisePhotoList'), records, {
      editable,
      onRemove: async (id) => {
        try { await media.remove(runId, id); if (runId === coordinator.getSnapshot().run?.workflow_run_id) await loadEvidence(); }
        catch (error) { setText('enterpriseDisposalError', error.message); }
      },
    }));
    previewUrls.push(...renderEvidenceList(element('regulatorPhotoList'), records));
  }

  function clearSourceEvidence(message = '等待所选记录证据') {
    sourceData = null; comparisonData = null; similarCases = null;
    ['expertSimilarCases', 'expertDemoProbabilities'].forEach(id => element(id)?.replaceChildren());
    setText('expertDemoRiskLevel', '--');
    setText('enterpriseWarningEvidence', message);
    setText('expertDemoMechanism', message);
    element('regulatorMonitoringComparison')?.querySelectorAll('article').forEach(article => {
      article.querySelector('b').textContent = '--';
      article.querySelector('em').textContent = '--';
    });
  }

  async function loadRiskData() {
    if (typeof authFetch !== 'function') return true;
    const runId = coordinator.getSnapshot().run?.workflow_run_id;
    const recordId = coordinator.getSnapshot().run?.algorithm?.record_id;
    if (!recordId) return true;
    const sequence = ++riskSequence;
    clearSourceEvidence('正在读取所选记录证据…');
    try {
      const [sourceResponse, comparisonResponse, casesResponse] = await Promise.all([
        authFetch('/api/roof-risk/evaluate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ record_id: recordId }), cache: 'no-store',
        }),
        authFetch('/api/roof-risk/evaluate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ record_id: 'REC-202511101153-02911' }), cache: 'no-store',
        }),
        authFetch(`/api/roof-risk/similar-cases?record_id=${encodeURIComponent(recordId)}&limit=3`, { cache: 'no-store' }),
      ]);
      const loaded = await Promise.all([
        responseJson(sourceResponse, 'source record'),
        responseJson(comparisonResponse, 'comparison record'),
        responseJson(casesResponse, 'similar cases'),
      ]);
      if (destroyed || sequence !== riskSequence || runId !== coordinator.getSnapshot().run?.workflow_run_id) return false;
      [sourceData, comparisonData, similarCases] = loaded;
      render(store.getState());
      return true;
    } catch (error) {
      if (!destroyed && sequence === riskSequence && runId === coordinator.getSnapshot().run?.workflow_run_id) clearSourceEvidence(`真实数据接口暂不可用：${error.message}`);
      return false;
    }
  }

  function renderSourceData() {
    if (!sourceData) return;
    setText('enterpriseWarningScore', sourceData.risk?.score ?? '--');
    setText('enterpriseWarningRecord', sourceData.record_id || sourceData.model_output?.record_id || sourceData.provenance?.record_id);
    const confidence = Number(sourceData.model_output?.confidence);
    setText('enterpriseWarningConfidence', Number.isFinite(confidence) ? `${(confidence * 100).toFixed(2)}%` : '--');
    const evidence = Array.isArray(sourceData.feature_evidence) ? sourceData.feature_evidence : [];
    setText('enterpriseWarningEvidence', evidence.length
      ? `主要因素：${evidence.map((item) => `${item.label} ${Number(item.standardized_value) >= 0 ? '+' : ''}${Number(item.standardized_value).toFixed(2)}σ`).join('、')}`
      : '当前记录暂无特征证据');
    setText('expertDemoRiskLevel', `${sourceData.model_output?.predicted_class || '--'} · ${sourceData.risk?.score ?? '--'}`);
    setText('expertDemoMechanism', evidence.length
      ? `${evidence.map((item) => item.label).join('、')}是当前记录标准化偏离较大的监测项，可供现场复核。该统计排序尚未进行模型归因或工程因果验证。`
      : '等待真实记录的模型概率与主要特征证据。');
    const probabilityContainer = element('expertDemoProbabilities');
    if (probabilityContainer) {
      probabilityContainer.replaceChildren();
      Object.entries(sourceData.model_output?.probabilities || {}).forEach(([label, probability]) => {
        const item = document.createElement('div');
        const name = document.createElement('span');
        const value = document.createElement('b');
        name.textContent = label;
        value.textContent = `${(Number(probability) * 100).toFixed(2)}%`;
        item.append(name, value);
        probabilityContainer.append(item);
      });
    }
    const comparison = element('regulatorMonitoringComparison');
    const articles = comparison?.querySelectorAll('article');
    if (articles?.length === 2) {
      articles[0].querySelector('b').textContent = sourceData.risk?.score ?? '--';
      articles[0].querySelector('em').textContent = sourceData.record_id;
      articles[1].querySelector('b').textContent = comparisonData?.risk?.score ?? '--';
      articles[1].querySelector('em').textContent = comparisonData?.record_id || '--';
    }
  }

  function renderSimilarCases() {
    const container = element('expertSimilarCases');
    if (!container || !similarCases?.cases) return;
    container.replaceChildren();
    similarCases.cases.forEach((item) => {
      const row = document.createElement('article');
      const record = document.createElement('b');
      const label = document.createElement('span');
      const similarity = document.createElement('em');
      record.textContent = item.record_id;
      label.textContent = `${item.true_class} · 风险 ${item.risk_score} · ${item.timestamp}`;
      similarity.textContent = `相似度 ${(Number(item.similarity) * 100).toFixed(1)}%`;
      row.append(record, label, similarity);
      container.append(row);
    });
    const note = document.createElement('p');
    note.textContent = `来源 ${similarCases.source} · 标准化七特征欧氏距离 · SHA-256 ${String(similarCases.source_sha256).slice(0, 12)}`;
    container.append(note);
  }

  function renderEnterprise(state) {
    const editable = user.role === 'enterprise' && [DEMO_STATES.DISPOSAL_IN_PROGRESS, DEMO_STATES.CHANGES_REQUESTED].includes(state.status);
    const form = element('enterpriseDisposalForm');
    form?.querySelectorAll('textarea,input,button[type="submit"]').forEach((control) => { control.disabled = !editable; });
    const notice = element('enterpriseRectificationNotice');
    if (notice) {
      notice.hidden = state.status !== DEMO_STATES.CHANGES_REQUESTED;
      notice.textContent = state.status === DEMO_STATES.CHANGES_REQUESTED
        ? `监管整改意见：${state.review.opinion}；期限：${formatTime(state.review.deadline)}` : '';
    }
    const snapshot = coordinator.getSnapshot();
    const alertIdentity = `${snapshot.run?.workflow_run_id}:${snapshot.run?.revision}`;
    const feasible = snapshot.run?.nodes?.find(node => node.agent_id === 'A5')?.output?.feasibility === 'feasible';
    const acknowledge = element('warningDialogAcknowledge');
    if (acknowledge) { acknowledge.hidden = user.role !== 'enterprise'; acknowledge.disabled = !feasible || snapshot.pending || snapshot.loading || Boolean(snapshot.error) || !snapshot.run?.plan_versions?.at(-1)?.advice || state.status !== DEMO_STATES.ALERT_TRIGGERED; }
    if (user.role === 'enterprise' && state.status === DEMO_STATES.ALERT_TRIGGERED && shownAlertRevision !== alertIdentity && !snapshot.pending) {
      shownAlertRevision = alertIdentity;
      showDialog(element('enterpriseWarningDialog'));
    }
  }

  function renderRegulator(state) {
    setText('regulatorDemoBanner', demoStatusView(state.status).label);
    const summary = element('regulatorDisposalSummary');
    if (summary) {
      summary.replaceChildren();
      const rows = state.disposal.submissionCount
        ? [
          `企业处置：已提交（第 ${state.disposal.submissionCount} 次）`,
          `工单编号：${state.disposal.workOrder}`,
          `补强措施：${state.disposal.measures}`,
          `负责人 / 完成时间：${state.disposal.responsiblePerson} / ${formatTime(state.disposal.completedAt)}`,
        ] : ['企业处置：尚未提交', '现场照片：等待上传'];
      rows.forEach((text) => { const row = document.createElement('p'); row.textContent = text; summary.append(row); });
    }
    const reviewEnabled = user.role === 'regulator' && state.status === DEMO_STATES.PENDING_REVIEW;
    ['regulatorReviewOpinion', 'regulatorRectificationDeadline', 'regulatorRejectAction', 'regulatorApproveAction']
      .forEach((id) => { const control = element(id); if (control) control.disabled = !reviewEnabled; });
  }

  function renderExpert(state) {
    setText('expertDemoClosureStatus', demoStatusView(state.status).label);
    const archive = element('expertArchiveAction');
    const conclusion = element('expertArchiveConclusion');
    const enabled = user.role === 'expert' && state.status === DEMO_STATES.VERIFIED;
    if (archive) archive.disabled = !enabled;
    if (conclusion) conclusion.disabled = state.status === DEMO_STATES.ARCHIVED;
    if (state.status === DEMO_STATES.ARCHIVED) setText('expertArchiveConclusion', state.archive.conclusion);
  }

  function render(state) {
    const snapshot = coordinator.getSnapshot();
    const run = snapshot.run;
    const identity = snapshot.selectedId;
    if (selectedIdentity !== identity) {
      selectedIdentity = identity; mediaSequence++; riskSequence++;
      evidenceRecords = []; sourceData = null; comparisonData = null; similarCases = null; shownAlertRevision = null;
      ['enterpriseWarningDialog', 'enterpriseDisposalDrawer'].forEach(id => closeDialog(element(id)));
      clearFields(['disposalMeasures', 'disposalWorkOrder', 'disposalResponsiblePerson', 'disposalCompletedAt', 'regulatorReviewOpinion', 'regulatorRectificationDeadline', 'expertArchiveConclusion', 'workflowFeedbackReason', 'workflowMemoryConclusion', 'workflowPersonnel','workflowMaterials','workflowDevices','workflowMonitoringTrend','workflowExecutionStatus','disposalPhotos']);
      if (element('workflowReprocessConfirmed')) element('workflowReprocessConfirmed').checked=false;
      ['enterpriseDisposalError','regulatorReviewError','expertArchiveError','workflowActionError'].forEach(id=>setText(id,''));
      clearSourceEvidence();
    }
    const status = demoStatusView(state.status);
    if (document?.body) document.body.dataset.warningDemoState = state.status;
    setText('warningDemoStatus', snapshot.error ? `协同保存不可用：${snapshot.error.message}` : snapshot.loading ? '读取保存事件…' : run ? `${state.status === 'alert_triggered' ? run.algorithm.predicted_class + '预警已触发' : status.label} · ${status.progress}%` : '尚无保存事件');
    setText('warningDemoEventId', run ? `${run.workflow_run_id}` : snapshot.selectedId || '--');
    setText('workflowRunIdentity', run ? `${run.workflow_run_id} · 修订 ${run.revision} · CSV ${run.algorithm.record_id}` : '尚无保存事件');
    const plan = run?.plan_versions?.at(-1);
    const advice = plan?.advice;
    setText('workflowPlanSource', run ? `方案 ${plan?.version ?? '--'}/5 · ${advice ? advice.source === 'deepseek' ? 'DeepSeek' : 'rule' : '无候选方案'}${advice?.fallback_reason ? ` · 降级原因：${advice.fallback_reason}` : ''} · 反馈 ${run.feedback?.length ? '人工输入' : '未收到'} · 返回 ${run.next_action || '--'} · 复用原CSV记录，无新测量证据` : '--');
    ['workflowCurrentPlan', 'enterpriseWarningPlan'].forEach(id => renderSavedPlan(id, run, snapshot.loading || Boolean(snapshot.error) || run?.workflow_run_id !== snapshot.selectedId));
    const color = ({重大风险:'red',较大风险:'orange',一般风险:'yellow',低风险:'blue'})[run?.algorithm?.predicted_class] || 'none';
    if (element('enterpriseWarningDialog')) element('enterpriseWarningDialog').dataset.riskLevel = color;
    setText('workflowWarningColor',color.toUpperCase());
    setText('workflowWarningRisk',run?.algorithm?.predicted_class || '--');
    setText('enterpriseWarningRecord',run?.algorithm?.record_id || '--');
    setText('enterpriseWarningScore',run?.nodes?.find(node=>node.agent_id==='A1')?.output?.risk_score ?? '--');
    setText('enterpriseWarningConfidence',Number.isFinite(run?.algorithm?.confidence)?`${(run.algorithm.confidence*100).toFixed(2)}%`:'--');
    setText('enterpriseWarningTitle', `${run?.algorithm?.predicted_class || '待加载'}预警 · 企业确认候选方案`);
    setText('regulatorVerificationTitle', `${run?.algorithm?.predicted_class || '当前'}预警处置核验`);
    setText('expertDemoEventTitle', `所选${run?.algorithm?.predicted_class || ''}事件机理复盘`);
    renderRail(state);
    const launcher = element('warningDemoLauncher');
    const reset = element('warningDemoReset');
    if (launcher) {
      launcher.hidden = user.role !== 'enterprise';
      launcher.textContent = state.status === DEMO_STATES.READY ? '启动橙色预警演示' : '查看当前处置事件';
      launcher.disabled = snapshot.pending || snapshot.loading;
    }
    if (reset) reset.hidden = user.role !== 'enterprise' || state.status === DEMO_STATES.READY;
    if (reset) reset.disabled = snapshot.pending || snapshot.loading || Boolean(snapshot.error);
    if (element('workflowRunSelection')) { element('workflowRunSelection').value = snapshot.selectedId || '';element('workflowRunSelection').disabled=snapshot.pending || snapshot.loading; }
    if (element('workflowRefresh')) element('workflowRefresh').disabled = snapshot.pending || snapshot.loading;
    renderEnterprise(state);
    renderRegulator(state);
    renderExpert(state);
    renderSourceData();
    renderSimilarCases();
    renderPhotos(state);
    const active = Boolean(run) && state.status !== 'ready' && !['verified','archived'].includes(state.status);
    ['workflowResourceForm','workflowReprocessForm'].forEach(id => { if (element(id)) element(id).hidden = user.role !== 'enterprise' || !active; });
    ['workflowResourceForm','workflowReprocessForm','workflowMemoryForm'].forEach(id => element(id)?.querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled=false; }));
    if (element('workflowMemoryForm')) element('workflowMemoryForm').hidden = user.role !== 'expert' || state.status !== 'archived' || Boolean(run?.case_memory?.length);
    if (element('workflowReprocessSubmit')) element('workflowReprocessSubmit').disabled = (run?.plan_versions?.length || 0) >= 5;
    const resource = run?.nodes?.find(node => node.agent_id === 'A5')?.output?.snapshot;
    setText('workflowResourceSnapshot', resource ? `已保存资源：人员 ${resource.personnel_available} · 材料 ${resource.support_material_sets} · 设备 ${resource.inspection_devices}` : '--');
    setText('workflowResponsibility', `当前责任：${['verified','archived'].includes(state.status) ? '智库' : state.status === 'pending_review' ? '监管' : '企业'} · 照片原图仅存于上传浏览器`);
    const events = element('workflowEventHistory');
    if (events) { events.replaceChildren(); (run?.events || []).slice().reverse().forEach(item => { const row=document.createElement('p'); row.textContent=`${formatTime(item.at)} · ${item.actor?.role || '--'} / ${item.actor?.displayName || '--'} · ${item.type}`;events.append(row); }); }
    const memory = element('workflowCaseMemory');
    if (memory) { memory.replaceChildren(); (run?.case_memory || []).forEach(item => { const row=document.createElement('p');row.textContent=`已审核记忆：${item.reviewed_conclusion} · ${item.actor?.displayName} · ${formatTime(item.reviewed_at)}`;memory.append(row); }); }
    ['regulatorRejectAction','regulatorApproveAction'].forEach(id => { if (element(id)) element(id).hidden = user.role !== 'regulator'; });
    if (element('expertArchiveAction')) element('expertArchiveAction').hidden = user.role !== 'expert';
    const blocked = snapshot.pending || snapshot.loading || Boolean(snapshot.error) || !run;
    if (blocked) ['enterpriseDisposalForm','workflowResourceForm','workflowReprocessForm','workflowMemoryForm'].forEach(id => element(id)?.querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled=true; }));
    ['regulatorApproveAction','regulatorRejectAction','expertArchiveAction'].forEach(id => { if (blocked && element(id)) element(id).disabled = true; });
    ['enterpriseWarningTimeline', 'regulatorWarningTimeline', 'expertWarningTimeline'].forEach((id) => renderTimeline(id, state.timeline));
  }

  async function startOrOpen() {
    const state = store.getState();
    if (!coordinator.getSnapshot().run || state.status === DEMO_STATES.READY) {
      if (user.role !== 'enterprise') throw new Error('仅企业可以启动协同');
      await options.beforeStart?.();
      const saved = await coordinator.start({ recordId: 'REC-202511101149-02909' });
      try { await options.onSourceSelected?.(saved.algorithm.record_id); }
      catch(error) { setText('workflowActionError',`事件已保存；监测记录切换失败：${error.message}`); }
      return;
    }
    if (state.status === DEMO_STATES.ALERT_TRIGGERED) showDialog(element('enterpriseWarningDialog'));
    else showDialog(element('enterpriseDisposalDrawer'));
  }

  async function submitDisposal(event) {
    event.preventDefault();
    const runId=coordinator.getSnapshot().run?.workflow_run_id;
    const draft = {
      measures: element('disposalMeasures')?.value,
      workOrder: element('disposalWorkOrder')?.value,
      responsiblePerson: element('disposalResponsiblePerson')?.value,
      completedAt: element('disposalCompletedAt')?.value,
      photos: [...store.getState().disposal.photos.filter(photo => !evidenceRecords.some(item => item.id === photo.id)), ...evidenceRecords].map(({ id, name, size }) => ({ id, name, ...(size !== undefined ? { size } : {}) })),
    };
    const validation = validateDisposalDraft(draft);
    setText('enterpriseDisposalError', validation.valid ? '' : validation.message);
    if (!validation.valid) return;
    try {
      await coordinator.dispatch({ type: DEMO_ACTIONS.SUBMIT_DISPOSAL, payload: draft });
      if (destroyed || runId!==coordinator.getSnapshot().run?.workflow_run_id) return;
      clearFields(['disposalMeasures', 'disposalWorkOrder', 'disposalResponsiblePerson', 'disposalCompletedAt']);
      closeDialog(element('enterpriseDisposalDrawer'));
    } catch (error) { if(!destroyed && runId===coordinator.getSnapshot().run?.workflow_run_id)setText('enterpriseDisposalError', actionError(error)); }
  }

  function clearFields(ids) { ids.forEach(id => { if (element(id)) element(id).value = ''; }); }
  function actionError(error) { return error.status === 409 ? '其他角色已更新事件，请复核最新状态后再提交。草稿已保留。' : error.message; }
  async function action(type, payload, errorId, fields = []) {
    const runId=coordinator.getSnapshot().run?.workflow_run_id;
    try {
      await coordinator.dispatch({ type, payload });
      if (destroyed || runId!==coordinator.getSnapshot().run?.workflow_run_id) return false;
      clearFields(fields);setText(errorId,'');return true;
    } catch (error) {
      if (!destroyed && runId===coordinator.getSnapshot().run?.workflow_run_id) setText(errorId,actionError(error));
      return false;
    }
  }
  async function resetCurrent() {
    if (user.role !== 'enterprise') return;
    await options.beforeStart?.();
    const saved=await coordinator.reset({recordId:coordinator.getSnapshot().run?.algorithm.record_id || 'REC-202511101149-02909'});
    try { await options.onSourceSelected?.(saved.algorithm.record_id); }
    catch(error) { setText('workflowActionError',`新事件已保存；监测记录切换失败：${error.message}`); }
  }

  async function refreshRunList() {
    const picker=element('workflowRunSelection');
    if (!picker || !selectionClient) return true;
    const sequence=++listSequence;
    try {
      const runs=await selectionClient.list();
      if (destroyed || sequence!==listSequence) return false;
      const selected=coordinator.getSnapshot().run;
      if (selected && !runs.some(run=>run.workflow_run_id===selected.workflow_run_id)) runs.unshift(selected);
      picker.replaceChildren();
      if (!runs.length) { const empty=document.createElement('option');empty.value='';empty.textContent='尚无保存事件';picker.append(empty); }
      runs.forEach(run=>{const option=document.createElement('option');option.value=run.workflow_run_id;option.textContent=`${run.workflow_run_id} · r${run.revision} · ${run.algorithm.record_id} · ${run.demo_state.status}`;picker.append(option);});
      picker.value=coordinator.getSnapshot().selectedId || '';
      return true;
    } catch(error) {
      if (!destroyed && sequence===listSequence) setText('workflowActionError',`保存事件列表不可用：${error.message}`);
      return false;
    }
  }
  listen('workflowRunSelection','change',async event=>{if(!event.currentTarget.value)return;try{await coordinator.select(event.currentTarget.value);}catch(error){setText('workflowActionError',actionError(error));}});
  listen('workflowRefresh','click',async()=>{
    try {
      await coordinator.refresh();
      const runId = coordinator.getSnapshot().selectedId;
      const [listReady, evidenceReady] = await Promise.all([refreshRunList(), loadRiskData()]);
      if (destroyed || runId !== coordinator.getSnapshot().selectedId) return;
      if (listReady && evidenceReady) setText('workflowActionError','');
      else if (listReady && !evidenceReady) setText('workflowActionError','所选记录证据不可用，请刷新重试。');
    } catch(error) { if (!destroyed) setText('workflowActionError',actionError(error)); }
  });

  listen('warningDemoLauncher', 'click', () => startOrOpen().catch((error) => setText('warningDemoStatus', `启动失败：${error.message}`)));
  listen('warningDemoReset', 'click', async () => {
    try { await resetCurrent(); } catch (error) { setText('warningDemoStatus',actionError(error)); }
  });
  listen('warningDialogDismiss', 'click', () => closeDialog(element('enterpriseWarningDialog')));
  listen('warningDialogAcknowledge', 'click', async () => {
    if (!await action(DEMO_ACTIONS.ACKNOWLEDGE, {}, 'enterpriseDisposalError')) return;
    closeDialog(element('enterpriseWarningDialog'));
    showDialog(element('enterpriseDisposalDrawer'));
  });
  listen('enterpriseDisposalClose', 'click', () => closeDialog(element('enterpriseDisposalDrawer')));
  listen('enterpriseDisposalCancel', 'click', () => closeDialog(element('enterpriseDisposalDrawer')));
  listen('enterpriseDisposalForm', 'submit', submitDisposal);
  listen('disposalPhotos', 'change', async (event) => {
    const input = event.currentTarget;
    const runId = coordinator.getSnapshot().run?.workflow_run_id;
    if (!runId || coordinator.getSnapshot().pending) return;
    const selected = Array.from(input.files || []);
    const validation = validateEvidenceFiles([...evidenceRecords, ...selected]);
    setText('enterpriseDisposalError', validation.valid ? '' : validation.message);
    if (!validation.valid) { input.value = ''; return; }
    try {
      for (const file of selected) await media.put(runId, file);
      if (runId === coordinator.getSnapshot().run?.workflow_run_id) { input.value = ''; await loadEvidence(); }
    } catch (error) { if(!destroyed && runId===coordinator.getSnapshot().run?.workflow_run_id)setText('enterpriseDisposalError', error.message); }
  });
  listen('regulatorRejectAction', 'click', () => action('REJECT',{opinion:element('regulatorReviewOpinion')?.value,deadline:element('regulatorRectificationDeadline')?.value},'regulatorReviewError',['regulatorReviewOpinion','regulatorRectificationDeadline']));
  listen('regulatorApproveAction', 'click', () => action('APPROVE',{opinion:element('regulatorReviewOpinion')?.value},'regulatorReviewError',['regulatorReviewOpinion','regulatorRectificationDeadline']));
  listen('expertArchiveAction', 'click', () => action('ARCHIVE',{conclusion:element('expertArchiveConclusion')?.value},'expertArchiveError',['expertArchiveConclusion']));
  listen('workflowResourceForm','submit',async event => {
    event.preventDefault();const resource_snapshot={};
    for (const [id,key] of [['workflowPersonnel','personnel_available'],['workflowMaterials','support_material_sets'],['workflowDevices','inspection_devices']]) {
      const value=element(id)?.value;
      if (value !== undefined && value !== '') resource_snapshot[key]=Number(value);
    }
    if (!Object.keys(resource_snapshot).length || Object.values(resource_snapshot).some(value=>!Number.isSafeInteger(value)||value<0)) { setText('workflowActionError','填写至少一个非负整数资源数量');return; }
    await action('UPDATE_RESOURCES',{resource_snapshot},'workflowActionError',['workflowPersonnel','workflowMaterials','workflowDevices']);
  });
  listen('workflowReprocessForm','submit',async event => {
    event.preventDefault();if (!element('workflowReprocessConfirmed')?.checked) { setText('workflowActionError','请明确确认复用原CSV记录重新研判');return; }
    const feedback={};const reason=element('workflowFeedbackReason')?.value?.trim();
    if (reason) feedback.reason=reason;
    for (const [id,key] of [['workflowMonitoringTrend','monitoring_trend'],['workflowExecutionStatus','execution_status']]) { if (element(id)?.value) feedback[key]=element(id).value; }
    const ok=await action('REPROCESS',{confirmed:true,...(Object.keys(feedback).length?{feedback}:{})},'workflowActionError',['workflowFeedbackReason','workflowMonitoringTrend','workflowExecutionStatus']);
    if (ok) element('workflowReprocessConfirmed').checked=false;
  });
  listen('workflowMemoryForm','submit',async event => { event.preventDefault();await action('APPROVE_MEMORY',{reviewed_conclusion:element('workflowMemoryConclusion')?.value},'workflowActionError',['workflowMemoryConclusion']); });

  let loadedRunId = null;
  let loadedRevision = null;
  const unsubscribe = coordinator.subscribe((snapshot) => {
    render(store.getState());
    if (snapshot.run?.workflow_run_id !== loadedRunId) {
      loadedRunId = snapshot.run?.workflow_run_id; loadRiskData();refreshRunList();
    }
    const identity = `${snapshot.run?.workflow_run_id}:${snapshot.run?.revision}`;
    if (identity !== loadedRevision) { loadedRevision=identity;loadEvidence(); }
  });
  cleanups.push(unsubscribe);
  const controller = {
    store,
    getSnapshot:coordinator.getSnapshot,
    openCurrent() {
      if (user.role === 'regulator') { element('regulatorVerificationTitle')?.scrollIntoView?.({block:'nearest'});element('regulatorReviewOpinion')?.focus?.();return Promise.resolve(); }
      return startOrOpen();
    },
    resetCurrent,
    refreshRisk(payload) {
      if (payload?.model_output?.record_id === coordinator.getSnapshot().run?.algorithm?.record_id) sourceData = payload;
      render(store.getState());
    },
    destroy() {
      destroyed=true;mediaSequence++;riskSequence++;
      revokeEvidencePreviews(previewUrls);
      cleanups.forEach((cleanup) => cleanup());
      if (ownedCoordinator) coordinator.destroy();
    },
  };
  activeController = controller;
  if (!coordinator.getSnapshot().initialized) await coordinator.refresh().catch(() => {});
  const initial = store.getState();
  render(initial);
  refreshRunList();
  await loadEvidence();
  if (initial.status !== DEMO_STATES.READY) loadRiskData();
  if (element('disposalCompletedAt') && !element('disposalCompletedAt').value) element('disposalCompletedAt').value = localDateTimeValue();
  return controller;
}

export function refreshWarningDemoRisk(payload) {
  activeController?.refreshRisk(payload);
}

export function destroyWarningDemo() {
  activeController?.destroy?.();
  activeController = null;
}
