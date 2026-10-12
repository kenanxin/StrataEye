'use strict';

// Local HTTP acceptance only. No browser, cloud account or external provider is used.
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { randomBytes, scryptSync } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const RECORD = 'REC-202511101149-02909';
const ROLES = { enterprise: 'enterprise_operator', regulator: 'regulator_officer', expert: 'expert_analyst' };

function createAdviceCaptureBarrier() {
  const captures = new Map(), waiters = new Map();
  return {
    capture({ invocation_id, memory }) {
      captures.set(invocation_id, memory);
      if (captures.size > 100) captures.delete(captures.keys().next().value);
      for (const finish of waiters.get(invocation_id) || []) finish(memory);
      waiters.delete(invocation_id);
    },
    wait(invocationId, timeoutMs = 10000) {
      if (captures.has(invocationId)) return Promise.resolve(captures.get(invocationId));
      return new Promise((resolve, reject) => {
        const pending = waiters.get(invocationId) || new Set();
        const finish = memory => { clearTimeout(timer); pending.delete(finish); resolve(memory); };
        const timer = setTimeout(() => { pending.delete(finish); if (!pending.size) waiters.delete(invocationId); reject(new Error(`IPC advice capture timeout: ${invocationId}`)); }, timeoutMs);
        pending.add(finish); waiters.set(invocationId, pending);
      });
    },
  };
}

async function childServer({ directory, password }) {
  const { createAppServer } = require('../server.js');
  const { createAuthService } = require('../server/auth-service.js');
  const { createFileWorkflowStore } = require('../server/workflow-store.js');
  const { createExpertAdviceService } = require('../server/expert-advice-service.js');
  const salt = randomBytes(16);
  const hash = ['scrypt', 16384, 8, 1, salt.toString('hex'), scryptSync(password, salt, 64).toString('hex')].join('$');
  const authService = createAuthService({ env: Object.fromEntries(['ENTERPRISE', 'REGULATOR', 'EXPERT'].map(role => [`ROOFRISK_${role}_PASSWORD_HASH`, hash])) });
  authService.provider = 'local';
  const disabled = createExpertAdviceService({ apiKey: '', fetchImpl: async () => { throw new Error('External provider forbidden in local QA'); } });
  const expertAdviceService = {
    configured: false,
    async generateWorkflowAdvice(input) {
      for (const memory of input.reviewed_memory) {
        assert.ok(!['actor', 'reviewed_conclusion', 'photos', 'responsiblePerson'].some(key => Object.hasOwn(memory, key)));
        assert.equal(memory.outcome, 'archived');
        assert.equal(memory.reviewed, true);
      }
      process.send({ kind: 'advice', invocation_id: input.advice_invocation_id, memory: input.reviewed_memory.map(item => ({ workflow_run_id: item.workflow_run_id, record_id: item.record_id })) });
      return disabled.generateWorkflowAdvice(input);
    },
  };
  const server = createAppServer({ authService, workflowStore: createFileWorkflowStore({ directory }), expertAdviceService });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.send({ kind: 'ready', port: server.address().port, pid: process.pid });
  process.on('message', message => {
    if (message.kind === 'stop') {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
    }
  });
}

async function launch(directory, password) {
  const child = fork(__filename, ['--child'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const advice = createAdviceCaptureBarrier();
  let outputBytes = 0;
  // Do not print child output or auth responses. Only count unexpected diagnostics.
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { outputBytes += bytes.length; });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Local child startup timeout')); }, 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Local child exited before readiness (${code})`)); });
    child.on('message', message => {
      if (message.kind === 'advice') advice.capture(message);
      if (message.kind === 'ready') { clearTimeout(timer); resolve(message); }
    });
    child.send({ kind: 'init', directory, password });
  });
  return {
    ...ready, base: `http://127.0.0.1:${ready.port}`, waitForAdvice: run => advice.wait(`${run.workflow_run_id}:v${run.plan_versions.at(-1).version}`),
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      const timer = setTimeout(() => child.kill(), 10000);
      child.send({ kind: 'stop' });
      const [code, signal] = await exited;
      clearTimeout(timer);
      assert.equal(code, 0, `Child shutdown failed (${signal || code})`);
      assert.equal(outputBytes, 0, 'Unexpected child diagnostics; inspect locally without logging secrets');
    },
  };
}

