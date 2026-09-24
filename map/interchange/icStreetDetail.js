// Street detail of Interchange, placed on the real geometry of the SVG map and the tarkov.dev data:
// - roads (SVG Normal_Roads / Highways): dashed centre lines, double yellow line and edge lines on the highway,
//   curbs and sidewalks along the roads next to the mall, signs at junctions, roadblocks where a road leaves the map;
// - parking lots (SVG Outdoors): stall lines, parked cars in the stalls, lamps in the aisles;
// - loot containers (crates, weapon boxes, toolboxes, buried barrels, ground caches...) at their spawn points, doors at
//   the key locks — on every level (floorProps);
// - dumpsters at the foot of the truck ramps, concrete blocks at "Highway Construction", freight wagons on the track
//   by the railway extract;
// - forest and bushes on open land (the land layer of the SVG, away from roads, pavement, rocks and buildings),
//   thicker towards the edges of the map.
// Approximate (no open data): stall layout, which stalls are taken, sidewalk width, sign types, tree positions,
// wagons and construction blocks.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { MeshBucket, strip, ringInfo, color } from './icKit.js';
import { InstancedLayer, composeMatrix } from '../city/instancing.js';
import { rng, hashString, pick, pointInPolygon, distToSegment, SegmentGrid } from '../city/util.js';
import { rasterMask, CSS_MASK } from './icTextures.js';
import { CAR_PAINTS, CAR_MODELS } from './icModels.js';

const PAINT = color('#d9d6c8');
const YELLOW = color('#d8b64a');
const WALK = color('#9d9a92');
const alongX = (dir) => Math.atan2(-dir.z, dir.x);
const faceZ = (d) => Math.atan2(d.x, d.z);
const off = (p, d, k) => ({ x: p.x + d.x * k, z: p.z + d.z * k });

const CONTAINER_MODELS = {
  'Wooden crate': 'crate', 'Weapon box': 'weaponBox', 'Wooden ammo box': 'ammoBox', 'Grenade box': 'ammoBox', Toolbox: 'toolbox',
  'Plastic suitcase': 'suitcase', 'Duffle bag': 'duffle', Medbag: 'medbag', Medcase: 'medbag', 'Buried barrel cache': 'barrel', 'Ground cache': 'hatch',
};

// Loot containers standing on the floor and doors at key locks of one level.
// baseY: game height of the level; groundY: where its floor is in the parent group; walls: SegmentGrid to turn doors.
// groundAt(sceneX, sceneZ): terrain height for maps with relief; then items stand on the ground under them.
export function floorProps(ctx, floorId, parent, { baseY = 0, groundY = 0.02, walls = null, groundAt = null } = {}) {
  const { mapData, icProps, materials } = ctx;
  const layers = new Map();
  const layer = (key) => {
    if (!layers.has(key)) layers.set(key, new InstancedLayer(parent, { name: `props-${key}`, geometry: icProps[key], material: materials.props, maxDistance: key === 'doorSingle' ? 320 : 200 }));
    return layers.get(key);
  };
  const toLocal = (y) => y - baseY + groundY;
  const r = rng(hashString(`floor-props:${floorId}`));
  let containers = 0;
  let doors = 0;
  for (const e of mapData.loot) {
    if (e.floor !== floorId) continue;
    const key = CONTAINER_MODELS[e.name];
    if (!key) continue;
    const sx = -e.position.x;
    const ground = groundAt ? groundAt(sx, e.position.z) : null;
    const lift = e.position.y - (ground != null ? ground : baseY);
    let y;
    if (lift > -2 && lift < 0.9) y = ground != null ? ground : groundY;
    else if (ground != null && lift >= 0.9) y = e.position.y;
    else if (floorId === 'STREET' && lift >= 0.9) y = toLocal(e.position.y);
    else continue;
    layer(key).add(composeMatrix(sx, y, e.position.z, r() * Math.PI * 2));
    containers += 1;
  }
  for (const e of mapData.entities) {
    if (e.type !== 'key' || e.floor !== floorId || !e.meta || e.meta.lockType !== 'door') continue;
    let p = { x: -e.position.x, z: e.position.z };
    const ground = groundAt ? groundAt(p.x, p.z) : null;
    const lift = e.position.y - (ground != null ? ground : baseY);
    let y;
    if (ground != null) y = lift < 2.2 ? ground : e.position.y - 1;
    else y = lift < 2.2 ? groundY : toLocal(e.position.y) - 1;
    let angle = r() * Math.PI * 2;
    const hit = walls ? walls.nearest(p, 5) : null;
    if (hit) {
      const { a, b } = hit.seg;
      const q = { x: a.x + (b.x - a.x) * hit.t, z: a.z + (b.z - a.z) * hit.t };
      let n = { x: p.x - q.x, z: p.z - q.z };
      let nl = Math.hypot(n.x, n.z);
      if (nl < 0.05) {
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        n = { x: -(b.z - a.z) / len, z: (b.x - a.x) / len };
        nl = 1;
      }
      n = { x: n.x / nl, z: n.z / nl };
      angle = faceZ(n);
      p = off(q, n, 0.12);
    }
    layer('doorSingle').add(composeMatrix(p.x, y, p.z, angle));
    doors += 1;
  }
  const list = [...layers.values()];
  for (const l of list) l.build();
  return { layers: list, containers, doors };
}

