// Customs model, built in the browser from Shebuka's Customs SVG (the same map tarkov.dev shows) and tarkov.dev data.
// OUTSIDE:
// - relief rebuilt from the heights of in-game objects (services/terrain.js), draped with the SVG ground layer
//   (roads, dirt roads, pavement, railway, grass); the river (SVG River) follows the relief;
// - buildings (SVG Big_Buildings / Small_Buildings / Garages) standing on the ground: storeys where the SVG has plans of
//   upper floors inside the footprint (dorms, warehouses, Fortress, Streamer House...), pitched roofs on small houses,
//   flat roofs with parapets on big buildings;
// - forest areas (SVG Trees), groves on open land, rocks, fences, power lines, railway with sleepers, lamps along roads,
//   abandoned cars along the roads, cars at trunk locks and V-Ex, stationary weapons, checkpoints, minefield signs,
//   loot containers and doors at key locks (tarkov.dev).
// Building levels (UNDERGROUND, LEVEL1..3): the SVG floor plans (Buildings-U, Buildings-1..3) at the floor height each
// building has in the data (loot and spawns on that floor), walls, partitions, locked rooms, ladders and stairs.
// Approximate (not in open data): relief between samples, building and roof heights, facades, which roads have wrecks,
// tree positions, stair direction.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { mergeGeometries, mergeVertices } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js/+esm';
import { SVGLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/SVGLoader.js/+esm';
import { MeshBucket, ringWalls, slab, box, ringInfo, color } from '../interchange/icKit.js';
import { InstancedLayer, composeMatrix } from '../city/instancing.js';
import { rng, hashString, pick, pointInPolygon, centroid, SegmentGrid, orient, simplifyRing, signedArea } from '../city/util.js';
import { buildCars, pylonGeometry } from '../interchange/icBuild.js';
import { floorProps } from '../interchange/icStreetDetail.js';
import { CAR_PAINTS, CAR_MODELS } from '../interchange/icModels.js';
import { walkLine, addMesh, buildTerrainMesh, buildWaterMesh, stripSloped } from '../shoreline/slBuild.js';
import { buildBuildings, buildRoads, buildPaths, buildFences, buildYards, buildLandmarks, buildGrass } from './csOutside.js';

const WHITE = color('#ffffff');
const C = {
  roofRust: color('#6b4f3a'), roofGrey: color('#5c5f5e'), roofDark: color('#46423c'), gable: color('#8a7d6a'),
  roofFlat: color('#5d5e5a'), parapet: color('#b3ab9c'), parapetLow: color('#8f887b'),
  rail: color('#6d6f6e'), ballast: color('#5b5147'),
  wall: color('#ddd6c6'), wallLow: color('#aaa293'), partition: color('#d2cbbb'), partitionLow: color('#a29b8d'),
  block: color('#6f6c66'), blockTop: color('#4b4945'), underside: color('#57554f'), locked: color('#7a3b33'),
  stair: color('#a39f97'), stairTop: color('#cdc8bd'), bunker: color('#6f6a5f'), bunkerLow: color('#4f4b43'),
};
const CONIFER = ['#3f5a36', '#46613a', '#3b5232', '#526b3f', '#34492e'];
const LEAF = ['#4f6a3a', '#5b7442', '#6d7d45', '#465f35', '#7a8450'];
const BUSH = ['#4c6338', '#5a6f3e', '#667541', '#43582f'];
const WRECK = ['#5a4636', '#4d4a45', '#6b5a48', '#3e3b36', '#7a6a55'];
const XLINK = 'http://www.w3.org/1999/xlink';

const alongX = (d) => Math.atan2(-d.z, d.x);
const faceZ = (d) => Math.atan2(d.x, d.z);
const off = (p, d, k) => ({ x: p.x + d.x * k, z: p.z + d.z * k });

export const CUSTOMS_LEVELS = {
  UNDERGROUND: { floors: 'Buildings-U', locked: [], ladders: ['Ladders-U'], layer: 'Underground_Level', storey: 2.7 },
  LEVEL1: { floors: 'Buildings-1', locked: ['Locked-1', 'Streamers-1f-locked', 'Gas_Station-locked', '3s-1f-locked', '2s-1f-locked'], ladders: ['Ladders-1'], layer: 'First_Floor', storey: 3.1 },
  LEVEL2: { floors: 'Buildings-2', locked: ['Big_red-2f-locked', '3s-2f-locked', '2s-2f-locked'], ladders: ['Ladders-2'], layer: 'Second_Floor', storey: 3.1 },
  LEVEL3: { floors: 'Buildings-3', locked: ['3s-3f-locked'], ladders: ['Ladders-3'], layer: 'Third_Floor', storey: 3.0 },
};
const ORDER = ['UNDERGROUND', 'LEVEL1', 'LEVEL2', 'LEVEL3'];

// Plan shapes of a group without the shapes of the listed subgroups (locked rooms are drawn separately).
export function polygonsExcept(svg, id, exceptIds, opts) {
  const all = svg.polygons(id, opts);
  if (!exceptIds.length) return all;
  const skip = exceptIds.flatMap((e) => svg.polygons(e, opts));
  const same = (a, b) => Math.abs(signedArea(a.outer) - signedArea(b.outer)) < 0.01 && Math.hypot(a.outer[0].x - b.outer[0].x, a.outer[0].z - b.outer[0].z) < 0.01;
  return all.filter((p) => !skip.some((q) => same(p, q)));
}

// <use> symbols (ladders, stairs) of a group -> polygons in scene meters.
function usePolygons(svg, groupId) {
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
        if (outer.length >= 3 && Math.abs(signedArea(outer)) > 0.2) out.push({ outer, holes: [] });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- water
export function carveRiver(ctx) {
  const { svg, terrain } = ctx;
  const { cols, rows, cell, gx0, gz0, heights } = terrain;
  const waterY = new Float32Array(cols * rows).fill(NaN);
  const surfaces = [];
  for (const poly of svg.polygons('River', { minArea: 30 })) {
    const info = ringInfo(poly.outer);
    const c0 = Math.max(0, Math.floor((-info.bounds.x1 - gx0) / cell) - 1);
    const c1 = Math.min(cols - 1, Math.ceil((-info.bounds.x0 - gx0) / cell) + 1);
    const r0 = Math.max(0, Math.floor((info.bounds.z0 - gz0) / cell) - 1);
    const r1 = Math.min(rows - 1, Math.ceil((info.bounds.z1 - gz0) / cell) + 1);
    const w = c1 - c0 + 1;
    const inside = new Uint8Array(w * (r1 - r0 + 1));
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        if (pointInPolygon({ x: -(gx0 + c * cell), z: gz0 + r * cell }, poly)) inside[(r - r0) * w + (c - c0)] = 1;
      }
    }
    const at = (r, c) => (r >= r0 && r <= r1 && c >= c0 && c <= c1 ? inside[(r - r0) * w + (c - c0)] : 0);
    let nodes = 0;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const own = at(r, c);
        // nodes inside the river and one cell around it, so the surface reaches the banks
        if (!own && !at(r, c - 1) && !at(r, c + 1) && !at(r - 1, c) && !at(r + 1, c)) continue;
        const i = r * cols + c;
        const h = heights[i];
        // deeper away from the banks
        const deep = own && at(r, c - 2) && at(r, c + 2) && at(r - 2, c) && at(r + 2, c);
        if (own) heights[i] = h - (deep ? 2.2 : 1.3);
        const wy = h - 0.45;
        waterY[i] = Number.isNaN(waterY[i]) ? wy : Math.max(waterY[i], wy);
        nodes += 1;
      }
    }
    surfaces.push({ flat: false, area: Math.round(info.area), nodes });
  }
  return { waterY, surfaces };
}

