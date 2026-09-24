// Factory model, built in the browser from Shebuka's Factory SVG (the same map tarkov.dev shows) and tarkov.dev data.
// - Levels (floor plans of the SVG): TUNNELS (Basement), LEVEL1 (Ground_Floor), LEVEL2 (Second_Floor), LEVEL3 (Third_Floor):
//   floor slabs with the plan drawn on them, outer walls, wall lines of the plan, small cut-outs as columns / blocks,
//   large cut-outs of the upper floors as open voids with railings, machines (Obstacles), concrete ledges, the silos
//   (Building) and stairs (<use> stair symbols) rising to the next level. Loot containers and doors at key locks from data.
// - Outside: the factory hall as one building on the real outline of the ground floor, the tall hall where the third
//   floor catwalks are, lower annexes elsewhere, gates where the tarkov.dev extracts and transits are, roof with
//   skylights and vents, boiler stack, yard, perimeter wall, trucks and forest around.
// Approximate (not in open data): wall and roof heights, facade pattern, stair direction, props outside the walls.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { SVGLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/SVGLoader.js/+esm';
import { MeshBucket, ringWalls, slab, box, ringInfo, color } from '../interchange/icKit.js';
import { rasterMask } from '../interchange/icTextures.js';
import { floorProps } from '../interchange/icStreetDetail.js';
import { InstancedLayer, composeMatrix } from '../city/instancing.js';
import { SegmentGrid, orient, simplifyRing, signedArea, rng, hashString, pick } from '../city/util.js';

export const FACTORY_LEVELS = {
  TUNNELS: { floors: 'Floor-b', walls: null, solids: ['Wall-b'], obstacles: [], ledges: [], stairsUp: ['Connector-Ground_Floor'], stairsDown: [], layer: 'Basement', mezzanine: false },
  LEVEL1: { floors: 'Floor', walls: 'Wall', solids: [], obstacles: ['Obstacles'], ledges: ['Ledge'], silos: 'Building', stairsUp: ['Stairs-up'], stairsDown: ['Stairs-down'], layer: 'Ground_Floor', mezzanine: false },
  LEVEL2: { floors: 'Floor-2', walls: 'Wall-2', solids: [], obstacles: ['Obstacles-2'], ledges: [], stairsUp: ['Stairs-2-up'], stairsDown: [], layer: 'Second_Floor', mezzanine: true },
  LEVEL3: { floors: 'Floor-3', walls: 'Wall-3', solids: [], obstacles: [], ledges: [], stairsUp: [], stairsDown: [], layer: 'Third_Floor', mezzanine: true },
};
const ORDER = ['TUNNELS', 'LEVEL1', 'LEVEL2', 'LEVEL3'];
export const HALL_ROOF = 12.8; // m above level 1: tall hall with the third-floor catwalks (estimate)
export const ANNEX_ROOF = 5.6; // m above level 1: corridors and annexes to the gates (estimate)

const WHITE = color('#ffffff');
const C = {
  wall: color('#b9b2a2'), wallLow: color('#8e877a'), partition: color('#c3bcad'), partitionLow: color('#958e81'),
  block: color('#5d5a54'), blockTop: color('#46443f'), underside: color('#4d4b46'),
  machine: color('#3d4446'), machineTop: color('#5d666a'), machineWarm: color('#6b5a3c'), machineWarmTop: color('#85714c'),
  ledge: color('#8c897f'), ledgeTop: color('#a19d92'), stair: color('#8f8b83'), stairTop: color('#b8b3a8'),
  rail: color('#c9a53a'), railPost: color('#6d6a62'), silo: color('#8b9294'), siloTop: color('#6f777a'), siloBand: color('#b3261e'),
  pit: color('#141515'), tunnelWall: color('#6f6a5f'), tunnelWallLow: color('#4f4b43'),
};
const XLINK = 'http://www.w3.org/1999/xlink';

