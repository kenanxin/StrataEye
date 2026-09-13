const freezePosition = position => Object.freeze([...position]);

const freezeNode = node => Object.freeze({
  ...node,
  position: freezePosition(node.position),
});

const freezeEdge = edge => Object.freeze({
  ...edge,
  points: edge.points ? Object.freeze(edge.points.map(freezePosition)) : undefined,
});

export const ROADWAY_NODES = Object.freeze([
  { id: 'portal', type: 'portal', position: [260, 18, -45] },
  { id: 'h1-junction', type: 'junction', position: [160, -45, -60] },
  { id: 'h1-level-end', type: 'level-end', position: [250, -45, -10] },
  { id: 'h2-junction', type: 'junction', position: [90, -95, -85] },
  { id: 'h3-junction', type: 'junction', position: [20, -155, -110] },
  { id: 'pump-chamber', type: 'chamber', position: [190, -95, -10] },
  { id: 'substation-chamber', type: 'chamber', position: [10, -95, -10] },
  { id: 'intake-gate-end', type: 'gate-end', position: [-30, -155, -45] },
  { id: 'return-gate-end', type: 'gate-end', position: [-30, -155, -175] },
  { id: 'working-face-1206', type: 'working-face', position: [-110, -155, -110] },
].map(freezeNode));

export const ROADWAY_EDGES = Object.freeze([
  { id: 'main-incline-h1', type: 'main-incline', from: 'portal', to: 'h1-junction', width: 6, points: [[260, 18, -45], [205, -12, -52], [160, -45, -60]] },
  { id: 'main-incline-h2', type: 'main-incline', from: 'h1-junction', to: 'h2-junction', width: 6, points: [[160, -45, -60], [125, -70, -72], [90, -95, -85]] },
  { id: 'main-incline-h3', type: 'main-incline', from: 'h2-junction', to: 'h3-junction', width: 6, points: [[90, -95, -85], [55, -125, -98], [20, -155, -110]] },
  { id: 'main-level-h1', type: 'main-level', from: 'h1-junction', to: 'h1-level-end', width: 6, points: [[160, -45, -60], [205, -45, -35], [250, -45, -10]] },
  { id: 'pump-descent', type: 'auxiliary-roadway', from: 'h1-level-end', to: 'pump-chamber', width: 5, points: [[250, -45, -10], [220, -70, -10], [190, -95, -10]] },
  { id: 'main-level-h2', type: 'main-level', from: 'h2-junction', to: 'substation-chamber', width: 6, points: [[90, -95, -85], [50, -95, -45], [10, -95, -10]] },
  { id: 'main-level-h3', type: 'main-level', from: 'h3-junction', to: 'intake-gate-end', width: 6, points: [[20, -155, -110], [5, -155, -75], [-30, -155, -45]] },
  { id: 'return-airway', type: 'return-airway', from: 'h1-junction', to: 'substation-chamber', width: 5, points: [[160, -45, -60], [85, -45, 15], [10, -95, -10]] },
  { id: 'intake-gate-road', type: 'gate-road', from: 'intake-gate-end', to: 'working-face-1206', width: 5.5, points: [[-30, -155, -45], [-70, -155, -60], [-110, -155, -110]] },
  { id: 'return-gate-road', type: 'gate-road', from: 'return-gate-end', to: 'working-face-1206', width: 5.5, points: [[-30, -155, -175], [-70, -155, -160], [-110, -155, -110]] },
  { id: 'lower-gate-crosscut', type: 'crosscut', from: 'h3-junction', to: 'return-gate-end', width: 4.5, points: [[20, -155, -110], [-5, -155, -145], [-30, -155, -175]] },
  { id: 'chamber-crosscut', type: 'crosscut', from: 'pump-chamber', to: 'substation-chamber', width: 4.5 },
  { id: 'face-crosscut', type: 'crosscut', from: 'intake-gate-end', to: 'return-gate-end', width: 4.5 },
].map(freezeEdge));

export const ATLAS_EXPOSED_EDGE_IDS = Object.freeze([
  'main-level-h3',
  'intake-gate-road',
  'return-gate-road',
  'lower-gate-crosscut',
]);

const nodesById = new Map(ROADWAY_NODES.map(node => [node.id, node]));
const edgesById = new Map(ROADWAY_EDGES.map(edge => [edge.id, edge]));

function requireNode(nodeId) {
  const node = nodesById.get(nodeId);
  if (!node) throw new Error(`Unknown roadway node: ${nodeId}`);
  return node;
}

function requireEdge(edgeId) {
  const edge = edgesById.get(edgeId);
  if (!edge) throw new Error(`Unknown roadway edge: ${edgeId}`);
  return edge;
}

export function sampleEdge(edgeId, t) {
  const edge = requireEdge(edgeId);
  const clamped = Math.min(1, Math.max(0, t));
  const points = edge.points ?? [requireNode(edge.from).position, requireNode(edge.to).position];
  const scaled = clamped * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(scaled));
  const local = scaled - index;
  return points[index].map((value, axis) => value + (points[index + 1][axis] - value) * local);
}

export function getConnectedNodeIds(nodeId) {
  requireNode(nodeId);
  return ROADWAY_EDGES
    .flatMap(edge => edge.from === nodeId ? [edge.to] : edge.to === nodeId ? [edge.from] : []);
}
