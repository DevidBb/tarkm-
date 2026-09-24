// Map markers (HTML labels via CSS2DRenderer): map data markers, quest objective points,
// the YOU ARE HERE marker, AI candidate rings and the straight line to the selected marker.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { CSS2DObject } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/renderers/CSS2DRenderer.js/+esm';
import { GLYPHS, MARKER_TYPES, displayName } from '../services/markerTypes.js';
import { sameBand, distanceBetween, formatMeters } from '../services/coords.js';
import { buildRoute } from './route.js';
import { formatDuration } from './nav/maneuvers.js';

const PLAYER_COLOR = 0x3d9bff;
const CANDIDATE_COLOR = 0xe5a13a;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
    if (o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element);
  });
  if (obj.parent) obj.parent.remove(obj);
}

export class MarkerLayer {
  constructor(scene, mapData, { onSelect, onRoute }) {
    this.mapData = mapData;
    this.onSelect = onSelect;
    this.onRoute = onRoute;
    this.navigator = null;
    this.resolution = new THREE.Vector2(1, 1);
    this.routeMaterials = [];
    this.routeFlow = null;
    this.routeKey = null;
    this.group = new THREE.Group();
    this.items = new Map();
    this.questIds = new Set();
    this.visibility = null;
    this.selectedId = null;
    this.playerResult = null;
    this.playerGroup = null;
    this.candidateGroup = null;
    this.routeGroup = null;
    this.routeBuilt = null;
    this.routeStart = null; // { position, floor, label } - a start other than the player
    this.routeTarget = null; // { id, type: 'pin', position, floor, name } - a target point picked on the map
    this.activeStep = -1;
    this.pinGroup = null;
    scene.add(this.group);
    for (const entity of mapData.entities) this.createMarker(entity);
  }

  // Scene-space anchor of an entity. Places from map labels have no height: they float above roofs.
  anchorOf(entity) {
    const { projection } = this.mapData;
    const s = projection.gameToScene(entity.position);
    let y;
    const ground = projection.heightAt ? projection.heightAt(s.x, s.z) : projection.groundY; // relief maps: ground under the label
    if (entity.position.y != null) y = s.y + 1.5;
    else if (entity.type === 'street') y = ground + 1;
    else y = ground + 8;
    return new THREE.Vector3(s.x, y + this.levelOffset(entity.floor), s.z);
  }

  playerAnchor(result) {
    const { projection } = this.mapData;
    const s = projection.gameToScene(result.position);
    const y = result.position.y != null ? s.y : result.floor ? projection.floorPlaneY(result.floor) : projection.groundY;
    return new THREE.Vector3(s.x, y + this.levelOffset(result.floor), s.z);
  }

  // Multi-level maps: markers of hidden levels are not shown, and in "All floors" each level is lifted by its offset.
  levelOffset(floorId) {
    return this.levelView && floorId ? this.levelView.offsetFor(floorId) : 0;
  }

  setLevelView(view) {
    this.levelView = view;
    for (const item of this.items.values()) item.object.position.copy(this.anchorOf(item.entity));
    if (this.visibility) this.applyVisibility(this.visibility);
    this.setPlayer(this.playerArg);
    this.drawPins();
  }

