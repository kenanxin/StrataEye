import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { getOverviewLabelIds, UNDERGROUND_LABEL_IDS, WORKING_FACE_LABEL_IDS } from './monitor-layout.mjs';
import { getMonitorOperationalState } from './monitor-state.mjs';

const CATEGORY_COLORS = {
  'roof-sensor': 0x26d6c8,
  camera: 0x4aa8ff,
  person: 0x66df86,
  'equipment-status': 0xffb14d,
};

const DEFAULT_UNDERGROUND_LABEL_IDS = new Set([
  'roof-separation-03',
  'support-pressure-03',
  'machine-stage-loader',
  'machine-crusher',
  'machine-belt',
]);

const LABEL_POSITION_OFFSETS = new Map([
  ['roof-separation-03', [0, 0.2, 0]],
  ['support-pressure-03', [1.15, 1.25, -1.15]],
  ['machine-supports', [-1.65, 0.35, -1.2]],
  ['machine-stage-loader', [-1.15, 0.12, -1.05]],
  ['machine-crusher', [1.35, 0.3, 0.75]],
  ['machine-belt', [1.1, 0.25, -0.65]],
]);

function metricValue(anchor, snapshot) {
  if (anchor.value) return anchor.value;
  const metrics = snapshot.metrics;
  if (anchor.type === 'roof-pressure' || anchor.type === 'junction-stress' || anchor.type === 'chamber-pressure') return metrics.roofPressure;
  if (anchor.type === 'roof-separation') return metrics.roofSeparation;
  if (anchor.type === 'convergence') return metrics.roofSubsidence;
  if (anchor.type === 'support-load') return metrics.supportResistance;
  if (anchor.type === 'microseismic') return metrics.microseismicEnergy;
  return anchor.category === 'camera' ? '在线' : anchor.category === 'person' ? '在岗' : '运行';
}

function formatValue(anchor, snapshot) {
  const value = metricValue(anchor, snapshot);
  return typeof value === 'number' ? `${value.toFixed(anchor.unit === 'kN' ? 0 : 1)} ${anchor.unit}` : value;
}

function createLabel(anchor, snapshot) {
  const element = document.createElement('div');
  element.className = `mine-v2-label ${anchor.category}`;
  element.style.cssText = 'padding:3px 6px;background:rgba(5,12,15,.78);border:1px solid rgba(63,213,205,.48);color:#d9f7f5;font:10.5px/1.22 sans-serif;white-space:nowrap;pointer-events:none;box-shadow:0 2px 7px rgba(0,0,0,.30);border-radius:2px';
  const labelName = anchor.name ?? anchor.id;
  element.innerHTML = `<b>${labelName}</b><span style="margin-left:6px">${formatValue(anchor, snapshot)}</span>`;
  const label = new CSS2DObject(element);
  label.position.fromArray(anchor.position);
  label.position.y += anchor.category === 'equipment-status' ? 0.55 : 0.9;
  const offset = LABEL_POSITION_OFFSETS.get(anchor.id);
  if (offset) label.position.add(new THREE.Vector3(...offset));
  label.userData.anchor = anchor;
  label.userData.valueElement = element.querySelector('span');
  return label;
}

function colorToCss(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function applyOperationalState(marker, label, snapshot) {
  const state = getMonitorOperationalState(label.userData.anchor, snapshot);
  const color = colorToCss(state.color);
  marker.material.color.setHex(state.color);
  marker.material.emissive.setHex(state.color);
  label.element.style.borderColor = color;
  label.element.style.borderLeftColor = colorToCss(state.categoryColor);
  label.element.style.color = color;
  label.userData.valueElement.textContent = label.userData.anchor.value ?? state.text;
}

export function buildLabelsAndMarkers(materials, runtime, simulator, anchors) {
  const root = new THREE.Group();
  root.name = 'mineV2MonitoringLayer';
  const snapshot = simulator.snapshot();
  const overviewLabelIds = new Set(getOverviewLabelIds(anchors));
  let focusedLabelId = null;

  anchors.forEach(anchor => {
    if (anchor.category === 'camera' || anchor.category === 'person') return;
    const color = CATEGORY_COLORS[anchor.category] ?? 0xffffff;
    const markerMaterial = materials.lamp.clone();
    markerMaterial.color.setHex(color);
    markerMaterial.emissive.setHex(color);
    markerMaterial.emissiveIntensity = anchor.category === 'roof-sensor' ? 0.08 : 0.28;
    markerMaterial.transparent = true;
    markerMaterial.opacity = anchor.category === 'roof-sensor' ? 0.34 : 0.58;
    const markerGeometry = new THREE.SphereGeometry(anchor.category === 'equipment-status' ? 0.045 : 0.055, 8, 6);
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.fromArray(anchor.position);
    marker.position.x -= 0.18;
    marker.position.y += 0.16;
    marker.name = `monitor-${anchor.id}`;
    marker.userData.anchor = anchor;
    marker.visible = false;
    root.add(marker);
    runtime.monitorMarkers.push(marker);

    const label = createLabel(anchor, snapshot);
    label.userData.overviewVisible = overviewLabelIds.has(anchor.id);
    label.userData.undergroundVisible = UNDERGROUND_LABEL_IDS.has(anchor.id);
    label.userData.workingFaceVisible = WORKING_FACE_LABEL_IDS.has(anchor.id);
    label.userData.marker = marker;
    root.add(label);
    runtime.labels.push(label);
    applyOperationalState(marker, label, snapshot);
  });

  runtime.setLabelMode = mode => {
    for (const label of runtime.labels) {
      const anchor = label.userData.anchor;
      const baseVisible = focusedLabelId
        ? anchor.id === focusedLabelId
        : DEFAULT_UNDERGROUND_LABEL_IDS.has(anchor.id) || anchor.status === 'danger';
      const visible = baseVisible;
      label.visible = visible;
      label.userData.marker.visible = false;
      if (focusedLabelId && anchor.id === focusedLabelId) {
        label.element.style.background = 'rgba(9,16,18,.9)';
        label.element.style.borderColor = '#ffd447';
        label.element.style.color = '#ffe7a3';
        label.element.style.fontSize = '12px';
        label.element.style.padding = '5px 8px';
      } else {
        label.element.style.background = 'rgba(5,12,15,.78)';
        label.element.style.fontSize = '10.5px';
        label.element.style.padding = '3px 6px';
      }
    }
  };
  runtime.setFocusedLabel = anchorId => {
    focusedLabelId = anchorId ?? null;
    runtime.setLabelMode(runtime.currentViewMode ?? 'underground');
  };
  runtime.setLabelMode('underground');

  runtime.updaters.push(() => {
    const next = simulator.snapshot();
    for (const label of runtime.labels) {
      applyOperationalState(label.userData.marker, label, next);
    }
  });
  return root;
}
