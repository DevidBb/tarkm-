// Chooses which map the app shows. Every map runs the same App; switching remounts it (key), which disposes
// the previous 3D scene. Interchange-specific 3D code is loaded lazily by the scene only when that map opens.

import { html, useState, useEffect } from './html.js';
import { App } from './App.js';
import { MapSwitcher } from './MapSwitcher.js';
import { MAPS, mapDefinition } from '../services/mapRegistry.js';

const MAP_KEY = 'tarkov-map-ai:map';

function initialMap() {
  try {
    const saved = localStorage.getItem(MAP_KEY);
    return MAPS.some((m) => m.id === saved) ? saved : 'streets';
  } catch {
    return 'streets';
  }
}

export function Root() {
  const [mapId, setMapId] = useState(initialMap);
  useEffect(() => {
    try { localStorage.setItem(MAP_KEY, mapId); } catch { /* storage unavailable */ }
  }, [mapId]);
  const def = mapDefinition(mapId);
  const switcher = html`<${MapSwitcher} value=${def.id} onChange=${setMapId} />`;
  return html`<${App} key=${def.id} mapDef=${def} mapSwitcher=${switcher} />`;
}
