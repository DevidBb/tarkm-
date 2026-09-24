// Low-poly models for the city layer, built from boxes, cylinders and extruded side profiles.
// Real proportions in meters. Vehicles: length along +X (front), width along Z, wheels on y = 0.
// Wall-mounted props (balconies, AC units...) stick out along +Z. Street props face the road along +X.
// Every geometry carries vertex colors; parts painted per instance (car bodies, tree crowns) are light
// so the instance color multiplies into the real paint color.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { mergeGeometries } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js/+esm';

function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function place(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

// Box with its bottom face at y.
export const box = (w, h, d, x, y, z, color, ry = 0, rx = 0, rz = 0) => place(paint(new THREE.BoxGeometry(w, h, d), color), x, y + h / 2, z, rx, ry, rz);
// Vertical cylinder with its bottom at y.
export const cyl = (rTop, rBottom, h, seg, x, y, z, color, rx = 0, rz = 0) => place(paint(new THREE.CylinderGeometry(rTop, rBottom, h, seg), color), x, y + h / 2, z, rx, 0, rz);
// Cylinder lying along Z (wheels).
const wheel = (r, w, x, z, color = '#171717') => place(paint(new THREE.CylinderGeometry(r, r, w, 12), color), x, r, z, Math.PI / 2);

// Side profile (x, y) extruded across the width (Z), centered on z = 0.
export function profile(points, width, color) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -width / 2);
  return paint(g, color);
}

export const merge = (list) => {
  const g = mergeGeometries(list, false);
  g.computeBoundingSphere();
  return g;
};

// ---------------------------------------------------------------- vehicles
// body: painted per instance; glass + details: fixed colors; decal: livery (ambulance, police, taxi...).
function vehicle({ length, width, height, body, glass, wheels, details = [], decal = [] }) {
  return {
    length,
    width,
    height,
    body: merge([profile(body, width, '#ffffff'), box(length * 0.98, 0.18, width + 0.02, 0, wheels.clearance, 0, '#3a3a3a')]),
    glass: merge([profile(glass, width + 0.04, '#1b2327')]),
    detail: merge([...wheels.list, ...details]),
    decal: decal.length ? merge(decal) : null,
  };
}

const wheels4 = (r, xf, xr, zw) => ({ clearance: r * 0.55, list: [wheel(r, 0.22, xf, zw), wheel(r, 0.22, xf, -zw), wheel(r, 0.22, xr, zw), wheel(r, 0.22, xr, -zw)] });
const lights = (xFront, xRear, y, z) => [
  box(0.05, 0.14, 0.32, xFront, y, z, '#e7e2cd'), box(0.05, 0.14, 0.32, xFront, y, -z, '#e7e2cd'),
  box(0.05, 0.14, 0.3, xRear, y, z, '#8c1d17'), box(0.05, 0.14, 0.3, xRear, y, -z, '#8c1d17'),
];

function sedan() {
  return vehicle({
    length: 4.2, width: 1.64, height: 1.4,
    body: [[-2.08, 0.32], [2.05, 0.32], [2.1, 0.55], [2.0, 0.78], [1.0, 0.86], [0.48, 1.38], [-0.9, 1.4], [-1.5, 0.9], [-2.06, 0.86], [-2.1, 0.55]],
    glass: [[-1.53, 0.87], [1.03, 0.85], [0.52, 1.34], [-0.9, 1.35]],
    wheels: wheels4(0.3, 1.28, -1.26, 0.72),
    details: [...lights(2.09, -2.1, 0.58, 0.56), box(0.12, 0.16, 1.66, 2.08, 0.34, 0, '#2a2a2a'), box(0.12, 0.16, 1.66, -2.1, 0.34, 0, '#2a2a2a')],
  });
}

function hatch() {
  return vehicle({
    length: 4.0, width: 1.66, height: 1.4,
    body: [[-1.98, 0.32], [2.0, 0.32], [2.04, 0.56], [1.94, 0.76], [0.95, 0.86], [0.42, 1.38], [-1.45, 1.41], [-1.98, 0.95], [-2.02, 0.55]],
    glass: [[-2.0, 0.93], [0.98, 0.84], [0.46, 1.36], [-1.46, 1.37]],
    wheels: wheels4(0.3, 1.25, -1.22, 0.73),
    details: [...lights(2.03, -2.02, 0.6, 0.56), box(0.12, 0.16, 1.68, 2.03, 0.34, 0, '#2a2a2a')],
  });
}

