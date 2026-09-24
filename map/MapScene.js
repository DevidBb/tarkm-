// 3D map scene: renderer, camera + orbit controls, floor planes, building volumes, markers.
// Imperative on purpose - React components drive it through this small API.
// To plug in a real 3D model later, add a GLB layer next to FloorLayers/Buildings using the same projection.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js/+esm';
import { CSS2DRenderer } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/renderers/CSS2DRenderer.js/+esm';
import { FloorLayers } from './floorLayers.js';
import { Buildings } from './buildings.js';
import { MarkerLayer } from './markers.js';
import { LootLayer } from './loot.js';
import { CityLayer } from './city/CityLayer.js';
import { Navigator } from './navigation.js';
import { levelViewFor, levelCamera } from '../services/levels.js';

// Overcast haze: the 3D city fades into it at low camera angles instead of a black void.
const SKY_COLOR = 0x5a636a;

export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export class MapScene {
  constructor(container, mapData, { onSelect, onRoute }) {
    this.container = container;
    this.mapData = mapData;
    // 'city' (Streets: floor planes + 3D city) or 'interchange' (separate street / mall-level models).
    this.kind = mapData.kind || 'city';
    this.activeFloor = mapData.defaultFloor || 'GROUND';
    this.wallMode = 'full';
    this.flight = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(SKY_COLOR, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'viewport__webgl';
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'viewport__labels';
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SKY_COLOR, 900, 3200);
    this.scene.add(new THREE.HemisphereLight(0xeef0dc, 0x1c2117, 1.7));
    const sun = new THREE.DirectionalLight(0xfff0d2, 1.1);
    sun.position.set(-300, 700, -200);
    this.scene.add(sun);
    if ((mapData.kind || 'city') !== 'city') {
      // The Interchange model can be viewed from below: a soft light from underneath keeps slab undersides readable.
      const under = new THREE.DirectionalLight(0xd9ddd0, 0.85);
      under.position.set(200, -600, 250);
      this.scene.add(under);
    }

    const { center } = mapData.projection;
    const baseY = this.kind === 'city' ? 0 : mapData.projection.groundY;
    this.home = {
      target: new THREE.Vector3(center.x, baseY, center.z),
      position: new THREE.Vector3(center.x + 140, baseY + 900, center.z + 640),
    };
    if (mapData.map.home) {
      // Small maps (Factory) set their own home view: target in scene meters + camera offset from it.
      const { target, offset } = mapData.map.home;
      this.home.target.set(target[0], baseY + target[1], target[2]);
      this.home.position.set(target[0] + offset[0], baseY + target[1] + offset[1], target[2] + offset[2]);
    }
    this.camera = new THREE.PerspectiveCamera(42, 1, this.kind === 'city' ? 1 : 0.5, 8000);
    this.camera.position.copy(this.home.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.home.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = false; // pan along the ground
    this.controls.minDistance = 25;
    this.controls.maxDistance = 1700;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.addEventListener('start', () => { this.flight = null; });
    if (this.kind !== 'city') {
      // Look at the model from any side, from below too, and get close inside the mall.
      this.controls.maxPolarAngle = Math.PI;
      this.controls.minDistance = 3;
      this.controls.zoomToCursor = true;
    }
    this.controls.update();

    this.floors = this.kind === 'city' ? new FloorLayers(this.scene, mapData, this.renderer) : null;
    this.buildings = this.kind === 'city' ? new Buildings(this.scene, mapData) : null;
    this.markers = new MarkerLayer(this.scene, mapData, { onSelect, onRoute });
    this.navigator = null;
    this.loot = new LootLayer(this.scene, mapData);
    this.city = this.kind === 'city' ? new CityLayer(this.scene, mapData, this.renderer) : null;
    this.levels = null;
    this.filters = null;
    if (this.kind !== 'city') this.applyLevelView(this.activeFloor);

    // A click (not a drag) on the canvas selects the nearest visible loot point.
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (ev) => { this.pressAt = ev.button === 0 ? { x: ev.clientX, y: ev.clientY } : null; });
    canvas.addEventListener('pointerup', (ev) => {
      const press = this.pressAt;
      this.pressAt = null;
      if (!press || Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 5) return;
      const rect = canvas.getBoundingClientRect();
      const hit = this.loot.pick(ev.clientX - rect.left, ev.clientY - rect.top, this.camera, rect.width, rect.height);
      if (hit) onSelect(hit.id);
    });

    this.clock = new THREE.Clock();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  async load() {
    const res = await fetch(this.mapData.svgUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`SVG-карта не загрузилась (HTTP ${res.status}).`);
    const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('SVG-карта повреждена. Перезапустите scripts\\update_data.ps1.');
    if (this.kind === 'city') {
      this.floors.setSvg(doc);
      this.buildings.build(doc);
      this.setFloor(this.activeFloor);
    }
    let environment = null;
    try {
      const envRes = await fetch(this.mapData.environmentUrl, { cache: 'no-store' });
      if (envRes.ok) environment = await envRes.json();
    } catch {
      environment = null; // optional: city and routes still build from the SVG alone
    }
    if (this.kind !== 'city') {
      await this.loadLevels(doc, environment);
      return;
    }
    this.city.build(doc, environment)
      .then((stats) => {
        console.info('[city]', stats);
        this.syncBuildings();
      })
      .catch((err) => console.error('[city] build failed, schematic buildings stay on', err));
    Navigator.build({ svgDoc: doc, mapData: this.mapData, environment })
      .then((nav) => {
        console.info('[nav]', nav.stats);
        this.navigator = nav;
        this.markers.setNavigator(nav);
      })
      .catch((err) => console.error('[nav] build failed, routes stay straight lines', err));
  }

  // Interchange: the 3D model module is fetched only now, when this map is opened.
  async loadLevels(doc, environment) {
    let LevelLayer;
    if (this.kind === 'shoreline') LevelLayer = (await import('./shoreline/ShorelineLayer.js')).ShorelineLayer;
    else if (this.kind === 'factory') LevelLayer = (await import('./factory/FactoryLayer.js')).FactoryLayer;
    else if (this.kind === 'customs') LevelLayer = (await import('./customs/CustomsLayer.js')).CustomsLayer;
    else LevelLayer = (await import('./interchange/InterchangeLayer.js')).InterchangeLayer;
    if (this.disposed) return;
    this.levels = new LevelLayer(this.scene, this.mapData, this.renderer);
    const stats = await this.levels.build(doc, environment);
    if (this.disposed) return;
    console.info(`[${this.kind}]`, JSON.stringify(stats));
    this.levels.setMode(this.activeFloor);
    this.levels.setWallMode(this.wallMode);
    if (this.filters) this.levels.setFlags(this.filters);
  }

  setFloor(floorId) {
    const previous = this.activeFloor;
    this.activeFloor = floorId;
    if (this.kind === 'city') {
      this.floors.setActive(floorId);
      this.buildings.setActive(floorId);
      this.city.setActive(floorId);
      return;
    }
    this.applyLevelView(floorId);
    if (this.levels) this.levels.setMode(floorId);
    if (previous !== floorId) this.flyToLevel(floorId);
  }

  // Multi-level maps: markers and loot follow the selected level (and the exploded offsets of "All floors").
  applyLevelView(mode) {
    const view = levelViewFor(this.mapData, mode);
    this.markers.setLevelView(view);
    this.loot.setLevelView(view);
  }

  flyToLevel(mode) {
    const cam = levelCamera(this.mapData, mode);
    if (!cam) {
      this.resetView();
      return;
    }
    this.startFlight(new THREE.Vector3(cam.target.x, cam.target.y, cam.target.z), new THREE.Vector3(cam.position.x, cam.position.y, cam.position.z));
  }

  // Hidden behind the evaluation screen: skip rendering until shown again.
  setPaused(paused) {
    this.paused = paused;
    if (!paused) this.resize();
  }

  setWallMode(mode) {
    this.wallMode = mode;
    if (this.levels) this.levels.setWallMode(mode);
  }

  applyVisibility(floorId, filters) {
    this.filters = filters;
    this.markers.applyVisibility({ floor: floorId, filters });
    this.loot.applyVisibility({ floor: floorId, filters });
    if (this.kind !== 'city') {
      if (this.levels) this.levels.setFlags(filters);
      return;
    }
    this.city.setFlags({
      buildings: filters.buildings !== false,
      cityModels: filters.cityModels !== false,
      vehicles: filters.vehicles !== false,
      streetProps: filters.streetProps !== false,
    });
    this.syncBuildings();
  }

  // Schematic shells show while the 3D city is building, if it failed, or when 3D models are switched off.
  syncBuildings() {
    if (!this.city) return;
    const f = this.filters || {};
    this.buildings.setVisible(f.buildings !== false && (f.cityModels === false || !this.city.ready));
    this.floors.setRealistic(this.city.ready && f.cityModels !== false);
  }

  setSelected(id) { this.markers.setSelected(id); }
  setPlayer(result) { this.markers.setPlayer(result); }
  setCandidates(candidates) { this.markers.setCandidates(candidates); }
  setQuestPoints(entities) { this.markers.setQuestPoints(entities); }

  // Fly so that all given game positions are in view.
  fitPositions(positions, minDistance = 140) {
    if (!positions.length) return;
    const pts = positions.map((p) => this.mapData.projection.gameToScene(p));
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const center = new THREE.Vector3((minX + maxX) / 2, Math.min(...pts.map((p) => p.y)), (minZ + maxZ) / 2);
    this.flyTo(center, Math.max(minDistance, Math.max(maxX - minX, maxZ - minZ) * 1.5));
  }

  flyTo(anchor, distance = 180) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1) dir.set(0.3, 1, 0.7);
    dir.normalize();
    if (dir.y < 0.6) { dir.y = 0.6; dir.normalize(); } // keep a readable top-down tilt
    this.startFlight(anchor.clone(), anchor.clone().add(dir.multiplyScalar(distance)));
  }

  flyToEntity(id, distance) {
    const anchor = this.markers.anchorById(id);
    if (anchor) this.flyTo(anchor, distance);
  }

  flyToPlayer(distance = 150) {
    const r = this.markers.playerResult;
    if (r) this.flyTo(this.markers.playerAnchor(r), distance);
  }

  resetView() {
    this.startFlight(this.home.target.clone(), this.home.position.clone());
  }

  startFlight(toTarget, toPosition) {
    this.flight = { fromTarget: this.controls.target.clone(), fromPosition: this.camera.position.clone(), toTarget, toPosition, t: 0 };
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.paused) return;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / 0.9);
      const e = 1 - Math.pow(1 - f.t, 3);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      this.camera.position.lerpVectors(f.fromPosition, f.toPosition, e);
      if (f.t >= 1) this.flight = null;
    }
    this.controls.update();
    this.updateZoomClass();
    if (this.floors) this.floors.update(dt);
    if (this.buildings) this.buildings.update(dt);
    if (this.city) this.city.update(dt, this.camera, this.controls.target);
    if (this.levels) this.levels.update(dt, this.camera);
    this.markers.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  // Declutter labels by camera distance: far = dots only, mid = place names, near = everything.
  updateZoomClass() {
    const d = this.camera.position.distanceTo(this.controls.target);
    const zoom = d > 650 ? 'zoom-far' : d > 320 ? 'zoom-mid' : 'zoom-near';
    if (zoom === this.zoomClass) return;
    const el = this.labels.domElement;
    if (this.zoomClass) el.classList.remove(this.zoomClass);
    el.classList.add(zoom);
    this.zoomClass = zoom;
    this.loot.setZoom(zoom);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.markers.setResolution(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.loot.dispose();
    if (this.levels) this.levels.dispose();
    this.renderer.dispose();
    this.container.replaceChildren();
  }
}
