/* ============================================================
   智慧矿山数字孪生 — 主控制器
   初始化、数据驱动、交互管理、灾害模拟
   ============================================================ */

import { initScene, focusMineEquipment, focusRoofWarningStage, setRoofFieldMode, disasterEffects } from './scene.js';
import { clearRoofRiskCharts, disposeCharts, initPortalCharts, resizeCharts, updateReplayChart, updateRoofRiskCharts } from './charts.js';
import { init, startDisaster, resetDisaster, getEquipFaults, getEnvData, isActive, getState, tick, getDisasterList } from './disaster.js';
import { EQUIPMENT, METRICS, getMetricLevel, getMineState, updateMineState } from './mine-data.js';
import { mapRoofRiskViewModel, unavailableRoofRiskViewModel } from './roof-risk-view-model.mjs';
import { authFetch, bootstrapAuthenticatedPortal } from './auth-client.mjs';
import { createReplayController } from './roof-risk-replay-controller.mjs';
import { destroyWarningDemo, getWarningDemoAdviceContext, refreshWarningDemoRisk, setupWarningDemo } from './warning-demo-ui.mjs';
import { setupMultiAgentWorkflow } from './multi-agent-workflow-ui.mjs';

let activeEquipmentId = null;
let lastEquipmentListSignature = '';
let roofDemoTimer = null;
let roofDemoIndex = -1;
let roofDemoPlaying = false;
let latestRoofRiskApiPayload = null;
let latestRoofRiskHistoryPayload = null;
let liveRoofRiskApiPayload = null;
let replayRoofRiskApiPayload = null;
let replayRoofRiskFrame = null;
let replayDisplayActive = false;
let latestRoofRiskEventsPayload = {};
let replayController = null;
let replayMeta = null;

const DEMO_METRIC_KEYS = ['roofPressure', 'separation', 'subsidence', 'supportResistance', 'anchorLoad', 'microseismicEnergy'];

const ROOF_DEMO_SEQUENCE = [
  { id: 'normalMonitor', holdMs: 3200 },
  { id: 'roofPressureRise', holdMs: 5200 },
  { id: 'roofSeparationAlarm', holdMs: 5200 },
  { id: 'supportResistanceAlarm', holdMs: 5200 },
  { id: 'roofFallWarning', holdMs: 7200 },
  { id: 'emergencyResponse', holdMs: 6200 },
];

const ROOF_WARNING_META = {
  normalMonitor: {
    stage: '\u6b63\u5e38\u76d1\u6d4b',
    level: '\u7eff\u8272',
    className: '',
    score: 18,
    trigger: '\u9876\u677f\u79bb\u5c42 4 mm\uff0c\u5e94\u529b 17.5 MPa\uff0c\u652f\u67b6\u963b\u529b\u7a33\u5b9a\u3002',
    advice: '\u7ef4\u6301\u5e38\u89c4\u5de1\u68c0\uff0c\u8bb0\u5f55\u76d1\u6d4b\u57fa\u7ebf\uff0c\u4e91\u56fe\u4f5c\u4e3a\u6b63\u5e38\u72b6\u6001\u5bf9\u7167\u3002',
  },
  roofPressureRise: {
    stage: '\u9876\u677f\u538b\u529b\u5347\u9ad8',
    level: '\u84dd\u8272\u5173\u6ce8',
    className: 'level-blue',
    score: 42,
    trigger: '\u951a\u6746/\u951a\u7d22\u53d7\u529b\u62ac\u5347\uff0c\u5c40\u90e8\u5e94\u529b\u96c6\u4e2d\u533a\u5411\u5de5\u4f5c\u9762\u51fa\u53e3\u6269\u5c55\u3002',
    advice: '\u63d0\u9ad8\u91c7\u6837\u9891\u7387\uff0c\u6838\u67e5\u652f\u62a4\u53d7\u529b\u548c\u9876\u677f\u88c2\u9699\u53d1\u80b2\u60c5\u51b5\u3002',
  },
  roofSeparationAlarm: {
    stage: '\u79bb\u5c42\u5f02\u5e38',
    level: '\u9ec4\u8272\u9884\u8b66',
    className: 'level-yellow',
    score: 68,
    trigger: '\u9876\u677f\u79bb\u5c42\u4f4d\u79fb\u5feb\u901f\u589e\u957f\uff0c\u4f4d\u79fb\u573a\u70ed\u70b9\u4e0e\u5e94\u529b\u96c6\u4e2d\u533a\u91cd\u53e0\u3002',
    advice: '\u5b89\u6392\u73b0\u573a\u590d\u6838\uff0c\u9650\u5236\u65e0\u5173\u4eba\u5458\u8fdb\u5165\uff0c\u51c6\u5907\u52a0\u5f3a\u652f\u62a4\u63aa\u65bd\u3002',
  },
  supportResistanceAlarm: {
    stage: '\u652f\u67b6\u963b\u529b\u5f02\u5e38',
    level: '\u6a59\u8272\u9884\u8b66',
    className: 'level-orange',
    score: 76,
    trigger: '\u7b2c 3 \u67b6\u6db2\u538b\u652f\u67b6\u963b\u529b\u63a5\u8fd1\u9608\u503c\uff0c\u51fa\u53e3\u6bb5\u8f7d\u8377\u8f6c\u79fb\u660e\u663e\u3002',
    advice: '\u68c0\u67e5\u652f\u67b6\u521d\u6491\u529b\u548c\u59ff\u6001\uff0c\u8054\u52a8\u8c03\u67b6\uff0c\u5fc5\u8981\u65f6\u964d\u4f4e\u63a8\u8fdb\u901f\u5ea6\u3002',
  },
  roofFallWarning: {
    stage: '\u9876\u677f\u57ae\u843d\u9884\u8b66',
    level: '\u7ea2\u8272\u9884\u8b66',
    className: 'level-red',
    score: 92,
    trigger: '\u5e94\u529b\u573a\u4e0e\u4f4d\u79fb\u573a\u5cf0\u503c\u53e0\u52a0\uff0c\u5de5\u4f5c\u9762\u51fa\u53e3\u9876\u677f\u51fa\u73b0\u9ad8\u98ce\u9669\u95ed\u5408\u533a\u3002',
    advice: '\u7acb\u5373\u505c\u673a\u64a4\u4eba\uff0c\u5c01\u63a7\u5371\u9669\u533a\u57df\uff0c\u542f\u52a8\u9876\u677f\u707e\u53d8\u5e94\u6025\u5904\u7f6e\u6d41\u7a0b\u3002',
  },
  emergencyResponse: {
    stage: '\u5e94\u6025\u5904\u7f6e',
    level: '\u5904\u7f6e\u4e2d',
    className: 'level-orange',
    score: 61,
    trigger: '\u4eba\u5458\u64a4\u79bb\u3001\u8bbe\u5907\u505c\u673a\u3001\u5371\u9669\u533a\u57df\u5c01\u63a7\u540e\uff0c\u98ce\u9669\u6307\u6570\u56de\u843d\u3002',
    advice: '\u4fdd\u6301\u5c01\u63a7\uff0c\u7b49\u5f85\u73b0\u573a\u786e\u8ba4\u548c\u652f\u62a4\u52a0\u56fa\u5b8c\u6210\u540e\u518d\u89e3\u9664\u9884\u8b66\u3002',
  },
};

