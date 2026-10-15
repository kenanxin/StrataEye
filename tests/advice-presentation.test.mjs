import test from 'node:test';
import assert from 'node:assert/strict';
import { adviceSourceLabel, adviceNotice, requestAdvice } from '../js/advice-presentation.mjs';
test('live, exact-evidence history and fallback have distinct truthful labels', () => {
  assert.equal(adviceSourceLabel({ source: 'deepseek', delivery: 'live' }), 'DeepSeek 实时生成');
  assert.equal(adviceSourceLabel({ source: 'deepseek', delivery: 'cache' }), 'DeepSeek 历史结果');
  const notice = adviceNotice({ source: 'deepseek', delivery: 'cache', generated_at: '2026-10-15T05:49:14Z' });
  assert.match(notice, /非本次实时调用/); assert.match(notice, /原生成时间/);
  assert.match(adviceNotice({ fallback_reason: 'provider_timeout', diagnostics: { phase: 'reading_body' } }), /已连接/);
});
test('advice deadline also bounds stalled body reads without an automatic retry', async () => {
  for (const bodyStalls of [true, false]) {
    let calls = 0;
    await assert.rejects(requestAdvice(async () => {
      calls++; return bodyStalls ? { ok: true, json: () => new Promise(() => {}) } : new Promise(() => {});
    }, '/explain', {}, { timeoutMs: 10 }), /等待超时/);
    assert.equal(calls, 1);
  }
});
test('advice helper returns validated server result and preserves HTTP errors', async () => {
  assert.deepEqual(await requestAdvice(async () => ({ ok: true, json: async () => ({ source: 'deepseek' }) }), '/', {}), { source: 'deepseek' });
  await assert.rejects(requestAdvice(async () => ({ ok: false, status: 429, json: async () => ({ error: { message: '已有请求' } }) }), '/', {}), /已有请求/);
});