function suv() {
  return vehicle({
    length: 3.9, width: 1.72, height: 1.66,
    body: [[-1.9, 0.42], [1.9, 0.42], [1.95, 0.72], [1.85, 0.98], [0.85, 1.04], [0.55, 1.62], [-1.85, 1.66], [-1.92, 1.02]],
    glass: [[-1.84, 1.04], [0.89, 1.02], [0.58, 1.59], [-1.84, 1.6]],
    wheels: wheels4(0.36, 1.2, -1.2, 0.76),
    details: [...lights(1.94, -1.92, 0.78, 0.6), box(0.5, 0.5, 0.2, -2.0, 0.8, 0, '#1d1d1d'), box(0.14, 0.2, 1.74, 1.96, 0.4, 0, '#262626')],
  });
}

function van(decal = []) {
  return vehicle({
    length: 5.5, width: 2.0, height: 2.3,
    body: [[-2.75, 0.4], [2.7, 0.4], [2.78, 0.85], [2.55, 1.05], [2.0, 1.2], [1.55, 2.25], [-2.75, 2.3]],
    glass: [[0.95, 1.2], [2.04, 1.19], [1.58, 2.2], [0.95, 2.2]],
    wheels: wheels4(0.36, 1.85, -1.55, 0.84),
    details: [...lights(2.76, -2.76, 0.75, 0.72), box(0.15, 0.2, 2.02, 2.75, 0.4, 0, '#2a2a2a')],
    decal,
  });
}

function bus() {
  return vehicle({
    length: 11.4, width: 2.5, height: 3.0,
    body: [[-5.7, 0.35], [5.7, 0.35], [5.75, 1.0], [5.7, 3.0], [-5.7, 3.0], [-5.75, 1.0]],
    glass: [[-5.4, 1.25], [5.77, 1.1], [5.77, 2.8], [-5.4, 2.75]],
    wheels: wheels4(0.5, 3.9, -2.6, 1.1),
    details: [...lights(5.76, -5.76, 0.8, 0.95), box(0.1, 2.0, 1.0, -1.0, 0.4, 1.26, '#2b3033'), box(0.1, 2.0, 1.0, 2.6, 0.4, 1.26, '#2b3033')],
  });
}

function truck() {
  const cargo = [box(4.4, 0.25, 2.4, -1.4, 0.95, 0, '#3b3d38'), box(4.4, 1.7, 2.4, -1.4, 1.2, 0, '#5d6448')];
  return vehicle({
    length: 7.4, width: 2.4, height: 2.9,
    body: [[0.9, 0.85], [3.6, 0.85], [3.7, 1.45], [3.2, 1.7], [2.8, 2.5], [1.1, 2.55], [0.9, 2.4]],
    glass: [[2.4, 1.72], [3.23, 1.71], [2.83, 2.46], [2.4, 2.47]],
    wheels: { clearance: 0.55, list: [wheel(0.48, 0.3, 2.8, 1.0), wheel(0.48, 0.3, 2.8, -1.0), wheel(0.48, 0.3, -1.6, 1.0), wheel(0.48, 0.3, -1.6, -1.0), wheel(0.48, 0.3, -2.9, 1.0), wheel(0.48, 0.3, -2.9, -1.0)] },
    details: [box(7.2, 0.3, 1.2, -0.1, 0.62, 0, '#1f201e'), ...cargo, ...lights(3.69, -3.62, 1.0, 0.9)],
  });
}

function patrol() {
  return vehicle({
    length: 6.2, width: 2.5, height: 2.75,
    body: [[-3.1, 0.6], [3.05, 0.6], [3.15, 1.3], [2.5, 1.55], [2.05, 2.65], [-3.1, 2.75]],
    glass: [[1.5, 1.6], [2.53, 1.56], [2.1, 2.55], [1.5, 2.55]],
    wheels: wheels4(0.55, 2.0, -2.0, 1.05),
    details: [box(0.2, 0.6, 2.2, 3.2, 0.55, 0, '#1c1d1b'), ...lights(3.14, -3.12, 1.05, 0.9)],
    decal: [box(6.0, 0.28, 2.54, -0.1, 1.45, 0, '#23458f'), box(0.28, 0.16, 1.3, 0.8, 2.74, 0, '#1e5bd6'), box(0.28, 0.16, 0.5, 0.8, 2.74, 0.3, '#c21f1f')],
  });
}

