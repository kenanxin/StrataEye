const RISK_META = [
  ['green', '低风险', '#50c878'],
  ['yellow', '一般风险', '#f2b84b'],
  ['orange', '较大风险', '#ef8f4e'],
  ['red', '重大风险', '#f05b5b'],
];

const round = (value, digits = 2) => {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
};

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower), 3);
}

function correlation(left, right) {
  const pairs = left.map((value, index) => [Number(value), Number(right[index])])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pairs.length < 3) return 0;
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  const numerator = pairs.reduce((sum, pair) => sum + ((pair[0] - leftMean) * (pair[1] - rightMean)), 0);
  const leftVariance = pairs.reduce((sum, pair) => sum + ((pair[0] - leftMean) ** 2), 0);
  const rightVariance = pairs.reduce((sum, pair) => sum + ((pair[1] - rightMean) ** 2), 0);
  return leftVariance && rightVariance ? round(numerator / Math.sqrt(leftVariance * rightVariance), 3) : 0;
}

function featureSchema(current, history) {
  return (history?.feature_schema || current?.feature_schema || []).filter((item) => item.key !== 'data_quality').slice(0, 7);
}

function currentFeatureRows(current, schema) {
  return schema.map((feature, index) => ({
    key: feature.key,
    label: feature.label || feature.key,
    unit: feature.unit || '',
    value: Number(current?.metrics?.[feature.key]?.value),
    standardized: Number(current?.metrics?.[feature.key]?.standardized_value ?? current?.feature_evidence?.find((item) => item.key === feature.key)?.standardized_value),
    contribution: Number(current?.risk?.contribution?.[feature.key] || 0),
    fallbackIndex: index,
  }));
}

function buildHistoryRows(history, schema) {
  return (history?.points || []).map((point) => schema.map((feature) => {
    const metric = point.metrics?.[feature.key];
    return {
      value: Number(metric?.value),
      standardized: Number(metric?.standardized_value),
    };
  }));
}

export function buildExpertResearchModel({ current = {}, history = {}, events = {}, analytics = {} } = {}) {
  const schema = featureSchema(current, history);
  const rows = buildHistoryRows(history, schema);
  const currentRows = currentFeatureRows(current, schema);
  const sourceAnalytics = analytics?.sampleCount ? analytics : (history?.analytics || {});
  const sampleCount = Number(sourceAnalytics.sampleCount || history?.provenance?.source_row_count || rows.length);
  const classDistribution = sourceAnalytics.classDistribution || {};
  const distribution = RISK_META.map(([key, label, color]) => ({
    key,
    label,
    color,
    count: Number(classDistribution[label] || events?.events?.filter((item) => item.risk_level === key).length || 0),
  }));
  const distributionTotal = distribution.reduce((sum, item) => sum + item.count, 0);
  distribution.forEach((item) => { item.percent = distributionTotal ? round((item.count / distributionTotal) * 100, 1) : 0; });

  const contributions = currentRows.filter((item) => Number.isFinite(item.standardized)).map((item) => ({
    ...item,
    contribution: Number.isFinite(item.standardized) ? Math.abs(item.standardized) : 0,
  })).sort((left, right) => right.contribution - left.contribution).map((item) => ({
    ...item,
    contribution: round(item.contribution, 3),
  }));

  const heatmap = schema.map((rowFeature, rowIndex) => schema.map((columnFeature, columnIndex) => ({
    x: columnIndex,
    y: rowIndex,
    value: sourceAnalytics.correlations?.[rowIndex]?.[columnIndex] ?? (rowIndex === columnIndex
      ? 1
      : correlation(rows.map((row) => row[rowIndex]?.standardized), rows.map((row) => row[columnIndex]?.standardized))),
  })));

  const violins = schema.map((feature, index) => {
    const values = rows.map((row) => row[index]?.standardized).filter(Number.isFinite);
    const min = percentile(values, 0);
    const max = percentile(values, 1);
    const binCount = 25;
    const bins = Array.from({ length: binCount }, () => 0);
    if (values.length && Number.isFinite(min) && Number.isFinite(max)) {
      const span = max - min || 1;
      values.forEach((value) => {
        const bin = Math.max(0, Math.min(binCount - 1, Math.floor(((value - min) / span) * binCount)));
        bins[bin] += 1;
      });
    }
    const maxDensity = Math.max(...bins, 1);
    const density = bins.map((value, bin) => {
      const left = bins[bin - 1] || 0;
      const right = bins[bin + 1] || 0;
      return round((left + value * 2 + right) / (maxDensity * 4), 3);
    });
    const sourceDistribution = sourceAnalytics.distributions?.[index];
    return {
      key: feature.key,
      label: feature.label || feature.key,
      values,
      min: sourceDistribution?.min ?? min,
      q1: sourceDistribution?.q1 ?? percentile(values, 0.25),
      median: sourceDistribution?.median ?? percentile(values, 0.5),
      q3: sourceDistribution?.q3 ?? percentile(values, 0.75),
      max: sourceDistribution?.max ?? percentile(values, 1),
      density: sourceDistribution?.density ?? density,
    };
  });

  const trend = (sourceAnalytics.trend || (history?.points || [])).map((point) => ({
    timestamp: point.timestamp,
    score: Number(point.score),
    level: point.level,
  })).filter((point) => Number.isFinite(point.score));

  const clusters = (history?.points || []).map((point, index) => ({
    value: [
      Number(point.metrics?.[schema[0]?.key]?.value),
      Number(point.metrics?.[schema[1]?.key]?.value),
      Number(point.score),
    ],
    label: point.timestamp,
    riskLevel: point.level,
    index,
  })).filter((point) => point.value.every(Number.isFinite));

  const riskLevel = current?.risk?.level || 'green';
  const currentScore = Number(current?.risk?.score);
  const explanation = {
    evidence: contributions.filter((item) => item.contribution > 0).slice(0, 4),
    rule: current?.risk?.explanation || '等待当前真实记录的风险判别依据。',
    mechanism: contributions.length
      ? `${contributions.slice(0, 3).map((item) => item.label).join('、')}的标准化偏离共同构成当前风险证据，需结合时间趋势与支护状态进行复核。`
      : '当前记录暂无足够特征证据。',
    conclusion: Number.isFinite(currentScore)
      ? `当前综合风险分为 ${currentScore}，对应${RISK_META.find(([key]) => key === riskLevel)?.[1] || '待判定'}。`
      : '当前风险结论等待真实数据。',
  };

  return {
    sampleCount,
    sourceName: sourceAnalytics.sourceName || history?.provenance?.source_name || 'teacher_roof_monitoring.csv',
    modelAccuracy: Number(sourceAnalytics.modelAccuracy),
    modelMacroF1: Number(sourceAnalytics.modelMacroF1),
    riskLevel,
    currentScore,
    schema,
    distribution,
    contributions,
    heatmap,
    violins,
    trend,
    clusters,
    currentProfile: currentRows.map((item) => ({ label: item.label, value: Number.isFinite(item.standardized) ? round(item.standardized, 3) : 0 })),
    explanation,
  };
}
