export function adviceSourceLabel(result = {}) {
  result ||= {};
  if (result.source !== 'deepseek') return '规则回退';
  return result.delivery === 'cache' ? 'DeepSeek 历史结果' : 'DeepSeek 实时生成';
}

export function adviceNotice(result = {}) {
  result ||= {};
  const labels = { not_configured: '未配置API', provider_http_error: '上游接口返回错误', provider_timeout: 'DeepSeek未在等待上限内返回完整结果',
    provider_unavailable: 'DeepSeek连接暂不可用', invalid_provider_json: '返回格式未通过校验', invalid_provider_advice: '引用或数值内容未通过校验',
    empty_provider_response: '上游返回空内容', provider_incomplete: '上游生成未完整结束，未采用该结果', provider_response_too_large: '返回内容超过安全上限' };
  const parts = [];
  if (result.delivery === 'cache') parts.push('同证据已验证结果，非本次实时调用');
  const at = result.generated_at || result.generatedAt;
  if (result.source === 'deepseek' && Number.isFinite(Date.parse(at))) parts.push(`原生成时间 ${new Date(at).toLocaleString('zh-CN', { hour12: false })}`);
  if (result.fallback_reason) parts.push(labels[result.fallback_reason] || '建议服务暂不可用');
  if (result.diagnostics?.phase === 'reading_body' && result.fallback_reason === 'provider_timeout') parts.push('已连接，等待生成正文超时');
  return parts.join(' · ');
}

export async function requestAdvice(authFetch, url, init, { timeoutMs = 110000, onWait = () => {} } = {}) {
  const controller = new AbortController();
  let deadlineTimer, waitTimer;
  const deadline = new Promise((_, reject) => { deadlineTimer = setTimeout(() => {
    controller.abort(); reject(new Error('建议请求等待超时；当前数据和曲线不受影响，请稍后手动重试'));
  }, timeoutMs); });
  waitTimer = setTimeout(() => onWait(), 10000);
  try {
    return await Promise.race([(async () => {
      const response = await authFetch(url, { ...init, signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
      return result;
    })(), deadline]);
  } finally { clearTimeout(deadlineTimer); clearTimeout(waitTimer); }
}
