// Relief of open maps (Shoreline), rebuilt from the heights of in-game objects that stand outside buildings
// (tarkov.dev positions of spawns, loot, extracts, locks...). Each grid cell keeps its lowest sample (the ground
// under crates, cars and people); a sample far below its neighbours (a cellar, a bunker) is dropped; empty cells are
// filled by pull-push interpolation and smoothed. Between the samples the relief is interpolated, not measured.

function pullPush(values, weights, cols, rows) {
  const levels = [{ v: values, w: weights, cols, rows }];
  while (levels[levels.length - 1].cols > 1 || levels[levels.length - 1].rows > 1) {
    const p = levels[levels.length - 1];
    const nc = Math.max(1, Math.ceil(p.cols / 2));
    const nr = Math.max(1, Math.ceil(p.rows / 2));
    const v = new Float32Array(nc * nr);
    const w = new Float32Array(nc * nr);
    for (let r = 0; r < p.rows; r += 1) {
      for (let c = 0; c < p.cols; c += 1) {
        const i = r * p.cols + c;
        const pw = p.w[i];
        if (!pw) continue;
        const j = (r >> 1) * nc + (c >> 1);
        v[j] += p.v[i] * pw;
        w[j] += pw;
      }
    }
    for (let j = 0; j < v.length; j += 1) {
      if (w[j] > 0) {
        v[j] /= w[j];
        w[j] = Math.min(1, w[j]);
      }
    }
    levels.push({ v, w, cols: nc, rows: nr });
  }
  for (let k = levels.length - 2; k >= 0; k -= 1) {
    const f = levels[k];
    const q = levels[k + 1];
    for (let r = 0; r < f.rows; r += 1) {
      for (let c = 0; c < f.cols; c += 1) {
        const i = r * f.cols + c;
        if (f.w[i] >= 1) continue;
        const x = Math.min(q.cols - 1, Math.max(0, (c - 0.5) / 2));
        const y = Math.min(q.rows - 1, Math.max(0, (r - 0.5) / 2));
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = Math.min(q.cols - 1, x0 + 1);
        const y1 = Math.min(q.rows - 1, y0 + 1);
        const tx = x - x0;
        const ty = y - y0;
        const up = (q.v[y0 * q.cols + x0] * (1 - tx) + q.v[y0 * q.cols + x1] * tx) * (1 - ty)
          + (q.v[y1 * q.cols + x0] * (1 - tx) + q.v[y1 * q.cols + x1] * tx) * ty;
        f.v[i] = f.v[i] * f.w[i] + up * (1 - f.w[i]);
        f.w[i] = 1;
      }
    }
  }
  return levels[0].v;
}

// samples: [[x, y, z], ...] in game meters; bounds: map.bounds of the map file.
export function buildTerrain(samples, bounds, { cell = 6, smooth = 60, pitDepth = 12 } = {}) {
  const gx0 = Math.min(bounds.topLeft.x, bounds.bottomRight.x);
  const gx1 = Math.max(bounds.topLeft.x, bounds.bottomRight.x);
  const gz0 = Math.min(bounds.topLeft.z, bounds.bottomRight.z);
  const gz1 = Math.max(bounds.topLeft.z, bounds.bottomRight.z);
  const cols = Math.ceil((gx1 - gx0) / cell) + 1;
  const rows = Math.ceil((gz1 - gz0) / cell) + 1;
  const n = cols * rows;
  const heights = new Float32Array(n);
  const known = new Uint8Array(n);
  for (const s of samples) {
    const c = Math.round((s[0] - gx0) / cell);
    const r = Math.round((s[2] - gz0) / cell);
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
    const i = r * cols + c;
    if (!known[i] || s[1] < heights[i]) heights[i] = s[1];
    known[i] = 1;
  }

  // Samples far below the ground around them are underground rooms, not terrain.
  const pits = [];
  for (let i = 0; i < n; i += 1) {
    if (!known[i]) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    const around = [];
    for (let dr = -5; dr <= 5; dr += 1) {
      for (let dc = -5; dc <= 5; dc += 1) {
        const rr = r + dr;
        const cc = c + dc;
        if ((!dr && !dc) || rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const j = rr * cols + cc;
        if (known[j]) around.push(heights[j]);
      }
    }
    if (around.length < 5) continue;
    around.sort((a, b) => a - b);
    if (heights[i] < around[around.length >> 1] - pitDepth) pits.push(i);
  }
  for (const i of pits) known[i] = 0;

  const values = new Float32Array(n);
  const weights = new Float32Array(n);
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    if (!known[i]) continue;
    values[i] = heights[i];
    weights[i] = 1;
    count += 1;
  }
  let cur = count ? pullPush(values, weights, cols, rows) : values;
  let next = new Float32Array(n);
  for (let it = 0; it < smooth; it += 1) {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        if (known[i]) { next[i] = cur[i]; continue; }
        let sum = 0;
        let k = 0;
        if (c > 0) { sum += cur[i - 1]; k += 1; }
        if (c < cols - 1) { sum += cur[i + 1]; k += 1; }
        if (r > 0) { sum += cur[i - cols]; k += 1; }
        if (r < rows - 1) { sum += cur[i + cols]; k += 1; }
        next[i] = sum / k;
      }
    }
    [cur, next] = [next, cur];
  }
  heights.set(cur);

  const heightAtGame = (gx, gz) => {
    const fx = Math.min(cols - 1.001, Math.max(0, (gx - gx0) / cell));
    const fz = Math.min(rows - 1.001, Math.max(0, (gz - gz0) / cell));
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const tx = fx - c;
    const tz = fz - r;
    const i = r * cols + c;
    return (heights[i] * (1 - tx) + heights[i + 1] * tx) * (1 - tz) + (heights[i + cols] * (1 - tx) + heights[i + cols + 1] * tx) * tz;
  };
  return {
    cols, rows, cell, gx0, gz0, heights, known,
    samples: count, pits: pits.length,
    heightAtGame,
    // scene x = -game x, scene z = game z
    heightAtScene: (sx, sz) => heightAtGame(-sx, sz),
  };
}
