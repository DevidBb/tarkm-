import { html } from './html.js';

// Turn-by-turn steps of the walking route (from map/navigation.js): streets, entrances, stairs, the target.
const ICONS = { walk: '→', enter: '⌂', exit: '⌂', up: '↑', down: '↓', arrive: '●', gap: '!', hazard: '⚠' };

export function RouteSteps({ steps }) {
  if (!steps || !steps.length) return null;
  return html`
    <ol class="route-steps">
      ${steps.map((s, i) => html`
        <li key=${i} class=${`route-step route-step--${s.kind}`}>
          <span class="route-step__icon">${ICONS[s.kind] || '→'}</span>
          <span class="route-step__text">${s.text}${s.note ? html`<span class="route-step__note">${s.note}</span>` : null}</span>
        </li>`)}
    </ol>
  `;
}
