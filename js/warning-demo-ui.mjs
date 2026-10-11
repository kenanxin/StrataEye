import { DEMO_ACTIONS, DEMO_EVENT_ID, DEMO_STATES, createWarningDemoStore } from './warning-demo-state.mjs';
import {
  createEvidencePreview,
  createWarningDemoMediaStore,
  revokeEvidencePreviews,
  validateEvidenceFiles,
} from './warning-demo-media.mjs';

const STATUS_VIEW = Object.freeze({
  ready: { label: '尚未启动', progress: 0 },
  alert_triggered: { label: '橙色预警已触发', progress: 12 },
  disposal_in_progress: { label: '企业现场处置中', progress: 30 },
  pending_review: { label: '等待监管核验', progress: 58 },
  changes_requested: { label: '监管已驳回，等待整改', progress: 48 },
  verified: { label: '监管核验通过', progress: 82 },
  archived: { label: '事件已闭环归档', progress: 100 },
});

const ACTION_ROLES = Object.freeze({
  START_DEMO: 'enterprise', ACKNOWLEDGE: 'enterprise', SUBMIT_DISPOSAL: 'enterprise', RESET: 'enterprise',
  REJECT: 'regulator', APPROVE: 'regulator', ARCHIVE: 'expert',
});

const STEP_ORDER = ['alert_triggered', 'disposal_in_progress', 'pending_review', 'changes_requested', 'verified', 'archived'];
let activeController = null;

export function canRolePerformDemoAction(role, action) {
  return ACTION_ROLES[action] === role;
}

export function demoStatusView(status) {
  return { ...(STATUS_VIEW[status] || STATUS_VIEW.ready) };
}

export function validateDisposalDraft(draft = {}) {
  const photos = Array.isArray(draft.photos) ? draft.photos : [];
  if (![draft.measures, draft.workOrder, draft.responsiblePerson, draft.completedAt].every((value) => String(value || '').trim()) || !photos.length) {
    return { valid: false, code: 'DISPOSAL_INCOMPLETE', message: '请完整填写处置措施、工单、负责人、完成时间并上传至少一张照片' };
  }
  return { valid: true, code: null, message: '' };
}

