// Claude reads an inventory screenshot for the "Оценить" tab (Artifact runtime `sample`, the viewer's own
// Claude account, no API key). Claude only transcribes what is printed on item cells (short name, stack
// count, size). Items are matched against the tarkov.dev item list in the page; where a label fits several
// items, Claude may only pick one of those candidates. Prices never come from Claude.

import { capability, isClaudeViewer } from './runtime.js';
import { prepareImageForClaude } from './claudeVision.js';

// Why a screenshot cannot be read right now (null = it can, or the runtime is still connecting).
export function recognitionProblem(marketAI, runtimeReady) {
  if (!runtimeReady) return null;
  if (!isClaudeViewer()) return 'Распознавание скриншота работает только в версии приложения внутри Claude. Здесь предметы можно добавить поиском.';
  if (!marketAI || !marketAI.available) return 'Claude недоступен на этой странице: разрешите ей доступ к Claude, когда появится запрос, или откройте приложение заново.';
  if (!marketAI.canReadImages) return 'В этом окне Claude не принимает изображения. Откройте приложение на claude.ai в браузере или добавьте предметы поиском.';
  return null;
}

const TILE_MP = 1.15; // the platform downsizes each image to ~1.2 MP: big screenshots go as tiles to keep labels legible
const MAX_GRID = 3;

function canvasBlob(canvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось подготовить изображение.'))), 'image/jpeg', quality);
  });
}

// [overview, tile 1..n] for large screenshots, or one image.
async function screenshotImages(file, limits) {
  const maxCount = Math.max(1, (limits.images && limits.images.maxCount) || 1);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { images: [await prepareImageForClaude(file, limits)], grid: 1 };
  }
  const { width, height } = bitmap;
  let grid = Math.min(MAX_GRID, Math.ceil(Math.sqrt((width * height) / 1e6 / TILE_MP)));
  while (grid > 1 && grid * grid + 1 > maxCount) grid -= 1;
  if (grid <= 1) {
    if (bitmap.close) bitmap.close();
    return { images: [await prepareImageForClaude(file, limits)], grid: 1 };
  }
  const images = [];
  const scale = Math.min(1, 1400 / Math.max(width, height));
  const overview = document.createElement('canvas');
  overview.width = Math.round(width * scale);
  overview.height = Math.round(height * scale);
  overview.getContext('2d').drawImage(bitmap, 0, 0, overview.width, overview.height);
  images.push(await canvasBlob(overview, 0.85));
  const overlap = 0.06;
  const tw = Math.min(width, Math.ceil(width / grid + width * overlap));
  const th = Math.min(height, Math.ceil(height / grid + height * overlap));
  for (let r = 0; r < grid; r += 1) {
    for (let c = 0; c < grid; c += 1) {
      const sx = Math.max(0, Math.min(width - tw, Math.round((c * width) / grid - (width * overlap) / 2)));
      const sy = Math.max(0, Math.min(height - th, Math.round((r * height) / grid - (height * overlap) / 2)));
      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      canvas.getContext('2d').drawImage(bitmap, sx, sy, tw, th, 0, 0, tw, th);
      images.push(await canvasBlob(canvas));
    }
  }
  if (bitmap.close) bitmap.close();
  return { images, grid };
}

const clampCount = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10000000) : 1;
};
// [x0, y0, x1, y1] as fractions of the screenshot (0..1000 is accepted too) or null.
const boxOf = (v) => {
  if (!Array.isArray(v) || v.length !== 4) return null;
  let b = v.map(Number);
  if (b.some((n) => !Number.isFinite(n))) return null;
  if (Math.max(...b) > 1.5) b = b.map((n) => n / 1000);
  const [x0, y0, x1, y1] = b.map((n) => Math.min(1, Math.max(0, n)));
  return x1 - x0 > 0.004 && y1 - y0 > 0.004 ? [x0, y0, x1, y1] : null;
};
const cells = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
};

