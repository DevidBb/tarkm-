// Low-poly props of the Customs model (same conventions as map/city/models.js: meters, vertex colors, bottom at y = 0,
// length along +X, "front" facing +Z). Tinted parts are white/grey so a per-instance color can paint them.
// Shapes are simplified.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { box, cyl, merge } from '../city/models.js';

export function customsModels() {
  const ribs = (len, h, d, n, col) => Array.from({ length: n }, (_, i) => box(0.07, h, d + 0.04, -len / 2 + ((i + 0.5) * len) / n, 0.08, 0, col));
  return {
    // 20 ft shipping container (tinted), doors at -X
    container: merge([
      box(6.06, 2.59, 2.44, 0, 0, 0, '#ffffff'),
      ...ribs(5.6, 2.35, 2.44, 14, '#d4d4d4'),
      box(0.06, 2.4, 2.3, -3.04, 0.1, 0, '#c4c4c4'),
      box(0.04, 2.3, 0.05, -3.08, 0.12, 0.3, '#5a5a5a'), box(0.04, 2.3, 0.05, -3.08, 0.12, -0.3, '#5a5a5a'),
      box(6.1, 0.12, 2.48, 0, 0, 0, '#3a3a3a'), box(6.1, 0.1, 2.48, 0, 2.52, 0, '#bdbdbd'),
    ]),
    // site cabin ("бытовка"): tinted body, window, door on +Z side
    cabin: merge([
      box(6.0, 2.5, 2.4, 0, 0.25, 0, '#ffffff'),
      box(6.1, 0.12, 2.5, 0, 2.75, 0, '#6d6d6a'),
      box(1.1, 0.9, 0.05, 1.2, 1.35, 1.21, '#2a3336'), box(1.2, 1.0, 0.03, 1.2, 1.3, 1.2, '#d6d2c6'),
      box(0.9, 2.0, 0.05, -1.8, 0.3, 1.21, '#5b5f5a'),
      box(0.4, 0.25, 0.4, -2.6, 0, 0.8, '#4a4a47'), box(0.4, 0.25, 0.4, 2.6, 0, 0.8, '#4a4a47'),
      box(0.4, 0.25, 0.4, -2.6, 0, -0.8, '#4a4a47'), box(0.4, 0.25, 0.4, 2.6, 0, -0.8, '#4a4a47'),
    ]),
    // metal garage door with frame, 2.8 m, facing +Z (tinted leaf)
    garageDoor: merge([
      box(3.0, 0.2, 0.12, 0, 2.3, 0, '#5f5c55'), box(0.15, 2.4, 0.12, -1.45, 0, 0, '#5f5c55'), box(0.15, 2.4, 0.12, 1.45, 0, 0, '#5f5c55'),
      box(1.35, 2.25, 0.05, -0.68, 0.02, 0.06, '#ffffff'), box(1.35, 2.25, 0.05, 0.68, 0.02, 0.06, '#e6e6e6'),
      box(0.9, 1.9, 0.02, 0.6, 0.1, 0.09, '#dcdcdc'),
      box(0.08, 0.3, 0.06, 0.1, 1.0, 0.1, '#2b2b2b'),
    ]),
    // porch: concrete step, canopy on two posts, facing +Z
    porch: merge([
      box(2.4, 0.35, 1.6, 0, 0, 0.8, '#8e8b83'),
      box(2.6, 0.12, 1.8, 0, 2.7, 0.9, '#5d5a52'),
      cyl(0.05, 0.05, 2.7, 6, -1.15, 0, 1.65, '#3b3d3b'), cyl(0.05, 0.05, 2.7, 6, 1.15, 0, 1.65, '#3b3d3b'),
    ]),
    // plain door facing +Z
    door: merge([box(1.2, 2.3, 0.12, 0, 0, 0, '#4b4a45'), box(0.95, 2.05, 0.05, 0, 0.05, 0.07, '#6d5c48'), box(0.1, 0.04, 0.05, 0.3, 1.0, 0.1, '#222')]),
    chimney: merge([box(0.7, 1.6, 0.7, 0, 0, 0, '#7d4a3a'), box(0.85, 0.12, 0.85, 0, 1.6, 0, '#5a5a56')]),
    drainpipe: merge([cyl(0.06, 0.06, 1, 6, 0, 0, 0, '#6d706c')]),
    // fences, 2.5 m panels along +X
    fenceWood: merge([
      ...Array.from({ length: 12 }, (_, i) => box(0.18, 1.7 + ((i * 37) % 5) * 0.03, 0.03, -1.15 + i * 0.21, 0.05, 0, i % 3 ? '#6e5a44' : '#5e4c39')),
      box(2.5, 0.08, 0.05, 0, 0.45, -0.04, '#4e3f30'), box(2.5, 0.08, 0.05, 0, 1.4, -0.04, '#4e3f30'),
      box(0.12, 1.9, 0.12, -1.25, 0, -0.08, '#3f3328'),
    ]),
    fenceSheet: merge([
      ...Array.from({ length: 13 }, (_, i) => box(0.19, 2.0, 0.035, -1.2 + i * 0.2, 0.1, (i % 2) * 0.03, i % 2 ? '#ffffff' : '#d9d9d9')),
      box(0.09, 2.2, 0.09, -1.25, 0, -0.06, '#4a4a47'),
    ]),
    chainPost: merge([cyl(0.04, 0.04, 2.1, 6, -1.25, 0, 0, '#5c5f5b'), box(2.5, 0.04, 0.04, 0, 2.02, 0, '#5c5f5b'), box(2.5, 0.03, 0.03, 0, 0.1, 0, '#5c5f5b')]),
    // tall grass clump (tinted)
    grass: merge([
      cyl(0, 0.3, 0.8, 5, 0, 0, 0, '#ffffff'), cyl(0, 0.24, 0.62, 4, 0.28, 0, 0.14, '#e8e8e8'), cyl(0, 0.26, 0.7, 4, -0.24, 0, 0.18, '#f2f2f2'),
      cyl(0, 0.22, 0.55, 4, 0.06, 0, -0.28, '#dddddd'), cyl(0, 0.2, 0.5, 4, -0.2, 0, -0.18, '#e4e4e4'),
    ]),
    tires: merge([cyl(0.36, 0.36, 0.25, 10, 0, 0, 0, '#1c1c1c'), cyl(0.36, 0.36, 0.25, 10, 0.05, 0.25, 0.03, '#222222'), cyl(0.36, 0.36, 0.25, 10, -0.03, 0.5, 0, '#1a1a1a'), cyl(0.16, 0.16, 0.76, 8, 0, 0.01, 0, '#0a0a0a')]),
    barrel: merge([cyl(0.3, 0.3, 0.88, 10, 0, 0, 0, '#ffffff'), cyl(0.31, 0.31, 0.04, 10, 0, 0.3, 0, '#cfcfcf'), cyl(0.31, 0.31, 0.04, 10, 0, 0.6, 0, '#cfcfcf')]),
    scrap: merge([box(1.8, 0.4, 1.2, 0, 0, 0, '#5a4636', 0.3), box(1.2, 0.3, 0.8, 0.2, 0.35, 0.1, '#6b6259', -0.4, 0.2), box(2.2, 0.08, 0.2, -0.2, 0.7, 0, '#4d4a45', 1.1, 0, 0.3), cyl(0.12, 0.12, 1.6, 6, 0.6, 0.5, -0.3, '#5e5a52', 1.2)]),
    logs: merge([cyl(0.2, 0.2, 4, 8, 0, 0.2, 0, '#6a5238', Math.PI / 2), cyl(0.2, 0.2, 4, 8, 0, 0.2, 0.4, '#5d4830', Math.PI / 2), cyl(0.2, 0.2, 4, 8, 0, 0.55, 0.2, '#6a5238', Math.PI / 2)]),
    // fuel pump
    pump: merge([box(0.8, 0.2, 0.6, 0, 0, 0, '#7d7a72'), box(0.6, 1.7, 0.4, 0, 0.2, 0, '#c9c3b3'), box(0.62, 0.3, 0.42, 0, 1.6, 0, '#2d5e9e'), box(0.4, 0.3, 0.03, 0, 1.1, 0.21, '#1b1f22')]),
    // bridge railing section, 2 m along +X
    railing: merge([box(0.1, 1.0, 0.1, -1, 0, 0, '#6d706c'), box(2, 0.08, 0.08, 0, 0.95, 0, '#6d706c'), box(2, 0.05, 0.05, 0, 0.5, 0, '#6d706c')]),
    // concrete block barrier on the road side
    fbs: merge([box(2.4, 0.6, 0.6, 0, 0, 0, '#8f8d86')]),
    // telegraph pole with a cross arm
    pole: merge([cyl(0.12, 0.16, 8, 6, 0, 0, 0, '#4e4032'), box(1.6, 0.1, 0.1, 0, 7.4, 0, '#4e4032'), cyl(0.05, 0.05, 0.2, 5, -0.6, 7.5, 0, '#cfcfc6'), cyl(0.05, 0.05, 0.2, 5, 0.6, 7.5, 0, '#cfcfc6')]),
  };
}