export function vehicleModels() {
  const s = sedan();
  return {
    sedan: s,
    hatch: hatch(),
    suv: suv(),
    van: van(),
    bus: bus(),
    truck: truck(),
    patrol: patrol(),
    ambulance: van([box(5.2, 0.24, 2.04, -0.25, 1.2, 0, '#c42a22'), box(0.3, 0.16, 1.2, 1.3, 2.28, 0, '#2f6fe0'), box(1.0, 0.5, 2.04, -1.9, 1.55, 0, '#c42a22')]),
    postvan: van([box(5.2, 0.38, 2.04, -0.25, 1.4, 0, '#1f4fa8')]),
    police: { ...sedan(), decal: merge([box(4.0, 0.14, 1.68, 0, 0.6, 0, '#1f4fa8'), box(0.26, 0.14, 1.1, -0.2, 1.39, 0, '#2d63d8'), box(0.26, 0.14, 0.35, -0.2, 1.39, 0.36, '#c21f1f')]) },
    taxi: { ...hatch(), decal: merge([box(0.3, 0.2, 0.55, -0.4, 1.4, 0, '#e2b81c'), ...[-1.2, -0.6, 0, 0.6].flatMap((x) => [box(0.28, 0.12, 1.7, x, 0.95, 0, '#151515')])]) },
    farBox: merge([box(1, 1, 1, 0, 0, 0, '#ffffff')]),
  };
}