// <use> stair symbols of a group -> polygons in scene meters.
export function usePolygons(svg, groupId) {
  const g = svg.group(groupId);
  if (!g) return [];
  const loader = new SVGLoader();
  const ser = new XMLSerializer();
  const out = [];
  for (const use of g.querySelectorAll('use')) {
    const href = use.getAttribute('href') || use.getAttributeNS(XLINK, 'href') || use.getAttribute('xlink:href');
    const ref = href ? svg.svgDoc.getElementById(href.replace(/^#/, '')) : null;
    if (!ref) continue;
    const x = Number(use.getAttribute('x')) || 0;
    const y = Number(use.getAttribute('y')) || 0;
    const transform = `${use.getAttribute('transform') || ''} translate(${x} ${y})`.trim();
    const markup = `<svg xmlns="http://www.w3.org/2000/svg"><g transform="${transform}">${ser.serializeToString(ref)}</g></svg>`;
    for (const path of loader.parse(markup).paths) {
      for (const shape of SVGLoader.createShapes(path)) {
        const outer = orient(simplifyRing(shape.getPoints(2).map(svg.toScene), 0.05, 1), true);
        if (outer.length >= 3 && Math.abs(signedArea(outer)) > 0.2) out.push({ outer, holes: [], id: href });
      }
    }
  }
  return out;
}

// Steps rising along the longer side of the stair outline (direction is not in the SVG: rises towards +x / +z).
function stairs(bucket, poly, y0, rise) {
  const info = ringInfo(poly.outer);
  const bx = info.bounds.x1 - info.bounds.x0;
  const bz = info.bounds.z1 - info.bounds.z0;
  const alongX = bx >= bz;
  const long = alongX ? bx : bz;
  const wide = alongX ? bz : bx;
  if (long < 0.8 || wide < 0.4) return 0;
  const steps = Math.max(4, Math.round(Math.abs(rise) / 0.18));
  const tread = long / steps;
  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) * tread;
    const cx = alongX ? info.bounds.x0 + t : info.center.x;
    const cz = alongX ? info.center.z : info.bounds.z0 + t;
    const h = ((i + 1) / steps) * rise;
    box(bucket, cx, y0, cz, alongX ? tread : wide, h, alongX ? wide : tread, 0, C.stair, C.stairTop);
  }
  return 1;
}

// Vertical cylinder into a bucket (silos, boilers, stack).
export function cylinder(bucket, cx, y0, cz, r, h, col, top = col, seg = 20) {
  const y1 = y0 + h;
  for (let i = 0; i < seg; i += 1) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r];
    const p1 = [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r];
    const am = (a0 + a1) / 2;
    const n = [Math.cos(am), 0, Math.sin(am)];
    bucket.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], n, col);
    bucket.tri([cx, y1, cz], [p0[0], y1, p0[1]], [p1[0], y1, p1[1]], [0, 1, 0], top);
  }
}

// Posts + handrail along a ring or polyline (catwalks, mezzanine edges).
function metalRail(bucket, pts, height, closed = true) {
  const count = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.1) continue;
    const ang = Math.atan2(-(b.z - a.z), b.x - a.x);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    box(bucket, mx, height - 0.06, mz, len, 0.06, 0.06, ang, C.rail);
    box(bucket, mx, height * 0.5, mz, len, 0.04, 0.04, ang, C.railPost);
    const posts = Math.max(1, Math.round(len / 1.6));
    for (let k = 0; k <= posts; k += 1) {
      const t = k / posts;
      box(bucket, a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t, 0.06, height, 0.06, 0, C.railPost);
    }
  }
}

// Wall strip of the given thickness along a polyline.
function lineWall(bucket, pts, thick, h, low, high) {
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.05) continue;
    const ang = Math.atan2(-(b.z - a.z), b.x - a.x);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    // two-tone like the resort partitions: darker foot
    box(bucket, mx, 0, mz, len + thick, Math.min(1.1, h), thick, ang, low, low);
    if (h > 1.1) box(bucket, mx, 1.1, mz, len + thick, h - 1.1, thick, ang, high, high);
  }
}

