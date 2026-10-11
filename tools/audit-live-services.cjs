'use strict';

// Isolated HTTP contexts: never saves cookies, credentials or provider content.
const fs = require('node:fs');
const path = require('node:path');
const { request } = require('C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.argv[2] || 'https://smart-mine-v2-balanced.vercel.app';
const output = process.argv[3] || 'docs/qa/2026-10-11-live-services.json';
const RECORD = 'REC-202511101149-02909';

async function main() {
  const evidence = { checked_at: new Date().toISOString(), base_url: base, roles: {} };
  for (const role of ['enterprise', 'regulator', 'expert']) {
    const prefix = role.toUpperCase();
    const username = process.env[`${prefix}_QA_USERNAME`];
    const password = process.env[`${prefix}_QA_PASSWORD`];
    if (!username || !password) throw new Error(`Set ${prefix}_QA_USERNAME and ${prefix}_QA_PASSWORD`);
    const context = await request.newContext({ baseURL: base, timeout: 120_000, proxy: { server: process.env.THREE_PORTAL_QA_PROXY || 'http://127.0.0.1:7897', bypass: 'localhost,127.0.0.1' } });
    const roleEvidence = {};
    evidence.roles[role] = roleEvidence;
    try {
      const login = await context.post('/api/auth/login', { data: { username, password } });
      roleEvidence.login_http = login.status();
      if (!login.ok()) { roleEvidence.login_error = (await login.json()).error?.code; console.log(JSON.stringify({ role, evidence: roleEvidence })); continue; }
      const session = await context.get('/api/auth/session');
      const user = await session.json();
      roleEvidence.session_http = session.status();
      roleEvidence.actual_role = user.user?.role;
      const currentResponse = await context.get('/api/roof-risk/current');
      const current = await currentResponse.json();
      roleEvidence.current_http = currentResponse.status();
      roleEvidence.data_source = current.data_source || current.provenance?.data_source;
      if (role === 'enterprise') {
        const statusResponse = await context.get('/api/multi-agent/status');
        roleEvidence.agent_status_http = statusResponse.status();
        if (statusResponse.ok()) {
          evidence.agent_runtime = await statusResponse.json();
          const runResponse = await context.post('/api/multi-agent/run', { data: { record_id: RECORD } });
          evidence.agent_run_http = runResponse.status();
          if (runResponse.ok()) {
            const run = await runResponse.json();
            evidence.six_agent_run = run;
            const shortage = await context.post('/api/multi-agent/run', { data: { record_id: RECORD, resource_snapshot: { personnel_available: 0, support_material_sets: 0, inspection_devices: 0 } } });
            evidence.shortage = await shortage.json();
            evidence.reflection_branches = {};
            for (const [name, feedback] of Object.entries({ pending: {}, monitoring: { monitoring_trend: 'worsened' }, execution: { execution_status: 'failed' }, resource: { resource_changed: true }, notification: { notification_failed: true } })) {
              const result = await context.post('/api/multi-agent/reflect', { data: { run, feedback } });
              evidence.reflection_branches[name] = await result.json();
            }
          }
        }
      }
      if (role === 'expert') {
        const configured = await context.get('/api/roof-risk/expert-advice/status');
        evidence.deepseek_config = await configured.json();
        if (evidence.deepseek_config.configured) {
          const start = performance.now();
          const response = await context.post('/api/roof-risk/expert-advice', { data: { recordId: current.provenance?.record_id, risk: current.risk, model: current.model_output, evidence: current.feature_evidence } });
          const result = await response.json();
          evidence.deepseek_call = { http: response.status(), elapsed_ms: Math.round(performance.now() - start), source: result.source, fallback_reason: result.fallback_reason, provider_status: result.provider_status, has_summary: Boolean(result.summary), recommendation_count: result.recommendations?.length };
        }
      }
      await context.post('/api/auth/logout');
    } catch {
      roleEvidence.request_error = 'network_or_protocol_error';
    } finally { await context.dispose(); }
    console.log(JSON.stringify({ role, evidence: evidence.roles[role] }));
  }
  evidence.failures = Object.entries(evidence.roles).flatMap(([role, result]) => {
    if (result.login_http !== 200) return [`${role}: login failed`];
    if (result.actual_role !== role) return [`${role}: role mismatch`];
    if (result.current_http !== 200 || result.request_error) return [`${role}: API check incomplete`];
    return [];
  });
  if (!evidence.six_agent_run?.nodes?.length) evidence.failures.push('six-agent execution not verified');
  evidence.status = evidence.failures.length ? 'FAIL' : 'PASS';
  evidence.deepseek_verification = evidence.deepseek_call?.source === 'deepseek' ? 'verified_provider_response'
    : evidence.deepseek_call ? 'local_fallback' : evidence.deepseek_config?.configured === false ? 'not_configured' : 'not_verified';
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: evidence.status, output, deepseek: evidence.deepseek_verification, agent_http: evidence.agent_run_http }));
  if (evidence.status === 'FAIL') process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
