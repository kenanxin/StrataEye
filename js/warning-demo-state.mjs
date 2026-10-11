export const DEMO_STORAGE_KEY = 'smart-mine-warning-demo:v1';
export const DEMO_EVENT_ID = 'DEMO-ORANGE-001';

export const DEMO_STATES = Object.freeze({
  READY: 'ready',
  ALERT_TRIGGERED: 'alert_triggered',
  DISPOSAL_IN_PROGRESS: 'disposal_in_progress',
  PENDING_REVIEW: 'pending_review',
  CHANGES_REQUESTED: 'changes_requested',
  VERIFIED: 'verified',
  ARCHIVED: 'archived',
});

export const DEMO_ACTIONS = Object.freeze({
  START_DEMO: 'START_DEMO',
  ACKNOWLEDGE: 'ACKNOWLEDGE',
  SUBMIT_DISPOSAL: 'SUBMIT_DISPOSAL',
  REJECT: 'REJECT',
  APPROVE: 'APPROVE',
  ARCHIVE: 'ARCHIVE',
  RESET: 'RESET',
});

const VALID_STATES = new Set(Object.values(DEMO_STATES));
const ACTION_ROLES = Object.freeze({
  START_DEMO: 'enterprise',
  ACKNOWLEDGE: 'enterprise',
  SUBMIT_DISPOSAL: 'enterprise',
  REJECT: 'regulator',
  APPROVE: 'regulator',
  ARCHIVE: 'expert',
  RESET: 'enterprise',
});

const VALID_FROM = Object.freeze({
  START_DEMO: [DEMO_STATES.READY],
  ACKNOWLEDGE: [DEMO_STATES.ALERT_TRIGGERED],
  SUBMIT_DISPOSAL: [DEMO_STATES.DISPOSAL_IN_PROGRESS, DEMO_STATES.CHANGES_REQUESTED],
  REJECT: [DEMO_STATES.PENDING_REVIEW],
  APPROVE: [DEMO_STATES.PENDING_REVIEW],
  ARCHIVE: [DEMO_STATES.VERIFIED],
  RESET: Object.values(DEMO_STATES),
});

function isoNow(now) {
  const value = typeof now === 'function' ? now() : new Date().toISOString();
  return value instanceof Date ? value.toISOString() : String(value);
}

function clean(value) {
  return String(value ?? '').trim();
}

function workflowError(code, detail = '') {
  const error = new Error(`${code}${detail ? `: ${detail}` : ''}`);
  error.code = code;
  return error;
}

function actorFor(action) {
  const role = clean(action?.actor?.role);
  const displayName = clean(action?.actor?.displayName) || role;
  return { role, displayName };
}

