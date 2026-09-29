// Route drawing, car-navigator style: a thick blue line with a dark casing (screen-space, readable at any zoom),
// a white flow animated toward the target, white chevrons along the way that keep their on-screen size, round
// manoeuvre points with the turn arrow, the start and the finish flag. Dashed connectors join the start marker and
// a target the path cannot reach (inside a building) to the line.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { Line2 } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/lines/Line2.js/+esm';
import { LineMaterial } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/lines/LineMaterial.js/+esm';
import { LineGeometry } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/lines/LineGeometry.js/+esm';
import { CSS2DObject } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/renderers/CSS2DRenderer.js/+esm';
import { MANEUVER_ICONS } from '../services/markerTypes.js';

const ROUTE_BLUE = 0x3d9bff;
const ROUTE_CASING = 0x06213f;
const CHEVRON_STEP = 14; // m between chevrons at close zoom

function material(resolution, options) {
  const m = new LineMaterial({ worldUnits: false, depthTest: false, depthWrite: false, transparent: true, ...options });
  m.resolution.copy(resolution);
  return m;
}

function line(points, mat, order) {
  const geometry = new LineGeometry();
  geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  const l = new Line2(geometry, mat);
  l.computeLineDistances();
  l.renderOrder = order;
  return l;
}

function pointAtHalf(path) {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += path[i].distanceTo(path[i - 1]);
  let left = total / 2;
  for (let i = 1; i < path.length; i += 1) {
    const d = path[i].distanceTo(path[i - 1]);
    if (d >= left) return path[i - 1].clone().lerp(path[i], d ? left / d : 0);
    left -= d;
  }
  return path[path.length - 1].clone();
}

// Positions along the path every `step` meters with the travel direction (horizontal).
function along(path, step, offset = step / 2) {
  const out = [];
  let carry = offset;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    let s = carry;
    while (s <= len) {
      const t = s / len;
      out.push({ x: a.x + dx * t, y: a.y + (b.y - a.y) * t, z: a.z + dz * t, dir: Math.atan2(dx, dz) });
      s += step;
    }
    carry = s - len;
  }
  return out;
}

// A flat "^" chevron lying on the ground, pointing +Z, about 1 unit long.
function chevronGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.55);
  s.lineTo(0.55, -0.05);
  s.lineTo(0.55, -0.45);
  s.lineTo(0, 0.12);
  s.lineTo(-0.55, -0.45);
  s.lineTo(-0.55, -0.05);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2); // shape +Y -> scene -Z
  g.scale(1, 1, -1); // -> +Z
  return g;
}

// route: { points, maneuvers }; from / to: start and target anchors; activeStep: highlighted manoeuvre.
export function buildRoute({ route, y, from, to, resolution, activeStep = -1 }) {
  const group = new THREE.Group();
  const path = route.points.map((p) => new THREE.Vector3(p.x, p.y != null ? p.y : y, p.z));
  const casing = material(resolution, { color: ROUTE_CASING, linewidth: 11, opacity: 0.85 });
  const core = material(resolution, { color: ROUTE_BLUE, linewidth: 6.5 });
  const flow = material(resolution, { color: 0xffffff, linewidth: 2, dashed: true, dashSize: 2.5, gapSize: 9, opacity: 0.85 });
  const connector = material(resolution, { color: ROUTE_BLUE, linewidth: 2.5, dashed: true, dashSize: 1.2, gapSize: 1.2 });
  group.add(line(path, casing, 44), line(path, core, 45), line(path, flow, 46));
  if (from.distanceTo(path[0]) > 0.8) group.add(line([from, path[0]], connector, 45));
  const end = path[path.length - 1];
  if (to.distanceTo(end) > 0.8) group.add(line([end, to], connector, 45));

  // Chevrons: one instanced mesh, re-scaled to a constant screen size every frame (see update()).
  const spots = along(path, CHEVRON_STEP);
  let chevrons = null;
  if (spots.length) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    chevrons = new THREE.InstancedMesh(chevronGeometry(), mat, spots.length);
    chevrons.renderOrder = 47;
    chevrons.frustumCulled = false;
    group.add(chevrons);
  }

  // Manoeuvre points (turns, entrances, stairs) with their arrows; start dot and finish flag.
  const labels = [];
  (route.maneuvers || []).forEach((m, k) => {
    if (!m.at) return;
    const el = document.createElement('div');
    const finish = m.kind === 'arrive' || (m.kind === 'gap' && m.dir === 'arrive');
    const kind = m.kind === 'start' ? 'start' : finish ? 'finish' : m.kind === 'gap' ? 'gap' : 'turn';
    el.className = `rman rman--${kind}${k === activeStep ? ' is-active' : ''}${m.hazard ? ' is-hazard' : ''}`;
    el.dataset.step = String(k);
    const icon = kind === 'start' ? MANEUVER_ICONS.start : finish ? MANEUVER_ICONS.arrive : MANEUVER_ICONS[m.dir] || MANEUVER_ICONS.straight;
    el.innerHTML = `<span class="rman__dot">${icon}</span>`;
    const obj = new CSS2DObject(el);
    obj.position.set(m.at.x, (m.at.y != null ? m.at.y : y) + 0.8, m.at.z);
    group.add(obj);
    labels.push({ el, obj, step: k });
  });

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eu = new THREE.Euler();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const update = (camera) => {
    if (!chevrons) return;
    // World size that keeps ~12 px on screen; far away only every 2nd / 4th chevron shows, keeping the rhythm.
    const k = (2 * Math.tan((camera.fov * Math.PI) / 360) * 12) / Math.max(300, resolution.y);
    const camD = camera.position.distanceTo(pos.set(spots[0].x, spots[0].y, spots[0].z));
    const skip = camD > 1000 ? 4 : camD > 480 ? 2 : 1;
    for (let i = 0; i < spots.length; i += 1) {
      const c = spots[i];
      pos.set(c.x, c.y + 0.15, c.z);
      const size = Math.max(0.8, camera.position.distanceTo(pos) * k);
      eu.set(0, c.dir, 0);
      q.setFromEuler(eu);
      sc.setScalar(i % skip === 0 ? size : 0.0001);
      m4.compose(pos, q, sc);
      chevrons.setMatrixAt(i, m4);
    }
    chevrons.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    materials: [casing, core, flow, connector],
    flow,
    mid: pointAtHalf(path),
    path,
    labels,
    update,
    dispose() {
      if (chevrons) {
        chevrons.geometry.dispose();
        chevrons.material.dispose();
      }
    },
  };
}
