// Frame pacing, adaptive quality and the performance panel of the 3D view.
//
// The scene is drawn on demand: while the camera moves, a layer fades, textures arrive after a change or the user
// is active next to animated fire / the route flow. A still scene is not redrawn at all. The frame rate is capped
// (settings: 30 / 60 / 90 / 120 / 144 / unlimited, 60 by default). "Auto" quality lowers the render scale first
// (the HTML labels and panels stay sharp) and only then the draw distance of repeated small objects, one step at a
// time, when the measured frame rate stays under the target; it climbs back the same way.

const KEY = 'tarkov-map:perf';
export const FPS_CHOICES = [30, 60, 90, 120, 144, 0]; // 0 = unlimited
export const QUALITY_CHOICES = ['auto', 'high', 'medium', 'low'];
// quality steps: render scale (of the device pixel ratio, capped at 2) and draw-distance scale of instanced details
const STEPS = [
  { scale: 1, lod: 1 },
  { scale: 0.9, lod: 1 },
  { scale: 0.8, lod: 1 },
  { scale: 0.8, lod: 0.85 },
  { scale: 0.75, lod: 0.7 },
];
const FIXED = { high: 0, medium: 2, low: 4 };

export function loadPerfSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    s = {};
  }
  return {
    fps: FPS_CHOICES.includes(s.fps) ? s.fps : 60,
    quality: QUALITY_CHOICES.includes(s.quality) ? s.quality : 'auto',
    panel: Boolean(s.panel),
  };
}

export function savePerfSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ fps: s.fps, quality: s.quality, panel: s.panel }));
  } catch {
    // storage unavailable: settings last for this session
  }
}

export class FramePacer {
  constructor({ onQuality }) {
    this.settings = loadPerfSettings();
    this.onQuality = onQuality;
    this.step = this.settings.quality === 'auto' ? 0 : FIXED[this.settings.quality];
    this.lastFrame = 0;
    this.lastRender = 0;
    this.lastChange = performance.now();
    this.lastInput = performance.now();
    // measured display refresh (shortest steady interval between animation frames)
    this.tickTimes = [];
    this.displayHz = 60;
    // frame rate while the view is in motion, per second
    this.win = { start: 0, frames: 0 };
    this.good = 0;
    // statistics for the panel
    this.stats = { rendered: 0, skipped: 0, cpu: 0, cpuN: 0, gpu: null };
  }

  get quality() { return STEPS[this.step]; }

  invalidate() { this.lastChange = performance.now(); }

  input() { this.lastInput = performance.now(); this.lastChange = this.lastInput; }

  setFps(fps) { this.settings.fps = fps; savePerfSettings(this.settings); }

  setQuality(q) {
    this.settings.quality = q;
    savePerfSettings(this.settings);
    this.setStep(q === 'auto' ? 0 : FIXED[q]);
  }

  setStep(step) {
    const s = Math.max(0, Math.min(STEPS.length - 1, step));
    if (s === this.step) return;
    this.step = s;
    this.good = 0;
    this.onQuality(STEPS[s]);
    this.invalidate();
  }

  // Called on every animation frame. Returns null to skip, else { dt, motion }.
  tick(now, { moving, animated }) {
    const t = this.tickTimes;
    if (this.lastTick) {
      t.push(now - this.lastTick);
      if (t.length > 120) t.shift();
      if (t.length === 120) {
        const sorted = [...t].sort((a, b) => a - b);
        this.displayHz = Math.round(1000 / sorted[20]);
      }
    }
    this.lastTick = now;
    const limit = this.settings.fps;
    if (limit && now - this.lastFrame < 1000 / limit - 1.5) return null;
    const settling = now - this.lastChange < 1500; // fades of layers and cut planes, label placement
    const refresh = now - this.lastChange < 8000 && now - this.lastRender > 400; // textures that load after a change
    const active = now - this.lastInput < 10000;
    const anim = animated && active && now - this.lastRender >= 33; // fire and route flow: 30 fps is enough
    if (!moving && !settling && !refresh && !anim) {
      this.stats.skipped += 1;
      this.win.start = 0;
      return null;
    }
    const dt = Math.min((now - (this.lastRender || now)) / 1000, 0.1);
    this.lastFrame = now;
    this.lastRender = now;
    this.stats.rendered += 1;
    if (moving) this.measure(now);
    else this.win.start = 0;
    return { dt, moving };
  }

