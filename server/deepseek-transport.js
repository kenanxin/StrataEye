'use strict';

// Only allowlisted scalar diagnostics leave this module; never error text,
// authorization headers, prompts or the provider's unvalidated response body.
async function requestDeepSeek({ fetchImpl, endpoint, apiKey, body, timeoutMs }) {
  const started = performance.now(), controller = new AbortController();
  let phase = 'awaiting_headers', httpStatus = null, bodyBytes = 0, headerMs = null, firstBodyMs = null, timer;
  const diagnostics = () => ({ phase, elapsed_ms: Math.round(performance.now() - started), http_status: httpStatus,
    headers_ms: headerMs, first_body_ms: firstBodyMs, body_bytes: bodyBytes });
  const failed = reason => ({ ok: false, reason, diagnostics: diagnostics() });
  const work = (async () => {
    try {
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: controller.signal, body: JSON.stringify(body) });
      httpStatus = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
      headerMs = Math.round(performance.now() - started);
      if (!response.ok) { controller.abort(); return failed('provider_http_error'); }
      phase = 'reading_body';
      let payload;
      if (response.body?.getReader) {
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let text = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          firstBodyMs ??= Math.round(performance.now() - started);
          bodyBytes += value.byteLength;
          if (bodyBytes > 262144) { controller.abort(); reader.cancel().catch(() => {}); return failed('provider_response_too_large'); }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode(); phase = 'parsing_json';
        try { payload = JSON.parse(text); } catch { return failed('invalid_provider_json'); }
      } else {
        // Injected/test fetch adapters may expose only json(). The same global
        // deadline still bounds a stalled body parser which ignores abort.
        payload = await response.json();
      }
      phase = 'complete';
      return { ok: true, payload, diagnostics: diagnostics() };
    } catch (error) {
      return failed(controller.signal.aborted || ['AbortError', 'TimeoutError'].includes(error?.name) ? 'provider_timeout' : 'provider_unavailable');
    }
  })();
  const deadline = new Promise(resolve => { timer = setTimeout(() => {
    const result = failed('provider_timeout'); controller.abort(); resolve(result);
  }, timeoutMs); });
  try { return await Promise.race([work, deadline]); } finally { clearTimeout(timer); }
}

module.exports = { requestDeepSeek };
