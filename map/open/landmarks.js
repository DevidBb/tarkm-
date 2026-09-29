// Recognisable landmarks of the open maps, placed where the SVG plan and the tarkov.dev labels put them: round
// structures (clarifiers of the Lighthouse water treatment plant, tanks and silos elsewhere), the radar dome on
// Reserve's Dome, Reserve's armoured train at the station, the lighthouse on Lightkeeper Island and the aircraft wreck
// of the Woods crash site. Positions come from the plan; the shapes are simplified models of what stands there in
// the game, sized from the drawn outline.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { mergeGeometries } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js/+esm';
import { paint } from '../city/models.js';
import { ringInfo } from '../interchange/icKit.js';
import { pointInRing, rng, hashString } from '../city/util.js';
import { strokesOf } from '../shoreline/slBuild.js';

const at = (g, x, y, z, ry = 0) => {
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
};
const cyl = (rt, rb, h, seg, color, open = false) => paint(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(0, h / 2, 0), color);
const boxG = (w, h, d, color) => paint(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), color);

// Label of the map data by English name (tarkov.dev labels), in scene coordinates.
function label(mapData, re) {
  const e = mapData.entities.find((x) => x.type === 'place' && re.test(x.name || ''));
  return e ? { x: -e.position.x, z: e.position.z } : null;
}

function circularity(ring) {
  const { area, perimeter } = ringInfo(ring);
  return perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
}

// ---------------------------------------------------------------- round structures
export function roundBuildingHook(ctx, geos) {
  const wtp = label(ctx.mapData, /^Water Treatment$/);
  return (poly, { ground, footprints }) => {
    const info = ringInfo(poly.outer);
    if (info.area < 40 || info.area > 9000 || circularity(poly.outer) < 0.86) return false;
    const r = Math.sqrt(info.area / Math.PI);
    const c = info.center;
    const y = ground(c.x, c.z);
    const clarifier = wtp && Math.hypot(c.x - wtp.x, c.z - wtp.z) < 260 && r > 7;
    if (clarifier) {
      // Open settling basin: concrete ring wall, dark water, centre column and a rotating bridge with railing.
      geos.push(at(cyl(r, r, 2.6, 48, '#a8a49a', true), c.x, y - 0.4, c.z));
      geos.push(at(cyl(r - 0.35, r - 0.35, 2.6, 48, '#8e8a80', true), c.x, y - 0.4, c.z));
      geos.push(at(paint(new THREE.RingGeometry(r - 0.4, r + 0.05, 48).rotateX(-Math.PI / 2), '#bdb8ac'), c.x, y + 2.21, c.z));
      geos.push(at(paint(new THREE.CircleGeometry(r - 0.35, 48).rotateX(-Math.PI / 2), '#3d5147'), c.x, y + 1.6, c.z));
      geos.push(at(cyl(1.4, 1.6, 3.2, 16, '#9c988e'), c.x, y - 0.4, c.z));
      const ang = (c.x * 7.3 + c.z * 3.1) % Math.PI;
      geos.push(at(boxG(r, 0.35, 1.2, '#5f6a70').translate(r / 2, 0, 0), c.x, y + 2.8, c.z, ang));
      geos.push(at(boxG(r, 1.0, 0.06, '#c9a33a').translate(r / 2, 0, 0.6), c.x, y + 3.1, c.z, ang));
    } else {
      // Storage tank / silo: steel drum with a low cone roof and a ladder.
      const h = Math.min(18, Math.max(5, r * 1.3));
      const col = r > 9 ? '#b9bab4' : '#8f9a8a';
      geos.push(at(cyl(r, r, h, 36, col), c.x, y - 0.3, c.z));
      geos.push(at(cyl(0.6, r + 0.1, Math.max(0.8, r * 0.18), 36, '#8a8c86'), c.x, y - 0.3 + h, c.z));
      geos.push(at(boxG(0.5, h, 0.12, '#5a5d58').translate(0, 0, r + 0.08), c.x, y - 0.3, c.z, (c.x + c.z) % 6));
    }
    footprints.push({ poly, bounds: info.bounds });
    return true;
  };
}