// Darkens hollows, ditches and steep slopes a little (cavity = how far a node lies below the mean of its surroundings),
// so the small relief reads from above.
function shadeHollows(mesh, terrain) {
  const { cols, rows, heights } = terrain;
  const col = new Float32Array(cols * rows * 3);
  const R = 3;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let sum = 0;
      let k = 0;
      for (let dr = -R; dr <= R; dr += R) {
        for (let dc = -R; dc <= R; dc += R) {
          const rr = Math.min(rows - 1, Math.max(0, r + dr));
          const cc = Math.min(cols - 1, Math.max(0, c + dc));
          sum += heights[rr * cols + cc];
          k += 1;
        }
      }
      const i = r * cols + c;
      const cavity = sum / k - heights[i];
      const gx = heights[r * cols + Math.min(cols - 1, c + 1)] - heights[r * cols + Math.max(0, c - 1)];
      const gz = heights[Math.min(rows - 1, r + 1) * cols + c] - heights[Math.max(0, r - 1) * cols + c];
      const slope = Math.hypot(gx, gz) / (4 * terrain.cell);
      let v = 1 - Math.max(-0.08, Math.min(0.32, cavity * 0.45)) - Math.min(0.15, slope * 0.3);
      v = Math.max(0.55, Math.min(1.08, v));
      col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
    }
  }
  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  mesh.material.vertexColors = true;
  mesh.material.needsUpdate = true;
}

