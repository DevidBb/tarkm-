// Loads maps/streets/streets.map.json (served as data/streets.map.json) and builds lookups.
// All positions come from that file (imported from tarkov.dev) - nothing here invents coordinates.

import { createProjection, floorForY, distanceBetween, FLOOR_ORDER } from './coords.js';
import { buildTerrain } from './terrain.js';
import { lootCategory } from './markerTypes.js';

export const MAP_DATA_URL = 'data/streets.map.json';
const SUPPORTED_FORMAT = 'tarkov-map-ai/map@1';

const normalize = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').trim();
const clean = (s) => (typeof s === 'string' ? s.trim() || null : s);

export async function loadMapData(url = MAP_DATA_URL) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Данные карты не загрузились (HTTP ${res.status}). Запустите scripts\\import_map.ps1.`);
  const data = await res.json();
  if (data.format !== SUPPORTED_FORMAT) throw new Error(`Неподдерживаемый формат данных карты: ${data.format}`);

  const levels = data.levels || null;
  const projection = createProjection(data.map, data.floors, levels ? levels.defaultFloor : 'GROUND');
  // Open maps with relief (Shoreline): terrain rebuilt from object heights, used to put labels and props on the ground.
  const terrain = data.terrain && Array.isArray(data.terrain.samples) ? buildTerrain(data.terrain.samples, data.map.bounds) : null;
  if (terrain) {
    projection.terrain = terrain;
    projection.heightAt = terrain.heightAtScene;
  }

  const insideRings = (rings, p) => {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const a = ring[i];
        const b = ring[j];
        if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
      }
    }
    return inside;
  };

  // Floor of a game position. Streets: by height bands. Interchange: street outside the mall footprint,
  // otherwise the mall floor whose height band contains y. Shoreline: outside unless inside the Resort footprint,
  // then the Resort floor by the bands of the map config.
  function floorAt(position) {
    if (!position || position.y == null) return null;
    // Customs: many separate buildings. Upper floors by the areas of the map config (rect + height band), then
    // basements (under their outline and below the ground), then the ground floor inside a building, else outside.
    if (levels && levels.zones) {
      const { extents = [], basements = [], interiors = [] } = levels.zones;
      const { x, y, z } = position;
      for (const e of extents) {
        const q = e.rect;
        if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1 && y >= e.minY && y < e.maxY) return e.floor;
      }
      for (const b of basements) if (y < b.maxY && insideRings([b.outline], position)) return 'UNDERGROUND';
      for (const ring of interiors) if (insideRings([ring], position)) return 'LEVEL1';
      return levels.defaultFloor;
    }
    if (levels && levels.building) {
      if (!insideRings(levels.building.outlines, position)) return levels.defaultFloor;
      const band = levels.building.bands.find((b) => b.maxY == null || position.y < b.maxY);
      return band ? band.floor : null;
    }
    if (!levels || !levels.mall) return floorForY(data.floors, position.y);
    const ring = levels.mall.outline;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      if ((a.z > position.z) !== (b.z > position.z) && position.x < ((b.x - a.x) * (position.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    const group = levels.groups.find((g) => (inside ? g.floors.length > 1 : g.floors.length === 1));
    if (!group) return null;
    if (!inside) return group.floors[0];
    const candidates = data.floors.filter((f) => group.floors.includes(f.id));
    return floorForY(candidates, position.y);
  }

  // One entity list for markers + named locations.
  const entities = [
    ...data.markers.map((m) => ({ ...m, name: clean(m.name), nameRu: clean(m.nameRu), meta: m.meta || {} })),
    ...data.locations.map((l) => ({
      id: `loc-${l.id}`,
      type: l.kind === 'street' ? 'street' : 'place',
      name: clean(l.name),
      nameRu: clean(l.nameRu),
      position: l.position,
      floor: l.floor,
      meta: { kind: l.kind, source: l.source },
    })),
  ];
  const byId = new Map(entities.map((e) => [e.id, e]));

  // Loot spawn points: kept out of `entities` (no HTML markers, not in search / nearest), drawn by map/loot.js.
  const lootData = data.loot || { containerTypes: [], items: {}, containers: [], loose: [] };
  const containerTypes = new Map(lootData.containerTypes.map((t) => [t.id, t]));
  const colorOf = (category) => (lootCategory(category) || { color: '#cccccc' }).color;
  const loot = [
    ...lootData.containers.map((c, i) => {
      const t = containerTypes.get(c.type) || {};
      const category = t.category || 'common';
      return {
        id: `loot-c-${i}`, type: 'loot', name: clean(t.name) || 'Container', nameRu: clean(t.nameRu),
        position: { x: c.x, y: c.y, z: c.z }, floor: c.floor,
        meta: { category, containerTypeId: c.type, color: colorOf(category) },
      };
    }),
    ...lootData.loose.map((l, i) => ({
      id: `loot-l-${i}`, type: 'loot', name: 'Loose loot', nameRu: 'Лут на полу',
      position: { x: l.x, y: l.y, z: l.z }, floor: l.floor,
      meta: { category: 'loose', color: colorOf('loose'), items: (l.items || []).map((id) => lootData.items[id]).filter(Boolean) },
    })),
  ];
  const lootCounts = {};
  for (const e of loot) {
    byId.set(e.id, e);
    lootCounts[e.meta.category] = (lootCounts[e.meta.category] || 0) + 1;
  }

  // Places Claude may choose from when it analyses a screenshot (ids must round-trip exactly).
  const aiCatalog = entities.filter((e) => ['place', 'street', 'extract', 'trader', 'transit'].includes(e.type));

  function nearest(position, { types, limit = 5, maxMeters = Infinity } = {}) {
    return entities
      .filter((e) => !types || types.includes(e.type))
      .map((e) => ({ entity: e, ...distanceBetween(position, e.position) }))
      .filter((r) => r.meters <= maxMeters)
      .sort((a, b) => a.meters - b.meters)
      .slice(0, limit);
  }

  function search(query, limit = 60) {
    const q = normalize(query);
    if (!q) return [];
    const hits = [];
    for (const e of entities) {
      const hay = [e.name, e.nameRu, e.meta.zoneName, e.meta.zoneNameRu, e.meta.keyId].map(normalize).join(' | ');
      const idx = hay.indexOf(q);
      if (idx >= 0) hits.push({ entity: e, score: idx === 0 ? 0 : 1 });
    }
    return hits.sort((a, b) => a.score - b.score).slice(0, limit).map((h) => h.entity);
  }

  return {
    raw: data,
    map: data.map,
    floors: data.floors,
    sources: data.sources,
    generatedAt: data.generatedAt,
    projection,
    entities,
    loot,
    lootCounts,
    byId,
    aiCatalog,
    svgUrl: `data/${data.map.svg.file}`,
    environmentUrl: data.map.environmentFile ? `data/${data.map.environmentFile}` : 'data/streets.environment.json',
    kind: data.map.kind || 'city',
    levels,
    defaultFloor: levels ? levels.defaultFloor : 'GROUND',
    floorOrder: levels ? levels.order : FLOOR_ORDER,
    floorOf: (y) => floorForY(data.floors, y),
    floorAt,
    terrain,
    heightAt: terrain ? terrain.heightAtScene : null,
    nearest,
    search,
  };
}
