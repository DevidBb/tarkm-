// 3D model of Customs with separate levels, in the same system as Interchange, Shoreline and Factory:
// OUTSIDE (the whole territory with relief, river, forest, buildings, railway, roads) and the buildings inside:
// UNDERGROUND (basements, bunkers), LEVEL1, LEVEL2, LEVEL3, all of them at their heights ("Inside") or apart
// ("All floors"). Customs has many separate buildings, so in the inside modes the relief stays as a faint context
// (buildings from outside, trees and props are hidden). Loaded lazily only when Customs is opened; each level is built
// the first time it is shown; hidden parts are not rendered; repeated objects are instanced with near/far LOD.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { createSvgReader } from '../interchange/icSvg.js';
import { rasterSvg, planUv } from '../interchange/icTextures.js';
import { interchangeModels } from '../interchange/icModels.js';
import { propModels, vehicleModels } from '../city/models.js';
import { levelViewFor, buildingFloors } from '../../services/levels.js';
import { scatterTrees } from '../shoreline/slBuild.js';
import { carveRiver, buildOutside, buildLevel, CUSTOMS_LEVELS } from './csBuild.js';
import { refineTerrain } from './csTerrain.js';
import { customsModels } from './csModels.js';
import { chainLinkTexture, groundDetailTexture, detailGround } from './csTextures.js';

const LOW_WALLS = 0.28;
const GHOST_OPACITY = 0.28;

// SVG ground layer in material colors (draped over the relief).
const CSS_GROUND = [
  '.land{fill:#66704a}', '.trees{fill:#3f5234}', '.rock{fill:#77756d}', '.water{fill:#34505f}',
  '.road_gravel{stroke:#7b6a4f}', '.road_tarmac{stroke:#55585a}', '.cement{fill:#8c8980}', '.building{fill:#3c3b37}',
  '.fence{stroke:none}', '.map_border{stroke:none}', '.railroad{stroke:#4d4036;stroke-dasharray:none}', '.powerline{stroke:none}',
  '.danger{fill:#b3261e;fill-opacity:.12;stroke:#b3261e;stroke-opacity:.35;stroke-dasharray:none}',
  '.shadow{filter:none}', '.stairs{fill:none}', '.floor{fill:none}', '.locked{fill:none}',
].join('');
const CSS_PLAN = ['.floor{fill:#bdb7ab}', '.locked{fill:#7a3b33}', '.stairs{fill:#c9a53a}', '.shadow{filter:none}'].join('');

