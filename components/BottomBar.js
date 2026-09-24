import { html, Glyph, useRef } from './html.js';
import { GLYPHS, MARKER_TYPES } from '../services/markerTypes.js';
import { FLOOR_ORDER } from '../services/coords.js';
import { ALL_FLOORS } from '../services/levels.js';

const LEGEND = ['objective', 'item', 'key', 'extract', 'trader', 'boss', 'place', 'danger', 'loot', 'player'];

export function BottomBar({ floor, floors, floorInfo = null, order = FLOOR_ORDER, onStep, onLocate, locateBusy, onSearch, onFilters, filtersOpen, ready, evaluateActive, onEvaluateFile, evaluateBusy }) {
  const idx = order.indexOf(floor);
  const info = floorInfo || floors.find((f) => f.id === floor) || (floor === ALL_FLOORS ? { nameRu: 'Все этажи' } : null);
  const evalFileRef = useRef(null);
  // In the "Оценить" tab the main button evaluates an inventory screenshot instead of locating the player.
  const mainButton = evaluateActive
    ? html`
      <button type="button" class=${`locate-btn${evaluateBusy ? ' is-busy' : ''}`} onClick=${() => evalFileRef.current && evalFileRef.current.click()} disabled=${evaluateBusy}>
        <${Glyph} svg=${GLYPHS.camera} className="locate-btn__icon" />
        <span class="locate-btn__text">
          <span class="locate-btn__title">Оценить инв</span>
          <span class="locate-btn__sub">${evaluateBusy ? 'Claude читает предметы…' : 'Файл · Ctrl+V · перетащить'}</span>
        </span>
      </button>
      <input ref=${evalFileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange=${(e) => { const f = e.target.files && e.target.files[0]; if (f && onEvaluateFile) onEvaluateFile(f); e.target.value = ''; }} />`
    : html`
      <button type="button" class=${`locate-btn${locateBusy ? ' is-busy' : ''}`} onClick=${onLocate} disabled=${!ready}>
        <${Glyph} svg=${GLYPHS.camera} className="locate-btn__icon" />
        <span class="locate-btn__text">
          <span class="locate-btn__title">Locate me</span>
          <span class="locate-btn__sub">${locateBusy ? 'Analyzing screenshot…' : 'Файл · Ctrl+V · перетащить'}</span>
        </span>
      </button>`;
  return html`
    <footer class="bottombar">
      ${mainButton}

      <div class="floor-step" role="group" aria-label="Этаж">
        <button type="button" class="icon-btn" onClick=${() => onStep(1)} disabled=${idx >= order.length - 1} aria-label="Этаж выше">↑</button>
        <div class="floor-step__value">
          <span class="eyebrow">Floor</span>
          <span class="mono">${floor}</span>
          ${info && html`<span class="floor-step__name">${info.nameRu}</span>`}
        </div>
        <button type="button" class="icon-btn" onClick=${() => onStep(-1)} disabled=${idx <= 0} aria-label="Этаж ниже">↓</button>
      </div>

      <button type="button" class="bar-btn" onClick=${onSearch}>Поиск</button>
      <button type="button" class=${`bar-btn${filtersOpen ? ' is-active' : ''}`} onClick=${onFilters} aria-expanded=${filtersOpen}>Фильтры</button>

      <div class="legend" aria-label="Легенда">
        ${LEGEND.map((t) => {
          const type = MARKER_TYPES[t];
          return html`
            <span key=${t} class=${`legend__item${type.stage ? ' is-later' : ''}`} style=${{ '--mk': type.color }} title=${type.stage ? `Этап ${type.stage}` : ''}>
              <${Glyph} svg=${GLYPHS[type.glyph]} className="legend__glyph" />${type.single}
            </span>`;
        })}
      </div>
    </footer>
  `;
}
