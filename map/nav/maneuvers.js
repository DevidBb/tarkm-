// Turn-by-turn description of a walking route, the way a car navigator reads one out: a start, turns with their
// angle class (keep left, turn right, sharp, U-turn), entrances, stairs, fence gaps and the arrival, each with the
// distance to the next one, the kind of ground in between (road, forest, open ground, inside) and a landmark
// nearby. Directions are left / right as seen on the map from above, which is also left / right in the game.

import { formatMeters } from '../../services/coords.js';

const RAD = Math.PI / 180;
const TURN_MIN = 28 * RAD; // smaller bends are "keep going"
const MERGE = 9; // m: bends closer than this add up into one manoeuvre
const LANDMARK_R = 45; // m

// Movement speeds for the time estimate (m/s): sprint with the pauses stamina forces, and plain walking.
export const SPEED = { sprint: 4.6, walk: 2.4, indoorSprint: 3.4, stairs: 5 /* s per storey */ };

const len2 = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

function simplify(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1;
    let bestD = tol;
    const A = pts[a];
    const B = pts[b];
    const dx = B.x - A.x;
    const dz = B.z - A.z;
    const l2 = dx * dx + dz * dz;
    for (let i = a + 1; i < b; i += 1) {
      const P = pts[i];
      let t = l2 ? ((P.x - A.x) * dx + (P.z - A.z) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(P.x - A.x - t * dx, P.z - A.z - t * dz);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Direction of travel around vertex i, looking up to `reach` meters back / ahead (robust to tiny zigzags).
function headingAt(pts, i, forward, reach = 6) {
  const p = pts[i];
  let j = i;
  let d = 0;
  while (d < reach) {
    const k = forward ? j + 1 : j - 1;
    if (k < 0 || k >= pts.length) break;
    d += len2(pts[j], pts[k]);
    j = k;
  }
  if (j === i) return null;
  const q = pts[j];
  return forward ? Math.atan2(q.z - p.z, q.x - p.x) : Math.atan2(p.z - q.z, p.x - q.x);
}

const norm = (a) => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
};

// Scene x right, z down (the map seen from above): a positive change of atan2(z, x) is a clockwise turn = right.
export function turnClass(delta) {
  const a = Math.abs(delta);
  const side = delta > 0 ? 'right' : 'left';
  if (a < TURN_MIN) return 'straight';
  if (a < 60 * RAD) return `slight-${side}`;
  if (a < 140 * RAD) return side;
  if (a < 165 * RAD) return `sharp-${side}`;
  return 'uturn';
}

const TURN_TEXT = {
  'slight-left': 'Держитесь левее',
  'slight-right': 'Держитесь правее',
  left: 'Поверните налево',
  right: 'Поверните направо',
  'sharp-left': 'Резко поверните налево',
  'sharp-right': 'Резко поверните направо',
  uturn: 'Развернитесь',
};

export const TURN_ICON = {
  start: 'start', straight: 'straight', 'slight-left': 'slight-left', 'slight-right': 'slight-right', left: 'left', right: 'right',
  'sharp-left': 'sharp-left', 'sharp-right': 'sharp-right', uturn: 'uturn',
};

const SURFACE_TEXT = {
  road: 'по дороге',
  path: 'по тропе',
  forest: 'через лес',
  open: 'по открытой местности',
  indoor: 'внутри здания',
  floor: 'по этажу',
  street: 'по улице и дворам',
};

// Turns inside one run of points (a leg or several legs of one layer). Returns [{ index, delta }].
function bends(pts) {
  const out = [];
  let acc = null;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const hin = headingAt(pts, i, false);
    const hout = headingAt(pts, i, true);
    if (hin == null || hout == null) continue;
    const delta = norm(hout - hin);
    if (Math.abs(delta) < 8 * RAD) continue;
    if (acc && len2(pts[acc.last], pts[i]) <= MERGE && Math.sign(delta) === Math.sign(acc.delta)) {
      acc.delta = norm(acc.delta + delta * 0.6);
      acc.last = i;
      if (Math.abs(delta) > Math.abs(acc.peak)) { acc.peak = delta; acc.index = i; }
    } else {
      if (acc) out.push(acc);
      acc = { index: i, last: i, delta, peak: delta };
    }
  }
  if (acc) out.push(acc);
  return out
    .map((b) => {
      // Total bend: heading well before the first vertex -> well after the last one.
      const hin = headingAt(pts, b.index, false, 10);
      const hout = headingAt(pts, b.last, true, 10);
      const delta = hin != null && hout != null ? norm(hout - hin) : b.delta;
      return { index: b.index, delta };
    })
    .filter((b) => Math.abs(b.delta) >= TURN_MIN);
}

function cumulative(pts) {
  const d = [0];
  for (let i = 1; i < pts.length; i += 1) d.push(d[i - 1] + len2(pts[i - 1], pts[i]));
  return d;
}

// ctx: {
//   legs: [{ layer: { rank, street }, inside, points: [{x,y,z}], floorName, hazard, assumed, locks: [] }],
//   surfaceOf(leg, pts) -> 'road' | 'path' | 'forest' | 'open' | 'indoor' | 'floor' | 'street',
//   streetName(pts) -> string | null, landmark(point) -> string | null,
//   startGap, endGap, reached, targetName, targetFloor, fenceCrossings: [{x,y,z}]
// }
export function describeRoute(ctx) {
  const { legs } = ctx;
  const maneuvers = [];
  const waypoints = [];
  let dist = 0;
  let sprint = 0;
  let walk = 0;

  const push = (m) => {
    maneuvers.push({ meters: 0, ...m, dist });
    return maneuvers[maneuvers.length - 1];
  };
  const stretchText = (m, surface, name) => {
    if (m < 1) return '';
    const where = name ? `по ${name}` : SURFACE_TEXT[surface] || '';
    return `${formatMeters(m)} ${where}`.trim();
  };

  // Runs: consecutive legs on one layer and one side of the walls describe one stretch of walking.
  if (ctx.startGap > 2.5) {
    push({ kind: 'gap', dir: null, at: legs[0].points[0], text: `Сначала ${formatMeters(ctx.startGap)} до начала маршрута`, note: 'Отсюда прохода на плане карты нет: возможно, запертая дверь или помещение, которого нет на плане.' });
  }

  legs.forEach((leg, k) => {
    const prev = legs[k - 1];
    const pts = simplify(leg.points, leg.inside ? 0.6 : 1.4);
    const at = pts[0];
    // Transition into this leg.
    if (!prev) {
      push({ kind: 'start', dir: 'start', at, heading: headingAt(pts, 0, true, 8), text: 'Старт' });
    } else if (prev.layer !== leg.layer) {
      const up = leg.layer.rank > prev.layer.rank;
      const storeys = Math.abs(leg.layer.rank - prev.layer.rank);
      const last = maneuvers[maneuvers.length - 1];
      const text = `${up ? 'Поднимитесь' : 'Спуститесь'} по лестнице: ${leg.floorName}`;
      sprint += SPEED.stairs * storeys;
      walk += SPEED.stairs * 1.6 * storeys;
      if (last && last.kind === (up ? 'up' : 'down') && len2(last.at, at) < 6) {
        last.storeys += storeys;
        last.text = `${up ? 'Поднимитесь' : 'Спуститесь'} на ${last.storeys} ${last.storeys < 5 ? 'этажа' : 'этажей'}: ${leg.floorName}`;
        waypoints[waypoints.length - 1].label = `${up ? '↑' : '↓'} ${leg.floorName}`;
      } else {
        push({ kind: up ? 'up' : 'down', dir: up ? 'up' : 'down', at, text, storeys });
        waypoints.push({ kind: up ? 'up' : 'down', x: at.x, y: at.y, z: at.z, label: `${up ? '↑' : '↓'} ${leg.floorName}` });
      }
    } else if (prev.inside !== leg.inside && leg.layer.street) {
      const guessed = leg.inside ? leg.assumedEntry : prev.assumedExit;
      const notes = [];
      if (guessed) notes.push('Дверь на плане не нарисована: показан ближайший проход, настоящий вход где-то у этой стены.');
      if (leg.inside && leg.entryLocks && leg.entryLocks.length) notes.push(`Рядом дверь под ключ: ${leg.entryLocks.join(', ')}`);
      const label = leg.inside ? 'Вход' : 'Выход';
      push({ kind: leg.inside ? 'enter' : 'exit', dir: leg.inside ? 'enter' : 'exit', at, text: leg.inside ? 'Войдите в здание' : 'Выйдите наружу', note: notes.join(' ') || null });
      waypoints.push({ kind: leg.inside ? 'enter' : 'exit', x: at.x, y: at.y, z: at.z, label: guessed ? `≈ ${label}` : label });
    }

    // Turns along the leg; each stretch between manoeuvres gets its surface.
    const cum = cumulative(pts);
    const turns = pts.length > 2 ? bends(pts) : [];
    const cuts = [0, ...turns.map((t) => t.index), pts.length - 1];
    for (let s = 0; s < cuts.length - 1; s += 1) {
      const a = cuts[s];
      const b = cuts[s + 1];
      const piece = pts.slice(a, b + 1);
      const meters = cum[b] - cum[a];
      const surface = ctx.surfaceOf(leg, piece);
      const name = !leg.inside && leg.layer.street && ctx.streetName ? ctx.streetName(piece) : null;
      const current = maneuvers[maneuvers.length - 1];
      if (s > 0) {
        const t = turns[s - 1];
        const dir = turnClass(t.delta);
        const p = pts[a];
        const lm = ctx.landmark ? ctx.landmark(p) : null;
        push({ kind: 'turn', dir, at: p, heading: headingAt(pts, a, true, 8), text: TURN_TEXT[dir] || 'Двигайтесь прямо', landmark: lm });
      }
      const m = maneuvers[maneuvers.length - 1];
      // The stretch after a manoeuvre: surface + meters (summed when the same manoeuvre continues across legs).
      m.meters += meters;
      if (!m.surface || m === current) m.surface = m.surface && m.surface !== surface && meters > 20 ? 'mixed' : m.surface || surface;
      m.name = m.name || name;
      dist += meters;
      const fast = leg.inside ? SPEED.indoorSprint : SPEED.sprint;
      sprint += meters / fast;
      walk += meters / SPEED.walk;
    }
    const notes = [];
    if (leg.assumed) notes.push(leg.inside ? 'Часть прохода внутри не нарисована на плане: показана приблизительно.' : 'Забор здесь нарисован сплошным: показан ближайший проход, настоящий проём где-то рядом.');
    if (leg.locks && leg.locks.length) notes.push(`По пути дверь под ключ: ${leg.locks.join(', ')}`);
    if (leg.hazard) notes.push('Часть пути проходит через опасную зону (снайпер).');
    if (notes.length) {
      const m = maneuvers[maneuvers.length - 1];
      m.note = [m.note, ...notes].filter(Boolean).join(' ');
      if (leg.hazard) m.hazard = true;
    }
  });

  for (const f of ctx.fenceCrossings || []) waypoints.push({ kind: 'fence', x: f.x, y: f.y, z: f.z, label: '≈ Проход в заборе' });

  const endPoint = legs[legs.length - 1].points[legs[legs.length - 1].points.length - 1];
  if (ctx.reached && ctx.endGap <= 2.5) {
    push({ kind: 'arrive', dir: 'arrive', at: endPoint, text: ctx.targetName ? `Вы у цели: ${ctx.targetName}` : 'Вы у цели' });
  } else {
    push({
      kind: 'gap',
      dir: 'arrive',
      at: endPoint,
      text: `Дальше ${formatMeters(ctx.endGap)} до цели: прохода на плане нет`,
      note: ctx.reached
        ? 'Возможно, запертая дверь, окно или место, которого нет на плане этажа.'
        : `Цель на уровне «${ctx.targetFloor}», но лестницы туда на плане не найдено.`,
    });
  }

  // Clean-up like a navigator's: a bend a few meters before or after an entrance, a staircase or the arrival is
  // part of that manoeuvre, not a step of its own; consecutive stairs read as one ("down 2 storeys").
  const TRANSITIONS = ['start', 'enter', 'exit', 'up', 'down', 'gap', 'arrive'];
  for (let k = maneuvers.length - 1; k >= 1; k -= 1) {
    const m = maneuvers[k];
    if (m.kind !== 'turn') continue;
    const prev = maneuvers[k - 1];
    const next = maneuvers[k + 1];
    if (TRANSITIONS.includes(prev.kind) && prev.meters < 6) {
      prev.meters += m.meters;
      prev.surface = m.surface || prev.surface;
      prev.name = prev.name || m.name;
      prev.note = [prev.note, m.note].filter(Boolean).join(' ') || null;
      maneuvers.splice(k, 1);
    } else if (next && TRANSITIONS.includes(next.kind) && m.meters < 3) {
      prev.meters += m.meters;
      prev.note = [prev.note, m.note].filter(Boolean).join(' ') || null;
      maneuvers.splice(k, 1);
    }
  }

  // A slight jog (keep left, then keep right a few meters later) is one straight line to a walker; a slight bend
  // just before the arrival is not worth a step either.
  const slight = (m) => m && m.kind === 'turn' && m.dir && m.dir.startsWith('slight-');
  for (let k = maneuvers.length - 2; k >= 1; k -= 1) {
    const m = maneuvers[k];
    const next = maneuvers[k + 1];
    const prev = maneuvers[k - 1];
    if (!slight(m)) continue;
    if (slight(next) && next.dir !== m.dir && m.meters < 15) {
      prev.meters += m.meters + next.meters;
      prev.note = [prev.note, m.note, next.note].filter(Boolean).join(' ') || null;
      maneuvers.splice(k, 2);
      k -= 1;
    } else if (next.kind === 'arrive' && m.meters < 15) {
      prev.meters += m.meters;
      prev.note = [prev.note, m.note].filter(Boolean).join(' ') || null;
      maneuvers.splice(k, 1);
    }
  }

  // Readable "after" text for every manoeuvre.
  for (const m of maneuvers) {
    if (m.meters >= 1) m.after = stretchText(m.meters, m.surface === 'mixed' ? null : m.surface, m.name);
    if (m.kind === 'start') m.text = 'Начните движение';
    if (m.landmark) m.text = `${m.text} у «${m.landmark}»`;
  }
  // Old step list shape (kind / text / note) for the cards that show all steps.
  const steps = maneuvers.map((m) => ({
    kind: m.kind === 'turn' ? 'walk' : m.kind === 'start' ? 'walk' : m.kind,
    dir: m.dir,
    text: m.after && m.kind !== 'arrive' && m.kind !== 'gap' ? `${m.text} · ${m.after}` : m.text,
    meters: m.meters,
    note: m.note || null,
    hazard: Boolean(m.hazard),
  }));
  return { maneuvers, waypoints, steps, eta: { sprint: Math.round(sprint), walk: Math.round(walk) } };
}

export function formatDuration(sec) {
  if (sec < 60) return `${Math.max(5, Math.round(sec / 5) * 5)} с`;
  const m = Math.floor(sec / 60);
  const s = Math.round((sec - m * 60) / 10) * 10;
  return s ? `${m} мин ${s} с` : `${m} мин`;
}
