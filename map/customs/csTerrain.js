// Finer relief of Customs, derived from the coarse relief of object heights (services/terrain.js, 6 m grid):
// - resampled to a 2 m grid;
// - road beds follow a smoothed line along each SVG road, with ditches beside the paved roads (Main_Roads, High_Roads,
//   Roads) and a shallow trough under the dirt roads (Dirt_Roads);
// - the railway (SVG Railway) runs on a low embankment;
// - paved yards (SVG Pavement) are planes fitted to the ground under them;
// - open ground gets a gentle unevenness and a few hollows and pits.
// Approximate: the ditches, embankment, unevenness and pits are a stylization (not in open data); the large-scale
// relief stays the one measured from object heights.

import { rng, hashString, pointInPolygon } from '../city/util.js';
import { ringInfo } from '../interchange/icKit.js';

const PAVED = { Main_Roads: 0.85, High_Roads: 0.85, Roads: 0.55 };
const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Road/rail lines resampled every `step` m with a smoothed height of the coarse relief along them.
function denseLines(svg, ids, coarse, step = 2, win = 7) {
  const out = [];
  for (const id of ids) {
    for (const s of svg.strokes(id)) {
      for (const line of s.lines) {
        const pts = [];
        for (let i = 0; i < line.length - 1; i += 1) {
          const a = line[i];
          const b = line[i + 1];
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const n = Math.max(1, Math.ceil(len / step));
          for (let k = 0; k < n; k += 1) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
        }
        pts.push(line[line.length - 1]);
        if (pts.length < 2) continue;
        const raw = pts.map((p) => coarse.heightAtScene(p.x, p.z));
        const h = raw.map((_, i) => {
          let sum = 0;
          let k = 0;
          for (let j = Math.max(0, i - win); j <= Math.min(raw.length - 1, i + win); j += 1) { sum += raw[j]; k += 1; }
          return sum / k;
        });
        out.push({ id, half: s.width / 2, pts, h });
      }
    }
  }
  return out;
}