// ---------------------------------------------------------------- per map
function reserveDome(ctx, geos) {
  const p = label(ctx.mapData, /^Dome$/);
  if (!p) return 0;
  const near = ctx.builtBuildings
    .map((b) => ({ b, d: pointInRing(p, b.poly.outer) ? 0 : Math.hypot(b.center.x - p.x, b.center.z - p.z) }))
    .sort((a, b) => a.d - b.d)[0];
  if (!near || near.d > 45) return 0;
  const { b } = near;
  const r = Math.min(13, Math.max(6, Math.sqrt(b.area) / 3.2));
  const top = b.eave + 0.4;
  // Radar dome: a white hemisphere on a drum, with a mast next to it.
  geos.push(at(cyl(r * 0.92, r * 0.92, 2.2, 40, '#d6d6d0'), b.center.x, top, b.center.z));
  geos.push(at(paint(new THREE.SphereGeometry(r, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), '#eeeeea'), b.center.x, top + 2.2, b.center.z));
  geos.push(at(cyl(0.18, 0.28, r * 1.6, 8, '#6d6f6e'), b.center.x + r * 1.1, top, b.center.z));
  return 1;
}

// ---------------------------------------------------------------- shared helpers
// Walks a polyline by arc length: point and unit direction at distance s.
function walker(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i += 1) cum.push(cum[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z));
  const length = cum[cum.length - 1];
  const at = (s) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i += 1;
    const a = line[i - 1];
    const b = line[i];
    const l = cum[i] - cum[i - 1] || 1e-9;
    const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / l));
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dir: { x: (b.x - a.x) / l, z: (b.z - a.z) / l } };
  };
  return { length, at };
}

// Places a train of cars (lengths in meters, 1.5 m couplings) on the railway track nearest to `p` where no car
// stands in a building or on water; each car follows the track's bends. Returns the car poses or null.
function trainOnTrack(ctx, outside, p, lengths, maxDist = 150) {
  const total = lengths.reduce((a, b) => a + b + 1.5, 0);
  let best = null;
  for (const s of strokesOf(ctx, 'railroad')) {
    for (const line of s.lines) {
      const w = walker(line);
      if (w.length < total + 2) continue;
      for (let s0 = 1; s0 + total < w.length; s0 += 3) {
        const mid = w.at(s0 + total / 2);
        const d = Math.hypot(mid.x - p.x, mid.z - p.z);
        if (d > maxDist || (best && d >= best.d)) continue;
        const poses = [];
        let u = s0;
        let ok = true;
        for (const len of lengths) {
          const c = w.at(u + len / 2);
          const ends = [w.at(u + 0.5), w.at(u + len - 0.5), c];
          if (ends.some((q) => outside.inFootprint(q) || outside.inWater(q))) { ok = false; break; }
          const a = w.at(u);
          const b = w.at(u + len);
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const l = Math.hypot(dx, dz) || 1;
          poses.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, dir: { x: dx / l, z: dz / l }, len });
          u += len + 1.5;
        }
        if (ok) best = { d, poses };
      }
    }
  }
  return best && best.poses;
}

// Free spots on open ground around `p` (not in buildings, water or on roads), at least `gap` apart.
function freeSpots(outside, p, radius, n, gap, r, road = 1.5, ground = null) {
  const out = [];
  const steep = (q) => ground && Math.max(Math.abs(ground(q.x + 2.5, q.z) - ground(q.x - 2.5, q.z)), Math.abs(ground(q.x, q.z + 2.5) - ground(q.x, q.z - 2.5))) > 1.4;
  for (let k = 0; k < n * 60 && out.length < n; k += 1) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * radius;
    const q = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d };
    if (outside.inFootprint(q) || outside.inWater(q) || outside.onRoad(q, road) || steep(q)) continue;
    if (out.some((o) => Math.hypot(o.x - q.x, o.z - q.z) < gap)) continue;
    out.push(q);
  }
  return out;
}

const yawOf = (dir) => Math.atan2(-dir.z, dir.x); // local +X along dir

