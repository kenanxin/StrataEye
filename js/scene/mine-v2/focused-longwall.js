import * as THREE from 'three';
import { FOCUSED_LONGWALL_LAYOUT } from './config.mjs';
import { loadAvailableModels } from '../asset-loader.js';
import { MODEL_ASSETS } from '../asset-registry.js';

function cloneMaterial(material, color, options = {}) {
  const next = material.clone();
  if (color !== undefined) next.color.setHex(color);
  Object.assign(next, options);
  next.needsUpdate = true;
  return next;
}

function register(runtime, role, object, meta = {}) {
  runtime.objectsByRole.set(role, object);
  object.userData.role = role;
  object.userData.focusMeta = meta;
  return object;
}

function addBox(root, name, size, position, material, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function addCylinderBetween(root, name, start, end, radius, material, radialSegments = 10) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const direction = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), radialSegments), material);
  mesh.name = name;
  mesh.position.copy(a.add(b).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function addPanelLine(root, name, start, end, material) {
  return addCylinderBetween(root, name, start, end, 0.025, material, 6);
}

function normalizeImportedModel(model, { targetLength = 10, targetHeight = null } = {}) {
  const wrapper = new THREE.Group();
  wrapper.add(model);
  wrapper.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(model);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  const basis = targetHeight ? initialSize.y : Math.max(initialSize.x, initialSize.y, initialSize.z);
  const target = targetHeight ?? targetLength;
  model.scale.multiplyScalar(target / (basis || 1));
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= bounds.min.y;
  model.position.z -= center.z;
  wrapper.updateMatrixWorld(true);
  return wrapper;
}

function cloneModelRoot(source) {
  const clone = source.clone(true);
  clone.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return clone;
}

function cloneWorldObject(source) {
  source.updateWorldMatrix(true, false);
  const clone = source.clone(true);
  source.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
  clone.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return clone;
}

function assembledConveyorOnly(sourceRoot) {
  const assembly = new THREE.Group();
  assembly.name = 'imported-conveyor-only-assembly';
  sourceRoot.updateMatrixWorld(true);
  sourceRoot.traverse(object => {
    if (object.isMesh) return;
    const name = object.name ?? '';
    if (!(/Conveyor_.*_low\d*/i.test(name) || /Conveyor_Belt/i.test(name) || /Conveyor_Roller/i.test(name))) return;
    if (!object.children.some(child => child.isMesh)) return;
    assembly.add(cloneWorldObject(object));
  });
  return assembly.children.length ? assembly : cloneModelRoot(sourceRoot);
}

function trimImportedConveyorEnvelope(root) {
  root.updateMatrixWorld(true);
  const toRemove = [];
  root.traverse(object => {
    if (!object.isMesh) return;
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const lateralOffset = Math.abs(center.z);
    const isSmallLoosePart = Math.max(size.x, size.y, size.z) < 2.4;
    const isTooFarFromBeltCenter = lateralOffset > 1.55;
    if (isSmallLoosePart && isTooFarFromBeltCenter) toRemove.push(object);
  });
  toRemove.forEach(object => {
    if (object.parent) object.parent.remove(object);
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.());
    else object.material?.dispose?.();
  });
  return toRemove.length;
}

function roadwaySectionPoints(width, height) {
  const halfWidth = width * 0.5;
  const springHeight = height - halfWidth;
  const points = [
    new THREE.Vector2(-halfWidth, 0),
    new THREE.Vector2(-halfWidth, springHeight),
  ];
  for (let index = 1; index < 18; index += 1) {
    const angle = Math.PI - (index / 18) * Math.PI;
    points.push(new THREE.Vector2(Math.cos(angle) * halfWidth, springHeight + Math.sin(angle) * halfWidth));
  }
  points.push(new THREE.Vector2(halfWidth, springHeight));
  points.push(new THREE.Vector2(halfWidth, 0));
  return points;
}

function roadwayRoofYAtX(width, height, x, inset = 0.16) {
  const halfWidth = width * 0.5;
  const springHeight = height - halfWidth;
  const clampedX = Math.max(-halfWidth + 0.08, Math.min(halfWidth - 0.08, x));
  const archY = springHeight + Math.sqrt(Math.max(0, halfWidth * halfWidth - clampedX * clampedX));
  return archY - inset;
}

function addRibSurface(root, name, stations, material) {
  const positions = [];
  const uvs = [];
  const indices = [];
  stations.forEach((station, index) => {
    const roughX = Math.sin(station.z * 1.37 + index * 0.71) * 0.05;
    const roughY = Math.cos(station.z * 0.83 + index * 1.19) * 0.04;
    positions.push(station.x + roughX, station.bottom, station.z);
    positions.push(station.x - roughX * 0.45, station.top + roughY, station.z);
    uvs.push(0, index * 0.55, 1, index * 0.55);
  });
  for (let index = 0; index < stations.length - 1; index += 1) {
    const a = index * 2;
    indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function addIrregularWallPatch(root, name, x, y, z, height, length, material, side = 1) {
  const halfH = height * 0.5;
  const halfL = length * 0.5;
  const points = [
    [x, y - halfH * 0.9, z - halfL * 0.78],
    [x + side * 0.018, y - halfH, z - halfL * 0.18],
    [x, y - halfH * 0.62, z + halfL * 0.76],
    [x - side * 0.012, y + halfH * 0.12, z + halfL],
    [x + side * 0.016, y + halfH, z + halfL * 0.18],
    [x, y + halfH * 0.68, z - halfL],
  ];
  const center = [x + side * 0.006, y, z];
  const positions = [...center];
  points.forEach(point => positions.push(...point));
  const indices = [];
  for (let i = 1; i <= points.length; i += 1) {
    indices.push(0, i, i === points.length ? 1 : i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const patchMaterial = material.clone();
  patchMaterial.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geometry, patchMaterial);
  mesh.name = name;
  mesh.receiveShadow = true;
  root.add(mesh);
  const edgeMat = material.clone();
  if (edgeMat.color) edgeMat.color.offsetHSL(0, -0.08, -0.12);
  const chipCount = 5;
  for (let i = 0; i < chipCount; i += 1) {
    const chip = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.035 + (i % 3) * 0.012, 0),
      edgeMat,
    );
    chip.name = `${name}-broken-edge`;
    chip.position.set(
      x - side * 0.012,
      y - halfH * 0.42 + i * (height / chipCount) + Math.sin(i * 1.7) * 0.05,
      z - halfL * 0.46 + ((i * 0.37) % 1) * length,
    );
    chip.scale.set(0.45, 0.25, 0.72);
    chip.rotation.set(i * 0.7, i * 0.31, i * 0.18);
    root.add(chip);
  }
  return mesh;
}

function addRoadwayFloorDetails(root, width, length, materials) {
  const curbMat = cloneMaterial(materials.concrete, 0x2b2b28, { roughness: 0.96 });
  const steelMat = cloneMaterial(materials.weatheredSteel, 0x4c4841, { roughness: 0.82 });
  const mudMat = cloneMaterial(materials.road, 0x211d18, { roughness: 1 });
  const leftLaneX = -width / 2 + 1.25;
  const rightDrainX = width / 2 - 0.62;

  addBox(root, 'left-maintenance-walkway-edge', [0.08, 0.075, length - 2.2], [leftLaneX, 0.07, length / 2 + 0.5], curbMat);
  addBox(root, 'roadway-center-wheel-track-left', [0.08, 0.018, length - 5], [-0.78, 0.012, length / 2 + 1.5], mudMat);
  addBox(root, 'roadway-center-wheel-track-right', [0.08, 0.018, length - 5], [0.78, 0.012, length / 2 + 1.5], mudMat);
  for (let z = 2.6; z < length - 1.8; z += 2.0) {
    addBox(root, 'right-drainage-grating-bar', [0.26, 0.02, 0.045], [rightDrainX + 0.05, 0.11, z], steelMat);
  }
  for (let z = 5; z < length - 3; z += 7.5) {
    addBox(root, 'floor-mud-stain', [1.1, 0.014, 2.1], [-0.35 + Math.sin(z) * 0.35, 0.018, z], mudMat, [0, 0.12 * Math.sin(z * 0.4), 0]);
  }
}

function addRoadwayShellMesh(root, width, height, length, material) {
  const section = roadwaySectionPoints(width, height);
  const zSegments = 40;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let zi = 0; zi <= zSegments; zi += 1) {
    const z = (zi / zSegments) * length;
    for (let si = 0; si < section.length; si += 1) {
      const point = section[si];
      const rough = Math.sin(z * 0.7 + si * 1.31) * 0.035 + Math.sin(z * 1.9 + si * 0.47) * 0.018;
      const sideBias = Math.abs(point.x) > width * 0.42 ? rough * 1.8 : rough;
      positions.push(point.x + sideBias, point.y + rough, z);
      uvs.push(si / (section.length - 1) * 2.5, z / 4);
    }
  }

  const ring = section.length;
  for (let zi = 0; zi < zSegments; zi += 1) {
    for (let si = 0; si < ring - 1; si += 1) {
      const a = zi * ring + si;
      const b = a + ring;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const shellMaterial = material.clone();
  shellMaterial.side = THREE.DoubleSide;
  const shell = new THREE.Mesh(geometry, shellMaterial);
  shell.name = 'horseshoe-coal-roadway-shell';
  shell.castShadow = true;
  shell.receiveShadow = true;
  root.add(shell);
  return shell;
}

function addHorseshoeRib(root, width, height, z, radius, material) {
  const section = roadwaySectionPoints(width - 0.16, height - 0.08);
  const points = section.map(point => new THREE.Vector3(point.x, point.y + 0.04, z));
  const rib = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 36, radius, 8, false),
    material,
  );
  rib.name = 'arched-steel-rib';
  rib.castShadow = true;
  rib.receiveShadow = true;
  root.add(rib);
  return rib;
}