function client(server, password) {
  let cookie = '';
  async function request(route, body, expected = 200) {
    const response = await fetch(`${server.base}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, expected, `${route}: expected HTTP ${expected}, got ${response.status}`);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response.json();
  }
  return {
    request,
    async login(role) {
      const result = await request('/api/auth/login', { username: ROLES[role], password });
      assert.equal(result.user.role, role);
      assert.equal((await request('/api/auth/session')).user.role, role);
    },
    logout: () => request('/api/auth/logout', {}),
    get: id => request(`/api/multi-agent/runs/${id}`),
    start: (command, extra = {}) => request('/api/multi-agent/run', { record_id: RECORD, command_id: command, ...extra }),
    act: (run, type, payload = {}, command = `${type}-${run.revision}`, expected = 200) => request(`/api/multi-agent/runs/${run.workflow_run_id}/actions`, { type, payload, command_id: command, expected_revision: run.revision }, expected),
  };
}

async function acceptance() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mine-teacher-feedback-qa-'));
  const password = randomBytes(32).toString('base64url');
  let server;
  const startedAt = new Date().toISOString();
  const chain = [];
  const disposal = {
    measures: '本地合成验收：复测并补充支护检查记录', workOrder: 'QA-WO-1', responsiblePerson: '合成验收操作员',
    completedAt: '2026-10-12T10:00:00Z', photos: [{ id: 'qa-local-photo', name: 'qa-metadata.jpg', size: 42 }],
    monitoring_trend: 'stable', execution_status: 'completed',
  };
  try {
    server = await launch(directory, password);
    const firstPid = server.pid;
    const a = client(server, password), b = client(server, password);
    await a.login('enterprise');
    await b.login('expert');
    const status = await a.request('/api/multi-agent/status');
    assert.equal(status.storage_provider, 'file'); assert.equal(status.durable, true); assert.equal(status.advice_configured, false);
    let run = await a.start('qa-start');
    const original = structuredClone(run);
    assert.equal(run.revision, 0); assert.equal(run.algorithm.record_id, RECORD);
    assert.deepEqual(await a.start('qa-start'), original);
    chain.push({ action: 'START', revision: run.revision, status: run.demo_state.status });
    async function action(type, payload, command) {
      run = await a.act(run, type, payload, command);
      assert.equal(run.revision, chain.length);
      chain.push({ action: type, revision: run.revision, status: run.demo_state.status });
    }
    await action('ACKNOWLEDGE', {}, 'qa-ack');
    const ack = structuredClone(run);
    await a.act(original, 'ACKNOWLEDGE', {}, 'qa-stale', 409);
    await action('SUBMIT_DISPOSAL', disposal, 'qa-submit');
    await a.logout(); await a.login('regulator');
    await a.act(run, 'ARCHIVE', { conclusion: 'wrong role' }, 'qa-forbidden', 403);
    await action('REJECT', { opinion: '本地验收：补充检查记录', deadline: '2026-10-15' }, 'qa-reject');
    await a.logout(); await a.login('enterprise');
    await action('SUBMIT_DISPOSAL', { ...disposal, workOrder: 'QA-WO-2' }, 'qa-resubmit');
    assert.deepEqual(await a.act(original, 'ACKNOWLEDGE', {}, 'qa-ack'), ack);
    assert.equal((await a.get(run.workflow_run_id)).events.length, 5);
    await a.logout(); await a.login('regulator');
    await action('APPROVE', { opinion: '本地验收：已核验' }, 'qa-approve');
    await a.logout(); await a.login('expert');
    await action('ARCHIVE', { conclusion: '本地合成流程归档' }, 'qa-archive');
    assert.deepEqual(await b.get(run.workflow_run_id), run);
    // Archiving alone does not admit memory to later advice.
    await a.logout(); await a.login('enterprise');
    const beforeMemory = await a.start('qa-before-memory');
    assert.equal((await server.waitForAdvice(beforeMemory)).length, 0);
    assert.deepEqual(beforeMemory.plan_versions[0].retrieved_context, []);
    await a.logout(); await a.login('expert');
    await action('APPROVE_MEMORY', { reviewed_conclusion: '合成私密复盘文本仅供本地审计' }, 'qa-memory');
    assert.equal(run.revision, 7); assert.equal(run.events.length, 8);
    assert.deepEqual(run.algorithm, original.algorithm); assert.deepEqual(run.nodes[0], original.nodes[0]);
    assert.equal(run.feedback.filter(item => item.type === 'SUBMIT_DISPOSAL').length, 2);
    assert.equal(run.demo_state.disposal.photos[0].storage_source, 'browser-local');
    assert.equal(run.events.find(item => item.type === 'SUBMIT_DISPOSAL').payload.photos[0].id, 'qa-local-photo');
    await a.request('/api/multi-agent/runs/WF-00000000-0000-4000-8000-999999999999', undefined, 404);
    const saved = structuredClone(await a.get(run.workflow_run_id));
    await server.stop(); server = undefined;
    server = await launch(directory, password); // A genuinely different Node process, same directory.
    assert.notEqual(server.pid, firstPid);
    const restarted = client(server, password), other = client(server, password);
    await restarted.login('enterprise'); await other.login('expert');
    assert.deepEqual(await restarted.get(saved.workflow_run_id), saved);
    assert.deepEqual(await other.get(saved.workflow_run_id), saved);
    const reset = await restarted.start('qa-reset-new-run');
    assert.notEqual(reset.workflow_run_id, saved.workflow_run_id);
    assert.deepEqual(await restarted.get(saved.workflow_run_id), saved);
    assert.deepEqual(await server.waitForAdvice(reset), [{ workflow_run_id: saved.workflow_run_id, record_id: RECORD }]);
    const retrieved = reset.plan_versions[0].retrieved_context;
    assert.equal(retrieved.length, 1); assert.equal(retrieved[0].workflow_run_id, saved.workflow_run_id);
    assert.equal(retrieved[0].record_id, RECORD); assert.equal(retrieved[0].review_revision, saved.revision);
    assert.deepEqual(reset.nodes.find(node => node.agent_id === 'A2').output.reviewed_workflows, retrieved);
    assert.deepEqual((await other.get(reset.workflow_run_id)).plan_versions[0].retrieved_context, retrieved);
    assert.equal(reset.plan_versions[0].advice.source, 'local-rule');
    assert.equal(reset.plan_versions[0].advice.fallback_reason, 'not_configured');

    let branch = await restarted.start('qa-resource-branch', { resource_snapshot: { personnel_available: 0, support_material_sets: 12, inspection_devices: 3 } });
    const initialBranch = structuredClone(branch);
    assert.equal(branch.next_action, 'return_to_resource');
    await restarted.act(branch, 'ACKNOWLEDGE', {}, 'qa-blocked-confirm', 400);
    branch = await restarted.act(branch, 'UPDATE_RESOURCES', { resource_snapshot: { personnel_available: 6 } });
    assert.deepEqual(branch.nodes[3].output.snapshot, { personnel_available: 6, support_material_sets: 12, inspection_devices: 3 });
    await restarted.act(branch, 'REPROCESS', { confirmed: false }, 'qa-unconfirmed', 400);
    await restarted.act(initialBranch, 'REPROCESS', { confirmed: true }, 'qa-branch-stale', 409);
    const preReprocess = structuredClone(branch);
    branch = await restarted.act(branch, 'REPROCESS', { confirmed: true, feedback: { monitoring_trend: 'worsened', execution_status: 'completed', reason: '合成人工反馈，等待新测量证据' } });
    assert.equal(branch.workflow_run_id, initialBranch.workflow_run_id);
    assert.equal(branch.plan_versions.length, 2); assert.deepEqual(branch.plan_versions[0], preReprocess.plan_versions[0]);
    assert.equal(branch.plan_versions[1].reprocess_from, 'return_to_perception');
    assert.equal(branch.plan_versions[1].monitoring_evidence, 'original_csv_record');
    assert.deepEqual(branch.algorithm, initialBranch.algorithm); assert.deepEqual(branch.nodes[0], initialBranch.nodes[0]);
    assert.deepEqual(branch.events.slice(0, 2), preReprocess.events);
    assert.deepEqual(branch.feedback.slice(0, 1), preReprocess.feedback);
    assert.equal(branch.feedback.at(-1).monitoring_trend, 'worsened');
    branch = await restarted.act(branch, 'ACKNOWLEDGE');
    assert.equal(branch.plan_versions[1].approved, true);
    const reflected = await restarted.request('/api/multi-agent/reflect', { run: { workflow_run_id: reset.workflow_run_id, nodes: [] }, feedback: { monitoring_trend: 'worsened' } });
    assert.equal(reflected.return_decision.action, 'wait_for_feedback');
    const low = await restarted.start('qa-low-risk', { record_id: 'REC-202512062045-13620' });
    assert.equal(low.current_phase, 'finish'); assert.equal(low.demo_state.status, 'ready'); assert.equal(low.plan_versions.length, 0);
    await restarted.act(low, 'ACKNOWLEDGE', {}, 'qa-low-confirm', 400);
    assert.equal((await restarted.request('/api/multi-agent/runs')).runs.length, 5);
    await server.stop(); server = undefined;
    return { ok: true, started_at: startedAt, completed_at: new Date().toISOString(), chain, independent_http_clients: 2, sequential_node_processes: 2,
      full_snapshot_restart_equal: true, reviewed_memory_retrieved: [{ workflow_run_id: saved.workflow_run_id, record_id: RECORD }],
      source: 'local-rule', fallback_reason: 'not_configured', reprocess_versions: [1, 2], reprocess_return: 'return_to_perception',
      algorithm_and_A1_preserved: true, error_statuses_checked: [400, 403, 404, 409], child_diagnostic_bytes: 0, browser_visual_verified: false, external_provider_calls: 0 };
  } finally {
    try { if (server) await server.stop(); }
    finally {
      const resolved = path.resolve(directory), tempRoot = path.resolve(os.tmpdir());
      assert.equal(path.dirname(resolved), tempRoot);
      assert.ok(path.basename(resolved).startsWith('mine-teacher-feedback-qa-'));
      await fs.rm(resolved, { recursive: true, force: true });
      await assert.rejects(fs.stat(resolved), { code: 'ENOENT' });
    }
  }
}

module.exports = { createAdviceCaptureBarrier };
if (require.main === module && process.argv.includes('--child')) {
  process.once('message', message => childServer(message).catch(() => { process.exitCode = 1; process.disconnect(); }));
} else if (require.main === module) {
  acceptance().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    // Assertion text contains only paths/statuses/fixture evidence; never dump request objects.
    console.error(`Local acceptance failed: ${error.message}`); process.exitCode = 1;
  });
}
