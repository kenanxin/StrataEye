import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createAgentCollaborationService } = require('../server/agent-collaboration-service.js');
const { createFileWorkflowStore } = require('../server/workflow-store.js');
const { createRoofRiskRepository } = require('../server/roof-risk-repository.js');
const { createExpertAdviceService } = require('../server/expert-advice-service.js');
const { createAppServer } = require('../server.js');
const artifact = JSON.parse(await readFile(new URL('../data/roof-risk-dataset.json', import.meta.url), 'utf8'));
const recordId = 'REC-202511101149-02909';
function provider() {
  let input;
  const service = createExpertAdviceService({ apiKey: 'test-key', fetchImpl: async (_url, request) => {
    input = JSON.parse(JSON.parse(request.body).messages.at(-1).content);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: '根据检索资料联合复核异常指标与支护状态', recommendations: ['由授权人员结合工况复核处置方案'], evidence_ids: [input.knowledge_chunks[0].id] }) } }] }) };
  } });
  return { service, input: () => input };
}
test('saved A2 snapshot feeds actual A3 citations and survives reprocess and storage reload', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mine-rag-workflow-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const ai = provider(), store = createFileWorkflowStore({ directory });
  const service = createAgentCollaborationService({ repository: createRoofRiskRepository(artifact), store, adviceService: ai.service });
  const actor = { username: 'operator', role: 'enterprise' };
  let run = await service.start({ recordId, actor, commandId: 'start' });
  const first = structuredClone(run.plan_versions[0].knowledge_retrieval);
  assert.equal(first.chunks.find(c => c.id === ai.input().knowledge_chunks[0].id).text, ai.input().knowledge_chunks[0].text);
  assert.ok(ai.input().knowledge_chunks.every(c => c.source_url && c.source_kind !== 'project_implementation_note' && !Object.hasOwn(c, 'locator')));
  assert.deepEqual(run.nodes[1].output.knowledge_retrieval, first);
  assert.equal(run.plan_versions[0].advice.source, 'deepseek');
  assert.ok(first.chunks.some(c => run.plan_versions[0].advice.evidence_ids.includes(c.id)));
  run = await service.act({ runId: run.workflow_run_id, actor, expectedRevision: run.revision, commandId: 'reprocess', type: 'REPROCESS', payload: { confirmed: true } });
  assert.deepEqual(run.plan_versions[0].knowledge_retrieval, first);
  assert.equal(run.plan_versions.length, 2);
  const restored = await createFileWorkflowStore({ directory }).get(run.workflow_run_id);
  assert.deepEqual(restored.plan_versions[0].knowledge_retrieval, first);
  assert.equal(restored.plan_versions[1].approved, false);
});
test('expert suggestion endpoint uses server record evidence and returns attributed RAG', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mine-rag-expert-'));
  const ai = provider(), server = createAppServer({ expertAdviceService: ai.service, workflowStore: createFileWorkflowStore({ directory }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { force: true, recursive: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'expert_analyst', password: 'Model@2026' }) });
  const response = await fetch(base + '/api/roof-risk/expert-advice', { method: 'POST', headers: { cookie: login.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json' },
    body: JSON.stringify({ recordId, risk: { score: 9999, predicted_class: 'fake' }, evidence: [{ value: 9999 }] }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.riskLevel, '较大风险'); assert.equal(result.risk.score, 70);
  assert.equal(ai.input().feature_evidence.length, 7);
  assert.ok(!JSON.stringify(ai.input()).includes('9999'));
  assert.ok(result.knowledge_retrieval.chunks.some(c => result.evidence_ids.includes(c.id)));
  assert.equal(result.source, 'deepseek');
});