export function buildStreetDetail(ctx, parent) {
  const { svg, heights, props, icProps, mall, materials, projection, flights, mapData } = ctx;
  const G = heights.STREET - 0.08; // ground plane of the STREET level
  const layers = [];
  const L = (name, geometry, maxDistance) => {
    const l = new InstancedLayer(parent, { name, geometry, material: materials.props, maxDistance });
    layers.push(l);
    return l;
  };
  const r = rng(hashString('interchange-street-detail'));
  const stats = { roads: 0, junctions: 0, curbs: 0, stalls: 0, lotLamps: 0, signs: 0, roadblocks: 0, dumpsters: 0, construction: 0, wagons: 0 };
  const paint = new MeshBucket();
  const walks = new MeshBucket();
  const bb = ringInfo(mall.poly.outer).bounds;
  const distMall = (p) => Math.hypot(Math.max(bb.x0 - p.x, 0, p.x - bb.x1), Math.max(bb.z0 - p.z, 0, p.z - bb.z1));

  // ---- roads
  const roads = [];
  for (const [id, kind] of [['Normal_Roads', 'normal'], ['Highways', 'highway']]) {
    for (const s of svg.strokes(id)) for (const line of s.lines) roads.push({ line, width: s.width, kind });
  }
  stats.roads = roads.length;
  const segs = [];
  roads.forEach((rd, ri) => {
    for (let i = 0; i < rd.line.length - 1; i += 1) segs.push({ a: rd.line[i], b: rd.line[i + 1], road: ri, width: rd.width });
  });
  const grid = new SegmentGrid(segs, 24);
  const onRoad = (p, except = -1, pad = 0) => grid.near(p, 16).some((sg) => sg.road !== except && distToSegment(p, sg.a, sg.b).d < sg.width / 2 + pad);
  const junctions = [];
  roads.forEach((rd, ri) => {
    const ends = [[rd.line[0], rd.line[1]], [rd.line[rd.line.length - 1], rd.line[rd.line.length - 2]]];
    for (const [end, next] of ends) {
      if (!next || !onRoad(end, ri, 2) || junctions.some((j) => Math.hypot(j.x - end.x, j.z - end.z) < 12)) continue;
      const len = Math.hypot(next.x - end.x, next.z - end.z) || 1;
      junctions.push({ x: end.x, z: end.z, r: rd.width * 1.2 + 5, road: ri, away: { x: (next.x - end.x) / len, z: (next.z - end.z) / len } });
    }
  });
  stats.junctions = junctions.length;
  const nearJunction = (p) => junctions.some((j) => Math.hypot(j.x - p.x, j.z - p.z) < j.r);
  const lots = svg.polygons('Outdoors', { minArea: 5 });
  const inLot = (p) => lots.some((q) => pointInPolygon(p, q));

  const curb = L('curb', props.curb, 520);
  roads.forEach((rd, ri) => {
    const w = rd.width;
    for (let i = 0; i < rd.line.length - 1; i += 1) {
      const a = rd.line[i];
      const b = rd.line[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.5) continue;
      const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      const n = { x: -dir.z, z: dir.x };
      for (let s = 0; s < len; s += 3) {
        const s1 = Math.min(len, s + 3);
        const pa = off(a, dir, s);
        const pb = off(a, dir, s1);
        const mid = off(a, dir, (s + s1) / 2);
        if (mall.inMall(mid) || nearJunction(mid)) continue;
        if (rd.kind === 'highway') {
          for (const o of [-0.14, 0.14]) strip(paint, off(pa, n, o), off(pb, n, o), 0.12, G + 0.02, YELLOW);
          for (const o of [-(w / 2 - 0.5), w / 2 - 0.5]) strip(paint, off(pa, n, o), off(pb, n, o), 0.15, G + 0.02, PAINT);
        } else if (Math.round(s / 3) % 2 === 0) {
          strip(paint, pa, pb, 0.13, G + 0.02, PAINT);
        }
        if (rd.kind !== 'normal' || distMall(mid) > 90) continue;
        for (const side of [-1, 1]) {
          const walkMid = off(mid, n, side * (w / 2 + 1.6));
          if (mall.inMall(walkMid) || onRoad(walkMid, ri, 0.3) || inLot(off(mid, n, side * (w / 2 + 0.8)))) continue;
          const e = off(mid, n, side * (w / 2 + 0.15));
          curb.add(composeMatrix(e.x, G, e.z, alongX(dir), s1 - s + 0.05, 1, 1));
          strip(walks, off(pa, n, side * (w / 2 + 1.6)), off(pb, n, side * (w / 2 + 1.6)), 2.6, G + 0.14, WALK);
          stats.curbs += 1;
        }
      }
    }
  });

  // ---- signs at junctions (parking sign next to a lot, a warning sign elsewhere)
  const signWarning = L('sign-warning', props.signWarning, 360);
  const signParking = L('sign-parking', props.signParking, 360);
  for (const j of junctions) {
    const rd = roads[j.road];
    const n = { x: -j.away.z, z: j.away.x };
    const pos = off(off(j, j.away, j.r + 1), n, rd.width / 2 + 1.2);
    if (mall.inMall(pos) || onRoad(pos, -1, 0.3)) continue;
    const lotNear = inLot(off(pos, n, 4)) || inLot(off(pos, n, -4));
    (lotNear ? signParking : signWarning).add(composeMatrix(pos.x, G, pos.z, alongX(j.away)));
    stats.signs += 1;
  }

  // ---- roadblocks where a road runs off the playable map
  const jersey = L('jersey-roadblock', props.jersey, 600);
  const X0 = projection.sceneLeft;
  const Z0 = projection.sceneTop;
  const X1 = X0 + projection.width;
  const Z1 = Z0 + projection.depth;
  const edgeDist = (p) => Math.min(p.x - X0, X1 - p.x, p.z - Z0, Z1 - p.z);
  for (const rd of roads) {
    const line = rd.line;
    for (const [end, next] of [[line[0], line[1]], [line[line.length - 1], line[line.length - 2]]]) {
      if (!next || edgeDist(end) > 35) continue;
      const len = Math.hypot(next.x - end.x, next.z - end.z) || 1;
      const d = { x: (next.x - end.x) / len, z: (next.z - end.z) / len };
      const n = { x: -d.z, z: d.x };
      const base = off(end, d, Math.min(len * 0.5, 14));
      const count = Math.ceil(rd.width / 3.1);
      for (let k = 0; k < count; k += 1) {
        const p = off(base, n, (k + 0.5) * (rd.width / count) - rd.width / 2);
        jersey.add(composeMatrix(p.x, G, p.z, alongX(n) + (r() - 0.5) * 0.15));
      }
      stats.roadblocks += 1;
    }
  }

  // ---- parking lots: stalls (5 m) - aisle (6 m) - stalls (5 m), 2.7 m wide; cars in some stalls; lamps in aisles
  const placements = [];
  const lotLamp = L('lot-lamp', props.lamp, 800);
  for (const lot of lots) {
    const info = ringInfo(lot.outer);
    if (info.area < 800 || mall.inMall(info.center)) continue;
    const lr = rng(hashString(`lot:${Math.round(info.center.x)}:${Math.round(info.center.z)}`));
    const alongZ = info.bounds.z1 - info.bounds.z0 >= info.bounds.x1 - info.bounds.x0;
    const [a0, a1] = alongZ ? [info.bounds.z0, info.bounds.z1] : [info.bounds.x0, info.bounds.x1];
    const [r0, r1] = alongZ ? [info.bounds.x0, info.bounds.x1] : [info.bounds.z0, info.bounds.z1];
    const P = (across, axis) => (alongZ ? { x: across, z: axis } : { x: axis, z: across });
    const inside = (p) => pointInPolygon(p, lot);
    const modules = Math.max(1, Math.floor((r1 - r0 - 2) / 16));
    const start = r0 + (r1 - r0 - modules * 16) / 2;
    for (let m = 0; m < modules; m += 1) {
      const mb = start + m * 16;
      for (const [b0, b1, face] of [[mb, mb + 5, -1], [mb + 11, mb + 16, 1]]) {
        for (let a = a0 + 1.5; a + 2.7 < a1 - 1.5; a += 2.7) {
          const c0 = P(b0, a);
          const c1 = P(b1, a);
          if (!inside(c0) || !inside(c1)) continue;
          strip(paint, c0, c1, 0.12, G + 0.02, PAINT);
          stats.stalls += 1;
          if (inside(P(b0, a + 2.7)) && inside(P(b1, a + 2.7)) && lr() < 0.2) {
            const c = P((b0 + b1) / 2, a + 1.35);
            const across = alongZ ? { x: face, z: 0 } : { x: 0, z: face };
            placements.push({ x: c.x, y: G, z: c.z, heading: alongX(across) + (lr() < 0.5 ? Math.PI : 0) + (lr() - 0.5) * 0.08, model: pick(lr, CAR_MODELS), paint: pick(lr, CAR_PAINTS) });
          }
        }
      }
      for (let a = a0 + 12; a < a1 - 6; a += 30) {
        const p = P(mb + 8, a);
        if (!inside(p)) continue;
        lotLamp.add(composeMatrix(p.x, G, p.z, lr() * Math.PI * 2));
        stats.lotLamps += 1;
      }
    }
  }

  // ---- dumpsters at the foot of the truck ramps (loading bays)
  const dumpster = L('dumpster', props.trash, 320);
  for (const f of flights) {
    if (f.kind !== 'ramp') continue;
    const len = Math.hypot(f.high.x - f.low.x, f.high.z - f.low.z) || 1;
    const u = { x: (f.high.x - f.low.x) / len, z: (f.high.z - f.low.z) / len };
    const n = { x: -u.z, z: u.x };
    for (let k = 0; k < 2; k += 1) {
      const p = off(off(f.low, n, f.width / 2 + 2.2), u, -3 - k * 1.8);
      if (onRoad(p) || mall.inMall(p)) continue;
      dumpster.add(composeMatrix(p.x, G, p.z, faceZ(n)), new THREE.Color(pick(r, ['#3a5a3f', '#2b4b6e', '#6b6d6a', '#2f5f5a'])));
      stats.dumpsters += 1;
    }
  }

  // ---- concrete blocks at the highway construction site
  const fbs = L('fbs', props.fbsBlock, 600);
  const site = mapData.entities.find((e) => (e.type === 'place' || e.type === 'street') && /construction/i.test(e.name));
  if (site) {
    const c = { x: -site.position.x, z: site.position.z };
    const cr = rng(hashString('highway-construction'));
    for (let k = 0; k < 5; k += 1) {
      const p = { x: c.x + (cr() - 0.5) * 50, z: c.z + (cr() - 0.5) * 50 };
      const ang = cr() * Math.PI;
      const across = { x: Math.sin(ang), z: Math.cos(ang) };
      for (let h = 0; h < 3; h += 1) {
        for (let q = 0; q < 3 - h; q += 1) {
          const bp = off(p, across, (q - (2 - h) / 2) * 0.65);
          fbs.add(composeMatrix(bp.x, G + h * 0.6, bp.z, ang));
          stats.construction += 1;
        }
      }
    }
  }

  // ---- freight wagons on the track next to the railway extract
  const wagon = L('wagon', icProps.wagon, 900);
  const rail = mapData.entities.find((e) => e.type === 'extract' && /railway/i.test(e.name));
  const tracks = svg.strokes('Train_Tracks').flatMap((s) => s.lines);
  if (rail && tracks.length) {
    const target = { x: -rail.position.x, z: rail.position.z };
    let best = null;
    tracks.forEach((line, li) => line.forEach((p, pi) => {
      const d = Math.hypot(p.x - target.x, p.z - target.z);
      if (!best || d < best.d) best = { d, li, pi };
    }));
    if (best && best.d < 200) {
      const line = tracks[best.li];
      const cum = [0];
      for (let i = 1; i < line.length; i += 1) cum.push(cum[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z));
      const total = cum[cum.length - 1];
      const s0 = cum[best.pi];
      const dirSign = s0 + 90 < total ? 1 : -1;
      for (let k = 0; k < 4; k += 1) {
        const s = s0 + dirSign * (25 + k * 14.6);
        if (s < 0 || s > total) break;
        let i = 1;
        while (i < line.length - 1 && cum[i] < s) i += 1;
        const a = line[i - 1];
        const b = line[i];
        const seg = cum[i] - cum[i - 1] || 1;
        const t = (s - cum[i - 1]) / seg;
        wagon.add(composeMatrix(a.x + (b.x - a.x) * t, G + 0.28, a.z + (b.z - a.z) * t, alongX({ x: (b.x - a.x) / seg, z: (b.z - a.z) / seg })));
        stats.wagons += 1;
      }
    }
  }

  for (const [bucket, name] of [[paint, 'road-and-lot-paint'], [walks, 'sidewalks']]) {
    const mesh = bucket.mesh(materials.solid);
    if (!mesh) continue;
    mesh.name = name;
    parent.add(mesh);
  }
  for (const l of layers) l.build();
  return { layers, placements, stats };
}

