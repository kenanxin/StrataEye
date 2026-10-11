import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createFileWorkflowStore, createSupabaseWorkflowStore, WorkflowStoreError } = require('../server/workflow-store.js');
const execute = promisify(execFile);
const modulePath = require.resolve('../server/workflow-store.js');
const id = 'WF-00000000-0000-4000-8000-000000000001';
const event = { type: 'ACKNOWLEDGE', operator: 'enterprise' };
const fixture = (overrides = {}) => ({
  workflow_run_id: id, revision: 0,
  created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-11T00:00:00Z',
  nodes: [], events: [], algorithm: { record_id: 'REC-TEST' }, phase: 'waiting_human',
  demo_state: { status: 'alert_triggered' }, plan_versions: [], feedback: [], case_memory: [],
  ...overrides,
});
const hasError = (code, statusCode) => (error) => {
  assert.ok(error instanceof WorkflowStoreError);
  assert.equal(error.code, code);
  assert.equal(error.statusCode, statusCode);
  return true;
};
async function local(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mine-workflows-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: createFileWorkflowStore({ directory }) };
}

test('file store survives restart with full state and command results', async (t) => {
  const { directory, store } = await local(t);
  const run = fixture();
  assert.deepEqual(await store.create(run, { commandId: 'create-1' }), run);
  assert.deepEqual(await createFileWorkflowStore({ directory }).get(id), run);
  const saved = await store.save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'approve-1', event });
  assert.deepEqual(saved.events, [event]);
  const reopened = createFileWorkflowStore({ directory });
  assert.deepEqual(await reopened.get(id), saved);
  const second = await reopened.save({ ...saved, revision: 2 }, { expectedRevision: 1, commandId: 'approve-2', event: { type: 'VERIFY' } });
  assert.equal(second.events.length, 2);
  assert.deepEqual(await createFileWorkflowStore({ directory }).save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'approve-1', event }), saved);
  assert.deepEqual(await reopened.create(run, { commandId: 'create-1' }), run);
  assert.equal((await reopened.get(id)).revision, 2);
});

test('stale revisions and independent create commands conflict', async (t) => {
  const { store } = await local(t);
  await store.create(fixture(), { commandId: 'create-1' });
  await assert.rejects(store.create(fixture(), { commandId: 'create-2' }), hasError('WORKFLOW_CONFLICT', 409));
  await store.save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'approve-1', event });
  await assert.rejects(store.save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'approve-2', event }), hasError('WORKFLOW_CONFLICT', 409));
});

test('durable duplicate lookup precedes new state, revision and event validation', async (t) => {
  const { directory, store } = await local(t);
  await store.create(fixture(), { commandId: 'create-1' });
  const saved = await store.save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'approve-1', event });
  await store.save({ ...saved, revision: 2, phase: 'verified' }, { expectedRevision: 1, commandId: 'verify-1', event: { type: 'VERIFY' } });
  assert.deepEqual(await createFileWorkflowStore({ directory }).save({ workflow_run_id: id, revision: -1 }, { expectedRevision: -1, commandId: 'approve-1', event: null }), saved);
  assert.deepEqual(await store.create({ workflow_run_id: id }, { commandId: 'create-1' }), fixture());
});

test('competing fresh file store instances allow only one new revision', async (t) => {
  const { directory, store } = await local(t);
  await store.create(fixture(), { commandId: 'create-1' });
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => createFileWorkflowStore({ directory }).save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: `concurrent-${i}`, event })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'WORKFLOW_CONFLICT'));
  assert.equal((await store.get(id)).events.length, 1);
  assert.deepEqual((await readdir(directory)).filter((name) => !name.endsWith('.json')), []);
});

test('separate Node processes serialize file writes and preserve durable idempotency', async (t) => {
  const { directory, store } = await local(t);
  await store.create(fixture(), { commandId: 'create-1' });
  const script = `const {createFileWorkflowStore}=require(process.argv[1]); const run=JSON.parse(process.argv[3]); createFileWorkflowStore({directory:process.argv[2]}).save(run,{expectedRevision:0,commandId:process.argv[4],event:{type:'ACKNOWLEDGE',operator:'enterprise'}}).then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>process.stdout.write(JSON.stringify({code:e.code,statusCode:e.statusCode})));`;
  const results = await Promise.all(['process-1', 'process-2'].map((command) => execute(process.execPath, ['-e', script, modulePath, directory, JSON.stringify(fixture({ revision: 1 })), command]).then((r) => JSON.parse(r.stdout))));
  assert.equal(results.filter((r) => r.revision === 1).length, 1);
  assert.equal(results.filter((r) => r.code === 'WORKFLOW_CONFLICT').length, 1);
  const winningCommand = results[0].revision === 1 ? 'process-1' : 'process-2';
  const retry = await execute(process.execPath, ['-e', script, modulePath, directory, JSON.stringify(fixture({ revision: 1 })), winningCommand]);
  assert.deepEqual(JSON.parse(retry.stdout), await store.get(id));
});