// SVG paths of the plans are filled even-odd, but SVGLoader keeps a same-winding inner ring as a separate shape.
// Rebuild the even-odd result: a polygon inside an odd number of others is a hole of its closest container.
function evenOdd(polys) {
  const info = polys.map((p) => ({ p, area: Math.abs(signedArea(p.outer)), c: ringInfo(p.outer).center }));
  const inRing = (pt, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      if ((a.z > pt.z) !== (b.z > pt.z) && pt.x < ((b.x - a.x) * (pt.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  };
  const out = [];
  for (const it of info) {
    const probe = it.p.outer[0];
    const probeMid = { x: (probe.x + it.c.x) / 2, z: (probe.z + it.c.z) / 2 };
    const containers = info.filter((o) => o !== it && o.area > it.area && inRing(probeMid, o.p.outer) && inRing(it.c, o.p.outer));
    if (containers.length % 2 === 1) {
      containers.sort((a, b) => a.area - b.area);
      containers[0].p.holes.push(orient(it.p.outer, false));
    } else {
      out.push(it.p);
    }
  }
  return out;
}

export function storeyHeight(heights, id) {
  const next = ORDER[ORDER.indexOf(id) + 1];
  if (id === 'LEVEL3') return 3.0;
  return Math.min(4.6, Math.max(2.6, next ? heights[next] - heights[id] : 3.2));
}

export function buildFactoryLevel(ctx, id) {
  const { svg, heights, materials } = ctx;
  const def = FACTORY_LEVELS[id];
  const storey = storeyHeight(heights, id);
  const group = new THREE.Group();
  group.name = id;
  const walls = new THREE.Group();
  group.add(walls);
  const floors = evenOdd(svg.polygons(def.floors, { minArea: 0.5 }));
  const stats = { floorParts: floors.length, storey: +storey.toFixed(2), wallLines: 0, columns: 0, blocks: 0, voids: 0, machines: 0, stairs: 0, silos: 0 };
  const floorB = new MeshBucket(ctx.planUv);
  const under = new MeshBucket();
  const wallB = new MeshBucket();
  const solidB = new MeshBucket();
  const stairB = new MeshBucket();
  const railB = new MeshBucket();
  const tunnel = id === 'TUNNELS';
  const wallHi = tunnel ? C.tunnelWall : C.wall;
  const wallLo = tunnel ? C.tunnelWallLow : C.wallLow;

  for (const poly of floors) {
    slab(floorB, poly, 0.02, WHITE);
    slab(under, poly, -0.3, C.underside, { down: true });
    for (const hole of poly.holes) ringWalls(under, hole, -0.3, 0, C.underside);
    ringWalls(under, poly.outer, -0.3, 0, C.underside);
    if (def.mezzanine) metalRail(railB, poly.outer, 1.1);
    else ringWalls(wallB, poly.outer, 0, storey, wallLo, wallHi);
    for (const hole of poly.holes) {
      const info = ringInfo(hole);
      if (info.area <= 2.5 && info.width > 0.2) {
        // columns of the hall
        ringWalls(wallB, hole, 0, storey, C.block, C.block);
        slab(wallB, { outer: hole, holes: [] }, storey, C.blockTop);
        stats.columns += 1;
      } else if (info.width <= 1.0 && !def.mezzanine) {
        ringWalls(wallB, hole, 0, storey - 0.1, C.partitionLow, C.partition);
        slab(wallB, { outer: hole, holes: [] }, storey - 0.1, C.partition);
      } else if (!def.mezzanine && info.area <= 80) {
        ringWalls(wallB, hole, 0, storey, C.block, C.block);
        slab(wallB, { outer: hole, holes: [] }, storey, C.blockTop);
        stats.blocks += 1;
      } else {
        // open void: railing on mezzanines, low curb on the ground
        if (def.mezzanine) metalRail(railB, hole, 1.1);
        stats.voids += 1;
      }
    }
  }

  // wall lines of the plan (stroked paths)
  if (def.walls) {
    for (const s of svg.strokes(def.walls)) {
      const thick = Math.max(0.22, Math.min(0.5, s.width));
      for (const line of s.lines) {
        lineWall(wallB, line, thick, def.mezzanine ? storey - 0.2 : storey, wallLo, wallHi);
        stats.wallLines += 1;
      }
    }
  }
  // filled solids (tunnels: silo foundations, debris)
  for (const gid of def.solids) {
    for (const poly of svg.polygons(gid, { minArea: 0.3 })) {
      const info = ringInfo(poly.outer);
      const big = info.area > 30;
      ringWalls(solidB, poly.outer, 0, big ? storey : Math.min(storey, 1.2 + info.area * 0.1), C.block, C.block);
      slab(solidB, { outer: poly.outer, holes: [] }, big ? storey : Math.min(storey, 1.2 + info.area * 0.1), C.blockTop);
      stats.blocks += 1;
    }
  }
  // machines and obstacles: height by footprint
  const r = rng(hashString(`factory-machines:${id}`));
  for (const gid of def.obstacles) {
    for (const poly of svg.polygons(gid, { minArea: 0.2 })) {
      const info = ringInfo(poly.outer);
      const h = info.area < 3 ? 1.1 : info.area < 12 ? 1.8 + r() * 0.4 : info.area < 40 ? 2.5 + r() * 0.5 : 3.1;
      const warm = r() < 0.3;
      ringWalls(solidB, poly.outer, 0, h, warm ? C.machineWarm : C.machine, warm ? C.machineWarm : C.machine);
      slab(solidB, { outer: poly.outer, holes: [] }, h, warm ? C.machineWarmTop : C.machineTop);
      stats.machines += 1;
    }
  }
  for (const gid of def.ledges) {
    for (const poly of svg.polygons(gid, { minArea: 0.5 })) {
      ringWalls(solidB, poly.outer, 0, 0.55, C.ledge, C.ledge);
      slab(solidB, poly, 0.55, C.ledgeTop);
    }
  }
  if (def.silos) {
    for (const poly of svg.polygons(def.silos, { minArea: 1 })) {
      const info = ringInfo(poly.outer);
      const rad = Math.min(info.bounds.x1 - info.bounds.x0, info.bounds.z1 - info.bounds.z0) / 2;
      if (rad < 0.8) continue;
      const h = rad > 3.3 ? 11.5 : 7.5;
      cylinder(solidB, info.center.x, 0.55, info.center.z, rad, h, C.silo, C.siloTop);
      cylinder(solidB, info.center.x, 0.55 + h * 0.62, info.center.z, rad + 0.04, 0.35, C.siloBand, C.siloBand);
      stats.silos += 1;
    }
  }
  // stairs up to the next level; openings of stairs going down
  const next = ORDER[ORDER.indexOf(id) + 1];
  const rise = next ? heights[next] - heights[id] : storey;
  for (const gid of def.stairsUp) {
    for (const poly of [...svg.polygons(gid, { minArea: 0.3 }), ...usePolygons(svg, gid)]) stats.stairs += stairs(stairB, poly, 0, rise);
  }
  for (const gid of def.stairsDown) {
    for (const poly of [...svg.polygons(gid, { minArea: 0.3 }), ...usePolygons(svg, gid)]) slab(stairB, poly, 0.05, C.pit);
  }

  const add = (parent, bucket, material, name) => {
    const mesh = bucket.mesh(material);
    if (mesh) {
      mesh.name = name;
      parent.add(mesh);
    }
    return mesh;
  };
  add(group, floorB, materials.plan[id], `${id}-floor`);
  add(group, under, materials.solid, `${id}-underside`);
  add(group, solidB, materials.solid, `${id}-machines`);
  add(group, stairB, materials.solid, `${id}-stairs`);
  add(group, railB, materials.solid, `${id}-railings`);
  add(walls, wallB, materials.solid, `${id}-walls`);

  const layers = [];
  if (id === 'LEVEL1') layers.push(...namedProps(ctx, group));
  const wallSegs = floors.flatMap((p) => [p.outer, ...p.holes]).flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] })));
  const levelProps = floorProps(ctx, id, group, { baseY: heights[id], groundY: 0.02, walls: new SegmentGrid(wallSegs, 16) });
  layers.push(...levelProps.layers);
  stats.containers = levelProps.containers;
  stats.doors = levelProps.doors;
  return { group, walls, layers, stats };
}

