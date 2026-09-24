// Shoreline outside (OUTSIDE level), from the SVG map and tarkov.dev data:
// - relief: rebuilt from the heights of in-game objects (services/terrain.js), draped with the SVG ground layer;
// - water (SVG Water): lakes and sea as flat surfaces at the lowest shore point, the river follows the relief;
//   the ground under water is lowered; piers (SVG Docks) on piles above the sea;
// - buildings (SVG Small / Medium buildings, Terminal): walls from the lowest ground corner, pitched roofs on
//   rectangular houses; the Resort (SVG Large_Buildings) with three storeys at the floor heights of the data;
// - forest (SVG Forest areas), bushes on forest edges, rocks (SVG Rocks), fences, power line towers and wires,
//   railway, minefield signs (SVG Mines + tarkov.dev minefields), lamps along paved roads;
// - cars at trunk locks, stationary weapons, checkpoint, loot containers and doors at key locks (tarkov.dev).
// Approximate (not in open data): relief between samples, building and roof heights, roof shapes, facade patterns,
// tree positions inside forest areas, Resort balconies, lamps.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { mergeGeometries } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js/+esm';
import { MeshBucket, ringWalls, slab, box, ringInfo, color } from '../interchange/icKit.js';
import { InstancedLayer, composeMatrix } from '../city/instancing.js';
import { rng, hashString, pick, pointInPolygon, centroid, SegmentGrid } from '../city/util.js';
import { upperTexture, roofTexture, UPPER_TILE } from '../city/textures.js';
import { buildCars, pylonGeometry } from '../interchange/icBuild.js';
import { floorProps } from '../interchange/icStreetDetail.js';
import { CAR_PAINTS, CAR_MODELS } from '../interchange/icModels.js';
import { rasterMask } from '../interchange/icTextures.js';

// Open ground for scattered trees: meadows and fields white; roads, paths, pavement, rocks, water, piers, buildings and
// the SVG forest areas (they have their own trees) black.
export const CSS_OPEN_GROUND = [
  '*{stroke:#000!important}',
  '.water,.water *,.cement,.cement *,.rock,.rock *,.building,.building *,.wood,.wood *,.trees,.trees *{fill:#000!important}',
  '.land,.land *{fill:#fff!important;stroke:none!important}',
  '.map_border,.map_border *,.danger,.danger *,.plane,.plane *{fill:none!important;stroke:none!important}',
  '.powerline,.powerline *,.fence,.fence *{stroke:none!important}', '.shadow{filter:none!important}',
].join('');

const WHITE = color('#ffffff');
const C = {
  deck: color('#6f5638'), deckDark: color('#4a3a28'), pile: color('#3e3226'),
  roofRust: color('#6b4f3a'), roofGrey: color('#5c5f5e'), roofDark: color('#46423c'), gable: color('#8a7d6a'),
  roofFlat: color('#5d5e5a'), parapet: color('#b3ab9c'), parapetLow: color('#8f887b'),
  rail: color('#6d6f6e'), ballast: color('#5b5147'),
};
const CONIFER = ['#3f5a36', '#46613a', '#3b5232', '#526b3f', '#34492e'];
const LEAF = ['#4f6a3a', '#5b7442', '#6d7d45', '#465f35', '#7a8450'];
const BUSH = ['#4c6338', '#5a6f3e', '#667541', '#43582f'];

const alongX = (d) => Math.atan2(-d.z, d.x);
const faceZ = (d) => Math.atan2(d.x, d.z);
const off = (p, d, k) => ({ x: p.x + d.x * k, z: p.z + d.z * k });

export function walkLine(line, step, fn, offset = step / 2) {
  let carry = offset;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-3) continue;
    const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    let s = carry;
    while (s <= len) {
      fn({ x: a.x + dir.x * s, z: a.z + dir.z * s }, dir);
      s += step;
    }
    carry = s - len;
  }
}

export function addMesh(parent, bucket, material, name) {
  const mesh = bucket.mesh(material);
  if (mesh) {
    mesh.name = name;
    parent.add(mesh);
  }
  return mesh;
}

