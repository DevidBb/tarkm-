// 3D model of Interchange with separate levels: STREET (the territory, the mall as a see-through shell),
// and the mall itself: PARKING, LEVEL1, LEVEL2, or all of them apart ("All floors").
// Loaded lazily (dynamic import) only when Interchange is opened; each mall level is built the first time it is
// shown, hidden levels are not rendered, repeated objects are instanced with near/far LOD.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { createSvgReader } from './icSvg.js';
import { rasterSvg, planUv, CSS_GROUND, CSS_PLAN } from './icTextures.js';
import { collectFlights, buildFlightMeshes, buildParking, buildLevel1, buildLevel2, buildStreet } from './icBuild.js';
import { levelViewFor, buildingFloors, ALL_FLOORS } from '../../services/levels.js';
import { pointInPolygon, centroid } from '../city/util.js';
import { propModels, vehicleModels } from '../city/models.js';
import { interchangeModels } from './icModels.js';
import { buildVegetation } from './icStreetDetail.js';

const BUILDERS = { PARKING: buildParking, LEVEL1: buildLevel1, LEVEL2: buildLevel2 };
const LOW_WALLS = 0.28;

function createMaterials() {
  const lambert = (o) => new THREE.MeshLambertMaterial(o);
  const plan = () => lambert({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  return {
    solid: lambert({ vertexColors: true, side: THREE.DoubleSide }),
    ground: lambert({ color: 0x6b6f63 }),
    plan: { PARKING: plan(), LEVEL1: plan(), LEVEL2: plan() },
    glass: lambert({ color: 0x9cc6d6, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    metal: lambert({ vertexColors: true, side: THREE.DoubleSide }),
    props: lambert({ vertexColors: true }),
    shell: lambert({ color: 0xd6d1c4, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
    edges: new THREE.LineBasicMaterial({ color: 0xece8da, transparent: true, opacity: 0.6 }),
    roof: lambert({ color: 0x3b4046, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }),
    rock: lambert({ color: 0x9a9175 }),
    wire: new THREE.LineBasicMaterial({ color: 0x1d1f1e, transparent: true, opacity: 0.8 }),
    carBody: lambert({ vertexColors: true }),
    carGlass: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, specular: 0x4a5560 }),
  };
}

export class InterchangeLayer {
  constructor(scene, mapData, renderer) {
    this.scene = scene;
    this.mapData = mapData;
    this.renderer = renderer;
    this.root = new THREE.Group();
    this.root.name = 'interchange';
    scene.add(this.root);
    this.levels = new Map();
    this.flights = [];
    this.street = null;
    this.mode = mapData.defaultFloor;
    this.wallScale = 1;
    this.flags = { vehicles: true, streetProps: true };
    this.heights = Object.fromEntries(mapData.floors.map((f) => [f.id, f.displayY]));
    this.ready = false;
  }

  async build(svgDoc, environment) {
    const t0 = performance.now();
    const { projection } = this.mapData;
    const svg = createSvgReader(svgDoc, projection);
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const structure = svg.polygons('Structure', { minArea: 1000 })[0];
    if (!structure) throw new Error('В SVG нет контура ТЦ (Structure).');
    const mallPoly = { outer: structure.outer, holes: [] };
    const inMall = (p) => pointInPolygon(p, mallPoly);

    const svgPts = structure.outer.map((p) => svg.toSvg(p));
    const minX = Math.min(...svgPts.map((p) => p.x));
    const maxX = Math.max(...svgPts.map((p) => p.x));
    const minY = Math.min(...svgPts.map((p) => p.y));
    const maxY = Math.max(...svgPts.map((p) => p.y));
    const mallCrop = { x: minX - 8, y: minY - 8, w: maxX - minX + 16, h: maxY - minY + 16 };

    const materials = createMaterials();
    this.materials = materials;
    const buildings = svg.polygons('Buildings', { minArea: 2 });
    const ctx = {
      fx: this.fx || null,
      svg,
      projection,
      heights: this.heights,
      environment,
      materials,
      mall: { poly: mallPoly, inMall, center: centroid(structure.outer) },
      flights: collectFlights(svg, inMall),
      buildingsInside: buildings.filter((b) => inMall(centroid(b.outer))),
      buildingsOutside: buildings.filter((b) => !inMall(centroid(b.outer))),
      planUv: { PARKING: planUv(projection, mallCrop), LEVEL1: planUv(projection, mallCrop), LEVEL2: planUv(projection, mallCrop) },
      props: propModels(),
      cars: vehicleModels(),
      game2: (p) => ({ x: -p.x, z: p.z }),
      mapData: this.mapData,
      anisotropy,
      icProps: interchangeModels(),
    };
    this.ctx = ctx;

    const { width: W, height: H } = this.mapData.map.svg;
    rasterSvg(svgDoc, { layers: ['Ground_Level'], css: CSS_GROUND, crop: { x: 0, y: 0, w: W, h: H }, pxPerUnit: 3.4, anisotropy })
      .then(({ texture }) => {
        materials.ground.map = texture;
        materials.ground.color.set(0xffffff);
        materials.ground.needsUpdate = true;
      })
      .catch((e) => console.warn('[interchange] ground texture', e));
    for (const [id, layer] of Object.entries({ PARKING: 'Ground_Level', LEVEL1: 'First_Floor', LEVEL2: 'Second_Floor' })) {
      rasterSvg(svgDoc, { layers: [layer], css: CSS_PLAN, crop: mallCrop, pxPerUnit: 5, anisotropy })
        .then(({ texture }) => {
          materials.plan[id].map = texture;
          materials.plan[id].needsUpdate = true;
        })
        .catch((e) => console.warn(`[interchange] ${id} plan texture`, e));
    }

    this.street = buildStreet(ctx);
    this.root.add(this.street.group);
    try {
      const vegetation = await buildVegetation(ctx, this.street.props);
      this.street.layers.push(...vegetation.layers);
      this.street.stats.vegetation = vegetation.stats;
    } catch (e) {
      console.warn('[interchange] vegetation', e);
    }
    this.flights = buildFlightMeshes(ctx.flights, this.heights, materials);
    for (const f of this.flights) this.root.add(f.mesh);
    this.ready = true;
    this.applyFlags();
    this.setMode(this.mode);

    const kinds = {};
    for (const f of ctx.flights) kinds[`${f.kind}:${f.lowerId}->${f.upperId}`] = (kinds[`${f.kind}:${f.lowerId}->${f.upperId}`] || 0) + 1;
    return { ms: Math.round(performance.now() - t0), flights: kinds, street: this.street.stats, buildingsInside: ctx.buildingsInside.length };
  }

  ensureLevel(id) {
    if (!this.levels.has(id) && BUILDERS[id]) {
      const t = performance.now();
      const built = BUILDERS[id](this.ctx);
      built.group.visible = false;
      built.walls.scale.y = this.wallScale;
      this.root.add(built.group);
      this.levels.set(id, built);
      this.applyFlags();
      console.info(`[interchange] ${id} built in ${Math.round(performance.now() - t)} ms`, built.stats);
    }
    return this.levels.get(id) || null;
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.ready) return;
    const street = this.mapData.defaultFloor;
    const view = levelViewFor(this.mapData, mode);
    const offset = (id) => (view && view.exploded ? view.offsetFor(id) : 0);
    this.street.group.visible = mode === street;
    for (const id of buildingFloors(this.mapData)) {
      const show = mode !== street && view.visible.has(id);
      const level = show ? this.ensureLevel(id) : this.levels.get(id);
      if (!level) continue;
      level.group.visible = show;
      level.group.position.y = this.heights[id] + offset(id);
    }
    for (const f of this.flights) {
      const { lowerId, upperId } = f.flight;
      // several levels at once (Mall, All floors): flights between two shown levels; one level: its flights up and down
      const show = view.visible.size > 1 ? view.visible.has(lowerId) && view.visible.has(upperId) : mode === lowerId || mode === upperId;
      f.mesh.visible = show;
      if (!show) continue;
      const lowY = this.heights[lowerId] + offset(lowerId);
      const highY = this.heights[upperId] + offset(upperId);
      f.mesh.position.y = lowY;
      f.mesh.scale.y = Math.max(0.1, highY - lowY);
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
    const all = [this.street, ...this.levels.values()].filter(Boolean);
    for (const part of all) {
      if (part.cars) part.cars.visible = this.flags.vehicles;
      if (part.props) part.props.visible = this.flags.streetProps;
    }
  }

  update(dt, camera) {
    if (!this.ready) return;
    const position = camera.position;
    const parts = [this.street, ...this.levels.values()];
    for (const part of parts) {
      if (!part || !part.group.visible) continue;
      for (const layer of part.layers) layer.update(position);
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    if (this.materials) {
      for (const m of Object.values(this.materials)) {
        if (m && m.dispose) {
          if (m.map) m.map.dispose();
          m.dispose();
        } else if (m) {
          for (const sub of Object.values(m)) {
            if (sub.map) sub.map.dispose();
            sub.dispose();
          }
        }
      }
    }
    this.scene.remove(this.root);
  }
}