// ---------------------------------------------------------------- vehicles and props
function railCar(kind, len) {
  const parts = [boxG(len, 1.1, 2.6, '#2b2d2a')]; // chassis and bogies
  if (kind === 'loco') {
    parts.push(boxG(len - 0.4, 3.2, 3.0, '#3f4a36').translate(0, 1.1, 0));
    parts.push(boxG(len * 0.3, 1.2, 2.8, '#374130').translate(-len * 0.3, 4.3, 0));
  } else if (kind === 'gun') {
    parts.push(boxG(len - 0.4, 2.6, 3.0, '#3f4a36').translate(0, 1.1, 0));
    parts.push(cyl(1.1, 1.3, 1.1, 16, '#343d2d').translate(0, 3.7, 0));
    parts.push(paint(new THREE.CylinderGeometry(0.16, 0.16, 5, 8).rotateZ(Math.PI / 2).translate(2.5, 4.3, 0), '#262a24'));
  } else if (kind === 'armour') {
    parts.push(boxG(len - 0.4, 2.6, 3.0, '#3f4a36').translate(0, 1.1, 0));
    for (const x of [-len * 0.3, 0, len * 0.3]) parts.push(boxG(0.8, 0.25, 0.05, '#1b1d1a').translate(x, 2.6, 1.52));
  } else if (kind === 'tank') {
    parts.push(paint(new THREE.CylinderGeometry(1.35, 1.35, len - 1.2, 20).rotateZ(Math.PI / 2).translate(0, 2.55, 0), '#2e302e'));
    parts.push(cyl(0.5, 0.5, 0.5, 12, '#2a2b2a').translate(0, 3.8, 0));
  } else if (kind === 'flat') {
    parts.push(boxG(len - 0.4, 0.3, 2.8, '#4a4038').translate(0, 1.1, 0));
  } else {
    const col = ['#6b3a2c', '#5b4a3c', '#4b5a5c', '#7a4a2e'][Math.floor(len * 13) % 4];
    parts.push(boxG(len - 0.4, 2.9, 2.9, col).translate(0, 1.1, 0));
    parts.push(boxG(2.2, 2.2, 0.05, '#2e2a26').translate(0, 1.4, 1.46));
  }
  return parts;
}

// Military truck (Ural-like) or eight-wheeled APC, burnt or in paint. Local +X is forward.
function militaryVehicle(kind, burnt) {
  const body = burnt ? '#3a2f28' : '#4d5a3a';
  const dark = burnt ? '#231d19' : '#2a2d27';
  const wheels = (xs, r = 0.55) => xs.flatMap((x) => [1, -1].map((side) => paint(new THREE.CylinderGeometry(r, r, 0.4, 10).rotateX(Math.PI / 2).translate(x, r, side * 1.15), '#1a1a18')));
  if (kind === 'btr') {
    return [
      ...wheels([-2.6, -0.9, 0.9, 2.6], 0.6),
      paint(new THREE.BoxGeometry(7.4, 1.4, 2.8).translate(0, 1.55, 0), body),
      paint(new THREE.BoxGeometry(1.6, 0.8, 2.6).translate(3.2, 1.05, 0), body),
      cyl(0.55, 0.65, 0.5, 12, dark).translate(0.8, 2.25, 0),
      paint(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6).rotateZ(Math.PI / 2).translate(2.0, 2.55, 0), '#1c1c1a'),
    ];
  }
  return [
    ...wheels([-2.4, -1.1, 2.3], 0.58),
    paint(new THREE.BoxGeometry(7.2, 0.5, 2.3).translate(-0.2, 1.1, 0), dark),
    paint(new THREE.BoxGeometry(2.0, 1.7, 2.4).translate(2.4, 2.1, 0), body),
    paint(new THREE.BoxGeometry(1.0, 0.8, 2.2).translate(3.7, 1.7, 0), body),
    paint(new THREE.BoxGeometry(4.4, 0.9, 2.45).translate(-1.3, 1.8, 0), body),
    burnt ? paint(new THREE.BoxGeometry(4.3, 0.12, 2.3).translate(-1.3, 2.3, 0), dark)
      : paint(new THREE.BoxGeometry(4.4, 1.6, 2.5).translate(-1.3, 3.05, 0), '#5d6448'),
  ];
}

function tent(len, wid, h, color) {
  // Army tent: a ridge prism on a low wall, entrance flap in front.
  const shape = new THREE.Shape();
  shape.moveTo(-wid / 2, 0);
  shape.lineTo(-wid / 2, h * 0.35);
  shape.lineTo(0, h);
  shape.lineTo(wid / 2, h * 0.35);
  shape.lineTo(wid / 2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false }).translate(0, 0, -len / 2).rotateY(Math.PI / 2);
  return [paint(g, color), paint(new THREE.BoxGeometry(0.05, h * 0.6, wid * 0.35).translate(len / 2 + 0.03, h * 0.3, 0), '#2b2a22')];
}