// ==================== 时间 ====================
function updateDateTime() {
  const now = new Date();
  document.getElementById('datetime').textContent = now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ==================== 设备列表 ====================
function renderEquipList() {
  const container = document.getElementById('equipList');
  if (!container) return;
  const faults = getEquipFaults();
  const summary = { total: EQUIPMENT.length, running: 0, maintain: 0, fault: 0, offline: 0 };
  const signatureParts = [];
  const rows = EQUIPMENT.map(e => {
    let status = e.status;
    let load = e.load === null ? '\u8ba1\u5212\u68c0\u4fee' : `${e.load.toFixed(1)}%`;
    if (faults[e.name]) {
      status = ['\u505c\u673a', '\u6545\u969c', '\u8fc7\u8f7d'].includes(faults[e.name]) ? 'fault' : 'maintain';
      load = faults[e.name];
    }
    summary[status] += 1;
    signatureParts.push(`${e.id}:${status}:${load}`);
    return `<div class="equip-row ${activeEquipmentId === e.id ? 'active' : ''}" data-equipment-id="${e.id}" title="${e.id} ? ${e.location}">
      <span class="equip-dot ${status}"></span>
      <span class="equip-name">${e.name}</span>
      <span class="equip-val">${load}</span>
    </div>`;
  });
  const nextSignature = `${activeEquipmentId ?? ''}|${signatureParts.join('|')}`;
  if (nextSignature === lastEquipmentListSignature) return;
  lastEquipmentListSignature = nextSignature;
  container.innerHTML = rows.join('');
  document.getElementById('equipmentTotal').textContent = `\u5171 ${summary.total} \u5957`;
  document.getElementById('equipmentRunning').textContent = summary.running;
  document.getElementById('equipmentFault').textContent = summary.fault;
  document.getElementById('equipmentMaintain').textContent = summary.maintain;
  document.getElementById('equipmentOffline').textContent = summary.offline;
}

function activateEquipmentRow(row) {
  if (!row) return;
  const equipmentId = row.dataset.equipmentId;
  const result = focusMineEquipment(equipmentId);
  if (!result) return;
  activeEquipmentId = equipmentId;
  document.querySelectorAll('.equip-row').forEach(item => item.classList.remove('active'));
  row.classList.add('active');
}

function setupEquipmentFocus() {
  const container = document.getElementById('equipList');
  if (!container) return;
  container.addEventListener('pointerdown', event => {
    const row = event.target.closest('.equip-row');
    if (!row) return;
    activateEquipmentRow(row);
  });
  container.addEventListener('click', event => {
    const row = event.target.closest('.equip-row');
    if (!row) return;
    activateEquipmentRow(row);
  });
}

// ==================== 安全预警 ====================
const DECISION_GUIDE = {
  normalMonitor: { badge: '\u5de1\u68c0', level: 'safe', stage: '\u6b63\u5e38\u76d1\u6d4b', basis: '\u9876\u677f\u538b\u529b\u3001\u79bb\u5c42\u91cf\u3001\u652f\u67b6\u5de5\u4f5c\u963b\u529b\u5747\u5904\u4e8e\u7a33\u5b9a\u533a\u95f4\u3002', decision: '\u4fdd\u6301\u81ea\u52a8\u5de1\u68c0\uff0c\u91cd\u70b9\u89c2\u5bdf\u8fd0\u8f93\u987a\u69fd 4m\u300110m\u300116m \u76d1\u6d4b\u70b9\u8d8b\u52bf\u3002', actions: ['\u6301\u7eed\u91c7\u96c6', '\u4fdd\u6301\u901a\u98ce', '\u6b63\u5e38\u63a8\u8fdb'] },
  roofPressureRise: { badge: '\u5173\u6ce8', level: 'warn', stage: '\u538b\u529b\u5347\u9ad8', basis: '\u9876\u677f\u538b\u529b\u63a5\u8fd1\u5173\u6ce8\u9608\u503c\uff0c\u652f\u67b6\u963b\u529b\u540c\u6b65\u62ac\u5347\u3002', decision: '\u964d\u4f4e\u91c7\u7164\u673a\u63a8\u8fdb\u901f\u5ea6\uff0c\u590d\u6838\u6db2\u538b\u652f\u67b6\u521d\u6491\u529b\u3002', actions: ['\u964d\u901f\u63a8\u8fdb', '\u590d\u6838\u652f\u67b6', '\u52a0\u5f3a\u5de1\u68c0'] },
  roofSeparationAlarm: { badge: '\u9884\u8b66', level: 'warn', stage: '\u79bb\u5c42\u5f02\u5e38', basis: '\u9876\u677f\u79bb\u5c42\u91cf\u8d85\u8fc7\u9884\u8b66\u9608\u503c\uff0c\u56f4\u5ca9\u7ed3\u6784\u7a33\u5b9a\u6027\u4e0b\u964d\u3002', decision: '\u6682\u505c\u5feb\u901f\u63a8\u8fdb\uff0c\u68c0\u67e5\u951a\u6746\u951a\u7d22\u53d7\u529b\u4e0e\u9876\u677f\u7834\u788e\u60c5\u51b5\u3002', actions: ['\u6838\u67e5\u79bb\u5c42\u4eea', '\u68c0\u67e5\u951a\u7d22', '\u51c6\u5907\u8865\u5f3a\u652f\u62a4'] },
  supportResistanceAlarm: { badge: '\u8054\u52a8', level: 'warn', stage: '\u652f\u67b6\u5f02\u5e38', basis: '\u6db2\u538b\u652f\u67b6\u5de5\u4f5c\u963b\u529b\u5f02\u5e38\u5347\u9ad8\uff0c\u51fa\u53e3\u652f\u62a4\u53d7\u538b\u660e\u663e\u3002', decision: '\u8054\u52a8\u91c7\u7164\u673a\u964d\u901f\u6216\u505c\u673a\u68c0\u67e5\uff0c\u8c03\u6574\u652f\u67b6\u59ff\u6001\u3002', actions: ['\u91c7\u7164\u673a\u964d\u901f', '\u652f\u67b6\u8c03\u538b', '\u51fa\u53e3\u5de1\u67e5'] },
  roofFallWarning: { badge: '\u7ea2\u8272', level: 'danger', stage: '\u57ae\u843d\u9884\u8b66', basis: '\u79bb\u5c42\u3001\u4e0b\u6c89\u3001\u652f\u67b6\u963b\u529b\u3001\u5fae\u9707\u80fd\u91cf\u591a\u6e90\u6307\u6807\u8026\u5408\u5f02\u5e38\u3002', decision: '\u7acb\u5373\u505c\u673a\u64a4\u4eba\uff0c\u5c01\u63a7\u5de5\u4f5c\u9762\u51fa\u53e3\u6bb5\uff0c\u7981\u6b62\u4eba\u5458\u8fdb\u5165\u9ad8\u98ce\u9669\u533a\u57df\u3002', actions: ['\u7acb\u5373\u505c\u673a', '\u4eba\u5458\u64a4\u79bb', '\u5c01\u63a7\u51fa\u53e3'] },
  emergencyResponse: { badge: '\u5904\u7f6e', level: 'danger', stage: '\u5e94\u6025\u5904\u7f6e', basis: '\u7cfb\u7edf\u5df2\u5b8c\u6210\u5371\u9669\u533a\u57df\u5b9a\u4f4d\uff0c\u8bbe\u5907\u5904\u4e8e\u505c\u673a\u5904\u7f6e\u72b6\u6001\u3002', decision: '\u6267\u884c\u64a4\u4eba\u3001\u65ad\u7535\u3001\u5c01\u63a7\u3001\u8865\u5f3a\u652f\u62a4\u548c\u6301\u7eed\u76d1\u6d4b\u3002', actions: ['\u65ad\u7535\u5c01\u63a7', '\u8865\u5f3a\u652f\u62a4', '\u6301\u7eed\u76d1\u6d4b'] },
};

function renderAlertList() {
  const container = document.getElementById('alertList');
  if (!container) return;

  const st = getState();
  const risk = latestRoofRiskApiPayload?.risk;
  const sourceTime = latestRoofRiskApiPayload?.provenance?.original_timestamp || latestRoofRiskApiPayload?.timestamp || '';
  const time = sourceTime.split(' ').at(-1) || '--';
  const apiLevel = risk?.level === 'red' || risk?.level === 'orange' ? 'mid' : risk?.level === 'yellow' ? 'warn' : 'low';
  let alerts = latestRoofRiskApiPayload ? [
    { time, msg: `${latestRoofRiskApiPayload.event_id || '--'} · ${risk?.stage || '正常监测'}`, level: apiLevel },
    { time: '', msg: risk?.explanation || '真实记录已进入持续监测。', level: apiLevel },
    { time: '', msg: `记录 ${latestRoofRiskApiPayload.provenance?.record_id || '--'} · 设备 ${latestRoofRiskApiPayload.provenance?.device_id || '--'}`, level: 'low' },
  ] : [];

  // 如果灾害活跃，在前面插入灾害告警
  if (st.active && st.alert) {
    const lvl = st.alert.level === 'danger' ? 'mid' : st.alert.level;
    alerts = [
      { time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), msg: st.alert.msg, level: lvl },
      { time: '', msg: `【${st.name}】阶段：${st.phaseName}`, level: lvl },
      ...alerts,
    ].slice(0, 7);
  }

  container.innerHTML = alerts.map(a => `
    <div class="alert-row ${a.level}">
      <span class="alert-time">${a.time}</span>
      <span class="alert-msg">${a.msg}</span>
      <span class="alert-lvl ${a.level}">${a.level === 'mid' ? '注意' : a.level === 'warn' ? '警告' : '正常'}</span>
    </div>
  `).join('') || '<p class="data-empty-state">真实预警数据暂不可用</p>';

  // 更新卡片badge
  const badge = document.querySelector('.card-badge');
  if (badge) {
    if (st.active && st.alert && st.alert.level === 'danger') {
      badge.textContent = '灾害进行中';
      badge.className = 'card-badge danger';
    } else if (st.active) {
      badge.textContent = '监测预警中';
      badge.className = 'card-badge warn';
    } else {
      badge.textContent = '无重大风险';
      badge.className = 'card-badge safe';
    }
  }
}

