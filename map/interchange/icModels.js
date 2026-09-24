// Low-poly props of the Interchange model (built like map/city/models.js: boxes, cylinders, vertex colors).
// Loot containers at their tarkov.dev spawn points, dock doors, entrances, doors, trailers, freight wagons,
// conifers and bushes. Parts painted per instance (crowns, dumpsters) are white.

import { box, cyl, merge } from '../city/models.js';

export const CAR_PAINTS = ['#e8e6df', '#e8e6df', '#a9adb0', '#a9adb0', '#5d6165', '#1c1d1f', '#1c1d1f', '#a12b27', '#6b1c21', '#1f3558', '#6f8fa8', '#3e5a3a', '#c9b98f', '#5a3d2b'];
export const CAR_MODELS = ['sedan', 'sedan', 'hatch', 'hatch', 'suv'];

export function interchangeModels() {
  const wheel = (r, w, x, z, rotated = Math.PI / 2) => cyl(r, r, w, 10, x, r - w / 2, z, '#161616', rotated);
  return {
    // loot containers (tarkov.dev container types)
    crate: merge([box(1.2, 0.85, 0.9, 0, 0, 0, '#8a6a42'), box(1.22, 0.08, 0.92, 0, 0.3, 0, '#6d5334'), box(1.22, 0.08, 0.92, 0, 0.62, 0, '#6d5334')]),
    weaponBox: merge([box(1.5, 0.45, 0.55, 0, 0, 0, '#3f4a36'), box(1.52, 0.05, 0.57, 0, 0.44, 0, '#2f372a'), box(0.1, 0.12, 0.3, 0.6, 0.45, 0, '#1f231d'), box(0.1, 0.12, 0.3, -0.6, 0.45, 0, '#1f231d')]),
    ammoBox: merge([box(0.7, 0.35, 0.4, 0, 0, 0, '#5e6b45'), box(0.72, 0.04, 0.42, 0, 0.35, 0, '#4a5537')]),
    toolbox: merge([box(0.6, 0.3, 0.3, 0, 0, 0, '#a3312a'), box(0.35, 0.06, 0.04, 0, 0.3, 0, '#2a2a2a')]),
    suitcase: merge([box(0.75, 0.28, 0.5, 0, 0, 0, '#2b2e30'), box(0.2, 0.05, 0.05, 0, 0.28, 0, '#1a1a1a')]),
    duffle: merge([box(0.8, 0.32, 0.38, 0, 0, 0, '#3d4a3a'), box(0.3, 0.06, 0.06, 0, 0.32, 0, '#222222')]),
    medbag: merge([box(0.45, 0.3, 0.25, 0, 0, 0, '#d8d4cc'), box(0.12, 0.2, 0.02, 0, 0.05, 0.13, '#c0302a')]),
    barrel: merge([cyl(0.3, 0.3, 0.35, 10, 0, 0, 0, '#5d4c36'), cyl(0.31, 0.31, 0.04, 10, 0, 0.35, 0, '#3e3326')]),
    hatch: merge([box(0.9, 0.08, 0.9, 0, 0, 0, '#5a4a33'), box(0.92, 0.03, 0.08, 0, 0.08, 0.2, '#3f3424'), box(0.92, 0.03, 0.08, 0, 0.08, -0.2, '#3f3424')]),

    // loading docks
    pallet: merge([box(1.2, 0.14, 1.0, 0, 0, 0, '#9b7d55'), box(1.0, 0.7, 0.8, 0, 0.14, 0, '#b8a27e'), box(1.02, 0.05, 0.82, 0, 0.5, 0, '#6f8a5a')]),
    // roll-up dock door with frame and bumpers, facing +Z
    dockDoor: merge([
      box(4.4, 0.25, 0.3, 0, 4.5, 0, '#5d605c'), box(0.25, 4.75, 0.3, -2.2, 0, 0, '#5d605c'), box(0.25, 4.75, 0.3, 2.2, 0, 0, '#5d605c'),
      ...Array.from({ length: 9 }, (_, i) => box(4.1, 0.46, 0.08, 0, i * 0.5, 0.05, i % 2 ? '#8d9496' : '#9aa1a3')),
      box(0.6, 0.5, 0.35, -1.6, 0.1, 0.3, '#1b1b1b'), box(0.6, 0.5, 0.35, 1.6, 0.1, 0.3, '#1b1b1b'),
      box(4.6, 0.12, 0.5, 0, 4.9, 0.25, '#d0a92e'),
    ]),
    // glass entrance, 12 m wide, facing +Z: glazing, mullions, canopy on two posts
    entrance: merge([
      box(12, 4.1, 0.12, 0, 0, 0.08, '#2c3b43'),
      ...[-6, -3, 0, 3, 6].map((x) => box(0.16, 4.2, 0.2, x, 0, 0.1, '#6b6f70')),
      box(12.2, 0.18, 0.22, 0, 2.5, 0.12, '#6b6f70'),
      box(12.6, 0.5, 4.4, 0, 4.2, 2.2, '#8c8f8a'), box(12.6, 0.12, 4.4, 0, 4.7, 2.2, '#5f625e'),
      box(0.25, 4.2, 0.25, -6.1, 0, 4.2, '#6b6f70'), box(0.25, 4.2, 0.25, 6.1, 0, 4.2, '#6b6f70'),
    ]),
    // steel door with frame, facing +Z
    doorSingle: merge([box(1.4, 2.5, 0.2, 0, 0, 0, '#4a4c48'), box(1.0, 2.1, 0.06, 0, 0, 0.12, '#6b6f6a'), box(0.12, 0.04, 0.06, 0.35, 1.0, 0.17, '#2a2a2a')]),

    // vehicles without a model in city/models.js: semi-trailer and freight wagon, length along +X
    trailer: merge([
      box(12.2, 2.9, 2.5, -0.4, 1.2, 0, '#c9c6bd'), box(12.2, 0.2, 2.5, -0.4, 1.0, 0, '#3a3b39'),
      wheel(0.48, 0.3, -4.6, 1.0), wheel(0.48, 0.3, -4.6, -1.0), wheel(0.48, 0.3, -5.8, 1.0), wheel(0.48, 0.3, -5.8, -1.0),
      box(0.2, 1.1, 0.2, 4.2, 0, 1.0, '#3a3b39'), box(0.2, 1.1, 0.2, 4.2, 0, -1.0, '#3a3b39'),
    ]),
    wagon: merge([
      box(13.8, 0.6, 2.9, 0, 0.6, 0, '#2a2a28'), box(13.8, 2.8, 3.0, 0, 1.2, 0, '#6a4533'), box(14, 0.25, 3.1, 0, 4.0, 0, '#57392b'),
      ...[-5, -3.6, 3.6, 5].flatMap((x) => [wheel(0.45, 0.2, x, 0.75), wheel(0.45, 0.2, x, -0.75)]),
      box(1.8, 2.2, 0.08, 0, 1.4, 1.52, '#4e3326'), box(1.8, 2.2, 0.08, 0, 1.4, -1.52, '#4e3326'),
    ]),

    // vegetation: crowns are white (color per instance)
    coniferTrunk: merge([cyl(0.14, 0.24, 3, 6, 0, 0, 0, '#4a3b2b')]),
    coniferCrown: merge([cyl(0, 2.6, 5.4, 7, 0, 2.2, 0, '#ffffff'), cyl(0, 2.0, 4.4, 7, 0, 4.9, 0, '#ffffff'), cyl(0, 1.2, 3.2, 7, 0, 7.6, 0, '#ffffff')]),
    bush: merge([cyl(0.7, 1.1, 1.1, 6, 0, 0, 0, '#ffffff'), cyl(0.15, 0.8, 0.6, 6, 0, 1.1, 0, '#ffffff')]),
  };
}
