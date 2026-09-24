// Building meshes from the city model: storey-textured facade walls (ground floor with shops / entrances /
// garages, upper floors by architectural style), flat roofs with parapets, cornices on old plastered and
// brick houses, blank party walls where a neighbour is lower, unfinished concrete frames, sign boards.
// Walls and roofs are merged per material (a few dozen draw calls for the whole city). Repeated facade and
// roof details are instanced per spatial cell and only drawn near the camera (LOD).

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import {
  upperTexture, groundTexture, blankTexture, roofTexture, signAtlas,
  STOREY, GROUND_STOREY, BAY, UPPER_TILE, GROUND_TILE, BLANK_TILE, ROOF_TILE,
} from './textures.js';
import { InstancedLayer, composeMatrix } from './instancing.js';
import { rng, hashString, pointInPolygon } from './util.js';

const TEXTURE_STYLE = { silicate: 'brick', frame: 'panel' };
const BLANK_OF = { stalinka: 'plaster', panel: 'concrete', brick: 'brick', silicate: 'brick', office: 'concrete', modern: 'plaster', industrial: 'concrete', glass: 'concrete', frame: 'concrete' };
const CORNICE_STYLES = new Set(['stalinka', 'brick', 'silicate']);
const LIVING = new Set(['residential', 'modern', 'hotel', 'lowrise', 'office', 'school', 'clinic', 'government']);

class Bucket {
  constructor(material) {
    this.material = material;
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
  }

  push(v, n, t, c) {
    this.p.push(v[0], v[1], v[2]);
    this.n.push(n[0], n[1], n[2]);
    this.uv.push(t[0], t[1]);
    this.c.push(c.r, c.g, c.b);
  }

  tri(v0, v1, v2, n, t0, t1, t2, c0, c1, c2) {
    const ax = v1[0] - v0[0]; const ay = v1[1] - v0[1]; const az = v1[2] - v0[2];
    const bx = v2[0] - v0[0]; const by = v2[1] - v0[1]; const bz = v2[2] - v0[2];
    const gx = ay * bz - az * by; const gy = az * bx - ax * bz; const gz = ax * by - ay * bx;
    if (gx * n[0] + gy * n[1] + gz * n[2] < 0) {
      this.push(v0, n, t0, c0); this.push(v2, n, t2, c2); this.push(v1, n, t1, c1);
    } else {
      this.push(v0, n, t0, c0); this.push(v1, n, t1, c1); this.push(v2, n, t2, c2);
    }
  }

  quad(v, n, t, c) {
    this.tri(v[0], v[1], v[2], n, t[0], t[1], t[2], c[0], c[1], c[2]);
    this.tri(v[0], v[2], v[3], n, t[0], t[2], t[3], c[0], c[2], c[3]);
  }

  build() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, this.material);
  }
}

function wall(bucket, a, b, y0, y1, out, s0, s1, tile, vBase, c0, c1) {
  if (y1 - y0 < 0.02) return;
  const u0 = s0 / tile.w;
  const u1 = s1 / tile.w;
  const v0 = (y0 - vBase) / tile.h;
  const v1 = (y1 - vBase) / tile.h;
  bucket.quad(
    [[a.x, y0, a.z], [b.x, y0, b.z], [b.x, y1, b.z], [a.x, y1, a.z]],
    [out.x, 0, out.z],
    [[u0, v0], [u1, v0], [u1, v1], [u0, v1]],
    [c0, c0, c1, c1],
  );
}

function roof(bucket, poly, y, color) {
  const contour = poly.outer.map((p) => new THREE.Vector2(p.x, p.z));
  const holes = poly.holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.z)));
  const all = [...contour, ...holes.flat()];
  const up = [0, 1, 0];
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
    const a = all[i]; const b = all[j]; const c = all[k];
    bucket.tri([a.x, y, a.y], [b.x, y, b.y], [c.x, y, c.y], up, [a.x / ROOF_TILE, a.y / ROOF_TILE], [b.x / ROOF_TILE, b.y / ROOF_TILE], [c.x / ROOF_TILE, c.y / ROOF_TILE], color, color, color);
  }
}

const shade = (color, k) => color.clone().multiplyScalar(k);
const facingAngle = (out) => Math.atan2(out.x, out.z);

