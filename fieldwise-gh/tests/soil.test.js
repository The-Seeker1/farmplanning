import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSdaQuery, sdaRows, parseSda, parseSoilGrids, geocode, lookupSoil, sanitizeSoil } from '../src/soil.js';
import { fetchJson, hostAllowed } from '../src/net.js';

const H = ['mukey', 'muname', 'cokey', 'compname', 'comppct_r', 'drainagecl', 'slope_r', 'hydgrp', 'hzdept_r', 'hzdepb_r', 'ph1to1h2o_r', 'om_r', 'sandtotal_r', 'silttotal_r', 'claytotal_r', 'awc_r', 'resdept_r'];
const sdaFixture = {
  Table: [
    H,
    ['1', 'Kennebec silt loam, 0 to 2 percent slopes', '100', 'Kennebec', '85', 'Moderately well drained', '1', 'B', '0', '20', '6.4', '3.0', '10', '68', '22', '0.22', null],
    ['1', 'Kennebec silt loam, 0 to 2 percent slopes', '100', 'Kennebec', '85', 'Moderately well drained', '1', 'B', '20', '41', '6.8', '2.0', '10', '60', '30', '0.20', null],
    ['1', 'Kennebec silt loam, 0 to 2 percent slopes', '100', 'Kennebec', '85', 'Moderately well drained', '1', 'B', '41', '90', '7.0', '1.0', '8', '58', '34', '0.20', null],
    ['1', 'Kennebec silt loam, 0 to 2 percent slopes', '200', 'Other', '15', 'Poorly drained', '3', 'D', '0', '25', '8.0', '1.0', '20', '40', '40', '0.15', '45'],
  ],
};

test('SDA query contains only numbers from the caller and the expected joins', () => {
  const q = buildSdaQuery(39.0473, -95.6752);
  assert.match(q, /POINT\(-95\.675200 39\.047300\)/);
  assert.match(q, /majcompflag = 'Yes'/);
  assert.match(q, /ORDER BY c\.comppct_r DESC/);
  assert.throws(() => buildSdaQuery("39'; DROP TABLE x;--", 1));
  assert.throws(() => buildSdaQuery(100, 0));
  assert.throws(() => buildSdaQuery(NaN, 0));
});

test('sdaRows turns the header + rows table into objects, and tolerates empty results', () => {
  const rows = sdaRows(sdaFixture);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].compname, 'Kennebec');
  assert.deepEqual(sdaRows({}), []);
  assert.deepEqual(sdaRows({ Table: [H] }), []);
  assert.deepEqual(sdaRows(null), []);
});

test('parseSda: dominant component, thickness-weighted over 0-30 cm', () => {
  const r = parseSda(sdaFixture);
  assert.equal(r.ph, 6.5);
  assert.equal(r.om, 2.7);
  assert.equal(r.sand, 10);
  assert.equal(r.silt, 65);
  assert.equal(r.clay, 25);
  assert.equal(r.texture, 'silt_loam');
  assert.equal(r.drainage, 'moderate');
  assert.equal(r.slopePct, 1);
  assert.equal(r.depthIn, 60);
  assert.equal(r.componentPct, 85);
  assert.equal(r.source, 'ssurgo');
  assert.match(r.notes.join(' '), /treated as deep/);
  assert.equal(parseSda({}), null);
});

test('parseSda converts a recorded restrictive depth from cm to inches', () => {
  const fx = { Table: [H, ['1', 'Shallow', '9', 'Shallow', '90', 'Well drained', '8', 'C', '0', '25', '7.2', '2', '30', '40', '30', '0.1', '50']] };
  const r = parseSda(fx);
  assert.equal(r.depthIn, 20);
  assert.equal(r.drainage, 'well');
});

test('parseSoilGrids applies d_factor and converts SOC to organic matter', () => {
  const layer = (name, d, vals) => ({ name, unit_measure: { d_factor: d }, depths: ['0-5cm', '5-15cm', '15-30cm'].map((label, i) => ({ label, values: { mean: vals[i] } })) });
  const fx = {
    properties: {
      layers: [
        layer('phh2o', 10, [66, 66, 66]),
        layer('soc', 10, [200, 200, 200]),
        layer('sand', 10, [120, 120, 120]),
        layer('silt', 10, [600, 600, 600]),
        layer('clay', 10, [280, 280, 280]),
      ],
    },
  };
  const r = parseSoilGrids(fx);
  assert.equal(r.ph, 6.6);
  assert.equal(r.om, 3.4);
  assert.equal(r.sand, 12);
  assert.equal(r.silt, 60);
  assert.equal(r.clay, 28);
  assert.equal(r.texture, 'silty_clay_loam');
  assert.equal(r.drainage, null);
  assert.equal(r.confidence, 'model');
  assert.equal(parseSoilGrids({}), null);
});

test('sanitizeSoil blanks impossible numbers instead of passing them on', () => {
  const r = sanitizeSoil({ ph: 66, om: 3, sand: 120, silt: 10, clay: 10, slopePct: -4, depthIn: 9999 });
  assert.equal(r.ph, null);
  assert.equal(r.sand, null);
  assert.equal(r.slopePct, null);
  assert.equal(r.depthIn, null);
  assert.equal(r.om, 3);
});