function timelineEntry(type, actor, at, detail) {
  return {
    id: `${at}-${type}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    role: actor.role,
    actor: actor.displayName,
    at,
    detail,
  };
}

export function createInitialDemoState(now = () => new Date().toISOString(), revision = 0) {
  const timestamp = isoNow(now);
  return {
    version: 1,
    revision,
    eventId: DEMO_EVENT_ID,
    sourceEventId: 'REAL-MAJOR-001',
    sourceRecordId: 'REC-202511101149-02909',
    comparisonRecordId: 'REC-202511101153-02911',
    status: DEMO_STATES.READY,
    alertSeenRevision: null,
    disposal: {
      measures: '',
      workOrder: '',
      responsiblePerson: '',
      completedAt: '',
      photos: [],
      submittedAt: null,
      submissionCount: 0,
    },
    review: { decision: null, opinion: '', deadline: '', reviewedAt: null, reviewer: '' },
    archive: { conclusion: '', archivedAt: null, archivedBy: '' },
    timeline: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function assertSubmission(payload = {}) {
  const photos = Array.isArray(payload.photos) ? payload.photos : [];
  if (!clean(payload.measures) || !clean(payload.workOrder) || !clean(payload.responsiblePerson)
    || !clean(payload.completedAt) || photos.length < 1) {
    throw workflowError('DISPOSAL_INCOMPLETE', '处置措施、工单、负责人、完成时间和现场照片均为必填项');
  }
}

function assertReview(payload = {}, rejected = false) {
  if (!clean(payload.opinion) || (rejected && !clean(payload.deadline))) {
    throw workflowError('REVIEW_INCOMPLETE', rejected ? '驳回意见和整改期限均为必填项' : '核验意见为必填项');
  }
}

function assertState(state) {
  const validIdentity = state?.eventId === DEMO_EVENT_ID || (/^WF-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(state?.eventId || '') && typeof state?.sourceRecordId === 'string' && state.sourceRecordId.length > 0);
  if (!state || state.version !== 1 || !validIdentity || !VALID_STATES.has(state.status)
    || !Array.isArray(state.timeline) || !state.disposal || !state.review || !state.archive) {
    throw workflowError('INVALID_DEMO_STATE');
  }
}

export function reduceDemoState(currentState, action, context = {}) {
  assertState(currentState);
  const type = clean(action?.type);
  const requiredRole = ACTION_ROLES[type];
  if (!requiredRole) throw workflowError('UNKNOWN_ACTION', type);
  const actor = actorFor(action);
  if (actor.role !== requiredRole) throw workflowError('ACTION_NOT_ALLOWED', `${type} requires ${requiredRole}`);
  if (!VALID_FROM[type].includes(currentState.status)) {
    throw workflowError('INVALID_TRANSITION', `${currentState.status} -> ${type}`);
  }

  const at = isoNow(context.now);
  if (type === DEMO_ACTIONS.RESET) {
    const reset = createInitialDemoState(() => at, currentState.revision + 1);
    for (const key of ['eventId', 'sourceEventId', 'sourceRecordId', 'comparisonRecordId']) reset[key] = currentState[key];
    return reset;
  }
  if (type === DEMO_ACTIONS.START_DEMO) {
    const started = createInitialDemoState(() => at, currentState.revision + 1);
    for (const key of ['eventId', 'sourceEventId', 'sourceRecordId', 'comparisonRecordId']) started[key] = currentState[key];
    started.status = DEMO_STATES.ALERT_TRIGGERED;
    started.timeline = [timelineEntry(type, actor, at, 'XGBoost 多元数据融合触发橙色预警。')];
    return started;
  }

  const next = structuredClone(currentState);
  next.revision += 1;
  next.updatedAt = at;
  let detail = '';

  if (type === DEMO_ACTIONS.ACKNOWLEDGE) {
    next.status = DEMO_STATES.DISPOSAL_IN_PROGRESS;
    next.alertSeenRevision = currentState.revision;
    detail = '企业端确认预警并进入现场处置。';
  }
  if (type === DEMO_ACTIONS.SUBMIT_DISPOSAL) {
    assertSubmission(action.payload);
    const submissionCount = Number(currentState.disposal.submissionCount || 0) + 1;
    next.status = DEMO_STATES.PENDING_REVIEW;
    next.disposal = {
      measures: clean(action.payload.measures),
      workOrder: clean(action.payload.workOrder),
      responsiblePerson: clean(action.payload.responsiblePerson),
      completedAt: clean(action.payload.completedAt),
      photos: structuredClone(action.payload.photos),
      submittedAt: at,
      submissionCount,
    };
    detail = submissionCount > 1 ? `企业端第 ${submissionCount} 次提交整改材料。` : '企业端提交工单与现场照片，等待监管核验。';
  }
  if (type === DEMO_ACTIONS.REJECT) {
    assertReview(action.payload, true);
    next.status = DEMO_STATES.CHANGES_REQUESTED;
    next.review = {
      decision: 'rejected',
      opinion: clean(action.payload.opinion),
      deadline: clean(action.payload.deadline),
      reviewedAt: at,
      reviewer: actor.displayName,
    };
    detail = `监管端驳回整改：${next.review.opinion}`;
  }
  if (type === DEMO_ACTIONS.APPROVE) {
    assertReview(action.payload);
    next.status = DEMO_STATES.VERIFIED;
    next.review = {
      decision: 'approved',
      opinion: clean(action.payload.opinion),
      deadline: '',
      reviewedAt: at,
      reviewer: actor.displayName,
    };
    detail = `监管端核验通过：${next.review.opinion}`;
  }
  if (type === DEMO_ACTIONS.ARCHIVE) {
    const conclusion = clean(action.payload?.conclusion);
    if (!conclusion) throw workflowError('ARCHIVE_INCOMPLETE', '复盘结论为必填项');
    next.status = DEMO_STATES.ARCHIVED;
    next.archive = { conclusion, archivedAt: at, archivedBy: actor.displayName };
    detail = `智库端确认闭环并纳入案例库：${conclusion}`;
  }

  next.timeline.push(timelineEntry(type, actor, at, detail));
  return next;
}

export function createWarningDemoStore(options = {}) {
  const storage = options.storage ?? globalThis.localStorage;
  const now = options.now ?? (() => new Date().toISOString());
  const listeners = new Set();

  function load() {
    try {
      const raw = storage?.getItem(DEMO_STORAGE_KEY);
      if (!raw) return createInitialDemoState(now);
      const parsed = JSON.parse(raw);
      assertState(parsed);
      return parsed;
    } catch (_) {
      return createInitialDemoState(now);
    }
  }

  let state = load();

  function notify() {
    const snapshot = structuredClone(state);
    listeners.forEach((listener) => listener(snapshot));
    if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
      globalThis.dispatchEvent(new CustomEvent('smart-mine-warning-demo', { detail: snapshot }));
    }
  }

  function persist() {
    storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  }

  const storageListener = (event) => {
    if (event.key !== DEMO_STORAGE_KEY) return;
    state = load();
    notify();
  };
  globalThis.addEventListener?.('storage', storageListener);

  return {
    getState() { return structuredClone(state); },
    dispatch(action) {
      state = reduceDemoState(state, action, { now });
      persist();
      notify();
      return structuredClone(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      listeners.clear();
      globalThis.removeEventListener?.('storage', storageListener);
    },
  };
}
