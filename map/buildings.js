// Building volumes: real footprints from the SVG #buildings group, extruded as translucent shells.
// Real building heights are not in any open data source, so the shells rise to the selected floor
// (a visual cue, not game geometry). A GLB model can replace this layer later.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { SVGLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/SVGLoader.js/+esm';
import { FLOOR_DISPLAY_Y, VERTICAL_EXAGGERATION } from '../services/coords.js';

export class Buildings {
  constructor(scene, mapData) {
    this.mapData = mapData;
    this.group = new THREE.Group();
    this.count = 0;
    this.height = 1;
    this.opacity = 0.16;
    this.target = { height: 1, opacity: 0.16 };
    scene.add(this.group);
  }

  build(svgDoc) {
    const { map, projection } = this.mapData;
    const groupEl = svgDoc.querySelector(`#${map.svg.buildingsGroup}`);
    if (!groupEl) throw new Error(`SVG has no #${map.svg.buildingsGroup} group`);
    const paths = Array.from(groupEl.querySelectorAll('path'))
      .map((p) => p.getAttribute('d'))
      .filter(Boolean);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
    const shapes = new SVGLoader().parse(svg).paths.flatMap((p) => SVGLoader.createShapes(p));

    const geometry = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false, curveSegments: 3 });
    // SVG (sx, sy, depth) -> scene (sceneLeft + sx*kx, height, sceneTop + sy*kz)
    geometry.rotateX(Math.PI / 2);
    geometry.scale(projection.svgScaleX, -1, projection.svgScaleZ);
    geometry.translate(projection.sceneLeft, 0, projection.sceneTop);
    geometry.computeVertexNormals();

    this.fill = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color: 0x9aa486, transparent: true, opacity: this.opacity, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 25),
      new THREE.LineBasicMaterial({ color: 0xdfe3cc, transparent: true, opacity: 0.42 }),
    );
    this.fill.renderOrder = 10;
    this.edges.renderOrder = 11;
    this.group.add(this.fill, this.edges);
    this.group.position.y = projection.floorPlaneY('GROUND');
    this.count = paths.length;
  }

  setActive(floorId) {
    if (floorId === 'UNDERGROUND') {
      this.target = { height: 3 * VERTICAL_EXAGGERATION, opacity: 0.05 };
      return;
    }
    const top = FLOOR_DISPLAY_Y[floorId] + 4;
    this.target = { height: (top - FLOOR_DISPLAY_Y.GROUND) * VERTICAL_EXAGGERATION, opacity: 0.16 };
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  update(dt) {
    if (!this.fill) return;
    const k = 1 - Math.exp(-dt * 6);
    this.height += (this.target.height - this.height) * k;
    this.opacity += (this.target.opacity - this.opacity) * k;
    this.group.scale.y = this.height;
    this.fill.material.opacity = this.opacity;
    this.edges.material.opacity = Math.min(0.45, this.opacity * 2.6);
  }
}
