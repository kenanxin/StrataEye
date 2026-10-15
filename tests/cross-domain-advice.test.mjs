import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createExpertAdviceService } = require('../server/expert-advice-service.js');
const { createKnowledgeRetrievalService } = require('../server/knowledge-retrieval-service.js');
const chunk = createKnowledgeRetrievalService().retrieve({ query: '支护 刚度 位移', limit: 6 }).chunks.find(item => item.source_url);
const input = { risk: { predicted_class: '较大风险', score: 70, confidence: 0.9 }, feature_evidence: [{ id: 'feature:r:support', label: '支架阻力', value: 0.8 }], knowledge_chunks: [chunk], rule_recommendations: ['人工复核支护'] };
const response = ids => ({ choices: [{ message: { content: JSON.stringify({ summary: '结合支护响应与资料复核异常原因', recommendations: ['人工核查支护状态'], evidence_ids: ids }) } }] });

test('current DeepSeek models use bounded non-thinking generation in both advice paths', async () => {
  for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
    const requests = [];
    const service = createExpertAdviceService({ apiKey: 'test-key', model, fetchImpl: async (_url, request) => {
      requests.push(JSON.parse(request.body));
      return { ok: true, json: async () => response([chunk.id]) };
    } });
    await service.generateWorkflowAdvice(input);
    await service.generate({ risk: { level: 'orange', score: 70 } });
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.model, model);
      assert.deepEqual(request.thinking, { type: 'disabled' });
      assert.equal(request.max_tokens, 1600);
      assert.equal(request.response_format, undefined);
    }
  }
});
test('A3 sends retrieved text and sources, accepts exact knowledge citation and locks model risk', async () => {
  let sent;
  const service = createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async (_url, request) => { sent = JSON.parse(request.body); return { ok: true, json: async () => response([chunk.id]) }; } });
  const result = await service.generateWorkflowAdvice(input);
  assert.equal(result.source, 'deepseek');
  assert.equal(JSON.parse(sent.messages.at(-1).content).knowledge_chunks[0].text, chunk.text);
  assert.deepEqual(result.evidence_ids, [chunk.id]);
  assert.deepEqual(result.risk, input.risk);
  assert.match(sent.messages[0].content, /资料.*指令|数据.*指令/);
});
test('unretrieved citations are rejected and rule fallback does not pretend to have cited RAG', async () => {
  const result = await createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => response(['knowledge:forged']) }) }).generateWorkflowAdvice(input);
  assert.equal(result.fallback_reason, 'invalid_provider_advice');
  assert.ok(!result.evidence_ids.includes(chunk.id));
  const offline = await createExpertAdviceService({ apiKey: '' }).generateWorkflowAdvice(input);
  assert.equal(offline.source, 'local-rule');
  assert.deepEqual(offline.evidence_ids, ['feature:r:support']);
});
