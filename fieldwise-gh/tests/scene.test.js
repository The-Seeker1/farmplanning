import test from 'node:test';
import assert from 'node:assert/strict';
import { clipHalfPlane, autoPartition, scanlines } from '../src/layout.js';
import { buildScene, heightAt, effectiveSlopePct, vegetationTone, MAX_ICONS_PER_SPECIES, SLOPE_WORD_PCT } from '../src/scene.js';
import { evaluatePlan, emptyPlan } from '../src/planner.js';
import { newProfile, sanitizeProfile } from '../src/storage.js';
import { polygonArea, rectPolygon, pointInPolygon, M2_PER_ACRE, fencePosts, fromFeet, toAcres } from '../src/geo.js';
import { squareLand, IDEAL_SOIL, near } from './helpers.js';

const L_SHAPE = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 200 }];

test('clipHalfPlane halves a square', () => {
  const square = rectPolygon(100, 100);
  const half = clipHalfPlane(square, 1, 0, 0);
  assert.ok(near(polygonArea(half), 5000, 1e-6));
  assert.equal(clipHalfPlane(square, 1, 0, -100).length, 0);
  assert.ok(near(polygonArea(clipHalfPlane(square, 1, 0, 100)), 10000, 1e-6));
});

test('autoPartition gives each item its share of the area and tiles the field', () => {
  const square = rectPolygon(400, 200);
  const parts = autoPartition(square, [{ id: 'a', fraction: 0.5 }, { id: 'b', fraction: 0.25 }, { id: 'c', fraction: 0.15 }]);
  assert.deepEqual(parts.map((p) => p.id), ['a', 'b', 'c', '__rest']);
  const total = polygonArea(square);
  assert.ok(near(parts[0].areaM2 / total, 0.5, 1e-4));
  assert.ok(near(parts[1].areaM2 / total, 0.25, 1e-4));
  assert.ok(near(parts[2].areaM2 / total, 0.15, 1e-4));
  assert.ok(near(parts[3].areaM2 / total, 0.1, 1e-4));
  assert.ok(near(parts.reduce((s, p) => s + p.areaM2, 0), total, 1e-3));
});

test('autoPartition works on an L-shaped field and normalizes fractions above 1', () => {
  const total = polygonArea(L_SHAPE);
  const parts = autoPartition(L_SHAPE, [{ id: 'x', fraction: 0.3 }, { id: 'y', fraction: 0.3 }]);
  assert.ok(near(parts[0].areaM2 / total, 0.3, 1e-3));
  assert.ok(near(parts[1].areaM2 / total, 0.3, 1e-3));
  const over = autoPartition(rectPolygon(100, 100), [{ id: 'p', fraction: 3 }, { id: 'q', fraction: 1 }]);
  assert.equal(over.length, 2);
  assert.ok(near(over[0].areaM2 / 10000, 0.75, 1e-3));
  assert.deepEqual(autoPartition(rectPolygon(100, 100), []), []);
  assert.deepEqual(autoPartition([], [{ id: 'a', fraction: 1 }]), []);
});

test('scanlines stay inside the polygon and respect spacing and the row cap', () => {
  const square = rectPolygon(100, 60);
  const rows = scanlines(square, 0, 3);
  assert.equal(rows.length, 20);
  for (const r of rows) {
    assert.ok(near(r.a.y, r.b.y, 1e-9));
    assert.ok(pointInPolygon({ x: (r.a.x + r.b.x) / 2, y: r.a.y }, square));
  }
  assert.ok(scanlines(square, 0, 0.001, { maxRows: 50 }).length <= 50);
  const lrows = scanlines(L_SHAPE, 0, 5);
  for (const r of lrows) assert.ok(pointInPolygon({ x: (r.a.x + r.b.x) / 2, y: r.a.y }, L_SHAPE));
  assert.deepEqual(scanlines([], 0, 3), []);
});

function profileWith(land, plans = []) {
  const p = newProfile('t');
  return sanitizeProfile({ ...p, land: { ...land, location: null }, plans });
}

test('buildScene: nothing to draw without a boundary', () => {
  const s = buildScene(newProfile('x'), null, null);
  assert.equal(s.empty, true);
});

test('buildScene: boundary fence posts match the fence math and sit on the boundary', () => {
  const land = squareLand(10);
  const profile = profileWith(land);
  const plan = { ...emptyPlan('P'), fenceBoundary: true, boundaryFence: 'barbed5' };
  const scene = buildScene(profile, plan, evaluatePlan(plan, profile.land));
  const f = scene.fences.find((x) => x.id === 'boundary');
  assert.equal(f.posts.length, fencePosts(profile.land.boundary, fromFeet(12), true).length);
  assert.equal(f.posts.length, 220);
  assert.equal(f.spans.length, f.posts.length);
  assert.equal(f.strands, 5);
});