// Vertical fuel tank with a conical roof and a ladder (merged geometry, vertex colors), at (x, y, z).
export function tankGeometry(x, y, z, r, h, color = '#b9b8b0') {
  const parts = [
    cyl(r, r, h, 28, x, y, z, color),
    cyl(r * 0.15, r * 1.02, r * 0.28, 28, x, y + h, z, '#8f8e87'),
    cyl(r + 0.05, r + 0.05, 0.25, 28, x, y + h * 0.33, z, '#9a9990'),
    cyl(r + 0.05, r + 0.05, 0.25, 28, x, y + h * 0.66, z, '#9a9990'),
    box(0.5, h + 1.0, 0.1, x + r + 0.15, y, z, '#4a4c48'),
    cyl(r + 0.3, r + 0.3, 0.5, 28, x, y - 0.3, z, '#77746c'),
  ];
  return merge(parts);
}

// A canopy over fuel pumps on four columns: w x d m, eave at h, long side along +X.
export function canopyGeometry(w, d, h) {
  return merge([
    box(w, 0.9, d, 0, h, 0, '#d8d4c8'), box(w + 0.1, 0.25, d + 0.1, 0, h + 0.1, 0, '#b3261e'),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => box(0.45, h, 0.45, sx * (w / 2 - 1.2), 0, sz * (d / 2 - 1.2), '#9e9b92')),
    box(w - 1, 0.25, 1.4, 0, 0, 0, '#8e8b83'),
  ]);
}

export const CONTAINER_COLORS = ['#2d5b8a', '#7a3326', '#3d5e3a', '#8a8c88', '#b45f22', '#5a3d2b', '#1f4a6b', '#6b7a3a', '#9a2a22'];
export const CABIN_COLORS = ['#c9c3b1', '#b8b4a6', '#7d8c6d', '#9aa3a7', '#d8cfb4'];
export const GARAGE_COLORS = ['#5d6b52', '#6b4f3a', '#5c6468', '#7a3b2e', '#4f5d6b', '#77705f'];
export const SHEET_COLORS = ['#5f7056', '#6a6e6a', '#4f6a7a', '#7a5a3e'];
export const GRASS_COLORS = ['#5f7a3c', '#6f8444', '#56703a', '#7d8a4c', '#8a8656', '#687f40'];
export const BARREL_COLORS = ['#2d5b8a', '#7a3326', '#3d5e3a', '#5d4c36', '#8a8c88'];
