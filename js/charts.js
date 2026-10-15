import { buildRoofRiskChartModel } from './roof-risk-chart-model.mjs';
import { buildExpertResearchModel } from './expert-research-model.mjs';
import { buildSupportSimulationOption } from './support-simulation-model.mjs';

const CHART_IDS = [
  'thresholdTrendChart',
  'replayTrendChart',
  'regulatorDistributionChart',
  'expertProbabilityChart',
  'expertDeviationChart',
  'expertHistoryChart',
  'expertDistributionChart',
  'expertContributionChart',
  'expertMechanismHeatmap',
  'expertViolinChart',
  'expertResearchTrendChart',
  'expertClusterChart',
];

const SERIES_COLORS = ['#32c7d9', '#f2b84b', '#50c878', '#d6e2e8', '#f05b5b', '#7fa4b8', '#a9c7d3'];
const RISK_COLORS = { red: '#f05b5b', orange: '#ef8f4e', yellow: '#f2b84b', green: '#50c878' };
const chartInstances = new Map();
let resizeObserver = null;
let themeRegistered = false;

function registerTheme() {
  if (themeRegistered || typeof echarts === 'undefined') return;
  echarts.registerTheme('smartMineIndustrial', {
    color: SERIES_COLORS,
    backgroundColor: 'transparent',
    textStyle: { color: '#a7b7c0', fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
    title: { textStyle: { color: '#e8f1f5' } },
    legend: { textStyle: { color: '#9db0ba' } },
    categoryAxis: {
      axisLine: { lineStyle: { color: '#34444d' } },
      axisTick: { show: false },
      axisLabel: { color: '#81949e' },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#81949e' },
      splitLine: { lineStyle: { color: '#26343b', type: 'dashed' } },
    },
  });
  themeRegistered = true;
}

function getResizeObserver() {
  if (!resizeObserver && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      entries.forEach(({ target, contentRect }) => {
        if (!contentRect.width || !contentRect.height) return;
        const chart = echarts.getInstanceByDom(target);
        if (chart && !chart.isDisposed()) chart.resize();
      });
    });
  }
  return resizeObserver;
}

function initChart(domId) {
  const dom = document.getElementById(domId);
  if (!dom || !dom.clientWidth || !dom.clientHeight) return null;
  if (typeof echarts === 'undefined') {
    dom.classList.add('chart-load-failed');
    dom.textContent = '图表组件加载失败，请刷新页面';
    return null;
  }
  dom.classList.remove('chart-load-failed');
  registerTheme();
  let chart = echarts.getInstanceByDom(dom);
  if (!chart) chart = echarts.init(dom, 'smartMineIndustrial', { renderer: 'canvas' });
  chartInstances.set(domId, chart);
  getResizeObserver()?.observe(dom);
  return chart;
}

function chartFor(domId) {
  const stored = chartInstances.get(domId);
  if (stored && !stored.isDisposed()) return stored;
  return initChart(domId);
}

function timeLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '--';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function numberLabel(value, maximumFractionDigits = 2) {
  return Number.isFinite(Number(value))
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits }).format(Number(value))
    : '--';
}

function baseTooltip(trigger = 'item') {
  return {
    trigger,
    renderMode: 'richText',
    confine: true,
    backgroundColor: '#10191e',
    borderColor: '#3b4c55',
    borderWidth: 1,
    textStyle: { color: '#e8f1f5', fontSize: 12 },
    extraCssText: 'box-shadow:none;',
  };
}

function emptyGraphic(message) {
  return [{
    type: 'text',
    left: 'center',
    top: 'middle',
    silent: true,
    style: { text: message, fill: '#70838d', font: '12px Segoe UI, Microsoft YaHei, sans-serif' },
  }];
}

