// Procedural textures of the Customs model. Facades are a stylization (no facade drawings in open data). One tile is
// 12.8 m wide and 12.4 m high (4 window bays x 4 storeys), the same convention as the city facades, so facadeRing()
// maps them 1:1 in meters.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';

const S = 512;
const PX = S / 12.8; // pixels per meter across
const PY = S / 12.4; // pixels per meter up
const cache = new Map();

function rand(seed) {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function canvas(w = S, h = S) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(key, c, anisotropy, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = anisotropy;
  cache.set(key, t);
  return t;
}

function grime(g, r, n = 5000) {
  for (let i = 0; i < n; i += 1) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
    g.fillRect(r() * S, r() * S, 2, 2);
  }
  // dirt from the ground and streaks from the roof
  const grad = g.createLinearGradient(0, S, 0, S - 1.2 * PY);
  grad.addColorStop(0, 'rgba(60,50,38,0.45)');
  grad.addColorStop(1, 'rgba(60,50,38,0)');
  g.fillStyle = grad;
  g.fillRect(0, S - 1.2 * PY, S, 1.2 * PY);
  for (let i = 0; i < 26; i += 1) {
    g.fillStyle = `rgba(55,48,40,${0.04 + r() * 0.1})`;
    g.fillRect(r() * S, 0, 2 + r() * 6, S * (0.2 + r() * 0.6));
  }
}

