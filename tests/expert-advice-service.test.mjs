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
const workflowAdviceFor = parsed => createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(parsed) } }] }) }) }).generateWorkflowAdvice(workflowInput);

const qualitativeExamples = ['进一步复核证据', '复核证据的一致性', '统一安排复测', '一旦发现异常应复核', '一般风险应持续观察'];
for (const value of qualitativeExamples) {
  for (const field of ['summary', 'recommendations']) {
    test(`workflow qualitative terms preserve provider text: ${field} ${value}`, async () => {
      const parsed = providerPayload({ [field]: field === 'summary' ? value : [value], risk: { predicted_class: '低风险', score: 0, confidence: 0 } });
      const result = await createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(parsed) } }] }) }) }).generateWorkflowAdvice(workflowInput);
      assert.equal(result.source, 'deepseek');
      assert.equal(result.summary, parsed.summary);
      assert.deepEqual(result.recommendations, parsed.recommendations);
      assert.deepEqual(result.risk, workflowInput.risk);
      assert.deepEqual(result.evidence_ids, parsed.evidence_ids);
      assert.equal(Object.hasOwn(result, 'fallback_reason'), false);
      assert.equal(Object.hasOwn(result, 'validation_errors'), false);
    });
  }
}

test('workflow qualitative masking still rejects adjacent numeric instructions in every proposal field', async () => {
  for (const value of ['进一步补强三百MPa', '统一在三十分钟内处置', '一旦超过５MPa', '一般风险每天一次', '一致率达到99%', '复核至少十处', '复核 one support']) {
    for (const field of ['summary', 'recommendations']) {
      const result = await workflowAdviceFor(providerPayload({ [field]: field === 'summary' ? value : [value] }));
      assert.equal(result.source, 'local-rule', `${field}: ${value}`);
      assert.equal(result.fallback_reason, 'invalid_provider_advice');
      assert.deepEqual(result.validation_errors, [{ code: field === 'summary' ? 'summary_numeric_content' : 'recommendation_numeric_content', field, ...(field === 'recommendations' ? { index: 0 } : {}) }]);
      assert.deepEqual(result.risk, workflowInput.risk);
      assert.deepEqual(result.recommendations, workflowInput.rule_recommendations);
    }
  }
});

test('workflow validation reports fixed diagnostics for malformed fields and citations', async () => {
  const cases = [
    [{ summary: '' }, { code: 'summary_invalid', field: 'summary' }],
    [{ summary: ' ' }, { code: 'summary_invalid', field: 'summary' }],
    [{ summary: null }, { code: 'summary_invalid', field: 'summary' }],
    [{ summary: {} }, { code: 'summary_invalid', field: 'summary' }],
    [{ summary: '复'.repeat(4001) }, { code: 'summary_invalid', field: 'summary' }],
    [{ recommendations: [] }, { code: 'recommendations_invalid', field: 'recommendations' }],
    [{ recommendations: Array(7).fill('复测支护') }, { code: 'recommendations_invalid', field: 'recommendations' }],
    [{ recommendations: '复测支护' }, { code: 'recommendations_invalid', field: 'recommendations' }],
    [{ recommendations: null }, { code: 'recommendations_invalid', field: 'recommendations' }],
    [{ recommendations: [''] }, { code: 'recommendation_invalid', field: 'recommendations', index: 0 }],
    [{ recommendations: ['复测支护', ' '] }, { code: 'recommendation_invalid', field: 'recommendations', index: 1 }],
    [{ recommendations: [{}] }, { code: 'recommendation_invalid', field: 'recommendations', index: 0 }],
    [{ recommendations: [null] }, { code: 'recommendation_invalid', field: 'recommendations', index: 0 }],
    [{ recommendations: ['复'.repeat(1001)] }, { code: 'recommendation_invalid', field: 'recommendations', index: 0 }],
    [{ evidence_ids: [] }, { code: 'evidence_ids_invalid', field: 'evidence_ids' }],
    [{ evidence_ids: 'feature:r:roof' }, { code: 'evidence_ids_invalid', field: 'evidence_ids' }],
    [{ evidence_ids: null }, { code: 'evidence_ids_invalid', field: 'evidence_ids' }],
    [{ evidence_ids: [42] }, { code: 'evidence_ids_invalid', field: 'evidence_ids' }],
    [{ evidence_ids: ['FORGED'] }, { code: 'unknown_evidence', field: 'evidence_ids' }],
  ];
  for (const [extra, expected] of cases) {
    const result = await workflowAdviceFor(providerPayload(extra));
    assert.equal(result.source, 'local-rule', expected.code);
    assert.equal(result.fallback_reason, 'invalid_provider_advice');
    assert.deepEqual(result.validation_errors, [expected]);
  }
  for (const parsed of [null, true, 42, [], 'private provider text']) {
    const result = await workflowAdviceFor(parsed);
    assert.equal(result.fallback_reason, 'invalid_provider_advice');
    assert.deepEqual(result.validation_errors, [
      { code: 'summary_invalid', field: 'summary' },
      { code: 'recommendations_invalid', field: 'recommendations' },
      { code: 'evidence_ids_invalid', field: 'evidence_ids' },
    ]);
  }
});

