// Quest progress: status (active / completed) and completed objectives per quest.
// Inside Claude (Artifact): `db` collection quest_progress, one document per quest id - survives reloads.
// Local preview: localStorage fallback (this browser only).

import { capability } from './runtime.js';

const COLLECTION = 'quest_progress';
const LOCAL_KEY = 'tarkov-map-ai:quest_progress';

const emptyEntry = () => ({ status: null, done: {}, updatedAt: null });

function normalizeEntry(raw) {
  const done = raw && raw.done && typeof raw.done === 'object' ? raw.done : {};
  const status = raw && (raw.status === 'active' || raw.status === 'completed') ? raw.status : null;
  return { status, done: { ...done }, updatedAt: (raw && raw.updatedAt) || null };
}

function createApi({ mode, label, read, persist, startSync }) {
  let current = read();
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(current));

  async function write(questId, entry) {
    const next = { ...entry, updatedAt: new Date().toISOString() };
    current = new Map(current).set(questId, next);
    emit();
    await persist(questId, next, current);
  }

  const get = (questId) => current.get(questId) || emptyEntry();

  return {
    mode,
    label,
    subscribe(fn, onError) {
      listeners.add(fn);
      if (startSync) startSync((map) => { current = map; emit(); }, onError);
      fn(current);
      return () => listeners.delete(fn);
    },
    get,
    setStatus(questId, status) {
      return write(questId, { ...get(questId), status });
    },
    toggleObjective(questId, objectiveId, isDone) {
      const entry = get(questId);
      const done = { ...entry.done };
      if (isDone) done[objectiveId] = true;
      else delete done[objectiveId];
      return write(questId, { ...entry, done, status: entry.status || 'active' });
    },
    async addActive(questIds) {
      for (const id of questIds) {
        const entry = get(id);
        if (entry.status !== 'completed' && entry.status !== 'active') await write(id, { ...entry, status: 'active' });
      }
    },
  };
}

export async function createProgressStore() {
  const db = await capability('db');
  if (db) {
    const col = db.collection(COLLECTION);
    let syncing = false;
    return createApi({
      mode: 'db',
      label: 'База приложения',
      read: () => new Map(),
      persist: (questId, entry) => col.doc(questId).set(entry),
      startSync(apply, onError) {
        if (syncing) return;
        syncing = true;
        col.onSnapshot(
          (snap) => apply(new Map(snap.docs.map((d) => [d.id, normalizeEntry(d.data())]))),
          (e) => { if (onError) onError(e); },
        );
      },
    });
  }
  return createApi({
    mode: 'local',
    label: 'Локально в браузере',
    read() {
      try {
        const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
        return new Map(Object.entries(raw).map(([id, e]) => [id, normalizeEntry(e)]));
      } catch {
        return new Map();
      }
    },
    persist(_id, _entry, all) {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(Object.fromEntries(all)));
      } catch { /* storage blocked: progress stays in memory for this visit */ }
    },
  });
}
