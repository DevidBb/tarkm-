// War-zone atmosphere shared by every map: burning car wrecks and fire barrels with animated flames, a glow on
// the ground and smoke plumes, plus tall smoke columns seen from across the map. Everything is three instanced
// draws with small shaders (flames and glow additive, smoke alpha-blended) driven by one time uniform, so dozens of
// fires cost almost nothing. Which wrecks burn is decoration, chosen deterministically - not game data.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { rng, hashString } from '../city/util.js';

const FLAME_VS = `
  attribute vec3 iPos; attribute float iSize; attribute float iSeed;
  uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vFade;
  void main() {
    vUv = uv; vSeed = iSeed;
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    float flick = 0.85 + 0.15 * sin(uTime * 9.0 + iSeed * 40.0) * sin(uTime * 13.7 + iSeed * 11.0);
    vec3 p = iPos + camRight * (position.x * iSize * 1.35) + vec3(0.0, (position.y + 0.5) * iSize * 2.4 * flick, 0.0);
    p.x += sin(uTime * 3.0 + iSeed * 20.0 + position.y * 3.0) * 0.12 * iSize * (position.y + 0.5);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFade = clamp(1.0 - (-mv.z - 700.0) / 500.0, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }`;
const FLAME_FS = `
  uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vFade;
  float n2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(n2(i), n2(i + vec2(1, 0)), f.x), mix(n2(i + vec2(0, 1)), n2(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec2 uv = vUv;
    float t = uTime * 2.2 + vSeed * 17.0;
    float turb = noise(vec2(uv.x * 4.0 + vSeed * 9.0, uv.y * 3.0 - t)) * 0.6 + noise(vec2(uv.x * 9.0, uv.y * 7.0 - t * 1.7)) * 0.4;
    float width = mix(0.42, 0.04, pow(uv.y, 0.8));
    float d = abs(uv.x - 0.5 + (turb - 0.5) * 0.25 * uv.y) / max(width, 0.001);
    float body = smoothstep(1.0, 0.35, d) * smoothstep(1.0, 0.55, uv.y + turb * 0.35) * smoothstep(0.0, 0.08, uv.y);
    if (body < 0.02) discard;
    vec3 hot = vec3(1.0, 0.93, 0.62); vec3 mid = vec3(1.0, 0.55, 0.12); vec3 edge = vec3(0.85, 0.18, 0.04);
    vec3 col = mix(edge, mid, smoothstep(0.1, 0.55, body));
    col = mix(col, hot, smoothstep(0.65, 1.0, body) * (1.0 - uv.y));
    gl_FragColor = vec4(col * body * 1.4 * vFade, 1.0);
  }`;

const GLOW_VS = `
  attribute vec3 iPos; attribute float iSize; attribute float iSeed;
  uniform float uTime; varying vec2 vUv; varying float vPulse;
  void main() {
    vUv = uv;
    vPulse = 0.75 + 0.25 * sin(uTime * 7.0 + iSeed * 30.0) * sin(uTime * 3.1 + iSeed * 7.0);
    vec3 p = iPos + vec3(position.x * iSize * 4.5, 0.08, position.y * iSize * 4.5);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const GLOW_FS = `
  varying vec2 vUv; varying float vPulse;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * a * a * 0.55 * vPulse, 1.0);
  }`;

// Smoke: every instance is one puff that loops up its plume (phase from the seed), grows and fades.
const SMOKE_VS = `
  attribute vec3 iPos; attribute float iSize; attribute float iSeed; attribute float iHeight; attribute float iDark;
  uniform float uTime; uniform vec2 uWind; varying vec2 vUv; varying float vAlpha; varying float vDark;
  void main() {
    vUv = uv; vDark = iDark;
    float life = fract(uTime * (0.045 + fract(iSeed * 7.13) * 0.02) * (40.0 / max(iHeight, 10.0)) + iSeed);
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float size = iSize * (0.7 + life * 3.2);
    vec3 c = iPos + vec3(uWind.x * life * iHeight * 0.55, life * iHeight, uWind.y * life * iHeight * 0.55);
    c.x += sin(iSeed * 50.0 + life * 5.0) * iSize * 0.6;
    c.z += cos(iSeed * 37.0 + life * 4.0) * iSize * 0.6;
    vec3 p = c + (camRight * position.x + camUp * position.y) * size;
    vAlpha = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.55, 1.0, life));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const SMOKE_FS = `
  varying vec2 vUv; varying float vAlpha; varying float vDark;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.15, d) * vAlpha * 0.8;
    if (a < 0.01) discard;
    vec3 col = mix(vec3(0.46, 0.45, 0.43), vec3(0.11, 0.105, 0.1), vDark);
    gl_FragColor = vec4(col, a);
  }`;