function addRoadwaySideServices(root, width, length, materials) {
  const leftX = -width / 2 + 0.34;
  const rightX = width / 2 - 0.34;
  const pipeMat = cloneMaterial(materials.rubber, 0x2b3431, { roughness: 0.9 });
  const cableMat = cloneMaterial(materials.rubber, 0x171b1b, { roughness: 0.92 });
  const bracketMat = cloneMaterial(materials.weatheredSteel, 0x4d4942, { roughness: 0.86 });
  const trayMat = cloneMaterial(materials.weatheredSteel, 0x322f2a, { roughness: 0.9 });

  for (let z = 2.5; z < length - 1.5; z += 4.2) {
    addCylinderBetween(root, 'left-wall-water-pipe', [leftX, 2.18, z - 1.75], [leftX, 2.18, z + 1.75], 0.055, pipeMat, 10);
    addCylinderBetween(root, 'left-wall-air-pipe', [leftX + 0.04, 2.52, z - 1.75], [leftX + 0.04, 2.52, z + 1.75], 0.036, pipeMat, 8);
    addCylinderBetween(root, 'right-wall-power-cable-a', [rightX - 0.04, 2.64, z - 1.45], [rightX - 0.04, 2.64, z + 1.45], 0.019, cableMat, 8);
    addCylinderBetween(root, 'right-wall-power-cable-b', [rightX - 0.09, 2.82, z - 1.45], [rightX - 0.09, 2.82, z + 1.45], 0.016, cableMat, 8);
    addBox(root, 'right-wall-cable-tray', [0.042, 0.046, 2.75], [rightX - 0.13, 2.5, z], trayMat);
  }

  for (let z = 1.4; z < length; z += 2.8) {
    addBox(root, 'left-pipe-wall-bracket', [0.36, 0.05, 0.08], [leftX + 0.17, 2.08, z], bracketMat, [0, 0, -0.08]);
    addBox(root, 'left-pipe-hanger', [0.05, 0.38, 0.05], [leftX + 0.32, 2.28, z], bracketMat);
    addBox(root, 'right-cable-tray-bracket', [0.32, 0.045, 0.07], [rightX - 0.17, 2.55, z], bracketMat, [0, 0, 0.08]);
    addBox(root, 'right-cable-hanger', [0.045, 0.34, 0.045], [rightX - 0.31, 2.76, z], bracketMat);
  }

  for (let z = 3.5; z < length - 2; z += 5.6) {
    addIrregularWallPatch(root, 'left-wall-shotcrete-patch', leftX - 0.11, 1.42, z, 0.78, 1.25, cloneMaterial(materials.concrete, 0x36332d, { roughness: 0.97 }), -1);
    addIrregularWallPatch(root, 'right-wall-shotcrete-patch', rightX + 0.11, 1.55, z + 1.2, 0.68, 1.1, cloneMaterial(materials.concrete, 0x31302b, { roughness: 0.97 }), 1);
  }
}

function createRoadwayShell(root, materials) {
  const { length, width, height } = FOCUSED_LONGWALL_LAYOUT.roadway;
  const coalRock = cloneMaterial(materials.darkRock, 0x24211d, { roughness: 0.98, envMapIntensity: 0.16 });
  const floorMat = cloneMaterial(materials.road, 0x191817, { roughness: 0.96 });
  const steel = cloneMaterial(materials.weatheredSteel, 0x55514b, { roughness: 0.84 });
  const boltMat = cloneMaterial(materials.steel, 0x8e968f, { roughness: 0.55 });
  const strapMat = cloneMaterial(materials.weatheredSteel, 0x393a36, { roughness: 0.88 });
  const plateMat = cloneMaterial(materials.weatheredSteel, 0x4c4a43, { roughness: 0.9 });
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x1c2a2d,
    roughness: 0.18,
    metalness: 0,
    transparent: true,
    opacity: 0.46,
    envMapIntensity: 0.4,
  });

  register(runtimeSafe(root), 'transportRoadway', root);

  addBox(root, 'transport-roadway-floor', [width - 0.3, 0.18, length], [0, -0.09, length / 2], floorMat);
  addRoadwayShellMesh(root, width, height, length, coalRock);
  addBox(root, 'right-drainage-channel', [0.34, 0.08, length - 2], [width / 2 - 0.36, 0.03, length / 2 + 1], cloneMaterial(materials.concrete, 0x303331));
  addRoadwayFloorDetails(root, width, length, materials);

  for (let z = 1; z <= length; z += 3) {
    addHorseshoeRib(root, width, height, z, 0.055, steel);
  }

  for (let z = 2.1; z < length; z += 3.2) {
    for (const x of [-2.0, -0.95, 0.95, 2.0]) {
      const roofY = roadwayRoofYAtX(width, height, x, 0.34);
      addCylinderBetween(root, 'short-roof-bolt-tail', [x, roofY, z], [x, roofY - 0.16, z], 0.018, boltMat, 8);
      addBox(root, 'roof-bolt-bearing-plate', [0.26, 0.018, 0.22], [x, roofY - 0.17, z], plateMat, [0.02 * Math.sign(x), 0.08 * Math.sign(x), 0]);
    }
    addBox(root, 'roof-cross-steel-strap', [3.25, 0.03, 0.1], [0, roadwayRoofYAtX(width, height, 0, 0.9), z], strapMat, [0, 0.015 * Math.sin(z), 0]);
  }

  for (const x of [-1.45, 1.45]) {
    addBox(root, 'roof-longitudinal-steel-band', [0.12, 0.026, length - 4.0], [x, roadwayRoofYAtX(width, height, x, 0.9), length / 2 + 0.5], strapMat);
  }

  for (let z = 3.4; z < 21; z += 4.4) {
    addBox(root, 'advance-roof-mesh', [1.55, 0.009, 0.28], [0, roadwayRoofYAtX(width, height, 0, 1.02), z], cloneMaterial(materials.steel, 0x343a37, { transparent: true, opacity: 0.028 }));
  }

  for (let z = 4; z < length; z += 7.2) {
    const lampY = roadwayRoofYAtX(width, height, 0, 1.05);
    addBox(root, 'roadway-lamp-mounting-plate', [0.82, 0.035, 0.36], [0, lampY + 0.04, z], plateMat);
    addCylinderBetween(root, 'roadway-lamp-short-hanger-left', [-0.24, lampY + 0.02, z], [-0.24, lampY - 0.2, z], 0.018, boltMat, 8);
    addCylinderBetween(root, 'roadway-lamp-short-hanger-right', [0.24, lampY + 0.02, z], [0.24, lampY - 0.2, z], 0.018, boltMat, 8);
    addBox(root, 'roadway-lamp-dark-housing', [0.78, 0.09, 0.34], [0, lampY - 0.2, z], cloneMaterial(materials.weatheredSteel, 0x36332d, { roughness: 0.86 }));
    const lamp = addBox(root, 'roadway-lamp', [0.62, 0.06, 0.24], [0, lampY - 0.27, z], cloneMaterial(materials.lamp, 0xffc982));
    const light = new THREE.PointLight(0xffd8a2, z < 22 ? 20 : 13, 8.5, 1.9);
    light.position.copy(lamp.position);
    light.position.y -= 0.3;
    light.name = 'roadway-low-light';
    root.add(light);
  }

  addRoadwaySideServices(root, width, length, materials);

  for (let i = 0; i < 58; i += 1) {
    const z = 1 + (i * 7.31) % (length - 2);
    const x = -2.0 + (i * 1.37) % 4.0;
    const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07 + (i % 5) * 0.025, 0), cloneMaterial(materials.coal, 0x111110));
    lump.name = 'floor-coal-debris';
    lump.position.set(x, 0.08, z);
    lump.scale.y = 0.4;
    lump.rotation.set(i * 0.3, i * 0.7, i * 0.13);
    root.add(lump);
  }

  for (const [x, z, sx, sz] of [[1.7, 7.5, 0.7, 1.6], [-1.5, 18, 0.85, 1.35], [1.35, 34, 0.6, 1.8]]) {
    addBox(root, 'local-puddle', [sx, 0.012, sz], [x, 0.012, z], waterMat);
  }
}

