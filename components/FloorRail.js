import { html, useMemo } from './html.js';

// Elevator-style floor switcher on the map edge. Counts = markers whose height falls on that floor.
export function FloorRail({ floors, floor, onChange, entities }) {
  const counts = useMemo(() => {
    const c = {};
    for (const e of entities) if (e.floor) c[e.floor] = (c[e.floor] || 0) + 1;
    return c;
  }, [entities]);

  return html`
    <nav class="rail" aria-label="Этажи">
      ${[...floors].reverse().map((f) => {
        const shared = Boolean(f.sharesHeightWith);
        const title = shared
          ? `${f.nameRu}: план помещений. По высоте не отличается от уровня улицы, поэтому маркеры общие.`
          : `${f.nameRu}${counts[f.id] ? ` · маркеров: ${counts[f.id]}` : ''}`;
        return html`
          <button key=${f.id} type="button" class=${`rail__btn${f.id === floor ? ' is-active' : ''}`} onClick=${() => onChange(f.id)} title=${title} aria-pressed=${f.id === floor}>
            <span class="rail__id mono">${f.id === 'UNDERGROUND' ? 'UG' : f.id === 'GROUND' ? 'G' : f.id}</span>
            <span class="rail__count mono">${shared ? '·' : counts[f.id] || ''}</span>
          </button>`;
      })}
    </nav>
  `;
}
