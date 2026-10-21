import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newProfile, sanitizeProfile, sanitizeStore, sanitizePrefs, createStorage, exportProfileJson, importProfileJson, createKeyStore,
  emptyStore, STORE_KEY, MAX_IMPORT_BYTES,
} from '../src/storage.js';
import { evaluatePlan } from '../src/planner.js';
import { rectPolygon } from '../src/geo.js';

const fakeBackend = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
};

function sampleProfile() {
  const p = newProfile('Test farm');
  p.land.boundary = rectPolygon(300, 200);
  p.land.soil = { ph: 6.7, om: 3, texture: 'silt_loam', drainage: 'well', slopePct: 2, depthIn: 60, source: 'ssurgo', mapUnit: 'Kennebec', notes: [] };
  p.land.location = { label: '1 Main St, Topeka', lat: 39.04, lon: -95.67 };
  p.land.origin = { lat: 39.04, lon: -95.67 };
  p.land.waterSource = 'well';
  p.land.zones = [{ id: 'z1', name: 'North pasture', use: 'pasture', polygon: rectPolygon(100, 100) }];
  p.land.fences = [{ id: 'f1', name: 'Divider', type: 'electric2', line: [{ x: 0, y: -50 }, { x: 0, y: 50 }], closed: false, gates: 1 }];
  p.land.markers = [{ id: 'm1', kind: 'beef', x: 10, y: 10, label: '' }, { id: 'm2', kind: 'barn', x: -20, y: 5, label: 'Barn' }];
  p.plans = [{ id: 'plan1', name: 'Beef', notes: '', grazing: 'rotational', fenceBoundary: true, boundaryFence: 'barbed5', boundaryGates: 1, allocations: [{ id: 'a1', kind: 'livestock', item: 'beef', acres: 10, heads: null }] }];
  p.activePlanId = 'plan1';
  p.overrides = { livestock: { beef: { annualRevenue: 1500 } }, crops: { corn: { price: 4.8 } } };
  return sanitizeProfile(p);
}

