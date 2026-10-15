import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { requestDeepSeek } = require('../server/deepseek-transport.js');
const { createAdviceCache } = require('../server/expert-advice-cache.js');
const { createExpertAdviceService } = require('../server/expert-advice-service.js');
const input = { risk: { predicted_class: '较大风险', score: 70 }, feature_evidence: [{ id: 'feature:r:support', value: 0.8 }], rule_recommendations: ['人工复核'] };
const parsed = { summary: '结合证据人工复核', recommendations: ['检查支护状态'], evidence_ids: ['feature:r:support'] };
const response = value => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) });
const transport = fetchImpl => requestDeepSeek({ fetchImpl, endpoint: 'https://api.deepseek.com/chat/completions', apiKey: 'private-key', body: {}, timeoutMs: 15 });

test('transport bounds both header and body waits even if a provider ignores abort', async () => {
  for (const [fetchImpl, phase] of [[() => new Promise(() => {}), 'awaiting_headers'], [async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }), 'reading_body']]) {
    const result = await transport(fetchImpl);
    assert.equal(result.reason, 'provider_timeout');
    assert.equal(result.diagnostics.phase, phase);
    assert.ok(result.diagnostics.elapsed_ms < 1000);
    assert.ok(!JSON.stringify(result).includes('private-key'));
  }
});
test('transport observes blank keepalives, rejects oversized bodies, and sanitizes HTTP errors', async () => {
  const good = await transport(async () => new Response('\n\n' + JSON.stringify({ choices: [] }), { status: 200 }));
  assert.equal(good.ok, true);
  assert.equal(good.diagnostics.phase, 'complete');
  const huge = await transport(async () => new Response('x'.repeat(262145)));
  assert.equal(huge.reason, 'provider_response_too_large');
  const bad = await transport(async () => ({ ok: false, status: 402, json: async () => ({ error: 'private provider body' }) }));
  assert.equal(bad.reason, 'provider_http_error');
  assert.equal(bad.diagnostics.http_status, 402);
  assert.ok(!JSON.stringify(bad).includes('private'));
});
test('cache detaches values, expires, survives local restart and has a bounded entry count', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mine-advice-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let time = 1000;
  const options = { directory, ttlMs: 1000, limit: 2, now: () => time };
  const cache = createAdviceCache(options), key = 'a'.repeat(64);
  cache.set(key, { content: 'safe' });
  cache.get(key).content = 'changed';
  assert.equal(createAdviceCache(options).get(key).content, 'safe');
  cache.set('b'.repeat(64), {}); cache.set('c'.repeat(64), {});
  assert.equal(cache.get(key), null);
  time += 1001;
  assert.equal(cache.get('c'.repeat(64)), null);
  assert.throws(() => cache.get('../secret'), TypeError);
});
test('workflow defaults to bounded text-channel JSON and explicit JSON mode remains configurable', async () => {
  for (const format of ['text', 'json_object']) {
    let sent;
    const service = createExpertAdviceService({ apiKey: 'test-key', responseFormat: format, fetchImpl: async (_url, init) => { sent = JSON.parse(init.body); return response(parsed); } });
    const result = await service.generateWorkflowAdvice(input);
    assert.equal(result.source, 'deepseek');
    assert.equal(sent.response_format?.type, format === 'json_object' ? 'json_object' : undefined);
    assert.match(sent.messages[0].content, /JSON/);
    assert.equal(result.delivery, 'live');
    assert.ok(result.generated_at);
    assert.equal(service.status().timeout_ms, 45000);
  }
});
test('only valid advice is cached against exact evidence; same-key in-flight requests coalesce', async () => {
  let calls = 0, release;
  const service = createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async () => { calls++; await new Promise(r => release = r); return response(parsed); } });
  const a = service.generateWorkflowAdvice(input), b = service.generateWorkflowAdvice(input);
  await Promise.resolve(); release();
  const results = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(results[0].source, 'deepseek');
  results[0].summary = 'edited';
  const cached = await service.generateWorkflowAdvice(input);
  assert.equal(cached.delivery, 'cache');
  assert.equal(cached.summary, parsed.summary);
  const next = service.generateWorkflowAdvice({ ...input, feature_evidence: [{ ...input.feature_evidence[0], value: 0.9 }] });
  await Promise.resolve(); release(); await next;
  assert.equal(calls, 2);
});
test('invalid output is never cached and diagnostics never contain provider text', async () => {
  let calls = 0;
  const service = createExpertAdviceService({ apiKey: 'private-key', fetchImpl: async () => { calls++; return response({ ...parsed, evidence_ids: ['FORGED'] }); } });
  for (let i = 0; i < 2; i++) assert.equal((await service.generateWorkflowAdvice(input)).fallback_reason, 'invalid_provider_advice');
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(service.status()).includes('private'));
  assert.ok(!JSON.stringify(service.status()).includes(parsed.summary));
});