// ---------------------------------------------------------------- relief and water
// Lowers the ground under every water body and returns the water height per terrain node (NaN = dry).
export function carveWater(ctx) {
  const { svg, terrain } = ctx;
  const { cols, rows, cell, gx0, gz0, heights } = terrain;
  const waterY = new Float32Array(cols * rows).fill(NaN);
  const surfaces = [];
  for (const poly of svg.polygons('Water', { minArea: 30 })) {
    const info = ringInfo(poly.outer);
    const flat = info.width >= 20; // lakes and the sea; the narrow river follows the ground
    let level = Infinity;
    for (const p of poly.outer) level = Math.min(level, terrain.heightAtScene(p.x, p.z));
    level -= 0.3;
    const c0 = Math.max(0, Math.floor((-info.bounds.x1 - gx0) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((-info.bounds.x0 - gx0) / cell));
    const r0 = Math.max(0, Math.floor((info.bounds.z0 - gz0) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((info.bounds.z1 - gz0) / cell));
    let nodes = 0;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        if (!pointInPolygon({ x: -(gx0 + c * cell), z: gz0 + r * cell }, poly)) continue;
        const i = r * cols + c;
        const h = heights[i];
        const wy = flat ? level : h - 0.4;
        heights[i] = flat ? Math.min(h, level - 2.2) : h - 1.6;
        waterY[i] = Number.isNaN(waterY[i]) ? wy : Math.max(waterY[i], wy);
        nodes += 1;
      }
    }
    surfaces.push({ flat, level, area: Math.round(info.area), nodes });
  }
  return { waterY, surfaces };
}

export function buildTerrainMesh(terrain, projection, material) {
  const { cols, rows, cell, gx0, gz0, heights } = terrain;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      const sx = -(gx0 + c * cell);
      const sz = gz0 + r * cell;
      pos[i * 3] = sx;
      pos[i * 3 + 1] = heights[i];
      pos[i * 3 + 2] = sz;
      uv[i * 2] = (sx - projection.sceneLeft) / projection.width;
      uv[i * 2 + 1] = 1 - (sz - projection.sceneTop) / projection.depth;
    }
  }
  const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      index[k++] = a; index[k++] = b; index[k++] = d;
      index[k++] = b; index[k++] = e; index[k++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'terrain';
  return mesh;
}

export function buildWaterMesh(terrain, waterY, material) {
  const { cols, rows, cell, gx0, gz0 } = terrain;
  const pos = [];
  const node = (r, c) => [-(gx0 + c * cell), waterY[r * cols + c], gz0 + r * cell];
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const i = r * cols + c;
      if (Number.isNaN(waterY[i]) || Number.isNaN(waterY[i + 1]) || Number.isNaN(waterY[i + cols]) || Number.isNaN(waterY[i + cols + 1])) continue;
      const a = node(r, c);
      const b = node(r, c + 1);
      const d = node(r + 1, c);
      const e = node(r + 1, c + 1);
      pos.push(...a, ...b, ...d, ...b, ...e, ...d);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, j) => (j % 3 === 1 ? 1 : 0)), 3));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'water';
  mesh.renderOrder = 2;
  return mesh;
}

// ---------------------------------------------------------------- buildings
export function facadeRing(bucket, ring, y0, y1, vBase) {
  let s = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.05) continue;
    const u0 = s / UPPER_TILE.w;
    const u1 = (s + len) / UPPER_TILE.w;
    const v = (y) => (y - vBase) / UPPER_TILE.h;
    bucket.quad([a.x, y0, a.z, u0, v(y0)], [b.x, y0, b.z, u1, v(y0)], [b.x, y1, b.z, u1, v(y1)], [a.x, y1, a.z, u0, v(y1)], [(b.z - a.z) / len, 0, -(b.x - a.x) / len], WHITE);
    s += len;
  }
}

function tri3(bucket, a, b, c, col, up = false) {
  const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
  const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
  let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  n = n.map((x) => x / l);
  if (up && n[1] < 0) n = n.map((x) => -x);
  bucket.tri(a, b, c, n, col);
}