// ---------------------------------------------------------------- outside
export function buildOutside(ctx, water) {
  const { svg, terrain, ground, materials, props, icProps } = ctx;
  const env = ctx.environment || {};
  const group = new THREE.Group();
  group.name = 'OUTSIDE';
  const ground3d = new THREE.Group();
  ground3d.name = 'outside-ground';
  const built = new THREE.Group();
  built.name = 'outside-buildings';
  const propsGroup = new THREE.Group();
  propsGroup.name = 'outside-props';
  const carGroup = new THREE.Group();
  carGroup.name = 'outside-cars';
  const vegGroup = new THREE.Group();
  vegGroup.name = 'vegetation';
  group.add(ground3d, built, propsGroup, carGroup, vegGroup);
  const layers = [];
  const stats = { buildings: 0, rocks: 0, trees: 0, bushes: 0, fences: 0, towers: 0, railSegments: 0, cars: 0, wrecks: 0, mineSigns: 0 };
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

  const terrainMesh = buildTerrainMesh(terrain, ctx.projection, materials.terrain);
  shadeHollows(terrainMesh, terrain);
  ground3d.add(terrainMesh);
  const waterMesh = buildWaterMesh(terrain, water.waterY, materials.water);
  if (waterMesh) ground3d.add(waterMesh);

  // roads (with their drawn width), yards
  const ROADS = ['Main_Roads', 'High_Roads', 'Roads', 'Dirt_Roads'];
  const pathSegs = [];
  for (const id of ROADS) {
    for (const s of svg.strokes(id)) for (const line of s.lines) for (let i = 0; i < line.length - 1; i += 1) pathSegs.push({ a: line[i], b: line[i + 1], width: s.width, id });
  }
  const pathGrid = new SegmentGrid(pathSegs, 24);
  ctx.roadGrid = pathGrid;
  const onRoad = (p, pad = 0) => pathGrid.near(p, 14).some((sg) => {
    const dx = sg.b.x - sg.a.x;
    const dz = sg.b.z - sg.a.z;
    const l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.min(1, Math.max(0, ((p.x - sg.a.x) * dx + (p.z - sg.a.z) * dz) / l2));
    return Math.hypot(p.x - (sg.a.x + dx * t), p.z - (sg.a.z + dz * t)) < sg.width / 2 + pad;
  });
  const yards = svg.polygons('Pavement', { minArea: 20 }).map((poly) => ({ poly, b: ringInfo(poly.outer).bounds }));
  ctx.inYard = (p) => yards.some((y) => p.x >= y.b.x0 && p.x <= y.b.x1 && p.z >= y.b.z0 && p.z <= y.b.z1 && pointInPolygon(p, y.poly));

  // ---- buildings (warehouses, dorms, houses, garages, frames, tanks, containers, cabins)
  const parts = { built, propsGroup, carGroup, vegGroup, L, stats, inWater, onRoad };
  const T = {};
  let tt = performance.now();
  const lap = (k) => { const n = performance.now(); T[k] = Math.round(n - tt); tt = n; };
  const { footprints, doors } = buildBuildings(ctx, parts);
  lap('buildings');
  const inFootprint = (p) => footprints.some((f) => p.x >= f.bounds.x0 && p.x <= f.bounds.x1 && p.z >= f.bounds.z0 && p.z <= f.bounds.z1 && pointInPolygon(p, f.poly));
  parts.inFootprint = inFootprint;

  // ---- rocks: the SVG outlines extruded, then roughened (seeded noise per vertex position) into boulders
  const rockGeos = [];
  const jit = (x, y, z) => {
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return h - Math.floor(h) - 0.5;
  };
  for (const poly of svg.polygons('Rocks', { minArea: 2 })) {
    const info = ringInfo(poly.outer);
    let low = Infinity;
    for (const p of poly.outer) low = Math.min(low, ground(p.x, p.z));
    const h = Math.min(7, 1.1 + Math.sqrt(info.area) / 5.5);
    try {
      const shape = new THREE.Shape(poly.outer.map((q) => new THREE.Vector2(q.x, q.z)));
      let g = new THREE.ExtrudeGeometry(shape, { depth: h * 0.45, bevelEnabled: true, bevelThickness: h * 0.55, bevelSize: Math.min(2.2, h * 0.7), bevelSegments: 3, curveSegments: 1 });
      g.rotateX(Math.PI / 2);
      g.translate(0, low - 0.6 + h, 0);
      g = mergeVertices(g, 0.05);
      const pos = g.attributes.position;
      const amp = Math.min(0.9, 0.25 + h * 0.12);
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
        const k = Math.round(x * 2) / 2; const m = Math.round(y * 2) / 2; const n = Math.round(z * 2) / 2;
        pos.setXYZ(i, x + jit(k, m, n) * amp, y + jit(m, n, k) * amp * 0.7, z + jit(n, k, m) * amp);
      }
      g = g.toNonIndexed();
      g.computeVertexNormals();
      rockGeos.push(g);
    } catch {
      // self-intersecting outline: skip that rock
    }
  }
  if (rockGeos.length) {
    const rocks = new THREE.Mesh(mergeGeometries(rockGeos, false), materials.rock);
    rocks.name = 'rocks';
    propsGroup.add(rocks);
  }
  stats.rocks = rockGeos.length;

  // ---- forest areas and their edges
  const coniferTrunk = L(vegGroup, 'conifer-trunk', icProps.coniferTrunk, 700);
  const coniferCrown = L(vegGroup, 'conifer-crown', icProps.coniferCrown, 2200);
  const treeTrunk = L(vegGroup, 'tree-trunk', props.treeTrunk, 700);
  const treeCrown = L(vegGroup, 'tree-crown', props.treeCrown, 2200);
  const bush = L(vegGroup, 'bush', icProps.bush, 520);
  const rf = rng(hashString('customs-forest'));
  for (const poly of svg.polygons('Trees', { minArea: 20 })) {
    const { bounds } = ringInfo(poly.outer);
    for (let x = bounds.x0 + 2; x < bounds.x1 && stats.trees < 16000; x += 5) {
      for (let z = bounds.z0 + 2; z < bounds.z1; z += 5) {
        const p = { x: x + (rf() - 0.5) * 4.5, z: z + (rf() - 0.5) * 4.5 };
        if (rf() > 0.8 || !pointInPolygon(p, poly) || inWater(p) || inFootprint(p) || onRoad(p, 1.5)) continue;
        const y = ground(p.x, p.z) - 0.1;
        const k = 0.75 + rf() * 0.6;
        const ang = rf() * Math.PI * 2;
        if (rf() < 0.6) {
          coniferTrunk.add(composeMatrix(p.x, y, p.z, ang, k, k, k));
          coniferCrown.add(composeMatrix(p.x, y, p.z, ang, k, k * (0.85 + rf() * 0.35), k), new THREE.Color(pick(rf, CONIFER)));
        } else {
          treeTrunk.add(composeMatrix(p.x, y, p.z, ang, k, k, k));
          treeCrown.add(composeMatrix(p.x, y, p.z, ang, k, k * (0.85 + rf() * 0.3), k), new THREE.Color(pick(rf, LEAF)));
        }
        stats.trees += 1;
        // undergrowth
        if (rf() < 0.35 && stats.bushes < 9000) {
          const q = { x: p.x + (rf() - 0.5) * 3, z: p.z + (rf() - 0.5) * 3 };
          const kb = 0.5 + rf() * 0.5;
          bush.add(composeMatrix(q.x, ground(q.x, q.z) - 0.05, q.z, rf() * Math.PI * 2, kb, kb * (0.7 + rf() * 0.5), kb), new THREE.Color(pick(rf, BUSH)));
          stats.bushes += 1;
        }
      }
    }
    const ring = poly.outer;
    const own = { outer: ring, holes: [] };
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.5 || stats.bushes >= 9000) return;
      const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      let out = { x: dir.z, z: -dir.x };
      if (pointInPolygon(off(off(a, dir, len / 2), out, 1), own)) out = { x: -out.x, z: -out.z };
      for (let s = rf() * 6; s < len; s += 6) {
        const p = off(off(a, dir, s), out, 1.5 + rf() * 2.5);
        if (inWater(p) || inFootprint(p) || onRoad(p, 0.8)) continue;
        const k = 0.6 + rf() * 0.7;
        bush.add(composeMatrix(p.x, ground(p.x, p.z) - 0.05, p.z, rf() * Math.PI * 2, k, k * (0.7 + rf() * 0.5), k), new THREE.Color(pick(rf, BUSH)));
        stats.bushes += 1;
      }
    });
  }

  lap('rocksForest');
  // ---- fences, roads and bridges, paths
  buildFences(ctx, parts, footprints);
  lap('fences');
  buildRoads(ctx, parts);
  lap('roads');
  buildPaths(ctx, parts, doors);
  lap('paths');

  // ---- power line towers and wires
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

  // ---- railway on its embankment: ballast, rails, sleepers, a few freight wagons
  const rails = new MeshBucket();
  const sleeperGeo = new THREE.BoxGeometry(0.26, 0.16, 2.6).translate(0, 0.08, 0);
  sleeperGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(sleeperGeo.attributes.position.count * 3).fill(0.36), 3));
  const sleeper = L(propsGroup, 'sleeper', sleeperGeo, 320, materials.metal);
  const wagon = L(propsGroup, 'wagon', icProps.wagon, 1400);
  const rw = rng(hashString('customs-rail'));
  for (const s of svg.strokes('Railway')) {
    for (const line of s.lines) {
      const pts = [];
      for (let i = 0; i < line.length - 1; i += 1) {
        const a = line[i];
        const b = line[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const n = Math.max(1, Math.ceil(len / 2));
        for (let k = 0; k < n; k += 1) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
      }
      pts.push(line[line.length - 1]);
      for (let i = 0; i < pts.length - 1; i += 1) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.05) continue;
        const nx = -(b.z - a.z) / len;
        const nz = (b.x - a.x) / len;
        const ya = ground(a.x, a.z);
        const yb = ground(b.x, b.z);
        stripSloped(rails, a, b, 3.6, ya + 0.05, yb + 0.05, C.ballast);
        for (const o of [-0.76, 0.76]) stripSloped(rails, { x: a.x + nx * o, z: a.z + nz * o }, { x: b.x + nx * o, z: b.z + nz * o }, 0.1, ya + 0.24, yb + 0.24, C.rail);
        stats.railSegments += 1;
      }
      walkLine(line, 0.7, (p, dir) => sleeper.add(composeMatrix(p.x, ground(p.x, p.z) + 0.05, p.z, alongX(dir))));
      walkLine(line, 90, (p, dir) => {
        if (rw() < 0.45) wagon.add(composeMatrix(p.x, ground(p.x, p.z) + 0.25, p.z, alongX(dir)), new THREE.Color(pick(rw, ['#6a4533', '#4e5a3c', '#5a5f63'])));
      }, 40);
    }
  }
  addMesh(propsGroup, rails, materials.metal, 'railway');

  // ---- telegraph poles and abandoned cars along the roads
  const pole = L(propsGroup, 'pole', ctx.csModels.pole, 900);
  const rc = rng(hashString('customs-wrecks'));
  const placements = [];
  for (const id of ['Main_Roads', 'High_Roads', 'Roads']) {
    for (const s of svg.strokes(id)) {
      for (const line of s.lines) {
        walkLine(line, 40, (p, dir) => {
          const q = off(p, { x: dir.z, z: -dir.x }, s.width / 2 + 5.5);
          if (inWater(q) || inFootprint(q) || onRoad(q, 1)) return;
          pole.add(composeMatrix(q.x, ground(q.x, q.z) - 0.1, q.z, alongX({ x: -dir.z, z: dir.x })));
          stats.poles = (stats.poles || 0) + 1;
        }, 20);
        walkLine(line, 34, (p, dir) => {
          if (rc() > (id === 'Roads' ? 0.25 : 0.45)) return;
          const shoulder = (rc() < 0.5 ? -1 : 1) * (s.width / 2 - 1.1 + rc() * 2.2);
          const q = off(p, { x: dir.z, z: -dir.x }, shoulder);
          if (inWater(q) || inFootprint(q)) return;
          const heading = alongX(dir) + (rc() < 0.5 ? Math.PI : 0) + (rc() - 0.5) * 0.9;
          placements.push({ x: q.x, y: ground(q.x, q.z), z: q.z, heading, model: pick(rc, [...CAR_MODELS, 'van', 'truck']), paint: rc() < 0.7 ? pick(rc, WRECK) : pick(rc, CAR_PAINTS), wreck: true });
          stats.wrecks += 1;
        }, 15);
      }
    }
  }

  // ---- yards (parked cars, trucks, containers, clutter), fuel canopies, bus stop, tall grass
  lap('railPolesWrecks');
  buildYards(ctx, parts, footprints, doors, placements);
  lap('yards');
  buildLandmarks(ctx, parts, placements);
  buildGrass(ctx, parts);
  lap('grass');

  // ---- data: cars at trunk locks and V-Ex, stationary weapons, checkpoints, minefield signs
  for (const v of env.vehicles || []) {
    const p = { x: -v.position.x, z: v.position.z };
    const near = pathGrid.nearest(p, 30);
    let heading = rc() * Math.PI * 2;
    if (near) {
      const len = Math.hypot(near.seg.b.x - near.seg.a.x, near.seg.b.z - near.seg.a.z) || 1;
      heading = alongX({ x: (near.seg.b.x - near.seg.a.x) / len, z: (near.seg.b.z - near.seg.a.z) / len });
    }
    const y = v.position.y != null ? Math.max(ground(p.x, p.z) - 0.3, v.position.y - 0.9) : ground(p.x, p.z);
    placements.push({ x: p.x, y, z: p.z, heading, model: pick(rc, CAR_MODELS), paint: pick(rc, CAR_PAINTS) });
  }
  layers.push(...buildCars(carGroup, placements, ctx, { share: 0.3, max: 9, onlyWrecks: true }));
  stats.cars = placements.length;
  const sandbags = L(propsGroup, 'sandbags', props.sandbags, 600);
  const gun = L(propsGroup, 'gun', props.gun, 400);
  for (const w of env.emplacements || []) {
    sandbags.add(composeMatrix(-w.position.x, w.position.y - 0.1, w.position.z, 0));
    gun.add(composeMatrix(-w.position.x, w.position.y - 0.1, w.position.z, rc() * Math.PI * 2));
  }
  const barrier = L(propsGroup, 'barrier', props.barrier, 700);
  const jersey = L(propsGroup, 'jersey', props.jersey, 600);
  for (const cp of env.checkpoints || []) {
    const p = { x: -cp.position.x, z: cp.position.z };
    const near = pathGrid.nearest(p, 25);
    let rot = 0;
    if (near) {
      const len = Math.hypot(near.seg.b.x - near.seg.a.x, near.seg.b.z - near.seg.a.z) || 1;
      rot = alongX({ x: -(near.seg.b.z - near.seg.a.z) / len, z: (near.seg.b.x - near.seg.a.x) / len });
    }
    barrier.add(composeMatrix(p.x, ground(p.x, p.z), p.z, rot));
    for (const k of [-2, -1, 1, 2]) {
      const q = { x: p.x + Math.cos(rot) * k * 3.1, z: p.z - Math.sin(rot) * k * 3.1 };
      jersey.add(composeMatrix(q.x, ground(q.x, q.z), q.z, rot));
    }
  }
  const mineSign = L(propsGroup, 'sign-mines', props.signMines, 520);
  for (const m of env.minefields || []) {
    const pts = (m.outline && m.outline.length ? m.outline : [m.position]).map((q) => ({ x: -q.x, z: q.z }));
    for (const q of pts) mineSign.add(composeMatrix(q.x, ground(q.x, q.z), q.z, rc() * Math.PI));
    stats.mineSigns += pts.length;
  }

  // ---- loot containers on the ground and doors at key locks
  const wallSegs = footprints.flatMap((f) => [f.poly.outer, ...f.poly.holes]).flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] })));
  const extra = floorProps(ctx, 'OUTSIDE', propsGroup, { walls: new SegmentGrid(wallSegs, 24), groundAt: ground });
  layers.push(...extra.layers);
  stats.containers = extra.containers;
  stats.doors = extra.doors;

  lap('rest');
  for (const l of layers) if (!l.cells.length) l.build();
  lap('instancing');
  stats.ms = T;
  return { group, ground: ground3d, built, props: propsGroup, cars: carGroup, vegetation: vegGroup, layers, stats, inWater, inFootprint, onRoad, terrainMesh };
}

