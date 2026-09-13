import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MINE_V2_CONFIG } from '../js/scene/mine-v2/config.mjs';
import { ROADWAY_NODES, ROADWAY_EDGES, ATLAS_EXPOSED_EDGE_IDS, getConnectedNodeIds, sampleEdge } from '../js/scene/mine-v2/topology.mjs';
import { CAMERA_PRESETS, CONTROL_LIMITS } from '../js/scene/mine-v2/camera-presets.mjs';
import { validateTopology } from '../js/scene/mine-v2/validate.mjs';
import { buildMonitorAnchors, getOverviewLabelIds, UNDERGROUND_LABEL_IDS, WORKING_FACE_LABEL_IDS } from '../js/scene/mine-v2/monitor-layout.mjs';
import { MODEL_ASSETS } from '../js/scene/asset-registry.js';
import { createMineV2Simulator } from '../js/scene/mine-v2/simulator.mjs';
import { getMonitorOperationalState, OPERATIONAL_COLORS } from '../js/scene/mine-v2/monitor-state.mjs';
import { UNDERGROUND_ASSET_DEPLOYMENTS } from '../js/scene/mine-v2/underground-asset-layout.mjs';
import { ZONE_PRESETS, ROADWAY_ENTRY_ZONE_IDS, FOCUS_ONLY_ZONE_IDS } from '../js/scene/mine-v2/zone-presets.mjs';
import { EQUIPMENT } from '../js/mine-data.js';
import { EQUIPMENT_FOCUS_ZONES } from '../js/scene/mine-v2/equipment-focus-map.mjs';

test('roof-sensor count excludes people and cameras', () => {
  const anchors = buildMonitorAnchors();
  const sensors = anchors.filter(item => item.category === 'roof-sensor');
  assert.ok(sensors.length >= 12);
  assert.ok(sensors.every(item => !['camera', 'person'].includes(item.type)));
});

test('every monitor anchor has its complete topology and threshold contract', () => {
  for (const anchor of buildMonitorAnchors()) {
    for (const key of ['id', 'category', 'type', 'position', 'unit', 'warn', 'danger']) assert.ok(key in anchor);
    assert.ok('edgeId' in anchor || 'nodeId' in anchor);
    assert.equal(anchor.position.length, 3);
  }
});

test('overview label tier never exceeds ten anchors', () => {
  assert.ok(getOverviewLabelIds(buildMonitorAnchors()).length <= 10);
});

test('underground label tier stays local to the active roadway', () => {
  const anchors = buildMonitorAnchors().filter(anchor => UNDERGROUND_LABEL_IDS.has(anchor.id));
  assert.deepEqual(anchors.map(anchor => anchor.id), ['CH-01', 'CH-02']);
});

test('threshold monitor state colors follow current metric values', () => {
  const anchor = buildMonitorAnchors().find(item => item.id === 'RP-01');
  const state = value => getMonitorOperationalState(anchor, { metrics: { roofPressure: value } });
  assert.deepEqual([state(17).level, state(17).color], ['normal', OPERATIONAL_COLORS.normal]);
  assert.deepEqual([state(23).level, state(23).color], ['warning', OPERATIONAL_COLORS.warning]);
  assert.deepEqual([state(29).level, state(29).color], ['danger', OPERATIONAL_COLORS.danger]);
});

test('working-face label tier is limited to key nearby anchors', () => {
  const anchors = buildMonitorAnchors();
  const labels = anchors.filter(anchor => WORKING_FACE_LABEL_IDS.has(anchor.id));
  assert.ok(labels.length >= 3 && labels.length <= 5);
  assert.deepEqual(labels.map(anchor => anchor.id), ['RP-02', 'RP-04', 'SR-01', 'EQ-STATE-01']);
});

test('same seed produces the same initial state and smooth updates', () => {
  const a = createMineV2Simulator(20260728);
  const b = createMineV2Simulator(20260728);
  assert.deepEqual(a.snapshot(), b.snapshot());
  const before = a.snapshot().metrics.roofPressure;
  const after = a.update(0.5).metrics.roofPressure;
  assert.ok(Math.abs(after - before) < 2);
});

test('approved topology has no missing endpoints and all horizons are reachable', () => {
  const report = validateTopology(ROADWAY_NODES, ROADWAY_EDGES);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unreachableNodeIds, []);
});