export function getWarningDemoAdviceContext(serverClosedLoop = {}, explicitState = null) {
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
    empty.textContent = '演示启动后将在此记录完整处置时间线。';
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
    caption.textContent = `${record.name} · ${(Number(record.size) / 1024).toFixed(0)} KB`;
    figure.append(image, caption);
    if (editable && onRemove) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除照片 ${record.name}`);
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
  const store = options.store || createWarningDemoStore();
  const media = options.media || createWarningDemoMediaStore();
  const actor = { role: user.role, displayName: user.displayName || user.username || user.role };
  let evidenceRecords = [];
  let sourceData = null;
  let comparisonData = null;
  let similarCases = null;
  let shownAlertRevision = null;
  let previewUrls = [];
  const cleanups = [];

  function listen(id, eventName, handler) {
    const target = element(id);
    if (!target) return;
    target.addEventListener(eventName, handler);
    cleanups.push(() => target.removeEventListener(eventName, handler));
  }

  async function loadEvidence() {
    try { evidenceRecords = await media.list(DEMO_EVENT_ID); } catch (_) { evidenceRecords = []; }
    renderPhotos(store.getState());
  }

  function renderPhotos(state) {
    revokeEvidencePreviews(previewUrls);
    previewUrls = [];
    const editable = user.role === 'enterprise' && [DEMO_STATES.DISPOSAL_IN_PROGRESS, DEMO_STATES.CHANGES_REQUESTED].includes(state.status);
    previewUrls.push(...renderEvidenceList(element('enterprisePhotoList'), evidenceRecords, {
      editable,
      onRemove: async (id) => { await media.remove(DEMO_EVENT_ID, id); await loadEvidence(); },
    }));
    previewUrls.push(...renderEvidenceList(element('regulatorPhotoList'), evidenceRecords));
  }

  async function loadRiskData() {
    if (typeof authFetch !== 'function') return;
    try {
      const [sourceResponse, comparisonResponse, casesResponse] = await Promise.all([
        authFetch('/api/roof-risk/evaluate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ record_id: 'REC-202511101149-02909' }), cache: 'no-store',
        }),
        authFetch('/api/roof-risk/evaluate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ record_id: 'REC-202511101153-02911' }), cache: 'no-store',
        }),
        authFetch('/api/roof-risk/similar-cases?record_id=REC-202511101149-02909&limit=3', { cache: 'no-store' }),
      ]);
      [sourceData, comparisonData, similarCases] = await Promise.all([
        responseJson(sourceResponse, 'source record'),
        responseJson(comparisonResponse, 'comparison record'),
        responseJson(casesResponse, 'similar cases'),
      ]);
      render(store.getState());
    } catch (error) {
      console.warn('Warning demo real-data context unavailable:', error);
      setText('expertDemoMechanism', '真实数据接口暂不可用，无法加载模型机理与相似案例。');
    }
  }

  function renderSourceData() {
    if (!sourceData) return;
    setText('enterpriseWarningScore', sourceData.risk?.score ?? 70);
    setText('enterpriseWarningRecord', sourceData.record_id || sourceData.model_output?.record_id || sourceData.provenance?.record_id);
    const confidence = Number(sourceData.model_output?.confidence);
    setText('enterpriseWarningConfidence', Number.isFinite(confidence) ? `${(confidence * 100).toFixed(2)}%` : '--');
    const evidence = Array.isArray(sourceData.feature_evidence) ? sourceData.feature_evidence : [];
    setText('enterpriseWarningEvidence', evidence.length
      ? `主要因素：${evidence.map((item) => `${item.label} ${Number(item.standardized_value) >= 0 ? '+' : ''}${Number(item.standardized_value).toFixed(2)}σ`).join('、')}`
      : '当前记录暂无特征证据');
    setText('expertDemoRiskLevel', `${sourceData.model_output?.predicted_class || '较大风险'} · ${sourceData.risk?.score ?? 70}`);
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
      articles[0].querySelector('b').textContent = sourceData.risk?.score ?? 70;
      articles[0].querySelector('em').textContent = sourceData.record_id;
      articles[1].querySelector('b').textContent = comparisonData?.risk?.score ?? 45;
      articles[1].querySelector('em').textContent = comparisonData?.record_id || 'REC-202511101153-02911';
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
    const editable = [DEMO_STATES.DISPOSAL_IN_PROGRESS, DEMO_STATES.CHANGES_REQUESTED].includes(state.status);
    const form = element('enterpriseDisposalForm');
    form?.querySelectorAll('textarea,input,button[type="submit"]').forEach((control) => { control.disabled = !editable; });
    const notice = element('enterpriseRectificationNotice');
    if (notice) {
      notice.hidden = state.status !== DEMO_STATES.CHANGES_REQUESTED;
      notice.textContent = state.status === DEMO_STATES.CHANGES_REQUESTED
        ? `监管整改意见：${state.review.opinion}；期限：${formatTime(state.review.deadline)}` : '';
    }
    if (editable && state.disposal.submissionCount > 0) {
      const values = {
        disposalMeasures: state.disposal.measures,
        disposalWorkOrder: state.disposal.workOrder,
        disposalResponsiblePerson: state.disposal.responsiblePerson,
        disposalCompletedAt: state.disposal.completedAt,
      };
      Object.entries(values).forEach(([id, value]) => { const input = element(id); if (input && document.activeElement !== input) input.value = value; });
    } else if (!editable && state.disposal.submissionCount > 0) {
      ['disposalMeasures', 'disposalWorkOrder', 'disposalResponsiblePerson', 'disposalCompletedAt'].forEach((id) => {
        const input = element(id);
        if (input && document.activeElement !== input) input.value = '';
      });
    }
    if (user.role === 'enterprise' && state.status === DEMO_STATES.ALERT_TRIGGERED && shownAlertRevision !== state.revision) {
      shownAlertRevision = state.revision;
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
    const status = demoStatusView(state.status);
    if (document?.body) document.body.dataset.warningDemoState = state.status;
    setText('warningDemoStatus', `${status.label} · ${status.progress}%`);
    setText('warningDemoEventId', state.eventId);
    renderRail(state);
    const launcher = element('warningDemoLauncher');
    const reset = element('warningDemoReset');
    if (launcher) {
      launcher.hidden = user.role !== 'enterprise';
      launcher.textContent = state.status === DEMO_STATES.READY ? '启动橙色预警演示' : '查看当前处置事件';
    }
    if (reset) reset.hidden = user.role !== 'enterprise' || state.status === DEMO_STATES.READY;
    renderEnterprise(state);
    renderRegulator(state);
    renderExpert(state);
    renderSourceData();
    renderSimilarCases();
    renderPhotos(state);
    ['enterpriseWarningTimeline', 'regulatorWarningTimeline', 'expertWarningTimeline'].forEach((id) => renderTimeline(id, state.timeline));
  }

  async function startOrOpen() {
    const state = store.getState();
    if (state.status === DEMO_STATES.READY) {
      const response = await authFetch('/api/roof-risk/select', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: 'REAL-MAJOR-001' }), cache: 'no-store',
      });
      await responseJson(response, 'select orange event');
      store.dispatch({ type: DEMO_ACTIONS.START_DEMO, actor });
      await loadRiskData();
      await options.onSourceSelected?.();
      return;
    }
    if (state.status === DEMO_STATES.ALERT_TRIGGERED) showDialog(element('enterpriseWarningDialog'));
    else showDialog(element('enterpriseDisposalDrawer'));
  }

  async function submitDisposal(event) {
    event.preventDefault();
    const draft = {
      measures: element('disposalMeasures')?.value,
      workOrder: element('disposalWorkOrder')?.value,
      responsiblePerson: element('disposalResponsiblePerson')?.value,
      completedAt: element('disposalCompletedAt')?.value,
      photos: evidenceRecords.map(({ id, name, size, type, createdAt }) => ({ id, name, size, type, createdAt })),
    };
    const validation = validateDisposalDraft(draft);
    setText('enterpriseDisposalError', validation.valid ? '' : validation.message);
    if (!validation.valid) return;
    store.dispatch({ type: DEMO_ACTIONS.SUBMIT_DISPOSAL, actor, payload: draft });
    ['disposalMeasures', 'disposalWorkOrder', 'disposalResponsiblePerson', 'disposalCompletedAt'].forEach((id) => {
      const input = element(id);
      if (input) input.value = '';
    });
    closeDialog(element('enterpriseDisposalDrawer'));
  }

  listen('warningDemoLauncher', 'click', () => startOrOpen().catch((error) => setText('warningDemoStatus', `启动失败：${error.message}`)));
  listen('warningDemoReset', 'click', async () => {
    if (!globalThis.confirm?.('确认清除本次演示的工单、照片和时间线并重新开始吗？')) return;
    await media.clear(DEMO_EVENT_ID).catch(() => {});
    evidenceRecords = [];
    store.dispatch({ type: DEMO_ACTIONS.RESET, actor });
  });
  listen('warningDialogDismiss', 'click', () => closeDialog(element('enterpriseWarningDialog')));
  listen('warningDialogAcknowledge', 'click', () => {
    store.dispatch({ type: DEMO_ACTIONS.ACKNOWLEDGE, actor });
    closeDialog(element('enterpriseWarningDialog'));
    showDialog(element('enterpriseDisposalDrawer'));
  });
  listen('enterpriseDisposalClose', 'click', () => closeDialog(element('enterpriseDisposalDrawer')));
  listen('enterpriseDisposalCancel', 'click', () => closeDialog(element('enterpriseDisposalDrawer')));
  listen('enterpriseDisposalForm', 'submit', submitDisposal);
  listen('disposalPhotos', 'change', async (event) => {
    const input = event.currentTarget;
    const selected = Array.from(input.files || []);
    const validation = validateEvidenceFiles([...evidenceRecords, ...selected]);
    setText('enterpriseDisposalError', validation.valid ? '' : validation.message);
    if (!validation.valid) { input.value = ''; return; }
    try {
      for (const file of selected) await media.put(DEMO_EVENT_ID, file);
      input.value = '';
      await loadEvidence();
    } catch (error) { setText('enterpriseDisposalError', error.message); }
  });
  listen('regulatorRejectAction', 'click', () => {
    try {
      store.dispatch({
        type: DEMO_ACTIONS.REJECT, actor,
        payload: { opinion: element('regulatorReviewOpinion')?.value, deadline: element('regulatorRectificationDeadline')?.value },
      });
      setText('regulatorReviewError', '');
    } catch (error) { setText('regulatorReviewError', error.message.replace(/^\w+:\s*/, '')); }
  });
  listen('regulatorApproveAction', 'click', () => {
    try {
      store.dispatch({ type: DEMO_ACTIONS.APPROVE, actor, payload: { opinion: element('regulatorReviewOpinion')?.value } });
      setText('regulatorReviewError', '');
    } catch (error) { setText('regulatorReviewError', error.message.replace(/^\w+:\s*/, '')); }
  });
  listen('expertArchiveAction', 'click', () => {
    try {
      store.dispatch({ type: DEMO_ACTIONS.ARCHIVE, actor, payload: { conclusion: element('expertArchiveConclusion')?.value } });
      setText('expertArchiveError', '');
    } catch (error) { setText('expertArchiveError', error.message.replace(/^\w+:\s*/, '')); }
  });

  const unsubscribe = store.subscribe((state) => {
    render(state);
    loadEvidence();
  });
  cleanups.push(unsubscribe);
  const controller = {
    store,
    refreshRisk(payload) {
      if (payload?.model_output?.record_id === 'REC-202511101149-02909') sourceData = payload;
      render(store.getState());
    },
    destroy() {
      revokeEvidencePreviews(previewUrls);
      cleanups.forEach((cleanup) => cleanup());
      store.destroy?.();
    },
  };
  activeController = controller;
  const initial = store.getState();
  render(initial);
  await loadEvidence();
  if (initial.status !== DEMO_STATES.READY) await loadRiskData();
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