const okRes = (body, status = 200, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

test('fetchJson only allows https and allowlisted hosts', async () => {
  await assert.rejects(fetchJson('http://nominatim.openstreetmap.org/x', { fetchImpl: async () => okRes({}) }), (e) => e.kind === 'blocked');
  await assert.rejects(fetchJson('https://evil.example.com/x', { fetchImpl: async () => okRes({}) }), (e) => e.kind === 'blocked');
  await assert.rejects(fetchJson('not a url'), (e) => e.kind === 'blocked');
  assert.ok(!hostAllowed('my-proxy.someone.workers.dev'));
  assert.ok(hostAllowed('nominatim.openstreetmap.org'));
  const r = await fetchJson('https://nominatim.openstreetmap.org/x', { fetchImpl: async () => okRes({ a: 1 }) });
  assert.deepEqual(r, { a: 1 });
});

test('fetchJson maps status codes to typed errors and never follows creds', async () => {
  let seen;
  const fakeFetch = (status, body = {}) => async (url, init) => {
    seen = init;
    return okRes(body, status, status === 429 ? { 'retry-after': '30' } : {});
  };
  await assert.rejects(fetchJson('https://rest.isric.org/x', { fetchImpl: fakeFetch(429) }), (e) => e.kind === 'quota' && e.retryAfter === 30);
  await assert.rejects(fetchJson('https://rest.isric.org/x', { fetchImpl: fakeFetch(403, { error: { message: 'API key not valid' } }) }), (e) => e.kind === 'auth' && /not valid/.test(e.detail));
  await assert.rejects(fetchJson('https://rest.isric.org/x', { fetchImpl: fakeFetch(500) }), (e) => e.kind === 'http' && e.status === 500);
  assert.equal(seen.credentials, 'omit');
  assert.equal(seen.referrerPolicy, 'no-referrer');
});

test('fetchJson enforces size and parse limits and timeouts', async () => {
  await assert.rejects(fetchJson('https://rest.isric.org/x', { maxBytes: 10, fetchImpl: async () => okRes('x'.repeat(50)) }), (e) => e.kind === 'toolarge');
  await assert.rejects(fetchJson('https://rest.isric.org/x', { fetchImpl: async () => okRes('<html>') }), (e) => e.kind === 'parse');
  const slow = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(fetchJson('https://rest.isric.org/x', { timeoutMs: 20, fetchImpl: slow }), (e) => e.kind === 'timeout');
  await assert.rejects(fetchJson('https://rest.isric.org/x', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), (e) => e.kind === 'network');
});

test('geocode returns the first US hit and rejects short or out-of-area results', async () => {
  const hit = [{ lat: '39.0473', lon: '-95.6752', display_name: 'Topeka, Shawnee County, Kansas, United States' }];
  const g = await geocode('900 SW Jackson St, Topeka, KS', { fetchImpl: async () => okRes(hit) });
  assert.equal(g.lat, 39.0473);
  assert.equal(g.region, 'east');
  assert.equal(await geocode('900 SW Jackson St, Topeka, KS', { fetchImpl: async () => okRes([]) }), null);
  assert.equal(await geocode('somewhere far', { fetchImpl: async () => okRes([{ lat: '48.85', lon: '2.35', display_name: 'Paris' }]) }), null);
  await assert.rejects(geocode('ab'), (e) => e.kind === 'blocked');
});

test('lookupSoil falls back to SoilGrids when SDA is unreachable (CORS) and reports both attempts', async () => {
  const layer = (name, d, v) => ({ name, unit_measure: { d_factor: d }, depths: ['0-5cm', '5-15cm', '15-30cm'].map((label) => ({ label, values: { mean: v } })) });
  const sg = { properties: { layers: [layer('phh2o', 10, 71), layer('soc', 10, 150), layer('sand', 10, 300), layer('silt', 10, 400), layer('clay', 10, 300)] } };
  const fakeFetch = async (url) => {
    if (url.includes('sdmdataaccess')) throw new TypeError('Failed to fetch');
    return okRes(sg);
  };
  const { reading, tried } = await lookupSoil(39.0, -95.7, { fetchImpl: fakeFetch });
  assert.equal(reading.source, 'soilgrids');
  assert.equal(reading.ph, 7.1);
  assert.deepEqual(tried.map((t) => [t.source, t.ok]), [['ssurgo', false], ['soilgrids', true]]);
  assert.equal(tried[0].kind, 'network');
});

test('lookupSoil prefers SSURGO', async () => {
  let calledUrl;
  const fakeFetch = async (url) => {
    calledUrl = url;
    return okRes(sdaFixture);
  };
  const a = await lookupSoil(39.0, -95.7, { fetchImpl: fakeFetch });
  assert.equal(a.reading.source, 'ssurgo');
  assert.match(calledUrl, /sdmdataaccess/);
  const none = await lookupSoil(39.0, -95.7, { fetchImpl: async () => { throw new TypeError('offline'); } });
  assert.equal(none.reading, null);
  assert.equal(none.tried.length, 2);
});
