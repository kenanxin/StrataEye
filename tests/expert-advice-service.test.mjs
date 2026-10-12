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

const workflowInput = { risk: { predicted_class: '重大风险', score: 95, confidence: 0.99 }, feature_evidence: [{ id: 'feature:r:roof', key: 'roof', label: '顶板', value: 2 }], similar_record_ids: ['REC-1'], reviewed_memory: [{ record_id: 'REC-2', workflow_run_id: 'WF-test', reviewed: true, reviewed_conclusion: '复测可参考', actor: { username: 'private person' } }], rule_recommendations: ['复测支护'], feedback: [{ responsiblePerson: 'private person', photos: [{ name: 'private.jpg' }] }], actor: { username: 'private person' } };
const providerPayload = (extra = {}) => ({ summary: '证据解释', recommendations: ['复测支护'], evidence_ids: ['feature:r:roof', 'REC-1'], ...extra });
test('workflow advice uses constrained prompt, known evidence and immutable authoritative risk', async () => {
  const before = structuredClone(workflowInput);
  const service = createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async (_url, request) => {
    assert.ok(!request.body.includes('private person'));
    assert.ok(!request.body.includes('private.jpg'));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(providerPayload({ risk: { predicted_class: '低风险' }, riskLevel: '低风险' })) } }] }) };
  } });
  const result = await service.generateWorkflowAdvice(workflowInput);
  assert.equal(result.source, 'deepseek');
  assert.equal(result.risk.predicted_class, '重大风险');
  assert.deepEqual(workflowInput, before);
});
test('workflow advice validates citations, JSON, arrays and numeric engineering instructions', async () => {
  for (const content of ['', 'plain text', JSON.stringify(providerPayload({ evidence_ids: ['FORGED'] })), JSON.stringify(providerPayload({ recommendations: 'bad' })), JSON.stringify(providerPayload({ recommendations: [{ text: 'bad' }] })), JSON.stringify(providerPayload({ recommendations: ['支护压力设为300MPa'] })), JSON.stringify(providerPayload({ summary: '支护压力设为三百MPa' }))]) {
    const result = await createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }) }).generateWorkflowAdvice(workflowInput);
    assert.equal(result.source, 'local-rule');
    assert.ok(result.fallback_reason);
    assert.deepEqual(result.recommendations, ['复测支护']);
  }
});
test('workflow provider HTTP failure and timeout remain truthful and sanitized', async () => {
  const failed = await createExpertAdviceService({ apiKey: 'private-key', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ secret: 'private body' }) }) }).generateWorkflowAdvice(workflowInput);
  assert.equal(failed.fallback_reason, 'provider_http_error');
  assert.ok(!JSON.stringify(failed).includes('private'));
  const timed = await createExpertAdviceService({ apiKey: 'private-key', timeoutMs: 10, fetchImpl: (_url, request) => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(Object.assign(new Error('private'), { name: 'AbortError' })))) }).generateWorkflowAdvice(workflowInput);
  assert.equal(timed.fallback_reason, 'provider_timeout');
});
test('all displayed provider advice rejects new numeric thresholds in percentages, time and Chinese quantities', async () => {
  for (const value of ['氧浓度低于18%立即停止作业', '每班最多作业8小时', '氧浓度低于百分之十八立即停止作业', '每班最多作业八小时', '每班最多作业٨小时', '氧浓度低于１８％立即停止作业', '每班最多作业半小时', 'Maximum eight hours per shift']) {
    for (const field of ['summary', 'recommendations']) {
      const parsed = providerPayload({ [field]: field === 'summary' ? value : [value] });
      const result = await createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(parsed) } }] }) }) }).generateWorkflowAdvice(workflowInput);
      assert.equal(result.source, 'local-rule', `${field}: ${value}`);
    }
  }
});
test('reviewed case freeform names, phones and emails never enter the provider prompt', async () => {
  let captured;
  const input = structuredClone(workflowInput);
  Object.assign(input.reviewed_memory[0], { reviewed_conclusion: '王小明 13800138000 person@example.com 私密复盘正文', risk_class: '重大风险', outcome: 'archived', action_codes: ['ACKNOWLEDGE', 'SUBMIT_DISPOSAL', 'APPROVE', 'ARCHIVE'], monitoring_trend: 'stable', execution_status: 'completed' });
  const result = await createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async (_url, request) => {
    captured = request.body;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(providerPayload({ evidence_ids: ['REC-2'] })) } }] }) };
  } }).generateWorkflowAdvice(input);
  assert.equal(result.source, 'deepseek');
  for (const privateText of ['王小明', '13800138000', 'person@example.com', '私密复盘正文', 'reviewed_conclusion']) assert.ok(!captured.includes(privateText), privateText);
  const submitted = JSON.parse(JSON.parse(captured).messages[1].content);
  assert.equal(submitted.reviewed_memory[0].record_id, 'REC-2');
  assert.equal(submitted.reviewed_memory[0].outcome, 'archived');
});

test('reviewed workflow citations distinguish shared CSV and review versions without private prompt fields', async () => {
  const input = structuredClone(workflowInput);
  input.reviewed_memory = ['WF-a', 'WF-b'].map(workflow_run_id => ({ reviewed: true, record_id: 'REC-shared', workflow_run_id, evidence_id: `case:${workflow_run_id}:review:1:r7`, review_version: 1, review_revision: 7, reviewed_at: '2026-10-12T10:00:00Z', source_model: { name: 'xgboost', mode: 'integrated_xgboost' }, risk_class: '重大风险', outcome: 'archived', action_codes: ['ARCHIVE'], actor: { name: 'private actor' }, organization: 'private org', reviewed_conclusion: 'private review', photos: ['private photo'], workOrder: 'private order' }));
  for (const citation of ['case:WF-a:review:1:r7', 'case:WF-b:review:1:r7', 'REC-shared', 'case:WF-a:review:2:r8']) {
    let captured;
    const result = await createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async (_url, request) => {
      captured = request.body;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(providerPayload({ evidence_ids: [citation] })) } }] }) };
    } }).generateWorkflowAdvice(input);
    assert.equal(result.source, citation.includes(':review:1:') ? 'deepseek' : 'local-rule');
    assert.ok(!captured.includes('private'));
    const safe = JSON.parse(JSON.parse(captured).messages[1].content).reviewed_memory;
    assert.deepEqual(safe.map(item => item.evidence_id), input.reviewed_memory.map(item => item.evidence_id));
    assert.deepEqual(safe[0].source_model, { name: 'xgboost', mode: 'integrated_xgboost' });
    assert.equal(safe[0].review_revision, 7);
  }
});