function bricks(g, x0, y0, w, h, r, base, spread, mortar, bw = 10, bh = 4) {
  g.fillStyle = mortar;
  g.fillRect(x0, y0, w, h);
  for (let y = y0; y < y0 + h; y += bh) {
    const off = ((y - y0) / bh) % 2 ? bw / 2 : 0;
    for (let x = x0 - off; x < x0 + w; x += bw) {
      const k = 1 + (r() - 0.5) * spread;
      g.fillStyle = `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
      g.fillRect(x + 1, y + 1, bw - 1, bh - 1);
    }
  }
}

// window with frame, cross bars; some boarded up or broken (abandoned area)
function windowAt(g, x, y, w, h, r, frame = '#e2ddd0') {
  g.fillStyle = 'rgba(40,36,30,0.35)';
  g.fillRect(x - 3, y + h, w + 6, 5); // sill shadow
  g.fillStyle = frame;
  g.fillRect(x - 2, y - 2, w + 4, h + 4);
  const roll = r();
  if (roll < 0.12) {
    g.fillStyle = '#6b5a45';
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(30,24,18,0.5)';
    for (let k = 0; k < h; k += 9) g.fillRect(x, y + k, w, 2);
    return;
  }
  const glass = g.createLinearGradient(x, y, x + w, y + h);
  glass.addColorStop(0, '#48565c');
  glass.addColorStop(1, '#1d2427');
  g.fillStyle = roll < 0.3 ? '#0d0f10' : glass;
  g.fillRect(x, y, w, h);
  g.fillStyle = frame;
  g.fillRect(x + w / 2 - 1.5, y, 3, h);
  g.fillRect(x, y + h * 0.32, w, 3);
}

function windows(g, r, { bays = 4, storeys = 4, ww = 1.35, wh = 1.45, sill = 0.9, frame, skip = 0 }) {
  const bay = S / bays;
  const st = S / storeys;
  for (let s = 0; s < storeys; s += 1) {
    for (let b = 0; b < bays; b += 1) {
      if (r() < skip) continue;
      const x = b * bay + (bay - ww * PX) / 2;
      const y = S - s * st - sill * PY - wh * PY;
      windowAt(g, x, y, ww * PX, wh * PY, r, frame);
    }
  }
}

const STYLES = {
  // white silicate brick with a darker plinth (dorms)
  silicate(g, r) {
    bricks(g, 0, 0, S, S, r, [214, 208, 194], 0.08, '#b9b2a2');
    windows(g, r, { frame: '#d9d4c6' });
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let s = 1; s < 4; s += 1) g.fillRect(0, S - s * (S / 4) - 3, S, 4); // floor bands
  },
  // red brick (houses, crackhouse)
  redbrick(g, r) {
    bricks(g, 0, 0, S, S, r, [150, 72, 52], 0.2, '#7b5a4a');
    windows(g, r, { frame: '#cfc6b4', skip: 0.1 });
  },
  // faded plaster (small houses, offices)
  plaster(g, r) {
    g.fillStyle = '#cdbf98';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i += 1) {
      g.fillStyle = `rgba(${r() < 0.5 ? '120,105,80' : '235,225,200'},${0.05 + r() * 0.12})`;
      g.beginPath();
      g.arc(r() * S, r() * S, 10 + r() * 40, 0, Math.PI * 2);
      g.fill();
    }
    // fallen plaster showing brick
    for (let i = 0; i < 6; i += 1) bricks(g, r() * S, r() * S, 20 + r() * 40, 12 + r() * 20, r, [140, 75, 55], 0.2, '#806050');
    windows(g, r, { frame: '#e8e1cf', skip: 0.05 });
  },
  // corrugated steel siding (warehouses); a high strip of small windows
  corrugatedGrey(g, r) { corrugated(g, r, [150, 154, 150]); },
  corrugatedBlue(g, r) { corrugated(g, r, [84, 110, 128]); },
  corrugatedRed(g, r) { corrugated(g, r, [150, 52, 40]); },
  corrugatedGreen(g, r) { corrugated(g, r, [92, 112, 84]); },
  // precast concrete panels (Fortress, industrial offices)
  panel(g, r) {
    g.fillStyle = '#a9a69d';
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += S / 4) {
      for (let x = 0; x < S; x += S / 2) {
        const k = 0.93 + r() * 0.12;
        g.fillStyle = `rgb(${Math.round(169 * k)},${Math.round(166 * k)},${Math.round(157 * k)})`;
        g.fillRect(x + 2, y + 2, S / 2 - 4, S / 4 - 4);
      }
    }
    g.fillStyle = 'rgba(40,40,36,0.5)';
    for (let y = 0; y <= S; y += S / 4) g.fillRect(0, y - 2, S, 3);
    for (let x = 0; x <= S; x += S / 2) g.fillRect(x - 2, 0, 3, S);
    windows(g, r, { bays: 4, ww: 1.8, wh: 1.2, sill: 1.1, frame: '#8d8a82', skip: 0.25 });
  },
  // plain plastered garage block
  garage(g, r) {
    g.fillStyle = '#b5ae9f';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 12; i += 1) bricks(g, r() * S, r() * S, 16 + r() * 30, 10 + r() * 16, r, [150, 90, 70], 0.2, '#806858');
  },
  // dark planks (sheds, old houses)
  wood(g, r) {
    for (let x = 0; x < S; x += 12) {
      const k = 0.85 + r() * 0.3;
      g.fillStyle = `rgb(${Math.round(98 * k)},${Math.round(80 * k)},${Math.round(60 * k)})`;
      g.fillRect(x, 0, 11, S);
      g.fillStyle = 'rgba(20,14,8,0.5)';
      g.fillRect(x + 11, 0, 1, S);
    }
    windows(g, r, { bays: 3, ww: 1.1, wh: 1.2, frame: '#d8d0bd', skip: 0.2 });
  },
};

function corrugated(g, r, [cr, cg, cb]) {
  for (let x = 0; x < S; x += 6) {
    const k = x % 12 ? 1.08 : 0.9;
    g.fillStyle = `rgb(${Math.round(cr * k)},${Math.round(cg * k)},${Math.round(cb * k)})`;
    g.fillRect(x, 0, 6, S);
  }
  // concrete plinth
  g.fillStyle = '#8e8a80';
  g.fillRect(0, S - 0.9 * PY, S, 0.9 * PY);
  // high strip of small windows at 5.5 .. 6.4 m on every second bay
  for (let x = 20; x < S; x += S / 4) {
    g.fillStyle = '#3a3f40';
    g.fillRect(x, S - 6.4 * PY, 2.2 * PX, 0.9 * PY);
    g.fillStyle = 'rgba(170,190,195,0.25)';
    g.fillRect(x + 3, S - 6.35 * PY, 0.8 * PX, 0.8 * PY);
  }
  // rust
  for (let i = 0; i < 70; i += 1) {
    g.fillStyle = `rgba(110,60,30,${0.05 + r() * 0.15})`;
    g.fillRect(r() * S, r() * S, 2 + r() * 5, 10 + r() * 60);
  }
}

export const FACADE_STYLES = Object.keys(STYLES);

export function customsFacade(style, anisotropy = 4) {
  const key = `facade:${style}`;
  if (cache.has(key)) return cache.get(key);
  const [c, g] = canvas();
  let seed = 7;
  for (const ch of style) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
  const r = rand(seed + 11);
  (STYLES[style] || STYLES.plaster)(g, r);
  grime(g, r);
  return finish(key, c, anisotropy);
}

// Chain-link mesh with transparent holes (alphaTest), one 2.5 m panel wide.
export function chainLinkTexture(anisotropy = 4) {
  const key = 'chain';
  if (cache.has(key)) return cache.get(key);
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(120,124,118,1)';
  g.lineWidth = 2;
  for (let k = -128; k < 256; k += 12) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 128, 128); g.stroke();
    g.beginPath(); g.moveTo(k, 128); g.lineTo(k + 128, 0); g.stroke();
  }
  const t = finish(key, c, anisotropy);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Grey tileable grain multiplied over the ground (world-space, see detailGround()).
export function groundDetailTexture(anisotropy = 4) {
  const key = 'ground-detail';
  if (cache.has(key)) return cache.get(key);
  const [c, g] = canvas(256, 256);
  const r = rand(4242);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 256, 256);
  const blob = (x, y, rad, col) => {
    for (const dx of [-256, 0, 256]) {
      for (const dy of [-256, 0, 256]) {
        g.fillStyle = col;
        g.beginPath();
        g.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
        g.fill();
      }
    }
  };
  for (let i = 0; i < 90; i += 1) blob(r() * 256, r() * 256, 6 + r() * 26, `rgba(${r() < 0.5 ? '90,90,90' : '170,170,170'},${0.08 + r() * 0.14})`);
  for (let i = 0; i < 9000; i += 1) {
    const v = Math.round(90 + r() * 90);
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  const t = finish(key, c, anisotropy);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Multiplies a material's color by the detail grain at two scales in world space, so large surfaces draped with a
// low-resolution map (relief, roads) do not look flat up close.
export function detailGround(material, texture, strength = 0.55) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: texture };
    shader.uniforms.detailStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDetailWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nuniform float detailStrength;\nvarying vec3 vDetailWorld;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float d1 = texture2D(detailMap, vDetailWorld.xz / 9.0).r;
        float d2 = texture2D(detailMap, vDetailWorld.xz / 41.0 + 0.37).r;
        float d = (d1 * 0.6 + d2 * 0.4) * 2.0 - 1.0;
        diffuseColor.rgb *= 1.0 + d * detailStrength;
      }`);
  };
  material.customProgramCacheKey = () => `detail-ground-${strength}`;
  material.needsUpdate = true;
}