function createWorkingFaceRoofEnvelope(root, materials) {
  const roofMat = cloneMaterial(materials.coal, 0x171513, { roughness: 0.98 });
  const ribMat = cloneMaterial(materials.darkRock, 0x302a23, { roughness: 0.98 });
  const strapMat = cloneMaterial(materials.weatheredSteel, 0x3d3b35, { roughness: 0.9 });
  const floorMat = cloneMaterial(materials.road, 0x181715, { roughness: 0.98 });

  const stations = [
    { z: -10.0, left: -4.1, right: 2.55, y: 3.7 },
    { z: -7.0, left: -4.05, right: 2.55, y: 3.82 },
    { z: -4.2, left: -3.95, right: 2.65, y: 4.08 },
    { z: -1.2, left: -4.05, right: 3.0, y: 4.65 },
    { z: 1.4, left: -4.25, right: 3.45, y: 5.55 },
    { z: 4.0, left: -4.45, right: 3.75, y: 6.18 },
  ];
  const columns = [-1, -0.55, -0.15, 0.22, 0.58, 1];
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let zi = 0; zi < stations.length; zi += 1) {
    const station = stations[zi];
    for (let xi = 0; xi < columns.length; xi += 1) {
      const t = (columns[xi] + 1) * 0.5;
      const crown = Math.sin(t * Math.PI) * 0.16;
      const rough = Math.sin(station.z * 1.73 + xi * 1.11) * 0.06 + Math.sin(station.z * 0.52 + xi * 2.4) * 0.035;
      const x = station.left + (station.right - station.left) * t;
      positions.push(x, station.y + crown + rough, station.z);
      uvs.push(t * 2.4, (station.z + 10) * 0.42);
    }
  }
  for (let zi = 0; zi < stations.length - 1; zi += 1) {
    for (let xi = 0; xi < columns.length - 1; xi += 1) {
      const a = zi * columns.length + xi;
      const b = a + columns.length;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const roofGeometry = new THREE.BufferGeometry();
  roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  roofGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  roofGeometry.setIndex(indices);
  roofGeometry.computeVertexNormals();
  const roofMesh = new THREE.Mesh(roofGeometry, roofMat);
  roofMesh.name = 'working-face-transition-irregular-roof';
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  root.add(roofMesh);

  addBox(root, 'working-face-short-floor-extension', [6.9, 0.12, 10.5], [-0.72, -0.06, -4.8], floorMat);
  addRibSurface(root, 'working-face-goaf-side-irregular-rib', [
    { z: -10.0, x: -4.08, bottom: 0.02, top: 3.35 },
    { z: -7.0, x: -4.04, bottom: 0.02, top: 3.46 },
    { z: -4.2, x: -3.92, bottom: 0.02, top: 3.72 },
    { z: -1.2, x: -4.0, bottom: 0.02, top: 4.18 },
    { z: 1.4, x: -4.18, bottom: 0.02, top: 4.9 },
    { z: 4.0, x: -4.36, bottom: 0.02, top: 5.45 },
  ], ribMat);
  addRibSurface(root, 'working-face-coal-side-irregular-rib', [
    { z: -10.0, x: 2.48, bottom: 0.02, top: 3.2 },
    { z: -7.0, x: 2.5, bottom: 0.02, top: 3.34 },
    { z: -4.2, x: 2.58, bottom: 0.02, top: 3.58 },
    { z: -1.2, x: 2.9, bottom: 0.02, top: 4.04 },
    { z: 1.4, x: 3.22, bottom: 0.02, top: 4.72 },
    { z: 4.0, x: 3.52, bottom: 0.02, top: 5.3 },
  ], ribMat);

  for (let z = -8.8; z <= 3.6; z += 2.4) {
    const y = z < -4 ? 3.56 : z < 0 ? 4.15 : z < 4 ? 5.1 : 6.02;
    const width = z < -4 ? 4.2 : z < 0 ? 4.65 : 5.0;
    const centerX = z < -4 ? -1.25 : z < 0 ? -1.05 : -0.75;
    addBox(root, 'working-face-roof-joint', [width, 0.018, 0.035], [centerX, y, z], cloneMaterial(materials.weatheredSteel, 0x2b2925), [0, 0.06, 0.06]);
  }

  for (let z = -8.0; z <= 2.8; z += 3.2) {
    const y = z < -4 ? 3.52 : z < 0 ? 4.1 : z < 4 ? 5.05 : 5.96;
    const width = z < -4 ? 2.85 : z < 0 ? 3.35 : 3.9;
    const centerX = z < -4 ? -1.45 : z < 0 ? -1.18 : -0.82;
    addBox(root, 'working-face-short-strap', [width, 0.03, 0.09], [centerX, y, z], strapMat);
  }

  const cableMat = cloneMaterial(materials.rubber, 0x101313, { roughness: 0.96 });
  const railMat = cloneMaterial(materials.weatheredSteel, 0x453f38, { roughness: 0.9 });
  for (let z = -8.5; z <= 3.2; z += 2.1) {
    addCylinderBetween(root, 'working-face-left-service-cable', [-3.82, 1.95, z - 0.72], [-3.82, 1.95, z + 0.72], 0.032, cableMat, 8);
    addCylinderBetween(root, 'working-face-left-service-cable-lower', [-3.76, 1.55, z - 0.72], [-3.76, 1.55, z + 0.72], 0.024, cableMat, 8);
    addBox(root, 'working-face-left-cable-bracket', [0.28, 0.045, 0.07], [-3.68, 1.82, z], railMat, [0, 0, -0.08]);
  }
  for (let z = -8.2; z <= 2.8; z += 2.8) {
    addCylinderBetween(root, 'working-face-right-rib-bolt', [2.68, 1.1, z], [2.52, 1.1, z], 0.018, railMat, 8);
    addCylinderBetween(root, 'working-face-right-rib-bolt', [2.84, 2.08, z + 0.45], [2.64, 2.08, z + 0.45], 0.017, railMat, 8);
    addBox(root, 'working-face-right-bolt-plate', [0.026, 0.14, 0.14], [2.51, 1.1, z], railMat);
    addBox(root, 'working-face-right-bolt-plate', [0.026, 0.13, 0.13], [2.63, 2.08, z + 0.45], railMat);
  }
  for (const z of [-7.4, -3.2, 1.0]) {
    addIrregularWallPatch(root, 'working-face-right-shotcrete-scar', 2.64, 1.55, z, 0.82, 1.35, cloneMaterial(materials.concrete, 0x3b352e, { roughness: 0.98 }), 1);
    const lamp = addBox(root, 'working-face-rib-low-lamp', [0.08, 0.08, 0.24], [2.42, 2.62, z + 0.35], cloneMaterial(materials.lamp, 0xffc078), [0, 0.2, 0]);
    const light = new THREE.PointLight(0xffbf78, 2.8, 3.1, 2.2);
    light.name = 'working-face-rib-low-light';
    light.position.copy(lamp.position);
    light.position.x -= 0.18;
    root.add(light);
  }

  for (let i = 0; i < 12; i += 1) {
    const z = -9.4 + (i * 1.07) % 17.8;
    const x = -3.65 + (i * 1.83) % 5.55;
    const y = z < -4 ? 3.46 : z < 0 ? 4.0 : z < 4 ? 4.95 : 5.88;
    addBox(root, 'working-face-roof-cleat', [0.32 + (i % 3) * 0.12, 0.014, 0.026], [x, y - 0.035, z], cloneMaterial(materials.weatheredSteel, 0x3d332b), [0, (i % 5) * 0.18, 0.2 - (i % 2) * 0.4]);
  }
}

function runtimeSafe(root) {
  return root.userData.runtime;
}

function createSupport(materials) {
  const root = new THREE.Group();
  root.name = 'hydraulic-support';
  const frame = cloneMaterial(materials.paintedSteel, 0x244f58, { roughness: 0.72 });
  const darkFrame = cloneMaterial(materials.weatheredSteel, 0x243033, { roughness: 0.86 });
  const guardPanel = cloneMaterial(materials.paintedSteel, 0x355f66, { roughness: 0.78, envMapIntensity: 0.18 });
  const cylinder = cloneMaterial(materials.steel, 0xa7aaa4, { metalness: 0.52, roughness: 0.34 });
  const hose = cloneMaterial(materials.rubber, 0x080a0a, { roughness: 0.9 });
  const warning = cloneMaterial(materials.paintedSteel, 0xc78d22, { roughness: 0.7 });

  addBox(root, 'support-left-skid', [1.95, 0.14, 0.24], [0.04, 0.1, -0.64], darkFrame);
  addBox(root, 'support-right-skid', [1.95, 0.14, 0.24], [0.04, 0.1, 0.64], darkFrame);
  addBox(root, 'support-base-crossbeam-front', [1.72, 0.12, 0.18], [0.05, 0.24, -0.38], frame);
  addBox(root, 'support-base-crossbeam-rear', [1.72, 0.12, 0.18], [0.05, 0.24, 0.38], frame);
  addBox(root, 'support-rear-link-seat', [0.32, 0.38, 1.42], [-0.78, 0.48, 0], frame);

  addBox(root, 'support-rear-shield', [0.2, 2.35, 1.64], [-0.66, 1.65, 0], frame, [0, 0, -0.2]);
  addBox(root, 'support-top-canopy-main', [1.72, 0.18, 1.82], [-0.04, 3.48, 0], frame, [0, 0, -0.055]);
  addBox(root, 'support-top-canopy-left-plate', [1.55, 0.035, 0.42], [-0.02, 3.62, -0.58], darkFrame, [0, 0, -0.055]);
  addBox(root, 'support-top-canopy-right-plate', [1.55, 0.035, 0.42], [-0.02, 3.62, 0.58], darkFrame, [0, 0, -0.055]);
  addBox(root, 'support-extendable-forepoling-beam', [0.72, 0.2, 1.72], [0.98, 3.28, 0], frame, [0, 0, -0.14]);
  for (const [z, panelHeight] of [[-0.55, 0.74], [0, 0.88], [0.55, 0.74]]) {
    addBox(root, 'support-face-guard-panel-segment', [0.075, panelHeight, 0.34], [1.27, 2.03, z], guardPanel, [0, 0, -0.12]);
    addBox(root, 'support-face-guard-rib', [0.095, 0.045, 0.38], [1.245, 2.44, z], darkFrame, [0, 0, -0.12]);
    addBox(root, 'support-face-guard-rib', [0.095, 0.045, 0.38], [1.335, 1.63, z], darkFrame, [0, 0, -0.12]);
  }
  addCylinderBetween(root, 'support-face-guard-side-pin', [1.25, 2.48, -0.76], [1.25, 2.48, 0.76], 0.026, cylinder, 8);
  addCylinderBetween(root, 'support-face-guard-lower-pin', [1.34, 1.55, -0.72], [1.34, 1.55, 0.72], 0.022, cylinder, 8);

  for (const z of [-0.68, -0.23, 0.23, 0.68]) {
    addCylinderBetween(root, 'support-canopy-rib', [-0.78, 3.68, z], [0.98, 3.48, z], 0.022, warning, 6);
  }
  for (const x of [-0.36, 0.38]) {
    for (const z of [-0.46, 0.46]) {
      addCylinderBetween(root, 'support-hydraulic-column-outer', [x, 0.34, z], [x + 0.08, 2.92, z], 0.105, darkFrame, 12);
      addCylinderBetween(root, 'support-hydraulic-column-chrome', [x + 0.05, 1.3, z], [x + 0.11, 3.32, z], 0.06, cylinder, 12);
      addCylinderBetween(root, 'support-column-pin-lower', [x - 0.18, 0.44, z], [x + 0.18, 0.44, z], 0.035, cylinder, 10);
      addCylinderBetween(root, 'support-column-pin-upper', [x - 0.16, 3.18, z], [x + 0.16, 3.18, z], 0.032, cylinder, 10);
    }
  }
  addCylinderBetween(root, 'support-advance-ram-left', [-0.42, 0.54, -0.7], [0.75, 1.2, -0.7], 0.038, cylinder, 10);
  addCylinderBetween(root, 'support-advance-ram-right', [-0.42, 0.54, 0.7], [0.75, 1.2, 0.7], 0.038, cylinder, 10);
  addBox(root, 'support-pressure-sensor', [0.16, 0.12, 0.2], [0.82, 2.02, 0.68], warning);
  addCylinderBetween(root, 'support-hydraulic-hose-a', [0.78, 2.04, 0.56], [0.16, 1.06, 0.52], 0.026, hose, 7);
  addCylinderBetween(root, 'support-hydraulic-hose-b', [0.78, 2.02, -0.56], [0.16, 1.04, -0.52], 0.026, hose, 7);
  addCylinderBetween(root, 'support-return-hose', [-0.66, 1.72, 0.62], [-0.18, 0.52, 0.7], 0.022, hose, 7);
  return root;
}

function createCoalWallSurface(materials, miningHeight, length) {
  const group = new THREE.Group();
  group.name = 'coal-wall-irregular-group';
  const coalMat = cloneMaterial(materials.coal, 0x2a241d, {
    roughness: 0.99,
    envMapIntensity: 0.16,
  });
  coalMat.side = THREE.DoubleSide;
  const ySegments = 9;
  const zSegments = 34;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let yi = 0; yi <= ySegments; yi += 1) {
    for (let zi = 0; zi <= zSegments; zi += 1) {
      const z = -length / 2 + (zi / zSegments) * length;
      const topRelief = 0.18 + Math.max(0, Math.sin(z * 0.82 + 0.7)) * 0.16
        + Math.max(0, Math.sin(z * 1.91)) * 0.08;
      const localHeight = miningHeight - topRelief;
      const y = (yi / ySegments) * localHeight;
      const seamStep = Math.floor((y / miningHeight) * 6) * 0.045;
      const cutNotch = Math.max(0, Math.sin((z + 2.8) * 1.34)) * Math.max(0, 1 - Math.abs(y - 1.6) / 1.7) * 0.08;
      const faceRough = Math.sin(z * 1.17 + yi * 0.83) * 0.115
        + Math.sin(z * 2.41 + yi * 1.9) * 0.055
        + Math.sin(z * 4.2 + yi * 0.35) * 0.025
        - seamStep
        - cutNotch;
      const exitBreak = z > 5.8 ? (z - 5.8) * 0.018 : 0;
      const x = 2.24 + faceRough + exitBreak;
      positions.push(x, y, z);
      uvs.push(zi / zSegments * 4, yi / ySegments * 1.6);
    }
  }
  const row = zSegments + 1;
  for (let yi = 0; yi < ySegments; yi += 1) {
    for (let zi = 0; zi < zSegments; zi += 1) {
      const a = yi * row + zi;
      indices.push(a, a + row, a + 1, a + row, a + row + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const wall = new THREE.Mesh(geometry, coalMat);
  wall.name = 'coal-wall-irregular-face';
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);

  const seamMat = cloneMaterial(materials.weatheredSteel, 0x3a3028, { roughness: 0.96, metalness: 0.12 });
  const freshCoalMat = cloneMaterial(materials.coal, 0x251f19, { roughness: 0.99 });
  const wetMat = cloneMaterial(materials.glass, 0x0f0c0a, { transparent: true, opacity: 0.22, roughness: 0.36, metalness: 0.02 });
  for (let y = 0.42; y < miningHeight - 0.45; y += 0.52) {
    const zOffset = Math.sin(y * 2.2) * 0.42;
    addBox(group, 'coal-wall-bedding-seam', [0.045, 0.026, length - 2.4], [2.03 + Math.sin(y * 2.2) * 0.045, y, zOffset], seamMat, [0.04, 0.02, 0.035]);
  }
  for (let i = 0; i < 24; i += 1) {
    const z = -9.4 + (i * 1.31) % 18.8;
    const y = 0.48 + (i * 0.41) % (miningHeight - 1.05);
    const crackLength = 0.72 + (i % 4) * 0.38;
    addBox(group, 'coal-wall-random-cleat', [0.042, 0.024, crackLength], [2.0 + (i % 4) * 0.026, y, z], freshCoalMat, [0.16 - (i % 2) * 0.32, 0.05, 0.55 - (i % 5) * 0.22]);
  }
  for (let i = 0; i < 11; i += 1) {
    const z = -8.8 + (i * 1.82) % 17.6;
    const y = 0.72 + (i * 0.63) % 2.3;
    addBox(group, 'coal-wall-wet-highlight', [0.028, 0.42 + (i % 3) * 0.16, 0.055], [1.96 + (i % 3) * 0.024, y, z], wetMat, [0.08, 0.02, -0.18 + (i % 4) * 0.11]);
  }
  for (let i = 0; i < 26; i += 1) {
    const lump = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.06 + (i % 5) * 0.023, 0),
      cloneMaterial(materials.coal, i % 3 === 0 ? 0x33291f : 0x171310, { roughness: 1 }),
    );
    lump.name = 'coal-wall-broken-edge-lump';
    lump.position.set(1.96 + (i % 4) * 0.035, 0.18 + (i * 0.29) % 3.05, -9.6 + (i * 0.91) % 19.2);
    lump.scale.set(0.55, 0.38 + (i % 3) * 0.1, 0.75);
    lump.rotation.set(i * 0.41, i * 0.17, i * 0.29);
    group.add(lump);
  }
  return group;
}