function thresholdTrendOption(model, {
  seriesLimit = 4,
  showEndLabel = true,
  includeDataZoom = false,
} = {}) {
  const trend = model.thresholdTrend;
  const visibleSeries = trend.series.slice(0, seriesLimit);
  if (!visibleSeries.length) return { series: [], graphic: emptyGraphic('暂无连续历史数据') };
  const isRiskScore = trend.mode === 'risk-score';
  const referenceLabel = isRiskScore ? '较大风险参考线' : '统计参考边界';
  return {
    animationDuration: 240,
    grid: { left: 43, right: showEndLabel ? 34 : 14, top: 48, bottom: includeDataZoom ? 54 : 30, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    legend: { top: 3, left: 0, right: 0, type: 'scroll', itemWidth: 16, itemHeight: 3, itemGap: 12, textStyle: { fontSize: 10 } },
    tooltip: {
      ...baseTooltip('axis'),
      axisPointer: { type: 'line', lineStyle: { color: '#607681', type: 'dashed' } },
      formatter(params) {
        if (!Array.isArray(params) || !params.length) return '';
        const lines = [timeLabel(params[0].value?.[0])];
        params.forEach((param) => {
          const raw = param.data?.rawValue;
          const unit = param.data?.unit || '';
          lines.push(isRiskScore
            ? `${param.seriesName}  ${numberLabel(raw)} 分`
            : `${param.seriesName}  ${numberLabel(raw)} ${unit}\nP05 ${numberLabel(param.data?.p05)} · P95 ${numberLabel(param.data?.p95)} · ${param.data?.direction === 'low' ? '低侧接近' : '高侧偏离'} ${numberLabel(param.value?.[1], 1)}%`);
        });
        return lines.join('\n');
      },
    },
    xAxis: { type: 'time', boundaryGap: false, axisLabel: { formatter: (value) => timeLabel(value), hideOverlap: true, fontSize: 10 } },
    yAxis: {
      type: 'value',
      name: isRiskScore ? '综合风险分' : '参考偏离 (%)',
      nameTextStyle: { color: '#81949e', fontSize: 10, padding: [0, 0, 4, 0] },
      axisLabel: { formatter: isRiskScore ? '{value}' : '{value}%', fontSize: 10 },
      min: 0,
      max: (range) => Math.max(isRiskScore ? 100 : 125, Math.ceil(range.max / 25) * 25),
    },
    series: visibleSeries.map((item, index) => ({
      id: item.key,
      name: item.label,
      type: 'line',
      showSymbol: false,
      smooth: 0.22,
      sampling: 'lttb',
      lineStyle: { width: index === 0 ? 2.6 : 1.6, shadowBlur: index === 0 ? 7 : 0, shadowColor: SERIES_COLORS[index] },
      areaStyle: index === 0 ? { opacity: 0.1 } : undefined,
      endLabel: { show: showEndLabel && index === 0, formatter: (params) => isRiskScore ? `${numberLabel(params.value?.[1], 0)} 分` : `${numberLabel(params.value?.[1], 0)}%`, color: SERIES_COLORS[index], fontSize: 10 },
      labelLayout: { moveOverlap: 'shiftY' },
      emphasis: { focus: 'series' },
      data: item.points.map((point, pointIndex) => ({
        value: [point.timestamp, point.index],
        rawValue: point.rawValue,
        unit: point.unit,
        p05: point.p05,
        p95: point.p95,
        direction: point.direction,
        deviated: point.deviated,
        symbol: pointIndex === item.points.length - 1 ? 'circle' : 'none',
        symbolSize: pointIndex === item.points.length - 1 ? (index === 0 ? 9 : 6) : 0,
      })),
      markLine: index === 0 ? {
        silent: true,
        symbol: 'none',
        label: { formatter: referenceLabel, color: '#f2b84b', fontSize: 10 },
        lineStyle: { color: '#f2b84b', width: 1, type: 'dashed' },
        data: [{ yAxis: trend.reference }],
      } : undefined,
      markArea: index === 0 ? {
        silent: true,
        label: { show: false },
        data: isRiskScore
          ? [
            [{ yAxis: 0, itemStyle: { color: 'rgba(80,200,120,0.045)' } }, { yAxis: 40 }],
            [{ yAxis: 40, itemStyle: { color: 'rgba(242,184,75,0.05)' } }, { yAxis: 70 }],
            [{ yAxis: 70, itemStyle: { color: 'rgba(240,91,91,0.07)' } }, { yAxis: 100 }],
          ]
          : [[
            { yAxis: 0, itemStyle: { color: 'rgba(50,199,217,0.035)' } },
            { yAxis: 100 },
          ]],
      } : undefined,
    })),
    dataZoom: includeDataZoom ? [{
        type: 'slider',
        filterMode: 'none',
        height: 15,
        bottom: 8,
        borderColor: '#30414a',
        backgroundColor: '#111a1f',
        fillerColor: 'rgba(50,199,217,0.16)',
        handleStyle: { color: '#32c7d9', borderColor: '#32c7d9' },
        textStyle: { color: '#70838d', fontSize: 9 },
      }] : undefined,
  };
}

function horizontalBarOption(source, { valueKey, valueMax, labelFormatter, tooltipFormatter, color }) {
  if (!source.length) return { series: [], graphic: emptyGraphic('暂无真实数据') };
  return {
    animationDuration: 280,
    dataset: { source },
    grid: { left: 78, right: 42, top: 8, bottom: 12, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    tooltip: { ...baseTooltip('item'), formatter: tooltipFormatter },
    xAxis: { type: 'value', max: valueMax, axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: { type: 'category', inverse: true, axisLabel: { fontSize: 11 }, axisLine: { show: false } },
    series: [{
      type: 'bar',
      encode: { x: valueKey, y: 'label' },
      barWidth: 10,
      showBackground: true,
      backgroundStyle: { color: '#202c32', borderRadius: 2 },
      itemStyle: { color, borderRadius: 2 },
      label: { show: true, position: 'right', color: '#d6e2e8', fontSize: 11, formatter: labelFormatter },
    }],
  };
}

function distributionOption(model) {
  return horizontalBarOption(model.distribution, {
    valueKey: 'count',
    valueMax: (value) => Math.max(1, Math.ceil(value.max * 1.3)),
    color: (params) => RISK_COLORS[params.data.key] || '#7fa4b8',
    labelFormatter: (params) => `${params.value.count} 条 · ${numberLabel(params.value.percent, 1)}%`,
    tooltipFormatter: (params) => `${params.value.label}\n${params.value.count} 条事件 · ${numberLabel(params.value.percent, 1)}%`,
  });
}

function probabilityOption(model) {
  return horizontalBarOption(model.probabilities, {
    valueKey: 'percent',
    valueMax: 100,
    color: (params) => RISK_COLORS[params.data.key === 'severe' ? 'red' : params.data.key === 'major' ? 'orange' : params.data.key === 'general' ? 'yellow' : 'green'],
    labelFormatter: (params) => `${numberLabel(params.value.percent, 3)}%`,
    tooltipFormatter: (params) => `${params.value.label}\n模型概率 ${numberLabel(params.value.percent, 3)}%`,
  });
}

function deviationOption(model) {
  if (!model.deviations.length) return { series: [], graphic: emptyGraphic('暂无标准化特征证据') };
  const source = model.deviations.map((item) => ({ ...item, magnitude: Math.abs(item.deviation) }));
  return horizontalBarOption(source, {
    valueKey: 'magnitude',
    valueMax: (value) => Math.max(1, Math.ceil(value.max * 1.25)),
    color: (params) => Math.abs(params.data.deviation) >= 2 ? '#f05b5b' : '#32c7d9',
    labelFormatter: (params) => `${params.value.deviation >= 0 ? '+' : ''}${numberLabel(params.value.deviation, 2)}σ`,
    tooltipFormatter: (params) => `${params.value.label}\n标准化偏离 ${params.value.deviation >= 0 ? '+' : ''}${numberLabel(params.value.deviation, 2)}σ\n原始值 ${numberLabel(params.value.rawValue)} ${params.value.unit || ''}`,
  });
}

function researchDistributionOption(model) {
  const source = model.distribution.map((item) => ({ ...item, value: item.count }));
  return {
    animationDuration: 240,
    tooltip: { ...baseTooltip('item'), formatter: (params) => `${params.name}\n${numberLabel(params.value, 0)} 条 · ${numberLabel(params.data.percent, 1)}%` },
    legend: { bottom: 0, left: 'center', itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 9 } },
    series: [{ type: 'pie', radius: ['44%', '72%'], center: ['50%', '45%'], avoidLabelOverlap: true, itemStyle: { borderColor: '#10191e', borderWidth: 2 }, label: { color: '#c8d6db', fontSize: 10, formatter: ({ name, percent }) => `${name}\n${percent}%` }, data: source.map((item) => ({ name: item.label, value: item.value, percent: item.percent, itemStyle: { color: item.color } })) }],
  };
}

function researchContributionOption(model) {
  return horizontalBarOption(model.contributions.slice(0, 7).map((item) => ({ label: item.label, value: item.contribution, contribution: item.contribution, unit: item.unit })), {
    valueKey: 'value', valueMax: (value) => Math.max(1, value.max * 1.25), color: '#e8a94a',
    labelFormatter: (params) => `${numberLabel(params.value.value, 3)}σ`,
    tooltipFormatter: (params) => `${params.value.label}\n标准化偏离绝对值 ${numberLabel(params.value.value, 3)}σ`,
  });
}

function researchHeatmapOption(model) {
  const labels = model.schema.map((item) => item.label);
  if (!labels.length) return { series: [], graphic: emptyGraphic('暂无机理关联数据') };
  return {
    animationDuration: 240,
    grid: { left: 82, right: 12, top: 8, bottom: 62 },
    tooltip: { ...baseTooltip('item'), formatter: (params) => `${labels[params.value[1]]} × ${labels[params.value[0]]}\nr = ${numberLabel(params.value[2], 3)}` },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 38, fontSize: 9 } },
    yAxis: { type: 'category', data: labels, axisLabel: { fontSize: 9 } },
    visualMap: { min: -1, max: 1, calculable: false, orient: 'horizontal', left: 'center', bottom: 4, itemWidth: 10, itemHeight: 90, inRange: { color: ['#2d6fa3', '#16242b', '#c94d4d'] }, textStyle: { color: '#81949e', fontSize: 9 } },
    series: [{ type: 'heatmap', data: model.heatmap.flat().map((cell) => [cell.x, cell.y, cell.value]), label: { show: true, color: '#e8f1f5', fontSize: 9, formatter: ({ value }) => Number(value[2]).toFixed(2) }, emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,.5)' } } }],
  };
}

function researchViolinOption(model) {
  const labels = model.violins.map((item) => item.label);
  if (!model.violins.length || model.violins.every((item) => !item.values.length)) return { series: [], graphic: emptyGraphic('暂无历史分布数据') };
  const yMin = Math.floor(Math.min(...model.violins.map((item) => item.min).filter(Number.isFinite)) - 0.25);
  const yMax = Math.ceil(Math.max(...model.violins.map((item) => item.max).filter(Number.isFinite)) + 0.25);
  return {
    animationDuration: 240,
    grid: { left: 44, right: 18, top: 18, bottom: 66 },
    tooltip: { ...baseTooltip('item'), formatter: (params) => { const item = model.violins[params.dataIndex]; return `${item.label}\n最大 ${numberLabel(item.max)}\nQ3 ${numberLabel(item.q3)}\n中位数 ${numberLabel(item.median)}\nQ1 ${numberLabel(item.q1)}\n最小 ${numberLabel(item.min)}`; } },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 38, fontSize: 9 } },
    yAxis: { type: 'value', min: yMin, max: yMax, name: '标准化值', nameTextStyle: { fontSize: 9, color: '#81949e' }, splitLine: { lineStyle: { color: '#26343b', type: 'dashed' } } },
    series: [{
      type: 'custom',
      renderItem(params, api) {
        const item = model.violins[params.dataIndex];
        const density = item.density || [];
        if (!density.length || !Number.isFinite(item.min) || !Number.isFinite(item.max)) return null;
        const points = [];
        density.forEach((value, index) => {
          const y = item.min + ((item.max - item.min) * index) / Math.max(1, density.length - 1);
          const centerX = api.coord([params.dataIndex, y])[0];
          points.push([centerX - (value * 24), api.coord([params.dataIndex, y])[1]]);
        });
        for (let index = density.length - 1; index >= 0; index -= 1) {
          const y = item.min + ((item.max - item.min) * index) / Math.max(1, density.length - 1);
          const centerX = api.coord([params.dataIndex, y])[0];
          points.push([centerX + (density[index] * 24), api.coord([params.dataIndex, y])[1]]);
        }
        return { type: 'polygon', shape: { points }, style: { fill: 'rgba(50,199,217,.28)', stroke: '#32c7d9', lineWidth: 1 } };
      },
      data: model.violins.map((_item, index) => ({ value: [index, 0] })),
    }],
  };
}