  createMarker(entity) {
    const type = MARKER_TYPES[entity.type];
    const meta = entity.meta || {};
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `mk mk--${entity.type}`;
    el.style.setProperty('--mk', meta.color || type.color);
    const label = meta.label || displayName(entity);
    el.title = `${type.single}: ${label}`;
    if (entity.type === 'street') {
      el.innerHTML = `<span class="mk__street">${escapeHtml(entity.name)}</span>`;
    } else {
      const badge = meta.badge ? `<span class="mk__badge">${escapeHtml(meta.badge)}</span>` : '';
      el.innerHTML = `<span class="mk__glyph">${GLYPHS[type.glyph]}</span>${badge}<span class="mk__label">${escapeHtml(label)}</span>`;
    }
    el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.onSelect(entity.id);
    });
    const object = new CSS2DObject(el);
    object.position.copy(this.anchorOf(entity));
    this.group.add(object);
    const item = { entity, object, el };
    this.items.set(entity.id, item);
    return item;
  }

  removeMarker(id) {
    const item = this.items.get(id);
    if (!item) return;
    this.group.remove(item.object);
    item.el.remove();
    this.items.delete(id);
  }

  // Quest objective points: rebuilt whenever the selected quest, active quests or progress change.
  setQuestPoints(entities) {
    for (const id of this.questIds) this.removeMarker(id);
    this.questIds.clear();
    for (const entity of entities) {
      const { el } = this.createMarker(entity);
      const meta = entity.meta || {};
      el.classList.toggle('is-done', Boolean(meta.done));
      el.classList.toggle('is-bg', Boolean(meta.background));
      el.classList.toggle('is-focus', Boolean(meta.focus));
      this.questIds.add(entity.id);
    }
    if (this.visibility) this.applyVisibility(this.visibility);
    const selected = this.items.get(this.selectedId);
    if (selected) selected.el.classList.add('is-selected');
    this.updateRoute();
  }

  applyVisibility(state) {
    this.visibility = state;
    const { floor, filters } = state;
    const { floors } = this.mapData;
    const lv = this.levelView;
    for (const { entity, object, el } of this.items.values()) {
      const onFloor = entity.floor == null || (lv ? lv.visible.has(entity.floor) : sameBand(floors, entity.floor, floor));
      let visible = filters[entity.type] !== false && (onFloor || (!lv && !filters.onlyCurrentFloor));
      if (entity.meta && entity.meta.background && filters.quests === false) visible = false;
      if (entity.id === this.tempId) visible = true;
      object.visible = visible;
      el.classList.toggle('is-offfloor', !onFloor);
    }
  }

  // Entities without a permanent HTML marker (loot points) get a temporary one while selected.
  setSelected(id) {
    const prev = this.items.get(this.selectedId);
    if (prev) prev.el.classList.remove('is-selected');
    if (this.tempId && this.tempId !== id) {
      this.removeMarker(this.tempId);
      this.tempId = null;
    }
    this.selectedId = id;
    if (id && !this.items.has(id)) {
      const entity = this.mapData.byId.get(id);
      if (entity) {
        this.createMarker(entity);
        this.tempId = id;
        if (this.visibility) this.applyVisibility(this.visibility);
      }
    }
    const next = this.items.get(id);
    if (next) next.el.classList.add('is-selected');
    this.updateRoute();
  }

  anchorById(id) {
    const item = this.items.get(id);
    const entity = item ? item.entity : this.mapData.byId.get(id);
    return entity ? this.anchorOf(entity) : null;
  }

  setPlayer(result) {
    this.playerArg = result;
    if (this.playerGroup) disposeObject(this.playerGroup);
    this.playerGroup = null;
    this.playerResult = result && result.status === 'found' ? result : null;
    if (this.playerResult) {
      const r = this.playerResult;
      const group = new THREE.Group();
      group.position.copy(this.playerAnchor(r));

      const el = document.createElement('div');
      el.className = `you${r.approximate ? ' you--approx' : ''}`;
      el.innerHTML = `<span class="you__pulse"></span><span class="you__dot"></span><span class="you__label">${r.approximate ? '≈ ' : ''}YOU ARE HERE</span>`;
      const label = new CSS2DObject(el);
      label.position.set(0, 2, 0);
      group.add(label);

      const radius = r.approximate ? 35 : 5;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * (r.approximate ? 0.94 : 0.7), radius, 72),
        new THREE.MeshBasicMaterial({ color: PLAYER_COLOR, transparent: true, opacity: r.approximate ? 0.5 : 0.9, side: THREE.DoubleSide, depthTest: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.4;
      ring.renderOrder = 40;
      group.add(ring);

      if (r.approximate) {
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(radius, 72),
          new THREE.MeshBasicMaterial({ color: PLAYER_COLOR, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthTest: false }),
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.3;
        disc.renderOrder = 39;
        group.add(disc);
      }

      if (r.forward) {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(-10, 30);
        shape.lineTo(10, 30);
        shape.closePath();
        const wedgeGeo = new THREE.ShapeGeometry(shape);
        wedgeGeo.rotateX(Math.PI / 2); // points +Z
        const wedge = new THREE.Mesh(
          wedgeGeo,
          new THREE.MeshBasicMaterial({ color: PLAYER_COLOR, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthTest: false }),
        );
        wedge.rotation.y = Math.atan2(-r.forward.x, r.forward.z); // game forward -> scene (mirrored X)
        wedge.position.y = 0.5;
        wedge.renderOrder = 41;
        group.add(wedge);
      }

      this.group.add(group);
      this.playerGroup = group;
    }
    this.updateRoute();
  }

  setCandidates(candidates) {
    if (this.candidateGroup) disposeObject(this.candidateGroup);
    this.candidateGroup = null;
    if (!candidates || !candidates.length) return;
    const group = new THREE.Group();
    for (const c of candidates) {
      const anchor = this.anchorOf(c.place);
      const groundY = c.place.position.y != null ? anchor.y - 1.5 : this.mapData.projection.groundY;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(26, 30, 64),
        new THREE.MeshBasicMaterial({ color: CANDIDATE_COLOR, transparent: true, opacity: 0.25 + c.confidence * 0.6, side: THREE.DoubleSide, depthTest: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(anchor.x, groundY + 0.4, anchor.z);
      ring.renderOrder = 35;
      group.add(ring);

      const el = document.createElement('div');
      el.className = 'cand';
      el.textContent = `${Math.round(c.confidence * 100)}% · ${displayName(c.place)}`;
      const label = new CSS2DObject(el);
      label.position.set(anchor.x, groundY + 12, anchor.z);
      group.add(label);
    }
    this.group.add(group);
    this.candidateGroup = group;
  }

  setNavigator(navigator) {
    this.navigator = navigator;
    this.routeKey = null;
    this.updateRoute();
  }

  setResolution(width, height) {
    this.resolution.set(width, height);
    for (const m of this.routeMaterials) m.resolution.set(width, height);
  }

  update(dt, camera) {
    if (this.routeFlow) this.routeFlow.dashOffset -= dt * 9;
    if (this.routeBuilt && camera) this.routeBuilt.update(camera);
  }

  // Start of the route: the player (LOCATE ME) unless a start point is set.
  routeFrom() {
    if (this.routeStart) return { position: this.routeStart.position, floor: this.routeStart.floor, anchor: this.pointAnchor(this.routeStart), label: this.routeStart.label };
    if (this.playerResult) return { position: this.playerResult.position, floor: this.playerResult.floor, anchor: this.playerAnchor(this.playerResult).add(new THREE.Vector3(0, 1, 0)), label: 'Вы' };
    return null;
  }

  routeTo() {
    if (this.routeTarget) return { entity: this.routeTarget, anchor: this.pointAnchor(this.routeTarget) };
    const item = this.items.get(this.selectedId);
    return item ? { entity: item.entity, anchor: this.anchorOf(item.entity) } : null;
  }

  // Scene anchor of a point picked on the map (its y is the picked scene height, or the ground).
  pointAnchor(p) {
    const { projection } = this.mapData;
    const s = { x: -p.position.x, z: p.position.z };
    let y = p.sceneY;
    if (y == null) y = p.position.y != null ? p.position.y : projection.heightAt ? projection.heightAt(s.x, s.z) : projection.groundY;
    return new THREE.Vector3(s.x, y + 0.6 + this.levelOffset(p.floor), s.z);
  }

  setRouteEnds({ start, target }) {
    this.routeStart = start || null;
    this.routeTarget = target || null;
    this.drawPins();
    this.updateRoute();
  }

  drawPins() {
    if (this.pinGroup) disposeObject(this.pinGroup);
    this.pinGroup = null;
    const pins = [];
    if (this.routeStart) pins.push({ p: this.routeStart, kind: 'start', text: this.routeStart.label || 'Старт' });
    if (this.routeTarget) pins.push({ p: this.routeTarget, kind: 'finish', text: this.routeTarget.name || 'Финиш' });
    if (!pins.length) return;
    const group = new THREE.Group();
    for (const { p, kind, text } of pins) {
      const el = document.createElement('div');
      el.className = `navpin navpin--${kind}`;
      el.innerHTML = `<span class="navpin__head"><i>${kind === 'start' ? 'A' : 'B'}</i></span><span class="navpin__label">${escapeHtml(text)}</span>`;
      const obj = new CSS2DObject(el);
      obj.position.copy(this.pointAnchor(p));
      group.add(obj);
    }
    this.group.add(group);
    this.pinGroup = group;
  }

  setActiveStep(k) {
    this.activeStep = k;
    if (!this.routeBuilt) return;
    for (const l of this.routeBuilt.labels) l.el.classList.toggle('is-active', l.step === k);
  }

  setSafeMode(safe) {
    if (this.navigator) this.navigator.setSafeMode(safe);
    this.routeKey = null;
    this.updateRoute();
  }

  emitRoute(info) {
    const steps = info && info.steps ? info.steps.map((s) => s.text).join('/') : '';
    const key = info ? `${info.targetId}|${info.fromLabel}|${Math.round(info.length || 0)}|${Math.round(info.straight)}|${info.outside}|${info.safe}|${steps}` : 'none';
    if (key === this.routeKey) return;
    this.routeKey = key;
    if (this.onRoute) this.onRoute(info);
  }

  // Walking route along roads, yards and through buildings when the navigator is ready; a straight line otherwise.
  updateRoute() {
    if (this.routeGroup) disposeObject(this.routeGroup);
    if (this.routeBuilt) this.routeBuilt.dispose();
    this.routeGroup = null;
    this.routeBuilt = null;
    this.routeMaterials = [];
    this.routeFlow = null;
    const start = this.routeFrom();
    const target = this.routeTo();
    if (!start || !target) {
      this.emitRoute(null);
      return;
    }
    const from = start.anchor;
    const to = target.anchor;
    const entity = target.entity;
    const targetName = entity.type === 'pin' ? entity.name : displayName(entity);
    const group = new THREE.Group();
    const nav = this.navigator
      ? this.navigator.route(start.position, entity.position, { fromFloor: start.floor, toFloor: entity.floor, targetName })
      : null;
    const el = document.createElement('div');
    el.className = 'route-label';
    let labelAt;
    const base = { targetId: entity.id, targetName, fromLabel: start.label, safe: Boolean(this.navigator && this.navigator.safe) };

    if (nav && nav.points.length >= 2) {
      const built = buildRoute({ route: nav, y: this.mapData.projection.groundY + 0.4, from, to, resolution: this.resolution, activeStep: this.activeStep });
      group.add(built.group);
      this.routeBuilt = built;
      this.routeMaterials = built.materials;
      this.routeFlow = built.flow;
      const outside = nav.reached && nav.endGap <= 2.5;
      el.innerHTML = `<b>${formatMeters(nav.length)}</b><span>${formatDuration(nav.eta.sprint)} бегом</span>`;
      labelAt = built.mid.add(new THREE.Vector3(0, 4, 0));
      // Entrances, stairs and fence gaps along the route.
      for (const wp of nav.waypoints || []) {
        const chip = document.createElement('div');
        chip.className = `route-wp route-wp--${wp.kind}`;
        chip.textContent = wp.label;
        const obj = new CSS2DObject(chip);
        obj.position.set(wp.x, wp.y + 2.5, wp.z);
        group.add(obj);
      }
      this.emitRoute({
        ...base, length: nav.length, straight: nav.straight, endGap: nav.endGap, outside, steps: nav.steps, maneuvers: nav.maneuvers,
        eta: nav.eta, fromFloor: nav.fromFloor, toFloor: nav.toFloor, reached: nav.reached,
      });
    } else {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([from, to]),
        new THREE.LineDashedMaterial({ color: PLAYER_COLOR, dashSize: 7, gapSize: 5, transparent: true, opacity: 0.95, depthTest: false }),
      );
      line.computeLineDistances();
      line.renderOrder = 45;
      group.add(line);
      const { meters, is3d } = distanceBetween(start.position, entity.position);
      el.innerHTML = `<b>${formatMeters(meters)}</b><span>по прямой${is3d ? '' : ' (без высоты)'}</span>`;
      labelAt = from.clone().lerp(to, 0.5);
      this.emitRoute({ ...base, length: null, straight: meters, endGap: null, outside: false, unreachable: Boolean(this.navigator) });
    }

    const label = new CSS2DObject(el);
    label.position.copy(labelAt);
    group.add(label);
    this.group.add(group);
    this.routeGroup = group;
  }
}
