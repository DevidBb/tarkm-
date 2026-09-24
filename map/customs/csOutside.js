// Details of the Customs territory (OUTSIDE), built from Shebuka's SVG and tarkov.dev data:
// - buildings by kind: warehouses (corrugated siding, roller doors toward yards and roads), dorms and Fortress (brick /
//   panels, entrances), houses (pitched roofs, chimneys, porches), garage rows (a gate every 3.3 m), unfinished
//   concrete frames (Skeleton, Old Construction), fuel tanks (SVG circles), shipping containers and site cabins
//   (SVG small buildings of container size);
// - roads as 3D surfaces on the relief (asphalt with worn centre line, cracks and potholes; dirt tracks with ruts),
//   bridges where a road crosses the river, trodden paths from doors to the nearest road;
// - fences of several kinds (concrete panels, chain-link, corrugated sheets, wooden planks) with gaps where roads pass;
// - yards: parked cars, trucks at roller doors, container stacks, pallets, barrels, tyres, scrap; fuel canopies at the gas
//   stations, a bus stop; tall grass on open ground.
// Approximate (not in open data): which building has which facade, door and gate positions, fence kinds, yard contents,
// parked cars, paths, grass. Landmarks are matched by the tarkov.dev location names (Big Red, Dorms, Fortress...).

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { MeshBucket, ringWalls, slab, box as kbox, ringInfo, color } from '../interchange/icKit.js';
import { InstancedLayer, composeMatrix } from '../city/instancing.js';
import { rng, hashString, pick, pointInPolygon, centroid, SegmentGrid, signedArea } from '../city/util.js';
import { walkLine, addMesh, facadeRing, gableRoof } from '../shoreline/slBuild.js';
import { customsFacade } from './csTextures.js';
import { tankGeometry, canopyGeometry, CONTAINER_COLORS, CABIN_COLORS, GARAGE_COLORS, SHEET_COLORS, GRASS_COLORS, BARREL_COLORS } from './csModels.js';
import { merge } from '../city/models.js';

const C = {
  roofRust: color('#6b4f3a'), roofGrey: color('#5c5f5e'), roofDark: color('#46423c'), roofSlate: color('#6e7271'), gable: color('#8a7d6a'),
  roofFlat: color('#5d5e5a'), roofTar: color('#3f403d'), parapet: color('#b3ab9c'), parapetLow: color('#8f887b'),
  concrete: color('#a8a59c'), concreteLow: color('#85827a'), concreteDark: color('#6f6c66'),
  asphalt: color('#4c4f51'), asphalt2: color('#55585a'), asphaltWorn: color('#5e5f5c'), shoulder: color('#6f6656'), line: color('#bdb7a3'),
  dirt: color('#7a6a4f'), rut: color('#5b4c38'), dirtGrass: color('#6d6c45'), path: color('#76664b'), path2: color('#6a5a41'),
  deck: color('#8a877f'), deckSide: color('#6f6c64'),
};
const alongX = (d) => Math.atan2(-d.z, d.x);
const faceZ = (n) => Math.atan2(n.x, n.z);
const off = (p, d, k) => ({ x: p.x + d.x * k, z: p.z + d.z * k });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Oriented bounding box of a ring: centre, long axis u, short axis v, length, width, corners, fill ratio.
export function obbOf(ring) {
  let best = null;
  const area = Math.abs(signedArea(ring));
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const u = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    const v = { x: -u.z, z: u.x };
    let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity;
    for (const p of ring) {
      const pu = p.x * u.x + p.z * u.z;
      const pv = p.x * v.x + p.z * v.z;
      u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
    }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) best = { A, u, v, u0, u1, v0, v1 };
  }
  let { u, v, u0, u1, v0, v1 } = best;
  if (u1 - u0 < v1 - v0) [u, v, u0, u1, v0, v1] = [v, { x: -v.x, z: -v.z }, v0, v1, -u1, -u0];
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  const center = { x: u.x * cu + v.x * cv, z: u.z * cu + v.z * cv };
  const len = u1 - u0;
  const wid = v1 - v0;
  const corner = (su, sv) => ({ x: center.x + u.x * su * len / 2 + v.x * sv * wid / 2, z: center.z + u.z * su * len / 2 + v.z * sv * wid / 2 });
  return { center, u, v, len, wid, fill: area / Math.max(1e-6, len * wid), corners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] };
}

// Edges of a ring with the outward normal (checked against the polygon, whatever the winding).
function edgesOf(poly) {
  const ring = poly.outer;
  const out = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.5) continue;
    const d = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    let n = { x: d.z, z: -d.x };
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (pointInPolygon(off(mid, n, 0.3), poly)) n = { x: -n.x, z: -n.z };
    out.push({ a, b, len, d, n, mid });
  }
  return out;
}

function groundRange(ground, ring) {
  let low = Infinity;
  let high = -Infinity;
  for (const p of ring) {
    const g = ground(p.x, p.z);
    low = Math.min(low, g);
    high = Math.max(high, g);
  }
  return { low, high };
}

// ---------------------------------------------------------------- landmarks from tarkov.dev locations
function landmarks(mapData) {
  const out = [];
  for (const e of mapData.entities) {
    if (!String(e.id).startsWith('loc-') || !e.position) continue;
    out.push({ name: e.name, p: { x: -e.position.x, z: e.position.z } });
  }
  const find = (name) => out.filter((l) => l.name === name).map((l) => l.p);
  return { all: out, find };
}

