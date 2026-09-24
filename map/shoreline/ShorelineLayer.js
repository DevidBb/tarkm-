// 3D model of Shoreline with separate levels: OUTSIDE (the whole territory with relief, water, forest, buildings and
// the Resort from outside) and the Resort inside: BASEMENT, LEVEL1, LEVEL2, LEVEL3, all of them at their heights
// ("Resort") or apart ("All floors"). Loaded lazily only when Shoreline is opened; each Resort floor is built the first
// time it is shown; hidden parts are not rendered; repeated objects are instanced with near/far LOD.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { createSvgReader } from '../interchange/icSvg.js';
import { rasterSvg, planUv } from '../interchange/icTextures.js';
import { interchangeModels } from '../interchange/icModels.js';
import { propModels, vehicleModels } from '../city/models.js';
import { pointInPolygon } from '../city/util.js';
import { levelViewFor, buildingFloors } from '../../services/levels.js';
import { carveWater, buildOutside, scatterTrees } from './slBuild.js';
import { buildResortLevel, RESORT_LEVELS } from './slLevels.js';

const LOW_WALLS = 0.28;

// SVG ground layer in material colors (draped over the relief).
const CSS_GROUND = [
  '.land{fill:#5f6b45}', '.trees{fill:#3d5033}', '.rock{fill:#8d8570}', '.water{fill:#34505f}', '.wood{fill:#6a5236}',
  '.gravel{fill:#7d6a4e}', '.tarmac{fill:#55585a}', '.road_gravel{stroke:#7d6a4e}', '.road_tarmac{stroke:#55585a}',
  '.cement{fill:#8f8c85}', '.building{fill:#3c3b37}', '.fence{stroke:none}', '.map_border{stroke:none}',
  '.railroad{stroke:#4d4036;stroke-dasharray:none}', '.powerline{stroke:none}', '.plane{fill:none;stroke:none}',
  '.danger{fill:#b3261e;fill-opacity:.12;stroke:#b3261e;stroke-opacity:.35;stroke-dasharray:none}', '.stairs{fill:none}',
  '.shadow{filter:none}', '.task{fill:none}', '.floor{fill:none}', '.locked{fill:none}',
].join('');
const CSS_PLAN = ['.floor{fill:#bdb7ab}', '.locked{fill:#7a3b33}', '.stairs{fill:#c9a53a}', '.shadow{filter:none}'].join('');

