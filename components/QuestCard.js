import { html, Glyph, useState } from './html.js';
import { GLYPHS, displayName } from '../services/markerTypes.js';
import { questName, traderName, traderColor, questProgress } from '../services/questData.js';
import { guideToText, keyName, plural } from '../services/questGuide.js';
import { formatMeters } from '../services/coords.js';
import { RouteSteps } from './RouteSteps.js';

const STATUSES = [
  [null, 'Не взят'],
  ['active', 'Активный'],
  ['completed', 'Выполнен'],
];

function KeyRow({ keyRef, onFocusEntity }) {
  const names = (keyRef.namesRu || []).filter(Boolean);
  const alternatives = names.length > 1 ? ` (или ${names.slice(1).join(', ')})` : '';
  const lock = keyRef.locks[0];
  return html`
    <div class="keyrow">
      <${Glyph} svg=${GLYPHS.key} className="keyrow__glyph" />
      <span class="keyrow__name">${keyName(keyRef)}${alternatives}</span>
      ${lock
        ? html`<button type="button" class="link-btn" onClick=${() => onFocusEntity(lock.id)}>Замок на карте${keyRef.locks.length > 1 ? ` (${keyRef.locks.length})` : ''}</button>`
        : html`<span class="muted">замок не отмечен</span>`}
    </div>
  `;
}

function Step({ step, questId, selected, onToggle, onFocusPoints, onFocusEntity }) {
  const o = step.objective;
  const where = step.places.filter((g) => g.place || g.floor);
  const pointsLabel = o.points.length > 1 ? `Показать ${o.points.length} ${plural(o.points.length, 'точку', 'точки', 'точек')}` : 'Показать на карте';
  return html`
    <li class=${`qstep${step.done ? ' is-done' : ''}${selected ? ' is-selected' : ''}`}>
      <label class="check qstep__check">
        <input type="checkbox" checked=${step.done} onChange=${(e) => onToggle(questId, o.id, e.target.checked)} />
        <span class="check__box" aria-hidden="true"></span>
        <span class="visually-hidden">Цель выполнена</span>
      </label>
      <div class="qstep__body">
        <div class="qstep__label"><span class="mono">${step.n}</span> ${step.label}${o.optional ? ' · необязательно' : ''}</div>
        <div class="qstep__text">${step.text}</div>
        ${where.length > 0 && html`
          <div class="chips">
            ${where.map((g, i) => html`<span key=${i} class="chip" title="Ближайшая подпись на карте и расстояние до неё">${g.place ? `у ${displayName(g.place)} · ${Math.round(g.meters)} м` : 'без подписи рядом'}${g.floor ? ` · ${g.floor}` : ''}${g.count > 1 ? ` · ${g.count} точки` : ''}</span>`)}
          </div>`}
        ${step.hints.map((h, i) => html`<div key=${i} class="qstep__hint">${h}</div>`)}
        ${step.keys.map((k, i) => html`<${KeyRow} key=${`k${i}`} keyRef=${k} onFocusEntity=${onFocusEntity} />`)}
        <div class="qstep__actions">
          ${o.points.length > 0 && html`<button type="button" class="link-btn" onClick=${() => onFocusPoints(questId, o.id)}>${pointsLabel}</button>`}
          ${step.extract && html`<button type="button" class="link-btn" onClick=${() => onFocusEntity(step.extract.id)}>Выход на карте</button>`}
          ${step.bosses.map((b) => html`<button key=${b.id} type="button" class="link-btn" onClick=${() => onFocusEntity(b.id)}>Зона: ${b.meta.zoneNameRu || b.meta.zoneName || displayName(b)}</button>`)}
          ${step.nearest && html`<span class="mono qstep__dist">${formatMeters(step.nearest.meters)}</span>`}
        </div>
      </div>
    </li>
  `;
}