function researchTrendOption(model) {
  if (!model.trend.length) return { series: [], graphic: emptyGraphic('暂无历史趋势数据') };
  return {
    animationDuration: 240,
    grid: { left: 42, right: 18, top: 18, bottom: 28 },
    tooltip: { ...baseTooltip('axis'), formatter: (params) => `${params[0]?.axisValue || ''}\n综合风险 ${numberLabel(params[0]?.value?.[1], 0)} 分` },
    xAxis: { type: 'category', data: model.trend.map((item) => item.timestamp.slice(5, 16)), axisLabel: { hideOverlap: true, fontSize: 9 } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 9 }, splitLine: { lineStyle: { color: '#26343b', type: 'dashed' } } },
    series: [{ type: 'line', smooth: 0.25, showSymbol: false, data: model.trend.map((item) => [item.timestamp.slice(5, 16), item.score]), lineStyle: { color: '#ef8f4e', width: 2 }, areaStyle: { color: 'rgba(239,143,78,.13)' }, markLine: { silent: true, symbol: 'none', lineStyle: { color: '#f05b5b', type: 'dashed' }, data: [{ yAxis: 70 }] } }],
  };
}

function researchClusterOption(model) {
  if (!model.currentProfile.length) return { series: [], graphic: emptyGraphic('暂无当前指标数据') };
  const maxMagnitude = Math.max(2, ...model.currentProfile.map((item) => Math.abs(item.value)));
  return {
    animationDuration: 240,
    radar: { center: ['50%', '53%'], radius: '65%', splitNumber: 4, indicator: model.currentProfile.map((item) => ({ name: item.label, max: maxMagnitude, min: -maxMagnitude })), axisName: { color: '#a9bac0', fontSize: 9 }, splitLine: { lineStyle: { color: ['#26343b', '#30424a', '#3a4c54', '#465961'] } }, splitArea: { areaStyle: { color: ['rgba(50,199,217,.02)', 'rgba(50,199,217,.05)'] } }, axisLine: { lineStyle: { color: '#3b4c55' } } },
    tooltip: { ...baseTooltip('item'), formatter: (params) => `${params.seriesName}\n${model.currentProfile.map((item) => `${item.label} ${item.value >= 0 ? '+' : ''}${numberLabel(item.value, 2)}σ`).join('\n')}` },
    series: [{ type: 'radar', symbol: 'circle', symbolSize: 4, data: [{ value: model.currentProfile.map((item) => item.value), name: '当前记录', lineStyle: { color: '#ef8f4e', width: 2 }, itemStyle: { color: '#ef8f4e' }, areaStyle: { color: 'rgba(239,143,78,.18)' } }] }],
  };
}

