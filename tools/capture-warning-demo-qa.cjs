'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const baseUrl = process.argv[2] || 'http://127.0.0.1:8094';
const outputDir = path.resolve(process.argv[3] || 'tools/.generated/warning-demo');
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const evidencePath = path.resolve('images/login-underground.jpg');

const accounts = {
  enterprise: [process.env.ENTERPRISE_QA_USERNAME || 'enterprise_operator', process.env.ENTERPRISE_QA_PASSWORD || 'Mine@2026'],
  regulator: [process.env.REGULATOR_QA_USERNAME || 'regulator_officer', process.env.REGULATOR_QA_PASSWORD || 'Safe@2026'],
  expert: [process.env.EXPERT_QA_USERNAME || 'expert_analyst', process.env.EXPERT_QA_PASSWORD || 'Model@2026'],
};

async function login(page, role) {
  const [username, password] = accounts[role];
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 90_000 }),
    page.locator('#loginSubmit').click(),
  ]);
  await page.waitForTimeout(1000);
  console.log(JSON.stringify({ role, url: page.url(), demoState: await page.locator('body').getAttribute('data-warning-demo-state') }));
  await page.waitForFunction(() => Boolean(document.body.dataset.warningDemoState));
  await page.locator('#warningDemoStrip').waitFor({ state: 'visible' });
  if (role === 'enterprise') await waitForCameraStable(page);
}

async function logout(page) {
  await Promise.all([
    page.waitForURL((url) => url.pathname.endsWith('/login'), { timeout: 30_000 }),
    page.locator('#logoutButton').click(),
  ]);
}

async function status(page, expected) {
  await page.waitForFunction((value) => document.body.dataset.warningDemoState === value, expected);
  return page.locator('#warningDemoStatus').innerText();
}

async function waitForCameraStable(page) {
  await page.waitForFunction(() => Boolean(document.querySelector('#threeContainer')?.dataset.cameraPosition), null, { timeout: 90_000 });
  let previous = null;
  let stableSamples = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await page.locator('#threeContainer').evaluate((element) => ({
      position: element.dataset.cameraPosition,
      target: element.dataset.cameraTarget,
    }));
    if (previous?.position === current.position && previous?.target === current.target) stableSamples += 1;
    else stableSamples = 0;
    if (stableSamples >= 3) return current;
    previous = current;
    await page.waitForTimeout(200);
  }
  throw new Error('Three.js camera did not settle before warning workflow');
}

