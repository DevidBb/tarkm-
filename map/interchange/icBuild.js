// Interchange model builders.
// From the SVG map (Shebuka / tarkov.dev): garage floor and walls, mall floor plans with every wall and closed room,
// atrium voids, decks, stairs / escalators / car ramps with their real direction, footprints of outside buildings,
// roads, rocks, fences, rails, power-line towers and lines. From tarkov.dev data: cars at trunk locks, the V-Ex car,
// stationary weapons, minefields, the checkpoint.
// Approximate on purpose (and said so in the README): garage column grid and stall lines, wall heights, parked cars
// without data, street lamps and highway barriers along the real roads.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { mergeGeometries } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js/+esm';
import { MeshBucket, ringWalls, slab, box, strip, railing, ringInfo, color } from './icKit.js';
import { InstancedLayer, composeMatrix } from '../city/instancing.js';
import { rng, hashString, pick, pointInPolygon, pointInRing, distToSegment, centroid, SegmentGrid } from '../city/util.js';
import { buildMallExterior } from './icExterior.js';
import { buildStreetDetail, floorProps } from './icStreetDetail.js';
import { CAR_PAINTS, CAR_MODELS } from './icModels.js';

const SLAB = 0.45;
const WHITE = color('#ffffff');
const C = {
  garageBase: color('#2f302d'), concrete: color('#b9b5ac'), concreteLow: color('#8a867d'),
  wall: color('#ddd8cc'), wallLow: color('#aaa498'), partition: color('#d2ccc0'), partitionLow: color('#a29c90'),
  block: color('#6f6c66'), blockTop: color('#4b4945'), paint: color('#ebe7d8'), deck: color('#a9a59b'),
  underside: color('#57554f'), stair: color('#a39f97'), stairTop: color('#cdc8bd'), esc: color('#596064'), escTop: color('#8e959a'),
  building: color('#8f8b83'), buildingTop: color('#5b5954'), station: color('#8d887c'),
};
const CONTAINER_COLORS = ['#6e4a3a', '#3f5670', '#4f6150', '#7a6a3f', '#8c8f8a', '#9a3b2f'];

const alongX = (dir) => Math.atan2(-dir.z, dir.x); // instance +X along dir

function ringEdges(rings) {
  const out = [];
  for (const ring of rings) ring.forEach((a, i) => out.push({ a, b: ring[(i + 1) % ring.length] }));
  return out;
}

