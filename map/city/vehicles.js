// Vehicles. Data-backed: streets.environment.json (ambulances, Patrol-A, car trunks, Rus Post van, taxi V-Ex)
// at their real positions; the type comes from the source text, heading follows the nearest curb.
// Decorative (approximate): parked and abandoned cars along the real SVG curbs, in courtyards and in the
// parking lot named by an extract. Near the camera: low-poly model per type; far: one painted box (LOD).

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { vehicleModels } from './models.js';
import { InstancedLayer, composeMatrix } from './instancing.js';
import { rng, hashString, pick, pointInPolygon, signedArea } from './util.js';

export const NEAR_DISTANCE = 280;

const PAINT = {
  white: '#e8e6df', silver: '#a9adb0', grey: '#5d6165', black: '#1c1d1f', red: '#a12b27', cherry: '#6b1c21',
  blue: '#1f3558', lightblue: '#6f8fa8', green: '#3e5a3a', beige: '#c9b98f', brown: '#5a3d2b', orange: '#b8612a',
};
const CAR_PAINTS = ['white', 'white', 'silver', 'silver', 'grey', 'black', 'black', 'red', 'cherry', 'blue', 'lightblue', 'green', 'beige', 'brown'];
const FIXED = { ambulance: '#eceae2', patrol: '#2d312d', postvan: '#eceae2', taxi: '#dcb21e', police: '#e9e9e4' };
const DATA_MODEL = { ambulance: 'ambulance', 'patrol-a': 'patrol', 'post-van': 'postvan', taxi: 'taxi', car: null };

function headingAlong(dir) {
  // Right-hand traffic: a car parked at a road edge has the curb on its right, so it faces -dir.
  return Math.atan2(dir.z, -dir.x);
}

