// Persistent storage for player positions.
// Inside Claude (Artifact): platform `db` document store + `assets` for screenshots - survives reloads and republishes.
// Local preview: localStorage fallback (this browser only, no screenshots).

import { capability } from './runtime.js';

const COLLECTION = 'player_positions';
const LOCAL_KEY = 'tarkov-map-ai:player_positions';
const HISTORY_LIMIT = 50;
const UPLOADABLE = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export async function createStorage() {
  const [db, assets] = await Promise.all([capability('db'), capability('assets')]);
  return db ? dbStore(db, assets) : localStore();
}

function dbStore(db, assets) {
  const col = db.collection(COLLECTION);
  return {
    mode: 'db',
    label: 'База приложения',
    canStoreScreenshots: Boolean(assets),
    async savePosition(record, screenshot) {
      let screenshotId = null;
      let screenshotError = null;
      if (assets && screenshot && UPLOADABLE.includes(screenshot.type)) {
        try {
          screenshotId = (await assets.upload(screenshot)).id;
        } catch (e) {
          screenshotError = (e && e.code) || 'upload_failed';
        }
      }
      const body = { ...record, screenshotId };
      const ref = await col.add(body);
      return { id: ref.id, ...body, screenshotError };
    },
    subscribePositions(onChange, onError) {
      return col.orderBy('createdAt', 'desc').limit(HISTORY_LIMIT).onSnapshot(
        (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (e) => { if (onError) onError(e); },
      );
    },
    screenshotUrl: (id) => (id ? `/_blob/${id}` : null),
  };
}

function localStore() {
  const listeners = new Set();
  const read = () => {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; }
  };
  const write = (rows) => {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(rows)); } catch { /* storage blocked: keep in memory only */ }
  };
  let memory = read();
  return {
    mode: 'local',
    label: 'Локально в браузере',
    canStoreScreenshots: false,
    async savePosition(record) {
      const row = { id: `local-${Date.now()}`, ...record, screenshotId: null };
      memory = [row, ...memory].slice(0, HISTORY_LIMIT);
      write(memory);
      listeners.forEach((fn) => fn(memory));
      return row;
    },
    subscribePositions(onChange) {
      listeners.add(onChange);
      onChange(memory);
      return () => listeners.delete(onChange);
    },
    screenshotUrl: () => null,
  };
}
