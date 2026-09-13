import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function readJpegSize(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    const length = bytes.readUInt16BE(offset + 2);
    offset += length + 2;
  }
  throw new Error('JPEG size marker not found');
}

test('login form is labeled, accessible, and does not ask users to choose a role', () => {
  const html = read('login.html');
  const css = read('css/login.css');
  assert.match(html, /id="loginForm"/);
  assert.match(html, /label for="username"/);
  assert.match(html, /autocomplete="username"/);
  assert.match(html, /label for="password"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /id="togglePassword"/);
  assert.match(html, /id="loginError"[^>]*role="alert"/);
  assert.doesNotMatch(html, /name="role"|data-role-option|角色选择/);
  assert.match(css, /images\/login-underground\.jpg/);
  assert.match(html, /css\/login\.css/);
  assert.match(html, /js\/login\.js/);
});

test('login script posts credentials and maps actionable error states', () => {
  const script = read('js/login.js');
  assert.match(script, /fetch\(['"]\/api\/auth\/login['"]/);
  assert.match(script, /method:\s*['"]POST['"]/);
  assert.match(script, /JSON\.stringify\(\{ username, password \}\)/);
  assert.match(script, /INVALID_CREDENTIALS/);
  assert.match(script, /RATE_LIMITED/);
  assert.match(script, /\/api\/auth\/session/);
  assert.doesNotMatch(script, /localStorage|sessionStorage/);
});

test('login script allows super administrators to use the backend admin portal URL', () => {
  const script = read('js/login.js');
  assert.match(script, /allowed\s*=\s*new Set\(\[[^\]]*['"]super_admin['"]/s);
  assert.match(script, /window\.location\.replace\(payload\.portalUrl/);
});

test('login and portal clients accept viewer as a read-only expert-layout role', async () => {
  const loginScript = read('js/login.js');
  assert.match(loginScript, /['"]viewer['"]/);

  const { portalUrlForRole } = await import('../js/auth-client.mjs');
  const viewerUrl = portalUrlForRole('viewer', {
    pathname: '/',
    search: '?scene=v2&view=underground&field=risk&portal=viewer',
    hash: '',
  });
  assert.equal(viewerUrl, '/?scene=v2&view=underground&field=risk&portal=expert');
});

test('login background is a local non-empty raster asset', () => {
  const imagePath = path.join(ROOT, 'images', 'login-underground.jpg');
  const capturePath = path.join(ROOT, 'tools', 'capture-login-background.cjs');
  assert.equal(fs.existsSync(imagePath), true);
  assert.ok(fs.statSync(imagePath).size > 50_000);
  assert.deepEqual(readJpegSize(imagePath), { width: 1600, height: 1000 });
  assert.equal(fs.existsSync(capturePath), true);

  const capture = fs.readFileSync(capturePath, 'utf8');
  assert.match(capture, /viewport:\s*\{\s*width:\s*1600,\s*height:\s*1000/);
  assert.match(capture, /#threeContainer canvas/);
  assert.match(capture, /\.mine-v2-label/);
  assert.match(capture, /scene=v2&view=underground/);
  assert.doesNotMatch(capture, /field=risk/);
  assert.match(capture, /type:\s*['"]jpeg['"]/);
});

test('application header exposes identity and logout instead of a portal switch', () => {
  const html = read('index.html');
  assert.match(html, /id="authDisplayName"/);
  assert.match(html, /id="authRole"/);
  assert.match(html, /id="logoutButton"/);
  assert.doesNotMatch(html, /id="portalSwitch"|data-portal=/);
});

test('final dashboard exposes only the underground digital twin', () => {
  const html = read('index.html');
  const mainScript = read('js/main.js');
  const sceneScript = read('js/scene.js');
  const mineV2Script = read('js/scene/mine-v2/mine-v2.js');
  assert.doesNotMatch(html, /data-view="surface"|id="viewToggle"|>地表</);
  assert.doesNotMatch(mainScript, /switchToSurface|dataset\.view === 'surface'/);
  assert.doesNotMatch(sceneScript, /export function switchToSurface|requestedView === 'surface'/);
  assert.doesNotMatch(mineV2Script, /surface-campus|terrain\.js|surfaceRoot|buildSurfaceCampus|buildTerrain/);
});

test('dashboard self-hosts the patched ECharts release consistently', () => {
  const html = read('index.html');
  const packageJson = JSON.parse(read('package.json'));
  const vendorPath = path.join(ROOT, 'js/vendor/echarts.min.js');
  assert.match(html, /\.\/js\/vendor\/echarts\.min\.js/);
  assert.ok(fs.statSync(vendorPath).size > 1_000_000);
  assert.equal(packageJson.dependencies.echarts, '^6.1.0');
});

test('application bootstraps from the session before initializing protected features', () => {
  const script = read('js/main.js');
  assert.match(script, /from ['"]\.\/auth-client\.mjs['"]/);
  assert.match(script, /await bootstrapAuthenticatedPortal\(\)/);
  assert.match(script, /await initApp\(session\.user\)/);
  assert.doesNotMatch(script, /setupPortalSwitch/);
  assert.doesNotMatch(script, /params\.set\(['"]portal['"]/);
  assert.doesNotMatch(script, /fetch\(['"]\/api\/roof-risk/);
  assert.match(script, /authFetch\(['"]\/api\/roof-risk/);
});

test('auth client owns role URLs, unauthorized redirects, logout, and action visibility', () => {
  const script = read('js/auth-client.mjs');
  assert.match(script, /enterprise/);
  assert.match(script, /regulator/);
  assert.match(script, /expert/);
  assert.match(script, /portal.*role/i);
  assert.match(script, /response\.status === 401/);
  assert.match(script, /\/api\/auth\/logout/);
  assert.match(script, /data-loop-action/);
  assert.doesNotMatch(script, /localStorage|sessionStorage/);
});

test('main application initializes the warning demo after authentication', () => {
  const script = read('js/main.js');
  assert.match(script, /setupWarningDemo/);
  assert.match(script, /getWarningDemoAdviceContext/);
  assert.match(script, /authenticatedUser/);
});

test('admin page protects the current super administrator and supports password reset', () => {
  const html = read('admin.html');
  const script = read('js/admin.js');
  assert.match(html, /id="resetDialog"/);
  assert.match(html, /id="resetPassword"[^>]*minlength="8"/);
  assert.match(script, /user\.isSelf/);
  assert.match(script, /超级管理员/);
  assert.match(script, /reset-password/);
  assert.match(script, /escapeHtml/);
  assert.match(script, /const form = event\.currentTarget/);
  assert.doesNotMatch(script, /await api\([^;]+;\s*event\.currentTarget\.reset\(\)/s);
});
