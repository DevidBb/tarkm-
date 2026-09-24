// Instanced batches split into spatial cells. Each cell is one InstancedMesh, so the GPU draws only cells
// in the view frustum, and per-cell distance checks give LOD: a "near" layer (detailed model) and a "far"
// layer (simplified model) of the same objects use the same cells with complementary distance ranges.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';

const DEFAULT_CELL = 160;
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();

export function composeMatrix(x, y, z, rotY = 0, sx = 1, sy = 1, sz = 1, rotX = 0, rotZ = 0) {
  tmpE.set(rotX, rotY, rotZ, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  tmpP.set(x, y, z);
  tmpS.set(sx, sy, sz);
  return new THREE.Matrix4().compose(tmpP, tmpQ, tmpS);
}

export class InstancedLayer {
  constructor(parent, { name, geometry, material, minDistance = 0, maxDistance = Infinity, cell = DEFAULT_CELL }) {
    this.parent = parent;
    this.name = name;
    this.geometry = geometry;
    this.material = material;
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    this.cell = cell;
    this.items = [];
    this.cells = [];
    this.enabled = true;
  }

  get count() {
    return this.items.length;
  }

  add(matrix, color = null) {
    const e = matrix.elements;
    this.items.push({ matrix, color, x: e[12], y: e[13], z: e[14] });
  }

  build() {
    const groups = new Map();
    for (const item of this.items) {
      const key = `${Math.floor(item.x / this.cell)},${Math.floor(item.z / this.cell)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const useColor = this.items.some((i) => i.color);
    for (const list of groups.values()) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, list.length);
      const center = new THREE.Vector3();
      list.forEach((item, i) => {
        mesh.setMatrixAt(i, item.matrix);
        if (useColor) mesh.setColorAt(i, item.color || new THREE.Color(1, 1, 1));
        center.x += item.x;
        center.y += item.y;
        center.z += item.z;
      });
      center.divideScalar(list.length);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = this.name;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      this.parent.add(mesh);
      this.cells.push({ mesh, center });
    }
    this.items = [];
    return this;
  }

  update(cameraPosition) {
    for (const c of this.cells) {
      const d = c.center.distanceTo(cameraPosition);
      c.mesh.visible = this.enabled && d >= this.minDistance && d < this.maxDistance;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) for (const c of this.cells) c.mesh.visible = false;
  }

  dispose() {
    for (const c of this.cells) {
      this.parent.remove(c.mesh);
      c.mesh.dispose();
    }
    this.cells = [];
  }
}
