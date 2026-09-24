// Reads geometry out of Shebuka's Interchange SVG (the same map tarkov.dev shows) in scene meters:
// filled polygons with holes (floors, garage, footprints), stroked lines with their drawn width (roads, fences,
// rails, power lines) and the up/down gradient of ramps, stairs and escalators.

import { SVGLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/SVGLoader.js/+esm';
import { orient, simplifyRing, signedArea } from '../city/util.js';

const STROKE_UNITS = { road_small: 5, road_medium: 8, road_large: 12, railroad: 3, powerline: 2, fence: 1 };
const XLINK = 'http://www.w3.org/1999/xlink';

export function createSvgReader(svgDoc, projection) {
  const loader = new SVGLoader();
  const ser = new XMLSerializer();
  // projection.svgToScene exists only for maps drawn rotated by 90 degrees (Factory).
  const unit = projection.svgToScene ? projection.svgUnit : (projection.svgScaleX + projection.svgScaleZ) / 2;
  const toScene = projection.svgToScene || ((v) => ({ x: projection.sceneLeft + v.x * projection.svgScaleX, z: projection.sceneTop + v.y * projection.svgScaleZ }));
  const toSvg = projection.sceneToSvg || ((p) => ({ x: (p.x - projection.sceneLeft) / projection.svgScaleX, y: (p.z - projection.sceneTop) / projection.svgScaleZ }));
  const group = (id) => svgDoc.querySelector(`[id="${id}"]`);
  // Drawn shapes under an id: the element itself when it is a shape, otherwise every shape in its subgroups.
  const SHAPES = new Set(['path', 'polygon', 'polyline', 'rect', 'line', 'circle', 'ellipse']);
  const leaves = (id) => {
    const g = group(id);
    if (!g) return [];
    if (SHAPES.has(g.localName)) return [g];
    return [...g.querySelectorAll('*')].filter((el) => SHAPES.has(el.localName) && !el.closest('defs, clipPath, mask'));
  };
  const pathsOf = (el) => loader.parse(`<svg xmlns="http://www.w3.org/2000/svg">${ser.serializeToString(el)}</svg>`).paths;

  function polygons(id, { minArea = 0.25, minEdge = 0.1 } = {}) {
    const out = [];
    for (const el of leaves(id)) {
      for (const path of pathsOf(el)) {
        for (const shape of SVGLoader.createShapes(path)) {
          const outer = orient(simplifyRing(shape.getPoints(3).map(toScene), minEdge, 1), true);
          if (outer.length < 3 || Math.abs(signedArea(outer)) < minArea) continue;
          const holes = shape.holes
            .map((h) => orient(simplifyRing(h.getPoints(3).map(toScene), minEdge, 1), false))
            .filter((h) => h.length >= 3 && Math.abs(signedArea(h)) >= 0.05);
          out.push({ outer, holes });
        }
      }
    }
    return out;
  }

  function strokeWidth(el) {
    for (let n = el; n && n.getAttribute; n = n.parentElement) {
      for (const cls of (n.getAttribute('class') || '').split(/\s+/)) if (STROKE_UNITS[cls]) return STROKE_UNITS[cls] * unit;
      const sw = n.getAttribute('stroke-width');
      if (sw) return Number(sw) * unit;
    }
    return 2 * unit;
  }

  // Ramp direction: "rampUp" leads up from this layer (bright end = top), "rampDown" leads down (dark end = bottom).
  function gradientOf(el) {
    const style = `${el.getAttribute('style') || ''} ${el.getAttribute('stroke') || ''} ${el.getAttribute('fill') || ''}`;
    const m = style.match(/url\(#([^)]+)\)/);
    if (!m) return null;
    const lg = svgDoc.getElementById(m[1]);
    if (!lg) return null;
    const href = lg.getAttributeNS(XLINK, 'href') || lg.getAttribute('href') || lg.getAttribute('xlink:href') || `#${m[1]}`;
    const kind = href.replace('#', '');
    const num = (name) => Number(lg.getAttribute(name));
    const p1 = toScene({ x: num('x1'), y: num('y1') });
    const p2 = toScene({ x: num('x2'), y: num('y2') });
    const up = kind.startsWith('rampUp');
    const l2r = kind.endsWith('l2r');
    let top;
    if (up) top = l2r ? p2 : p1;
    else top = l2r ? p1 : p2;
    return { kind, up, top };
  }

  function strokes(id) {
    return leaves(id)
      .map((el) => ({
        el,
        lines: pathsOf(el).flatMap((p) => p.subPaths.map((sp) => sp.getPoints(2).map(toScene))).filter((l) => l.length >= 2),
        width: strokeWidth(el),
        gradient: gradientOf(el),
      }))
      .filter((s) => s.lines.length);
  }

  return { svgDoc, unit, toScene, toSvg, group, polygons, strokes };
}