function logPile(len, cols, rowsN) {
  const out = [];
  const r = 0.28;
  for (let row = 0; row < rowsN; row += 1) {
    const n = cols - row;
    for (let k = 0; k < n; k += 1) {
      const z = (k - (n - 1) / 2) * r * 2.05;
      out.push(paint(new THREE.CylinderGeometry(r, r, len, 8).rotateZ(Math.PI / 2).translate(0, r + row * r * 1.75, z), k % 3 ? '#7a5a3c' : '#8a6a48'));
    }
  }
  for (const x of [-len / 2 + 0.02, len / 2 - 0.02]) out.push(paint(new THREE.BoxGeometry(0.04, rowsN * r * 1.75, cols * r * 2).translate(x, rowsN * r * 0.9, 0), '#c9b28a'));
  return out;
}

// ---------------------------------------------------------------- Reserve
function armouredTrain(ctx, geos, outside) {
  const p = label(ctx.mapData, /^Train Station$/);
  if (!p) return 0;
  const kinds = ['loco', 'gun', 'armour', 'gun', 'armour'];
  const poses = trainOnTrack(ctx, outside, p, [15, 13, 13, 13, 13]);
  if (!poses) return 0;
  poses.forEach((c, k) => {
    const y = ctx.ground(c.x, c.z) + 0.35;
    for (const g of railCar(kinds[k], c.len)) geos.push(at(g, c.x, y, c.z, yawOf(c.dir)));
  });
  return 1;
}

// The helicopter standing on Reserve's parade ground, drawn in the plan as one silhouette (#Chopper).
function helicopter(ctx, geos) {
  const polys = ctx.svg.polygons('Chopper', { minArea: 1 });
  if (!polys.length) return 0;
  // The silhouette's mass lies along the fuselage (blades are thin): area-weighted principal axis from a point grid.
  const pts = [];
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const q of polys.flatMap((poly) => poly.outer)) {
    x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z);
  }
  for (let x = x0; x <= x1; x += 0.4) {
    for (let z = z0; z <= z1; z += 0.4) {
      const q = { x, z };
      if (polys.some((poly) => pointInRing(q, poly.outer))) pts.push(q);
    }
  }
  if (pts.length < 20) return 0;
  const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length;
  const cz = pts.reduce((a, q) => a + q.z, 0) / pts.length;
  let sxx = 0; let szz = 0; let sxz = 0;
  for (const q of pts) {
    sxx += (q.x - cx) ** 2; szz += (q.z - cz) ** 2; sxz += (q.x - cx) * (q.z - cz);
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let u = { x: Math.cos(ang), z: Math.sin(ang) };
  // The nose is the heavy end: the thin tail boom reaches further from the centre of mass.
  let umin = Infinity; let umax = -Infinity;
  for (const q of pts) {
    const a = (q.x - cx) * u.x + (q.z - cz) * u.z;
    umin = Math.min(umin, a); umax = Math.max(umax, a);
  }
  if (umax > -umin) {
    u = { x: -u.x, z: -u.z };
    [umin, umax] = [-umax, -umin];
  }
  const L = umax - umin; // nose to tail tip
  const k = Math.max(0.6, Math.min(1.4, L / 25));
  const hub = { x: cx + u.x * umax * 0.1, z: cz + u.z * umax * 0.1 };
  const y = ctx.ground(hub.x, hub.z);
  const olive = '#56603f';
  const parts = [
    paint(new THREE.CylinderGeometry(1.25, 1.2, 9, 14).rotateZ(Math.PI / 2).translate(1.0, 2.0, 0), olive), // cabin
    paint(new THREE.SphereGeometry(1.25, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2).scale(1.4, 1, 1).translate(5.5, 2.0, 0), olive),
    paint(new THREE.BoxGeometry(1.2, 0.6, 1.9).translate(5.6, 2.55, 0), '#6c8790'), // cockpit glazing
    paint(new THREE.BoxGeometry(5.2, 1.0, 1.9).translate(1.4, 3.45, 0), '#4c5537'), // engines
    cyl(0.25, 0.3, 0.8, 8, '#2c2e2a').translate(1.2, 3.9, 0),
    paint(new THREE.CylinderGeometry(0.34, 0.62, 9.5, 10).rotateZ(Math.PI / 2).translate(-8.2, 2.5, 0), olive), // tail boom
    paint(new THREE.BoxGeometry(1.8, 2.4, 0.2).translate(-12.6, 3.3, 0).rotateZ(0), '#4c5537'),
    paint(new THREE.BoxGeometry(1.6, 0.12, 3.0).translate(-11.8, 2.6, 0), '#4c5537'),
    ...[-2.2, 2.6].flatMap((x) => [1, -1].map((side) => paint(new THREE.CylinderGeometry(0.28, 0.28, 0.3, 10).rotateX(Math.PI / 2).translate(x, 0.3, side * 1.3), '#1a1a18'))),
    ...[1, -1].map((side) => paint(new THREE.CylinderGeometry(0.45, 0.45, 3.2, 10).rotateZ(Math.PI / 2).translate(0.4, 1.3, side * 1.55), '#4a5236')), // fuel tanks
  ];
  // Main rotor, five drooping blades; tail rotor on the fin.
  for (let b = 0; b < 5; b += 1) {
    const a = (b / 5) * Math.PI * 2 + 0.3;
    parts.push(paint(new THREE.BoxGeometry(10.5, 0.08, 0.5).translate(5.25, 0, 0).rotateZ(-0.05).rotateY(a).translate(1.2, 4.35, 0), '#2a2c28'));
  }
  for (let b = 0; b < 3; b += 1) parts.push(paint(new THREE.BoxGeometry(0.3, 3.0, 0.05).rotateZ((b / 3) * Math.PI).translate(-12.8, 3.8, 0.2), '#2a2c28'));
  const ry = yawOf(u);
  for (const g of parts) {
    g.scale(k, k, k);
    geos.push(at(g, hub.x, y, hub.z, ry));
  }
  return 1;
}