// Gable roof over a rectangle: ridge along the long side.
export function gableRoof(bucket, ring, eave, rise, col, gableCol) {
  let [p0, p1, p2, p3] = ring;
  if (Math.hypot(p1.x - p0.x, p1.z - p0.z) < Math.hypot(p2.x - p1.x, p2.z - p1.z)) [p0, p1, p2, p3] = [p1, p2, p3, p0];
  const m03 = { x: (p0.x + p3.x) / 2, z: (p0.z + p3.z) / 2 };
  const m12 = { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
  const A = [p0.x, eave, p0.z]; const B = [p1.x, eave, p1.z]; const Cc = [p2.x, eave, p2.z]; const D = [p3.x, eave, p3.z];
  const R0 = [m03.x, eave + rise, m03.z]; const R1 = [m12.x, eave + rise, m12.z];
  tri3(bucket, A, B, R1, col, true); tri3(bucket, A, R1, R0, col, true);
  tri3(bucket, D, Cc, R1, col, true); tri3(bucket, D, R1, R0, col, true);
  tri3(bucket, A, D, R0, gableCol); tri3(bucket, B, Cc, R1, gableCol);
}

export function stripSloped(bucket, a, b, width, ya, yb, col) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 0.01) return;
  const nx = (-(b.z - a.z) / len) * (width / 2);
  const nz = ((b.x - a.x) / len) * (width / 2);
  bucket.quad([a.x - nx, ya, a.z - nz], [b.x - nx, yb, b.z - nz], [b.x + nx, yb, b.z + nz], [a.x + nx, ya, a.z + nz], [0, 1, 0], col);
}

