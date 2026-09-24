import { html, Glyph, useState, useEffect, useRef, useMemo, useCallback } from './html.js';
import { loadMap, loadQuests, loadMarket, connectRuntime, createApi } from '../services/api.js';
import { recognizeInventory, mergeRows, newRowKey } from '../services/evaluate.js';
import { recognitionProblem } from '../services/claudeMarket.js';
import { BUILD } from '../services/version.js';
import { DEFAULT_FILTERS, GLYPHS, QUICK_FILTERS, LOOT_CATEGORIES, filterOn, toggleFilterRow } from '../services/markerTypes.js';
import { distanceBetween } from '../services/coords.js';
import { floorShows, floorStepOrder, floorLabel } from '../services/levels.js';
import { LevelPanel } from './LevelPanel.js';
import { foundFromCandidate, resultFromRecord } from '../services/positionDetection.js';
import { visionErrorMessage } from '../services/claudeVision.js';
import { decideMatch, questName, traderColor } from '../services/questData.js';
import { buildGuide } from '../services/questGuide.js';
import { MapScene, webglAvailable } from '../map/MapScene.js';
import { TopBar } from './TopBar.js';
import { EvaluateStage } from './EvaluatePanel.js';
import { SidePanel } from './SidePanel.js';
import { InfoPanel } from './InfoPanel.js';
import { BottomBar } from './BottomBar.js';
import { FloorRail } from './FloorRail.js';
import { FiltersMenu } from './FiltersMenu.js';
import { LocateDialog } from './LocateDialog.js';

const IMAGE_NAME = /\.(png|jpe?g|webp|gif|bmp)$/i;
const EMPTY_PROGRESS = new Map();
const IDLE_AI = { phase: 'idle', results: [] };
const IDLE_IMPORT = { phase: 'idle', items: [] };
const FILTERS_KEY = 'tarkov-map-ai:filters';
const EVAL_KEY = 'tarkov-map-ai:evaluate';
const IDLE_EVAL = { phase: 'idle' };

function loadStoredEvaluation() {
  try {
    const saved = JSON.parse(localStorage.getItem(EVAL_KEY) || 'null');
    return {
      mode: saved && saved.mode === 'pve' ? 'pve' : 'pvp',
      rows: saved && Array.isArray(saved.rows) ? saved.rows.filter((r) => r && r.key && Number.isFinite(r.count)) : [],
    };
  } catch {
    return { mode: 'pvp', rows: [] };
  }
}

