// Step-by-step quest guide built only from imported data: objective points (tarkov.dev),
// the nearest named place, floor by height, required keys with their lock markers, extracts and boss zones.

import { distanceBetween } from './coords.js';
import { displayName } from './markerTypes.js';
import { questName, traderName } from './questData.js';

export const OBJECTIVE_LABELS = {
  visit: 'Посетить место',
  findQuestItem: 'Найти квестовый предмет',
  giveQuestItem: 'Передать квестовый предмет',
  findItem: 'Найти предмет',
  giveItem: 'Передать предмет',
  plantItem: 'Заложить предмет',
  plantQuestItem: 'Заложить квестовый предмет',
  mark: 'Отметить маркером',
  shoot: 'Устранить цель',
  extract: 'Выйти с локации',
  useItem: 'Использовать предмет',
  experience: 'Условие по опыту',
  skill: 'Навык',
  traderLevel: 'Уровень торговца',
  traderStanding: 'Репутация у торговца',
  taskStatus: 'Статус другого квеста',
  playerLevel: 'Уровень игрока',
  buildWeapon: 'Собрать оружие',
  sellItem: 'Продать предмет',
};

const PLACE_RADIUS = 150;
const lc = (s) => String(s || '').trim().toLowerCase();

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function nearestPlace(map, position) {
  const hit = map.nearest({ x: position.x, y: null, z: position.z }, { types: ['place'], limit: 1, maxMeters: PLACE_RADIUS })[0];
  return hit ? { place: hit.entity, meters: hit.meters } : null;
}

export function lockMarkersForKey(map, key) {
  const names = new Set([...(key.names || []), ...(key.namesRu || [])].map(lc).filter(Boolean));
  if (!names.size) return [];
  return map.entities.filter((e) => e.type === 'key' && (names.has(lc(e.name)) || names.has(lc(e.nameRu))));
}

export function extractMarker(map, exitName) {
  if (!exitName) return null;
  return map.entities.find((e) => e.type === 'extract' && lc(e.meta.gameKey) === lc(exitName)) || null;
}

export function bossMarkers(map, targetNames) {
  const names = new Set((targetNames || []).map(lc).filter(Boolean));
  if (!names.size) return [];
  return map.entities.filter((e) => e.type === 'boss' && (names.has(lc(e.name)) || names.has(lc(e.nameRu)) || names.has(lc(e.meta.mob))));
}

export const keyName = (key) => (key.namesRu || []).find(Boolean) || (key.names || []).find(Boolean) || 'Ключ';

