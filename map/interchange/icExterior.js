// The ULTRA mall seen from outside (STREET level), from the SVG layers of the map:
// - garage level: walls on the footprint `Structure`, vehicle gates where the garage floor meets outdoor pavement;
// - mall body: walls on `Structure-2` (the building without the open loading decks) up to the roof; roof with a parapet
//   and skylights over the four openings of `Structure-2`;
// - loading decks `Pavament-1`: parapets on the outer edges, openings where the truck ramps arrive, dock doors where a
//   deck meets the first-floor plan;
// - entrances: the exterior landing of the first floor (Floor-1 outside the footprint) with a glass front, and ground
//   doors where stairs from the garage start at the outer wall;
// - signs of IDEA, GOSHAN and OLI on the outer wall nearest to the store (store positions from tarkov.dev), ULTRA above
//   the main entrance.
// Approximate (no open data): wall and roof heights, facade pattern, sign colors, roof equipment, trailers and pallets.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { MeshBucket, ringWalls, slab, strip, railing, box, ringInfo, color } from './icKit.js';
import { InstancedLayer, composeMatrix } from '../city/instancing.js';
import { signAtlas } from '../city/textures.js';
import { rng, hashString, pick, pointInPolygon, distToSegment, centroid, SegmentGrid } from '../city/util.js';
import { facadeTexture } from './icTextures.js';

export const ROOF_ABOVE_LEVEL2 = 8; // m, estimate: 6 m storey + roof structure
const GATE_HEIGHT = 4.6;
const WHITE = color('#ffffff');
const C = {
  roof: color('#6d6f6c'), parapet: color('#bdb7aa'), parapetLow: color('#9d988d'), cap: color('#85827b'),
  void: color('#121313'), soffit: color('#3b3c3a'), deck: color('#a9a59b'), underside: color('#57554f'),
  column: color('#9f9b92'), signBack: color('#26282a'), stripe: color('#d0a92e'),
};

const alongX = (dir) => Math.atan2(-dir.z, dir.x);
const faceZ = (d) => Math.atan2(d.x, d.z);
const at = (run, s) => ({ x: run.a.x + run.dir.x * s, z: run.a.z + run.dir.z * s });
const off = (p, d, k) => ({ x: p.x + d.x * k, z: p.z + d.z * k });

// Walk a ring edge by edge in `step` m; classify(p, out) -> kind | null; neighbouring samples of one kind form runs
// { edge, kind, a, dir, out (away from the ring interior), len, s0, s1 }.
export function scanRing(ring, isInside, classify, step = 1) {
  const runs = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.3) continue;
    const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    let out = { x: dir.z, z: -dir.x };
    if (isInside({ x: (a.x + b.x) / 2 + out.x * 0.5, z: (a.z + b.z) / 2 + out.z * 0.5 })) out = { x: -out.x, z: -out.z };
    let cur = null;
    for (let s = step / 2; s < len; s += step) {
      const kind = classify({ x: a.x + dir.x * s, z: a.z + dir.z * s }, out);
      if (kind && cur && cur.kind === kind) {
        cur.s1 = Math.min(len, s + step / 2);
      } else {
        cur = kind ? { edge: i, kind, a, dir, out, len, s0: Math.max(0, s - step / 2), s1: Math.min(len, s + step / 2) } : null;
        if (cur) runs.push(cur);
      }
    }
  }
  return runs;
}