// ==================== 数据刷新（读取灾害模块） ====================
function renderDecisionPanel(values, riskScore) {
  const panel = document.getElementById('decisionPanel');
  const badge = document.getElementById('decisionBadge');
  if (!panel) return;

  const st = getState();
  const guide = st.active
    ? DECISION_GUIDE[st.type] ?? DECISION_GUIDE.normalMonitor
    : DECISION_GUIDE.normalMonitor;
  const level = st.active ? guide.level : (riskScore >= 80 ? 'danger' : riskScore >= 50 ? 'warn' : 'safe');
  const badgeText = st.active ? guide.badge : (level === 'safe' ? '巡检' : level === 'warn' ? '关注' : '红色');

  if (badge) {
    badge.textContent = badgeText;
    badge.className = `decision-badge ${level}`;
  }

  const actionClass = level === 'danger' ? 'danger' : level === 'warn' ? 'warn' : '';
  panel.innerHTML = `
    <div class="decision-stage">
      <strong>${guide.stage}</strong>
      <span>风险分 ${riskScore}</span>
    </div>
    <div class="decision-grid">
      <div class="decision-item ${actionClass}">
        <div class="decision-label">判定依据</div>
        <div class="decision-text">${guide.basis}</div>
      </div>
      <div class="decision-item ${actionClass}">
        <div class="decision-label">处置建议</div>
        <div class="decision-text">${guide.decision}</div>
      </div>
      <div class="decision-item ${actionClass}">
        <div class="decision-label">联动动作</div>
        <div class="decision-actions">
          ${guide.actions.map(action => `<span class="decision-action ${actionClass}">${action}</span>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderEnterpriseMetricSlots(viewModel, demoValues = null) {
  const slots = document.querySelectorAll('[data-metric-slot]');
  const defaultLabels = ['顶板离层速率', '锚杆轴力增量', '锚索轴力增量', '支架阻力', '涌水量', '微震能量', '距水体/岩溶体距离'];
  if (!slots.length) return;
  if (demoValues) {
    DEMO_METRIC_KEYS.forEach((key, index) => {
      const slot = slots[index];
      const metric = METRICS[key];
      const value = Number(demoValues[key]);
      if (!slot || !metric) return;
      slot.querySelector('.env-label').textContent = metric.label;
      const valueElement = slot.querySelector('.env-value');
      const precision = ['supportResistance', 'anchorLoad', 'microseismicEnergy'].includes(key) ? 0 : 1;
      valueElement.textContent = Number.isFinite(value) ? `${value.toFixed(precision)} ${metric.unit}` : '--';
      valueElement.className = `env-value ${Number.isFinite(value) ? getMetricLevel(key, value) : 'safe'}`;
      slot.dataset.status = Number.isFinite(value) ? getMetricLevel(key, value) : 'safe';
      const ratio = Number.isFinite(value)
        ? Math.max(0, Math.min(100, (value - metric.normal[0]) / (metric.danger - metric.normal[0]) * 100))
        : 0;
      slot.querySelector('.env-bar i').style.width = `${ratio}%`;
      const state = slot.querySelector('.env-state');
      if (state) state.textContent = Number.isFinite(value) ? '灾变阶段演示' : '等待数据';
      let reference = slot.querySelector('.env-reference');
      if (!reference) {
        reference = document.createElement('span');
        reference.className = 'env-reference';
        slot.querySelector('.env-bar').before(reference);
      }
      reference.textContent = '灾变过程演示值';
    });
    const uncovered = slots[6];
    if (uncovered) {
      uncovered.querySelector('.env-value').textContent = '--';
      uncovered.querySelector('.env-bar i').style.width = '0%';
      uncovered.querySelector('.env-reference').textContent = '当前演示不改变真实记录';
    }
    return;
  }

  const metrics = viewModel.available ? viewModel.metrics.filter(metric => metric.key !== 'data_quality').slice(0, 7) : [];
  slots.forEach((slot, index) => {
    const metric = metrics[index];
    slot.querySelector('.env-label').textContent = metric?.label || defaultLabels[index];
    const valueElement = slot.querySelector('.env-value');
    valueElement.textContent = metric?.text || '--';
    valueElement.className = `env-value ${metric?.status || 'safe'}`;
    slot.dataset.status = metric?.status || 'safe';
    slot.dataset.referenceDirection = metric?.referenceDirection || 'high';
    slot.dataset.referenceDeviation = metric?.isReferenceDeviation ? 'true' : 'false';
    slot.id = metric?.key ? `metric-${metric.key}` : '';
    slot.querySelector('.env-bar i').style.width = `${metric?.percent ?? 0}%`;
    let reference = slot.querySelector('.env-reference');
    if (!reference) {
      reference = document.createElement('span');
      reference.className = 'env-reference';
      slot.querySelector('.env-bar').before(reference);
    }
    reference.textContent = Number.isFinite(metric?.p05) && Number.isFinite(metric?.p95)
      ? `P05 ${metric.p05} · P95 ${metric.p95} ${metric.unit || ''}`
      : '参考范围不可用';
    const state = slot.querySelector('.env-state');
    if (state) {
      state.textContent = !metric?.referenceAvailable
        ? '参考不可用'
        : metric.isReferenceDeviation
          ? `${metric.referenceDeviationSide === 'low' ? '低侧' : '高侧'}统计偏离`
          : metric.isModelEvidence
            ? '模型证据'
            : '参考范围内';
    }
  });

  setText('currentModelLevel', viewModel.available ? viewModel.model.predictedClass : '--');
  setText('currentModelConfidence', viewModel.available ? viewModel.model.confidenceText : '--');
  setText('currentLabelAgreement', viewModel.available ? viewModel.model.labelAgreement : '等待真实数据');
  setText('modelEvidenceCount', viewModel.available ? `${viewModel.model.evidenceCount ?? 0} 项` : '--');
  setText('thresholdExceededCount', viewModel.available ? `${metrics.filter((metric) => metric.isReferenceDeviation).length} 项` : '--');
  const attention = document.getElementById('enterpriseAttentionSummary');
  if (attention) {
    const noteworthy = metrics.filter((metric) => metric.isModelEvidence || metric.isReferenceDeviation);
    const title = document.createElement('strong');
    title.textContent = '重点关注';
    const list = document.createElement('div');
    if (!viewModel.available) {
      const message = document.createElement('span');
      message.textContent = viewModel.message || '真实数据暂不可用';
      list.append(message);
    } else if (!noteworthy.length) {
      const normal = document.createElement('span');
      normal.textContent = '当前记录未发现模型关注项或统计偏离';
      list.append(normal);
    } else {
      noteworthy.forEach((metric) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = metric.status === 'danger' ? 'danger' : 'warning';
        const evidenceLabel = metric.isModelEvidence && metric.isReferenceDeviation
          ? `模型证据 / ${metric.referenceDeviationSide === 'low' ? '低侧' : '高侧'}统计偏离`
          : metric.isModelEvidence
            ? '模型证据'
            : `${metric.referenceDeviationSide === 'low' ? '低侧' : '高侧'}统计偏离`;
        button.textContent = `${metric.label} · ${evidenceLabel}`;
        button.addEventListener('click', () => document.getElementById(`metric-${metric.key}`)?.scrollIntoView({ block: 'center' }));
        list.append(button);
      });
    }
    attention.replaceChildren(title, list);
  }
}

function renderExpertModel(viewModel) {
  const factorList = document.getElementById('expertFactorList');
  const auditState = document.getElementById('expertAuditState');
  setText('expertConfidence', viewModel.model.confidenceText);
  setText('expertInputStatus', viewModel.available ? '8 项真实输入' : viewModel.message);
  setText('expertModelStatus', viewModel.available ? `${viewModel.model.name} · 准确率 ${viewModel.model.accuracyText}` : '--');
  if (auditState) {
    auditState.textContent = viewModel.model.labelAgreement;
    auditState.className = `model-audit-state ${viewModel.model.auditState}`;
  }
  if (factorList) {
    factorList.innerHTML = viewModel.available
      ? viewModel.metrics.map(metric => `<p><span>${metric.label}</span><b>${metric.text}</b><i style="width:${metric.percent ?? 0}%"></i></p>`).join('')
      : `<p class="data-empty-state">${viewModel.message}</p>`;
  }
  setText('apiRecordId', viewModel.provenance.recordId);
  setText('apiRecordTime', viewModel.provenance.timestamp);
  setText('apiSourceHash', viewModel.provenance.hashShort);
  setText('apiModelAccuracy', viewModel.model.accuracyText);
}

function renderReplayEvents(meta) {
  const track = document.getElementById('replayEventTrack');
  if (!track) return;
  const levelLabel = { green: '低风险', yellow: '一般风险', orange: '较大风险', red: '重大风险' };
  track.innerHTML = (meta.event_markers || []).map((marker) => `
    <button class="replay-event ${marker.risk_level}" type="button" data-replay-index="${marker.index}">
      <i></i>
      <span><strong>${levelLabel[marker.risk_level] || marker.stage}</strong><small>${marker.timestamp}</small></span>
      <b>#${Number(marker.index) + 1}</b>
    </button>
  `).join('');
  track.querySelectorAll('[data-replay-index]').forEach((button) => {
    button.addEventListener('click', () => {
      activateReplayDisplay();
      replayController?.seek(Number(button.dataset.replayIndex));
    });
  });
}

function renderReplayControllerState(state) {
  const status = document.getElementById('replayStatus');
  const playPause = document.getElementById('replayPlayPause');
  const labels = {
    idle: '准备回放',
    playing: '历史回放中',
    paused: '回放已暂停',
    ended: '已到数据末尾',
    error: '回放中断',
  };
  if (status) {
    status.textContent = state.error || labels[state.status] || '历史回放';
    status.className = state.status;
  }
  if (playPause) {
    const playing = state.status === 'playing';
    playPause.textContent = playing ? '❚❚' : '▶';
    playPause.setAttribute('aria-label', playing ? '暂停历史数据回放' : '播放历史数据');
    playPause.title = playing ? '暂停历史数据回放' : '播放历史数据';
  }
  document.querySelectorAll('[data-replay-speed]').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.replaySpeed) === state.speed);
  });
  const loop = document.getElementById('replayLoop');
  if (loop) loop.checked = state.loop;
  const previous = document.getElementById('replayPrevious');
  const next = document.getElementById('replayNext');
  if (previous) previous.disabled = state.index <= 0;
  if (next) next.disabled = state.index >= (replayMeta?.total || 1) - 1 && !state.loop;
}

