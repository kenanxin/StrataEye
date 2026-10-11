import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpertAdviceService, localAdvice } from '../server/expert-advice-service.js';

const input = {
  risk: { level: 'red', score: 95 },
  evidence: [{ key: 'roof', label: '顶板离层速率', standardized_value: 2.8 }],
  closed_loop: { active_step_label: '企业端现场处置' },
};

test('local advice is deterministic and contains traceable evidence', async () => {
  const result = await createExpertAdviceService({ apiKey: '' }).generate(input);
  assert.equal(result.source, 'local-rule');
  assert.equal(result.riskLevel, '重大风险');
  assert.match(result.summary, /顶板离层速率/);
  assert.ok(result.recommendations.length >= 3);
  assert.match(result.evidence[0], /2.80σ/);
});

test('successful DeepSeek response is normalized', async () => {
  const service = createExpertAdviceService({
    apiKey: 'test-key',
    fetchImpl: async (_url, request) => {
      assert.equal(request.headers.Authorization, 'Bearer test-key');
      return { ok: true, async json() { return { choices: [{ message: { content: JSON.stringify({ riskLevel: '重大风险', summary: '模型解释', recommendations: ['建议 A'], evidence: ['证据 A'], timeHorizon: '立即' }) } }] }; } };
    },
  });
  const result = await service.generate(input);
  assert.equal(result.source, 'deepseek');
  assert.equal(result.summary, '模型解释');
  assert.deepEqual(result.recommendations, ['建议 A']);
});

test('DeepSeek failure falls back to local advice', async () => {
  const service = createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async () => { throw new Error('offline'); } });
  const result = await service.generate(input);
  assert.equal(result.source, 'local-rule');
  assert.deepEqual(result.recommendations, localAdvice(input).recommendations);
  assert.equal(result.fallback_reason, 'provider_unavailable');
});

test('provider failure retains safe HTTP evidence without leaking response or key', async () => {
  const result = await createExpertAdviceService({ apiKey: 'private-key', fetchImpl: async () => ({ ok: false, status: 402 }) }).generate(input);
  assert.equal(result.fallback_reason, 'provider_http_error');
  assert.equal(result.provider_status, 402);
  assert.ok(!JSON.stringify(result).includes('private-key'));
});