export function analyzeMall(ctx) {
  const { svg, mall, flights } = ctx;
  const { inMall } = mall;
  const inAny = (polys, p) => polys.some((q) => pointInPolygon(p, q));
  const floor1 = svg.polygons('Floor-1', { minArea: 5 });
  const decks = svg.polygons('Pavament-1', { minArea: 20 });
  const garage = svg.polygons('Garage', { minArea: 20 });
  const lots = svg.polygons('Outdoors', { minArea: 5 });
  const body = svg.polygons('Structure-2', { minArea: 1000 })[0] || null;
  const ring = mall.poly.outer;

  const gates = scanRing(ring, inMall, (p, out) => {
    const inside = [1, 3, 6].map((k) => off(p, out, -k));
    const outside = [1, 3, 6].map((k) => off(p, out, k));
    return inside.some((q) => inAny(garage, q)) && outside.some((q) => inAny(lots, q)) ? 'gate' : null;
  }).filter((run) => run.s1 - run.s0 >= 6);

  const landings = scanRing(ring, inMall, (p, out) => ([1.5, 3].some((k) => inAny(floor1, off(p, out, k))) ? 'landing' : null))
    .filter((run) => run.s1 - run.s0 >= 4)
    .map((run) => {
      const mid = at(run, (run.s0 + run.s1) / 2);
      return { ...run, depth: [1, 2, 3, 4, 5, 6, 7, 8].filter((k) => inAny(floor1, off(mid, run.out, k))).length };
    });

  const deckEdges = decks.flatMap((d) => {
    const own = { outer: d.outer, holes: [] };
    return scanRing(d.outer, (p) => pointInPolygon(p, own), (p, out) => {
      const q = [0.8, 2, 4].map((k) => off(p, out, k));
      if (q.some((x) => inAny(floor1, x))) return 'dock';
      if (q.some((x) => inMall(x))) return 'parapet';
      return 'opening';
    });
  });

  // Ground doors: stairs from the garage whose foot is within 16 m of the outer wall.
  const doors = [];
  for (const f of flights) {
    if (f.lowerId !== 'PARKING' || f.kind !== 'stairs') continue;
    let best = null;
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const hit = distToSegment(f.low, a, b);
      if (!best || hit.d < best.d) best = { ...hit, a, b };
    });
    if (!best || best.d > 16) continue;
    const len = Math.hypot(best.b.x - best.a.x, best.b.z - best.a.z) || 1;
    const dir = { x: (best.b.x - best.a.x) / len, z: (best.b.z - best.a.z) / len };
    const p = { x: best.a.x + (best.b.x - best.a.x) * best.t, z: best.a.z + (best.b.z - best.a.z) * best.t };
    let out = { x: dir.z, z: -dir.x };
    if (inMall(off(p, out, 0.5))) out = { x: -out.x, z: -out.z };
    doors.push({ p, dir, out });
  }
  return { ring, body, gates, landings, deckEdges, doors };
}

function facadeQuad(bucket, a, dir, s0, s1, ya, yb, sBase, tileW, yBase, yTop) {
  if (s1 - s0 < 0.02 || yb - ya < 0.02) return;
  const p0 = off(a, dir, s0);
  const p1 = off(a, dir, s1);
  const u0 = (sBase + s0) / tileW;
  const u1 = (sBase + s1) / tileW;
  const v = (y) => (y - yBase) / (yTop - yBase);
  bucket.quad([p0.x, ya, p0.z, u0, v(ya)], [p1.x, ya, p1.z, u1, v(ya)], [p1.x, yb, p1.z, u1, v(yb)], [p0.x, yb, p0.z, u0, v(yb)], [dir.z, 0, -dir.x], WHITE);
}

function colorQuad(bucket, run, s0, s1, ya, yb, col) {
  const p0 = at(run, s0);
  const p1 = at(run, s1);
  bucket.quad([p0.x, ya, p0.z], [p1.x, ya, p1.z], [p1.x, yb, p1.z], [p0.x, yb, p0.z], [run.out.x, 0, run.out.z], col);
}

// Nearest point on the ring edges that lie on the mall footprint (the outside faces), with the outward normal.
function nearestOuterWall(ring, isInside, onFootprint, p) {
  let best = null;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 22) return;
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (!onFootprint(mid)) return;
    const hit = distToSegment(p, a, b);
    if (best && hit.d >= best.d) return;
    const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    let out = { x: dir.z, z: -dir.x };
    if (isInside(off(mid, out, 0.5))) out = { x: -out.x, z: -out.z };
    const s = Math.min(len - 11, Math.max(11, hit.t * len));
    best = { d: hit.d, p: off(a, dir, s), dir, out };
  });
  return best;
}