function applyReplayFrame(frame) {
  const payload = frame.current;
  const viewModel = mapRoofRiskViewModel(payload);
  replayRoofRiskApiPayload = payload;
  replayRoofRiskFrame = frame;

  setText('replayIndex', `${frame.index + 1} / ${new Intl.NumberFormat('zh-CN').format(frame.total)}`);
  setText('replayRecordId', viewModel.provenance.recordId);
  setText('replayTimestamp', viewModel.provenance.timestamp);
  setText('replayDevice', `设备 ${viewModel.provenance.deviceId}`);
  setText('replayRisk', `${payload.risk?.score ?? '--'} · ${formatRiskLevel(payload.risk?.level)}`);
  setText('replayRiskStage', payload.risk?.stage || '--');
  setText('replayPrediction', payload.model_output?.predicted_class || '--');
  setText('replayConfidence', Number.isFinite(Number(payload.model_output?.confidence))
    ? `置信度 ${(Number(payload.model_output.confidence) * 100).toFixed(2)}%`
    : '置信度 --');
  setText('replaySourceHash', viewModel.provenance.hashShort);
  setText('replayTrueClass', payload.model_output?.true_class || '--');
  setText('replayPredictedClass', payload.model_output?.predicted_class || '--');
  if (replayDisplayActive) {
    setText('diagnosisModeBadge', `历史记录 · #${frame.index + 1}`);
    setText('diagnosisRecordContext', viewModel.provenance.recordId);
    setText('replaySyncText', `当前诊断已同步至第 ${new Intl.NumberFormat('zh-CN').format(frame.index + 1)} 条 · ${viewModel.provenance.recordId}`);
  }
  const returnLive = document.getElementById('replayReturnLive');
  if (returnLive) returnLive.disabled = !replayDisplayActive;

  const seek = document.getElementById('replaySeek');
  if (seek) seek.value = String(frame.index);
  const workbench = document.getElementById('replayWorkbench');
  if (workbench) {
    workbench.dataset.recordId = viewModel.provenance.recordId;
    workbench.dataset.riskLevel = payload.risk?.level || 'green';
  }
  document.querySelectorAll('[data-replay-index]').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.replayIndex) === frame.index);
  });

  updateReplayChart({ current: payload, history: frame.history });
  if (replayDisplayActive) {
    latestRoofRiskApiPayload = replayRoofRiskApiPayload;
    setText('enterpriseSourceName', payload.provenance?.source_name || 'teacher_roof_monitoring.csv');
    setText('enterpriseRecordId', viewModel.provenance.recordId);
    setText('enterpriseRecordTime', viewModel.provenance.timestamp);
    setText('enterpriseDeviceId', viewModel.provenance.deviceId);
    setText('enterpriseSourceHash', viewModel.provenance.hashShort);
    renderEnterpriseMetricSlots(viewModel);
    showRoofWarningPanelFromApi(payload);
    renderApiDecisionPanel(payload);
    updateRoofRiskCharts({ current: payload, history: frame.history, events: latestRoofRiskEventsPayload });
  }

}

function activateReplayDisplay() {
  if (replayDisplayActive) return;
  replayDisplayActive = true;
  document.body.dataset.roofDataMode = 'replay';
  if (replayRoofRiskFrame) applyReplayFrame(replayRoofRiskFrame);
}

async function deactivateReplayDisplay() {
  if (!replayDisplayActive) return;
  replayController?.pause();
  replayDisplayActive = false;
  document.body.dataset.roofDataMode = 'live';
  setText('diagnosisModeBadge', '实时记录');
  setText('replaySyncText', '已返回实时记录，历史回放保持暂停');
  const returnLive = document.getElementById('replayReturnLive');
  if (returnLive) returnLive.disabled = true;
  await refreshRoofRiskApiStatus();
}

async function loadReplayFrame(index) {
  const response = await authFetch(`/api/roof-risk/replay/frame?index=${index}&window=72`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`回放接口异常 HTTP ${response.status}`);
  return response.json();
}

