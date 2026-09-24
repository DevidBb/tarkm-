// Frontend API facade. The UI talks only to this module.
// It mirrors the planned backend endpoints, so a later local FastAPI backend can replace the
// Artifact runtime implementation without touching components:
//   GET  /api/map                -> loadMap()                        (data/streets.map.json)
//   GET  /api/locations          -> map.entities / map.search()
//   POST /api/quests/search      -> quests.match()                   (data/streets.quests.json, local matching)
//   POST /api/quests/parse       -> runtime.questAI.identifyQuest()  (Claude picks ids from the quest list)
//   POST /api/position/detect    -> api.detectPosition()
//   GET  /api/positions/history  -> api.subscribeHistory()
//   POST /api/progress           -> runtime.progress.setStatus() / toggleObjective()

import { loadMapData } from './mapData.js';
import { loadQuestData } from './questData.js';
import { createStorage } from './storage.js';
import { createVision } from './claudeVision.js';
import { createProgressStore } from './progress.js';
import { createQuestAI } from './claudeQuests.js';
import { loadMarketData } from './market.js';
import { createMarketAI } from './claudeMarket.js';
import { detectPosition, toPositionRecord } from './positionDetection.js';

// def: entry of services/mapRegistry.js (Streets when omitted).
export function loadMap(def = null) {
  return loadMapData(def ? def.mapUrl : undefined);
}

export function loadQuests(def = null) {
  return loadQuestData(def ? def.questsUrl : undefined);
}

// GET /api/market/prices -> data/market/prices.json (tarkov.dev snapshot)
export function loadMarket() {
  return loadMarketData();
}

export async function connectRuntime() {
  const [storage, vision, progress, questAI, marketAI] = await Promise.all([createStorage(), createVision(), createProgressStore(), createQuestAI(), createMarketAI()]);
  return { storage, vision, progress, questAI, marketAI };
}

export function createApi(map, { storage, vision }) {
  return {
    map,
    storage,
    vision,
    detectPosition: (args) => detectPosition({ ...args, mapData: map, vision }),
    savePosition: (result, fileName, screenshot) => storage.savePosition({ ...toPositionRecord(result, fileName), mapId: map.map.id }, screenshot),
    subscribeHistory: (onChange, onError) => storage.subscribePositions(onChange, onError),
  };
}
