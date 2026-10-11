import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEMO_STATES,
  createInitialDemoState,
  createWarningDemoStore,
  reduceDemoState,
} from '../js/warning-demo-state.mjs';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('persisted workflow identity survives START and RESET without demo substitution', () => {
  const state = createInitialDemoState();
  Object.assign(state, { eventId: 'WF-00000000-0000-4000-8000-000000000001', sourceRecordId: 'REC-REAL-2', sourceEventId: 'WARN-REC-REAL-2', comparisonRecordId: null });
  const actor = { role: 'enterprise', displayName: 'enterprise' };
  const started = reduceDemoState(state, { type: 'START_DEMO', actor });
  const reset = reduceDemoState(started, { type: 'RESET', actor });
  for (const current of [started, reset]) {
    assert.equal(current.eventId, state.eventId);
    assert.equal(current.sourceRecordId, 'REC-REAL-2');
    assert.equal(current.comparisonRecordId, null);
  }
});

const enterprise = { role: 'enterprise', displayName: '企业演示员' };
const regulator = { role: 'regulator', displayName: '监管演示员' };
const expert = { role: 'expert', displayName: '智库演示员' };
const context = { now: () => '2026-09-07T10:00:00.000Z' };

test('orange warning demo follows the complete happy path', () => {
  let state = createInitialDemoState(context.now);
  state = reduceDemoState(state, { type: 'START_DEMO', actor: enterprise }, context);
  assert.equal(state.status, DEMO_STATES.ALERT_TRIGGERED);
  assert.equal(state.sourceRecordId, 'REC-202511101149-02909');

  state = reduceDemoState(state, { type: 'ACKNOWLEDGE', actor: enterprise }, context);
  assert.equal(state.status, DEMO_STATES.DISPOSAL_IN_PROGRESS);

  state = reduceDemoState(state, {
    type: 'SUBMIT_DISPOSAL',
    actor: enterprise,
    payload: {
      measures: '加密锚索并复核支架初撑力',
      workOrder: 'GD-2026-0907-01',
      responsiblePerson: '张工',
      completedAt: '2026-09-07T10:20',
      photos: [{ id: 'photo-1', name: '现场.jpg', size: 1024, type: 'image/jpeg' }],
    },
  }, context);
  assert.equal(state.status, DEMO_STATES.PENDING_REVIEW);

  state = reduceDemoState(state, {
    type: 'APPROVE', actor: regulator, payload: { opinion: '工单与后续监测对照完整，同意通过。' },
  }, context);
  assert.equal(state.status, DEMO_STATES.VERIFIED);

  state = reduceDemoState(state, {
    type: 'ARCHIVE', actor: expert, payload: { conclusion: '完成三端核验，纳入复盘案例库。' },
  }, context);
  assert.equal(state.status, DEMO_STATES.ARCHIVED);
  assert.equal(state.timeline.length, 5);
});

test('regulator can reject and enterprise can resubmit', () => {
  let state = createInitialDemoState(context.now);
  state = reduceDemoState(state, { type: 'START_DEMO', actor: enterprise }, context);
  state = reduceDemoState(state, { type: 'ACKNOWLEDGE', actor: enterprise }, context);
  const disposal = {
    measures: '增设临时支护', workOrder: 'GD-02', responsiblePerson: '李工',
    completedAt: '2026-09-07T10:20', photos: [{ id: 'p1', name: 'a.png', size: 1, type: 'image/png' }],
  };
  state = reduceDemoState(state, { type: 'SUBMIT_DISPOSAL', actor: enterprise, payload: disposal }, context);
  state = reduceDemoState(state, {
    type: 'REJECT', actor: regulator,
    payload: { opinion: '缺少支架初撑力复测说明。', deadline: '2026-09-07T12:00' },
  }, context);
  assert.equal(state.status, DEMO_STATES.CHANGES_REQUESTED);
  assert.equal(state.review.deadline, '2026-09-07T12:00');

  state = reduceDemoState(state, {
    type: 'SUBMIT_DISPOSAL', actor: enterprise,
    payload: { ...disposal, measures: '增设临时支护并补充支架初撑力复测。' },
  }, context);
  assert.equal(state.status, DEMO_STATES.PENDING_REVIEW);
  assert.equal(state.disposal.submissionCount, 2);
});

test('workflow rejects actions by the wrong role or in the wrong state', () => {
  let state = createInitialDemoState(context.now);
  assert.throws(
    () => reduceDemoState(state, { type: 'START_DEMO', actor: regulator }, context),
    /ACTION_NOT_ALLOWED/,
  );
  state = reduceDemoState(state, { type: 'START_DEMO', actor: enterprise }, context);
  assert.throws(
    () => reduceDemoState(state, { type: 'APPROVE', actor: regulator, payload: { opinion: '通过' } }, context),
    /INVALID_TRANSITION/,
  );
  assert.throws(
    () => reduceDemoState(state, { type: 'ARCHIVE', actor: expert, payload: { conclusion: '归档' } }, context),
    /INVALID_TRANSITION/,
  );
});

test('enterprise submission requires complete work order and photo evidence', () => {
  let state = createInitialDemoState(context.now);
  state = reduceDemoState(state, { type: 'START_DEMO', actor: enterprise }, context);
  state = reduceDemoState(state, { type: 'ACKNOWLEDGE', actor: enterprise }, context);
  assert.throws(
    () => reduceDemoState(state, {
      type: 'SUBMIT_DISPOSAL', actor: enterprise,
      payload: { measures: '', workOrder: '', responsiblePerson: '', completedAt: '', photos: [] },
    }, context),
    /DISPOSAL_INCOMPLETE/,
  );
});

test('store restores valid state and recovers corrupt persisted JSON', () => {
  const storage = memoryStorage();
  const store = createWarningDemoStore({ storage, now: context.now });
  store.dispatch({ type: 'START_DEMO', actor: enterprise });
  const restored = createWarningDemoStore({ storage, now: context.now });
  assert.equal(restored.getState().status, DEMO_STATES.ALERT_TRIGGERED);

  const corrupt = memoryStorage({ 'smart-mine-warning-demo:v1': '{bad json' });
  const recovered = createWarningDemoStore({ storage: corrupt, now: context.now });
  assert.equal(recovered.getState().status, DEMO_STATES.READY);
});

test('reset returns to ready and records a fresh event revision', () => {
  const storage = memoryStorage();
  const store = createWarningDemoStore({ storage, now: context.now });
  const started = store.dispatch({ type: 'START_DEMO', actor: enterprise });
  const reset = store.dispatch({ type: 'RESET', actor: enterprise });
  assert.equal(reset.status, DEMO_STATES.READY);
  assert.ok(reset.revision > started.revision);
  assert.equal(reset.timeline.length, 0);
});