test('validator rejects a disconnected edge', () => {
  const report = validateTopology(ROADWAY_NODES, [...ROADWAY_EDGES, { id: 'bad', from: 'missing', to: 'portal' }]);
  assert.ok(report.errors.some(message => message.includes('missing')));
});

test('mine v2 descriptor exposes only underground-related inspection modes', () => {
  assert.deepEqual(Object.keys(CAMERA_PRESETS), ['overview', 'underground', 'exit']);
  assert.deepEqual(Object.keys(CONTROL_LIMITS), ['overview', 'underground', 'exit']);
  assert.ok(CONTROL_LIMITS.overview.maxDistance >= 90);
  assert.equal(CONTROL_LIMITS.underground.minAzimuth, -Infinity);
  assert.equal(CONTROL_LIMITS.underground.maxAzimuth, Infinity);
  assert.deepEqual(CONTROL_LIMITS.exit, CONTROL_LIMITS.underground);
});

test('mine atlas has exactly three enterable roadway zones', () => {
  assert.deepEqual(ROADWAY_ENTRY_ZONE_IDS, ['mainHaulage', 'auxTransport', 'returnAirway']);
  assert.deepEqual(FOCUS_ONLY_ZONE_IDS, ['pumpRoom', 'substation', 'longwall']);
  assert.deepEqual(Object.keys(ZONE_PRESETS), ['atlas', 'mainHaulage', 'auxTransport', 'returnAirway', 'pumpRoom', 'substation', 'longwall']);
  for (const id of ROADWAY_ENTRY_ZONE_IDS) assert.equal(ZONE_PRESETS[id].mode, 'roadway');
  for (const id of FOCUS_ONLY_ZONE_IDS) assert.equal(ZONE_PRESETS[id].mode, 'focus');
});

test('mine uses the approved meter-scale dimensions', () => {
  assert.deepEqual(MINE_V2_CONFIG.world, { width: 900, depth: 520, undergroundDepth: 210 });
  assert.deepEqual(MINE_V2_CONFIG.horizons, [-45, -95, -155]);
  assert.equal(MINE_V2_CONFIG.workingFace.length, 20);
  assert.deepEqual(MINE_V2_CONFIG.roadway, { minWidth: 4.5, maxWidth: 6, defaultHeight: 4.2 });
});

test('working-face role contract includes every disaster dependency', () => {
  assert.deepEqual(MINE_V2_CONFIG.requiredRoles, [
    'workingFace', 'coalWall', 'hydraulicSupportArray', 'shearer',
    'scraperConveyor', 'stageLoader', 'stageLoaderSZZ1200', 'crusherPLM3000',
    'undergroundBeltDSJ120', 'transportRoadway',
    'roofSeparation01', 'roofSeparation02', 'roofSeparation03',
    'convergence01', 'anchorLoad01', 'supportPressure03', 'microseismic01', 'cctv01',
  ]);
});

test('all competition equipment rows have a V2 focus route and scene role', () => {
  const requiredRoles = new Set(MINE_V2_CONFIG.requiredRoles);
  assert.deepEqual(EQUIPMENT.map(item => item.id), [
    'EQ-01', 'EQ-02', 'EQ-03', 'EQ-04', 'EQ-05', 'EQ-06',
    'MON-01', 'MON-02', 'MON-03', 'MON-04', 'MON-05', 'MON-06', 'MON-07',
  ]);
  for (const item of EQUIPMENT) {
    assert.ok(item.sceneObjectName, `${item.id} has no sceneObjectName`);
    assert.ok(item.id in EQUIPMENT_FOCUS_ZONES, `${item.id} has no V2 focus zone`);
    assert.ok(requiredRoles.has(item.sceneObjectName), `${item.id} scene role ${item.sceneObjectName} is not in V2 role contract`);
    const zoneId = EQUIPMENT_FOCUS_ZONES[item.id];
    assert.ok(Object.keys(ZONE_PRESETS).includes(zoneId), `${item.id} has invalid focus zone ${zoneId}`);
  }
});