// ---------------------------------------------------------------- buildings
export function buildBuildings(ctx, parts) {
  const { svg, ground, materials, anisotropy, mapData, csModels } = ctx;
  const { built, L, stats } = parts;
  const lm = landmarks(mapData);
  const near = (name, poly, c, r = 22) => lm.find(name).some((p) => pointInPolygon(p, poly) || dist(p, c) < r);
  const upper = { LEVEL2: svg.polygons('Buildings-2', { minArea: 2 }), LEVEL3: svg.polygons('Buildings-3', { minArea: 2 }) };
  const hasPlan = (id, poly) => upper[id].some((q) => pointInPolygon(centroid(q.outer), poly) || pointInPolygon(centroid(poly.outer), q));
  const facadeBuckets = new Map();
  const facade = (style) => {
    if (!facadeBuckets.has(style)) {
      facadeBuckets.set(style, new MeshBucket());
      if (!materials.facades[style]) materials.facades[style] = new THREE.MeshLambertMaterial({ map: customsFacade(style, anisotropy), side: THREE.DoubleSide });
    }
    return facadeBuckets.get(style);
  };
  const roofs = new MeshBucket();
  const frames = new MeshBucket();
  const tanks = [];
  const rb = rng(hashString('customs-buildings-v2'));
  const footprints = [];
  const doors = [];
  const layer = {
    container: L(built, 'container', csModels.container, 900),
    cabin: L(built, 'cabin', csModels.cabin, 700),
    garageDoor: L(built, 'garage-door', csModels.garageDoor, 380),
    rollerDoor: L(built, 'roller-door', ctx.icProps.dockDoor, 520),
    door: L(built, 'door', csModels.door, 300),
    porch: L(built, 'porch', csModels.porch, 360),
    chimney: L(built, 'chimney', csModels.chimney, 700),
    pipe: L(built, 'drainpipe', csModels.drainpipe, 260),
    roofVent: L(built, 'roof-vent', ctx.props.roofVent, 600),
    roofMachine: L(built, 'roof-machine', ctx.props.roofMachine, 600),
  };
  const nearTrailerPark = (c) => lm.find('Trailer Park').some((p) => dist(p, c) < 80);
  const nearSite = (c) => [...lm.find('Skeleton'), ...lm.find('Old Construction')].some((p) => dist(p, c) < 60);

  const KINDS = [['Garages-2', 'garage'], ['Big_Buildings-2', 'big'], ['Small_Buildings-2', 'small']];
  const circles = [...(svg.group('Big_Buildings-2') || { querySelectorAll: () => [] }).querySelectorAll('circle')].map((el) => ({
    c: svg.toScene({ x: Number(el.getAttribute('cx')), y: Number(el.getAttribute('cy')) }),
    r: Number(el.getAttribute('r')) * svg.unit,
  }));
  const allPolys = KINDS.flatMap(([gid]) => svg.polygons(gid, { minArea: 3 })).map((poly) => ({ poly, b: ringInfo(poly.outer).bounds }));
  for (const [gid, group] of KINDS) {
    for (const poly of svg.polygons(gid, { minArea: 3 })) {
      const info = ringInfo(poly.outer);
      const c = centroid(poly.outer);
      const box = obbOf(poly.outer);
      const { low, high } = groundRange(ground, poly.outer);
      const floorY = high + 0.15;
      const fp = { poly, bounds: info.bounds, floorY, eave: floorY + 3, kind: group, obb: box, center: c };
      footprints.push(fp);
      stats.buildings += 1;

      // fuel tanks: the SVG draws them as circles
      const circle = circles.find((q) => dist(q.c, c) < q.r * 0.5);
      if (circle) {
        const r = circle.r;
        tanks.push(tankGeometry(circle.c.x, low, circle.c.z, r, Math.min(12, 6 + r * 0.5)));
        fp.kind = 'tank';
        fp.eave = low + 12;
        stats.tanks = (stats.tanks || 0) + 1;
        continue;
      }
      // shipping containers and site cabins: container-sized small buildings
      if (group === 'small' && box.fill > 0.9 && box.wid > 2 && box.wid < 3.4 && box.len > 5.5 && box.len < 7.5) {
        const cabin = nearTrailerPark(c) || nearSite(c);
        const y = (low + high) / 2 - 0.05;
        if (cabin) layer.cabin.add(composeMatrix(box.center.x, y, box.center.z, alongX(box.u)), new THREE.Color(pick(rb, CABIN_COLORS)));
        else layer.container.add(composeMatrix(box.center.x, y, box.center.z, alongX(box.u)), new THREE.Color(pick(rb, CONTAINER_COLORS)));
        fp.kind = cabin ? 'cabin' : 'container';
        fp.eave = y + 2.6;
        stats[fp.kind === 'cabin' ? 'cabins' : 'shippingContainers'] = (stats[fp.kind === 'cabin' ? 'cabins' : 'shippingContainers'] || 0) + 1;
        continue;
      }
      if (group === 'small' && nearTrailerPark(c) && box.fill > 0.9 && box.wid < 7 && box.len > 9) {
        // long trailers of the trailer park
        const y = (low + high) / 2;
        layer.cabin.add(composeMatrix(box.center.x, y, box.center.z, alongX(box.u), box.len / 6, 1.1, box.wid / 2.4), new THREE.Color(pick(rb, CABIN_COLORS)));
        fp.kind = 'cabin';
        fp.eave = y + 3;
        continue;
      }

      const storeys = hasPlan('LEVEL3', poly) ? 3 : hasPlan('LEVEL2', poly) ? 2 : 1;
      const is = (name, r) => near(name, poly, c, r);
      let kind;
      let style;
      if (is('Skeleton', 10) || is('Old Construction', 10)) kind = 'frame';
      else if (group === 'garage') { kind = 'garage'; style = 'garage'; }
      else if (is('Big Red', 10)) { kind = 'warehouse'; style = 'corrugatedRed'; }
      else if (is('Dorms', 42)) { kind = 'dorm'; style = 'silicate'; }
      else if (is('Fortress', 10) || is('Stronghold', 10)) { kind = 'block'; style = 'panel'; }
      else if (is('Crackhouse', 12)) { kind = 'house'; style = 'redbrick'; }
      else if (is('New Gas Station', 25) || is('New Gas', 25) || is('Old Gas', 20)) { kind = 'block'; style = 'plaster'; }
      else if (group === 'big' && ((storeys === 1 && info.area > 700) || info.area > 1400)) { kind = 'warehouse'; style = pick(rb, ['corrugatedGrey', 'corrugatedGrey', 'corrugatedBlue', 'corrugatedGreen']); }
      else if (group === 'big') { kind = 'block'; style = storeys > 1 ? pick(rb, ['panel', 'silicate', 'redbrick']) : pick(rb, ['panel', 'redbrick', 'plaster']); }
      else if (box.fill > 0.9 && info.area < 60 && box.wid < 6.5) { kind = 'shed'; style = pick(rb, ['wood', 'plaster', 'garage']); }
      else { kind = 'house'; style = pick(rb, ['redbrick', 'plaster', 'plaster', 'wood']); }
      fp.kind = kind;
      stats.kinds = stats.kinds || {};
      stats.kinds[kind] = (stats.kinds[kind] || 0) + 1;

      if (kind === 'frame') {
        // unfinished concrete frame: slabs on a column grid, no walls
        const levels = Math.max(storeys, is('Skeleton', 10) ? 3 : 2);
        const H = 3.3;
        for (let k = 0; k <= levels; k += 1) {
          const y = floorY + k * H;
          slab(frames, poly, y, k === levels ? C.concreteDark : C.concrete);
          slab(frames, poly, y - 0.3, C.concreteLow, { down: true });
          ringWalls(frames, poly.outer, y - 0.3, y, C.concreteLow);
          // rebar stubs on the top slab
          if (k === levels) {
            for (const e of edgesOf(poly)) walkLine([e.a, e.b], 1.5, (p) => kbox(frames, p.x, y, p.z, 0.05, 0.8, 0.05, 0, C.roofRust), 0.75);
          }
        }
        for (let su = -box.len / 2 + 0.6; su <= box.len / 2 - 0.5; su += 6) {
          for (let sv = -box.wid / 2 + 0.6; sv <= box.wid / 2 - 0.5; sv += 6) {
            const p = { x: box.center.x + box.u.x * su + box.v.x * sv, z: box.center.z + box.u.z * su + box.v.z * sv };
            if (!pointInPolygon(p, poly)) continue;
            kbox(frames, p.x, low - 0.2, p.z, 0.5, floorY - low + levels * H + 0.2, 0.5, alongX(box.u), C.concrete, C.concreteDark);
          }
        }
        // ground floor walls only in part (the frame stands on a plinth)
        ringWalls(frames, poly.outer, low - 0.4, floorY, C.concreteLow, C.concrete);
        fp.eave = floorY + levels * H;
        continue;
      }

      let height;
      if (kind === 'garage') height = 2.8;
      else if (kind === 'warehouse') height = Math.max(storeys * 3.3 + 0.8, info.area > 1500 ? 9 : 7.5);
      else if (kind === 'shed') height = 2.8;
      else if (storeys > 1) height = storeys * 3.3 + 0.3;
      else if (group === 'big') height = info.area > 900 ? 7 : 5;
      else height = info.area > 150 ? 4.2 : 3.4;
      const eave = floorY + height;
      fp.eave = eave;
      facadeRing(facade(style), poly.outer, low - 0.4, eave, floorY);
      for (const hole of poly.holes) facadeRing(facade(style), hole, low - 0.4, eave, floorY);

      const pitched = poly.outer.length === 4 && !poly.holes.length && box.fill > 0.95;
      if (pitched && (kind === 'house' || kind === 'shed')) {
        gableRoof(roofs, poly.outer, eave, Math.min(2.4, 0.9 + box.wid * 0.18), pick(rb, [C.roofRust, C.roofGrey, C.roofDark, C.roofSlate]), C.gable);
        if (kind === 'house') {
          const k = (rb() - 0.5) * box.len * 0.5;
          const q = off(box.center, box.u, k);
          layer.chimney.add(composeMatrix(q.x, eave + 0.2, q.z, alongX(box.u)));
        }
        fp.eave = eave + 1.5;
      } else if (pitched && kind === 'warehouse') {
        gableRoof(roofs, poly.outer, eave, Math.min(2.2, box.wid * 0.08), pick(rb, [C.roofGrey, C.roofSlate, C.roofRust]), C.gable);
        fp.eave = eave + 1.5;
      } else {
        slab(roofs, poly, eave, kind === 'garage' ? C.roofTar : C.roofFlat);
        ringWalls(roofs, poly.outer, eave, eave + (kind === 'garage' ? 0.2 : 0.5), C.parapetLow, C.parapet);
        if (info.area > 250 && kind !== 'garage') {
          const n = Math.min(8, Math.round(info.area / 260));
          for (let k = 0; k < n; k += 1) {
            const p = { x: box.center.x + box.u.x * (rb() - 0.5) * box.len * 0.8 + box.v.x * (rb() - 0.5) * box.wid * 0.7, z: box.center.z + box.u.z * (rb() - 0.5) * box.len * 0.8 + box.v.z * (rb() - 0.5) * box.wid * 0.7 };
            if (pointInPolygon(p, poly)) (rb() < 0.7 ? layer.roofVent : layer.roofMachine).add(composeMatrix(p.x, eave, p.z, alongX(box.u)));
          }
        }
      }

      // drainpipes on the corners of storeyed buildings
      if (storeys > 1 || kind === 'block' || kind === 'dorm') {
        for (let i = 0; i < poly.outer.length; i += 1) {
          const p = poly.outer[i];
          const pv = poly.outer[(i + poly.outer.length - 1) % poly.outer.length];
          const nx = poly.outer[(i + 1) % poly.outer.length];
          const d1 = { x: p.x - pv.x, z: p.z - pv.z };
          const d2 = { x: nx.x - p.x, z: nx.z - p.z };
          const turn = Math.abs(Math.atan2(d1.x * d2.z - d1.z * d2.x, d1.x * d2.x + d1.z * d2.z));
          if (turn < 0.5) continue;
          const bis = { x: (p.x - c.x), z: (p.z - c.z) };
          const bl = Math.hypot(bis.x, bis.z) || 1;
          const q = { x: p.x + (bis.x / bl) * 0.15, z: p.z + (bis.z / bl) * 0.15 };
          layer.pipe.add(composeMatrix(q.x, low - 0.2, q.z, 0, 1, eave - low + 0.2, 1));
        }
      }

      // openings, facing the nearest road where there is a choice
      const edges = edgesOf(poly);
      const toRoad = (e) => {
        const hit = ctx.roadGrid.nearest(off(e.mid, e.n, 2), 120);
        return hit ? hit.d : 999;
      };
      const free = (p) => !allPolys.some((f) => p.x >= f.b.x0 - 1 && p.x <= f.b.x1 + 1 && p.z >= f.b.z0 - 1 && p.z <= f.b.z1 + 1 && pointInPolygon(p, f.poly));
      if (kind === 'garage') {
        // gates on the long sides that face open ground (both sides of a double row)
        for (const e of edges) {
          if (e.len < 7 || !free(off(e.mid, e.n, 3))) continue;
          const n = Math.floor(e.len / 3.3);
          const start = (e.len - n * 3.3) / 2 + 1.65;
          for (let k = 0; k < n; k += 1) {
            const p = off(off(e.a, e.d, start + k * 3.3), e.n, 0.04);
            layer.garageDoor.add(composeMatrix(p.x, floorY - 0.15, p.z, faceZ(e.n)), new THREE.Color(pick(rb, GARAGE_COLORS)));
            stats.garageGates = (stats.garageGates || 0) + 1;
          }
        }
        continue;
      }
      if (kind === 'warehouse') {
        // roller doors on the sides facing a yard or a road
        for (const e of edges) {
          if (e.len < 9) continue;
          const out = off(e.mid, e.n, 6);
          const yard = ctx.inYard(out) || toRoad(e) < 25;
          if (!yard || !free(out)) continue;
          const n = Math.min(3, Math.max(1, Math.floor(e.len / 16)));
          for (let k = 0; k < n; k += 1) {
            const s = ((k + 0.5) / n) * e.len;
            const p = off(off(e.a, e.d, s), e.n, 0.1);
            layer.rollerDoor.add(composeMatrix(p.x, floorY - 0.15, p.z, faceZ(e.n)));
            doors.push({ p: off(p, e.n, 1.5), n: e.n, kind: 'roller', fp });
          }
        }
        continue;
      }
      // entrance door(s) + porch on the side nearest to a road
      const ranked = edges.filter((e) => e.len > 2.2 && free(off(e.mid, e.n, 2))).sort((a, b) => toRoad(a) - toRoad(b));
      const entrances = kind === 'dorm' ? 2 : kind === 'block' ? 2 : 1;
      for (const e of ranked.slice(0, entrances)) {
        const p = off(e.mid, e.n, 0.08);
        layer.door.add(composeMatrix(p.x, floorY - 0.1, p.z, faceZ(e.n)));
        if (kind !== 'shed') layer.porch.add(composeMatrix(p.x, floorY - 0.4, p.z, faceZ(e.n)));
        doors.push({ p: off(p, e.n, 2), n: e.n, kind: 'door', fp });
      }
    }
  }
  for (const [style, bucket] of facadeBuckets) addMesh(built, bucket, materials.facades[style], `facades-${style}`);
  addMesh(built, roofs, materials.solid, 'roofs');
  addMesh(built, frames, materials.solid, 'concrete-frames');
  if (tanks.length) {
    const m = new THREE.Mesh(merge(tanks), materials.props);
    m.name = 'tanks';
    built.add(m);
  }
  return { footprints, doors };
}

