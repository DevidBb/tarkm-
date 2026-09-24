// Walking navigation on the real Streets plan, like a car navigator but on foot and through buildings.
// Every floor of the SVG map becomes a 0.5 m grid (a "layer"):
// - street level: roads, pavements, yards and passages, plus the ground-floor rooms (First_Floor). Building
//   footprints and their outer walls block, so a route gets inside only through a doorway of the plan;
// - upper floors and the underground: the rooms and stairs of that floor.
// Doorways are read from the plan: a stretch of the ground-floor fill that reaches the footprint edge and is at
// least DOOR_MIN wide (the narrower notches are windows). Stairs: the same stair shape drawn on two floors joins them.
// A* runs over all layers at once; string pulling straightens every street / inside / floor leg separately.
// A point's layer comes from its height above the local ground (the lowest data points around it): Streets is
// hilly, so one height band per floor does not fit the whole map.
// A yard walled off by a fence with no gap drawn, or a room whose plan stops short of the outer wall, would
// otherwise be its own island unreachable from the street network - openSealedRooms() bridges the shortest such
// gap (through wall or fence, never mines) and flags the crossing as an approximate, drawn guess.
// Mines are a real hazard with no known safe lane in open data, so they always block. A sniper zone is only a
// risk warning, not a wall - it stays walkable but costs extra, so a route only crosses one when that is
// genuinely the shortest way, and says so.

import { SVGLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/SVGLoader.js/+esm';
import { displayName } from '../services/markerTypes.js';
import { formatMeters } from '../services/coords.js';

const CELL = 0.5; // meters per grid cell (the SVG is ~1 unit per meter)
const PX = 2; // raster pixels per cell side
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const STRIP_ATTRS = ['class', 'style', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'fill-opacity', 'opacity', 'filter', 'id'];

// Raster colors (drawn without anti-aliasing): red = walkable, green = inside a building, blue = fence.
const C_OUT = '#ff0000';
const C_IN = '#ffff00';
const C_WALL = '#00ff00';
const C_FENCE = '#0000ff';

const OUTDOOR_IDS = ['cement', 'road', 'gravel', 'green'];
const DOOR_MIN = 0.78; // m: window notches in the plan are 0.65 m, doorways 0.9 m and wider
const OUTLINE_TOL = 0.2; // m: a room edge this close to the footprint outline lies on the outer wall
const WALL_STROKE = 1.1; // m: outer walls are closed with this stroke along the footprint outline...
const DOOR_STROKE = 1.8; // m: ...and doorways are reopened across it

// Walking cost per cell: 1 + a penalty near walls (+ a little extra inside, so routes keep to streets and yards
// unless a building is a real shortcut). `clear` is the wall clearance of straightened legs, in distance-field units.
const OUT = { comfort: 2.2, penalty: 0.7, extra: 0, clear: 5 };
const IN = { comfort: 0.7, penalty: 0.6, extra: 0.4, clear: 2 };
const DOOR_COST = 5 / CELL;
const HAZARD_PENALTY = 4; // a sniper zone costs like a ~4x detour: crossed only when that is genuinely shorter
const STAIR_BASE = 3; // m
const STAIR_PER_STOREY = 5; // m of walking per storey climbed
const GROUND_STOREY = 3.2; // m above the local ground: still the street level (tarkov.dev points sit ~1 m above floors)
const STOREY = 3.1;
const UNDER_REL = -3;
const SNAP_START = 60; // m
const GOAL_NEAR = 3;
const GOAL_FAR = 40;
const SHORT_LEG = 8; // cells: shorter inside/outside flickers between two legs of the other kind are noise
const MAX_EXPANDED = 4000000;
const REACHED_GAP = 2.5;
// Street-level rooms the plan leaves without any doorway (some building plans stop short of the outer walls):
// regions of at least SEALED_MIN_CELLS get the shortest passage through the building mass, up to SEALED_BRIDGE.
const SEALED_MIN_CELLS = 24;
const SEALED_BRIDGE = 15; // m

function refNode(svgDoc, el) {
  if (el.localName !== 'use') return { node: el, dx: 0, dy: 0 };
  const href = el.getAttributeNS(XLINK_NS, 'href') || el.getAttribute('href') || el.getAttribute('xlink:href');
  const node = href ? svgDoc.querySelector(`[id="${href.replace(/^#/, '')}"]`) : null;
  return { node, dx: Number(el.getAttribute('x')) || 0, dy: Number(el.getAttribute('y')) || 0 };
}

function cleanMarkup(svgDoc, el, ser) {
  const { node, dx, dy } = refNode(svgDoc, el);
  if (!node) return '';
  const copy = node.cloneNode(true);
  const strip = (n) => {
    for (const a of STRIP_ATTRS) n.removeAttribute(a);
    for (const child of n.children) strip(child);
  };
  strip(copy);
  const markup = ser.serializeToString(copy);
  return dx || dy ? `<g transform="translate(${dx} ${dy})">${markup}</g>` : markup;
}

function markupOf(svgDoc, groups, ser) {
  return groups.flatMap((g) => [...g.children]).map((el) => cleanMarkup(svgDoc, el, ser)).join('');
}

// SVG path elements -> closed polygons [{x, y}] in SVG units.
function polygons(pathEls, divisions = 4) {
  const ds = pathEls.map((p) => p.getAttribute('d')).filter(Boolean);
  if (!ds.length) return [];
  const svg = `<svg xmlns="${SVG_NS}">${ds.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
  const out = [];
  for (const shapePath of new SVGLoader().parse(svg).paths) {
    for (const sub of shapePath.subPaths) {
      const pts = [];
      for (const p of sub.getPoints(divisions)) {
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-3) pts.push({ x: p.x, y: p.y });
      }
      if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= 1e-3) pts.pop();
      if (pts.length > 2) out.push(pts);
    }
  }
  return out;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
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
    let d = Math.hypot(b.x - a.x, b.z - a.z);
    let t0 = 0;
    while (d - t0 >= left) {
      t0 += left;
      const t = t0 / d;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      left = step;
    }
    left -= d - t0;
  }
  return out;
}

function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

const lcFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// Doorways: chains of room edges lying on the footprint outline, at least DOOR_MIN long.
function findDoors(footprints, rooms) {
  const B = 2;
  const hash = new Map();
  for (const poly of footprints) {
    for (let k = 0; k < poly.length; k += 1) {
      const a = poly[k];
      const b = poly[(k + 1) % poly.length];
      const edge = [a.x, a.y, b.x, b.y];
      for (let x = Math.floor(Math.min(a.x, b.x) / B) - 1; x <= Math.floor(Math.max(a.x, b.x) / B) + 1; x += 1) {
        for (let y = Math.floor(Math.min(a.y, b.y) / B) - 1; y <= Math.floor(Math.max(a.y, b.y) / B) + 1; y += 1) {
          const key = `${x},${y}`;
          if (!hash.has(key)) hash.set(key, []);
          hash.get(key).push(edge);
        }
      }
    }
  }
  const onOutline = (x, y) => {
    const list = hash.get(`${Math.floor(x / B)},${Math.floor(y / B)}`);
    if (!list) return false;
    for (const e of list) if (segmentDistance(x, y, e[0], e[1], e[2], e[3]) < OUTLINE_TOL) return true;
    return false;
  };
  const doors = [];
  for (const poly of rooms) {
    const n = poly.length;
    const flush = poly.map((a, k) => {
      const b = poly[(k + 1) % n];
      return onOutline(a.x, a.y) && onOutline(b.x, b.y) && onOutline((a.x + b.x) / 2, (a.y + b.y) / 2);
    });
    const start = flush.indexOf(false);
    if (start < 0) continue; // a room drawn exactly as its footprint: no wall to find a doorway in
    let chain = null;
    for (let s = 1; s <= n; s += 1) {
      const k = (start + s) % n;
      if (flush[k]) {
        const a = poly[k];
        const b = poly[(k + 1) % n];
        if (!chain) chain = { pts: [a], len: 0 };
        chain.pts.push(b);
        chain.len += Math.hypot(b.x - a.x, b.y - a.y);
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
function labelComponents(walk, cols, rows, queue) {
  const n = cols * rows;
  const comp = new Uint16Array(n);
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

// Floors of the map grouped into walking layers (floors sharing a height band, like GROUND + 1F, are one layer),
// bottom to top, with the SVG groups each layer is drawn from.
function layerSpecs(svgDoc, floors) {
  const drawn = floors.filter((f) => f.svgLayer);
  const specs = [];
  for (const f of drawn) {
    if (f.sharesHeightWith) continue;
    const floorIds = [f.id, ...drawn.filter((x) => x.sharesHeightWith === f.id).map((x) => x.id)];
    const spec = { floorIds, street: floorIds.includes('GROUND'), outdoor: [], footprints: [], fences: [], mines: [], hazards: [], rooms: [], stairs: [], passages: [] };
    for (const id of floorIds) {
      const root = svgDoc.querySelector(`[id="${drawn.find((x) => x.id === id).svgLayer}"]`);
      if (!root) continue;
      for (const g of root.children) {
        if (g.localName !== 'g') continue;
        const gid = g.getAttribute('id') || '';
        const cls = (g.getAttribute('class') || '').split(/\s+/);
        if (OUTDOOR_IDS.includes(gid)) spec.outdoor.push(g);
        else if (gid === 'buildings') spec.footprints.push(g);
        else if (gid === 'fence') spec.fences.push(g);
        // Mines are a real, unmapped physical hazard - never routed through. A sniper zone is only a risk
        // warning (a player can and does walk through it); it stays walkable, just costed like a detour.
        else if (gid === 'mines' || cls.includes('danger_small')) spec.mines.push(g);
        else if (gid === 'sniper' || cls.includes('danger')) spec.hazards.push(g);
        else if (cls.includes('stairs')) spec.stairs.push(g);
        else if (cls.includes('floor')) spec.rooms.push(g);
        else if (cls.includes('tarmac') || cls.includes('cement') || cls.includes('gravel')) spec.passages.push(g);
      }
    }
    specs.push(spec);
  }
  return specs;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Navigation raster failed to load'));
    img.src = url;
  });
}

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

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

export class Navigator {
  // Rejects when the map cannot be rasterized; the app then keeps straight-line distances.
  static async build({ svgDoc, mapData, environment }) {
    const nav = new Navigator(mapData);
    await nav.prepare(svgDoc, environment);
    return nav;
  }

  constructor(mapData) {
    const { projection } = mapData;
    this.mapData = mapData;
    this.projection = projection;
    this.cols = Math.round(projection.width / CELL);
    this.rows = Math.round(projection.depth / CELL);
    this.n = this.cols * this.rows;
    this.cellW = projection.width / this.cols;
    this.cellH = projection.depth / this.rows;
    this.svgSize = { w: mapData.map.svg.width, h: mapData.map.svg.height };
    this.layers = [];
    this.portals = new Map();
    this.doors = [];
    this.state = [];
    this.gen = 0;
    this.heap = new MinHeap();
    this.cache = new Map();
    this.ready = false;
    this.stats = null;
  }

  svgToScene(p) {
    const P = this.projection;
    return { x: P.sceneLeft + p.x * P.svgScaleX, z: P.sceneTop + p.y * P.svgScaleZ };
  }

  async prepare(svgDoc, environment) {
    const t0 = performance.now();
    const ser = new XMLSerializer();
    const P = this.projection;
    const specs = layerSpecs(svgDoc, this.mapData.floors);
    const streetIndex = specs.findIndex((s) => s.street);
    if (streetIndex < 0) throw new Error('No street level in the map floors');
    const streetSpec = specs[streetIndex];

    const paths = (groups) => groups.flatMap((g) => [...g.querySelectorAll('path')]);
    const doors = findDoors(polygons(paths(streetSpec.footprints), 12), polygons(paths(streetSpec.rooms), 12));
    this.doors = doors.map((d) => {
      let left = d.len / 2;
      let mid = d.pts[0];
      for (let k = 1; k < d.pts.length; k += 1) {
        const a = d.pts[k - 1];
        const b = d.pts[k];
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        if (l >= left) { mid = { x: a.x + ((b.x - a.x) * left) / (l || 1), y: a.y + ((b.y - a.y) * left) / (l || 1) }; break; }
        left -= l;
      }
      return { ...this.svgToScene(mid), width: d.len };
    });
    const doorMarkup = doors.map((d) => `<polyline points="${d.pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ')}"/>`).join('');
    const toSvg = (p) => `${((-p.x - P.sceneLeft) / P.svgScaleX).toFixed(2)},${((p.z - P.sceneTop) / P.svgScaleZ).toFixed(2)}`;
    const minefields = ((environment && environment.minefields) || [])
      .filter((m) => Array.isArray(m.outline) && m.outline.length >= 3)
      .map((m) => `<polygon points="${m.outline.map(toSvg).join(' ')}"/>`)
      .join('');

    const queue = new Int32Array(this.n);
    const stairs = new Map();
    let compTotal = 0;
    for (const [k, spec] of specs.entries()) {
      const { walk, indoor, fence, walkable } = await this.rasterize(this.layerMarkup(svgDoc, spec, ser, doorMarkup, minefields));
      if (!walkable) continue;
      const hazard = spec.hazards.length ? await this.rasterizeMask(this.hazardMarkup(svgDoc, spec, ser)) : null;
      const { comp, count } = labelComponents(walk, this.cols, this.rows, queue);
      const layer = {
        index: this.layers.length,
        rank: k - streetIndex,
        floorIds: spec.floorIds,
        street: spec.street,
        walk,
        indoor: spec.street ? indoor : null,
        fence: spec.street ? fence : null,
        hazard,
        dist: distanceField(walk, this.cols, this.rows),
        comp,
        compBase: compTotal,
        assumed: null,
        walkable,
        y: (spec.street ? P.groundY : P.floorPlaneY(spec.floorIds[0])) + 0.4,
      };
      compTotal += count + 1;
      this.layers.push(layer);
      for (const g of spec.stairs) {
        for (const el of g.children) {
          const { node, dx, dy } = refNode(svgDoc, el);
          if (!node || !node.getAttribute('d')) continue;
          const key = el.localName === 'use' ? `use:${node.getAttribute('id')}:${dx}:${dy}` : `d:${node.getAttribute('d')}`;
          if (!stairs.has(key)) {
            const poly = polygons([node])[0];
            if (!poly) continue;
            const xs = poly.map((p) => p.x);
            const ys = poly.map((p) => p.y);
            const center = this.svgToScene({ x: (Math.min(...xs) + Math.max(...xs)) / 2 + dx, y: (Math.min(...ys) + Math.max(...ys)) / 2 + dy });
            stairs.set(key, { ...center, layers: [] });
          }
          stairs.get(key).layers.push(layer);
        }
      }
      await nextFrame();
    }
    this.streetLayer = this.layers.find((l) => l.street);
    if (!this.streetLayer) throw new Error('Street level has no walkable area');
    this.linkLayers(stairs, compTotal);
    const opened = this.openSealedRooms();
    if (opened) {
      const street = this.streetLayer;
      street.comp = labelComponents(street.walk, this.cols, this.rows, queue).comp;
      street.dist = distanceField(street.walk, this.cols, this.rows);
      this.linkLayers(stairs, compTotal);
    }
    this.prepareHeights();
    this.ready = true;
    this.stats = {
      ms: Math.round(performance.now() - t0),
      cols: this.cols,
      rows: this.rows,
      cell: CELL,
      layers: this.layers.map((l) => `${l.floorIds.join('+')}:${Math.round((l.walkable / this.n) * 1000) / 10}%`),
      doors: this.doors.length,
      stairs: stairs.size,
      portals: this.portalCount,
      assumedEntrances: opened,
    };
  }

  layerMarkup(svgDoc, spec, ser, doorMarkup, minefields) {
    const { w: W, h: H } = this.svgSize;
    const m = (groups) => markupOf(svgDoc, groups, ser);
    const parts = [
      `<svg xmlns="${SVG_NS}" width="${this.cols * PX}" height="${this.rows * PX}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" shape-rendering="crispEdges">`,
      `<rect x="-20" y="-20" width="${W + 40}" height="${H + 40}" fill="#000"/>`,
    ];
    if (spec.street) {
      parts.push(`<g fill="${C_OUT}" stroke="none">${m(spec.outdoor)}</g>`);
      parts.push(`<g fill="${C_WALL}" stroke="none">${m(spec.footprints)}</g>`);
    }
    parts.push(`<g fill="${C_IN}" stroke="none">${m(spec.rooms)}${m(spec.stairs)}</g>`);
    if (spec.street) {
      parts.push(`<g fill="none" stroke="${C_WALL}" stroke-width="${WALL_STROKE}" stroke-linejoin="round">${m(spec.footprints)}</g>`);
      parts.push(`<g fill="none" stroke="${C_IN}" stroke-width="${DOOR_STROKE}" stroke-linecap="butt" stroke-linejoin="round">${doorMarkup}</g>`);
    }
    parts.push(`<g fill="${C_OUT}" stroke="none">${m(spec.passages)}</g>`);
    if (spec.street) parts.push(`<g fill="none" stroke="${C_FENCE}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${m(spec.fences)}</g>`);
    // Only mines block outright - a real, unmapped hazard. A sniper zone (spec.hazards) is drawn nowhere here,
    // so the ordinary ground underneath stays walkable; hazardMarkup() rasterizes it separately as a cost only.
    parts.push(`<g fill="#000" stroke="#000" stroke-width="1.6" stroke-linejoin="round">${m(spec.mines)}${spec.street ? minefields : ''}</g>`, '</svg>');
    return parts.join('');
  }

  hazardMarkup(svgDoc, spec, ser) {
    const { w: W, h: H } = this.svgSize;
    const shapes = markupOf(svgDoc, spec.hazards, ser);
    return [
      `<svg xmlns="${SVG_NS}" width="${this.cols * PX}" height="${this.rows * PX}" viewBox="0 0 ${this.svgSize.w} ${this.svgSize.h}" preserveAspectRatio="none" shape-rendering="crispEdges">`,
      `<rect x="-20" y="-20" width="${W + 40}" height="${H + 40}" fill="#000"/>`,
      `<g fill="#fff" stroke="#fff" stroke-width="1.6" stroke-linejoin="round">${shapes}</g>`,
      '</svg>',
    ].join('');
  }

  // A plain white-on-black mask (any partial coverage counts): used only as a routing cost, so over-marking a
  // cell at a hazard's edge is the safe direction.
  async rasterizeMask(markup) {
    const { cols, rows, n } = this;
    const width = cols * PX;
    const height = rows * PX;
    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, width, height);
    const px = ctx.getImageData(0, 0, width, height).data;
    canvas.width = 0;
    canvas.height = 0;
    const mask = new Uint8Array(n);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        let hit = false;
        for (let dy = 0; dy < PX && !hit; dy += 1) {
          const row = (r * PX + dy) * width;
          for (let dx = 0; dx < PX; dx += 1) if (px[(row + c * PX + dx) * 4] > 40) { hit = true; break; }
        }
        if (hit) mask[r * cols + c] = 1;
      }
    }
    return mask;
  }

  async rasterize(markup) {
    const { cols, rows, n } = this;
    const width = cols * PX;
    const height = rows * PX;
    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, width, height);
    const px = ctx.getImageData(0, 0, width, height).data;
    canvas.width = 0;
    canvas.height = 0;
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
    return { walk, indoor, fence, walkable };
  }

  linkLayers(stairs, compTotal) {
    this.dsu = new Int32Array(compTotal + 1);
    for (let i = 0; i < this.dsu.length; i += 1) this.dsu[i] = i;
    this.portals = new Map();
    this.buildPortals(stairs);
  }

  // Street-level regions with no way to reach the main street/yard network (not even by stairs through other
  // floors) get the shortest passage to it, through whatever blocks them: a building's walls, or a fence around
  // an enclosed yard. Mines and sniper zones are never crossed - the plan simply has no route through those.
  // The passage cells are flagged `assumed`: the plan does not show where the real door or fence gap is.
  openSealedRooms() {
    const layer = this.streetLayer;
    const { walk, indoor, fence, comp, compBase } = layer;
    const { cols, rows, n } = this;
    let count = 0;
    for (let i = 0; i < n; i += 1) if (comp[i] !== 0xffff && comp[i] > count) count = comp[i];
    const size = new Int32Array(count + 2);
    for (let i = 0; i < n; i += 1) {
      const c = comp[i];
      if (c && c !== 0xffff) size[c] += 1;
    }
    // The main network is the one component (after stairs/portal unions) with by far the most walkable cells;
    // everything else that isn't already joined to it is a candidate for bridging.
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
    const depth = new Uint8Array(n);
    const queue = new Int32Array(n);
    const assumed = new Uint8Array(n);
    const maxDepth = Math.round(SEALED_BRIDGE / CELL);
    let opened = 0;
    for (let c = 1; c <= count; c += 1) {
      if (size[c] < SEALED_MIN_CELLS || isOpen(c)) continue;
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
      // indoor[i] already says whether this bridged cell is building mass (1) or a fence gap (0) - leave it,
      // so a fence bridge stays an outdoor leg and a wall bridge still reads as entering the building.
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
    const r0 = (i / this.cols) | 0;
    const c0 = i - r0 * this.cols;
    for (let r = Math.max(0, r0 - 4); r <= Math.min(this.rows - 1, r0 + 4); r += 1) {
      for (let c = Math.max(0, c0 - 4); c <= Math.min(this.cols - 1, c0 + 4); c += 1) {
        if (layer.assumed[r * this.cols + c]) return true;
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

  // Stairs drawn on several floors join each pair of neighbouring floors. A stair drawn on one floor only
  // (a flight down to the underground, up to a mezzanine) joins the neighbouring floor that is walkable right there.
  buildPortals(stairs) {
    let count = 0;
    const byRank = new Map(this.layers.map((l) => [l.rank, l]));
    for (const s of stairs.values()) {
      const list = [...new Set(s.layers)].sort((a, b) => a.rank - b.rank);
      const pairs = [];
      if (list.length >= 2) {
        for (let k = 1; k < list.length; k += 1) pairs.push([list[k - 1], list[k]]);
      } else {
        const only = list[0];
        for (const other of [byRank.get(only.rank - 1), byRank.get(only.rank + 1)]) {
          if (other && this.snap(other, s, 1.5)) { pairs.push([only, other]); break; }
        }
      }
      for (const [a, b] of pairs) {
        const sa = this.snap(a, s, 2.5);
        const sb = this.snap(b, s, 2.5);
        if (!sa || !sb) continue;
        const cost = (STAIR_BASE + STAIR_PER_STOREY * Math.abs(b.rank - a.rank)) / CELL;
        const na = a.index * this.n + sa.i;
        const nb = b.index * this.n + sb.i;
        if (!this.portals.has(na)) this.portals.set(na, []);
        if (!this.portals.has(nb)) this.portals.set(nb, []);
        this.portals.get(na).push({ node: nb, cost });
        this.portals.get(nb).push({ node: na, cost });
        this.union(a, sa.i, b, sb.i);
        count += 1;
      }
    }
    this.portalCount = count;
  }

  // Local ground height from data points (spawns, extracts, loot) standing on open street cells; locked doors
  // and street labels for route notes.
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
    const points = [...this.mapData.entities, ...(this.mapData.loot || [])];
    for (const e of points) {
      if (!e.position || e.position.y == null) continue;
      const p = { x: -e.position.x, z: e.position.z, y: e.position.y };
      const i = this.cellOf(p.x, p.z);
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
    const { outdoor, all } = this.heightHash;
    let ys = this.heightsNear(outdoor, x, z, 35);
    if (ys.length >= 3) return quantile(ys, 0.3);
    ys = this.heightsNear(all, x, z, 35);
    if (ys.length >= 3) return quantile(ys, 0.05);
    ys = this.heightsNear(outdoor, x, z, 80);
    return ys.length ? quantile(ys, 0.3) : null;
  }

  // Walking layer of a game position: the storey from the height above local ground, limited to the floors
  // actually drawn at that spot. Without a height the floor id is used, then the street level.
  layerFor(position, floorHint = null) {
    const s = { x: -position.x, z: position.z };
    let want = null;
    if (position.y != null) {
      const ground = this.groundAt(s.x, s.z);
      if (ground != null) {
        const rel = position.y - ground;
        want = rel < UNDER_REL ? -1 : rel < GROUND_STOREY ? 0 : 1 + Math.floor((rel - GROUND_STOREY) / STOREY);
      }
    }
    if (want == null && floorHint) {
      const hinted = this.layers.find((l) => l.floorIds.includes(floorHint));
      if (hinted) want = hinted.rank;
    }
    if (want == null) want = 0;
    const drawnHere = this.layers.filter((l) => this.snap(l, s, 1.5));
    if (!drawnHere.length) return this.layers.find((l) => l.rank === want) || this.streetLayer;
    return drawnHere.reduce((best, l) => {
      const d = Math.abs(l.rank - want);
      const bd = Math.abs(best.rank - want);
      return d < bd || (d === bd && Math.abs(l.rank) < Math.abs(best.rank)) ? l : best;
    });
  }

  cellOf(sceneX, sceneZ) {
    const c = Math.floor((sceneX - this.projection.sceneLeft) / this.cellW);
    const r = Math.floor((sceneZ - this.projection.sceneTop) / this.cellH);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  centerOf(i) {
    const r = Math.floor(i / this.cols);
    const c = i - r * this.cols;
    return { x: this.projection.sceneLeft + (c + 0.5) * this.cellW, z: this.projection.sceneTop + (r + 0.5) * this.cellH };
  }

  // Nearest walkable cell of a layer to a scene point, within maxMeters; `accept` filters cells.
  snap(layer, p, maxMeters, accept = null) {
    const { cols, rows } = this;
    const { walk } = layer;
    const c0 = Math.floor((p.x - this.projection.sceneLeft) / this.cellW);
    const r0 = Math.floor((p.z - this.projection.sceneTop) / this.cellH);
    const maxR = Math.ceil(maxMeters / CELL) + 1;
    let best = null;
    for (let rad = 0; rad <= maxR; rad += 1) {
      for (let r = r0 - rad; r <= r0 + rad; r += 1) {
        if (r < 0 || r >= rows) continue;
        const edge = r === r0 - rad || r === r0 + rad;
        for (let c = c0 - rad; c <= c0 + rad; c += edge ? 1 : 2 * rad || 1) {
          if (c < 0 || c >= cols) continue;
          const i = r * cols + c;
          if (!walk[i] || (accept && !accept(i))) continue;
          const q = this.centerOf(i);
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d <= maxMeters + CELL && (!best || d < best.d)) best = { layer, i, d };
        }
      }
      if (best && best.d <= rad * CELL) break;
    }
    return best;
  }

  cellCost(layer, i) {
    const inside = layer.indoor ? layer.indoor[i] : 1;
    const k = inside ? IN : OUT;
    const d = layer.dist[i] * CELL * 0.5;
    let cost = 1 + (d < k.comfort ? (k.comfort - d) * k.penalty : 0) + k.extra;
    if (layer.hazard && layer.hazard[i]) cost += HAZARD_PENALTY;
    return cost;
  }

  searchState(li) {
    let s = this.state[li];
    if (!s) {
      s = { g: new Float32Array(this.n), parent: new Int32Array(this.n), closed: new Uint8Array(this.n), gen: -1 };
      this.state[li] = s;
    }
    if (s.gen !== this.gen) {
      s.g.fill(Infinity);
      s.closed.fill(0);
      s.gen = this.gen;
    }
    return s;
  }

  search(startNode, goalNode) {
    const { n, cols, rows, heap } = this;
    this.gen += 1;
    heap.clear();
    const goalLayer = Math.floor(goalNode / n);
    const goalCell = goalNode - goalLayer * n;
    const gr = Math.floor(goalCell / cols);
    const gc = goalCell - gr * cols;
    const h = (i) => {
      const r = (i / cols) | 0;
      const dx = Math.abs(i - r * cols - gc);
      const dz = Math.abs(r - gr);
      return dx > dz ? dx + 0.41421356 * dz : dz + 0.41421356 * dx;
    };
    const startLayer = Math.floor(startNode / n);
    const startCell = startNode - startLayer * n;
    const s0 = this.searchState(startLayer);
    s0.g[startCell] = 0;
    s0.parent[startCell] = -1;
    heap.push(startNode, h(startCell));
    let expanded = 0;
    let reached = false;
    while (heap.size) {
      const node = heap.pop();
      const li = Math.floor(node / n);
      const cur = node - li * n;
      const s = this.searchState(li);
      if (s.closed[cur]) continue;
      s.closed[cur] = 1;
      expanded += 1;
      if (node === goalNode) { reached = true; break; }
      if (expanded > MAX_EXPANDED) break;
      const layer = this.layers[li];
      const { walk, indoor } = layer;
      const { g, parent, closed } = s;
      const gCur = g[cur];
      const cCur = this.cellCost(layer, cur);
      const base = li * n;
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
          if (!walk[ni] || closed[ni]) continue;
          const diagonal = dr && dc;
          if (diagonal && (!walk[r * cols + nc] || !walk[nr * cols + c])) continue; // no corner cutting
          let ng = gCur + (diagonal ? Math.SQRT2 : 1) * (cCur + this.cellCost(layer, ni)) * 0.5;
          if (indoor && indoor[ni] !== indoor[cur]) ng += DOOR_COST;
          if (ng < g[ni]) {
            g[ni] = ng;
            parent[ni] = node;
            heap.push(base + ni, ng + h(ni));
          }
        }
      }
      const portals = this.portals.get(node);
      if (portals) {
        for (const p of portals) {
          const tl = Math.floor(p.node / n);
          const ti = p.node - tl * n;
          const ts = this.searchState(tl);
          if (ts.closed[ti]) continue;
          const ng = gCur + p.cost;
          if (ng < ts.g[ti]) {
            ts.g[ti] = ng;
            ts.parent[ti] = node;
            heap.push(p.node, ng + h(ti));
          }
        }
      }
    }
    if (!reached) return null;
    const nodes = [];
    for (let node = goalNode; node !== -1;) {
      nodes.push(node);
      const li = Math.floor(node / n);
      node = this.state[li].parent[node - li * n];
    }
    nodes.reverse();
    return { nodes, expanded };
  }

  lineOfSight(layer, a, b, clear) {
    const { cols } = this;
    const { walk, dist } = layer;
    const ar = Math.floor(a / cols);
    const br = Math.floor(b / cols);
    const ax = a - ar * cols + 0.5;
    const bx = b - br * cols + 0.5;
    const az = ar + 0.5;
    const bz = br + 0.5;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.35));
    for (let s = 1; s < steps; s += 1) {
      const t = s / steps;
      const i = Math.floor(az + (bz - az) * t) * cols + Math.floor(ax + (bx - ax) * t);
      if (!walk[i] || dist[i] < clear) return false;
    }
    return true;
  }

  smooth(layer, cells, clear) {
    if (cells.length <= 2) return cells;
    const out = [cells[0]];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let last = anchor + 1;
      for (let j = anchor + 2; j < cells.length; j += 1) {
        if (this.lineOfSight(layer, cells[anchor], cells[j], clear)) last = j;
        else if (j - last > 28) break;
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
      const f = inside ? pick(layer.floorIds.find((id) => id !== 'GROUND')) || pick('GROUND') : pick('GROUND');
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

  locksNear(layer, pts, radius) {
    return [...new Set(this.lockedDoors.filter((d) => d.layer === layer && polylineDistance(d.x, d.z, pts) <= radius).map((d) => d.name))];
  }

  // Route between two game positions. Options: the floor ids of both ends (used when a position has no height).
  route(fromGame, toGame, { fromFloor = null, toFloor = null } = {}) {
    if (!this.ready) return null;
    const a = { x: -fromGame.x, z: fromGame.z };
    const b = { x: -toGame.x, z: toGame.z };
    const key = [a.x, a.z, fromGame.y, b.x, b.z, toGame.y].map((v) => (v == null ? '-' : v.toFixed(1))).join(':') + `|${fromFloor}|${toFloor}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const t0 = performance.now();
    const street = this.streetLayer;
    const fromLayer = this.layerFor(fromGame, fromFloor);
    const toLayer = this.layerFor(toGame, toFloor);

    // A target inside a building is reached inside it, not at the pavement behind its wall.
    const bCell = this.cellOf(b.x, b.z);
    const targetInside = toLayer.indoor && bCell >= 0 ? toLayer.indoor[bCell] : null;
    const goalFor = (start) => {
      const ok = (layer, inside) => (i) => this.sameComponent(start.layer, start.i, layer, i) && (inside == null || !layer.indoor || layer.indoor[i] === inside);
      const matched = this.snap(toLayer, b, GOAL_NEAR, ok(toLayer, targetInside)) || this.snap(toLayer, b, 12, ok(toLayer, targetInside));
      // A target right on the drawn edge of a room can round to the wrong side of the wall (indoor when the
      // spot is really the yard next to it, or the reverse): a nearby cell of the other side wins when it is
      // clearly closer, not merely closer, so a genuinely indoor target still snaps inside past a thin wall.
      const any = this.snap(toLayer, b, GOAL_NEAR, ok(toLayer, null));
      if (any && (!matched || any.d < matched.d * 0.5 || matched.d - any.d > 1.5)) return any;
      return matched
        || this.snap(toLayer, b, GOAL_FAR, ok(toLayer, targetInside))
        || this.snap(toLayer, b, GOAL_FAR, ok(toLayer, null))
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
    const found = this.search(sa.layer.index * this.n + sa.i, sb.layer.index * this.n + sb.i);
    if (!found) return null;

    // Legs: runs of one layer and one side of the building walls.
    const legs = [];
    for (const node of found.nodes) {
      const li = Math.floor(node / this.n);
      const i = node - li * this.n;
      const layer = this.layers[li];
      const inside = layer.indoor ? layer.indoor[i] : 1;
      const last = legs[legs.length - 1];
      if (!last || last.layer !== layer || last.inside !== inside) legs.push({ layer, inside, cells: [i] });
      else last.cells.push(i);
    }
    for (let changed = true; changed;) {
      changed = false;
      for (let k = 1; k < legs.length - 1; k += 1) {
        const [p, m, q] = [legs[k - 1], legs[k], legs[k + 1]];
        if (p.layer === m.layer && q.layer === m.layer && p.inside === q.inside && m.cells.length <= SHORT_LEG) {
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
      leg.points = this.smooth(leg.layer, leg.cells, leg.inside ? IN.clear : OUT.clear).map((i) => ({ ...this.centerOf(i), y: leg.layer.y }));
    }
    const first = legs[0].points;
    const lastLeg = legs[legs.length - 1];
    if (sa.d < 0.8) first[0] = { x: a.x, z: a.z, y: legs[0].layer.y };
    const onTargetLayer = sb.layer === toLayer;
    if (onTargetLayer && sb.d < 0.8) lastLeg.points[lastLeg.points.length - 1] = { x: b.x, z: b.z, y: lastLeg.layer.y };

    let length = 0;
    const steps = [];
    const waypoints = [];
    if (sa.d > REACHED_GAP) {
      steps.push({
        kind: 'gap',
        text: `Сначала ${formatMeters(sa.d)} до начала маршрута: отсюда прохода на плане карты нет`,
        note: 'Возможно, запертая дверь или помещение, которого нет на плане этажа.',
      });
    }
    legs.forEach((leg, k) => {
      const prev = legs[k - 1];
      const next = legs[k + 1];
      const pts = next && next.layer === leg.layer ? [...leg.points, next.points[0]] : leg.points;
      const meters = polylineLength(pts);
      length += meters;
      const at = leg.points[0];
      if (prev && prev.layer !== leg.layer) {
        const up = leg.layer.rank > prev.layer.rank;
        length += STAIR_PER_STOREY * Math.abs(leg.layer.rank - prev.layer.rank);
        const floor = this.floorName(leg.layer, leg.inside);
        const lastStep = steps[steps.length - 1];
        const kind = up ? 'up' : 'down';
        const text = `${up ? 'Поднимитесь' : 'Спуститесь'} по лестнице на ${lcFirst(floor)}`;
        if (lastStep && lastStep.kind === kind) {
          lastStep.text = text;
          waypoints[waypoints.length - 1].label = `${up ? '↑' : '↓'} ${floor}`;
        } else {
          steps.push({ kind, text });
          waypoints.push({ kind, x: at.x, y: at.y, z: at.z, label: `${up ? '↑' : '↓'} ${floor}` });
        }
      } else if (prev && leg.layer.street && prev.inside !== leg.inside) {
        const locks = leg.inside ? this.locksNear(leg.layer, [at], 3) : [];
        const guessed = this.assumedNear(leg.layer, leg.inside ? leg.cells[0] : prev.cells[prev.cells.length - 1]);
        const notes = [];
        if (guessed) notes.push('Дверь на плане карты не нарисована: показан ближайший проход сквозь стену, настоящий вход где-то у этой стены.');
        if (locks.length) notes.push(`Рядом дверь под ключ: ${locks.join(', ')}`);
        steps.push({
          kind: leg.inside ? 'enter' : 'exit',
          text: leg.inside ? 'Войдите в здание' : 'Выйдите на улицу',
          note: notes.join(' ') || null,
        });
        const label = leg.inside ? 'Вход' : 'Выход';
        waypoints.push({ kind: leg.inside ? 'enter' : 'exit', x: at.x, y: at.y, z: at.z, label: guessed ? `≈ ${label}` : label });
      }
      // A fence bridge stays inside an outdoor leg (both sides are outside), so it never trips the enter/exit
      // branch above - flag it here instead, with a marker at the crossing itself.
      if (!leg.inside && leg.layer.fence) {
        const fenced = leg.cells.filter((i) => leg.layer.assumed[i] && leg.layer.fence[i]);
        if (fenced.length) {
          const mid = this.centerOf(fenced[Math.floor(fenced.length / 2)]);
          waypoints.push({ kind: 'fence', x: mid.x, y: leg.layer.y, z: mid.z, label: '≈ Забор' });
        }
      }
      if (meters < 1) return;
      let text;
      if (!leg.inside) {
        const name = this.streetAlong(pts);
        text = `Идите ${formatMeters(meters)} ${name ? `по ${name}` : 'по улице и дворам'}`;
      } else if (leg.layer.street) {
        text = `Пройдите ${formatMeters(meters)} внутри здания`;
      } else {
        text = `Пройдите ${formatMeters(meters)} по этажу (${lcFirst(this.floorName(leg.layer, true))})`;
      }
      const locks = leg.inside ? this.locksNear(leg.layer, pts, 1.8) : [];
      const notes = [];
      const assumedInLeg = leg.layer.assumed && leg.cells.slice(8, -8).some((i) => leg.layer.assumed[i]);
      if (assumedInLeg) {
        notes.push(leg.inside
          ? 'Часть прохода внутри не нарисована на плане: показана приблизительно.'
          : 'Забор здесь нарисован сплошным: показан ближайший проход через него, настоящий проём где-то рядом.');
      }
      if (locks.length) notes.push(`По пути дверь под ключ: ${locks.join(', ')}`);
      const hazardInLeg = Boolean(leg.layer.hazard) && leg.cells.some((i) => leg.layer.hazard[i]);
      if (hazardInLeg) notes.push('Часть пути проходит через зону снайпера.');
      steps.push({ kind: hazardInLeg ? 'hazard' : 'walk', text, meters, note: notes.join(' ') || null });
    });

    const points = legs.flatMap((leg) => leg.points);
    const end = points[points.length - 1];
    const endGap = Math.hypot(b.x - end.x, b.z - end.z);
    const reached = onTargetLayer;
    if (reached && endGap <= REACHED_GAP) {
      steps.push({ kind: 'arrive', text: 'Вы у цели' });
    } else {
      steps.push({
        kind: 'gap',
        text: `Дальше ${formatMeters(endGap)} до цели: прохода на плане карты нет`,
        note: reached
          ? 'Возможно, запертая дверь, окно или место, которого нет на плане этажа.'
          : `Цель на уровне «${this.floorName(toLayer, true)}», но лестницы туда на плане не найдено.`,
      });
    }
    const dy = fromGame.y != null && toGame.y != null ? fromGame.y - toGame.y : 0;
    const result = {
      points,
      length,
      straight: Math.hypot(b.x - a.x, dy, b.z - a.z),
      reached,
      startGap: sa.d,
      endGap,
      fromFloor: this.floorName(sa.layer, sa.layer.indoor ? sa.layer.indoor[sa.i] : 1),
      toFloor: this.floorName(toLayer, true),
      steps,
      waypoints,
      expanded: found.expanded,
      ms: Math.round(performance.now() - t0),
    };
    if (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, result);
    return result;
  }
}