test('workflow accepts exact text and array limits with original proposal wording', async () => {
  const parsed = providerPayload({ summary: '复'.repeat(4000), recommendations: Array(6).fill('核'.repeat(1000)) });
  const result = await workflowAdviceFor(parsed);
  assert.equal(result.source, 'deepseek');
  assert.equal(result.summary, parsed.summary);
  assert.deepEqual(result.recommendations, parsed.recommendations);
  assert.deepEqual(result.evidence_ids, parsed.evidence_ids);
});

test('workflow validation diagnostics are bounded and never contain provider content or credentials', async () => {
  const privateMarker = 'private-key private response body person@example.com';
  const parsed = providerPayload({ summary: `${privateMarker} 300MPa`, recommendations: Array(20).fill(`${privateMarker} 三百MPa`), evidence_ids: [privateMarker] });
  const result = await createExpertAdviceService({ apiKey: 'private-key', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(parsed) } }] }) }) }).generateWorkflowAdvice(workflowInput);
  assert.equal(result.fallback_reason, 'invalid_provider_advice');
  assert.equal(result.validation_errors.length, 12);
  const allowed = {
    summary_invalid: 'summary', summary_numeric_content: 'summary',
    recommendations_invalid: 'recommendations', recommendation_invalid: 'recommendations', recommendation_numeric_content: 'recommendations',
    evidence_ids_invalid: 'evidence_ids', unknown_evidence: 'evidence_ids',
  };
  for (const error of result.validation_errors) {
    assert.equal(error.field, allowed[error.code]);
    assert.deepEqual(Object.keys(error).sort(), Object.hasOwn(error, 'index') ? ['code', 'field', 'index'] : ['code', 'field']);
    if (Object.hasOwn(error, 'index')) assert.ok(Number.isInteger(error.index) && error.index >= 0);
  }
  for (const secret of ['private-key', 'private response body', 'person@example.com']) assert.ok(!JSON.stringify(result).includes(secret));
  const unknown = await workflowAdviceFor(providerPayload({ evidence_ids: [privateMarker] }));
  assert.deepEqual(unknown.validation_errors, [{ code: 'unknown_evidence', field: 'evidence_ids' }]);
  assert.ok(!JSON.stringify(unknown).includes(privateMarker));
});

test('workflow prompt states exact limits and includes a valid example using this request evidence', async () => {
  const input = structuredClone(workflowInput);
  input.feature_evidence[0].id = 'feature:current:roof';
  input.similar_record_ids = [];
  let prompt;
  const result = await createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async (_url, request) => {
    prompt = JSON.parse(request.body).messages[0].content;
    const example = JSON.parse(prompt.split('JSON示例：')[1]);
    assert.deepEqual(example.evidence_ids, ['feature:current:roof']);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(example) } }] }) };
  } }).generateWorkflowAdvice(input);
  assert.equal(result.source, 'deepseek');
  assert.match(prompt, /summary[^。]*4000/);
  assert.match(prompt, /recommendations[^。]*1[–-]6[^。]*1000/);
  assert.match(prompt, /中文数量/);
  assert.match(prompt, /英文数量/);
  assert.match(prompt, /百分比/);
  assert.match(prompt, /时限/);
  assert.match(prompt, /工程阈值/);
  assert.match(prompt, /原样/);
  assert.deepEqual(result.risk, input.risk);
});

test('workflow transport and JSON failures keep their existing reason without validation diagnostics', async () => {
  const cases = [
    [{ apiKey: '' }, 'not_configured'],
    [{ fetchImpl: async () => ({ ok: false }) }, 'provider_http_error'],
    [{ fetchImpl: async () => { throw new Error('private response'); } }, 'provider_unavailable'],
    ...['', 'plain text'].map(content => [{ fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }) }, content ? 'invalid_provider_json' : 'empty_provider_response']),
  ];
  for (const [options, reason] of cases) {
    const result = await createExpertAdviceService({ apiKey: 'test-key', ...options }).generateWorkflowAdvice(workflowInput);
    assert.equal(result.fallback_reason, reason);
    assert.equal(Object.hasOwn(result, 'validation_errors'), false);
  }
});

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
