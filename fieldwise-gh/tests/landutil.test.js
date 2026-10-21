import test from 'node:test';
import assert from 'node:assert/strict';
import { landPoint, rectangleBoundary, mergeSoilReading, recenterOrigin, DEFAULT_ORIGIN } from '../src/landutil.js';
import { makeProjection, polygonCentroid, polygonArea, toAcres } from '../src/geo.js';
import { near } from './helpers.js';

test('rectangleBoundary: 1,320 x 660 ft is 20 acres; silly sizes are rejected', () => {
  const r = rectangleBoundary(1320, 660);
  assert.ok(near(toAcres(polygonArea(r)), 20, 1e-3));
  assert.throws(() => rectangleBoundary(5, 500));
  assert.throws(() => rectangleBoundary('abc', 500));
  assert.throws(() => rectangleBoundary(1e6, 500));
});

test('landPoint prefers the boundary center, then the address, then the origin', () => {
  const origin = { lat: 38.9, lon: -95.2 };
  const projection = makeProjection(origin);
  const boundary = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }];
  const p = landPoint({ boundary, origin, location: { lat: 1, lon: 1 } });
  const want = projection.toLatLon({ x: 200, y: 200 });
  assert.ok(near(p.lat, want.lat, 1e-9) && near(p.lon, want.lon, 1e-9));
  assert.deepEqual(landPoint({ boundary: [], origin, location: { lat: 39, lon: -95 } }), { lat: 39, lon: -95 });
  assert.deepEqual(landPoint({ origin }), origin);
  assert.equal(landPoint({}), null);
  assert.equal(landPoint(null), null);
});

test('recenterOrigin puts the field center exactly on the target', () => {
  const boundary = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }];
  const target = { lat: 38.5, lon: -97.3 };
  const origin = recenterOrigin({ boundary }, target);
  const p = makeProjection(origin).toLatLon(polygonCentroid(boundary));
  assert.ok(near(p.lat, target.lat, 1e-9));
  assert.ok(near(p.lon, target.lon, 1e-9));
  assert.deepEqual(recenterOrigin({ boundary: [] }, target), target);
  assert.ok(DEFAULT_ORIGIN.lat > 37 && DEFAULT_ORIGIN.lat < 40);
});

test('mergeSoilReading overwrites what came back and keeps what did not', () => {
  const current = { ph: 7.9, om: 1, texture: 'clay', drainage: 'poor', slopePct: 5, depthIn: 30, source: 'manual', notes: [] };
  const next = mergeSoilReading(current, { source: 'soilgrids', ph: 6.4, om: 2.8, texture: 'silt_loam', drainage: null, slopePct: null, depthIn: null, sand: 10, silt: 65, clay: 25, mapUnit: 'SoilGrids', notes: ['n'] });
  assert.equal(next.ph, 6.4);
  assert.equal(next.drainage, 'poor');
  assert.equal(next.slopePct, 5);
  assert.equal(next.source, 'soilgrids');
  assert.deepEqual(next.notes, ['n']);
  assert.equal(current.ph, 7.9);
});
