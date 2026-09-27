// 3D model of the open maps that share Shoreline's kind of ground (Woods, Reserve, Lighthouse, Ground Zero): the
// relief from the heights of in-game spawn points, water, piers, rocks, forest and groves, buildings with painted
// facades and roofs, fences, power lines, railway, minefield signs, lamps, abandoned and burning cars. The Shoreline
// builder does the work; this layer only finds which SVG groups hold what, by their CSS class, since every map names
// its groups differently. One level (OUTSIDE); loaded lazily when such a map is opened.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { createSvgReader } from '../interchange/icSvg.js';
import { rasterSvg, planUv } from '../interchange/icTextures.js';
import { buildLevel } from '../customs/csBuild.js';
import { levelViewFor, buildingFloors } from '../../services/levels.js';
import { interchangeModels } from '../interchange/icModels.js';
import { propModels, vehicleModels } from '../city/models.js';
import { carveWater, buildOutside, scatterTrees } from '../shoreline/slBuild.js';
import { buildTerrain } from '../../services/terrain.js';
import { InstancedLayer, composeMatrix } from '../city/instancing.js';
import { paint } from '../city/models.js';
import { rng, hashString } from '../city/util.js';
import { raiseMountains, slopeBoulders, boulderGeometries } from './relief.js';
import { mergeGeometries } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js/+esm';
import { roundBuildingHook, buildLandmarks } from './landmarks.js';

const CSS_GROUND = [
  '.land{fill:#5f6b45}', '.trees{fill:#3d5033}', '.rock{fill:#7a7862}', '.water{fill:#34505f}', '.wood{fill:#6a5236}',
  '.gravel{fill:#7d6a4e}', '.tarmac{fill:#55585a}', '.road_gravel{stroke:#7d6a4e}', '.road_tarmac{stroke:#55585a}',
  '.cement{fill:#8f8c85}', '.building{fill:#3c3b37}', '.fence{stroke:none}', '.map_border{stroke:none}',
  '.railroad{stroke:#4d4036;stroke-dasharray:none}', '.powerline{stroke:none}', '.plane{fill:#6b6f6e;stroke:none}', '.misc{fill:#6b6a63}', '.chopper{fill:#4d4c45}',
  '.danger{fill:#b3261e;fill-opacity:.12;stroke:#b3261e;stroke-opacity:.35;stroke-dasharray:none}', '.stairs{fill:none}',
  '.shadow{filter:none}', '.task{fill:none}', '.floor{fill:none}', '.locked{fill:none}', '.trees *{fill:#3d5033}',
].join('');

// Plans of the levels under and above the ground (Reserve bunkers, Ground Zero garage and storeys).
const CSS_PLAN = [
  '.floor{fill:#bdb7ab}', '.locked{fill:#7a3b33}', '.stairs{fill:#c9a53a}', '.shadow{filter:none}', '.cement{fill:#aaa69c}',
  '.tarmac{fill:#64676a}', '.gravel{fill:#8a7a5e}', '.building{fill:#8f8a80}', '.land{fill:#7d8a62}', '.water{fill:#4d6a78}',
].join('');
const LEVEL_ORDER = ['UNDERGROUND', 'LEVEL1', 'LEVEL2', 'LEVEL3'];
const LOW_WALLS = 0.28;
const GHOST_OPACITY = 0.28;

// Per map: ground colour, how dense the scattered groves are, building heights (city = Ground Zero towers).
const PROFILES = {
  woods: { ground: 0x56653e, groves: { max: 36000, step: 6, floor: 0.34, peak: 0.85, onRock: 0.35 } },
  reserve: { ground: 0x5f6b45, groves: { max: 6500, step: 8, floor: 0.02, peak: 0.55, onRock: 0.5 } },
  lighthouse: { ground: 0x66704a, groves: { max: 18000, step: 7, floor: 0.06, peak: 0.6, onRock: 0.8 } },
  'ground-zero': { ground: 0x6b6d62, base: 0x55575a, groves: { max: 500, step: 10, floor: 0.0, peak: 0.25 }, city: true },
};

const STYLES = ['brick', 'panel', 'industrial'];
const CITY_STYLES = ['glass', 'office', 'modern', 'panel'];