// ---------------------------------------------------------------- roads, bridges, paths
// A line resampled every `step` m.
function densify(line, step) {
  const pts = [];
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k += 1) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  pts.push(line[line.length - 1]);
  return pts;
}

// Heights along a line: on the relief, bridged where the line is over water (linear between the dry banks).
function lineHeights(pts, ground, inWater, lift) {
  const ys = pts.map((p) => ground(p.x, p.z) + lift);
  const wet = pts.map((p) => inWater(p));
  const runs = [];
  for (let i = 0; i < pts.length; i += 1) {
    if (!wet[i]) continue;
    let j = i;
    while (j + 1 < pts.length && wet[j + 1]) j += 1;
    const a = Math.max(0, i - 1);
    const b = Math.min(pts.length - 1, j + 1);
    for (let k = i; k <= j; k += 1) ys[k] = ys[a] + ((ys[b] - ys[a]) * (k - a)) / Math.max(1, b - a) + 0.35;
    runs.push([a, b]);
    i = j;
  }
  return { ys, runs };
}

// A strip along dense points: bands = [[offset0, offset1, colorFn(i)]] across the line (meters, left negative).
function ribbon(bucket, pts, ys, bands, groundAt = null) {
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-3) continue;
    // miter-free: normals per segment are enough at 2 m resolution
    const n = { x: -(b.z - a.z) / len, z: (b.x - a.x) / len };
    for (const [o0, o1, col, drop] of bands) {
      const c = typeof col === 'function' ? col(i) : col;
      if (!c) continue;
      const outer = Math.abs(o0) > Math.abs(o1) ? o0 : o1;
      // shoulders: the outer edge goes down to the ground beside the road
      const yAt = (p, o, y) => (drop && groundAt && o === outer ? Math.min(y, groundAt(p.x + n.x * o, p.z + n.z * o) + 0.02) : y);
      const P = (p, o, y) => [p.x + n.x * o, yAt(p, o, y), p.z + n.z * o];
      bucket.quad(P(a, o0, ys[i]), P(b, o0, ys[i + 1]), P(b, o1, ys[i + 1]), P(a, o1, ys[i]), [0, 1, 0], c);
    }
  }
}