// ---------------------------------------------------------------- Woods
// The convoy: a column of wrecked military trucks and APCs on the road by the Convoy label, some still burning.
function convoy(ctx, geos, outside) {
  const p = label(ctx.mapData, /^Convoy$/);
  if (!p) return 0;
  let best = null;
  for (const s of [...strokesOf(ctx, 'roads'), ...strokesOf(ctx, 'roadsUnpaved')]) {
    for (const line of s.lines) {
      const w = walker(line);
      for (let t = 0; t <= w.length; t += 2) {
        const q = w.at(t);
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (!best || d < best.d) best = { d, w, t };
      }
    }
  }
  if (!best || best.d > 120) return 0;
  const r = rng(hashString(`${ctx.mapData.map.id}:convoy`));
  const kinds = ['btr', 'truck', 'truck', 'btr', 'truck', 'truck', 'truck'];
  let n = 0;
  kinds.forEach((kind, k) => {
    const t = best.t + (k - 3) * 11;
    if (t < 0 || t > best.w.length) return;
    const q = best.w.at(t);
    const side = (r() - 0.5) * 2.4;
    const x = q.x - q.dir.z * side;
    const z = q.z + q.dir.x * side;
    const burnt = r() < 0.75;
    const ry = yawOf(q.dir) + (r() - 0.5) * 0.5 + (r() < 0.2 ? Math.PI : 0);
    for (const g of militaryVehicle(kind, burnt)) geos.push(at(g, x, ctx.ground(x, z), z, ry));
    if (ctx.fx && burnt && r() < 0.45) ctx.fx.fire(x, ctx.ground(x, z) + 1.4, z, { size: 1.2, smoke: 12 });
    n += 1;
  });
  return n;
}

// Stacks of logs around the sawmills and the lumber yard.
function lumber(ctx, geos, outside) {
  let n = 0;
  const r = rng(hashString(`${ctx.mapData.map.id}:lumber`));
  for (const [re, count, radius] of [[/^Lumber$/, 9, 40], [/^Sawmill$/, 6, 55], [/^Old Sawmill$/, 5, 40]]) {
    const p = label(ctx.mapData, re);
    if (!p) continue;
    for (const q of freeSpots(outside, p, radius, count, 9, r, 1.5, ctx.ground)) {
      const len = 5 + r() * 3;
      const ry = r() * Math.PI;
      for (const g of logPile(len, 5 + Math.floor(r() * 3), 3 + Math.floor(r() * 2))) geos.push(at(g, q.x, ctx.ground(q.x, q.z) - 0.05, q.z, ry));
      n += 1;
    }
  }
  return n;
}

