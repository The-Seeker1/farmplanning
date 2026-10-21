import { rectPolygon, M2_PER_ACRE } from '../src/geo.js';

export const IDEAL_SOIL = { ph: 6.8, om: 3.2, texture: 'silt_loam', drainage: 'well', slopePct: 2, depthIn: 60 };

export function squareLand(acres, soil = IDEAL_SOIL, extra = {}) {
  const side = Math.sqrt(acres * M2_PER_ACRE);
  return { id: 'land_test', name: 'Test land', region: 'east', boundary: rectPolygon(side, side), soil: { ...soil }, zones: [], fences: [], markers: [], waterSource: 'well', ...extra };
}
export const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