export function buildRoads(ctx, parts) {
  const { svg, ground, materials, props, csModels } = ctx;
  const { propsGroup, L, stats, inWater } = parts;
  const surface = new MeshBucket();
  const deck = new MeshBucket();
  const rr = rng(hashString('customs-roads'));
  const shade = (base, k) => base.clone().multiplyScalar(k);
  const pothole = L(propsGroup, 'pothole', props.pothole, 260);
  const crack = L(propsGroup, 'crack', props.crack, 220);
  const railing = L(propsGroup, 'bridge-railing', csModels.railing, 500);
  const LIFT = { Main_Roads: 0.07, High_Roads: 0.065, Roads: 0.06, Dirt_Roads: 0.045 };
  stats.bridges = 0;
  for (const id of ['Main_Roads', 'High_Roads', 'Roads', 'Dirt_Roads']) {
    for (const s of svg.strokes(id)) {
      for (const line of s.lines) {
        const pts = densify(line, 2);
        if (pts.length < 2) continue;
        const { ys, runs } = lineHeights(pts, ground, inWater, LIFT[id]);
        const h = s.width / 2;
        if (id === 'Dirt_Roads') {
          const tint = pts.map(() => 0.9 + rr() * 0.2);
          ribbon(surface, pts, ys, [
            [-h - 0.5, -h, (i) => shade(C.dirtGrass, tint[i]), true],
            [-h, -1.05, (i) => shade(C.dirt, tint[i])],
            [-1.05, -0.5, (i) => shade(C.rut, tint[i])],
            [-0.5, 0.5, (i) => shade(C.dirtGrass, tint[i])],
            [0.5, 1.05, (i) => shade(C.rut, tint[i])],
            [1.05, h, (i) => shade(C.dirt, tint[i])],
            [h, h + 0.5, (i) => shade(C.dirtGrass, tint[i]), true],
          ], ground);
        } else {
          // asphalt in patches of different wear, gravel shoulders, a worn dashed centre line on the wide roads
          const tint = [];
          let cur = 1;
          for (let i = 0; i < pts.length; i += 1) {
            if (i % 6 === 0) cur = rr() < 0.25 ? 1.12 : 0.94 + rr() * 0.1;
            tint.push(cur);
          }
          ribbon(surface, pts, ys, [
            [-h - 0.9, -h, (i) => shade(C.shoulder, tint[i]), true],
            [-h, h, (i) => shade(C.asphalt, tint[i])],
            [h, h + 0.9, (i) => shade(C.shoulder, tint[i]), true],
          ], ground);
          if (id !== 'Roads') {
            const lineYs = ys.map((y) => y + 0.01);
            ribbon(surface, pts, lineYs, [[-0.07, 0.07, (i) => (i % 3 === 0 && rr() < 0.8 ? C.line : null)]]);
          }
          walkLine(line, 11, (p, dir) => {
            const q = off(p, { x: -dir.z, z: dir.x }, (rr() - 0.5) * s.width * 0.7);
            if (inWater(q)) return;
            const y = ground(q.x, q.z) + LIFT[id] + 0.005;
            if (rr() < 0.35) pothole.add(composeMatrix(q.x, y, q.z, rr() * Math.PI, 0.7 + rr() * 0.6, 1, 0.7 + rr() * 0.6));
            else if (rr() < 0.6) crack.add(composeMatrix(q.x, y, q.z, alongX(dir) + (rr() - 0.5), 1 + rr(), 1, 1));
          }, 5);
        }
        // bridges: deck edge, railings, piers
        for (const [a, b] of runs) {
          stats.bridges += 1;
          for (let i = a; i < b; i += 1) {
            const p = pts[i];
            const q = pts[i + 1];
            const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
            const n = { x: -(q.z - p.z) / len, z: (q.x - p.x) / len };
            for (const side of [-1, 1]) {
              const e0 = off(p, n, side * (h + 0.3));
              const e1 = off(q, n, side * (h + 0.3));
              deck.quad([e0.x, ys[i] - 0.7, e0.z], [e1.x, ys[i + 1] - 0.7, e1.z], [e1.x, ys[i + 1], e1.z], [e0.x, ys[i], e0.z], [n.x * side, 0, n.z * side], C.deckSide);
              railing.add(composeMatrix((e0.x + e1.x) / 2, (ys[i] + ys[i + 1]) / 2, (e0.z + e1.z) / 2, alongX({ x: (q.x - p.x) / len, z: (q.z - p.z) / len }), len / 2, 1, 1));
            }
            deck.quad([p.x - n.x * h, ys[i] - 0.7, p.z - n.z * h], [p.x + n.x * h, ys[i] - 0.7, p.z + n.z * h], [q.x + n.x * h, ys[i + 1] - 0.7, q.z + n.z * h], [q.x - n.x * h, ys[i + 1] - 0.7, q.z - n.z * h], [0, -1, 0], C.deckSide);
            if ((i - a) % 4 === 2) {
              const bed = ground(p.x, p.z);
              kbox(deck, p.x, bed - 0.5, p.z, 1.0, ys[i] - 0.7 - bed + 0.5, s.width * 0.8, alongX({ x: (q.x - p.x) / len, z: (q.z - p.z) / len }), C.deckSide, C.deck);
            }
          }
        }
      }
    }
  }
  const mesh = addMesh(propsGroup, surface, materials.road, 'roads');
  if (mesh) mesh.renderOrder = 1;
  addMesh(propsGroup, deck, materials.solid, 'bridges');
}

