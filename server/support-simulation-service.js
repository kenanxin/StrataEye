'use strict';
const { createHash } = require('node:crypto');
const defaultArtifact = require('../data/support-simulation-v1.json');
const shapeArtifact = require('../data/support-deformation-v1.json');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createKnowledgeRetrievalService } = require('./knowledge-retrieval-service.js');
const { createExpertAdviceService } = require('./expert-advice-service.js');

function createSupportSimulationService({ artifact = defaultArtifact, knowledgeService = createKnowledgeRetrievalService(), adviceService = createExpertAdviceService() } = {}) {
  const data = structuredClone(artifact);
  if(artifact===defaultArtifact){
    const hash=createHash('sha256').update(readFileSync(join(__dirname,'../data/support-simulation-v1.json'))).digest('hex');
    if(shapeArtifact.core_file_sha256!==hash||shapeArtifact.solver_source_sha256!==data.provenance.solver_source_sha256
      ||shapeArtifact.node_positions_m.length!==data.parameters.elements+1||!(shapeArtifact.display_reference_max_mm>0))throw new TypeError('Deformation provenance mismatch');
    data.deformation_version=shapeArtifact.version;data.display_reference_max_mm=shapeArtifact.display_reference_max_mm;
    data.deformation_provenance={...shapeArtifact, cases:undefined,node_positions_m:undefined};
    for(const item of data.cases){
      const shape=shapeArtifact.cases.find(c=>c.id===item.id);
      if(shape?.frames?.length!==item.frames.length)throw new TypeError('Missing deformation frames');
      item.frames.forEach((frame,i)=>{
        const p=shape.frames[i],n=shapeArtifact.node_positions_m.length;
        if(p.step!==i||p.displacement_mm.length!==n||p.rotation_rad.length!==n
          ||![...p.displacement_mm,...p.rotation_rad].every(Number.isFinite)
          ||Math.abs(p.displacement_mm[0])>1e-8||Math.abs(p.displacement_mm.at(-1))>1e-8
          ||Math.abs(p.displacement_mm[data.parameters.spring_node]-frame.support_displacement_mm)>1e-8)throw new TypeError('Invalid deformation field');
        frame.beam_profile={...structuredClone(p),node_positions_m:[...shapeArtifact.node_positions_m]};
        frame.display_reference_max_mm=shapeArtifact.display_reference_max_mm;
      });
    }
  }
  if (data.source_kind !== 'mechanics_simulation' || data.computation_mode !== 'precomputed_solver_frames' || data.cases?.length !== 3) throw new TypeError('Invalid support simulation artifact');
  for (const item of data.cases) {
    if (!item.id || !Number.isFinite(item.spring_stiffness_mn_per_m) || item.spring_stiffness_mn_per_m <= 0 || item.frames?.length !== 21) throw new TypeError('Invalid support preset');
    item.frames.forEach((frame, i) => {
      if (frame.step !== i || !['load_kn_per_m', 'support_force_kn', 'support_displacement_mm', 'max_deflection_mm', 'max_bending_stress_mpa', 'applied_load_kn', 'equilibrium_relative_error', 'residual_relative_error'].every(key => Number.isFinite(frame[key]) && frame[key] >= 0)
        || !Array.isArray(frame.boundary_reactions_kn) || !frame.boundary_reactions_kn.every(Number.isFinite)
        || Math.abs(frame.support_force_kn - item.spring_stiffness_mn_per_m * frame.support_displacement_mm) > 1e-7
        || Math.abs(frame.support_force_kn + frame.boundary_reactions_kn.reduce((a, b) => a + b, 0) - frame.applied_load_kn) > 1e-6
        || Math.max(frame.equilibrium_relative_error, frame.residual_relative_error) > 1e-8) throw new TypeError('Support frame verification failed');
    });
  }
  const artifactHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  function getCase(caseId, step) {
    const item = data.cases.find(c => c.id === caseId);
    if (!item || !Number.isInteger(step) || step < 0 || step >= item.frames.length) throw new TypeError('Unknown simulation preset or invalid loading step');
    return { version: data.version, source_kind: data.source_kind, artifact_sha256: artifactHash, object_id: data.object_id,
      case_id: item.id, label: item.label, spring_stiffness_mn_per_m: item.spring_stiffness_mn_per_m, frame: structuredClone(item.frames[step]) };
  }
  let busy = false;
  return {
    catalog() { return { ...structuredClone(data), artifact_sha256: artifactHash }; },
    getCase,
    async explain({ caseId, step }) {
      const selected = getCase(caseId, step);
      if (busy) { const error = new Error('已有模拟研判请求正在处理，请稍后重试'); error.statusCode = 429; error.code = 'SIMULATION_ADVICE_BUSY'; throw error; }
      busy = true;
      try {
        const baseline=data.cases.find(c=>c.id==='reference-support'),reference=baseline.frames[step];
        const contrast=selected.spring_stiffness_mn_per_m<baseline.spring_stiffness_mn_per_m?'较低刚度 位移增大 反力降低':selected.spring_stiffness_mn_per_m>baseline.spring_stiffness_mn_per_m?'较高刚度 位移减小 反力增加':'参考刚度 联合观察';
        const retrieval = knowledgeService.retrieve({ query: `结构力学 梁 弯曲 弹性 刚度 载荷 位移 反力 ${contrast} 矿压监测 支护载荷 变形 联合观察 顶板 安全管理 人工复核`, limit: 5 });
        const id = `simulation:${data.version}:${caseId}:${step}`;
        const frame = selected.frame;
        const featureEvidence = [
          ['support_force_kn', '模拟支护反力', frame.support_force_kn, 'kN'],
          ['support_displacement_mm', '支护点顶板位移', frame.support_displacement_mm, 'mm'],
          ['load_kn_per_m', '条带均布载荷', frame.load_kn_per_m, 'kN/m'],
          ['stiffness', '支护弹簧刚度', selected.spring_stiffness_mn_per_m, 'MN/m'],
          ['reference_force_kn','同载荷参考刚度工况反力',reference.support_force_kn,'kN'],
          ['reference_displacement_mm','同载荷参考刚度工况位移',reference.support_displacement_mm,'mm'],
          ['reference_stiffness','参考支护刚度',baseline.spring_stiffness_mn_per_m,'MN/m'],
        ].map(([key, label, value, unit]) => ({ id: `${id}:${key}`, key, label, value, unit }));
        const advice = await adviceService.generateWorkflowAdvice({ evidence_origin: 'mechanics_simulation',
          risk: { predicted_class: '模拟工况待人工研判', score: null, confidence: null }, feature_evidence: featureEvidence,
          knowledge_chunks: retrieval.chunks, rule_recommendations: ['联合复核载荷、支护刚度、反力与顶板位移', '核对模型假设与现场条件后再形成处置方案', '由有权限的人员确认，保留解释依据和复核记录'] });
        return { ...selected, evidence: featureEvidence, retrieval, advice,
          comparison:{case_id:baseline.id,step,load_kn_per_m:reference.load_kn_per_m,support_force_kn:reference.support_force_kn,support_displacement_mm:reference.support_displacement_mm},
          human_approval_required: true, business_event_created: false,
          disclaimer: data.disclaimer, chain: [
            { agent_id: 'A1', status: 'success', summary: '读取选定预计算帧，未调用教师XGBoost分类' },
            { agent_id: 'A2', status: 'success', summary: `检索${retrieval.chunks.length}段跨域资料` },
            { agent_id: 'A3', status: 'success', summary: advice.source === 'deepseek' ? '生成带引用的DeepSeek候选解释' : `规则解释回退：${advice.fallback_reason || 'provider_unavailable'}` },
            { agent_id: 'A5', status: 'skipped', summary: '研究解释不创建现场资源任务' },
            { agent_id: 'A4', status: 'waiting_human', summary: '仅供人工研究复核，未写入教师事件或下发指令' },
            { agent_id: 'A6', status: 'skipped', summary: '未形成真实处置结果，不自动归档案例' },
          ] };
      } finally { busy = false; }
    },
  };
}
module.exports = { createSupportSimulationService };