async function initReplayWorkbench() {
  const workbench = document.getElementById('replayWorkbench');
  if (!workbench) return;
  try {
    const response = await authFetch('/api/roof-risk/replay/meta', { cache: 'no-store' });
    if (!response.ok) throw new Error(`回放元数据异常 HTTP ${response.status}`);
    replayMeta = await response.json();
    setText('replayStartTime', replayMeta.start_timestamp || '数据起点');
    setText('replayEndTime', replayMeta.end_timestamp || '数据终点');
    const seek = document.getElementById('replaySeek');
    seek.max = String(replayMeta.total - 1);
    seek.value = String(replayMeta.default_index);
    renderReplayEvents(replayMeta);

    replayController = createReplayController({
      total: replayMeta.total,
      initialIndex: replayMeta.default_index,
      intervalMs: 900,
      loadFrame: loadReplayFrame,
      onFrame: applyReplayFrame,
      onState: renderReplayControllerState,
    });
    document.getElementById('replayPrevious')?.addEventListener('click', () => {
      activateReplayDisplay();
      replayController.previous();
    });
    document.getElementById('replayNext')?.addEventListener('click', () => {
      activateReplayDisplay();
      replayController.next();
    });
    document.getElementById('replayPlayPause')?.addEventListener('click', () => {
      if (replayController.snapshot().status === 'playing') replayController.pause();
      else {
        activateReplayDisplay();
        replayController.play();
      }
    });
    seek.addEventListener('change', () => {
      activateReplayDisplay();
      replayController.seek(Number(seek.value));
    });
    document.querySelectorAll('[data-replay-speed]').forEach((button) => {
      button.addEventListener('click', () => replayController.setSpeed(Number(button.dataset.replaySpeed)));
    });
    document.getElementById('replayLoop')?.addEventListener('change', (event) => replayController.setLoop(event.target.checked));
    document.getElementById('replayViewDiagnosis')?.addEventListener('click', () => {
      document.getElementById('enterpriseCoreMonitoring')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('replayReturnLive')?.addEventListener('click', deactivateReplayDisplay);

    await replayController.seek(replayMeta.default_index);
  } catch (error) {
    renderReplayControllerState({ status: 'error', index: 0, speed: 1, loop: false, error: error.message });
  }
}

function stageIdFromApiRisk(risk = {}) {
  if (risk.level === 'red') return 'roofFallWarning';
  if (risk.level === 'orange') return 'supportResistanceAlarm';
  if (risk.level === 'yellow') return 'roofSeparationAlarm';
  if (risk.level === 'attention') return 'roofPressureRise';
  return 'normalMonitor';
}

function showRoofWarningPanelFromApi(payload) {
  const risk = payload?.risk || {};
  const card = document.getElementById('roofWarningCard');
  if (!card) return;
  card.classList.remove('level-blue', 'level-yellow', 'level-orange', 'level-red');
  const levelClass = {
    red: 'level-red',
    orange: 'level-orange',
    yellow: 'level-yellow',
    attention: 'level-blue',
  }[risk.level];
  if (levelClass) card.classList.add(levelClass);
  setText('roofWarningStage', risk.stage || '正常监测');
  setText('roofWarningLevel', formatRiskLevel(risk.level));
  setText('roofWarningScore', risk.score ?? '--');
  const triggerText = Array.isArray(risk.trigger) ? risk.trigger.map(formatTriggerName).join('、') : '多源指标';
  setText('roofWarningTrigger', triggerText);
  setText('roofWarningAdvice', risk.explanation || payload?.closed_loop?.command || '保持自动巡检，持续观察顶板监测趋势。');
}

function renderApiDecisionPanel(payload) {
  const panel = document.getElementById('decisionPanel');
  const badge = document.getElementById('decisionBadge');
  if (!panel) return;
  const risk = payload?.risk || {};
  const score = Number(risk.score) || 0;
  const level = score >= 80 ? 'danger' : score >= 50 ? 'warn' : 'safe';
  const badgeText = risk.level === 'red' ? '红色' : risk.level === 'orange' ? '联动' : risk.level === 'yellow' ? '关注' : '巡检';
  const actionClass = level === 'danger' ? 'danger' : level === 'warn' ? 'warn' : '';
  if (badge) {
    badge.textContent = badgeText;
    badge.className = `decision-badge ${level}`;
  }
  const actions = Array.isArray(payload?.disposal?.actions) && payload.disposal.actions.length
    ? payload.disposal.actions
    : ['持续采集', '现场复核', '闭环跟踪'];
  panel.innerHTML = `
    <div class="decision-stage">
      <strong>${risk.stage || '正常监测'}</strong>
      <span>风险分 ${risk.score ?? '--'}</span>
    </div>
    <div class="decision-grid">
      <div class="decision-item ${actionClass}">
        <div class="decision-label">判定依据</div>
        <div class="decision-text">${risk.explanation || '多源指标处于可控区间。'}</div>
      </div>
      <div class="decision-item ${actionClass}">
        <div class="decision-label">处置建议</div>
        <div class="decision-text">${payload?.closed_loop?.command || '保持自动巡检，持续观察顶板监测点趋势。'}</div>
      </div>
      <div class="decision-item ${actionClass}">
        <div class="decision-label">联动动作</div>
        <div class="decision-actions">
          ${actions.map(action => `<span class="decision-action ${actionClass}">${action}</span>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderUnavailableRiskPanels() {
  const card = document.getElementById('roofWarningCard');
  if (card) card.classList.remove('level-blue', 'level-yellow', 'level-orange', 'level-red');
  setText('roofWarningStage', '真实数据不可用');
  setText('roofWarningLevel', '--');
  setText('roofWarningScore', '--');
  setText('roofWarningTrigger', '--');
  setText('roofWarningAdvice', '真实数据接口暂不可用，请检查 RoofRisk API 服务。');
  const badge = document.getElementById('decisionBadge');
  if (badge) {
    badge.textContent = '离线';
    badge.className = 'decision-badge warn';
  }
  const panel = document.getElementById('decisionPanel');
  if (panel) panel.innerHTML = '<p class="data-empty-state">真实数据接口暂不可用，当前未生成模型研判与处置建议。</p>';
}

function renderStageClosedLoop(stageId = 'normalMonitor') {
  const meta = ROOF_WARNING_META[stageId] ?? ROOF_WARNING_META.normalMonitor;
  const stageIndex = ROOF_DEMO_SEQUENCE.findIndex(item => item.id === stageId);
  const progress = Math.max(12, Math.round(((stageIndex >= 0 ? stageIndex + 1 : 1) / ROOF_DEMO_SEQUENCE.length) * 100));
  const stageLoopMeta = {
    normalMonitor: {
      status: '巡检中',
      event: 'DEMO-ROOF-000',
      step: '企业端识别',
      next: '建立正常监测基线，持续采集顶板应力和位移数据。',
      statuses: ['active', 'pending', 'pending', 'pending', 'pending'],
    },
    roofPressureRise: {
      status: '关注中',
      event: 'DEMO-ROOF-001',
      step: '企业端识别',
      next: '顶板压力抬升，提升采样频率并复核支护状态。',
      statuses: ['active', 'pending', 'pending', 'pending', 'pending'],
    },
    roofSeparationAlarm: {
      status: '预警中',
      event: 'DEMO-ROOF-002',
      step: '现场复核',
      next: '离层异常扩大，现场复核锚索载荷和围岩变形。',
      statuses: ['done', 'active', 'pending', 'pending', 'pending'],
    },
    supportResistanceAlarm: {
      status: '复核中',
      event: 'DEMO-ROOF-003',
      step: '监管督办',
      next: '支架阻力异常，联动降速、调架并提交复测记录。',
      statuses: ['done', 'done', 'active', 'pending', 'pending'],
    },
    roofFallWarning: {
      status: '处置中',
      event: 'DEMO-ROOF-004',
      step: '现场处置',
      next: '红色预警触发，立即停机撤人并封控高风险区域。',
      statuses: ['done', 'active', 'active', 'done', 'pending'],
    },
    emergencyResponse: {
      status: '应急中',
      event: 'DEMO-ROOF-005',
      step: '应急处置',
      next: '执行撤人、断电、封控和补强支护，等待复盘归档。',
      statuses: ['done', 'done', 'active', 'done', 'pending'],
    },
  }[stageId] ?? {};
  const steps = [
    { label: '企业端识别', status: stageLoopMeta.statuses?.[0] ?? 'pending', detail: '多源监测指标进入当前演示阶段。' },
    { label: '现场处置', status: stageLoopMeta.statuses?.[1] ?? 'pending', detail: meta.advice },
    { label: '监管督办', status: stageLoopMeta.statuses?.[2] ?? 'pending', detail: '监管端按预警等级核验处置反馈。' },
    { label: '模型复核', status: stageLoopMeta.statuses?.[3] ?? 'pending', detail: meta.trigger },
    { label: '闭环归档', status: stageLoopMeta.statuses?.[4] ?? 'pending', detail: '风险降级并完成复核后归档。' },
  ];
  setText('enterpriseLoopStatus', stageLoopMeta.status || meta.level);
  setText('enterpriseLoopEvent', stageLoopMeta.event || `DEMO-${stageId}`);
  setText('enterpriseLoopStep', stageLoopMeta.step || meta.stage);
  setText('enterpriseLoopProgress', `${progress}%`);
  setText('enterpriseLoopNext', stageLoopMeta.next || meta.advice);
  renderClosedLoopTrack('enterpriseLoopTrack', steps);
}

function refreshData() {
  const mine = getMineState();
  const disasterValues = getEnvData();
  const roofMetricKeys = DEMO_METRIC_KEYS;
  const activeRoofValues = Object.fromEntries(
    roofMetricKeys
      .filter(key => Number.isFinite(disasterValues[key]))
      .map(key => [key, disasterValues[key]])
  );
  const values = isActive()
    ? { ...mine.metrics, ...activeRoofValues }
    : mine.metrics;
  const viewModel = latestRoofRiskApiPayload
    ? mapRoofRiskViewModel(latestRoofRiskApiPayload)
    : unavailableRoofRiskViewModel();
  renderEnterpriseMetricSlots(viewModel, isActive() ? values : null);
  renderExpertModel(viewModel);

  const activeStageId = getState().type;
  const apiRiskScore = Number(latestRoofRiskApiPayload?.risk?.score);
  const roofRiskScore = isActive()
    ? (ROOF_WARNING_META[activeStageId]?.score ?? calcRoofRiskScore(values))
    : Number.isFinite(apiRiskScore)
      ? apiRiskScore
    : 0;
  const roofRiskLevel = roofRiskScore >= 80 ? 'danger' : roofRiskScore >= 50 ? 'warn' : 'safe';
  document.getElementById('riskScore').textContent = isActive() || latestRoofRiskApiPayload ? roofRiskScore : '--';
  document.getElementById('riskScore').className = `prod-num ${roofRiskLevel}`;
  if (!isActive() && latestRoofRiskApiPayload) {
    showRoofWarningPanelFromApi(latestRoofRiskApiPayload);
    renderApiDecisionPanel(latestRoofRiskApiPayload);
  } else if (isActive()) {
    showRoofWarningPanel(activeStageId ?? 'normalMonitor', roofRiskScore);
    renderDecisionPanel(values, roofRiskScore);
    renderStageClosedLoop(activeStageId ?? 'normalMonitor');
  } else {
    renderUnavailableRiskPanels();
  }
  const v2SensorCount = window.__mineDiagnostics?.validation?.counts?.roofSensors;
  const monitorCount = Number.isFinite(v2SensorCount) ? v2SensorCount : mine.monitorPoints.length;
  const completeness = Number.isFinite(v2SensorCount)
    ? 100
    : Math.round(mine.monitorPoints.filter(point => values[point.metric] !== undefined).length / mine.monitorPoints.length * 100);
  document.getElementById('monitorCount').innerHTML = `${monitorCount}<span>个</span>`;
  document.getElementById('dataCompleteness').innerHTML = `${completeness}<span>%</span>`;
  const simulationNote = document.getElementById('simulationNote');
  if (simulationNote && Number(simulationNote.dataset.focusUntil ?? 0) < Date.now()) {
    simulationNote.textContent = isActive()
      ? mine.simulationNote
      : viewModel.available
        ? `${viewModel.provenance.source} · 记录 ${viewModel.provenance.recordId}`
        : viewModel.message;
  }

  // 设备列表
  renderEquipList();

  // 告警列表
  renderAlertList();
}

function calcRoofRiskScore(values) {
  const ratio = key => {
    const metric = METRICS[key];
    return Math.max(0, Math.min(1, (values[key] - metric.normal[0]) / (metric.danger - metric.normal[0])));
  };
  return Math.round((
    ratio('roofPressure') * 0.26 +
    ratio('separation') * 0.24 +
    ratio('subsidence') * 0.16 +
    ratio('supportResistance') * 0.16 +
    ratio('anchorLoad') * 0.10 +
    ratio('microseismicEnergy') * 0.08
  ) * 100);
}

function updateMetric(id, key, value, precision) {
  const metric = METRICS[key];
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = `${value.toFixed(precision)} ${metric.unit}`;
  el.className = `env-value ${getMetricLevel(key, value)}`;
}

function setActiveDisasterButton(stageId) {
  const panel = document.getElementById('disasterPanel');
  if (!panel) return;
  panel.querySelectorAll('.disaster-btn').forEach(btn => btn.classList.remove('active'));
  const stageBtn = panel.querySelector(`.disaster-btn[data-id="${stageId}"]`);
  if (stageBtn) stageBtn.classList.add('active');
  const demoBtn = document.getElementById('roofFullDemoBtn');
  if (demoBtn && roofDemoPlaying) demoBtn.classList.add('active', 'playing');
}

function updateRoofDemoButton() {
  const demoBtn = document.getElementById('roofFullDemoBtn');
  if (!demoBtn) return;
  if (roofDemoPlaying) {
    const current = ROOF_DEMO_SEQUENCE[roofDemoIndex];
    const disaster = getDisasterList().find(item => item.id === current?.id);
    demoBtn.textContent = `演示进行中：${disaster?.name ?? '顶板预警'}`;
    demoBtn.classList.add('playing');
  } else {
    demoBtn.textContent = '开始顶板灾变全过程演示';
    demoBtn.classList.remove('playing', 'active');
  }
}

function showRoofWarningPanel(stageId = 'normalMonitor', scoreOverride = null) {
  const meta = ROOF_WARNING_META[stageId] ?? ROOF_WARNING_META.normalMonitor;
  const card = document.getElementById('roofWarningCard');
  if (!card) return;
  card.classList.remove('level-blue', 'level-yellow', 'level-orange', 'level-red');
  if (meta.className) card.classList.add(meta.className);
  const stageEl = document.getElementById('roofWarningStage');
  const levelEl = document.getElementById('roofWarningLevel');
  const scoreEl = document.getElementById('roofWarningScore');
  const triggerEl = document.getElementById('roofWarningTrigger');
  const adviceEl = document.getElementById('roofWarningAdvice');
  if (stageEl) stageEl.textContent = meta.stage;
  if (levelEl) levelEl.textContent = meta.level;
  if (scoreEl) scoreEl.textContent = String(scoreOverride ?? meta.score);
  if (triggerEl) triggerEl.textContent = meta.trigger;
  if (adviceEl) adviceEl.textContent = meta.advice;
}

function stopRoofDemo(options = {}) {
  if (roofDemoTimer) {
    clearTimeout(roofDemoTimer);
    roofDemoTimer = null;
  }
  roofDemoPlaying = false;
  roofDemoIndex = -1;
  updateRoofDemoButton();
  if (options.clearStageActive) {
    document.querySelectorAll('#disasterPanel .disaster-btn').forEach(btn => btn.classList.remove('active'));
  }
}

async function restoreSelectedRealEvent() {
  resetDisaster();
  await refreshRoofRiskApiStatus();
  refreshData();
}

function playRoofDemoStep(index = 0) {
  if (!roofDemoPlaying) return;
  if (index >= ROOF_DEMO_SEQUENCE.length) {
    roofDemoPlaying = false;
    roofDemoIndex = ROOF_DEMO_SEQUENCE.length - 1;
    updateRoofDemoButton();
    restoreSelectedRealEvent();
    return;
  }
  roofDemoIndex = index;
  const item = ROOF_DEMO_SEQUENCE[index];
  startDisaster(item.id);
  focusRoofWarningStage(item.id);
  setActiveDisasterButton(item.id);
  showRoofWarningPanel(item.id);
  updateRoofDemoButton();
  refreshData();
  roofDemoTimer = setTimeout(() => playRoofDemoStep(index + 1), item.holdMs);
}

function startRoofDemo() {
  stopRoofDemo();
  resetDisaster();
  roofDemoPlaying = true;
  playRoofDemoStep(0);
}

window.__roofDemoStage = stageId => {
  stopRoofDemo();
  const currentState = getState();
  if (!currentState.active || currentState.type !== stageId) {
    resetDisaster();
    startDisaster(stageId);
  }
  const focusResult = focusRoofWarningStage(stageId);
  setActiveDisasterButton(stageId);
  showRoofWarningPanel(stageId);
  refreshData();
  return { state: getState(), focusResult };
};

function applyInitialStageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const stageId = params.get('stage');
  if (!stageId) return;
  let attempts = 0;
  let focusHits = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const result = window.__roofDemoStage(stageId);
    focusHits = result?.focusResult ? focusHits + 1 : 0;
    if (focusHits >= 3 || attempts >= 60) clearInterval(timer);
  }, 600);
}

