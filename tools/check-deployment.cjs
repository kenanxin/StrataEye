'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { request } = require('C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = process.argv[2] || 'docs/qa/2026-10-11-deployment.json';
const hash = value => crypto.createHash('sha256').update(String(value).replace(/\r\n/g, '\n')).digest('hex');

async function main() {
  const report = { checked_at: new Date().toISOString(), hash_normalization: 'LF line endings', endpoints: {}, assets: {}, local_assets: {} };
  const context = await request.newContext({ timeout: 55_000, proxy: { server: process.env.THREE_PORTAL_QA_PROXY || 'http://127.0.0.1:7897' } });
  try {
    for (const [name, url] of Object.entries({ frontend: 'https://smart-mine-v2-balanced.vercel.app/login', backend: 'https://smart-mine-v2-balanced.onrender.com/healthz' })) {
      const start = performance.now();
      try {
        const response = await context.get(url);
        report.endpoints[name] = { url, http: response.status(), elapsed_ms: Math.round(performance.now() - start) };
        if (name === 'backend' && response.ok()) report.endpoints[name].health = await response.json();
      } catch { report.endpoints[name] = { url, error: 'request_failed', elapsed_ms: Math.round(performance.now() - start) }; }
    }
    await Promise.all(['js/scene.js', 'js/main.js', 'js/multi-agent-workflow-ui.mjs'].map(async asset => {
      report.local_assets[asset] = hash(fs.readFileSync(asset));
      for (const [name, base] of Object.entries({ frontend: 'https://smart-mine-v2-balanced.vercel.app', backend: 'https://smart-mine-v2-balanced.onrender.com' })) {
        try {
          const response = await context.get(`${base}/${asset}`);
          const text = await response.text();
          report.assets[`${name}/${asset}`] = { http: response.status(), sha256: hash(text), matches_local: hash(text) === report.local_assets[asset] };
          if (asset === 'js/scene.js') report.assets[`${name}/${asset}`].contains_surface_switch = text.includes('function switchToSurface');
        } catch { report.assets[`${name}/${asset}`] = { error: 'request_failed' }; }
      }
    }));
  } finally { await context.dispose(); }
  report.backend_verified_release = report.endpoints.backend?.health?.release === 'competition-audit-v1';
  report.frontend_verified_release = Object.entries(report.assets).filter(([name]) => name.startsWith('frontend/')).every(([, asset]) => asset.matches_local === true);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
