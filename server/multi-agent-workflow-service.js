'use strict';

const { randomUUID } = require('crypto');
const { performance } = require('node:perf_hooks');

const AGENTS = [
  ['A1', '感知预警 Agent', 'perception_warning'],
  ['A2', '知识检索 Agent', 'knowledge_retrieval'],
  ['A3', '调度决策 Agent', 'dispatch_decision'],
  ['A5', '资源评估 Agent', 'resource_evaluation'],
  ['A4', '协同管控 Agent', 'collaborative_control'],
  ['A6', '反思迭代 Agent', 'reflection_iteration'],
];

const DEFAULT_RESOURCES = Object.freeze({
  personnel_available: 6,
  support_material_sets: 12,
  inspection_devices: 3,
});

function skippedNode(agent, reason) {
  return {
    agent_id: agent[0], name: agent[1], node: agent[2], status: 'skipped',
    reason, input_evidence: [], output_summary: reason, output: null, elapsed_ms: 0,
  };
}

function completedNode(agent, status, inputEvidence, outputSummary, output, startedAt) {
  return {
    agent_id: agent[0], name: agent[1], node: agent[2], status,
    input_evidence: inputEvidence, output_summary: outputSummary, output,
    elapsed_ms: Number((performance.now() - startedAt).toFixed(6)),
  };
}

function planForRisk(predictedClass) {
  if (predictedClass === '重大风险') {
    return ['立即停止危险区域作业并组织撤离', '划定警戒区并复核支护与顶板状态', '加密监测并提交监管核验'];
  }
  if (predictedClass === '较大风险') {
    return ['现场复测主要异常指标', '制定临时补强支护工单', '加密监测并提交监管复核'];
  }
  return ['提高采样频率', '复核顶板与支护状态', '持续跟踪指标趋势'];
}

function resourceEvaluation(snapshot) {
  if (snapshot !== undefined && (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot))) {
    throw new TypeError('resourceSnapshot must be an object');
  }
  const resource = { ...DEFAULT_RESOURCES, ...(snapshot || {}) };
  for (const key of Object.keys(resource)) {
    if (!Object.hasOwn(DEFAULT_RESOURCES, key) || !Number.isSafeInteger(resource[key]) || resource[key] < 0) {
      throw new TypeError(`resourceSnapshot.${key} must be a non-negative safe integer`);
    }
  }
  const gaps = [];
  if (Number(resource.personnel_available) < 2) gaps.push('现场处置人员不足2人');
  if (Number(resource.support_material_sets) < 1) gaps.push('补强支护材料不足');
  if (Number(resource.inspection_devices) < 1) gaps.push('复测设备不足');
  return {
    snapshot: resource,
    feasibility: gaps.length ? 'infeasible' : 'feasible',
    gaps,
    redecision_required: gaps.length > 0,
  };
}

