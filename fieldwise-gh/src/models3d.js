import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tempMatrix = new THREE.Matrix4();
const tempTurn = new THREE.Quaternion();
const tempEuler = new THREE.Euler();

function finish(geo, color, matrix) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.applyMatrix4(matrix);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const list = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    list[i * 3] = c.r;
    list[i * 3 + 1] = c.g;
    list[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(list, 3));
  return g;
}

function at(x, y, z, { rx: rotateX = 0, ry: rotateY = 0, rz: rotateZ = 0, sx: scaleX = 1, sy: scaleY = 1, sz: scaleZ = 1 } = {}) {
  tempEuler.set(rotateX, rotateY, rotateZ);
  tempTurn.setFromEuler(tempEuler);
  return tempMatrix.compose(new THREE.Vector3(x, y, z), tempTurn, new THREE.Vector3(scaleX, scaleY, scaleZ)).clone();
}

const box = (w, h, d, color, x, y, z, o) => finish(new THREE.BoxGeometry(w, h, d), color, at(x, y, z, o));
const cone = (r, h, seg, color, x, y, z, o) => finish(new THREE.ConeGeometry(r, h, seg), color, at(x, y, z, o));
const cylinder = (radiusTop, radiusBottom, h, seg, color, x, y, z, o) => finish(new THREE.CylinderGeometry(radiusTop, radiusBottom, h, seg), color, at(x, y, z, o));
const ball = (r, color, x, y, z, o) => finish(new THREE.IcosahedronGeometry(r, 0), color, at(x, y, z, o));

function gable(w, h, d, color, x, y, z) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  return finish(geo, color, at(x, y, z));
}

const merge = (parts) => {
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  return g;
};

function legs(xList, zList, w, h, color) {
  const out = [];
  for (const x of xList) for (const z of zList) out.push(box(w, h, w, color, x, h / 2, z));
  return out;
}

export const ANIMAL_BUILDERS = {
  beef: () => merge([
    box(2.0, 1.0, 0.85, '#8a4526', 0, 1.15, 0),
    box(0.6, 0.55, 0.5, '#efe6d6', 1.25, 1.3, 0),
    box(0.12, 0.1, 0.4, '#6e3820', 1.05, 1.62, 0),
    box(0.4, 0.14, 0.1, '#efe6d6', 1.28, 1.62, 0),
    box(0.08, 0.7, 0.08, '#5a2e18', -1.05, 1.0, 0),
    ...legs([-0.7, 0.7], [-0.3, 0.3], 0.2, 0.75, '#5a2e18'),
  ]),
  sheep: () => merge([
    ball(0.44, '#f2f0e8', 0, 0.8, 0, { sx: 1.25, sy: 0.9, sz: 0.9 }),
    box(0.3, 0.32, 0.26, '#3b3530', 0.62, 0.88, 0),
    box(0.1, 0.08, 0.34, '#3b3530', 0.55, 1.05, 0),
    ...legs([-0.3, 0.3], [-0.17, 0.17], 0.09, 0.42, '#3b3530'),
  ]),
  goats: () => merge([
    box(0.95, 0.5, 0.4, '#d8c7a5', 0, 0.8, 0),
    box(0.28, 0.3, 0.22, '#e6d8bb', 0.6, 1.02, 0),
    cone(0.04, 0.22, 4, '#4b4035', 0.55, 1.28, 0.07, { rz: -0.4 }),
    cone(0.04, 0.22, 4, '#4b4035', 0.55, 1.28, -0.07, { rz: -0.4 }),
    box(0.06, 0.16, 0.06, '#f4efe3', 0.76, 0.9, 0),
    box(0.1, 0.12, 0.05, '#d8c7a5', -0.52, 1.0, 0, { rz: 0.5 }),
    ...legs([-0.35, 0.35], [-0.14, 0.14], 0.08, 0.55, '#bda987'),
  ]),
  horses: () => merge([
    box(1.8, 0.85, 0.6, '#7a4a2a', 0, 1.4, 0),
    box(0.36, 0.95, 0.3, '#7a4a2a', 1.0, 1.95, 0, { rz: -0.45 }),
    box(0.62, 0.3, 0.28, '#6e4126', 1.5, 2.3, 0, { rz: -0.35 }),
    box(0.1, 0.75, 0.07, '#1d1511', 0.82, 2.15, 0, { rz: -0.45 }),
    box(0.1, 0.95, 0.1, '#1d1511', -1.0, 1.15, 0, { rz: 0.25 }),
    ...legs([-0.65, 0.65], [-0.2, 0.2], 0.14, 1.0, '#4a2a16'),
  ]),
  hogs: () => merge([
    box(1.4, 0.7, 0.65, '#e8a6a0', 0, 0.68, 0),
    box(0.42, 0.45, 0.45, '#e8a6a0', 0.88, 0.62, 0),
    box(0.18, 0.22, 0.3, '#d98a85', 1.14, 0.52, 0),
    box(0.08, 0.2, 0.15, '#d98a85', 0.8, 0.95, 0.18),
    box(0.08, 0.2, 0.15, '#d98a85', 0.8, 0.95, -0.18),
    box(0.05, 0.05, 0.05, '#d98a85', -0.72, 0.8, 0),
    ...legs([-0.5, 0.5], [-0.2, 0.2], 0.14, 0.32, '#d98a85'),
  ]),
  chickens: () => merge([
    box(0.38, 0.3, 0.26, '#f4f1ea', 0, 0.34, 0),
    box(0.22, 0.2, 0.05, '#cfc9bc', -0.22, 0.46, 0, { rz: 0.6 }),
    box(0.12, 0.14, 0.1, '#f4f1ea', 0.22, 0.52, 0),
    box(0.08, 0.07, 0.03, '#c0392b', 0.22, 0.62, 0),
    cone(0.03, 0.08, 4, '#e8a317', 0.3, 0.5, 0, { rz: -Math.PI / 2 }),
    box(0.025, 0.2, 0.025, '#e0a82e', 0, 0.1, 0.06),
    box(0.025, 0.2, 0.025, '#e0a82e', 0, 0.1, -0.06),
  ]),
};