// Filters are a per-viewer convenience: remembered in this browser, merged over defaults so new keys appear.
function loadFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return DEFAULT_FILTERS;
    const merged = { ...DEFAULT_FILTERS };
    for (const k of Object.keys(DEFAULT_FILTERS)) if (typeof saved[k] === 'boolean') merged[k] = saved[k];
    return merged;
  } catch {
    return DEFAULT_FILTERS;
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// A quest name read from a screenshot counts only when it clearly matches one quest.
function matchQuestName(questsData, name) {
  const results = questsData.match(name, 3);
  if (decideMatch(results).level === 'sure') return results[0].quest;
  const [top, second] = results;
  if (top && top.score >= 0.7 && (!second || top.score - second.score >= 0.1)) return top.quest;
  return null;
}

function mostCommonFloor(points) {
  const counts = new Map();
  for (const p of points) if (p.floor) counts.set(p.floor, (counts.get(p.floor) || 0) + 1);
  let best = null;
  for (const [floor, n] of counts) if (!best || n > best[1]) best = [floor, n];
  return best ? best[0] : null;
}

export function App({ mapSwitcher = null, mapDef = null } = {}) {
  const [map, setMap] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sceneError, setSceneError] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [floor, setFloor] = useState('GROUND');
  const [filters, setFilters] = useState(loadFilters);
  const [selectedId, setSelectedId] = useState(null);
  const [player, setPlayer] = useState(null);
  const [uncertain, setUncertain] = useState(null);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState('quests');
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [locate, setLocate] = useState({ open: false, phase: 'idle' });
  const [dragging, setDragging] = useState(false);
  const [wallMode, setWallMode] = useState('full');
  const mapName = mapDef ? mapDef.name : 'Streets of Tarkov';
  const mapShort = mapName.replace(/ of Tarkov$/, '');

  const [questsData, setQuestsData] = useState(null);
  const [questsError, setQuestsError] = useState(null);
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const [selectedQuestId, setSelectedQuestId] = useState(null);
  const [selectedObjectiveId, setSelectedObjectiveId] = useState(null);
  const [questQuery, setQuestQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [questAi, setQuestAi] = useState(IDLE_AI);
  const [importState, setImportState] = useState(IDLE_IMPORT);
  const [traderFilter, setTraderFilter] = useState(null);

  const [market, setMarket] = useState(null);
  const [marketError, setMarketError] = useState(null);
  const [marketMode, setMarketMode] = useState(() => loadStoredEvaluation().mode);
  const [evalRows, setEvalRows] = useState(() => loadStoredEvaluation().rows);
  const [evalState, setEvalState] = useState(IDLE_EVAL);
  const [evalShot, setEvalShot] = useState(null); // last screenshot given to "Оценить": { url, name }
  const [routeInfo, setRouteInfo] = useState(null);
  const marketPromiseRef = useRef(null);
  const evalAbortRef = useRef(null);
  const imageTargetRef = useRef(null);
  const pendingEvalRef = useRef(null);

  const viewportRef = useRef(null);
  const sceneRef = useRef(null);
  const searchRef = useRef(null);
  const questInputRef = useRef(null);
  const abortRef = useRef(null);
  const selectHandlerRef = useRef(() => {});
  const autoSelectRef = useRef(null);

  useEffect(() => {
    loadMap(mapDef)
      .then((m) => {
        setFloor(m.defaultFloor);
        setMap(m);
      })
      .catch((e) => setLoadError(e.message));
    loadQuests(mapDef).then(setQuestsData).catch((e) => setQuestsError(e.message));
    connectRuntime()
      .then(setRuntime)
      .catch(() => setRuntime({ storage: null, vision: { available: false, message: 'Не удалось подключиться к Claude.' }, progress: null, questAI: null }));
  }, []);

  const api = useMemo(() => (map && runtime && runtime.storage ? createApi(map, runtime) : null), [map, runtime]);
  const marketAI = runtime ? runtime.marketAI : null;
  const recognitionIssue = recognitionProblem(marketAI, Boolean(runtime));

  // Prices (~1 MB) load the first time the Evaluate tab is used.
  const ensureMarket = useCallback(() => {
    if (!marketPromiseRef.current) {
      marketPromiseRef.current = loadMarket()
        .then((m) => { setMarket(m); return m; })
        .catch((e) => { setMarketError(e.message); marketPromiseRef.current = null; throw e; });
    }
    return marketPromiseRef.current;
  }, []);

  useEffect(() => { if (tab === 'evaluate') ensureMarket().catch(() => {}); }, [tab, ensureMarket]);

  useEffect(() => {
    try { localStorage.setItem(EVAL_KEY, JSON.stringify({ mode: marketMode, rows: evalRows })); } catch { /* storage unavailable */ }
  }, [marketMode, evalRows]);
  const progressStore = runtime ? runtime.progress : null;
  const questAI = runtime ? runtime.questAI : null;

  useEffect(() => {
    if (!progressStore) return undefined;
    return progressStore.subscribe((m) => setProgress(new Map(m)), (e) => console.warn('[progress]', e));
  }, [progressStore]);

  // Scene lifecycle
  useEffect(() => {
    if (!map || !viewportRef.current) return undefined;
    if (!webglAvailable()) {
      setSceneError('WebGL недоступен в этом браузере: включите аппаратное ускорение или обновите драйвер видеокарты.');
      return undefined;
    }
    let scene;
    try {
      scene = new MapScene(viewportRef.current, map, { onSelect: (id) => selectHandlerRef.current(id), onRoute: (info) => setRouteInfo(info) });
    } catch (e) {
      setSceneError(`3D-сцена не запустилась: ${e.message}`);
      return undefined;
    }
    sceneRef.current = scene;
    scene.load().catch((e) => setSceneError(e.message));
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [map]);

  // Quest objective points shown on the map: the selected quest, plus every active quest in the background.
  const questPointEntities = useMemo(() => {
    if (!questsData) return [];
    const list = [];
    const add = (quest, background) => {
      const entry = progress.get(quest.id);
      const color = traderColor(quest.trader);
      for (const o of quest.objectives) {
        const done = Boolean(entry && (entry.status === 'completed' || (entry.done && entry.done[o.id])));
        if (background && done) continue;
        o.points.forEach((p) => {
          list.push({
            id: p.id,
            type: p.kind === 'possible' ? 'item' : 'objective',
            name: o.description,
            nameRu: o.descriptionRu,
            position: p.position,
            floor: p.floor,
            meta: {
              questId: quest.id,
              objectiveId: o.id,
              badge: String(o.index + 1),
              label: `${questName(quest)} · шаг ${o.index + 1}${p.kind === 'possible' ? ' (возможное место)' : ''}`,
              color,
              done,
              background,
              focus: !background && selectedObjectiveId === o.id,
            },
          });
        });
      }
    };
    const selected = selectedQuestId ? questsData.byId.get(selectedQuestId) : null;
    if (selected) add(selected, false);
    for (const q of questsData.quests) {
      if (q.id !== selectedQuestId && (progress.get(q.id) || {}).status === 'active') add(q, true);
    }
    return list;
  }, [questsData, progress, selectedQuestId, selectedObjectiveId]);

  const questPointsById = useMemo(() => new Map(questPointEntities.map((e) => [e.id, e])), [questPointEntities]);

  useEffect(() => { if (sceneRef.current) sceneRef.current.setQuestPoints(questPointEntities); }, [questPointEntities, map]);
  useEffect(() => { if (sceneRef.current) sceneRef.current.setFloor(floor); }, [floor, map]);
  useEffect(() => { if (sceneRef.current) sceneRef.current.applyVisibility(floor, filters); }, [floor, filters, map]);
  useEffect(() => { if (sceneRef.current) sceneRef.current.setSelected(selectedId); }, [selectedId, map, questPointEntities]);
  useEffect(() => { if (sceneRef.current) sceneRef.current.setCandidates(uncertain ? uncertain.ai.candidates : null); }, [uncertain, map]);
  useEffect(() => { if (sceneRef.current) sceneRef.current.setWallMode(wallMode); }, [wallMode, map]);
  // The "Оценить" tab covers the map: stop drawing the 3D scene once the curtain has closed.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;
    if (tab !== 'evaluate') {
      scene.setPaused(false);
      return undefined;
    }
    const t = setTimeout(() => scene.setPaused(true), 500);
    return () => clearTimeout(t);
  }, [tab, map]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setPlayer(player);
    if (player && player.fly) scene.flyToPlayer(player.approximate ? 280 : 150);
  }, [player, map]);

  useEffect(() => {
    if (!api) return undefined;
    return api.subscribeHistory(setHistory, (e) => console.warn('[history]', e));
  }, [api]);

  selectHandlerRef.current = (id) => {
    const point = questPointsById.get(id);
    if (point) {
      setSelectedQuestId(point.meta.questId);
      setSelectedObjectiveId(point.meta.objectiveId);
    }
    setSelectedId(id);
  };

  const focusEntity = useCallback((id) => {
    if (!map) return;
    const entity = map.byId.get(id);
    setSelectedId(id);
    if (entity && entity.floor && !floorShows(map, floor, entity.floor)) setFloor(entity.floor);
    if (sceneRef.current) sceneRef.current.flyToEntity(id, 170);
  }, [map, floor]);

  const selectQuest = useCallback((questId) => {
    if (!questsData) return;
    const quest = questsData.byId.get(questId);
    if (!quest) return;
    setSelectedQuestId(questId);
    setSelectedObjectiveId(null);
    setSelectedId(null);
    const points = quest.objectives.flatMap((o) => o.points);
    if (!points.length) return;
    const questFloor = mostCommonFloor(points);
    if (questFloor && map) setFloor((f) => (floorShows(map, f, questFloor) ? f : questFloor));
    if (sceneRef.current) sceneRef.current.fitPositions(points.map((p) => p.position));
  }, [questsData, map]);

  const focusQuestPoints = useCallback((questId, objectiveId) => {
    if (!questsData) return;
    const quest = questsData.byId.get(questId);
    const objective = quest && quest.objectives.find((o) => o.id === objectiveId);
    if (!objective) return;
    setSelectedQuestId(questId);
    setSelectedObjectiveId(objectiveId);
    const { points } = objective;
    if (!points.length) return;
    let target = points[0];
    if (player) {
      let best = Infinity;
      for (const p of points) {
        const d = distanceBetween(player.position, p.position).meters;
        if (d < best) { best = d; target = p; }
      }
    }
    setSelectedId(target.id);
    if (target.floor && map && !floorShows(map, floor, target.floor)) setFloor(target.floor);
    if (sceneRef.current) sceneRef.current.fitPositions(points.map((p) => p.position), 110);
  }, [questsData, player, map, floor]);

  // Quest search: debounce, match locally, open the quest when the match is unambiguous.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(questQuery), 220);
    return () => clearTimeout(t);
  }, [questQuery]);

  const questMatch = useMemo(
    () => (questsData && debouncedQuery.trim() ? decideMatch(questsData.match(debouncedQuery)) : { level: 'none', results: [] }),
    [questsData, debouncedQuery],
  );

  useEffect(() => { setQuestAi(IDLE_AI); }, [debouncedQuery]);

  useEffect(() => {
    if (questMatch.level !== 'sure') return;
    const id = questMatch.results[0].quest.id;
    const key = `${debouncedQuery}|${id}`;
    if (autoSelectRef.current === key) return;
    autoSelectRef.current = key;
    selectQuest(id);
  }, [questMatch, debouncedQuery, selectQuest]);

  const askClaude = useCallback(async () => {
    if (!questAI || !questAI.available || !questsData || !questQuery.trim()) return;
    setQuestAi({ phase: 'thinking', results: [] });
    try {
      const results = await questAI.identifyQuest(questQuery, questsData, { mapName });
      setQuestAi({ phase: 'done', results });
      if (results[0] && results[0].score >= 0.8) selectQuest(results[0].quest.id);
    } catch (e) {
      setQuestAi({ phase: 'error', results: [], error: visionErrorMessage(e) });
    }
  }, [questAI, questsData, questQuery, selectQuest]);

  const importQuestScreenshot = useCallback(async (file) => {
    if (!questAI || !questsData) return;
    setImportState({ phase: 'reading', items: [] });
    try {
      const names = await questAI.readQuestList(file);
      const items = names.map((n) => ({ ...n, quest: matchQuestName(questsData, n.name) }));
      setImportState({ phase: 'done', items, added: false });
    } catch (e) {
      setImportState({ phase: 'error', items: [], error: visionErrorMessage(e) });
    }
  }, [questAI, questsData]);

  const addImported = useCallback(async () => {
    if (!progressStore) return;
    const ids = [...new Set(importState.items.filter((i) => i.quest).map((i) => i.quest.id))];
    try {
      await progressStore.addActive(ids);
      setImportState((s) => ({ ...s, added: true }));
    } catch (e) {
      console.warn('[progress]', e);
    }
  }, [progressStore, importState]);

  const setQuestStatus = useCallback((questId, status) => {
    if (progressStore) progressStore.setStatus(questId, status).catch((e) => console.warn('[progress]', e));
  }, [progressStore]);

  const toggleObjective = useCallback((questId, objectiveId, done) => {
    if (progressStore) progressStore.toggleObjective(questId, objectiveId, done).catch((e) => console.warn('[progress]', e));
  }, [progressStore]);

  const selectedQuest = questsData && selectedQuestId ? questsData.byId.get(selectedQuestId) : null;
  const guide = useMemo(
    () => (selectedQuest && map ? buildGuide(selectedQuest, { map, progressEntry: progress.get(selectedQuest.id), player }) : null),
    [selectedQuest, map, progress, player],
  );

  const activeQuestIds = useMemo(() => [...progress].filter(([, e]) => e.status === 'active').map(([id]) => id), [progress]);

  const nearbyObjectives = useMemo(() => {
    if (!player || !questsData) return [];
    const ids = new Set(activeQuestIds);
    if (selectedQuestId) ids.add(selectedQuestId);
    const best = [];
    for (const id of ids) {
      const quest = questsData.byId.get(id);
      if (!quest) continue;
      const entry = progress.get(id);
      if (entry && entry.status === 'completed') continue;
      for (const o of quest.objectives) {
        if (entry && entry.done && entry.done[o.id]) continue;
        let nearest = null;
        for (const p of o.points) {
          const d = distanceBetween(player.position, p.position);
          if (!nearest || d.meters < nearest.meters) nearest = { quest, objective: o, point: p, meters: d.meters };
        }
        if (nearest) best.push(nearest);
      }
    }
    return best.sort((a, b) => a.meters - b.meters).slice(0, 5);
  }, [player, questsData, progress, activeQuestIds, selectedQuestId]);

  const showPlayer = useCallback((result) => {
    setUncertain(null);
    setPlayer({ ...result, fly: Date.now() });
    if (result.floor) setFloor(result.floor);
  }, []);

  const acceptResult = useCallback(async (result, file, fileName) => {
    showPlayer(result);
    try {
      await api.savePosition(result, fileName, file);
    } catch (e) {
      console.warn('[save position]', e);
      setLocate((s) => ({ ...s, saveError: 'Позиция показана на карте, но не сохранилась в истории.' }));
    }
  }, [api, showPlayer]);

  const runLocate = useCallback(async (file) => {
    if (!api || !file) return;
    if (abortRef.current) abortRef.current.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    const fileName = file.name || '';
    setUncertain(null);
    setLocate({ open: true, phase: 'reading', fileName, preview: null, result: null, error: null, streamed: 0 });
    readAsDataUrl(file).then((preview) => setLocate((s) => (s.fileName === fileName ? { ...s, preview } : s)));
    try {
      const result = await api.detectPosition({
        file,
        fileName,
        signal: ctl.signal,
        onStep: (step) => setLocate((s) => ({ ...s, phase: step === 'ai' ? 'analyzing' : 'reading' })),
        onText: ({ text }) => setLocate((s) => ({ ...s, streamed: text.length })),
      });
      if (ctl.signal.aborted) return;
      setLocate((s) => ({ ...s, phase: 'done', result }));
      if (result.status === 'found') acceptResult(result, file, fileName);
      if (result.status === 'uncertain') setUncertain({ ai: result.ai, file, fileName });
    } catch (e) {
      if (e && e.code === 'cancelled') {
        setLocate((s) => ({ ...s, phase: 'idle', result: null }));
        return;
      }
      console.warn('[locate]', e);
      setLocate((s) => ({ ...s, phase: 'error', error: visionErrorMessage(e), file }));
    }
  }, [api, acceptResult]);

  const chooseCandidate = useCallback((candidate) => {
    if (!uncertain) return;
    acceptResult(foundFromCandidate(candidate, uncertain.ai), uncertain.file, uncertain.fileName);
    setLocate((s) => ({ ...s, open: false }));
  }, [uncertain, acceptResult]);

  const evaluateFile = useCallback(async (file) => {
    if (!file) return;
    setTab('evaluate');
    // Show at once that the screenshot arrived, even if it cannot be read in this view.
    setEvalShot((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { url: URL.createObjectURL(file), name: file.name || 'скриншот из буфера' };
    });
    if (!runtime) {
      // The Claude runtime is still connecting: keep the screenshot and read it as soon as it is ready.
      pendingEvalRef.current = file;
      setEvalState({ phase: 'waiting' });
      return;
    }
    if (recognitionIssue) {
      setEvalState({ phase: 'error', error: recognitionIssue });
      return;
    }
    if (evalAbortRef.current) evalAbortRef.current.abort();
    const ctl = new AbortController();
    evalAbortRef.current = ctl;
    setEvalState({ phase: 'reading' });
    try {
      const data = await ensureMarket();
      const result = await recognizeInventory({ file, market: data, marketAI, signal: ctl.signal, onPhase: (phase) => setEvalState({ phase }) });
      if (ctl.signal.aborted) return;
      setEvalRows((rows) => mergeRows(rows, result.rows));
      setEvalState({ phase: 'done', notes: result.notes, read: result.rows.length, unmatched: result.rows.filter((r) => !r.itemId).length });
    } catch (e) {
      if (e && e.code === 'cancelled') {
        setEvalState(IDLE_EVAL);
        return;
      }
      console.warn('[evaluate]', e);
      setEvalState({ phase: 'error', error: visionErrorMessage(e) });
    }
  }, [runtime, recognitionIssue, marketAI, ensureMarket]);

  useEffect(() => {
    if (!runtime || !pendingEvalRef.current) return;
    const file = pendingEvalRef.current;
    pendingEvalRef.current = null;
    evaluateFile(file);
  }, [runtime, evaluateFile]);

  // A pasted or dropped image goes to the inventory evaluation while that tab is open (never to LOCATE ME),
  // otherwise to LOCATE ME. The Evaluate tab also has its own paste zone that handles the event first.
  imageTargetRef.current = (file) => {
    if (tab === 'evaluate' || document.querySelector('[data-panel="evaluate"]')) return evaluateFile(file);
    return api ? runLocate(file) : undefined;
  };

  // Screenshot from clipboard (Ctrl+V) or dropped anywhere on the page
  useEffect(() => {
    const onPaste = (ev) => {
      const item = Array.from((ev.clipboardData && ev.clipboardData.items) || []).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      const file = item && item.getAsFile();
      if (!file) return;
      ev.preventDefault();
      imageTargetRef.current(file);
    };
    const hasFiles = (ev) => Array.from((ev.dataTransfer && ev.dataTransfer.types) || []).includes('Files');
    const onDragOver = (ev) => { if (hasFiles(ev)) { ev.preventDefault(); setDragging(true); } };
    const onDragLeave = (ev) => { if (!ev.relatedTarget) setDragging(false); };
    const onDrop = (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      setDragging(false);
      const file = Array.from(ev.dataTransfer.files).find((f) => f.type.startsWith('image/') || IMAGE_NAME.test(f.name));
      if (file) imageTargetRef.current(file);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') { setFiltersOpen(false); setLocate((s) => ({ ...s, open: false })); } };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('keydown', onKey);
    };
  }, [api, runLocate]);

  const stepOrder = floorStepOrder(map);
  const stepFloor = (delta) => setFloor((f) => stepOrder[Math.min(stepOrder.length - 1, Math.max(0, stepOrder.indexOf(f) + delta))]);
  const presentTypes = useMemo(() => new Set(map ? map.entities.map((e) => e.type) : []), [map]);
  // Position history of this map only (records saved before maps existed belong to Streets).
  const mapHistory = useMemo(() => {
    const id = map ? map.map.id : 'streets-of-tarkov';
    return history.filter((r) => (r.mapId || 'streets-of-tarkov') === id);
  }, [history, map]);

  const toggleFilter = (row) => setFilters((f) => toggleFilterRow(f, row));

  useEffect(() => {
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* storage unavailable */ }
  }, [filters]);

  const visibleLoot = map && filters.loot
    ? LOOT_CATEGORIES.filter((c) => filters[`loot_${c.id}`]).reduce((n, c) => n + (map.lootCounts[c.id] || 0), 0)
    : 0;
  const bossCount = map ? map.entities.filter((e) => e.type === 'boss').length : 0;
  const quickCount = { 'q-quests': questPointEntities.length, 'q-boss': bossCount, 'q-loot': visibleLoot };

  const openHistoryRecord = (record) => {
    if (!map) return;
    showPlayer(resultFromRecord(record, map));
  };

  const updateEvalRow = (key, patch) => setEvalRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const evaluatePanel = {
    market, marketError, mode: marketMode, onMode: setMarketMode, rows: evalRows, marketAI, evalState, recognitionIssue, connecting: !runtime, shot: evalShot,
    onCount: (key, value) => updateEvalRow(key, { count: Math.max(1, Math.round(Number(value)) || 1) }),
    onItem: (key, itemId) => updateEvalRow(key, { itemId, picked: itemId ? 'user' : null }),
    onRemove: (key) => setEvalRows((rows) => rows.filter((r) => r.key !== key)),
    onAdd: (itemId) => setEvalRows((rows) => mergeRows(rows, [{ key: newRowKey(), itemId, count: 1, source: 'manual' }])),
    onClear: () => { setEvalRows([]); setEvalState(IDLE_EVAL); },
    onFile: evaluateFile,
    onCancel: () => { if (evalAbortRef.current) evalAbortRef.current.abort(); },
  };

  const selected = map && selectedId ? map.byId.get(selectedId) : null;

  return html`
    <div class="app">
      <${TopBar} map=${map} floor=${floor} runtime=${runtime} player=${player} mapSwitcher=${mapSwitcher} />
      <div class="stage">
        <${SidePanel}
          map=${map} tab=${tab} onTab=${setTab} query=${query} onQuery=${setQuery} searchRef=${searchRef}
          selectedId=${selectedId} onFocus=${focusEntity} history=${mapHistory} storage=${runtime && runtime.storage}
          onHistory=${openHistoryRecord} activeRecordId=${player && player.recordId} activeQuestCount=${activeQuestIds.length}
          questPanel=${{
            questsData, questsError, progress, query: questQuery, onQuery: setQuestQuery, inputRef: questInputRef, match: questMatch,
            selectedQuestId, onSelectQuest: selectQuest, questAI, aiState: questAi, onAskClaude: askClaude,
            importState, onImportFile: importQuestScreenshot, onAddImported: addImported, onClearImport: () => setImportState(IDLE_IMPORT),
            traderFilter, onTraderFilter: setTraderFilter, mapName: mapShort,
          }}
          evaluatePanel=${evaluatePanel}
        />
        <main class=${`viewport${tab === 'evaluate' ? ' is-covered' : ''}`}>
          <div class="viewport__canvas" ref=${viewportRef}></div>
          ${!map && !loadError && html`<div class="viewport__msg">Загрузка данных карты…</div>`}
          ${(loadError || sceneError) && html`<div class="viewport__msg viewport__msg--error">${loadError || sceneError}</div>`}
          ${map && (map.levels
            ? html`<${LevelPanel} map=${map} floor=${floor} onChange=${setFloor} entities=${map.entities} wallMode=${wallMode} onWallMode=${setWallMode} />`
            : html`<${FloorRail} floors=${map.floors} floor=${floor} onChange=${setFloor} entities=${map.entities} />`)}
          <div class="viewport__tools">
            <button type="button" class="chip-btn" onClick=${() => sceneRef.current && sceneRef.current.resetView()}>Вся карта</button>
            ${player && html`<button type="button" class="chip-btn chip-btn--player" onClick=${() => sceneRef.current && sceneRef.current.flyToPlayer()}>К моей позиции</button>`}
          </div>
          ${map && html`
            <div class="quickfilters" role="group" aria-label="Быстрые фильтры">
              ${QUICK_FILTERS.map((row) => {
                const on = filterOn(filters, row);
                return html`
                  <button key=${row.id} type="button" class=${`qf${on ? ' is-on' : ''}`} style=${{ '--mk': row.color }} aria-pressed=${on} onClick=${() => toggleFilter(row)}>
                    <${Glyph} svg=${GLYPHS[row.glyph]} className="qf__glyph" />
                    <span>${row.label}</span>
                    ${on && quickCount[row.id] > 0 && html`<span class="qf__count mono">${quickCount[row.id]}</span>`}
                  </button>`;
              })}
            </div>`}
          <div class="viewport__hint">ЛКМ — вращать · ПКМ — двигать · колесо — масштаб</div>
          <div class="viewport__credit">Карта: Shebuka · tarkov.dev · CC BY-NC-SA 4.0 · сборка ${BUILD}</div>
          <div class=${`evalstage${tab === 'evaluate' ? ' is-open' : ''}`} aria-hidden=${tab !== 'evaluate'}>
            ${tab === 'evaluate' && html`<${EvaluateStage} ...${evaluatePanel} />`}
          </div>
          ${dragging && html`<div class="drop-overlay"><div>${tab === 'evaluate' ? 'Отпустите скриншот — оценю предметы' : 'Отпустите скриншот — определю позицию'}</div></div>`}
        </main>
        <${InfoPanel}
          map=${map} selected=${selected} player=${player} uncertain=${uncertain}
          guide=${guide} progressEntry=${selectedQuest ? progress.get(selectedQuest.id) : null} selectedObjectiveId=${selectedObjectiveId}
          questsGeneratedAt=${questsData ? questsData.generatedAt : null} nearbyObjectives=${nearbyObjectives} hasActiveQuests=${activeQuestIds.length > 0}
          onFocus=${focusEntity} onClearSelection=${() => setSelectedId(null)} routeInfo=${routeInfo}
          onFlyToPlayer=${() => sceneRef.current && sceneRef.current.flyToPlayer()}
          onChooseCandidate=${chooseCandidate} onLocate=${() => setLocate((s) => ({ ...s, open: true }))}
          onSetQuestStatus=${setQuestStatus} onToggleObjective=${toggleObjective} onFocusQuestPoints=${focusQuestPoints}
          onCloseQuest=${() => { setSelectedQuestId(null); setSelectedObjectiveId(null); if (selectedId && selectedId.startsWith('q:')) setSelectedId(null); }}
        />
      </div>
      <${BottomBar}
        floor=${floor} floors=${map ? map.floors : []} floorInfo=${map ? floorLabel(map, floor) : null} order=${stepOrder} onStep=${stepFloor} evaluateActive=${tab === 'evaluate'}
        onEvaluateFile=${evaluateFile} evaluateBusy=${evalState.phase === 'reading' || evalState.phase === 'matching' || evalState.phase === 'waiting'}
        onLocate=${() => setLocate((s) => ({ ...s, open: true }))} locateBusy=${locate.phase === 'reading' || locate.phase === 'analyzing'}
        onSearch=${() => { setTab('quests'); setTimeout(() => questInputRef.current && questInputRef.current.focus(), 0); }}
        onFilters=${() => setFiltersOpen((o) => !o)} filtersOpen=${filtersOpen} ready=${Boolean(api)}
      />
      ${filtersOpen && html`<${FiltersMenu} filters=${filters} lootCounts=${map ? map.lootCounts : null} presentTypes=${presentTypes} mapKind=${map ? map.kind : 'city'} onToggle=${toggleFilter} onClose=${() => setFiltersOpen(false)} />`}
      ${locate.open && html`
        <${LocateDialog}
          state=${locate} vision=${runtime && runtime.vision} ready=${Boolean(api)} mapName=${mapName}
          onFile=${runLocate} onClose=${() => setLocate((s) => ({ ...s, open: false }))}
          onCancel=${() => abortRef.current && abortRef.current.abort()}
          onRetry=${() => locate.file && runLocate(locate.file)}
          onChooseCandidate=${chooseCandidate}
          onShowPlayer=${() => { setLocate((s) => ({ ...s, open: false })); if (sceneRef.current) sceneRef.current.flyToPlayer(); }}
        />`}
    </div>
  `;
}
