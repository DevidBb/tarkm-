// Resort floors of Shoreline, from the SVG floor plans (Floors-U, Floors-1..3): floor slab with the plan drawn on it,
// outer walls, thin plan cut-outs as partition walls, small closed cut-outs as solid blocks, locked rooms
// (Floors-Locked-N) tinted, stairs (Stairs-N paths and the shared stair symbols they reference) as step boxes.
// Loot containers standing on the floor and doors at key locks come from tarkov.dev.
// Approximate: storey height (from the floor heights of the data), wall height, stair direction.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { SVGLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/SVGLoader.js/+esm';
import { MeshBucket, ringWalls, slab, box, ringInfo, color } from '../interchange/icKit.js';
import { SegmentGrid, orient, simplifyRing, signedArea } from '../city/util.js';
import { floorProps } from '../interchange/icStreetDetail.js';

export const RESORT_LEVELS = {
  BASEMENT: { floors: 'Floors-U', locked: null, stairs: ['Stairs-U'], layer: 'Underground_Level' },
  LEVEL1: { floors: 'Floors-1', locked: 'Floors-Locked-1', stairs: ['Stairs-1'], layer: 'First_Floor' },
  LEVEL2: { floors: 'Floors-2', locked: 'Floors-Locked-2', stairs: ['Stairs-2'], layer: 'Second_Floor' },
  LEVEL3: { floors: 'Floors-3', locked: 'Floors-Locked-3', stairs: ['Stairs-3'], layer: 'Third_Floor' },
};
const ORDER = ['BASEMENT', 'LEVEL1', 'LEVEL2', 'LEVEL3'];
const WHITE = color('#ffffff');
const C = {
  wall: color('#ddd6c6'), wallLow: color('#aaa293'), partition: color('#d2cbbb'), partitionLow: color('#a29b8d'),
  block: color('#6f6c66'), blockTop: color('#4b4945'), underside: color('#57554f'), locked: color('#7a3b33'),
  stair: color('#a39f97'), stairTop: color('#cdc8bd'),
};
const XLINK = 'http://www.w3.org/1999/xlink';

// <use> elements of a group (stair symbols placed with x/y and a transform) -> polygons in scene meters.
function usePolygons(svg, groupId) {
  const g = svg.group(groupId);
  if (!g) return [];
  const loader = new SVGLoader();
  const ser = new XMLSerializer();
  const out = [];
  for (const use of g.querySelectorAll('use')) {
    const href = use.getAttribute('href') || use.getAttributeNS(XLINK, 'href') || use.getAttribute('xlink:href');
    const ref = href ? svg.svgDoc.getElementById(href.replace(/^#/, '')) : null;
    if (!ref) continue;
    const x = Number(use.getAttribute('x')) || 0;
    const y = Number(use.getAttribute('y')) || 0;
    const transform = `${use.getAttribute('transform') || ''} translate(${x} ${y})`.trim();
    const markup = `<svg xmlns="http://www.w3.org/2000/svg"><g transform="${transform}">${ser.serializeToString(ref)}</g></svg>`;
    for (const path of loader.parse(markup).paths) {
      for (const shape of SVGLoader.createShapes(path)) {
        const outer = orient(simplifyRing(shape.getPoints(2).map(svg.toScene), 0.05, 1), true);
        if (outer.length >= 3 && Math.abs(signedArea(outer)) > 0.3) out.push({ outer, holes: [] });
      }
    }
  }
  return out;
}

// Steps rising along the longer side of the stair outline up to the next floor.
function stairs(bucket, poly, rise) {
  const info = ringInfo(poly.outer);
  const bx = info.bounds.x1 - info.bounds.x0;
  const bz = info.bounds.z1 - info.bounds.z0;
  const alongX = bx >= bz;
  const long = alongX ? bx : bz;
  const wide = alongX ? bz : bx;
  if (long < 1 || wide < 0.5) return 0;
  const steps = Math.max(4, Math.round(rise / 0.18));
  const tread = long / steps;
  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) * tread;
    const cx = alongX ? info.bounds.x0 + t : info.center.x;
    const cz = alongX ? info.center.z : info.bounds.z0 + t;
    box(bucket, cx, 0, cz, alongX ? tread : wide, ((i + 1) / steps) * rise, alongX ? wide : tread, 0, C.stair, C.stairTop);
  }
  return 1;
}

export function storeyHeight(heights, id) {
  const next = ORDER[ORDER.indexOf(id) + 1];
  return Math.min(4.2, Math.max(2.4, next ? heights[next] - heights[id] : 3.2));
}

export function buildResortLevel(ctx, id) {
  const { svg, heights, materials } = ctx;
  const def = RESORT_LEVELS[id];
  const storey = storeyHeight(heights, id);
  const group = new THREE.Group();
  group.name = id;
  const walls = new THREE.Group();
  group.add(walls);
  const floors = svg.polygons(def.floors, { minArea: 2 });
  const stats = { floorParts: floors.length, storey: +storey.toFixed(2), partitions: 0, blocks: 0, voids: 0, locked: 0, stairs: 0 };
  const floorB = new MeshBucket(ctx.planUv);
  const under = new MeshBucket();
  const wallB = new MeshBucket();
  const lockedB = new MeshBucket();
  const stairB = new MeshBucket();

  for (const poly of floors) {
    slab(floorB, poly, 0.02, WHITE);
    slab(under, { outer: poly.outer, holes: [] }, -0.3, C.underside, { down: true });
    ringWalls(under, poly.outer, -0.3, 0, C.underside);
    ringWalls(wallB, poly.outer, 0, storey, C.wallLow, C.wall);
    for (const hole of poly.holes) {
      const info = ringInfo(hole);
      if (info.width <= 1.3) {
        ringWalls(wallB, hole, 0, storey - 0.1, C.partitionLow, C.partition);
        slab(wallB, { outer: hole, holes: [] }, storey - 0.1, C.partition);
        stats.partitions += 1;
      } else if (info.area <= 300) {
        ringWalls(wallB, hole, 0, storey, C.block, C.block);
        slab(wallB, { outer: hole, holes: [] }, storey, C.blockTop);
        stats.blocks += 1;
      } else {
        stats.voids += 1;
      }
    }
  }
  if (def.locked) {
    for (const poly of svg.polygons(def.locked, { minArea: 1 })) {
      slab(lockedB, poly, 0.07, C.locked);
      stats.locked += 1;
    }
  }
  const stairPolys = [...def.stairs.flatMap((g) => svg.polygons(g, { minArea: 0.5 })), ...def.stairs.flatMap((g) => usePolygons(svg, g))];
  for (const poly of stairPolys) stats.stairs += stairs(stairB, poly, storey);

  const add = (parent, bucket, material, name) => {
    const mesh = bucket.mesh(material);
    if (mesh) {
      mesh.name = name;
      parent.add(mesh);
    }
  };
  add(group, floorB, materials.plan[id], `${id}-floor`);
  add(group, under, materials.solid, `${id}-underside`);
  add(group, lockedB, materials.solid, `${id}-locked`);
  add(group, stairB, materials.solid, `${id}-stairs`);
  add(walls, wallB, materials.solid, `${id}-walls`);

  const wallSegs = floors.flatMap((p) => [p.outer, ...p.holes]).flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] })));
  const levelProps = floorProps(ctx, id, group, { baseY: heights[id], groundY: 0.02, walls: new SegmentGrid(wallSegs, 16) });
  stats.containers = levelProps.containers;
  stats.doors = levelProps.doors;
  return { group, walls, cars: null, props: null, layers: levelProps.layers, stats };
}
