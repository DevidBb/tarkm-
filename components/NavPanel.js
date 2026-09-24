// Navigator UI: the route card (from / to, distance and time, safe mode, turn-by-turn list, nearest extract) and
// the next-manoeuvre plate over the map, the way a car navigator shows them.

import { html } from './html.js';
import { MANEUVER_ICONS, FACTION_LABELS } from '../services/markerTypes.js';
import { formatMeters } from '../services/coords.js';
import { formatDuration } from '../map/nav/maneuvers.js';

function Icon({ name, className = 'nav-ico' }) {
  return html`<span class=${className} dangerouslySetInnerHTML=${{ __html: MANEUVER_ICONS[name] || MANEUVER_ICONS.straight }}></span>`;
}

const iconOf = (m) => (m.kind === 'start' ? 'start' : m.kind === 'arrive' ? 'arrive' : m.kind === 'gap' ? (m.dir === 'arrive' ? 'arrive' : 'gap') : m.dir || 'straight');

function End({ letter, title, sub, empty, onPick, onClear, picking, pickLabel }) {
  return html`
    <div class=${`nav-end${empty ? ' is-empty' : ''}`}>
      <span class=${`nav-end__pin nav-end__pin--${letter === 'A' ? 'a' : 'b'}`}>${letter}</span>
      <span class="nav-end__text">
        <span class="nav-end__title">${title}</span>
        ${sub && html`<span class="nav-end__sub">${sub}</span>`}
      </span>
      <button type="button" class=${`nav-mini${picking ? ' is-on' : ''}`} onClick=${onPick} title=${pickLabel}>${picking ? 'Нажмите на карту…' : 'На карте'}</button>
      ${onClear && html`<button type="button" class="icon-btn icon-btn--sm" onClick=${onClear} aria-label="Убрать точку">✕</button>`}
    </div>
  `;
}

function ExtractList({ state, onSide, onChoose, onRun }) {
  const sides = [['pmc', 'ЧВК'], ['scav', 'Дикий']];
  return html`
    <div class="nav-exits">
      <div class="nav-exits__head">
        <span class="subhead">Ближайший выход</span>
        <div class="seg seg--sm" role="group" aria-label="За кого играете">
          ${sides.map(([id, label]) => html`<button key=${id} type="button" class=${`seg__btn${state.side === id ? ' is-on' : ''}`} aria-pressed=${state.side === id} onClick=${() => onSide(id)}>${label}</button>`)}
        </div>
      </div>
      ${state.phase === 'busy' && html`<div class="nav-exits__busy"><span class="spinner"></span>Считаю маршруты ко всем выходам…</div>`}
      ${state.phase === 'idle' && html`<button type="button" class="btn btn--ghost btn--block" onClick=${onRun}>Найти ближайшие выходы</button>`}
      ${state.phase === 'done' && !state.list.length && html`<p class="muted">От старта не нашлось пути ни к одному выходу этой стороны.</p>`}
      ${state.phase === 'done' && state.list.length > 0 && html`
        <ol class="nav-exits__list">
          ${state.list.map((r, k) => {
            const e = r.target.entity;
            const faction = e.meta && e.meta.faction;
            return html`
              <li key=${e.id}>
                <button type="button" class=${`nav-exit${k === 0 ? ' is-best' : ''}`} onClick=${() => onChoose(e.id)}>
                  <span class="nav-exit__rank mono">${k + 1}</span>
                  <span class="nav-exit__text">
                    <span class="nav-exit__name">${r.target.name}</span>
                    <span class="nav-exit__sub">${e.type === 'transit' ? 'Переход на другую карту' : FACTION_LABELS[faction] || 'Выход'}${r.route.maneuvers.some((m) => m.hazard) ? ' · через зону снайпера' : ''}</span>
                  </span>
                  <span class="nav-exit__num mono">${formatMeters(r.route.length)}<small>${formatDuration(r.route.eta.sprint)}</small></span>
                </button>
              </li>`;
          })}
        </ol>`}
    </div>
  `;
}

