'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');

const RUN_ID = /^WF-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_LIST_SCAN = 10000;
const ERROR_STATUS = { WORKFLOW_INVALID_INPUT: 400, WORKFLOW_FORBIDDEN: 403, WORKFLOW_NOT_FOUND: 404, WORKFLOW_CONFLICT: 409, WORKFLOW_CORRUPT_DATA: 503 };

class WorkflowStoreError extends Error {
  constructor(code, message, statusCode = ERROR_STATUS[code] || 503) {
    super(message);
    this.name = 'WorkflowStoreError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code, message) { throw new WorkflowStoreError(code, message); }
function invalid(message) { fail('WORKFLOW_INVALID_INPUT', message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function revision(value) { return Number.isSafeInteger(value) && value >= 0; }
function validateId(id) { if (typeof id !== 'string' || !RUN_ID.test(id)) invalid('A canonical WF UUID is required'); }
function validateCommand(id) { if (typeof id !== 'string' || !COMMAND_ID.test(id)) invalid('A valid commandId is required'); }
function validateJson(value, ancestors = new Set(), depth = 0) {
  if (depth > 64) invalid('Workflow JSON nesting exceeds 64 levels');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!object(value) && !Array.isArray(value)) invalid('Workflow state must contain only JSON values');
  if (ancestors.has(value)) invalid('Workflow JSON must not be circular');
  ancestors.add(value);
  if (Object.getOwnPropertySymbols(value).length) invalid('Workflow state must contain only JSON keys');
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) invalid('Workflow arrays must be dense JSON arrays');
    }
    for (const key of Object.keys(value)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) invalid('Workflow arrays must contain only numeric indices');
    }
  }
  for (const child of Object.values(value)) validateJson(child, ancestors, depth + 1);
  ancestors.delete(value);
}
function validTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}
function validateEvent(event) {
  if (!object(event) || !text(event.type) || event.type.length > 128) invalid('An event with a type is required');
  validateJson(event);
}
function validateRun(run) {
  if (!object(run)) invalid('A complete workflow run is required');
  validateJson(run);
  validateId(run.workflow_run_id);
  if (!revision(run.revision)) invalid('Run revision must be a non-negative safe integer');
  if (!validTimestamp(run.created_at) || !validTimestamp(run.updated_at) || Date.parse(run.updated_at) < Date.parse(run.created_at)) invalid('Run timestamps must be valid UTC dates in chronological order');
  if (!object(run.algorithm) || !text(run.algorithm.record_id) || run.algorithm.record_id.length > 256 || !object(run.demo_state) || !text(run.phase) || run.phase.length > 128) invalid('Run algorithm, record_id, phase and demo_state are required');
  for (const field of ['nodes', 'plan_versions', 'feedback', 'case_memory', 'events']) {
    if (!Array.isArray(run[field]) || !run[field].every(object)) invalid(`Run ${field} must be an array of objects`);
  }
  run.events.forEach(validateEvent);
  if (Buffer.byteLength(JSON.stringify(run)) > MAX_BYTES) invalid('Workflow state exceeds the 4 MiB limit');
}
// Capture inputs before the first await; full validation follows the durable deduplication check.
function capture(run, commandId) {
  validateId(run?.workflow_run_id);
  validateCommand(commandId);
  try { return structuredClone(run); } catch (_) { invalid('Workflow state must be cloneable JSON'); }
}
function listOptions({ limit = 20, recordId } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) invalid('List limit must be an integer from 1 to 100');
  if (recordId !== undefined && (!text(recordId) || recordId.length > 256)) invalid('A valid recordId is required');
  return { limit, recordId };
}
function validateEnvelope(envelope, id) {
  try {
    if (!object(envelope) || envelope.schema_version !== 1 || !Array.isArray(envelope.commands) || !envelope.commands.length) invalid('Invalid workflow envelope');
    validateRun(envelope.run);
    if (envelope.run.workflow_run_id !== id || envelope.commands.length !== envelope.run.revision + 1) invalid('Invalid workflow ledger');
    const ids = new Set();
    let previous;
    envelope.commands.forEach((command, index) => {
      if (!object(command)) invalid('Invalid workflow command');
      validateCommand(command.command_id);
      validateRun(command.run);
      if (ids.has(command.command_id) || command.run.workflow_run_id !== id || command.run.revision !== index || command.run.created_at !== envelope.run.created_at) invalid('Invalid workflow command history');
      if (previous && (Date.parse(command.run.updated_at) < Date.parse(previous.updated_at) || command.run.events.length !== previous.events.length + 1 || !isDeepStrictEqual(command.run.events.slice(0, -1), previous.events))) invalid('Invalid workflow event history');
      ids.add(command.command_id);
      previous = command.run;
    });
    if (!isDeepStrictEqual(previous, envelope.run)) invalid('Workflow state disagrees with ledger');
  } catch (_) { fail('WORKFLOW_CORRUPT_DATA', 'Persisted workflow data is invalid'); }
  return envelope;
}

