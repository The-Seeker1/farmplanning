import test from 'node:test';
import assert from 'node:assert/strict';
import {
  M2_PER_ACRE, toAcres, toFeet, makeProjection, polygonArea, polygonPerimeter, polylineLength, polygonCentroid,
  orientedBoundingBox, fieldDimensions, pointInPolygon, isSimplePolygon, fencePosts, scatterInPolygon, rectPolygon,
  convexHull, ensureCCW, signedArea, sanitizePoint, fromFeet,
} from '../src/geo.js';
import { near } from './helpers.js';

test('one acre square has area 1 acre and a ~63.6 m side', () => {
  const side = Math.sqrt(M2_PER_ACRE);
  const square = rectPolygon(side, side);
  assert.ok(near(toAcres(polygonArea(square)), 1, 1e-9));
  assert.ok(near(side, 63.6149, 1e-3));
  assert.ok(near(polygonPerimeter(square), 4 * side, 1e-9));
});

test('a quarter section (160 ac) is 2,640 ft on a side', () => {
  const side = Math.sqrt(160 * M2_PER_ACRE);
  assert.ok(near(toFeet(side), 2640, 0.5));
});

test('projection round trip is exact within a millimeter, and distances are right', () => {
  const origin = { lat: 39.0473, lon: -95.6752 };
  const projection = makeProjection(origin);
  const latLng = { lat: 39.0521, lon: -95.6689 };
  const back = projection.toLatLon(projection.toLocal(latLng));
  assert.ok(near(back.lat, latLng.lat, 1e-9));
  assert.ok(near(back.lon, latLng.lon, 1e-9));
  const d = projection.toLocal({ lat: origin.lat + 0.001, lon: origin.lon });
  assert.ok(near(d.y, 111.32, 0.2));
  const e = projection.toLocal({ lat: origin.lat, lon: origin.lon + 0.001 });
  assert.ok(near(e.x, 86.5, 0.5));
});

test('shoelace area is orientation independent; ensureCCW fixes winding', () => {
  const canvasWidth = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }];
  assert.equal(polygonArea(canvasWidth), 100);
  assert.ok(signedArea(canvasWidth) < 0);
  assert.ok(signedArea(ensureCCW(canvasWidth)) > 0);
});

test('centroid of a rectangle and of an L shape', () => {
  const c = polygonCentroid(rectPolygon(20, 10, 5, 7));
  assert.ok(near(c.x, 5) && near(c.y, 7));
  const makeAnimal = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }];
  const lc = polygonCentroid(makeAnimal);
  assert.ok(near(lc.x, 8.3333, 1e-3) && near(lc.y, 8.3333, 1e-3));
});

test('oriented bounding box recovers a rotated 200 x 50 m field', () => {
  const theta = (30 * Math.PI) / 180;
  const rot = rectPolygon(200, 50).map((p) => ({ x: p.x * Math.cos(theta) - p.y * Math.sin(theta) + 500, y: p.x * Math.sin(theta) + p.y * Math.cos(theta) - 300 }));
  const box = orientedBoundingBox(rot);
  assert.ok(near(box.length, 200, 1e-6), `length ${box.length}`);
  assert.ok(near(box.width, 50, 1e-6), `width ${box.width}`);
  assert.ok(near(box.angle, theta, 1e-6), `angle ${box.angle}`);
  assert.ok(near(box.center.x, 500, 1e-6) && near(box.center.y, -300, 1e-6));
});

test('fieldDimensions reports feet and an equivalent rectangle', () => {
  const lengthM = fromFeet(1320);
  const widthM = fromFeet(660);
  const d = fieldDimensions(rectPolygon(lengthM, widthM));
  assert.ok(near(d.acres, 20, 1e-3));
  assert.ok(near(d.boxLengthFt, 1320, 1e-6));
  assert.ok(near(d.boxWidthFt, 660, 1e-6));
  assert.ok(near(d.equivLengthFt, 1320, 1e-6));
  assert.ok(near(d.boxFill, 1, 1e-9));
});

test('an L-shaped field has box fill below 1', () => {
  const makeAnimal = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
  const d = fieldDimensions(makeAnimal);
  assert.ok(d.boxFill < 0.8 && d.boxFill > 0.7);
});

test('point in polygon', () => {
  const square = rectPolygon(10, 10);
  assert.ok(pointInPolygon({ x: 1, y: 1 }, square));
  assert.ok(!pointInPolygon({ x: 6, y: 0 }, square));
});

test('simple polygon check catches a bow-tie', () => {
  assert.ok(isSimplePolygon(rectPolygon(10, 10)));
  const bow = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  assert.ok(!isSimplePolygon(bow));
});

test('fence posts: straight run puts a post at each end and equal spans', () => {
  const posts = fencePosts([{ x: 0, y: 0 }, { x: 100, y: 0 }], fromFeet(12));
  assert.equal(posts.length, 29);
  assert.ok(posts[0].corner && posts.at(-1).corner);
  const gap = posts[1].x - posts[0].x;
  assert.ok(gap <= fromFeet(12) + 1e-9);
});

test('fence posts: closed square gets corner posts and no duplicate start', () => {
  const square = rectPolygon(100, 100);
  const posts = fencePosts(square, 25, true);
  assert.equal(posts.length, 16);
  assert.equal(posts.filter((p) => p.corner).length, 4);
});

test('polyline length', () => {
  assert.ok(near(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }]), 11));
});

test('scatterInPolygon returns n deterministic points inside', () => {
  const polygon = rectPolygon(100, 60);
  const a = scatterInPolygon(polygon, 40, 3);
  const b = scatterInPolygon(polygon, 40, 3);
  assert.equal(a.length, 40);
  assert.deepEqual(a, b);
  assert.ok(a.every((p) => pointInPolygon(p, polygon)));
  assert.deepEqual(scatterInPolygon(polygon, 0), []);
});

test('convex hull drops interior points', () => {
  const points = [...rectPolygon(10, 10), { x: 0, y: 0 }, { x: 1, y: 1 }];
  assert.equal(convexHull(points).length, 4);
});

test('sanitizePoint rejects junk', () => {
  assert.equal(sanitizePoint({ x: NaN, y: 1 }), null);
  assert.equal(sanitizePoint({ x: 1e9, y: 1 }), null);
  assert.deepEqual(sanitizePoint({ x: '3', y: 4 }), { x: 3, y: 4 });
  assert.equal(sanitizePoint(null), null);
});
