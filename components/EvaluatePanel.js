import { html, useState, useMemo, useRef } from './html.js';
import { MODES, formatRub, itemName, itemShort, priceInfo, traderLabel } from '../services/market.js';
import { BUILD } from '../services/version.js';

const IMAGE_NAME = /\.(png|jpe?g|webp)$/i;

// Own paste/drop target: handles the event before the page-wide LOCATE ME handler ever sees it.
function PasteZone({ onFile, disabled, problem, connecting, compact }) {
  const fileRef = useRef(null);
  const [over, setOver] = useState(false);
  const pick = (files) => Array.from(files || []).find((f) => f.type.startsWith('image/') || IMAGE_NAME.test(f.name || ''));
  const onPaste = (e) => {
    const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    const file = item && item.getAsFile();
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    onFile(file);
  };
  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const file = pick(e.dataTransfer && e.dataTransfer.files);
    if (file) onFile(file);
  };
  return html`
    <div
      class=${`epaste${compact ? ' epaste--compact' : ''}${over ? ' is-over' : ''}${disabled ? ' is-busy' : ''}`}
      role="button"
      tabIndex="0"
      aria-label="Скриншот инвентаря: нажмите, чтобы выбрать файл, или вставьте Ctrl+V"
      onClick=${() => !disabled && fileRef.current && fileRef.current.click()}
      onKeyDown=${(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled && fileRef.current) { e.preventDefault(); fileRef.current.click(); } }}
      onPaste=${onPaste}
      onDragOver=${(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
      onDragLeave=${() => setOver(false)}
      onDrop=${onDrop}
    >
      <b>${compact ? 'Ещё скриншот' : 'Скиньте скриншот инвентаря'}</b>
      <span>Ctrl+V · перетащите сюда · или нажмите и выберите файл</span>
      ${connecting && html`<span class="epaste__note">Подключаюсь к Claude…</span>`}
      ${problem && html`<span class="epaste__note warn-text">${problem}</span>`}
      <input ref=${fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange=${(e) => { const f = e.target.files && e.target.files[0]; if (f) onFile(f); e.target.value = ''; }} />
    </div>
  `;
}

const PICKED = { claude: 'выбрал Claude', similar: 'похожее название — проверьте', user: 'выбрано вами' };

function whereText(info) {
  if (info.source === 'money') return 'Рубли: считаются по номиналу';
  if (info.source === 'flea') return `Средняя цена на барахолке за 24 ч${info.fleaLow ? ` · последнее мин. предложение ${formatRub(info.fleaLow)}` : ''}`;
  if (info.source === 'trader') return `${info.noFlea ? 'Нельзя продать на барахолке' : 'На барахолке цены нет'} · лучший торговец: ${traderLabel(info.trader.trader)}`;
  return 'Цены нет: не продаётся ни на барахолке, ни торговцам';
}

function bestText(info) {
  if (!info.best || info.source === 'money') return null;
  if (info.best.where === 'trader' && info.flea != null) {
    return `Выгоднее торговцу ${traderLabel(info.best.trader)}: ${formatRub(info.best.price)} (барахолка ≈ ${formatRub(info.fleaNet)} после комиссии)`;
  }
  if (info.best.where === 'flea') {
    return `На барахолке ≈ ${formatRub(info.fleaNet)} после комиссии ${formatRub(info.fee)}${info.trader ? ` · торговцу ${traderLabel(info.trader.trader)}: ${formatRub(info.trader.price)}` : ''}`;
  }
  return null;
}