test('focused longwall contract exposes physical roadway and monitoring roles', () => {
  for (const role of [
    'transportRoadway', 'roofSeparation01', 'roofSeparation02', 'roofSeparation03',
    'convergence01', 'anchorLoad01', 'supportPressure03', 'microseismic01', 'cctv01',
  ]) {
    assert.ok(MINE_V2_CONFIG.requiredRoles.includes(role), `${role} is missing from the focused role contract`);
  }
});

test('main incline reaches all three production horizons', () => {
  for (const id of ['h1-junction', 'h2-junction', 'h3-junction']) {
    assert.ok(ROADWAY_NODES.some(node => node.id === id));
    assert.ok(getConnectedNodeIds(id).length >= 2);
  }
});

test('main levels remain on their assigned production horizons', () => {
  for (const [id, horizon] of [['main-level-h1', -45], ['main-level-h2', -95], ['main-level-h3', -155]]) {
    const edge = ROADWAY_EDGES.find(item => item.id === id);
    assert.ok(edge);
    assert.ok(edge.points.every(point => point[1] === horizon));
  }
});

test('atlas exposes only selected roadway sections', () => {
  assert.deepEqual(ATLAS_EXPOSED_EDGE_IDS, [
    'main-level-h3',
    'intake-gate-road',
    'return-gate-road',
    'lower-gate-crosscut',
  ]);
  for (const id of ATLAS_EXPOSED_EDGE_IDS) assert.ok(ROADWAY_EDGES.some(edge => edge.id === id));
});

test('roadway widths stay within practical underground dimensions', () => {
  for (const edge of ROADWAY_EDGES) {
    assert.ok(edge.width >= 4.5 && edge.width <= 6, `${edge.id} width ${edge.width}m is outside 4.5m-6m`);
  }
});

test('edge sampling returns exact endpoints', () => {
  const edge = ROADWAY_EDGES.find(item => item.id === 'main-incline-h1');
  assert.deepEqual(sampleEdge(edge.id, 0), ROADWAY_NODES.find(node => node.id === edge.from).position);
  assert.deepEqual(sampleEdge(edge.id, 1), ROADWAY_NODES.find(node => node.id === edge.to).position);
});

test('installed licensed models point to optimized local GLB files', () => {
  const installed = Object.values(MODEL_ASSETS).filter(asset => asset.installed);
  assert.equal(installed.length, 6);
  for (const asset of installed) {
    assert.match(asset.url, /scene\.optimized\.glb$/);
    const assetUrl = new URL(`../${asset.url.replace(/^\.\//, '')}`, import.meta.url);
    assert.equal(existsSync(fileURLToPath(assetUrl)), true, `${asset.label} optimized asset is missing`);
    assert.equal(asset.license, 'CC BY 4.0');
  }
});

test('underground licensed assets have fixed engineering placements', () => {
  const installedKeys = new Set(Object.entries(MODEL_ASSETS).filter(([, asset]) => asset.installed).map(([key]) => key));
  assert.ok(UNDERGROUND_ASSET_DEPLOYMENTS.length >= 2);
  for (const placement of UNDERGROUND_ASSET_DEPLOYMENTS) {
    assert.ok(installedKeys.has(placement.assetKey), `${placement.id} references an unavailable asset`);
    assert.ok(placement.edgeId || placement.nodeId, `${placement.id} is not anchored to the topology`);
    assert.ok(placement.targetLength > 0 && placement.targetLength <= 28);
  }
  assert.equal(UNDERGROUND_ASSET_DEPLOYMENTS.filter(item => item.type === 'rail').length, 1);
  assert.equal(UNDERGROUND_ASSET_DEPLOYMENTS.filter(item => item.type === 'belt').length, 1);
  assert.equal(UNDERGROUND_ASSET_DEPLOYMENTS.filter(item => item.type === 'camera').length, 0);
  assert.equal(UNDERGROUND_ASSET_DEPLOYMENTS.filter(item => item.type === 'ventilation').length, 0);
  assert.equal(UNDERGROUND_ASSET_DEPLOYMENTS.filter(item => item.type === 'plant').length, 0);
});

test('underground assets map to atlas zones', () => {
  const zoneIds = new Set(Object.keys(ZONE_PRESETS));
  for (const placement of UNDERGROUND_ASSET_DEPLOYMENTS) {
    assert.ok(zoneIds.has(placement.zoneId), `${placement.id} has invalid zoneId`);
  }
});
