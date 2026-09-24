// Walking navigation on the real map plans, like a car navigator but on foot and through buildings - for every map.
// The SVG plan (Shebuka / tarkov.dev) is drawn into walking grids ("layers"), one per storey:
// - street level: the open ground (roads, paths, fields, forest; water, rocks, fences, mines and the map border
//   block) plus the ground-floor rooms. A building with a floor plan is entered only through a doorway of that
//   plan: a stretch of room edge on the footprint outline at least DOOR_MIN wide (narrower notches are windows).
//   A building without a plan (most houses on the open maps) can be walked into at a detour cost - the plan simply
//   does not say where its door is, and the route says so;
// - other storeys: their rooms, stairs and open galleries, cropped to the area they cover.
// Stairs join neighbouring storeys where they are drawn on both, or where the next storey is walkable right there;
// Interchange also uses its drawn ramps and escalators. A* runs over all layers at once; string pulling
// straightens every leg; nav/maneuvers.js turns the result into navigator-style instructions.
// Mines always block (no safe lane is known in open data). A sniper zone only costs extra (a lot in safe mode).

import { displayName } from '../services/markerTypes.js';
import { navProfile, roleOf } from './nav/profiles.js';
import { mapCss, placedMarkup, polygonsOf, leavesOf, rasterPixels, sceneMatrix, svgUnitMeters, SVG_NS } from './nav/svgRaster.js';
import { describeRoute } from './nav/maneuvers.js';
import { pointInRing } from './city/util.js';

const PX = 2; // raster pixels per cell side
const C_OUT = '#ff0000'; // walkable, outside
const C_IN = '#ffff00'; // walkable, inside
const C_WALL = '#00ff00'; // building mass
const C_FENCE = '#0000ff'; // fence

const DOOR_MIN = 0.78; // m: window notches in the plans are ~0.65 m, doorways 0.9 m and wider
const OUTLINE_TOL = 0.2;
const WALL_STROKE = 1.1;
const DOOR_STROKE = 1.8;
const FENCE_STROKE = 1.1;
const BORDER_STROKE = 2.4;
const MINE_STROKE = 1.6;

// Cost per meter: 1 on roads + penalties. comfort / penalty keep routes off walls, clear (m) is the wall clearance
// of straightened legs.
const OUT = { comfort: 2.2, penalty: 0.7, extra: 0, clear: 1.25 };
const IN = { comfort: 0.7, penalty: 0.6, extra: 0.4, clear: 0.5 };
const OFFROAD = 0.12;
const FOREST = 0.1;
const SOFT = 2.2; // walking through a building whose plan is not drawn
const HAZARD = { normal: 4, safe: 40 };
const DOOR_COST = 5; // m
const STAIR_BASE = 3;
const STAIR_PER_STOREY = 5;
const GROUND_STOREY = 3.2;
const STOREY = 3.1;
const UNDER_REL = -3;
const SNAP_START = 60;
const GOAL_NEAR = 3;
const GOAL_FAR = 40;
const SHORT_LEG = 4; // m
const SEALED_MIN_AREA = 6; // m²
const SEALED_BRIDGE = 15; // m

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));
const quantile = (values, q) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const hasClass = (el, c) => (el.getAttribute('class') || '').split(/\s+/).includes(c);

function segmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

function polylineDistance(x, z, pts) {
  if (pts.length === 1) return Math.hypot(x - pts[0].x, z - pts[0].z);
  let best = Infinity;
  for (let k = 1; k < pts.length; k += 1) best = Math.min(best, segmentDistance(x, z, pts[k - 1].x, pts[k - 1].z, pts[k].x, pts[k].z));
  return best;
}

function polylineLength(pts) {
  let len = 0;
  for (let k = 1; k < pts.length; k += 1) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
  return len;
}

function resample(pts, step) {
  const out = [pts[0]];
  let left = step;
  for (let k = 1; k < pts.length; k += 1) {
    const a = pts[k - 1];
    const b = pts[k];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    let t0 = 0;
    while (d - t0 >= left) {
      t0 += left;
      const t = t0 / d;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      left = step;
    }
    left -= d - t0;
  }
  const last = pts[pts.length - 1];
  const end = out[out.length - 1];
  if (Math.hypot(last.x - end.x, last.z - end.z) > 0.2) out.push({ x: last.x, z: last.z });
  return out;
}

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a / 2);
};
const ringCenter = (ring) => {
  let x = 0;
  let z = 0;
  for (const p of ring) { x += p.x; z += p.z; }
  return { x: x / ring.length, z: z / ring.length };
};

// Doorways: chains of room edges lying on a footprint outline, at least DOOR_MIN long (scene meters).
function findDoors(footprints, rooms) {
  const B = 2;
  const hash = new Map();
  for (const poly of footprints) {
    for (let k = 0; k < poly.length; k += 1) {
      const a = poly[k];
      const b = poly[(k + 1) % poly.length];
      const edge = [a.x, a.z, b.x, b.z];
      for (let x = Math.floor(Math.min(a.x, b.x) / B) - 1; x <= Math.floor(Math.max(a.x, b.x) / B) + 1; x += 1) {
        for (let z = Math.floor(Math.min(a.z, b.z) / B) - 1; z <= Math.floor(Math.max(a.z, b.z) / B) + 1; z += 1) {
          const key = `${x},${z}`;
          if (!hash.has(key)) hash.set(key, []);
          hash.get(key).push(edge);
        }
      }
    }
  }
  const onOutline = (x, z) => {
    const list = hash.get(`${Math.floor(x / B)},${Math.floor(z / B)}`);
    if (!list) return false;
    for (const e of list) if (segmentDistance(x, z, e[0], e[1], e[2], e[3]) < OUTLINE_TOL) return true;
    return false;
  };
  const doors = [];
  for (const poly of rooms) {
    const n = poly.length;
    const flush = poly.map((a, k) => {
      const b = poly[(k + 1) % n];
      return onOutline(a.x, a.z) && onOutline(b.x, b.z) && onOutline((a.x + b.x) / 2, (a.z + b.z) / 2);
    });
    const start = flush.indexOf(false);
    if (start < 0) continue;
    let chain = null;
    for (let s = 1; s <= n; s += 1) {
      const k = (start + s) % n;
      if (flush[k]) {
        const a = poly[k];
        const b = poly[(k + 1) % n];
        if (!chain) chain = { pts: [a], len: 0 };
        chain.pts.push(b);
        chain.len += Math.hypot(b.x - a.x, b.z - a.z);
      } else if (chain) {
        if (chain.len >= DOOR_MIN) doors.push(chain);
        chain = null;
      }
    }
  }
  return doors;
}

function distanceField(walk, cols, rows) {
  const n = cols * rows;
  const dist = new Uint8Array(n); // 2 units per cell, saturates at 255
  for (let i = 0; i < n; i += 1) dist[i] = walk[i] ? 255 : 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      let d = dist[i];
      if (!d) continue;
      if ((r === 0 || c === 0 || c === cols - 1) && d > 2) d = 2;
      if (c > 0 && dist[i - 1] + 2 < d) d = dist[i - 1] + 2;
      if (r > 0) {
        if (dist[i - cols] + 2 < d) d = dist[i - cols] + 2;
        if (c > 0 && dist[i - cols - 1] + 3 < d) d = dist[i - cols - 1] + 3;
        if (c < cols - 1 && dist[i - cols + 1] + 3 < d) d = dist[i - cols + 1] + 3;
      }
      dist[i] = d;
    }
  }
  for (let r = rows - 1; r >= 0; r -= 1) {
    for (let c = cols - 1; c >= 0; c -= 1) {
      const i = r * cols + c;
      let d = dist[i];
      if (!d) continue;
      if (r === rows - 1 && d > 2) d = 2;
      if (c < cols - 1 && dist[i + 1] + 2 < d) d = dist[i + 1] + 2;
      if (r < rows - 1) {
        if (dist[i + cols] + 2 < d) d = dist[i + cols] + 2;
        if (c < cols - 1 && dist[i + cols + 1] + 3 < d) d = dist[i + cols + 1] + 3;
        if (c > 0 && dist[i + cols - 1] + 3 < d) d = dist[i + cols - 1] + 3;
      }
      dist[i] = d;
    }
  }
  return dist;
}

