// Textures for the Interchange model: SVG layers rasterized in material colors (the floor plans and the ground),
// cropped to the part of the map that uses them, plus a world-UV mapper for slabs.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const CSS_GROUND = [
  '.land{fill:#56613f}', '.rock{fill:#a0977a}', '.water{fill:#3a5566}', '.cement{fill:#8e8b84}', '.gravel{fill:#6e5e48}',
  '.building{fill:#3a3b38}', '.structure{fill:#4e4d49}', '.road_tarmac{stroke:#4a4c4e}', '.road_gravel{stroke:#6e5e48}',
  '.railroad{stroke:#4d4036;stroke-dasharray:none}', '.powerline{stroke:none}', '.fence{stroke:none}',
  '.danger{fill:#b3261e;fill-opacity:.16;stroke:#b3261e;stroke-opacity:.45}', '.map_border{stroke:#121212}', '.shadow{filter:none}',
].join('');

export const CSS_PLAN = [
  '.floor{fill:#bdb7ab}', '.cement{fill:#9c9990}', '.building{fill:#2c2d2b}', '.structure{fill:#30312f}', '.shadow{filter:none}',
  '.road_tarmac{stroke:#7d7f80}', '.land{fill:#3d4535}', '.water{fill:#3a5566}', '.rock{fill:#8e866d}', '.railroad{stroke:none}',
  '.powerline{stroke:none}', '.fence{stroke:none}', '.danger{fill:none;stroke:none}', '.map_border{stroke:none}',
].join('');

// Vegetation mask: open land white, everything else (roads, pavement, gravel, rocks, water, buildings, rails,
// fences) black. Stroke widths stay as the SVG styles them.
export const CSS_MASK = [
  '*{stroke:#000!important}',
  '.water,.water *,.structure,.structure *,.rock,.rock *,.cement,.cement *,.building,.building *,.floor,.floor *{fill:#000!important}',
  '.road_gravel,.road_gravel *{fill:#000!important}',
  '.land,.land *{fill:#fff!important;stroke:none!important}',
  '.map_border,.map_border *,.danger,.danger *{fill:none!important;stroke:none!important}',
  '.powerline,.powerline *{stroke:none!important}', '.shadow{filter:none!important}',
].join('');

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG layer failed to rasterize'));
    img.src = url;
  });
}

// crop: {x, y, w, h} in SVG units. Resolves { texture, crop }.
export async function rasterSvg(svgDoc, { layers, css, crop, pxPerUnit = 4, maxSize = 4096, anisotropy = 4 }) {
  const { canvas } = await rasterCanvas(svgDoc, { layers, css, crop, pxPerUnit, maxSize });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return { texture, crop };
}

// Pixels of rasterized layers for sampling: { data, width, height, crop, scale (px per SVG unit) }.
export async function rasterMask(svgDoc, { layers, css, crop, pxPerUnit = 1, maxSize = 2048 }) {
  const { canvas, scale } = await rasterCanvas(svgDoc, { layers, css, crop, pxPerUnit, maxSize });
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  return { data, width: canvas.width, height: canvas.height, crop, scale };
}

async function rasterCanvas(svgDoc, { layers, css, crop, pxPerUnit, maxSize }) {
  const scale = Math.min(pxPerUnit, maxSize / crop.w, maxSize / crop.h);
  const width = Math.max(1, Math.round(crop.w * scale));
  const height = Math.max(1, Math.round(crop.h * scale));
  const src = svgDoc.documentElement;
  const root = src.cloneNode(false);
  root.setAttribute('viewBox', `${crop.x} ${crop.y} ${crop.w} ${crop.h}`);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('preserveAspectRatio', 'none');
  for (const child of Array.from(src.children)) {
    if (child.localName === 'g' && !layers.includes(child.getAttribute('id'))) continue;
    root.appendChild(child.cloneNode(true));
  }
  const style = svgDoc.createElementNS(SVG_NS, 'style');
  style.textContent = css;
  root.appendChild(style);
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d', { willReadFrequently: false }).drawImage(img, 0, 0, width, height);
  return { canvas, scale: width / crop.w };
}

// Facade tiles (512 px). "body": mall walls from the first floor to the roof, v = 0..1 over that height —
// shop-front glazing, panel bands, a ribbon of windows, cornice. "podium": the garage level — concrete with
// ventilation slots. Pattern is a stylization (no facade drawings in open data).
export function facadeTexture(kind, anisotropy = 4) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  let seed = kind === 'body' ? 11 : 23;
  const r = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const band = (v0, v1, col) => {
    g.fillStyle = col;
    g.fillRect(0, S - v1 * S, S, (v1 - v0) * S);
  };
  if (kind === 'body') {
    band(0, 1, '#cdc7b9');
    band(0, 0.24, '#303d44');
    for (let x = 0; x <= S; x += 64) { g.fillStyle = '#6d7173'; g.fillRect(x - 3, S - 0.24 * S, 6, 0.24 * S); }
    band(0.24, 0.28, '#8c877d');
    band(0.52, 0.64, '#35434a');
    for (let x = 0; x <= S; x += 43) { g.fillStyle = '#7b7f80'; g.fillRect(x - 2, S - 0.64 * S, 4, 0.12 * S); }
    band(0.94, 1, '#77726a');
    g.strokeStyle = 'rgba(120,114,102,0.55)';
    g.lineWidth = 2;
    for (const v of [0.4, 0.8]) { g.beginPath(); g.moveTo(0, S - v * S); g.lineTo(S, S - v * S); g.stroke(); }
    for (let x = 0; x <= S; x += 128) { g.beginPath(); g.moveTo(x, S - 0.94 * S); g.lineTo(x, S - 0.28 * S); g.stroke(); }
    g.fillStyle = '#b8b2a4';
    g.fillRect(0, S * 0.06, 16, S * 0.66);
  } else {
    band(0, 1, '#8e8a81');
    band(0, 0.08, '#6f6c65');
    for (let x = 16; x < S; x += 128) { g.fillStyle = '#262827'; g.fillRect(x, S - 0.8 * S, 96, 0.35 * S); }
    for (let x = 0; x <= S; x += 128) { g.fillStyle = '#7d7970'; g.fillRect(x - 6, 0, 12, S); }
    band(0.92, 1, '#77736b');
  }
  for (let i = 0; i < 70; i += 1) {
    g.fillStyle = `rgba(60,55,45,${0.04 + r() * 0.08})`;
    g.fillRect(r() * S, r() * S * 0.35, 2 + r() * 6, 40 + r() * 220);
  }
  for (let i = 0; i < 5000; i += 1) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
    g.fillRect(r() * S, r() * S, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = anisotropy;
  return t;
}

// Scene x/z -> uv inside a raster crop.
export function planUv(projection, crop) {
  return (x, z) => {
    const s = projection.sceneToSvg ? projection.sceneToSvg({ x, z }) : null; // rotated maps (Factory)
    const u = s ? s.x : (x - projection.sceneLeft) / projection.svgScaleX;
    const v = s ? s.y : (z - projection.sceneTop) / projection.svgScaleZ;
    return [(u - crop.x) / crop.w, 1 - (v - crop.y) / crop.h];
  };
}