function createWorkingFace(root, materials, runtime) {
  const { supportCount, length, miningHeight } = FOCUSED_LONGWALL_LAYOUT.face;
  const face = register(runtime, 'workingFace', new THREE.Group(), {
    name: '工作面出口段',
    install: '运输顺槽出口相邻 20m 工作面',
    meter: '0m',
  });
  face.name = 'focused-working-face';
  root.add(face);

  const coalWall = register(runtime, 'coalWall', createCoalWallSurface(materials, miningHeight, length), {
    name: '煤壁',
    install: '工作面采煤侧',
    meter: '出口段',
  });
  face.add(coalWall);

  const coalLampMat = cloneMaterial(materials.lamp, 0xffd28a);
  for (const z of [-6.2, -1.4, 3.4, 8.0]) {
    const lamp = addBox(face, 'coal-wall-service-lamp', [0.12, 0.1, 0.42], [1.55, 2.45, z], coalLampMat, [0, 0.12, 0]);
    const light = new THREE.PointLight(0xffd7a0, 5.2, 3.8, 2.1);
    light.name = 'coal-wall-wash-light';
    light.position.set(lamp.position.x - 0.18, lamp.position.y - 0.15, lamp.position.z);
    face.add(light);
  }

  const afc = register(runtime, 'scraperConveyor', new THREE.Group(), {
    name: '刮板输送机 SGZ1000',
    install: '工作面煤壁前',
    meter: '出口段 0-20m',
  });
  afc.name = 'AFC-scraper-conveyor';
  face.add(afc);
  addBox(afc, 'AFC-pan-line', [1.25, 0.28, length], [0.65, 0.32, 0], cloneMaterial(materials.weatheredSteel, 0x41494a));
  addBox(afc, 'AFC-chain-slot', [0.82, 0.08, length - 0.8], [0.65, 0.54, 0], cloneMaterial(materials.rubber, 0x111111));
  for (let z = -9; z <= 9; z += 1.2) {
    addBox(afc, 'AFC-scraper-flight', [1.0, 0.08, 0.08], [0.65, 0.63, z], cloneMaterial(materials.steel, 0x8c867d));
  }
  addBox(afc, 'AFC-left-pan-side', [0.12, 0.42, length], [-0.04, 0.56, 0], cloneMaterial(materials.weatheredSteel, 0x2f3535));
  addBox(afc, 'AFC-right-pan-side', [0.12, 0.42, length], [1.34, 0.56, 0], cloneMaterial(materials.weatheredSteel, 0x2f3535));

  const shearer = register(runtime, 'shearer', new THREE.Group(), {
    name: '采煤机 MG650/1620',
    install: 'AFC 上方，靠近出口',
    meter: '工作面出口约 8m',
  });
  shearer.name = 'workingFaceShearer';
  shearer.position.set(0.82, 0.68, -3.2);
  face.add(shearer);
  const shearerYellow = cloneMaterial(materials.paintedSteel, 0xb77818, { roughness: 0.74 });
  const shearerDark = cloneMaterial(materials.weatheredSteel, 0x2b3030, { roughness: 0.86 });
  const shearerBlack = cloneMaterial(materials.rubber, 0x090a0a, { roughness: 0.94 });
  const shearerSteel = cloneMaterial(materials.steel, 0x8e877c, { metalness: 0.35, roughness: 0.5 });
  const shearerLamp = cloneMaterial(materials.lamp, 0xffd8a2);
  const warningStripe = cloneMaterial(materials.paintedSteel, 0xd1a12f, { roughness: 0.68 });
  addBox(shearer, 'shearer-main-body', [1.46, 0.72, 1.65], [0, 0.72, 0], shearerYellow);
  addBox(shearer, 'shearer-left-traction-box', [1.22, 0.48, 0.56], [0.02, 0.62, -0.96], shearerDark);
  addBox(shearer, 'shearer-right-traction-box', [1.22, 0.48, 0.56], [0.02, 0.62, 0.96], shearerDark);
  addBox(shearer, 'shearer-top-service-cover', [1.18, 0.06, 1.22], [-0.08, 1.12, 0], shearerDark);
  for (const z of [-0.5, 0, 0.5]) {
    addBox(shearer, 'shearer-side-service-panel', [0.035, 0.3, 0.34], [0.75, 0.78, z], shearerDark);
    addBox(shearer, 'shearer-cooling-grille', [0.04, 0.035, 0.25], [0.78, 0.9, z], shearerSteel);
    addBox(shearer, 'shearer-cooling-grille', [0.04, 0.035, 0.25], [0.78, 0.78, z], shearerSteel);
  }
  for (const z of [-0.82, 0.82]) {
    addBox(shearer, 'shearer-warning-stripe', [0.045, 0.07, 0.42], [0.79, 0.42, z], warningStripe, [0, 0, 0.35]);
    const lamp = addBox(shearer, 'shearer-front-work-lamp', [0.08, 0.07, 0.06], [0.72, 1.05, z], shearerLamp);
    const beam = new THREE.PointLight(0xffd8a2, 4.5, 2.8, 2.3);
    beam.name = 'shearer-work-light';
    beam.position.copy(lamp.position);
    shearer.add(beam);
  }
  addBox(shearer, 'shearer-control-cab', [0.48, 0.38, 0.46], [0.46, 1.27, -0.22], cloneMaterial(materials.glass, 0x708b92, { opacity: 0.58 }));
  addBox(shearer, 'shearer-left-crawler-track', [0.32, 0.2, 2.08], [-0.54, 0.22, 0], shearerBlack);
  addBox(shearer, 'shearer-right-crawler-track', [0.32, 0.2, 2.08], [0.54, 0.22, 0], shearerBlack);
  for (let z = -0.92; z <= 0.92; z += 0.23) {
    addBox(shearer, 'shearer-track-shoe-left', [0.36, 0.035, 0.08], [-0.54, 0.34, z], shearerSteel);
    addBox(shearer, 'shearer-track-shoe-right', [0.36, 0.035, 0.08], [0.54, 0.34, z], shearerSteel);
  }
  addBox(shearer, 'shearer-cable-tray', [0.18, 0.18, 2.75], [-0.73, 1.12, 0], shearerDark);
  for (let z = -1.2; z <= 1.2; z += 0.3) {
    addBox(shearer, 'shearer-drag-chain-link', [0.22, 0.05, 0.08], [-0.78, 1.28 + Math.sin(z * 3) * 0.025, z], shearerBlack, [0, 0.18, 0]);
  }
  addCylinderBetween(shearer, 'shearer-ranging-arm-front', [0.02, 0.94, -0.92], [0.12, 0.92, -2.02], 0.13, shearerYellow, 10);
  addCylinderBetween(shearer, 'shearer-ranging-arm-rear', [0.02, 0.94, 0.92], [0.12, 0.92, 2.02], 0.13, shearerYellow, 10);
  addBox(shearer, 'shearer-front-arm-guard', [0.22, 0.14, 0.88], [0.05, 1.02, -1.48], shearerDark, [0.12, 0, 0]);
  addBox(shearer, 'shearer-rear-arm-guard', [0.22, 0.14, 0.88], [0.05, 1.02, 1.48], shearerDark, [-0.12, 0, 0]);
  addCylinderBetween(shearer, 'shearer-cutting-drum-front', [0.12, 0.9, -1.82], [0.12, 0.9, -2.72], 0.5, shearerDark, 24);
  addCylinderBetween(shearer, 'shearer-cutting-drum-rear', [0.12, 0.9, 1.82], [0.12, 0.9, 2.72], 0.5, shearerDark, 24);
  for (const zCenter of [-2.27, 2.27]) {
    for (let blade = 0; blade < 4; blade += 1) {
      const angle = blade * Math.PI * 0.5;
      const x = 0.12 + Math.cos(angle) * 0.28;
      const y = 0.9 + Math.sin(angle) * 0.28;
      addBox(shearer, 'shearer-drum-helical-vane', [0.08, 0.16, 0.9], [x, y, zCenter], shearerSteel, [0, 0.38, angle]);
    }
  }
  for (const zCenter of [-2.3, 2.3]) {
    for (let tooth = 0; tooth < 14; tooth += 1) {
      const angle = tooth / 14 * Math.PI * 2;
      const pick = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 6), shearerSteel);
      pick.name = 'shearer-drum-pick';
      pick.position.set(0.12 + Math.cos(angle) * 0.47, 0.9 + Math.sin(angle) * 0.47, zCenter + (tooth % 2 ? 0.32 : -0.32));
      pick.rotation.z = angle - Math.PI / 2;
      shearer.add(pick);
    }
  }
  addCylinderBetween(shearer, 'shearer-trailing-power-cable', [-0.76, 1.18, 1.25], [-1.18, 0.92, 2.4], 0.03, shearerBlack, 8);
  addCylinderBetween(shearer, 'shearer-water-spray-line', [0.58, 1.08, -1.4], [0.58, 1.08, 1.4], 0.018, shearerSteel, 8);
  for (const z of [-1.05, -0.35, 0.35, 1.05]) {
    addCylinderBetween(shearer, 'shearer-spray-nozzle', [0.58, 1.08, z], [0.86, 0.96, z + 0.08], 0.014, shearerSteel, 6);
  }

  const supports = register(runtime, 'hydraulicSupportArray', new THREE.Group(), {
    name: '液压支架组 ZY12000',
    install: '工作面出口段 12 架',
    meter: '出口段 0-20m',
  });
  supports.name = 'hydraulicSupportArray';
  face.add(supports);
  for (let i = 0; i < supportCount; i += 1) {
    const support = createSupport(materials);
    support.position.set(-1.95, 0, -length / 2 + 0.9 + i * ((length - 1.8) / (supportCount - 1)));
    support.userData.supportIndex = i + 1;
    supports.add(support);
    // Keep a dedicated device role: createMonitoring later reuses the legacy
    // supportPressure03 role for its small sensor, not for the whole support.
    if (i === 2) runtime.objectsByRole.set('simulationSupport01', support);
    if (i === 2) register(runtime, 'supportPressure03', support, {
      name: '支架压力 03',
      install: '工作面出口第 3 架液压支架',
      meter: '工作面约 4m',
      value: '工作阻力 9680 kN',
      status: 'warning',
    });
  }

  const goaf = register(runtime, 'goaf', new THREE.Group(), {
    name: '采空区矸石',
    install: '液压支架后方',
    meter: '出口段',
  });
  goaf.name = 'goaf-collapse-rock';
  face.add(goaf);
  for (let i = 0; i < 34; i += 1) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 + (i % 6) * 0.07, 0), cloneMaterial(materials.darkRock, 0x342d25));
    rock.position.set(-4.3 - (i % 4) * 0.45, 0.25 + (i % 3) * 0.25, -9 + (i * 1.41) % 18);
    rock.scale.y = 0.65;
    rock.name = 'goafRock';
    goaf.add(rock);
  }

  face.position.set(0, 0, 1.2);
}

