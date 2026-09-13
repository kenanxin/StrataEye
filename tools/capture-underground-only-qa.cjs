'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const baseUrl = process.argv[2] || 'http://127.0.0.1:52353';
const outputDir = path.resolve(process.argv[3] || 'tools/.generated/underground-only');

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    proxy: { server: process.env.UNDERGROUND_QA_PROXY || 'http://127.0.0.1:7897', bypass: '127.0.0.1,localhost' },
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() }); });

  const loginResponse = await context.request.post(`${baseUrl}/api/auth/login`, {
    data: {
      username: process.env.ENTERPRISE_QA_USERNAME || 'enterprise_operator',
      password: process.env.ENTERPRISE_QA_PASSWORD || 'Mine@2026',
    },
  });
  if (!loginResponse.ok()) throw new Error(`QA login failed with HTTP ${loginResponse.status()}`);

  await page.goto(`${baseUrl}/?scene=v2&view=surface&field=risk&portal=enterprise`, { waitUntil: 'commit', timeout: 30_000 });
  try {
    await page.waitForFunction(() => typeof window.__mineCameraState === 'function', null, { timeout: 90_000 });
  } catch (error) {
    const diagnostics = {
      url: page.url(),
      title: await page.title(),
      bodyState: await page.locator('body').getAttribute('data-auth-state'),
      pageErrors,
      consoleErrors,
      failedResponses,
    };
    await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: false });
    throw new Error(`Scene bootstrap timeout: ${JSON.stringify(diagnostics)}; ${error.message}`);
  }
  await page.waitForFunction(() => window.__mineCameraState?.().viewMode === 'underground', null, { timeout: 90_000 });
  await page.locator('.mine-load-status').waitFor({ state: 'detached', timeout: 90_000 });

  const report = await page.evaluate(() => ({
    url: location.href,
    viewMode: window.__mineCameraState?.().viewMode,
    surfaceButtons: document.querySelectorAll('[data-view="surface"]').length,
    surfaceRoots: document.querySelectorAll('[data-scene-root="surface"]').length,
    title: document.title,
  }));
  if (report.viewMode !== 'underground') throw new Error(`Expected underground view, received ${report.viewMode}`);
  if (report.surfaceButtons || report.surfaceRoots) throw new Error(`Surface UI/runtime remains: ${JSON.stringify(report)}`);
  const actionableConsoleErrors = consoleErrors.filter(message => !message.includes('status of 404'));
  if (pageErrors.length || actionableConsoleErrors.length || failedResponses.length) {
    throw new Error(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors, failedResponses })}`);
  }

  const screenshot = path.join(outputDir, 'underground-only-chrome.png');
  await page.screenshot({ path: screenshot, fullPage: false });
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify({ ...report, pageErrors, consoleErrors, failedResponses, screenshot }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ ...report, pageErrors, consoleErrors, failedResponses, screenshot }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
