// Marker types shared by the 3D map layer, legend, filters and info panel.

const INK = '#0b0d0a';

export const GLYPHS = {
  objective: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l2.1 4.4 4.9.6-3.6 3.4.9 4.8L8 11.9 3.7 14.2l.9-4.8L1 6l4.9-.6z" fill="currentColor"/></svg>`,
  item: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l6 3v8l-6 3-6-3V4z" fill="currentColor"/><path d="M2 4l6 3 6-3M8 7v8" stroke="${INK}" stroke-width="1.2" fill="none"/></svg>`,
  key: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 7h7v2h-1.6v2.2h-2V9H8z" fill="currentColor"/></svg>`,
  extract: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 1.5h7.5v3h-2v-1H4v9h3.5v-1h2v3H2z" fill="currentColor"/><path d="M9.5 5l4.5 3-4.5 3V9.2H6.5V6.8h3z" fill="currentColor"/></svg>`,
  transit: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 5.2h9V2.5L15 7l-4.5 4.5V8.8h-9z" fill="currentColor"/><rect x="1.5" y="12.2" width="13" height="1.8" fill="currentColor"/></svg>`,
  trader: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="4.8" r="3" fill="currentColor"/><path d="M2.3 15c0-3.3 2.6-5.7 5.7-5.7s5.7 2.4 5.7 5.7z" fill="currentColor"/></svg>`,
  boss: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.2c-3.4 0-5.7 2.4-5.7 5.4 0 1.8.9 3.2 2.1 4V13h7.2v-2.4c1.2-.8 2.1-2.2 2.1-4 0-3-2.3-5.4-5.7-5.4z" fill="currentColor"/><circle cx="5.8" cy="7" r="1.4" fill="${INK}"/><circle cx="10.2" cy="7" r="1.4" fill="${INK}"/><path d="M6.2 13h1.2v2H6.2zm2.4 0h1.2v2H8.6z" fill="currentColor"/></svg>`,
  danger: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.3l7.2 13H.8z" fill="currentColor"/><path d="M7.2 5.6h1.6v4.6H7.2zm0 5.6h1.6v1.6H7.2z" fill="${INK}"/></svg>`,
  place: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 .8a5.2 5.2 0 0 0-5.2 5.2c0 3.8 5.2 9.2 5.2 9.2s5.2-5.4 5.2-9.2A5.2 5.2 0 0 0 8 .8z" fill="currentColor"/><circle cx="8" cy="6" r="1.9" fill="${INK}"/></svg>`,
  loot: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 6h13v8h-13z" fill="currentColor"/><path d="M3.2 2.2h9.6L14.5 6h-13z" fill="currentColor" opacity=".65"/><rect x="6.4" y="7.4" width="3.2" height="3" fill="${INK}"/></svg>`,
  switch: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="1.5" width="10" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4v5.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="11.2" r="1.6" fill="currentColor"/></svg>`,
  spawn: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3.6" r="2.4" fill="currentColor"/><path d="M4.4 15V9.6c0-2 1.6-3.4 3.6-3.4s3.6 1.4 3.6 3.4V15h-2v-4H6.4v4z" fill="currentColor"/><path d="M1 13.6h3.2M11.8 13.6H15" stroke="currentColor" stroke-width="1.4"/></svg>`,
  player: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="currentColor"/><circle cx="8" cy="8" r="2.4" fill="#fff"/></svg>`,
  camera: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.6 3.2l1-1.6h2.8l1 1.6H14a1 1 0 0 1 1 1v8.2a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8.2" r="2.7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
};

export const MARKER_TYPES = {
  objective: { label: 'Цели квестов', single: 'Цель квеста', color: '#e5a13a', glyph: 'objective' },
  item: { label: 'Места квестовых предметов', single: 'Место предмета', color: '#d58f4e', glyph: 'item' },
  key: { label: 'Ключи и замки', single: 'Замок', color: '#e3c45a', glyph: 'key' },
  extract: { label: 'Выходы', single: 'Выход', color: '#62c46f', glyph: 'extract' },
  transit: { label: 'Переходы', single: 'Переход', color: '#9c8cf0', glyph: 'transit' },
  boss: { label: 'Боссы', single: 'Босс', color: '#e0527a', glyph: 'boss' },
  trader: { label: 'Торговцы', single: 'Торговец', color: '#4fc0cf', glyph: 'trader' },
  danger: { label: 'Опасности', single: 'Опасность', color: '#d9503f', glyph: 'danger' },
  place: { label: 'Места', single: 'Место', color: '#c9cbb8', glyph: 'place' },
  street: { label: 'Улицы', single: 'Улица', color: '#8f977f', glyph: 'place' },
  loot: { label: 'Лут', single: 'Лут', color: '#d8c27a', glyph: 'loot' },
  switch: { label: 'Переключатели', single: 'Переключатель', color: '#7fd3ff', glyph: 'switch' },
  spawn: { label: 'Спавны ЧВК', single: 'Спавн ЧВК', color: '#b6e36b', glyph: 'spawn' },
  player: { label: 'Вы здесь', single: 'Вы здесь', color: '#3d9bff', glyph: 'player' },
};

export const FACTION_LABELS = { pmc: 'ЧВК', scav: 'Дикий', shared: 'Общий (ЧВК + Дикий)' };

// Loot groups used by the filter menu. Category ids are assigned by scripts/import_map.ps1.
export const LOOT_CATEGORIES = [
  { id: 'valuables', label: 'Сейфы и кассы', color: '#f2c94c', defaultOn: true },
  { id: 'weapon', label: 'Оружейные, патронные, гранатные ящики', color: '#e5694e', defaultOn: true },
  { id: 'tech', label: 'Техника: системники, инструменты', color: '#5db5dc', defaultOn: true },
  { id: 'medical', label: 'Медицина', color: '#6fd08a', defaultOn: true },
  { id: 'stash', label: 'Тайники и пластиковые чемоданы', color: '#c792ea', defaultOn: true },
  { id: 'common', label: 'Сумки, ящики, куртки, трупы', color: '#a9a58d', defaultOn: false },
  { id: 'loose', label: 'Лут на полу', color: '#f1ebd0', defaultOn: false },
];
export const lootCategory = (id) => LOOT_CATEGORIES.find((c) => c.id === id) || null;

export const DEFAULT_FILTERS = {
  quests: true,
  objective: true,
  item: true,
  key: true,
  extract: true,
  transit: true,
  boss: true,
  trader: true,
  danger: true,
  switch: true,
  spawn: false,
  place: true,
  street: true,
  buildings: true,
  cityModels: true,
  vehicles: true,
  streetProps: true,
  loot: false,
  ...Object.fromEntries(LOOT_CATEGORIES.map((c) => [`loot_${c.id}`, c.defaultOn])),
  onlyCurrentFloor: false,
};

// A filter row controls one or more boolean `keys` (marker types or flags). `requires` = keys that must
// also be on for the row to count as checked; turning the row on switches them on too.
export const FILTER_ROWS = [
  { id: 'quests', label: 'Квесты: все активные', keys: ['quests'] },
  { id: 'objective', label: 'Цели квестов', keys: ['objective'], color: MARKER_TYPES.objective.color },
  { id: 'item', label: 'Места квестовых предметов', keys: ['item'], color: MARKER_TYPES.item.color },
  { id: 'key', label: 'Ключи и замки', keys: ['key'], color: MARKER_TYPES.key.color },
  { id: 'switch', label: 'Переключатели (питание, сигнализация)', keys: ['switch'], color: MARKER_TYPES.switch.color, markerTypes: ['switch'] },
  { id: 'extract', label: 'Выходы и переходы', keys: ['extract', 'transit'], color: MARKER_TYPES.extract.color },
  { id: 'spawn', label: 'Спавны ЧВК', keys: ['spawn'], color: MARKER_TYPES.spawn.color, markerTypes: ['spawn'] },
  { id: 'boss', label: 'Боссы', keys: ['boss'], color: MARKER_TYPES.boss.color },
  { id: 'trader', label: 'Торговцы (БТР)', keys: ['trader'], color: MARKER_TYPES.trader.color, markerTypes: ['trader'] },
  { id: 'buildings', label: 'Здания (3D-объёмы)', keys: ['buildings'] },
  { id: 'place', label: 'Места и улицы', keys: ['place', 'street'], color: MARKER_TYPES.place.color },
  { id: 'danger', label: 'Опасные зоны', keys: ['danger'], color: MARKER_TYPES.danger.color },
];

// 3D environment. Buildings stand on real footprints; parked cars and street furniture along real curbs are approximate.
export const ENV_ROWS = [
  { id: 'cityModels', label: '3D-модели зданий (выкл. — схема)', keys: ['cityModels'], requires: ['buildings'], kinds: ['city'] },
  { id: 'vehicles', label: 'Машины', keys: ['vehicles'] },
  { id: 'streetProps', label: 'Улицы: фонари, знаки, разметка, заборы', keys: ['streetProps'] },
];

export const LOOT_MASTER_ROW ={ id: 'loot', label: 'Показывать лут', keys: ['loot'], color: MARKER_TYPES.loot.color };
export const LOOT_ROWS = LOOT_CATEGORIES.map((c) => ({ id: `loot_${c.id}`, category: c.id, label: c.label, keys: [`loot_${c.id}`], requires: ['loot'], color: c.color }));
export const FLOOR_ROW = { id: 'onlyCurrentFloor', label: 'Только текущий этаж', keys: ['onlyCurrentFloor'] };

// Quick toggles over the map.
export const QUICK_FILTERS = [
  { id: 'q-quests', label: 'Задания', keys: ['quests', 'objective', 'item'], color: MARKER_TYPES.objective.color, glyph: 'objective' },
  { id: 'q-boss', label: 'Боссы', keys: ['boss'], color: MARKER_TYPES.boss.color, glyph: 'boss' },
  { id: 'q-spawn', label: 'Спавны ЧВК', keys: ['spawn'], color: MARKER_TYPES.spawn.color, glyph: 'spawn' },
  { id: 'q-loot', label: 'Лут', keys: ['loot'], color: MARKER_TYPES.loot.color, glyph: 'loot' },
];

export const filterOn = (filters, row) => [...row.keys, ...(row.requires || [])].every((k) => Boolean(filters[k]));

export function toggleFilterRow(filters, row) {
  const on = !filterOn(filters, row);
  const next = { ...filters };
  for (const k of row.keys) next[k] = on;
  if (on) for (const k of row.requires || []) next[k] = true;
  return next;
}

export function displayName(entity) {
  return entity.nameRu || entity.name || entity.id;
}
