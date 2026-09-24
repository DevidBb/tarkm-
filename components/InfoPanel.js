import { html, Glyph } from './html.js';
import { GLYPHS, MARKER_TYPES, FACTION_LABELS, displayName, lootCategory } from '../services/markerTypes.js';
import { distanceBetween, formatMeters, formatCoord } from '../services/coords.js';
import { CONFIDENCE_THRESHOLD } from '../services/positionDetection.js';
import { questName, traderColor } from '../services/questData.js';
import { OBJECTIVE_LABELS } from '../services/questGuide.js';
import { EntityRow } from './SidePanel.js';
import { QuestCard } from './QuestCard.js';
import { RouteSteps } from './RouteSteps.js';

const pct = (v) => `${Math.round(v * 100)}%`;

function Field({ label, children, mono }) {
  return html`<div class="field"><span class="field__label">${label}</span><span class=${`field__value${mono ? ' mono' : ''}`}>${children}</span></div>`;
}

function typeFields(e) {
  const m = e.meta || {};
  switch (e.type) {
    case 'extract':
      return [['Для кого', FACTION_LABELS[m.faction] || m.faction], ['Игровой id', m.gameKey]];
    case 'transit':
      return [['Переход', e.nameRu || e.name]];
    case 'key':
      return [['Ключ', e.nameRu || e.name], ['Ключ (EN)', e.name], ['Что открывает', m.lockType === 'trunk' ? 'Багажник' : 'Дверь'], ['Нужно электричество', m.needsPower ? 'Да' : 'Нет']];
    case 'boss':
      return [
        ['Зона', m.zoneNameRu || m.zoneName || m.zone],
        ['Шанс появления босса', pct(m.spawnChance)],
        ['Шанс этой зоны', pct(m.locationChance)],
        ['Точек появления', String((m.positions || []).length)],
      ];
    case 'trader':
      return [['Торговец', m.traderRu || m.trader], ['Остановка', e.nameRu || e.name]];
    case 'danger':
      return [['Тип', e.nameRu || e.name]];
    case 'switch':
      return [['Переключатель', e.nameRu || e.name], ['Название (EN)', e.name], ['Игровой id', m.gameKey]];
    case 'spawn':
      return [
        ['Кто появляется', m.sides === 'all' ? 'Игроки: ЧВК и Дикий' : 'ЧВК'],
        ['Зона', m.zoneNameRu || m.zoneName || '—'],
        ['Источник', 'tarkov.dev: возможная точка появления, не гарантированная'],
      ];
    case 'loot': {
      const category = lootCategory(m.category);
      const fields = [['Категория', category ? category.label : m.category]];
      if (m.items) {
        const names = m.items.map((i) => i.nameRu || i.name);
        const shown = names.slice(0, 15).join(', ');
        fields.push(['Может появиться', names.length ? `${shown}${names.length > 15 ? ` и ещё ${names.length - 15}` : ''}` : 'Нет данных']);
      } else {
        fields.push(['Контейнер', e.nameRu || e.name]);
      }
      fields.push(['Источник', 'tarkov.dev: точка спавна, лут появляется не каждый рейд']);
      return fields;
    }
    default:
      return [['Источник', m.kind === 'zone' ? 'Игровая зона (центр точек появления)' : 'Подпись на карте tarkov.dev']];
  }
}