// ==================== 灾害控制面板 ====================
function setupDisasterPanel() {
  const panel = document.getElementById('disasterPanel');
  if (!panel) return;

  const disasters = getDisasterList();
  const stageCodes = {
    normalMonitor: '01',
    roofPressureRise: '02',
    roofSeparationAlarm: '03',
    supportResistanceAlarm: '04',
    roofFallWarning: '05',
    emergencyResponse: '06',
  };
  panel.innerHTML = `
    <button class="disaster-btn demo-btn" id="roofFullDemoBtn" title="自动播放顶板灾变从正常监测到应急处置的完整闭环">
      开始顶板灾变全过程演示
    </button>
  ` + disasters.map(d => `
    <button class="disaster-btn" data-id="${d.id}" title="${d.desc}">
      <span class="stage-code" aria-hidden="true">${stageCodes[d.id] ?? '--'}</span>
      ${d.name}
    </button>
  `).join('') + `
    <button class="disaster-btn reset-btn" id="resetDisasterBtn">复位演示</button>
  `;

  // 绑定点击
  const demoBtn = document.getElementById('roofFullDemoBtn');
  if (demoBtn) {
    demoBtn.addEventListener('click', () => {
      startRoofDemo();
    });
  }

  panel.querySelectorAll('.disaster-btn[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      stopRoofDemo();
      if (isActive()) {
        if (!confirm('当前有灾害正在模拟，是否切换？')) return;
      }
      startDisaster(btn.dataset.id);
      focusRoofWarningStage(btn.dataset.id);
      showRoofWarningPanel(btn.dataset.id);
      // 高亮当前按钮
      setActiveDisasterButton(btn.dataset.id);
    });
  });

  // 重置按钮
  const resetBtn = document.getElementById('resetDisasterBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      stopRoofDemo();
      panel.querySelectorAll('.disaster-btn').forEach(b => b.classList.remove('active'));
      await restoreSelectedRealEvent();
    });
  }
}

function setupRoofFieldControls() {
  const panel = document.getElementById('roofFieldControls');
  if (!panel) return;

  const applyRoofFieldMode = mode => {
    if (!setRoofFieldMode(mode)) return false;
    panel.querySelectorAll('[data-field-mode]').forEach(item => item.classList.toggle('active', item.dataset.fieldMode === mode));
    const title = document.getElementById('roofFieldLegendTitle');
    const range = document.getElementById('roofFieldLegendRange');
    if (title && range) {
      const roofFieldMeta = {
        stress: ['顶板应力场', '14 → 38 MPa'],
        displacement: ['顶板位移场', '4 → 46 mm'],
        risk: ['综合风险场', '0 → 100'],
      }[mode] ?? ['综合风险场', '0 → 100'];
      title.textContent = roofFieldMeta[0];
      range.textContent = roofFieldMeta[1];
    }
    return true;
  };

  panel.querySelectorAll('[data-field-mode]').forEach(button => {
    button.addEventListener('click', () => {
      applyRoofFieldMode(button.dataset.fieldMode);
    });
  });

  const initialMode = new URLSearchParams(window.location.search).get('field');
  if (initialMode) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (applyRoofFieldMode(initialMode) || attempts >= 20) clearInterval(timer);
    }, 300);
  }
}

function normalizeDataSourceLabel(source) {
  const labels = {
    teacher_real_csv_xgboost: '老师提供的真实监测数据 · XGBoost',
    standardized_simulated_multisource: '标准化模拟多源数据',
    database: '数据库实时数据',
    hardware_gateway: '井下网关实时数据',
    model_service: '模型服务输出',
  };
  return labels[source] ?? source ?? '未配置';
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value ?? '--';
}

function formatLoopStatus(status) {
  const labels = {
    done: '已完成',
    active: '进行中',
    pending: '待处理',
  };
  return labels[status] ?? status ?? '--';
}

function formatTriggerName(trigger) {
  const labels = {
    roof_separation_rate: '顶板离层速率',
    bolt_axial_force_increment: '锚杆轴力增量',
    cable_axial_force_increment: '锚索轴力增量',
    water_inflow: '涌水量',
    distance_to_water: '距水体/岩溶体距离',
    data_quality: '数据质量',
    stress: '顶板应力',
    roof_stress: '顶板应力',
    displacement: '顶板位移',
    separation: '顶板离层量',
    subsidence: '顶板下沉量',
    support: '支护状态',
    support_resistance: '支架工作阻力',
    microseismic: '微震能量',
    microseismic_energy: '微震能量',
  };
  return labels[trigger] ?? trigger;
}

function formatRiskLevel(level) {
  const labels = {
    red: '红色预警',
    orange: '橙色预警',
    yellow: '黄色关注',
    green: '正常巡检',
  };
  return labels[level] ?? level ?? '--';
}

function statusText(status) {
  const labels = {
    processing: '处置中',
    confirmed: '复核中',
    watching: '关注中',
    closed: '已闭环',
  };
  return labels[status] ?? status ?? '--';
}

function renderClosedLoopTrack(containerId, steps = []) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = steps.map(step => `
    <div class="loop-step ${step.status || 'pending'}" title="${step.detail || ''}">
      <b>${step.label || '--'}</b>
      <span>${formatLoopStatus(step.status)}</span>
    </div>
  `).join('');
}

function renderClosedLoopFlow(containerId, steps = []) {
  const container = document.getElementById(containerId);
  if (!container || !steps.length) return;
  container.innerHTML = steps.slice(0, 4).map((step, index, list) => {
    const node = `<span class="${step.status || 'pending'}" title="${step.detail || ''}">${step.label || '--'}</span>`;
    return index < list.length - 1 ? `${node}<i></i>` : node;
  }).join('');
}

let regulatorEvents = [];
let selectedRegulatorEventId = null;

function enrichRegulatorEvents(events = []) {
  return events;
}

function renderRegulatorRiskOverview(events = []) {
  const list = document.getElementById('regulatorMineRiskList');
  const priorityCount = events.filter(event => ['red', 'orange'].includes(event.risk_level)).length;
  setText('regulatorPriorityCount', events.length ? priorityCount : '--');
  setText('regulatorOverviewCount', events.length ? `${events.length} 条真实代表事件` : '真实数据不可用');
  if (!list) return;
  if (!events.length) {
    list.innerHTML = '<p class="data-empty-state">真实数据接口暂不可用</p>';
    return;
  }
  const classByLevel = { red: 'danger', orange: 'warn', yellow: 'watch', green: 'safe' };
  list.innerHTML = events.map(event => `
    <div class="mine-risk-row ${classByLevel[event.risk_level] || 'safe'}">
      <span>${event.true_class || event.stage || event.event_id}</span>
      <b>${event.risk_score ?? '--'}</b>
      <em>${formatRiskLevel(event.risk_level)}</em>
      <i style="width:${Math.max(0, Math.min(100, Number(event.risk_score) || 0))}%"></i>
    </div>
  `).join('');
}

function refreshRegulatorEventDetail(event) {
  if (!event) {
    setText('regulatorAdviceStatus', '真实数据接口暂不可用');
    const unavailableList = document.getElementById('regulatorSupervisionList');
    if (unavailableList) unavailableList.innerHTML = '<p class="data-empty-state">无法读取真实事件与处置状态</p>';
    const unavailableEvidence = document.getElementById('regulatorEvidence');
    if (unavailableEvidence) unavailableEvidence.innerHTML = '<p class="data-empty-state">事件证据暂不可用</p>';
    return;
  }
  setText('regulatorAdviceStatus', `${event.stage || formatRiskLevel(event.risk_level)} · ${statusText(event.status)}`);
  const list = document.getElementById('regulatorSupervisionList');
  if (list) {
    list.innerHTML = `
      <p><b>督办要求</b><span>${event.supervision || '按预警等级执行监管复核。'}</span></p>
      <p><b>企业反馈</b><span>${event.feedback || '等待企业端上传反馈。'}</span></p>
      <p><b>专家意见</b><span>${event.expert_summary || '等待智库端输出模型解释。'}</span></p>
    `;
  }
  const evidence = document.getElementById('regulatorEvidence');
  if (evidence) {
    evidence.innerHTML = `
      <p><span>真实记录</span><b>${event.record_id || '--'}</b></p>
      <p><span>原始时间</span><b>${event.created_at || '--'}</b></p>
      <p><span>模型置信度</span><b>${Number.isFinite(Number(event.confidence)) ? `${(Number(event.confidence) * 100).toFixed(2)}%` : '--'}</b></p>
    `;
  }
}