function createRoadwayEquipment(root, materials, runtime) {
  const coalFlowMat = cloneMaterial(materials.coal, 0x171411, { roughness: 0.98, envMapIntensity: 0.08 });
  const skirtMat = cloneMaterial(materials.rubber, 0x080909, { roughness: 0.96 });
  const chuteMat = cloneMaterial(materials.weatheredSteel, 0x393f3d, { roughness: 0.88 });
  const stageLoader = register(runtime, 'stageLoaderSZZ1200', new THREE.Group(), {
    name: '转载机 SZZ1200',
    install: '运输顺槽 1-12m',
    meter: '1-12m',
  });
  runtime.objectsByRole.set('stageLoader', stageLoader);
  stageLoader.name = 'stageLoader';
  stageLoader.position.set(-0.35, 0, 0.8);
  stageLoader.scale.z = 0.86;
  root.add(stageLoader);
  addBox(stageLoader, 'stage-loader-trough', [1.28, 0.24, 12], [0, 0.42, 6], cloneMaterial(materials.weatheredSteel, 0x464f50));
  addBox(stageLoader, 'stage-loader-left-sideboard', [0.12, 0.72, 11.6], [-0.74, 0.84, 6], cloneMaterial(materials.weatheredSteel, 0x303637));
  addBox(stageLoader, 'stage-loader-right-sideboard', [0.12, 0.72, 11.6], [0.74, 0.84, 6], cloneMaterial(materials.weatheredSteel, 0x303637));
  for (let z = 1.2; z < 11.4; z += 0.9) {
    addBox(stageLoader, 'stage-loader-chain-flight', [1.05, 0.08, 0.08], [0, 0.64, z], cloneMaterial(materials.steel, 0x8a8378));
  }
  addBox(stageLoader, 'stage-loader-drive-frame', [1.75, 0.72, 1.15], [0, 0.95, 1.2], cloneMaterial(materials.paintedSteel, 0xbd8828));
  addCylinderBetween(stageLoader, 'stage-loader-drive-drum', [-0.95, 1.0, 0.55], [0.95, 1.0, 0.55], 0.28, cloneMaterial(materials.weatheredSteel, 0x272b2c), 16);
  addCylinderBetween(stageLoader, 'stage-loader-side-motor', [1.02, 0.95, 1.55], [1.78, 0.95, 1.55], 0.32, cloneMaterial(materials.weatheredSteel, 0x303536), 16);
  addBox(stageLoader, 'stage-loader-open-feed-mouth', [1.05, 0.46, 0.12], [0, 0.98, 2.15], cloneMaterial(materials.rubber, 0x080909));

  const crusher = register(runtime, 'crusherPLM3000', new THREE.Group(), {
    name: '破碎机 PLM3000',
    install: '运输顺槽 14-19m',
    meter: '14-19m',
  });
  crusher.name = 'crusherPLM3000';
  crusher.position.set(0.15, 0, 3.8);
  root.add(crusher);
  addBox(crusher, 'crusher-lower-skid', [2.5, 0.26, 4.8], [0, 0.28, 12.2], cloneMaterial(materials.weatheredSteel, 0x353a38));
  addBox(crusher, 'crusher-side-left', [0.22, 1.45, 4.2], [-1.22, 1.15, 12.2], cloneMaterial(materials.paintedSteel, 0xc28b22));
  addBox(crusher, 'crusher-side-right', [0.22, 1.45, 4.2], [1.22, 1.15, 12.2], cloneMaterial(materials.paintedSteel, 0xc28b22));
  addBox(crusher, 'crusher-top-guard', [2.28, 0.18, 4.05], [0, 1.93, 12.2], cloneMaterial(materials.weatheredSteel, 0x3f4544));
  addBox(crusher, 'crusher-dark-mouth', [1.85, 0.75, 0.16], [0, 1.2, 10.1], cloneMaterial(materials.rubber, 0x070808));
  addBox(crusher, 'crusher-hopper', [3.05, 0.24, 2.3], [0, 2.35, 10.8], cloneMaterial(materials.weatheredSteel, 0x5b5248), [0.26, 0, 0]);
  addBox(crusher, 'crusher-hopper-left-wing', [0.18, 1.0, 2.25], [-1.38, 2.15, 10.8], cloneMaterial(materials.weatheredSteel, 0x5b5248), [0.2, 0, -0.34]);
  addBox(crusher, 'crusher-hopper-right-wing', [0.18, 1.0, 2.25], [1.38, 2.15, 10.8], cloneMaterial(materials.weatheredSteel, 0x5b5248), [0.2, 0, 0.34]);
  addCylinderBetween(crusher, 'crusher-toothed-shaft-a', [-0.82, 1.25, 11.55], [0.82, 1.25, 11.55], 0.18, cloneMaterial(materials.weatheredSteel, 0x262b2c), 14);
  addCylinderBetween(crusher, 'crusher-toothed-shaft-b', [-0.82, 1.25, 12.45], [0.82, 1.25, 12.45], 0.18, cloneMaterial(materials.weatheredSteel, 0x262b2c), 14);
  for (const z of [11.55, 12.45]) {
    for (let tooth = 0; tooth < 8; tooth += 1) {
      addBox(crusher, 'crusher-breaking-tooth', [0.08, 0.26, 0.08], [-0.7 + tooth * 0.2, 1.48, z], cloneMaterial(materials.steel, 0x8f887d), [0.4, 0, tooth % 2 ? 0.5 : -0.5]);
    }
  }
  addCylinderBetween(crusher, 'crusher-side-motor', [1.38, 1.12, 13.1], [2.18, 1.12, 13.1], 0.38, cloneMaterial(materials.weatheredSteel, 0x333738), 16);
  addCylinderBetween(crusher, 'crusher-flywheel', [-1.5, 1.18, 13.45], [-1.82, 1.18, 13.45], 0.5, cloneMaterial(materials.weatheredSteel, 0x252a2b), 18);

  addBox(root, 'stage-loader-to-crusher-transfer-chute', [1.18, 0.18, 2.45], [-0.12, 0.72, 12.55], chuteMat, [0.08, 0.03, 0]);
  addBox(root, 'stage-loader-transfer-left-skirt', [0.12, 0.42, 2.65], [-0.78, 0.98, 12.55], skirtMat, [0.08, 0.02, -0.08]);
  addBox(root, 'stage-loader-transfer-right-skirt', [0.12, 0.42, 2.65], [0.56, 0.98, 12.55], skirtMat, [0.08, -0.02, 0.08]);
  addBox(root, 'crusher-to-belt-transfer-chute', [1.12, 0.18, 2.35], [0.36, 0.82, 20.1], chuteMat, [0.06, -0.02, 0]);
  addBox(root, 'belt-loading-hood-top', [1.12, 0.12, 1.1], [0.55, 1.42, 21.25], chuteMat, [0.08, 0, 0]);
  addBox(root, 'belt-loading-hood-left-skirt', [0.08, 0.38, 1.35], [0.02, 1.16, 21.35], skirtMat, [0.04, 0, -0.04]);
  addBox(root, 'belt-loading-hood-right-skirt', [0.08, 0.38, 1.35], [1.08, 1.16, 21.35], skirtMat, [0.04, 0, 0.04]);
  addBox(root, 'belt-transfer-falling-coal-stream', [0.34, 0.28, 0.22], [0.55, 1.22, 21.1], coalFlowMat, [0.16, 0.04, 0.03]);
  for (let i = 0; i < 14; i += 1) {
    const z = 23.4 + i * 1.45;
    const coal = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.065 + (i % 4) * 0.012, 0),
      coalFlowMat,
    );
    coal.name = 'belt-coal-load';
    coal.position.set(0.55 + Math.sin(i * 1.7) * 0.15, 1.26 + (i % 3) * 0.018, z);
    coal.scale.set(1.35, 0.34, 0.9);
    coal.rotation.set(i * 0.37, i * 0.19, i * 0.53);
    root.add(coal);
  }
  const belt = register(runtime, 'undergroundBeltDSJ120', new THREE.Group(), {
    name: '带式输送机 DSJ120',
    install: '运输顺槽 21-50m',
    meter: '21-50m',
  });
  belt.name = 'undergroundBeltDSJ120';
  belt.position.x = 0.55;
  root.add(belt);
  const beltTop = addBox(belt, 'belt-rubber', [1.28, 0.09, 28], [0, 0.92, 36], cloneMaterial(materials.rubber, 0x0b0c0c));
  beltTop.rotation.z = 0.035;
  addBox(belt, 'belt-frame-left', [0.1, 0.12, 28], [-0.66, 0.58, 36], cloneMaterial(materials.steel, 0x626b68));
  addBox(belt, 'belt-frame-right', [0.1, 0.12, 28], [0.66, 0.58, 36], cloneMaterial(materials.steel, 0x626b68));
  for (let z = 23; z < 49; z += 3) {
    addCylinderBetween(belt, 'belt-center-roller', [-0.36, 0.76, z], [0.36, 0.76, z], 0.06, cloneMaterial(materials.weatheredSteel, 0x77736b), 12);
    addCylinderBetween(belt, 'belt-left-wing-roller', [-0.68, 0.72, z], [-0.36, 0.84, z], 0.052, cloneMaterial(materials.weatheredSteel, 0x77736b), 12);
    addCylinderBetween(belt, 'belt-right-wing-roller', [0.36, 0.84, z], [0.68, 0.72, z], 0.052, cloneMaterial(materials.weatheredSteel, 0x77736b), 12);
    addBox(belt, 'belt-h-frame', [1.55, 0.07, 0.08], [0, 0.46, z], cloneMaterial(materials.steel, 0x4e5654));
    addCylinderBetween(belt, 'belt-left-leg', [-0.7, 0.12, z], [-0.7, 0.7, z], 0.032, cloneMaterial(materials.steel, 0x4e5654), 7);
    addCylinderBetween(belt, 'belt-right-leg', [0.7, 0.12, z], [0.7, 0.7, z], 0.032, cloneMaterial(materials.steel, 0x4e5654), 7);
  }
  addCylinderBetween(belt, 'belt-tail-drum', [-0.68, 0.88, 22.2], [0.68, 0.88, 22.2], 0.22, cloneMaterial(materials.weatheredSteel, 0x333837), 18);
  addCylinderBetween(belt, 'belt-head-drum', [-0.68, 0.88, 49.2], [0.68, 0.88, 49.2], 0.22, cloneMaterial(materials.weatheredSteel, 0x333837), 18);
}