export async function createMarketAI() {
  const sample = await capability('sample');
  if (!sample) return { available: false, canReadImages: false };
  let limits = null;
  try { limits = await sample.limits(); } catch { limits = null; }
  const prepared = new WeakMap();
  const imagesFor = (file) => {
    if (!prepared.has(file)) prepared.set(file, screenshotImages(file, limits));
    return prepared.get(file);
  };

  async function readInventory(file, { signal } = {}) {
    if (!limits || !limits.images) throw { code: 'images_unavailable', message: 'images unavailable' };
    const { images, grid } = await imagesFor(file);
    const layout = grid > 1
      ? `Image 1 is the whole screenshot at low resolution, only for layout. Images 2-${images.length} are the same screenshot cut into a ${grid}x${grid} grid (left to right, then top to bottom) at full resolution, with a small overlap between neighbouring pieces. Read the labels on those pieces. An item seen in two overlapping pieces is still ONE item: count it once.`
      : 'The image is the whole screenshot.';
    const prompt = [
      'The screenshot is from the game Escape from Tarkov and shows items: an inventory, stash, container, trader or flea market window.',
      layout,
      'Every item cell shows a short name in its top-right corner; stackable items (ammo, money, some barter items) also show a stack number in the bottom-right corner.',
      'For every distinct item type you can see, report:',
      '- label: the short name exactly as printed on the cell (keep the language, letters, digits and dots);',
      '- full_name: the full item name only if it is fully readable on screen (tooltip, inspect window, trader list), otherwise "";',
      '- count: total quantity of this item type = the sum of the stack numbers of all its cells (a cell without a number counts as 1);',
      '- cells_w and cells_h: the size of one such item in inventory cells;',
      '- confidence: 0..1, how sure you are that the label is read correctly;',
      `- box: where ONE cell of this item is on the WHOLE screenshot${grid > 1 ? ' (as on image 1)' : ''}: [x0, y0, x1, y1] as fractions from 0 to 1 of the screenshot width and height (x0, y0 = top-left corner, x1, y1 = bottom-right corner of the item cell); [] if you cannot tell.`,
      'Rules: never invent items or labels you cannot read. Skip empty cells, equipment slot captions, buttons, tabs, filters and the money balance counters of the interface. Items inside closed containers are not visible: do not guess them.',
      'Reply with only JSON: {"items": [{"label": "Bolts", "full_name": "", "count": 2, "cells_w": 1, "cells_h": 1, "confidence": 0.9, "box": [0.41, 0.22, 0.45, 0.28]}], "notes_ru": "1-2 предложения по-русски: что видно и что не удалось прочитать"}',
    ].join('\n');
    const options = { images, modelTier: 'complex' };
    if (signal) options.signal = signal;
    const raw = await sample.json(prompt, options);
    const items = (Array.isArray(raw && raw.items) ? raw.items : [])
      .map((it) => ({
        label: String((it && it.label) || '').trim().slice(0, 60),
        fullName: String((it && it.full_name) || '').trim().slice(0, 120),
        count: clampCount(it && it.count),
        width: cells(it && it.cells_w),
        height: cells(it && it.cells_h),
        confidence: Math.min(1, Math.max(0, Number(it && it.confidence) || 0)),
        box: boxOf(it && it.box),
      }))
      .filter((it) => it.label || it.fullName)
      .slice(0, 80);
    return { items, notes: String((raw && raw.notes_ru) || '').slice(0, 400), images: images.length };
  }

  // questions: [{ label, width, height, candidates: [item] }] -> index of the chosen candidate or null, per question.
  async function chooseCandidates(file, questions, { signal } = {}) {
    if (!questions.length) return [];
    const { images } = await imagesFor(file);
    const lines = questions.map((q, i) => [
      `${i + 1}. label "${q.label}"${q.width && q.height ? ` (${q.width}x${q.height} cells on the screenshot)` : ''}:`,
      ...q.candidates.map((c, k) => `   ${String.fromCharCode(97 + k)}) ${c.name}${c.nameRu && c.nameRu !== c.name ? ` / ${c.nameRu}` : ''}; short name "${c.shortName || ''}"; ${c.width}x${c.height} cells`),
    ].join('\n'));
    const prompt = [
      'These are the same Escape from Tarkov screenshot pieces as before. Some labels read from them match several items of the game database.',
      'For each numbered label choose the candidate letter that matches the item on the screenshot (compare the icon, the size in cells and the label), or null if none fits. When unsure, answer null.',
      ...lines,
      'Reply with only JSON: {"answers": [{"n": 1, "choice": "a"}]}',
    ].join('\n');
    const options = { images, modelTier: 'default' };
    if (signal) options.signal = signal;
    const raw = await sample.json(prompt, options);
    const out = questions.map(() => null);
    for (const a of Array.isArray(raw && raw.answers) ? raw.answers : []) {
      const n = Math.round(Number(a && a.n)) - 1;
      const choice = typeof (a && a.choice) === 'string' ? a.choice.trim().toLowerCase().charCodeAt(0) - 97 : -1;
      if (n >= 0 && n < questions.length && choice >= 0 && choice < questions[n].candidates.length) out[n] = choice;
    }
    return out;
  }

  return { available: true, canReadImages: Boolean(limits && limits.images), readInventory, chooseCandidates };
}