export function buildMallExterior(ctx) {
  const analysis = analyzeMall(ctx);
  const { heights, materials, anisotropy, props, icProps, mapData, mall } = ctx;
  const y0 = heights.STREET;
  const ground = y0 - 0.08;
  const deckY = heights.LEVEL1;
  const roofY = heights.LEVEL2 + ROOF_ABOVE_LEVEL2;
  const group = new THREE.Group();
  group.name = 'mall-exterior';
  const layers = [];
  const L = (name, geometry, maxDistance) => {
    const l = new InstancedLayer(group, { name, geometry, material: materials.props, maxDistance });
    layers.push(l);
    return l;
  };
  const r = rng(hashString('ultra-exterior'));
  const stats = { gates: analysis.gates.length, landings: analysis.landings.length, groundDoors: analysis.doors.length, dockDoors: 0, rampOpenings: 0, signs: 0, roofUnits: 0, skylights: 0, trailers: 0 };

  if (!materials.facadeBody) {
    materials.facadeBody = new THREE.MeshLambertMaterial({ map: facadeTexture('body', anisotropy), side: THREE.DoubleSide });
    materials.facadePodium = new THREE.MeshLambertMaterial({ map: facadeTexture('podium', anisotropy), side: THREE.DoubleSide });
  }

  // garage level with gates
  const podium = new MeshBucket();
  const solid = new MeshBucket();
  const ring = analysis.ring;
  let acc = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.05) return;
    const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    const piece = (s0, s1, ya) => facadeQuad(podium, a, dir, s0, s1, ya, deckY, acc, 8, ground, deckY);
    let s = 0;
    for (const g of analysis.gates.filter((x) => x.edge === i).sort((p, q) => p.s0 - q.s0)) {
      if (g.s0 > s) piece(s, g.s0, ground);
      piece(g.s0, g.s1, ground + GATE_HEIGHT);
      s = g.s1;
    }
    if (s < len) piece(s, len, ground);
    acc += len;
  });
  for (const g of analysis.gates) {
    const back = { ...g, a: off(g.a, g.out, -1.6) };
    const top = ground + GATE_HEIGHT;
    colorQuad(solid, back, g.s0, g.s1, ground, top, C.void);
    const q0 = at(g, g.s0); const q1 = at(g, g.s1); const p0 = at(back, g.s0); const p1 = at(back, g.s1);
    solid.quad([q0.x, top, q0.z], [q1.x, top, q1.z], [p1.x, top, p1.z], [p0.x, top, p0.z], [0, -1, 0], C.soffit);
    solid.quad([q0.x, ground, q0.z], [p0.x, ground, p0.z], [p0.x, top, p0.z], [q0.x, top, q0.z], [g.dir.x, 0, g.dir.z], C.soffit);
    solid.quad([q1.x, ground, q1.z], [p1.x, ground, p1.z], [p1.x, top, p1.z], [q1.x, top, q1.z], [-g.dir.x, 0, -g.dir.z], C.soffit);
    strip(solid, off(q0, g.out, 0.15), off(q1, g.out, 0.15), 0.3, top + 0.25, C.stripe);
  }

  // mall body, roof, parapet, skylights, roof equipment
  const bodyB = new MeshBucket();
  const glass = new MeshBucket();
  const metal = new MeshBucket();
  const { body } = analysis;
  const onFootprint = (p) => distToSegmentRing(ring, p) < 1.5;
  if (body) {
    let s = 0;
    body.outer.forEach((a, i) => {
      const b = body.outer[(i + 1) % body.outer.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.05) return;
      facadeQuad(bodyB, a, { x: (b.x - a.x) / len, z: (b.z - a.z) / len }, 0, len, deckY, roofY, s, 12, deckY, roofY);
      s += len;
    });
    slab(solid, body, roofY, C.roof);
    ringWalls(solid, body.outer, roofY, roofY + 1.2, C.parapetLow, C.parapet);
    body.outer.forEach((a, i) => strip(solid, a, body.outer[(i + 1) % body.outer.length], 0.45, roofY + 1.21, C.cap));
    for (const h of body.holes) {
      const info = ringInfo(h);
      const c = centroid(h);
      const baseY = roofY + 0.5;
      const apex = [c.x, baseY + Math.min(4, 0.8 + Math.sqrt(info.area) * 0.12), c.z];
      ringWalls(solid, h, roofY, baseY, C.parapet);
      slab(solid, { outer: h, holes: [] }, roofY - 3, C.void);
      h.forEach((a, i) => {
        const b = h[(i + 1) % h.length];
        const ux = b.x - a.x; const uz = b.z - a.z;
        const vx = apex[0] - a.x; const vy = apex[1] - baseY; const vz = apex[2] - a.z;
        let n = [0 * vz - uz * vy, uz * vx - ux * vz, ux * vy - 0 * vx];
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        n = n.map((x) => x / nl);
        if (n[1] < 0) n = n.map((x) => -x);
        glass.tri([a.x, baseY, a.z], [b.x, baseY, b.z], apex, n, WHITE);
        strip(metal, a, { x: apex[0], z: apex[2] }, 0.08, baseY + 0.02, color('#8b9094'));
      });
      stats.skylights += 1;
    }
    const grid = new SegmentGrid(body.outer.map((a, i) => ({ a, b: body.outer[(i + 1) % body.outer.length] })), 24);
    const machine = L('roof-machine', props.roofMachine, 900);
    const ac = L('roof-ac', props.roofAC, 600);
    const vent = L('roof-vent', props.roofVent, 600);
    const bb = ringInfo(body.outer).bounds;
    const holeBoxes = body.holes.map((h) => ringInfo(h).bounds);
    for (let x = bb.x0 + 12; x < bb.x1; x += 22) {
      for (let z = bb.z0 + 12; z < bb.z1; z += 22) {
        const p = { x: x + (r() - 0.5) * 8, z: z + (r() - 0.5) * 8 };
        if (!pointInPolygon(p, body) || grid.nearest(p, 5)) continue;
        if (holeBoxes.some((q) => p.x > q.x0 - 7 && p.x < q.x1 + 7 && p.z > q.z0 - 7 && p.z < q.z1 + 7)) continue;
        const roll = r();
        const m = composeMatrix(p.x, roofY, p.z, Math.round(r() * 4) * (Math.PI / 2));
        if (roll < 0.25) machine.add(m); else if (roll < 0.6) ac.add(m); else if (roll < 0.8) vent.add(m); else continue;
        stats.roofUnits += 1;
      }
    }
  }

  // loading decks: parapets, ramp openings, dock doors with trailers, pallets, dumpsters
  const dockDoor = L('dock-door', icProps.dockDoor, 500);
  const trailer = L('trailer', icProps.trailer, 700);
  const pallet = L('pallet', icProps.pallet, 260);
  const dumpster = L('dumpster', props.trash, 320);
  for (const e of analysis.deckEdges) {
    if (e.kind === 'parapet') {
      colorQuad(solid, e, e.s0, e.s1, deckY, deckY + 1.1, C.parapet);
      strip(solid, at(e, e.s0), at(e, e.s1), 0.3, deckY + 1.11, C.cap);
    } else if (e.kind === 'opening') {
      if (e.s1 - e.s0 >= 4) {
        stats.rampOpenings += 1;
        for (const s of [e.s0, e.s1]) box(solid, at(e, s).x, deckY, at(e, s).z, 0.35, 1.1, 0.35, 0, C.stripe);
      }
    } else if (e.kind === 'dock') {
      const len = e.s1 - e.s0;
      const count = Math.floor(len / 9);
      const toDeck = { x: -e.out.x, z: -e.out.z };
      for (let k = 0; k < count; k += 1) {
        const p = at(e, e.s0 + (k + 0.5) * (len / count));
        dockDoor.add(composeMatrix(p.x + toDeck.x * 0.2, deckY, p.z + toDeck.z * 0.2, faceZ(toDeck)));
        stats.dockDoors += 1;
        if (len >= 30 && k % 2 === 0 && r() < 0.45) {
          trailer.add(composeMatrix(p.x + toDeck.x * 6.9, deckY, p.z + toDeck.z * 6.9, alongX(toDeck)), new THREE.Color(pick(r, ['#ffffff', '#e8e2d2', '#c9d3d9'])));
          stats.trailers += 1;
        } else if (r() < 0.5) {
          const side = r() < 0.5 ? -1 : 1;
          pallet.add(composeMatrix(p.x + toDeck.x * 2.4 + e.dir.x * side * 2.9, deckY, p.z + toDeck.z * 2.4 + e.dir.z * side * 2.9, r() * 0.4));
        }
      }
      if (len >= 12) {
        const p = at(e, e.s0 + 2.2);
        dumpster.add(composeMatrix(p.x + toDeck.x * 1.4, deckY, p.z + toDeck.z * 1.4, faceZ(toDeck)), new THREE.Color(pick(r, ['#3a5a3f', '#2b4b6e', '#6b6d6a'])));
      }
    }
  }

  // entrances
  const entrance = L('entrance', icProps.entrance, 900);
  const deck = new MeshBucket();
  for (const run of analysis.landings) {
    const depth = Math.max(2, run.depth);
    const p0 = at(run, run.s0); const p1 = at(run, run.s1);
    const q0 = off(p0, run.out, depth); const q1 = off(p1, run.out, depth);
    deck.quad([p0.x, deckY, p0.z], [p1.x, deckY, p1.z], [q1.x, deckY, q1.z], [q0.x, deckY, q0.z], [0, 1, 0], C.deck);
    deck.quad([p0.x, deckY - 0.45, p0.z], [p1.x, deckY - 0.45, p1.z], [q1.x, deckY - 0.45, q1.z], [q0.x, deckY - 0.45, q0.z], [0, -1, 0], C.underside);
    deck.quad([q0.x, deckY - 0.45, q0.z], [q1.x, deckY - 0.45, q1.z], [q1.x, deckY, q1.z], [q0.x, deckY, q0.z], [run.out.x, 0, run.out.z], C.underside);
    railing(glass, metal, [p0, q0, q1, p1], deckY, 1.1, { closed: false });
    for (const q of [off(q0, run.dir, 0.6), off(q1, run.dir, -0.6)]) box(solid, q.x - run.out.x * 0.5, ground, q.z - run.out.z * 0.5, 0.6, deckY - 0.45 - ground, 0.6, alongX(run.dir), C.column);
    const mid = at(run, (run.s0 + run.s1) / 2);
    const width = Math.min(24, run.s1 - run.s0 - 1);
    entrance.add(composeMatrix(mid.x + run.out.x * 0.2, deckY, mid.z + run.out.z * 0.2, faceZ(run.out), width / 12, 1, Math.min(1, depth / 4.6)));
  }
  for (const d of analysis.doors) {
    entrance.add(composeMatrix(d.p.x + d.out.x * 0.2, ground, d.p.z + d.out.z * 0.2, faceZ(d.out), 0.3, 0.72, 0.55));
  }

  // store signs
  const signs = [];
  const places = mapData.entities.filter((e) => e.type === 'place' && e.floor === 'LEVEL1');
  const BRANDS = [
    { re: /^idea$/i, text: 'IDEA', bg: '#1f4f9c', fg: '#f3d11c' },
    { re: /^goshan$/i, text: 'GOSHAN', bg: '#d42a2c', fg: '#ffffff' },
    { re: /^oli$/i, text: 'OLI', bg: '#f1efe9', fg: '#d9261c' },
  ];
  const isBody = (p) => (body ? pointInPolygon(p, { outer: body.outer, holes: [] }) : mall.inMall(p));
  const bodyRing = body ? body.outer : ring;
  for (const brand of BRANDS) {
    const place = places.find((e) => brand.re.test(e.name));
    if (!place) continue;
    const wall = nearestOuterWall(bodyRing, isBody, onFootprint, { x: -place.position.x, z: place.position.z });
    if (wall) signs.push({ ...brand, ...wall });
  }
  const main = [...analysis.landings].sort((p, q) => (q.s1 - q.s0) - (p.s1 - p.s0))[0];
  if (main) signs.push({ text: 'ULTRA', bg: '#18191b', fg: '#e8e1cc', p: at(main, (main.s0 + main.s1) / 2), dir: main.dir, out: main.out, low: true });
  let signMesh = null;
  if (signs.length) {
    const { texture, cells } = signAtlas(signs, anisotropy);
    const sb = new MeshBucket();
    signs.forEach((sg, i) => {
      const cell = cells[i];
      const w = sg.low ? 12.8 : 19.2;
      const h = w / 6.4;
      const yb = sg.low ? deckY + 5.4 : deckY + 9.5;
      const right = { x: sg.out.z, z: -sg.out.x };
      const c = off(sg.p, sg.out, 0.45);
      const lft = off(c, right, -w / 2);
      const rgt = off(c, right, w / 2);
      sb.quad([lft.x, yb, lft.z, cell.u0, cell.v0], [rgt.x, yb, rgt.z, cell.u1, cell.v0], [rgt.x, yb + h, rgt.z, cell.u1, cell.v1], [lft.x, yb + h, lft.z, cell.u0, cell.v1], [sg.out.x, 0, sg.out.z], WHITE);
      const back = off(sg.p, sg.out, 0.2);
      box(solid, back.x, yb - 0.2, back.z, w + 0.4, h + 0.4, 0.4, alongX(right), C.signBack);
      stats.signs += 1;
    });
    materials.signs = new THREE.MeshLambertMaterial({ map: texture });
    signMesh = sb.mesh(materials.signs);
    if (signMesh) {
      signMesh.name = 'store-signs';
      group.add(signMesh);
    }
  }

  const add = (bucket, material, name) => {
    const mesh = bucket.mesh(material);
    if (mesh) {
      mesh.name = name;
      group.add(mesh);
    }
  };
  add(podium, materials.facadePodium, 'garage-level-facade');
  add(bodyB, materials.facadeBody, 'mall-facade');
  add(solid, materials.solid, 'mall-roof-parapets-gates');
  add(deck, materials.solid, 'entrance-landings');
  add(glass, materials.glass, 'mall-glass');
  add(metal, materials.metal, 'mall-rails');
  for (const l of layers) l.build();
  return { group, layers, stats, analysis };
}

function distToSegmentRing(ring, p) {
  let d = Infinity;
  for (let i = 0; i < ring.length; i += 1) d = Math.min(d, distToSegment(p, ring[i], ring[(i + 1) % ring.length]).d);
  return d;
}
