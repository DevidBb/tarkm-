// 3D model of the open maps that share Shoreline's kind of ground (Woods, Reserve, Lighthouse, Ground Zero): the
// relief from the heights of in-game spawn points, water, piers, rocks, forest and groves, buildings with painted
// facades and roofs, fences, power lines, railway, minefield signs, lamps, abandoned and burning cars. The Shoreline
// builder does the work; this layer only finds which SVG groups hold what, by their CSS class, since every map names
// its groups differently. One level (OUTSIDE); loaded lazily when such a map is opened.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { createSvgReader } from '../interchange/icSvg.js';
import { rasterSvg } from '../interchange/icTextures.js';
import { interchangeModels } from '../interchange/icModels.js';
import { propModels, vehicleModels } from '../city/models.js';
import { carveWater, buildOutside, scatterTrees } from '../shoreline/slBuild.js';

const CSS_GROUND = [
  '.land{fill:#5f6b45}', '.trees{fill:#3d5033}', '.rock{fill:#8d8570}', '.water{fill:#34505f}', '.wood{fill:#6a5236}',
  '.gravel{fill:#7d6a4e}', '.tarmac{fill:#55585a}', '.road_gravel{stroke:#7d6a4e}', '.road_tarmac{stroke:#55585a}',
  '.cement{fill:#8f8c85}', '.building{fill:#3c3b37}', '.fence{stroke:none}', '.map_border{stroke:none}',
  '.railroad{stroke:#4d4036;stroke-dasharray:none}', '.powerline{stroke:none}', '.plane{fill:#6b6f6e;stroke:none}', '.misc{fill:#6b6a63}',
  '.danger{fill:#b3261e;fill-opacity:.12;stroke:#b3261e;stroke-opacity:.35;stroke-dasharray:none}', '.stairs{fill:none}',
  '.shadow{filter:none}', '.task{fill:none}', '.floor{fill:none}', '.locked{fill:none}', '.trees *{fill:#3d5033}',
].join('');

// Per map: ground colour, how dense the scattered groves are, building heights (city = Ground Zero towers).
const PROFILES = {
  woods: { ground: 0x56653e, groves: { max: 34000, step: 6, floor: 0.34, peak: 0.85 } },
  reserve: { ground: 0x5f6b45, groves: { max: 6000, step: 8, floor: 0.02, peak: 0.55 } },
  lighthouse: { ground: 0x66704a, groves: { max: 12000, step: 7, floor: 0.04, peak: 0.6 } },
  'ground-zero': { ground: 0x6b6d62, groves: { max: 500, step: 10, floor: 0.0, peak: 0.25 }, city: true },
};

const STYLES = ['brick', 'panel', 'industrial'];

// SVG ids of each part of the ground, from the group classes of Ground_Level.
export function idsByClass(svgDoc, { city = false } = {}) {
  const ids = { water: [], docks: [], rocks: [], forest: [], fences: [], powerlines: [], towers: [], railroad: [], mines: [], roads: [], roadsUnpaved: [], paths: [], buildings: [] };
  const root = svgDoc.querySelector('[id="Ground_Level"]');
  if (!root) return ids;
  for (const g of root.children) {
    if (g.localName !== 'g') continue;
    const id = g.getAttribute('id') || '';
    const cls = (g.getAttribute('class') || '').split(/\s+/);
    const has = (c) => cls.includes(c);
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
        else ids.buildings.push([pid, city ? 'auto-city' : 'auto', 0, STYLES]);
      }
    }
  }
  return ids;
}

function createMaterials(groundColor) {
  const lambert = (o) => new THREE.MeshLambertMaterial(o);
  return {
    solid: lambert({ vertexColors: true, side: THREE.DoubleSide }),
    terrain: lambert({ color: groundColor }),
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
    this.ready = false;
  }

  async build(svgDoc, environment) {
    const t0 = performance.now();
    const { projection, terrain } = this.mapData;
    if (!terrain) throw new Error('В данных карты нет рельефа.');
    const profile = PROFILES[this.mapData.map.id] || {};
    const svg = createSvgReader(svgDoc, projection);
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
      ids: idsByClass(svgDoc, { city: profile.city }),
      groves: profile.groves,
    };
    this.ctx = ctx;
    const water = carveWater(ctx);
    this.outside = buildOutside(ctx, water);
    this.root.add(this.outside.group);
    try {
      const groves = await scatterTrees(ctx, this.outside);
      this.outside.stats.groveTrees = groves.trees;
    } catch (e) {
      console.warn('[open] groves', e);
    }
    const { width: W, height: H } = this.mapData.map.svg;
    rasterSvg(svgDoc, { layers: ['Ground_Level'], css: CSS_GROUND, crop: { x: 0, y: 0, w: W, h: H }, pxPerUnit: W * H > 1.2e6 ? 2 : 3, anisotropy })
      .then(({ texture }) => {
        materials.terrain.map = texture;
        materials.terrain.color.set(0xffffff);
        materials.terrain.needsUpdate = true;
      })
      .catch((e) => console.warn('[open] ground texture', e));
    this.ready = true;
    this.applyFlags();
    return {
      ms: Math.round(performance.now() - t0),
      ids: Object.fromEntries(Object.entries(ctx.ids).map(([k, v]) => [k, v.length])),
      terrain: { grid: `${terrain.cols}x${terrain.rows}`, cell: terrain.cell, samples: terrain.samples },
      water: water.surfaces.length,
      outside: this.outside.stats,
    };
  }

  setMode(mode) { this.mode = mode; }

  setWallMode() {}

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
    if (!this.ready || !this.outside.group.visible) return;
    for (const layer of this.outside.layers) layer.update(camera.position);
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