function quad(w = 1, h = 1) {
  const g = new THREE.PlaneGeometry(w, h);
  return g;
}

function instanced(base, count, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.attributes.position = base.attributes.position;
  g.attributes.uv = base.attributes.uv;
  for (const [name, size, data] of attrs) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(data), size));
  g.instanceCount = count;
  return g;
}

export class Ambience {
  // groundAt(x, z): ground height (scene) or null for the flat maps.
  constructor(scene, { groundAt = null, seed = 'fx' } = {}) {
    this.scene = scene;
    this.groundAt = groundAt;
    this.fires = [];
    this.smokes = [];
    this.r = rng(hashString(seed));
    this.root = new THREE.Group();
    this.root.name = 'ambience';
    scene.add(this.root);
    this.uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.35, -0.18) } };
    this.built = false;
  }

  y(x, z, fallback = 0) {
    const g = this.groundAt ? this.groundAt(x, z) : null;
    return g == null || Number.isNaN(g) ? fallback : g;
  }

  // A fire: size 1 = a burning barrel, 2 = a car, 3+ = a truck or a heap. Smoke rises `smoke` meters (0 = none).
  fire(x, y, z, { size = 1, smoke = 14, dark = 0.85 } = {}) {
    this.fires.push({ x, y, z, size, seed: this.r() });
    // Bigger fires are several tongues of flame side by side.
    const extra = size >= 1.5 ? Math.round(size) : 0;
    for (let k = 0; k < extra; k += 1) {
      const a = this.r() * Math.PI * 2;
      const d = size * (0.25 + this.r() * 0.35);
      this.fires.push({ x: x + Math.cos(a) * d, y: y - size * 0.15, z: z + Math.sin(a) * d, size: size * (0.55 + this.r() * 0.3), seed: this.r(), extra: true });
    }
    if (smoke > 0) this.plume(x, y + size * 1.4, z, { height: smoke, size: 1.1 + size * 0.9, count: Math.round(10 + size * 5), dark });
  }

  // A smoke plume without flames (a smouldering ruin, a column seen from afar).
  plume(x, y, z, { height = 40, size = 3, count = 14, dark = 0.7 } = {}) {
    for (let k = 0; k < count; k += 1) this.smokes.push({ x, y, z, size, height, seed: (k + this.r()) / count, dark });
  }

  // Cars placed by a map builder: a few wrecks burn. Marks the chosen placements as burned (no glass, charred paint)
  // so call it before the cars are instanced. share: fraction of candidates that burn, max: cap per call.
  cars(placements, { share = 0.25, max = 8, onlyWrecks = true } = {}) {
    const candidates = placements.filter((p) => (onlyWrecks ? p.wreck || p.burned : true) && p.model !== 'bus');
    let n = 0;
    for (const p of candidates) {
      if (n >= max) break;
      if (!p.burned && this.r() > share) continue;
      p.burned = true;
      p.paint = this.r() < 0.5 ? '#2b2723' : '#3a2a22';
      const big = p.model === 'truck' || p.model === 'van';
      const y = p.y != null ? p.y : this.y(p.x, p.z, 0);
      this.fire(p.x, y + (big ? 1.4 : 0.9), p.z, { size: big ? 2.4 : 1.8, smoke: big ? 34 : 22 });
      n += 1;
    }
    return n;
  }

  build() {
    this.clear();
    const base = quad();
    if (this.fires.length) {
      const f = this.fires;
      const flameGeo = instanced(base, f.length, [
        ['iPos', 3, f.flatMap((p) => [p.x, p.y - p.size * 0.35, p.z])],
        ['iSize', 1, f.map((p) => p.size)],
        ['iSeed', 1, f.map((p) => p.seed)],
      ]);
      const flame = new THREE.Mesh(flameGeo, new THREE.ShaderMaterial({
        vertexShader: FLAME_VS, fragmentShader: FLAME_FS, uniforms: this.uniforms,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      flame.frustumCulled = false;
      flame.renderOrder = 30;
      const glowGeo = instanced(base, f.length, [
        ['iPos', 3, f.flatMap((p) => [p.x, this.y(p.x, p.z, p.y - p.size) + 0.05, p.z])],
        ['iSize', 1, f.map((p) => (p.extra ? 0 : p.size))],
        ['iSeed', 1, f.map((p) => p.seed)],
      ]);
      const glow = new THREE.Mesh(glowGeo, new THREE.ShaderMaterial({
        vertexShader: GLOW_VS, fragmentShader: GLOW_FS, uniforms: this.uniforms,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.frustumCulled = false;
      glow.renderOrder = 29;
      this.root.add(glow, flame);
    }
    if (this.smokes.length) {
      const s = this.smokes;
      const geo = instanced(base, s.length, [
        ['iPos', 3, s.flatMap((p) => [p.x, p.y, p.z])],
        ['iSize', 1, s.map((p) => p.size)],
        ['iSeed', 1, s.map((p) => p.seed)],
        ['iHeight', 1, s.map((p) => p.height)],
        ['iDark', 1, s.map((p) => p.dark)],
      ]);
      const smoke = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, uniforms: this.uniforms,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      smoke.frustumCulled = false;
      smoke.renderOrder = 31;
      this.root.add(smoke);
    }
    this.built = true;
    return { fires: this.fires.length, smokePuffs: this.smokes.length };
  }

  update(dt) {
    this.uniforms.uTime.value += dt;
  }

  setVisible(v) { this.root.visible = v; }

  clear() {
    for (const m of [...this.root.children]) {
      m.geometry.dispose();
      m.material.dispose();
      this.root.remove(m);
    }
  }

  dispose() {
    this.clear();
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

// Places named like camps (scav camps, farms, bunkers, checkpoints) get a fire barrel or a campfire next to them.
const CAMP = /camp|лагер|ферм|farm|scav|дики|checkpoint|кпп|блокпост|roadblock|bunker|бункер|construction|стройк|village|деревн|sawmill|лесопил/i;

export function campFires(fx, mapData, { max = 8, offset = 4 } = {}) {
  const r = rng(hashString(`${mapData.map.id}:camps`));
  let n = 0;
  const places = mapData.entities.filter((e) => (e.type === 'place' || e.type === 'boss') && e.position && CAMP.test(`${e.name || ''} ${e.nameRu || ''} ${(e.meta && e.meta.zoneName) || ''}`));
  for (const e of places) {
    if (n >= max) break;
    const a = r() * Math.PI * 2;
    const x = -e.position.x + Math.cos(a) * offset;
    const z = e.position.z + Math.sin(a) * offset;
    const y = e.position.y != null && e.type === 'boss' ? e.position.y : fx.y(x, z, mapData.projection.groundY);
    fx.fire(x, y + 0.9, z, { size: 1, smoke: 10, dark: 0.55 });
    n += 1;
  }
  return n;
}
