import { html } from './html.js';
import { FILTER_ROWS, ENV_ROWS, LOOT_MASTER_ROW, LOOT_ROWS, FLOOR_ROW, filterOn } from '../services/markerTypes.js';

function Check({ checked, onChange, label, color, count, dim }) {
  return html`
    <label class=${`check${dim ? ' is-dim' : ''}`} style=${color ? { '--mk': color } : null}>
      <input type="checkbox" checked=${checked} onChange=${onChange} />
      <span class="check__box" aria-hidden="true"></span>
      <span class="check__label">${label}</span>
      ${count != null && html`<span class="check__count">${count}</span>`}
    </label>
  `;
}

// Rows for marker types the current map does not have (e.g. BTR on Interchange, switches on Streets) are hidden.
export function FiltersMenu({ filters, onToggle, onClose, lootCounts, presentTypes = null, mapKind = 'city' }) {
  const counts = lootCounts || {};
  const shown = (r) => (!r.markerTypes || !presentTypes || r.markerTypes.some((t) => presentTypes.has(t))) && (!r.kinds || r.kinds.includes(mapKind));
  const lootTotal = Object.values(counts).reduce((a, b) => a + b, 0);
  const row = (r, extra = {}) => html`<${Check} key=${r.id} checked=${filterOn(filters, r)} label=${r.label} color=${r.color} onChange=${() => onToggle(r)} ...${extra} />`;
  return html`
    <div class="filters" role="dialog" aria-label="Фильтры карты">
      <div class="filters__head">
        <span class="eyebrow">Фильтры</span>
        <button type="button" class="icon-btn" onClick=${onClose} aria-label="Закрыть фильтры">✕</button>
      </div>
      ${FILTER_ROWS.filter(shown).map((r) => row(r))}
      <div class="filters__sep"></div>
      <div class="eyebrow filters__title">Окружение 3D</div>
      ${ENV_ROWS.filter(shown).map((r) => row(r))}
      <div class="filters__sep"></div>
      <div class="eyebrow filters__title">Лут · точки спавна</div>
      ${row(LOOT_MASTER_ROW, { count: lootTotal })}
      ${LOOT_ROWS.map((r) => row(r, { count: counts[r.category] || 0, dim: !filters.loot }))}
      <div class="filters__sep"></div>
      ${row(FLOOR_ROW)}
    </div>
  `;
}
