// City analysis: turns the real Streets geometry (SVG footprints, roads, fences, trees) and tarkov.dev data
// (loot / marker heights, accessible floors, sniper roof spawns, place names) into a description of the city
// that the mesh builders render. Nothing here invents positions: buildings stand on their SVG footprints,
// street furniture follows the SVG road edges. What is estimated (storeys without evidence, facade style)
// is derived deterministically from the data and marked `estimated` so the UI can say so.

import { SVGLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/SVGLoader.js/+esm';
import { FLOOR_DISPLAY_Y } from '../../services/coords.js';
import { STOREY, GROUND_STOREY } from './textures.js';
import {
  rng, hashString, pick, clamp, signedArea, orient, simplifyRing, turnAngle, edgeFrame, dist, centroid,
  pointInPolygon, distToSegment, SegmentGrid,
} from './util.js';

const BAND_MIN = { 2: 10, 3: 15, 4: 20, 5: 25 }; // tarkov.dev floor height bands (game meters)

const KINDS = {
  residential: { styles: ['stalinka', 'stalinka', 'panel', 'brick', 'silicate'], storeys: [5, 8], depth: 14, ground: 'entrance', balcony: 0.35, ac: 0.08 },
  modern: { styles: ['modern'], storeys: [9, 12], depth: 16, ground: 'shop', balcony: 0.45, ac: 0.1 },
  hotel: { styles: ['panel', 'stalinka'], storeys: [6, 8], depth: 15, ground: 'shop', balcony: 0.08, ac: 0.14 },
  office: { styles: ['office', 'panel'], storeys: [4, 6], depth: 16, ground: 'entrance', balcony: 0, ac: 0.18 },
  commercial: { styles: ['glass', 'office', 'modern'], storeys: [2, 3], depth: 22, ground: 'shop', balcony: 0, ac: 0.06 },
  showroom: { styles: ['glass'], storeys: [1, 2], depth: 20, ground: 'showroom', balcony: 0, ac: 0 },
  cinema: { styles: ['office'], storeys: [3, 4], depth: 30, ground: 'shop', balcony: 0, ac: 0.02 },
  school: { styles: ['silicate'], storeys: [3, 4], depth: 14, ground: 'entrance', balcony: 0, ac: 0.02 },
  government: { styles: ['stalinka'], storeys: [3, 4], depth: 16, ground: 'entrance', balcony: 0, ac: 0.08 },
  clinic: { styles: ['silicate'], storeys: [2, 2], depth: 12, ground: 'entrance', balcony: 0, ac: 0.1 },
  lowrise: { styles: ['brick', 'silicate', 'panel'], storeys: [1, 3], depth: 12, ground: 'entrance', balcony: 0.15, ac: 0.08 },
  industrial: { styles: ['industrial'], height: [7, 10], depth: 30, ground: 'gates', balcony: 0, ac: 0 },
  garage: { styles: ['industrial'], height: [2.8, 3.2], depth: 12, ground: 'garage', balcony: 0, ac: 0 },
  kiosk: { styles: ['industrial'], height: [2.8, 3.4], depth: 10, ground: 'shop', balcony: 0, ac: 0 },
  construction: { styles: ['frame'], storeys: [3, 4], depth: 40, ground: null, balcony: 0, ac: 0 },
};

export const KIND_LABELS = {
  residential: 'Жилой дом', modern: 'Современный жилой комплекс', hotel: 'Гостиница', office: 'Офисное здание',
  commercial: 'Торговое здание', showroom: 'Автосалон', cinema: 'Кинотеатр', school: 'Школа', government: 'Административное здание',
  clinic: 'Клиника', lowrise: 'Малоэтажное здание', industrial: 'Промышленное здание', garage: 'Гаражи', kiosk: 'Киоск / павильон',
  construction: 'Недострой',
};

const TINTS = {
  stalinka: ['#e3b877', '#e8d08c', '#d8a58c', '#bcc6a6', '#d9d0bd', '#e0c39a'],
  panel: ['#ffffff', '#ebe6db', '#d6dade', '#efe1cb', '#dcdcd4'],
  brick: ['#b0664b', '#a45a42', '#c07a5e', '#9b5540'],
  silicate: ['#f2ecdc', '#e6e0cf', '#ded6c0'],
  office: ['#ffffff', '#e2e6e6', '#e8e2d4'],
  modern: ['#ffffff', '#efcfb6', '#dde3e6', '#e9dcc4'],
  industrial: ['#ffffff', '#cfd6c9', '#d8cdb8', '#c9d3db'],
  glass: ['#ffffff', '#dfe8ea'],
  frame: ['#d0cdc4'],
};

// Signs only where the data names a place. Brand spellings follow the game's own texts in the quest data.
const SIGN_RULES = [
  [/pharmacy/i, 'АПТЕКА', '#1f7a3c', '#f2f2ea'],
  [/post office/i, 'ПОЧТА', '#1f4fa8', '#f2f2ea'],
  [/tarbank/i, 'TARBANK', '#1c2a44', '#e8c36a'],
  [/cardinal bank/i, 'CARDINAL BANK', '#6d1b1b', '#f2e6c8'],
  [/pinewood/i, 'PINEWOOD HOTEL', '#23312a', '#e9e2c8'],
  [/sparja/i, 'СПАРЖА', '#c62828', '#ffffff'],
  [/shestyorochka/i, 'ШЕСТЁРОЧКА', '#d32f2f', '#ffffff'],
  [/lexos/i, 'LEXOS', '#e9e9e4', '#1d1d1d'],
  [/beluga/i, 'BELUGA', '#0f2233', '#d9c38a'],
  [/k[il]{2}mov shopping mall/i, 'KLIMOV MALL', '#2a2a2a', '#f0c24b'],
  [/cinema/i, 'КИНОТЕАТР «РОДИНА»', '#7a1f1f', '#f2e6c8'],
  [/vet clinic/i, 'ВЕТКЛИНИКА', '#e9ede8', '#1f6f4a'],
  [/ministry of the interior/i, 'АКАДЕМИЯ МВД', '#1f3354', '#e9e2c8'],
  [/lerm expo/i, 'LERM EXPO', '#e6e6e0', '#1f3354'],
  [/concordia/i, 'CONCORDIA', '#2b2f33', '#e9e2c8'],
  [/burger spot/i, 'BURGER SPOT', '#b3261e', '#f7d046'],
  [/bilbo coffee/i, 'BILBO COFFEE', '#3b2a1e', '#e9dcc0'],
  [/prestigio/i, 'PRESTIGIO', '#1d1d1d', '#d9c38a'],
  [/diner/i, 'DINER', '#1f4fa8', '#f2f2ea'],
  [/corner restaurant/i, 'РЕСТОРАН', '#3b2a1e', '#e9dcc0'],
  [/family market/i, 'FAMILY MARKET', '#2e7d32', '#ffffff'],
  [/hive/i, 'HIVE', '#1d1d1d', '#f0c24b'],
  [/hotel/i, 'ГОСТИНИЦА', '#23312a', '#e9e2c8'],
];

function signFor(name) {
  const rule = SIGN_RULES.find(([re]) => re.test(name));
  return rule ? { text: rule[1], bg: rule[2], fg: rule[3], label: name } : null;
}

function hull(points) {
  const s = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower = [];
  const upper = [];
  for (const p of s) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of s.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function minRect(points) {
  const h = hull(points);
  let best = { area: Infinity, w: 0, d: 0 };
  for (let i = 0; i < h.length; i += 1) {
    const { dir } = edgeFrame(h[i], h[(i + 1) % h.length]);
    let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity;
    for (const p of h) {
      const u = p.x * dir.x + p.z * dir.z;
      const v = -p.x * dir.z + p.z * dir.x;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) best = { area, w: Math.min(u1 - u0, v1 - v0), d: Math.max(u1 - u0, v1 - v0) };
  }
  return best;
}

function bounds(ring) {
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  return { x0, x1, z0, z1 };
}

const inBounds = (p, b, m = 0) => p.x >= b.x0 - m && p.x <= b.x1 + m && p.z >= b.z0 - m && p.z <= b.z1 + m;

function distToRings(p, rings) {
  let best = Infinity;
  for (const ring of rings) for (let i = 0; i < ring.length; i += 1) best = Math.min(best, distToSegment(p, ring[i], ring[(i + 1) % ring.length]).d);
  return best;
}

// ---------------------------------------------------------------- roads
function buildRoads(polys) {
  const edges = [];
  const rings = [];
  for (const poly of polys) {
    for (const ring of [poly.outer, ...poly.holes]) {
      rings.push(ring);
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length];
        edges.push({ a, b, ...edgeFrame(a, b), ring, i });
      });
    }
  }
  const grid = new SegmentGrid(edges, 24);
  for (const e of edges) {
    const mid = { x: (e.a.x + e.b.x) / 2, z: (e.a.z + e.b.z) / 2 };
    const hit = grid.ray(mid, { x: -e.out.x, z: -e.out.z }, 60, e);
    e.width = hit ? hit.t : null;
  }

  const center = [];
  const seen = new Set();
  for (const e of edges) {
    for (let s = 3; s < e.len - 2; s += 6) {
      const p = { x: e.a.x + e.dir.x * s, z: e.a.z + e.dir.z * s };
      const hit = grid.ray(p, { x: -e.out.x, z: -e.out.z }, 40, e);
      if (!hit || hit.t < 5) continue;
      if (Math.abs(e.dir.x * hit.seg.dir.x + e.dir.z * hit.seg.dir.z) < 0.94) continue;
      const c = { x: p.x - (e.out.x * hit.t) / 2, z: p.z - (e.out.z * hit.t) / 2 };
      const key = `${Math.round(c.x / 3)},${Math.round(c.z / 3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      center.push({ x: c.x, z: c.z, dir: e.dir, width: hit.t });
    }
  }

  const corners = [];
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i += 1) {
      const a = ring[(i - 1 + n) % n];
      const b = ring[i];
      const c = ring[(i + 1) % n];
      const deg = Math.abs(turnAngle(a, b, c)) * (180 / Math.PI);
      if (deg < 50 || deg > 130 || dist(a, b) < 10 || dist(b, c) < 10) continue;
      const o0 = edgeFrame(a, b).out;
      const o1 = edgeFrame(b, c).out;
      const len = Math.hypot(o0.x + o1.x, o0.z + o1.z) || 1;
      corners.push({ p: b, out: { x: (o0.x + o1.x) / len, z: (o0.z + o1.z) / len }, dirs: [edgeFrame(a, b).dir, edgeFrame(b, c).dir] });
    }
  }
  const contains = (p) => polys.some((poly) => pointInPolygon(p, poly));
  return { polys, edges, grid, center, corners, contains };
}

// ---------------------------------------------------------------- buildings
function classify({ area, rect, names, containers, upperFloors }) {
  const has = (re) => re.test(names);
  const cnt = (n) => containers[n] || 0;
  if (area < 130 && rect.w < 10) return 'kiosk';
  if (has(/construction/i)) return 'construction';
  if (has(/lexos|dealership/i)) return 'showroom';
  if (has(/cinema/i)) return 'cinema';
  if (has(/school/i)) return 'school';
  if (has(/ministry|academy/i)) return 'government';
  if (has(/vet clinic/i)) return 'clinic';
  if (has(/mall|expo/i)) return 'commercial';
  if (has(/concordia|cardinal/i)) return 'modern';
  if (area > 6000) return 'residential';
  if (has(/hotel/i)) return 'hotel';
  if (has(/grocery|market|shestyorochka|sparja/i)) return 'commercial';
  if (has(/factory/i)) return 'industrial';
  if (rect.w <= 16 && rect.d / Math.max(rect.w, 1) >= 2.8 && area < 1700 && !upperFloors) return 'garage';
  if (cnt('Toolbox') + cnt('Technical supply crate') + cnt('Wooden crate') + cnt('Grenade box') >= 6 && cnt('Drawer') < 6) return 'industrial';
  if (cnt('PC block') >= 4 || (cnt('Drawer') >= 12 && area < 1500)) return 'office';
  if (area < 450) return 'lowrise';
  return 'residential';
}

function heightFor(def, r, base, ev) {
  if (def.height) {
    let top = base + def.height[0] + r() * (def.height[1] - def.height[0]);
    if (ev.maxY != null) top = Math.max(top, ev.maxY + 3);
    if (ev.roofY != null) top = Math.max(top, ev.roofY + 0.2);
    return { top, storeys: null, estimated: ev.maxY == null && ev.roofY == null };
  }
  const storeysDefault = def.storeys[0] + Math.floor(r() * (def.storeys[1] - def.storeys[0] + 1));
  if (ev.roofY != null) {
    const top = ev.roofY + 0.2;
    return { top, storeys: Math.max(1, Math.round((top - base - GROUND_STOREY) / STOREY)), estimated: false };
  }
  let minTop = base + GROUND_STOREY + storeysDefault * STOREY;
  if (ev.maxY != null) minTop = Math.max(minTop, ev.maxY + 3.2);
  if (ev.band) minTop = Math.max(minTop, BAND_MIN[ev.band] + 4);
  const storeys = Math.max(1, Math.ceil((minTop - base - GROUND_STOREY) / STOREY - 0.05));
  return { top: base + GROUND_STOREY + storeys * STOREY, storeys, estimated: true };
}

function evidenceNear(items, test) {
  let maxY = null;
  let band = 0;
  let roofY = null;
  for (const e of items.points) if (test(e.p)) maxY = maxY == null ? e.y : Math.max(maxY, e.y);
  for (const f of items.floors) if (f.area >= 40 && test(f.c)) band = Math.max(band, f.n);
  for (const rp of items.roofs) if (test(rp.p)) roofY = roofY == null ? rp.y : Math.max(roofY, rp.y);
  return { maxY, band, roofY };
}

// Splits a ring into facade runs: at real corners, and every 28-48 m along long walls.
function splitRuns(ring, r) {
  const pts = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    pts.push(a);
    const k = Math.floor(dist(a, b) / 40);
    for (let j = 1; j <= k; j += 1) {
      const t = j / (k + 1);
      pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, soft: true });
    }
  });
  const n = pts.length;
  const corner = pts.map((p, i) => !p.soft && Math.abs(turnAngle(pts[(i - 1 + n) % n], p, pts[(i + 1) % n])) > (35 * Math.PI) / 180);
  let start = corner.findIndex(Boolean);
  if (start < 0) start = 0;
  const runs = [];
  let cur = [start];
  let len = 0;
  let target = 28 + r() * 20;
  for (let k = 1; k <= n; k += 1) {
    const i = (start + k) % n;
    len += dist(pts[cur[cur.length - 1]], pts[i]);
    cur.push(i);
    if (k === n || corner[i] || len >= target) {
      runs.push(cur);
      cur = [i];
      len = 0;
      target = 28 + r() * 20;
    }
  }
  return { pts, runs };
}

function miterPoint(pts, i, depth) {
  const n = pts.length;
  const p = pts[i];
  const o0 = edgeFrame(pts[(i - 1 + n) % n], p).out;
  const o1 = edgeFrame(p, pts[(i + 1) % n]).out;
  let mx = -(o0.x + o1.x);
  let mz = -(o0.z + o1.z);
  const len = Math.hypot(mx, mz);
  if (len < 1e-3) { mx = -o1.x; mz = -o1.z; } else { mx /= len; mz /= len; }
  const cosHalf = Math.max(0.35, mx * -o1.x + mz * -o1.z);
  return { x: p.x + (mx * depth) / cosHalf, z: p.z + (mz * depth) / cosHalf };
}

function makeRunStyle(def, kind, r, commercial, isOuter) {
  const style = pick(r, def.styles);
  let ground = def.ground;
  if (ground === 'entrance' && commercial && isOuter && r() < 0.75) ground = 'shop';
  return { kind, style, variant: Math.floor(r() * 2), tint: pick(r, TINTS[style] || ['#ffffff']), ground, balcony: def.balcony, ac: def.ac };
}

export function buildCityModel({ svgDoc, mapData, environment }) {
  const P = mapData.projection;
  const base = FLOOR_DISPLAY_Y.GROUND;
  const loader = new SVGLoader();
  const ser = new XMLSerializer();
  const toScene = (v) => ({ x: P.sceneLeft + v.x * P.svgScaleX, z: P.sceneTop + v.y * P.svgScaleZ });
  const game2 = (p) => ({ x: -p.x, z: p.z });

  const polysOf = (el) => {
    const data = loader.parse(`<svg xmlns="http://www.w3.org/2000/svg">${ser.serializeToString(el)}</svg>`);
    return data.paths.flatMap((path) => SVGLoader.createShapes(path)).map((shape) => {
      const outer = orient(simplifyRing(shape.getPoints(4).map(toScene), 0.5, 4), true);
      if (outer.length < 3 || signedArea(outer) < 4) return null;
      const holes = shape.holes
        .map((h) => orient(simplifyRing(h.getPoints(4).map(toScene), 0.5, 4), false))
        .filter((h) => h.length >= 3 && Math.abs(signedArea(h)) > 4);
      return { outer, holes };
    }).filter(Boolean);
  };

  const roadEl = svgDoc.querySelector('#road');
  const roads = buildRoads(roadEl ? [...roadEl.children].flatMap(polysOf) : []);
  const streetFacing = (mid, out) => {
    const probe = { x: mid.x + out.x * 6, z: mid.z + out.z * 6 };
    return roads.contains(probe) || Boolean(roads.grid.nearest(probe, 7));
  };

  const labels = mapData.entities.filter((e) => e.type === 'place' && e.name).map((e) => ({ name: e.name, p: game2(e.position) }));
  const points = [
    ...mapData.loot.map((e) => ({ p: game2(e.position), y: e.position.y, container: e.meta.category === 'loose' ? null : e.name })),
    ...mapData.entities.filter((e) => e.type !== 'place' && e.type !== 'street' && e.position.y != null).map((e) => ({ p: game2(e.position), y: e.position.y })),
  ];
  const roofs = ((environment && environment.roofPoints) || []).map((rp) => ({ p: game2(rp.position), y: rp.position.y }));
  const floorShapes = [];
  for (const n of [2, 3, 4, 5]) {
    for (const el of svgDoc.querySelectorAll(`#Floor-${n} > *`)) {
      for (const poly of polysOf(el)) floorShapes.push({ n, c: centroid(poly.outer), area: signedArea(poly.outer) });
    }
  }

  const buildings = [];
  [...svgDoc.querySelectorAll('#buildings > *')].forEach((el, index) => {
    polysOf(el).forEach((poly, part) => {
      const id = `${index}.${part}`;
      const r = rng(hashString(`building:${id}`));
      const b = bounds(poly.outer);
      const rings = [poly.outer, ...poly.holes];
      const area = signedArea(poly.outer) - poly.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
      const rect = minRect(poly.outer);
      const inside = (p) => inBounds(p, b) && pointInPolygon(p, poly);
      const near = labels.filter((l) => inBounds(l.p, b, 14) && (pointInPolygon(l.p, poly) || distToRings(l.p, [poly.outer]) < 14));
      const items = {
        points: points.filter((e) => inside(e.p)),
        floors: floorShapes.filter((f) => inside(f.c)),
        roofs: roofs.filter((rp) => inBounds(rp.p, b, 3) && (pointInPolygon(rp.p, poly) || distToRings(rp.p, [poly.outer]) < 3)),
      };
      const containers = {};
      for (const e of items.points) if (e.container) containers[e.container] = (containers[e.container] || 0) + 1;
      const names = near.map((l) => l.name).join(' | ');
      const upperFloors = items.floors.some((f) => f.area >= 40);
      const kind = classify({ area, rect, names, containers, upperFloors });
      const def = KINDS[kind];
      const commercial = (containers['Cash register'] || 0) >= 2 || /pharmacy|cafe|coffee|diner|restaurant|burger|market|bank|post office|sparja|hive|grocery/i.test(names);

      const building = { id, kind, kindLabel: KIND_LABELS[kind], poly, rings, area, rect, labels: near.map((l) => l.name), volumes: [], filler: null, signs: [], estimated: true };
      const wallsOf = (outerPts, isOuter, run) => outerPts.slice(0, -1).map((a, i) => {
        const bb = outerPts[i + 1];
        const f = edgeFrame(a, bb);
        const mid = { x: (a.x + bb.x) / 2, z: (a.z + bb.z) / 2 };
        return { a, b: bb, ...f, facing: isOuter && streetFacing(mid, f.out) ? 'street' : 'court', run };
      });

      const big = area >= 1800 && rect.w >= 34 && kind !== 'construction';
      if (!big) {
        const ev = evidenceNear(items, () => true);
        const h = heightFor(def, r, base, ev);
        const run = { ...makeRunStyle(def, kind, r, commercial, true), top: h.top, storeys: h.storeys };
        const walls = rings.flatMap((ring, ri) => wallsOf([...ring, ring[0]], ri === 0, run));
        building.volumes.push({ top: h.top, run, walls, roof: poly, ends: [] });
        building.estimated = h.estimated;
      } else {
        const depthMax = clamp(def.depth, 8, rect.w * 0.35);
        rings.forEach((ring, ri) => {
          const isOuter = ri === 0;
          const { pts, runs } = splitRuns(ring, r);
          const depth = depthMax;
          const inner = pts.map((_, i) => miterPoint(pts, i, depth));
          const runVolumes = runs.map((idx) => {
            const outerPts = idx.map((i) => pts[i]);
            const innerPts = idx.map((i) => inner[i]);
            const test = (p) => {
              for (let k = 0; k < outerPts.length - 1; k += 1) if (distToSegment(p, outerPts[k], outerPts[k + 1]).d <= depth + 4) return true;
              return false;
            };
            const ev = evidenceNear(items, test);
            const h = heightFor(def, r, base, ev);
            if (!h.estimated) building.estimated = false;
            const run = { ...makeRunStyle(def, kind, r, commercial, isOuter), top: h.top, storeys: h.storeys };
            const walls = [
              ...wallsOf(outerPts, isOuter, run),
              ...wallsOf([...innerPts].reverse(), false, run).map((w) => ({ ...w, facing: 'inner' })),
            ];
            return { top: h.top, run, walls, roof: { outer: orient([...outerPts, ...[...innerPts].reverse()], true), holes: [] }, outerPts, innerPts, ends: [] };
          });
          runVolumes.forEach((v, k) => {
            const prev = runVolumes[(k - 1 + runVolumes.length) % runVolumes.length];
            const next = runVolumes[(k + 1) % runVolumes.length];
            if (runVolumes.length > 1 && v.top > prev.top + 0.3) v.ends.push({ a: v.innerPts[0], b: v.outerPts[0], from: prev.top, to: v.top });
            if (runVolumes.length > 1 && v.top > next.top + 0.3) {
              const last = v.outerPts.length - 1;
              v.ends.push({ a: v.outerPts[last], b: v.innerPts[last], from: next.top, to: v.top });
            }
          });
          building.volumes.push(...runVolumes);
        });
        const minTop = Math.min(...building.volumes.map((v) => v.top));
        const interior = evidenceNear(items, (p) => distToRings(p, rings) > depthMax + 2);
        let fillerTop = base + 4.5;
        if (interior.maxY != null) fillerTop = Math.max(fillerTop, interior.maxY + 3);
        if (interior.band) fillerTop = Math.max(fillerTop, BAND_MIN[interior.band] + 4);
        building.filler = { top: Math.min(fillerTop, minTop - 0.6), roof: poly };
      }

      buildings.push(building);
    });
  });

  // Signs: one per named place, on the nearest facade (street side preferred) of a building big enough
  // to be that place; the same text is not repeated within 80 m (duplicate labels in the source).
  const placed = [];
  for (const l of labels) {
    const sign = signFor(l.name);
    if (!sign || placed.some((s) => s.text === sign.text && dist(s.p, l.p) < 80)) continue;
    let best = null;
    for (const bld of buildings) {
      if (bld.area < 150 || bld.kind === 'construction' || !inBounds(l.p, bounds(bld.poly.outer), 45)) continue;
      for (const v of bld.volumes) {
        for (const w of v.walls) {
          if (w.facing === 'inner' || w.len < 5) continue;
          const d = distToSegment(l.p, w.a, w.b).d - (w.facing === 'street' ? 8 : 0);
          if (d < 40 && (!best || d < best.d)) best = { d, w, v, bld };
        }
      }
    }
    if (!best) continue;
    placed.push({ text: sign.text, p: l.p });
    const width = Math.min(best.w.len * 0.85, 1.6 + sign.text.length * 0.5);
    const y = Math.min(best.v.top - 0.8, base + GROUND_STOREY - 0.45);
    best.bld.signs.push({ ...sign, wall: best.w, width, height: 0.85, y });
  }

  const trees = [...svgDoc.querySelectorAll('#green > circle')].map((c) => {
    const p = toScene({ x: +c.getAttribute('cx'), y: +c.getAttribute('cy') });
    return { x: p.x, z: p.z, r: +c.getAttribute('r') * P.svgScaleX };
  });
  const fences = [...svgDoc.querySelectorAll('#fence > *')].map((el) => {
    const data = loader.parse(`<svg xmlns="http://www.w3.org/2000/svg">${ser.serializeToString(el)}</svg>`);
    return data.paths.flatMap((path) => path.subPaths.map((sp) => sp.getPoints(2).map(toScene)));
  }).flat().filter((line) => line.length >= 2);

  const buildingGrid = new SegmentGrid(buildings.flatMap((bld) => bld.rings.flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length], building: bld })))), 24);

  return { base, roads, buildings, buildingGrid, trees, fences, labels, game2 };
}