  // Adaptive quality: frames per second while the view keeps moving, against the target.
  measure(now) {
    if (this.settings.quality !== 'auto') return;
    const w = this.win;
    if (!w.start) {
      w.start = now;
      w.frames = 0;
      return;
    }
    w.frames += 1;
    if (now - w.start < 1000) return;
    const fps = (w.frames * 1000) / (now - w.start);
    const target = Math.min(this.settings.fps || this.displayHz, this.displayHz);
    w.start = now;
    w.frames = 0;
    this.lastFps = fps;
    if (fps < target * 0.8) this.setStep(this.step + 1);
    else if (fps > target * 0.95) {
      this.good += 1;
      if (this.good >= 3) this.setStep(this.step - 1);
    } else this.good = 0;
  }

  cpu(ms) {
    this.stats.cpu += ms;
    this.stats.cpuN += 1;
  }
}

// GPU time of the scene render (WebGL2 timer queries), when the browser exposes them.
export class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension && gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];
    this.last = null;
  }

  begin() {
    if (!this.ext || this.pending.length > 3 || this.active) return;
    const q = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  poll() {
    const { gl, ext } = this;
    if (!ext) return null;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) this.last = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(q);
      this.pending.shift();
    }
    return this.last;
  }
}

// The panel: live numbers every half second and the frame rate / quality settings.
export class PerfPanel {
  constructor(container, scene) {
    this.scene = scene;
    const el = document.createElement('div');
    el.className = 'perfpanel';
    el.innerHTML = `
      <button type="button" class="perfpanel__toggle" title="Производительность 3D">FPS</button>
      <div class="perfpanel__body">
        <div class="perfpanel__head">Производительность</div>
        <pre class="perfpanel__stats mono"></pre>
        <label>Лимит FPS <select data-k="fps">${FPS_CHOICES.map((f) => `<option value="${f}">${f || 'без лимита'}</option>`).join('')}</select></label>
        <label>Качество <select data-k="quality"><option value="auto">авто</option><option value="high">высокое</option><option value="medium">среднее</option><option value="low">низкое</option></select></label>
      </div>`;
    container.appendChild(el);
    this.el = el;
    this.statsEl = el.querySelector('.perfpanel__stats');
    const pacer = scene.pacer;
    el.querySelector('[data-k="fps"]').value = String(pacer.settings.fps);
    el.querySelector('[data-k="quality"]').value = pacer.settings.quality;
    el.querySelector('[data-k="fps"]').addEventListener('change', (e) => { pacer.setFps(Number(e.target.value)); pacer.invalidate(); });
    el.querySelector('[data-k="quality"]').addEventListener('change', (e) => pacer.setQuality(e.target.value));
    el.querySelector('.perfpanel__toggle').addEventListener('click', () => this.setOpen(!pacer.settings.panel));
    this.setOpen(pacer.settings.panel);
    this.prev = { rendered: 0, t: performance.now() };
    this.timer = setInterval(() => this.refresh(), 500);
  }

  setOpen(open) {
    const pacer = this.scene.pacer;
    pacer.settings.panel = open;
    savePerfSettings(pacer.settings);
    this.el.classList.toggle('is-open', open);
  }

  refresh() {
    if (!this.el.classList.contains('is-open') || document.hidden) return;
    const s = this.scene;
    const p = s.pacer;
    const now = performance.now();
    const fps = ((p.stats.rendered - this.prev.rendered) * 1000) / (now - this.prev.t);
    this.prev = { rendered: p.stats.rendered, t: now };
    const cpu = p.stats.cpuN ? p.stats.cpu / p.stats.cpuN : 0;
    p.stats.cpu = 0;
    p.stats.cpuN = 0;
    const info = s.renderer.info;
    const gpu = s.gpuTimer ? s.gpuTimer.poll() : null;
    const heap = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB` : 'n/a';
    const c = s.sceneCounts();
    const q = p.quality;
    this.statsEl.textContent = [
      `FPS          ${fps.toFixed(0)}${fps < 1 ? ' (сцена стоит)' : ''}`,
      `Frame (CPU)  ${cpu.toFixed(2)} ms`,
      `GPU          ${gpu != null ? `${gpu.toFixed(2)} ms` : 'нет данных'}`,
      `Draw calls   ${s.lastCalls}`,
      `Triangles    ${(s.lastTriangles / 1000).toFixed(0)}k`,
      `Geometries   ${info.memory.geometries}`,
      `Textures     ${info.memory.textures}`,
      `Objects      ${c.objects} (видимых мешей ${c.visible})`,
      `Labels       ${c.labels}`,
      `JS heap      ${heap}`,
      `Scale        ${(s.renderer.getPixelRatio()).toFixed(2)} px/px · детали ×${q.lod}`,
      `Экран        ${p.displayHz} Гц · лимит ${p.settings.fps || '∞'}`,
    ].join('\n');
  }

  dispose() {
    clearInterval(this.timer);
    this.el.remove();
  }
}
