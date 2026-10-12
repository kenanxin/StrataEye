import { demoStatusView } from './warning-demo-state.mjs';

export const WORKFLOW_SELECTION_KEY = 'smart-mine-workflow:selected-run';
export class WorkflowHttpError extends Error {
  constructor(status, body) {
    super(body?.message || body?.error?.message || (typeof body?.error === 'string' ? body.error : `HTTP ${status}`));
    this.status = status;
    this.code = body?.code || body?.error?.code || (typeof body?.error === 'string' ? body.error : 'WORKFLOW_HTTP_ERROR');
  }
}
function commandId() { return globalThis.crypto?.randomUUID?.() || `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export function createWorkflowClient({ authFetch }) {
  async function request(path, body) {
    const init = { cache: 'no-store' };
    if (body) Object.assign(init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    // Only an ambiguous transport failure is retried, with the exact same command.
    let response;
    try { response = await authFetch(path, init); }
    catch (error) { if (!body) throw error; response = await authFetch(path, init); }
    const result = await response.json();
    if (!response.ok) throw new WorkflowHttpError(response.status, result);
    return result;
  }
  return {
    start({ recordId, resourceSnapshot }) {
      return request('/api/multi-agent/run', { record_id: recordId, ...(resourceSnapshot !== undefined ? { resource_snapshot: resourceSnapshot } : {}), command_id: commandId() });
    },
    async list({ recordId, limit = 20 } = {}) {
      const query = new URLSearchParams({ limit: String(limit), ...(recordId ? { record_id: recordId } : {}) });
      return (await request(`/api/multi-agent/runs?${query}`)).runs;
    },
    get(runId) { return request(`/api/multi-agent/runs/${encodeURIComponent(runId)}`); },
    status() { return request('/api/multi-agent/status'); },
    act({ runId, type, payload = {}, expectedRevision }) {
      return request(`/api/multi-agent/runs/${encodeURIComponent(runId)}/actions`, { type, payload, expected_revision: expectedRevision, command_id: commandId() });
    },
  };
}

export function createWorkflowCoordinator({ client, storage = globalThis.localStorage, pollInterval = 10000, maxPolls = 60 } = {}) {
  const listeners = new Set();
  let selectedId = null;
  try { selectedId = storage?.getItem(WORKFLOW_SELECTION_KEY) || null; } catch (_) { /* selection cache is optional */ }
  let snapshot = { run: null, selectedId, loading: false, pending: false, error: null, initialized: false };
  let generation = 0, readSequence = 0, destroyed = false, timer = null, polls = 0;
  function publish(patch) {
    if (destroyed) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(api.getSnapshot());
  }
  function accept(run) {
    selectedId = run?.workflow_run_id || null;
    try { if (selectedId) storage?.setItem(WORKFLOW_SELECTION_KEY, selectedId); } catch (_) { /* selection only */ }
    publish({ run, selectedId, loading: false, initialized: true });
  }
  function schedule() {
    clearTimeout(timer);
    if (!destroyed && pollInterval > 0 && polls < maxPolls) {
      timer = setTimeout(async () => {
        polls++;
        if (!snapshot.pending) await api.refresh().catch(() => {});
        schedule();
      }, pollInterval);
      timer.unref?.();
    }
  }
  async function mutate(operation) {
    if (snapshot.pending) throw new Error('已有操作正在保存，请等待完成');
    const epoch = ++generation;
    publish({ pending: true, error: null });
    try {
      const run = await operation();
      if (epoch === generation) {
        if (snapshot.run?.workflow_run_id === run.workflow_run_id && snapshot.run.revision > run.revision) await api.refresh();
        else accept(run);
      }
      return run;
    } catch (error) {
      if (error.status === 409 && epoch === generation) await api.refresh().catch(() => {});
      if (epoch === generation) publish({ error });
      throw error;
    } finally { if (epoch === generation) publish({ pending: false }); }
  }
  const api = {
    getSnapshot() { return { ...snapshot, run: snapshot.run ? structuredClone(snapshot.run) : null }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async refresh() {
      const epoch = generation, seq = ++readSequence, id = selectedId;
      publish({ loading: !snapshot.run });
      try {
        let run;
        if (id) run = await client.get(id);
        else { const runs = await client.list(); run = runs?.[0] || null; }
        if (epoch === generation && seq === readSequence && id === selectedId && !destroyed) {
          if (!run || !snapshot.run || run.workflow_run_id !== snapshot.run.workflow_run_id || run.revision >= snapshot.run.revision) accept(run);
          publish({ error: null });
        }
        return run;
      } catch (error) {
        if (epoch === generation && seq === readSequence) publish({ loading: false, initialized: true, error });
        throw error;
      }
    },
    async select(runId) {
      if (snapshot.pending) throw new Error('保存完成后再选择事件');
      generation++; selectedId = runId;
      publish({ selectedId, run: null, error: null, initialized: false });
      return api.refresh();
    },
    start(options) { return mutate(() => client.start(options)); },
    reset(options = {}) {
      return api.start({ recordId: options.recordId || snapshot.run?.algorithm?.record_id, resourceSnapshot: options.resourceSnapshot });
    },
    dispatch({ type, payload = {} }) {
      if (!snapshot.run || snapshot.error) return Promise.reject(new Error('协同保存状态不可用，请刷新后重试'));
      const run = snapshot.run;
      return mutate(() => client.act({ runId: run.workflow_run_id, type, payload, expectedRevision: run.revision }));
    },
    destroy() { destroyed = true; generation++; clearTimeout(timer); listeners.clear(); },
  };
  schedule();
  return api;
}

export function projectWorkflowClosedLoop(run) {
  if (!run) return null;
  const state = run.demo_state, view = demoStatusView(state.status, run.algorithm.predicted_class);
  const role = ['pending_review', 'changes_requested'].includes(state.status) ? (state.status === 'pending_review' ? 'regulator' : 'enterprise')
    : ['verified', 'archived'].includes(state.status) ? 'expert' : 'enterprise';
  const order = ['alert_triggered', 'disposal_in_progress', 'pending_review', 'verified', 'archived'];
  const current = state.status === 'changes_requested' ? 1 : order.indexOf(state.status);
  return {
    eventId: run.workflow_run_id, revision: run.revision, label: view.label, progress: view.progress,
    source: `已保存协同 · ${run.algorithm.record_id} · r${run.revision}`,
    owner: { enterprise: '企业', regulator: '监管', expert: '智库' }[role],
    next: run.next_action || run.phase, timeline: state.timeline || [],
    canSign: run.algorithm.predicted_class !== '低风险' && state.status !== 'ready',
    steps: order.map((status, index) => ({ id: status, label: demoStatusView(status,run.algorithm.predicted_class).label, owner: index < 2 ? '企业' : index === 2 ? '监管' : '智库', status: index < current ? 'done' : index === current ? 'active' : 'pending' })),
  };
}