// 4-connected regions (A* forbids corner cutting, so diagonal-only contacts are not passable either).
function labelComponents(walk, cols, rows) {
  const n = cols * rows;
  const comp = new Uint16Array(n);
  const queue = new Int32Array(n);
  let next = 1;
  for (let s = 0; s < n; s += 1) {
    if (!walk[s] || comp[s]) continue;
    const label = next < 0xffff ? next : 0xffff; // 0xffff: too many regions, treated as "may connect"
    if (next < 0xffff) next += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    comp[s] = label;
    while (head < tail) {
      const i = queue[head++];
      const r = (i / cols) | 0;
      const c = i - r * cols;
      if (c > 0 && walk[i - 1] && !comp[i - 1]) { comp[i - 1] = label; queue[tail++] = i - 1; }
      if (c < cols - 1 && walk[i + 1] && !comp[i + 1]) { comp[i + 1] = label; queue[tail++] = i + 1; }
      if (r > 0 && walk[i - cols] && !comp[i - cols]) { comp[i - cols] = label; queue[tail++] = i - cols; }
      if (r < rows - 1 && walk[i + cols] && !comp[i + cols]) { comp[i + cols] = label; queue[tail++] = i + cols; }
    }
  }
  return { comp, count: next - 1 };
}

class MinHeap {
  constructor(capacity = 1 << 16) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
    this.size = 0;
  }

  clear() { this.size = 0; }

  push(val, key) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      const v = new Int32Array(this.size * 2);
      k.set(this.keys);
      v.set(this.vals);
      this.keys = k;
      this.vals = v;
    }
    let i = this.size;
    this.size += 1;
    const { keys, vals } = this;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  pop() {
    const { keys, vals } = this;
    const top = vals[0];
    this.size -= 1;
    const key = keys[this.size];
    const val = vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && keys[c + 1] < keys[c]) c += 1;
      if (keys[c] >= key) break;
      keys[i] = keys[c];
      vals[i] = vals[c];
      i = c;
    }
    keys[i] = key;
    vals[i] = val;
    return top;
  }
}

const svgOverrides = (unit) => [
  '*{filter:none!important;opacity:1!important;fill-opacity:1!important;stroke-opacity:1!important;stroke-dasharray:none!important}',
  `.nv-fence *{fill:none!important;stroke:currentColor!important;stroke-width:${FENCE_STROKE / unit}px!important;stroke-linecap:round;stroke-linejoin:round}`,
  `.nv-border *{fill:none!important;stroke:currentColor!important;stroke-width:${BORDER_STROKE / unit}px!important;stroke-linejoin:round}`,
  `.nv-outline *{fill:none!important;stroke:currentColor!important;stroke-width:${WALL_STROKE / unit}px!important;stroke-linejoin:round}`,
  `.nv-mines *{fill:currentColor!important;stroke:currentColor!important;stroke-width:${MINE_STROKE / unit}px!important;stroke-linejoin:round}`,
  `.nv-block *{stroke:currentColor;stroke-width:${0.3 / unit}px}`,
  '.nv-solid *{fill:currentColor!important}',
  '.nv-screen{mix-blend-mode:screen}',
].join('\n');

export class Navigator {
  // Rejects when the map cannot be rasterized; the app then keeps straight-line distances.
  static async build({ svgDoc, mapData, environment, onProgress = null }) {
    const nav = new Navigator(mapData);
    await nav.prepare(svgDoc, environment, onProgress);
    return nav;
  }

  constructor(mapData) {
    const { projection } = mapData;
    this.mapData = mapData;
    this.projection = projection;
    this.profile = navProfile(mapData);
    this.cell = this.profile.cell;
    this.GC = Math.max(1, Math.round(projection.width / this.cell));
    this.GR = Math.max(1, Math.round(projection.depth / this.cell));
    this.cellW = projection.width / this.GC;
    this.cellH = projection.depth / this.GR;
    this.x0 = projection.sceneLeft;
    this.z0 = projection.sceneTop;
    this.unit = svgUnitMeters(projection);
    this.layers = [];
    this.portals = new Map();
    this.heap = new MinHeap();
    this.cache = new Map();
    this.ready = false;
    this.stats = null;
    this.safe = false;
  }

  // ------------------------------------------------------------------ build

  // Floors of the plan grouped into walking layers, bottom to top, each with its role groups.
  collectSpecs(svgDoc) {
    const { floors } = this.mapData;
    const P = this.projection;
    const drawn = floors.filter((f) => f.svgLayer);
    const streetIds = this.profile.street.filter((id) => drawn.some((f) => f.id === id));
    if (!streetIds.length && drawn.length) streetIds.push(drawn[0].id);
    const groundSvg = (drawn.find((f) => f.id === streetIds[0]) || {}).svgLayer;
    const heightOf = (f) => {
      const y = P.floorPlaneY(f.id);
      return Number.isFinite(y) ? y : 0;
    };
    const units = [{ floorIds: streetIds, street: true, y: Math.max(...drawn.filter((f) => streetIds.includes(f.id)).map(heightOf)) }];
    for (const f of drawn) {
      if (streetIds.includes(f.id) || f.sharesHeightWith) continue;
      const shared = drawn.filter((x) => x.sharesHeightWith === f.id).map((x) => x.id);
      units.push({ floorIds: [f.id, ...shared], street: false, y: heightOf(f) });
    }
    units.sort((a, b) => a.y - b.y);
    const streetAt = units.findIndex((u) => u.street);
    const specs = [];
    units.forEach((u, k) => {
      const spec = { ...u, rank: k - streetAt, groups: [] };
      const seen = new Set();
      for (const id of u.floorIds) {
        const f = drawn.find((x) => x.id === id);
        if (!f || seen.has(f.svgLayer)) continue;
        seen.add(f.svgLayer);
        const root = svgDoc.querySelector(`[id="${f.svgLayer}"]`);
        if (!root) continue;
        const ground = u.street && f.svgLayer === groundSvg;
        const visit = (el, inherited) => {
          if (el.localName !== 'g') return;
          const own = (el.getAttribute('class') || '').split(/\s+/).filter((c) => c && c !== 'shadow');
          const classes = [...new Set([...own, ...inherited])];
          const role = roleOf(this.profile, el.getAttribute('id') || '', classes, { ground });
          if (role === 'recurse') {
            for (const child of el.children) visit(child, classes);
            return;
          }
          if (role !== 'ignore') spec.groups.push({ el, role, ground, floorId: id });
        };
        for (const child of root.children) visit(child, []);
      }
      specs.push(spec);
    });
    return specs;
  }

  async prepare(svgDoc, environment, onProgress) {
    const t0 = performance.now();
    const ser = new XMLSerializer();
    const P = this.projection;
    this.css = mapCss(svgDoc);
    this.matrix = sceneMatrix(P);
    const specs = this.collectSpecs(svgDoc);
    const streetSpec = specs.find((s) => s.street);
    if (!streetSpec) throw new Error('No street level in the map floors');

    // Rooms, stairs and footprints of each layer as polygons (doors, planned buildings, crops, stairs).
    for (const spec of specs) {
      const itemsOf = (roles) => spec.groups.filter((g) => roles.includes(g.role)).flatMap((g) => leavesOf(g.el).map((el) => ({ el, group: g })));
      spec.rooms = itemsOf(['room']);
      spec.stairs = itemsOf(['stairs']);
      spec.passages = itemsOf(['passage']);
      spec.buildings = spec.street ? itemsOf(['building']) : [];
      const all = [...spec.rooms, ...spec.stairs, ...spec.passages, ...spec.buildings];
      const polys = polygonsOf(svgDoc, all, P);
      all.forEach((it, k) => {
        it.rings = polys[k];
        it.ring = polys[k].reduce((best, r) => (!best || ringArea(r) > ringArea(best) ? r : best), null);
      });
      const roomGroups = spec.groups.filter((g) => g.role === 'room');
      spec.lockedEls = [
        ...roomGroups.filter((g) => hasClass(g.el, 'locked')).map((g) => g.el),
        ...roomGroups.flatMap((g) => [...g.el.querySelectorAll('[class~="locked"]')]),
      ];
    }

    // Street level buildings: with a plan (a room inside) or without.
    const roomCenters = streetSpec.rooms.filter((r) => r.ring).map((r) => ringCenter(r.ring));
    for (const b of streetSpec.buildings) {
      b.planned = Boolean(b.ring) && roomCenters.some((c) => b.rings.some((ring) => pointInRing(c, ring)));
    }
    const planned = streetSpec.buildings.filter((b) => b.planned);
    const doors = findDoors(planned.flatMap((b) => b.rings), streetSpec.rooms.flatMap((r) => r.rings));
    this.doors = doors.map((d) => {
      let left = d.len / 2;
      let mid = d.pts[0];
      for (let k = 1; k < d.pts.length; k += 1) {
        const a = d.pts[k - 1];
        const b = d.pts[k];
        const l = Math.hypot(b.x - a.x, b.z - a.z);
        if (l >= left) { mid = { x: a.x + ((b.x - a.x) * left) / (l || 1), z: a.z + ((b.z - a.z) * left) / (l || 1) }; break; }
        left -= l;
      }
      return { x: mid.x, z: mid.z, width: d.len };
    });
    const doorMarkup = doors.map((d) => `<polyline points="${d.pts.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`).join(' ')}"/>`).join('');
    const minefields = ((environment && environment.minefields) || [])
      .filter((m) => Array.isArray(m.outline) && m.outline.length >= 3)
      .map((m) => `<polygon points="${m.outline.map((p) => `${(-p.x).toFixed(2)},${p.z.toFixed(2)}`).join(' ')}"/>`)
      .join('');