// ---------------------------------------------------------------- building levels
// Floor height of one plan shape: the most common height of this floor's loot and spawns inside it (the data), else the
// ground under it (+ storeys). Returns game meters.
function floorHeight(ctx, id, poly) {
  const { mapData, ground } = ctx;
  const ys = [];
  const b = ringInfo(poly.outer).bounds;
  const test = (e) => {
    if (e.floor !== id || !e.position || e.position.y == null) return;
    const p = { x: -e.position.x, z: e.position.z };
    if (p.x < b.x0 - 1 || p.x > b.x1 + 1 || p.z < b.z0 - 1 || p.z > b.z1 + 1) return;
    if (pointInPolygon(p, poly)) ys.push(e.position.y);
  };
  for (const e of mapData.loot) test(e);
  for (const e of mapData.entities) test(e);
  let high = -Infinity;
  for (const p of poly.outer) high = Math.max(high, ground(p.x, p.z));
  const base = high + 0.15;
  const fallback = { UNDERGROUND: base - 3.4, LEVEL1: base, LEVEL2: base + 3.3, LEVEL3: base + 6.6 }[id];
  if (!ys.length) return fallback;
  ys.sort((a, c) => a - c);
  // loose loot lies on the floor, containers stand on it: the lower quartile is the floor
  const y = ys[Math.floor(ys.length / 4)] - 0.05;
  // guard against a stray point from another storey
  return Math.abs(y - fallback) > 2.6 && id !== 'UNDERGROUND' ? fallback : y;
}

