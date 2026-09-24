// Loot spawn points (~2600): drawn as WebGL point sprites instead of HTML markers, one Points object
// per (category, floor band) so filters and floor changes only flip visibility. Clicks are picked in screen space.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { bandOf, sameBand } from '../services/coords.js';
import { lootCategory } from '../services/markerTypes.js';

const SIZES = { 'zoom-far': 5, 'zoom-mid': 7, 'zoom-near': 11 };
const PICK_RADIUS = 12;
const OFF_FLOOR_PENALTY = 6;

function dotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  // Square with a dark rim: round dots on the map are HTML markers (locks, hazards), squares are loot.
  ctx.fillStyle = '#0b0d0a';
  ctx.fillRect(6, 6, 52, 52);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(14, 14, 36, 36);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class LootLayer {
  constructor(scene, mapData) {
    this.mapData = mapData;
    this.group = new THREE.Group();
    this.texture = dotTexture();
    this.buckets = [];
    const byKey = new Map();
    for (const e of mapData.loot) {
      const band = e.floor ? bandOf(mapData.floors, e.floor) : null;
      const key = `${e.meta.category}|${band}`;
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = { category: e.meta.category, band, entities: [], positions: [], onFloor: true };
        byKey.set(key, bucket);
      }
      const s = mapData.projection.gameToScene(e.position);
      bucket.entities.push(e);
      bucket.positions.push(new THREE.Vector3(s.x, s.y + 1, s.z));
    }
    for (const bucket of byKey.values()) {
      const category = lootCategory(bucket.category);
      const material = new THREE.PointsMaterial({
        color: new THREE.Color(category ? category.color : '#cccccc'),
        map: this.texture,
        size: SIZES['zoom-mid'],
        sizeAttenuation: false,
        transparent: true,
        alphaTest: 0.2,
        depthTest: false,
        depthWrite: false,
      });
      bucket.points = new THREE.Points(new THREE.BufferGeometry().setFromPoints(bucket.positions), material);
      bucket.points.renderOrder = 30;
      bucket.points.visible = false;
      this.group.add(bucket.points);
      this.buckets.push(bucket);
    }
    scene.add(this.group);
  }

  // Multi-level maps: loot of hidden levels is not drawn; in "All floors" each level's points are lifted.
  setLevelView(view) {
    this.levelView = view;
    for (const b of this.buckets) b.points.position.y = view && b.band ? view.offsetFor(b.band) : 0;
    if (this.visibilityState) this.applyVisibility(this.visibilityState);
  }

  applyVisibility({ floor, filters }) {
    this.visibilityState = { floor, filters };
    const lv = this.levelView;
    for (const b of this.buckets) {
      b.onFloor = b.band == null || (lv ? lv.visible.has(b.band) : sameBand(this.mapData.floors, b.band, floor));
      b.points.visible = Boolean(filters.loot && filters[`loot_${b.category}`]) && (b.onFloor || (!lv && !filters.onlyCurrentFloor));
      b.points.material.opacity = b.onFloor ? 1 : 0.25;
    }
  }

  setZoom(zoom) {
    const size = SIZES[zoom] || SIZES['zoom-mid'];
    for (const b of this.buckets) b.points.material.size = size;
  }

  // Nearest visible loot point to a canvas pixel, within PICK_RADIUS. Points on the active floor win ties.
  pick(x, y, camera, width, height) {
    const v = new THREE.Vector3();
    let best = null;
    let bestScore = PICK_RADIUS;
    for (const b of this.buckets) {
      if (!b.points.visible) continue;
      const penalty = b.onFloor ? 0 : OFF_FLOOR_PENALTY;
      for (let i = 0; i < b.positions.length; i += 1) {
        v.copy(b.positions[i]);
        v.y += b.points.position.y;
        v.project(camera);
        if (v.z > 1) continue;
        const score = Math.hypot((v.x + 1) / 2 * width - x, (1 - v.y) / 2 * height - y) + penalty;
        if (score < bestScore) {
          bestScore = score;
          best = b.entities[i];
        }
      }
    }
    return best;
  }

  dispose() {
    for (const b of this.buckets) {
      b.points.geometry.dispose();
      b.points.material.dispose();
    }
    this.texture.dispose();
  }
}