// Trodden paths from doors (and extracts) to the nearest road or track; a gentle bend; skipped if a building is in the way.
export function buildPaths(ctx, parts, doors) {
  const { ground, materials, mapData } = ctx;
  const { propsGroup, stats, inWater, inFootprint } = parts;
  const bucket = new MeshBucket();
  const rp = rng(hashString('customs-paths'));
  const starts = doors.filter((d) => d.kind === 'door').map((d) => d.p);
  for (const e of mapData.entities) {
    if ((e.type === 'extract' || e.type === 'transit') && e.floor === 'OUTSIDE' && e.position) starts.push({ x: -e.position.x, z: e.position.z });
  }
  let n = 0;
  for (const s of starts) {
    const hit = ctx.roadGrid.nearest(s, 70);
    if (!hit) continue;
    const { a, b } = hit.seg;
    const t = Math.max(0, Math.min(1, hit.t));
    const e = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    const len = dist(s, e);
    if (len < hit.seg.width / 2 + 3) continue;
    const dir = { x: (e.x - s.x) / len, z: (e.z - s.z) / len };
    const bend = (rp() - 0.5) * 0.35 * len;
    const ctrl = off(off(s, dir, len / 2), { x: -dir.z, z: dir.x }, bend);
    const pts = [];
    const steps = Math.max(2, Math.ceil(len / 1.5));
    let blocked = false;
    for (let k = 0; k <= steps; k += 1) {
      const u = k / steps;
      const p = { x: (1 - u) * (1 - u) * s.x + 2 * (1 - u) * u * ctrl.x + u * u * e.x, z: (1 - u) * (1 - u) * s.z + 2 * (1 - u) * u * ctrl.z + u * u * e.z };
      if (k > 1 && k < steps && (inFootprint(p) || inWater(p))) { blocked = true; break; }
      pts.push(p);
    }
    if (blocked) continue;
    const ys = pts.map((p) => ground(p.x, p.z) + 0.035);
    const w = 0.5 + rp() * 0.25;
    ribbon(bucket, pts, ys, [[-w - 0.25, -w, C.path2], [-w, w, (i) => (i % 5 === 0 ? C.path2 : C.path)], [w, w + 0.25, C.path2]]);
    n += 1;
  }
  stats.paths = n;
  addMesh(propsGroup, bucket, materials.road, 'paths');
}

