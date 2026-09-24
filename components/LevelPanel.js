import { html, useMemo } from './html.js';
import { ALL_FLOORS, wholeView } from '../services/levels.js';

const SHORT = { STREET: 'Street', OUTSIDE: 'Outside', PARKING: 'Parking', BASEMENT: 'Basement', TUNNELS: 'Tunnels', UNDERGROUND: 'Underground', LEVEL1: 'Level 1', LEVEL2: 'Level 2', LEVEL3: 'Level 3' };

// Level switcher for multi-level maps (Interchange), in the style of the floor rail:
// OUTSIDE → Street; MALL → Level 2 / Level 1 / Parking (top to bottom) + All floors; wall height.
export function LevelPanel({ map, floor, onChange, entities, wallMode, onWallMode }) {
  const counts = useMemo(() => {
    const c = {};
    for (const e of entities) if (e.floor) c[e.floor] = (c[e.floor] || 0) + 1;
    return c;
  }, [entities]);
  const byId = new Map(map.floors.map((f) => [f.id, f]));
  const whole = wholeView(map);

  const button = (id, label, title, count) => html`
    <button key=${id} type="button" class=${`levels__btn${floor === id ? ' is-active' : ''}`} onClick=${() => onChange(id)} title=${title} aria-pressed=${floor === id}>
      <span class="levels__name">${label}</span>
      ${count ? html`<span class="levels__count mono">${count}</span>` : null}
    </button>`;

  return html`
    <nav class="rail levels" aria-label="Уровни карты">
      <div class="levels__title">${map.map.name}</div>
      ${map.levels.groups.map((g) => html`
        <div key=${g.id} class="levels__group">
          <div class="levels__head">${g.id === 'outside' ? 'Outside' : g.name} <span>${g.nameRu}</span></div>
          ${g.floors.length > 1 && whole && button(whole.id, whole.name, `${whole.nameRu}: все уровни на своих высотах`, 0)}
          ${[...g.floors].reverse().map((id) => {
            const f = byId.get(id);
            return button(id, SHORT[id] || (f ? f.name : id), f ? f.nameRu : id, counts[id]);
          })}
          ${g.floors.length > 1 && button(ALL_FLOORS, 'All floors', 'Все уровни здания сразу, разнесённые по высоте', 0)}
        </div>`)}
      <div class="levels__group">
        <div class="levels__head">Стены</div>
        <div class="seg seg--sm levels__walls" role="group" aria-label="Высота стен">
          <button type="button" class=${`seg__btn${wallMode !== 'low' ? ' is-on' : ''}`} aria-pressed=${wallMode !== 'low'} onClick=${() => onWallMode('full')} title="Стены в полную высоту">Full</button>
          <button type="button" class=${`seg__btn${wallMode === 'low' ? ' is-on' : ''}`} aria-pressed=${wallMode === 'low'} onClick=${() => onWallMode('low')} title="Низкие стены: планировку видно под любым углом">Low</button>
        </div>
      </div>
    </nav>
  `;
}