// ---------------------------------------------------------------- outside
export function buildOutside(ctx, water) {
  const { svg, terrain, ground, materials, props, icProps, anisotropy, resort, heights } = ctx;
  const env = ctx.environment || {};
  const group = new THREE.Group();
  group.name = 'OUTSIDE';
  const propsGroup = new THREE.Group();
  propsGroup.name = 'outside-props';
  const carGroup = new THREE.Group();
  carGroup.name = 'outside-cars';
  const vegGroup = new THREE.Group();
  vegGroup.name = 'vegetation';
  group.add(propsGroup, carGroup, vegGroup);
  const layers = [];
  const stats = { waterBodies: water.surfaces.length, docks: 0, buildings: 0, resortRings: 0, balconies: 0, rocks: 0, trees: 0, bushes: 0, fences: 0, towers: 0, railSegments: 0, mineSigns: 0, lamps: 0, cars: 0 };
  const L = (parent, name, geometry, maxDistance, material = materials.props) => {
    const l = new InstancedLayer(parent, { name, geometry, material, maxDistance });
    layers.push(l);
    return l;
  };
  const inWater = (p) => {
    const c = Math.round((-p.x - terrain.gx0) / terrain.cell);
    const r = Math.round((p.z - terrain.gz0) / terrain.cell);
    if (c < 0 || r < 0 || c >= terrain.cols || r >= terrain.rows) return false;
    return !Number.isNaN(water.waterY[r * terrain.cols + c]);
  };

  group.add(buildTerrainMesh(terrain, ctx.projection, materials.terrain));
  const waterMesh = buildWaterMesh(terrain, water.waterY, materials.water);
  if (waterMesh) group.add(waterMesh);

  // piers on piles
  const flatLevels = water.surfaces.filter((s) => s.flat && Number.isFinite(s.level)).map((s) => s.level);
  const seaLevel = flatLevels.length ? Math.min(...flatLevels) : -66;
  const deck = new MeshBucket();
  for (const poly of svg.polygons('Docks', { minArea: 4 })) {
    const deckY = seaLevel + 1.6;
    slab(deck, poly, deckY, C.deck);
    slab(deck, { outer: poly.outer, holes: [] }, deckY - 0.3, C.deckDark, { down: true });
    ringWalls(deck, poly.outer, deckY - 0.3, deckY, C.deckDark);
    poly.outer.forEach((a, i) => {
      const b = poly.outer[(i + 1) % poly.outer.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.5) return;
      const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      for (let s = 0; s < len; s += 4) {
        const p = off(a, dir, s);
        const bottom = Math.min(seaLevel - 2, ground(p.x, p.z));
        box(deck, p.x, bottom, p.z, 0.35, deckY - bottom, 0.35, 0, C.pile);
      }
    });
    stats.docks += 1;
  }
  addMesh(group, deck, materials.solid, 'piers');

  // buildings
  const footprints = [];
  const facadeBuckets = new Map();
  const facade = (style) => {
    if (!facadeBuckets.has(style)) {
      facadeBuckets.set(style, new MeshBucket());
      if (!materials.facades[style]) materials.facades[style] = new THREE.MeshLambertMaterial({ map: upperTexture(style, style === 'stalinka' ? 1 : 0, anisotropy), side: THREE.DoubleSide });
    }
    return facadeBuckets.get(style);
  };
  const roofs = new MeshBucket();
  const rb = rng(hashString('shoreline-buildings'));
  const KINDS = [
    ['Small_Buildings', 'small', 3.1, ['brick', 'panel', 'industrial']],
    ['Medium_Buildings', 'medium', 6.4, ['panel', 'brick', 'industrial']],
    ['Terminal', 'terminal', 6.5, ['industrial']],
  ];
  for (const [gid, kind, H, styles] of KINDS) {
    for (const poly of svg.polygons(gid, { minArea: 3 })) {
      const info = ringInfo(poly.outer);
      let low = ground(info.center.x, info.center.z);
      let high = low;
      for (const p of poly.outer) {
        const g = ground(p.x, p.z);
        low = Math.min(low, g);
        high = Math.max(high, g);
      }
      const floorY = high + 0.15;
      const height = kind === 'small' && info.area > 150 ? 4.2 : H;
      const eave = floorY + height;
      facadeRing(facade(pick(rb, styles)), poly.outer, low - 0.4, eave, floorY);
      for (const hole of poly.holes) facadeRing(facade('brick'), hole, low - 0.4, eave, floorY);
      if (poly.outer.length === 4 && !poly.holes.length && kind !== 'terminal') {
        gableRoof(roofs, poly.outer, eave, kind === 'small' ? 1.5 : 2.3, pick(rb, [C.roofRust, C.roofGrey, C.roofDark]), C.gable);
      } else {
        slab(roofs, poly, eave, C.roofFlat);
        ringWalls(roofs, poly.outer, eave, eave + 0.45, C.parapetLow, C.parapet);
      }
      footprints.push({ poly, bounds: info.bounds });
      stats.buildings += 1;
    }
  }

  // the Resort: three storeys on the footprint, flat roof with parapet, balconies on the long facades
  const roofY = heights.LEVEL3 + 3.3;
  const resortFacade = facade('stalinka');
  const resortRoof = new MeshBucket();
  const balcony = L(group, 'resort-balcony', props.balconyOpen, 650);
  for (const poly of resort.polys) {
    let low = Infinity;
    for (const p of poly.outer) low = Math.min(low, ground(p.x, p.z));
    const bottom = Math.min(low, heights.LEVEL1) - 0.5;
    for (const ring of [poly.outer, ...poly.holes]) {
      facadeRing(resortFacade, ring, bottom, roofY, heights.LEVEL1 - 0.3);
      ringWalls(roofs, ring, roofY, roofY + 0.9, C.parapetLow, C.parapet);
    }
    slab(resortRoof, poly, roofY, WHITE);
    const own = { outer: poly.outer, holes: poly.holes };
    poly.outer.forEach((a, i) => {
      const b = poly.outer[(i + 1) % poly.outer.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 14) return;
      const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      let out = { x: dir.z, z: -dir.x };
      if (pointInPolygon(off(off(a, dir, len / 2), out, 0.6), own)) out = { x: -out.x, z: -out.z };
      for (let s = 3.2; s < len - 3.2; s += 6.4) {
        const p = off(a, dir, s);
        for (const fy of [heights.LEVEL2, heights.LEVEL3]) {
          if (rb() > 0.5) continue;
          balcony.add(composeMatrix(p.x, fy, p.z, faceZ(out)));
          stats.balconies += 1;
        }
      }
    });
    footprints.push({ poly, bounds: ringInfo(poly.outer).bounds });
    stats.resortRings += 1;
  }
  for (const [style, bucket] of facadeBuckets) addMesh(group, bucket, materials.facades[style], `facades-${style}`);
  addMesh(group, roofs, materials.solid, 'roofs');
  if (!materials.roofTex) materials.roofTex = new THREE.MeshLambertMaterial({ map: roofTexture(anisotropy) });
  addMesh(group, resortRoof, materials.roofTex, 'resort-roof');

  const inFootprint = (p) => footprints.some((f) => p.x >= f.bounds.x0 && p.x <= f.bounds.x1 && p.z >= f.bounds.z0 && p.z <= f.bounds.z1 && pointInPolygon(p, f.poly));
  const pathSegs = [];
  for (const id of ['Roads', 'Roads_Unpaved', 'Path']) {
    for (const s of svg.strokes(id)) for (const line of s.lines) for (let i = 0; i < line.length - 1; i += 1) pathSegs.push({ a: line[i], b: line[i + 1], width: s.width });
  }
  const pathGrid = new SegmentGrid(pathSegs, 24);
  const onRoad = (p, pad = 0) => pathGrid.near(p, 14).some((sg) => {
    const dx = sg.b.x - sg.a.x;
    const dz = sg.b.z - sg.a.z;
    const l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.min(1, Math.max(0, ((p.x - sg.a.x) * dx + (p.z - sg.a.z) * dz) / l2));
    return Math.hypot(p.x - (sg.a.x + dx * t), p.z - (sg.a.z + dz * t)) < sg.width / 2 + pad;
  });

  // rocks
  const rockGeos = [];
  for (const poly of svg.polygons('Rocks', { minArea: 2 })) {
    const info = ringInfo(poly.outer);
    let low = Infinity;
    for (const p of poly.outer) low = Math.min(low, ground(p.x, p.z));
    const h = Math.min(6, 0.7 + Math.sqrt(info.area) / 9);
    try {
      const shape = new THREE.Shape(poly.outer.map((q) => new THREE.Vector2(q.x, q.z)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: h * 0.5, bevelEnabled: true, bevelThickness: h * 0.5, bevelSize: Math.min(1.8, h * 0.6), bevelSegments: 2, curveSegments: 1 });
      g.rotateX(Math.PI / 2);
      g.translate(0, low - 0.3 + h, 0);
      rockGeos.push(g.index ? g.toNonIndexed() : g);
    } catch {
      // self-intersecting outline: skip that rock
    }
  }
  if (rockGeos.length) {
    const rocks = new THREE.Mesh(mergeGeometries(rockGeos, false), materials.rock);
    rocks.name = 'rocks';
    group.add(rocks);
  }
  stats.rocks = rockGeos.length;

  // forest areas and their edges
  const coniferTrunk = L(vegGroup, 'conifer-trunk', icProps.coniferTrunk, 700);
  const coniferCrown = L(vegGroup, 'conifer-crown', icProps.coniferCrown, 2200);
  const treeTrunk = L(vegGroup, 'tree-trunk', props.treeTrunk, 700);
  const treeCrown = L(vegGroup, 'tree-crown', props.treeCrown, 2200);
  const bush = L(vegGroup, 'bush', icProps.bush, 520);
  const rf = rng(hashString('shoreline-forest'));
  for (const poly of svg.polygons('Forest', { minArea: 40 })) {
    const { bounds } = ringInfo(poly.outer);
    for (let x = bounds.x0 + 2; x < bounds.x1 && stats.trees < 18000; x += 7) {
      for (let z = bounds.z0 + 2; z < bounds.z1; z += 7) {
        const p = { x: x + (rf() - 0.5) * 5.5, z: z + (rf() - 0.5) * 5.5 };
        if (rf() > 0.74 || !pointInPolygon(p, poly) || inWater(p) || inFootprint(p) || onRoad(p, 1.5)) continue;
        const y = ground(p.x, p.z) - 0.1;
        const k = 0.75 + rf() * 0.6;
        const ang = rf() * Math.PI * 2;
        if (rf() < 0.65) {
          coniferTrunk.add(composeMatrix(p.x, y, p.z, ang, k, k, k));
          coniferCrown.add(composeMatrix(p.x, y, p.z, ang, k, k * (0.85 + rf() * 0.35), k), new THREE.Color(pick(rf, CONIFER)));
        } else {
          treeTrunk.add(composeMatrix(p.x, y, p.z, ang, k, k, k));
          treeCrown.add(composeMatrix(p.x, y, p.z, ang, k, k * (0.85 + rf() * 0.3), k), new THREE.Color(pick(rf, LEAF)));
        }
        stats.trees += 1;
      }
    }
    const ring = poly.outer;
    const own = { outer: ring, holes: [] };
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.5 || stats.bushes >= 6000) return;
      const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      let out = { x: dir.z, z: -dir.x };
      if (pointInPolygon(off(off(a, dir, len / 2), out, 1), own)) out = { x: -out.x, z: -out.z };
      for (let s = rf() * 8; s < len; s += 9) {
        const p = off(off(a, dir, s), out, 2 + rf() * 2);
        if (inWater(p) || inFootprint(p) || onRoad(p, 0.8)) continue;
        const k = 0.6 + rf() * 0.7;
        bush.add(composeMatrix(p.x, ground(p.x, p.z) - 0.05, p.z, rf() * Math.PI * 2, k, k * (0.7 + rf() * 0.5), k), new THREE.Color(pick(rf, BUSH)));
        stats.bushes += 1;
      }
    });
  }

  // fences
  const fence = L(propsGroup, 'fence', props.fenceMetal, 700);
  for (const s of svg.strokes('Fences')) {
    for (const line of s.lines) {
      walkLine(line, 2.5, (p, dir) => {
        fence.add(composeMatrix(p.x, ground(p.x, p.z) - 0.05, p.z, alongX(dir)));
        stats.fences += 1;
      });
    }
  }

  // power line towers (turned across the line) and wires
  const lineSegs = [];
  for (const s of svg.strokes('Powerlines')) for (const line of s.lines) for (let i = 0; i < line.length - 1; i += 1) lineSegs.push({ a: line[i], b: line[i + 1] });
  const lineGrid = new SegmentGrid(lineSegs, 40);
  const pylon = L(propsGroup, 'pylon', pylonGeometry(), 2200);
  for (const poly of svg.polygons('Powerline_Towers', { minArea: 1 })) {
    const c = centroid(poly.outer);
    const near = lineGrid.nearest(c, 30);
    let rot = 0;
    if (near) {
      const len = Math.hypot(near.seg.b.x - near.seg.a.x, near.seg.b.z - near.seg.a.z) || 1;
      rot = alongX({ x: -(near.seg.b.z - near.seg.a.z) / len, z: (near.seg.b.x - near.seg.a.x) / len });
    }
    pylon.add(composeMatrix(c.x, ground(c.x, c.z) - 0.2, c.z, rot));
    stats.towers += 1;
  }
  const wirePts = [];
  for (const { a, b } of lineSegs) {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 5) continue;
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    const ga = ground(a.x, a.z);
    const gb = ground(b.x, b.z);
    for (const [o, y] of [[-7.6, 21], [7.6, 21], [-5, 25], [5, 25]]) {
      for (let k = 0; k < 8; k += 1) {
        const t0 = k / 8;
        const t1 = (k + 1) / 8;
        const sag = (t) => -2.2 * 4 * t * (1 - t);
        wirePts.push(
          a.x + (b.x - a.x) * t0 + nx * o, ga + (gb - ga) * t0 + y + sag(t0), a.z + (b.z - a.z) * t0 + nz * o,
          a.x + (b.x - a.x) * t1 + nx * o, ga + (gb - ga) * t1 + y + sag(t1), a.z + (b.z - a.z) * t1 + nz * o,
        );
      }
    }
  }
  if (wirePts.length) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
    const wires = new THREE.LineSegments(wg, materials.wire);
    wires.name = 'wires';
    propsGroup.add(wires);
  }

  // railway
  const rails = new MeshBucket();
  const sleeperGeo = new THREE.BoxGeometry(0.26, 0.16, 2.6).translate(0, 0.08, 0);
  sleeperGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(sleeperGeo.attributes.position.count * 3).fill(0.42), 3));
  const sleeper = L(propsGroup, 'sleeper', sleeperGeo, 320, materials.metal);
  for (const s of svg.strokes('Railroad')) {
    for (const line of s.lines) {
      for (let i = 0; i < line.length - 1; i += 1) {
        const a = line[i];
        const b = line[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.1) continue;
        const nx = -(b.z - a.z) / len;
        const nz = (b.x - a.x) / len;
        const ya = ground(a.x, a.z);
        const yb = ground(b.x, b.z);
        stripSloped(rails, a, b, 3.4, ya + 0.02, yb + 0.02, C.ballast);
        for (const o of [-0.76, 0.76]) stripSloped(rails, { x: a.x + nx * o, z: a.z + nz * o }, { x: b.x + nx * o, z: b.z + nz * o }, 0.1, ya + 0.2, yb + 0.2, C.rail);
        stats.railSegments += 1;
      }
      walkLine(line, 0.7, (p, dir) => sleeper.add(composeMatrix(p.x, ground(p.x, p.z) + 0.02, p.z, alongX(dir))));
    }
  }
  addMesh(propsGroup, rails, materials.metal, 'railway');

  // minefields: signs along the SVG outlines and at the tarkov.dev minefields
  const mineSign = L(propsGroup, 'sign-mines', props.signMines, 520);
  for (const poly of svg.polygons('Mines', { minArea: 20 })) {
    const own = { outer: poly.outer, holes: [] };
    poly.outer.forEach((a, i) => {
      const b = poly.outer[(i + 1) % poly.outer.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1) return;
      const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      let out = { x: dir.z, z: -dir.x };
      if (pointInPolygon(off(off(a, dir, len / 2), out, 0.6), own)) out = { x: -out.x, z: -out.z };
      for (let s = 5; s < len; s += 25) {
        const p = off(off(a, dir, s), out, 1);
        mineSign.add(composeMatrix(p.x, ground(p.x, p.z), p.z, alongX(out)));
        stats.mineSigns += 1;
      }
    });
  }
  for (const m of env.minefields || []) {
    const c = { x: -m.position.x, z: m.position.z };
    mineSign.add(composeMatrix(c.x, ground(c.x, c.z), c.z, 0));
    stats.mineSigns += 1;
  }

  // lamps along paved roads
  const lamp = L(propsGroup, 'lamp', props.lamp, 800);
  for (const s of svg.strokes('Roads')) {
    for (const line of s.lines) {
      let side = 1;
      walkLine(line, 55, (p, dir) => {
        const out = { x: dir.z * side, z: -dir.x * side };
        side = -side;
        const q = off(p, out, s.width / 2 + 1);
        if (inWater(q) || inFootprint(q)) return;
        lamp.add(composeMatrix(q.x, ground(q.x, q.z) - 0.05, q.z, alongX({ x: -out.x, z: -out.z })));
        stats.lamps += 1;
      }, 20);
    }
  }

  // data: cars at trunk locks and V-Ex, stationary weapons, checkpoint
  const roadSegs = [];
  for (const id of ['Roads', 'Roads_Unpaved', 'Path']) for (const s of svg.strokes(id)) for (const line of s.lines) for (let i = 0; i < line.length - 1; i += 1) roadSegs.push({ a: line[i], b: line[i + 1] });
  const roadGrid = new SegmentGrid(roadSegs, 24);
  const rc = rng(hashString('shoreline-cars'));
  const placements = [];
  for (const v of env.vehicles || []) {
    const p = { x: -v.position.x, z: v.position.z };
    const near = roadGrid.nearest(p, 30);
    let heading = rc() * Math.PI * 2;
    if (near) {
      const len = Math.hypot(near.seg.b.x - near.seg.a.x, near.seg.b.z - near.seg.a.z) || 1;
      heading = alongX({ x: (near.seg.b.x - near.seg.a.x) / len, z: (near.seg.b.z - near.seg.a.z) / len });
    }
    const y = v.position.y != null ? Math.max(ground(p.x, p.z) - 0.3, v.position.y - 0.9) : ground(p.x, p.z);
    placements.push({ x: p.x, y, z: p.z, heading, model: pick(rc, CAR_MODELS), paint: pick(rc, CAR_PAINTS) });
  }
  layers.push(...buildCars(carGroup, placements, ctx));
  stats.cars = placements.length;
  const sandbags = L(propsGroup, 'sandbags', props.sandbags, 600);
  const gun = L(propsGroup, 'gun', props.gun, 400);
  for (const w of env.emplacements || []) {
    sandbags.add(composeMatrix(-w.position.x, w.position.y - 0.1, w.position.z, 0));
    gun.add(composeMatrix(-w.position.x, w.position.y - 0.1, w.position.z, rc() * Math.PI * 2));
  }
  const barrier = L(propsGroup, 'barrier', props.barrier, 700);
  for (const cp of env.checkpoints || []) {
    const p = { x: -cp.position.x, z: cp.position.z };
    barrier.add(composeMatrix(p.x, ground(p.x, p.z), p.z, 0));
  }

  // loot containers on the ground and doors at key locks
  const wallSegs = footprints.flatMap((f) => [f.poly.outer, ...f.poly.holes]).flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] })));
  const extra = floorProps(ctx, 'OUTSIDE', propsGroup, { walls: new SegmentGrid(wallSegs, 24), groundAt: ground });
  layers.push(...extra.layers);
  stats.containers = extra.containers;
  stats.doors = extra.doors;

  for (const l of layers) if (!l.cells.length) l.build();
  return { group, props: propsGroup, cars: carGroup, vegetation: vegGroup, layers, stats, inWater, inFootprint, onRoad };
}

