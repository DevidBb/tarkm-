// Inventory evaluation pipeline: Claude reads labels (and where one cell of each item is) -> local matching against
// the tarkov.dev item list -> Claude picks among candidates only where a label fits several items -> the item is cut
// out of the screenshot for its card. Rows are plain data (kept in localStorage by the app):
// { key, itemId, count, label, fullName, width, height, confidence, candidates, source, picked, box, crop }.

export const newRowKey = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const CROP_SIZE = 180; // px, longest side of the stored picture

// Cuts one cell of every row with a box out of the screenshot (small JPEG data URL, a little margin around it).
async function cropItems(file, rows) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return;
  }
  const { width: W, height: H } = bitmap;
  for (const r of rows) {
    if (!r.box) continue;
    const [x0, y0, x1, y1] = r.box;
    const pw = (x1 - x0) * W;
    const ph = (y1 - y0) * H;
    const sx = Math.max(0, x0 * W - pw * 0.08);
    const sy = Math.max(0, y0 * H - ph * 0.08);
    const sw = Math.min(W - sx, pw * 1.16);
    const sh = Math.min(H - sy, ph * 1.16);
    if (sw < 4 || sh < 4) continue;
    const k = Math.min(2, CROP_SIZE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * k));
    canvas.height = Math.max(1, Math.round(sh * k));
    canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    try {
      r.crop = canvas.toDataURL('image/jpeg', 0.82);
    } catch {
      r.crop = null;
    }
  }
  if (bitmap.close) bitmap.close();
}

export async function recognizeInventory({ file, market, marketAI, signal, onPhase = () => {} }) {
  onPhase('reading');
  const read = await marketAI.readInventory(file, { signal });
  const rows = read.items.map((it) => {
    const match = market.matchLabel(it);
    return {
      key: newRowKey(),
      itemId: match.level === 'sure' ? match.candidates[0].item.id : null,
      count: it.count,
      label: it.label,
      fullName: it.fullName,
      width: it.width,
      height: it.height,
      confidence: it.confidence,
      candidates: match.candidates.map((c) => c.item.id),
      level: match.level,
      source: 'screenshot',
      picked: match.level === 'sure' ? 'exact' : null,
      box: it.box,
      crop: null,
    };
  });

  const questions = rows.filter((r) => r.level === 'maybe' && r.candidates.length > 1);
  if (questions.length) {
    onPhase('matching');
    try {
      const answers = await marketAI.chooseCandidates(
        file,
        questions.map((q) => ({ label: q.label || q.fullName, width: q.width, height: q.height, candidates: q.candidates.map((id) => market.byId.get(id)) })),
        { signal },
      );
      answers.forEach((choice, i) => {
        if (choice != null) {
          questions[i].itemId = questions[i].candidates[choice];
          questions[i].picked = 'claude';
        }
      });
    } catch (e) {
      if (e && e.code === 'cancelled') throw e;
      console.warn('[evaluate] candidates left for manual choice', e); // rows stay with a picker
    }
  }
  for (const r of rows) {
    if (r.level === 'maybe' && r.candidates.length === 1) {
      r.itemId = r.candidates[0];
      r.picked = 'similar';
    }
  }
  await cropItems(file, rows);
  return { rows, notes: read.notes };
}

// Same item from several screenshots adds up (the first picture stays); unmatched rows stay separate.
export function mergeRows(existing, incoming) {
  const out = existing.map((r) => ({ ...r }));
  for (const row of incoming) {
    const same = row.itemId && out.find((r) => r.itemId === row.itemId);
    if (same) {
      same.count += row.count;
      if (!same.crop && row.crop) same.crop = row.crop;
    } else {
      out.push({ ...row });
    }
  }
  return out;
}