export function QuestCard({ guide, progressEntry, selectedObjectiveId, generatedAt, player, routeInfo, onSetStatus, onToggleObjective, onFocusPoints, onFocusEntity, onClose }) {
  const [copied, setCopied] = useState(null);
  const q = guide.quest;
  const status = (progressEntry && progressEntry.status) || null;
  const { done, total } = questProgress(q, progressEntry);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(guideToText(guide));
      setCopied('Гайд скопирован');
    } catch {
      setCopied('Буфер обмена недоступен на этой странице');
    }
    setTimeout(() => setCopied(null), 2500);
  };

  return html`
    <section class="card card--quest" style=${{ '--trader': traderColor(q.trader) }}>
      <div class="card__eyebrow">
        <${Glyph} svg=${GLYPHS.objective} className="card__glyph" />
        <span>Quest · ${traderName(q.trader)}</span>
        <button type="button" class="icon-btn card__close" onClick=${onClose} aria-label="Закрыть квест">✕</button>
      </div>
      <h2 class="card__title">${questName(q)}</h2>
      <div class="card__alt">${[q.nameRu && q.name ? q.name : null, q.minPlayerLevel ? `уровень ${q.minPlayerLevel}+` : null, q.kappaRequired ? 'нужен для Kappa' : null].filter(Boolean).join(' · ')}</div>

      <div class="seg" role="group" aria-label="Статус квеста">
        ${STATUSES.map(([value, label]) => html`
          <button key=${label} type="button" class=${`seg__btn${status === value ? ' is-on' : ''}`} aria-pressed=${status === value} onClick=${() => onSetStatus(q.id, value)}>${label}</button>`)}
      </div>
      <div class="qprogress">
        <div class="meter"><span class="meter__fill" style=${{ width: total ? `${(done / total) * 100}%` : '0%' }}></span></div>
        <span class="mono">${done}/${total}</span>
      </div>

      ${guide.next && player && html`
        <button type="button" class="next-goal" onClick=${() => onFocusPoints(q.id, guide.next.objective.id)}>
          <span class="eyebrow">Ближайшая цель</span>
          <span>Шаг ${guide.next.n}: ${guide.next.label} · ${formatMeters(guide.next.nearest.meters)} по прямой</span>
        </button>`}
      ${routeInfo && routeInfo.length != null && String(routeInfo.targetId || '').startsWith(`q:${q.id}:`) && html`
        <div class="route-note">
          Маршрут до выбранной точки: <b>${formatMeters(routeInfo.length)}</b>${routeInfo.outside ? '' : ` + ${formatMeters(routeInfo.endGap)} до цели`} · по прямой ${formatMeters(routeInfo.straight)}
          <${RouteSteps} steps=${routeInfo.steps} />
        </div>`}

      ${guide.neededKeys.length > 0 && html`
        <div class="subhead">Нужные ключи</div>
        <div class="list">${guide.neededKeys.map((k, i) => html`<${KeyRow} key=${i} keyRef=${k} onFocusEntity=${onFocusEntity} />`)}</div>`}

      <div class="subhead subhead--row">
        <span>Гайд</span>
        <button type="button" class="link-btn" onClick=${copy}>Копировать текст</button>
      </div>
      ${copied && html`<div class="muted">${copied}</div>`}
      <ol class="qsteps">
        ${guide.steps.map((s) => html`
          <${Step} key=${s.objective.id} step=${s} questId=${q.id} selected=${selectedObjectiveId === s.objective.id} onToggle=${onToggleObjective} onFocusPoints=${onFocusPoints} onFocusEntity=${onFocusEntity} />`)}
      </ol>
      <p class="card__foot">
        Цели, точки и ключи: tarkov.dev, данные от ${new Date(generatedAt).toLocaleDateString('ru-RU')}. Этаж определён по высоте точки.
        ${q.wikiLink && html` <a href=${q.wikiLink} target="_blank" rel="noopener noreferrer">Wiki</a>`}
      </p>
    </section>
  `;
}