function createMonitorObject(root, materials, runtime, anchor) {
  const statusColor = anchor.status === 'danger' ? 0xff3434 : anchor.status === 'warning' ? 0xffc533 : 0x28d986;
  const bodyColor = anchor.type === 'roof-separation'
    ? 0xb9922f
    : anchor.type === 'anchor-load'
      ? 0x68706b
      : anchor.type === 'microseismic'
        ? 0x526066
      : 0x5f6966;
  const mat = cloneMaterial(materials.paintedSteel, bodyColor, { emissiveIntensity: 0.0, roughness: 0.88 });
  const darkMount = cloneMaterial(materials.weatheredSteel, 0x2f3432, { roughness: 0.82 });
  let object;
  if (anchor.type === 'convergence') {
    object = new THREE.Group();
    object.name = `monitor-${anchor.id}`;
    object.position.set(...anchor.position);
    const convergenceLineMat = cloneMaterial(materials.rubber, 0x22373a, {
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    addCylinderBetween(object, 'convergence-line-left', [0, 0, 0], [5.05, 3.2, 0], 0.007, convergenceLineMat, 6);
    addCylinderBetween(object, 'convergence-line-right', [10.1, 0, 0], [5.05, 3.2, 0], 0.007, convergenceLineMat, 6);
    addBox(object, 'convergence-station-box', [0.34, 0.24, 0.22], [0, 0, 0], mat);
    addBox(object, 'convergence-station-base', [0.46, 0.06, 0.3], [0, -0.17, 0], darkMount);
  } else if (anchor.type === 'camera') {
    object = new THREE.Group();
    object.name = `monitor-${anchor.id}`;
    object.position.set(...anchor.position);
    addBox(object, 'cctv-body', [0.58, 0.34, 0.42], [0, 0, 0], cloneMaterial(materials.steel, 0x87939a));
    addCylinderBetween(object, 'cctv-lens', [0, 0, 0.12], [0, -0.2, -0.34], 0.11, mat, 12);
    addBox(object, 'cctv-wall-bracket', [0.18, 0.52, 0.18], [0.36, -0.1, 0.08], darkMount);
  } else {
    object = new THREE.Group();
    object.name = `monitor-${anchor.id}`;
    object.position.set(...anchor.position);
    if (anchor.type === 'roof-separation') {
      addCylinderBetween(object, 'separation-roof-anchor', [-0.16, 0, 0], [0.16, 0, 0], 0.045, darkMount, 12);
      addCylinderBetween(object, 'separation-probe-rod', [0, -0.04, 0], [0, -0.78, 0], 0.018, mat, 8);
      addCylinderBetween(object, 'separation-reading-collar', [-0.1, -0.28, 0], [0.1, -0.28, 0], 0.032, mat, 10);
    } else if (anchor.type === 'anchor-load') {
      addCylinderBetween(object, 'anchor-load-ring', [-0.16, 0, 0], [0.16, 0, 0], 0.07, mat, 14);
      addCylinderBetween(object, 'anchor-load-lead-wire', [0.12, -0.02, 0], [0.55, -0.36, 0.18], 0.014, darkMount, 6);
    } else if (anchor.type === 'microseismic') {
      addCylinderBetween(object, 'microseismic-geophone-body', [0, -0.12, 0], [0, 0.12, 0], 0.075, mat, 12);
      addCylinderBetween(object, 'microseismic-cable', [0.05, -0.1, 0], [0.42, -0.38, 0.16], 0.012, darkMount, 6);
    } else {
      addCylinderBetween(object, 'monitor-pin', [0, -0.12, 0], [0, 0.12, 0], 0.05, mat, 10);
    }
  }
  if (!object.parent) root.add(object);
  register(runtime, anchor.role, object, anchor);
  return object;
}

function freezeAnchor(anchor) {
  return Object.freeze({ ...anchor, position: Object.freeze([...anchor.position]) });
}

export const FOCUSED_LONGWALL_MONITORS = Object.freeze([
  { id: 'roof-separation-01', role: 'roofSeparation01', category: 'roof-sensor', type: 'roof-separation', name: '顶板离层仪 01', meter: 4, install: '运输顺槽 4m 顶板中线', value: '离层量 18 mm', status: 'safe', position: [0, 6.45, 4], unit: 'mm', warn: 25, danger: 32 },
  { id: 'roof-separation-02', role: 'roofSeparation02', category: 'roof-sensor', type: 'roof-separation', name: '顶板离层仪 02', meter: 10, install: '运输顺槽 10m 顶板中线', value: '离层量 25 mm', status: 'warning', position: [0, 6.45, 10], unit: 'mm', warn: 25, danger: 32 },
  { id: 'roof-separation-03', role: 'roofSeparation03', category: 'roof-sensor', type: 'roof-separation', name: '顶板离层仪 03', meter: 16, install: '运输顺槽 16m 顶板中线', value: '离层量 38 mm', status: 'danger', position: [0, 6.45, 16], unit: 'mm', warn: 25, danger: 32 },
  { id: 'convergence-01', role: 'convergence01', category: 'roof-sensor', type: 'convergence', name: '巷道收敛监测 01', meter: 10, install: '运输顺槽 10m 两帮-顶板测线', value: '收敛量 21 mm', status: 'warning', position: [-5.05, 2.05, 10], unit: 'mm', warn: 18, danger: 25 },
  { id: 'anchor-load-01', role: 'anchorLoad01', category: 'roof-sensor', type: 'anchor-load', name: '锚索受力监测 01', meter: 12, install: '运输顺槽 12m 顶板锚索', value: '锚索载荷 236 kN', status: 'warning', position: [2.25, 6.05, 12], unit: 'kN', warn: 220, danger: 260 },
  { id: 'support-pressure-03', role: 'supportPressure03', category: 'equipment-status', type: 'support-load', name: '支架压力 03', meter: 4, install: '工作面出口第 3 架液压支架', value: '工作阻力 9680 kN', status: 'warning', position: [-1.1, 2.3, -4.8], unit: 'kN', warn: 9500, danger: 10500 },
  { id: 'microseismic-01', role: 'microseismic01', category: 'roof-sensor', type: 'microseismic', name: '微震监测 01', meter: 18, install: '运输顺槽 18m 左帮', value: '微震能量 860 J', status: 'warning', position: [-5.02, 2.8, 18], unit: 'J', warn: 800, danger: 1200 },
  { id: 'cctv-01', role: 'cctv01', category: 'camera', type: 'camera', name: '出口 CCTV 01', meter: 2, install: '工作面出口顶板支架', value: '视频在线', status: 'safe', position: [4.2, 5.85, 2], unit: 'stream', warn: null, danger: null },
].map(freezeAnchor));

export const FOCUSED_LONGWALL_EQUIPMENT = Object.freeze([
  { id: 'machine-shearer', category: 'equipment-status', type: 'equipment', name: '采煤机', value: '运行', position: [0.7, 2.8, -2.0] },
  { id: 'machine-afc', category: 'equipment-status', type: 'equipment', name: '刮板输送机', value: '运行', position: [0.8, 1.5, 4.4] },
  { id: 'machine-supports', category: 'equipment-status', type: 'equipment', name: '液压支架组', value: '12架', position: [-2.2, 4.0, 2.4] },
  { id: 'machine-stage-loader', category: 'equipment-status', type: 'equipment', name: '转载机', value: '0-12m', position: [-1.1, 1.8, 6] },
  { id: 'machine-crusher', category: 'equipment-status', type: 'equipment', name: '破碎机', value: '8-16m', position: [1.55, 2.9, 12] },
  { id: 'machine-belt', category: 'equipment-status', type: 'equipment', name: '带式输送机', value: '12-50m', position: [1.55, 1.8, 28] },
].map(freezeAnchor));

function createMonitoring(root, materials, runtime) {
  const monitors = [...FOCUSED_LONGWALL_MONITORS, ...FOCUSED_LONGWALL_EQUIPMENT]
    .map(anchor => ({ ...anchor, position: [...anchor.position] }));

  const relocatedEquipmentAnchors = new Map([
    ['machine-supports', { value: '12架', position: [-2.15, 3.05, -1.4] }],
    ['machine-stage-loader', { value: '1-12m', position: [-1.35, 1.9, 7] }],
    ['machine-crusher', { value: '14-19m', position: [1.75, 3.05, 16.5] }],
    ['machine-belt', { value: '21-50m', position: [2.25, 1.9, 35.5] }],
  ]);
  relocatedEquipmentAnchors.set('machine-supports', { value: '12架', position: [-3.1, 3.15, -2.2] });
  relocatedEquipmentAnchors.set('machine-stage-loader', { value: '1-12m', position: [-2.35, 1.75, 5.3] });
  relocatedEquipmentAnchors.set('machine-crusher', { value: '14-19m', position: [2.8, 2.65, 15.7] });
  relocatedEquipmentAnchors.set('machine-belt', { value: '21-50m', position: [2.85, 1.65, 33.0] });

  monitors.forEach(anchor => {
    const next = relocatedEquipmentAnchors.get(anchor.id);
    if (!next) return;
    anchor.value = next.value;
    anchor.position = next.position;
  });

  const hazardMat = new THREE.MeshBasicMaterial({ color: 0xff3535, transparent: true, opacity: 0.018, depthWrite: false });
  addBox(root, 'roof-warning-zone-10-to-18m', [2.55, 0.01, 5.4], [-0.1, 6.0, 14], hazardMat);
  const crackMat = cloneMaterial(materials.paintedSteel, 0x7a3a32, {
    transparent: true,
    opacity: 0.16,
    emissiveIntensity: 0.04,
    depthWrite: false,
  });
  for (const z of [10.5, 12.8, 16.2, 18.1]) {
    addBox(root, 'warning-roof-crack', [0.46, 0.01, 0.02], [-0.28 + (z % 2) * 0.48, 6.1, z], crackMat, [0, 0.35, 0.25]);
  }

  monitors.forEach(anchor => createMonitorObject(root, materials, runtime, anchor));
  runtime.monitorAnchors = monitors;
}

function createDust(root) {
  const count = 360;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = -2.4 + (i * 1.71) % 4.8;
    positions[i * 3 + 1] = 0.7 + (i * 0.47) % 2.8;
    positions[i * 3 + 2] = (i * 3.83) % 50;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0x807365, size: 0.008, transparent: true, opacity: 0.055, depthWrite: false });
  const dust = new THREE.Points(geometry, material);
  dust.name = 'dust';
  dust.userData.isAmbientTunnelDust = true;
  root.add(dust);
}