function createMaterials() {
  const lambert = (o) => new THREE.MeshLambertMaterial(o);
  const plan = () => lambert({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  return {
    solid: lambert({ vertexColors: true, side: THREE.DoubleSide }),
    terrain: lambert({ color: 0x5f6b45 }),
    water: new THREE.MeshPhongMaterial({ color: 0x2c4c5e, shininess: 60, specular: 0x334455, transparent: true, opacity: 0.88 }),
    plan: Object.fromEntries(Object.keys(RESORT_LEVELS).map((id) => [id, plan()])),
    glass: lambert({ color: 0x9cc6d6, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    metal: lambert({ vertexColors: true, side: THREE.DoubleSide }),
    props: lambert({ vertexColors: true }),
    rock: lambert({ color: 0x8d8570 }),
    wire: new THREE.LineBasicMaterial({ color: 0x1d1f1e, transparent: true, opacity: 0.8 }),
    carBody: lambert({ vertexColors: true }),
    carGlass: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, specular: 0x4a5560 }),
    facades: {},
    roofTex: null,
  };
}

export class ShorelineLayer {
  constructor(scene, mapData, renderer) {
    this.scene = scene;
    this.mapData = mapData;
    this.renderer = renderer;
    this.root = new THREE.Group();
    this.root.name = 'shoreline';
    scene.add(this.root);
    this.levels = new Map();
    this.outside = null;
    this.mode = mapData.defaultFloor;
    this.wallScale = 1;
    this.flags = { vehicles: true, streetProps: true };
    this.heights = Object.fromEntries(mapData.floors.map((f) => [f.id, f.displayY]));
    this.ready = false;
  }

  async build(svgDoc, environment) {
    const t0 = performance.now();
    const { projection, terrain } = this.mapData;
    if (!terrain) throw new Error('В данных Shoreline нет рельефа. Перезапустите scripts\\import_shoreline.ps1.');
    const svg = createSvgReader(svgDoc, projection);
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const materials = createMaterials();
    this.materials = materials;
    const resortPolys = svg.polygons('Large_Buildings', { minArea: 500 });
    if (!resortPolys.length) throw new Error('В SVG нет контура санатория (Large_Buildings).');

    const svgPts = resortPolys.flatMap((p) => p.outer).map((p) => svg.toSvg(p));
    const xs = svgPts.map((p) => p.x);
    const ys = svgPts.map((p) => p.y);
    const crop = { x: Math.min(...xs) - 12, y: Math.min(...ys) - 12, w: Math.max(...xs) - Math.min(...xs) + 24, h: Math.max(...ys) - Math.min(...ys) + 24 };

    const ctx = {
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
      resort: { polys: resortPolys, inResort: (p) => resortPolys.some((q) => pointInPolygon(p, q)) },
      planUv: planUv(projection, crop),
    };
    this.ctx = ctx;

    const water = carveWater(ctx);
    this.outside = buildOutside(ctx, water);
    this.root.add(this.outside.group);
    try {
      const groves = await scatterTrees(ctx, this.outside);
      this.outside.stats.groveTrees = groves.trees;
    } catch (e) {
      console.warn('[shoreline] groves', e);
    }

    const { width: W, height: H } = this.mapData.map.svg;
    rasterSvg(svgDoc, { layers: ['Ground_Level'], css: CSS_GROUND, crop: { x: 0, y: 0, w: W, h: H }, pxPerUnit: 3, anisotropy })
      .then(({ texture }) => {
        materials.terrain.map = texture;
        materials.terrain.color.set(0xffffff);
        materials.terrain.needsUpdate = true;
      })
      .catch((e) => console.warn('[shoreline] ground texture', e));
    for (const [id, def] of Object.entries(RESORT_LEVELS)) {
      rasterSvg(svgDoc, { layers: [def.layer], css: CSS_PLAN, crop, pxPerUnit: 8, anisotropy })
        .then(({ texture }) => {
          materials.plan[id].map = texture;
          materials.plan[id].needsUpdate = true;
        })
        .catch((e) => console.warn(`[shoreline] ${id} plan texture`, e));
    }

    this.ready = true;
    this.applyFlags();
    this.setMode(this.mode);
    return {
      ms: Math.round(performance.now() - t0),
      terrain: { grid: `${terrain.cols}x${terrain.rows}`, cell: terrain.cell, samples: terrain.samples, pitsDropped: terrain.pits },
      water: water.surfaces.length,
      outside: this.outside.stats,
    };
  }

  ensureLevel(id) {
    if (!this.levels.has(id) && RESORT_LEVELS[id]) {
      const t = performance.now();
      const built = buildResortLevel(this.ctx, id);
      built.group.visible = false;
      built.walls.scale.y = this.wallScale;
      this.root.add(built.group);
      this.levels.set(id, built);
      console.info(`[shoreline] ${id} built in ${Math.round(performance.now() - t)} ms`, JSON.stringify(built.stats));
    }
    return this.levels.get(id) || null;
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.ready) return;
    const outsideId = this.mapData.defaultFloor;
    const view = levelViewFor(this.mapData, mode);
    this.outside.group.visible = mode === outsideId;
    for (const id of buildingFloors(this.mapData)) {
      const show = mode !== outsideId && view.visible.has(id);
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
    if (!this.outside) return;
    this.outside.cars.visible = this.flags.vehicles;
    this.outside.props.visible = this.flags.streetProps;
  }

  update(dt, camera) {
    if (!this.ready) return;
    const position = camera.position;
    for (const part of [this.outside, ...this.levels.values()]) {
      if (!part || !part.group.visible) continue;
      for (const layer of part.layers) layer.update(position);
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