export const ANIMAL_SCALE = { beef: 1.35, sheep: 1.5, goats: 1.5, horses: 1.35, hogs: 1.5, chickens: 2.3 };

export const FEATURE_BUILDERS = {
  barn: () => merge([
    box(8, 3.6, 12, '#a23b2a', 0, 1.8, 0),
    gable(8.8, 2.4, 12.8, '#5b5f63', 0, 3.6, 0),
    box(2.6, 3.0, 0.15, '#f2efe6', 0, 1.5, 6.05),
    box(2.6, 3.0, 0.15, '#f2efe6', 0, 1.5, -6.05),
  ]),
  house: () => merge([
    box(9, 3, 7, '#e7dfcf', 0, 1.5, 0),
    gable(9.8, 2.8, 7.8, '#6a4a3a', 0, 3, 0),
    box(1.0, 1.8, 0.8, '#8a8178', 2.4, 4.4, 0),
    box(1.1, 2.1, 0.12, '#6a4a3a', 0, 1.05, 3.55),
  ]),
  tank: () => merge([
    cylinder(1.4, 1.4, 1.3, 10, '#4a86b5', 0, 0.65, 0),
    cylinder(1.5, 1.5, 0.12, 10, '#d8e6f0', 0, 1.3, 0),
  ]),
  shade: () => merge([
    ...[-2.2, 2.2].flatMap((x) => [-2.2, 2.2].map((z) => box(0.25, 2.4, 0.25, '#6b4a2b', x, 1.2, z))),
    box(5.6, 0.2, 5.6, '#8a8f94', 0, 2.5, 0),
  ]),
  tree: () => merge([
    cylinder(0.22, 0.34, 2.2, 6, '#6b4a2b', 0, 1.1, 0),
    ball(1.8, '#3e7a3a', 0, 3.5, 0, { sy: 1.15 }),
    ball(1.25, '#4f9143', 0.3, 4.7, 0.1),
  ]),
  weed: () => merge([
    cone(0.12, 0.7, 4, '#7a8f2a', 0, 0.35, 0),
    cone(0.1, 0.55, 4, '#a2b035', 0.25, 0.28, 0.1, { rz: -0.2 }),
    cone(0.1, 0.6, 4, '#8a9f30', -0.2, 0.3, -0.15, { rz: 0.2 }),
    cone(0.09, 0.5, 4, '#a2b035', 0.05, 0.25, 0.28),
  ]),
};

export function unitBox() {
  return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
}
export function unitBar() {
  return new THREE.BoxGeometry(1, 1, 1);
}
