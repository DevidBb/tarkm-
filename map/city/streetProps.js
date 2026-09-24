// Street furniture along the real road geometry of the SVG map: curbs on every road edge, centerline markings,
// crosswalks at signalled corners, street lamps with overhead wires, traffic lights and road signs at block
// corners, storm drains, manholes, potholes and cracks, trash containers, urns, bollards, billboards.
// Data-backed pieces: SVG fences and trees, bus shelters at BTR stops, sandbag nests at stationary weapons,
// warning signs and barriers at minefields, checkpoint barriers at checkpoint extracts, the sewer manhole.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { InstancedLayer, composeMatrix } from './instancing.js';
import { adAtlas } from './textures.js';
import { rng, hashString, pick, clamp, centroid } from './util.js';

const alongX = (dir) => Math.atan2(-dir.z, dir.x); // model +X along dir
const faceZ = (d) => Math.atan2(d.x, d.z); // model +Z toward d

const ADS = [
  { text: 'TERRAGROUP', sub: 'БУДУЩЕЕ СЕГОДНЯ', bg: '#1d2b3a', bg2: '#0e151d', fg: '#e9e2c8' },
  { text: 'LEXOS', sub: 'АВТОСАЛОН', bg: '#d9d9d2', bg2: '#9ea2a3', fg: '#1d1d1d' },
  { text: 'TARBANK', sub: 'ВКЛАДЫ · КРЕДИТЫ', bg: '#1c2a44', bg2: '#101826', fg: '#e8c36a' },
  { text: 'СПАРЖА', sub: 'ВСЁ ДЛЯ ДОМА', bg: '#c62828', bg2: '#7f1717', fg: '#ffffff' },
  { text: 'ШЕСТЁРОЧКА', sub: 'РЯДОМ С ДОМОМ', bg: '#d32f2f', bg2: '#2e7d32', fg: '#ffffff' },
  { text: 'ГОШАН', sub: 'ГИПЕРМАРКЕТ', bg: '#e53935', bg2: '#b71c1c', fg: '#ffffff' },
];

