// Route drawing: the navigator path as screen-space lines (readable at any zoom) with a white flow
// animated toward the target, plus dashed connectors from the player marker and to a target the path
// cannot reach (inside a building).

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { Line2 } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/lines/Line2.js/+esm';
import { LineMaterial } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/lines/LineMaterial.js/+esm';
import { LineGeometry } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/lines/LineGeometry.js/+esm';

const ROUTE_BLUE = 0x3d9bff;
const ROUTE_DARK = 0x061526;

function material(resolution, options) {
  const m = new LineMaterial({ worldUnits: false, depthTest: false, depthWrite: false, transparent: true, ...options });
  m.resolution.copy(resolution);
  return m;
}

function line(points, mat, order) {
  const geometry = new LineGeometry();
  geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  const l = new Line2(geometry, mat);
  l.computeLineDistances();
  l.renderOrder = order;
  return l;
}

function pointAtHalf(path) {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += path[i].distanceTo(path[i - 1]);
  let left = total / 2;
  for (let i = 1; i < path.length; i += 1) {
    const d = path[i].distanceTo(path[i - 1]);
    if (d >= left) return path[i - 1].clone().lerp(path[i], d ? left / d : 0);
    left -= d;
  }
  return path[path.length - 1].clone();
}

// points: scene {x, z, y?} (y: the floor the leg is on; stairs are the jumps between floors);
// y: height for points without one; from / to: player and target anchors.
export function buildRoute({ points, y, from, to, resolution }) {
  const group = new THREE.Group();
  const path = points.map((p) => new THREE.Vector3(p.x, p.y != null ? p.y : y, p.z));
  const outline = material(resolution, { color: ROUTE_DARK, linewidth: 9, opacity: 0.8 });
  const core = material(resolution, { color: ROUTE_BLUE, linewidth: 5 });
  const flow = material(resolution, { color: 0xffffff, linewidth: 2.2, dashed: true, dashSize: 2.5, gapSize: 6 });
  const connector = material(resolution, { color: ROUTE_BLUE, linewidth: 2.5, dashed: true, dashSize: 1.2, gapSize: 1.2 });
  group.add(line(path, outline, 44), line(path, core, 45), line(path, flow, 46));
  if (from.distanceTo(path[0]) > 0.8) group.add(line([from, path[0]], connector, 45));
  const end = path[path.length - 1];
  if (to.distanceTo(end) > 0.8) group.add(line([end, to], connector, 45));
  return { group, materials: [outline, core, flow, connector], flow, mid: pointAtHalf(path) };
}