export function NavPanel(props) {
  const {
    route, navState, startInfo, targetInfo, pickMode, safe, activeStep, previewing, exits,
    onPickStart, onPickTarget, onClearStart, onClearTarget, onSwap, onSafe, onStep, onPreview, onClose,
    onExitsSide, onExitsRun, onChooseExit,
  } = props;
  const ready = route && route.length != null;
  return html`
    <section class="card nav-card" aria-label="Маршрут">
      <div class="card__eyebrow nav-card__eyebrow">
        <${Icon} name="right" className="card__glyph" />
        <span>Навигатор</span>
        ${navState === 'building' && html`<span class="nav-card__state">готовлю план карты…</span>`}
        <button type="button" class="icon-btn card__close" onClick=${onClose} aria-label="Закрыть маршрут">✕</button>
      </div>

      <div class="nav-ends">
        <${End}
          letter="A" title=${startInfo ? startInfo.title : 'Откуда?'} sub=${startInfo ? startInfo.sub : 'LOCATE ME, точка на карте или «Маршрут отсюда» у маркера'}
          empty=${!startInfo} picking=${pickMode === 'from'} onPick=${onPickStart} onClear=${startInfo && startInfo.custom ? onClearStart : null} pickLabel="Поставить старт кликом по карте"
        />
        <button type="button" class="nav-swap" onClick=${onSwap} disabled=${!startInfo || !targetInfo} aria-label="Поменять местами старт и финиш" title="Поменять местами">⇅</button>
        <${End}
          letter="B" title=${targetInfo ? targetInfo.title : 'Куда?'} sub=${targetInfo ? targetInfo.sub : 'Маркер на карте, точка или ближайший выход'}
          empty=${!targetInfo} picking=${pickMode === 'to'} onPick=${onPickTarget} onClear=${targetInfo ? onClearTarget : null} pickLabel="Поставить финиш кликом по карте"
        />
      </div>

      ${ready && html`
        <div class="nav-sum">
          <div class="nav-sum__main">
            <span class="nav-sum__time">${formatDuration(route.eta.sprint)}</span>
            <span class="nav-sum__label">бегом</span>
          </div>
          <div class="nav-sum__facts">
            <span><b class="mono">${formatMeters(route.length)}</b> по маршруту</span>
            <span><b class="mono">${formatDuration(route.eta.walk)}</b> шагом</span>
            <span><b class="mono">${formatMeters(route.straight)}</b> по прямой</span>
          </div>
        </div>
        <div class="nav-actions">
          <button type="button" class="btn btn--player" onClick=${onPreview}>${previewing ? '■ Стоп' : '▶ Проезд'}</button>
          <label class="nav-toggle">
            <input type="checkbox" checked=${safe} onChange=${(e) => onSafe(e.target.checked)} />
            <span class="nav-toggle__box" aria-hidden="true"></span>
            <span>Обходить зоны снайпера</span>
          </label>
        </div>
        <ol class="nav-steps">
          ${route.maneuvers.map((m, k) => html`
            <li key=${k}>
              <button type="button" class=${`nav-step${k === activeStep ? ' is-active' : ''}${m.hazard ? ' is-hazard' : ''}${m.kind === 'gap' ? ' is-gap' : ''}`} onClick=${() => onStep(k)}>
                <${Icon} name=${iconOf(m)} className="nav-step__ico" />
                <span class="nav-step__text">
                  <span class="nav-step__title">${m.text}</span>
                  ${m.after && m.kind !== 'arrive' && m.kind !== 'gap' && html`<span class="nav-step__after">${m.after}</span>`}
                  ${m.note && html`<span class="nav-step__note">${m.note}</span>`}
                </span>
                <span class="nav-step__dist mono">${Math.round(m.dist)} м</span>
              </button>
            </li>`)}
        </ol>`}
      ${route && route.length == null && startInfo && targetInfo && html`
        <p class=${route.unreachable ? 'nav-warn' : 'muted'}>${route.unreachable
          ? `Пути по плану карты нет: одна из точек вне проходимой части (вода, скалы, за границей карты) или в закрытом месте. По прямой ${formatMeters(route.straight)}.`
          : navState === 'failed' ? 'План карты не прочитался: показано расстояние по прямой.' : `Строю маршрут по плану карты… Пока по прямой: ${formatMeters(route.straight)}.`}</p>`}
      ${!targetInfo && startInfo && html`<p class="hint">Выберите цель: нажмите маркер на карте или в списке «Места», поставьте точку «На карте» или найдите ближайший выход ниже.</p>`}
      ${!startInfo && html`<p class="hint">Старт маршрута: нажмите LOCATE ME со скриншотом из рейда или поставьте точку «На карте» там, где вы сейчас.</p>`}
      ${startInfo && html`<${ExtractList} state=${exits} onSide=${onExitsSide} onChoose=${onChooseExit} onRun=${onExitsRun} />`}
    </section>
  `;
}

// The plate over the map: the next manoeuvre, big, with the distance to it, and what comes after.
export function ManeuverBanner({ route, step, onStep, onClose, previewing, onPreview }) {
  if (!route || !route.maneuvers || route.maneuvers.length < 2) return null;
  const list = route.maneuvers;
  const k = Math.min(Math.max(1, step), list.length - 1);
  const m = list[k];
  const prev = list[k - 1];
  const next = list[k + 1];
  const remaining = route.length - m.dist;
  return html`
    <div class=${`mplate${m.hazard ? ' is-hazard' : ''}`} role="region" aria-label="Следующий манёвр">
      <button type="button" class="mplate__nav" onClick=${() => onStep(k - 1)} disabled=${k <= 1} aria-label="Предыдущий манёвр">‹</button>
      <div class="mplate__tile">
        <${Icon} name=${iconOf(m)} className="mplate__ico" />
        <span class="mplate__in mono">${prev.meters >= 1 ? formatMeters(prev.meters) : 'сразу'}</span>
      </div>
      <div class="mplate__body">
        <div class="mplate__text">${m.text}</div>
        ${m.after && m.kind !== 'arrive' && m.kind !== 'gap' && html`<div class="mplate__after">затем ${m.after}</div>`}
        ${next && html`<div class="mplate__next"><${Icon} name=${iconOf(next)} className="mplate__next-ico" /><span>${next.text}</span></div>`}
      </div>
      <div class="mplate__meta">
        <span class="mplate__count mono">${k} / ${list.length - 1}</span>
        <span class="mplate__rest mono">${formatMeters(Math.max(0, remaining))}</span>
        <button type="button" class="mplate__ride" onClick=${onPreview}>${previewing ? '■' : '▶'}</button>
      </div>
      <button type="button" class="mplate__nav" onClick=${() => onStep(k + 1)} disabled=${k >= list.length - 1} aria-label="Следующий манёвр">›</button>
      <button type="button" class="mplate__close" onClick=${onClose} aria-label="Скрыть маршрут">✕</button>
    </div>
  `;
}
