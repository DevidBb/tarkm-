// Coordinate systems
// - Game: Unity world meters, left-handed, Y up (what tarkov.dev data and EFT screenshot names use).
// - Scene: three.js, right-handed, Y up. sceneX = -gameX, sceneZ = gameZ, sceneY = gameY * VERTICAL_EXAGGERATION.
//   Mirroring X converts handedness, and makes the top-down view match the tarkov.dev 2D map.
// The Streets SVG spans bounds.topLeft (x=323, z=-295) .. bounds.bottomRight (x=-280, z=532).
// Heights are true scale (1:1) so the 3D buildings, cars and street furniture keep real proportions.

export const VERTICAL_EXAGGERATION = 1;

export const FLOOR_ORDER = ['UNDERGROUND', 'GROUND', '1F', '2F', '3F', '4F', '5F'];

// Visual plane height of each floor, in game meters (display only - not game data).
export const FLOOR_DISPLAY_Y = { UNDERGROUND: -9, GROUND: -1, '1F': 3, '2F': 10, '3F': 15, '4F': 20, '5F': 25 };

// floors / groundFloor: optional. A floor with `displayY` (Interchange) is drawn at that height; others use FLOOR_DISPLAY_Y.
export function createProjection(map, floors = null, groundFloor = 'GROUND') {
  const floorY = (floorId) => {
    const f = floors ? floors.find((x) => x.id === floorId) : null;
    return (f && f.displayY != null ? f.displayY : FLOOR_DISPLAY_Y[floorId]) * VERTICAL_EXAGGERATION;
  };
  const { topLeft, bottomRight } = map.bounds;
  const sceneLeft = -topLeft.x;
  const sceneRight = -bottomRight.x;
  const sceneTop = topLeft.z;
  const sceneBottom = bottomRight.z;
  const svgScaleX = (sceneRight - sceneLeft) / map.svg.width;
  const svgScaleZ = (sceneBottom - sceneTop) / map.svg.height;
  // Maps drawn with coordinateRotation 90 (Factory): SVG x runs along game z, SVG y along game x (map.svgAxes).
  // Other maps keep the plain mapping above and have no svgToScene.
  let rotated = null;
  if (map.svgAxes && map.svgAxes.u.axis === 'z') {
    const { u, v } = map.svgAxes;
    const ku = (u.to - u.from) / map.svg.width; // game z per SVG x
    const kv = (v.to - v.from) / map.svg.height; // game x per SVG y
    rotated = {
      svgToScene: (p) => ({ x: -(v.from + p.y * kv), z: u.from + p.x * ku }),
      sceneToSvg: (p) => ({ x: (p.z - u.from) / ku, y: (-p.x - v.from) / kv }),
      svgUnit: (Math.abs(ku) + Math.abs(kv)) / 2,
    };
  }
  return {
    ...(rotated || {}),
    sceneLeft, sceneTop, svgScaleX, svgScaleZ,
    width: sceneRight - sceneLeft,
    depth: sceneBottom - sceneTop,
    center: { x: (sceneLeft + sceneRight) / 2, z: (sceneTop + sceneBottom) / 2 },
    gameToScene(p, fallbackY = 0) {
      const y = p.y == null ? fallbackY : p.y;
      return { x: -p.x, y: y * VERTICAL_EXAGGERATION, z: p.z };
    },
    floorPlaneY: floorY,
    groundY: floorY(groundFloor),
    isInside(p, margin = 5) {
      const minX = Math.min(topLeft.x, bottomRight.x) - margin;
      const maxX = Math.max(topLeft.x, bottomRight.x) + margin;
      const minZ = Math.min(topLeft.z, bottomRight.z) - margin;
      const maxZ = Math.max(topLeft.z, bottomRight.z) + margin;
      return p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ;
    },
  };
}

// Height band -> floor id. 1F shares the ground band (tarkov.dev has no separate height range for it).
export function floorForY(floors, y) {
  if (y == null || !Number.isFinite(y)) return null;
  for (const f of floors) {
    if (f.sharesHeightWith) continue;
    if ((f.minY == null || y >= f.minY) && (f.maxY == null || y < f.maxY)) return f.id;
  }
  return null;
}

export function bandOf(floors, floorId) {
  const f = floors.find((x) => x.id === floorId);
  return f && f.sharesHeightWith ? f.sharesHeightWith : floorId;
}

export function sameBand(floors, a, b) {
  if (!a || !b) return false;
  return bandOf(floors, a) === bandOf(floors, b);
}

// Straight-line distance in game meters. Uses height only when both points have it.
export function distanceBetween(a, b) {
  const is3d = a.y != null && b.y != null;
  const dy = is3d ? a.y - b.y : 0;
  return { meters: Math.hypot(a.x - b.x, dy, a.z - b.z), is3d };
}

export function formatMeters(m) {
  if (m < 10) return `${m.toFixed(1)} м`;
  return `${Math.round(m)} м`;
}

export function formatCoord(v) {
  return v == null ? '—' : v.toFixed(1);
}
