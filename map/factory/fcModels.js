// Low-poly props of the Factory model (same conventions as map/city/models.js: meters, vertex colors, bottom at y = 0,
// length along +X). Placed at tarkov.dev label positions (Heli Crash, Forklifts, Med Tent, Blue Containers, Boilers...);
// their shapes are simplified.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { box, cyl, merge } from '../city/models.js';

function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
// cylinder lying along X
const hcyl = (r, len, x, y, z, color, seg = 14) => {
  const g = paint(new THREE.CylinderGeometry(r, r, len, seg), color);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
};

export function factoryModels() {
  return {
    // crashed transport helicopter: fuselage on its side, broken tail boom, bent blades
    heli: merge([
      box(7.2, 2.4, 2.6, 0, 0, 0, '#4d5a44', 0, 0, 0.18),
      box(2.2, 1.6, 2.4, 4.3, 0.2, 0, '#46523e', 0, 0, 0.1),
      box(1.2, 1.0, 2.0, 5.6, 0.5, 0, '#27302a', 0, 0, 0.1),
      box(5.6, 0.8, 0.8, -6.0, 0.9, 0.6, '#4d5a44', 0.25, 0, 0.12),
      box(0.3, 2.2, 1.4, -8.6, 1.0, 1.2, '#46523e', 0.25),
      box(8.5, 0.12, 0.5, 0.8, 2.7, 0, '#262626', 0.5, 0, 0.25),
      box(7.0, 0.12, 0.5, -0.5, 2.1, 1.0, '#262626', -0.9, 0.2, 0.3),
      box(1.0, 0.8, 1.0, 0.5, 2.3, 0, '#2c302b'),
      box(3.0, 0.6, 1.8, -1.0, 0, 2.4, '#3a3a36', 0.4),
    ]),
    forklift: merge([
      box(2.2, 1.0, 1.2, 0, 0.3, 0, '#d7a52a'),
      box(1.0, 0.9, 1.2, -0.6, 1.3, 0, '#2a2c2b'),
      box(0.06, 1.2, 0.06, -0.1, 1.3, 0.55, '#2a2c2b'), box(0.06, 1.2, 0.06, -0.1, 1.3, -0.55, '#2a2c2b'),
      box(1.2, 0.06, 1.2, -0.6, 2.5, 0, '#2a2c2b'),
      box(0.12, 2.6, 0.9, 1.2, 0.1, 0, '#3a3c3b'),
      box(1.2, 0.06, 0.15, 1.8, 0.12, 0.3, '#3a3c3b'), box(1.2, 0.06, 0.15, 1.8, 0.12, -0.3, '#3a3c3b'),
      cyl(0.32, 0.32, 0.25, 10, 0.7, 0.2, 0.62, '#161616', Math.PI / 2), cyl(0.32, 0.32, 0.25, 10, 0.7, 0.2, -0.62, '#161616', Math.PI / 2),
      cyl(0.26, 0.26, 0.22, 10, -0.8, 0.14, 0.6, '#161616', Math.PI / 2), cyl(0.26, 0.26, 0.22, 10, -0.8, 0.14, -0.6, '#161616', Math.PI / 2),
    ]),
    medTent: merge([
      box(6.0, 0.06, 4.2, 0, 0, 0, '#3f4a38'),
      box(6.0, 2.0, 0.06, 0, 0, 2.1, '#5d6b4c'), box(6.0, 2.0, 0.06, 0, 0, -2.1, '#5d6b4c'),
      box(6.1, 0.08, 2.5, 0, 2.2, 1.05, '#667553', 0, 0.45), box(6.1, 0.08, 2.5, 0, 2.2, -1.05, '#667553', 0, -0.45),
      box(0.06, 0.9, 0.9, 3.02, 1.4, 0, '#e8e4dc'), box(0.07, 0.6, 0.18, 3.05, 1.55, 0, '#c0302a'), box(0.07, 0.18, 0.6, 3.05, 1.55, 0, '#c0302a'),
      box(1.9, 0.5, 0.7, -1.4, 0.2, 1.2, '#2c3a45'), box(1.9, 0.5, 0.7, 1.2, 0.2, -1.2, '#2c3a45'),
    ]),
    blueContainer: merge([
      box(6.06, 2.59, 2.44, 0, 0, 0, '#2d5b8a'),
      ...Array.from({ length: 9 }, (_, i) => box(0.08, 2.4, 2.48, -2.7 + i * 0.68, 0.1, 0, '#244b73')),
      box(0.06, 2.4, 2.3, 3.04, 0.1, 0, '#22476b'),
    ]),
    boiler: merge([hcyl(1.2, 6.5, 0, 1.5, 0, '#8d8f8b'), box(0.5, 1.6, 0.5, 0, 2.6, 0, '#6d6f6b'), box(5.6, 0.3, 1.6, 0, 0, 0, '#4a4b48'), hcyl(1.25, 0.2, 2.8, 1.5, 0, '#b3261e'), hcyl(1.25, 0.2, -2.8, 1.5, 0, '#b3261e')]),
    pump: merge([box(1.6, 1.2, 1.0, 0, 0, 0, '#3c6a8a'), hcyl(0.35, 2.6, 0.8, 0.6, 0, '#6d706c'), box(0.6, 1.8, 0.6, -1.0, 0, 0, '#5a5c58')]),
    pallets: merge([box(1.2, 0.14, 1.0, 0, 0, 0, '#9b7d55'), box(1.2, 0.14, 1.0, 0, 0.14, 0, '#8a6c46'), box(1.2, 0.14, 1.0, 0, 0.28, 0, '#9b7d55'), box(1.0, 0.8, 0.8, 0, 0.42, 0, '#b8a27e')]),
    workbench: merge([box(2.4, 0.08, 1.0, 0, 0.9, 0, '#6b5237'), ...[[-1.1, -0.4], [1.1, -0.4], [-1.1, 0.4], [1.1, 0.4]].map(([x, z]) => box(0.08, 0.9, 0.08, x, 0, z, '#2f312f')), box(0.5, 0.3, 0.3, 0.6, 0.98, 0, '#a3312a')]),
    roofUnit: merge([box(3.4, 1.6, 2.0, 0, 0, 0, '#9fa19b'), cyl(0.55, 0.55, 0.08, 10, -0.8, 1.6, 0, '#3b3c3a'), cyl(0.55, 0.55, 0.08, 10, 0.8, 1.6, 0, '#3b3c3a'), box(3.6, 0.12, 2.2, 0, 1.6, 0, '#7e7f7a')]),
    roofVent: merge([box(1.2, 1.0, 1.2, 0, 0, 0, '#86877f'), box(1.5, 0.1, 1.5, 0, 1.0, 0, '#5f605a'), cyl(0.25, 0.25, 1.2, 8, 0, 1.1, 0, '#6f706a')]),
  };
}
