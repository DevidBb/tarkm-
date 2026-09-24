// Procedural textures of the Factory model. Facades are a stylization (no facade drawings in open data):
// hall = concrete plinth, brick wall, ribbon of factory windows, corrugated steel above; annex = brick with small windows.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';

function rand(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function finish(c, anisotropy, clampV = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = clampV ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}

function grime(g, S, r, n = 4000) {
  for (let i = 0; i < n; i += 1) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
    g.fillRect(r() * S, r() * S, 2, 2);
  }
}

function bricks(g, x0, y0, w, h, r) {
  g.fillStyle = '#7a4a37';
  g.fillRect(x0, y0, w, h);
  const bw = 16;
  const bh = 6;
  for (let y = y0; y < y0 + h; y += bh) {
    const off = ((y - y0) / bh) % 2 ? bw / 2 : 0;
    for (let x = x0 - off; x < x0 + w; x += bw) {
      const v = 100 + r() * 40;
      g.fillStyle = `rgb(${v + 20},${v * 0.55},${v * 0.42})`;
      g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  }
}

export function factoryFacade(kind, anisotropy = 4) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const r = rand(kind === 'hall' ? 17 : 29);
  const V = (v) => S - v * S; // v: 0 bottom .. 1 top of the wall
  if (kind === 'hall') {
    // corrugated steel
    g.fillStyle = '#8f938f';
    g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 8) { g.fillStyle = x % 16 ? '#9da19c' : '#7f837f'; g.fillRect(x, 0, 4, S); }
    // brick band 0..0.42
    bricks(g, 0, V(0.42), S, 0.42 * S, r);
    // concrete plinth
    g.fillStyle = '#7d7a72';
    g.fillRect(0, V(0.07), S, 0.07 * S);
    // ribbon windows 0.5..0.68
    g.fillStyle = '#5f625f';
    g.fillRect(0, V(0.69), S, 0.2 * S);
    for (let x = 6; x < S; x += 64) {
      g.fillStyle = '#263238';
      g.fillRect(x, V(0.68), 52, 0.17 * S);
      g.fillStyle = 'rgba(160,190,200,0.25)';
      g.fillRect(x + 2, V(0.68), 20, 0.17 * S);
      g.fillStyle = '#5f625f';
      for (let k = 1; k < 4; k += 1) g.fillRect(x + k * 13, V(0.68), 2, 0.17 * S);
      g.fillRect(x, V(0.6), 52, 2);
      if (r() < 0.25) { g.fillStyle = '#1b2226'; g.fillRect(x + 26, V(0.68), 13, 0.08 * S); } // broken pane
    }
    // rust streaks
    for (let i = 0; i < 40; i += 1) { g.fillStyle = `rgba(120,70,40,${0.05 + r() * 0.12})`; g.fillRect(r() * S, V(1), 2 + r() * 5, 0.3 * S * r()); }
    g.fillStyle = '#5a5d5a';
    g.fillRect(0, 0, S, 0.04 * S);
  } else {
    bricks(g, 0, 0, S, S, r);
    g.fillStyle = '#7d7a72';
    g.fillRect(0, V(0.12), S, 0.12 * S);
    for (let x = 30; x < S; x += 128) {
      g.fillStyle = '#6d6a62';
      g.fillRect(x - 4, V(0.8) - 4, 78, 0.28 * S + 8);
      g.fillStyle = '#263238';
      g.fillRect(x, V(0.8), 70, 0.28 * S);
      g.fillStyle = '#6d6a62';
      g.fillRect(x + 34, V(0.8), 3, 0.28 * S);
      g.fillRect(x, V(0.66), 70, 3);
    }
    g.fillStyle = '#5a5751';
    g.fillRect(0, 0, S, 0.08 * S);
  }
  grime(g, S, r);
  return finish(c, anisotropy, true);
}

export function factoryTexture(kind, anisotropy = 4) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const r = rand({ roof: 5, concrete: 7, grass: 11, asphalt: 13, fence: 19 }[kind] || 3);
  const blobs = (n, col, a, size) => {
    for (let i = 0; i < n; i += 1) {
      g.globalAlpha = r() * a;
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(r() * S, r() * S, size * (0.4 + r()), size * (0.3 + r() * 0.6), r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  };
  if (kind === 'roof') {
    g.fillStyle = '#5b5d5a'; g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 6) { g.fillStyle = x % 12 ? '#63655f' : '#4f514d'; g.fillRect(x, 0, 3, S); }
    blobs(20, '#3f403d', 0.5, 24); blobs(8, '#6e5a44', 0.3, 18);
  } else if (kind === 'concrete') {
    g.fillStyle = '#8b8880'; g.fillRect(0, 0, S, S);
    blobs(30, '#76736b', 0.45, 20); blobs(20, '#a29f96', 0.35, 14);
    g.fillStyle = 'rgba(40,40,38,0.5)'; g.fillRect(0, 0, S, 2); g.fillRect(0, 0, 2, S);
  } else if (kind === 'grass') {
    g.fillStyle = '#56633c'; g.fillRect(0, 0, S, S);
    blobs(40, '#44522f', 0.6, 26); blobs(30, '#6c7446', 0.5, 18); blobs(12, '#76674a', 0.35, 14);
  } else if (kind === 'asphalt') {
    g.fillStyle = '#4b4d4f'; g.fillRect(0, 0, S, S);
    blobs(30, '#3b3d3f', 0.5, 22); blobs(16, '#5d5f61', 0.35, 16);
  } else {
    g.fillStyle = '#9b988e'; g.fillRect(0, 0, S, S);
    blobs(20, '#85827a', 0.5, 20);
    g.fillStyle = 'rgba(50,50,46,0.55)';
    for (let x = 0; x < S; x += 64) g.fillRect(x, 0, 3, S);
  }
  grime(g, S, r, 2500);
  return finish(c, anisotropy);
}