export function initPortalCharts() {
  CHART_IDS.forEach(initChart);
  return chartInstances;
}

export function updateRoofRiskCharts({ current = {}, history = {}, events = {}, analytics = {} } = {}) {
  const model = buildRoofRiskChartModel(current, history, events);
  const research = buildExpertResearchModel({ current, history, events, analytics });
  const title = document.getElementById('thresholdTrendTitle');
  const hint = document.getElementById('thresholdTrendHint');
  if (title) title.textContent = '当前记录 · XGBoost 风险概率';
  if (hint) hint.textContent = '四分类预测概率 · 与历史趋势分开展示';
  const options = {
    thresholdTrendChart: probabilityOption(model),
    regulatorDistributionChart: distributionOption(model),
    expertProbabilityChart: probabilityOption(model),
    expertDeviationChart: deviationOption(model),
    expertHistoryChart: thresholdTrendOption(model),
    expertDistributionChart: researchDistributionOption(research),
    expertContributionChart: researchContributionOption(research),
    expertMechanismHeatmap: researchHeatmapOption(research),
    expertViolinChart: researchViolinOption(research),
    expertResearchTrendChart: researchTrendOption(research),
    expertClusterChart: researchClusterOption(research),
  };

  Object.entries(options).forEach(([domId, option]) => {
    const chart = chartFor(domId);
    if (!chart) return;
    const currentSeries = chart.getOption()?.series?.length || 0;
    const nextSeries = option.series?.length || 0;
    chart.setOption(option, { notMerge: currentSeries !== nextSeries });
  });
  renderExpertResearchSummary(research, current);
  return model;
}