function walk(line, step, fn, offset = step / 2) {
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

const addMesh = (parent, bucket, material, name) => {
  const mesh = bucket.mesh(material);
  if (mesh) {
    mesh.name = name;
    parent.add(mesh);
  }
  return mesh;
};

// ---------------------------------------------------------------- stairs, escalators, ramps
const RAMP_GROUPS = [
  { id: 'Ramps', layer: 0 },
  { id: 'Big_Ramps', layer: 0, big: true },
  { id: 'Ramps-1', layer: 1 },
  { id: 'Ramps-2', layer: 2 },
];

// Each staircase is drawn on both layers it joins (lower: "up", upper: "down"): the pieces are merged into one flight.
export function collectFlights(svg, inMall) {
  const segs = [];
  for (const def of RAMP_GROUPS) {
    for (const s of svg.strokes(def.id)) {
      if (!s.gradient) continue;
      if (def.id === 'Ramps' && s.el.closest('[id="Big_Ramps"]')) continue; // subgroup, read on its own as truck ramps
      const line = s.lines[0];
      const a = line[0];
      const b = line[line.length - 1];
      const da = Math.hypot(a.x - s.gradient.top.x, a.z - s.gradient.top.z);
      const db = Math.hypot(b.x - s.gradient.top.x, b.z - s.gradient.top.z);
      segs.push({ low: da > db ? a : b, high: da > db ? b : a, width: s.width, lower: s.gradient.up ? def.layer : def.layer - 1, big: Boolean(def.big) });
    }
  }
  const along = (f, p) => (p.x - f.origin.x) * f.u.x + (p.z - f.origin.z) * f.u.z;
  const lateral = (f, p) => Math.abs(-(p.x - f.origin.x) * f.u.z + (p.z - f.origin.z) * f.u.x);
  const flights = [];
  for (const s of segs) {
    if (s.lower < 0) continue;
    const len = Math.hypot(s.high.x - s.low.x, s.high.z - s.low.z);
    if (len < 0.5) continue;
    const u = { x: (s.high.x - s.low.x) / len, z: (s.high.z - s.low.z) / len };
    const match = flights.find((f) => {
      if (f.lower !== s.lower || f.u.x * u.x + f.u.z * u.z < 0.96) return false;
      if (lateral(f, s.low) > 2.5 || lateral(f, s.high) > 2.5) return false;
      const t0 = along(f, s.low);
      const t1 = along(f, s.high);
      return Math.max(0, Math.min(t0, t1) - f.t1, f.t0 - Math.max(t0, t1)) < 3;
    });
    if (match) {
      const t0 = along(match, s.low);
      const t1 = along(match, s.high);
      match.t0 = Math.min(match.t0, t0, t1);
      match.t1 = Math.max(match.t1, t0, t1);
      match.width = Math.max(match.width, s.width);
      match.parts += 1;
    } else {
      flights.push({ lower: s.lower, big: s.big, width: s.width, origin: s.low, u, t0: 0, t1: len, parts: 1 });
    }
  }
  return flights.map((f) => {
    const low = { x: f.origin.x + f.u.x * f.t0, z: f.origin.z + f.u.z * f.t0 };
    const high = { x: f.origin.x + f.u.x * f.t1, z: f.origin.z + f.u.z * f.t1 };
    let lowerId = f.lower === 1 ? 'LEVEL1' : 'LEVEL2';
    if (f.lower === 0) lowerId = !f.big && inMall(low) ? 'PARKING' : 'STREET';
    const upperId = f.lower === 0 ? 'LEVEL1' : 'LEVEL2';
    const kind = f.big ? 'ramp' : f.lower >= 1 ? 'escalator' : 'stairs';
    return { low, high, width: f.width, lowerId, upperId, kind, parts: f.parts };
  });
}

// Geometry of a flight rises from y = 0 (lower floor) to y = 1 (upper floor); the layer scales it to the real
// or exploded height difference.
export function buildFlightMeshes(flights, heights, materials) {
  return flights.map((f) => {
    const bucket = new MeshBucket();
    const len = Math.hypot(f.high.x - f.low.x, f.high.z - f.low.z);
    const u = { x: (f.high.x - f.low.x) / len, z: (f.high.z - f.low.z) / len };
    const n = { x: -u.z, z: u.x };
    const rise = Math.max(0.5, heights[f.upperId] - heights[f.lowerId]);
    const rot = Math.atan2(u.x, u.z);
    const w = f.width;
    const at = (t, side) => ({ x: f.low.x + u.x * t + n.x * side, z: f.low.z + u.z * t + n.z * side });
    if (f.kind === 'ramp') {
      const a0 = at(0, -w / 2);
      const a1 = at(0, w / 2);
      const b0 = at(len, -w / 2);
      const b1 = at(len, w / 2);
      bucket.quad([a0.x, 0, a0.z], [a1.x, 0, a1.z], [b1.x, 1, b1.z], [b0.x, 1, b0.z], [0, 1, 0], C.deck);
      const h = 0.9 / rise;
      for (const [p, q, side] of [[a0, b0, -1], [a1, b1, 1]]) {
        const nn = [n.x * side, 0, n.z * side];
        bucket.tri([p.x, 0, p.z], [q.x, 1, q.z], [q.x, 0, q.z], nn, C.underside);
        bucket.quad([p.x, 0, p.z], [q.x, 1, q.z], [q.x, 1 + h, q.z], [p.x, h, p.z], nn, C.concrete);
      }
    } else {
      const escalator = f.kind === 'escalator';
      const steps = Math.max(6, Math.round(rise / (escalator ? 0.2 : 0.17)));
      const tread = len / steps;
      for (let i = 0; i < steps; i += 1) {
        const mid = at((i + 0.5) * tread, 0);
        box(bucket, mid.x, 0, mid.z, escalator ? w * 0.84 : w, (i + 1) / steps, tread, rot, escalator ? C.esc : C.stair, escalator ? C.escTop : C.stairTop);
      }
      const h = 1.0 / rise;
      const off = w * (escalator ? 0.45 : 0.5);
      for (const side of [-1, 1]) {
        const p = at(0, off * side);
        const q = at(len, off * side);
        bucket.quad([p.x, 0, p.z], [q.x, 1, q.z], [q.x, 1 + h, q.z], [p.x, h, p.z], [n.x * side, 0, n.z * side], escalator ? C.esc : C.concrete);
      }
    }
    const mesh = new THREE.Mesh(bucket.geometry(), materials.solid);
    mesh.name = `flight-${f.kind}`;
    return { flight: f, mesh };
  });
}

// ---------------------------------------------------------------- cars
// burn: { share, max, onlyWrecks } - some wrecks burn (ctx.fx, map/fx/ambience.js); call before instancing.
export function buildCars(parent, placements, ctx, burn = null) {
  const { cars: models, materials } = ctx;
  if (burn && ctx.fx) ctx.fx.cars(placements, burn);
  const layers = [];
  const byModel = new Map();
  const near = (name, geometry, material) => {
    const l = new InstancedLayer(parent, { name, geometry, material, maxDistance: 260 });
    layers.push(l);
    return l;
  };
  const far = new InstancedLayer(parent, { name: 'car-far', geometry: models.farBox, material: materials.carBody, minDistance: 260 });
  layers.push(far);
  for (const pl of placements) {
    const m = models[pl.model];
    if (!m) continue;
    if (!byModel.has(pl.model)) {
      byModel.set(pl.model, {
        body: near(`${pl.model}-body`, m.body, materials.carBody),
        glass: near(`${pl.model}-glass`, m.glass, materials.carGlass),
        detail: near(`${pl.model}-detail`, m.detail, materials.props),
        decal: m.decal ? near(`${pl.model}-decal`, m.decal, materials.props) : null,
      });
    }
    const lay = byModel.get(pl.model);
    const matrix = composeMatrix(pl.x, pl.y, pl.z, pl.heading);
    const col = new THREE.Color(pl.paint);
    lay.body.add(matrix, col);
    if (!pl.burned) lay.glass.add(matrix);
    lay.detail.add(matrix);
    if (lay.decal && !pl.burned) lay.decal.add(matrix);
    far.add(composeMatrix(pl.x, pl.y + 0.3, pl.z, pl.heading, m.length, m.height * 0.8, m.width), col.clone());
  }
  for (const l of layers) l.build();
  return layers;
}

const dataVehicles = (ctx, floorId) => ((ctx.environment && ctx.environment.vehicles) || [])
  .filter((v) => v.floor === floorId)
  .map((v) => ({ ...ctx.game2(v.position), y: v.position.y, id: v.id }));

// ---------------------------------------------------------------- parking garage
export function buildParking(ctx) {
  const { svg, heights, materials, mall, flights } = ctx;
  const H = Math.max(3, heights.LEVEL1 - SLAB - heights.PARKING);
  const group = new THREE.Group();
  group.name = 'PARKING';
  const walls = new THREE.Group();
  group.add(walls);
  const garage = svg.polygons('Garage', { minArea: 20 });
  const stats = { garageParts: garage.length, columns: 0, stalls: 0, blocks: 0, cars: 0, dataCars: 0 };

  const base = new MeshBucket();
  slab(base, mall.poly, -0.04, C.garageBase);
  const floor = new MeshBucket(ctx.planUv.PARKING);
  for (const g of garage) slab(floor, g, 0.01, WHITE);

  const wallB = new MeshBucket();
  for (const g of garage) for (const ring of [g.outer, ...g.holes]) ringWalls(wallB, ring, 0, H, C.concreteLow, C.concrete);
  for (const b of ctx.buildingsInside) {
    ringWalls(wallB, b.outer, 0, H, C.block, C.block);
    slab(wallB, { outer: b.outer, holes: [] }, H, C.blockTop);
    stats.blocks += 1;
  }

  const edges = ringEdges(garage.flatMap((g) => [g.outer, ...g.holes]));
  const grid = new SegmentGrid(edges, 16);
  const inGarage = (p) => garage.some((g) => pointInPolygon(p, g));
  const nearFlight = (p, pad) => flights.some((f) => distToSegment(p, f.low, f.high).d < f.width / 2 + pad);

  // Columns: regular 8.1 m grid inside the garage (the SVG does not draw them).
  const cols = new MeshBucket();
  const xs = garage.flatMap((g) => g.outer.map((p) => p.x));
  const zs = garage.flatMap((g) => g.outer.map((p) => p.z));
  for (let x = Math.min(...xs) + 4; x < Math.max(...xs); x += 8.1) {
    for (let z = Math.min(...zs) + 4; z < Math.max(...zs); z += 8.1) {
      const p = { x, z };
      if (!inGarage(p) || grid.nearest(p, 2.4) || nearFlight(p, 2)) continue;
      box(cols, x, 0, z, 0.7, H, 0.7, 0, C.concrete);
      stats.columns += 1;
    }
  }

  // Stall lines along the garage walls (approximate layout).
  const paint = new MeshBucket();
  const stalls = [];
  for (const e of edges) {
    const len = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z);
    if (len < 8) continue;
    const dir = { x: (e.b.x - e.a.x) / len, z: (e.b.z - e.a.z) / len };
    const inward = { x: -dir.z, z: dir.x };
    const probe = { x: (e.a.x + e.b.x) / 2 + inward.x * 3, z: (e.a.z + e.b.z) / 2 + inward.z * 3 };
    if (!inGarage(probe)) continue;
    for (let s = 1.5; s <= len - 1.5; s += 2.7) {
      const p = { x: e.a.x + dir.x * s + inward.x * 0.35, z: e.a.z + dir.z * s + inward.z * 0.35 };
      const q = { x: p.x + inward.x * 5, z: p.z + inward.z * 5 };
      if (!inGarage(q) || nearFlight(q, 1)) continue;
      strip(paint, p, q, 0.12, 0.03, C.paint);
      stats.stalls += 1;
      if (s + 2.7 <= len - 1.5) stalls.push({ x: p.x + dir.x * 1.35 + inward.x * 2.55, z: p.z + dir.z * 1.35 + inward.z * 2.55, dir: inward });
    }
  }

  addMesh(group, base, materials.solid, 'garage-base');
  addMesh(group, floor, materials.plan.PARKING, 'garage-floor');
  addMesh(group, paint, materials.solid, 'garage-paint');
  addMesh(walls, wallB, materials.solid, 'garage-walls');
  addMesh(walls, cols, materials.solid, 'garage-columns');

  const r = rng(hashString('interchange-parking'));
  const placements = [];
  for (const v of dataVehicles(ctx, 'PARKING')) {
    const near = grid.nearest(v, 30);
    const dir = near ? { x: near.seg.b.x - near.seg.a.x, z: near.seg.b.z - near.seg.a.z } : { x: 1, z: 0 };
    const len = Math.hypot(dir.x, dir.z) || 1;
    placements.push({ x: v.x, y: 0, z: v.z, heading: alongX({ x: dir.x / len, z: dir.z / len }), model: pick(r, CAR_MODELS), paint: pick(r, CAR_PAINTS) });
    stats.dataCars += 1;
  }
  for (const s of stalls) {
    if (r() > 0.12) continue;
    placements.push({ x: s.x, y: 0, z: s.z, heading: alongX(s.dir) + (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.08, model: pick(r, CAR_MODELS), paint: pick(r, CAR_PAINTS) });
  }
  const carGroup = new THREE.Group();
  carGroup.name = 'garage-cars';
  group.add(carGroup);
  const layers = buildCars(carGroup, placements, ctx);
  stats.cars = placements.length;
  const extra = floorProps(ctx, 'PARKING', group, { baseY: heights.PARKING, groundY: 0.02, walls: grid });
  stats.props = { containers: extra.containers, doors: extra.doors };
  return { group, walls, cars: carGroup, props: null, layers: [...layers, ...extra.layers], stats };
}

// ---------------------------------------------------------------- mall floors
function floorUnderside(bucket, polys) {
  for (const p of polys) {
    slab(bucket, { outer: p.outer, holes: [] }, -SLAB, C.underside, { down: true });
    ringWalls(bucket, p.outer, -SLAB, 0, C.underside);
  }
}

function holeTouchesFlights(hole, flights) {
  return flights.some((f) => [0.2, 0.5, 0.8].some((t) => pointInRing({ x: f.low.x + (f.high.x - f.low.x) * t, z: f.low.z + (f.high.z - f.low.z) * t }, hole)));
}

function buildMallFloor(ctx, { id, svgFloor, height, partition, voids, extra }) {
  const { svg, materials, flights } = ctx;
  const group = new THREE.Group();
  group.name = id;
  const walls = new THREE.Group();
  group.add(walls);
  const floors = svg.polygons(svgFloor, { minArea: 5 });
  const stats = { floorParts: floors.length, walls: 0, rooms: 0, voids: 0 };
  const floorB = new MeshBucket(ctx.planUv[id]);
  const under = new MeshBucket();
  const wallB = new MeshBucket();
  const glass = new MeshBucket();
  const metal = new MeshBucket();
  const related = flights.filter((f) => f.upperId === id || f.lowerId === id);

  for (const poly of floors) {
    slab(floorB, poly, 0.02, WHITE);
    ringWalls(wallB, poly.outer, 0, height, C.wallLow, C.wall);
    for (const hole of poly.holes) {
      const info = ringInfo(hole);
      const isVoid = holeTouchesFlights(hole, related) || (voids && voids.some((v) => pointInRing(info.center, v)));
      if (isVoid) {
        railing(glass, metal, hole, 0, 1.1);
        stats.voids += 1;
      } else if (info.width <= 1.3) {
        ringWalls(wallB, hole, 0, partition, C.partitionLow, C.partition);
        slab(wallB, { outer: hole, holes: [] }, partition, C.partition);
        stats.walls += 1;
      } else {
        ringWalls(wallB, hole, 0, height, C.block, C.block);
        slab(wallB, { outer: hole, holes: [] }, height, C.blockTop);
        stats.rooms += 1;
      }
    }
  }
  floorUnderside(under, floors);
  if (extra) extra({ group, glass, metal, under, stats });

  addMesh(group, floorB, materials.plan[id], `${id}-floor`);
  addMesh(group, under, materials.solid, `${id}-underside`);
  addMesh(walls, wallB, materials.solid, `${id}-walls`);
  addMesh(group, glass, materials.glass, `${id}-glass`);
  addMesh(group, metal, materials.metal, `${id}-rails`);
  const wallGrid = new SegmentGrid(ringEdges(floors.flatMap((p) => [p.outer, ...p.holes])), 16);
  const levelProps = floorProps(ctx, id, group, { baseY: ctx.heights[id], groundY: 0.02, walls: wallGrid });
  stats.props = { containers: levelProps.containers, doors: levelProps.doors };
  return { group, walls, cars: null, props: null, layers: levelProps.layers, stats };
}

export function buildLevel1(ctx) {
  const { heights, svg, materials } = ctx;
  const height = Math.max(3, heights.LEVEL2 - SLAB - heights.LEVEL1);
  return buildMallFloor(ctx, {
    id: 'LEVEL1',
    svgFloor: 'Floor-1',
    height,
    partition: Math.min(5.5, height),
    voids: null,
    extra: ({ group, glass, metal, stats }) => {
      // Outdoor decks on the first-floor level (SVG "Pavament-1") with their balustrades.
      const decks = svg.polygons('Pavament-1', { minArea: 20 });
      const deck = new MeshBucket();
      for (const d of decks) {
        slab(deck, d, 0, C.deck);
        slab(deck, { outer: d.outer, holes: [] }, -SLAB, C.underside, { down: true });
        ringWalls(deck, d.outer, -SLAB, 0, C.underside);
        railing(glass, metal, d.outer, 0, 1.1);
      }
      addMesh(group, deck, materials.solid, 'LEVEL1-decks');
      stats.decks = decks.length;
    },
  });
}

export function buildLevel2(ctx) {
  const { svg, materials } = ctx;
  // The mall roof outline on this layer has holes exactly where the atria and escalator wells are.
  const roofs = svg.polygons('Structure-2', { minArea: 50 });
  const voids = roofs.flatMap((p) => p.holes);
  return buildMallFloor(ctx, {
    id: 'LEVEL2',
    svgFloor: 'Floor-2',
    height: 6,
    partition: 4.5,
    voids,
    extra: ({ group, stats }) => {
      const roof = new MeshBucket();
      for (const p of roofs) slab(roof, p, -0.1, color('#ffffff'));
      addMesh(group, roof, materials.roof, 'LEVEL2-roof-around');
      stats.voidOutlines = voids.length;
    },
  });
}

// ---------------------------------------------------------------- outside
export function pylonGeometry() {
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const beam = (a, b, r) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    if (len < 0.01) return;
    const g = new THREE.CylinderGeometry(r, r, len, 4, 1, true);
    g.deleteAttribute('uv');
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, vb.clone().sub(va).normalize()));
    g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
    parts.push(g.toNonIndexed());
  };
  const Hgt = 27;
  const leg = (y) => 2.8 - (y / Hgt) * 2.1;
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [sx, sz] of corners) beam([sx * leg(0), 0, sz * leg(0)], [sx * leg(Hgt), Hgt, sz * leg(Hgt)], 0.14);
  for (const y of [6, 12, 18, 23]) {
    for (let i = 0; i < 4; i += 1) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      beam([ax * leg(y), y, az * leg(y)], [bx * leg(y), y, bz * leg(y)], 0.07);
      const y2 = y + 6 > Hgt ? Hgt : y + 6;
      beam([ax * leg(y), y, az * leg(y)], [bx * leg(y2), y2, bz * leg(y2)], 0.05);
    }
  }
  beam([-8, 21, 0], [8, 21, 0], 0.12);
  beam([-5.5, 25, 0], [5.5, 25, 0], 0.1);
  beam([0, Hgt, 0], [0, Hgt + 2.5, 0], 0.08);
  const g = mergeGeometries(parts, false);
  const steel = color('#7b807c');
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => [steel.r, steel.g, steel.b]).flat(), 3));
  g.computeBoundingSphere();
  return g;
}