    let base = 0;
    let compTotal = 0;
    const built = [];
    for (const spec of specs) {
      const box = spec.street ? null : this.cropOf(spec);
      if (!spec.street && !box) continue;
      const layer = this.makeLayer(spec, box, base);
      await this.rasterLayer(layer, spec, svgDoc, ser, { doorMarkup, planned, minefields });
      if (!layer.walkable) continue;
      const { comp, count } = labelComponents(layer.walk, layer.cols, layer.rows);
      layer.comp = comp;
      layer.compBase = compTotal;
      compTotal += count + 1;
      layer.dist = distanceField(layer.walk, layer.cols, layer.rows);
      base += layer.n;
      layer.spec = spec;
      this.layers.push(layer);
      built.push(spec);
      if (onProgress) onProgress(this.layers.length / specs.length);
      await nextFrame();
    }
    this.totalN = base;
    this.streetLayer = this.layers.find((l) => l.street);
    if (!this.streetLayer) throw new Error('Street level has no walkable area');
    this.layers.forEach((l, k) => { l.index = k; });
    this.g = new Float32Array(this.totalN);
    this.parent = new Int32Array(this.totalN);
    this.stamp = new Uint32Array(this.totalN);
    this.closedStamp = new Uint32Array(this.totalN);
    this.gen = 0;
    this.maxExpanded = Math.max(1500000, Math.round(this.totalN * 1.2));