export function buildStreetProps(city, environment, { parent, clippingPlanes, props, propMaterial, anisotropy }) {
  const { base, roads } = city;
  const env = environment || {};
  const layers = {};
  const L = (name, geometry, maxDistance) => { layers[name] = new InstancedLayer(parent, { name, geometry, material: propMaterial, maxDistance }); };
  L('curb', props.curb, 520); L('marking', props.marking, 480); L('stripe', props.stripe, 420);
  L('lamp', props.lamp, 750); L('trafficLight', props.trafficLight, 520);
  L('signNoEntry', props.signNoEntry, 360); L('signParking', props.signParking, 360); L('signWarning', props.signWarning, 360); L('signMines', props.signMines, 420);
  L('busStop', props.busStop, 700); L('trash', props.trash, 320); L('urn', props.urn, 240); L('bollard', props.bollard, 240);
  L('manhole', props.manhole, 260); L('drain', props.drain, 220); L('pothole', props.pothole, 320); L('crack', props.crack, 260);
  L('billboard', props.billboardFrame, 900); L('fenceConcrete', props.fenceConcrete, 650); L('fenceMetal', props.fenceMetal, 650);
  L('treeTrunk', props.treeTrunk, 900); L('treeCrown', props.treeCrown, 1400);
  L('sandbags', props.sandbags, 600); L('gun', props.gun, 400); L('fbsBlock', props.fbsBlock, 600); L('jersey', props.jersey, 600); L('barrier', props.barrier, 700);

  const insideBuilding = (p, margin = 0.8) => Boolean(city.buildingGrid.nearest(p, margin));
  const levelY = (y) => (y == null || y < 8 ? base : y - 0.05); // street level is flattened to the ground plane
  const corners = roads.corners;
  const nearCorner = (p, radius) => corners.some((c) => Math.hypot(c.p.x - p.x, c.p.z - p.z) < radius);

  // ---- curbs, drains, lamps, trash, urns along every road edge
  const wires = [];
  let prevLamp = null;
  for (const e of roads.edges) {
    const r = rng(hashString(`edge:${e.a.x.toFixed(1)}:${e.a.z.toFixed(1)}`));
    if (e.len >= 0.4) {
      layers.curb.add(composeMatrix((e.a.x + e.b.x) / 2 + e.out.x * 0.15, base, (e.a.z + e.b.z) / 2 + e.out.z * 0.15, alongX(e.dir), e.len + 0.1, 1, 1));
    }
    const wide = e.width == null || e.width >= 8;
    if (e.len >= 10 && wide) {
      for (let s = 6 + r() * 6; s < e.len - 4; s += 26 + r() * 6) {
        const p = { x: e.a.x + e.dir.x * s + e.out.x * 1.3, z: e.a.z + e.dir.z * s + e.out.z * 1.3 };
        if (insideBuilding(p) || nearCorner(p, 7)) continue;
        layers.lamp.add(composeMatrix(p.x, base, p.z, Math.atan2(e.out.z, -e.out.x)));
        const top = { x: p.x, y: base + 8.05, z: p.z };
        if (prevLamp && Math.hypot(prevLamp.x - top.x, prevLamp.z - top.z) < 36) wires.push([prevLamp, top]);
        prevLamp = top;
        if (r() < 0.25) {
          const u = { x: p.x + e.dir.x * 1.2, z: p.z + e.dir.z * 1.2 };
          layers.urn.add(composeMatrix(u.x, base, u.z));
        }
      }
    } else {
      prevLamp = null;
    }
    if (e.len >= 12 && (e.width == null || e.width >= 7)) {
      for (let s = 8 + r() * 10; s < e.len - 4; s += 28) {
        layers.drain.add(composeMatrix(e.a.x + e.dir.x * s - e.out.x * 0.4, base + 0.005, e.a.z + e.dir.z * s - e.out.z * 0.4, alongX(e.dir)));
      }
    }
    if (e.len >= 40 && wide && r() < 0.14) {
      const s = 10 + r() * (e.len - 20);
      const n = 2 + Math.floor(r() * 2);
      for (let k = 0; k < n; k += 1) {
        const p = { x: e.a.x + e.dir.x * (s + k * 1.6) + e.out.x * 3.2, z: e.a.z + e.dir.z * (s + k * 1.6) + e.out.z * 3.2 };
        if (insideBuilding(p, 1)) break;
        layers.trash.add(composeMatrix(p.x, base, p.z, faceZ({ x: -e.out.x, z: -e.out.z }) + (r() - 0.5) * 0.2), new THREE.Color(pick(r, ['#3a5a3f', '#2b4b6e', '#6b6d6a', '#2f5f5a'])));
      }
    }
  }

  // ---- centerline: markings, manholes, potholes, cracks
  const markCells = new Set();
  for (const c of roads.center) {
    const key = `${Math.round(c.x / 5)},${Math.round(c.z / 5)}`;
    if (markCells.has(key)) continue;
    markCells.add(key);
    const r = rng(hashString(`c:${key}`));
    const perp = { x: -c.dir.z, z: c.dir.x };
    if (!nearCorner(c, 10)) {
      if (c.width >= 12) {
        for (const side of [-0.18, 0.18]) layers.marking.add(composeMatrix(c.x + perp.x * side, base + 0.01, c.z + perp.z * side, alongX(c.dir), 5.2, 1, 1));
      } else if (c.width >= 7) {
        layers.marking.add(composeMatrix(c.x, base + 0.01, c.z, alongX(c.dir), 3, 1, 1));
      }
    }
    const lateral = (r() - 0.5) * c.width * 0.6;
    const q = { x: c.x + perp.x * lateral, z: c.z + perp.z * lateral };
    const roll = r();
    if (roll < 0.05) layers.pothole.add(composeMatrix(q.x, base + 0.012, q.z, r() * Math.PI * 2, 0.7 + r() * 0.7, 1, 0.7 + r() * 0.7));
    else if (roll < 0.14) layers.crack.add(composeMatrix(q.x, base + 0.012, q.z, r() * Math.PI * 2));
    else if (roll < 0.2) layers.manhole.add(composeMatrix(c.x + perp.x * 1.4, base + 0.01, c.z + perp.z * 1.4));
  }
  for (const m of env.manholes || []) {
    const p = city.game2(m.position);
    layers.manhole.add(composeMatrix(p.x, levelY(m.position.y) + 0.01, p.z));
  }

  // ---- corners: traffic lights + crosswalks at wide intersections, signs and bollards elsewhere
  let lights = 0;
  let zebras = 0;
  for (const cn of corners) {
    const r = rng(hashString(`corner:${cn.p.x.toFixed(1)}:${cn.p.z.toFixed(1)}`));
    const near = roads.grid.near(cn.p, 2);
    const wide = near.length && near.every((e) => e.width == null || e.width >= 9);
    const p = { x: cn.p.x + cn.out.x * 1.3, z: cn.p.z + cn.out.z * 1.3 };
    if (insideBuilding(p, 0.6)) continue;
    if (wide && lights < 90) {
      lights += 1;
      layers.trafficLight.add(composeMatrix(p.x, base, p.z, alongX(cn.dirs[0])));
      for (const d of cn.dirs) {
        if (zebras >= 60 || r() < 0.35) continue;
        const c = roads.center.find((s) => Math.hypot(s.x - cn.p.x, s.z - cn.p.z) < 16 && Math.abs(s.dir.x * d.x + s.dir.z * d.z) > 0.9);
        if (!c) continue;
        zebras += 1;
        const across = { x: -c.dir.z, z: c.dir.x };
        for (let k = 0.6; k < c.width - 0.4; k += 1.1) {
          const off = k - c.width / 2;
          layers.stripe.add(composeMatrix(c.x + across.x * off, base + 0.011, c.z + across.z * off, faceZ(c.dir), 1, 1, 3.6));
        }
      }
    } else if (r() < 0.45) {
      const sign = pick(r, ['signNoEntry', 'signParking', 'signWarning', 'signParking']);
      const d = cn.dirs[0];
      layers[sign].add(composeMatrix(p.x + d.x * 1.5, base, p.z + d.z * 1.5, Math.atan2(d.z, -d.x)));
    } else if (r() < 0.5) {
      for (const d of cn.dirs) {
        for (let k = 0; k < 4; k += 1) {
          const q = { x: cn.p.x + cn.out.x * 0.5 - d.x * (2 + k * 1.6), z: cn.p.z + cn.out.z * 0.5 - d.z * (2 + k * 1.6) };
          if (!insideBuilding(q, 0.4)) layers.bollard.add(composeMatrix(q.x, base, q.z));
        }
      }
    }
  }

  // ---- billboards at wide corners
  const billboards = [];
  for (const cn of corners) {
    if (billboards.length >= 12) break;
    const r = rng(hashString(`bb:${cn.p.x.toFixed(1)}:${cn.p.z.toFixed(1)}`));
    const near = roads.grid.near(cn.p, 2);
    if (!near.length || !near.every((e) => e.width == null || e.width >= 13) || r() > 0.3) continue;
    const p = { x: cn.p.x + cn.out.x * 5, z: cn.p.z + cn.out.z * 5 };
    if (insideBuilding(p, 3.5) || billboards.some((b) => Math.hypot(b.p.x - p.x, b.p.z - p.z) < 60)) continue;
    const angle = Math.atan2(cn.out.z, -cn.out.x);
    layers.billboard.add(composeMatrix(p.x, base, p.z, angle));
    billboards.push({ p, angle, ad: billboards.length % ADS.length });
  }
  const billboardMesh = buildBillboardFaces(billboards, base, { parent, clippingPlanes, anisotropy });

  // ---- data: BTR stops -> bus shelters
  for (const stop of env.btrStops || []) {
    const p0 = city.game2(stop.position);
    const hit = roads.grid.nearest(p0, 25);
    if (!hit) continue;
    const e = hit.seg;
    const s = hit.t * e.len;
    const p = { x: e.a.x + e.dir.x * s + e.out.x * 2.3, z: e.a.z + e.dir.z * s + e.out.z * 2.3 };
    layers.busStop.add(composeMatrix(p.x, base, p.z, faceZ({ x: -e.out.x, z: -e.out.z })));
    layers.urn.add(composeMatrix(p.x + e.dir.x * 3, base, p.z + e.dir.z * 3));
  }

  // ---- data: fences from the SVG
  for (const line of city.fences) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const a = line[i];
      const b = line[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.3) continue;
      const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      const near = city.buildingGrid.nearest(a, 30);
      const metal = near && ['construction', 'industrial', 'garage'].includes(near.seg.building.kind);
      const pieces = Math.max(1, Math.round(len / 2.5));
      const pl = len / pieces;
      for (let k = 0; k < pieces; k += 1) {
        const s = (k + 0.5) * pl;
        layers[metal ? 'fenceMetal' : 'fenceConcrete'].add(composeMatrix(a.x + dir.x * s, base, a.z + dir.z * s, alongX(dir), pl / 2.5, 1, 1));
      }
    }
  }

  // ---- data: trees from the SVG
  for (const t of city.trees) {
    const r = rng(hashString(`tree:${t.x.toFixed(1)}:${t.z.toFixed(1)}`));
    const k = clamp(t.r / 1.6, 0.55, 1.7);
    const angle = r() * Math.PI * 2;
    layers.treeTrunk.add(composeMatrix(t.x, base, t.z, angle, k, k, k));
    layers.treeCrown.add(composeMatrix(t.x, base, t.z, angle, k, k * (0.85 + r() * 0.3), k), new THREE.Color(pick(r, ['#4f6a3a', '#5b7442', '#6d7d45', '#465f35', '#7a8450', '#8a8a4a'])));
  }

  // ---- data: stationary weapons -> sandbag nests
  for (const w of env.emplacements || []) {
    const p = city.game2(w.position);
    const y = levelY(w.position.y);
    const hit = roads.grid.nearest(p, 40);
    const angle = hit ? Math.atan2(hit.seg.out.z, -hit.seg.out.x) : 0;
    layers.sandbags.add(composeMatrix(p.x, y, p.z, angle + Math.PI));
    layers.gun.add(composeMatrix(p.x, y, p.z, angle));
  }

  // ---- data: minefields -> warning sign + barrier
  for (const mf of env.minefields || []) {
    const pts = (mf.outline || []).map((q) => city.game2(q));
    if (pts.length < 2) continue;
    const y = levelY(mf.position.y);
    const c = centroid(pts);
    let best = null;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (!best || len > best.len) best = { a, b, len };
    }
    const dir = { x: (best.b.x - best.a.x) / (best.len || 1), z: (best.b.z - best.a.z) / (best.len || 1) };
    const mid = { x: (best.a.x + best.b.x) / 2, z: (best.a.z + best.b.z) / 2 };
    let out = { x: mid.x - c.x, z: mid.z - c.z };
    const ol = Math.hypot(out.x, out.z) || 1;
    out = { x: out.x / ol, z: out.z / ol };
    layers.signMines.add(composeMatrix(mid.x + out.x * 1.2, y, mid.z + out.z * 1.2, Math.atan2(-out.z, out.x)));
    layers.jersey.add(composeMatrix(mid.x + out.x * 0.7 + dir.x * 2, y, mid.z + out.z * 0.7 + dir.z * 2, faceZ(dir)));
  }

  // ---- data: checkpoint extracts -> barrier, blocks
  for (const cp of env.checkpoints || []) {
    const p = city.game2(cp.position);
    const y = levelY(cp.position.y);
    const hit = roads.grid.nearest(p, 40);
    const out = hit ? hit.seg.out : { x: 0, z: 1 };
    const dir = hit ? hit.seg.dir : { x: 1, z: 0 };
    layers.barrier.add(composeMatrix(p.x, y, p.z, Math.atan2(out.z, -out.x)));
    for (let k = -2; k <= 2; k += 1) {
      layers.fbsBlock.add(composeMatrix(p.x + dir.x * (8 + k * 2.6) - out.x * (k % 2) * 1.2, y, p.z + dir.z * (8 + k * 2.6) - out.z * (k % 2) * 1.2, alongX(dir)));
    }
  }

  let wireMesh = null;
  if (wires.length) {
    const pos = [];
    for (const [a, b] of wires) {
      const steps = 4;
      for (let i = 0; i < steps; i += 1) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const sag = (t) => -1.1 * 4 * t * (1 - t);
        pos.push(a.x + (b.x - a.x) * t0, a.y + sag(t0), a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, a.y + sag(t1), a.z + (b.z - a.z) * t1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wireMesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x202220, transparent: true, opacity: 0.8, clippingPlanes }));
    wireMesh.matrixAutoUpdate = false;
    parent.add(wireMesh);
  }

  for (const l of Object.values(layers)) l.build();
  const counts = Object.fromEntries(Object.entries(layers).map(([k, l]) => [k, l.cells.reduce((s, c) => s + c.mesh.count, 0)]));
  return { layers: Object.values(layers), wires: wireMesh, billboards: billboardMesh, counts };
}

function buildBillboardFaces(billboards, base, { parent, clippingPlanes, anisotropy }) {
  if (!billboards.length) return null;
  const { texture, cells } = adAtlas(ADS, anisotropy);
  const pos = [];
  const uv = [];
  const nor = [];
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (const b of billboards) {
    m.copy(composeMatrix(b.p.x, base, b.p.z, b.angle));
    const cell = cells[b.ad];
    const n = new THREE.Vector3(1, 0, 0).transformDirection(m);
    for (const side of [1, -1]) {
      const x = 0.12 * side;
      const corners = [[x, 4.55, 3.1 * side], [x, 4.55, -3.1 * side], [x, 7.55, -3.1 * side], [x, 7.55, 3.1 * side]];
      const uvs = [[cell.u0, cell.v0], [cell.u1, cell.v0], [cell.u1, cell.v1], [cell.u0, cell.v1]];
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        v.set(...corners[idx]).applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
        uv.push(...uvs[idx]);
        nor.push(n.x * side, 0, n.z * side);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide, clippingPlanes }));
  mesh.matrixAutoUpdate = false;
  parent.add(mesh);
  return mesh;
}