export function buildBuildings(city, { parent, clippingPlanes, anisotropy, props, propMaterial }) {
  const { base } = city;
  const materials = new Map();
  const buckets = new Map();
  const bucket = (key, makeTexture) => {
    if (!buckets.has(key)) {
      const material = new THREE.MeshLambertMaterial({ map: makeTexture(), vertexColors: true, side: THREE.DoubleSide, clippingPlanes });
      materials.set(key, material);
      buckets.set(key, new Bucket(material));
    }
    return buckets.get(key);
  };
  const upper = (style, variant) => bucket(`up:${style}:${variant}`, () => upperTexture(style, variant, anisotropy));
  const ground = (kind, variant) => bucket(`gr:${kind}:${variant}`, () => groundTexture(kind, variant, anisotropy));
  const blank = (kind) => bucket(`blank:${kind}`, () => blankTexture(kind, anisotropy));
  const roofBucket = bucket('roof', () => roofTexture(anisotropy));

  const layer = (name, geometry, maxDistance) => new InstancedLayer(parent, { name, geometry, material: propMaterial, maxDistance });
  const layers = {
    balconyOpen: layer('balconyOpen', props.balconyOpen, 520),
    balconyGlazed: layer('balconyGlazed', props.balconyGlazed, 520),
    acUnit: layer('acUnit', props.acUnit, 320),
    drainpipe: layer('drainpipe', props.drainpipe, 380),
    fireEscape: layer('fireEscape', props.fireEscape, 450),
    entrance: layer('entrance', props.entrance, 420),
    roofVent: layer('roofVent', props.roofVent, 700),
    roofMachine: layer('roofMachine', props.roofMachine, 900),
    roofAC: layer('roofAC', props.roofAC, 600),
    antenna: layer('antenna', props.antenna, 500),
    chimney: layer('chimney', props.chimney, 700),
    column: layer('column', props.fbsBlock, 900),
    signBoard: layer('signBoard', props.signBoard, Infinity),
  };

  const signs = [];
  for (const b of city.buildings) {
    const r = rng(hashString(`mesh:${b.id}`));
    for (const v of b.volumes) {
      const { run } = v;
      if (run.style === 'frame') {
        buildFrame(b, v, { base, blank, roofBucket, layers, r });
        continue;
      }
      const tex = TEXTURE_STYLE[run.style] || run.style;
      const tint = new THREE.Color(run.tint).multiplyScalar(0.9 + r() * 0.12);
      const low = shade(tint, 0.72);
      const gTop = Math.min(v.top, base + GROUND_STOREY);
      const counters = { outer: 0, inner: 0 };

      for (const w of v.walls) {
        const key = w.facing === 'inner' ? 'inner' : 'outer';
        const s0 = counters[key];
        const s1 = s0 + w.len;
        counters[key] = s1;

        let groundKind = run.ground || 'entrance';
        if (groundKind === 'shop' && w.facing !== 'street') groundKind = 'entrance';
        if (w.facing === 'inner') wall(blank(BLANK_OF[run.style] || 'plaster'), w.a, w.b, base, gTop, w.out, s0, s1, BLANK_TILE, base, low, tint);
        else wall(ground(groundKind, run.variant), w.a, w.b, base, gTop, w.out, s0, s1, GROUND_TILE, base, low, tint);
        wall(upper(tex, run.variant), w.a, w.b, gTop, v.top, w.out, s0, s1, UPPER_TILE, base + GROUND_STOREY, shade(tint, 0.92), tint);

        if (w.facing !== 'inner') {
          wall(blank('concrete'), w.a, w.b, v.top, v.top + 0.9, w.out, s0, s1, BLANK_TILE, v.top, shade(tint, 0.85), shade(tint, 0.85));
          if (CORNICE_STYLES.has(run.style) && run.storeys) cornice(blank(BLANK_OF[run.style]), w, v.top, tint);
          details(w, v, s0, { base, r, layers, run });
        }
      }
      for (const e of v.ends) {
        const f = { x: e.b.z - e.a.z, z: -(e.b.x - e.a.x) };
        const len = Math.hypot(f.x, f.z) || 1;
        const out = { x: f.x / len, z: f.z / len };
        wall(blank(BLANK_OF[run.style] || 'plaster'), e.a, e.b, e.from, e.to, out, 0, len, BLANK_TILE, base, tint, tint);
        if (e.to - e.from > 7 && ['brick', 'stalinka', 'silicate', 'office'].includes(run.style) && r() < 0.55) {
          const mid = { x: (e.a.x + e.b.x) / 2, z: (e.a.z + e.b.z) / 2 };
          for (let y = e.from; y < e.to - 2; y += STOREY) layers.fireEscape.add(composeMatrix(mid.x, y, mid.z, facingAngle(out)));
        }
      }
      roof(roofBucket, v.roof, v.top, shade(tint, 0.95));
      roofEquipment(v.roof, v.top, run, { r, layers, dir: v.walls[0] ? v.walls[0].dir : { x: 1, z: 0 } });
    }
    if (b.filler) {
      roof(roofBucket, b.filler.roof, b.filler.top, new THREE.Color('#d9d6cc'));
      roofEquipment(b.filler.roof, b.filler.top, { kind: 'commercial', storeys: 1 }, { r, layers, dir: { x: 1, z: 0 } });
    }
    signs.push(...b.signs);
  }

  const meshes = [];
  for (const bk of buckets.values()) {
    const mesh = bk.build();
    if (mesh) {
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      meshes.push(mesh);
    }
  }
  const signMesh = buildSigns(signs, { parent, clippingPlanes, anisotropy, layers });
  if (signMesh) meshes.push(signMesh);
  for (const l of Object.values(layers)) l.build();
  return { meshes, layers: Object.values(layers), materials: [...materials.values()] };
}

