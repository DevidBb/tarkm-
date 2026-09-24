import { html } from './html.js';
import { MAPS } from '../services/mapRegistry.js';

export { MAPS };

export function MapSwitcher({ value, onChange }) {
  return html`
    <label class="mapswitch">
      <span class="eyebrow">Карта</span>
      <select class="mapswitch__select" value=${value} onChange=${(e) => onChange(e.target.value)} aria-label="Выбор карты">
        ${MAPS.map((m) => html`<option key=${m.id} value=${m.id}>${m.name}</option>`)}
      </select>
    </label>
  `;
}