// SVG ids of each part of the ground, from the group classes of Ground_Level.
export function idsByClass(svgDoc, { city = false } = {}) {
  const ids = { water: [], docks: [], rocks: [], forest: [], fences: [], powerlines: [], towers: [], railroad: [], mines: [], roads: [], roadsUnpaved: [], paths: [], buildings: [] };
  const root = svgDoc.querySelector('[id="Ground_Level"]');
  if (!root) return ids;
  ids.landAbove = {};
  for (const g of root.children) {
    if (g.localName !== 'g') continue;
    const id = g.getAttribute('id') || '';
    const cls = (g.getAttribute('class') || '').split(/\s+/);
    const has = (c) => cls.includes(c);
    // islands: land groups drawn after a water group lie on it
    if (has('land')) for (const w of ids.water) ids.landAbove[w].push(id);
    if (has('water')) ids.landAbove[id] = [];
    if (/tower/i.test(id)) ids.towers.push(id);
    else if (/roof/i.test(id)) continue;
    else if (has('water')) ids.water.push(id);
    else if (has('wood')) ids.docks.push(id);
    else if (has('rock')) ids.rocks.push(id);
    else if (has('trees')) ids.forest.push(id);
    else if (has('fence')) ids.fences.push(id);
    else if (has('powerline')) ids.powerlines.push(id);
    else if (has('railroad')) ids.railroad.push(id);
    else if (has('danger') && /mine/i.test(id)) ids.mines.push(id);
    else if (has('road_tarmac') || has('tarmac')) ids.roads.push(id);
    else if (has('road_gravel') || has('gravel')) ids.roadsUnpaved.push(id);
    else if (has('building')) {
      // A buildings group with subgroups (Terminal: Powerline_Towers, Straight...) is read subgroup by subgroup.
      const subs = [...g.children].filter((c) => c.localName === 'g' && c.getAttribute('id'));
      const parts = subs.length ? subs.map((c) => c.getAttribute('id')) : [id];
      for (const pid of parts) {
        if (/tower/i.test(pid)) ids.towers.push(pid);
        else ids.buildings.push([pid, city ? 'auto-city' : 'auto', 0, city ? CITY_STYLES : STYLES]);
      }
    }
  }
  return ids;
}

function createMaterials(groundColor) {
  const lambert = (o) => new THREE.MeshLambertMaterial(o);
  return {
    solid: lambert({ vertexColors: true, side: THREE.DoubleSide }),
    terrain: lambert({ color: groundColor, vertexColors: true }),
    water: new THREE.MeshPhongMaterial({ color: 0x2c4c5e, shininess: 60, specular: 0x334455, transparent: true, opacity: 0.88 }),
    plan: {},
    glass: lambert({ color: 0x9cc6d6, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    metal: lambert({ vertexColors: true, side: THREE.DoubleSide }),
    props: lambert({ vertexColors: true }),
    rock: lambert({ color: 0x85837b, flatShading: true }),
    wire: new THREE.LineBasicMaterial({ color: 0x1d1f1e, transparent: true, opacity: 0.8 }),
    carBody: lambert({ vertexColors: true }),
    carGlass: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, specular: 0x4a5560 }),
    facades: {},
    roofTex: null,
  };
}

export class OpenLayer {
  constructor(scene, mapData, renderer) {
    this.scene = scene;
    this.mapData = mapData;
    this.renderer = renderer;
    this.root = new THREE.Group();
    this.root.name = `open-${mapData.map.id}`;
    scene.add(this.root);
    this.outside = null;
    this.mode = mapData.defaultFloor;
    this.flags = { vehicles: true, streetProps: true };
    this.heights = Object.fromEntries(mapData.floors.map((f) => [f.id, f.displayY]));
    this.levels = new Map();
    this.wallScale = 1;
    this.ready = false;
  }

