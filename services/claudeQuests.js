// Claude helpers for quests (Artifact runtime `sample`, the viewer's own Claude account, no API key):
// - identifyQuest: free-form or paraphrased quest text -> quest ids from the quest list of the open map;
// - readQuestList: a screenshot of the in-game task list -> quest names (then matched locally).
// Claude never produces coordinates or quest ids outside the list; unknown ids are dropped.

import { capability } from './runtime.js';
import { prepareImageForClaude } from './claudeVision.js';

function catalogLines(quests) {
  return quests.map((q) => {
    const goals = q.objectives
      .map((o) => o.descriptionRu || o.description)
      .filter(Boolean)
      .join('; ')
      .slice(0, 120);
    const trader = q.trader ? `${q.trader.nameRu || ''}/${q.trader.name || ''}` : '';
    return `${q.id} | ${q.nameRu || ''} | ${q.name || ''} | ${trader} | ${goals}`;
  });
}

function withSignal(options, signal) {
  if (signal) options.signal = signal;
  return options;
}

export async function createQuestAI() {
  const sample = await capability('sample');
  if (!sample) return { available: false, canReadImages: false };
  let limits = null;
  try { limits = await sample.limits(); } catch { limits = null; }

  async function identifyQuest(text, questsData, { signal, mapName = 'Streets of Tarkov' } = {}) {
    const prompt = [
      `Match a quest text from the game Escape from Tarkov to quests from a fixed list (map: ${mapName}).`,
      'The text can be Russian or English, partial, paraphrased, or copied from the in-game task screen, including the trader name.',
      'Choose at most 3 quests. Use ONLY quest_id values copied exactly from the list. If nothing fits, return an empty list - do not guess.',
      'confidence is your calibrated probability (0..1); all confidences together must sum to at most 1.',
      '',
      'Quest list (quest_id | Russian name | English name | trader | objectives):',
      ...catalogLines(questsData.quests),
      '',
      'Text:',
      '"""',
      String(text).slice(0, 4000),
      '"""',
      '',
      'Reply with only JSON: {"candidates": [{"quest_id": "...", "confidence": 0.7, "reason": "коротко по-русски"}]}',
    ].join('\n');
    const raw = await sample.json(prompt, withSignal({ modelTier: 'default' }, signal));
    const out = [];
    for (const c of Array.isArray(raw && raw.candidates) ? raw.candidates : []) {
      const quest = questsData.byId.get(String(c && c.quest_id));
      if (!quest || out.some((x) => x.quest.id === quest.id)) continue;
      let confidence = Number(c.confidence);
      if (!Number.isFinite(confidence)) continue;
      if (confidence > 1) confidence /= 100;
      out.push({ quest, score: Math.min(1, Math.max(0, confidence)), reason: 'claude', why: String(c.reason || '').slice(0, 200) });
    }
    const sum = out.reduce((s, c) => s + c.score, 0);
    if (sum > 1) out.forEach((c) => { c.score /= sum; });
    return out.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  async function readQuestList(file, { signal } = {}) {
    if (!limits || !limits.images) throw { code: 'images_unavailable', message: 'images unavailable' };
    const image = await prepareImageForClaude(file, limits);
    const prompt = [
      'The image is a screenshot from the game Escape from Tarkov: the task (quest) list or a task window.',
      'List every quest name you can actually read, exactly as written (keep the original language). Do not invent names that are not visible.',
      'For each quest also give the location/map column and status if they are visible.',
      'Reply with only JSON: {"quests": [{"name": "...", "map": "...", "status": "active|completed|failed|unknown"}]}',
    ].join('\n');
    const raw = await sample.json(prompt, withSignal({ images: image, modelTier: 'default' }, signal));
    return (Array.isArray(raw && raw.quests) ? raw.quests : [])
      .map((q) => ({
        name: String((q && q.name) || '').trim(),
        map: String((q && q.map) || '').trim(),
        status: String((q && q.status) || 'unknown'),
      }))
      .filter((q) => q.name)
      .slice(0, 40);
  }

  return { available: true, canReadImages: Boolean(limits && limits.images), identifyQuest, readQuestList };
}
