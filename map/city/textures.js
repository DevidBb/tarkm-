// Procedural textures for the city layer, drawn on canvases at load (no image files, no copied game art):
// worn post-Soviet facades (panel, Stalinist plaster, brick, office ribbon windows, corrugated metal, glass),
// ground floors (shops, entrances with barred windows, garages, gates), blank walls, roofs and sign boards.
// Facade textures are light and neutral: buildings tint them with vertex colors (ochre, salmon, grey...).

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { rng, hashString } from './util.js';

export const STOREY = 3.1; // m, residential storey
export const GROUND_STOREY = 4.0; // m, ground floor
export const BAY = 3.2; // m, one window bay
export const TILE_BAYS = 4;
export const TILE_STOREYS = 4;
export const UPPER_TILE = { w: BAY * TILE_BAYS, h: STOREY * TILE_STOREYS };
export const GROUND_TILE = { w: BAY * TILE_BAYS, h: GROUND_STOREY };
export const BLANK_TILE = { w: 12.8, h: 12.4 };
export const ROOF_TILE = 16;

const PX = 40; // pixels per meter on facade tiles
const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function grain(ctx, w, h, r, amount) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

// Vertical dirt/rain streaks.
function streaks(ctx, w, h, r, count, rgb, alphaMax) {
  for (let i = 0; i < count; i += 1) {
    const x = r() * w;
    const y = r() * h * 0.8;
    const sw = 3 + r() * 16;
    const len = h * (0.1 + r() * 0.45);
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, `rgba(${rgb},${alphaMax * (0.4 + r() * 0.6)})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, sw, len);
  }
}

function blobs(ctx, w, h, r, count, fill, alphaMax, size) {
  for (let i = 0; i < count; i += 1) {
    ctx.globalAlpha = alphaMax * (0.3 + r() * 0.7);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(r() * w, r() * h, size * (0.4 + r()), size * (0.25 + r() * 0.6), r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function bricks(ctx, x0, y0, w, h, r, base, mortar, bw = 10, bh = 3) {
  ctx.fillStyle = mortar;
  ctx.fillRect(x0, y0, w, h);
  for (let y = 0, row = 0; y < h; y += bh, row += 1) {
    for (let x = row % 2 ? -bw / 2 : 0; x < w; x += bw) {
      const k = 0.82 + r() * 0.3;
      const [cr, cg, cb] = base;
      ctx.fillStyle = `rgb(${cr * k | 0},${cg * k | 0},${cb * k | 0})`;
      ctx.fillRect(x0 + Math.max(0, x), y0 + y, Math.min(bw - 1, w - x, bw - 1 + Math.min(0, x)), bh - 1);
    }
  }
}

// One window: old wooden or white frames, curtains, some broken or boarded up.
function windowAt(ctx, x, y, w, h, r, frame = '#ebe7dc', opts = {}) {
  const roll = r();
  const oldWood = r() < 0.3;
  ctx.fillStyle = oldWood ? '#8b7556' : frame;
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  if (roll > 0.965 && !opts.noBoards) {
    ctx.fillStyle = '#6f5a3e';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(30,20,10,0.7)';
    ctx.lineWidth = 2;
    for (let yy = y + 7; yy < y + h; yy += 9) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy + (r() - 0.5) * 3); ctx.stroke(); }
    return;
  }
  const g = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
  g.addColorStop(0, roll > 0.92 ? '#0b0c0d' : '#46555c');
  g.addColorStop(0.45, '#1f272b');
  g.addColorStop(1, '#161b1e');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  if (roll > 0.92) {
    ctx.strokeStyle = 'rgba(200,210,215,0.55)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) { ctx.beginPath(); ctx.moveTo(x + r() * w, y + r() * h); ctx.lineTo(x + r() * w, y + r() * h); ctx.stroke(); }
  } else if (r() < 0.45) {
    const colors = ['#b9a27c', '#7c5b43', '#6d7a5d', '#a58f6a', '#c9c0ab', '#5f6e7a'];
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    ctx.globalAlpha = 0.75;
    const cw = w * (0.25 + r() * 0.3);
    ctx.fillRect(r() < 0.5 ? x : x + w - cw, y, cw, h);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = oldWood ? '#8b7556' : frame;
  const m = Math.max(3, w * 0.05);
  if (opts.mullion !== 'none') ctx.fillRect(x + w * 0.5 - m / 2, y, m, h);
  if (opts.transom) ctx.fillRect(x, y + h * 0.3, w, m);
  // sill and the dirt that runs down from it
  ctx.fillStyle = '#b9b5aa';
  ctx.fillRect(x - 6, y + h + 3, w + 12, 4);
  const s = ctx.createLinearGradient(0, y + h + 7, 0, y + h + 40);
  s.addColorStop(0, 'rgba(40,36,30,0.28)');
  s.addColorStop(1, 'rgba(40,36,30,0)');
  ctx.fillStyle = s;
  ctx.fillRect(x - 2, y + h + 7, w + 4, 33);
}

function finish(key, c, anisotropy) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy || 4;
  cache.set(key, tex);
  return tex;
}

// ---------- upper floors: 4 bays x 4 storeys per tile ----------
const UPPER = {
  panel(ctx, w, h, r) {
    ctx.fillStyle = '#d8d5cb';
    ctx.fillRect(0, 0, w, h);
    const bay = BAY * PX;
    const st = STOREY * PX;
    for (let s = 0; s < TILE_STOREYS; s += 1) {
      for (let b = 0; b < TILE_BAYS; b += 1) {
        ctx.fillStyle = `rgba(${r() < 0.5 ? '120,116,105' : '235,230,215'},${0.05 + r() * 0.1})`;
        ctx.fillRect(b * bay, s * st, bay, st);
        const ww = 1.5 * PX;
        const wh = 1.45 * PX;
        windowAt(ctx, b * bay + (bay - ww) / 2, (s + 1) * st - 0.9 * PX - wh, ww, wh, r, '#e8e5da');
      }
    }
    ctx.fillStyle = 'rgba(70,66,60,0.55)';
    for (let s = 0; s <= TILE_STOREYS; s += 1) ctx.fillRect(0, s * st - 1, w, 3);
    for (let b = 0; b <= TILE_BAYS; b += 1) ctx.fillRect(b * bay - 1, 0, 3, h);
  },
  stalinka(ctx, w, h, r) {
    ctx.fillStyle = '#e6dcc4';
    ctx.fillRect(0, 0, w, h);
    const bay = BAY * PX;
    const st = STOREY * PX;
    for (let b = 0; b <= TILE_BAYS; b += 2) {
      ctx.fillStyle = 'rgba(255,250,236,0.35)';
      ctx.fillRect(b * bay - 10, 0, 20, h);
    }
    for (let s = 0; s < TILE_STOREYS; s += 1) {
      ctx.fillStyle = 'rgba(120,105,80,0.35)';
      ctx.fillRect(0, s * st + 2, w, 3);
      for (let b = 0; b < TILE_BAYS; b += 1) {
        const ww = 1.25 * PX;
        const wh = 1.95 * PX;
        const x = b * bay + (bay - ww) / 2;
        const y = (s + 1) * st - 0.85 * PX - wh;
        ctx.fillStyle = 'rgba(255,250,238,0.8)';
        ctx.fillRect(x - 10, y - 14, ww + 20, 6); // sandrik
        ctx.fillStyle = 'rgba(80,70,55,0.35)';
        ctx.fillRect(x - 10, y - 8, ww + 20, 3);
        windowAt(ctx, x, y, ww, wh, r, '#f0ece2', { transom: true });
      }
    }
    // missing plaster exposing brick
    for (let i = 0; i < 3; i += 1) {
      if (r() < 0.6) {
        const pw = 40 + r() * 90;
        const ph = 25 + r() * 60;
        const px = r() * (w - pw);
        const py = r() * (h - ph);
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, r(), 0, Math.PI * 2);
        ctx.clip();
        bricks(ctx, px, py, pw, ph, r, [150, 85, 62], '#b8a48e');
        ctx.restore();
      }
    }
  },
  brick(ctx, w, h, r) {
    bricks(ctx, 0, 0, w, h, r, [242, 236, 226], '#cfc6b6');
    ctx.fillStyle = 'rgba(160,80,55,0.0)';
    const bay = BAY * PX;
    const st = STOREY * PX;
    for (let s = 0; s < TILE_STOREYS; s += 1) {
      for (let b = 0; b < TILE_BAYS; b += 1) {
        const ww = 1.35 * PX;
        const wh = 1.5 * PX;
        const x = b * bay + (bay - ww) / 2;
        const y = (s + 1) * st - 0.9 * PX - wh;
        ctx.fillStyle = 'rgba(90,70,60,0.45)';
        ctx.fillRect(x - 6, y - 10, ww + 12, 7); // lintel
        windowAt(ctx, x, y, ww, wh, r, '#e6e1d4');
      }
    }
  },
  office(ctx, w, h, r) {
    ctx.fillStyle = '#c9cac5';
    ctx.fillRect(0, 0, w, h);
    const st = STOREY * PX;
    for (let s = 0; s < TILE_STOREYS; s += 1) {
      const y = s * st + 0.35 * PX;
      const gh = 1.75 * PX;
      const g = ctx.createLinearGradient(0, y, 0, y + gh);
      g.addColorStop(0, '#5b6c73');
      g.addColorStop(1, '#232c30');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, w, gh);
      for (let x = 0; x < w; x += 1.25 * PX) {
        ctx.fillStyle = '#8d918e';
        ctx.fillRect(x, y, 4, gh);
        const roll = r();
        if (roll > 0.93) { ctx.fillStyle = '#0d0f10'; ctx.fillRect(x + 4, y, 1.25 * PX - 4, gh); }
        else if (roll > 0.88) { ctx.fillStyle = '#b8b09a'; ctx.globalAlpha = 0.7; ctx.fillRect(x + 4, y, 1.25 * PX - 4, gh); ctx.globalAlpha = 1; }
      }
      ctx.fillStyle = 'rgba(60,58,52,0.35)';
      ctx.fillRect(0, y + gh, w, 4);
    }
  },
  modern(ctx, w, h, r) {
    ctx.fillStyle = '#e4dccf';
    ctx.fillRect(0, 0, w, h);
    const bay = BAY * PX;
    const st = STOREY * PX;
    for (let s = 0; s < TILE_STOREYS; s += 1) {
      for (let b = 0; b < TILE_BAYS; b += 1) {
        ctx.fillStyle = `rgba(${r() < 0.5 ? '150,95,70' : '120,120,115'},${0.08 + r() * 0.12})`;
        ctx.fillRect(b * bay + 2, s * st + 2, bay - 4, st - 4);
        const ww = 2.0 * PX;
        const wh = 1.75 * PX;
        windowAt(ctx, b * bay + (bay - ww) / 2, (s + 1) * st - 0.6 * PX - wh, ww, wh, r, '#3d4144', { noBoards: true });
      }
    }
  },
  industrial(ctx, w, h, r) {
    for (let x = 0; x < w; x += 8) {
      ctx.fillStyle = x % 16 ? '#b9bbb4' : '#a4a79f';
      ctx.fillRect(x, 0, 8, h);
    }
    ctx.fillStyle = '#6b706c';
    for (let x = 0; x < w; x += 1.6 * PX) {
      if (r() < 0.8) {
        const wy = h * 0.08;
        ctx.fillStyle = r() < 0.2 ? '#0e1011' : '#3a474c';
        ctx.fillRect(x + 8, wy, 1.2 * PX, 0.9 * PX);
      }
    }
    streaks(ctx, w, h, r, 18, '120,70,40', 0.35);
  },
  glass(ctx, w, h, r) {
    ctx.fillStyle = '#9ea4a3';
    ctx.fillRect(0, 0, w, h);
    const pw = 1.6 * PX;
    const ph = STOREY * PX;
    for (let y = 0; y < h; y += ph) {
      for (let x = 0; x < w; x += pw) {
        const g = ctx.createLinearGradient(x, y, x + pw, y + ph);
        g.addColorStop(0, '#6f8a90');
        g.addColorStop(0.5, '#2c3a3f');
        g.addColorStop(1, '#3f5157');
        ctx.fillStyle = r() > 0.95 ? '#0c0e0f' : g;
        ctx.fillRect(x + 3, y + 3, pw - 6, ph - 6);
      }
    }
  },
};

// ---------- ground floors: 4 bays x 1 ground storey ----------
const GROUND = {
  shop(ctx, w, h, r, wallFill) {
    ctx.fillStyle = wallFill;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5f5b56';
    ctx.fillRect(0, h - 0.45 * PX, w, 0.45 * PX); // plinth
    ctx.fillStyle = '#2d2c2a';
    ctx.fillRect(0, 0, w, 0.85 * PX); // sign band (boards are 3D)
    const unit = w / 2;
    for (let i = 0; i < 2; i += 1) {
      const x = i * unit + 0.3 * PX;
      const ww = unit - 0.6 * PX;
      const top = 1.05 * PX;
      const bottom = h - 0.45 * PX;
      if (r() < 0.3) {
        ctx.fillStyle = '#8b8e8c'; // roller shutter
        ctx.fillRect(x, top, ww, bottom - top);
        ctx.fillStyle = 'rgba(40,40,40,0.35)';
        for (let yy = top; yy < bottom; yy += 6) ctx.fillRect(x, yy, ww, 2);
        streaks(ctx, w, h, r, 2, '110,70,40', 0.3);
      } else {
        const g = ctx.createLinearGradient(x, top, x + ww, bottom);
        g.addColorStop(0, '#55666c');
        g.addColorStop(0.5, '#1c2427');
        g.addColorStop(1, '#2b3539');
        ctx.fillStyle = g;
        ctx.fillRect(x, top, ww, bottom - top);
        ctx.fillStyle = '#7a7d7a';
        ctx.fillRect(x + ww * 0.62, top, 5, bottom - top);
        ctx.fillRect(x, top, ww, 5);
        if (r() < 0.25) { ctx.strokeStyle = 'rgba(210,215,215,0.5)'; ctx.beginPath(); ctx.moveTo(x + r() * ww, top); ctx.lineTo(x + r() * ww, bottom); ctx.stroke(); }
      }
    }
  },
  entrance(ctx, w, h, r, wallFill) {
    ctx.fillStyle = wallFill;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(70,64,56,0.55)';
    ctx.fillRect(0, h - 0.7 * PX, w, 0.7 * PX);
    const bay = BAY * PX;
    for (let b = 0; b < TILE_BAYS; b += 1) {
      const ww = 1.35 * PX;
      const wh = 1.5 * PX;
      const x = b * bay + (bay - ww) / 2;
      const y = h - 1.3 * PX - wh;
      windowAt(ctx, x, y, ww, wh, r, '#e3dfd3', { noBoards: false });
      ctx.strokeStyle = 'rgba(35,33,30,0.9)'; // window bars
      ctx.lineWidth = 2;
      for (let xx = x + 8; xx < x + ww; xx += 11) { ctx.beginPath(); ctx.moveTo(xx, y - 2); ctx.lineTo(xx, y + wh + 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(x, y + wh * 0.5); ctx.lineTo(x + ww, y + wh * 0.5); ctx.stroke();
    }
  },
  garage(ctx, w, h, r, wallFill) {
    ctx.fillStyle = wallFill;
    ctx.fillRect(0, 0, w, h);
    const colors = ['#4f6150', '#3f5670', '#6a4a3a', '#6d6f6a', '#7a6a3f'];
    const dw = w / 4;
    for (let i = 0; i < 4; i += 1) {
      const x = i * dw + 0.25 * PX;
      const ww = dw - 0.5 * PX;
      const y = h - 2.3 * PX;
      ctx.fillStyle = colors[Math.floor(r() * colors.length)];
      ctx.fillRect(x, y, ww, 2.3 * PX);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let xx = x; xx < x + ww; xx += 7) ctx.fillRect(xx, y, 2, 2.3 * PX);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x + ww / 2 - 2, y, 4, 2.3 * PX);
    }
    streaks(ctx, w, h, r, 14, '120,70,40', 0.35);
  },
  gates(ctx, w, h, r, wallFill) {
    ctx.fillStyle = wallFill;
    ctx.fillRect(0, 0, w, h);
    const x = w * (0.15 + r() * 0.3);
    const gw = 3.6 * PX;
    ctx.fillStyle = '#56615a';
    ctx.fillRect(x, h - 3.5 * PX, gw, 3.5 * PX);
    ctx.fillStyle = 'rgba(20,20,20,0.35)';
    for (let yy = h - 3.5 * PX; yy < h; yy += 9) ctx.fillRect(x, yy, gw, 2);
    streaks(ctx, w, h, r, 10, '120,70,40', 0.4);
  },
  showroom(ctx, w, h, r) {
    UPPER.glass(ctx, w, h, r);
    ctx.fillStyle = '#4b4d4c';
    ctx.fillRect(0, h - 0.3 * PX, w, 0.3 * PX);
  },
};

function weather(ctx, w, h, r, strength = 1) {
  streaks(ctx, w, h, r, Math.round(26 * strength), '45,40,34', 0.22);
  blobs(ctx, w, h, r, Math.round(14 * strength), '#3a352e', 0.1, 40);
  const bottom = ctx.createLinearGradient(0, h * 0.8, 0, h);
  bottom.addColorStop(0, 'rgba(40,36,30,0)');
  bottom.addColorStop(1, 'rgba(40,36,30,0.18)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, r, 22);
}

export const UPPER_STYLES = Object.keys(UPPER);
export const GROUND_KINDS = Object.keys(GROUND);

export function upperTexture(style, variant, anisotropy) {
  const key = `upper:${style}:${variant}`;
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = canvas(512, 512);
  const r = rng(hashString(key));
  (UPPER[style] || UPPER.panel)(ctx, 512, 512, r);
  weather(ctx, 512, 512, r, style === 'glass' ? 0.4 : 1);
  return finish(key, c, anisotropy);
}

const GROUND_WALL = { shop: '#cfc8b8', entrance: '#d6cfbf', garage: '#b4b1a8', gates: '#b6b8b0', showroom: '#9ea4a3' };

export function groundTexture(kind, variant, anisotropy) {
  const key = `ground:${kind}:${variant}`;
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = canvas(512, 160);
  const r = rng(hashString(key));
  (GROUND[kind] || GROUND.entrance)(ctx, 512, 160, r, GROUND_WALL[kind] || '#d0c9b9');
  weather(ctx, 512, 160, r, 0.8);
  return finish(key, c, anisotropy);
}

export function blankTexture(kind, anisotropy) {
  const key = `blank:${kind}`;
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = canvas(256, 256);
  const r = rng(hashString(key));
  if (kind === 'brick') bricks(ctx, 0, 0, 256, 256, r, [236, 230, 220], '#cbc2b2', 5, 2);
  else if (kind === 'concrete') {
    ctx.fillStyle = '#c7c5bd';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(80,78,72,0.25)';
    for (let y = 0; y < 256; y += 30) ctx.fillRect(0, y, 256, 2);
    for (let x = 0; x < 256; x += 60) ctx.fillRect(x, 0, 2, 256);
  } else {
    ctx.fillStyle = '#e2dac8';
    ctx.fillRect(0, 0, 256, 256);
    blobs(ctx, 256, 256, r, 10, '#ffffff', 0.15, 30);
  }
  streaks(ctx, 256, 256, r, 16, '45,40,34', 0.25);
  blobs(ctx, 256, 256, r, 8, '#3a352e', 0.1, 24);
  grain(ctx, 256, 256, r, 20);
  return finish(key, c, anisotropy);
}

export function roofTexture(anisotropy) {
  const key = 'roof';
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = canvas(256, 256);
  const r = rng(hashString(key));
  ctx.fillStyle = '#55544f';
  ctx.fillRect(0, 0, 256, 256);
  blobs(ctx, 256, 256, r, 26, '#3f3e3a', 0.5, 26);
  blobs(ctx, 256, 256, r, 10, '#6a6960', 0.4, 18);
  ctx.strokeStyle = 'rgba(30,30,28,0.5)';
  for (let i = 0; i < 12; i += 1) { ctx.beginPath(); ctx.moveTo(r() * 256, r() * 256); ctx.lineTo(r() * 256, r() * 256); ctx.stroke(); }
  grain(ctx, 256, 256, r, 26);
  return finish(key, c, anisotropy);
}

// Sign boards: one atlas, one cell per text. Returns the texture and a uv rectangle per sign.
export function signAtlas(signs, anisotropy) {
  const cols = 4;
  const cw = 512;
  const ch = 80;
  const rows = Math.max(1, Math.ceil(signs.length / cols));
  const [c, ctx] = canvas(cols * cw, rows * ch);
  const r = rng(hashString(signs.map((s) => s.text).join('|')));
  const cells = signs.map((s, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    ctx.fillStyle = s.bg;
    ctx.fillRect(x, y, cw, ch);
    ctx.fillStyle = s.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 54;
    ctx.font = `700 ${size}px "Rajdhani", "Arial Narrow", Arial, sans-serif`;
    while (ctx.measureText(s.text).width > cw - 40 && size > 20) {
      size -= 2;
      ctx.font = `700 ${size}px "Rajdhani", "Arial Narrow", Arial, sans-serif`;
    }
    ctx.fillText(s.text, x + cw / 2, y + ch / 2 + 2);
    streaks(ctx, cw, ch, r, 5, '30,30,30', 0.25);
    return { u0: x / c.width, u1: (x + cw) / c.width, v0: 1 - (y + ch) / c.height, v1: 1 - y / c.height };
  });
  grain(ctx, c.width, c.height, r, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy || 4;
  return { texture: tex, cells };
}

// Billboard posters (2:1): brand names that exist in the game's own texts, faded and dirty.
export function adAtlas(ads, anisotropy) {
  const cw = 512;
  const ch = 256;
  const [c, ctx] = canvas(cw * 2, ch * Math.ceil(ads.length / 2));
  const r = rng(hashString(ads.map((a) => a.text).join('|')));
  const cells = ads.map((ad, i) => {
    const x = (i % 2) * cw;
    const y = Math.floor(i / 2) * ch;
    const g = ctx.createLinearGradient(x, y, x + cw, y + ch);
    g.addColorStop(0, ad.bg);
    g.addColorStop(1, ad.bg2 || ad.bg);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, cw, ch);
    ctx.fillStyle = ad.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 110;
    ctx.font = `700 ${size}px "Rajdhani", "Arial Narrow", Arial, sans-serif`;
    while (ctx.measureText(ad.text).width > cw - 50 && size > 30) { size -= 4; ctx.font = `700 ${size}px "Rajdhani", "Arial Narrow", Arial, sans-serif`; }
    ctx.fillText(ad.text, x + cw / 2, y + ch * 0.45);
    if (ad.sub) {
      ctx.font = `600 34px "IBM Plex Sans", Arial, sans-serif`;
      ctx.fillText(ad.sub, x + cw / 2, y + ch * 0.78);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cw, ch);
    ctx.clip();
    streaks(ctx, cw * 2, ch * 2, r, 14, '40,36,30', 0.3);
    if (r() < 0.6) { ctx.fillStyle = 'rgba(210,205,190,0.85)'; ctx.fillRect(x + r() * cw * 0.7, y + r() * ch * 0.6, 60 + r() * 120, 30 + r() * 70); }
    ctx.restore();
    return { u0: x / c.width, u1: (x + cw) / c.width, v0: 1 - (y + ch) / c.height, v1: 1 - y / c.height };
  });
  grain(ctx, c.width, c.height, r, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy || 4;
  return { texture: tex, cells };
}

// Tileable grain used to take the flat look off the rasterized ground layer.
export function noiseCanvas(size = 256, seed = 7) {
  const [c, ctx] = canvas(size, size);
  const r = rng(seed);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  blobs(ctx, size, size, r, 40, '#6a6a6a', 0.35, size / 10);
  blobs(ctx, size, size, r, 30, '#959595', 0.3, size / 14);
  grain(ctx, size, size, r, 40);
  return c;
}