  async build(svgDoc, environment) {
    const t0 = performance.now();
    const { projection } = this.mapData;
    if (!this.mapData.terrain) throw new Error('В данных карты нет рельефа.');
    const profile = PROFILES[this.mapData.map.id] || {};
    const svg = createSvgReader(svgDoc, projection);
    const ids = idsByClass(svgDoc, { city: profile.city });
    // A finer relief than the shared 6 m one, with the mountains of the plan raised on it.
    const terrain = buildTerrain(this.mapData.raw.terrain.samples, this.mapData.map.bounds, { cell: 4, smooth: 110 });
    const rockPolys = ids.rocks.flatMap((id) => svg.polygons(id, { minArea: 2 }));
    const mountains = raiseMountains(terrain, rockPolys, { maxHeight: profile.mountains || 36 });
    this.mapData.terrain = terrain;
    this.mapData.heightAt = terrain.heightAtScene;
    projection.terrain = terrain;
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const materials = createMaterials(profile.ground || 0x5f6b45);
    this.materials = materials;
    projection.heightAt = terrain.heightAtScene;
    const ctx = {
      fx: this.fx || null,
      svg,
      projection,
      terrain,
      ground: (x, z) => terrain.heightAtScene(x, z),
      heights: this.heights,
      materials,
      props: propModels(),
      cars: vehicleModels(),
      icProps: interchangeModels(),
      mapData: this.mapData,
      environment,
      anisotropy,
      resort: { polys: [], inResort: () => false },
      ids,
      landAbove: ids.landAbove,
      groves: profile.groves,
      rockFilter: () => false, // rocks are hills of the relief or boulders, built here
      builtBuildings: [],
      landmarkGeos: [],
      noTrees: [],
    };
    ctx.roundBuilding = roundBuildingHook(ctx, ctx.landmarkGeos);
    this.ctx = ctx;
    // Levels besides the ground, built like Customs' (plan slabs, walls from the outlines) when first shown.
    const { width: SW, height: SH } = this.mapData.map.svg;
    const full = { x: 0, y: 0, w: SW, h: SH };
    ctx.levelDefs = {};
    for (const f of this.mapData.floors) {
      if (f.id === this.mapData.defaultFloor || !f.svgLayer || !svgDoc.querySelector(`[id="${f.svgLayer}"]`)) continue;
      ctx.levelDefs[f.id] = { floors: f.svgLayer, locked: [], ladders: [], layer: f.svgLayer, storey: f.id === 'UNDERGROUND' ? 3.4 : 3.3, offset: f.offset != null ? f.offset : null };
    }
    ctx.levelOrder = LEVEL_ORDER.filter((id) => ctx.levelDefs[id]);
    const crops = {};
    for (const [id, def] of Object.entries(ctx.levelDefs)) {
      materials.plan[id] = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      const pts = svg.polygons(def.floors, { minArea: 1 }).flatMap((q) => q.outer).map((q) => svg.toSvg(q));
      if (!pts.length) continue;
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      const x = Math.max(0, Math.min(...xs) - 8);
      const y = Math.max(0, Math.min(...ys) - 8);
      crops[id] = { x, y, w: Math.min(SW, Math.max(...xs) + 8) - x, h: Math.min(SH, Math.max(...ys) + 8) - y };
    }
    const uvs = Object.fromEntries(Object.entries(crops).map(([id, c]) => [id, planUv(projection, c)]));
    ctx.planUvFor = (id) => uvs[id] || planUv(projection, full);
    this.levelCrops = crops;
    this.svgDoc = svgDoc;
    const water = carveWater(ctx);
    this.outside = buildOutside(ctx, water);
    this.root.add(this.outside.group);
    const landmarks = buildLandmarks(ctx, this.outside);
    // Loose boulders on the raised slopes; small rock outlines of the plan as stones.
    const rb = rng(hashString(`${this.mapData.map.id}:boulders`));
    const stones = boulderGeometries(rockPolys, ctx.ground, rb);
    if (stones.length) {
      const mesh = new THREE.Mesh(mergeGeometries(stones, false), materials.solid);
      mesh.name = 'stones';
      this.outside.group.add(mesh);
    }
    const spots = slopeBoulders(terrain, rockPolys, rb);
    if (spots.length) {
      const geo = paint(new THREE.IcosahedronGeometry(1, 0), '#8a877f');
      const boulders = new InstancedLayer(this.outside.props, { name: 'boulders', geometry: geo, material: materials.rock, maxDistance: 900 });
      for (const s of spots) {
        const k = 0.6 + rb() * 1.8;
        boulders.add(composeMatrix(s.x, s.y - k * 0.3, s.z, rb() * 6.28, k * (0.8 + rb() * 0.6), k * (0.5 + rb() * 0.5), k));
      }
      boulders.build();
      this.outside.layers.push(boulders);
    }
    try {
      const groves = await scatterTrees(ctx, this.outside);
      this.outside.stats.groveTrees = groves.trees;
    } catch (e) {
      console.warn('[open] groves', e);
    }
    const { width: W, height: H } = this.mapData.map.svg;
    const background = `#${new THREE.Color(profile.base || profile.ground || 0x5f6b45).getHexString()}`;
    rasterSvg(svgDoc, { layers: ['Ground_Level'], css: CSS_GROUND, crop: { x: 0, y: 0, w: W, h: H }, pxPerUnit: W * H > 1.2e6 ? 2 : 3, anisotropy, background })
      .then(({ texture }) => {
        materials.terrain.map = texture;
        materials.terrain.color.set(0xffffff);
        materials.terrain.needsUpdate = true;
      })
      .catch((e) => console.warn('[open] ground texture', e));
    this.ready = true;
    this.applyFlags();
    this.setMode(this.mode);
    return {
      ms: Math.round(performance.now() - t0),
      ids: Object.fromEntries(Object.entries(ctx.ids).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])),
      terrain: { grid: `${terrain.cols}x${terrain.rows}`, cell: terrain.cell, samples: terrain.samples },
      water: water.surfaces.length,
      mountains,
      landmarks,
      boulders: spots.length,
      stones: stones.length,
      levels: Object.keys(ctx.levelDefs),
      outside: this.outside.stats,
    };
  }

  // A level is built (and its plan rasterized) the first time it is shown.
  ensureLevel(id) {
    const def = this.ctx && this.ctx.levelDefs[id];
    if (!this.levels.has(id) && def) {
      const t = performance.now();
      const built = buildLevel(this.ctx, id);
      built.group.visible = false;
      built.walls.scale.y = this.wallScale;
      this.root.add(built.group);
      this.levels.set(id, built);
      const crop = this.levelCrops[id] || { x: 0, y: 0, w: this.mapData.map.svg.width, h: this.mapData.map.svg.height };
      const pxPerUnit = Math.min(6, 3600 / Math.max(crop.w, crop.h));
      rasterSvg(this.svgDoc, { layers: [def.layer], css: CSS_PLAN, crop, pxPerUnit, anisotropy: this.ctx.anisotropy })
        .then(({ texture }) => {
          this.materials.plan[id].map = texture;
          this.materials.plan[id].needsUpdate = true;
        })
        .catch((e) => console.warn(`[open] ${id} plan texture`, e));
      console.info(`[open] ${id} built in ${Math.round(performance.now() - t)} ms`, JSON.stringify(built.stats));
    }
    return this.levels.get(id) || null;
  }

  // Inside modes: the relief stays as a faint see-through context over the bunkers and garages.
  ghostGround(on) {
    const m = this.materials.terrain;
    if (m.transparent === on) return;
    m.transparent = on;
    m.opacity = on ? GHOST_OPACITY : 1;
    m.depthWrite = !on;
    m.needsUpdate = true;
    this.materials.water.opacity = on ? GHOST_OPACITY : 0.88;
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.ready) return;
    const floors = buildingFloors(this.mapData);
    if (!floors.length) return;
    const outside = mode === this.mapData.defaultFloor;
    const view = levelViewFor(this.mapData, mode);
    // inside: only the (see-through) relief and water of the outside stay; "All floors" lifts levels apart, without them
    for (const child of this.outside.group.children) {
      const ground = child.name === 'terrain' || child.name === 'water';
      child.visible = outside || (ground && !view.exploded);
    }
    if (outside) this.applyFlags();
    this.ghostGround(!outside);
    for (const id of floors) {
      const show = !outside && view.visible.has(id);
      const level = show ? this.ensureLevel(id) : this.levels.get(id);
      if (!level) continue;
      level.group.visible = show;
      level.group.position.y = this.heights[id] + (view.exploded ? view.offsetFor(id) : 0);
    }
  }

  setWallMode(mode) {
    this.wallScale = mode === 'low' ? LOW_WALLS : 1;
    for (const level of this.levels.values()) level.walls.scale.y = this.wallScale;
  }

  setFlags(filters) {
    this.flags = { vehicles: filters.vehicles !== false, streetProps: filters.streetProps !== false };
    this.applyFlags();
  }

  applyFlags() {
    if (!this.outside || this.mode !== this.mapData.defaultFloor) return;
    this.outside.cars.visible = this.flags.vehicles;
    this.outside.props.visible = this.flags.streetProps;
  }

  update(dt, camera) {
    if (!this.ready) return;
    for (const part of [this.outside, ...this.levels.values()]) {
      if (!part || !part.group.visible) continue;
      for (const layer of part.layers) layer.update(camera.position);
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    const disposeMaterial = (m) => {
      if (!m) return;
      if (m.map) m.map.dispose();
      m.dispose();
    };
    if (this.materials) {
      for (const m of Object.values(this.materials)) {
        if (m && typeof m.dispose === 'function') disposeMaterial(m);
        else if (m) Object.values(m).forEach(disposeMaterial);
      }
    }
    this.scene.remove(this.root);
  }
}
