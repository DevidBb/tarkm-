import { html, useState, useEffect, useRef } from './html.js';
import { MAPS } from '../services/mapRegistry.js';

export { MAPS };

// The map picker: a button in the top bar that opens a grid of all maps (Russian name first, the English one under
// it, what the map is, and a mark on the maps whose data is still partial).
export function MapSwitcher({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = MAPS.find((m) => m.id === value) || MAPS[0];
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return html`
    <div class="mapswitch" ref=${ref}>
      <button type="button" class=${`mapswitch__btn${open ? ' is-open' : ''}`} onClick=${() => setOpen((o) => !o)} aria-expanded=${open} aria-haspopup="true">
        <span class="eyebrow">Карта · ${MAPS.length}</span>
        <span class="mapswitch__name">${current.nameRu}<span class="mapswitch__caret" aria-hidden="true">▾</span></span>
        <span class="topbar__sub">${current.name}</span>
      </button>
      ${open && html`
        <div class="mappick" role="menu" aria-label="Выбор карты">
          ${MAPS.map((m) => html`
            <button key=${m.id} type="button" role="menuitem" class=${`mappick__card${m.id === current.id ? ' is-current' : ''}`}
              onClick=${() => { setOpen(false); if (m.id !== current.id) onChange(m.id); }}>
              <span class="mappick__top">
                <span class="mappick__ru">${m.nameRu}</span>
                ${m.early && html`<span class="mappick__tag">новая</span>`}
              </span>
              <span class="mappick__en">${m.name}</span>
              <span class="mappick__blurb">${m.blurb}</span>
            </button>`)}
        </div>`}
    </div>
  `;
}
