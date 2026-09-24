// 3D city layer: built after the SVG map loads, on top of the existing floor planes and markers.
// - buildings are cut above the selected floor with a clipping plane, so floor plans stay visible;
// - filters switch buildings / vehicles / street furniture;
// - every frame, instanced cells switch between near (detailed) and far (simplified or hidden) by distance.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { FLOOR_DISPLAY_Y } from '../../services/coords.js';
import { buildCityModel } from './cityModel.js';
import { buildBuildings } from './buildingMeshes.js';
import { buildVehicles } from './vehicles.js';
import { buildStreetProps } from './streetProps.js';
import { propModels } from './models.js';

const CUT_ABOVE_FLOOR = 2.6;
const NO_CUT = 1000;
// Yield to the browser between build phases. setTimeout, not requestAnimationFrame: rAF is paused in
// background tabs and would stall the build.
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

export class CityLayer {
  constructor(scene, mapData, renderer) {
    this.mapData = mapData;
    this.renderer = renderer;
    renderer.localClippingEnabled = true;
    this.plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), NO_CUT);
    this.clippingPlanes = [this.plane];
    this.cut = NO_CUT;
    this.targetCut = NO_CUT;
    this.root = new THREE.Group();
    this.root.name = 'city';
    this.groups = { buildings: new THREE.Group(), vehicles: new THREE.Group(), street: new THREE.Group() };
    for (const g of Object.values(this.groups)) this.root.add(g);
    scene.add(this.root);
    this.layers = { buildings: [], vehicles: [], street: [] };
    this.flags = { buildings: true, cityModels: true, vehicles: true, streetProps: true };
    this.ready = false;
    this.stats = null;
  }

  // environment: streets.environment.json or null (the city still builds from the SVG alone).
  async build(svgDoc, environment = null) {
    const t0 = performance.now();
    const timings = {};
    let mark = performance.now();
    const lap = (name) => {
      const now = performance.now();
      timings[name] = Math.round(now - mark);
      mark = now;
    };
    lap('fetch');
    const city = buildCityModel({ svgDoc, mapData: this.mapData, environment });
    lap('model');
    await nextFrame();
    mark = performance.now();
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const props = propModels();
    const propMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, clippingPlanes: this.clippingPlanes });
    const common = { clippingPlanes: this.clippingPlanes, anisotropy, props, propMaterial };
    lap('props');
    const buildings = buildBuildings(city, { ...common, parent: this.groups.buildings });
    lap('buildings');
    await nextFrame();
    mark = performance.now();
    const vehicles = buildVehicles(city, environment, { ...common, parent: this.groups.vehicles });
    lap('vehicles');
    await nextFrame();
    mark = performance.now();
    const street = buildStreetProps(city, environment, { ...common, parent: this.groups.street });
    lap('street');
    this.timings = timings;

    this.city = city;
    this.vehicles = vehicles;
    this.wires = street.wires;
    this.layers = { buildings: buildings.layers, vehicles: vehicles.layers, street: street.layers };
    const kinds = {};
    for (const b of city.buildings) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
    this.stats = {
      ms: Math.round(performance.now() - t0),
      timings,
      buildings: city.buildings.length,
      volumes: city.buildings.reduce((s, b) => s + b.volumes.length, 0),
      kinds,
      heightsFromData: city.buildings.filter((b) => !b.estimated).length,
      signs: city.buildings.reduce((s, b) => s + b.signs.length, 0),
      vehicles: vehicles.stats,
      street: street.counts,
      environment: Boolean(environment),
    };
    this.ready = true;
    this.applyFlags();
    return this.stats;
  }

  setActive(floorId) {
    if (floorId === 'GROUND') this.targetCut = NO_CUT;
    else if (floorId === 'UNDERGROUND') this.targetCut = FLOOR_DISPLAY_Y.GROUND - 0.3;
    else this.targetCut = FLOOR_DISPLAY_Y[floorId] + CUT_ABOVE_FLOOR;
  }

  setFlags(flags) {
    this.flags = { ...this.flags, ...flags };
    this.applyFlags();
  }

  applyFlags() {
    this.groups.buildings.visible = this.flags.buildings !== false && this.flags.cityModels !== false;
    this.groups.vehicles.visible = this.flags.vehicles !== false;
    this.groups.street.visible = this.flags.streetProps !== false;
  }

  get showsBuildings() {
    return this.ready && this.groups.buildings.visible;
  }

  update(dt, camera, target) {
    if (!this.ready) return;
    const k = 1 - Math.exp(-dt * 6);
    if (this.targetCut >= NO_CUT) {
      this.cut = this.cut >= 70 ? NO_CUT : this.cut + (80 - this.cut) * k;
    } else {
      const from = Math.min(this.cut, 70);
      this.cut = from + (this.targetCut - from) * k;
    }
    this.plane.constant = this.cut;

    const position = camera.position;
    for (const [group, list] of Object.entries(this.layers)) {
      const visible = this.groups[group === 'street' ? 'street' : group].visible;
      if (!visible) continue;
      for (const layer of list) layer.update(position);
    }
    if (this.wires) this.wires.visible = position.distanceTo(target) < 650;
  }
}