// Trees outside the SVG forest areas: in groves (smooth value noise over a 70 m lattice) on open ground, away from
// roads, water and buildings. The SVG marks only part of the woods, so these positions are an approximation.
export async function scatterTrees(ctx, outside) {
  const { svg, projection, props, icProps, materials, mapData, ground } = ctx;
  const mask = await rasterMask(svg.svgDoc, {
    layers: ['Ground_Level'], css: CSS_OPEN_GROUND, crop: { x: 0, y: 0, w: mapData.map.svg.width, h: mapData.map.svg.height }, pxPerUnit: 1,
  });
  const open = (p) => {
    const u = (p.x - projection.sceneLeft) / projection.svgScaleX;
    const v = (p.z - projection.sceneTop) / projection.svgScaleZ;
    const px = Math.floor((u - mask.crop.x) * mask.scale);
    const py = Math.floor((v - mask.crop.y) * mask.scale);
    if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return false;
    return mask.data[(py * mask.width + px) * 4] > 140;
  };
  const clear = (p, rad) => open(p) && [0, 1.571, 3.142, 4.712].every((a) => open({ x: p.x + Math.cos(a) * rad, z: p.z + Math.sin(a) * rad }));
  const lattice = (i, j) => {
    const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, z) => {
    const fx = x / 70;
    const fz = z / 70;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = smooth(fx - i);
    const tz = smooth(fz - j);
    return (lattice(i, j) * (1 - tx) + lattice(i + 1, j) * tx) * (1 - tz) + (lattice(i, j + 1) * (1 - tx) + lattice(i + 1, j + 1) * tx) * tz;
  };
  const L = (name, geometry, maxDistance) => new InstancedLayer(outside.vegetation, { name, geometry, material: materials.props, maxDistance });
  const layers = [L('grove-conifer-trunk', icProps.coniferTrunk, 700), L('grove-conifer-crown', icProps.coniferCrown, 2200), L('grove-tree-trunk', props.treeTrunk, 700), L('grove-tree-crown', props.treeCrown, 2200)];
  const [coniferTrunk, coniferCrown, treeTrunk, treeCrown] = layers;
  const r = rng(hashString('shoreline-groves'));
  let trees = 0;
  for (let x = projection.sceneLeft + 4; x < projection.sceneLeft + projection.width && trees < 9000; x += 8) {
    for (let z = projection.sceneTop + 4; z < projection.sceneTop + projection.depth; z += 8) {
      const p = { x: x + (r() - 0.5) * 6, z: z + (r() - 0.5) * 6 };
      const n = noise(p.x, p.z);
      const density = n < 0.5 ? 0.015 : Math.min(0.6, (n - 0.5) * 2.2);
      if (r() > density || !clear(p, 3) || outside.inWater(p) || outside.inFootprint(p) || outside.onRoad(p, 2.5)) continue;
      const y = ground(p.x, p.z) - 0.1;
      const k = 0.7 + r() * 0.65;
      const ang = r() * Math.PI * 2;
      if (r() < 0.7) {
        coniferTrunk.add(composeMatrix(p.x, y, p.z, ang, k, k, k));
        coniferCrown.add(composeMatrix(p.x, y, p.z, ang, k, k * (0.85 + r() * 0.35), k), new THREE.Color(pick(r, CONIFER)));
      } else {
        treeTrunk.add(composeMatrix(p.x, y, p.z, ang, k, k, k));
        treeCrown.add(composeMatrix(p.x, y, p.z, ang, k, k * (0.85 + r() * 0.3), k), new THREE.Color(pick(r, LEAF)));
      }
      trees += 1;
    }
  }
  for (const l of layers) l.build();
  outside.layers.push(...layers);
  return { trees };
}