// ---------------------------------------------------------------- street props
export function propModels() {
  const metal = '#6f726e';
  const dark = '#2f312f';
  const concrete = '#9a988f';
  return {
    lamp: merge([cyl(0.07, 0.11, 8.2, 6, 0, 0, 0, metal), box(1.9, 0.08, 0.08, 0.95, 8.0, 0, metal), box(0.7, 0.18, 0.3, 1.75, 7.8, 0, '#3b3d3b'), box(0.5, 0.02, 0.2, 1.75, 7.78, 0, '#d9d3b3')]),
    trafficLight: merge([
      cyl(0.07, 0.08, 3.4, 6, 0, 0, 0, '#3c3e3c'), box(0.34, 1.0, 0.3, 0, 2.55, 0, '#181a19'),
      ...[1, -1].flatMap((side) => [box(0.02, 0.2, 0.2, side * 0.18, 3.25, 0, '#b0261c'), box(0.02, 0.2, 0.2, side * 0.18, 2.95, 0, '#b58b1e'), box(0.02, 0.2, 0.2, side * 0.18, 2.65, 0, '#2f8a3c')]),
    ]),
    signNoEntry: merge([cyl(0.035, 0.035, 2.6, 5, 0, 0, 0, '#8a8c88'), place(paint(new THREE.CylinderGeometry(0.35, 0.35, 0.03, 16), '#b3261e'), 0.03, 2.5, 0, 0, 0, Math.PI / 2), box(0.02, 0.1, 0.46, 0.05, 2.45, 0, '#f2f2ee')]),
    signParking: merge([cyl(0.035, 0.035, 2.6, 5, 0, 0, 0, '#8a8c88'), box(0.03, 0.6, 0.6, 0.03, 2.2, 0, '#2a4f9a'), box(0.02, 0.4, 0.08, 0.05, 2.3, -0.1, '#f2f2ee'), box(0.02, 0.2, 0.2, 0.05, 2.5, 0.02, '#f2f2ee')]),
    signWarning: merge([cyl(0.035, 0.035, 2.4, 5, 0, 0, 0, '#8a8c88'), place(paint(new THREE.CylinderGeometry(0.46, 0.46, 0.03, 3), '#b3261e'), 0.03, 2.55, 0, 0, 0, Math.PI / 2), place(paint(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 3), '#f2f2ee'), 0.05, 2.55, 0, 0, 0, Math.PI / 2)]),
    signMines: merge([cyl(0.04, 0.04, 1.5, 5, 0, 0, 0, '#5a4a36'), box(0.03, 0.45, 0.7, 0.03, 1.1, 0, '#b3261e'), box(0.02, 0.33, 0.58, 0.05, 1.16, 0, '#f2f2ee')]),
    busStop: merge([
      box(4.2, 0.12, 1.8, 0, 2.6, 0, '#5f6a6d'), box(4.0, 2.2, 0.06, 0, 0.35, -0.85, '#6e8388'),
      box(0.06, 2.2, 1.6, -2.0, 0.35, 0, '#6e8388'), box(0.06, 2.2, 1.6, 2.0, 0.35, 0, '#6e8388'),
      cyl(0.05, 0.05, 2.6, 6, -2.05, 0, 0.85, dark), cyl(0.05, 0.05, 2.6, 6, 2.05, 0, 0.85, dark),
      box(2.6, 0.08, 0.45, 0, 0.45, -0.5, '#6b5237'), cyl(0.04, 0.04, 2.8, 5, 2.6, 0, 0.9, '#8a8c88'), box(0.5, 0.35, 0.03, 2.6, 2.4, 0.92, '#2a4f9a'),
    ]),
    trash: merge([box(1.45, 1.05, 1.1, 0, 0.15, 0, '#ffffff'), box(1.5, 0.08, 1.15, 0, 1.2, 0, '#b9b9b9'), cyl(0.07, 0.07, 0.15, 6, 0.6, 0, 0.45, '#111'), cyl(0.07, 0.07, 0.15, 6, -0.6, 0, -0.45, '#111')]),
    urn: merge([cyl(0.26, 0.2, 0.75, 8, 0, 0, 0, '#8d8b84')]),
    bollard: merge([cyl(0.08, 0.09, 0.9, 8, 0, 0, 0, '#50524f'), cyl(0.085, 0.085, 0.1, 8, 0, 0.7, 0, '#c9a43a')]),
    fbsBlock: merge([box(2.4, 0.6, 0.6, 0, 0, 0, '#8f8d86')]),
    jersey: merge([profile([[-1.5, 0], [1.5, 0], [1.5, 0.8], [-1.5, 0.8]], 0.3, '#a3a197'), profile([[-1.5, 0], [1.5, 0], [1.5, 0.2], [-1.5, 0.2]], 0.62, '#9a988e')]),
    manhole: merge([cyl(0.42, 0.42, 0.02, 12, 0, 0, 0, '#51514c'), cyl(0.35, 0.35, 0.035, 12, 0, 0, 0, '#2e2f2d')]),
    drain: merge([box(0.85, 0.03, 0.4, 0, 0, 0, '#4d4d49'), ...[-0.3, -0.15, 0, 0.15, 0.3].map((x) => box(0.05, 0.04, 0.32, x, 0, 0, '#121212'))]),
    pothole: merge([cyl(0.8, 0.7, 0.015, 7, 0, 0, 0, '#262725'), box(1.6, 0.02, 0.07, 0.9, 0, 0.2, '#262725', 0.4), box(1.2, 0.02, 0.06, -0.8, 0, -0.3, '#262725', -0.7)]),
    crack: merge([box(2.2, 0.015, 0.05, 0, 0, 0, '#2a2b29', 0.2), box(1.4, 0.015, 0.05, 1.5, 0, 0.35, '#2a2b29', -0.5), box(1.1, 0.015, 0.05, -1.4, 0, -0.2, '#2a2b29', 0.9)]),
    billboardFrame: merge([cyl(0.16, 0.2, 5.2, 8, 0, 0, 1.9, '#4a4c4a'), cyl(0.16, 0.2, 5.2, 8, 0, 0, -1.9, '#4a4c4a'), box(0.3, 3.3, 6.5, -0.05, 4.4, 0, '#3a3b3a')]),
    fenceConcrete: merge([box(2.5, 2.2, 0.14, 0, 0, 0, '#9b988e'), box(0.3, 2.35, 0.3, -1.25, 0, 0, '#8b887f')]),
    fenceMetal: merge([box(2.5, 2.0, 0.05, 0, 0, 0, '#6e7a70'), box(0.1, 2.2, 0.1, -1.25, 0, 0, '#4a4f4a')]),
    treeTrunk: merge([cyl(0.12, 0.2, 3.2, 6, 0, 0, 0, '#4a3b2b')]),
    treeCrown: merge([place(paint(new THREE.IcosahedronGeometry(2.4, 0), '#ffffff'), 0, 4.6, 0)]),
    curb: merge([box(1, 0.16, 0.3, 0, 0, 0, '#a19e96')]),
    marking: merge([box(1, 0.02, 0.15, 0, 0, 0, '#dcd9cc')]),
    stripe: merge([box(0.5, 0.02, 1, 0, 0, 0, '#dcd9cc')]),
    sandbags: sandbagNest(),
    barrier: merge([box(2.2, 2.5, 2.2, -3.5, 0, 0, '#c9c3b1'), box(2.25, 0.5, 2.25, -3.5, 1.3, 0, '#39454a'), cyl(0.12, 0.12, 1.1, 6, -2.2, 0, 0, '#3c3e3c'),
      ...Array.from({ length: 6 }, (_, i) => box(0.6, 0.12, 0.12, -1.6 + i * 0.6, 1.0, 0, i % 2 ? '#f0efe8' : '#b3261e'))]),
    roofVent: merge([box(1.2, 1.0, 1.2, 0, 0, 0, '#7a7b76'), box(1.45, 0.1, 1.45, 0, 1.0, 0, '#5c5d59')]),
    roofMachine: merge([box(3.4, 2.6, 3.2, 0, 0, 0, '#8e8b83'), box(1.0, 2.0, 0.05, 0.6, 0, 1.61, '#4d4a45'), box(3.6, 0.15, 3.4, 0, 2.6, 0, '#6f6d66')]),
    roofAC: merge([box(1.3, 0.9, 0.85, 0, 0, 0, '#b8bab6'), cyl(0.3, 0.3, 0.05, 10, 0.2, 0.9, 0, '#303130')]),
    antenna: merge([cyl(0.03, 0.04, 4.5, 5, 0, 0, 0, '#6d6d6a'), box(1.4, 0.03, 0.03, 0, 3.8, 0, '#6d6d6a'), box(1.0, 0.03, 0.03, 0, 3.2, 0, '#6d6d6a', Math.PI / 2)]),
    chimney: merge([box(0.8, 1.6, 0.8, 0, 0, 0, '#8a4b37'), box(0.95, 0.12, 0.95, 0, 1.6, 0, '#5b3326')]),
    balconyOpen: merge([box(2.7, 0.14, 1.05, 0, 0, 0.52, '#9a988f'), box(2.7, 1.0, 0.05, 0, 0.14, 1.03, '#74766f'), box(0.05, 1.0, 1.0, -1.33, 0.14, 0.52, '#74766f'), box(0.05, 1.0, 1.0, 1.33, 0.14, 0.52, '#74766f')]),
    balconyGlazed: merge([box(2.7, 0.14, 1.05, 0, 0, 0.52, '#9a988f'), box(2.7, 1.0, 0.06, 0, 0.14, 1.03, '#cfcac0'), box(2.64, 1.35, 0.04, 0, 1.14, 1.02, '#34444a'), box(2.7, 0.1, 1.06, 0, 2.49, 0.53, '#d8d4c8'), box(0.06, 2.35, 1.0, -1.33, 0.14, 0.52, '#cfcac0'), box(0.06, 2.35, 1.0, 1.33, 0.14, 0.52, '#cfcac0')]),
    acUnit: merge([box(0.85, 0.55, 0.3, 0, 0, 0.16, '#d7d8d3'), place(paint(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 10), '#4b4c4a'), 0.12, 0.28, 0.32, Math.PI / 2)]),
    drainpipe: merge([cyl(0.07, 0.07, 1, 6, 0, 0, 0.14, '#7b7e7a')]),
    fireEscape: merge([
      box(0.05, 3.1, 0.05, -0.3, 0, 0.3, '#3d3f3c'), box(0.05, 3.1, 0.05, 0.3, 0, 0.3, '#3d3f3c'),
      ...Array.from({ length: 9 }, (_, i) => box(0.6, 0.03, 0.03, 0, 0.3 + i * 0.32, 0.3, '#3d3f3c')),
      box(1.6, 0.05, 0.95, 0.9, 0, 0.5, '#3d3f3c'), box(1.6, 0.9, 0.03, 0.9, 0.05, 0.97, '#3d3f3c'),
    ]),
    entrance: merge([box(2.6, 0.14, 1.4, 0, 2.55, 0.7, '#8e8c85'), box(1.1, 2.2, 0.1, 0, 0, 0.05, '#4a3f35'), box(2.2, 0.15, 1.1, 0, 0, 0.55, '#7d7b75'), box(0.25, 0.12, 0.12, 0.8, 2.3, 0.1, '#d9d3b3')]),
    signBoard: merge([box(1, 1, 0.22, 0, 0, 0.11, '#2b2c2b')]),
    gun: merge([box(0.08, 0.8, 0.08, 0, 0, 0, '#2c2e2c'), box(1.3, 0.1, 0.1, 0.4, 0.8, 0, '#2c2e2c'), box(0.4, 0.3, 0.3, -0.1, 0.72, 0, '#3a3d38')]),
  };
}

function sandbagNest() {
  const parts = [];
  for (let layer = 0; layer < 3; layer += 1) {
    for (let i = 0; i < 12; i += 1) {
      const a = -Math.PI * 0.85 + (i / 11) * Math.PI * 1.7 + (layer % 2) * 0.12;
      const r = 1.5;
      const tone = ['#8b7b5c', '#7f7052', '#96866a'][(i + layer) % 3];
      parts.push(box(0.62, 0.26, 0.36, Math.cos(a) * r, layer * 0.26, Math.sin(a) * r, tone, -a + Math.PI / 2));
    }
  }
  return merge(parts);
}
