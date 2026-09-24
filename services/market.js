// Item prices for the "Оценить" tab: data/market/prices.json, a snapshot of tarkov.dev flea market and trader
// prices (PvP and PvE) made by scripts/import_prices.ps1. Finds items by the short or full name read from a
// screenshot and works out what selling brings: the flea market 24 h average, the flea market fee (formula of
// the tarkov.dev API, rates from the data) and the trader who pays the most.

export const PRICES_URL = 'data/market/prices.json';
const FORMAT = 'tarkov-map-ai/prices@1';
export const MODES = [['pvp', 'PvP'], ['pve', 'PvE']];
const ROUBLES_ID = '5449016a4bdc2d6f028b456f';

const compact = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
const RUB = new Intl.NumberFormat('ru-RU');
export const formatRub = (n) => `${RUB.format(Math.round(n))} ₽`;
export const itemName = (item) => item.nameRu || item.name;
export const itemShort = (item) => item.shortNameRu || item.shortName || '';

function trigrams(s) {
  const padded = `  ${s} `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 2; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

// tarkov.dev API fleaMarketFee (resolvers/itemResolver.mjs), without the Intelligence Center discount.
export function fleaFee(price, basePrice, rates, count = 1) {
  if (!rates || !(price > 0) || !(basePrice > 0)) return 0;
  const vo = basePrice;
  const vr = price;
  let po = Math.log10(vo / vr);
  if (vr < vo) po = Math.pow(po, 1.08);
  let pr = Math.log10(vr / vo);
  if (vr >= vo) pr = Math.pow(pr, 1.08);
  const fee = vo * rates.offer * Math.pow(4, po) * count + vr * rates.requirement * Math.pow(4, pr) * count;
  return Math.round(Math.min(fee, Number.MAX_SAFE_INTEGER));
}

export function priceInfo(market, item, mode) {
  if (item.id === ROUBLES_ID) {
    return { unit: 1, source: 'money', flea: null, fleaLow: null, fee: null, fleaNet: null, trader: null, best: { where: 'money', price: 1 }, noFlea: true };
  }
  const m = item[mode] || null;
  const rates = market.fleaMarket[mode] || market.fleaMarket.pvp;
  const flea = !item.noFlea && m && m.avg24h > 0 ? m.avg24h : null;
  const trader = m && m.bestTraderPrice > 0 ? { price: m.bestTraderPrice, trader: market.traders[m.bestTrader] || null } : null;
  const fee = flea ? fleaFee(flea, item.basePrice, rates) : null;
  const fleaNet = flea ? Math.max(0, flea - fee) : null;
  let best = null;
  if (fleaNet != null && (!trader || fleaNet > trader.price)) best = { where: 'flea', price: fleaNet };
  else if (trader) best = { where: 'trader', price: trader.price, trader: trader.trader };
  return {
    unit: flea != null ? flea : trader ? trader.price : null,
    source: flea != null ? 'flea' : trader ? 'trader' : 'none',
    flea,
    fleaLow: m && m.lastLow > 0 ? m.lastLow : null,
    offers: m ? m.offers : 0,
    lastScan: m ? m.lastScan : null,
    fee,
    fleaNet,
    trader,
    best,
    noFlea: Boolean(item.noFlea),
  };
}

export const traderLabel = (trader) => (trader ? trader.nameRu || trader.name : 'торговец');

export async function loadMarketData(url = PRICES_URL) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Цены не загрузились (HTTP ${res.status}). Запустите scripts\\import_prices.ps1.`);
  const data = await res.json();
  if (data.format !== FORMAT) throw new Error(`Неподдерживаемый формат цен: ${data.format}`);

  const col = Object.fromEntries(data.columns.map((c, i) => [c, i]));
  const pc = Object.fromEntries(data.priceColumns.map((c, i) => [c, i]));
  const modeOf = (arr) => (Array.isArray(arr)
    ? { avg24h: arr[pc.avg24h], low24h: arr[pc.low24h], lastLow: arr[pc.lastLow], offers: arr[pc.offers], lastScan: arr[pc.lastScan], bestTrader: arr[pc.bestTrader], bestTraderPrice: arr[pc.bestTraderPrice] }
    : null);
  const list = data.items.map((row) => ({
    id: row[col.id],
    name: row[col.name],
    nameRu: row[col.nameRu],
    shortName: row[col.shortName],
    shortNameRu: row[col.shortNameRu],
    width: row[col.width],
    height: row[col.height],
    basePrice: row[col.basePrice],
    noFlea: row[col.noFlea] === 1,
    pvp: modeOf(row[col.pvp]),
    pve: modeOf(row[col.pve]),
  }));
  const byId = new Map(list.map((it) => [it.id, it]));
  const traders = data.traders.map(([name, nameRu]) => ({ name, nameRu }));
  const popularity = (it) => (it.pvp ? it.pvp.offers || 0 : 0);

  const exactShort = new Map();
  const exactName = new Map();
  const put = (map, key, item) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    const arr = map.get(key);
    if (!arr.includes(item)) arr.push(item);
  };
  for (const it of list) {
    put(exactShort, compact(it.shortName), it);
    put(exactShort, compact(it.shortNameRu), it);
    put(exactName, compact(it.name), it);
    put(exactName, compact(it.nameRu), it);
  }

  let grams = null;
  const gramIndex = () => {
    if (!grams) {
      grams = list.map((it) => ({
        it,
        short: [it.shortName, it.shortNameRu].map(compact).filter(Boolean).map(trigrams),
        name: [it.name, it.nameRu].map(compact).filter(Boolean).map(trigrams),
      }));
    }
    return grams;
  };

  // A label read from a screenshot -> candidate items. sure: one clear item; maybe: pick among candidates; none.
  function matchLabel({ label, fullName, width, height }) {
    const found = new Map();
    const add = (item, score, why) => {
      const prev = found.get(item.id);
      if (!prev || score > prev.score) found.set(item.id, { item, score, why });
    };
    const full = compact(fullName);
    const lab = compact(label);
    if (full) for (const it of exactName.get(full) || []) add(it, 1, 'name');
    if (lab) {
      for (const it of exactShort.get(lab) || []) add(it, 0.95, 'short');
      for (const it of exactName.get(lab) || []) add(it, 0.92, 'name');
    }
    const exact = found.size > 0;
    if (!exact && (lab.length >= 2 || full.length >= 4)) {
      const lg = lab ? trigrams(lab) : null;
      const fg = full ? trigrams(full) : null;
      for (const g of gramIndex()) {
        let s = 0;
        if (lg) for (const t of g.short) s = Math.max(s, dice(lg, t));
        if (fg) for (const t of g.name) s = Math.max(s, dice(fg, t) * 0.98);
        if (lg && !fg) for (const t of g.name) s = Math.max(s, dice(lg, t) * 0.8);
        if (s >= 0.5) add(g.it, s * 0.85, 'similar');
      }
    }
    const results = [...found.values()];
    if (width && height) {
      for (const r of results) {
        const sameSize = (r.item.width === width && r.item.height === height) || (r.item.width === height && r.item.height === width);
        r.score += sameSize ? 0.03 : -0.1;
      }
    }
    results.sort((a, b) => b.score - a.score || popularity(b.item) - popularity(a.item));
    const [top, second] = results;
    let level = 'none';
    if (top && exact && (!second || top.score - second.score >= 0.08)) level = 'sure';
    else if (top && top.score >= 0.45) level = 'maybe';
    return { level, candidates: results.slice(0, 6) };
  }

  function search(query, limit = 8) {
    const q = compact(query);
    if (q.length < 2) return [];
    const hits = [];
    for (const it of list) {
      let score = 0;
      for (const s of [it.shortName, it.shortNameRu]) {
        const c = compact(s);
        if (c === q) score = Math.max(score, 1);
        else if (c.startsWith(q)) score = Math.max(score, 0.85);
      }
      for (const s of [it.name, it.nameRu]) {
        const c = compact(s);
        if (c === q) score = Math.max(score, 0.95);
        else if (c.startsWith(q)) score = Math.max(score, 0.8);
        else if (c.includes(q)) score = Math.max(score, 0.6);
      }
      if (score) hits.push({ it, score });
    }
    hits.sort((a, b) => b.score - a.score || popularity(b.it) - popularity(a.it));
    return hits.slice(0, limit).map((h) => h.it);
  }

  return { generatedAt: data.generatedAt, source: data.source, fleaMarket: data.fleaMarket, traders, list, byId, matchLabel, search };
}
