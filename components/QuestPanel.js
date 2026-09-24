import { html, useRef, useMemo } from './html.js';
import { questName, traderName, traderColor, questProgress } from '../services/questData.js';

const pct = (v) => `${Math.round(v * 100)}%`;

function QuestRow({ quest, entry, selected, onSelect }) {
  const { done, total } = questProgress(quest, entry);
  const status = entry && entry.status;
  return html`
    <button
      type="button"
      class=${`qrow${selected ? ' is-selected' : ''}${status ? ` is-${status}` : ''}`}
      style=${{ '--trader': traderColor(quest.trader) }}
      onClick=${() => onSelect(quest.id)}
    >
      <span class="qrow__dot" aria-hidden="true"></span>
      <span class="qrow__text">
        <span class="qrow__name">${questName(quest)}</span>
        <span class="qrow__sub">${traderName(quest.trader)}${quest.name && quest.nameRu ? ` · ${quest.name}` : ''}</span>
      </span>
      <span class="qrow__meta mono">${status === 'completed' ? 'готов' : status === 'active' && total ? `${done}/${total}` : ''}</span>
    </button>
  `;
}

function Section({ title, quests, progress, selectedQuestId, onSelectQuest, open, empty }) {
  return html`
    <details class="group" open=${open}>
      <summary class="group__head"><span>${title}</span><span class="group__count mono">${quests.length}</span></summary>
      <div class="list">
        ${quests.length === 0 && empty && html`<div class="list__caption">${empty}</div>`}
        ${quests.map((q) => html`<${QuestRow} key=${q.id} quest=${q} entry=${progress.get(q.id)} selected=${q.id === selectedQuestId} onSelect=${onSelectQuest} />`)}
      </div>
    </details>
  `;
}

function MatchRows({ results, selectedQuestId, onSelectQuest, showWhy }) {
  return results.map((r) => html`
    <button
      key=${r.quest.id}
      type="button"
      class=${`match__row${r.quest.id === selectedQuestId ? ' is-selected' : ''}`}
      style=${{ '--trader': traderColor(r.quest.trader) }}
      onClick=${() => onSelectQuest(r.quest.id)}
    >
      <span class="match__name">${questName(r.quest)}<span class="muted"> · ${traderName(r.quest.trader)}</span></span>
      <span class="mono match__pct">${pct(r.score)}</span>
      ${showWhy && r.why && html`<span class="match__why">${r.why}</span>`}
    </button>
  `);
}

function MatchBlock({ query, match, selectedQuestId, onSelectQuest, questAI, aiState, onAskClaude, mapName }) {
  if (!query.trim()) {
    return html`<p class="hint">Например: <b>Аудит</b>, <b>Слава КПСС</b>, <b>Debtor</b> или вставьте текст задания целиком.</p>`;
  }
  const { level, results } = match;
  const title = level === 'sure' ? 'Квест найден' : level === 'maybe' ? 'Возможно, вы имели в виду' : 'Не удалось точно определить квест';
  return html`
    <div class=${`match match--${level}`}>
      <div class="match__title">${title}</div>
      ${level === 'none' && html`<p class="muted">Среди квестов ${mapName} нет такого названия или текста задания.</p>`}
      <${MatchRows} results=${results.slice(0, level === 'sure' ? 1 : 5)} selectedQuestId=${selectedQuestId} onSelectQuest=${onSelectQuest} />
      ${level !== 'sure' && questAI && questAI.available && html`
        <button type="button" class="btn btn--ghost" onClick=${onAskClaude} disabled=${aiState.phase === 'thinking'}>
          ${aiState.phase === 'thinking' ? 'Claude сверяет текст…' : 'Спросить Claude'}
        </button>`}
      ${level !== 'sure' && questAI && !questAI.available && html`<p class="muted">Разбор свободного текста через Claude работает в версии приложения внутри Claude.</p>`}
      ${aiState.phase === 'done' && aiState.results.length === 0 && html`<p class="muted">Claude тоже не нашёл подходящий квест среди квестов ${mapName}.</p>`}
      ${aiState.phase === 'done' && aiState.results.length > 0 && html`
        <div class="match__sub">Варианты Claude</div>
        <${MatchRows} results=${aiState.results} selectedQuestId=${selectedQuestId} onSelectQuest=${onSelectQuest} showWhy=${true} />`}
      ${aiState.phase === 'error' && html`<p class="warn-text">${aiState.error}</p>`}
    </div>
  `;
}

