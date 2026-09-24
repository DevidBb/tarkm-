import { html } from './html.js';
import { floorLabel } from '../services/levels.js';

function Status({ state, label, title }) {
  return html`<span class=${`status status--${state}`} title=${title || ''}><span class="status__dot"></span>${label}</span>`;
}

export function TopBar({ map, floor, runtime, player, mapSwitcher = null }) {
  const floorInfo = map ? floorLabel(map, floor) : null;
  const vision = runtime ? runtime.vision : null;
  const storage = runtime ? runtime.storage : null;

  let visionState = 'wait';
  let visionLabel = 'Claude Vision: подключение…';
  if (vision) {
    visionState = vision.available ? 'ok' : 'off';
    visionLabel = vision.available ? 'Claude Vision: доступен' : 'Claude Vision: недоступен здесь';
  }

  return html`
    <header class="topbar">
      <div class="brand">
        <span class="brand__name">Tarkov Map</span>
        <span class="brand__ai">AI</span>
      </div>
      <div class="topbar__cell">
        ${mapSwitcher || html`<span class="eyebrow">Карта</span><span class="topbar__value">${map ? map.map.name : '…'}</span>`}
        ${!mapSwitcher && map && map.map.nameRu && html`<span class="topbar__sub">${map.map.nameRu}</span>`}
      </div>
      <div class="topbar__cell">
        <span class="eyebrow">Этаж</span>
        <span class="topbar__value mono">${floor}</span>
        ${floorInfo && html`<span class="topbar__sub">${floorInfo.nameRu}</span>`}
      </div>
      ${player && html`
        <div class="topbar__cell topbar__cell--you">
          <span class="eyebrow">${player.approximate ? '≈ You are here' : 'You are here'}</span>
          <span class="topbar__value">${player.place ? player.place.nameRu || player.place.name : 'Позиция найдена'}</span>
          <span class="topbar__sub mono">${player.floor || '—'} · ${Math.round(player.confidence * 100)}%</span>
        </div>`}
      <div class="topbar__status">
        <${Status} state=${visionState} label=${visionLabel} title=${vision && vision.message} />
        <${Status}
          state=${storage ? (storage.mode === 'db' ? 'ok' : 'warn') : 'wait'}
          label=${storage ? `История: ${storage.label.toLowerCase()}` : 'История: подключение…'}
        />
      </div>
    </header>
  `;
}