test('a good profile survives a sanitize round trip unchanged', () => {
  const p = sampleProfile();
  const again = sanitizeProfile(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(again.land.soil, p.land.soil);
  assert.deepEqual(again.plans, p.plans);
  assert.deepEqual(again.overrides, p.overrides);
  assert.equal(again.land.zones.length, 1);
  assert.equal(again.land.fences[0].type, 'electric2');
  assert.equal(again.land.markers.length, 2);
  assert.equal(again.activePlanId, 'plan1');
  const evaluation = evaluatePlan(again.plans[0], again.land, again.overrides);
  assert.ok(evaluation.money.net.base > 0);
});

test('hostile profile: unknown keys, wrong types, huge numbers and prototype tricks are neutralized', () => {
  const evil = JSON.parse(`{
    "__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}},
    "id": "<script>alert(1)</script>", "name": "${'N'.repeat(500)}", "createdAt": "x",
    "land": {
      "name": "<img src=x onerror=alert(1)>", "region": "mars", "zone": 99,
      "boundary": [{"x":1,"y":2},{"x":"a","y":3},{"x":1e99,"y":0},{"x":10,"y":0},{"x":10,"y":10},null,5],
      "soil": {"ph": 99, "om": -5, "texture": "lava", "drainage": "wet-ish", "slopePct": "steep", "source": "hacker", "notes": [1, "ok", "<b>x</b>"]},
      "waterSource": "the moon",
      "zones": [{"id":"../../etc","use":"nuclear","polygon":[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1}]}, {"polygon":[{"x":0,"y":0}]}],
      "fences": [{"type":"laser","line":[{"x":0,"y":0},{"x":5,"y":5}],"gates":99999}, {"type":"barbed5","line":[]}],
      "markers": [{"kind":"dragon","x":1,"y":1}, {"kind":"beef","x":"NaN","y":1}, {"kind":"beef","x":1,"y":1,"label":"<b>cow</b>"}]
    },
    "plans": [{"name":"p","grazing":"zigzag","boundaryFence":"laser","allocations":[
      {"kind":"livestock","item":"dragon","acres":5},
      {"kind":"livestock","item":"beef","acres":1e12,"heads":-5},
      {"kind":"crop","item":"constructor","acres":1},
      {"kind":"garden","acres":0.1,"vegetables":{"tomatoes":0.5,"__proto__":{"x":1},"toString":1,"bogus":1}}
    ]}],
    "overrides": {"livestock":{"beef":{"annualRevenue":"1e99","purchase":-5,"evil":1},"__proto__":{"x":1}},"gateCost":"free"},
    "learning": {"weakTopics":{"ph":3,"__proto__":9,"BAD KEY":4}, "quizHistory":[{"ts":1,"score":999,"total":3,"source":"x"}]}
  }`);
  const p = sanitizeProfile(evil);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.match(p.id, /^prof_/);
  assert.equal(p.name.length, 60);
  assert.equal(p.land.region, 'east');
  assert.equal(p.land.zone, 3);
  assert.equal(p.land.boundary.length, 3);
  assert.equal(p.land.soil.ph, 10.5);
  assert.equal(p.land.soil.om, 0);
  assert.equal(p.land.soil.texture, null);
  assert.equal(p.land.soil.drainage, null);
  assert.equal(p.land.soil.slopePct, null);
  assert.equal(p.land.soil.source, 'manual');
  assert.deepEqual(p.land.soil.notes, ['ok', '<b>x</b>']);
  assert.equal(p.land.waterSource, null);
  assert.equal(p.land.zones.length, 1);
  assert.match(p.land.zones[0].id, /^zone_/);
  assert.equal(p.land.zones[0].use, 'pasture');
  assert.equal(p.land.fences.length, 1);
  assert.equal(p.land.fences[0].type, 'barbed5');
  assert.equal(p.land.fences[0].gates, 20);
  assert.equal(p.land.markers.length, 1);
  assert.equal(p.land.markers[0].label, '<b>cow</b>');
  assert.equal(p.plans[0].grazing, 'rotational');
  assert.equal(p.plans[0].boundaryFence, 'barbed5');
  const kinds = p.plans[0].allocations.map((a) => `${a.kind}:${a.item || ''}`);
  assert.deepEqual(kinds, ['livestock:beef', 'garden:']);
  assert.equal(p.plans[0].allocations[0].acres, 100000);
  assert.equal(p.plans[0].allocations[0].heads, 0);
  assert.deepEqual(Object.keys(p.plans[0].allocations[1].vegetables), ['tomatoes']);
  assert.deepEqual(p.overrides.livestock.beef, { purchase: 0, annualRevenue: 1e7 });
  assert.equal(p.overrides.gateCost, undefined);
  assert.deepEqual(p.learning.weakTopics, { ph: 3 });
  assert.equal(p.learning.quizHistory[0].score, 50);
  assert.equal(p.learning.quizHistory[0].source, 'template');
});

test('sanitizeProfile rejects non-objects', () => {
  assert.throws(() => sanitizeProfile(null));
  assert.throws(() => sanitizeProfile([]));
  assert.throws(() => sanitizeProfile('x'));
});

test('boundary is wound counter-clockwise and list sizes are capped', () => {
  const canvasWidth = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }];
  const p = sanitizeProfile({ land: { boundary: canvasWidth } });
  const area = p.land.boundary.reduce((s, a, i, list) => s + (a.x * list[(i + 1) % list.length].y - list[(i + 1) % list.length].x * a.y), 0);
  assert.ok(area > 0);
  const many = sanitizeProfile({ land: { markers: Array.from({ length: 5000 }, (_, i) => ({ kind: 'beef', x: i, y: i })) }, plans: Array.from({ length: 100 }, () => ({})) });
  assert.equal(many.land.markers.length, 600);
  assert.equal(many.plans.length, 20);
});

test('storage: save/load, corrupt data, blocked storage, size cap', () => {
  const be = fakeBackend();
  const s = createStorage(be);
  const store = emptyStore();
  store.profiles[0] = sampleProfile();
  store.activeProfileId = store.profiles[0].id;
  s.save(store);
  const loaded = s.load();
  assert.equal(loaded.profiles[0].name, 'Test farm');
  assert.equal(loaded.activeProfileId, store.profiles[0].id);

  be.setItem(STORE_KEY, '{not json');
  assert.equal(s.load().profiles.length, 1);

  be.setItem(STORE_KEY, JSON.stringify({ profiles: [null, 5, { name: 'ok' }], activeProfileId: 'nope' }));
  const l2 = s.load();
  assert.equal(l2.profiles.length, 1);
  assert.equal(l2.profiles[0].name, 'ok');

  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const slopeRange = createStorage(blocked);
  assert.doesNotThrow(() => slopeRange.save(store));
  assert.equal(slopeRange.persistent, false);
  assert.ok(slopeRange.load().profiles.length >= 1);
});

