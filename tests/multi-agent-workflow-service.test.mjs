import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createRoofRiskRepository } = require('../server/roof-risk-repository.js');
const { createMultiAgentWorkflowService } = require('../server/multi-agent-workflow-service.js');

const artifact = JSON.parse(fs.readFileSync(new URL('../data/roof-risk-dataset.json', import.meta.url), 'utf8'));
const service = createMultiAgentWorkflowService(createRoofRiskRepository(artifact));

test('major-risk XGBoost record executes the delivered six-agent order', () => {
  const result = service.run({ recordId: 'REC-202511101149-02909' });
  assert.deepEqual(result.nodes.map((node) => node.agent_id), ['A1', 'A2', 'A3', 'A5', 'A4', 'A6']);
  assert.deepEqual(result.nodes.map((node) => node.status), ['success', 'success', 'success', 'success', 'waiting_human', 'waiting_human']);
  assert.equal(result.algorithm.model, 'xgboost');
  assert.equal(result.algorithm.data_source, 'teacher_real_csv_xgboost');
  assert.equal(result.algorithm.record_id, 'REC-202511101149-02909');
  assert.equal(result.nodes[4].output.delivery_mode, 'dry_run');
  assert.equal(result.nodes[4].output.external_delivery, false);
  assert.equal(result.safety.human_approval_required, true);
});

test('pending feedback is not reported as completed reflection', () => {
  const run = service.run({ recordId: 'REC-202511101149-02909' });
  assert.equal(run.nodes[5].output.return_decision.action, 'wait_for_feedback');
  assert.equal(service.reflect({ run }).status, 'waiting_human');
  assert.equal(service.reflect({ run, feedback: { execution_status: 'completed', monitoring_trend: 'stable' } }).return_decision.action, 'finish');
  assert.ok(run.nodes.every((node) => Number.isFinite(node.elapsed_ms) && node.elapsed_ms >= 0));
  assert.ok(run.nodes.some((node) => node.elapsed_ms !== 1));
});

test('malformed resources cannot bypass the feasibility check', () => {
  for (const value of ['abc', '2', null, -1, 0.5, Infinity]) {
    assert.throws(() => service.run({ recordId: 'REC-202511101149-02909', resourceSnapshot: { personnel_available: value } }), /safe integer/);
  }
  assert.throws(() => service.run({ recordId: 'REC-202511101149-02909', resourceSnapshot: [] }), /object/);
});

test('low-risk record stops after A1 and marks downstream nodes skipped', () => {
  const result = service.run({ recordId: 'REC-202512062045-13620' });
  assert.equal(result.nodes[0].status, 'success');
  assert.ok(result.nodes.slice(1).every((node) => node.status === 'skipped'));
  assert.equal(result.current_phase, 'finish');
  assert.match(result.nodes[1].reason, /低风险/);
});

test('resource shortage stops at A5 and never creates a control draft', () => {
  const result = service.run({
    recordId: 'REC-202511101149-02909',
    resourceSnapshot: { personnel_available: 0, support_material_sets: 0, inspection_devices: 0 },
  });
  assert.equal(result.nodes[3].status, 'needs_attention');
  assert.equal(result.nodes[3].output.feasibility, 'infeasible');
  assert.equal(result.nodes[4].status, 'skipped');
  assert.equal(result.nodes[5].status, 'skipped');
  assert.equal(result.next_action, 'return_to_resource');
});

test('reflection recommends a human-confirmed return without executing a loop', () => {
  const run = service.run({ recordId: 'REC-202511101149-02909' });
  const result = service.reflect({ run, feedback: { monitoring_trend: 'worsened', execution_status: 'completed' } });
  assert.equal(result.agent_id, 'A6');
  assert.equal(result.return_decision.action, 'return_to_perception');
  assert.equal(result.return_decision.operator_confirmation_required, true);
  assert.equal(result.auto_loop, false);
});
