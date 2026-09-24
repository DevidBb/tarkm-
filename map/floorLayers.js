// Floor planes: each floor is a horizontal plane textured with its own layer of the Streets SVG
// (Ground_Level, First_Floor ... Fifth_Floor, Underground_Level), stacked at its height.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { FLOOR_ORDER } from '../services/coords.js';
import { noiseCanvas } from './city/textures.js';

const HIGH_RES = 4096; // active floor
const LOW_RES = 1536; // context floors

// With the 3D city on, the street level is drawn in material colors (asphalt, pavement, grass, gravel)
// instead of the schematic palette; hazard zones keep their red so they stay readable.
const REALISTIC_GROUND_CSS = '.tarmac{fill:#4b4d4f}.cement{fill:#8f8c85}.land{fill:#5a653f}.gravel{fill:#6e5e48}.building{fill:#343532}.fence{stroke:#77776f}.map_border{stroke:#111}';

// How visible every floor plane is while `active` is selected.
export function floorOpacities(active) {
  const o = Object.fromEntries(FLOOR_ORDER.map((id) => [id, 0]));
  o[active] = 1;
  if (active === 'UNDERGROUND') {
    o.GROUND = 0.1;
  } else if (active === '1F') {
    o.GROUND = 0.4;
  } else if (active !== 'GROUND') {
    o.GROUND = 0.28;
    const below = FLOOR_ORDER[FLOOR_ORDER.indexOf(active) - 1];
    if (below !== 'GROUND') o[below] = 0.3;
  }
  return o;
}

function layerImageUrl(svgDoc, layerId, width, height, extraCss = null) {
  const src = svgDoc.documentElement;
  const root = src.cloneNode(false);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('preserveAspectRatio', 'none');
  for (const child of Array.from(src.children)) {
    if (child.localName === 'g' && child.getAttribute('id') !== layerId) continue; // keep <style>, <defs>, this layer
    root.appendChild(child.cloneNode(true));
  }
  if (extraCss) {
    const style = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = extraCss;
    root.appendChild(style);
  }
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG layer failed to rasterize'));
    img.src = url;
  });
}

export class FloorLayers {
  constructor(scene, mapData, renderer) {
    this.mapData = mapData;
    this.svgDoc = null;
    this.maxTexture = renderer.capabilities.maxTextureSize;
    this.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.group = new THREE.Group();
    this.planes = new Map();
    this.realistic = false;
    this.styleVersion = 0;
    this.activeId = 'GROUND';
    scene.add(this.group);

    const { projection } = mapData;
    const geometry = new THREE.PlaneGeometry(projection.width, projection.depth);
    geometry.rotateX(-Math.PI / 2); // lie flat; image top -> scene -Z (game z = topLeft.z)

    FLOOR_ORDER.forEach((id, order) => {
      const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(projection.center.x, projection.floorPlaneY(id), projection.center.z);
      mesh.renderOrder = order;
      mesh.visible = false;
      this.group.add(mesh);
      this.planes.set(id, { id, mesh, material, res: 0, loadingRes: 0, target: 0 });
    });
  }

  setSvg(svgDoc) {
    this.svgDoc = svgDoc;
  }

  setRealistic(on) {
    if (this.realistic === on) return;
    this.realistic = on;
    this.styleVersion += 1;
    const plane = this.planes.get('GROUND');
    plane.res = 0;
    plane.loadingRes = 0;
    if (plane.target > 0) this.ensureTexture(plane, this.activeId === 'GROUND' ? HIGH_RES : LOW_RES);
  }

  setActive(activeId) {
    this.activeId = activeId;
    const opacities = floorOpacities(activeId);
    for (const plane of this.planes.values()) {
      plane.target = opacities[plane.id];
      if (plane.target > 0) {
        this.ensureTexture(plane, plane.id === activeId ? HIGH_RES : LOW_RES);
      } else if (plane.res > LOW_RES && plane.material.map) {
        plane.material.map.dispose(); // free the big texture of floors we left
        plane.material.map = null;
        plane.res = 0;
      }
    }
  }

  async ensureTexture(plane, wanted) {
    if (!this.svgDoc) return;
    const res = Math.min(wanted, this.maxTexture);
    if (plane.res >= res || plane.loadingRes >= res) return;
    plane.loadingRes = res;
    const version = this.styleVersion;
    const realistic = this.realistic && plane.id === 'GROUND';
    try {
      const { width: svgW, height: svgH } = this.mapData.map.svg;
      const height = res;
      const width = Math.round((res * svgW) / svgH);
      const img = await loadImage(layerImageUrl(this.svgDoc, this.svgLayerOf(plane.id), width, height, realistic ? REALISTIC_GROUND_CSS : null));
      if (plane.res >= res || version !== this.styleVersion) return; // a sharper or restyled texture won meanwhile
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      if (realistic) {
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = ctx.createPattern(noiseCanvas(256), 'repeat');
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.anisotropy;
      if (plane.material.map) plane.material.map.dispose();
      plane.material.map = texture;
      plane.material.needsUpdate = true;
      plane.res = res;
    } catch (err) {
      console.error(`[floors] ${plane.id}:`, err);
    } finally {
      if (plane.loadingRes === res) plane.loadingRes = 0;
    }
  }

  svgLayerOf(floorId) {
    const floor = this.mapData.floors.find((f) => f.id === floorId);
    return floor ? floor.svgLayer : null;
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 8);
    for (const plane of this.planes.values()) {
      const target = plane.material.map ? plane.target : 0;
      plane.material.opacity += (target - plane.material.opacity) * k;
      plane.mesh.visible = plane.material.opacity > 0.01;
    }
  }
}