test('buildScene: drawn fences keep their type and open ends', () => {
  const land = squareLand(10, IDEAL_SOIL, { fences: [{ id: 'f1', name: 'Divider', type: 'electric2', line: [{ x: -50, y: 0 }, { x: 50, y: 0 }], closed: false, gates: 1 }] });
  const scene = buildScene(profileWith(land), null, null);
  const f = scene.fences[0];
  assert.equal(f.type, 'electric2');
  assert.equal(f.spans.length, f.posts.length - 1);
  assert.equal(f.strands, 2);
});

test('buildScene: animals are inside the boundary, counts match, big herds are drawn as icons', () => {
  const land = squareLand(200);
  const profile = profileWith(land);
  const plan = { ...emptyPlan('Chickens + beef'), allocations: [
    { id: 'c', kind: 'livestock', item: 'chickens', acres: 40, heads: null },
    { id: 'b', kind: 'livestock', item: 'beef', acres: 100, heads: null },
  ] };
  const evaluation = evaluatePlan(plan, profile.land);
  const scene = buildScene(profile, plan, evaluation);
  const hens = scene.animals.filter((a) => a.kind === 'chickens');
  const cows = scene.animals.filter((a) => a.kind === 'beef');
  const henHeads = evaluation.livestock.find((l) => l.item === 'chickens').heads;
  const cowHeads = evaluation.livestock.find((l) => l.item === 'beef').heads;
  assert.ok(henHeads > 1000);
  assert.ok(hens.length <= MAX_ICONS_PER_SPECIES);
  const leg = scene.legend.find((l) => l.kind === 'chickens');
  assert.equal(leg.heads, henHeads);
  assert.ok(leg.perIcon > 1);
  assert.ok(leg.perIcon * hens.length >= henHeads);
  assert.equal(cows.length, cowHeads);
  for (const a of scene.animals) assert.ok(pointInPolygon(a, profile.land.boundary), `${a.kind} outside`);
});

test('buildScene: tapped spots become herd clusters and share the plan head count', () => {
  const land = squareLand(100, IDEAL_SOIL, { markers: [
    { id: 'm1', kind: 'beef', x: -60, y: -60 }, { id: 'm2', kind: 'beef', x: 60, y: 60 }, { id: 'm3', kind: 'barn', x: 0, y: 0 },
    { id: 'm4', kind: 'goats', x: 20, y: -20 },
  ] });
  const profile = profileWith(land);
  const plan = { ...emptyPlan('Beef'), allocations: [{ id: 'b', kind: 'livestock', item: 'beef', acres: 60, heads: 20 }] };
  const evaluation = evaluatePlan(plan, profile.land);
  const scene = buildScene(profile, plan, evaluation);
  const cows = scene.animals.filter((a) => a.kind === 'beef');
  assert.equal(cows.length, 20);
  const nearA = cows.filter((c) => Math.hypot(c.x + 60, c.y + 60) < 30).length;
  const nearB = cows.filter((c) => Math.hypot(c.x - 60, c.y - 60) < 30).length;
  assert.equal(nearA, 10);
  assert.equal(nearB, 10);
  const goats = scene.animals.filter((a) => a.kind === 'goats');
  assert.equal(goats.length, 6);
  assert.ok(goats.every((g) => g.preview));
  assert.ok(scene.legend.find((l) => l.kind === 'goats').preview);
  assert.equal(scene.features.length, 1);
  assert.equal(scene.features[0].kind, 'barn');
});

test('buildScene: a tapped spot near the edge keeps animals inside the fence line', () => {
  const land = squareLand(10, IDEAL_SOIL, { markers: [{ id: 'm1', kind: 'sheep', x: 100, y: 100 }] });
  const half = Math.sqrt(10 * M2_PER_ACRE) / 2;
  land.markers[0].x = half - 1;
  land.markers[0].y = half - 1;
  const profile = profileWith(land);
  const scene = buildScene(profile, null, null);
  assert.ok(scene.animals.length > 0);
  for (const a of scene.animals) assert.ok(pointInPolygon(a, profile.land.boundary));
});