function createMultiAgentWorkflowService(repository) {
  if (!repository?.evaluateRecord || !repository?.findSimilarCases) {
    throw new TypeError('repository must provide evaluateRecord and findSimilarCases');
  }

  function reflect({ run, feedback = {} }) {
    if (!run?.workflow_run_id) throw new TypeError('a completed workflow run is required');
    let action = 'wait_for_feedback';
    let reason = '等待人工审批与现场处置反馈，尚未完成闭环核验。';
    if (feedback.monitoring_trend === 'worsened') {
      action = 'return_to_perception'; reason = '监测趋势恶化，建议人工确认后返回A1读取新监测窗口。';
    } else if (feedback.execution_status === 'failed') {
      action = 'return_to_decision'; reason = '处置执行失败，建议返回A3重新生成候选方案。';
    } else if (feedback.resource_changed === true) {
      action = 'return_to_resource'; reason = '资源条件变化，建议返回A5重新评估。';
    } else if (feedback.notification_failed === true) {
      action = 'return_to_control'; reason = '协同通知失败，建议返回A4重新生成协同草案。';
    } else if (feedback.execution_status === 'completed' && feedback.monitoring_trend === 'stable') {
      action = 'finish'; reason = '已收到执行完成和监测稳定反馈，提交人工闭环核验；本节点未代替监管审批。';
    }
    return {
      agent_id: 'A6', name: '反思迭代 Agent', status: action === 'finish' ? 'success' : 'waiting_human',
      reflection_mode: 'rule_assisted', auto_loop: false, auto_update: false,
      return_decision: { action, reason, operator_confirmation_required: true },
    };
  }

  function run({ recordId, resourceSnapshot } = {}) {
    if (typeof recordId !== 'string' || !recordId) throw new TypeError('recordId is required');
    if (resourceSnapshot !== undefined) resourceEvaluation(resourceSnapshot);
    let startedAt = performance.now();
    const evaluated = repository.evaluateRecord(recordId);
    const workflowRunId = `WF-${randomUUID()}`;
    const warningId = `WARN-${recordId}`;
    const traceId = randomUUID();
    const nodes = [];
    const predictedClass = evaluated.model_output.predicted_class;
    const isLowRisk = predictedClass === '低风险';

    nodes.push(completedNode(
      AGENTS[0], 'success',
      evaluated.feature_evidence.map((item) => `${item.label}=${item.value}${item.unit || ''}`),
      `XGBoost判定${predictedClass}，置信度${(evaluated.model_output.confidence * 100).toFixed(2)}%。`,
      {
        warning_id: warningId,
        risk_level: predictedClass,
        risk_score: evaluated.risk.score,
        confidence: evaluated.model_output.confidence,
        fast_alert_required: ['较大风险', '重大风险'].includes(predictedClass),
        feature_evidence: evaluated.feature_evidence,
        model_mode: 'integrated_xgboost',
      },
      startedAt,
    ));

    if (isLowRisk) {
      AGENTS.slice(1).forEach((agent) => nodes.push(skippedNode(agent, 'A1判定为低风险，按条件边结束本次链路。')));
      return buildResult({ workflowRunId, warningId, traceId, evaluated, nodes, currentPhase: 'finish', nextAction: 'continue_monitoring' });
    }

    startedAt = performance.now();
    const similar = repository.findSimilarCases(recordId, 3);
    nodes.push(completedNode(
      AGENTS[1], 'success',
      [`查询记录${recordId}`, `标准化七维特征欧氏距离`, `数据哈希${evaluated.provenance.source_sha256.slice(0, 12)}…`],
      `检索到${similar.cases.length}条真实数据相似记录；相似不代表已证实事故因果。`,
      { method: similar.method, catalog: 'teacher_csv_similar_records', cases: similar.cases },
      startedAt,
    ));

    startedAt = performance.now();
    const actions = planForRisk(predictedClass);
    nodes.push(completedNode(
      AGENTS[2], 'success',
      [`风险等级：${predictedClass}`, `${similar.cases.length}条相似数据记录`, ...evaluated.risk.trigger],
      `形成${actions.length}项可审计候选处置步骤，等待资源可行性校验。`,
      { decision_mode: 'rule_assisted', plan_id: `PLAN-${recordId}`, actions, human_approval_boundary: true },
      startedAt,
    ));

    startedAt = performance.now();
    const resources = resourceEvaluation(resourceSnapshot);
    nodes.push(completedNode(
      AGENTS[3], resources.feasibility === 'feasible' ? 'success' : 'needs_attention',
      Object.entries(resources.snapshot).map(([key, value]) => `${key}=${value}`),
      resources.feasibility === 'feasible' ? '人员、材料和复测设备满足演示处置方案要求。' : `存在${resources.gaps.length}项资源缺口，禁止进入协同管控。`,
      resources,
      startedAt,
    ));

    if (resources.feasibility !== 'feasible') {
      nodes.push(skippedNode(AGENTS[4], 'A5资源评估不可行，未生成协同下发草案。'));
      nodes.push(skippedNode(AGENTS[5], '未进入协同管控，本次不执行反思节点。'));
      return buildResult({ workflowRunId, warningId, traceId, evaluated, nodes, currentPhase: 'resource_evaluation', nextAction: 'return_to_resource' });
    }

    startedAt = performance.now();
    nodes.push(completedNode(
      AGENTS[4], 'waiting_human',
      [`方案${nodes[2].output.plan_id}`, 'A5资源评估可行', '企业端/监管端/智库端权限边界'],
      '已生成三端协同处置草案；未自动下发任何真实控制指令。',
      {
        coordination_id: `COORD-${recordId}`,
        delivery_mode: 'dry_run', external_delivery: false, dispatch_status: 'waiting_approval',
        portal_tasks: { enterprise: actions, regulator: ['核验工单与监测对照', '决定通过或驳回'], expert: ['解释主要模型证据', '复盘并提出返回建议'] },
      },
      startedAt,
    ));

    startedAt = performance.now();
    const reflection = reflect({
      run: { workflow_run_id: workflowRunId },
      feedback: { execution_status: 'pending_human_approval' },
    });
    nodes.push(completedNode(
      AGENTS[5], reflection.status,
      ['A1—A5结构化输出', '当前尚无现场处置反馈'],
      '已建立反思检查点；等待三端处置反馈后判断闭环或定向返回。',
      reflection,
      startedAt,
    ));

    return buildResult({ workflowRunId, warningId, traceId, evaluated, nodes, currentPhase: 'waiting_human', nextAction: 'operator_approval' });
  }

  return {
    status() {
      return {
        available: true, runtime: 'node_compatibility_layer', source_design: 'delivered_langgraph_six_agent_workflow',
        perception_backend: 'teacher_real_csv_xgboost', node_order: AGENTS.map((agent) => agent[0]),
        human_approval_required: true, external_delivery: false,
      };
    },
    run,
    reflect,
  };
}

function buildResult({ workflowRunId, warningId, traceId, evaluated, nodes, currentPhase, nextAction }) {
  return {
    schema_version: 1,
    workflow_run_id: workflowRunId,
    warning_id: warningId,
    trace_id: traceId,
    current_phase: currentPhase,
    next_action: nextAction,
    algorithm: {
      data_source: 'teacher_real_csv_xgboost', model: evaluated.model_output.best_model,
      model_mode: 'integrated_xgboost', record_id: evaluated.record_id,
      predicted_class: evaluated.model_output.predicted_class,
      confidence: evaluated.model_output.confidence,
      source_sha256: evaluated.provenance.source_sha256,
    },
    nodes,
    safety: {
      human_approval_required: true,
      external_delivery: false,
      statement: 'A3—A6为规则辅助研判与演示性工作流，不代表生产级自动控制。',
    },
  };
}

module.exports = { AGENTS, DEFAULT_RESOURCES, createMultiAgentWorkflowService };
