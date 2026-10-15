'use strict';

// Explicit, one-request diagnostics. Run from the repository root with
// node --env-file=.env.local tools/diagnose-deepseek.cjs minimal --allow-generation
// Never prints a credential, request body, provider text, or raw error message.
const { createExpertAdviceService } = require('../server/expert-advice-service.js');
const { createSupportSimulationService } = require('../server/support-simulation-service.js');

const mode = process.argv[2];
const endpoint = process.env.DEEPSEEK_API_ENDPOINT || 'https://api.deepseek.com/chat/completions';
const model = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const allowedModels = new Set(['deepseek-flash', 'deepseek-v4-pro']);
const timeoutMs = 65000;
let requestCount = 0;
const started = performance.now();
const emit = (event, fields = {}) => console.log(JSON.stringify({ event, elapsed_ms: Math.round(performance.now() - started), ...fields }));

function errorType(error) {
  if (['AbortError', 'TimeoutError'].includes(error?.name)) return 'timeout';
  const code = error?.cause?.code || error?.code;
  return ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code) ? code : 'request_failed';
}

async function observedFetch(url, request) {
  if (++requestCount > 1) throw new Error('Diagnostic request budget exceeded');
  const sent = JSON.parse(request.body);
  emit('request_started', { mode, model: sent.model, body_bytes: Buffer.byteLength(request.body), message_count: sent.messages.length,
    max_tokens: sent.max_tokens, thinking_disabled: sent.thinking?.type === 'disabled', json_mode: sent.response_format?.type === 'json_object' });
  let phase = 'awaiting_headers';
  let timer;
  try {
    const response = await fetch(url, request);
    phase = 'reading_body';
    emit('headers_received', { status: response.status, json_content_type: (response.headers.get('content-type') || '').includes('application/json') });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '', bytes = 0, chunks = 0, whitespaceChunks = 0, firstNonWhitespace = null;
    timer = setInterval(() => emit('body_progress', { bytes, chunks, whitespace_chunks: whitespaceChunks, non_whitespace_seen: firstNonWhitespace !== null }), 15000);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = decoder.decode(value, { stream: true });
      bytes += value.byteLength;
      chunks++;
      if (!part.trim()) whitespaceChunks++;
      if (part.trim() && firstNonWhitespace === null) {
        firstNonWhitespace = Math.round(performance.now() - started);
        emit('body_first_non_whitespace', { chunk_bytes: value.byteLength });
      }
      if (chunks === 1) emit('body_first_chunk', { bytes: value.byteLength, whitespace_only: !part.trim() });
      if (bytes > 1024 * 1024) { await reader.cancel(); phase = 'body_too_large'; throw new Error('Diagnostic response size limit'); }
      text += part;
    }
    text += decoder.decode();
    phase = 'parsing_json';
    let payload;
    try { payload = JSON.parse(text); }
    catch { emit('body_invalid_json', { bytes, chunks, whitespace_chunks: whitespaceChunks }); throw new Error('Invalid response JSON'); }
    const choice = payload.choices?.[0];
    if (mode === 'rag' && typeof choice?.message?.content === 'string') {
      try {
        const proposal = JSON.parse(choice.message.content);
        const fields = [{ field: 'summary', text: proposal.summary }, ...(Array.isArray(proposal.recommendations) ? proposal.recommendations.map((text, index) => ({ field: 'recommendations', index, text })) : [])];
        const knownPhrases = ['同一', '单一', '两者', '一方面', '另一', '一并', '一起', '一同', '一侧'];
        emit('proposal_quantity_scan', { fields: fields.filter(item => typeof item.text === 'string').map(item => ({ field: item.field, index: item.index,
          known_phrase_hits: knownPhrases.filter(word => item.text.includes(word)),
          has_arabic_number: /\p{N}/u.test(item.text),
          chinese_quantity_characters: [...new Set(item.text.replace(/进一步|一致|统一|一旦|一般风险/g, ' ').match(/[零〇一二三四五六七八九十百千万亿兆两半廿卅卌壹贰叁肆伍陆柒捌玖拾佰仟]/gu) || [])] })) });
      } catch { /* No raw provider text in diagnostics. */ }
    }
    const safeFinishReasons = new Set(['stop', 'length', 'content_filter', 'tool_calls', 'insufficient_system_resource', 'aborted']);
    emit('body_complete', { status: response.status, bytes, chunks, whitespace_chunks: whitespaceChunks,
      finish_reason: safeFinishReasons.has(choice?.finish_reason) ? choice.finish_reason : null,
      content_chars: typeof choice?.message?.content === 'string' ? choice.message.content.length : 0,
      reasoning_chars: typeof choice?.message?.reasoning_content === 'string' ? choice.message.reasoning_content.length : 0,
      total_tokens: Number.isFinite(payload.usage?.total_tokens) ? payload.usage.total_tokens : null,
      provider_error_present: Boolean(payload.error) });
    return { ok: response.ok, status: response.status, json: async () => payload };
  } catch (error) {
    emit('transport_failed', { phase, error_type: errorType(error) });
    throw error;
  } finally { clearInterval(timer); }
}

async function main() {
  if (!['minimal', 'minimal-text', 'rag'].includes(mode) || !process.argv.includes('--allow-generation')) {
    emit('refused', { reason: 'explicit_mode_and_generation_authorization_required' }); process.exitCode = 2; return;
  }
  if (!process.env.DEEPSEEK_API_KEY || endpoint !== 'https://api.deepseek.com/chat/completions' || !allowedModels.has(model)) {
    emit('refused', { reason: 'missing_key_or_nonapproved_endpoint_or_model' }); process.exitCode = 2; return;
  }
  if (mode === 'rag') {
    const adviceService = createExpertAdviceService({ timeoutMs, fetchImpl: observedFetch, cacheDirectory: require('node:path').resolve('.runtime/expert-advice-cache') });
    const result = await createSupportSimulationService({ adviceService }).explain({ caseId: 'soft-support', step: 20 });
    emit('workflow_result', { source: result.advice.source, delivery: result.advice.delivery, generated_at: result.advice.generated_at, fallback_reason: result.advice.fallback_reason,
      validation_errors: result.advice.validation_errors, evidence_ids: result.advice.evidence_ids,
      retrieval_count: result.retrieval.chunks.length, business_event_created: result.business_event_created });
    process.exitCode = result.advice.source === 'deepseek' ? 0 : 1;
    return;
  }
  const jsonMode = mode === 'minimal';
  const response = await observedFetch(endpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model, thinking: { type: 'disabled' }, max_tokens: 32, temperature: 0.2,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'user', content: jsonMode ? 'Return only JSON: {"ok":true}' : 'Reply only OK.' }] }) });
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  let expected = content?.trim() === 'OK';
  if (jsonMode) { try { expected = JSON.parse(content).ok === true; } catch { expected = false; } }
  emit('minimal_result', { status: response.status, expected_content: expected });
  process.exitCode = response.ok && expected ? 0 : 1;
}

if (require.main === module) main().catch(error => { emit('diagnostic_failed', { error_type: errorType(error) }); process.exitCode = 1; });