function EntityCard({ entity, player, routeInfo, onFocus, onClear, onRouteTo, onRouteFrom, navShown }) {
  const route = routeInfo && routeInfo.targetId === entity.id && routeInfo.length != null ? routeInfo : null;
  const type = MARKER_TYPES[entity.type];
  const dist = player ? distanceBetween(player.position, entity.position) : null;
  const p = entity.position;
  return html`
    <section class="card" style=${{ '--mk': type.color }}>
      <div class="card__eyebrow">
        <${Glyph} svg=${GLYPHS[type.glyph]} className="card__glyph" />
        <span>${type.single}</span>
        <button type="button" class="icon-btn card__close" onClick=${onClear} aria-label="Снять выделение">✕</button>
      </div>
      <h2 class="card__title">${displayName(entity)}</h2>
      ${entity.nameRu && entity.nameRu !== entity.name && html`<div class="card__alt">${entity.name}</div>`}
      <div class="fields">
        ${typeFields(entity).filter(([, v]) => v).map(([label, value]) => html`<${Field} key=${label} label=${label}>${value}<//>`)}
        <${Field} label="Этаж">${entity.floor ? `${entity.floor} (по высоте)` : 'Нет данных о высоте'}<//>
        <${Field} label="X / Y / Z" mono>${formatCoord(p.x)} / ${formatCoord(p.y)} / ${formatCoord(p.z)}<//>
        ${route && html`<${Field} label="По маршруту" mono>${formatMeters(route.length)}${route.outside ? '' : ` + ${formatMeters(route.endGap)} до цели`}<//>`}
        ${dist && html`<${Field} label="Distance" mono>${formatMeters(dist.meters)} по прямой${dist.is3d ? '' : ' (без высоты)'}<//>`}
      </div>
      ${route && !navShown && html`<${RouteSteps} steps=${route.steps} />`}
      <div class="card__actions card__actions--wrap">
        <button type="button" class="btn btn--player" onClick=${() => onRouteTo(entity.id)}>Маршрут сюда</button>
        <button type="button" class="btn btn--ghost" onClick=${() => onRouteFrom(entity.id)}>Отсюда</button>
        <button type="button" class="btn btn--ghost" onClick=${() => onFocus(entity.id)}>На карте</button>
      </div>
    </section>
  `;
}

function NearbyObjectives({ items, hasActiveQuests, onFocusQuestPoints }) {
  if (!items.length) {
    return html`<p class="muted">${hasActiveQuests ? 'У активных квестов не осталось целей с точками на карте.' : 'Отметьте квесты как «Активный»: здесь появятся ближайшие цели.'}</p>`;
  }
  return html`
    <div class="list">
      ${items.map((it) => html`
        <button key=${`${it.quest.id}:${it.objective.id}`} type="button" class="row" style=${{ '--mk': traderColor(it.quest.trader) }} onClick=${() => onFocusQuestPoints(it.quest.id, it.objective.id)}>
          <${Glyph} svg=${GLYPHS[it.point.kind === 'possible' ? 'item' : 'objective']} className="row__glyph" />
          <span class="row__text">
            <span class="row__name">${questName(it.quest)}</span>
            <span class="row__sub">Шаг ${it.objective.index + 1}: ${OBJECTIVE_LABELS[it.objective.type] || 'цель'}${it.point.floor ? ` · ${it.point.floor}` : ''}</span>
          </span>
          <span class="row__meters mono">${formatMeters(it.meters)}</span>
        </button>`)}
    </div>
  `;
}

function PlayerCard({ map, player, onFocus, onFlyToPlayer, compact, nearbyObjectives, hasActiveQuests, onFocusQuestPoints }) {
  const exact = player.method === 'filename';
  const nearExtracts = map.nearest(player.position, { types: ['extract', 'transit'], limit: 3 });
  const p = player.position;
  return html`
    <section class="card card--player">
      <div class="card__eyebrow"><span class="you-dot"></span><span>${player.approximate ? '≈ You are here' : 'You are here'}</span></div>
      <h2 class="card__title">${player.place ? displayName(player.place) : 'Позиция найдена'}</h2>
      <div class="fields">
        ${exact && player.place && html`<${Field} label="Ближайший ориентир">${displayName(player.place)} — ${formatMeters(player.placeMeters)}<//>`}
        <${Field} label="Этаж">${player.floor || 'не определён'}${player.method !== 'filename' && player.floor ? ' (оценка AI)' : ''}<//>
        <${Field} label="Confidence" mono>${pct(player.confidence)}<//>
        ${!compact && html`<${Field} label="Метод">${exact ? 'Координаты из имени файла EFT' : player.method === 'ai_confirmed' ? 'AI-кандидат, выбран вами' : 'Claude Vision по скриншоту'}<//>`}
        ${player.approximate && html`<${Field} label="Точность">Приблизительно: координаты ориентира, круг ±35 м<//>`}
        ${!compact && html`<${Field} label="X / Y / Z" mono>${formatCoord(p.x)} / ${formatCoord(p.y)} / ${formatCoord(p.z)}<//>`}
        ${!compact && player.takenAt && html`<${Field} label="Скриншот сделан" mono>${player.takenAt}<//>`}
      </div>
      <div class="card__actions">
        <button type="button" class="btn btn--player" onClick=${onFlyToPlayer}>К моей позиции</button>
      </div>
      <div class="subhead">Nearby quest objectives</div>
      <${NearbyObjectives} items=${nearbyObjectives} hasActiveQuests=${hasActiveQuests} onFocusQuestPoints=${onFocusQuestPoints} />
      ${!compact && html`
        <div class="subhead">Ближайшие выходы</div>
        <div class="list">${nearExtracts.map((r) => html`<${EntityRow} key=${r.entity.id} entity=${r.entity} meters=${r.meters} onFocus=${onFocus} />`)}</div>`}
    </section>
  `;
}

export function CandidatesList({ ai, onChoose }) {
  return html`
    <div class="cands">
      ${ai.candidates.map((c) => html`
        <div key=${c.place.id} class="cand-row">
          <div class="cand-row__top">
            <span class="cand-row__name">${displayName(c.place)}</span>
            <span class="cand-row__pct mono">${pct(c.confidence)}</span>
          </div>
          <div class="meter"><span class="meter__fill" style=${{ width: pct(c.confidence) }}></span></div>
          ${c.evidence && html`<div class="cand-row__why">${c.evidence}</div>`}
          <button type="button" class="btn btn--ghost" onClick=${() => onChoose(c)}>Я здесь</button>
        </div>`)}
    </div>
  `;
}

function UncertainCard({ uncertain, onChoose }) {
  const { ai } = uncertain;
  return html`
    <section class="card card--warn">
      <div class="card__eyebrow"><span>AI не уверен</span></div>
      <h2 class="card__title">Possible locations</h2>
      <p class="muted">Лучший вариант ниже ${pct(CONFIDENCE_THRESHOLD)}: позиция не показана как точная. Варианты обведены на карте. Выберите свой, если узнаёте место.</p>
      <${CandidatesList} ai=${ai} onChoose=${onChoose} />
      ${ai.summary && html`<div class="subhead">Что увидел Claude</div><p class="muted">${ai.summary}</p>`}
    </section>
  `;
}

function IntroCard({ map, onLocate }) {
  const count = (t) => (map ? map.entities.filter((e) => e.type === t).length : 0);
  return html`
    <section class="card">
      <div class="card__eyebrow"><span>Quest info</span></div>
      <h2 class="card__title">Где я и куда идти</h2>
      <ol class="steps">
        <li>Во вкладке <b>Квесты</b> введите название квеста или вставьте текст задания: появится гайд, а цели отметятся на карте.</li>
        <li>Нажмите <b>LOCATE ME</b> и загрузите скриншот из рейда. Оригинальный файл из <span class="mono">Documents\\Escape from Tarkov\\Screenshots</span> даёт точные координаты.</li>
        <li>Отмечайте цели галочками: прогресс сохраняется.</li>
      </ol>
      <button type="button" class="btn" onClick=${onLocate}>Locate me</button>
      ${map && html`
        <div class="subhead">На карте сейчас</div>
        <div class="fields">
          <${Field} label="Выходы и переходы" mono>${count('extract') + count('transit')}<//>
          <${Field} label="Замки с ключами" mono>${count('key')}<//>
          <${Field} label="Зоны боссов" mono>${count('boss')}<//>
          ${count('trader') > 0 && html`<${Field} label="Остановки БТР" mono>${count('trader')}<//>`}
          ${count('switch') > 0 && html`<${Field} label="Переключатели" mono>${count('switch')}<//>`}
          ${count('spawn') > 0 && html`<${Field} label="Спавны ЧВК (фильтр)" mono>${count('spawn')}<//>`}
          <${Field} label="Опасные зоны" mono>${count('danger')}<//>
          <${Field} label="Места и улицы" mono>${count('place') + count('street')}<//>
          <${Field} label="Точки лута (фильтр «Лут»)" mono>${map.loot.length}<//>
          <${Field} label="Данные обновлены" mono>${new Date(map.generatedAt).toLocaleDateString('ru-RU')}<//>
        </div>`}
    </section>
  `;
}

export function InfoPanel(props) {
  const {
    map, selected, player, uncertain, guide, progressEntry, selectedObjectiveId, questsGeneratedAt, nearbyObjectives, hasActiveQuests, routeInfo,
    onFocus, onClearSelection, onFlyToPlayer, onChooseCandidate, onLocate, onSetQuestStatus, onToggleObjective, onFocusQuestPoints, onCloseQuest,
    onRouteTo, onRouteFrom, navPanel,
  } = props;
  return html`
    <aside class="info" aria-label="Информация">
      ${navPanel}
      ${uncertain && html`<${UncertainCard} uncertain=${uncertain} onChoose=${onChooseCandidate} />`}
      ${selected && html`<${EntityCard} entity=${selected} player=${player} routeInfo=${routeInfo} onFocus=${onFocus} onClear=${onClearSelection} onRouteTo=${onRouteTo} onRouteFrom=${onRouteFrom} navShown=${Boolean(navPanel)} />`}
      ${guide && html`
        <${QuestCard}
          guide=${guide} progressEntry=${progressEntry} selectedObjectiveId=${selectedObjectiveId} generatedAt=${questsGeneratedAt} player=${player} routeInfo=${routeInfo}
          onSetStatus=${onSetQuestStatus} onToggleObjective=${onToggleObjective} onFocusPoints=${onFocusQuestPoints} onFocusEntity=${onFocus} onClose=${onCloseQuest}
        />`}
      ${player && map && html`
        <${PlayerCard}
          map=${map} player=${player} onFocus=${onFocus} onFlyToPlayer=${onFlyToPlayer} compact=${Boolean(selected || guide)}
          nearbyObjectives=${nearbyObjectives} hasActiveQuests=${hasActiveQuests} onFocusQuestPoints=${onFocusQuestPoints}
        />`}
      ${!uncertain && !selected && !player && !guide && !navPanel && html`<${IntroCard} map=${map} onLocate=${onLocate} />`}
    </aside>
  `;
}