// ---------------------------------------------------------------- fences
// Kind per fence line (approximate): corrugated sheets near garages and cabins, wooden planks near houses, concrete
// panels on long lines and around industrial buildings, chain-link elsewhere. Gaps where roads and tracks pass.
export function buildFences(ctx, parts, footprints) {
  const { svg, ground, materials, props, csModels } = ctx;
  const { propsGroup, L, stats, onRoad } = parts;
  const rf = rng(hashString('customs-fences'));
  const lay = {
    concrete: L(propsGroup, 'fence-concrete', props.fenceConcrete, 700),
    wood: L(propsGroup, 'fence-wood', csModels.fenceWood, 420),
    sheet: L(propsGroup, 'fence-sheet', csModels.fenceSheet, 520),
    chainPost: L(propsGroup, 'fence-chain-post', csModels.chainPost, 420),
    chainNet: L(propsGroup, 'fence-chain-net', ctx.chainPanel, 320, materials.chain),
  };
  const nearKind = (p, kinds, r) => footprints.some((f) => kinds.includes(f.kind) && dist(p, f.center) < r + Math.max(f.obb.len, f.obb.wid) / 2);
  stats.fenceKinds = {};
  for (const s of svg.strokes('Fence')) {
    for (const line of s.lines) {
      let total = 0;
      for (let i = 0; i < line.length - 1; i += 1) total += dist(line[i], line[i + 1]);
      const mid = line[Math.floor(line.length / 2)];
      let kind;
      if (nearKind(mid, ['garage', 'cabin'], 25)) kind = 'sheet';
      else if (total < 140 && nearKind(mid, ['house', 'shed'], 30)) kind = 'wood';
      else if (total > 220 || nearKind(mid, ['warehouse', 'block', 'tank', 'frame'], 35)) kind = 'concrete';
      else kind = 'chain';
      stats.fenceKinds[kind] = (stats.fenceKinds[kind] || 0) + 1;
      const tint = kind === 'sheet' ? new THREE.Color(pick(rf, SHEET_COLORS)) : null;
      walkLine(line, 2.5, (p, dir) => {
        if (onRoad(p, 0.6)) return; // gate / gap
        if (rf() < 0.03) return; // a missing panel
        const y = ground(p.x, p.z) - 0.05;
        const rot = alongX(dir);
        const lean = rf() < 0.08 ? (rf() - 0.5) * 0.25 : 0;
        const m = composeMatrix(p.x, y, p.z, rot, 1, 1, 1, lean);
        if (kind === 'concrete') lay.concrete.add(m);
        else if (kind === 'wood') lay.wood.add(m);
        else if (kind === 'sheet') lay.sheet.add(m, tint);
        else { lay.chainPost.add(m); lay.chainNet.add(m); }
        stats.fences += 1;
      });
    }
  }
}

