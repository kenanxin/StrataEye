import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createAppServer } = require('../server.js');
const { createFileWorkflowStore } = require('../server/workflow-store.js');
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mine-api-'));
  const authService = { getSession: token => token ? { user: { username: token, role: token, displayName: token } } : null, can: () => false, ...options.authService };
  const server = createAppServer({ workflowStore: createFileWorkflowStore({ directory }), authService, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const request = async (route, body, role = 'enterprise') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: `roofrisk_session=${role}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, payload: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  };
  return request;
}
test('HTTP derives trusted actor, rejects fake runs and supports persisted reads/actions', async t => {
  const req = await fixture(t);
  const body = { record_id: 'REC-202511101149-02909', command_id: 'start', actor: { role: 'enterprise' } };
  assert.equal((await req('/api/multi-agent/run', body, 'viewer')).status, 403);
  const { payload: run, status } = await req('/api/multi-agent/run', body);
  assert.equal(status, 200);
  assert.deepEqual((await req('/api/multi-agent/run', body)).payload, run);
  for (const role of ['enterprise', 'regulator', 'expert', 'viewer', 'super_admin']) assert.equal((await req(`/api/multi-agent/runs/${run.workflow_run_id}`, undefined, role)).status, 200);
  assert.equal((await req('/api/multi-agent/runs')).payload.runs.length, 1);
  const route = `/api/multi-agent/runs/${run.workflow_run_id}/actions`;
  assert.equal((await req(route, { type: 'APPROVE', payload: { opinion: 'checked' }, actor: { role: 'regulator' }, command_id: 'fake', expected_revision: 0 })).status, 403);
  assert.equal((await req(route, { type: 'ACKNOWLEDGE', command_id: 'ack', expected_revision: 0 })).status, 200);
  assert.equal((await req(route, { type: 'ACKNOWLEDGE', command_id: 'stale', expected_revision: 0 })).status, 409);
  assert.equal((await req(route, { type: 'ACKNOWLEDGE', expected_revision: 1 })).status, 400);
  assert.equal((await req('/api/multi-agent/reflect', { run: { workflow_run_id: 'WF-00000000-0000-4000-8000-999999999999', nodes: [] } })).status, 404);
  const reflected = await req('/api/multi-agent/reflect', { run: { workflow_run_id: run.workflow_run_id, nodes: [] }, feedback: { monitoring_trend: 'worsened' } });
  assert.equal(reflected.payload.return_decision.action, 'wait_for_feedback');
});
test('backend static files and encoded dot paths are protected while browser assets work', async t => {
  const req = await fixture(t);
  for (const route of ['/server.js', '/%73erver.js', '/SERVER.JS', '/server.js.', '/server.js::$DATA', '/public%5c..%5cserver.js', '/public%5c..%5c.RUNTIME%5cprivate.json', '/server/auth-service.js', '/tests/auth-service.test.mjs', '/tools/x', '/supabase/x', '/.runtime/x', '/.RUNTIME%2fprivate.json', '/%2eruntime/x', '/.superpowers/x', '/.git/config', '/.env', '/%2eenv', '/server%5cauth-service.js']) assert.equal((await req(route)).status, 403, route);
  assert.equal((await req('/js/warning-demo-state.mjs')).status, 200);
});
test('session lookup failure is caught and sanitized', async t => {
  const req = await fixture(t, { authService: { getSession: async () => { throw new Error('private provider body'); } } });
  const result = await req('/api/multi-agent/status');
  assert.equal(result.status, 503);
  assert.ok(!JSON.stringify(result).includes('private provider body'));
});
test('Supabase auth never silently selects local file workflow persistence', async t => {
  const req = await fixture(t, { workflowStore: undefined, authService: { provider: 'supabase', getSession: () => ({ user: { username: 'enterprise', role: 'enterprise' } }) }, workflowStoreProvider: 'supabase', workflowStoreOptions: {} });
  const status = await req('/api/multi-agent/status');
  assert.equal(status.payload.available, false);
  assert.equal(status.payload.storage_provider, 'supabase');
  assert.equal((await req('/api/multi-agent/run', { record_id: 'REC-202511101149-02909' })).status, 503);
});
test('configured but unavailable database is visible in status and mutations', async t => {
  const unavailable = () => { const error = new Error('Workflow database unavailable'); error.code = 'WORKFLOW_STORAGE_UNAVAILABLE'; error.statusCode = 503; throw error; };
  const { WorkflowStoreError } = require('../server/workflow-store.js');
  const req = await fixture(t, { workflowStoreProvider: 'supabase', workflowStore: { list: unavailable, get: () => { throw new WorkflowStoreError('WORKFLOW_STORAGE_UNAVAILABLE', 'Workflow database unavailable', 503); } } });
  const status = await req('/api/multi-agent/status');
  assert.equal(status.payload.available, false);
  assert.equal(status.payload.durable, false);
  assert.equal(status.payload.storage_provider, 'supabase');
  assert.equal((await req('/api/multi-agent/run', { record_id: 'REC-202511101149-02909' })).status, 503);
});
test('Render environment cannot claim default file storage is durable', async t => {
  const previous = process.env.RENDER;
  process.env.RENDER = 'true';
  try {
    const req = await fixture(t, { workflowStore: undefined, workflowStoreProvider: 'file' });
    const status = await req('/api/multi-agent/status');
    assert.equal(status.payload.available, false);
    assert.equal(status.payload.durable, false);
    assert.equal((await req('/api/multi-agent/run', { record_id: 'REC-202511101149-02909' })).status, 503);
  } finally { if (previous === undefined) delete process.env.RENDER; else process.env.RENDER = previous; }
});
