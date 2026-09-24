import { html, Glyph, useRef } from './html.js';
import { GLYPHS, displayName } from '../services/markerTypes.js';
import { formatMeters, formatCoord } from '../services/coords.js';
import { CandidatesList } from './InfoPanel.js';

const pct = (v) => `${Math.round(v * 100)}%`;

function Observations({ ai }) {
  if (!ai) return null;
  const o = ai.observations;
  const chips = [...o.textSigns, ...o.architecture, ...o.indoorFeatures, ...o.uniqueObjects, ...o.streetLayout].slice(0, 14);
  return html`
    ${ai.summary && html`<p class="muted">${ai.summary}</p>`}
    ${chips.length > 0 && html`<div class="chips">${chips.map((c, i) => html`<span key=${i} class="chip">${c}</span>`)}</div>`}
  `;
}

function Result({ state, vision, onRetry, onCancel, onChooseCandidate, onShowPlayer, mapName = 'Streets of Tarkov' }) {
  const { phase, result } = state;
  if (phase === 'reading') return html`<div class="result result--busy"><span class="spinner"></span>Проверяю имя файла…</div>`;
  if (phase === 'analyzing') {
    return html`
      <div class="result result--busy">
        <span class="spinner"></span>
        <div>
          <div class="result__title">Analyzing screenshot…</div>
          <div class="muted">Claude ищет вывески, архитектуру и приметы помещений. Обычно 10–60 секунд${state.streamed ? ` · получено ${state.streamed} симв.` : ''}.</div>
        </div>
        <button type="button" class="btn btn--ghost" onClick=${onCancel}>Стоп</button>
      </div>`;
  }
  if (phase === 'error') {
    return html`
      <div class="result result--bad">
        <div class="result__title">Не получилось</div>
        <p>${state.error}</p>
        <button type="button" class="btn" onClick=${onRetry}>Повторить</button>
      </div>`;
  }
  if (phase !== 'done' || !result) return null;

  switch (result.status) {
    case 'found': {
      const exact = result.method === 'filename';
      const p = result.position;
      return html`
        <div class="result result--ok">
          <div class="result__title">Location found${result.approximate ? ' · приблизительно' : ''}</div>
          <div class="result__place">${result.place ? displayName(result.place) : 'Без ориентира рядом'}</div>
          <div class="fields">
            ${exact && result.place && html`<div class="field"><span class="field__label">До ориентира</span><span class="field__value mono">${formatMeters(result.placeMeters)}</span></div>`}
            <div class="field"><span class="field__label">Этаж</span><span class="field__value mono">${result.floor || '—'}</span></div>
            <div class="field"><span class="field__label">Confidence</span><span class="field__value mono">${pct(result.confidence)}</span></div>
            <div class="field"><span class="field__label">X / Y / Z</span><span class="field__value mono">${formatCoord(p.x)} / ${formatCoord(p.y)} / ${formatCoord(p.z)}</span></div>
          </div>
          <p class="muted">${exact ? 'Координаты и направление взгляда взяты из имени файла, которое записала игра.' : 'Позиция — координаты ориентира из данных карты; AI не выдаёт координаты сам.'}</p>
          ${!exact && html`<${Observations} ai=${result.ai} />`}
          ${state.saveError && html`<p class="warn-text">${state.saveError}</p>`}
          <button type="button" class="btn btn--player" onClick=${onShowPlayer}>Показать на карте</button>
        </div>`;
    }
    case 'uncertain':
      return html`
        <div class="result result--warn">
          <div class="result__title">Possible locations</div>
          <p class="muted">Уверенность ниже 50%, поэтому точная позиция не показана. Если узнаёте место, выберите его.</p>
          <${CandidatesList} ai=${result.ai} onChoose=${onChooseCandidate} />
          <${Observations} ai=${result.ai} />
        </div>`;
    case 'not_found':
      return html`
        <div class="result result--warn">
          <div class="result__title">Не удалось точно определить место</div>
          <p class="muted">Claude не нашёл на скриншоте признаков, совпадающих с местами карты. Попробуйте кадр с вывеской, улицей или характерным зданием.</p>
          <${Observations} ai=${result.ai} />
        </div>`;
    case 'not_streets':
      return html`
        <div class="result result--warn">
          <div class="result__title">Похоже, это не ${mapName}</div>
          <${Observations} ai=${result.ai} />
        </div>`;
    case 'out_of_bounds':
      return html`
        <div class="result result--warn">
          <div class="result__title">Координаты вне ${mapName}</div>
          <p class="muted">В имени файла есть координаты (${formatCoord(result.position.x)}, ${formatCoord(result.position.y)}, ${formatCoord(result.position.z)}), но они за границами этой карты. Скорее всего, скриншот сделан на другой локации.</p>
        </div>`;
    case 'ai_unavailable':
      return html`
        <div class="result result--warn">
          <div class="result__title">В имени файла нет координат EFT</div>
          <p class="muted">${result.message || (vision && vision.message) || 'AI-анализ недоступен.'}</p>
          <p class="muted">Совет: загрузите оригинальный файл из <span class="mono">Documents\\Escape from Tarkov\\Screenshots</span>, не переименовывая его.</p>
        </div>`;
    default:
      return null;
  }
}

export function LocateDialog({ state, vision, ready, onFile, onClose, onCancel, onRetry, onChooseCandidate, onShowPlayer, mapName = 'Streets of Tarkov' }) {
  const inputRef = useRef(null);
  const busy = state.phase === 'reading' || state.phase === 'analyzing';
  const pick = () => { if (!busy && ready && inputRef.current) inputRef.current.click(); };

  return html`
    <div class="modal" onClick=${(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div class="locate" role="dialog" aria-modal="true" aria-labelledby="locate-title">
        <div class="locate__head">
          <${Glyph} svg=${GLYPHS.camera} className="locate__icon" />
          <div>
            <h2 id="locate-title" class="locate__title">Locate me</h2>
            <div class="muted">Где я на ${mapName}?</div>
          </div>
          <button type="button" class="icon-btn" onClick=${onClose} aria-label="Закрыть">✕</button>
        </div>

        <button type="button" class=${`drop${state.preview ? ' has-image' : ''}`} onClick=${pick} disabled=${busy || !ready}>
          ${state.preview
            ? html`<img src=${state.preview} alt="Загруженный скриншот" class="drop__img" />`
            : html`<span class="drop__empty"><b>Перетащите скриншот сюда</b><span>или нажмите, чтобы выбрать файл · Ctrl+V — вставить из буфера</span></span>`}
        </button>
        <input ref=${inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden onChange=${(e) => { const f = e.target.files && e.target.files[0]; if (f) onFile(f); e.target.value = ''; }} />
        ${state.fileName && html`<div class="locate__file mono" title=${state.fileName}>${state.fileName}</div>`}

        <div class="methods">
          <div class="method"><span class="method__n mono">1</span><div><b>Имя файла EFT.</b> Игра пишет X/Y/Z и поворот камеры в имя скриншота: точная позиция без AI.</div></div>
          <div class="method"><span class="method__n mono">2</span><div><b>Claude Vision.</b> ${vision ? (vision.available ? 'Вывески, архитектура, помещения сопоставляются только с местами из данных карты.' : vision.message) : 'Подключение…'}</div></div>
        </div>

        <${Result} state=${state} vision=${vision} onRetry=${onRetry} onCancel=${onCancel} onChooseCandidate=${onChooseCandidate} onShowPlayer=${onShowPlayer} mapName=${mapName} />
      </div>
    </div>
  `;
}