function ImportBlock({ importState, onAddImported, onClearImport, onSelectQuest, mapName }) {
  if (importState.phase === 'idle') return null;
  if (importState.phase === 'reading') {
    return html`<div class="match match--busy"><span class="spinner"></span><span>Claude читает список квестов со скриншота…</span></div>`;
  }
  if (importState.phase === 'error') {
    return html`
      <div class="match match--none">
        <p class="warn-text">${importState.error}</p>
        <button type="button" class="btn btn--ghost" onClick=${onClearImport}>Закрыть</button>
      </div>
    `;
  }
  const matched = importState.items.filter((i) => i.quest);
  return html`
    <div class="match">
      <div class="match__title">Со скриншота: ${importState.items.length} · найдено в квестах ${mapName}: ${matched.length}</div>
      ${importState.items.map((i, k) => html`
        <div key=${k} class="import-row">
          <span class="import-row__name">${i.name}</span>
          ${i.quest
            ? html`<button type="button" class="link-btn" onClick=${() => onSelectQuest(i.quest.id)}>${questName(i.quest)}</button>`
            : html`<span class="muted">нет среди квестов ${mapName}</span>`}
        </div>`)}
      <div class="card__actions">
        ${matched.length > 0 && html`<button type="button" class="btn" onClick=${onAddImported} disabled=${importState.added}>${importState.added ? 'Добавлено' : `Сделать активными (${matched.length})`}</button>`}
        <button type="button" class="btn btn--ghost" onClick=${onClearImport}>Закрыть</button>
      </div>
    </div>
  `;
}

export function QuestPanel(props) {
  const {
    questsData, questsError, progress, query, onQuery, inputRef, match, selectedQuestId, onSelectQuest,
    questAI, aiState, onAskClaude, importState, onImportFile, onAddImported, onClearImport, traderFilter, onTraderFilter,
    mapName = 'Streets',
  } = props;
  const fileRef = useRef(null);

  const lists = useMemo(() => {
    if (!questsData) return null;
    const visible = questsData.quests.filter((q) => !traderFilter || q.traderId === traderFilter);
    const statusOf = (q) => (progress.get(q.id) || {}).status;
    return {
      visible,
      active: visible.filter((q) => statusOf(q) === 'active'),
      completed: visible.filter((q) => statusOf(q) === 'completed'),
    };
  }, [questsData, progress, traderFilter]);

  if (questsError) {
    return html`<div class="side__body"><div class="note"><div class="note__title">Квесты не загрузились</div><p>${questsError}</p></div></div>`;
  }
  if (!questsData || !lists) return html`<div class="side__body"><div class="side__empty">Загрузка квестов…</div></div>`;

  return html`
    <div class="side__body">
      <label class="qsearch">
        <span class="eyebrow">Search quest</span>
        <textarea
          ref=${inputRef}
          rows="3"
          value=${query}
          onChange=${(e) => onQuery(e.target.value)}
          placeholder="Название квеста или полный текст задания (RU / EN)"
        ></textarea>
      </label>

      <${MatchBlock} query=${query} match=${match} selectedQuestId=${selectedQuestId} onSelectQuest=${onSelectQuest} questAI=${questAI} aiState=${aiState} onAskClaude=${onAskClaude} mapName=${mapName} />

      ${questAI && questAI.canReadImages && html`
        <button type="button" class="btn btn--ghost btn--block" onClick=${() => fileRef.current && fileRef.current.click()} disabled=${importState.phase === 'reading'}>
          Активные квесты со скриншота игры
        </button>
        <input ref=${fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange=${(e) => { const f = e.target.files && e.target.files[0]; if (f) onImportFile(f); e.target.value = ''; }} />`}
      <${ImportBlock} importState=${importState} onAddImported=${onAddImported} onClearImport=${onClearImport} onSelectQuest=${onSelectQuest} mapName=${mapName} />

      <div class="chips chips--traders" role="group" aria-label="Фильтр по торговцу">
        <button type="button" class=${`chip-toggle${!traderFilter ? ' is-on' : ''}`} onClick=${() => onTraderFilter(null)}>Все</button>
        ${questsData.traders.map((t) => html`
          <button key=${t.id} type="button" class=${`chip-toggle${traderFilter === t.id ? ' is-on' : ''}`} style=${{ '--trader': traderColor(t) }} onClick=${() => onTraderFilter(traderFilter === t.id ? null : t.id)}>
            ${traderName(t)} <span class="mono">${t.count}</span>
          </button>`)}
      </div>

      <${Section} title="Active" quests=${lists.active} progress=${progress} selectedQuestId=${selectedQuestId} onSelectQuest=${onSelectQuest} open=${true} empty="Откройте квест и отметьте «Активный»." />
      <${Section} title="Completed" quests=${lists.completed} progress=${progress} selectedQuestId=${selectedQuestId} onSelectQuest=${onSelectQuest} open=${false} empty="Пока нет выполненных." />
      <${Section} title=${`Все квесты ${mapName}`} quests=${lists.visible} progress=${progress} selectedQuestId=${selectedQuestId} onSelectQuest=${onSelectQuest} open=${lists.active.length === 0} />
    </div>
  `;
}
