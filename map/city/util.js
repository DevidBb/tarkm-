// Deterministic helpers for the 3D city layer: seeded random numbers and 2D polygon math.
// All 2D points are scene X/Z meters ({ x, z }). Outer rings are counter-clockwise (signedArea > 0),
// holes clockwise, so for every ring edge a->b the vector (dz, -dx) points out of the polygon material.

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: small, fast, good enough for layout variation. Same seed -> same city every load.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (r, list) => list[Math.min(list.length - 1, Math.floor(r() * list.length))];
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export function orient(ring, ccw) {
  const isCcw = signedArea(ring) > 0;
  return isCcw === ccw ? ring : [...ring].reverse();
}

export function ringLength(ring) {
  let len = 0;
  for (let i = 0; i < ring.length; i += 1) len += dist(ring[i], ring[(i + 1) % ring.length]);
  return len;
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function centroid(points) {
  let x = 0;
  let z = 0;
  for (const p of points) { x += p.x; z += p.z; }
  return { x: x / points.length, z: z / points.length };
}

export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export const pointInPolygon = (p, poly) => pointInRing(p, poly.outer) && !poly.holes.some((h) => pointInRing(p, h));

// Drops near-duplicate points and almost straight vertices so walls get long clean edges.
export function simplifyRing(ring, minEdge = 0.6, minTurnDeg = 5) {
  let pts = [];
  for (const p of ring) {
    if (!pts.length || dist(pts[pts.length - 1], p) >= minEdge) pts.push(p);
  }
  if (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < minEdge) pts.pop();
  const minTurn = (minTurnDeg * Math.PI) / 180;
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const next = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (Math.abs(turnAngle(a, b, c)) < minTurn && next.length + (pts.length - i) > 3) {
        changed = true;
        continue;
      }
      next.push(b);
    }
    pts = next;
  }
  return pts;
}

// Signed turn at b for the path a->b->c, radians (-PI..PI).
export function turnAngle(a, b, c) {
  const a1 = Math.atan2(b.z - a.z, b.x - a.x);
  const a2 = Math.atan2(c.z - b.z, c.x - b.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function edgeFrame(a, b) {
  const len = dist(a, b) || 1e-6;
  const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
  return { len, dir, out: { x: dir.z, z: -dir.x } };
}

export function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1);
  return { d: Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)), t };
}

// Distance along the ray o + dir*t to segment a-b, or null.
export function raySegment(o, dir, a, b) {
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const den = dir.x * ez - dir.z * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - o.x) * ez - (a.z - o.z) * ex) / den;
  const u = ((a.x - o.x) * dir.z - (a.z - o.z) * dir.x) / den;
  return t > 1e-4 && u >= 0 && u <= 1 ? t : null;
}

// Uniform grid over segments for fast "nearest edge" and ray queries.
export class SegmentGrid {
  constructor(segments, cell = 24) {
    this.cell = cell;
    this.map = new Map();
    this.segments = segments;
    segments.forEach((s, i) => {
      const x0 = Math.floor(Math.min(s.a.x, s.b.x) / cell);
      const x1 = Math.floor(Math.max(s.a.x, s.b.x) / cell);
      const z0 = Math.floor(Math.min(s.a.z, s.b.z) / cell);
      const z1 = Math.floor(Math.max(s.a.z, s.b.z) / cell);
      for (let gx = x0; gx <= x1; gx += 1) {
        for (let gz = z0; gz <= z1; gz += 1) {
          const key = `${gx},${gz}`;
          if (!this.map.has(key)) this.map.set(key, []);
          this.map.get(key).push(i);
        }
      }
    });
  }

  near(p, radius) {
    const c = this.cell;
    const out = new Set();
    for (let gx = Math.floor((p.x - radius) / c); gx <= Math.floor((p.x + radius) / c); gx += 1) {
      for (let gz = Math.floor((p.z - radius) / c); gz <= Math.floor((p.z + radius) / c); gz += 1) {
        const list = this.map.get(`${gx},${gz}`);
        if (list) for (const i of list) out.add(i);
      }
    }
    return [...out].map((i) => this.segments[i]);
  }

  nearest(p, radius) {
    let best = null;
    for (const s of this.near(p, radius)) {
      const r = distToSegment(p, s.a, s.b);
      if (r.d <= radius && (!best || r.d < best.d)) best = { seg: s, d: r.d, t: r.t };
    }
    return best;
  }

  // First hit along a ray, marching through grid cells up to maxDist.
  ray(o, dir, maxDist, skip) {
    let best = null;
    const step = this.cell * 0.5;
    const seen = new Set();
    for (let s = 0; s <= maxDist + step; s += step) {
      const p = { x: o.x + dir.x * s, z: o.z + dir.z * s };
      for (const seg of this.near(p, this.cell * 0.75)) {
        if (seg === skip || seen.has(seg)) continue;
        seen.add(seg);
        const t = raySegment(o, dir, seg.a, seg.b);
        if (t != null && t <= maxDist && (!best || t < best.t)) best = { t, seg };
      }
      if (best && best.t < s) break;
    }
    return best;
  }
}
