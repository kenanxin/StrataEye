'use strict';

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const RISK_LABELS = { green: '低风险', yellow: '一般风险', orange: '较大风险', red: '重大风险' };

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function localAdvice(input = {}) {
  const risk = input.risk || {};
  const level = String(risk.level || 'green');
  const score = finite(risk.score);
  const evidence = Array.isArray(input.evidence) ? input.evidence.filter(Boolean).slice(0, 5) : [];
  const loop = input.closed_loop || {};
  const labels = evidence.map((item) => item.label || item.key).join('、') || '当前监测指标';
  const actions = level === 'red'
    ? ['立即停止高风险区域作业并组织人员撤离', '复核顶板离层、锚杆锚索受力和支架阻力', '完成现场封控与加固后再申请复工']
    : level === 'orange'
      ? ['提高采样频率并安排现场复测', '检查支护参数和异常指标的同步变化', '将复核结果提交监管端确认']
      : level === 'yellow'
        ? ['保持连续监测并跟踪趋势', '复核异常指标对应的传感器与支护状态', '必要时提高巡检频次']
        : ['维持常态巡检与数据采集', '继续观察关键指标趋势', '保留本次记录作为基线样本'];
  return {
    source: 'local-rule',
    generatedAt: new Date().toISOString(),
    riskLevel: RISK_LABELS[level] || '待判定',
    summary: `当前综合风险${score === null ? '待判定' : `为 ${score} 分`}，主要关注${labels}。${loop.active_step_label ? `当前闭环环节为${loop.active_step_label}。` : ''}`,
    recommendations: actions,
    evidence: evidence.map((item) => `${item.label || item.key}${finite(item.standardized_value) === null ? '' : `（标准化偏离 ${Number(item.standardized_value).toFixed(2)}σ）`}`),
    timeHorizon: level === 'red' ? '立即执行' : level === 'orange' ? '30 分钟内' : '持续观察',
  };
}

function normalizeDeepSeek(payload, fallback) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { summary: content.trim() };
  }
  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations.map(String).filter(Boolean).slice(0, 6)
    : fallback.recommendations;
  return {
    source: 'deepseek',
    generatedAt: new Date().toISOString(),
    riskLevel: String(parsed.riskLevel || fallback.riskLevel),
    summary: String(parsed.summary || fallback.summary),
    recommendations,
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 6) : fallback.evidence,
    timeHorizon: String(parsed.timeHorizon || fallback.timeHorizon),
  };
}

function createExpertAdviceService(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || '';
  const endpoint = options.endpoint || process.env.DEEPSEEK_API_ENDPOINT || DEFAULT_ENDPOINT;
  const model = options.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const timeoutMs = Number(options.timeoutMs || 12000);
  return {
    configured: Boolean(apiKey && typeof fetchImpl === 'function'),
    endpoint,
    async generate(input = {}) {
      const fallback = localAdvice(input);
      if (!apiKey || typeof fetchImpl !== 'function') return { ...fallback, fallback_reason: 'not_configured' };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: '你是煤矿顶板灾变科研专家。仅根据输入的真实监测数据和模型证据输出 JSON，字段为 riskLevel、summary、recommendations、evidence、timeHorizon。不要编造未提供的传感器数据。' },
              { role: 'user', content: JSON.stringify(input) },
            ],
          }),
        });
        if (!response.ok) return { ...fallback, fallback_reason: 'provider_http_error', provider_status: response.status };
        const payload = await response.json();
        return normalizeDeepSeek(payload, fallback) || { ...fallback, fallback_reason: 'empty_provider_response' };
      } catch (error) {
        return { ...fallback, fallback_reason: error.name === 'AbortError' ? 'provider_timeout' : 'provider_unavailable' };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

module.exports = { createExpertAdviceService, localAdvice, normalizeDeepSeek };