function cornice(bk, w, top, tint) {
  const o = 0.35;
  const a2 = { x: w.a.x + w.out.x * o, z: w.a.z + w.out.z * o };
  const b2 = { x: w.b.x + w.out.x * o, z: w.b.z + w.out.z * o };
  const y0 = top - 0.7;
  const c = shade(tint, 1.05);
  wall(bk, a2, b2, y0, top, w.out, 0, w.len, BLANK_TILE, y0, shade(tint, 0.85), c);
  bk.quad([[w.a.x, y0, w.a.z], [w.b.x, y0, w.b.z], [b2.x, y0, b2.z], [a2.x, y0, a2.z]], [0, -1, 0], [[0, 0], [1, 0], [1, 0.05], [0, 0.05]], [shade(tint, 0.6), shade(tint, 0.6), shade(tint, 0.6), shade(tint, 0.6)]);
  bk.quad([[w.a.x, top, w.a.z], [w.b.x, top, w.b.z], [b2.x, top, b2.z], [a2.x, top, a2.z]], [0, 1, 0], [[0, 0], [1, 0], [1, 0.05], [0, 0.05]], [c, c, c, c]);
}

// Balconies stacked in columns, AC units, drainpipes and entrance canopies on one facade wall.
function details(w, v, s0, { base, r, layers, run }) {
  const { storeys } = run;
  const angle = facingAngle(w.out);
  const at = (s, y) => ({ x: w.a.x + w.dir.x * (s - s0), y, z: w.a.z + w.dir.z * (s - s0) });
  const firstBay = Math.ceil((s0 + 0.8) / BAY - 0.5);
  if (storeys && storeys >= 1) {
    for (let j = firstBay; (j + 0.5) * BAY <= s0 + w.len - 0.8; j += 1) {
      const s = (j + 0.5) * BAY;
      const column = rng(hashString(`${v.top}:${w.a.x.toFixed(1)}:${w.a.z.toFixed(1)}:${j}`));
      const hasBalcony = run.balcony > 0 && column() < run.balcony && w.facing !== 'inner';
      const glazed = column() < (run.style === 'stalinka' ? 0.2 : 0.55);
      for (let k = 0; k < storeys; k += 1) {
        const y = base + GROUND_STOREY + k * STOREY;
        if (y + STOREY > v.top + 0.01) break;
        if (hasBalcony) {
          const p = at(s, y);
          (glazed && column() > 0.1 ? layers.balconyGlazed : layers.balconyOpen).add(composeMatrix(p.x, p.y, p.z, angle));
        } else if (column() < run.ac * (w.facing === 'street' ? 1 : 0.6)) {
          const p = at(s + 1.0, y + 0.35);
          layers.acUnit.add(composeMatrix(p.x, p.y, p.z, angle));
        }
      }
    }
  }
  if (run.kind !== 'kiosk' && run.kind !== 'garage' && w.len > 6) {
    for (let s = s0 + 0.4; s < s0 + w.len; s += 24) {
      if (r() < 0.6) {
        const p = at(s, base);
        layers.drainpipe.add(composeMatrix(p.x, p.y, p.z, angle, 1, v.top - base, 1));
      }
    }
  }
  const entranceWall = w.facing === 'court' || (w.facing === 'street' && run.ground !== 'shop' && run.ground !== 'showroom');
  if (LIVING.has(run.kind) && entranceWall && w.len >= 8) {
    for (let s = s0 + 6; s < s0 + w.len - 3; s += 24) {
      const p = at(Math.round(s / BAY) * BAY, base);
      layers.entrance.add(composeMatrix(p.x, p.y, p.z, angle));
    }
  }
}

