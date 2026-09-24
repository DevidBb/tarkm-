// Geometry kit for the Interchange model: merged triangle buckets with vertex colors, walls along polygon rings,
// slabs with holes, boxes, glass railings, paint strips. Everything is built in the coordinates the caller gives
// (scene meters); levels build at local height 0 and are moved as a group.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';

export const color = (hex) => new THREE.Color(hex);

export class MeshBucket {
  // uvOf(x, z, y, u, v) -> [u, v]: world-mapped texture coordinates (floor plans); otherwise the given u/v are used.
  constructor(uvOf = null) {
    this.p = [];
    this.n = [];
    this.c = [];
    this.uv = [];
    this.uvOf = uvOf;
  }

  get empty() {
    return this.p.length === 0;
  }

  push(v, n, col) {
    this.p.push(v[0], v[1], v[2]);
    this.n.push(n[0], n[1], n[2]);
    this.c.push(col.r, col.g, col.b);
    if (this.uvOf) {
      const t = this.uvOf(v[0], v[2], v[1], v[3], v[4]);
      this.uv.push(t[0], t[1]);
    } else {
      this.uv.push(v[3] || 0, v[4] || 0);
    }
  }

  // a, b, c: [x, y, z, u, v]; the winding is fixed so the face normal agrees with n.
  tri(a, b, c, n, ca, cb = ca, cc = ca) {
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
    const gx = uy * vz - uz * vy; const gy = uz * vx - ux * vz; const gz = ux * vy - uy * vx;
    if (gx * n[0] + gy * n[1] + gz * n[2] < 0) {
      this.push(a, n, ca); this.push(c, n, cc); this.push(b, n, cb);
    } else {
      this.push(a, n, ca); this.push(b, n, cb); this.push(c, n, cc);
    }
  }

  quad(a, b, c, d, n, ca, cb = ca, cc = cb, cd = cc) {
    this.tri(a, b, c, n, ca, cb, cc);
    this.tri(a, c, d, n, ca, cc, cd);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }

  mesh(material) {
    return this.empty ? null : new THREE.Mesh(this.geometry(), material);
  }
}

// Vertical walls along a closed ring (or an open polyline) from y0 to y1.
export function ringWalls(bucket, ring, y0, y1, colorLow, colorHigh = colorLow, { closed = true, uvScale = 4 } = {}) {
  let s = 0;
  const count = closed ? ring.length : ring.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.02) continue;
    const n = [(b.z - a.z) / len, 0, -(b.x - a.x) / len];
    bucket.quad(
      [a.x, y0, a.z, s / uvScale, y0 / uvScale],
      [b.x, y0, b.z, (s + len) / uvScale, y0 / uvScale],
      [b.x, y1, b.z, (s + len) / uvScale, y1 / uvScale],
      [a.x, y1, a.z, s / uvScale, y1 / uvScale],
      n, colorLow, colorLow, colorHigh, colorHigh,
    );
    s += len;
  }
}

// Horizontal polygon with holes at height y.
export function slab(bucket, poly, y, col, { down = false, uvScale = 4 } = {}) {
  const contour = poly.outer.map((p) => new THREE.Vector2(p.x, p.z));
  const holes = (poly.holes || []).map((h) => h.map((p) => new THREE.Vector2(p.x, p.z)));
  const all = [...contour, ...holes.flat()];
  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, holes);
  } catch {
    return 0;
  }
  const n = down ? [0, -1, 0] : [0, 1, 0];
  for (const [i, j, k] of tris) {
    const a = all[i];
    const b = all[j];
    const c = all[k];
    if (!a || !b || !c) continue;
    bucket.tri([a.x, y, a.y, a.x / uvScale, a.y / uvScale], [b.x, y, b.y, b.x / uvScale, b.y / uvScale], [c.x, y, c.y, c.x / uvScale, c.y / uvScale], n, col);
  }
  return tris.length;
}

// Box (optionally rotated around Y) from y0 to y0 + sy.
export function box(bucket, cx, y0, cz, sx, sy, sz, rotY, col, top = col) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const pt = (dx, dz, y) => [cx + dx * c + dz * s, y, cz - dx * s + dz * c];
  const hx = sx / 2;
  const hz = sz / 2;
  const y1 = y0 + sy;
  const p = [pt(-hx, -hz, y0), pt(hx, -hz, y0), pt(hx, hz, y0), pt(-hx, hz, y0), pt(-hx, -hz, y1), pt(hx, -hz, y1), pt(hx, hz, y1), pt(-hx, hz, y1)];
  const face = (i0, i1, i2, i3, n, col0, col1 = col0) => bucket.quad(p[i0], p[i1], p[i2], p[i3], n, col0, col0, col1, col1);
  const rot = (x, z) => [x * c + z * s, 0, -x * s + z * c];
  face(4, 5, 6, 7, [0, 1, 0], top);
  face(0, 1, 5, 4, rot(0, -1), col);
  face(1, 2, 6, 5, rot(1, 0), col);
  face(2, 3, 7, 6, rot(0, 1), col);
  face(3, 0, 4, 7, rot(-1, 0), col);
}

// Flat strip on a surface (paint lines, rails, ramps) along a->b.
export function strip(bucket, a, b, width, y, col) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 0.01) return;
  const nx = (-(b.z - a.z) / len) * (width / 2);
  const nz = ((b.x - a.x) / len) * (width / 2);
  bucket.quad([a.x - nx, y, a.z - nz], [b.x - nx, y, b.z - nz], [b.x + nx, y, b.z + nz], [a.x + nx, y, a.z + nz], [0, 1, 0], col);
}

// Glass balustrade with a handrail along a ring or polyline.
export function railing(glass, metal, pts, y, height, { closed = true } = {}) {
  const glassCol = color('#ffffff');
  const railCol = color('#8b9094');
  const count = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.05) continue;
    const n = [(b.z - a.z) / len, 0, -(b.x - a.x) / len];
    glass.quad([a.x, y + 0.08, a.z], [b.x, y + 0.08, b.z], [b.x, y + height, b.z], [a.x, y + height, a.z], n, glassCol);
    strip(metal, a, b, 0.1, y + height + 0.02, railCol);
  }
}

// Ring statistics used to classify holes of floor plans (thin wall lines vs rooms vs voids).
export function ringInfo(ring) {
  let area = 0;
  let perimeter = 0;
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    area += p.x * q.z - q.x * p.z;
    perimeter += Math.hypot(q.x - p.x, q.z - p.z);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  area = Math.abs(area / 2);
  // Width of a thin shape ~ 2 * area / perimeter (exact for long rectangles).
  const width = perimeter > 0 ? (2 * area) / perimeter : 0;
  return { area, perimeter, width, bounds: { x0, x1, z0, z1 }, center: { x: (x0 + x1) / 2, z: (z0 + z1) / 2 } };
}
