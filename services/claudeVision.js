// Screenshot analysis with Claude via the Artifact runtime `sample` capability.
// It runs on the viewer's own Claude account, so no API key ever reaches the page.
// Claude may only choose places from the catalog; positions always come from map data.

import { capability } from './runtime.js';

const FLOOR_IDS = ['UNDERGROUND', 'GROUND', '1F', '2F', '3F', '4F', '5F'];
const MAX_CANDIDATES = 5;

const ERROR_TEXT = {
  not_granted: 'Доступ к Claude для этой страницы не разрешён.',
  sampling_disabled: 'Claude недоступен для этого аккаунта или организации.',
  not_declared: 'Страница не объявила доступ к Claude.',
  capability_disabled: 'Claude недоступен в этом просмотре.',
  capability_removed: 'Эта версия приложения Claude не поддерживает анализ изображений.',
  images_unavailable: 'В этом просмотре Claude не принимает изображения.',
  image_rejected: 'Изображение не принято. Нужен PNG, JPEG или WebP до 20 МБ.',
  rate_limited: 'Лимит запросов к Claude исчерпан. Повторите позже.',
  session_expired: 'Сессия claude.ai истекла. Войдите снова и повторите.',
  refused: 'Claude отказался анализировать это изображение.',
  empty_completion: 'Claude не вернул ответ. Попробуйте другой скриншот.',
  invalid_json: 'Claude ответил не в том формате. Нажмите «Повторить».',
  prompt_too_large: 'Запрос получился слишком большим.',
  cancelled: 'Анализ остановлен.',
  upstream_error: 'Сбой связи с Claude. Нажмите «Повторить».',
};

export function visionErrorMessage(e) {
  if (e && ERROR_TEXT[e.code]) return ERROR_TEXT[e.code];
  if (e && e.message) return e.message;
  return ERROR_TEXT.upstream_error;
}

function buildPrompt(catalog, mapName, floorIds) {
  const lines = catalog.map((e) => {
    const names = e.nameRu && e.nameRu !== e.name ? `${e.name} / ${e.nameRu}` : e.name;
    return `${e.id} | ${names} | ${e.type}${e.floor ? ` | ${e.floor}` : ''}`;
  });
  const example = catalog.find((e) => e.id === 'loc-lexos') || catalog[0] || { id: 'place-id' };
  const exampleFloor = floorIds.includes('GROUND') ? 'GROUND' : floorIds[0];
  return [
    `You are analysing ONE screenshot from the game Escape from Tarkov. The player says it was taken on the map "${mapName}".`,
    `Task: work out where on ${mapName} the screenshot was taken, choosing ONLY from the place catalog below.`,
    '',
    'Use all visual evidence, not only readable text:',
    '- shop signs, billboards, brand names, street name plates, building and room numbers',
    '- architecture: facades, number of storeys, windows, balconies, arches, glass fronts, stylobates',
    '- indoor features: corridors, stairs, elevators, room layout, hotel rooms, offices, basements, parking levels',
    '- unique objects: BTR, tram, cranes, barricades, checkpoints, construction sites, vehicles',
    '- street layout, sightlines and what is visible in the distance',
    '- height: street level, upper floor (view down from windows), or underground',
    '',
    'Rules:',
    '- Never invent places or coordinates. Copy place_id values exactly as written in the catalog.',
    '- confidence = your calibrated probability (0..1) that the player stands at or right next to that place. All confidences together must sum to at most 1.',
    '- If the evidence is weak or generic (plain corridor, dark room, only foliage), return low confidences or an empty candidates list. Do not guess to be helpful.',
    `- floor must be one of ${floorIds.join(', ')} or "unknown".`,
    `- If the image is not from Escape from Tarkov or clearly not ${mapName}, set is_expected_map to false.`,
    '',
    'Place catalog (place_id | name | type | floor):',
    ...lines,
    '',
    'Reply with only this JSON:',
    '{"is_expected_map": true, "indoor": false,',
    ' "observations": {"text_signs": [], "architecture": [], "indoor_features": [], "unique_objects": [], "street_layout": []},',
    ` "candidates": [{"place_id": "${example.id}", "confidence": 0.4, "floor": "${exampleFloor}", "evidence": "short reason"}],`,
    ' "summary_ru": "1-2 предложения по-русски: что видно на скриншоте и почему выбраны эти места"}',
  ].join('\n');
}

const asStrings = (v) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 12) : []);

function normalizeResult(raw, catalogById, floorIds) {
  const candidates = [];
  for (const c of Array.isArray(raw && raw.candidates) ? raw.candidates : []) {
    const place = catalogById.get(String(c && c.place_id));
    if (!place || candidates.some((x) => x.place.id === place.id)) continue;
    let confidence = Number(c.confidence);
    if (!Number.isFinite(confidence)) continue;
    if (confidence > 1) confidence /= 100;
    confidence = Math.min(1, Math.max(0, confidence));
    const floor = floorIds.includes(c.floor) ? c.floor : null;
    candidates.push({ place, confidence, floor, evidence: String(c.evidence || '').slice(0, 300) });
  }
  const sum = candidates.reduce((s, c) => s + c.confidence, 0);
  if (sum > 1) candidates.forEach((c) => { c.confidence /= sum; });
  candidates.sort((a, b) => b.confidence - a.confidence);

  const obs = (raw && raw.observations) || {};
  return {
    // isStreets = "the screenshot is from the selected map" (name kept from the Streets-only version)
    isStreets: typeof (raw && raw.is_expected_map) === 'boolean' ? raw.is_expected_map : null,
    indoor: typeof (raw && raw.indoor) === 'boolean' ? raw.indoor : null,
    observations: {
      textSigns: asStrings(obs.text_signs),
      architecture: asStrings(obs.architecture),
      indoorFeatures: asStrings(obs.indoor_features),
      uniqueObjects: asStrings(obs.unique_objects),
      streetLayout: asStrings(obs.street_layout),
    },
    candidates: candidates.slice(0, MAX_CANDIDATES),
    summary: String((raw && raw.summary_ru) || '').slice(0, 600),
  };
}

export async function prepareImageForClaude(file, limits) {
  const accepted = limits.images.mediaTypes || [];
  if (accepted.includes(file.type) && file.size <= limits.images.maxInputBytes) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось подготовить изображение.'))), 'image/jpeg', 0.9);
  });
}

export async function createVision() {
  const sample = await capability('sample');
  if (!sample) {
    return {
      available: false,
      reason: 'no_runtime',
      message: 'AI-анализ работает в опубликованной версии приложения внутри Claude. Здесь доступно точное определение по имени файла скриншота EFT.',
    };
  }
  let limits = null;
  try { limits = await sample.limits(); } catch { limits = null; }
  if (!limits || !limits.images) {
    return { available: false, reason: 'no_images', message: ERROR_TEXT.images_unavailable };
  }

  async function analyze(file, catalog, { signal, onText, mapName = 'Streets of Tarkov', floorIds = FLOOR_IDS } = {}) {
    const image = await prepareImageForClaude(file, limits);
    const options = { images: image, modelTier: 'complex' };
    if (signal) options.signal = signal;
    if (typeof onText === 'function') options.onText = onText;
    const raw = await sample.json(buildPrompt(catalog, mapName, floorIds), options);
    return normalizeResult(raw, new Map(catalog.map((e) => [e.id, e])), floorIds);
  }

  return { available: true, reason: null, message: null, limits, analyze };
}