test('internal project notes and source locators never leave the advice service', async () => {
  let sent;
  const service = createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async (_url, init) => { sent = JSON.parse(init.body); return response(parsed); } });
  await service.generateWorkflowAdvice({ ...input, knowledge_chunks: [{ id: 'knowledge:project:private', source_kind: 'project_implementation_note', source_url: null,
    title: 'private implementation', text: 'private internal source', locator: 'D:/private/server/secret.js', content_sha256: 'a'.repeat(64) }] });
  assert.deepEqual(JSON.parse(sent.messages.at(-1).content).knowledge_chunks, []);
  assert.ok(!JSON.stringify(sent).includes('private'));
});

test('file-backed advice survives service restart with its original generation timestamp', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mine-advice-service-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = await createExpertAdviceService({ apiKey: 'test-key', cacheDirectory: directory, fetchImpl: async () => response(parsed) }).generateWorkflowAdvice(input);
  let requests = 0;
  const next = await createExpertAdviceService({ apiKey: 'test-key', cacheDirectory: directory, fetchImpl: async () => { requests++; throw new Error('offline'); } }).generateWorkflowAdvice(input);
  assert.equal(next.delivery, 'cache'); assert.equal(next.generated_at, first.generated_at);
  assert.equal(requests, 0); assert.deepEqual(next.risk, first.risk);
});

test('invalid cached advice is revalidated and never displayed; timeout configuration stays bounded', async () => {
  let requests = 0;
  const cache = { storage: 'test', get: () => ({ ...parsed, provider_model: 'deepseek-flash', prompt_version: 'rag-qualitative-v4-public-20261015', generated_at: new Date().toISOString(), evidence_ids: ['FORGED'] }), set() {} };
  const service = createExpertAdviceService({ apiKey: 'test-key', model: 'deepseek-flash', cache, timeoutMs: 999999, fetchImpl: async () => { requests++; return response(parsed); } });
  assert.equal(service.status().timeout_ms, 90000);
  assert.equal((await service.generateWorkflowAdvice(input)).delivery, 'live');
  assert.equal(requests, 1);
  assert.equal(createExpertAdviceService({ timeoutMs: NaN }).status().timeout_ms, 45000);
});

test('corrupt cache files are ignored and unwritable cache paths cannot suppress valid advice', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mine-advice-corrupt-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = 'd'.repeat(64);
  writeFileSync(join(directory, `${key}.json`), '{broken');
  assert.equal(createAdviceCache({ directory }).get(key), null);
  const occupied = join(directory, 'occupied'); writeFileSync(occupied, 'test fixture');
  const result = await createExpertAdviceService({ apiKey: 'test-key', cacheDirectory: occupied, fetchImpl: async () => response(parsed) }).generateWorkflowAdvice(input);
  assert.equal(result.delivery, 'live');
  assert.throws(() => createAdviceCache({ limit: -1 }), TypeError);
});

test('truncated or filtered generations are never accepted or cached even with valid JSON', async () => {
  let calls = 0;
  const service = createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async () => {
    calls++; return { ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(parsed) } }] }) };
  } });
  for (let i = 0; i < 2; i++) assert.equal((await service.generateWorkflowAdvice(input)).fallback_reason, 'provider_incomplete');
  assert.equal(calls, 2);
});