async function addImportedMachineModels(root, runtime) {
  const { results, failures } = await loadAvailableModels([
    ['conveyorKit', MODEL_ASSETS.conveyorKit, { name: 'imported-quarry-conveyor-kit' }],
    ['cctv', MODEL_ASSETS.cctv, { name: 'imported-weathered-cctv-camera' }],
  ]);

  const conveyor = results.get('conveyorKit')?.root;
  if (conveyor) {
    const importedBelt = normalizeImportedModel(assembledConveyorOnly(conveyor), { targetLength: 29 });
    trimImportedConveyorEnvelope(importedBelt);
    importedBelt.name = 'imported-belt-conveyor-DSJ120';
    importedBelt.position.set(0.55, -0.08, 35.5);
    importedBelt.rotation.y = Math.PI / 2;
    importedBelt.scale.multiplyScalar(0.48);
    importedBelt.visible = true;
    root.add(importedBelt);
    const proceduralBelt = runtime.objectsByRole.get('undergroundBeltDSJ120');
    if (proceduralBelt) proceduralBelt.visible = false;
    register(runtime, 'undergroundBeltDSJ120', importedBelt, {
      name: '带式输送机 DSJ120',
      install: '运输顺槽 21-50m',
      meter: '21-50m',
      value: '真实模型',
      status: 'running',
    });
  }

  const cctv = results.get('cctv')?.root;
  if (cctv) {
    const importedCctv = normalizeImportedModel(cloneModelRoot(cctv), { targetHeight: 0.58 });
    importedCctv.name = 'imported-weathered-cctv-camera';
    importedCctv.position.set(4.2, 5.85, 2);
    importedCctv.rotation.set(0, Math.PI * 0.72, 0);
    root.add(importedCctv);
    const proceduralCctv = runtime.objectsByRole.get('cctv01');
    if (proceduralCctv) proceduralCctv.visible = false;
    register(runtime, 'cctv01', importedCctv, {
      name: '出口 CCTV 01',
      install: '工作面出口顶板支架',
      meter: '2m',
      value: '真实模型',
      status: 'safe',
    });
  }

  runtime.importedMachineModelFailures = failures;
}

export async function buildFocusedLongwallScene(materials, runtime) {
  const root = new THREE.Group();
  root.name = 'focusedLongwallRoadway';
  root.userData.runtime = runtime;
  createRoadwayShell(root, materials);
  createWorkingFaceRoofEnvelope(root, materials);
  createWorkingFace(root, materials, runtime);
  createRoadwayEquipment(root, materials, runtime);
  createMonitoring(root, materials, runtime);
  createDust(root);
  await addImportedMachineModels(root, runtime);

  const exitLight = new THREE.RectAreaLight(0xffd8a4, 32, 7, 4);
  exitLight.position.set(0, 3.1, 3);
  exitLight.rotation.x = -Math.PI / 2;
  exitLight.name = 'face-exit-area-light';
  root.add(exitLight);

  return root;
}