// Named places of the tarkov.dev map get their objects: helicopter wreck, forklifts, med tent, blue containers,
// boilers. Positions are the label positions; the objects themselves are simplified.
function namedProps(ctx, parent) {
  const { mapData, fcModels, materials } = ctx;
  const at = (name) => {
    const e = mapData.entities.find((x) => x.type === 'place' && x.name === name);
    return e ? { x: -e.position.x, z: e.position.z } : null;
  };
  const layers = [];
  const L = (name, geometry) => {
    const l = new InstancedLayer(parent, { name, geometry, material: materials.props, maxDistance: 400 });
    layers.push(l);
    return l;
  };
  const put = (label, key, list) => {
    const p = at(label);
    if (!p) return;
    const l = L(key, fcModels[key]);
    for (const [dx, dz, rot, s = 1] of list) l.add(composeMatrix(p.x + dx, 0.02, p.z + dz, rot, s, s, s));
  };
  put('Heli Crash', 'heli', [[0, 0, 0.6]]);
  put('Forklifts', 'forklift', [[-2, 1.5, 0.3], [2.5, -1.5, 2.2], [1, 4, 1.4]]);
  put('Med Tent', 'medTent', [[0, 0, Math.PI / 2]]);
  put('Blue Containers', 'blueContainer', [[0, -3, 0], [0, 0, 0], [0.2, 3, 0.02]]);
  put('Boilers', 'boiler', [[-1.8, 0, 0], [1.8, 0, 0]]);
  put('Pumping Station', 'pump', [[-1.5, 0, 0], [1.5, 0, Math.PI]]);
  put('Wood Room', 'pallets', [[0, 0, 0], [1.6, 1, 0.4], [-1.4, -1.2, 1.1]]);
  put('Glass Hall', 'workbench', [[-2, 0, 0], [2, 0, 0], [0, 2.5, Math.PI / 2]]);
  for (const l of layers) l.build();
  return layers;
}

// ---------------------------------------------------------------- outside

// Greedy rectangles over a boolean grid (row runs merged downwards). Returns [c0, r0, c1, r1) in cells.
function rects(mask, cols, rows) {
  const out = [];
  let active = new Map();
  for (let r = 0; r <= rows; r += 1) {
    const runs = new Map();
    if (r < rows) {
      let c = 0;
      while (c < cols) {
        if (!mask[r * cols + c]) { c += 1; continue; }
        const s = c;
        while (c < cols && mask[r * cols + c]) c += 1;
        runs.set(`${s},${c}`, [s, c]);
      }
    }
    const next = new Map();
    for (const [k, [s, e]] of runs) next.set(k, active.has(k) ? active.get(k) : { s, e, r0: r });
    for (const [k, a] of active) if (!runs.has(k)) out.push([a.s, a.r0, a.e, r]);
    active = next;
  }
  return out;
}