export function refineTerrain(coarse, svg, { cell = 2 } = {}) {
  const span = { x: (coarse.cols - 1) * coarse.cell, z: (coarse.rows - 1) * coarse.cell };
  const cols = Math.floor(span.x / cell) + 1;
  const rows = Math.floor(span.z / cell) + 1;
  const n = cols * rows;
  const { gx0, gz0 } = coarse;
  const heights = new Float32Array(n);
  const sx = (c) => -(gx0 + c * cell); // scene x of a column
  const sz = (r) => gz0 + r * cell;
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) heights[r * cols + c] = coarse.heightAtGame(gx0 + c * cell, gz0 + r * cell);

  // weight of the natural unevenness (0 on roads, yards, rails, under buildings)
  const rough = new Float32Array(n).fill(1);
  // nodes of a scene-space box
  const eachNode = (x0, x1, z0, z1, fn) => {
    const c0 = Math.max(0, Math.floor((-x1 - gx0) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((-x0 - gx0) / cell));
    const r0 = Math.max(0, Math.floor((z0 - gz0) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((z1 - gz0) / cell));
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) fn(r * cols + c, { x: sx(c), z: sz(r) });
  };

  // ---- paved yards: a plane fitted to the ground under each one
  const yards = svg.polygons('Pavement', { minArea: 20 });
  for (const poly of yards) {
    const b = ringInfo(poly.outer).bounds;
    const inside = [];
    eachNode(b.x0, b.x1, b.z0, b.z1, (i, p) => { if (pointInPolygon(p, poly)) inside.push([i, p]); });
    if (inside.length < 3) continue;
    // least squares h = a + bx + cz (centered)
    let mx = 0; let mz = 0; let mh = 0;
    for (const [i, p] of inside) { mx += p.x; mz += p.z; mh += heights[i]; }
    mx /= inside.length; mz /= inside.length; mh /= inside.length;
    let sxx = 0; let szz = 0; let sxz = 0; let sxh = 0; let szh = 0;
    for (const [i, p] of inside) {
      const dx = p.x - mx; const dz = p.z - mz; const dh = heights[i] - mh;
      sxx += dx * dx; szz += dz * dz; sxz += dx * dz; sxh += dx * dh; szh += dz * dh;
    }
    const det = sxx * szz - sxz * sxz || 1;
    const bx = (sxh * szz - szh * sxz) / det;
    const bz = (szh * sxx - sxh * sxz) / det;
    for (const [i, p] of inside) {
      heights[i] = mh + bx * (p.x - mx) + bz * (p.z - mz);
      rough[i] = 0;
    }
  }

  // ---- roads and rails: nearest line per node within its reach
  const dist = new Float32Array(n).fill(Infinity);
  const lineH = new Float32Array(n);
  const half = new Float32Array(n);
  const kind = new Uint8Array(n); // 1 paved, 2 dirt, 3 rail
  const depth = new Float32Array(n);
  const lines = [
    ...denseLines(svg, ['Main_Roads', 'High_Roads', 'Roads'], coarse).map((l) => ({ ...l, kind: 1, reach: l.half + 6, ditch: PAVED[l.id] })),
    ...denseLines(svg, ['Dirt_Roads'], coarse).map((l) => ({ ...l, kind: 2, reach: l.half + 3, ditch: 0 })),
    ...denseLines(svg, ['Railway'], coarse, 2, 12).map((l) => ({ ...l, half: 2.4, kind: 3, reach: 7.5, ditch: 0 })),
  ];
  for (const l of lines) {
    for (let k = 0; k < l.pts.length - 1; k += 1) {
      const a = l.pts[k];
      const b = l.pts[k + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1e-9;
      eachNode(Math.min(a.x, b.x) - l.reach, Math.max(a.x, b.x) + l.reach, Math.min(a.z, b.z) - l.reach, Math.max(a.z, b.z) + l.reach, (i, p) => {
        const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
        const d = Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
        if (d > l.reach) return;
        // the closer line wins; a paved road beats a dirt track or rails at the same distance
        const score = d - l.half;
        const cur = dist[i] - half[i];
        if (dist[i] !== Infinity && !(score < cur - 0.01 || (Math.abs(score - cur) <= 0.01 && l.kind < kind[i]))) return;
        dist[i] = d;
        half[i] = l.half;
        kind[i] = l.kind;
        depth[i] = l.ditch;
        lineH[i] = l.h[k] + (l.h[k + 1] - l.h[k]) * t;
      });
    }
  }
  const yardMask = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) if (rough[i] === 0) yardMask[i] = 1;
  let ditches = 0;
  for (let i = 0; i < n; i += 1) {
    if (dist[i] === Infinity) continue;
    const d = dist[i];
    const hw = half[i];
    const nat = heights[i];
    if (kind[i] === 3) {
      // embankment: flat top 0.8 m above the smoothed line, slopes down to the natural ground
      const top = lineH[i] + 0.8;
      const s = smoothstep((d - hw) / 5);
      heights[i] = top + (nat - top) * s;
      rough[i] = Math.min(rough[i], s);
      continue;
    }
    const bed = lineH[i] - (kind[i] === 2 ? 0.12 : 0);
    const shoulder = kind[i] === 2 ? 2.5 : 5;
    const s = smoothstep((d - hw - 0.3) / shoulder);
    let h = yardMask[i] && kind[i] === 2 ? nat : bed + (nat - bed) * s;
    // ditch beside paved roads (not across yards)
    if (depth[i] && !yardMask[i] && d > hw + 1.2 && d < hw + 4.2) {
      h -= depth[i] * Math.sin((Math.PI * (d - hw - 1.2)) / 3);
      ditches += 1;
    }
    heights[i] = h;
    rough[i] = Math.min(rough[i], s);
  }

  // ---- buildings: no unevenness under them
  for (const id of ['Buildings', 'Powerline_Towers']) {
    for (const poly of svg.polygons(id, { minArea: 2 })) {
      const b = ringInfo(poly.outer).bounds;
      eachNode(b.x0 - 2, b.x1 + 2, b.z0 - 2, b.z1 + 2, (i, p) => {
        if (pointInPolygon(p, poly)) rough[i] = 0;
        else rough[i] = Math.min(rough[i], 0.4);
      });
    }
  }

  // ---- gentle unevenness of open ground (value noise, two octaves)
  const lattice = (i, j, s) => {
    const h = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const vnoise = (x, z, size, s) => {
    const fx = x / size; const fz = z / size;
    const i = Math.floor(fx); const j = Math.floor(fz);
    const tx = smoothstep(fx - i); const tz = smoothstep(fz - j);
    return (lattice(i, j, s) * (1 - tx) + lattice(i + 1, j, s) * tx) * (1 - tz) + (lattice(i, j + 1, s) * (1 - tx) + lattice(i + 1, j + 1, s) * tx) * tz;
  };
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (!rough[i]) continue;
      const x = sx(c);
      const z = sz(r);
      heights[i] += rough[i] * ((vnoise(x, z, 34, 1) - 0.5) * 0.9 + (vnoise(x, z, 11, 2) - 0.5) * 0.35);
    }
  }

  // ---- hollows and pits in open ground
  const rp = rng(hashString('customs-pits'));
  const pits = [];
  for (let tries = 0; tries < 4000 && pits.length < 70; tries += 1) {
    const c = Math.floor(rp() * cols);
    const r = Math.floor(rp() * rows);
    const i = r * cols + c;
    if (rough[i] < 0.99) continue;
    const big = rp() < 0.3;
    const rad = big ? 5 + rp() * 5 : 1.6 + rp() * 2.2;
    const dep = big ? 0.5 + rp() * 0.6 : 0.4 + rp() * 0.6;
    const p = { x: sx(c), z: sz(r) };
    let clear = true;
    eachNode(p.x - rad, p.x + rad, p.z - rad, p.z + rad, (j) => { if (rough[j] < 0.9) clear = false; });
    if (!clear) continue;
    eachNode(p.x - rad, p.x + rad, p.z - rad, p.z + rad, (j, q) => {
      const t = Math.hypot(q.x - p.x, q.z - p.z) / rad;
      if (t < 1) heights[j] -= dep * (1 - smoothstep(t)) ;
    });
    pits.push({ x: p.x, z: p.z, rad, dep, big });
  }

  const heightAtGame = (gx, gz) => {
    const fx = Math.min(cols - 1.001, Math.max(0, (gx - gx0) / cell));
    const fz = Math.min(rows - 1.001, Math.max(0, (gz - gz0) / cell));
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const tx = fx - c;
    const tz = fz - r;
    const i = r * cols + c;
    // follow the triangle split of the mesh (a-b-d / b-e-d), so objects sit on the drawn surface
    if (tx + tz <= 1) return heights[i] + (heights[i + 1] - heights[i]) * tx + (heights[i + cols] - heights[i]) * tz;
    const e = heights[i + cols + 1];
    return e + (heights[i + cols] - e) * (1 - tx) + (heights[i + 1] - e) * (1 - tz);
  };
  return {
    cols, rows, cell, gx0, gz0, heights,
    samples: coarse.samples, pits: coarse.pits,
    detail: { ditchNodes: ditches, hollows: pits.length, yards: yards.length },
    hollows: pits,
    rough,
    // 0 on roads, yards, rails and under buildings .. 1 on open ground
    roughAt: (x, z) => {
      const c = Math.round((-x - gx0) / cell);
      const r = Math.round((z - gz0) / cell);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return 0;
      return rough[r * cols + c];
    },
    heightAtGame,
    heightAtScene: (x, z) => heightAtGame(-x, z),
  };
}