function createMaterials(anisotropy) {
  const lambert = (o) => new THREE.MeshLambertMaterial(o);
  const detail = groundDetailTexture(anisotropy);
  const terrain = lambert({ color: 0x66704a });
  detailGround(terrain, detail, 0.5);
  const road = lambert({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  detailGround(road, detail, 0.35);
  const plan = () => lambert({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  return {
    solid: lambert({ vertexColors: true, side: THREE.DoubleSide }),
    terrain,
    road,
    chain: lambert({ map: chainLinkTexture(anisotropy), alphaTest: 0.45, side: THREE.DoubleSide }),
    water: new THREE.MeshPhongMaterial({ color: 0x2c4c5e, shininess: 60, specular: 0x334455, transparent: true, opacity: 0.88 }),
    plan: Object.fromEntries(Object.keys(CUSTOMS_LEVELS).map((id) => [id, plan()])),
    glass: lambert({ color: 0x9cc6d6, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    metal: lambert({ vertexColors: true, side: THREE.DoubleSide }),
    props: lambert({ vertexColors: true }),
    rock: lambert({ color: 0x8b8a84, flatShading: true }),
    wire: new THREE.LineBasicMaterial({ color: 0x1d1f1e, transparent: true, opacity: 0.8 }),
    carBody: lambert({ vertexColors: true }),
    carGlass: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, specular: 0x4a5560 }),
    facades: {},
    roofTex: null,
  };
}

export class CustomsLayer {
  constructor(scene, mapData, renderer) {
    this.scene = scene;
    this.mapData = mapData;
    this.renderer = renderer;
    this.root = new THREE.Group();
    this.root.name = 'customs';
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
    const { projection } = this.mapData;
    const coarse = this.mapData.terrain;
    if (!coarse) throw new Error('В данных Customs нет рельефа. Перезапустите scripts/import_customs.py.');
    const svg = createSvgReader(svgDoc, projection);
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const materials = createMaterials(anisotropy);
    this.materials = materials;
    const t1 = performance.now();
    // 2 m relief with road beds, ditches, rail embankment, yards and hollows; labels and props use it too
    const terrain = refineTerrain(coarse, svg);
    projection.terrain = terrain;
    projection.heightAt = terrain.heightAtScene;
    const terrainMs = Math.round(performance.now() - t1);
    // chain-link panel: a textured plane along +X (the posts are a separate model)
    const chainPanel = new THREE.PlaneGeometry(2.5, 1.9);
    chainPanel.translate(0, 1.05, 0);
    chainPanel.attributes.uv.array.forEach((v, i, arr) => { arr[i] = i % 2 ? v * 1.9 / 1.25 : v * 2; });
    const { width: W, height: H } = this.mapData.map.svg;
    const full = { x: 0, y: 0, w: W, h: H };

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
      csModels: customsModels(),
      chainPanel,
      mapData: this.mapData,
      environment,
      anisotropy,
    };
    // plan textures cropped to the buildings of each level (they are spread over the whole map)
    const crops = {};
    for (const [id, def] of Object.entries(CUSTOMS_LEVELS)) {
      const pts = svg.polygons(def.floors, { minArea: 1 }).flatMap((p) => p.outer).map((p) => svg.toSvg(p));
      if (!pts.length) continue;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x = Math.max(0, Math.min(...xs) - 8);
      const y = Math.max(0, Math.min(...ys) - 8);
      crops[id] = { x, y, w: Math.min(W, Math.max(...xs) + 8) - x, h: Math.min(H, Math.max(...ys) + 8) - y };
    }
    const uvs = Object.fromEntries(Object.entries(crops).map(([id, c]) => [id, planUv(projection, c)]));
    ctx.planUvFor = (id) => uvs[id] || planUv(projection, full);
    this.ctx = ctx;

    const t2 = performance.now();
    const water = carveRiver(ctx);
    const t3 = performance.now();
    this.outside = buildOutside(ctx, water);
    this.root.add(this.outside.group);
    const t4 = performance.now();
    this.outside.stats.ms.river = Math.round(t3 - t2);
    this.outside.stats.ms.prep = Math.round(t2 - t0);
    this.outside.stats.ms.outside = Math.round(t4 - t3);
    try {
      const groves = await scatterTrees(ctx, this.outside);
      this.outside.stats.ms.groves = Math.round(performance.now() - t4);
      this.outside.stats.groveTrees = groves.trees;
    } catch (e) {
      console.warn('[customs] groves', e);
    }

    rasterSvg(svgDoc, { layers: ['Ground_Level'], css: CSS_GROUND, crop: full, pxPerUnit: 4, anisotropy })
      .then(({ texture }) => {
        materials.terrain.map = texture;
        materials.terrain.color.set(0xffffff);
        materials.terrain.needsUpdate = true;
      })
      .catch((e) => console.warn('[customs] ground texture', e));
    for (const [id, def] of Object.entries(CUSTOMS_LEVELS)) {
      const crop = crops[id] || full;
      const pxPerUnit = Math.min(6, 3600 / Math.max(crop.w, crop.h));
      rasterSvg(svgDoc, { layers: [def.layer], css: CSS_PLAN, crop, pxPerUnit, anisotropy })
        .then(({ texture }) => {
          materials.plan[id].map = texture;
          materials.plan[id].needsUpdate = true;
        })
        .catch((e) => console.warn(`[customs] ${id} plan texture`, e));
    }

    this.ready = true;
    this.applyFlags();
    this.setMode(this.mode);
    return {
      ms: Math.round(performance.now() - t0),
      terrain: { grid: `${terrain.cols}x${terrain.rows}`, cell: terrain.cell, samples: terrain.samples, ms: terrainMs, ...terrain.detail },
      water: water.surfaces.length,
      outside: this.outside.stats,
    };
  }

  ensureLevel(id) {
    if (!this.levels.has(id) && CUSTOMS_LEVELS[id]) {
      const t = performance.now();
      const built = buildLevel(this.ctx, id);
      built.group.visible = false;
      built.walls.scale.y = this.wallScale;
      this.root.add(built.group);
      this.levels.set(id, built);
      console.info(`[customs] ${id} built in ${Math.round(performance.now() - t)} ms`, JSON.stringify(built.stats));
    }
    return this.levels.get(id) || null;
  }

  // Inside modes: the relief stays as a faint see-through context, so basements under it are visible.
  ghostGround(on) {
    const m = this.materials.terrain;
    if (m.transparent === on) return;
    m.transparent = on;
    m.opacity = on ? GHOST_OPACITY : 1;
    m.depthWrite = !on;
    m.needsUpdate = true;
    const w = this.materials.water;
    w.opacity = on ? GHOST_OPACITY : 0.88;
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.ready) return;
    const outsideId = this.mapData.defaultFloor;
    const view = levelViewFor(this.mapData, mode);
    const outside = mode === outsideId;
    this.outside.group.visible = true;
    // in "All floors" the levels are lifted apart, the ground would only get in the way
    this.outside.ground.visible = outside || !view.exploded;
    for (const part of [this.outside.built, this.outside.props, this.outside.cars, this.outside.vegetation]) part.visible = outside;
    if (outside) this.applyFlags();
    this.ghostGround(!outside);
    for (const id of buildingFloors(this.mapData)) {
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
