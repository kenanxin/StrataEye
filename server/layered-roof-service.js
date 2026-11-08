'use strict';
const { createHash } = require('node:crypto');
const defaultArtifact = require('../data/layered-roof-v1.json');
const { createKnowledgeRetrievalService } = require('./knowledge-retrieval-service.js');
const { createExpertAdviceService } = require('./expert-advice-service.js');

function createLayeredRoofService({ artifact = defaultArtifact, knowledgeService = createKnowledgeRetrievalService(), adviceService = createExpertAdviceService() } = {}) {
  const data = structuredClone(artifact);
  const valid = value => Number.isFinite(value) && value >= 0;
  const n = data.parameters?.elements + 1;
  const ids = new Set(['reference', 'load-increase', 'anchor-weakening', 'upper-loading']);
  if (data.source_kind !== 'mechanics_simulation' || data.computation_mode !== 'precomputed_solver_frames' || !Number.isInteger(n) || n < 3 || data.cases?.length !== 4) throw new TypeError('Invalid layered artifact');
  for (const item of data.cases) {
    if (!ids.delete(item.id) || !valid(item.anchor_stiffness_mn_per_m) || item.frames?.length !== 21) throw new TypeError('Invalid layered scenario');
    for (const [step, f] of item.frames.entries()) {
      const vectors = ['node_positions_m', 'signed_gap_mm', 'opening_mm', 'contact_overlap_mm'];
      if (f.step !== step || vectors.some(key => !Array.isArray(f[key]) || f[key].length !== n || !f[key].every(Number.isFinite)) ||
          f.layers?.length !== 2 || f.layers.some(l => l.displacement_mm?.length !== n || !l.displacement_mm.every(Number.isFinite) || !valid(l.max_deflection_mm) || !valid(l.max_bending_stress_mpa)) ||
          !['max_opening_mm', 'max_contact_overlap_mm', 'total_anchor_force_kn', 'applied_load_kn', 'upper_load_kn_per_m', 'lower_load_kn_per_m'].every(k => valid(f[k])) ||
          !['residual_relative_error', 'equilibrium_relative_error', 'energy_relative_error'].every(k => valid(f[k]) && f[k] < 1e-7)) throw new TypeError('Invalid layered frame');
      const near = (a, b) => Math.abs(a-b) <= 1e-6 * Math.max(1, Math.abs(b));
      for (let i = 0; i < n; i++) {
        const gap = f.layers[1].displacement_mm[i] - f.layers[0].displacement_mm[i];
        if (!near(f.signed_gap_mm[i], gap) || !near(f.opening_mm[i], Math.max(gap, 0)) || !near(f.contact_overlap_mm[i], Math.max(-gap, 0))) throw new TypeError('Gap verification failed');
      }
      const anchorNodes = data.parameters.anchor_nodes;
      if (!Array.isArray(anchorNodes) || Object.keys(f.anchor_forces_kn || {}).length !== anchorNodes.length || anchorNodes.some(node => !valid(f.anchor_forces_kn[node]) || !near(f.anchor_forces_kn[node], item.anchor_stiffness_mn_per_m*f.opening_mm[node]))) throw new TypeError('Tie verification failed');
      if (!Array.isArray(f.contact_forces_kn) || f.contact_forces_kn.length !== n-2 || f.contact_forces_kn.some((force, i) => !valid(force) || !near(force, data.parameters.contact_stiffness_n_per_m2*(data.parameters.length_m/(n-1))*f.contact_overlap_mm[i+1]/1e6))) throw new TypeError('Contact verification failed');
      const supports = Object.values(f.lower_support_forces_kn || {}), reactions = f.boundary_reactions_kn;
      if (!supports.every(valid) || !Array.isArray(reactions) || reactions.length !== 4 || !reactions.every(Number.isFinite) ||
          !near(f.applied_load_kn, (f.upper_load_kn_per_m+f.lower_load_kn_per_m)*data.parameters.length_m) ||
          !near(supports.reduce((a,b)=>a+b,0)+reactions.reduce((a,b)=>a+b,0), f.applied_load_kn) ||
          !near(f.max_opening_mm, Math.max(...f.opening_mm)) || !near(f.max_contact_overlap_mm, Math.max(...f.contact_overlap_mm)) ||
          !near(f.total_anchor_force_kn, Object.values(f.anchor_forces_kn).reduce((a,b)=>a+b,0))) throw new TypeError('Conservation verification failed');
    }
  }
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  function getCase(caseId, step) {
    const item = data.cases.find(c => c.id === caseId);
    if (!item || !Number.isInteger(step) || step < 0 || step > 20) throw new TypeError('Unknown layered scenario or loading step');
    const frame = item.frames[step], reference = data.cases.find(c => c.id === 'reference').frames[step];
    return structuredClone({ version: data.version, source_kind: data.source_kind, artifact_sha256: hash,
      object_id: data.object_id, case_id: caseId, label: item.label, frame, reference,
      comparison: { opening_delta_mm: frame.max_opening_mm-reference.max_opening_mm,
        anchor_force_delta_kn: frame.total_anchor_force_kn-reference.total_anchor_force_kn,
        lower_deflection_delta_mm: frame.layers[1].max_deflection_mm-reference.layers[1].max_deflection_mm,
        same_load: frame.upper_load_kn_per_m === reference.upper_load_kn_per_m && frame.lower_load_kn_per_m === reference.lower_load_kn_per_m },
      interpretation_kind: 'known_preset_comparison', human_approval_required: true, business_event_created: false });
  }
  let busy = false;
  return {
    catalog() { return { ...structuredClone(data), artifact_sha256: hash }; }, getCase,
    async explain({ caseId, step }) {
      const selected = getCase(caseId, step);
      if (busy) { const e = new Error('已有分层顶板解释正在处理'); e.code = 'SIMULATION_ADVICE_BUSY'; throw e; }
      busy = true;
      try {
        const f = selected.frame, r = selected.reference;
        const rows = [['opening', '模拟层间张开峰值', f.max_opening_mm, 'mm'], ['ties', '模拟锚固连接总拉力', f.total_anchor_force_kn, 'kN'],
          ['lower', '下层顶板挠度峰值', f.layers[1].max_deflection_mm, 'mm'], ['upper_load', '上层均布载荷', f.upper_load_kn_per_m, 'kN/m'],
          ['lower_load', '下层均布载荷', f.lower_load_kn_per_m, 'kN/m'], ['reference_opening', '参考工况层间张开', r.max_opening_mm, 'mm'],
          ['reference_ties', '参考工况锚固总拉力', r.total_anchor_force_kn, 'kN'], ['overlap', '罚接触弹性重叠峰值', f.max_contact_overlap_mm, 'mm']];
        const evidence = rows.map(([key, label, value, unit]) => ({ id: `layered:${data.version}:${caseId}:${step}:${key}`, key, label, value, unit }));
        const retrieval = knowledgeService.retrieve({ query: '顶板 离层 岩梁 弯曲 刚度 支护 受力 位移 联合监测 人工复核', limit: 5 });
        const advice = await adviceService.generateWorkflowAdvice({ evidence_origin: 'mechanics_simulation',
          risk: { predicted_class: '分层顶板预设工况研究', score: null, confidence: null },
          feature_evidence: evidence, knowledge_chunks: retrieval.chunks,
          rule_recommendations: ['联合比较层间张开、锚固拉力与下层变形，并核对载荷条件',
            '当前为已知预设工况对照，异常来源仍需现场监测与专家核验',
            '核对岩层参数、锚固条件和模型适用范围后由专业人员复核'] });
        return { ...selected, evidence, retrieval, advice, scope: data.scope, limitations: data.limitations };
      } finally { busy = false; }
    },
  };
}
module.exports = { createLayeredRoofService };