function dilate(mask, cols, rows, radius) {
  const out = new Uint8Array(mask.length);
  const r2 = radius * radius;
  const offs = [];
  for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) if (dx * dx + dy * dy <= r2) offs.push([dx, dy]);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!mask[y * cols + x]) continue;
      for (const [dx, dy] of offs) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < cols && yy < rows) out[yy * cols + xx] = 1;
      }
    }
  }
  return out;
}

const FLOOR_ONLY = '*{fill:none!important;stroke:none!important;filter:none!important}.floor,.floor *{fill:#fff!important}';

export async function buildOutside(ctx) {
  const { svg, heights, materials, mapData, fcModels, icProps, props, cars } = ctx;
  const group = new THREE.Group();
  group.name = 'OUTSIDE';
  const G = heights.LEVEL1;
  const stats = { facadeParts: 0, roofParts: 0, gates: 0, skylights: 0, roofUnits: 0, trees: 0, trucks: 0, fence: 0 };
  const { width: W, height: H } = mapData.map.svg;
  const crop = { x: 0, y: 0, w: W, h: H };
  const px = 2; // raster cells per SVG unit (~0.5 m)
  const floorM = await rasterMask(svg.svgDoc, { layers: ['Ground_Floor'], css: FLOOR_ONLY, crop, pxPerUnit: px });
  const l3M = await rasterMask(svg.svgDoc, { layers: ['Third_Floor'], css: FLOOR_ONLY, crop, pxPerUnit: px });
  const cols = floorM.width;
  const rows = floorM.height;
  const cell = 1 / floorM.scale; // SVG units per cell
  const on = (m, i) => m.data[i * 4] > 128 && m.data[i * 4 + 3] > 128;
  const floor = new Uint8Array(cols * rows);
  const l3 = new Uint8Array(cols * rows);
  for (let i = 0; i < cols * rows; i += 1) { floor[i] = on(floorM, i) ? 1 : 0; l3[i] = on(l3M, i) ? 1 : 0; }
  // close tiny gaps of the plan (door lines drawn as gaps)
  const hall = dilate(l3, cols, rows, Math.round(5 * floorM.scale));
  const tall = new Uint8Array(cols * rows);
  for (let i = 0; i < tall.length; i += 1) tall[i] = floor[i] && hall[i] ? 1 : 0;

  // gates: tarkov.dev extracts and transits on the ground floor, opening in the facade within 3.2 m
  const gatePts = mapData.entities
    .filter((e) => (e.type === 'extract' || e.type === 'transit') && e.floor === 'LEVEL1')
    .map((e) => ({ scene: { x: -e.position.x, z: e.position.z }, name: e.name }));
  const cellCenter = (c, r) => svg.toScene({ x: (c + 0.5) * cell, y: (r + 0.5) * cell });
  const nearGate = (p) => gatePts.some((g) => Math.hypot(g.scene.x - p.x, g.scene.z - p.z) < 3.2);

  const facade = new Uint8Array(cols * rows);
  const gateCells = new Uint8Array(cols * rows);
  const step = new Uint8Array(cols * rows); // tall cells next to the low roof: wall between the roofs
  const inside = (m, c, r) => c >= 0 && r >= 0 && c < cols && r < rows && m[r * cols + c];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (!floor[i]) continue;
      const edge = !inside(floor, c - 1, r) || !inside(floor, c + 1, r) || !inside(floor, c, r - 1) || !inside(floor, c, r + 1);
      if (edge) {
        if (nearGate(cellCenter(c, r))) gateCells[i] = 1;
        else facade[i] = 1;
      }
      if (tall[i] && (!inside(tall, c - 1, r) || !inside(tall, c + 1, r) || !inside(tall, c, r - 1) || !inside(tall, c, r + 1))) step[i] = 1;
    }
  }
  // svg rect -> scene axis-aligned box
  const sceneRect = ([c0, r0, c1, r1]) => {
    const a = svg.toScene({ x: c0 * cell, y: r0 * cell });
    const b = svg.toScene({ x: c1 * cell, y: r1 * cell });
    return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
  };
  const boxRect = (bucket, rc, y0, y1, col, top = col) => {
    const q = sceneRect(rc);
    box(bucket, (q.x0 + q.x1) / 2, y0, (q.z0 + q.z1) / 2, q.x1 - q.x0, y1 - y0, q.z1 - q.z0, 0, col, top);
    return q;
  };

  const facadeHall = new MeshBucket((x, z, y) => [(x + z) / 9, (y - G) / HALL_ROOF]);
  const facadeLow = new MeshBucket((x, z, y) => [(x + z) / 9, (y - G) / ANNEX_ROOF]);
  const roofB = new MeshBucket((x, z) => [x / 12, z / 12]);
  const trim = new MeshBucket();
  const tallOnly = (i) => tall[i];
  const lowOnly = (i) => !tall[i];
  const maskOf = (src, pred) => { const m = new Uint8Array(src.length); for (let i = 0; i < src.length; i += 1) m[i] = src[i] && pred(i) ? 1 : 0; return m; };
  for (const rc of rects(maskOf(facade, tallOnly), cols, rows)) { boxRect(facadeHall, rc, G, G + HALL_ROOF + 0.9, WHITE); stats.facadeParts += 1; }
  for (const rc of rects(maskOf(facade, lowOnly), cols, rows)) { boxRect(facadeLow, rc, G, G + ANNEX_ROOF + 0.7, WHITE); stats.facadeParts += 1; }
  for (const rc of rects(maskOf(step, (i) => !facade[i]), cols, rows)) boxRect(facadeHall, rc, G + ANNEX_ROOF, G + HALL_ROOF + 0.9, WHITE);
  // gates: lintel above a 4.4 m opening, dark opening, sliding door frames
  const gateLow = maskOf(gateCells, lowOnly);
  const gateHigh = maskOf(gateCells, tallOnly);
  for (const rc of rects(gateLow, cols, rows)) { boxRect(facadeLow, rc, G + 4.4, G + ANNEX_ROOF + 0.7, WHITE); boxRect(trim, rc, G, G + 4.4, color('#1b1c1c')); }
  for (const rc of rects(gateHigh, cols, rows)) { boxRect(facadeHall, rc, G + 4.4, G + HALL_ROOF + 0.9, WHITE); boxRect(trim, rc, G, G + 4.4, color('#1b1c1c')); }
  stats.gates = gatePts.length;

  // roofs
  for (const rc of rects(tall, cols, rows)) { boxRect(roofB, rc, G + HALL_ROOF - 0.35, G + HALL_ROOF, WHITE); stats.roofParts += 1; }
  for (const rc of rects(maskOf(floor, lowOnly), cols, rows)) { boxRect(roofB, rc, G + ANNEX_ROOF - 0.35, G + ANNEX_ROOF, WHITE); stats.roofParts += 1; }

  // skylight ridges over the tall hall, every 9 m, clipped to the tall area
  const glassB = new MeshBucket();
  const r = rng(hashString('factory-roof'));
  const tallBox = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (let rr = 0; rr < rows; rr += 1) for (let c = 0; c < cols; c += 1) {
    if (!tall[rr * cols + c]) continue;
    const p = cellCenter(c, rr);
    tallBox.x0 = Math.min(tallBox.x0, p.x); tallBox.x1 = Math.max(tallBox.x1, p.x); tallBox.z0 = Math.min(tallBox.z0, p.z); tallBox.z1 = Math.max(tallBox.z1, p.z);
  }
  const isTallAt = (x, z) => {
    const s = svg.toSvg({ x, z });
    const c = Math.floor(s.x / cell);
    const rr = Math.floor(s.y / cell);
    return inside(tall, c, rr);
  };
  const isFloorAt = (x, z) => {
    const s = svg.toSvg({ x, z });
    return inside(floor, Math.floor(s.x / cell), Math.floor(s.y / cell));
  };
  for (let x = tallBox.x0 + 7; x < tallBox.x1 - 5; x += 13) {
    let z = tallBox.z0 + 3;
    while (z < tallBox.z1 - 3) {
      if (!isTallAt(x, z)) { z += 1; continue; }
      const z0 = z;
      while (z < tallBox.z1 - 2 && isTallAt(x, z) && isTallAt(x, z + 2.5)) z += 1;
      if (z - z0 > 6) {
        box(glassB, x, G + HALL_ROOF, (z0 + z + 2) / 2 - 1, 2.6, 1.1, z - z0 - 2, 0, WHITE);
        box(trim, x, G + HALL_ROOF, (z0 + z + 2) / 2 - 1, 3.0, 0.3, z - z0 - 1.6, 0, color('#5c5f60'));
        stats.skylights += 1;
      }
      z += 2;
    }
  }
  // roof units
  const unitLayer = new InstancedLayer(group, { name: 'roof-units', geometry: fcModels.roofUnit, material: materials.props, maxDistance: 600 });
  const ventLayer = new InstancedLayer(group, { name: 'roof-vents', geometry: fcModels.roofVent, material: materials.props, maxDistance: 600 });
  for (let x = -75; x < 66; x += 7) {
    for (let z = -60; z < 68; z += 7) {
      const px2 = x + (r() - 0.5) * 3;
      const pz2 = z + (r() - 0.5) * 3;
      if (!isFloorAt(px2, pz2) || r() < 0.55) continue;
      const tallHere = isTallAt(px2, pz2);
      if (tallHere && Math.abs(((px2 - tallBox.x0 - 7) % 13 + 13) % 13) < 2.2) continue; // keep off the skylights
      (r() < 0.5 ? unitLayer : ventLayer).add(composeMatrix(px2, G + (tallHere ? HALL_ROOF : ANNEX_ROOF), pz2, r() < 0.5 ? 0 : Math.PI / 2));
      stats.roofUnits += 1;
    }
  }
  // boiler stack next to the Boilers room (tarkov.dev label)
  const boilers = mapData.entities.find((e) => e.type === 'place' && e.name === 'Boilers');
  if (boilers) {
    const bx = -boilers.position.x;
    const bz = boilers.position.z;
    cylinder(trim, bx, G, bz, 1.6, 30, color('#8a6f5f'), color('#3a3431'), 18);
    cylinder(trim, bx, G + 25, bz, 1.65, 1.2, color('#b3261e'), color('#b3261e'), 18);
    cylinder(trim, bx, G + 27.4, bz, 1.65, 1.2, color('#e9e6de'), color('#e9e6de'), 18);
  }

  // ground: concrete yard inside the perimeter, grass outside, perimeter wall with gaps at the gates
  const b = mapData.map.bounds;
  const sx0 = Math.min(-b.topLeft.x, -b.bottomRight.x);
  const sx1 = Math.max(-b.topLeft.x, -b.bottomRight.x);
  const sz0 = Math.min(b.topLeft.z, b.bottomRight.z);
  const sz1 = Math.max(b.topLeft.z, b.bottomRight.z);
  const groundB = new MeshBucket((x, z) => [x / 10, z / 10]);
  const pad = 6;
  box(groundB, (sx0 + sx1) / 2, G - 0.6, (sz0 + sz1) / 2, sx1 - sx0 + pad * 2, 0.55, sz1 - sz0 + pad * 2, 0, color('#8a877f'));
  const grassB = new MeshBucket((x, z) => [x / 14, z / 14]);
  box(grassB, (sx0 + sx1) / 2, G - 0.9, (sz0 + sz1) / 2, sx1 - sx0 + 360, 0.3, sz1 - sz0 + 360, 0, color('#ffffff'));
  const fenceB = new MeshBucket((x, z, y) => [(x + z) / 4, y / 4]);
  const fenceRing = [{ x: sx0 - pad, z: sz0 - pad }, { x: sx1 + pad, z: sz0 - pad }, { x: sx1 + pad, z: sz1 + pad }, { x: sx0 - pad, z: sz1 + pad }];
  for (let i = 0; i < 4; i += 1) {
    const a = fenceRing[i];
    const c2 = fenceRing[(i + 1) % 4];
    const len = Math.hypot(c2.x - a.x, c2.z - a.z);
    for (let s = 0; s < len; s += 3) {
      const t0 = s / len;
      const t1 = Math.min(1, (s + 3) / len);
      const p0 = { x: a.x + (c2.x - a.x) * t0, z: a.z + (c2.z - a.z) * t0 };
      const p1 = { x: a.x + (c2.x - a.x) * t1, z: a.z + (c2.z - a.z) * t1 };
      const m = { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 };
      if (gatePts.some((g) => Math.hypot(g.scene.x - m.x, g.scene.z - m.z) < 9)) continue; // gate gap
      box(fenceB, m.x, G - 0.1, m.z, Math.max(0.25, Math.abs(p1.x - p0.x) + 0.02), 3.2, Math.max(0.25, Math.abs(p1.z - p0.z) + 0.02), 0, WHITE);
      stats.fence += 1;
    }
  }

  // trucks, containers and a few cars outside the gates, lamps along the wall
  const truckLayer = new InstancedLayer(group, { name: 'trucks', geometry: icProps.trailer, material: materials.props, maxDistance: 900 });
  const contLayer = new InstancedLayer(group, { name: 'containers', geometry: fcModels.blueContainer, material: materials.props, maxDistance: 900 });
  const lampLayer = new InstancedLayer(group, { name: 'lamps', geometry: props.lamp, material: materials.props, maxDistance: 700 });
  const rg = rng(hashString('factory-yard'));
  for (const g of gatePts) {
    // outward direction: from the map centre to the gate
    const cx = (sx0 + sx1) / 2;
    const cz = (sz0 + sz1) / 2;
    const dx = g.scene.x - cx;
    const dz = g.scene.z - cz;
    const horiz = Math.abs(dx) > Math.abs(dz);
    const out = horiz ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) };
    const side = horiz ? { x: 0, z: 1 } : { x: 1, z: 0 };
    const px2 = g.scene.x + out.x * (pad + 14);
    const pz2 = g.scene.z + out.z * (pad + 14);
    if (rg() < 0.7) {
      truckLayer.add(composeMatrix(px2 + side.x * 5, G, pz2 + side.z * 5, horiz ? 0 : Math.PI / 2), new THREE.Color(pick(rg, ['#c9c6bd', '#8b2f24', '#2f5a86'])));
      stats.trucks += 1;
    }
    contLayer.add(composeMatrix(px2 - side.x * 7, G, pz2 - side.z * 7, horiz ? Math.PI / 2 : 0));
  }
  for (let i = 0; i < 4; i += 1) {
    const a = fenceRing[i];
    const c2 = fenceRing[(i + 1) % 4];
    const len = Math.hypot(c2.x - a.x, c2.z - a.z);
    for (let s = 12; s < len - 6; s += 24) {
      const t = s / len;
      const x = a.x + (c2.x - a.x) * t;
      const z = a.z + (c2.z - a.z) * t;
      const ang = Math.atan2(-(c2.z - a.z), c2.x - a.x) + Math.PI / 2;
      lampLayer.add(composeMatrix(x - Math.sin(ang) * 1.2, G - 0.05, z - Math.cos(ang) * 1.2, ang));
    }
  }
  // forest ring outside the perimeter
  const trunk = new InstancedLayer(group, { name: 'tree-trunks', geometry: icProps.coniferTrunk, material: materials.props, maxDistance: 1400 });
  const crown = new InstancedLayer(group, { name: 'tree-crowns', geometry: icProps.coniferCrown, material: materials.props, maxDistance: 1400 });
  const greens = ['#2e4a2c', '#34502f', '#2a4430', '#3a5534', '#2f4b36'];
  for (let x = sx0 - 170; x < sx1 + 170; x += 6) {
    for (let z = sz0 - 170; z < sz1 + 170; z += 6) {
      const tx = x + (rg() - 0.5) * 5;
      const tz = z + (rg() - 0.5) * 5;
      const d = Math.max(sx0 - pad - tx, tx - sx1 - pad, sz0 - pad - tz, tz - sz1 - pad);
      if (d < 10) continue; // clear strip along the wall
      if (gatePts.some((g) => Math.hypot(g.scene.x - tx, g.scene.z - tz) < 38)) continue; // roads out of the gates
      if (rg() > Math.min(0.75, 0.2 + d / 60)) continue;
      const s = 0.8 + rg() * 0.6;
      trunk.add(composeMatrix(tx, G - 0.6, tz, rg() * 6, s, s, s));
      crown.add(composeMatrix(tx, G - 0.6, tz, rg() * 6, s, s, s), new THREE.Color(pick(rg, greens)));
      stats.trees += 1;
    }
  }
  // roads out of the gates
  const roadB = new MeshBucket((x, z) => [x / 8, z / 8]);
  for (const g of gatePts) {
    const cx = (sx0 + sx1) / 2;
    const cz = (sz0 + sz1) / 2;
    const dx = g.scene.x - cx;
    const dz = g.scene.z - cz;
    const horiz = Math.abs(dx) > Math.abs(dz);
    const len = 170;
    const ox = horiz ? Math.sign(dx) * (len / 2 + pad) : 0;
    const oz = horiz ? 0 : Math.sign(dz) * (len / 2 + pad);
    box(roadB, g.scene.x + ox, G - 0.62, g.scene.z + oz, horiz ? len : 7, 0.1, horiz ? 7 : len, 0, WHITE);
  }

  const add = (bucket, material, name) => {
    const mesh = bucket.mesh(material);
    if (mesh) { mesh.name = name; group.add(mesh); }
  };
  add(facadeHall, materials.facadeHall, 'hall facade');
  add(facadeLow, materials.facadeLow, 'annex facade');
  add(roofB, materials.roof, 'roofs');
  add(trim, materials.solid, 'trim, gates, stack');
  add(glassB, materials.skylight, 'skylights');
  add(groundB, materials.yard, 'yard');
  add(grassB, materials.grass, 'grass');
  add(roadB, materials.road, 'roads');
  add(fenceB, materials.fence, 'perimeter wall');
  const layers = [unitLayer, ventLayer, truckLayer, contLayer, lampLayer, trunk, crown];
  for (const l of layers) l.build();
  return { group, layers, stats, tall, isFloorAt };
}
