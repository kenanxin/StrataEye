import * as THREE from 'three';
import { CAMERA_PRESETS, CONTROL_LIMITS } from './camera-presets.mjs';
import { preparePbrMesh } from '../materials.js';
import { createMineV2Materials } from './materials.js';
import { createSceneAdapter } from './scene-adapter.js';
import { createMineV2Simulator } from './simulator.mjs';
import { buildLabelsAndMarkers } from './labels.js';
import { MINE_V2_CONFIG } from './config.mjs';
import { buildFocusedLongwallScene } from './focused-longwall.js';
import { buildCutawayGeology } from './cutaway-geology.js';
import { buildRoadwayNetwork } from './roadway-network.js';

export async function buildMineV2(sourceMaterials) {
  const root = new THREE.Group();
  root.name = 'focusedLongwallDigitalTwin';

  // —— 地质层：连续岩体 + 煤层 + 剖切窗口 ——
  const geologyRoot = new THREE.Group();
  geologyRoot.name = 'mineV2GeologyRoot';
  root.add(geologyRoot);

  // —— 井下层：巷道网络 + 硐室 + 节点灯光 ——
  const undergroundRoot = new THREE.Group();
  undergroundRoot.name = 'mineV2UndergroundRoot';
  root.add(undergroundRoot);

  // —— 聚焦层：1206 工作面出口段 + 50m 运输顺槽详模 ——
  const focusedRoot = new THREE.Group();
  focusedRoot.name = 'mineV2FocusedRoot';
  root.add(focusedRoot);

  const materials = createMineV2Materials(sourceMaterials);
  const simulator = createMineV2Simulator(MINE_V2_CONFIG.seed);
  const undergroundAmbient = new THREE.AmbientLight(0x2b302d, 0.72);
  undergroundAmbient.name = 'mineV2UndergroundAmbient';
  undergroundRoot.add(undergroundAmbient);

  const runtime = {
    variant: 'v2',
    labels: [],
    monitorMarkers: [],
    routeVehicles: [],
    updaters: [],
    objectsByRole: new Map(),
    simulator,
    monitorAnchors: [],
    zonePresets: {},
    geologyRoot,
    undergroundRoot,
    focusedRoot,
    requestCameraFocus: null,
    update(delta) { for (const updater of this.updaters) updater(delta); },
    dispose() {},
  };

  // —— 1. 连续岩体与地质剖切 ——
  const geology = buildCutawayGeology(materials, runtime);
  geologyRoot.add(geology);

  // —— 2. 三层地下巷道网络（主斜井 + 三个水平 + 联络巷 + 硐室）——
  const roadwayNetwork = buildRoadwayNetwork(materials, runtime);
  undergroundRoot.add(roadwayNetwork);

  // —— 3. 1206 工作面出口段详模 ——
  const focusedMine = await buildFocusedLongwallScene(materials, runtime);
  focusedRoot.add(focusedMine);
  const inspectionBounds = new THREE.Box3().setFromObject(focusedMine);

  runtime.updaters.push(delta => { runtime.latestSnapshot = simulator.update(delta); });

  root.add(buildLabelsAndMarkers(materials, runtime, simulator, runtime.monitorAnchors));

  // —— 视角切换：控制各层可见性 ——
  runtime.setViewMode = mode => {
    const normalizedMode = mode === 'overview' ? 'overview' : 'underground';
    runtime.currentViewMode = normalizedMode;
    const isOverview = normalizedMode === 'overview';
    const isUnderground = normalizedMode === 'underground';

    geologyRoot.visible = true;
    undergroundRoot.visible = true;
    focusedRoot.visible = isUnderground;

    undergroundRoot.traverse(child => {
      if (child.isLight) child.visible = true;
    });

    runtime.monitorMarkers.forEach(marker => {
      const markerObj = marker?.isObject3D ? marker : marker?.root;
      if (markerObj?.isObject3D) markerObj.visible = true;
      if (marker?.label) marker.label.visible = isUnderground;
    });
  };
  runtime.setViewMode('overview');

  root.traverse(object => preparePbrMesh(object));

  let sceneObjectCount = 0;
  let meshCount = 0;
  let triangleCount = 0;
  root.traverse(object => {
    sceneObjectCount += 1;
    if (!object.isMesh || !object.geometry) return;
    meshCount += 1;
    const indexCount = object.geometry.index?.count;
    const positionCount = object.geometry.attributes?.position?.count ?? 0;
    triangleCount += Math.floor((indexCount ?? positionCount) / 3);
  });

  const counts = {
    sceneObjects: sceneObjectCount,
    meshes: meshCount,
    triangles: triangleCount,
    equipment: simulator.snapshot().equipmentRegistry.length,
    roofSensors: runtime.monitorAnchors.filter(anchor => anchor.category === 'roof-sensor').length,
    cameras: runtime.monitorAnchors.filter(anchor => anchor.category === 'camera').length,
    people: 0,
  };
  return {
    root,
    runtime,
    cameraPresets: CAMERA_PRESETS,
    controlLimits: CONTROL_LIMITS,
    validation: {
      variant: 'v2',
      errors: [],
      warnings: [],
      counts,
      inspectionBounds: {
        min: inspectionBounds.min.toArray(),
        max: inspectionBounds.max.toArray(),
      },
    },
    sceneAdapter: createSceneAdapter(runtime),
  };
}
