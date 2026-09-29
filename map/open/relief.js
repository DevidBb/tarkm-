// Mountains and rocky hills of the open maps. The SVG plans draw them only as outlines (class `rock`), and the heights
// of in-game spawn points never reach the slopes, so the ground there is flat. Big rock areas are raised from their
// outline inward: steep at the foot, rounding off toward the middle, the peak height growing with the size of the
// area, with some unevenness. Small rock outlines stay boulders (extruded by the Shoreline builder). The shape is an
// approximation of the real mountains, not measured relief.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { pointInRing } from '../city/util.js';
import { paint } from '../city/models.js';

const BIG_ROCK = 140; // m²: rock areas at least this large are raised in the relief; smaller ones become boulders

export const ringArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a / 2);
};

export const isBigRock = (poly) => ringArea(poly.outer) >= BIG_ROCK;

function segDist(px, pz, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - a.x) * dx + (pz - a.z) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - a.x - t * dx, pz - a.z - t * dz);
}

function valueNoise(x, z, scale) {
  const fx = x / scale;
  const fz = z / scale;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const lat = (a, b) => {
    const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const s = (t) => t * t * (3 - 2 * t);
  const tx = s(fx - i);
  const tz = s(fz - j);
  return (lat(i, j) * (1 - tx) + lat(i + 1, j) * tx) * (1 - tz) + (lat(i, j + 1) * (1 - tx) + lat(i + 1, j + 1) * tx) * tz;
}

// terrain: services/terrain.js grid (heights mutated in place). polys: [{ outer, holes }] in scene meters.
export function raiseMountains(terrain, polys, { maxHeight = 38 } = {}) {
  const { cols, rows, cell, gx0, gz0, heights } = terrain;
  let raised = 0;
  let peak = 0;
  for (const poly of polys) {
    const ring = poly.outer;
    const area = ringArea(ring);
    if (area < BIG_ROCK) continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of ring) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    // scene x = -game x: terrain columns run along game x
    const c0 = Math.max(0, Math.floor((-x1 - gx0) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((-x0 - gx0) / cell));
    const r0 = Math.max(0, Math.floor((z0 - gz0) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((z1 - gz0) / cell));
    const inside = [];
    let dmax = 0;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const p = { x: -(gx0 + c * cell), z: gz0 + r * cell };
        if (!pointInRing(p, ring) || poly.holes.some((h) => pointInRing(p, h))) continue;
        let d = Infinity;
        for (let k = 0; k < ring.length; k += 1) d = Math.min(d, segDist(p.x, p.z, ring[k], ring[(k + 1) % ring.length]));
        inside.push([r * cols + c, d, p]);
        if (d > dmax) dmax = d;
      }
    }
    if (!inside.length) continue;
    const H = Math.min(maxHeight, 4 + Math.sqrt(area) * 0.17) * Math.min(1, 0.45 + dmax / 40);
    const R = Math.max(5, dmax * 0.5);
    for (const [i, d, p] of inside) {
      const rough = 0.78 + 0.34 * valueNoise(p.x, p.z, 26) + 0.12 * valueNoise(p.x + 91, p.z - 37, 9);
      const h = H * (1 - Math.exp(-d / R)) * rough;
      heights[i] += h;
      if (h > peak) peak = h;
    }
    raised += 1;
  }
  return { raised, peak: Math.round(peak) };
}

// Positions for loose boulders on the raised slopes (deterministic).
export function slopeBoulders(terrain, polys, r, perArea = 1 / 500) {
  const out = [];
  for (const poly of polys) {
    const area = ringArea(poly.outer);
    if (area < BIG_ROCK) continue;
    const n = Math.min(400, Math.round(area * perArea));
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of poly.outer) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    for (let k = 0, tries = 0; k < n && tries < n * 6; tries += 1) {
      const p = { x: x0 + r() * (x1 - x0), z: z0 + r() * (z1 - z0) };
      if (!pointInRing(p, poly.outer)) continue;
      out.push({ x: p.x, z: p.z, y: terrain.heightAtScene(p.x, p.z) });
      k += 1;
    }
  }
  return out;
}

// Small rock outlines as boulders: a lumpy low-poly stone stretched along the outline's main axis and sunk a little
// into the ground, instead of a flat extruded slab.
export function boulderGeometries(polys, ground, r) {
  const out = [];
  for (const poly of polys) {
    const ring = poly.outer;
    const area = ringArea(ring);
    if (area >= BIG_ROCK || area < 2) continue;
    const cx = ring.reduce((a, q) => a + q.x, 0) / ring.length;
    const cz = ring.reduce((a, q) => a + q.z, 0) / ring.length;
    let sxx = 0; let szz = 0; let sxz = 0;
    for (const q of ring) {
      sxx += (q.x - cx) ** 2; szz += (q.z - cz) ** 2; sxz += (q.x - cx) * (q.z - cz);
    }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const u = { x: Math.cos(ang), z: Math.sin(ang) };
    let a0 = Infinity; let a1 = -Infinity; let b0 = Infinity; let b1 = -Infinity;
    let low = Infinity;
    for (const q of ring) {
      const a = (q.x - cx) * u.x + (q.z - cz) * u.z;
      const b = -(q.x - cx) * u.z + (q.z - cz) * u.x;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
      low = Math.min(low, ground(q.x, q.z));
    }
    const rx = Math.max(0.6, (a1 - a0) / 2);
    const rz = Math.max(0.6, (b1 - b0) / 2);
    const h = Math.min(5.5, 0.8 + Math.sqrt(area) * 0.32);
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.attributes.position;
    // lumps: move each vertex (shared positions move together, keyed by rounded coordinates)
    const bump = new Map();
    for (let i = 0; i < pos.count; i += 1) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      if (!bump.has(key)) bump.set(key, 0.82 + r() * 0.3);
      const k = bump.get(key);
      const y = pos.getY(i);
      pos.setXYZ(i, pos.getX(i) * k, (y < 0 ? y * 0.4 : y) * k, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    g.scale(rx, h * 0.8, rz);
    g.rotateY(-ang);
    g.translate(cx + (a0 + a1) / 2 * u.x - (b0 + b1) / 2 * u.z, low + h * 0.1, cz + (a0 + a1) / 2 * u.z + (b0 + b1) / 2 * u.x);
    const shade = 0.36 + r() * 0.08;
    out.push(paint(g, new THREE.Color(shade, shade * 0.98, shade * 0.93)));
  }
  return out;
}
