/* ============================================================
   智慧矿山数字孪生 — Three.js 3D场景 v3
   工程参照：立井开拓 + 长壁综采工作面
   三巷并列：皮带运输巷 / 轨道运输巷 / 回风巷
   通风回路：副井(进风) → 工作面 → 回风巷 → 风井(回风)
   ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadMineMaterials } from './scene/materials.js';
import { buildMineV2 } from './scene/mine-v2/mine-v2.js';
import { animateRoofFieldCloud, createRoofFieldCloud, setRoofFieldCloudMode, updateRoofFieldCloud } from './scene/mine-v2/roof-field-cloud.js';
import { EQUIPMENT } from './mine-data.js';
import { EQUIPMENT_FOCUS_ZONES } from './scene/mine-v2/equipment-focus-map.mjs';

// ==================== 全局 ====================
let scene, camera, renderer, composer, labelRenderer, controls;
let groundGroup, undergroundGroup, indicatorGroup;
let groundMesh;
let shearerBody;
let mineRuntime;
let cameraPresets;
let controlLimits;
let mineEnvironment;
let sceneAdapter;
let diagnosticsElement;
let roofFieldCloud = null;
let roofFieldStage = 'normalMonitor';
let diagnosticsStartedAt = 0;
let diagnosticsFrameCount = 0;
let sceneInitStartedAt = 0;
const clock = new THREE.Clock();
const indicators = [];
let viewMode = 'underground';
let targetCamPos = new THREE.Vector3();
let targetLookAt = new THREE.Vector3();
let isTransitioning = false;
let focusHighlight = null;
let focusHighlightUntil = 0;

let controlMode = 'rotate';

// ==================== 材质工厂 ====================
const M = {
  rock:   () => new THREE.MeshStandardMaterial({ color:0x7a6b5c, roughness:0.75, metalness:0.05 }),
  coal:   () => new THREE.MeshStandardMaterial({ color:0x161616, roughness:0.45, metalness:0.15, emissive:0x020202, emissiveIntensity:0.5 }),
  coalBold:()=>new THREE.MeshStandardMaterial({ color:0x0e0e0e, roughness:0.4,  metalness:0.2,  emissive:0x030303, emissiveIntensity:0.6 }),
  steel:  () => new THREE.MeshStandardMaterial({ color:0x778899, roughness:0.3,  metalness:0.7 }),
  steelDark:()=>new THREE.MeshStandardMaterial({ color:0x556677, roughness:0.35, metalness:0.65 }),
  iron:   () => new THREE.MeshStandardMaterial({ color:0x667788, roughness:0.25, metalness:0.85 }),
  yellow: () => new THREE.MeshStandardMaterial({ color:0xffb800, roughness:0.25, metalness:0.6, emissive:0x331100, emissiveIntensity:0.35 }),
  blue:   () => new THREE.MeshStandardMaterial({ color:0x448aff, roughness:0.3,  metalness:0.7 }),
  gray:   () => new THREE.MeshStandardMaterial({ color:0x889999, roughness:0.4,  metalness:0.55 }),
  building:()=>new THREE.MeshStandardMaterial({ color:0x889999, roughness:0.5,  metalness:0.2 }),
  roof:   () => new THREE.MeshStandardMaterial({ color:0x445566, roughness:0.6,  metalness:0.3 }),
  ground: () => new THREE.MeshStandardMaterial({ color:0x5c4a3a, roughness:0.85, metalness:0.05, transparent:true, opacity:1 }),
  road:   () => new THREE.MeshStandardMaterial({ color:0x444444, roughness:0.9 }),
  wood:   () => new THREE.MeshStandardMaterial({ color:0x8B6914, roughness:0.8 }),
  leaf:   () => new THREE.MeshStandardMaterial({ color:0x2d5a27, roughness:0.7 }),
  glow:   (c) => new THREE.MeshBasicMaterial({ color:c }),
  glowTrans:(c,o)=>new THREE.MeshBasicMaterial({ color:c, transparent:true, opacity:o }),
};

// ==================== 场景初始化 ====================
export function initScene(containerId) {
  const container = document.getElementById(containerId);
  diagnosticsElement = container;
  sceneInitStartedAt = performance.now();
  const w = container.clientWidth, h = container.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151310);
  scene.fog = new THREE.FogExp2(0x151310, 0.0015);

  camera = new THREE.PerspectiveCamera(35, w / h, 0.5, 2000);
  camera.position.set(55, 38, 78);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.34, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(w, h);
  labelRenderer.domElement.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
  container.appendChild(labelRenderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, -5, -4);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 135;
  controls.maxPolarAngle = Math.PI * 0.85;
  controls.minPolarAngle = 0.05;
  controls.autoRotate = false;
  controls.update();

  setupLighting();
  buildScene(container);
  setupCustomControls(container);

  targetCamPos.copy(camera.position);
  targetLookAt.copy(controls.target);
  window.__mineCameraState = () => ({
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    targetPosition: targetCamPos.toArray(),
    targetLookAt: targetLookAt.toArray(),
    fov: camera.fov,
    viewMode,
  });

  window.addEventListener('resize', () => onResize(containerId));
  animate();
}

// ==================== 光照 ====================
function setupLighting() {
  scene.add(new THREE.AmbientLight(0x637078, 0.32));
  scene.add(new THREE.HemisphereLight(0xb8c9d2, 0x40372f, 0.5));

  const sun = new THREE.DirectionalLight(0xffeedd, 2.2);
  sun.position.set(30, 25, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 100;
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.bias = -0.0001;
  scene.add(sun);
  const coolFill = new THREE.DirectionalLight(0x4488cc, 0.65);
  coolFill.position.set(-15, 5, -10);
  scene.add(coolFill);

  // 井下补光灯（初始隐藏）
  [
    [13, -7.5, -4, 0xffaa44, 30, 16],
    [5, -7, -4, 0xffaa44, 25, 12],
    [13, -5.5, -4, 0x4488ff, 18, 14],
    [-3, -7, -4, 0xffaa44, 20, 10],
  ].forEach(([x, y, z, c, i, d]) => {
    const l = new THREE.PointLight(c, i, d, 1.5);
    l.position.set(x, y, z);
    l.name = 'underLight';
    l.visible = false;
    scene.add(l);
  });
}

// ==================== 构建场景 ====================
function buildScene(container) {
  groundGroup = new THREE.Group();
  undergroundGroup = new THREE.Group();
  indicatorGroup = new THREE.Group();

  scene.add(groundGroup);
  scene.add(undergroundGroup);
  scene.add(indicatorGroup);

  loadUndergroundMine(container);
}

async function loadUndergroundMine(container) {
  const status = document.createElement('div');
  status.className = 'mine-load-status';
  status.innerHTML = '<span></span><b>正在装载井下写实场景</b><small>岩层材质 0%</small>';
  container.appendChild(status);

  try {
    const materials = await loadMineMaterials((progress, name) => {
      const percent = Math.round(progress * 100);
      status.querySelector('small').textContent = `${name} ${percent}%`;
      status.style.setProperty('--mine-load', `${percent}%`);
    });
    mineEnvironment = await loadMineEnvironment();
    if (mineEnvironment) {
      scene.environment = mineEnvironment;
      scene.background = mineEnvironment;
      scene.backgroundIntensity = 0.48;
      scene.backgroundBlurriness = 0;
    } else {
      // Vercel may receive a Git LFS pointer instead of the HDR binary. The
      // environment is visual polish, so keep the procedural mine usable.
      scene.environment = null;
      scene.background = new THREE.Color(0x718087);
    }
    scene.environmentIntensity = 0.72;

    scene.fog.density = 0.00022;
    const mine = await buildMineV2(materials);
    window.__mineDiagnostics = { variant: 'v2', validation: mine.validation ?? null };
    undergroundGroup.add(mine.root);
    mineRuntime = mine.runtime;
    diagnosticsStartedAt = performance.now();
    diagnosticsFrameCount = 0;
    diagnosticsElement.dataset.firstReadyMs = Math.round(diagnosticsStartedAt - sceneInitStartedAt).toString();
    diagnosticsElement.dataset.meshes = String(mine.validation?.counts?.meshes ?? 0);
    diagnosticsElement.dataset.triangles = String(mine.validation?.counts?.triangles ?? 0);
    cameraPresets = mine.cameraPresets;
    controlLimits = mine.controlLimits;
    sceneAdapter = mine.sceneAdapter ?? null;
    roofFieldCloud = createRoofFieldCloud();
    mine.root.add(roofFieldCloud);
    shearerBody = mine.runtime.workingFaceShearer;
    if (mineRuntime) mineRuntime.requestCameraFocus = preset => applyCameraFocusPreset(preset);
    applyCameraPreset('underground', true);
    status.classList.add('ready');
    status.querySelector('b').textContent = '数字孪生场景已就绪';
    status.querySelector('small').textContent = '井下 1206 工作面';
    setTimeout(() => status.remove(), 1400);
  } catch (error) {
    console.error('井下场景加载失败', error);
    status.classList.add('error');
    status.querySelector('b').textContent = '井下场景加载失败';
    status.querySelector('small').textContent = error.message || String(error);
  }
}

async function loadMineEnvironment() {
  let objectUrl = null;
  try {
    const response = await fetch('./assets/hdri/quarry_02_4k.hdr');
    if (!response.ok) throw new Error(`HDR request failed with HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const signature = new TextDecoder('ascii').decode(buffer.slice(0, 16));
    if (!signature.startsWith('#?RADIANCE') && !signature.startsWith('#?RGBE')) {
      throw new Error('HDR response is not a Radiance image');
    }
    objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
    const environment = await new RGBELoader().loadAsync(objectUrl);
    environment.mapping = THREE.EquirectangularReflectionMapping;
    return environment;
  } catch (error) {
    console.warn('HDR 环境贴图不可用，已切换到基础光照', error);
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

// ==================== 地面 ====================
function createGround() {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), M.ground());
  g.rotation.x = -Math.PI / 2;
  g.position.set(0, 0, -5);
  g.receiveShadow = true;
  g.name = 'ground';
  groundMesh = g;
  groundGroup.add(g);

  // 网格辅助线
  const grid = new THREE.PolarGridHelper(22, 48, 24, 256, 0x334455, 0x1a2a3a);
  grid.position.y = 0.02;
  grid.name = 'grid';
  groundGroup.add(grid);
}

// ==================== 地质剖面（西侧切面） ====================
function createGeologicalSection() {
  const sx = -14, sw = 3, sz = 7;
  [
    { y:-1.5, h:3,   c:0x8B7355 },
    { y:-4,   h:2.5, c:0x9B8B7A },
    { y:-6.2, h:2.5, c:0x6A5A4A },
    { y:-8.8, h:3.5, c:0x111111 },  // 煤层
    { y:-12,  h:3.5, c:0x7A7060 },
  ].forEach(d => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sw, d.h, sz), M.rock());
    m.material.color.set(d.c);
    m.position.set(sx, d.y, -5);
    m.castShadow = true;
    m.receiveShadow = true;
    groundGroup.add(m);
  });

  // 煤层上下界发光标识
  [-6.5, -10.6].forEach(y => {
    const e = new THREE.Mesh(
      new THREE.BoxGeometry(sw + 0.4, 0.1, sz + 0.4),
      M.glow(0xff6600)
    );
    e.position.set(sx, y, -5);
    groundGroup.add(e);
  });
}

// ==================== 煤层（核心地质体） ====================
function createCoalSeam() {
  // 主煤层：从西到东横贯整个矿区，巷道在其中穿越
  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(30, 3, 6),
    M.coal()
  );
  seam.position.set(2, -9.5, -4.5);
  seam.name = 'coalSeam';
  undergroundGroup.add(seam);

  // 上下边界发光条
  [-8, -11].forEach(y => {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(30.2, 0.06, 6.2),
      M.glow(0x333333)
    );
    edge.position.set(2, y, -4.5);
    edge.name = 'coalEdge';
    undergroundGroup.add(edge);
  });
}

// ==================== 井筒 ====================
function createShafts() {
  const sm = M.steelDark();

  // 主井（箕斗提升煤炭）—— 居中
  const mainShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 10.5, 16), sm);
  mainShaft.position.set(0, -5.25, -4.5);
  mainShaft.castShadow = true;
  undergroundGroup.add(mainShaft);
  // 井口环
  const mc = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.12, 8, 16), M.iron());
  mc.rotation.x = Math.PI / 2;
  mc.position.set(0, 0.05, -4.5);
  surfaceGroup.add(mc);

  // 副井（人员/材料/进风）—— 主井东侧
  const auxShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 10, 16), sm);
  auxShaft.position.set(3.5, -5, -4.5);
  auxShaft.castShadow = true;
  undergroundGroup.add(auxShaft);
  const ac = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.1, 8, 16), M.iron());
  ac.rotation.x = Math.PI / 2;
  ac.position.set(3.5, 0.05, -4.5);
  surfaceGroup.add(ac);

  // 风井（回风）—— 西侧
  const ventShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 10, 12), sm);
  ventShaft.position.set(-6, -5, -4.5);
  ventShaft.castShadow = true;
  undergroundGroup.add(ventShaft);
}

// ==================== 井底车场 ====================
function createPitBottom() {
  const cm = new THREE.MeshStandardMaterial({ color:0x4a4540, roughness:0.75, metalness:0.1 });

  // 主井底车场（含煤仓）
  const mainPit = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.8, 3.5), cm);
  mainPit.position.set(0, -9.3, -4.5);
  undergroundGroup.add(mainPit);

  // 煤仓（主井底部临时储煤）
  const bunker = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 2.5, 12), M.steelDark());
  bunker.position.set(0, -10.5, -4.5);
  undergroundGroup.add(bunker);

  // 副井底部
  const auxPit = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 2.5), cm);
  auxPit.position.set(3.5, -9, -4.5);
  undergroundGroup.add(auxPit);

  // 风井底部
  const ventPit = new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 2), cm);
  ventPit.position.set(-6, -9, -4.5);
  undergroundGroup.add(ventPit);

  // 主井-副井联络巷
  const link = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 2), cm);
  link.position.set(1.75, -9, -4.5);
  undergroundGroup.add(link);
}

// ==================== 井架 ====================
function createHeadframes() {
  // 主井井架（大型，箕斗提升）
  createHeadframe(0, -4.5, 10, 1.0);
  // 副井井架（小型，罐笼提升）
  createHeadframe(3.5, -4.5, 7, 0.7);
}

function createHeadframe(cx, cz, height, baseW) {
  const hf = new THREE.Group();
  const pm = M.steel();
  const poleR = 0.15;

  [[-baseW, cz-baseW],[baseW, cz-baseW],[-baseW, cz+baseW],[baseW, cz+baseW]].forEach(([px, pz]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(poleR, poleR, height, 8), pm);
    p.position.set(px, height / 2, pz);
    p.castShadow = true;
    hf.add(p);
  });

  // 天轮平台
  const plat = new THREE.Mesh(new THREE.BoxGeometry(baseW * 2.5, 0.3, baseW * 2.5), pm);
  plat.position.set(cx, height, cz);
  plat.castShadow = true;
  hf.add(plat);

  // 天轮 ×2
  for (let i = -1; i <= 1; i += 2) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(baseW * 0.6, 0.1, 8, 16), M.iron());
    w.position.set(cx + i * baseW * 0.8, height + 0.3, cz);
    w.castShadow = true;
    hf.add(w);
    // 钢丝绳
    const rope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, height + 2, 6),
      new THREE.MeshStandardMaterial({ color:0x333333, roughness:0.5, metalness:0.5 })
    );
    rope.position.set(cx + i * baseW * 0.8, height / 2 - 1, cz);
    hf.add(rope);
  }

  surfaceGroup.add(hf);
}

// ==================== 三巷并列（井下巷道网络） ====================
function createRoadways() {
  const tm = new THREE.MeshStandardMaterial({ color:0x3d3833, roughness:0.8, metalness:0.05 });
  const roadLen = 15; // 巷道长度

  // 皮带运输大巷（最南侧 z=-5.8，运煤）
  const beltRW = new THREE.Mesh(new THREE.BoxGeometry(roadLen, 2.5, 2.5), tm);
  beltRW.position.set(7, -8.8, -5.8);
  beltRW.name = 'beltRoadway';
  undergroundGroup.add(beltRW);

  // 轨道运输大巷（中间 z=-4.5，行人/运料/进风）
  const trackRW = new THREE.Mesh(new THREE.BoxGeometry(roadLen, 2.5, 2.5), tm);
  trackRW.position.set(7, -8.8, -4.5);
  trackRW.name = 'trackRoadway';
  undergroundGroup.add(trackRW);

  // 回风大巷（最北侧 z=-3.2，回风）
  const returnRW = new THREE.Mesh(new THREE.BoxGeometry(roadLen, 2.5, 2.5), tm);
  returnRW.position.set(7, -8.8, -3.2);
  returnRW.name = 'returnRoadway';
  undergroundGroup.add(returnRW);

  // 联络巷（横向连接三条巷道）
  for (let x = 2; x <= 12; x += 3.5) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2, 3), tm);
    cross.position.set(x, -8.8, -4.5);
    undergroundGroup.add(cross);
  }

  // 轨道（轨道巷底部）
  const rm = new THREE.MeshStandardMaterial({ color:0x666666, roughness:0.3, metalness:0.9 });
  for (let z = -5.3; z >= -3.7; z -= 0.7) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(roadLen - 0.5, 0.06, 0.1), rm);
    rail.position.set(7, -9.95, z);
    undergroundGroup.add(rail);
  }

  // 皮带（皮带巷底部）
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(roadLen - 0.5, 0.25, 1.2),
    new THREE.MeshStandardMaterial({ color:0x444444, roughness:0.6, metalness:0.3 })
  );
  belt.position.set(7, -9.7, -5.8);
  undergroundGroup.add(belt);

  // 壁灯
  [ -5.8, -4.5, -3.2 ].forEach(z => {
    for (let x = 0.5; x <= 13.5; x += 2.5) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 4, 4), M.glow(0xffcc66));
      lamp.position.set(x, -7.5, z);
      undergroundGroup.add(lamp);
      indicators.push({ mesh: lamp, baseColor: 0xffcc66, phase: x + z });
    }
  });
}

// ==================== 综采工作面 ====================
function createWorkingFace() {
  const fg = new THREE.Group();
  // 工作面位于巷道东端，南北向（z方向）连接皮带巷和回风巷
  const fzCenter = -4.5;  // 工作面中心z坐标
  const fzHalf = 1.5;     // 工作面半长（简化，代表~150m）
  const fx = 14.5;         // 工作面x坐标（巷道东端）
  const fy = -9;           // 工作面y坐标（煤层中部）

  // === 煤壁（工作面正在切割的煤层暴露面） ===
  const coalWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 3, fzHalf * 2 + 0.5),
    M.coalBold()
  );
  coalWall.position.set(fx + 1.5, fy, fzCenter);
  coalWall.name = 'coalWall';
  fg.add(coalWall);

  // 煤壁层理线
  for (let j = 0; j < 5; j++) {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.03, fzHalf * 2 + 0.6),
      M.glow(0x2a2a2a)
    );
    line.position.set(fx + 1.75, fy - 1 + j * 0.55, fzCenter);
    fg.add(line);
  }

  // === 采煤机（沿z轴在工作面上往复运动） ===
  shearerBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.3, 3),
    M.yellow()
  );
  shearerBody.position.set(fx, fy, fzCenter);
  shearerBody.castShadow = true;
  shearerBody.name = 'shearer';
  fg.add(shearerBody);

  // 滚筒 ×2（装在采煤机两端，都朝向煤壁+x方向）
  for (let i = -1; i <= 1; i += 2) {
    const drumG = new THREE.Group();
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 0.45, 16),
      new THREE.MeshStandardMaterial({ color:0xbb7700, roughness:0.2, metalness:0.85 })
    );
    drum.rotation.z = Math.PI / 2;
    drum.name = 'drum';
    drumG.add(drum);
    // 截齿
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * Math.PI * 2;
      const pick = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.2, 4),
        new THREE.MeshStandardMaterial({ color:0x999999, roughness:0.2, metalness:0.9 })
      );
      pick.position.set(0, Math.cos(a) * 0.55, Math.sin(a) * 0.55);
      pick.rotation.set(0, 0, a);
      pick.name = 'pick';
      drumG.add(pick);
    }
    // 两个滚筒都在煤壁侧(+x)，一上一下切割全厚，南北各一端
    drumG.position.set(1.0, i * 0.6, i * 1.8);
    shearerBody.add(drumG);
  }

  // === 刮板输送机（AFC，在采煤机下方沿工作面方向） ===
  const afc = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.35, fzHalf * 2 + 2),
    M.gray()
  );
  afc.position.set(fx + 0.2, fy - 1, fzCenter);
  fg.add(afc);

  // === 液压支架 ×5（在采煤机后方 -x 方向，支撑顶板） ===
  for (let i = 0; i < 5; i++) {
    const sg = new THREE.Group();
    const sm = M.blue();

    sg.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 1.3), sm)).position.y = -0.75;
    sg.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 1.2), sm)).position.y = 0.95;

    for (let c = -1; c <= 1; c += 2)
      for (let r = -1; r <= 1; r += 2)
        sg.add(new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.07, 1.5, 6),
          new THREE.MeshStandardMaterial({ color:0x889999, roughness:0.2, metalness:0.8 })
        )).position.set(c * 0.12, 0.05, r * 0.38);

    const shield = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.65, 1.1),
      new THREE.MeshStandardMaterial({ color:0x5577aa, roughness:0.35, metalness:0.6 })
    );
    shield.position.set(0.55, 0.2, 0);
    shield.rotation.z = -0.5;
    sg.add(shield);

    sg.position.set(fx - 1.2 - i * 0.85, fy, fzCenter + (i - 2) * 0.85);
    sg.castShadow = true;
    sg.name = 'support';
    fg.add(sg);
  }

  // === 转载机（连接AFC和皮带巷） ===
  const stageLoader = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.5, 1),
    M.gray()
  );
  stageLoader.position.set(fx - 1.5, fy - 1.1, -5.5);
  stageLoader.rotation.y = 0.3;
  fg.add(stageLoader);

  // === 落煤（采落的煤块在AFC上） ===
  for (let i = 0; i < 15; i++) {
    const sz = 0.08 + Math.random() * 0.22;
    const lump = new THREE.Mesh(
      new THREE.IcosahedronGeometry(sz, 0),
      new THREE.MeshStandardMaterial({ color:0x151515, roughness:0.9 })
    );
    lump.position.set(
      fx + 0.2 + (Math.random() - 0.5) * 0.4,
      fy - 0.7 + Math.random() * 0.2,
      fzCenter + (Math.random() - 0.5) * (fzHalf * 2)
    );
    lump.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    lump.name = 'coalLump';
    fg.add(lump);
  }

  undergroundGroup.add(fg);
}

// ==================== 采空区（工作面后方垮落区） ====================
function createGoaf() {
  const goafGroup = new THREE.Group();

  // 垮落岩石（不规则堆积）
  for (let i = 0; i < 40; i++) {
    const sz = 0.2 + Math.random() * 0.6;
    const rock = new THREE.Mesh(
      new THREE.IcosahedronGeometry(sz, 1),
      new THREE.MeshStandardMaterial({ color:0x5a5040 + Math.floor(Math.random()*0x202020), roughness:0.85 })
    );
    rock.position.set(
      9 + Math.random() * 5,
      -9.5 + Math.random() * 2,
      -4.5 + (Math.random() - 0.5) * 3.5
    );
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    rock.castShadow = true;
    rock.name = 'goafRock';
    goafGroup.add(rock);
  }

  // 采空区边界虚线框
  const boundaryGeo = new THREE.BoxGeometry(5.5, 0.05, 4);
  const boundary = new THREE.Mesh(boundaryGeo, new THREE.MeshBasicMaterial({
    color: 0xff4444, transparent: true, opacity: 0.35, wireframe: false,
  }));
  boundary.position.set(11, -10, -4.5);
  goafGroup.add(boundary);

  undergroundGroup.add(goafGroup);
}

// ==================== 地面设施 ====================
function createSurfaceFacilities() {
  const bm = M.building();
  const bdm = new THREE.MeshStandardMaterial({ color:0x556666, roughness:0.5, metalness:0.2 });
  const rm = M.roof();

  // 绞车房（紧邻主井）
  createBuilding(3.5, 3, 3.5, 3, 0.02, -2.5, bm, rm, surfaceGroup);
  // 副井绞车房
  createBuilding(2.5, 2.5, 2.5, 5.5, 0.02, -2.5, bm, rm, surfaceGroup);
  // 选煤厂（皮带连接主井）
  createBuilding(5.5, 4.5, 4, -8, 0.02, -0.5, bdm, rm, surfaceGroup);
  // 办公楼
  createBuilding(4.5, 2.8, 3, 9, 0.02, 2, bm, rm, surfaceGroup);
  // 机修车间
  createBuilding(2.5, 2, 3, -5, 0.02, 5, bm, rm, surfaceGroup);
  // 变电所
  createBuilding(1.5, 1.5, 2, 7, 0.02, 5, bdm, rm, surfaceGroup);

  // 地面皮带走廊（主井→选煤厂）
  const beltG = new THREE.Group();
  const beltMat = new THREE.MeshStandardMaterial({ color:0x556677, roughness:0.4, metalness:0.5 });
  const sBelt = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 1.1), beltMat);
  sBelt.position.set(-4, 1, -4);
  sBelt.castShadow = true;
  surfaceGroup.add(sBelt);

  // 皮带支架
  const stMat = new THREE.MeshStandardMaterial({ color:0x666666, roughness:0.4, metalness:0.6 });
  for (let i = 0; i < 5; i++) {
    const bx = -7 + i * 2;
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.2, 4), stMat);
    stand.position.set(bx, 0.55, -4);
    stand.castShadow = true;
    surfaceGroup.add(stand);
  }

  // 通风机（风井口，抽出式）
  const fanBase = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.5, 8), bdm);
  fanBase.position.set(-6, 0.75, -4.5);
  fanBase.castShadow = true;
  surfaceGroup.add(fanBase);

  const fanBlade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 0.25, 16),
    new THREE.MeshStandardMaterial({ color:0x555555, roughness:0.2, metalness:0.9 })
  );
  fanBlade.position.set(-6, 1.6, -4.5);
  fanBlade.rotation.z = Math.PI / 2;
  fanBlade.name = 'fan';
  surfaceGroup.add(fanBlade);

  // 风道
  const duct = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 2, 8),
    new THREE.MeshStandardMaterial({ color:0x666666, roughness:0.4, metalness:0.5 })
  );
  duct.position.set(-6, 0.5, -3.5);
  duct.rotation.x = Math.PI / 3;
  duct.name = 'duct';
  surfaceGroup.add(duct);
}

function createBuilding(w, h, d, px, py, pz, wallMat, roofMat, parent) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
  wall.position.set(px, py + h / 2, pz);
  wall.castShadow = wall.receiveShadow = true;
  parent.add(wall);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.75, 0.8, 4), roofMat);
  roof.position.set(px, py + h + 0.4, pz);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  parent.add(roof);

  // 窗户
  const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.4, h * 0.3), M.glow(0xffdd99));
  win.position.set(px, py + h * 0.6, pz + d / 2 + 0.01);
  parent.add(win);
}

// ==================== 煤堆 ====================
function createCoalStockpile() {
  const cm = new THREE.MeshStandardMaterial({ color:0x161616, roughness:0.9, metalness:0.05 });
  const pile = new THREE.Mesh(new THREE.ConeGeometry(2, 2.8, 12, 8), cm);
  pile.position.set(-10, 1.4, -1);
  pile.castShadow = true;
  surfaceGroup.add(pile);

  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(
      new THREE.ConeGeometry(0.4 + Math.random() * 0.5, 0.5 + Math.random() * 1, 8, 6), cm
    );
    s.position.set(-10 + (Math.random() - 0.5) * 3.5, 0.25, -1 + (Math.random() - 0.5) * 3);
    s.castShadow = true;
    surfaceGroup.add(s);
  }
}

// ==================== 装饰 ====================
function createDecorations() {
  // 道路
  const road = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 20), M.road());
  road.rotation.x = -Math.PI / 2;
  road.position.set(1.5, 0.02, 3);
  road.receiveShadow = true;
  surfaceGroup.add(road);

  // 树木
  for (let i = 0; i < 12; i++) {
    const tg = new THREE.Group();
    tg.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 1.2, 6), M.wood())).position.y = 0.6;
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 6, 4), M.leaf());
    leaves.position.y = 1.5;
    leaves.castShadow = true;
    tg.add(leaves);
    tg.position.set(-18 + Math.random() * 6, 0, -10 + Math.random() * 20);
    surfaceGroup.add(tg);
  }
}

// ==================== 指示灯 ====================
function createIndicators() {
  [
    [0, 0.4, -4.5, 0x00e676],
    [3.5, 0.4, -4.5, 0x00e676],
    [-6, 0.4, -4.5, 0xffb700],
    [14.5, -8, -4.5, 0xffcc00],
    [14.5, -7, -4.5, 0x00e676],
    [-8, 0.4, -0.5, 0x00e676],
    [5, 0.4, -2.5, 0x00e676],
    [9, 0.4, 2, 0x00e676],
  ].forEach(([x, y, z, c]) => {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), M.glow(c));
    light.position.set(x, y, z);
    indicatorGroup.add(light);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), M.glowTrans(c, 0.25));
    light.add(glow);
    indicators.push({ mesh: light, baseColor: c, phase: Math.random() * Math.PI * 2 });
  });
}

// ==================== 粒子 ====================
function createParticles() {
  // 转载点煤尘
  const dc = 80;
  const dp = new Float32Array(dc * 3);
  for (let i = 0; i < dc; i++) {
    dp[i * 3] = -2 + (Math.random() - 0.5) * 3;
    dp[i * 3 + 1] = -0.5 + (Math.random() - 0.5) * 2;
    dp[i * 3 + 2] = -4 + (Math.random() - 0.5) * 2;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color:0x888888, size:0.12, transparent:true, opacity:0.45, blending:THREE.AdditiveBlending,
  }));
  dust.name = 'dust';
  surfaceGroup.add(dust);

  // 井下微光
  const sc = 50;
  const sp = new Float32Array(sc * 3);
  for (let i = 0; i < sc; i++) {
    sp[i * 3] = 6 + (Math.random() - 0.5) * 20;
    sp[i * 3 + 1] = -8.5 + (Math.random() - 0.5) * 5;
    sp[i * 3 + 2] = -4.5 + (Math.random() - 0.5) * 5;
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const spark = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color:0x44aaff, size:0.07, transparent:true, opacity:0.5, blending:THREE.AdditiveBlending,
  }));
  spark.name = 'spark';
  undergroundGroup.add(spark);
}

// ==================== 标签 ====================
function createLabels() {
  const style = 'color:#e9eef2;font-size:11px;font-family:"Microsoft YaHei",sans-serif;padding:2px 8px;background:rgba(7,9,13,0.75);border:1px solid rgba(243,167,18,0.42);border-radius:3px;white-space:nowrap;pointer-events:none;';

  [
    // 地面标签
    ['主井井架\n(箕斗提煤)', 0, 5.8, -4.5],
    ['副井井架\n(人员/材料/进风)', 3.5, 4.5, -4.5],
    ['通风机\n(抽出式回风)', -6, 3.5, -4.5],
    ['绞车房', 3, 2.5, -2.5],
    ['选煤厂', -8, 3.5, -0.5],
    ['煤 仓', -10, 4, -1],
    ['办公楼', 9, 2.5, 2],
    ['皮带走廊', -4, 1.8, -4],
    // 井下标签
    ['运输大巷\n(皮带运煤)', 7, -6.8, -5.8],
    ['轨道大巷\n(行人/运料/进风)', 7, -6.8, -4.5],
    ['回风大巷\n(污风排出)', 7, -6.8, -3.2],
    ['综采工作面', 15.5, -6.5, -4.5],
    ['采煤机', 14.5, -6, -4.5],
    ['液压支架', 11, -8, -4.5],
    ['采空区\n(垮落带)', 11, -8.5, -2],
    ['煤 层', -12, -8, -4.5],
    ['井底车场', 0, -7.5, -4.5],
    ['煤 仓', 0, -10, -3],
    ['副井进风 ↓', 3.5, -4, -4.5],
    ['风井回风 ↑', -6, -4, -4.5],
  ].forEach(([t, x, y, z]) => {
    const div = document.createElement('div');
    div.textContent = t;
    div.style.cssText = style + 'text-align:center;';
    const label = new CSS2DObject(div);
    label.position.set(x, y, z);
    scene.add(label);
  });
}

// ==================== 视角切换 ====================
function applyCameraPreset(mode, immediate = false) {
  const normalizedMode = cameraPresets?.[mode] ? mode : 'underground';
  const preset = cameraPresets?.[normalizedMode];
  if (!preset) return;
  viewMode = normalizedMode;
  targetCamPos.fromArray(preset.position);
  targetLookAt.fromArray(preset.target);
  camera.fov = preset.fov;
  camera.updateProjectionMatrix();
  const limits = controlLimits?.[normalizedMode];
  controls.minDistance = limits?.minDistance ?? (normalizedMode === 'overview' ? 34 : 12);
  controls.maxDistance = limits?.maxDistance ?? (normalizedMode === 'overview' ? 135 : 90);
  const isCutawayView = normalizedMode === 'overview' || normalizedMode === 'underground';
  controls.minAzimuthAngle = limits?.minAzimuth ?? (isCutawayView ? -1.15 : -Infinity);
  controls.maxAzimuthAngle = limits?.maxAzimuth ?? (isCutawayView ? 1.15 : Infinity);
  controls.minPolarAngle = limits?.minPolar ?? 0;
  controls.maxPolarAngle = limits?.maxPolar ?? Math.PI;
  controls.autoRotate = false;
  scene.background = new THREE.Color(0x151310);
  scene.backgroundIntensity = 1;
  scene.environmentIntensity = 0.26;
  groundGroup.visible = true;
  undergroundGroup.visible = true;
  indicatorGroup.visible = true;
  scene.traverse(c => { if (c.name === 'underLight') c.visible = true; });
  mineRuntime?.monitorMarkers?.forEach(markerEntry => {
    const root = markerEntry?.isObject3D ? markerEntry : markerEntry?.root;
    if (!root?.isObject3D) throw new TypeError('Monitor marker must be an Object3D or a legacy { root, label } entry');
    root.visible = true;
    if (markerEntry?.label) markerEntry.label.visible = normalizedMode === 'underground';
  });
  mineRuntime?.setViewMode?.(normalizedMode);
  if (mineRuntime?.setLabelMode) mineRuntime.setLabelMode(normalizedMode);
  else mineRuntime?.labels?.forEach(label => {
    label.visible = true;
  });

  if (immediate) {
    camera.position.copy(targetCamPos);
    controls.target.copy(targetLookAt);
    controls.update();
    isTransitioning = false;
  } else {
    isTransitioning = true;
  }
}

function applyCameraFocusPreset(preset, immediate = false) {
  if (!preset) return;
  if (viewMode !== 'underground') applyCameraPreset('underground', true);
  targetCamPos.fromArray(preset.position);
  targetLookAt.fromArray(preset.target);
  camera.fov = preset.fov;
  camera.updateProjectionMatrix();
  controls.minDistance = preset.minDistance ?? 1.2;
  controls.maxDistance = preset.maxDistance ?? 22;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.minPolarAngle = preset.minPolar ?? 0.18;
  controls.maxPolarAngle = preset.maxPolar ?? Math.PI - 0.08;
  controls.autoRotate = false;
  if (immediate) {
    camera.position.copy(targetCamPos);
    controls.target.copy(targetLookAt);
    controls.update();
    isTransitioning = false;
  } else {
    isTransitioning = true;
  }
}

function clearFocusHighlight() {
  if (!focusHighlight) return;
  focusHighlight.parent?.remove(focusHighlight);
  focusHighlight.geometry?.dispose?.();
  focusHighlight.material?.dispose?.();
  focusHighlight = null;
}

function highlightFocusObject(object) {
  clearFocusHighlight();
  if (!object) return;
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const radius = Math.max(0.32, Math.min(0.86, Math.max(size.x, size.z) * 0.16));
  const geometry = new THREE.RingGeometry(radius * 0.78, radius, 48);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffd447,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  focusHighlight = new THREE.Mesh(geometry, material);
  focusHighlight.name = 'equipment-focus-locator-ring';
  focusHighlight.rotation.x = -Math.PI / 2;
  focusHighlight.position.set(center.x, Math.max(0.06, box.min.y + 0.045), center.z);
  scene.add(focusHighlight);
  focusHighlightUntil = performance.now() + 3600;
}

function updateFocusPanel(equipment, meta) {
  const note = document.getElementById('simulationNote');
  if (!note || !equipment) return;
  const install = meta?.install ?? equipment.location;
  const meter = meta?.meter ?? equipment.location;
  const value = meta?.value ?? (equipment.load === null ? '计划检修' : `${equipment.load.toFixed(1)}%`);
  const status = meta?.status ?? equipment.status;
  note.textContent = `定位：${equipment.name}｜位置：${install}｜米标：${meter}｜状态：${status}｜值：${value}`;
  note.dataset.focusUntil = String(Date.now() + 6000);
}

function clampFocusCameraX(value) {
  return Math.max(-3.8, Math.min(3.8, value));
}

const FOCUSED_MACHINE_CAMERA = {
  'EQ-01': { position: [1.18, 2.55, -9.8], target: [0.58, 1.14, -3.25], fov: 43, minDistance: 1.2, maxDistance: 18 },
  'EQ-02': { position: [4.1, 2.55, 7.2], target: [0.65, 0.85, 2.8], fov: 50, minDistance: 1.3, maxDistance: 16 },
  'EQ-03': { position: [-4.45, 3.15, -7.2], target: [-1.95, 2.15, -1.7], fov: 55, minDistance: 1.4, maxDistance: 17 },
  'EQ-04': { position: [3.7, 2.65, 41.5], target: [0.65, 1.05, 31.5], fov: 47, minDistance: 1.6, maxDistance: 20 },
  'EQ-05': { position: [0.25, 3.15, 14.2], target: [-1.2, 1.22, 5.3], fov: 54, minDistance: 1.4, maxDistance: 18 },
  'EQ-06': { position: [-3.9, 2.95, 20.8], target: [1.9, 1.75, 15.7], fov: 49, minDistance: 1.4, maxDistance: 16 },
};

const FOCUSED_MONITOR_CAMERA = {
  'MON-03': { position: [3.15, 4.15, 23.4], target: [0.05, 5.45, 16.0], fov: 45, minDistance: 1.3, maxDistance: 18 },
  'MON-05': { position: [3.35, 4.05, 19.8], target: [1.25, 5.2, 12.0], fov: 44, minDistance: 1.3, maxDistance: 18 },
};

const EQUIPMENT_FOCUS_LABELS = {
  'EQ-01': 'machine-shearer',
  'EQ-02': 'machine-afc',
  'EQ-03': 'machine-supports',
  'EQ-04': 'machine-belt',
  'EQ-05': 'machine-stage-loader',
  'EQ-06': 'machine-crusher',
};

export function switchToOverview() { applyCameraPreset('overview'); }
export function switchToUnderground() { mineRuntime?.setFocusedLabel?.(null); applyCameraPreset('underground', mineRuntime?.variant === 'v2'); }
export function focusMineZone(zoneId) { return sceneAdapter?.focusZone(zoneId) ?? null; }
export function focusMineEquipment(equipmentId) {
  const equipment = EQUIPMENT.find(item => item.id === equipmentId);
  if (!equipment) return null;
  const zoneId = EQUIPMENT_FOCUS_ZONES[equipment.id] ?? 'atlas';
  const rolePosition = sceneAdapter?.getWorldPosition(equipment.sceneObjectName);
  const roleObject = sceneAdapter?.getObject(equipment.sceneObjectName);
  const roleMeta = sceneAdapter?.getObjectMeta(equipment.sceneObjectName);
  if (rolePosition) {
    const machinePreset = FOCUSED_MACHINE_CAMERA[equipment.id];
    if (machinePreset) {
      applyCameraFocusPreset(machinePreset, true);
      mineRuntime?.setFocusedLabel?.(EQUIPMENT_FOCUS_LABELS[equipment.id] ?? null);
      highlightFocusObject(roleObject);
      updateFocusPanel(equipment, roleMeta);
      return { mode: 'machine-preset', equipment, zoneId, preset: machinePreset };
    }
    const monitorPreset = FOCUSED_MONITOR_CAMERA[equipment.id];
    if (monitorPreset) {
      applyCameraFocusPreset(monitorPreset, true);
      mineRuntime?.setFocusedLabel?.(roleMeta?.id ?? null);
      highlightFocusObject(roleObject);
      updateFocusPanel(equipment, roleMeta);
      return { mode: 'monitor-preset', equipment, zoneId, preset: monitorPreset };
    }
    const isMonitor = equipment.id?.startsWith('MON-');
    const cameraX = clampFocusCameraX(rolePosition.x + (rolePosition.x <= 0 ? 2.4 : -2.4));
    const cameraZ = rolePosition.z + (rolePosition.z < 8 ? 7.5 : 8.8);
    const cameraY = rolePosition.y + (isMonitor ? 1.8 : 2.4);
    applyCameraFocusPreset({
      position: [cameraX, cameraY, cameraZ],
      target: [rolePosition.x, rolePosition.y + 0.7, rolePosition.z],
      fov: equipment.id?.startsWith('MON-') ? 38 : 42,
    }, true);
    mineRuntime?.setFocusedLabel?.(null);
    highlightFocusObject(roleObject);
    updateFocusPanel(equipment, roleMeta);
    return { mode: 'object', equipment, zoneId };
  }
  const preset = focusMineZone(zoneId);
  return preset ? { mode: preset.mode, equipment, zoneId, preset } : null;
}

export function getViewMode() { return viewMode; }

const ROOF_STAGE_CAMERA = {
  normalMonitor: {
    roles: ['roofSeparation01', 'roofSeparation02', 'roofSeparation03'],
    offset: [3.4, -2.0, 10.2],
    targetOffset: [0, -0.88, 0.7],
    fov: 45,
    label: null,
  },
  roofPressureRise: {
    roles: ['anchorLoad01', 'roofSeparation02'],
    offset: [2.65, -1.35, 8.4],
    targetOffset: [-0.15, -0.92, -0.35],
    fov: 44,
    minDistance: 7.8,
    label: null,
  },
  roofSeparationAlarm: {
    roles: ['roofSeparation02', 'roofSeparation03'],
    offset: [3.8, -1.05, 10.0],
    targetOffset: [0, -0.95, -0.35],
    fov: 45,
    minDistance: 8.0,
    label: null,
  },
  supportResistanceAlarm: {
    position: [-5.15, 9.8, -8.65],
    target: [-1.25, 4.62, -3.0],
    fov: 46,
    minDistance: 7.2,
    maxDistance: 28,
    minPolar: 0.12,
    maxPolar: Math.PI * 0.54,
    label: 'machine-supports',
    inspectionView: true,
  },
  roofFallWarning: {
    position: [-5.35, 10.2, -10.25],
    target: [-1.05, 4.62, -4.35],
    fov: 46,
    minDistance: 7.4,
    maxDistance: 28,
    minPolar: 0.12,
    maxPolar: Math.PI * 0.54,
    label: 'machine-supports',
    inspectionView: true,
  },
  emergencyResponse: {
    roles: ['stageLoaderSZZ1200', 'undergroundBeltDSJ120'],
    offset: [-2.75, 4.25, 10.4],
    targetOffset: [0.1, 0.78, 0.45],
    fov: 49,
    minDistance: 8.2,
    maxDistance: 25,
    minPolar: 0.32,
    maxPolar: Math.PI * 0.78,
    label: 'machine-belt',
  },
};

function averageRolePosition(roles) {
  const points = roles
    .map(role => sceneAdapter?.getWorldPosition(role))
    .filter(Boolean);
  if (!points.length) return null;
  return points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
}

const ROOF_INSPECTION_DIM_ROLES = ['shearer', 'scraperConveyor', 'hydraulicSupportArray', 'stageLoaderSZZ1200'];
const roofInspectionMaterialState = new WeakMap();

function setObjectInspectionOpacity(object, opacity) {
  object?.traverse?.((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => {
      if (!roofInspectionMaterialState.has(material)) {
        roofInspectionMaterialState.set(material, {
          transparent: material.transparent,
          opacity: material.opacity,
          depthWrite: material.depthWrite,
        });
      }
      material.transparent = true;
      material.opacity = Math.min(material.opacity, opacity);
      material.depthWrite = false;
      material.needsUpdate = true;
    });
  });
}

function restoreInspectionOpacity(object) {
  object?.traverse?.((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => {
      const original = roofInspectionMaterialState.get(material);
      if (!original) return;
      material.transparent = original.transparent;
      material.opacity = original.opacity;
      material.depthWrite = original.depthWrite;
      material.needsUpdate = true;
      roofInspectionMaterialState.delete(material);
    });
  });
}

function setRoofInspectionView(enabled) {
  ROOF_INSPECTION_DIM_ROLES
    .map(role => sceneAdapter?.getObject(role))
    .filter(Boolean)
    .forEach(object => (enabled ? setObjectInspectionOpacity(object, 0.22) : restoreInspectionOpacity(object)));
}

export function focusRoofWarningStage(stageId) {
  if (viewMode !== 'underground') switchToUnderground();
  const preset = ROOF_STAGE_CAMERA[stageId] ?? ROOF_STAGE_CAMERA.normalMonitor;
  const isFallWarning = stageId === 'roofFallWarning';
  setRoofInspectionView(Boolean(preset.inspectionView));
  roofFieldStage = stageId ?? 'normalMonitor';
  updateRoofFieldCloud(roofFieldCloud, roofFieldStage, null, performance.now() * 0.001, true);
  if (preset.position && preset.target) {
    applyCameraFocusPreset({
      position: preset.position,
      target: preset.target,
      fov: preset.fov,
      minDistance: preset.minDistance ?? 7.2,
      maxDistance: preset.maxDistance ?? 24,
      minPolar: preset.minPolar ?? 0.22,
      maxPolar: preset.maxPolar ?? Math.PI * 0.78,
    }, Boolean(preset.inspectionView));
    mineRuntime?.setFocusedLabel?.(preset.label);
    return { stageId, center: null, preset };
  }
  const center = averageRolePosition(preset.roles);
  if (!center) return null;
  const offset = new THREE.Vector3(...preset.offset);
  const targetOffset = new THREE.Vector3(...preset.targetOffset);
  applyCameraFocusPreset({
    position: [center.x + offset.x, center.y + offset.y, center.z + offset.z],
    target: [center.x + targetOffset.x, center.y + targetOffset.y, center.z + targetOffset.z],
    fov: preset.fov,
    minDistance: preset.minDistance ?? (isFallWarning ? 11.2 : 7.2),
    maxDistance: preset.maxDistance ?? 24,
    minPolar: preset.minPolar ?? (isFallWarning ? 0.28 : 0.22),
    maxPolar: preset.maxPolar ?? (isFallWarning ? Math.PI * 0.72 : Math.PI * 0.78),
  }, false);
  mineRuntime?.setFocusedLabel?.(preset.label);
  return { stageId, center: center.toArray(), preset };
}

export function setRoofFieldMode(mode) {
  if (!roofFieldCloud) return false;
  const ok = setRoofFieldCloudMode(roofFieldCloud, mode);
  if (ok) updateRoofFieldCloud(roofFieldCloud, roofFieldStage, mode, performance.now() * 0.001, true);
  return ok;
}

export function setRoofFieldVisible(visible) {
  if (!roofFieldCloud) return false;
  roofFieldCloud.visible = Boolean(visible);
  return true;
}

function applyRoofFieldStage(stageId) {
  roofFieldStage = stageId ?? 'normalMonitor';
  updateRoofFieldCloud(roofFieldCloud, roofFieldStage, null, performance.now() * 0.001, true);
}

// ==================== 灾害视觉效果 ====================
const tempEffects = []; // 临时效果对象，reset时清除

function addTemp(obj) { tempEffects.push(obj); return obj; }

// ==================== 模型破坏记录（用于恢复） ====================
const damageRecords = []; // { undo: () => void }

function recordDamage(undoFn) {
  damageRecords.push({ undo: undoFn });
}

function undoAllDamage() {
  // 倒序恢复
  for (let i = damageRecords.length - 1; i >= 0; i--) {
    try { damageRecords[i].undo(); } catch(e) {}
  }
  damageRecords.length = 0;
}

// 辅助：保存对象原始transform并返回恢复函数
function saveTransform(obj) {
  const pos = obj.position.clone();
  const rot = obj.rotation.clone();
  const scl = obj.scale.clone();
  return () => { obj.position.copy(pos); obj.rotation.copy(rot); obj.scale.copy(scl); };
}

// 辅助：保存对象可见性
function saveVisibility(obj) {
  const vis = obj.visible;
  return () => { obj.visible = vis; };
}

function resolveEffectPosition(role, fallback) {
  return sceneAdapter?.getWorldPosition(role) ?? new THREE.Vector3(...fallback);
}

const ROOF_RISK_LEVELS = {
  normal: { color: 0x2ee68a, opacity: 0.16, emissive: 0x0a4f2e, pulse: 1.2 },
  watch: { color: 0xffc247, opacity: 0.22, emissive: 0x6b4200, pulse: 1.8 },
  warn: { color: 0xff7a1a, opacity: 0.28, emissive: 0x7a2500, pulse: 2.4 },
  danger: { color: 0xff263a, opacity: 0.28, emissive: 0x7a0008, pulse: 3.2 },
  control: { color: 0x28d7ff, opacity: 0.16, emissive: 0x004966, pulse: 2.0 },
};

function removeRoofRiskEffects() {
  const toRemove = [];
  scene.traverse(obj => {
    if (obj.userData?.roofRiskEffect) toRemove.push(obj);
  });
  toRemove.forEach(obj => {
    if (obj.parent) obj.parent.remove(obj);
    obj.traverse?.(child => {
      child.geometry?.dispose?.();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose?.());
        else child.material.dispose?.();
      }
    });
  });
}

function addRoofRiskBand(level, role, fallback, options = {}) {
  const cfg = ROOF_RISK_LEVELS[level] ?? ROOF_RISK_LEVELS.watch;
  const center = resolveEffectPosition(role, fallback);
  const band = addTemp(new THREE.Group());
  band.name = `roof-risk-zone-${level}-${role}`;
  band.userData = { roofRiskEffect: true };
  band.position.copy(center).add(new THREE.Vector3(options.offsetX ?? 0, options.offsetY ?? -0.2, options.offsetZ ?? 0));
  scene.add(band);

  const halo = addTemp(new THREE.PointLight(cfg.color, (options.light ?? 1.4) * 0.55, options.lightDistance ?? 9, 2));
  halo.name = `roof-risk-light-${level}-${role}`;
  halo.userData = { roofRiskEffect: true, baseIntensity: (options.light ?? 1.4) * 0.55, pulse: cfg.pulse };
  halo.position.copy(center).add(new THREE.Vector3(0, -0.8, 0));
  scene.add(halo);
  return band;
}

function tintRoofMonitor(role, level, fallback) {
  const obj = sceneAdapter?.getObject(role);
  const cfg = ROOF_RISK_LEVELS[level] ?? ROOF_RISK_LEVELS.watch;
  if (role?.startsWith?.('roofSeparation')) {
    // 离层仪本身是细杆传感器，整根染红在镜头里会像异常粗线；风险范围交给云图表达。
    return;
  }
  if (obj) {
    obj.traverse(child => {
      if (child.material?.color) {
        const originalColor = child.material.color.clone();
        const originalEmissive = child.material.emissive?.clone?.();
        const originalEmissiveIntensity = child.material.emissiveIntensity;
        recordDamage(() => {
          child.material.color.copy(originalColor);
          if (originalEmissive && child.material.emissive) child.material.emissive.copy(originalEmissive);
          if (originalEmissiveIntensity !== undefined) child.material.emissiveIntensity = originalEmissiveIntensity;
        });
        child.material.color.set(cfg.color);
        if (child.material.emissive) {
          child.material.emissive.set(cfg.emissive);
          child.material.emissiveIntensity = level === 'danger' ? 1.4 : 0.8;
        }
      }
    });
  }

  // 风险空间分布由顶板云图承担；这里仅调整对象材质，避免额外圆点/线条干扰录屏画面。
}

function showRoofRisk(level, options = {}) {
  removeRoofRiskEffects();
  const targets = options.targets ?? [
    ['roofSeparation01', [0, 6.45, 4]],
    ['roofSeparation02', [0, 6.45, 10]],
    ['roofSeparation03', [0, 6.45, 16]],
    ['anchorLoad01', [2.25, 6.05, 12]],
  ];
  targets.forEach(([role, fallback], index) => {
    addRoofRiskBand(level, role, fallback, {
      width: role === 'anchorLoad01' ? 1.9 : 2.65,
      length: level === 'danger' ? 4.8 : 3.7,
      offsetZ: index === 0 ? 0.3 : 0,
      light: level === 'danger' ? 2.6 : 1.3,
    });
    tintRoofMonitor(role, level, fallback);
  });

  if (options.includeFace) {
    addRoofRiskBand(level, 'supportPressure03', [-1.1, 2.3, -4.8], {
      width: 1.85,
      length: 2.45,
      offsetY: 2.15,
      light: level === 'danger' ? 2.8 : 1.4,
    });
    tintRoofMonitor('supportPressure03', level, [-1.1, 2.3, -4.8]);
  }
}

function createEvacuationArrow(color = 0x28d7ff) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.42, -0.72);
  shape.lineTo(0.18, -0.72);
  shape.lineTo(0.18, -1.08);
  shape.lineTo(0.86, 0);
  shape.lineTo(0.18, 1.08);
  shape.lineTo(0.18, 0.72);
  shape.lineTo(-0.42, 0.72);
  shape.lineTo(-0.42, -0.72);
  const mesh = addTemp(new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  ));
  mesh.name = 'emergency-evacuation-arrow';
  mesh.userData = { roofRiskEffect: true, baseOpacity: 0.38, pulse: 2.4 };
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = Math.PI / 2;
  return mesh;
}

function addEmergencyLabel(text, position, level = 'danger') {
  const div = document.createElement('div');
  const color = level === 'danger' ? '#ffc2be' : '#ffe0a6';
  const border = level === 'danger' ? 'rgba(255,93,85,0.76)' : 'rgba(243,167,18,0.76)';
  const bg = level === 'danger' ? 'rgba(55,8,12,0.9)' : 'rgba(40,29,8,0.9)';
  div.textContent = text;
  div.style.cssText = [
    'padding:3px 7px',
    `border:1px solid ${border}`,
    'border-radius:4px',
    `background:${bg}`,
    `color:${color}`,
    'font:700 10px/14px var(--font-sans)',
    'letter-spacing:0.5px',
    'white-space:nowrap',
    'box-shadow:0 4px 14px rgba(0,0,0,0.42)',
  ].join(';');
  const label = addTemp(new CSS2DObject(div));
  label.name = 'emergency-decision-label';
  label.userData = { roofRiskEffect: true };
  label.position.copy(position);
  scene.add(label);
  return label;
}

function addCordonLine(center, options = {}) {
  const group = addTemp(new THREE.Group());
  group.name = 'emergency-cordon-line';
  group.userData = { roofRiskEffect: true };
  const width = options.width ?? 4.2;
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(width / 7, 0.035, 0.14),
      new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xffffff : 0xff263a,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      })
    );
    seg.position.set(-width / 2 + (i + 0.5) * width / 7, 0, 0);
    group.add(seg);
  }
  group.position.copy(center);
  group.rotation.y = options.rotationY ?? 0;
  undergroundGroup.add(group);
  return group;
}

function addEmergencyResponseMarkers(mode = 'danger') {
  const face = resolveEffectPosition('workingFace', [0, 2, -4.5]);
  const baseY = Math.max(0.08, face.y - 1.65);
  const arrowColor = mode === 'control' ? 0x28d7ff : 0xffd447;
  [3.2, 8.2, 13.2].forEach((offsetZ, index) => {
    const arrow = createEvacuationArrow(arrowColor);
    arrow.position.set(face.x - 3.25, baseY + 0.018, face.z + offsetZ);
    arrow.scale.setScalar(index === 0 ? 0.58 : 0.66);
    undergroundGroup.add(arrow);
  });

  addCordonLine(new THREE.Vector3(face.x - 0.45, baseY + 0.05, face.z + 0.35), {
    width: 3.35,
    rotationY: 0,
  });

  addEmergencyLabel('撤离方向 →', new THREE.Vector3(face.x - 3.45, baseY + 0.72, face.z + 13.6), 'control');
  addEmergencyLabel('封控区：禁止进入', new THREE.Vector3(face.x - 0.45, baseY + 1.0, face.z + 0.35), 'danger');
  addEmergencyLabel(mode === 'control' ? '停机 · 断电 · 补强支护' : '红色预警：准备撤人停机', new THREE.Vector3(face.x + 1.55, baseY + 1.8, face.z - 1.0), mode === 'control' ? 'control' : 'danger');
}

export const disasterEffects = {

  roofRiskNormal() {
    applyRoofFieldStage('normalMonitor');
    showRoofRisk('normal', {
      targets: [
        ['roofSeparation01', [0, 6.45, 4]],
        ['roofSeparation02', [0, 6.45, 10]],
      ],
    });
  },

  roofRiskWatch() {
    applyRoofFieldStage('roofPressureRise');
    showRoofRisk('watch');
  },

  roofRiskWarn() {
    applyRoofFieldStage('roofSeparationAlarm');
    showRoofRisk('warn');
    const riskCenter = resolveEffectPosition('roofSeparation02', [0, 6.45, 10]);
    spawnBurstParticles(riskCenter.x, riskCenter.y - 0.35, riskCenter.z, 0xffaa33, 45, 1.2, 0.045);
  },

  supportOverload() {
    applyRoofFieldStage('supportResistanceAlarm');
    showRoofRisk('warn', { includeFace: true });
    const support = sceneAdapter?.getObject('supportPressure03');
    if (support) {
      recordDamage(saveTransform(support));
      support.position.y -= 0.08;
      support.rotation.z += 0.035;
    }
  },

  roofRiskDanger() {
    applyRoofFieldStage('roofFallWarning');
    showRoofRisk('danger', { includeFace: true });
    addEmergencyResponseMarkers('danger');
    const riskCenter = resolveEffectPosition('roofSeparation03', [0, 6.45, 16]);
    spawnBurstParticles(riskCenter.x, riskCenter.y - 0.35, riskCenter.z, 0xff4a2f, 48, 1.6, 0.05);
  },

  emergencyControl() {
    applyRoofFieldStage('emergencyResponse');
    showRoofRisk('control', { includeFace: true });
    addEmergencyResponseMarkers('control');
  },

  /** 爆炸：闪光 + 摧毁煤壁 + 支架歪斜 + 采煤机位移 + 碎石 */
  explosion() {
    const effectPosition = resolveEffectPosition('coalWall', [14.5, -8, -4.5]);
    // --- 闪光 + 粒子 ---
    const flash = addTemp(new THREE.PointLight(0xff6600, 80, 20, 2));
    flash.position.copy(effectPosition);
    scene.add(flash);
    const flash2 = addTemp(new THREE.PointLight(0xff4400, 50, 15, 2));
    flash2.position.copy(effectPosition).add(new THREE.Vector3(-1.5, 1, 0));
    scene.add(flash2);
    let count = 0;
    const iv = setInterval(() => {
      count++;
      flash.intensity = count % 2 ? 80 : 5;
      flash2.intensity = count % 2 ? 50 : 2;
      if (count > 6) { clearInterval(iv); flash.intensity = 5; flash2.intensity = 2; }
    }, 150);
    addTemp({ parent: scene, _iv: iv }); // 存一下以防万一

    spawnBurstParticles(effectPosition.x, effectPosition.y, effectPosition.z, 0xff8844, 200, 4, 0.15);

    // --- 摧毁煤壁 ---
    scene.traverse(c => {
      if (c.name === 'coalWall') {
        recordDamage(saveVisibility(c));
        c.visible = false;

        // 在煤壁位置生成不规则碎石
        const wallPos = c.position.clone();
        const wallParent = c.parent;
        if (wallParent) {
          for (let i = 0; i < 25; i++) {
            const sz = 0.12 + Math.random() * 0.4;
            const frag = new THREE.Mesh(
              new THREE.IcosahedronGeometry(sz, 1),
              new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.15 })
            );
            frag.position.copy(wallPos).add(
              new THREE.Vector3(
                (Math.random() - 0.5) * 1.5,
                (Math.random() - 0.5) * 3,
                (Math.random() - 0.5) * 2.5
              )
            );
            frag.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            frag.name = 'coalFrag';
            frag.userData = { velX: (Math.random() - 0.5) * 0.08, velY: (Math.random() - 0.5) * 0.04 };
            wallParent.add(frag);
            recordDamage(() => { if (frag.parent) frag.parent.remove(frag); frag.geometry?.dispose(); frag.material?.dispose(); });
          }
        }
      }
    });

    // --- 液压支架歪斜/倒下 ---
    let supportIdx = 0;
    scene.traverse(c => {
      if (c.name === 'support' && supportIdx < 3) {
        recordDamage(saveTransform(c));
        // 随机方向倒伏
        c.rotation.z += (Math.random() - 0.3) * 1.2;
        c.rotation.x += (Math.random() - 0.5) * 0.8;
        c.position.y -= 0.3 + Math.random() * 0.6;
        c.position.x += (Math.random() - 0.5) * 0.8;
        supportIdx++;
      }
    });

    // --- 采煤机位移 ---
    if (shearerBody) {
      recordDamage(saveTransform(shearerBody));
      shearerBody.position.x -= 0.8;
      shearerBody.position.y -= 0.5;
      shearerBody.rotation.z += 0.4;
    }

    // --- 巷道口碎石堵塞 ---
    for (let i = 0; i < 30; i++) {
      const sz = 0.15 + Math.random() * 0.5;
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(sz, 1),
        new THREE.MeshStandardMaterial({ color: 0x5a4a3a + Math.floor(Math.random() * 0x303030), roughness: 0.85 })
      );
      rock.position.copy(effectPosition).add(new THREE.Vector3(-2.5 + Math.random() * 2, -0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 3));
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      rock.name = 'debris';
      rock.userData = { velY: -0.01, settled: false };
      undergroundGroup.add(rock);
      recordDamage(() => { if (rock.parent) rock.parent.remove(rock); rock.geometry?.dispose(); rock.material?.dispose(); });
    }

    // --- 相机震动 ---
    const origAuto = controls.autoRotate;
    controls.autoRotate = false;
    setTimeout(() => { controls.autoRotate = origAuto; }, 800);
  },

  /** 突出：煤岩射出 + 煤壁大洞 + 煤块铺满巷道 */
  outburst() {
    const effectPosition = resolveEffectPosition('coalWall', [14.5, -8, -4.5]);
    spawnBurstParticles(effectPosition.x, effectPosition.y, effectPosition.z, 0x332211, 350, 7, 0.22);
    spawnBurstParticles(effectPosition.x, effectPosition.y + 1, effectPosition.z, 0x998866, 180, 5, 0.14);

    // 煤壁开大洞
    scene.traverse(c => {
      if (c.name === 'coalWall') {
        recordDamage(saveVisibility(c));
        c.visible = false;
        const wp = c.position.clone();
        const wPar = c.parent;
        if (wPar) {
          // 空洞 + 喷射出的巨量煤块
          for (let i = 0; i < 50; i++) {
            const sz = 0.1 + Math.random() * 0.5;
            const lump = new THREE.Mesh(
              new THREE.IcosahedronGeometry(sz, 1),
              new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 })
            );
            lump.position.copy(wp).add(
              new THREE.Vector3(
                (Math.random() - 0.8) * 3,  // 向巷道内喷射
                (Math.random() - 0.5) * 3,
                (Math.random() - 0.5) * 4
              )
            );
            lump.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            lump.name = 'coalFrag';
            lump.userData = { velX: -0.02 - Math.random() * 0.1, velY: 0.01 - Math.random() * 0.02 };
            wPar.add(lump);
            recordDamage(() => { if (lump.parent) lump.parent.remove(lump); lump.geometry?.dispose(); lump.material?.dispose(); });
          }
        }
      }
    });

    // 支架也被冲歪
    let si = 0;
    scene.traverse(c => {
      if (c.name === 'support' && si < 2) {
        recordDamage(saveTransform(c));
        c.rotation.z += (Math.random() - 0.5) * 0.6;
        c.position.x -= 0.5 + Math.random();
        si++;
      }
    });
  },

  /** 局部掉渣 */
  smallFall() {
    const effectPosition = resolveEffectPosition('workingFace', [14, -7, -4.5]);
    for (let i = 0; i < 15; i++) {
      const sz = 0.08 + Math.random() * 0.18;
      const d = new THREE.Mesh(
        new THREE.IcosahedronGeometry(sz, 0),
        new THREE.MeshStandardMaterial({ color: 0x6b5b4a, roughness: 0.9 })
      );
      d.position.copy(effectPosition).add(new THREE.Vector3(-1 + Math.random() * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2));
      d.name = 'debris';
      d.userData = { velY: -0.02 - Math.random() * 0.05, settled: false };
      undergroundGroup.add(d);
      recordDamage(() => { if (d.parent) d.parent.remove(d); d.geometry?.dispose(); d.material?.dispose(); });
    }
  },

  /** 大面积顶板垮落 */
  roofFall() {
    showRoofRisk('danger', { includeFace: true });
    const effectPosition = resolveEffectPosition('workingFace', [13, -7, -4.5]);
    // 大量顶板碎石
    for (let i = 0; i < 60; i++) {
      const sz = 0.1 + Math.random() * 0.6;
      const d = new THREE.Mesh(
        new THREE.IcosahedronGeometry(sz, 1),
        new THREE.MeshStandardMaterial({ color: 0x6b5b4a + Math.floor(Math.random() * 0x202020), roughness: 0.85 })
      );
      d.position.copy(effectPosition).add(new THREE.Vector3(-3 + Math.random() * 6, Math.random() * 1.5, (Math.random() - 0.5) * 4));
      d.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      d.name = 'debris';
      d.userData = { velY: -0.01 - Math.random() * 0.04, settled: false };
      undergroundGroup.add(d);
      recordDamage(() => { if (d.parent) d.parent.remove(d); d.geometry?.dispose(); d.material?.dispose(); });
    }

    // 支架压垮（隐藏部分 + 压扁）
    let sc = 0;
    scene.traverse(c => {
      if (c.name === 'support' && sc < 3) {
        if (sc < 2) {
          recordDamage(saveVisibility(c));
          c.visible = false;
        } else {
          recordDamage(saveTransform(c));
          c.scale.y = 0.3;
          c.position.y -= 0.8;
        }
        sc++;
      }
    });

    // 粉尘
    spawnBurstParticles(effectPosition.x, effectPosition.y, effectPosition.z, 0x887766, 250, 5, 0.18);
  },

  /** 渗水 */
  seepage() {
    const effectPosition = resolveEffectPosition('workingFace', [15, -8, -4.5]);
    for (let i = 0; i < 20; i++) {
      const drop = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.7 })
      );
      drop.position.copy(effectPosition).add(new THREE.Vector3(-1 + Math.random() * 2, -1 + Math.random() * 2, (Math.random() - 0.5) * 3));
      drop.name = 'waterDrop';
      drop.userData = { velY: -0.01 - Math.random() * 0.03 };
      undergroundGroup.add(drop);
      recordDamage(() => { if (drop.parent) drop.parent.remove(drop); drop.geometry?.dispose(); drop.material?.dispose(); });
    }
  },

  /** 突水涌入 */
  waterInrush() {
    const effectPosition = resolveEffectPosition('pumpRoom', [14, -9, -4.5]);
    spawnBurstParticles(effectPosition.x, effectPosition.y, effectPosition.z, 0x3388ff, 200, 5, 0.15);
    const waterPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 5),
      new THREE.MeshBasicMaterial({ color: 0x2266cc, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
    );
    waterPlane.rotation.x = -Math.PI / 2;
    waterPlane.position.copy(effectPosition).add(new THREE.Vector3(-5, -2.5, 0));
    waterPlane.name = 'waterPlane';
    waterPlane.userData = { targetY: waterPlane.position.y + 2, speed: 0.02 };
    undergroundGroup.add(waterPlane);
    recordDamage(() => { if (waterPlane.parent) waterPlane.parent.remove(waterPlane); waterPlane.geometry?.dispose(); waterPlane.material?.dispose(); });
  },

  /** 持续淹水 */
  flooding() {
    const effectPosition = resolveEffectPosition('pumpRoom', [10, -9, -4.5]);
    spawnBurstParticles(effectPosition.x, effectPosition.y, effectPosition.z, 0x3388ff, 100, 3, 0.1);
  },

  /** 烟雾 */
  smoke() {
    const effectPosition = resolveEffectPosition('workingFace', [11, -7, -4.5]);
    spawnBurstParticles(effectPosition.x, effectPosition.y, effectPosition.z, 0x555544, 80, 4, 0.1);
    const sl = addTemp(new THREE.PointLight(0xff6600, 10, 12, 2));
    sl.position.copy(effectPosition).add(new THREE.Vector3(0, -1, 0));
    scene.add(sl);
  },

  /** 起火前兆 */
  fireStart() {
    const effectPosition = resolveEffectPosition('workingFace', [11, -9, -4.5]);
    const fl = addTemp(new THREE.PointLight(0xff4400, 20, 12, 2));
    fl.position.copy(effectPosition);
    fl.name = 'fireLight';
    scene.add(fl);
    spawnBurstParticles(effectPosition.x, effectPosition.y, effectPosition.z, 0x664400, 60, 3, 0.08);

    // 采空区变暗（表示氧化）
    scene.traverse(c => {
      if ((c.name === 'goafRock' || c.name === 'coalSeam') && c.material && c.material.emissive) {
        recordDamage(() => { c.material.emissive.set(0x020202); c.material.emissiveIntensity = 0.5; });
        c.material.emissive.set(0x331100);
        c.material.emissiveIntensity = 0.8;
      }
    });
  },

  /** 明火燃烧 */
  fire() {
    const effectPosition = resolveEffectPosition('workingFace', [11, -9, -4.5]);
    const fl = addTemp(new THREE.PointLight(0xff3300, 40, 16, 2));
    fl.position.copy(effectPosition);
    fl.name = 'fireLight';
    scene.add(fl);
    spawnBurstParticles(effectPosition.x, effectPosition.y, effectPosition.z, 0xff6600, 150, 4, 0.12);
    spawnBurstParticles(effectPosition.x, effectPosition.y + 0.5, effectPosition.z, 0xff4400, 100, 3, 0.1);
    spawnBurstParticles(effectPosition.x, effectPosition.y + 2, effectPosition.z, 0x333322, 100, 5, 0.15);

    // 采空区岩石变红热
    scene.traverse(c => {
      if (c.name === 'goafRock' && c.material && c.material.emissive) {
        recordDamage(() => { c.material.emissive.set(0x020202); c.material.emissiveIntensity = 0.5; });
        c.material.emissive.set(0x661100);
        c.material.emissiveIntensity = 1.2;
      }
    });
  },

  /** 灾后 */
  aftermath() {
    scene.traverse(c => {
      if (c.name === 'dust' && c.isPoints && !c.userData?.isAmbientTunnelDust) {
        c.material.opacity = 0.7;
        c.material.size = 0.2;
      }
    });
  },

  /** 全部复位：撤销模型破坏 + 清除粒子/灯光 */
  reset() {
    applyRoofFieldStage('normalMonitor');
    // 1. 撤销所有模型修改
    undoAllDamage();

    // 2. 清除临时粒子/灯光等
    tempEffects.forEach(obj => {
      if (obj._iv) clearInterval(obj._iv);
      if (obj.parent) obj.parent.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    tempEffects.length = 0;

    // 3. 恢复粒子默认参数
    scene.traverse(c => {
      if (c.name === 'dust' && c.isPoints && !c.userData?.isAmbientTunnelDust) {
        c.material.opacity = 0.45;
        c.material.size = 0.12;
      }
    });
  },
};

/** 创建爆发粒子 */
function spawnBurstParticles(x, y, z, color, count, spread, size) {
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    velocities[i * 3] = (Math.random() - 0.5) * spread;
    velocities[i * 3 + 1] = (Math.random() - 0.2) * spread;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * spread;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color, size, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = addTemp(new THREE.Points(geo, mat));
  pts.userData = { velocities, spread, life: 1.0 };
  pts.name = 'burstParticles';
  scene.add(pts);
  return pts;
}

// ==================== 鼠标控制 ====================
function setupCustomControls(container) {
  const canvas = renderer.domElement;
  const tipEl = container.querySelector('.scene-tips');

  function setMode(m) {
    controlMode = m;
    controls.mouseButtons = m === 'rotate'
      ? { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY }
      : { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY };
    if (tipEl) {
      tipEl.textContent = m === 'rotate'
        ? '左键旋转 | 滚轮缩放 | 右键切换平移模式'
        : '左键平移 | 滚轮缩放 | 右键切换旋转模式';
    }
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (e.button === 2) setMode(controlMode === 'rotate' ? 'pan' : 'rotate');
  });

  setMode('rotate');
}