function stairs(bucket, poly, rise) {
  const info = ringInfo(poly.outer);
  const bx = info.bounds.x1 - info.bounds.x0;
  const bz = info.bounds.z1 - info.bounds.z0;
  const along = bx >= bz;
  const long = along ? bx : bz;
  const wide = along ? bz : bx;
  if (long < 0.6 || wide < 0.3) return 0;
  const steps = Math.max(4, Math.round(rise / 0.2));
  const tread = long / steps;
  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) * tread;
    const cx = along ? info.bounds.x0 + t : info.center.x;
    const cz = along ? info.center.z : info.bounds.z0 + t;
    box(bucket, cx, 0, cz, along ? tread : wide, ((i + 1) / steps) * rise, along ? wide : tread, 0, C.stair, C.stairTop);
  }
  return 1;
}

export function buildLevel(ctx, id) {
  const { svg, heights, materials } = ctx;
  const def = CUSTOMS_LEVELS[id];
  const base = heights[id];
  const group = new THREE.Group();
  group.name = id;
  const walls = new THREE.Group();
  group.add(walls);
  const floors = polygonsExcept(svg, def.floors, def.locked, { minArea: 1.5 });
  const stats = { floorParts: floors.length, partitions: 0, blocks: 0, voids: 0, locked: 0, stairs: 0 };
  const floorB = new MeshBucket(ctx.planUvFor ? ctx.planUvFor(id) : ctx.planUv);
  const under = new MeshBucket();
  const wallB = new MeshBucket();
  const lockedB = new MeshBucket();
  const stairB = new MeshBucket();
  const bunker = id === 'UNDERGROUND';
  const hi = bunker ? C.bunker : C.wall;
  const lo = bunker ? C.bunkerLow : C.wallLow;
  const next = ORDER[ORDER.indexOf(id) + 1];
  const slabs = [];
  for (const poly of floors) {
    const y = floorHeight(ctx, id, poly) - base; // local height inside the level group
    slabs.push({ poly, y });
    slab(floorB, poly, y + 0.02, WHITE);
    slab(under, poly, y - 0.3, C.underside, { down: true });
    ringWalls(under, poly.outer, y - 0.3, y, C.underside);
    ringWalls(wallB, poly.outer, y, y + def.storey, lo, hi);
    for (const hole of poly.holes) {
      const info = ringInfo(hole);
      if (info.width <= 1.3) {
        ringWalls(wallB, hole, y, y + def.storey - 0.1, C.partitionLow, C.partition);
        slab(wallB, { outer: hole, holes: [] }, y + def.storey - 0.1, C.partition);
        stats.partitions += 1;
      } else if (info.area <= 120) {
        ringWalls(wallB, hole, y, y + def.storey, C.block, C.block);
        slab(wallB, { outer: hole, holes: [] }, y + def.storey, C.blockTop);
        stats.blocks += 1;
      } else {
        ringWalls(wallB, hole, y, y + def.storey, lo, hi);
        stats.voids += 1;
      }
    }
  }
  const levelAt = (p) => {
    const s = slabs.find((q) => pointInPolygon(p, q.poly));
    return s ? s.y : null;
  };
  for (const lid of def.locked) {
    for (const poly of svg.polygons(lid, { minArea: 1 })) {
      const y = levelAt(centroid(poly.outer)) ?? (floorHeight(ctx, id, poly) - base);
      slab(lockedB, poly, y + 0.06, C.locked);
      ringWalls(wallB, poly.outer, y, y + def.storey, C.locked, C.locked);
      stats.locked += 1;
    }
  }
  const rise = next ? Math.max(2.6, Math.min(3.6, heights[next] - heights[id])) : def.storey;
  for (const gid of def.ladders) {
    for (const poly of [...svg.polygons(gid, { minArea: 0.3 }), ...usePolygons(svg, gid)]) {
      const y = levelAt(centroid(poly.outer));
      const bucket = new MeshBucket();
      const n = stairs(bucket, poly, bunker ? 3.2 : 3.3);
      if (!n) continue;
      // shift the steps to the floor they start on
      const g = bucket.geometry();
      g.translate(0, y ?? 0, 0);
      const mesh = new THREE.Mesh(g, materials.solid);
      mesh.name = `${id}-stairs`;
      group.add(mesh);
      stats.stairs += 1;
    }
  }
  addMesh(group, floorB, materials.plan[id], `${id}-floor`);
  addMesh(group, under, materials.solid, `${id}-underside`);
  addMesh(group, lockedB, materials.solid, `${id}-locked`);
  addMesh(walls, wallB, materials.solid, `${id}-walls`);
  stats.rise = +rise.toFixed(2);

  // loot containers and doors of this floor: at their real heights (groundAt gives the slab under them)
  const wallSegs = floors.flatMap((p) => [p.outer, ...p.holes]).flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] })));
  // floorProps works in game heights: a child group shifted by -base keeps them absolute inside the level group
  const abs = new THREE.Group();
  abs.name = `${id}-props`;
  abs.position.y = -base;
  group.add(abs);
  const guess = { UNDERGROUND: -3.4, LEVEL1: 0.15, LEVEL2: 3.45, LEVEL3: 6.75 }[id];
  const groundAt = (x, z) => {
    const y = levelAt({ x, z });
    return y == null ? ctx.ground(x, z) + guess : y + base + 0.02;
  };
  const levelProps = floorProps(ctx, id, abs, { baseY: 0, groundY: 0.02, walls: new SegmentGrid(wallSegs, 16), groundAt });
  stats.containers = levelProps.containers;
  stats.doors = levelProps.doors;
  return { group, walls, layers: levelProps.layers, stats };
}