function createFileWorkflowStore({ directory = path.resolve('.runtime/workflows') } = {}) {
  if (!text(directory)) invalid('A workflow directory is required');
  const root = path.resolve(directory);
  const filename = (id) => path.join(root, `${id}.json`);

  async function checkDirectory() {
    try {
      if (!(await fs.stat(root)).isDirectory()) fail('WORKFLOW_STORAGE_UNAVAILABLE', 'Workflow storage path is not a directory');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      if (error instanceof WorkflowStoreError) throw error;
      fail('WORKFLOW_STORAGE_UNAVAILABLE', 'Workflow directory is unavailable');
    }
  }

  async function read(id) {
    let handle;
    try {
      const stat = await fs.lstat(filename(id));
      if (!stat.isFile() || stat.isSymbolicLink()) fail('WORKFLOW_CORRUPT_DATA', 'Workflow path is not a regular file');
      if (stat.size > MAX_BYTES) fail('WORKFLOW_CORRUPT_DATA', 'Persisted workflow exceeds the 4 MiB limit');
      handle = await fs.open(filename(id), 'r');
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > MAX_BYTES) fail('WORKFLOW_CORRUPT_DATA', 'Persisted workflow exceeds the 4 MiB limit');
      let parsed;
      try { parsed = JSON.parse(buffer.subarray(0, size).toString('utf8')); } catch (_) { fail('WORKFLOW_CORRUPT_DATA', 'Persisted workflow JSON is invalid'); }
      return validateEnvelope(parsed, id);
    } catch (error) {
      if (error.code === 'ENOENT') { await checkDirectory(); return null; }
      if (error instanceof WorkflowStoreError) throw error;
      fail('WORKFLOW_STORAGE_UNAVAILABLE', 'Workflow file storage is unavailable');
    } finally { if (handle) await handle.close(); }
  }

  async function replace(id, envelope) {
    const data = JSON.stringify(envelope);
    if (Buffer.byteLength(data) > MAX_BYTES) invalid('Workflow and command history exceed the 4 MiB limit');
    const temporary = path.join(root, `.${id}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(data, 'utf8');
      await handle.sync();
      await handle.close(); handle = null;
      await fs.rename(temporary, filename(id));
    } catch (_) { fail('WORKFLOW_STORAGE_UNAVAILABLE', 'Workflow could not be durably saved'); }
    finally {
      if (handle) await handle.close();
      await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw new WorkflowStoreError('WORKFLOW_STORAGE_UNAVAILABLE', 'Workflow temporary file cleanup failed'); });
    }
  }

  async function locked(id, operation) {
    const lock = path.join(root, `.${id}.lock`);
    const started = Date.now();
    let acquired = false;
    try {
      await fs.mkdir(root, { recursive: true });
      while (!acquired) {
        try { await fs.mkdir(lock); acquired = true; }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          if (Date.now() - started >= 5000) fail('WORKFLOW_STORAGE_BUSY', 'Workflow lock is busy or abandoned; inspect it before recovery');
          await delay(10);
        }
      }
      return await operation();
    } catch (error) {
      if (error instanceof WorkflowStoreError) throw error;
      fail('WORKFLOW_STORAGE_UNAVAILABLE', 'Workflow file storage is unavailable');
    } finally {
      if (acquired) await fs.rmdir(lock).catch(() => fail('WORKFLOW_STORAGE_UNAVAILABLE', 'Workflow lock cleanup failed'));
    }
  }

  return {
    storage_provider: 'file',
    async create(run, { commandId } = {}) {
      const candidate = capture(run, commandId);
      return locked(candidate.workflow_run_id, async () => {
        const current = await read(candidate.workflow_run_id);
        const duplicate = current?.commands.find((item) => item.command_id === commandId);
        if (duplicate) return structuredClone(duplicate.run);
        if (current) fail('WORKFLOW_CONFLICT', 'Workflow already exists');
        validateRun(candidate);
        if (candidate.revision !== 0) invalid('A new workflow must have revision zero');
        await replace(candidate.workflow_run_id, { schema_version: 1, run: candidate, commands: [{ command_id: commandId, run: candidate }] });
        return structuredClone(candidate);
      });
    },
    async get(runId) {
      validateId(runId);
      const current = await read(runId);
      if (!current) fail('WORKFLOW_NOT_FOUND', 'Workflow was not found');
      return current.run;
    },
    async list(options) {
      const { limit, recordId } = listOptions(options);
      let directoryHandle;
      const runs = [];
      try {
        directoryHandle = await fs.opendir(root);
        let scanned = 0;
        for await (const entry of directoryHandle) {
          if (++scanned > MAX_LIST_SCAN) fail('WORKFLOW_STORAGE_UNAVAILABLE', 'Workflow list exceeds the directory scan limit');
          if (!entry.name.endsWith('.json')) continue;
          const id = entry.name.slice(0, -5);
          if (!RUN_ID.test(id)) fail('WORKFLOW_CORRUPT_DATA', 'Unexpected workflow filename');
          const current = await read(id);
          if (current && (recordId === undefined || current.run.algorithm.record_id === recordId)) {
            runs.push(current.run);
            runs.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.workflow_run_id.localeCompare(b.workflow_run_id));
            if (runs.length > limit) runs.pop();
          }
        }
      } catch (error) {
        if (error.code === 'ENOENT') { await checkDirectory(); return []; }
        if (error instanceof WorkflowStoreError) throw error;
        fail('WORKFLOW_STORAGE_UNAVAILABLE', 'Workflow listing is unavailable');
      }
      return runs;
    },
    async save(run, { expectedRevision, commandId, event } = {}) {
      const candidate = capture(run, commandId);
      let capturedEvent;
      try { capturedEvent = structuredClone(event); } catch (_) { invalid('Event must be cloneable JSON'); }
      return locked(candidate.workflow_run_id, async () => {
        const current = await read(candidate.workflow_run_id);
        if (!current) fail('WORKFLOW_NOT_FOUND', 'Workflow was not found');
        const duplicate = current.commands.find((item) => item.command_id === commandId);
        if (duplicate) return structuredClone(duplicate.run);
        if (!revision(expectedRevision)) invalid('expectedRevision must be a non-negative safe integer');
        validateRun(candidate); validateEvent(capturedEvent);
        if (candidate.revision !== expectedRevision + 1) invalid('New revision must equal expectedRevision + 1');
        if (current.run.revision !== expectedRevision) fail('WORKFLOW_CONFLICT', 'Workflow revision changed; reload the current state');
        if (candidate.created_at !== current.run.created_at || Date.parse(candidate.updated_at) < Date.parse(current.run.updated_at)) invalid('Workflow timestamps cannot be rewritten or moved backwards');
        const events = [...current.run.events, capturedEvent];
        if (!isDeepStrictEqual(candidate.events, current.run.events) && !isDeepStrictEqual(candidate.events, events)) invalid('Workflow event history cannot be rewritten');
        candidate.events = events;
        await replace(candidate.workflow_run_id, { ...current, run: candidate, commands: [...current.commands, { command_id: commandId, run: candidate }] });
        return structuredClone(candidate);
      });
    },
  };
}

function createSupabaseWorkflowStore({ url, serviceRoleKey, fetchImpl = globalThis.fetch } = {}) {
  let base;
  try { base = new URL(url); } catch (_) { invalid('A valid Supabase URL is required'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') invalid('Supabase URL must be an HTTP origin');
  if (!text(serviceRoleKey) || typeof fetchImpl !== 'function') invalid('Supabase service-role configuration is required');

  async function request(route, body) {
    let response, payload;
    try {
      response = await fetchImpl(`${base.origin}/rest/v1/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      payload = await response.json();
    } catch (_) { fail('WORKFLOW_STORAGE_UNAVAILABLE', 'Workflow database is unavailable'); }
    if (!response.ok) {
      const code = Object.hasOwn(ERROR_STATUS, payload?.message) ? payload.message : Object.hasOwn(ERROR_STATUS, payload?.code) ? payload.code : null;
      if (code) fail(code, { WORKFLOW_CONFLICT: 'Workflow revision conflict', WORKFLOW_NOT_FOUND: 'Workflow was not found', WORKFLOW_INVALID_INPUT: 'Invalid workflow input', WORKFLOW_FORBIDDEN: 'Workflow database access denied', WORKFLOW_CORRUPT_DATA: 'Persisted workflow database state is invalid' }[code]);
      if ([401, 403].includes(response.status)) fail('WORKFLOW_FORBIDDEN', 'Workflow database access denied');
      fail('WORKFLOW_STORAGE_UNAVAILABLE', 'Workflow database request failed');
    }
    return payload;
  }
  function result(run, expectedId) {
    try { validateRun(run); if (expectedId && run.workflow_run_id !== expectedId) invalid('Unexpected workflow ID'); }
    catch (_) { fail('WORKFLOW_CORRUPT_DATA', 'Workflow database returned invalid state'); }
    return run;
  }
  return {
    storage_provider: 'supabase',
    async create(run, { commandId } = {}) {
      const candidate = capture(run, commandId);
      validateJson(candidate);
      return result(await request('rpc/mine_workflow_create', { p_run: candidate, p_command_id: commandId }), candidate.workflow_run_id);
    },
    async get(runId) {
      validateId(runId);
      const query = new URLSearchParams({ select: 'state', workflow_run_id: `eq.${runId}`, limit: '1' });
      const rows = await request(`mine_workflow_runs?${query}`);
      if (!Array.isArray(rows) || rows.length > 1) fail('WORKFLOW_CORRUPT_DATA', 'Workflow database returned invalid rows');
      if (!rows.length) fail('WORKFLOW_NOT_FOUND', 'Workflow was not found');
      return result(rows[0]?.state, runId);
    },
    async list(options) {
      const { limit, recordId } = listOptions(options);
      const query = new URLSearchParams({ select: 'state', order: 'updated_at.desc,workflow_run_id.asc', limit: String(limit) });
      if (recordId !== undefined) query.set('record_id', `eq.${recordId}`);
      const rows = await request(`mine_workflow_runs?${query}`);
      if (!Array.isArray(rows) || rows.length > limit) fail('WORKFLOW_CORRUPT_DATA', 'Workflow database returned invalid rows');
      return rows.map((row) => result(row?.state));
    },
    async save(run, { expectedRevision, commandId, event } = {}) {
      const candidate = capture(run, commandId);
      // The RPC checks the durable command ledger before validating the proposed revision/state.
      validateJson(candidate); validateJson(event); validateJson(expectedRevision);
      return result(await request('rpc/mine_workflow_save', { p_run: candidate, p_expected_revision: expectedRevision, p_command_id: commandId, p_event: event }), candidate.workflow_run_id);
    },
  };
}

module.exports = { WorkflowStoreError, createFileWorkflowStore, createSupabaseWorkflowStore };
