export const MINE_V2_CONFIG = Object.freeze({
  seed: 20260728,
  world: Object.freeze({ width: 900, depth: 520, undergroundDepth: 210 }),
  horizons: Object.freeze([-45, -95, -155]),
  workingFace: Object.freeze({ id: 'working-face-1206', length: 20, width: 8, height: 4 }),
  roadway: Object.freeze({ minWidth: 4.5, maxWidth: 6, defaultHeight: 4.2 }),
  performance: Object.freeze({ targetFps: 40, maxLabelsOverview: 10 }),
  requiredRoles: Object.freeze([
    'workingFace', 'coalWall', 'hydraulicSupportArray', 'shearer',
    'scraperConveyor', 'stageLoader', 'stageLoaderSZZ1200', 'crusherPLM3000',
    'undergroundBeltDSJ120', 'transportRoadway',
    'roofSeparation01', 'roofSeparation02', 'roofSeparation03',
    'convergence01', 'anchorLoad01', 'supportPressure03', 'microseismic01', 'cctv01',
  ]),
});

export const FOCUSED_LONGWALL_LAYOUT = Object.freeze({
  roadway: Object.freeze({ length: 50, width: 10.5, height: 7.2 }),
  face: Object.freeze({ length: 20, miningHeight: 4, supportCount: 12 }),
  zones: Object.freeze({
    stageLoader: Object.freeze([1, 12]),
    crusher: Object.freeze([14, 19]),
    belt: Object.freeze([21, 50]),
    monitoring: Object.freeze([0, 20]),
  }),
  defaultCamera: Object.freeze({
    position: Object.freeze([4.4, 3.75, 25.5]),
    target: Object.freeze([-0.9, 2.0, 5.8]),
    fov: 58,
  }),
});