test('concurrent duplicate commands append one event only', async (t) => {
  const { directory, store } = await local(t);
  await store.create(fixture(), { commandId: 'create-1' });
  const results = await Promise.all(Array.from({ length: 6 }, () => createFileWorkflowStore({ directory }).save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'same-command', event })));
  results.forEach((result) => assert.deepEqual(result, results[0]));
  assert.equal((await store.get(id)).events.length, 1);
});

test('missing runs return 404 and list defaults to bounded newest state with record filtering', async (t) => {
  const { store } = await local(t);
  await assert.rejects(store.get(id), hasError('WORKFLOW_NOT_FOUND', 404));
  await assert.rejects(store.save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'missing', event }), hasError('WORKFLOW_NOT_FOUND', 404));
  for (let i = 1; i <= 22; i++) {
    await store.create(fixture({ workflow_run_id: `WF-00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, updated_at: `2026-10-11T00:00:${String(i).padStart(2, '0')}Z`, algorithm: { record_id: i % 2 ? 'REC-ODD' : 'REC-EVEN' } }), { commandId: `create-${i}` });
  }
  assert.equal((await store.list()).length, 20);
  const result = await store.list({ limit: 3, recordId: 'REC-ODD' });
  assert.equal(result.length, 3);
  assert.equal(result[0].workflow_run_id.slice(-12), '000000000021');
  assert.ok(result.every((run) => run.algorithm.record_id === 'REC-ODD'));
  for (const limit of [0, -1, 101, 1.5, '20', Infinity]) await assert.rejects(store.list({ limit }), hasError('WORKFLOW_INVALID_INPUT', 400));
});

test('strict IDs, complete JSON state, revisions, commands and events reject invalid inputs', async (t) => {
  const { store } = await local(t);
  for (const bad of ['../outside', `${id}/x`, `${id.toLowerCase()}`, 'WF-not-uuid', `${id}\u0000`]) {
    await assert.rejects(store.get(bad), hasError('WORKFLOW_INVALID_INPUT', 400));
  }
  for (const bad of [{ nodes: {} }, { events: [null] }, { algorithm: [] }, { algorithm: {} }, { revision: '0' }, { revision: -1 }, { created_at: 'yesterday' }, { updated_at: '2026-02-30T00:00:00Z' }, { feedback: null }, { phase: '' }, { demo_state: [] }, { extra: NaN }, { extra: undefined }]) {
    await assert.rejects(store.create(fixture(bad), { commandId: 'invalid' }), hasError('WORKFLOW_INVALID_INPUT', 400));
  }
  const incomplete = fixture(); delete incomplete.case_memory;
  await assert.rejects(store.create(incomplete, { commandId: 'invalid' }), hasError('WORKFLOW_INVALID_INPUT', 400));
  for (const commandId of ['', null, '../command', 'x'.repeat(129)]) await assert.rejects(store.create(fixture(), { commandId }), hasError('WORKFLOW_INVALID_INPUT', 400));
  await assert.rejects(store.create(fixture({ revision: 1 }), { commandId: 'invalid' }), hasError('WORKFLOW_INVALID_INPUT', 400));
  await store.create(fixture(), { commandId: 'create-1' });
  for (const expectedRevision of [-1, '0', NaN]) await assert.rejects(store.save(fixture({ revision: 1 }), { expectedRevision, commandId: 'invalid', event }), hasError('WORKFLOW_INVALID_INPUT', 400));
  for (const revision of [0, 2]) await assert.rejects(store.save(fixture({ revision }), { expectedRevision: 0, commandId: 'invalid', event }), hasError('WORKFLOW_INVALID_INPUT', 400));
  for (const bad of [null, [], {}, { type: '' }]) await assert.rejects(store.save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'invalid', event: bad }), hasError('WORKFLOW_INVALID_INPUT', 400));
});

test('sparse arrays with enumerable properties reject before any run is committed', async (t) => {
  const { directory, store } = await local(t);
  for (const key of ['extra', '01', '-1', '4294967295']) {
    const nodes = new Array(1);
    nodes[key] = {};
    await assert.rejects(store.create(fixture({ nodes }), { commandId: 'invalid-sparse' }), hasError('WORKFLOW_INVALID_INPUT', 400));
    await assert.rejects(store.get(id), hasError('WORKFLOW_NOT_FOUND', 404));
    assert.deepEqual(await readdir(directory), []);
  }
  const nodes = [{}];
  nodes.extra = {};
  await assert.rejects(store.create(fixture({ nodes }), { commandId: 'invalid-extra' }), hasError('WORKFLOW_INVALID_INPUT', 400));
  assert.deepEqual(await readdir(directory), []);
  const current = await store.create(fixture(), { commandId: 'valid-create' });
  const evidence = new Array(1);
  evidence.extra = {};
  await assert.rejects(store.save({ ...current, revision: 1 }, { expectedRevision: 0, commandId: 'invalid-save', event: { ...event, evidence } }), hasError('WORKFLOW_INVALID_INPUT', 400));
  assert.deepEqual(await store.get(id), current);
});

test('save retains creation identity and rejects rewritten event history', async (t) => {
  const { store } = await local(t);
  await store.create(fixture(), { commandId: 'create-1' });
  const saved = await store.save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'approve-1', event });
  await assert.rejects(store.save({ ...saved, revision: 2, created_at: '2026-10-12T00:00:00Z' }, { expectedRevision: 1, commandId: 'bad-create-time', event }), hasError('WORKFLOW_INVALID_INPUT', 400));
  await assert.rejects(store.save({ ...saved, revision: 2, events: [] }, { expectedRevision: 1, commandId: 'bad-history', event }), hasError('WORKFLOW_INVALID_INPUT', 400));
  const appended = { type: 'VERIFY' };
  const next = await store.save({ ...saved, revision: 2, events: [...saved.events, appended] }, { expectedRevision: 1, commandId: 'already-appended', event: appended });
  assert.deepEqual(next.events, [event, appended]);
});

test('file input and result objects are detached from durable state', async (t) => {
  const { store } = await local(t);
  const run = fixture();
  const pending = store.create(run, { commandId: 'create-1' });
  run.algorithm.record_id = 'MUTATED';
  const result = await pending;
  result.algorithm.record_id = 'MUTATED-RESULT';
  assert.equal((await store.get(id)).algorithm.record_id, 'REC-TEST');
});

test('corrupt JSON, corrupt command ledger and oversized data fail without overwrite', async (t) => {
  const { directory, store } = await local(t);
  await store.create(fixture(), { commandId: 'create-1' });
  const filename = path.join(directory, `${id}.json`);
  const valid = await readFile(filename, 'utf8');
  const corruptLedger = JSON.parse(valid);
  corruptLedger.commands = [];
  for (const corrupt of ['{broken', JSON.stringify({ run: fixture() }), JSON.stringify(corruptLedger), ' '.repeat(4 * 1024 * 1024 + 1)]) {
    await writeFile(filename, corrupt);
    await assert.rejects(store.get(id), hasError('WORKFLOW_CORRUPT_DATA', 503));
    await assert.rejects(store.list(), hasError('WORKFLOW_CORRUPT_DATA', 503));
    await assert.rejects(store.create(fixture(), { commandId: 'create-2' }), hasError('WORKFLOW_CORRUPT_DATA', 503));
    await assert.rejects(store.save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'save-1', event }), hasError('WORKFLOW_CORRUPT_DATA', 503));
    assert.equal(await readFile(filename, 'utf8'), corrupt);
  }
});

test('abandoned per-run locks fail visibly without eviction or state overwrite', async (t) => {
  const { directory, store } = await local(t);
  await store.create(fixture(), { commandId: 'create-1' });
  await mkdir(path.join(directory, `.${id}.lock`));
  await assert.rejects(store.save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'locked', event }), hasError('WORKFLOW_STORAGE_BUSY', 503));
  assert.equal((await store.get(id)).revision, 0);
  assert.ok((await readdir(directory)).includes(`.${id}.lock`));
});

test('filesystem failures are surfaced as storage unavailable', async (t) => {
  const { directory } = await local(t);
  const blockingFile = path.join(directory, 'file-not-directory');
  await writeFile(blockingFile, 'keep');
  const store = createFileWorkflowStore({ directory: blockingFile });
  await assert.rejects(store.create(fixture(), { commandId: 'create' }), hasError('WORKFLOW_STORAGE_UNAVAILABLE', 503));
  await assert.rejects(store.get(id), hasError('WORKFLOW_STORAGE_UNAVAILABLE', 503));
  await assert.rejects(store.list(), hasError('WORKFLOW_STORAGE_UNAVAILABLE', 503));
  assert.equal(await readFile(blockingFile, 'utf8'), 'keep');
});

test('supabase writes use service-role RPC methods, arguments and validated response', async () => {
  const calls = [];
  const store = createSupabaseWorkflowStore({ url: 'https://database.example/', serviceRoleKey: 'test-service-role', fetchImpl: async (url, init) => {
    calls.push({ url, init });
    const body = JSON.parse(init.body);
    return { ok: true, json: async () => body.p_event ? { ...body.p_run, events: [body.p_event] } : body.p_run };
  } });
  assert.deepEqual(await store.create(fixture(), { commandId: 'create-1' }), fixture());
  assert.equal((await store.save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'approve-1', event })).events.length, 1);
  assert.equal(calls[0].url, 'https://database.example/rest/v1/rpc/mine_workflow_create');
  assert.equal(calls[1].url, 'https://database.example/rest/v1/rpc/mine_workflow_save');
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_run: fixture(), p_command_id: 'create-1' });
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_run: fixture({ revision: 1 }), p_expected_revision: 0, p_command_id: 'approve-1', p_event: event });
  for (const { init } of calls) {
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.apikey, 'test-service-role');
    assert.equal(init.headers.Authorization, 'Bearer test-service-role');
    assert.equal(init.headers['Content-Type'], 'application/json');
  }
});

test('supabase get/list issue bounded escaped reads with service authentication', async () => {
  const calls = [];
  const store = createSupabaseWorkflowStore({ url: 'https://database.example', serviceRoleKey: 'test-service-role', fetchImpl: async (url, init) => { calls.push({ url: new URL(url), init }); return { ok: true, json: async () => [{ state: fixture() }] }; } });
  assert.deepEqual(await store.get(id), fixture());
  assert.deepEqual(await store.list({ limit: 5, recordId: 'REC?x=&"' }), [fixture()]);
  assert.equal(calls[0].url.searchParams.get('workflow_run_id'), `eq.${id}`);
  assert.equal(calls[0].url.searchParams.get('limit'), '1');
  assert.equal(calls[1].url.searchParams.get('limit'), '5');
  assert.equal(calls[1].url.searchParams.get('record_id'), 'eq.REC?x=&"');
  assert.equal(calls[1].url.searchParams.get('order'), 'updated_at.desc,workflow_run_id.asc');
  calls.forEach(({ init }) => assert.equal(init.headers.Authorization, 'Bearer test-service-role'));
});

test('supabase errors remain visible with stable codes and never expose provider secrets', async () => {
  for (const [providerCode, status] of [['WORKFLOW_CONFLICT', 409], ['WORKFLOW_INVALID_INPUT', 400], ['WORKFLOW_NOT_FOUND', 404], ['WORKFLOW_FORBIDDEN', 403], ['WORKFLOW_CORRUPT_DATA', 503]]) {
    const store = createSupabaseWorkflowStore({ url: 'https://database.example', serviceRoleKey: 'secret', fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ code: 'P0001', message: providerCode, details: 'private secret details' }) }) });
    await assert.rejects(store.save(fixture({ revision: 1 }), { expectedRevision: 0, commandId: 'save', event }), hasError(providerCode, status));
  }
  for (const fetchImpl of [async () => { throw new Error('secret'); }, async () => ({ ok: false, status: 500, json: async () => ({ message: 'secret' }) }), async () => ({ ok: true, json: async () => ({}) }), async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })]) {
    const store = createSupabaseWorkflowStore({ url: 'https://database.example', serviceRoleKey: 'secret', fetchImpl });
    await assert.rejects(store.create(fixture(), { commandId: 'create' }), (error) => { assert.equal(error.statusCode, 503); assert.doesNotMatch(error.message, /secret/); return true; });
  }
  const empty = createSupabaseWorkflowStore({ url: 'https://database.example', serviceRoleKey: 'secret', fetchImpl: async () => ({ ok: true, json: async () => [] }) });
  await assert.rejects(empty.get(id), hasError('WORKFLOW_NOT_FOUND', 404));
  assert.deepEqual(await empty.list(), []);
});

test('migration contract is additive, row-locking, command-deduplicated and service-role only', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202610110001_workflow_runs.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.mine_workflow_runs/i);
  assert.match(sql, /create table if not exists public\.mine_workflow_commands/i);
  assert.match(sql, /primary key\s*\(workflow_run_id, command_id\)/i);
  for (const name of ['mine_workflow_create', 'mine_workflow_save']) {
    assert.match(sql, new RegExp(`function public\\.${name}\\(`, 'i'));
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^;]+ from public, anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^;]+ to service_role`, 'i'));
  }
  assert.match(sql, /for update/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /WORKFLOW_CONFLICT/);
  assert.match(sql, /WORKFLOW_INVALID_INPUT/);
  assert.match(sql, /v_expected_revision\s*\+\s*1/);
  assert.match(sql, /jsonb_typeof\(p_expected_revision\) is distinct from 'number'/i);
  const saveSql = sql.slice(sql.indexOf('create or replace function public.mine_workflow_save'));
  assert.ok(saveSql.indexOf('return v_saved') < saveSql.indexOf('perform public.mine_workflow_validate(p_run)'));
  assert.match(saveSql, /mine_workflow_validate_stored\(v_state, v_id, v_revision\)/);
  assert.match(saveSql, /mine_workflow_validate_stored\(v_saved, v_id, v_saved_revision\)/);
  assert.doesNotMatch(sql, /drop table|truncate|grant[^;]+to (?:anon|authenticated)/i);
});