// Camps: army tents around a fire pit, with the forest cleared around them.
function camps(ctx, geos, outside) {
  let n = 0;
  const r = rng(hashString(`${ctx.mapData.map.id}:camps`));
  const list = [[/^USEC Camp$/, 5, '#7a7c52'], [/^Military Camp$/, 6, '#6f7550'], [/^Jaeger's Camp$/, 1, '#6b6f48'], [/^Scav Town$/, 2, '#7d7560']];
  for (const [re, count, color] of list) {
    const p = label(ctx.mapData, re);
    if (!p) continue;
    const spots = freeSpots(outside, p, 40, count, 8, r, 1.5, ctx.ground);
    for (const q of spots) {
      const big = r() < 0.5;
      const ry = Math.atan2(-(p.z - q.z), p.x - q.x) + (r() - 0.5) * 0.4; // entrance toward the camp centre
      for (const g of tent(big ? 6 : 4, big ? 4.6 : 3.2, big ? 2.9 : 2.2, color)) geos.push(at(g, q.x, ctx.ground(q.x, q.z) - 0.05, q.z, ry));
      if (ctx.noTrees) ctx.noTrees.push({ x: q.x, z: q.z, r: 5 });
      n += 1;
    }
    if (spots.length && ctx.fx) {
      const c = spots.reduce((a, q) => ({ x: a.x + q.x / spots.length, z: a.z + q.z / spots.length }), { x: 0, z: 0 });
      const [f] = freeSpots(outside, c, 6, 1, 1, r, 0.5);
      if (f) ctx.fx.fire(f.x, ctx.ground(f.x, f.z) + 0.3, f.z, { size: 0.6, smoke: 6, dark: 0.5 });
    }
    if (ctx.noTrees) ctx.noTrees.push({ x: p.x, z: p.z, r: 14 });
  }
  return n;
}

// ---------------------------------------------------------------- Lighthouse
// Freight cars standing on the sidings of the train yard.
function freightYard(ctx, geos, outside) {
  const p = label(ctx.mapData, /^Train Yard$/);
  if (!p) return 0;
  const r = rng(hashString(`${ctx.mapData.map.id}:freight`));
  const kinds = ['box', 'tank', 'tank', 'box', 'flat', 'box'];
  const poses = trainOnTrack(ctx, outside, p, kinds.map((k) => (k === 'tank' ? 11 : 13)), 200);
  if (!poses) return 0;
  poses.forEach((c, k) => {
    if (r() < 0.15) return;
    const y = ctx.ground(c.x, c.z) + 0.35;
    for (const g of railCar(kinds[k], c.len + r() * 0.01)) geos.push(at(g, c.x, y, c.z, yawOf(c.dir)));
  });
  return poses.length;
}

function lighthouseTower(ctx, geos) {
  const p = label(ctx.mapData, /^Lightkeeper Island$/);
  if (!p) return 0;
  const y = ctx.ground(p.x, p.z);
  // Tapered white tower with red bands, gallery, lantern room and a red cap; the keeper's house at its foot.
  geos.push(at(cyl(4.2, 4.6, 2.2, 8, '#8d8a82'), p.x, y - 0.5, p.z));
  const H = 26;
  const bands = 6;
  for (let k = 0; k < bands; k += 1) {
    const h0 = 1.7 + (H / bands) * k;
    const r0 = 3.2 - (1.1 * k) / bands;
    const r1 = 3.2 - (1.1 * (k + 1)) / bands;
    geos.push(at(cyl(r1, r0, H / bands, 20, k % 2 ? '#b8322a' : '#f1eee6'), p.x, y + h0, p.z));
  }
  geos.push(at(cyl(2.9, 2.9, 0.35, 20, '#3a3c3a'), p.x, y + H + 1.7, p.z));
  geos.push(at(cyl(1.6, 1.6, 2.4, 16, '#f6e39a'), p.x, y + H + 2.05, p.z));
  geos.push(at(cyl(0.2, 2.0, 1.6, 16, '#b8322a'), p.x, y + H + 4.45, p.z));
  geos.push(at(boxG(8, 3.2, 6, '#e8e2d2'), p.x + 9, ctx.ground(p.x + 9, p.z + 4) - 0.2, p.z + 4));
  geos.push(at(paint(new THREE.ConeGeometry(6.2, 2.4, 4).rotateY(Math.PI / 4).scale(1.05, 1, 0.78).translate(0, 1.2, 0), '#6e3a2e'), p.x + 9, ctx.ground(p.x + 9, p.z + 4) + 3, p.z + 4));
  ctx.lighthouseLamp = { x: p.x, y: y + H + 3.2, z: p.z };
  return 1;
}

function planeWreck(ctx, geos) {
  const polys = ctx.svg.polygons('Plane', { minArea: 2 });
  if (!polys.length) return 0;
  const pts = polys.flatMap((q) => q.outer);
  const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
  const cz = pts.reduce((s, q) => s + q.z, 0) / pts.length;
  // Main axis of the drawn wreck (principal component of its outline points).
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (const q of pts) {
    sxx += (q.x - cx) ** 2;
    szz += (q.z - cz) ** 2;
    sxz += (q.x - cx) * (q.z - cz);
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const u = { x: Math.cos(ang), z: Math.sin(ang) };
  const v = { x: -u.z, z: u.x };
  let umin = Infinity;
  let umax = -Infinity;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const q of pts) {
    const a = (q.x - cx) * u.x + (q.z - cz) * u.z;
    const b = (q.x - cx) * v.x + (q.z - cz) * v.z;
    umin = Math.min(umin, a); umax = Math.max(umax, a); vmin = Math.min(vmin, b); vmax = Math.max(vmax, b);
  }
  const L = Math.max(12, umax - umin);
  const span = Math.max(10, vmax - vmin);
  const ry = Math.atan2(-u.z, u.x);
  const R = Math.min(2.8, Math.max(1.6, L * 0.055));
  const put = (g, along, across, lift = 0, turn = 0) => {
    const x = cx + u.x * along + v.x * across;
    const z = cz + u.z * along + v.z * across;
    if (turn) g.rotateY(turn);
    geos.push(at(g, x, ctx.ground(x, z) + lift, z, ry));
  };
  const hull = (len, color) => paint(new THREE.CylinderGeometry(R, R, len, 16).rotateZ(Math.PI / 2).translate(0, R * 0.8, 0), color);
  // The fuselage broke in two; wings lie across the middle, the tail rests at the back.
  put(hull(L * 0.48, '#a9aca8'), umin + L * 0.26, 0, -0.4);
  put(hull(L * 0.36, '#8f928e'), umax - L * 0.2, 0.8, -0.5, 0.2);
  put(paint(new THREE.SphereGeometry(R, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2).translate(0, R * 0.8, 0), '#9a9d99'), umin + 0.4, 0, -0.4);
  put(boxG(L * 0.16, 0.35, span * 0.95, '#b4b7b3'), umin + L * 0.45, 0, 0.3);
  put(boxG(L * 0.12, span * 0.12, 0.3, '#9c9f9b'), umax - 2, 0.8, R * 1.4);
  put(boxG(L * 0.1, 0.25, span * 0.35, '#9c9f9b'), umax - 2, 0.8, R * 0.9);
  for (const k of [-0.32, -0.16, 0.16, 0.32]) {
    put(paint(new THREE.CylinderGeometry(0.7, 0.8, 3.2, 12).rotateZ(Math.PI / 2).translate(0, 0.8, 0), '#5c5f5b'), umin + L * 0.43, span * k, -0.2);
  }
  put(boxG(L * 0.3, 0.05, span * 0.5, '#2c2a26'), umin + L * 0.45, 0, 0.02); // scorched ground
  // The crash cut a clearing through the forest.
  if (ctx.noTrees) ctx.noTrees.push({ x: cx, z: cz, r: L * 0.7 + 18 });
  if (ctx.fx) {
    ctx.fx.fire(cx + u.x * (umin + L * 0.45), ctx.ground(cx, cz) + 1.2, cz + u.z * (umin + L * 0.45), { size: 1.4, smoke: 14 });
  }
  return 1;
}

export function buildLandmarks(ctx, outside) {
  const geos = ctx.landmarkGeos;
  const id = ctx.mapData.map.id;
  const stats = {};
  if (id === 'reserve') {
    stats.dome = reserveDome(ctx, geos);
    stats.train = armouredTrain(ctx, geos, outside);
    stats.helicopter = helicopter(ctx, geos);
  }
  if (id === 'lighthouse') {
    stats.lighthouse = lighthouseTower(ctx, geos);
    stats.freight = freightYard(ctx, geos, outside);
  }
  if (id === 'woods') {
    stats.plane = planeWreck(ctx, geos);
    stats.convoy = convoy(ctx, geos, outside);
    stats.logs = lumber(ctx, geos, outside);
    stats.tents = camps(ctx, geos, outside);
  }
  if (geos.length) {
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), ctx.materials.solid);
    mesh.name = 'landmarks';
    outside.group.add(mesh);
  }
  stats.parts = geos.length;
  return stats;
}