// Forest and bushes on open land. The land layer is rasterized into a mask (1 px ≈ 0.9 m); a tree needs clear land
// around it. Density grows with the distance from the mall.
export async function buildVegetation(ctx, parent) {
  const { svg, projection, heights, props, icProps, mall, materials, mapData } = ctx;
  const mask = await rasterMask(svg.svgDoc, {
    layers: ['Ground_Level'], css: CSS_MASK, crop: { x: 0, y: 0, w: mapData.map.svg.width, h: mapData.map.svg.height }, pxPerUnit: 1,
  });
  const land = (p) => {
    const u = (p.x - projection.sceneLeft) / projection.svgScaleX;
    const v = (p.z - projection.sceneTop) / projection.svgScaleZ;
    const px = Math.floor((u - mask.crop.x) * mask.scale);
    const py = Math.floor((v - mask.crop.y) * mask.scale);
    if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return false;
    return mask.data[(py * mask.width + px) * 4] > 140;
  };
  const clear = (p, rad) => land(p) && [0, 1.571, 3.142, 4.712].every((a) => land({ x: p.x + Math.cos(a) * rad, z: p.z + Math.sin(a) * rad }));
  const bb = ringInfo(mall.poly.outer).bounds;
  const distMall = (p) => Math.hypot(Math.max(bb.x0 - p.x, 0, p.x - bb.x1), Math.max(bb.z0 - p.z, 0, p.z - bb.z1));
  const L = (name, geometry, maxDistance) => new InstancedLayer(parent, { name, geometry, material: materials.props, maxDistance });
  const layers = [
    L('conifer-trunk', icProps.coniferTrunk, 700), L('conifer-crown', icProps.coniferCrown, 1800),
    L('tree-trunk', props.treeTrunk, 700), L('tree-crown', props.treeCrown, 1800), L('bush', icProps.bush, 500),
  ];
  const [coniferTrunk, coniferCrown, treeTrunk, treeCrown, bush] = layers;
  const r = rng(hashString('interchange-vegetation'));
  const G = heights.STREET - 0.08;
  const X0 = projection.sceneLeft;
  const Z0 = projection.sceneTop;
  let trees = 0;
  let bushes = 0;
  let samples = 0;
  let landSamples = 0;
  for (let x = X0 + 3; x < X0 + projection.width; x += 6.5) {
    for (let z = Z0 + 3; z < Z0 + projection.depth; z += 6.5) {
      const p = { x: x + (r() - 0.5) * 5, z: z + (r() - 0.5) * 5 };
      samples += 1;
      if (!land(p)) continue;
      landSamples += 1;
      const d = distMall(p);
      const density = d < 45 ? 0 : Math.min(0.8, 0.06 + (d - 45) / 320);
      const roll = r();
      const angle = r() * Math.PI * 2;
      if (roll < density && trees < 9000 && clear(p, 3.5)) {
        const k = 0.7 + r() * 0.65;
        if (r() < 0.6) {
          coniferTrunk.add(composeMatrix(p.x, G, p.z, angle, k, k, k));
          coniferCrown.add(composeMatrix(p.x, G, p.z, angle, k, k * (0.85 + r() * 0.35), k), new THREE.Color(pick(r, ['#3f5a36', '#46613a', '#3b5232', '#526b3f'])));
        } else {
          treeTrunk.add(composeMatrix(p.x, G, p.z, angle, k, k, k));
          treeCrown.add(composeMatrix(p.x, G, p.z, angle, k, k * (0.85 + r() * 0.3), k), new THREE.Color(pick(r, ['#4f6a3a', '#5b7442', '#6d7d45', '#465f35', '#7a8450'])));
        }
        trees += 1;
      } else if (roll > 0.955 && d > 15 && bushes < 5000 && clear(p, 1.5)) {
        const k = 0.6 + r() * 0.8;
        bush.add(composeMatrix(p.x, G, p.z, angle, k, k * (0.7 + r() * 0.5), k), new THREE.Color(pick(r, ['#4c6338', '#5a6f3e', '#667541', '#43582f'])));
        bushes += 1;
      }
    }
  }
  for (const l of layers) l.build();
  return { layers, stats: { trees, bushes, landShare: +(landSamples / Math.max(1, samples)).toFixed(2) } };
}
