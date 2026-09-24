// 3D model of Factory with separate levels, in the same system as Interchange and Shoreline:
// OUTSIDE (the factory from outside: halls, annexes, gates, roof, yard) and the factory inside: TUNNELS, LEVEL1,
// LEVEL2, LEVEL3, all of them at their heights ("Factory") or apart ("All floors"). Loaded lazily only when Factory is
// opened; each level is built the first time it is shown; hidden parts are not rendered.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { createSvgReader } from '../interchange/icSvg.js';
import { rasterSvg, planUv } from '../interchange/icTextures.js';
import { interchangeModels } from '../interchange/icModels.js';
import { propModels, vehicleModels } from '../city/models.js';
import { levelViewFor, buildingFloors } from '../../services/levels.js';
import { buildFactoryLevel, buildOutside, FACTORY_LEVELS } from './fcBuild.js';
import { factoryModels } from './fcModels.js';
import { factoryFacade, factoryTexture } from './fcTextures.js';

const LOW_WALLS = 0.28;
const CSS_PLAN = [
  '.floor{fill:#b3ada1}', '.cement{fill:#9a968c}', '.building{fill:#34383a}', '.stairs{fill:#c9a53a}', '.wall{stroke:#2a2a28}',
  '.shadow{filter:none}', '.locked{fill:#7a3b33}', '.task{fill:none}',
].join('');

function createMaterials(anisotropy) {
  const lambert = (o) => new THREE.MeshLambertMaterial(o);
  const plan = () => lambert({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  return {
    solid: lambert({ vertexColors: true, side: THREE.DoubleSide }),
    plan: Object.fromEntries(Object.keys(FACTORY_LEVELS).map((id) => [id, plan()])),
    props: lambert({ vertexColors: true }),
    facadeHall: lambert({ vertexColors: true, map: factoryFacade('hall', anisotropy) }),
    facadeLow: lambert({ vertexColors: true, map: factoryFacade('annex', anisotropy) }),
    roof: lambert({ vertexColors: true, map: factoryTexture('roof', anisotropy) }),
    skylight: new THREE.MeshPhongMaterial({ color: 0x8fb3c0, shininess: 80, specular: 0x556677, transparent: true, opacity: 0.75 }),
    yard: lambert({ vertexColors: true, map: factoryTexture('concrete', anisotropy) }),
    grass: lambert({ vertexColors: true, map: factoryTexture('grass', anisotropy) }),
    road: lambert({ vertexColors: true, map: factoryTexture('asphalt', anisotropy) }),
    fence: lambert({ vertexColors: true, map: factoryTexture('fence', anisotropy) }),
  };
}

export class FactoryLayer {
  constructor(scene, mapData, renderer) {
    this.scene = scene;
    this.mapData = mapData;
    this.renderer = renderer;
    this.root = new THREE.Group();
    this.root.name = 'factory';
    scene.add(this.root);
    this.levels = new Map();
    this.outside = null;
    this.mode = mapData.defaultFloor;
    this.wallScale = 1;
    this.flags = { vehicles: true, streetProps: true };
    this.heights = Object.fromEntries(mapData.floors.map((f) => [f.id, f.displayY]));
    this.ready = false;
  }

  async build(svgDoc) {
    const t0 = performance.now();
    const { projection } = this.mapData;
    if (!projection.svgToScene) throw new Error('Factory: в данных карты нет осей SVG (map.svgAxes). Перезапустите scripts/import_factory.py.');
    const svg = createSvgReader(svgDoc, projection);
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const materials = createMaterials(anisotropy);
    this.materials = materials;
    const { width: W, height: H } = this.mapData.map.svg;
    const crop = { x: 0, y: 0, w: W, h: H };
    const ctx = {
      svg,
      projection,
      heights: this.heights,
      materials,
      props: propModels(),
      cars: vehicleModels(),
      icProps: interchangeModels(),
      fcModels: factoryModels(),
      mapData: this.mapData,
      anisotropy,
      planUv: planUv(projection, crop),
    };
    this.ctx = ctx;
    this.outside = await buildOutside(ctx);
    this.root.add(this.outside.group);
    for (const [id, def] of Object.entries(FACTORY_LEVELS)) {
      rasterSvg(svgDoc, { layers: [def.layer], css: CSS_PLAN, crop, pxPerUnit: 14, anisotropy })
        .then(({ texture }) => {
          materials.plan[id].map = texture;
          materials.plan[id].needsUpdate = true;
        })
        .catch((e) => console.warn(`[factory] ${id} plan texture`, e));
    }
    this.ready = true;
    this.applyFlags();
    this.setMode(this.mode);
    return { ms: Math.round(performance.now() - t0), outside: this.outside.stats };
  }

  ensureLevel(id) {
    if (!this.levels.has(id) && FACTORY_LEVELS[id]) {
      const t = performance.now();
      const built = buildFactoryLevel(this.ctx, id);
      built.group.visible = false;
      built.walls.scale.y = this.wallScale;
      this.root.add(built.group);
      this.levels.set(id, built);
      console.info(`[factory] ${id} built in ${Math.round(performance.now() - t)} ms`, JSON.stringify(built.stats));
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

  applyFlags() {}

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