function renderExpertResearchSummary(model, current) {
  const labels = { green: '低风险', yellow: '一般风险', orange: '较大风险', red: '重大风险' };
  const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  set('expertResearchSource', model.sourceName);
  set('researchRiskLevel', labels[model.riskLevel] || '--');
  set('researchRiskScore', Number.isFinite(model.currentScore) ? `综合风险 ${numberLabel(model.currentScore, 0)} 分` : '综合风险 --');
  set('researchConfidence', Number.isFinite(Number(current.model_output?.confidence)) ? `${numberLabel(Number(current.model_output.confidence) * 100, 2)}%` : '--');
  set('researchModelName', `${String(current.model_output?.best_model || 'XGBoost').toUpperCase()} · ${current.model_output?.predicted_class || '--'}`);
  set('researchSampleCount', model.sampleCount ? numberLabel(model.sampleCount, 0) : '--');
  set('researchSourceName', model.sourceName);
  set('researchEvidenceCount', `${model.explanation.evidence.length} 项`);
  set('researchAccuracy', Number.isFinite(model.modelAccuracy) ? `${numberLabel(model.modelAccuracy * 100, 2)}%` : '--');
  set('researchF1', Number.isFinite(model.modelMacroF1) ? `Macro-F1 ${(model.modelMacroF1 * 100).toFixed(2)}%` : 'Macro-F1 --');
  set('researchEvidenceText', model.explanation.evidence.map((item) => `${item.label}（贡献 ${numberLabel(item.contribution, 3)}）`).join('、') || '暂无当前记录证据');
  set('researchRuleText', model.explanation.rule);
  set('researchMechanismText', model.explanation.mechanism);
  set('researchConclusionText', model.explanation.conclusion);
}