// Item card in the centre of the screen: the item cut out of the screenshot, name, total and unit price.
function Card({ row, rank, market, mode, onCount, onItem, onRemove }) {
  const item = row.itemId ? market.byId.get(row.itemId) : null;
  const info = item ? priceInfo(market, item, mode) : null;
  const total = info && info.unit != null ? info.unit * row.count : null;
  const best = info ? bestText(info) : null;
  const showLabel = row.source === 'screenshot' && row.label && (!item || ![item.shortName, item.shortNameRu, item.name, item.nameRu].includes(row.label));
  return html`
    <div class=${`ecard${item ? '' : ' is-unmatched'}`}>
      <div class="ecard__img">
        ${row.crop
          ? html`<img src=${row.crop} alt=${item ? itemName(item) : row.label || ''} />`
          : html`<span class="ecard__noimg mono">${item ? `${item.width}×${item.height}` : '?'}</span>`}
        <span class="ecard__rank mono">${rank}</span>
        <button type="button" class="icon-btn icon-btn--sm ecard__remove" onClick=${() => onRemove(row.key)} aria-label="Убрать из оценки">✕</button>
      </div>
      <div class="ecard__name">${item ? itemName(item) : `«${row.label || row.fullName}»`}</div>
      <div class="erow__sub">
        ${item && html`<span>${itemShort(item)} · ${item.width}×${item.height}</span>`}
        ${showLabel && html`<span>со скриншота: «${row.label}»</span>`}
        ${row.picked && PICKED[row.picked] && html`<span class=${row.picked === 'similar' ? 'warn-text' : ''}>${PICKED[row.picked]}</span>`}
      </div>
      ${row.candidates && row.candidates.length > 1 && html`
        <select class="erow__select" value=${row.itemId || ''} onChange=${(e) => onItem(row.key, e.target.value || null)} aria-label="Какой это предмет">
          <option value="">— выберите предмет —</option>
          ${row.candidates.map((id) => {
            const c = market.byId.get(id);
            return c && html`<option key=${id} value=${id}>${itemName(c)} · ${c.width}×${c.height}</option>`;
          })}
        </select>`}
      ${!item && !(row.candidates && row.candidates.length > 1) && html`<div class="erow__warn">Не нашёл в базе предметов. Уберите карточку и добавьте предмет поиском слева.</div>`}
      ${item && html`
        <div class="ecard__total mono">${total != null ? formatRub(total) : '—'}</div>
        <div class="erow__price">
          <input class="erow__count mono" type="number" min="1" step="1" value=${row.count} onChange=${(e) => onCount(row.key, e.target.value)} aria-label="Количество" />
          <span class="mono erow__unit">× ${info.unit != null ? formatRub(info.unit) : '—'}</span>
        </div>
        <div class="erow__where">${whereText(info)}</div>
        ${best && html`<div class="erow__best">${best}</div>`}`}
    </div>
  `;
}

// Centre of the screen while the "Оценить" tab is open: screenshot drop zone and item cards, most expensive first.
export function EvaluateStage(props) {
  const { market, marketError, mode, rows, onCount, onItem, onRemove, evalState, onFile, onCancel, recognitionIssue, connecting, shot } = props;
  const sorted = useMemo(() => {
    if (!market) return rows;
    const value = (r) => {
      const item = r.itemId ? market.byId.get(r.itemId) : null;
      if (!item) return -1; // not recognized: at the end
      const info = priceInfo(market, item, mode);
      return info.unit != null ? info.unit * r.count : 0;
    };
    return [...rows].sort((a, b) => value(b) - value(a));
  }, [rows, market, mode]);
  const busy = evalState.phase === 'reading' || evalState.phase === 'matching' || evalState.phase === 'waiting';

  return html`
    <div class="estage" data-panel="evaluate">
      <div class="estage__head">
        <h2 class="estage__title">Оценка инвентаря</h2>
        <span class="muted">Предметы со скриншота — от дорогих к дешёвым</span>
      </div>
      <${PasteZone} onFile=${onFile} disabled=${busy} problem=${shot ? null : recognitionIssue} connecting=${connecting} compact=${rows.length > 0} />
      ${shot && html`
        <div class=${`eshot${evalState.phase === 'error' ? ' is-bad' : ''}`}>
          <img src=${shot.url} alt="Загруженный скриншот" />
          <div class="eshot__text">
            <b>Скриншот получен</b>
            <span class="muted">${shot.name}</span>
            <span>${busy ? 'Читаю предметы…' : evalState.phase === 'error' ? 'Прочитать не получилось — причина ниже' : evalState.phase === 'done' ? 'Готово — карточки ниже' : ''}</span>
          </div>
        </div>`}
      ${busy && html`
        <div class="match match--busy">
          <span class="spinner"></span>
          <span>${evalState.phase === 'waiting' ? 'Скриншот получен, подключаюсь к Claude… Если долго висит — разрешите странице доступ к Claude во всплывающем запросе.' : evalState.phase === 'reading' ? 'Claude читает предметы на скриншоте…' : 'Claude уточняет похожие предметы…'}</span>
          ${evalState.phase !== 'waiting' && html`<button type="button" class="btn btn--ghost" onClick=${onCancel}>Стоп</button>`}
        </div>`}
      ${evalState.phase === 'error' && html`<div class="match match--none"><p class="warn-text">${evalState.error}</p></div>`}
      ${evalState.phase === 'done' && html`
        <div class="match match--sure">
          <div class="match__title">Со скриншота: ${evalState.read} ${evalState.unmatched ? `· нужно проверить: ${evalState.unmatched}` : '· всё найдено'}</div>
          ${evalState.notes && html`<p class="muted">${evalState.notes}</p>`}
        </div>`}
      ${marketError && html`<div class="note"><div class="note__title">Цены не загрузились</div><p>${marketError}</p></div>`}
      ${!market && !marketError && html`<div class="side__empty">Загрузка цен…</div>`}
      ${market && rows.length > 0 && html`
        <div class="ecards">
          ${sorted.map((r, i) => html`<${Card} key=${r.key} row=${r} rank=${i + 1} market=${market} mode=${mode} onCount=${onCount} onItem=${onItem} onRemove=${onRemove} />`)}
        </div>
        <p class="hint">Картинку предмета вырезаю по координатам, которые Claude указывает на скриншоте, — рамка может быть немного смещена. Цены — из снимка tarkov.dev, не от Claude.</p>`}
    </div>
  `;
}