    const stairs = this.collectStairs(built);
    await this.linkLayers(stairs, compTotal, svgDoc);
    const opened = this.openSealedRooms();
    if (opened) {
      const s = this.streetLayer;
      s.comp = labelComponents(s.walk, s.cols, s.rows).comp;
      s.dist = distanceField(s.walk, s.cols, s.rows);
      await this.linkLayers(stairs, compTotal, svgDoc);
    }
    for (const l of this.layers) delete l.spec;
    this.prepareHeights();
    this.ready = true;
    this.stats = {
      ms: Math.round(performance.now() - t0),
      grid: `${this.GC}x${this.GR}`,
      cell: this.cell,
      layers: this.layers.map((l) => `${l.floorIds.join('+')}:${l.cols}x${l.rows}:${Math.round((l.walkable / l.n) * 1000) / 10}%`),
      doors: this.doors.length,
      plannedBuildings: planned.length,
      softBuildings: streetSpec.buildings.length - planned.length,
      stairs: stairs.length,
      portals: this.portalCount,
      flights: this.flights || 0,
      assumedEntrances: opened,
    };
  }

  // Bounding box (global cells) of what a storey draws: its rooms, stairs and galleries, plus a margin.
  cropOf(spec) {
    const pts = [...spec.rooms, ...spec.stairs, ...spec.passages].flatMap((it) => it.rings.flat());
    if (!pts.length) return null;
    const margin = 4;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const c0 = Math.max(0, Math.floor((minX - margin - this.x0) / this.cellW));
    const c1 = Math.min(this.GC - 1, Math.ceil((maxX + margin - this.x0) / this.cellW));
    const r0 = Math.max(0, Math.floor((minZ - margin - this.z0) / this.cellH));
    const r1 = Math.min(this.GR - 1, Math.ceil((maxZ + margin - this.z0) / this.cellH));
    if (c1 <= c0 || r1 <= r0) return null;
    return { c0, r0, cols: c1 - c0 + 1, rows: r1 - r0 + 1 };
  }

  makeLayer(spec, box, base) {
    const b = box || { c0: 0, r0: 0, cols: this.GC, rows: this.GR };
    const P = this.projection;
    return {
      rank: spec.rank,
      floorIds: spec.floorIds,
      street: spec.street,
      c0: b.c0,
      r0: b.r0,
      cols: b.cols,
      rows: b.rows,
      n: b.cols * b.rows,
      base,
      y: (spec.street ? P.groundY : P.floorPlaneY(spec.floorIds[0])) + 0.4,
      assumed: null,
    };
  }

  // Raster of one layer: walk / indoor / fence from the main drawing, cost masks from two small ones.
  async rasterLayer(layer, spec, svgDoc, ser, { doorMarkup, planned, minefields }) {
    const u = this.unit;
    const [a, b, c, d, e, f] = this.matrix;
    const x = this.x0 + layer.c0 * this.cellW;
    const z = this.z0 + layer.r0 * this.cellH;
    const w = layer.cols * this.cellW;
    const h = layer.rows * this.cellH;
    const head = (px) => [
      `<svg xmlns="${SVG_NS}" width="${layer.cols * px}" height="${layer.rows * px}" viewBox="${x} ${z} ${w} ${h}" preserveAspectRatio="none" shape-rendering="crispEdges">`,
      `<style>${this.css}\n${svgOverrides(u)}</style>`,
      `<rect x="${x - 50}" y="${z - 50}" width="${w + 100}" height="${h + 100}" fill="#000"/>`,
    ];
    const inSvg = (inner) => (inner ? `<g transform="matrix(${a} ${b} ${c} ${d} ${e} ${f})">${inner}</g>` : '');
    const markupOf = (list) => list.map((g) => placedMarkup(svgDoc, g.el, ser)).join('');
    const colored = (color, inner, cls = '') => (inner ? `<g color="${color}"${cls ? ` class="${cls}"` : ''}>${inner}</g>` : '');
    const byRole = (...roles) => spec.groups.filter((g) => roles.includes(g.role));
    const unplanned = spec.street ? spec.buildings.filter((bl) => !bl.planned) : [];

    const parts = head(PX);
    if (spec.street) {
      // Open ground in document order: a road or pier drawn over water is a bridge, forest drawn over rocks is walkable.
      const ground = [];
      for (const g of spec.groups) {
        if (!g.ground) continue;
        if (['walk', 'forest', 'road'].includes(g.role)) ground.push(colored(C_OUT, placedMarkup(svgDoc, g.el, ser)));
        else if (['water', 'rock'].includes(g.role)) ground.push(colored('#000', placedMarkup(svgDoc, g.el, ser), 'nv-solid'));
      }
      parts.push(inSvg(ground.join('')));
      parts.push(inSvg(colored(this.profile.soft ? C_IN : C_WALL, markupOf(unplanned), 'nv-solid')));
      parts.push(inSvg(colored(C_WALL, markupOf(planned), 'nv-solid')));
    }
    parts.push(inSvg(colored(C_IN, markupOf(byRole('room', 'stairs')), 'nv-solid')));
    if (spec.street) {
      parts.push(inSvg(colored(C_WALL, markupOf(planned), 'nv-outline')));
      if (doorMarkup) parts.push(`<g fill="none" stroke="${C_IN}" stroke-width="${DOOR_STROKE}" stroke-linecap="butt" stroke-linejoin="round">${doorMarkup}</g>`);
    }
    parts.push(inSvg(colored(C_OUT, markupOf(byRole('passage')))));
    if (spec.street) parts.push(inSvg(colored(C_FENCE, markupOf(byRole('fence')), 'nv-fence')));
    if (spec.street && this.profile.border) parts.push(inSvg(colored('#000', markupOf(byRole('border')), 'nv-border')));
    parts.push(inSvg(colored('#000', markupOf(byRole('block')), 'nv-block')));
    parts.push(inSvg(colored('#000', markupOf(byRole('mines')), 'nv-mines')));
    if (spec.street && minefields) parts.push(`<g fill="#000" stroke="#000" stroke-width="${MINE_STROKE}" stroke-linejoin="round">${minefields}</g>`);
    parts.push('</svg>');
    if (window.__navKeepMarkup) layer.markup = parts.join('');
    const px = await rasterPixels(parts.join(''), layer.cols * PX, layer.rows * PX);
    this.decodeMain(layer, px);
    if (!layer.walkable) return;

    // Masks, one pixel per cell: road (R) / forest (G) / hazard (B), and soft building (R) / locked room (G).
    const screen = (color, inner) => (inner ? `<g color="${color}" class="nv-screen">${inner}</g>` : '');
    const m1 = head(1);
    if (spec.street) {
      m1.push(inSvg(screen('#ff0000', markupOf(byRole('road')))));
      m1.push(inSvg(screen('#00ff00', markupOf(byRole('forest')))));
    }
    m1.push(inSvg(screen('#0000ff', markupOf(byRole('hazard')))), '</svg>');
    const q1 = await rasterPixels(m1.join(''), layer.cols, layer.rows);
    const m2 = head(1);
    if (this.profile.soft) m2.push(inSvg(screen('#ff0000', markupOf(unplanned))));
    m2.push(inSvg(screen('#00ff00', spec.lockedEls.map((el) => placedMarkup(svgDoc, el, ser)).join(''))), '</svg>');
    const q2 = await rasterPixels(m2.join(''), layer.cols, layer.rows);
    const n = layer.n;
    const road = new Uint8Array(n);
    const forest = new Uint8Array(n);
    const hazard = new Uint8Array(n);
    const soft = new Uint8Array(n);
    const locked = new Uint8Array(n);
    let hazards = 0;
    for (let i = 0; i < n; i += 1) {
      const o = i * 4;
      if (q1[o] > 127) road[i] = 1;
      if (q1[o + 1] > 127) forest[i] = 1;
      if (q1[o + 2] > 127) { hazard[i] = 1; hazards += 1; }
      if (q2[o] > 127 && layer.indoor[i]) soft[i] = 1;
      if (q2[o + 1] > 127) locked[i] = 1;
    }
    Object.assign(layer, { road, forest, hazard: hazards ? hazard : null, soft, locked });
  }

  decodeMain(layer, px) {
    const { cols, rows, n } = layer;
    const width = cols * PX;
    const walk = new Uint8Array(n);
    const indoor = new Uint8Array(n);
    const fence = new Uint8Array(n);
    const full = PX * PX;
    let walkable = 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let dy = 0; dy < PX; dy += 1) {
          const row = (r * PX + dy) * width;
          for (let dx = 0; dx < PX; dx += 1) {
            const o = (row + c * PX + dx) * 4;
            if (px[o] > 127) red += 1;
            if (px[o + 1] > 127) green += 1;
            if (px[o + 2] > 127) blue += 1;
          }
        }
        const i = r * cols + c;
        if (red === full) { walk[i] = 1; walkable += 1; }
        if (green * 2 >= full) indoor[i] = 1;
        if (blue * 2 >= full) fence[i] = 1;
      }
    }
    Object.assign(layer, { walk, indoor, fence, walkable });
  }

  // ------------------------------------------------------------------ stairs and portals

  collectStairs(specs) {
    const out = [];
    for (const spec of specs) {
      const layer = this.layers.find((l) => l.spec === spec);
      if (!layer) continue;
      for (const s of spec.stairs) {
        if (!s.ring) continue;
        const xs = s.ring.map((p) => p.x);
        const zs = s.ring.map((p) => p.z);
        out.push({
          layer,
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          z: (Math.min(...zs) + Math.max(...zs)) / 2,
          ring: s.ring,
        });
      }
    }
    return out;
  }

  addPortal(la, ia, lb, ib, cost) {
    const na = la.base + ia;
    const nb = lb.base + ib;
    if (!this.portals.has(na)) this.portals.set(na, []);
    if (!this.portals.has(nb)) this.portals.set(nb, []);
    this.portals.get(na).push({ node: nb, cost });
    this.portals.get(nb).push({ node: na, cost });
    this.union(la, ia, lb, ib);
    this.portalCount += 1;
  }

  async linkLayers(stairs, compTotal, svgDoc) {
    this.dsu = new Int32Array(compTotal + 1);
    for (let i = 0; i < this.dsu.length; i += 1) this.dsu[i] = i;
    this.portals = new Map();
    this.portalCount = 0;
    const byRank = new Map(this.layers.map((l) => [l.rank, l]));
    const cost = (a, b) => (STAIR_BASE + STAIR_PER_STOREY * Math.abs(b.rank - a.rank)) / this.cell;
    const linked = new Set();
    const link = (sa, la, sb, lb) => {
      const lo = la.rank < lb.rank ? { s: sa, l: la } : { s: sb, l: lb };
      const key = `${lo.l.rank}:${Math.round(lo.s.x * 2)}:${Math.round(lo.s.z * 2)}`;
      if (linked.has(key)) return;
      const a = this.snap(la, sa, 2.5);
      const b = this.snap(lb, sb, 2.5);
      if (!a || !b) return;
      linked.add(key);
      this.addPortal(la, a.i, lb, b.i, cost(la, lb));
    };
    for (const s of stairs) {
      let partnered = false;
      for (const other of [byRank.get(s.layer.rank - 1), byRank.get(s.layer.rank + 1)]) {
        if (!other) continue;
        const partner = stairs.find((t) => t.layer === other && (Math.hypot(t.x - s.x, t.z - s.z) < 3 || pointInRing(s, t.ring) || pointInRing(t, s.ring)));
        if (partner) {
          partnered = true;
          link(s, s.layer, partner, other);
        }
      }
      if (partnered) continue;
      // A flight drawn on one storey only leads to the neighbouring storey that is walkable right there.
      for (const other of [byRank.get(s.layer.rank - 1), byRank.get(s.layer.rank + 1)]) {
        if (other && this.snap(other, s, 1.5)) { link(s, s.layer, s, other); break; }
      }
    }
    if (this.profile.portals === 'interchange') await this.interchangePortals(svgDoc);
  }

  // Interchange: ramps, outside stairs and escalators as drawn on its plan (the same reading the 3D model uses).
  async interchangePortals(svgDoc) {
    const [{ createSvgReader }, { collectFlights }, { pointInPolygon }] = await Promise.all([
      import('./interchange/icSvg.js'),
      import('./interchange/icBuild.js'),
      import('./city/util.js'),
    ]);
    const svg = createSvgReader(svgDoc, this.projection);
    const structure = svg.polygons('Structure', { minArea: 1000 })[0];
    const inMall = structure ? (p) => pointInPolygon(p, { outer: structure.outer, holes: [] }) : () => false;
    const flights = collectFlights(svg, inMall);
    const layerOf = (id) => this.layers.find((l) => l.floorIds.includes(id));
    let count = 0;
    for (const fl of flights) {
      const lo = layerOf(fl.lowerId);
      const hi = layerOf(fl.upperId);
      if (!lo || !hi || lo === hi) continue;
      const a = this.snap(lo, fl.low, 3.5);
      const b = this.snap(hi, fl.high, 3.5);
      if (!a || !b) continue;
      const len = Math.hypot(fl.high.x - fl.low.x, fl.high.z - fl.low.z);
      this.addPortal(lo, a.i, hi, b.i, (len + 2) / this.cell);
      count += 1;
    }
    this.flights = count;
  }

  // Street-level regions with no way to the main network get the shortest passage through what blocks them
  // (building mass or a fence). Mines and sniper zones are never bridged. The passage is flagged `assumed`.
  openSealedRooms() {
    const layer = this.streetLayer;
    const { walk, indoor, fence, comp, compBase, cols, rows, n } = layer;
    let count = 0;
    for (let i = 0; i < n; i += 1) if (comp[i] !== 0xffff && comp[i] > count) count = comp[i];
    const size = new Int32Array(count + 2);
    for (let i = 0; i < n; i += 1) {
      const c = comp[i];
      if (c && c !== 0xffff) size[c] += 1;
    }
    const open = new Uint8Array(this.dsu.length);
    const rootSize = new Map();
    for (let c = 1; c <= count; c += 1) {
      if (!size[c]) continue;
      const root = this.find(compBase + c);
      rootSize.set(root, (rootSize.get(root) || 0) + size[c]);
    }
    let mainRoot = -1;
    let mainSize = -1;
    for (const [root, sz] of rootSize) if (sz > mainSize) { mainSize = sz; mainRoot = root; }
    if (mainRoot >= 0) open[mainRoot] = 1;
    const isOpen = (c) => c === 0xffff || (c > 0 && open[this.find(compBase + c)] === 1);
    const first = new Int32Array(count + 2);
    for (let c = 1; c <= count; c += 1) first[c + 1] = first[c] + size[c];
    const cells = new Int32Array(first[count + 1]);
    const cursor = first.slice();
    for (let i = 0; i < n; i += 1) {
      const c = comp[i];
      if (c && c !== 0xffff) cells[cursor[c]++] = i;
    }
    const stamp = new Int32Array(n);
    const parent = new Int32Array(n);
    const depth = new Uint16Array(n);
    const queue = new Int32Array(n);
    const assumed = new Uint8Array(n);
    const maxDepth = Math.round(SEALED_BRIDGE / this.cell);
    const minCells = Math.max(8, Math.round(SEALED_MIN_AREA / (this.cell * this.cell)));
    let opened = 0;
    for (let c = 1; c <= count; c += 1) {
      if (size[c] < minCells || isOpen(c)) continue;
      let head = 0;
      let tail = 0;
      for (let k = first[c]; k < first[c + 1]; k += 1) {
        const i = cells[k];
        stamp[i] = c;
        parent[i] = -1;
        depth[i] = 0;
        queue[tail++] = i;
      }
      let found = -1;
      while (head < tail && found < 0) {
        const cur = queue[head++];
        const r = (cur / cols) | 0;
        const col = cur - r * cols;
        for (let k = 0; k < 4; k += 1) {
          let j;
          if (k === 0) { if (col === 0) continue; j = cur - 1; } else if (k === 1) { if (col === cols - 1) continue; j = cur + 1; } else if (k === 2) { if (r === 0) continue; j = cur - cols; } else { if (r === rows - 1) continue; j = cur + cols; }
          if (stamp[j] === c) continue;
          stamp[j] = c;
          if (walk[j]) {
            if (comp[j] !== c && isOpen(comp[j])) { parent[j] = cur; found = j; break; }
            continue;
          }
          if (!(indoor[j] || fence[j]) || depth[cur] >= maxDepth) continue;
          parent[j] = cur;
          depth[j] = depth[cur] + 1;
          queue[tail++] = j;
        }
      }
      if (found < 0) continue;
      const path = [];
      for (let i = parent[found]; i >= 0 && !walk[i]; i = parent[i]) path.push(i);
      if (!path.length) continue;
      for (const i of path) {
        walk[i] = 1;
        assumed[i] = 1;
        comp[i] = comp[found];
      }
      if (comp[found] !== 0xffff) this.dsu[this.find(compBase + c)] = this.find(compBase + comp[found]);
      layer.walkable += path.length;
      opened += 1;
    }
    layer.assumed = assumed;
    return opened;
  }

  assumedNear(layer, i) {
    if (!layer.assumed) return false;
    const r0 = (i / layer.cols) | 0;
    const c0 = i - r0 * layer.cols;
    const R = Math.ceil(2 / this.cell);
    for (let r = Math.max(0, r0 - R); r <= Math.min(layer.rows - 1, r0 + R); r += 1) {
      for (let c = Math.max(0, c0 - R); c <= Math.min(layer.cols - 1, c0 + R); c += 1) {
        if (layer.assumed[r * layer.cols + c]) return true;
      }
    }
    return false;
  }

  find(i) {
    const { dsu } = this;
    while (dsu[i] !== i) {
      dsu[i] = dsu[dsu[i]];
      i = dsu[i];
    }
    return i;
  }

  union(la, ia, lb, ib) {
    if (la.comp[ia] === 0xffff || lb.comp[ib] === 0xffff) return;
    const a = this.find(la.compBase + la.comp[ia]);
    const b = this.find(lb.compBase + lb.comp[ib]);
    if (a !== b) this.dsu[a] = b;
  }

  sameComponent(la, ia, lb, ib) {
    if (la.comp[ia] === 0xffff || lb.comp[ib] === 0xffff) return true;
    return this.find(la.compBase + la.comp[ia]) === this.find(lb.compBase + lb.comp[ib]);
  }

  // ------------------------------------------------------------------ heights, labels, locks

  prepareHeights() {
    const B = 20;
    const outdoor = new Map();
    const all = new Map();
    const add = (hash, p) => {
      const key = `${Math.floor(p.x / B)},${Math.floor(p.z / B)}`;
      if (!hash.has(key)) hash.set(key, []);
      hash.get(key).push(p);
    };
    const street = this.streetLayer;
    for (const e of [...this.mapData.entities, ...(this.mapData.loot || [])]) {
      if (!e.position || e.position.y == null) continue;
      const p = { x: -e.position.x, z: e.position.z, y: e.position.y };
      const i = this.cellOf(street, p.x, p.z);
      if (i < 0) continue;
      add(all, p);
      if (street.walk[i] && !street.indoor[i]) add(outdoor, p);
    }
    this.heightHash = { B, outdoor, all };
    this.lockedDoors = this.mapData.entities
      .filter((e) => e.type === 'key' && e.meta && e.meta.lockType === 'door' && e.position)
      .map((e) => ({ x: -e.position.x, z: e.position.z, layer: this.layerFor(e.position, e.floor), name: displayName(e) }));
    this.streets = this.mapData.entities
      .filter((e) => e.type === 'street' && e.position)
      .map((e) => ({ x: -e.position.x, z: e.position.z, name: displayName(e) }));
    this.landmarks = this.mapData.entities
      .filter((e) => ['place', 'extract', 'transit', 'trader'].includes(e.type) && e.position)
      .map((e) => ({ x: -e.position.x, z: e.position.z, name: displayName(e) }));
  }

  heightsNear(hash, x, z, radius) {
    const { B } = this.heightHash;
    const out = [];
    for (let bx = Math.floor((x - radius) / B); bx <= Math.floor((x + radius) / B); bx += 1) {
      for (let bz = Math.floor((z - radius) / B); bz <= Math.floor((z + radius) / B); bz += 1) {
        for (const p of hash.get(`${bx},${bz}`) || []) if (Math.hypot(p.x - x, p.z - z) <= radius) out.push(p.y);
      }
    }
    return out;
  }

  groundAt(x, z) {
    if (this.projection.heightAt) return this.projection.heightAt(x, z);
    const { outdoor, all } = this.heightHash;
    let ys = this.heightsNear(outdoor, x, z, 35);
    if (ys.length >= 3) return quantile(ys, 0.3);
    ys = this.heightsNear(all, x, z, 35);
    if (ys.length >= 3) return quantile(ys, 0.05);
    ys = this.heightsNear(outdoor, x, z, 80);
    return ys.length ? quantile(ys, 0.3) : null;
  }

  layerOfFloor(floorId) {
    return floorId ? this.layers.find((l) => l.floorIds.includes(floorId)) || null : null;
  }

  // Walking layer of a game position. Maps with levels: the floor the map data gives (or the hint). Streets: the
  // storey from the height above the local ground, limited to the floors actually drawn at that spot.
  layerFor(position, floorHint = null) {
    const s = { x: -position.x, z: position.z };
    const drawnHere = (maxM) => this.layers.filter((l) => this.snap(l, s, maxM));
    if (this.mapData.levels) {
      let floorId = floorHint;
      if (!floorId && position.y != null && this.mapData.floorAt) floorId = this.mapData.floorAt(position);
      let layer = this.layerOfFloor(floorId) || this.streetLayer;
      if (!this.snap(layer, s, 2.5)) {
        const here = drawnHere(2.5);
        if (here.length) layer = here.reduce((best, l) => (Math.abs(l.rank - layer.rank) < Math.abs(best.rank - layer.rank) ? l : best));
      }
      return layer;
    }
    let want = null;
    if (position.y != null) {
      const ground = this.groundAt(s.x, s.z);
      if (ground != null) {
        const rel = position.y - ground;
        want = rel < UNDER_REL ? -1 : rel < GROUND_STOREY ? 0 : 1 + Math.floor((rel - GROUND_STOREY) / STOREY);
      }
    }
    if (want == null && floorHint) {
      const hinted = this.layerOfFloor(floorHint);
      if (hinted) want = hinted.rank;
    }
    if (want == null) want = 0;
    const here = drawnHere(1.5);
    if (!here.length) return this.layers.find((l) => l.rank === want) || this.streetLayer;
    return here.reduce((best, l) => {
      const d = Math.abs(l.rank - want);
      const bd = Math.abs(best.rank - want);
      return d < bd || (d === bd && Math.abs(l.rank) < Math.abs(best.rank)) ? l : best;
    });
  }

  // ------------------------------------------------------------------ grid helpers

  cellOf(layer, sceneX, sceneZ) {
    const c = Math.floor((sceneX - this.x0) / this.cellW) - layer.c0;
    const r = Math.floor((sceneZ - this.z0) / this.cellH) - layer.r0;
    if (c < 0 || r < 0 || c >= layer.cols || r >= layer.rows) return -1;
    return r * layer.cols + c;
  }

  centerOf(layer, i) {
    const r = Math.floor(i / layer.cols);
    const c = i - r * layer.cols;
    return { x: this.x0 + (layer.c0 + c + 0.5) * this.cellW, z: this.z0 + (layer.r0 + r + 0.5) * this.cellH };
  }

  // Nearest walkable cell of a layer to a scene point, within maxMeters; `accept` filters cells.
  snap(layer, p, maxMeters, accept = null) {
    const { cols, rows, walk } = layer;
    const c0 = Math.floor((p.x - this.x0) / this.cellW) - layer.c0;
    const r0 = Math.floor((p.z - this.z0) / this.cellH) - layer.r0;
    const maxR = Math.ceil(maxMeters / this.cell) + 1;
    if (c0 < -maxR || r0 < -maxR || c0 >= cols + maxR || r0 >= rows + maxR) return null;
    let best = null;
    for (let rad = 0; rad <= maxR; rad += 1) {
      for (let r = r0 - rad; r <= r0 + rad; r += 1) {
        if (r < 0 || r >= rows) continue;
        const edge = r === r0 - rad || r === r0 + rad;
        for (let c = c0 - rad; c <= c0 + rad; c += edge ? 1 : 2 * rad || 1) {
          if (c < 0 || c >= cols) continue;
          const i = r * cols + c;
          if (!walk[i] || (accept && !accept(i))) continue;
          const q = this.centerOf(layer, i);
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d <= maxMeters + this.cell && (!best || d < best.d)) best = { layer, i, d };
        }
      }
      if (best && best.d <= rad * this.cell) break;
    }
    return best;
  }

  cellCost(layer, i) {
    const inside = layer.indoor[i];
    const k = inside ? IN : OUT;
    const d = layer.dist[i] * this.cell * 0.5;
    let cost = 1 + (d < k.comfort ? (k.comfort - d) * k.penalty : 0) + k.extra;
    if (!inside && layer.street) {
      if (!layer.road[i]) cost += OFFROAD;
      if (layer.forest[i]) cost += FOREST;
    }
    if (inside && layer.soft[i]) cost += SOFT;
    if (layer.hazard && layer.hazard[i]) cost += this.safe ? HAZARD.safe : HAZARD.normal;
    return cost;
  }

  layerOfNode(node) {
    const { layers } = this;
    for (let k = layers.length - 1; k >= 0; k -= 1) if (node >= layers[k].base) return layers[k];
    return layers[0];
  }

  // ------------------------------------------------------------------ search

  // A* from one node to one goal node (heuristic in cells); with a Set of goal nodes it is a Dijkstra that stops
  // once every goal is settled (routes to many extracts at once).
  search(startNode, goal) {
    const { heap } = this;
    const many = goal instanceof Set;
    this.gen += 1;
    const gen = this.gen;
    heap.clear();
    let gc = 0;
    let gr = 0;
    if (!many) {
      const gl = this.layerOfNode(goal);
      const gi = goal - gl.base;
      const r = Math.floor(gi / gl.cols);
      gr = gl.r0 + r;
      gc = gl.c0 + gi - r * gl.cols;
    }
    const h = many ? () => 0 : (layer, i) => {
      const r = (i / layer.cols) | 0;
      const dx = Math.abs(layer.c0 + i - r * layer.cols - gc);
      const dz = Math.abs(layer.r0 + r - gr);
      return dx > dz ? dx + 0.41421356 * dz : dz + 0.41421356 * dx;
    };
    const { g, parent, stamp, closedStamp } = this;
    const sl = this.layerOfNode(startNode);
    g[startNode] = 0;
    stamp[startNode] = gen;
    parent[startNode] = -1;
    heap.push(startNode, h(sl, startNode - sl.base));
    let expanded = 0;
    let remaining = many ? goal.size : 1;
    const reachedGoals = new Set();
    const doorCost = DOOR_COST / this.cell;
    while (heap.size) {
      const node = heap.pop();
      if (closedStamp[node] === gen) continue;
      closedStamp[node] = gen;
      expanded += 1;
      if (many ? goal.has(node) : node === goal) {
        reachedGoals.add(node);
        remaining -= 1;
        if (remaining <= 0) break;
      }
      if (expanded > this.maxExpanded) break;
      const layer = this.layerOfNode(node);
      const { walk, indoor, cols, rows, base } = layer;
      const cur = node - base;
      const gCur = g[node];
      const cCur = this.cellCost(layer, cur);
      const r = (cur / cols) | 0;
      const c = cur - r * cols;
      for (let dr = -1; dr <= 1; dr += 1) {
        const nr = r + dr;
        if (nr < 0 || nr >= rows) continue;
        for (let dc = -1; dc <= 1; dc += 1) {
          if (!dr && !dc) continue;
          const nc = c + dc;
          if (nc < 0 || nc >= cols) continue;
          const ni = nr * cols + nc;
          const nn = base + ni;
          if (!walk[ni] || closedStamp[nn] === gen) continue;
          const diagonal = dr && dc;
          if (diagonal && (!walk[r * cols + nc] || !walk[nr * cols + c])) continue; // no corner cutting
          let ng = gCur + (diagonal ? Math.SQRT2 : 1) * (cCur + this.cellCost(layer, ni)) * 0.5;
          if (layer.street && indoor[ni] !== indoor[cur]) ng += doorCost;
          if (stamp[nn] !== gen || ng < g[nn]) {
            g[nn] = ng;
            stamp[nn] = gen;
            parent[nn] = node;
            heap.push(nn, ng + h(layer, ni));
          }
        }
      }
      const portals = this.portals.get(node);
      if (portals) {
        for (const p of portals) {
          if (closedStamp[p.node] === gen) continue;
          const ng = gCur + p.cost;
          if (stamp[p.node] !== gen || ng < g[p.node]) {
            g[p.node] = ng;
            stamp[p.node] = gen;
            parent[p.node] = node;
            const tl = this.layerOfNode(p.node);
            heap.push(p.node, ng + h(tl, p.node - tl.base));
          }
        }
      }
    }
    const pathTo = (goalNode) => {
      if (!reachedGoals.has(goalNode)) return null;
      const nodes = [];
      for (let node = goalNode; node !== -1; node = parent[node]) nodes.push(node);
      nodes.reverse();
      return nodes;
    };
    if (many) {
      const costs = new Map([...reachedGoals].map((node) => [node, g[node]]));
      const paths = new Map([...reachedGoals].map((node) => [node, pathTo(node)]));
      return { pathTo: (node) => paths.get(node) || null, expanded, cost: (node) => (costs.has(node) ? costs.get(node) : Infinity) };
    }
    const nodes = pathTo(goal);
    return nodes ? { nodes, expanded } : null;
  }

  lineOfSight(layer, a, b, clear) {
    const { cols, walk, dist } = layer;
    const ar = Math.floor(a / cols);
    const br = Math.floor(b / cols);
    const ax = a - ar * cols + 0.5;
    const bx = b - br * cols + 0.5;
    const az = ar + 0.5;
    const bz = br + 0.5;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.35));
    const road = layer.street && !layer.indoor[a] ? layer.road : null;
    const onRoad = road && road[a] && road[b];
    const hazard = layer.hazard && !(layer.hazard[a] || layer.hazard[b]) ? layer.hazard : null;
    let offRoad = 0;
    for (let s = 1; s < steps; s += 1) {
      const t = s / steps;
      const i = Math.floor(az + (bz - az) * t) * cols + Math.floor(ax + (bx - ax) * t);
      if (!walk[i] || dist[i] < clear) return false;
      if (hazard && hazard[i]) return false;
      if (onRoad && !road[i]) offRoad += 1;
    }
    // A road leg stays on the road: no shortcut across a field between two points of the same road.
    return !(onRoad && offRoad > 4);
  }

  smooth(layer, cells, clearMeters) {
    if (cells.length <= 2) return cells;
    const clear = Math.max(1, Math.round(clearMeters / (this.cell * 0.5)));
    const out = [cells[0]];
    let anchor = 0;
    const window = Math.round(14 / this.cell);
    while (anchor < cells.length - 1) {
      let last = anchor + 1;
      for (let j = anchor + 2; j < cells.length; j += 1) {
        if (this.lineOfSight(layer, cells[anchor], cells[j], clear)) last = j;
        else if (j - last > window) break;
      }
      out.push(cells[last]);
      anchor = last;
    }
    return out;
  }

  floorName(layer, inside) {
    const floors = this.mapData.floors;
    const pick = (id) => floors.find((f) => f.id === id);
    if (layer.street) {
      const f = inside ? pick(layer.floorIds[1]) || pick(layer.floorIds[0]) : pick(layer.floorIds[0]);
      return f ? f.nameRu || f.name : '';
    }
    const f = pick(layer.floorIds[0]);
    return f ? f.nameRu || f.name : layer.floorIds[0];
  }

  streetAlong(pts) {
    if (!this.streets.length || polylineLength(pts) < 20) return null;
    const samples = resample(pts, 10);
    const counts = new Map();
    for (const s of samples) {
      let best = null;
      let bestD = 40;
      for (const st of this.streets) {
        const d = Math.hypot(st.x - s.x, st.z - s.z);
        if (d < bestD) { bestD = d; best = st; }
      }
      if (best) counts.set(best, (counts.get(best) || 0) + 1);
    }
    let top = null;
    let topCount = 0;
    for (const [st, count] of counts) if (count > topCount) { top = st; topCount = count; }
    return top && topCount >= samples.length * 0.6 ? top.name : null;
  }

  // Ground under a stretch: road, forest, open ground (or inside / on a storey).
  surfaceOf(leg, pts) {
    const { layer } = leg;
    if (!layer.street) return 'floor';
    if (leg.inside) return 'indoor';
    const samples = pts.length > 1 ? resample(pts, Math.max(1, this.cell * 2)) : pts;
    let road = 0;
    let forest = 0;
    let n = 0;
    for (const s of samples) {
      const i = this.cellOf(layer, s.x, s.z);
      if (i < 0) continue;
      n += 1;
      if (layer.road[i]) road += 1;
      else if (layer.forest[i]) forest += 1;
    }
    if (this.streets.length && !this.projection.heightAt) return 'street';
    if (!n) return 'open';
    const open = n - road - forest;
    if (road / n >= 0.5) return 'road';
    if (forest >= open && forest / n >= 0.35) return 'forest';
    return open >= road ? 'open' : 'road';
  }

  landmarkNear(p) {
    let best = null;
    let bestD = 45;
    for (const l of this.landmarks) {
      const d = Math.hypot(l.x - p.x, l.z - p.z);
      if (d < bestD) { bestD = d; best = l; }
    }
    return best ? best.name : null;
  }

  locksNear(layer, pts, radius) {
    return [...new Set(this.lockedDoors.filter((d) => d.layer === layer && polylineDistance(d.x, d.z, pts) <= radius).map((d) => d.name))];
  }

  // Height of a route point for drawing: on relief maps the ground under it (+ storeys), else the layer plane.
  drawY(layer, p) {
    if (this.projection.heightAt) {
      const ground = this.projection.heightAt(p.x, p.z);
      return ground + 0.45 + (layer.street ? 0 : layer.rank * 3.3);
    }
    return layer.y;
  }

  // ------------------------------------------------------------------ routes

  setSafeMode(safe) {
    if (this.safe === Boolean(safe)) return;
    this.safe = Boolean(safe);
    this.cache.clear();
  }

  endpoints(fromGame, toGame, fromFloor, toFloor) {
    const a = { x: -fromGame.x, z: fromGame.z };
    const b = { x: -toGame.x, z: toGame.z };
    const street = this.streetLayer;
    const fromLayer = this.layerFor(fromGame, fromFloor);
    const toLayer = this.layerFor(toGame, toFloor);
    const bCell = this.cellOf(toLayer, b.x, b.z);
    const targetInside = bCell >= 0 && toLayer.street ? toLayer.indoor[bCell] : null;
    const goalFor = (start) => {
      const ok = (layer, inside) => (i) => this.sameComponent(start.layer, start.i, layer, i) && (inside == null || !layer.street || layer.indoor[i] === inside);
      const matched = this.snap(toLayer, b, GOAL_NEAR, ok(toLayer, targetInside)) || this.snap(toLayer, b, 12, ok(toLayer, targetInside));
      // A target right on the drawn edge of a room can round to the wrong side of the wall: a nearby cell of the
      // other side wins only when it is clearly closer.
      const any = this.snap(toLayer, b, GOAL_NEAR, ok(toLayer, null));
      if (any && (!matched || any.d < matched.d * 0.5 || matched.d - any.d > 1.5)) return any;
      return matched
        || this.snap(toLayer, b, GOAL_FAR, ok(toLayer, targetInside))
        || this.snap(toLayer, b, GOAL_FAR, ok(toLayer, null))
        || this.snap(toLayer, b, SNAP_START, ok(toLayer, null))
        || (toLayer !== street ? this.snap(street, b, SNAP_START, ok(street, null)) : null);
    };
    let sa = this.snap(fromLayer, a, SNAP_START) || (fromLayer !== street ? this.snap(street, a, SNAP_START) : null);
    if (!sa) return null;
    let sb = goalFor(sa);
    if (!sb) {
      // The start is cut off on the plan (a closed room): leave it at the nearest spot connected to the target.
      const free = this.snap(toLayer, b, GOAL_NEAR) || this.snap(toLayer, b, GOAL_FAR) || this.snap(street, b, SNAP_START);
      if (!free) return null;
      const toFree = (layer) => (i) => this.sameComponent(free.layer, free.i, layer, i);
      sa = this.snap(fromLayer, a, GOAL_FAR, toFree(fromLayer)) || this.snap(street, a, SNAP_START, toFree(street));
      if (!sa) return null;
      sb = goalFor(sa);
      if (!sb) return null;
    }
    return { a, b, sa, sb, toLayer };
  }

  // Route between two game positions. Options: the floor ids of both ends (used when a position has no height).
  route(fromGame, toGame, { fromFloor = null, toFloor = null, targetName = null } = {}) {
    if (!this.ready) return null;
    const key = [-fromGame.x, fromGame.z, fromGame.y, -toGame.x, toGame.z, toGame.y].map((v) => (v == null ? '-' : v.toFixed(1))).join(':') + `|${fromFloor}|${toFloor}|${this.safe}|${targetName}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const t0 = performance.now();
    const ends = this.endpoints(fromGame, toGame, fromFloor, toFloor);
    if (!ends) return null;
    const found = this.search(ends.sa.layer.base + ends.sa.i, ends.sb.layer.base + ends.sb.i);
    if (!found) return null;
    const result = this.assemble(found.nodes, fromGame, toGame, ends, targetName);
    result.expanded = found.expanded;
    result.ms = Math.round(performance.now() - t0);
    if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, result);
    return result;
  }

  // Routes from one position to many targets (nearest extract): one Dijkstra, then each path. Returns the
  // reachable targets sorted by walking length, each with its full route.
  routeToMany(fromGame, targets, { fromFloor = null } = {}) {
    if (!this.ready || !targets.length) return [];
    const t0 = performance.now();
    const street = this.streetLayer;
    const a = { x: -fromGame.x, z: fromGame.z };
    const fromLayer = this.layerFor(fromGame, fromFloor);
    const sa = this.snap(fromLayer, a, SNAP_START) || (fromLayer !== street ? this.snap(street, a, SNAP_START) : null);
    if (!sa) return [];
    const same = (layer) => (i) => this.sameComponent(sa.layer, sa.i, layer, i);
    const goals = [];
    for (const t of targets) {
      const toLayer = this.layerFor(t.position, t.floor);
      const b = { x: -t.position.x, z: t.position.z };
      const sb = this.snap(toLayer, b, GOAL_NEAR, same(toLayer)) || this.snap(toLayer, b, GOAL_FAR, same(toLayer)) || this.snap(street, b, SNAP_START, same(street));
      if (sb) goals.push({ t, sb, toLayer, b });
    }
    if (!goals.length) return [];
    const found = this.search(sa.layer.base + sa.i, new Set(goals.map((g) => g.sb.layer.base + g.sb.i)));
    const out = [];
    for (const { t, sb, toLayer, b } of goals) {
      const nodes = found.pathTo(sb.layer.base + sb.i);
      if (!nodes) continue;
      const route = this.assemble(nodes, fromGame, t.position, { a, b, sa, sb, toLayer }, t.name || null);
      out.push({ target: t, route });
    }
    out.sort((x, y) => x.route.length - y.route.length);
    this.lastManyMs = Math.round(performance.now() - t0);
    return out;
  }

  // Search nodes -> legs, straightened points, turn-by-turn description.
  assemble(nodeList, fromGame, toGame, { a, b, sa, sb, toLayer }, targetName) {
    const minCells = Math.max(2, Math.round(SHORT_LEG / this.cell));
    const legs = [];
    for (const node of nodeList) {
      const layer = this.layerOfNode(node);
      const i = node - layer.base;
      const inside = layer.street ? layer.indoor[i] : 1;
      const last = legs[legs.length - 1];
      if (!last || last.layer !== layer || last.inside !== inside) legs.push({ layer, inside, cells: [i] });
      else last.cells.push(i);
    }
    for (let changed = true; changed;) {
      changed = false;
      for (let k = 1; k < legs.length - 1; k += 1) {
        const [p, m, q] = [legs[k - 1], legs[k], legs[k + 1]];
        if (p.layer === m.layer && q.layer === m.layer && p.inside === q.inside && m.cells.length <= minCells) {
          p.cells.push(...m.cells, ...q.cells);
          legs.splice(k, 2);
          changed = true;
          break;
        }
      }
    }
    if (legs.length > 1 && legs[0].layer === legs[1].layer && legs[0].cells.length <= 4) {
      legs[1].cells.unshift(...legs[0].cells);
      legs.shift();
    }
    if (legs.length > 1 && legs[legs.length - 1].layer === legs[legs.length - 2].layer && legs[legs.length - 1].cells.length <= 4) {
      legs[legs.length - 2].cells.push(...legs.pop().cells);
    }

    for (const leg of legs) {
      leg.flat = this.smooth(leg.layer, leg.cells, leg.inside ? IN.clear : OUT.clear).map((i) => this.centerOf(leg.layer, i));
    }
    if (sa.d < 0.8) legs[0].flat[0] = { x: a.x, z: a.z };
    const lastLeg = legs[legs.length - 1];
    const onTargetLayer = sb.layer === toLayer;
    if (onTargetLayer && sb.d < 0.8) lastLeg.flat[lastLeg.flat.length - 1] = { x: b.x, z: b.z };

    // Points for drawing: on relief the outside legs follow the ground (resampled every 4 m).
    const relief = Boolean(this.projection.heightAt);
    let length = 0;
    const fenceCrossings = [];
    legs.forEach((leg, k) => {
      const next = legs[k + 1];
      const flat = next && next.layer === leg.layer ? [...leg.flat, next.flat[0]] : leg.flat;
      leg.meters = polylineLength(flat);
      length += leg.meters;
      if (k > 0 && legs[k - 1].layer !== leg.layer) length += STAIR_PER_STOREY * Math.abs(leg.layer.rank - legs[k - 1].layer.rank);
      const dense = relief && !leg.inside ? resample(leg.flat, 4) : leg.flat;
      leg.points = dense.map((p) => ({ x: p.x, z: p.z, y: this.drawY(leg.layer, p) }));
      leg.floorName = this.floorName(leg.layer, leg.inside);
      const trim = Math.min(8, leg.cells.length >> 2);
      const mid = trim ? leg.cells.slice(trim, -trim) : leg.cells;
      leg.assumed = Boolean(leg.layer.assumed) && mid.some((i) => leg.layer.assumed[i]);
      leg.hazard = Boolean(leg.layer.hazard) && leg.cells.some((i) => leg.layer.hazard[i]);
      leg.locks = leg.inside ? this.locksNear(leg.layer, leg.flat, 1.8) : [];
      const prev = legs[k - 1];
      if (prev && leg.layer.street && prev.layer === leg.layer) {
        leg.assumedEntry = this.assumedNear(leg.layer, leg.cells[0]) || Boolean(leg.inside && leg.layer.soft[leg.cells[0]]);
        leg.entryLocks = leg.inside ? this.locksNear(leg.layer, [leg.flat[0]], 3) : [];
      }
      if (next) leg.assumedExit = this.assumedNear(leg.layer, leg.cells[leg.cells.length - 1]) || Boolean(leg.inside && leg.layer.soft[leg.cells[leg.cells.length - 1]]);
      if (!leg.inside && leg.layer.street && leg.layer.assumed) {
        const fenced = leg.cells.filter((i) => leg.layer.assumed[i] && leg.layer.fence[i]);
        if (fenced.length) {
          const c = this.centerOf(leg.layer, fenced[Math.floor(fenced.length / 2)]);
          fenceCrossings.push({ x: c.x, z: c.z, y: this.drawY(leg.layer, c) });
        }
      }
    });
    // "Exit" of a leg is described on the next leg's entry.
    legs.forEach((leg, k) => {
      const prev = legs[k - 1];
      if (prev && !leg.inside && prev.inside) leg.assumedEntry = prev.assumedExit;
    });
    const points = legs.flatMap((leg) => leg.points);
    const endLeg = legs[legs.length - 1];
    const end = endLeg.flat[endLeg.flat.length - 1];
    const endGap = Math.hypot(b.x - end.x, b.z - end.z);
    const described = describeRoute({
      legs,
      surfaceOf: (leg, pts) => this.surfaceOf(leg, pts),
      streetName: this.streets.length ? (pts) => this.streetAlong(pts) : null,
      landmark: (p) => this.landmarkNear(p),
      startGap: sa.d,
      endGap,
      reached: onTargetLayer,
      targetName,
      targetFloor: this.floorName(toLayer, true),
      fenceCrossings,
    });
    const dy = fromGame.y != null && toGame.y != null ? fromGame.y - toGame.y : 0;
    return {
      points,
      legs: legs.map((l) => ({ rank: l.layer.rank, street: l.layer.street, inside: Boolean(l.inside), floorIds: l.layer.floorIds, points: l.points, meters: l.meters })),
      length,
      straight: Math.hypot(b.x - a.x, dy, b.z - a.z),
      reached: onTargetLayer,
      startGap: sa.d,
      endGap,
      fromFloor: this.floorName(sa.layer, sa.layer.street ? sa.layer.indoor[sa.i] : 1),
      toFloor: this.floorName(toLayer, true),
      steps: described.steps,
      maneuvers: described.maneuvers,
      waypoints: described.waypoints,
      eta: described.eta,
    };
  }

  // Debug: the walking raster of a layer as a PNG data URL.
  debugImage(layerIndex = 0) {
    const layer = this.layers[layerIndex];
    if (!layer) return null;
    const canvas = document.createElement('canvas');
    canvas.width = layer.cols;
    canvas.height = layer.rows;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(layer.cols, layer.rows);
    for (let i = 0; i < layer.n; i += 1) {
      const o = i * 4;
      const w = layer.walk[i];
      const inside = layer.indoor[i];
      let rgb = [18, 18, 22];
      if (w) {
        if (inside) rgb = layer.soft[i] ? [150, 110, 200] : layer.locked[i] ? [220, 80, 80] : [230, 200, 90];
        else rgb = layer.road[i] ? [200, 200, 200] : layer.forest[i] ? [60, 150, 70] : [140, 170, 100];
      } else if (layer.fence[i]) rgb = [40, 90, 255];
      else if (inside) rgb = [70, 60, 40];
      if (layer.hazard && layer.hazard[i]) rgb = [rgb[0], rgb[1] * 0.5, 255];
      if (layer.assumed && layer.assumed[i]) rgb = [255, 0, 255];
      img.data[o] = rgb[0];
      img.data[o + 1] = rgb[1];
      img.data[o + 2] = rgb[2];
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }
}
