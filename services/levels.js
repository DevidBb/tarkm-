// Multi-level maps (Interchange, Shoreline): which floors are shown for a level mode, and how far apart the levels of
// the building are drawn in "All floors". Maps without `levels` in their data (Streets) never use this and keep
// their floor rail.

import { FLOOR_ORDER, sameBand } from './coords.js';

export const ALL_FLOORS = 'ALL';
export const EXPLODE_GAP = 24; // m added between building levels in "All floors"
export const MALL_VIEW = 'MALL'; // id of the whole-building view when the map data names none (Interchange)

export const buildingGroup = (mapData) => (mapData && mapData.levels ? mapData.levels.groups.find((g) => g.floors.length > 1) || null : null);
export const buildingFloors = (mapData) => {
  const g = buildingGroup(mapData);
  return g ? g.floors : [];
};

// The whole building inside, every level at its real height, without the exterior: Interchange "Mall", Shoreline "Resort".
export function wholeView(mapData) {
  const g = buildingGroup(mapData);
  if (!g) return null;
  return g.wholeView || { id: MALL_VIEW, name: 'Mall', nameRu: 'ТЦ изнутри' };
}
export const wholeViewId = (mapData) => {
  const v = wholeView(mapData);
  return v ? v.id : MALL_VIEW;
};

// Footprint points of the building in game x/z (Interchange: one outline, Shoreline: rings of the Resort).
function buildingOutline(mapData) {
  const { levels } = mapData;
  if (levels.building) return levels.building.outlines.flat();
  return levels.mall ? levels.mall.outline : [];
}

// null = no level view (Streets behaviour). Otherwise: floors whose markers and geometry are visible, and a
// vertical offset per floor for the exploded view.
export function levelViewFor(mapData, mode) {
  if (!mapData || !mapData.levels) return null;
  if (mode === wholeViewId(mapData)) return { mode, exploded: false, visible: new Set(buildingFloors(mapData)), offsetFor: () => 0 };
  if (mode === ALL_FLOORS) {
    const floors = buildingFloors(mapData);
    const offsets = Object.fromEntries(floors.map((id, i) => [id, i * EXPLODE_GAP]));
    return { mode, exploded: true, visible: new Set(floors), offsetFor: (floorId) => offsets[floorId] || 0 };
  }
  const also = mode === mapData.levels.defaultFloor && mapData.levels.outsideShows ? mapData.levels.outsideShows : [];
  return { mode, exploded: false, visible: new Set([mode, ...also]), offsetFor: () => 0 };
}

// Order for the ↑ / ↓ floor stepper.
export function floorStepOrder(mapData) {
  if (!mapData || !mapData.levels) return FLOOR_ORDER;
  const order = [...mapData.levels.order];
  order.splice(order.indexOf(mapData.levels.defaultFloor) + 1, 0, wholeViewId(mapData));
  return [...order, ALL_FLOORS];
}

// Is `target` visible while `current` is selected (used before jumping to another floor)?
export function floorShows(mapData, current, target) {
  if (!mapData || !target) return true;
  if (mapData.levels) {
    if (current === ALL_FLOORS || current === wholeViewId(mapData)) return buildingFloors(mapData).includes(target);
    if (current === mapData.levels.defaultFloor && (mapData.levels.outsideShows || []).includes(target)) return true;
    return current === target;
  }
  return sameBand(mapData.floors, current, target);
}

// Camera for a level mode (plain numbers, scene coordinates). null = the whole-map home view.
export function levelCamera(mapData, mode) {
  if (!mapData || !mapData.levels || mode === mapData.levels.defaultFloor) return null;
  const ring = buildingOutline(mapData);
  if (!ring.length) return null;
  const xs = ring.map((p) => -p.x);
  const zs = ring.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  // Camera distance follows the building size (offsets below are tuned for the 520 m Interchange mall).
  const k = Math.min(1, Math.max(0.4, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 520));
  const heightOf = (id) => {
    const f = mapData.floors.find((x) => x.id === id);
    return f && f.displayY != null ? f.displayY : 0;
  };
  const floors = buildingFloors(mapData);
  if (mode === wholeViewId(mapData)) {
    const y = (heightOf(floors[0]) + heightOf(floors[floors.length - 1])) / 2;
    return { target: { x: cx, y, z: cz }, position: { x: cx - 380 * k, y: y + 300 * k, z: cz + 360 * k } };
  }
  if (mode === ALL_FLOORS) {
    const bottom = heightOf(floors[0]);
    const top = heightOf(floors[floors.length - 1]) + (floors.length - 1) * EXPLODE_GAP;
    const y = (bottom + top) / 2;
    return { target: { x: cx, y, z: cz }, position: { x: cx - 470 * k, y: y + 260 * k, z: cz + 470 * k } };
  }
  const y = heightOf(mode);
  return { target: { x: cx, y, z: cz }, position: { x: cx + 170 * k, y: y + 440 * k, z: cz + 330 * k } };
}

export const floorLabel = (mapData, floorId) => {
  if (!mapData) return null;
  const group = buildingGroup(mapData);
  if (floorId === ALL_FLOORS) return { id: ALL_FLOORS, name: 'All floors', nameRu: group ? `Все этажи: ${group.nameRu}` : 'Все этажи' };
  const whole = wholeView(mapData);
  if (whole && floorId === whole.id) return whole;
  return mapData.floors.find((f) => f.id === floorId) || null;
};