// ---------------------------------------------------------------- yards
// Parked cars on paved yards, trucks at roller doors, container stacks at the edges of big yards, clutter along walls.
export function buildYards(ctx, parts, footprints, doors, placements) {
  const { svg, ground, csModels, icProps, props } = ctx;
  const { propsGroup, L, stats, inFootprint, onRoad, inWater } = parts;
  const ry = rng(hashString('customs-yards'));
  const container = L(propsGroup, 'yard-container', csModels.container, 900);
  const lay = {
    pallet: L(propsGroup, 'yard-pallet', icProps.pallet, 260),
    crate: L(propsGroup, 'yard-crate', icProps.crate, 240),
    barrel: L(propsGroup, 'yard-barrel', csModels.barrel, 260),
    tires: L(propsGroup, 'yard-tires', csModels.tires, 240),
    scrap: L(propsGroup, 'yard-scrap', csModels.scrap, 300),
    logs: L(propsGroup, 'yard-logs', csModels.logs, 300),
    trash: L(propsGroup, 'yard-trash', props.trash, 300),
    fbs: L(propsGroup, 'yard-blocks', csModels.fbs, 400),
    trailer: L(propsGroup, 'yard-semitrailer', icProps.trailer, 900),
  };
  const clear = (p, r = 2) => !inFootprint(p) && !onRoad(p, 1) && !inWater(p)
    && [0, 1.57, 3.14, 4.71].every((a) => !inFootprint({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }));
  stats.parked = 0;
  stats.yardContainers = 0;
  stats.clutter = 0;
  const yards = svg.polygons('Pavement', { minArea: 150 });
  for (const yard of yards) {
    const info = ringInfo(yard.outer);
    const edges = edgesOf(yard);
    // parked cars nose-in along the longest edges
    const byLen = [...edges].sort((a, b) => b.len - a.len).slice(0, info.area > 2500 ? 2 : 1);
    for (const e of byLen) {
      walkLine([e.a, e.b], 3.0, (p) => {
        if (ry() > 0.32) return;
        const q = off(p, e.n, -3.2); // inward
        if (!pointInPolygon(q, yard) || !clear(q, 2.4)) return;
        placements.push({ x: q.x, y: ground(q.x, q.z), z: q.z, heading: alongX(e.n) + (ry() - 0.5) * 0.3, model: pick(ry, ['sedan', 'sedan', 'hatch', 'suv', 'van']), paint: pick(ry, ['#5a4636', '#4d4a45', '#a9adb0', '#1f3558', '#6b1c21', '#e8e6df', '#3e5a3a', '#c9b98f']) });
        stats.parked += 1;
      }, 4);
    }
    // container stacks at the edges of big yards
    if (info.area > 1200) {
      for (const e of edges) {
        if (e.len < 14) continue;
        walkLine([e.a, e.b], 7.5, (p) => {
          if (ry() > 0.2) return;
          const q = off(p, e.n, -2.2);
          if (!pointInPolygon(q, yard) || !clear(q, 3.4)) return;
          const y = ground(q.x, q.z) - 0.05;
          const rot = alongX(e.d);
          container.add(composeMatrix(q.x, y, q.z, rot), new THREE.Color(pick(ry, CONTAINER_COLORS)));
          stats.yardContainers += 1;
          if (ry() < 0.3) {
            container.add(composeMatrix(q.x, y + 2.59, q.z, rot + (ry() - 0.5) * 0.08), new THREE.Color(pick(ry, CONTAINER_COLORS)));
            stats.yardContainers += 1;
          }
        }, 5);
      }
    }
  }
  // trucks backed up to some roller doors, semi-trailers left in the yards
  for (const d of doors) {
    if (d.kind !== 'roller' || ry() > 0.4) continue;
    const q = off(d.p, d.n, 4.5);
    if (!clear(q, 3)) continue;
    if (ry() < 0.6) placements.push({ x: q.x, y: ground(q.x, q.z), z: q.z, heading: alongX(d.n), model: 'truck', paint: pick(ry, ['#3e5a3a', '#5a4636', '#1f3558', '#6b6f6a']) });
    else lay.trailer.add(composeMatrix(q.x + d.n.x * 2, ground(q.x, q.z), q.z + d.n.z * 2, alongX(d.n) + Math.PI));
    stats.trucks = (stats.trucks || 0) + 1;
  }
  // clutter along the walls of warehouses, garages, frames and houses
  const kinds = { warehouse: 0.35, garage: 0.25, frame: 0.5, house: 0.2, block: 0.2, container: 0.3, cabin: 0.4, shed: 0.3 };
  for (const f of footprints) {
    const pr = kinds[f.kind];
    if (!pr) continue;
    for (const e of edgesOf(f.poly)) {
      walkLine([e.a, e.b], 4.5, (p) => {
        if (ry() > pr) return;
        const q = off(off(p, e.n, 1.2 + ry() * 1.5), e.d, (ry() - 0.5) * 2);
        if (!clear(q, 0.9)) return;
        const y = ground(q.x, q.z) - 0.02;
        const rot = ry() * Math.PI * 2;
        const roll = ry();
        if (f.kind === 'frame') (roll < 0.5 ? lay.fbs : roll < 0.8 ? lay.pallet : lay.logs).add(composeMatrix(q.x, y, q.z, alongX(e.d) + (ry() - 0.5) * 0.4));
        else if (f.kind === 'house' || f.kind === 'shed') (roll < 0.4 ? lay.logs : roll < 0.7 ? lay.barrel : lay.trash).add(composeMatrix(q.x, y, q.z, rot), roll >= 0.4 && roll < 0.7 ? new THREE.Color(pick(ry, BARREL_COLORS)) : null);
        else if (roll < 0.28) lay.pallet.add(composeMatrix(q.x, y, q.z, rot));
        else if (roll < 0.5) lay.barrel.add(composeMatrix(q.x, y, q.z, rot), new THREE.Color(pick(ry, BARREL_COLORS)));
        else if (roll < 0.65) lay.tires.add(composeMatrix(q.x, y, q.z, rot));
        else if (roll < 0.8) lay.crate.add(composeMatrix(q.x, y, q.z, rot));
        else if (roll < 0.9) lay.scrap.add(composeMatrix(q.x, y, q.z, rot));
        else lay.trash.add(composeMatrix(q.x, y, q.z, alongX(e.d)));
        stats.clutter += 1;
      }, 2);
    }
  }
}