function renderRegulatorEventQueue(events = []) {
  const queue = document.getElementById('regulatorEventQueue');
  const count = document.getElementById('regulatorEventCount');
  if (!queue) return;
  regulatorEvents = events;
  if (!events.length) {
    selectedRegulatorEventId = null;
    if (count) count.textContent = '真实数据不可用';
    queue.innerHTML = '<p class="data-empty-state">真实数据接口暂不可用</p>';
    refreshRegulatorEventDetail(null);
    return;
  }
  if (!selectedRegulatorEventId && events.length) selectedRegulatorEventId = events[0].event_id;
  if (count) count.textContent = `${events.length} 条事件`;
  queue.innerHTML = events.map(event => `
    <button class="event-queue-item ${event.event_id === selectedRegulatorEventId ? 'active' : ''}" data-event-id="${event.event_id}">
      <span>${event.event_id}</span>
      <b>${event.face_id || event.mine_name || '--'}</b>
      <em>${formatRiskLevel(event.risk_level)} · ${event.risk_score ?? '--'}</em>
    </button>
  `).join('');
  queue.querySelectorAll('[data-event-id]').forEach(button => {
    button.addEventListener('click', async () => {
      selectedRegulatorEventId = button.dataset.eventId;
      renderRegulatorEventQueue(regulatorEvents);
      refreshRegulatorEventDetail(regulatorEvents.find(event => event.event_id === selectedRegulatorEventId));
      await selectRoofRiskEvent(selectedRegulatorEventId);
    });
  });
  refreshRegulatorEventDetail(events.find(event => event.event_id === selectedRegulatorEventId) || events[0]);
}

function renderRegulatorTimeline(loop = {}) {
  const timeline = document.getElementById('regulatorActionTimeline');
  if (!timeline) return;
  const steps = Array.isArray(loop.steps) ? loop.steps : [];
  timeline.innerHTML = steps.map(step => `
    <p><b>${formatLoopStatus(step.status)}</b><span>${step.owner || '三端共享'}：${step.detail || step.label || '--'}</span></p>
  `).join('');
}

