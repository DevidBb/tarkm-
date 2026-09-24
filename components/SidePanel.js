import { html, Glyph, useMemo } from './html.js';
import { GLYPHS, MARKER_TYPES, displayName } from '../services/markerTypes.js';
import { QuestPanel } from './QuestPanel.js';
import { EvaluatePanel } from './EvaluatePanel.js';

const TABS = [
  ['quests', 'Квесты'],
  ['places', 'Места'],
  ['evaluate', 'Оценить'],
];

const GROUPS = [
  { type: 'place', open: true },
  { type: 'extract', open: true },
  { type: 'transit', open: false },
  { type: 'trader', open: false },
  { type: 'boss', open: false },
  { type: 'key', open: false },
  { type: 'danger', open: false },
  { type: 'street', open: false },
];

export function EntityRow({ entity, selected, onFocus, meters }) {
  const type = MARKER_TYPES[entity.type];
  const sub = [entity.nameRu && entity.nameRu !== entity.name ? entity.name : null, entity.floor].filter(Boolean).join(' · ');
  return html`
    <button type="button" class=${`row${selected ? ' is-selected' : ''}`} style=${{ '--mk': type.color }} onClick=${() => onFocus(entity.id)}>
      <${Glyph} svg=${GLYPHS[type.glyph]} className="row__glyph" />
      <span class="row__text">
        <span class="row__name">${displayName(entity)}</span>
        ${sub && html`<span class="row__sub">${sub}</span>`}
      </span>
      ${meters != null && html`<span class="row__meters mono">${meters < 10 ? meters.toFixed(1) : Math.round(meters)} м</span>`}
    </button>
  `;
}

function PlacesTab({ map, query, onQuery, searchRef, selectedId, onFocus }) {
  const results = useMemo(() => (map && query.trim() ? map.search(query) : null), [map, query]);
  const grouped = useMemo(() => {
    if (!map) return [];
    return GROUPS.map((g) => ({ ...g, items: map.entities.filter((e) => e.type === g.type).sort((a, b) => displayName(a).localeCompare(displayName(b), 'ru')) }));
  }, [map]);

  return html`
    <div class="side__body">
      <label class="search">
        <span class="visually-hidden">Поиск по карте</span>
        <input ref=${searchRef} type="search" value=${query} onChange=${(e) => onQuery(e.target.value)} placeholder="Поиск: место, выход, ключ, босс…" />
      </label>
      ${!map && html`<div class="side__empty">Загрузка данных…</div>`}
      ${results && html`
        <div class="list">
          <div class="list__caption">${results.length ? `Найдено: ${results.length}` : 'Ничего не найдено. Квесты ищите во вкладке «Квесты».'}</div>
          ${results.map((e) => html`<${EntityRow} key=${e.id} entity=${e} selected=${e.id === selectedId} onFocus=${onFocus} />`)}
        </div>`}
      ${!results && grouped.map((g) => html`
        <details key=${g.type} class="group" open=${g.open}>
          <summary class="group__head" style=${{ '--mk': MARKER_TYPES[g.type].color }}>
            <${Glyph} svg=${GLYPHS[MARKER_TYPES[g.type].glyph]} className="group__glyph" />
            <span>${MARKER_TYPES[g.type].label}</span>
            <span class="group__count mono">${g.items.length}</span>
          </summary>
          <div class="list">
            ${g.items.map((e) => html`<${EntityRow} key=${e.id} entity=${e} selected=${e.id === selectedId} onFocus=${onFocus} />`)}
          </div>
        </details>`)}
    </div>
  `;
}

export function SidePanel(props) {
  const { tab, onTab, activeQuestCount, questPanel, evaluatePanel } = props;
  const counts = { quests: activeQuestCount, evaluate: evaluatePanel ? evaluatePanel.rows.length : 0 };
  return html`
    <aside class="side" aria-label="Квесты, места и оценка">
      <div class="tabs" role="tablist">
        ${TABS.map(([id, label]) => html`
          <button key=${id} type="button" role="tab" aria-selected=${tab === id} class=${`tab${tab === id ? ' is-active' : ''}`} onClick=${() => onTab(id)}>
            ${label}${counts[id] > 0 && html`<span class="tab__count mono">${counts[id]}</span>`}
          </button>`)}
      </div>
      ${tab === 'quests' && html`<${QuestPanel} ...${questPanel} />`}
      ${tab === 'places' && html`<${PlacesTab} ...${props} />`}
      ${tab === 'evaluate' && evaluatePanel && html`<${EvaluatePanel} ...${evaluatePanel} />`}
    </aside>
  `;
}
