import { ZONE_PRESETS } from './zone-presets.mjs';
import { FOCUSED_LONGWALL_LAYOUT } from './config.mjs';

// 井下总览镜头：读取三层巷道网络与 1206 工作面空间关系
const OVERVIEW_PRESET = Object.freeze({
  position: Object.freeze([300, 30, 300]),
  target: Object.freeze([55, -90, -85]),
  fov: 42,
});

// 井下镜头：聚焦 1206 工作面出口段及运输顺槽
const UNDERGROUND_PRESET = Object.freeze({
  position: Object.freeze([...FOCUSED_LONGWALL_LAYOUT.defaultCamera.position]),
  target: Object.freeze([...FOCUSED_LONGWALL_LAYOUT.defaultCamera.target]),
  fov: FOCUSED_LONGWALL_LAYOUT.defaultCamera.fov,
});

export const CAMERA_PRESETS = Object.freeze({
  overview: OVERVIEW_PRESET,
  underground: UNDERGROUND_PRESET,
  exit: UNDERGROUND_PRESET,
});

export const CONTROL_LIMITS = Object.freeze({
  overview: Object.freeze({
    minDistance: 40,
    maxDistance: 360,
    minAzimuth: -0.75,
    maxAzimuth: 0.75,
    minPolar: 0.12,
    maxPolar: Math.PI * 0.46,
  }),
  underground: Object.freeze({
    minDistance: 2,
    maxDistance: 90,
    minAzimuth: -Infinity,
    maxAzimuth: Infinity,
  }),
  exit: Object.freeze({
    minDistance: 2,
    maxDistance: 90,
    minAzimuth: -Infinity,
    maxAzimuth: Infinity,
  }),
});
