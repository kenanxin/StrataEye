import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createSupportSimulationService } = require('../server/support-simulation-service.js');
const { createExpertAdviceService } = require('../server/expert-advice-service.js');

test('support presets retain physical units, balance and F=k*w without teacher risk fields', () => {
  const service = createSupportSimulationService();
  const catalog = service.catalog();
  assert.equal(catalog.source_kind, 'mechanics_simulation');
  assert.equal(catalog.computation_mode, 'precomputed_solver_frames');
  assert.equal(catalog.cases.length, 3);
  for (const item of catalog.cases) {
    for (const frame of item.frames) {
      assert.ok(Math.abs(frame.support_force_kn - item.spring_stiffness_mn_per_m * frame.support_displacement_mm) < 1e-7);
      assert.ok(Math.abs(frame.support_force_kn + frame.boundary_reactions_kn.reduce((a, b) => a + b, 0) - frame.applied_load_kn) < 1e-6);
      assert.ok(frame.equilibrium_relative_error < 1e-8);
      assert.equal('risk_score' in frame, false);
    }
  }
  const weak = service.getCase('soft-support', 20), base = service.getCase('reference-support', 20);
  assert.ok(weak.frame.support_force_kn < base.frame.support_force_kn);
  assert.ok(weak.frame.support_displacement_mm > base.frame.support_displacement_mm);
  assert.match(catalog.disclaimer, /实测|现场/);
});
test('support service rejects arbitrary scenarios and out-of-range steps', () => {
  const service = createSupportSimulationService();
  for (const [id, step] of [['../../etc', 0], ['reference-support', -1], ['reference-support', 21], ['reference-support', 1.1], ['reference-support', '1']]) assert.throws(() => service.getCase(id, step), TypeError);
  const first = service.catalog(); first.cases[0].frames[0].support_force_kn = 999;
  assert.notEqual(service.catalog().cases[0].frames[0].support_force_kn, 999);
});
test('simulation advice uses server-owned frame, RAG evidence and truthful offline fallback', async () => {
  const service = createSupportSimulationService({ adviceService: createExpertAdviceService({ apiKey: '' }) });
  const result = await service.explain({ caseId: 'soft-support', step: 20 });
  assert.equal(result.source_kind, 'mechanics_simulation');
  assert.equal(result.advice.source, 'local-rule');
  assert.equal(result.advice.fallback_reason, 'not_configured');
  assert.equal(result.advice.risk.score, null);
  assert.doesNotMatch(result.advice.summary, /XGBoost判定/);
  assert.equal(result.business_event_created, false);
  assert.equal(result.human_approval_required, true);
  assert.ok(result.retrieval.chunks.length >= 3);
  assert.ok(result.advice.evidence_ids.every(id => id.startsWith('simulation:')));
});
test('export provenance points to the current exporter and the distinct simulation device role', async () => {
  const bytes = await readFile(new URL('../tools/export-support-simulation.py', import.meta.url));
  const catalog = createSupportSimulationService().catalog();
  assert.equal(catalog.provenance.exporter_source_sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(catalog.provenance.solver_verification.passed, true);
  assert.equal(catalog.scene_role, 'simulationSupport01');
});