export function updateReplayChart({ current = {}, history = {} } = {}) {
  const chart = chartFor('replayTrendChart');
  if (!chart) return null;
  const model = buildRoofRiskChartModel(current, history, {});
  const option = thresholdTrendOption(model, {
    seriesLimit: 7,
    showEndLabel: true,
    includeDataZoom: true,
  });
  chart.setOption(option, { notMerge: true });
  return model.thresholdTrend;
}

export function updateSupportSimulationChart(item, selectedStep) {
  const chart = chartFor('supportSimulationChart');
  if (chart) chart.setOption(buildSupportSimulationOption(item, selectedStep));
}

export function disposeSupportSimulationChart() {
  const chart = chartInstances.get('supportSimulationChart');
  if (chart && !chart.isDisposed()) { resizeObserver?.unobserve(chart.getDom()); chart.dispose(); }
  chartInstances.delete('supportSimulationChart');
}

export function clearRoofRiskCharts(message = '真实数据暂不可用') {
  CHART_IDS.forEach((domId) => {
    const chart = chartFor(domId);
    if (chart) chart.setOption({ series: [], dataset: { source: [] }, graphic: emptyGraphic(message) }, { notMerge: true });
  });
}

export function resizeCharts() {
  chartInstances.forEach((chart) => {
    const dom = chart.getDom();
    if (!chart.isDisposed() && dom.clientWidth && dom.clientHeight) chart.resize();
  });
}

export function disposeCharts() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  chartInstances.forEach((chart) => {
    if (!chart.isDisposed()) chart.dispose();
  });
  chartInstances.clear();
}
