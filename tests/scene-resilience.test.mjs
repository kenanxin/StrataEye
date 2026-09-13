import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sceneSource = fs.readFileSync(path.join(ROOT, 'js', 'scene.js'), 'utf8');

test('an unavailable HDR environment cannot abort mine scene construction', () => {
  assert.match(sceneSource, /mineEnvironment\s*=\s*await loadMineEnvironment\(\)/);
  assert.match(sceneSource, /async function loadMineEnvironment\(\)[\s\S]*catch \(error\)[\s\S]*return null;/);
  assert.match(sceneSource, /signature\.startsWith\('#\?RADIANCE'\)/);
  assert.match(sceneSource, /HDR response is not a Radiance image/);
  assert.match(sceneSource, /const mine = await buildMineV2\(materials\)/);
  assert.doesNotMatch(sceneSource, /buildIntegratedMine/);

  const environmentLoad = sceneSource.indexOf('mineEnvironment = await loadMineEnvironment()');
  const mineBuild = sceneSource.indexOf('const mine = await buildMineV2(materials)');
  assert.ok(environmentLoad >= 0 && mineBuild > environmentLoad);
});

test('underground view has a dark background fallback when the HDR is unavailable', () => {
  assert.match(sceneSource, /new THREE\.Color\(0x151310\)/);
  assert.doesNotMatch(sceneSource, /switchToSurface|requestedView === 'surface'/);
});
