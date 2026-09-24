// Streets of Tarkov quest database: data/streets.quests.json, imported from tarkov.dev by scripts/import_quests.ps1.
// Finds a quest by its name or by a pasted quest text. Matching is deterministic and runs in the page;
// claudeQuests.js may only pick quest ids from this same list, and coordinates always come from the data.

export const QUESTS_DATA_URL = 'data/streets.quests.json';
const SUPPORTED_FORMAT = 'tarkov-map-ai/quests@1';

export const MATCH_SURE = 0.82;
export const MATCH_MAYBE = 0.45;

const TRADER_COLORS = {
  prapor: '#8fae5a',
  therapist: '#e2574c',
  skier: '#6fa8d8',
  peacekeeper: '#cbb26a',
  mechanic: '#e8a33d',
  ragman: '#b06bb8',
  jaeger: '#4f9d6e',
  fence: '#a3a38f',
  lightkeeper: '#7fc4c9',
  'btr driver': '#4fc0cf',
  ref: '#d98a6a',
};

export const traderColor = (trader) => (trader && TRADER_COLORS[String(trader.name || '').toLowerCase()]) || '#9aa288';
export const questName = (quest) => quest.nameRu || quest.name || quest.id;
export const traderName = (trader) => (trader ? trader.nameRu || trader.name : 'Неизвестный торговец');

export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Phrases almost every objective of a map contains; they say nothing about which quest it is.
const FILLER = [
  'на локации улицы таркова',
  'на локации улиц таркова',
  'в зоне улиц таркова',
  'улицы таркова',
  'улиц таркова',
  'on streets of tarkov',
  'streets of tarkov',
  'на локации развязка',
  'на развязке',
  'on interchange',
  'на локации',
  'location',
];

function stripFiller(text) {
  let t = ` ${text} `;
  for (const f of FILLER) t = t.split(` ${f} `).join(' ');
  return t.replace(/\s+/g, ' ').trim();
}

function trigrams(s) {
  const padded = `  ${s} `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 2; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function buildIndexEntry(quest) {
  const names = [quest.name, quest.nameRu].filter(Boolean).map(normalizeText).filter(Boolean);
  const objectiveTexts = quest.objectives
    .flatMap((o) => [o.description, o.descriptionRu])
    .filter(Boolean)
    .map((t) => stripFiller(normalizeText(t)))
    .filter((t) => t.length >= 6);
  const traders = quest.trader ? [quest.trader.name, quest.trader.nameRu].filter(Boolean).map(normalizeText) : [];
  return {
    quest,
    names: names.map((text) => ({ text, grams: trigrams(text) })),
    objectives: objectiveTexts.map((text) => ({ text, grams: trigrams(text) })),
    traders,
  };
}

function scoreEntry(entry, query) {
  const { text, grams, core, coreGrams } = query;
  let best = { score: 0, reason: null, exact: false };
  const consider = (score, reason, exact = false) => {
    if (score > best.score) best = { score, reason, exact };
  };
  const padded = ` ${text} `;
  for (const n of entry.names) {
    if (text === n.text) consider(1, 'name', true);
    else if (n.text.length >= 4 && padded.includes(` ${n.text} `)) consider(0.9 + Math.min(0.08, n.text.length / 300), 'name_in_text');
    else if (text.length >= 3 && n.text.startsWith(text)) consider(0.62 + 0.3 * (text.length / n.text.length), 'name_prefix');
    consider(dice(grams, n.grams), 'name_similar');
  }
  if (core) {
    const paddedCore = ` ${core} `;
    for (const o of entry.objectives) {
      if (o.text.length >= 14 && paddedCore.includes(` ${o.text} `)) consider(0.88, 'objective_in_text');
      else if (core.length >= 14 && o.text.includes(core)) consider(0.8, 'objective_fragment');
      consider(dice(coreGrams, o.grams) * 0.92, 'objective_similar');
    }
  }
  if (best.score > 0.3 && entry.traders.some((t) => t && padded.includes(` ${t} `))) {
    best = { ...best, score: Math.min(1, best.score + 0.04) };
  }
  return best;
}

// sure: open the quest; maybe: let the player pick; none: say so, never guess.
export function decideMatch(results) {
  const [top, second] = results;
  if (!top) return { level: 'none', results };
  const gap = second ? top.score - second.score : 1;
  if (top.score >= MATCH_SURE && (top.exact || gap >= 0.06)) return { level: 'sure', results };
  if (top.score >= MATCH_MAYBE) return { level: 'maybe', results };
  return { level: 'none', results };
}

export function questProgress(quest, entry) {
  const required = quest.objectives.filter((o) => !o.optional);
  const doneMap = (entry && entry.done) || {};
  const done = entry && entry.status === 'completed' ? required.length : required.filter((o) => doneMap[o.id]).length;
  return { done, total: required.length };
}

export async function loadQuestData(url = QUESTS_DATA_URL) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Данные квестов не загрузились (HTTP ${res.status}). Запустите scripts\\import_quests.ps1.`);
  const data = await res.json();
  if (data.format !== SUPPORTED_FORMAT) throw new Error(`Неподдерживаемый формат данных квестов: ${data.format}`);

  const traders = new Map(data.traders.map((t) => [t.id, t]));
  const quests = data.quests.map((q) => ({
    ...q,
    trader: traders.get(q.traderId) || null,
    objectives: q.objectives.map((o, index) => ({
      ...o,
      index,
      points: (o.points || []).map((p, j) => ({ ...p, id: `q:${q.id}:${o.id}:${j}` })),
    })),
  }));
  const byId = new Map(quests.map((q) => [q.id, q]));
  const index = quests.map(buildIndexEntry);

  function match(input, limit = 6) {
    const text = normalizeText(input);
    if (!text) return [];
    const core = stripFiller(text);
    const query = { text, grams: trigrams(text), core, coreGrams: trigrams(core) };
    return index
      .map((entry) => ({ quest: entry.quest, ...scoreEntry(entry, query) }))
      .filter((r) => r.score >= 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  const traderList = data.traders
    .map((t) => ({ ...t, count: quests.filter((q) => q.traderId === t.id).length }))
    .sort((a, b) => traderName(a).localeCompare(traderName(b), 'ru'));

  return { quests, byId, traders: traderList, generatedAt: data.generatedAt, match };
}