function placesSummary(map, points) {
  const groups = new Map();
  for (const p of points) {
    const near = nearestPlace(map, p.position);
    const key = `${near ? near.place.id : 'none'}|${p.floor || '?'}`;
    const group = groups.get(key) || { place: near ? near.place : null, meters: null, floor: p.floor || null, count: 0, pointIds: [] };
    if (near && (group.meters == null || near.meters < group.meters)) group.meters = near.meters;
    group.count += 1;
    group.pointIds.push(p.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

const refName = (r) => (r ? r.nameRu || r.name : null);

function hintsFor(o, { quest, extract, bosses }) {
  const hints = [];
  const possible = o.points.filter((p) => p.kind === 'possible').length;
  if (possible > 1) hints.push(`${possible} ${plural(possible, 'возможное место', 'возможных места', 'возможных мест')}: предмет появляется в одном из них, проверьте все отмеченные точки.`);
  if (o.questItem) hints.push(`Предмет: ${refName(o.questItem)}`);
  if (o.items && o.items.length) {
    const names = o.items.map(refName).filter(Boolean);
    const more = o.itemsTotal > names.length ? ` и ещё ${o.itemsTotal - names.length}` : '';
    hints.push(`${o.count > 1 ? `${o.count} шт. · ` : ''}${names.length > 1 ? 'Подходит' : 'Предмет'}: ${names.join(', ')}${more}`);
  }
  if (o.markerItem) hints.push(`Нужен: ${refName(o.markerItem)}`);
  if (o.weapons && o.weapons.length) {
    const names = o.weapons.map(refName).filter(Boolean);
    const more = o.weaponsTotal > names.length ? ` и ещё ${o.weaponsTotal - names.length}` : '';
    hints.push(`Оружие: ${names.join(', ')}${more}`);
  }
  if (o.foundInRaid) hints.push('Предмет должен быть найден в рейде (FIR).');
  if (o.type === 'shoot') {
    if (bosses.length) {
      hints.push(`Зона появления: ${bosses.map((b) => `${b.meta.zoneNameRu || b.meta.zoneName || displayName(b)} (шанс босса ${Math.round((b.meta.spawnChance || 0) * 100)}%)`).join(', ')}`);
    } else {
      hints.push(`Точки на карте нет: ${o.count > 1 ? `нужно ${o.count} раз, ` : ''}цель может быть в любом месте локации.`);
    }
  }
  if (o.type === 'extract') hints.push(extract ? `Выход: ${displayName(extract)}` : 'Подойдёт любой выход с локации.');
  if ((o.type === 'giveQuestItem' || o.type === 'giveItem') && !o.points.length) hints.push(`Сдать торговцу ${traderName(quest.trader)} после рейда.`);
  if (!o.points.length && !['shoot', 'extract', 'giveQuestItem', 'giveItem'].includes(o.type)) {
    hints.push('Для этой цели в данных tarkov.dev нет точки на карте.');
  }
  return hints;
}

export function buildGuide(quest, { map, progressEntry, player }) {
  const done = (progressEntry && progressEntry.done) || {};
  const completed = progressEntry && progressEntry.status === 'completed';
  const steps = quest.objectives.map((o, i) => {
    const extract = extractMarker(map, o.exitName);
    const bosses = o.type === 'shoot' ? bossMarkers(map, o.targetNames) : [];
    const keys = (o.requiredKeys || []).map((k) => ({ ...k, locks: lockMarkersForKey(map, k) }));
    let nearest = null;
    if (player) {
      for (const p of o.points) {
        const d = distanceBetween(player.position, p.position);
        if (!nearest || d.meters < nearest.meters) nearest = { pointId: p.id, meters: d.meters, is3d: d.is3d };
      }
    }
    return {
      n: i + 1,
      objective: o,
      label: OBJECTIVE_LABELS[o.type] || 'Условие',
      text: o.descriptionRu || o.description || OBJECTIVE_LABELS[o.type] || o.type,
      done: Boolean(completed || done[o.id]),
      places: placesSummary(map, o.points),
      keys,
      extract,
      bosses,
      nearest,
      hints: hintsFor(o, { quest, extract, bosses }),
    };
  });
  const neededKeys = (quest.neededKeys || []).map((k) => ({ ...k, locks: lockMarkersForKey(map, k) }));
  const next = steps.filter((s) => !s.done && s.nearest).sort((a, b) => a.nearest.meters - b.nearest.meters)[0] || null;
  return { quest, steps, neededKeys, next };
}

// Plain-text version of the guide (copy button).
export function guideToText(guide) {
  const q = guide.quest;
  const lines = [`${questName(q)} — ${traderName(q.trader)}`];
  if (guide.neededKeys.length) lines.push(`Ключи: ${guide.neededKeys.map(keyName).join('; ')}`);
  for (const s of guide.steps) {
    const where = [...new Set(s.places.filter((g) => g.place).map((g) => `у ${displayName(g.place)} (~${Math.round(g.meters)} м${g.floor ? `, ${g.floor}` : ''})`))];
    lines.push(`${s.n}. ${s.text}${where.length ? ` — ${where.join('; ')}` : ''}`);
    for (const h of s.hints) lines.push(`   • ${h}`);
    for (const k of s.keys) lines.push(`   • Ключ: ${keyName(k)}`);
  }
  return lines.join('\n');
}
