'use strict';

const { createHash } = require('node:crypto');
const { WorkflowStoreError } = require('./workflow-store.js');
const { createMultiAgentWorkflowService } = require('./multi-agent-workflow-service.js');
const POLICY = Object.freeze({ ACKNOWLEDGE: 'enterprise', SUBMIT_DISPOSAL: 'enterprise', REJECT: 'regulator', APPROVE: 'regulator', ARCHIVE: 'expert', REPROCESS: 'enterprise', UPDATE_RESOURCES: 'enterprise', APPROVE_MEMORY: 'expert' });
const ACTIVE = ['alert_triggered', 'disposal_in_progress', 'changes_requested', 'pending_review'];
const COMMAND = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const reducer = () => import('../js/warning-demo-state.mjs');
function fail(status, message) { throw new WorkflowStoreError(status === 403 ? 'WORKFLOW_FORBIDDEN' : status === 409 ? 'WORKFLOW_CONFLICT' : 'WORKFLOW_INVALID_INPUT', message, status); }
function identity(actor) {
  const id = actor?.subject || actor?.username;
  if (typeof id !== 'string' || !id.trim() || typeof actor.role !== 'string') fail(403, 'A trusted actor identity is required');
  return id;
}
function command(actor, commandId) {
  if (typeof commandId !== 'string' || !COMMAND.test(commandId)) fail(400, 'A valid command_id is required');
  return createHash('sha256').update(JSON.stringify([identity(actor), commandId])).digest('hex');
}
function runIdFor(key) {
  const hex = `${key.slice(0, 12)}4${key.slice(13, 16)}8${key.slice(17, 32)}`;
  return `WF-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function publicActor(actor) { return { identity: identity(actor), role: actor.role, displayName: String(actor.displayName || actor.role), ...(actor.subject ? { subject: actor.subject } : { username: actor.username }) }; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function feedbackFor(type, payload, actor, at) {
  const feedback = { type, actor, at, source: 'human-input' };
  for (const key of ['monitoring_trend', 'execution_status']) {
    if (payload[key] !== undefined) {
      const allowed = key === 'monitoring_trend' ? ['stable', 'worsened', 'improved'] : ['completed', 'failed', 'pending_human_approval'];
      if (!allowed.includes(payload[key])) fail(400, `Invalid ${key}`);
      feedback[key] = payload[key];
    }
  }
  if (type === 'REJECT') { feedback.execution_status = 'failed'; feedback.opinion = payload.opinion; feedback.deadline = payload.deadline; }
  if (type === 'UPDATE_RESOURCES') { feedback.resource_changed = true; feedback.resource_snapshot = payload.resource_snapshot; }
  return feedback;
}

function createAgentCollaborationService({ repository, store, adviceService, now = () => new Date().toISOString() } = {}) {
  const builder = createMultiAgentWorkflowService(repository);
  const at = () => { const value = now(); return value instanceof Date ? value.toISOString() : String(value); };
  const available = () => { if (!store) throw new WorkflowStoreError('WORKFLOW_STORAGE_UNAVAILABLE', 'Durable workflow storage is unavailable', 503); };
  async function reviewedMemory(recordId, similarIds) {
    const runs = (await Promise.all([recordId, ...similarIds].map(id => store.list({ recordId: id, limit: 100 })))).flat();
    return runs.filter(run => run.demo_state.status === 'archived').flatMap(run => run.case_memory.filter(item => item.reviewed === true && item.reviewed_conclusion && item.actor?.role === 'expert').map(() => {
      const evaluated = repository.evaluateRecord(run.algorithm.record_id);
      const assessment = currentFeedback(run);
      return { reviewed: true, workflow_run_id: run.workflow_run_id, record_id: evaluated.record_id, risk_class: evaluated.model_output.predicted_class,
        action_codes: [...new Set(run.events.map(event => event.type).filter(type => Object.hasOwn(POLICY, type)))], outcome: 'archived',
        ...(assessment.monitoring_trend ? { monitoring_trend: assessment.monitoring_trend } : {}),
        ...(assessment.execution_status ? { execution_status: assessment.execution_status } : {}) };
    }));
  }
  async function plan(run, version, timestamp) {
    const decision = run.nodes.find(node => node.agent_id === 'A3');
    if (!decision.output) return null;
    const evaluated = repository.evaluateRecord(run.algorithm.record_id);
    const featureEvidence = Object.entries(evaluated.metrics).filter(([key]) => key !== 'data_quality').map(([key, metric]) => ({ ...metric, key, label: evaluated.feature_evidence.find(item => item.key === key)?.label || key, id: `feature:${run.algorithm.record_id}:${key}` }));
    const similarIds = run.nodes.find(node => node.agent_id === 'A2').output.cases.map(item => item.record_id);
    const memory = await reviewedMemory(run.algorithm.record_id, similarIds);
    const input = { risk: { predicted_class: run.algorithm.predicted_class, confidence: run.algorithm.confidence, score: run.nodes[0].output.risk_score }, feature_evidence: featureEvidence, similar_record_ids: similarIds, reviewed_memory: memory, rule_recommendations: decision.output.actions };
    const advice = await adviceService.generateWorkflowAdvice(input);
    decision.output = { ...decision.output, decision_mode: advice.source === 'deepseek' ? 'deepseek_proposal' : 'rule_assisted', actions: advice.recommendations, advice, plan_version: version };
    decision.output_summary = advice.summary;
    const control = run.nodes.find(node => node.agent_id === 'A4');
    if (control.output) control.output.portal_tasks.enterprise = advice.recommendations;
    return { version, created_at: timestamp, source_record_id: run.algorithm.record_id, monitoring_evidence: 'original_csv_record', feedback_source: run.feedback.length ? 'human-input' : 'none', feedback_start_index: run.feedback.length, advice, resources: structuredClone(run.nodes.find(node => node.agent_id === 'A5').output.snapshot), approved: false };
  }
  function currentFeedback(run) {
    const currentPlan = run.plan_versions.at(-1);
    const startIndex = currentPlan?.feedback_start_index || 0;
    const assessment = Object.assign({}, ...run.feedback.slice(startIndex));
    const resourceIndex = Math.max(startIndex, currentPlan?.resource_feedback_consumed_index || 0);
    assessment.resource_changed = run.feedback.slice(resourceIndex).some(item => item.resource_changed === true);
    return assessment;
  }
  function reflectSaved(run) {
    const feedback = currentFeedback(run);
    if (run.nodes.find(node => node.agent_id === 'A5').output?.feasibility === 'infeasible') feedback.resource_changed = true;
    const reflection = builder.reflect({ run, feedback });
    if (['verified', 'archived'].includes(run.demo_state.status)) {
      reflection.status = 'success';
      reflection.return_decision = { action: 'finish', reason: run.demo_state.status === 'archived' ? '监管已核验且专家已完成归档，历史人工反馈保留用于审计。' : '监管已完成当前方案核验，等待专家复盘归档。', operator_confirmation_required: true };
    }
    const node = run.nodes.find(node => node.agent_id === 'A6');
    node.status = reflection.status; node.output = reflection; node.output_summary = reflection.return_decision.reason;
    run.next_action = reflection.return_decision.action;
    return reflection;
  }
  return {
    async status() {
      let ready = Boolean(store);
      if (store) { try { await store.list({ limit: 1 }); } catch (_) { ready = false; } }
      return { ...builder.status(), available: ready, storage_provider: store?.storage_provider || 'unavailable', durable: ready, advice_configured: Boolean(adviceService?.configured), learning_mode: 'reviewed_case_memory' };
    },
    async start({ recordId, resourceSnapshot, actor, commandId }) {
      identity(actor); if (actor.role !== 'enterprise') fail(403, 'Only enterprise can start collaboration runs');
      const key = command(actor, commandId), id = runIdFor(key);
      available();
      try { const existing = await store.get(id); return await store.create(existing, { commandId: key }); }
      catch (error) { if (error.statusCode !== 404) throw error; }
      const run = builder.run({ recordId, resourceSnapshot });
      const timestamp = at(), { createInitialDemoState } = await reducer();
      run.workflow_run_id = id; run.revision = 0; run.phase = run.current_phase;
      run.created_at = timestamp; run.updated_at = timestamp; run.feedback = []; run.case_memory = []; run.plan_versions = [];
      run.demo_state = createInitialDemoState(() => timestamp);
      Object.assign(run.demo_state, { eventId: id, sourceEventId: run.warning_id, sourceRecordId: run.algorithm.record_id, comparisonRecordId: null });
      run.events = [{ type: 'START', actor: publicActor(actor), command_id: commandId, command_key: key, at: timestamp }];
      if (run.current_phase !== 'finish') {
        run.demo_state.status = 'alert_triggered';
        run.demo_state.timeline.push({ id: `${id}-start`, type: 'START', role: actor.role, actor: String(actor.displayName || actor.role), at: timestamp, detail: `XGBoost判定${run.algorithm.predicted_class}，等待企业确认候选方案。` });
        run.plan_versions.push(await plan(run, 1, timestamp));
        if (run.next_action === 'return_to_resource') reflectSaved(run);
      }
      return store.create(run, { commandId: key });
    },
    async get(runId) { available(); return store.get(runId); },
    async list(query) { available(); return store.list(query); },
    async reflect(runId) { available(); const run = await store.get(runId); if (run.current_phase === 'finish') fail(400, 'Low-risk monitoring run has no reflection workflow'); return reflectSaved(run); },
    async act({ runId, type, payload = {}, actor, expectedRevision, commandId }) {
      identity(actor);
      if (!Object.hasOwn(POLICY, type)) fail(400, 'Unknown workflow action');
      if (actor.role !== POLICY[type]) fail(403, 'Actor cannot perform this action');
      const key = command(actor, commandId); available();
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !object(payload)) fail(400, 'Valid expected_revision and payload are required');
      const current = await store.get(runId);
      if (current.events.some(event => event.command_key === key)) return store.save(current, { expectedRevision, commandId: key, event: { type } });
      if (current.revision !== expectedRevision) fail(409, 'Workflow revision changed; reload the current state');
      if (current.current_phase === 'finish') fail(400, 'Low-risk monitoring run has no business actions');
      const run = structuredClone(current), timestamp = at(), trustedActor = publicActor(actor);
      const event = { type, actor: trustedActor, command_id: commandId, command_key: key, payload: structuredClone(payload), at: timestamp };
      if (['REPROCESS', 'UPDATE_RESOURCES'].includes(type)) {
        if (!ACTIVE.includes(run.demo_state.status)) fail(400, 'Action requires an active unverified run');
        if (type === 'UPDATE_RESOURCES') {
          if (!object(payload.resource_snapshot)) fail(400, 'resource_snapshot is required');
          const snapshot = { ...run.nodes[3].output.snapshot, ...payload.resource_snapshot };
          const calculated = builder.run({ recordId: run.algorithm.record_id, resourceSnapshot: snapshot });
          run.nodes[3] = calculated.nodes[3];
          run.nodes[4] = calculated.nodes[4];
          if (run.nodes[4].output) run.nodes[4].output.portal_tasks.enterprise = structuredClone(run.nodes[2].output.actions);
          event.payload.resource_snapshot = snapshot;
          run.feedback.push(feedbackFor(type, event.payload, trustedActor, timestamp));
          run.plan_versions.at(-1).approved = false;
          run.demo_state.status = 'alert_triggered'; run.demo_state.alertSeenRevision = null;
          run.demo_state.timeline.push({ id: `${key}-resources`, type, role: actor.role, actor: trustedActor.displayName, at: timestamp, detail: '人工更新资源快照，重新评估可行性，等待企业确认。' });
          run.phase = calculated.current_phase; run.current_phase = run.phase;
          reflectSaved(run);
        } else {
          if (payload.confirmed !== true) fail(400, 'Explicit human confirmation is required');
          if (run.plan_versions.length >= 5) fail(400, 'Maximum of five plan versions reached');
          if (payload.feedback !== undefined) {
            const assessment = payload.feedback;
            if (!object(assessment) || !Object.keys(assessment).length || Object.keys(assessment).some(key => !['monitoring_trend', 'execution_status', 'reason'].includes(key))) fail(400, 'Only manual trend, execution status and reason are accepted');
            const feedback = feedbackFor('REPROCESS_FEEDBACK', assessment, trustedActor, timestamp);
            if (assessment.reason !== undefined) {
              if (typeof assessment.reason !== 'string' || !assessment.reason.trim() || assessment.reason.length > 2000) fail(400, 'Manual feedback reason must be a non-empty string of at most 2000 characters');
              feedback.reason = assessment.reason.trim();
            }
            run.feedback.push(feedback);
          }
          const returnTarget = reflectSaved(run).return_decision.action;
          const calculated = builder.run({ recordId: run.algorithm.record_id, resourceSnapshot: run.nodes[3].output.snapshot });
          run.nodes = [run.nodes[0], ...calculated.nodes.slice(1)];
          const extraStep = {
            return_to_perception: '人工反馈提示趋势恶化，复核原记录并补充经核验的新监测证据',
            return_to_decision: '根据保存的整改反馈重新复核处置措施并补充工单证据',
            return_to_resource: '复核人工更新的资源快照并补齐已记录的资源缺口',
          }[returnTarget];
          if (extraStep) run.nodes[2].output.actions.push(extraStep);
          run.plan_versions.push(await plan(run, run.plan_versions.length + 1, timestamp));
          run.plan_versions.at(-1).reprocess_from = returnTarget;
          run.demo_state.status = 'alert_triggered'; run.demo_state.alertSeenRevision = null;
          run.demo_state.review = { decision: null, opinion: '', deadline: '', reviewedAt: null, reviewer: '' };
          run.demo_state.timeline.push({ id: `${key}-reprocess`, type, role: actor.role, actor: trustedActor.displayName, at: timestamp, detail: '复用原CSV模型记录生成新候选方案，等待企业重新确认；人工趋势反馈尚未提供新测量证据。' });
          run.phase = calculated.current_phase; run.current_phase = run.phase; run.next_action = calculated.next_action;
          if (calculated.next_action === 'return_to_resource') reflectSaved(run);
        }
        run.demo_state.revision += 1; run.demo_state.updatedAt = timestamp;
      } else if (type === 'APPROVE_MEMORY') {
        if (run.demo_state.status !== 'archived' || typeof payload.reviewed_conclusion !== 'string' || !payload.reviewed_conclusion.trim()) fail(400, 'Archived run and explicit reviewed conclusion are required');
        if (run.case_memory.length) fail(400, 'Case memory has already been reviewed');
        run.case_memory.push({ reviewed: true, reviewed_conclusion: payload.reviewed_conclusion.trim(), actor: trustedActor, reviewed_at: timestamp });
        run.demo_state.revision += 1; run.demo_state.updatedAt = timestamp;
        run.demo_state.timeline.push({ id: `${key}-memory`, type, role: actor.role, actor: trustedActor.displayName, at: timestamp, detail: '专家人工审核复盘摘要并允许后续案例检索参考。' });
      } else {
        if (type === 'ACKNOWLEDGE' && run.nodes[3].output.feasibility !== 'feasible') fail(400, 'Resources must be feasible before plan confirmation');
        if (type === 'SUBMIT_DISPOSAL') {
          if (run.nodes[3].output.feasibility !== 'feasible' || !run.plan_versions.at(-1).approved) fail(400, 'A feasible enterprise-confirmed plan is required');
          if (Array.isArray(payload.photos)) {
            if (!payload.photos.every(photo => object(photo) && typeof photo.name === 'string' && photo.name.trim() && (!Object.hasOwn(photo, 'id') || typeof photo.id === 'string' && COMMAND.test(photo.id)) && (!Object.hasOwn(photo, 'size') || Number.isSafeInteger(photo.size) && photo.size >= 0))) fail(400, 'Valid browser-local photo metadata and opaque photo IDs are required');
            event.payload.photos = payload.photos.map((photo, index) => ({ id: photo.id ?? `PHOTO-${key.slice(0, 32)}-${index}`, name: photo.name, ...(Object.hasOwn(photo, 'size') ? { size: photo.size } : {}), storage_source: 'browser-local' }));
            if (new Set(event.payload.photos.map(photo => photo.id)).size !== event.payload.photos.length) fail(400, 'Photo IDs must be distinct within a submission');
          }
          run.feedback.push(feedbackFor(type, payload, trustedActor, timestamp));
        }
        if (type === 'REJECT') run.feedback.push(feedbackFor(type, payload, trustedActor, timestamp));
        const { reduceDemoState } = await reducer();
        try { run.demo_state = reduceDemoState(run.demo_state, { type, payload: event.payload, actor: trustedActor }, { now: () => timestamp }); }
        catch (error) { fail(error.code === 'ACTION_NOT_ALLOWED' ? 403 : 400, 'Invalid workflow transition or incomplete action fields'); }
        run.phase = run.demo_state.status; run.current_phase = run.phase;
        if (type === 'ACKNOWLEDGE') {
          Object.assign(run.plan_versions.at(-1), { approved: true, approved_by: trustedActor, approved_at: timestamp, approved_resources: structuredClone(run.nodes[3].output.snapshot), resource_feedback_consumed_index: run.feedback.length });
        }
        reflectSaved(run);
      }
      run.revision += 1; run.updated_at = timestamp;
      return store.save(run, { expectedRevision, commandId: key, event });
    },
  };
}
module.exports = { createAgentCollaborationService };