export function buildVehicles(city, environment, { parent, clippingPlanes, propMaterial }) {
  const models = vehicleModels();
  const { base, roads } = city;
  const placements = [];
  const taken = new Map();
  const cellKey = (p) => `${Math.floor(p.x / 6)},${Math.floor(p.z / 6)}`;
  const isFree = (p, radius = 5) => {
    for (let gx = -1; gx <= 1; gx += 1) {
      for (let gz = -1; gz <= 1; gz += 1) {
        const list = taken.get(`${Math.floor(p.x / 6) + gx},${Math.floor(p.z / 6) + gz}`);
        if (list && list.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < radius)) return false;
      }
    }
    return true;
  };
  const insideBuilding = (p) => {
    const near = city.buildingGrid.nearest(p, 30);
    return Boolean(near && pointInPolygon(p, near.seg.building.poly));
  };
  const add = (pl) => {
    placements.push(pl);
    const k = cellKey(pl);
    if (!taken.has(k)) taken.set(k, []);
    taken.get(k).push(pl);
  };

  // ---- data-backed vehicles
  for (const v of (environment && environment.vehicles) || []) {
    const p = city.game2(v.position);
    const r = rng(hashString(v.id));
    const edge = roads.grid.nearest(p, 14);
    const model = DATA_MODEL[v.kind] || pick(r, ['sedan', 'hatch', 'sedan', 'suv']);
    const heading = edge ? headingAlong(edge.seg.dir) : r() * Math.PI * 2;
    add({ x: p.x, z: p.z, heading, model, paint: FIXED[model] || PAINT[pick(r, CAR_PAINTS)], source: 'data', id: v.id, kind: v.kind, note: v.source });
  }
  const btrStops = ((environment && environment.btrStops) || []).map((s) => city.game2(s.position));

  // ---- decorative: along curbs
  const nearKind = (p) => {
    const near = city.buildingGrid.nearest(p, 28);
    return near ? near.seg.building.kind : null;
  };
  for (const e of roads.edges) {
    if (e.len < 12 || (e.width != null && e.width < 6.5)) continue;
    const r = rng(hashString(`cars:${e.a.x.toFixed(1)}:${e.a.z.toFixed(1)}`));
    const density = e.width == null || e.width > 11 ? 0.34 : 0.2;
    let s = 4 + r() * 5;
    while (s < e.len - 5) {
      const probe = { x: e.a.x + e.dir.x * s, z: e.a.z + e.dir.z * s };
      const kind = nearKind(probe);
      let model;
      const roll = r();
      if (kind === 'industrial' || kind === 'construction' || kind === 'garage') model = roll < 0.35 ? 'truck' : roll < 0.65 ? 'van' : pick(r, ['sedan', 'suv']);
      else if (kind === 'government') model = roll < 0.35 ? 'police' : pick(r, ['sedan', 'hatch', 'suv']);
      else if (kind === 'commercial' || kind === 'showroom') model = roll < 0.18 ? 'van' : pick(r, ['sedan', 'hatch', 'hatch', 'suv']);
      else if (e.width != null && e.width >= 14 && roll < 0.03) model = 'bus';
      else model = roll < 0.05 ? 'van' : roll < 0.08 ? 'taxi' : pick(r, ['sedan', 'sedan', 'hatch', 'hatch', 'suv']);
      const m = models[model];
      if (r() < density && s + m.length < e.len - 3) {
        const along = s + m.length / 2;
        let off = m.width / 2 + 0.35;
        let heading = headingAlong(e.dir);
        let tiltX = 0;
        let tiltZ = 0;
        const state = r();
        if (state < 0.1) { heading += (r() - 0.5) * 1.4; off += 1 + r() * 2.5; }
        else if (state < 0.16) { off = -(0.3 + r() * 0.6); tiltX = 0.05 + r() * 0.04; }
        const p = { x: e.a.x + e.dir.x * along - e.out.x * off, z: e.a.z + e.dir.z * along - e.out.z * off };
        if (isFree(p, m.length * 0.6 + 1) && !insideBuilding(p) && btrStops.every((b) => Math.hypot(b.x - p.x, b.z - p.z) > 14)) {
          const burned = r() < 0.05;
          const paint = burned ? '#2b2723' : FIXED[model] || (model === 'bus' ? '#c9b13a' : model === 'truck' ? pick(r, ['#3d5a7a', '#b8612a', '#4e5f3a', '#7a7f82']) : PAINT[pick(r, CAR_PAINTS)]);
          add({ x: p.x, z: p.z, heading, tiltX, tiltZ, model, paint, burned, source: 'decor' });
        }
        s += m.length + 1.2 + r() * 3.5;
      } else {
        s += 5 + r() * 7;
      }
    }
  }

  // ---- decorative: courtyards (holes in building footprints)
  for (const b of city.buildings) {
    for (const hole of b.poly.holes) {
      if (Math.abs(signedArea(hole)) < 500) continue;
      const r = rng(hashString(`yard:${b.id}:${hole.length}`));
      hole.forEach((a, i) => {
        const c = hole[(i + 1) % hole.length];
        const len = Math.hypot(c.x - a.x, c.z - a.z);
        if (len < 10) return;
        const dir = { x: (c.x - a.x) / len, z: (c.z - a.z) / len };
        const out = { x: dir.z, z: -dir.x };
        for (let s = 5; s < len - 5; s += 7) {
          if (r() > 0.22) continue;
          const model = pick(r, ['sedan', 'hatch', 'hatch', 'suv', 'sedan']);
          const p = { x: a.x + dir.x * s + out.x * 3.4, z: a.z + dir.z * s + out.z * 3.4 };
          if (!isFree(p, 4.5)) continue;
          add({ x: p.x, z: p.z, heading: Math.atan2(-dir.z, dir.x) + (r() - 0.5) * 0.3, model, paint: PAINT[pick(r, CAR_PAINTS)], source: 'decor' });
        }
      });
    }
  }

  // ---- decorative: rows in the parking lot named by an extract
  for (const lot of (environment && environment.parkingLots) || []) {
    const p0 = city.game2(lot.position);
    const edge = roads.grid.nearest(p0, 45);
    if (!edge) continue;
    const e = edge.seg;
    const r = rng(hashString(`lot:${lot.name}`));
    const t = edge.t * e.len;
    for (let k = -5; k <= 5; k += 1) {
      if (r() < 0.2) continue;
      const s = t + k * 2.8;
      if (s < 2 || s > e.len - 2) continue;
      const model = pick(r, ['sedan', 'hatch', 'suv', 'sedan']);
      const p = { x: e.a.x + e.dir.x * s - e.out.x * 3.2, z: e.a.z + e.dir.z * s - e.out.z * 3.2 };
      if (!isFree(p, 2.5)) continue;
      add({ x: p.x, z: p.z, heading: Math.atan2(e.out.z, -e.out.x) + (r() - 0.5) * 0.12, model, paint: PAINT[pick(r, CAR_PAINTS)], source: 'decor' });
    }
  }

  // ---- instanced layers: detailed near, painted boxes far
  const bodyMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, clippingPlanes });
  const glassMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, clippingPlanes, shininess: 80, specular: 0x4a5560 });
  const layers = [];
  const layerFor = new Map();
  const near = (name, geometry, material) => {
    const l = new InstancedLayer(parent, { name, geometry, material, maxDistance: NEAR_DISTANCE });
    layers.push(l);
    return l;
  };
  const far = new InstancedLayer(parent, { name: 'car-far', geometry: models.farBox, material: bodyMaterial, minDistance: NEAR_DISTANCE });
  layers.push(far);
  for (const [name, m] of Object.entries(models)) {
    if (name === 'farBox') continue;
    layerFor.set(name, {
      body: near(`${name}-body`, m.body, bodyMaterial),
      glass: near(`${name}-glass`, m.glass, glassMaterial),
      detail: near(`${name}-detail`, m.detail, propMaterial),
      decal: m.decal ? near(`${name}-decal`, m.decal, propMaterial) : null,
    });
  }
  const color = new THREE.Color();
  for (const pl of placements) {
    const m = models[pl.model];
    const lay = layerFor.get(pl.model);
    const matrix = composeMatrix(pl.x, base, pl.z, pl.heading, 1, 1, 1, pl.tiltX || 0, pl.tiltZ || 0);
    color.set(pl.paint);
    lay.body.add(matrix, color.clone());
    if (!pl.burned) lay.glass.add(matrix);
    lay.detail.add(matrix);
    if (lay.decal && !pl.burned) lay.decal.add(matrix);
    far.add(composeMatrix(pl.x, base + 0.3, pl.z, pl.heading, m.length, m.height * 0.8, m.width), color.clone());
  }
  for (const l of layers) l.build();

  const stats = { data: placements.filter((p) => p.source === 'data').length, decor: placements.filter((p) => p.source === 'decor').length };
  return { layers, placements, stats, materials: [bodyMaterial, glassMaterial] };
}