// ==================== 动画 ====================
function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1);
  const t = performance.now() * 0.001;

  if (mineRuntime) mineRuntime.update(dt, t);
  animateRoofFieldCloud(roofFieldCloud, t);
  if (focusHighlight) {
    if (typeof focusHighlight.update === 'function') focusHighlight.update();
    else {
      focusHighlight.rotation.z += dt * 0.9;
      focusHighlight.material.opacity = 0.18 + Math.sin(t * 5) * 0.04;
    }
    if (performance.now() > focusHighlightUntil) clearFocusHighlight();
  }

  if (isTransitioning) {
    const transitionRate = viewMode === 'underground' ? 4.2 : 4.8;
    const blend = 1 - Math.exp(-transitionRate * dt);
    camera.position.lerp(targetCamPos, blend);
    controls.target.lerp(targetLookAt, blend);
    if (camera.position.distanceTo(targetCamPos) < 0.2) {
      camera.position.copy(targetCamPos);
      controls.target.copy(targetLookAt);
      isTransitioning = false;
    }
  }

  controls.update();

  // 滚筒旋转 + 风机旋转
  scene.traverse(c => {
    if (c.name === 'drum') c.rotation.x += dt * 3;
    if (c.name === 'fan') c.rotation.x += dt * 5;
  });

  // 采煤机沿工作面往复（z方向）

  // 指示灯闪烁
  indicators.forEach(ind => {
    const b = 0.5 + 0.5 * Math.sin(t * 3 + ind.phase);
    ind.mesh.material.opacity = b;
    const g = ind.mesh.children[0];
    if (g) g.material.opacity = b * 0.3;
  });

  // 煤尘动画
  scene.traverse(c => {
    if (c.name === 'dust' && c.isPoints && c !== mineRuntime?.dust && !c.userData?.isAmbientTunnelDust) {
      const pos = c.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.array[i * 3 + 1] += (Math.random() - 0.5) * 0.03;
        pos.array[i * 3] += (Math.random() - 0.5) * 0.02;
        if (Math.abs(pos.array[i * 3 + 1] - (-0.5)) > 2) pos.array[i * 3 + 1] = -0.5;
      }
      pos.needsUpdate = true;
    }
    if (c.name === 'coalLump') {
      c.position.y += (Math.random() - 0.5) * 0.005;
      c.rotation.z += (Math.random() - 0.5) * 0.02;
    }
    // 爆发粒子扩散
    if (c.name === 'burstParticles' && c.isPoints && c.userData.velocities) {
      const pos = c.geometry.attributes.position;
      const vel = c.userData.velocities;
      const spread = c.userData.spread;
      for (let i = 0; i < pos.count; i++) {
        pos.array[i * 3] += vel[i * 3] * dt;
        pos.array[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos.array[i * 3 + 2] += vel[i * 3 + 2] * dt;
        // 减速
        vel[i * 3] *= 0.995;
        vel[i * 3 + 1] *= 0.995;
        vel[i * 3 + 2] *= 0.995;
      }
      pos.needsUpdate = true;
      // 淡出
      c.userData.life -= dt;
      if (c.userData.life < 0 && c.material.opacity > 0) {
        c.material.opacity = Math.max(0, c.material.opacity - dt * 0.8);
      }
    }
    // 水位面上涨
    if (c.name === 'waterPlane' && c.userData.targetY) {
      if (c.position.y < c.userData.targetY) {
        c.position.y += c.userData.speed;
      }
    }
    // 水珠下落
    if (c.name === 'waterDrop' && c.userData.velY) {
      c.position.y += c.userData.velY;
      if (c.position.y < -11.5) c.position.y = -8;
    }
    // 碎石/煤块下落
    if ((c.name === 'debris' || c.name === 'coalFrag') && c.userData) {
      if (!c.userData.settled && c.position.y > -11.5) {
        c.position.y += c.userData.velY || -0.01;
        if (c.userData.velX) c.position.x += c.userData.velX;
        c.rotation.x += 0.03;
        c.rotation.z += 0.03;
        // 落地后停止
        if (c.position.y <= -11.2) {
          c.position.y = -11.2;
          c.userData.settled = true;
        }
      }
    }
    // 火焰灯光闪烁
    if (c.userData?.roofRiskEffect) {
      const pulse = 0.72 + Math.sin(t * (c.userData.pulse ?? 2.0)) * 0.28;
      if (c.material?.opacity !== undefined && c.userData.baseOpacity !== undefined) {
        c.material.opacity = Math.max(0.06, c.userData.baseOpacity * pulse);
      }
      if (c.isLight && c.userData.baseIntensity !== undefined) {
        c.intensity = c.userData.baseIntensity * (0.75 + pulse);
      }
    }
    if (c.name === 'fireLight' && c.isLight) {
      c.intensity = 30 + Math.sin(t * 15) * 10 + Math.sin(t * 23) * 5;
    }
  });

  composer.render();
  labelRenderer.render(scene, camera);
  if (mineRuntime?.variant === 'v2' && diagnosticsElement) {
    diagnosticsFrameCount += 1;
    const elapsed = performance.now() - diagnosticsStartedAt;
    if (elapsed >= 500) {
      diagnosticsElement.dataset.averageFps = (diagnosticsFrameCount * 1000 / elapsed).toFixed(1);
      diagnosticsElement.dataset.textures = renderer.info.memory.textures.toString();
      diagnosticsElement.dataset.geometries = renderer.info.memory.geometries.toString();
      diagnosticsElement.dataset.sampleMs = Math.round(elapsed).toString();
      diagnosticsElement.dataset.cameraPosition = camera.position.toArray().map(value => value.toFixed(2)).join(',');
      diagnosticsElement.dataset.cameraTarget = controls.target.toArray().map(value => value.toFixed(2)).join(',');
    }
  }
}

function onResize(containerId) {
  const container = document.getElementById(containerId);
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  labelRenderer.setSize(w, h);
}