async function screenshot(page, name, selector) {
  const filePath = path.join(outputDir, `${name}.png`);
  if (selector) await page.locator(selector).screenshot({ path: filePath });
  else await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function layoutReport(page, selectors) {
  return page.evaluate((targets) => {
    const visibleRects = targets.flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { selector: element.id ? `#${element.id}` : element.className, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      })
      .filter((rect) => rect.right - rect.left > 2 && rect.bottom - rect.top > 2);
    const overlaps = [];
    for (let left = 0; left < visibleRects.length; left += 1) {
      for (let right = left + 1; right < visibleRects.length; right += 1) {
        const a = visibleRects[left];
        const b = visibleRects[right];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) overlaps.push([a.selector, b.selector]);
      }
    }
    return {
      viewport: [innerWidth, innerHeight],
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      overlaps,
      rects: visibleRects,
    };
  }, selectors);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    proxy: { server: process.env.THREE_PORTAL_QA_PROXY || 'http://127.0.0.1:7897', bypass: '127.0.0.1,localhost' },
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
  });
  const evidence = {};

  try {
    await login(page, 'enterprise');
    await status(page, 'ready');
    const cameraBefore = await waitForCameraStable(page);
    await page.locator('#warningDemoLauncher').click();
    await status(page, 'alert_triggered');
    await page.locator('#enterpriseWarningDialog').waitFor({ state: 'visible' });
    evidence.enterpriseAlert = await screenshot(page, '01-enterprise-orange-alert');
    if ((await page.locator('#enterpriseWarningRecord').innerText()) !== 'REC-202511101149-02909') throw new Error('trigger record id did not render');

    await page.locator('#warningDialogAcknowledge').click();
    await status(page, 'disposal_in_progress');
    await page.locator('#disposalMeasures').fill('在运输顺槽监测1区域加密锚索，复核支架初撑力并设置警戒区域。');
    await page.locator('#disposalResponsiblePerson').fill('企业值守演示员');
    await page.locator('#disposalPhotos').setInputFiles(evidencePath);
    await page.waitForTimeout(1500);
    await page.locator('#enterprisePhotoList img').waitFor({ state: 'visible' });
    await page.locator('#enterpriseDisposalSubmit').click();
    await status(page, 'pending_review');
    evidence.enterpriseSubmitted = await screenshot(page, '02-enterprise-submitted');
    const cameraAfter = await waitForCameraStable(page);
    if (cameraBefore.position !== cameraAfter.position || cameraBefore.target !== cameraAfter.target) {
      throw new Error('Three.js camera changed during warning workflow');
    }

    await logout(page);
    await login(page, 'regulator');
    await status(page, 'pending_review');
    await page.locator('#regulatorPhotoList img').waitFor({ state: 'visible' });
    evidence.regulatorPending = await screenshot(page, '03-regulator-pending-review');
    const regulatorLayout = await layoutReport(page, ['#regulatorVerificationPanel', '.regulator-grid > .portal-card']);
    await page.locator('#regulatorReviewOpinion').fill('工单已提交，但需补充支架初撑力复测结论。');
    await page.locator('#regulatorRectificationDeadline').fill('2026-09-07T19:00');
    await page.locator('#regulatorRejectAction').click();
    await status(page, 'changes_requested');

    await logout(page);
    await login(page, 'enterprise');
    await status(page, 'changes_requested');
    await page.locator('#warningDemoLauncher').click();
    await page.locator('#enterpriseRectificationNotice').waitFor({ state: 'visible' });
    await page.locator('#disposalMeasures').fill('已加密锚索，完成支架初撑力复测，并补充警戒区域巡查记录。');
    await page.locator('#enterpriseDisposalSubmit').click();
    await status(page, 'pending_review');

    await logout(page);
    await login(page, 'regulator');
    await status(page, 'pending_review');
    await page.locator('#regulatorReviewOpinion').fill('整改材料完整，后续监测真实对照已降至一般风险，同意核验通过。');
    await page.locator('#regulatorApproveAction').click();
    await status(page, 'verified');
    evidence.regulatorVerified = await screenshot(page, '04-regulator-verified');

    await logout(page);
    await login(page, 'expert');
    await status(page, 'verified');
    await page.waitForFunction(() => document.querySelectorAll('#expertSimilarCases article').length === 3);
    evidence.expertReview = await screenshot(page, '05-expert-mechanism-review');
    await page.locator('#runMultiAgentWorkflow').click();
    await page.waitForFunction(() => document.querySelector('#multiAgentSource')?.textContent.includes('XGBOOST'), null, { timeout: 30_000 });
    await page.locator('#multiAgentRail [data-agent-id="A6"]').click();
    const agentStates = await page.locator('#multiAgentRail [data-agent-id]').evaluateAll(elements => elements.map(element => ({ agent: element.dataset.agentId, status: element.dataset.status })));
    if (!agentStates.some(node => node.agent === 'A6' && node.status === 'waiting_human')) throw new Error('A6 must wait for field feedback');
    evidence.sixAgentReflection = await screenshot(page, '07-six-agent-waiting-feedback', '#multiAgentWorkbench');
    const expertLayout = await layoutReport(page, ['#expertDemoEventStrip', '.expert-research-console', '.expert-grid > .portal-card']);
    await page.locator('#expertArchiveAction').click();
    await status(page, 'archived');
    evidence.expertArchived = await screenshot(page, '06-expert-archived');

    const finalState = await page.evaluate(() => JSON.parse(localStorage.getItem('smart-mine-warning-demo:v1')));
    const failures = [];
    if (finalState.status !== 'archived') failures.push('final state is not archived');
    if (finalState.disposal.submissionCount !== 2) failures.push('resubmission count is not 2');
    if (finalState.disposal.photos.length !== 1) failures.push('photo evidence did not persist');
    if (finalState.review.decision !== 'approved') failures.push('regulator approval did not persist');
    if (finalState.timeline.length !== 7) failures.push(`expected 7 timeline entries, got ${finalState.timeline.length}`);
    if (regulatorLayout.documentWidth > regulatorLayout.viewport[0] + 1 || expertLayout.documentWidth > expertLayout.viewport[0] + 1) failures.push('horizontal overflow detected');
    if (regulatorLayout.overlaps.length) failures.push(`regulator overlap: ${JSON.stringify(regulatorLayout.overlaps)}`);
    if (expertLayout.overlaps.length) failures.push(`expert overlap: ${JSON.stringify(expertLayout.overlaps)}`);
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(' | ')}`);
    const unexpectedResponses = failedResponses.filter(({ status, url }) => {
      if (status === 401 && url.startsWith(`${baseUrl}/api/`)) return false;
      if (status === 404 && url === `${baseUrl}/favicon.ico`) return false;
      return true;
    });
    if (unexpectedResponses.length) failures.push(`failed responses: ${JSON.stringify(unexpectedResponses)}`);
    const unexpectedConsole = consoleErrors.filter((message) => !message.startsWith('Failed to load resource:'));
    if (unexpectedConsole.length) failures.push(`console errors: ${unexpectedConsole.join(' | ')}`);

    const result = { status: failures.length ? 'FAIL' : 'PASS', evidence, finalState, agentStates, regulatorLayout, expertLayout, pageErrors, consoleErrors, failedResponses, unexpectedResponses, failures };
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(result, null, 2));
    if (failures.length) throw new Error(failures.join('\n'));
    console.log(JSON.stringify({ status: 'PASS', outputDir, screenshots: Object.keys(evidence).length }));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