test('export strips location unless asked; import re-sanitizes, renames and re-ids', () => {
  const p = sampleProfile();
  const plain = JSON.parse(exportProfileJson(p));
  assert.equal(plain.format, 'fieldwise-profile');
  assert.equal(plain.profile.land.location, null);
  assert.equal(plain.profile.land.origin, null);
  assert.ok(!exportProfileJson(p).includes('Main St'));
  const withLoc = JSON.parse(exportProfileJson(p, { includeLocation: true }));
  assert.equal(withLoc.profile.land.location.lat, 39.04);

  const imported = importProfileJson(exportProfileJson(p));
  assert.notEqual(imported.id, p.id);
  assert.match(imported.name, /\(imported\)$/);
  assert.equal(imported.land.zones.length, 1);

  assert.throws(() => importProfileJson('not json'), /valid JSON/);
  assert.throws(() => importProfileJson('{"format":"other"}'), /not a FieldWise/);
  assert.throws(() => importProfileJson(JSON.stringify({ format: 'fieldwise-profile', version: 99, profile: {} })), /newer/);
  assert.throws(() => importProfileJson('x'.repeat(MAX_IMPORT_BYTES + 1)), /too large/);
  assert.throws(() => importProfileJson(42));
});

test('prefs: model name is checked and unknown fields are dropped', () => {
  assert.equal(sanitizePrefs({ proxyUrl: 'https://evil.com/sda' }).proxyUrl, undefined);
  assert.equal(sanitizePrefs({ model: '../../x' }).model, 'gemini-flash-latest');
  assert.equal(sanitizePrefs({ model: 'gemini-2.5-pro' }).model, 'gemini-2.5-pro');
  assert.equal(sanitizePrefs({ provider: 'skynet' }).provider, 'gemini');
});

test('the API key is never written into the profile store', () => {
  const be = fakeBackend();
  const sess = fakeBackend();
  const ks = createKeyStore({ session: sess, local: be });
  ks.save('gemini', 'fake-secret-key-12345678901234', false);
  const s = createStorage(be);
  s.save(emptyStore());
  const dump = [...be._m.values()].join('|');
  assert.ok(!dump.includes('fake-secret'));
  assert.equal(ks.load('gemini'), 'fake-secret-key-12345678901234');
  assert.equal(ks.remembered('gemini'), false);
});

test('key store: session by default, local only on opt-in, switching moves it, clear removes both', () => {
  const sess = fakeBackend();
  const location = fakeBackend();
  const ks = createKeyStore({ session: sess, local: location });
  ks.save('gemini', 'k1', false);
  assert.equal(sess.getItem('fieldwise.key.gemini'), 'k1');
  assert.equal(location.getItem('fieldwise.key.gemini'), null);
  ks.save('gemini', 'k2', true);
  assert.equal(sess.getItem('fieldwise.key.gemini'), null);
  assert.equal(location.getItem('fieldwise.key.gemini'), 'k2');
  assert.equal(ks.remembered('gemini'), true);
  ks.clear('gemini');
  assert.equal(ks.load('gemini'), '');
  const dead = createKeyStore({ session: { getItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } }, local: { getItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } } });
  assert.equal(dead.load('gemini'), '');
});

test('sanitizeStore de-duplicates ids and caps profile count', () => {
  const a = sampleProfile();
  const s = sanitizeStore({ profiles: [a, a, ...Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }))] });
  assert.ok(s.profiles.length <= 25);
  assert.equal(new Set(s.profiles.map((p) => p.id)).size, s.profiles.length);
});

import { sanitizePrefs as _sp, DEFAULT_COMPARE_WEIGHTS as _dw } from '../src/storage.js';
test('compare weights are clamped, defaulted, and never all zero', () => {
  assert.deepEqual(_sp({}).compareWeights, _dw);
  assert.deepEqual(_sp({ compareWeights: { profit: 500, fit: -4, risk: 'x', startup: 20 } }).compareWeights, { profit: 100, fit: 0, risk: 20, startup: 20 });
  assert.deepEqual(_sp({ compareWeights: { profit: 0, fit: 0, risk: 0, startup: 0 } }).compareWeights, _dw);
});

import { sanitizeProfile as _sprof } from '../src/storage.js';
test('assumption overrides are limited to safe ranges and unknown keys are dropped', () => {
  const p = _sprof({ id: 'prof_x', name: 'x', overrides: { assumptions: { startFraction: 5, yearsProjected: 99.6, roadsBuildingsShare: -1, evil: '__proto__' } } });
  assert.deepEqual(p.overrides.assumptions, { startFraction: 1, yearsProjected: 10, roadsBuildingsShare: 0 });
  assert.deepEqual(_sprof({ id: 'prof_y', name: 'y' }).overrides.assumptions, {});
});