test('buildScene: crop rows, partitions and zone links', () => {
  const land = squareLand(40);
  const profile = profileWith(land);
  const plan = { ...emptyPlan('Crops'), allocations: [
    { id: 'c1', kind: 'crop', item: 'corn', acres: 20 },
    { id: 'c2', kind: 'crop', item: 'wheat', acres: 10 },
    { id: 'g', kind: 'garden', acres: 0.2, vegetables: { tomatoes: 1 } },
  ] };
  const evaluation = evaluatePlan(plan, profile.land);
  const scene = buildScene(profile, plan, evaluation);
  assert.equal(scene.crops.length, 3);
  const corn = scene.regions.find((r) => r.id === 'c1');
  assert.ok(near(toAcres(polygonArea(corn.polygon)), 20, 0.05));
  assert.ok(scene.crops.every((c) => c.rows.length > 0));
  assert.ok(scene.stats.rows > 0);

  const square = Math.sqrt(5 * M2_PER_ACRE);
  const withZone = profileWith({ ...land, zones: [{ id: 'z1', name: 'Back forty', use: 'crop', polygon: rectPolygon(square, square, 40, 40) }] });
  const linked = { ...plan, allocations: [{ id: 'c1', kind: 'crop', item: 'corn', acres: 1, zoneId: 'z1' }] };
  const sc2 = buildScene(withZone, linked, evaluatePlan(linked, withZone.land));
  const reg = sc2.regions.find((r) => r.id === 'c1');
  assert.ok(reg.linked);
  assert.ok(near(toAcres(polygonArea(reg.polygon)), 5, 1e-6));
  assert.ok(!sc2.regions.some((r) => r.id === 'z1'));
});

test('terrain: slope from soil data, else from the latest photo word, else nearly flat', () => {
  assert.equal(effectiveSlopePct({ soil: { slopePct: 6 } }), 6);
  assert.equal(effectiveSlopePct({ soil: {}, photos: [] }), 1);
  const photos = [{ ts: 1, summary: { slope: 'flat' } }, { ts: 5, summary: { slope: 'steep' } }, { ts: 9, summary: { slope: 'unknown' } }];
  assert.equal(effectiveSlopePct({ soil: {}, photos }), SLOPE_WORD_PCT.steep);
  const flat = { slopePct: 1, dirAngle: 0.6, bumpiness: 0.5, seed: 3.1, base: 0 };
  const steep = { ...flat, slopePct: 15, bumpiness: 3 };
  const span = (t) => { const hs = []; for (let x = -200; x <= 200; x += 20) for (let y = -200; y <= 200; y += 20) hs.push(heightAt(t, x, y)); return Math.max(...hs) - Math.min(...hs); };
  assert.ok(span(steep) > 5 * span(flat));
  assert.equal(heightAt(flat, 10, 10), heightAt(flat, 10, 10));
});

test('photo analysis changes the scene: tone, trees, bare patches, weeds, ponds', () => {
  const land = squareLand(40, IDEAL_SOIL);
  const base = buildScene(profileWith(land), null, null);
  assert.equal(base.trees.length, 0);
  assert.equal(base.patches.length, 0);
  assert.equal(base.tone.from, 'soil');

  const summary = {
    landCover: [{ cls: 'grass', pct: 50 }, { cls: 'trees', pct: 20 }, { cls: 'bare_soil', pct: 20 }, { cls: 'water', pct: 10 }],
    vegetationCondition: 'poor', slope: 'moderate', drainage: 'poor', erosionSigns: true, standingWater: true,
    weeds: [{ name: 'Johnsongrass', severity: 'heavy' }], observations: [], confidence: 'medium',
  };
  const withPhoto = buildScene(profileWith({ ...land, soil: { ...land.soil, slopePct: null }, photos: [{ id: 'p1', ts: 5, engine: 'gemini', kind: 'ground', summary }] }), null, null);
  assert.equal(withPhoto.tone.tone, 'poor');
  assert.equal(withPhoto.tone.from, 'photo');
  assert.ok(withPhoto.trees.length >= 10);
  assert.ok(withPhoto.patches.some((p) => p.kind === 'bare'));
  assert.ok(withPhoto.patches.some((p) => p.kind === 'weeds'));
  assert.ok(withPhoto.patches.some((p) => p.kind === 'pond'));
  assert.equal(withPhoto.terrain.slopePct, 8);
});

test('buildScene is JSON-serializable and deterministic', () => {
  const land = squareLand(40, IDEAL_SOIL, { markers: [{ id: 'm', kind: 'beef', x: 0, y: 0 }] });
  const profile = profileWith(land);
  const plan = { ...emptyPlan('A'), allocations: [{ id: 'b', kind: 'livestock', item: 'beef', acres: 30, heads: 8 }] };
  const evaluation = evaluatePlan(plan, profile.land);
  const a = JSON.stringify(buildScene(profile, plan, evaluation));
  const b = JSON.stringify(buildScene(profile, plan, evaluation));
  assert.equal(a, b);
  assert.ok(a.length > 100);
});

test('vegetationTone falls back to soil quality when there is no photo', () => {
  assert.equal(vegetationTone({ soil: IDEAL_SOIL }).tone, 'good');
  assert.equal(vegetationTone({ soil: { ph: 4.6, drainage: 'very_poor', texture: 'sand', slopePct: 30, depthIn: 5 } }).tone, 'poor');
});