// ---------------------------------------------------------------- landmarks: fuel canopies, bus stop
export function buildLandmarks(ctx, parts, placements) {
  const { ground, materials, mapData, csModels, props } = ctx;
  const { propsGroup, L, stats, inFootprint } = parts;
  const lm = landmarks(mapData);
  const pumps = L(propsGroup, 'fuel-pump', csModels.pump, 300);
  const stop = L(propsGroup, 'bus-stop', props.busStop, 500);
  const geos = [];
  const roadDir = (p) => {
    const hit = ctx.roadGrid.nearest(p, 60);
    if (!hit) return null;
    const { a, b } = hit.seg;
    const len = dist(a, b) || 1;
    const d = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    const t = Math.max(0, Math.min(1, hit.t));
    return { d, q: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, width: hit.seg.width };
  };
  stats.canopies = 0;
  for (const name of ['New Gas Station', 'Old Gas']) {
    for (const p0 of lm.find(name)) {
      const r = roadDir(p0);
      if (!r) continue;
      // canopy between the station and the road, parallel to the road
      let n = { x: p0.x - r.q.x, z: p0.z - r.q.z };
      const nl = Math.hypot(n.x, n.z) || 1;
      n = { x: n.x / nl, z: n.z / nl };
      // as close to the station as it fits without touching a building (all corners free)
      const fits = (q) => [[-7.5, -5], [7.5, -5], [7.5, 5], [-7.5, 5], [0, 0]].every(([u, v]) => !inFootprint(off(off(q, r.d, u), n, v)));
      let c = off(r.q, n, r.width / 2 + 6);
      for (let k = 0; k < 12; k += 1) {
        const q = off(r.q, n, r.width / 2 + 6 + k * 1.5);
        if (fits(q)) c = q;
        else break;
      }
      const y = ground(c.x, c.z);
      const g = canopyGeometry(14, 9, 5.2);
      g.rotateY(alongX(r.d));
      g.translate(c.x, y, c.z);
      geos.push(g);
      for (const k of [-4, 0, 4]) {
        const q = off(c, r.d, k);
        pumps.add(composeMatrix(q.x, y + 0.25, q.z, alongX(r.d)));
      }
      stats.canopies += 1;
    }
  }
  for (const p0 of lm.find('Bus Station')) {
    const r = roadDir(p0);
    if (!r) continue;
    let n = { x: p0.x - r.q.x, z: p0.z - r.q.z };
    const nl = Math.hypot(n.x, n.z) || 1;
    n = { x: n.x / nl, z: n.z / nl };
    const q = off(r.q, n, r.width / 2 + 2.2);
    stop.add(composeMatrix(q.x, ground(q.x, q.z), q.z, faceZ({ x: -n.x, z: -n.z })));
    const b = off(off(r.q, n, r.width / 2 - 1.6), r.d, 9);
    placements.push({ x: b.x, y: ground(b.x, b.z), z: b.z, heading: alongX(r.d), model: 'bus', paint: '#8a7a55' });
  }
  if (geos.length) {
    const m = new THREE.Mesh(merge(geos), materials.props);
    m.name = 'fuel-canopies';
    propsGroup.add(m);
  }
}

// ---------------------------------------------------------------- tall grass
export function buildGrass(ctx, parts) {
  const { ground, terrain, csModels, projection } = ctx;
  const { vegGroup, L, stats, inWater, inFootprint, onRoad } = parts;
  const grass = L(vegGroup, 'grass', csModels.grass, 170);
  const rg = rng(hashString('customs-grass'));
  // only on the playable land (SVG Ground), not on the dark area beyond the map border
  const land = ctx.svg.polygons('Ground', { minArea: 100 });
  const onLand = (p) => land.some((q) => pointInPolygon(p, q));
  let n = 0;
  for (let tries = 0; tries < 90000 && n < 36000; tries += 1) {
    const p = { x: projection.sceneLeft + rg() * projection.width, z: projection.sceneTop + rg() * projection.depth };
    if (terrain.roughAt(p.x, p.z) < 0.35 || inWater(p) || inFootprint(p) || onRoad(p, 1) || !onLand(p)) continue;
    const k = 1.0 + rg() * 1.1;
    // clumps: a few tufts together
    for (let j = 0; j < 4; j += 1) {
      const q = { x: p.x + (rg() - 0.5) * 3, z: p.z + (rg() - 0.5) * 3 };
      grass.add(composeMatrix(q.x, ground(q.x, q.z) - 0.05, q.z, rg() * Math.PI * 2, k, k * (0.7 + rg() * 0.8), k), new THREE.Color(pick(rg, GRASS_COLORS)));
      n += 1;
    }
  }
  stats.grass = n;
}
