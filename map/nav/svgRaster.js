// SVG plan -> walking rasters. Shebuka's maps (the ones tarkov.dev shows) are layered SVGs: every floor is a group
// (Ground_Level, First_Floor, ...) of role groups told apart by their CSS class (land, trees, water, rock, road_*,
// building, fence, floor, stairs, danger...). This module sorts those groups into walking roles, and draws them in
// flat colours with the map's own CSS (so stroke widths, fill rules and transforms render exactly as on tarkov.dev),
// only with every paint turned into `currentColor`. `<use>` references are inlined, so each role group is
// self-contained. Everything is drawn in scene meters: the SVG -> scene transform (also the rotated Factory one) is a
// single matrix around the map content.

import { SVGLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/SVGLoader.js/+esm';

export const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const SHAPES = new Set(['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'line']);
const DROP = new Set(['text', 'image', 'title', 'desc', 'metadata', 'script', 'style', 'defs', 'clipPath', 'mask', 'marker', 'linearGradient', 'radialGradient', 'pattern', 'filter', 'symbol']);
const PAINT_DECL = /(^|;|\s)(fill|stroke)\s*:\s*([^;]+)/g;

const classList = (el) => (el.getAttribute && el.getAttribute('class') ? el.getAttribute('class').split(/\s+/).filter(Boolean) : []);
const paintValue = (v) => (/^\s*none\s*(!important)?\s*$/i.test(v) ? 'none' : 'currentColor');

// "fill: #123; stroke: url(#g)" -> "fill: currentColor; stroke: currentColor" (none stays none)
function recolorDecls(text) {
  return text
    .replace(PAINT_DECL, (m, lead, prop, value) => `${lead}${prop}:${paintValue(value)}`)
    .replace(/(^|;|\s)(filter|opacity|fill-opacity|stroke-opacity|stroke-dasharray)\s*:[^;]+/g, '$1');
}

// The map's own <style> blocks with every colour replaced by currentColor.
export function mapCss(svgDoc) {
  return [...svgDoc.querySelectorAll('style')]
    .map((s) => s.textContent.replace(/\{([^}]*)\}/g, (m, body) => `{${recolorDecls(body)}}`))
    .join('\n');
}

function refOf(svgDoc, use) {
  const href = use.getAttributeNS(XLINK_NS, 'href') || use.getAttribute('href') || use.getAttribute('xlink:href');
  return href ? svgDoc.querySelector(`[id="${href.replace(/^#/, '')}"]`) : null;
}

// Deep copy with <use> inlined (as <g transform="use-transform translate(x y)">), labels dropped, paints recoloured.
// `mark(copy, original)` can tag copies (leaf indices for polygons).
export function cloneClean(svgDoc, el, mark = null, depth = 0) {
  if (DROP.has(el.localName)) return null;
  if (el.localName === 'use') {
    const ref = depth < 8 ? refOf(svgDoc, el) : null;
    if (!ref) return null;
    const g = svgDoc.createElementNS(SVG_NS, 'g');
    const t = [el.getAttribute('transform') || '', `translate(${Number(el.getAttribute('x')) || 0} ${Number(el.getAttribute('y')) || 0})`].join(' ').trim();
    g.setAttribute('transform', t);
    for (const c of classList(el)) g.classList.add(c);
    const inner = cloneClean(svgDoc, ref, mark, depth + 1);
    if (inner) g.appendChild(inner);
    if (mark) mark(g, el);
    return g;
  }
  const copy = svgDoc.createElementNS(SVG_NS, el.localName);
  for (const a of el.attributes) {
    const name = a.name;
    if (name === 'id' || name === 'filter' || name === 'opacity' || name === 'fill-opacity' || name === 'stroke-opacity' || name === 'stroke-dasharray' || name.startsWith('inkscape') || name.startsWith('sodipodi') || name === 'clip-path' || name === 'mask') continue;
    if (name === 'fill' || name === 'stroke') copy.setAttribute(name, paintValue(a.value));
    else if (name === 'style') copy.setAttribute('style', recolorDecls(a.value));
    else copy.setAttribute(name, a.value);
  }
  if (mark && SHAPES.has(el.localName)) mark(copy, el);
  for (const child of el.children) {
    const c = cloneClean(svgDoc, child, mark, depth);
    if (c) copy.appendChild(c);
  }
  return copy;
}

// Transform chain of the ancestors of `el` (outermost first), as one transform attribute value.
export function ancestorTransform(el) {
  const chain = [];
  for (let n = el.parentElement; n && n.localName !== 'svg'; n = n.parentElement) {
    const t = n.getAttribute('transform');
    if (t) chain.unshift(t);
  }
  return chain.join(' ');
}

// Classes the element inherits from its ancestors (CSS styles on groups apply to the shapes inside).
export function inheritedClasses(el) {
  const out = [];
  for (let n = el.parentElement; n && n.localName !== 'svg'; n = n.parentElement) out.push(...classList(n));
  return out;
}

// Markup of an element with its ancestor transforms, ready to sit inside the SVG -> scene group.
export function placedMarkup(svgDoc, el, ser, mark = null) {
  const copy = cloneClean(svgDoc, el, mark);
  if (!copy) return '';
  // Classes of ancestors carry the map CSS (stroke widths of road_small etc.): re-attach them on a wrapper.
  const cls = inheritedClasses(el);
  const t = ancestorTransform(el);
  const open = `<g${t ? ` transform="${t}"` : ''}${cls.length ? ` class="${cls.join(' ')}"` : ''}>`;
  return `${open}${ser.serializeToString(copy)}</g>`;
}

// SVG -> scene as an SVG matrix(a b c d e f): x' = a x + c y + e, z' = b x + d y + f.
export function sceneMatrix(projection) {
  if (projection.svgToScene) {
    const o = projection.svgToScene({ x: 0, y: 0 });
    const ex = projection.svgToScene({ x: 1, y: 0 });
    const ey = projection.svgToScene({ x: 0, y: 1 });
    return [ex.x - o.x, ex.z - o.z, ey.x - o.x, ey.z - o.z, o.x, o.z];
  }
  return [projection.svgScaleX, 0, 0, projection.svgScaleZ, projection.sceneLeft, projection.sceneTop];
}

export const svgUnitMeters = (projection) => {
  const [a, b, c, d] = sceneMatrix(projection);
  return (Math.hypot(a, b) + Math.hypot(c, d)) / 2;
};

// Closed polygons (scene meters) of marked leaves: one parse of a combined document, leaves tagged with data-k.
// items: [{ el }] -> returns an array (per item) of rings [{x, z}].
export function polygonsOf(svgDoc, items, projection, divisions = 6) {
  const ser = new XMLSerializer();
  const m = sceneMatrix(projection);
  const parts = items.map((item, k) => {
    const copy = cloneClean(svgDoc, item.el);
    if (!copy) return '';
    const t = ancestorTransform(item.el);
    return `<g data-k="${k}"${t ? ` transform="${t}"` : ''}>${ser.serializeToString(copy)}</g>`;
  });
  const out = items.map(() => []);
  if (!parts.some(Boolean)) return out;
  const text = `<svg xmlns="${SVG_NS}">${parts.join('')}</svg>`;
  let data;
  try {
    data = new SVGLoader().parse(text);
  } catch {
    return out;
  }
  for (const path of data.paths) {
    const node = path.userData && path.userData.node;
    const holder = node && node.closest ? node.closest('[data-k]') : null;
    if (!holder) continue;
    const k = Number(holder.getAttribute('data-k'));
    for (const sub of path.subPaths) {
      const pts = [];
      for (const p of sub.getPoints(divisions)) {
        const q = { x: m[0] * p.x + m[2] * p.y + m[4], z: m[1] * p.x + m[3] * p.y + m[5] };
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(q.x - last.x, q.z - last.z) > 1e-3) pts.push(q);
      }
      if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) <= 1e-3) pts.pop();
      if (pts.length > 2) out[k].push(pts);
    }
  }
  return out;
}

// Leaf-level items of a group: the shapes (and <use> elements) that make up its drawing, each on its own.
export function leavesOf(el) {
  if (SHAPES.has(el.localName) || el.localName === 'use') return [el];
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (DROP.has(c.localName)) continue;
      if (SHAPES.has(c.localName) || c.localName === 'use') out.push(c);
      else if (c.localName === 'g' || c.localName === 'a' || c.localName === 'switch') walk(c);
    }
  };
  walk(el);
  return out;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Navigation raster failed to load'));
    img.src = url;
  });
}

// Draws an SVG document into a canvas of width x height and returns its RGBA pixels.
export async function rasterPixels(markup, width, height) {
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, width, height);
  const px = ctx.getImageData(0, 0, width, height).data;
  canvas.width = 0;
  canvas.height = 0;
  return px;
}