function randomPointsInPolygon(poly, count, r) {
  const xs = poly.outer.map((p) => p.x);
  const zs = poly.outer.map((p) => p.z);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const z0 = Math.min(...zs); const z1 = Math.max(...zs);
  const out = [];
  for (let tries = 0; out.length < count && tries < count * 12; tries += 1) {
    const p = { x: x0 + r() * (x1 - x0), z: z0 + r() * (z1 - z0) };
    if (pointInPolygon(p, poly)) out.push(p);
  }
  return out;
}

function roofEquipment(poly, top, run, { r, layers, dir }) {
  const xs = poly.outer.map((p) => p.x);
  const zs = poly.outer.map((p) => p.z);
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
  const count = Math.min(14, Math.floor(area / 220));
  const angle = Math.atan2(dir.x, dir.z);
  const pts = randomPointsInPolygon(poly, count, r);
  pts.forEach((p, i) => {
    const m = composeMatrix(p.x, top, p.z, angle);
    const roll = r();
    if (['residential', 'modern', 'hotel'].includes(run.kind)) {
      if (i === 0 && run.storeys >= 5) layers.roofMachine.add(m);
      else if (run.style === 'stalinka' && roll < 0.45) layers.chimney.add(m);
      else if (roll < 0.35) layers.antenna.add(m);
      else layers.roofVent.add(m);
    } else if (run.kind === 'industrial' || run.kind === 'garage') {
      layers.roofVent.add(m);
    } else if (roll < 0.6) {
      layers.roofAC.add(m);
    } else {
      layers.roofVent.add(m);
    }
  });
}

// Unfinished building: concrete slabs on every storey and a column grid, no facade.
function buildFrame(b, v, { base, blank, roofBucket, layers, r }) {
  const concrete = new THREE.Color('#c9c6bc');
  const slabBucket = blank('concrete');
  const storeys = Math.max(2, Math.round((v.top - base - GROUND_STOREY) / STOREY) + 1);
  const levels = [];
  for (let k = 0; k <= storeys; k += 1) levels.push(base + GROUND_STOREY + (k - 1) * STOREY + (k === 0 ? 0.3 : 0));
  for (const y of levels.slice(1)) {
    roof(y === levels[levels.length - 1] ? roofBucket : slabBucket, v.roof, y, concrete);
    for (const w of v.walls) wall(slabBucket, w.a, w.b, y - 0.3, y, w.out, 0, w.len, BLANK_TILE, y, concrete, concrete);
  }
  const pts = randomPointsInPolygon(v.roof, Math.floor(b.area / 45), r);
  for (const p of pts) {
    for (let k = 1; k < levels.length; k += 1) {
      layers.column.add(composeMatrix(p.x, levels[k - 1], p.z, 0, 0.21, (levels[k] - levels[k - 1] - 0.3) / 0.6, 0.83));
    }
  }
}

function buildSigns(signs, { parent, clippingPlanes, anisotropy, layers }) {
  if (!signs.length) return null;
  const { texture, cells } = signAtlas(signs, anisotropy);
  const material = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide, clippingPlanes, vertexColors: true });
  const bk = new Bucket(material);
  const white = new THREE.Color(1, 1, 1);
  signs.forEach((sign, i) => {
    const { wall: w } = sign;
    const cell = cells[i];
    const midS = w.len / 2;
    const cx = w.a.x + w.dir.x * midS;
    const cz = w.a.z + w.dir.z * midS;
    const half = sign.width / 2;
    const off = 0.23;
    const a = { x: cx - w.dir.x * half + w.out.x * off, z: cz - w.dir.z * half + w.out.z * off };
    const b = { x: cx + w.dir.x * half + w.out.x * off, z: cz + w.dir.z * half + w.out.z * off };
    const y0 = sign.y;
    const y1 = sign.y + sign.height;
    // Text reads left-to-right for a viewer facing the wall: that viewer's right is -dir.
    bk.quad(
      [[b.x, y0, b.z], [a.x, y0, a.z], [a.x, y1, a.z], [b.x, y1, b.z]],
      [w.out.x, 0, w.out.z],
      [[cell.u0, cell.v0], [cell.u1, cell.v0], [cell.u1, cell.v1], [cell.u0, cell.v1]],
      [white, white, white, white],
    );
    layers.signBoard.add(composeMatrix(cx, y0 - 0.05, cz, Math.atan2(w.out.x, w.out.z), sign.width + 0.2, sign.height + 0.1, 1));
  });
  const mesh = bk.build();
  mesh.matrixAutoUpdate = false;
  parent.add(mesh);
  return mesh;
}