async function refreshRegulatorEvents(payload = null) {
  const queue = document.getElementById('regulatorEventQueue');
  if (!queue) return;
  try {
    let eventPayload = payload;
    if (!eventPayload) {
      const response = await authFetch('/api/roof-risk/events', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      eventPayload = await response.json();
    }
    if (eventPayload.selected_event_id) selectedRegulatorEventId = eventPayload.selected_event_id;
    const events = enrichRegulatorEvents(Array.isArray(eventPayload.events) ? eventPayload.events : []);
    renderRegulatorRiskOverview(events);
    renderRegulatorEventQueue(events);
  } catch (error) {
    renderRegulatorRiskOverview([]);
    renderRegulatorEventQueue(enrichRegulatorEvents([]));
    console.warn('RoofRisk events unavailable:', error);
  }
}

async function selectRoofRiskEvent(eventId) {
  if (!eventId) return;
  try {
    const response = await authFetch('/api/roof-risk/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await refreshRoofRiskApiStatus();
  } catch (error) {
    console.warn('RoofRisk event selection failed:', error);
  }
}

function refreshClosedLoop(payload) {
  const loop = payload.closed_loop || {};
  const enterprise = loop.portal_roles?.enterprise || {};
  const regulator = loop.portal_roles?.regulator || {};
  const expert = loop.portal_roles?.expert || {};
  const progressText = `${loop.progress ?? Math.round((payload.disposal?.closed_loop_rate ?? 0) * 100)}%`;
  const steps = Array.isArray(loop.steps) ? loop.steps : [];
  const activeStep = steps.find(step => step.status === 'active') || steps[0] || {};
  const isClosed = (loop.progress ?? 0) >= 100 || payload.disposal?.status === 'closed';

  setText('enterpriseLoopStatus', enterprise.status || payload.disposal?.status || '--');
  setText('enterpriseLoopEvent', payload.event_id);
  setText('enterpriseLoopStep', loop.active_step_label || activeStep.label);
  setText('enterpriseLoopProgress', progressText);
  setText('enterpriseLoopNext', enterprise.next || loop.command);
  renderClosedLoopTrack('enterpriseLoopTrack', steps);

  setText('regulatorLoopEvent', payload.event_id);
  setText('regulatorLoopProgress', progressText);
  setText('regulatorLoopStep', loop.active_step_label || activeStep.label);
  setText('regulatorLoopOwner', activeStep.owner || '三端共享');
  setText('regulatorLoopStatus', regulator.status || '督办中');
  const closureRing = document.querySelector('.regulator-screen .closure-ring');
  if (closureRing) closureRing.classList.toggle('closed', isClosed);
  renderClosedLoopFlow('regulatorLoopFlow', steps);
  renderRegulatorTimeline(loop);

  setText('expertLoopEvent', `事件 ${payload.event_id || '--'}：${payload.risk?.level === 'red' ? '红色预警' : payload.risk?.stage || '--'}`);
  setText('expertRuleLayer', `${payload.risk?.explanation || '多源指标触发预警。'}`);
  setText('expertFusionLayer', `综合风险指数 ${payload.risk?.score ?? '--'}，当前环节：${loop.active_step_label || activeStep.label || '--'}。`);
  setText('expertLoopLayer', expert.next || expert.primary || loop.command);

  const evidence = document.getElementById('expertEvidenceChain');
  if (evidence) {
    const triggerText = Array.isArray(payload.risk?.trigger) ? payload.risk.trigger.map(formatTriggerName).join('、') : '多源指标';
    const evidenceItems = Array.isArray(payload.feature_evidence) ? payload.feature_evidence : [];
    const evidenceText = evidenceItems.length
      ? evidenceItems.map(item => `${item.label} ${Number(item.standardized_value) >= 0 ? '+' : ''}${Number(item.standardized_value).toFixed(2)}σ`).join('，')
      : '--';
    const stepText = steps.map(step => step.label).join(' → ');
    evidence.innerHTML = `
      <p><b>触发指标</b><span>${triggerText}</span></p>
      <p><b>特征证据</b><span>${evidenceText}</span></p>
      <p><b>当前证据</b><span>${loop.command || payload.risk?.explanation || '--'}</span></p>
      <p><b>处置链路</b><span>${stepText || '--'}</span></p>
    `;
  }
  setText('expertSummaryStatus', isClosed ? '复盘已生成' : '复盘草稿');
  const replay = document.getElementById('expertReplaySummary');
  if (replay) {
    const triggerText = Array.isArray(payload.risk?.trigger) ? payload.risk.trigger.map(formatTriggerName).join('、') : '多源指标';
    replay.innerHTML = `
      <strong>事件复盘摘要</strong>
      <p>事件 ${payload.event_id || '--'} 综合风险指数 ${payload.risk?.score ?? '--'}，触发指标为 ${triggerText}。当前闭环阶段为 ${loop.active_step_label || activeStep.label || '--'}，${loop.command || '三端持续跟踪处置进展。'}</p>
    `;
  }

  document.querySelectorAll('[data-loop-action="advance"]:not([hidden])').forEach(button => {
    button.disabled = isClosed;
    button.textContent = isClosed ? '已完成闭环' : (button.closest('.regulator-screen') ? '监管复核通过' : '提交处置反馈');
  });
  document.querySelectorAll('[data-loop-action="archive"]:not([hidden])').forEach(button => {
    button.disabled = isClosed;
    button.textContent = isClosed ? '已归档' : '直接闭环归档';
    button.classList.toggle('closed', isClosed);
  });
}

async function refreshRoofRiskApiStatus() {
  const statusText = document.getElementById('apiStatusText');
  if (!statusText) return;
  try {
    const [currentResponse, historyResponse, eventsResponse, analyticsResponse] = await Promise.all([
      authFetch('/api/roof-risk/current', { cache: 'no-store' }),
      authFetch('/api/roof-risk/history', { cache: 'no-store' }),
      authFetch('/api/roof-risk/events', { cache: 'no-store' }),
      authFetch('/api/roof-risk/research-analytics', { cache: 'no-store' }),
    ]);
    if (!currentResponse.ok || !historyResponse.ok || !eventsResponse.ok || !analyticsResponse.ok) {
      throw new Error(`HTTP ${currentResponse.status}/${historyResponse.status}/${eventsResponse.status}/${analyticsResponse.status}`);
    }
    const [payload, historyPayload, eventsPayload, analyticsPayload] = await Promise.all([
      currentResponse.json(), historyResponse.json(), eventsResponse.json(),
      analyticsResponse.json(),
    ]);
    liveRoofRiskApiPayload = payload;
    latestRoofRiskHistoryPayload = historyPayload;
    latestRoofRiskEventsPayload = eventsPayload;
    setText('apiVersion', payload.api_version ?? 'RoofRisk API v1');
    setText('apiDataSource', normalizeDataSourceLabel(payload.data_source));
    setText('apiEventId', payload.event_id ?? '--');
    setText('apiFaceId', payload.face_id ?? '--');
    const viewModel = mapRoofRiskViewModel(payload);
    if (!replayDisplayActive) {
      latestRoofRiskApiPayload = liveRoofRiskApiPayload;
      document.body.dataset.roofDataMode = 'live';
      setText('enterpriseSourceName', payload.provenance?.source_name || 'teacher_roof_monitoring.csv');
      setText('enterpriseRecordId', viewModel.provenance.recordId);
      setText('enterpriseRecordTime', viewModel.provenance.timestamp);
      setText('enterpriseDeviceId', viewModel.provenance.deviceId);
      setText('enterpriseSourceHash', viewModel.provenance.hashShort);
      setText('diagnosisModeBadge', '实时记录');
      setText('diagnosisRecordContext', viewModel.provenance.recordId);
      renderExpertModel(viewModel);
      refreshClosedLoop(payload);
      refreshWarningDemoRisk(payload);
    }
    initPortalCharts();
    if (!replayDisplayActive) {
      updateRoofRiskCharts({ current: payload, history: historyPayload, events: eventsPayload, analytics: analyticsPayload });
    }
    statusText.textContent = '接口在线';
    statusText.classList.remove('api-offline');
    await refreshRegulatorEvents(eventsPayload);
  } catch (error) {
    liveRoofRiskApiPayload = null;
    const unavailable = unavailableRoofRiskViewModel();
    if (!replayDisplayActive) {
      latestRoofRiskApiPayload = null;
      renderEnterpriseMetricSlots(unavailable);
      renderExpertModel(unavailable);
    }
    setText('apiDataSource', unavailable.provenance.source);
    setText('apiEventId', '--');
    setText('apiFaceId', '--');
    setText('enterpriseSourceName', '真实数据接口暂不可用');
    setText('enterpriseRecordId', '--');
    setText('enterpriseRecordTime', '--');
    setText('enterpriseDeviceId', '--');
    setText('enterpriseSourceHash', '--');
    if (!replayDisplayActive) clearRoofRiskCharts('真实数据接口暂不可用');
    statusText.textContent = '接口离线';
    statusText.classList.add('api-offline');
    console.warn('RoofRisk API status unavailable:', error);
  }
}

async function advanceClosedLoop(action = 'advance') {
  const buttons = document.querySelectorAll('[data-loop-action]:not([hidden])');
  buttons.forEach(button => { button.disabled = true; });
  try {
    const response = await authFetch('/api/roof-risk/closed-loop/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.warn('Closed loop advance failed:', error);
  } finally {
    buttons.forEach(button => { button.disabled = false; });
    await refreshRoofRiskApiStatus();
  }
}

function setupClosedLoopActions() {
  document.querySelectorAll('[data-loop-action]:not([hidden])').forEach(button => {
    button.addEventListener('click', () => {
      advanceClosedLoop(button.dataset.loopAction || 'advance');
    });
  });
}

function setExpertAdviceResult(result) {
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const sourceLabel = result.source === 'deepseek' ? 'DeepSeek AI' : '本地专家规则';
  const fallbackLabels = { not_configured: 'API未配置', provider_http_error: 'API返回错误', empty_provider_response: 'API返回空内容', provider_timeout: 'API请求超时', provider_unavailable: 'API连接失败' };
  const fallbackNotice = result.fallback_reason ? `已使用本地规则：${fallbackLabels[result.fallback_reason] || 'API暂不可用'}${result.provider_status ? `（HTTP ${result.provider_status}）` : ''}。` : '';
  const source = document.getElementById('expertAdviceSource');
  const time = document.getElementById('expertAdviceTime');
  const resultPanel = document.getElementById('expertAdviceResult');
  const copy = document.getElementById('copyExpertAdvice');
  const sourceBadge = document.getElementById('expertExplanationSource');
  const text = [
    `建议来源：${sourceLabel}${fallbackNotice ? `，${fallbackNotice}` : ''}`,
    `风险等级：${result.riskLevel}`,
    `建议时效：${result.timeHorizon}`,
    `分析摘要：${result.summary}`,
    `依据：${(result.evidence || []).join('、') || '当前记录暂无额外证据'}`,
    `专家建议：${(result.recommendations || []).map((item, index) => `${index + 1}. ${item}`).join(' ')}`,
  ].join('\n');
  if (source) source.textContent = sourceLabel;
  if (time) time.textContent = result.generatedAt ? new Date(result.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '--';
  if (sourceBadge) sourceBadge.textContent = sourceLabel;
  if (resultPanel) {
    resultPanel.innerHTML = `<strong>${escapeHtml(result.riskLevel)} · ${escapeHtml(result.timeHorizon)}</strong>${fallbackNotice ? `<p role="status">${escapeHtml(fallbackNotice)}</p>` : ''}<p>${escapeHtml(result.summary)}</p><ul>${(result.recommendations || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }
  if (copy) { copy.disabled = false; copy.dataset.copyText = text; }
}

async function generateExpertAdvice() {
  const button = document.getElementById('generateExpertAdvice');
  if (!button || !latestRoofRiskApiPayload) return;
  button.disabled = true;
  button.textContent = '分析中…';
  try {
    const payload = latestRoofRiskApiPayload;
    const response = await authFetch('/api/roof-risk/expert-advice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordId: payload.provenance?.record_id,
        timestamp: payload.provenance?.original_timestamp,
        risk: payload.risk,
        model: payload.model_output,
        evidence: payload.feature_evidence,
        closed_loop: getWarningDemoAdviceContext(payload.closed_loop),
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setExpertAdviceResult(await response.json());
  } catch (error) {
    const fallback = document.getElementById('expertAdviceResult');
    if (fallback) fallback.innerHTML = '<strong>建议生成失败</strong><p>当前无法连接建议服务，请稍后重试。已有模型解释仍可使用。</p>';
    console.warn('Expert advice generation failed:', error);
  } finally {
    button.disabled = false;
    button.textContent = '生成建议';
  }
}

function setupExpertResearchActions() {
  document.getElementById('generateExpertAdvice')?.addEventListener('click', generateExpertAdvice);
  document.getElementById('copyExpertAdvice')?.addEventListener('click', async (event) => {
    const text = event.currentTarget.dataset.copyText;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      event.currentTarget.textContent = '已复制';
      setTimeout(() => { event.currentTarget.textContent = '复制建议文本'; }, 1400);
    } catch { event.currentTarget.textContent = '复制失败'; }
  });
}

async function refreshExpertAdviceStatus() {
  const button = document.getElementById('generateExpertAdvice');
  const source = document.getElementById('expertAdviceSource');
  const result = document.getElementById('expertAdviceResult');
  if (!button) return;
  try {
    const response = await authFetch('/api/roof-risk/expert-advice/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = await response.json();
    button.disabled = !status.configured;
    button.textContent = status.configured ? '生成 DeepSeek 建议' : '需配置 DeepSeek';
    if (source) source.textContent = status.configured ? 'DeepSeek 已配置 · 调用待验证' : 'DeepSeek 未配置';
    if (!status.configured && result) result.innerHTML = '<strong>DeepSeek API 未配置</strong><p>当前仅展示真实数据和模型解释。配置服务端 DEEPSEEK_API_KEY 后，才会生成 AI 专家建议。</p>';
  } catch (error) {
    button.disabled = true;
    button.textContent = 'DeepSeek 不可用';
    if (source) source.textContent = '接口状态未知';
    console.warn('Expert advice status unavailable:', error);
  }
}

// ==================== 窗口响应 ====================
function onResize() { resizeCharts(); }

// ==================== 主循环 ====================
let lastTick = performance.now();
function gameLoop() {
  requestAnimationFrame(gameLoop);
  const now = performance.now();
  const dt = (now - lastTick) / 1000; // 秒
  lastTick = now;

  // 推进灾害模拟
  tick(dt * 1000);
  updateMineState(dt);
}

// ==================== 启动 ====================
async function initApp(authenticatedUser) {
  console.log('智慧矿山数字孪生综合管控平台启动中...');

  // 初始化灾害模块（注入场景特效）
  init(disasterEffects);

  // 仅企业值守端需要三维场景；监管和智库端避免后台加载大型模型。
  if (authenticatedUser.role === 'enterprise') initScene('threeContainer');

  // 图表在角色门户可见且真实 API 数据就绪后初始化。
  initPortalCharts();

  // UI 组件
  setupRoofFieldControls();
  setupClosedLoopActions();
  setupExpertResearchActions();
  if (authenticatedUser.role === 'expert') {
    setupMultiAgentWorkflow({ authFetch, getCurrentPayload: () => latestRoofRiskApiPayload });
  }
  refreshExpertAdviceStatus();
  await setupWarningDemo({ user: authenticatedUser, authFetch, onSourceSelected: refreshRoofRiskApiStatus });
  setupDisasterPanel();
  setupEquipmentFocus();
  await refreshRoofRiskApiStatus();
  if (authenticatedUser.role === 'enterprise') await initReplayWorkbench();
  refreshData();
  renderEquipList();
  renderAlertList();
  applyInitialStageFromUrl();

  // 定时任务
  updateDateTime();
  setInterval(updateDateTime, 1000);
  setInterval(refreshData, 500);

  // 主循环（驱动灾害模拟）
  lastTick = performance.now();
  gameLoop();

  window.addEventListener('resize', onResize);
  window.addEventListener('beforeunload', () => {
    replayController?.dispose();
    destroyWarningDemo();
    disposeCharts();
  }, { once: true });

  console.log('平台启动完成。');
}

document.addEventListener('DOMContentLoaded', async () => {
  const session = await bootstrapAuthenticatedPortal();
  if (!session) return;
  await initApp(session.user);
});