export function buildStreet(ctx) {
  const { svg, heights, materials, projection, mall, props, environment } = ctx;
  const y0 = heights.STREET;
  const group = new THREE.Group();
  group.name = 'STREET';
  const propsGroup = new THREE.Group();
  propsGroup.name = 'street-props';
  const carGroup = new THREE.Group();
  carGroup.name = 'street-cars';
  group.add(propsGroup, carGroup);
  const layers = [];
  const stats = {};
  const r = rng(hashString('interchange-street'));

  // Ground: the SVG street layer in material colors.
  const groundGeo = new THREE.PlaneGeometry(projection.width, projection.depth);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, materials.ground);
  ground.position.set(projection.center.x, y0 - 0.08, projection.center.z);
  ground.name = 'ground';
  group.add(ground);

  // The mall from outside: facades, garage gates, loading decks, entrances, signs, roof (icExterior.js).
  const exterior = buildMallExterior(ctx);
  group.add(exterior.group);
  layers.push(...exterior.layers);
  stats.exterior = exterior.stats;

  // Decks around the mall at first-floor height, reachable from the street.
  const deckY = heights.LEVEL1;
  const decks = svg.polygons('Pavament-1', { minArea: 20 });
  const deck = new MeshBucket();
  const glass = new MeshBucket();
  const metal = new MeshBucket();
  for (const d of decks) {
    slab(deck, d, deckY, C.deck);
    slab(deck, { outer: d.outer, holes: [] }, deckY - SLAB, C.underside, { down: true });
    ringWalls(deck, d.outer, deckY - SLAB, deckY, C.underside);
    // parapets, ramp openings and dock doors on the deck edges come from icExterior.js
  }
  addMesh(group, deck, materials.solid, 'decks');
  addMesh(group, glass, materials.glass, 'deck-glass');
  addMesh(group, metal, materials.metal, 'deck-rails');

  // Buildings outside the mall (SVG footprints). Height by size: the data has no heights for them.
  const bld = new MeshBucket();
  stats.buildings = 0;
  for (const b of ctx.buildingsOutside) {
    const info = ringInfo(b.outer);
    const bx = info.bounds.x1 - info.bounds.x0;
    const bz = info.bounds.z1 - info.bounds.z0;
    const ratio = Math.max(bx, bz) / Math.max(0.5, Math.min(bx, bz));
    let h = 3.2;
    let wallCol = C.building;
    let topCol = C.buildingTop;
    if (info.area >= 300) { h = 8.5; wallCol = C.station; } else if (info.area >= 90) { h = 4.8; } else if (info.area >= 18 && ratio >= 1.8) {
      h = 2.6;
      wallCol = color(pick(r, CONTAINER_COLORS));
      topCol = wallCol.clone().multiplyScalar(0.8);
    }
    ringWalls(bld, b.outer, y0, y0 + h, wallCol.clone().multiplyScalar(0.72), wallCol);
    slab(bld, { outer: b.outer, holes: [] }, y0 + h, topCol);
    stats.buildings += 1;
  }
  addMesh(group, bld, materials.solid, 'buildings');

  // Rocks and sand piles (SVG "Rocks") as low mounds.
  const rockGeos = [];
  for (const p of svg.polygons('Rocks', { minArea: 4 })) {
    const info = ringInfo(p.outer);
    const h = Math.min(2.6, 0.35 + Math.sqrt(info.area) / 55);
    try {
      const shape = new THREE.Shape(p.outer.map((q) => new THREE.Vector2(q.x, q.z)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: h * 0.4, bevelEnabled: true, bevelThickness: h * 0.6, bevelSize: Math.min(2.2, h * 1.2), bevelSegments: 2, curveSegments: 1 });
      g.rotateX(Math.PI / 2);
      g.translate(0, y0 - 0.25 + h, 0);
      rockGeos.push(g.index ? g.toNonIndexed() : g);
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

  const L = (name, geometry, maxDistance, material = materials.props) => {
    const l = new InstancedLayer(propsGroup, { name, geometry, material, maxDistance });
    layers.push(l);
    return l;
  };

  // Fences (SVG).
  const fence = L('fence', props.fenceMetal, 700);
  for (const s of svg.strokes('Fence')) {
    for (const line of s.lines) walk(line, 2.5, (p, dir) => fence.add(composeMatrix(p.x, y0, p.z, alongX(dir))));
  }

  // Power-line towers and cables (SVG).
  const towers = svg.polygons('Powerline_Towers', { minArea: 4 }).map((p) => centroid(p.outer));
  const pylon = L('pylon', pylonGeometry(), 1800);
  for (const t of towers) pylon.add(composeMatrix(t.x, y0, t.z, 0));
  const wirePts = [];
  for (const s of svg.strokes('Powerlines')) {
    for (const line of s.lines) {
      for (let i = 0; i < line.length - 1; i += 1) {
        const a = line[i];
        const b = line[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 5) continue;
        const nx = -(b.z - a.z) / len;
        const nz = (b.x - a.x) / len;
        for (const [off, y] of [[-7.6, 21], [7.6, 21], [-5, 25], [5, 25]]) {
          const steps = 8;
          for (let k = 0; k < steps; k += 1) {
            const t0 = k / steps;
            const t1 = (k + 1) / steps;
            const sag = (t) => -2.2 * 4 * t * (1 - t);
            wirePts.push(
              a.x + (b.x - a.x) * t0 + nx * off, y0 + y + sag(t0), a.z + (b.z - a.z) * t0 + nz * off,
              a.x + (b.x - a.x) * t1 + nx * off, y0 + y + sag(t1), a.z + (b.z - a.z) * t1 + nz * off,
            );
          }
        }
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
  stats.towers = towers.length;

  // Railway (SVG): ballast, two rails and sleepers per track.
  const rails = new MeshBucket();
  const sleeper = L('sleeper', new THREE.BoxGeometry(0.26, 0.16, 2.6).translate(0, 0.08, 0), 320, materials.metal);
  sleeper.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(sleeper.geometry.attributes.position.count * 3).fill(0.42), 3));
  for (const s of svg.strokes('Train_Tracks')) {
    for (const line of s.lines) {
      for (let i = 0; i < line.length - 1; i += 1) {
        const a = line[i];
        const b = line[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.1) continue;
        const nx = -(b.z - a.z) / len;
        const nz = (b.x - a.x) / len;
        strip(rails, a, b, 3.4, y0 + 0.02, color('#5b5147'));
        for (const off of [-0.76, 0.76]) {
          strip(rails, { x: a.x + nx * off, z: a.z + nz * off }, { x: b.x + nx * off, z: b.z + nz * off }, 0.1, y0 + 0.2, color('#6d6f6e'));
        }
      }
      walk(line, 0.7, (p, dir) => sleeper.add(composeMatrix(p.x, y0, p.z, alongX(dir))));
    }
  }
  addMesh(propsGroup, rails, materials.metal, 'rails');

  // Street lamps along the roads and barriers along the highway (placed along the real SVG roads).
  const buildingsNear = new SegmentGrid(ringEdges(ctx.buildingsOutside.map((b) => b.outer)), 24);
  const lamp = L('lamp', props.lamp, 800);
  stats.lamps = 0;
  for (const s of svg.strokes('Normal_Roads')) {
    for (const line of s.lines) {
      let side = 1;
      walk(line, 34, (p, dir) => {
        const out = { x: dir.z * side, z: -dir.x * side };
        const q = { x: p.x + out.x * (s.width / 2 + 0.9), z: p.z + out.z * (s.width / 2 + 0.9) };
        side = -side;
        if (mall.inMall(q) || buildingsNear.nearest(q, 2)) return;
        lamp.add(composeMatrix(q.x, y0, q.z, alongX({ x: -out.x, z: -out.z })));
        stats.lamps += 1;
      }, 10);
    }
  }
  const barrier = L('barrier', props.jersey, 500);
  for (const s of svg.strokes('Highways')) {
    for (const line of s.lines) {
      walk(line, 3.1, (p, dir) => {
        for (const sgn of [-1, 1]) {
          const off = (s.width / 2 - 0.5) * sgn;
          barrier.add(composeMatrix(p.x + dir.z * off, y0, p.z - dir.x * off, alongX(dir)));
        }
      });
    }
  }

  // Data-backed objects.
  const env = environment || {};
  const sandbags = L('sandbags', props.sandbags, 600);
  const gun = L('gun', props.gun, 400);
  for (const w of env.emplacements || []) {
    const p = ctx.game2(w.position);
    sandbags.add(composeMatrix(p.x, w.position.y - 0.1, p.z, 0));
    gun.add(composeMatrix(p.x, w.position.y - 0.1, p.z, r() * Math.PI * 2));
  }
  const mines = L('signMines', props.signMines, 500);
  for (const m of env.minefields || []) {
    const pts = (m.outline || []).map((q) => ctx.game2(q));
    if (!pts.length) continue;
    const c = centroid(pts);
    mines.add(composeMatrix(c.x, y0, c.z, r() * Math.PI * 2));
  }
  const checkpoint = L('barrier-checkpoint', props.barrier, 700);
  const blocks = L('fbs', props.fbsBlock, 600);
  for (const cp of env.checkpoints || []) {
    const p = ctx.game2(cp.position);
    checkpoint.add(composeMatrix(p.x, y0, p.z, 0));
    for (let k = -2; k <= 2; k += 1) blocks.add(composeMatrix(p.x + 8 + k * 2.6, y0, p.z + (k % 2) * 1.2, 0));
  }

  // Cars: at trunk locks and the V-Ex from data; parked in the outdoor lots (approximate).
  const roadSegs = [];
  for (const id of ['Normal_Roads', 'Highways']) for (const s of svg.strokes(id)) for (const line of s.lines) for (let i = 0; i < line.length - 1; i += 1) roadSegs.push({ a: line[i], b: line[i + 1] });
  const roads = new SegmentGrid(roadSegs, 24);
  const placements = [];
  stats.dataCars = 0;
  for (const v of dataVehicles(ctx, 'STREET')) {
    const near = roads.nearest(v, 40);
    const dir = near ? { x: near.seg.b.x - near.seg.a.x, z: near.seg.b.z - near.seg.a.z } : { x: 1, z: 0 };
    const len = Math.hypot(dir.x, dir.z) || 1;
    placements.push({ x: v.x, y: v.y - 0.9 > y0 ? v.y - 0.9 : y0, z: v.z, heading: alongX({ x: dir.x / len, z: dir.z / len }), model: pick(r, CAR_MODELS), paint: pick(r, CAR_PAINTS) });
    stats.dataCars += 1;
  }
  // Road paint, curbs, sidewalks, signs, roadblocks, parking stalls with cars and lamps, dumpsters, construction
  // blocks, wagons (icStreetDetail.js).
  const detail = buildStreetDetail(ctx, propsGroup);
  layers.push(...detail.layers);
  placements.push(...detail.placements);
  stats.detail = detail.stats;
  layers.push(...buildCars(carGroup, placements, ctx, { share: 0.03, max: 6, onlyWrecks: false }));
  stats.cars = placements.length;

  // Crates, weapon boxes, caches at their loot spawn points; doors at key locks.
  const wallEdges = new SegmentGrid(ringEdges([...ctx.buildingsOutside.map((b) => b.outer), mall.poly.outer]), 24);
  const extra = floorProps(ctx, 'STREET', propsGroup, { baseY: y0, groundY: y0 - 0.08, walls: wallEdges });
  layers.push(...extra.layers);
  stats.props = { containers: extra.containers, doors: extra.doors };

  for (const l of layers) if (!l.cells.length) l.build();
  return { group, walls: null, cars: carGroup, props: propsGroup, layers, stats };
}