function AddItem({ market, mode, onAdd }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => (query.trim().length >= 2 ? market.search(query, 8) : []), [market, query]);
  return html`
    <div class="eadd">
      <label class="search">
        <span class="visually-hidden">Добавить предмет вручную</span>
        <input type="search" value=${query} onChange=${(e) => setQuery(e.target.value)} placeholder="Добавить предмет: название (RU / EN)" />
      </label>
      ${results.length > 0 && html`
        <div class="list eadd__list">
          ${results.map((it) => {
            const info = priceInfo(market, it, mode);
            return html`
              <button key=${it.id} type="button" class="row" onClick=${() => { onAdd(it.id); setQuery(''); }}>
                <span class="row__text">
                  <span class="row__name">${itemName(it)}</span>
                  <span class="row__sub">${itemShort(it)} · ${it.width}×${it.height}</span>
                </span>
                <span class="row__meters mono">${info.unit != null ? formatRub(info.unit) : '—'}</span>
              </button>`;
          })}
        </div>`}
      ${query.trim().length >= 2 && results.length === 0 && html`<div class="list__caption">Ничего не найдено.</div>`}
    </div>
  `;
}

function Summary({ market, rows, mode }) {
  const t = { avg: 0, best: 0, count: 0, priced: 0, unmatched: 0 };
  for (const r of rows) {
    const item = r.itemId ? market.byId.get(r.itemId) : null;
    if (!item) { t.unmatched += 1; continue; }
    const info = priceInfo(market, item, mode);
    t.count += r.count;
    if (info.unit != null) { t.avg += info.unit * r.count; t.priced += 1; }
    if (info.best) t.best += info.best.price * r.count;
  }
  return html`
    <div class="esum">
      <div class="esum__line"><span>По средней цене</span><span class="esum__value">${formatRub(t.avg)}</span></div>
      <div class="esum__line"><span>Если продать выгоднее всего</span><span class="esum__value esum__value--best">≈ ${formatRub(t.best)}</span></div>
      <div class="esum__meta">Предметов: ${t.count}${t.unmatched ? ` · не распознано: ${t.unmatched}` : ''} · комиссия барахолки без учёта бонуса Разведцентра</div>
    </div>
  `;
}

// Left panel of the "Оценить" tab: game mode, price snapshot, totals, manual add, clear. The screenshot and the
// item cards are in the centre (EvaluateStage).
export function EvaluatePanel(props) {
  const { market, marketError, mode, onMode, rows, onAdd, onClear } = props;
  if (marketError) {
    return html`<div class="side__body"><div class="note"><div class="note__title">Цены не загрузились</div><p>${marketError}</p></div></div>`;
  }
  if (!market) return html`<div class="side__body"><div class="side__empty">Загрузка цен…</div></div>`;

  const snapshot = new Date(market.generatedAt);
  const hours = (Date.now() - snapshot.getTime()) / 36e5;
  return html`
    <div class="side__body">
      <div class="ehead">
        <div class="ehead__row">
          <span class="eyebrow">Цены tarkov.dev</span>
          <div class="seg seg--sm" role="group" aria-label="Режим игры">
            ${MODES.map(([id, label]) => html`<button key=${id} type="button" class=${`seg__btn${mode === id ? ' is-on' : ''}`} aria-pressed=${mode === id} onClick=${() => onMode(id)}>${label}</button>`)}
          </div>
        </div>
        <div class=${`ehead__meta${hours > 24 ? ' warn-text' : ''}`}>
          Снимок цен от ${snapshot.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${hours > 24 ? ' — старше суток, цены могли измениться' : ''} · сборка ${BUILD}
        </div>
      </div>
      <p class="hint">Скриншот — в центре экрана: Ctrl+V, перетаскивание или кнопка «Оценить инв» внизу. Подходит любой скрин, в том числе Win+Shift+S; чем крупнее видны названия предметов, тем точнее.</p>
      ${rows.length > 0 && html`<${Summary} market=${market} rows=${rows} mode=${mode} />`}
      <${AddItem} market=${market} mode=${mode} onAdd=${onAdd} />
      ${rows.length > 0 && html`<button type="button" class="btn btn--ghost btn--block" onClick=${onClear}>Очистить оценку</button>`}
    </div>
  `;
}
