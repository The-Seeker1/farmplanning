import { fetchJson, NetError } from './net.js';
import { textureClass, normalizeDrainage } from './soilfit.js';
import { inferRegion } from './planner.js';

const SDA_URL = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const SOILGRIDS = 'https://rest.isric.org/soilgrids/v2.0/properties/query';

const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function buildSdaQuery(lat, lon) {
  const latNumber = Number(lat);
  const lonNumber = Number(lon);
  if (!Number.isFinite(latNumber) || !Number.isFinite(lonNumber) || Math.abs(latNumber) > 90 || Math.abs(lonNumber) > 180) throw new Error('Invalid coordinates');
  return [
    'SELECT mu.mukey, mu.muname, c.cokey, c.compname, c.comppct_r, c.drainagecl, c.slope_r, c.hydgrp,',
    'h.hzdept_r, h.hzdepb_r, h.ph1to1h2o_r, h.om_r, h.sandtotal_r, h.silttotal_r, h.claytotal_r, h.awc_r,',
    '(SELECT MIN(cr.resdept_r) FROM corestrictions cr WHERE cr.cokey = c.cokey) AS resdept_r',
    'FROM mapunit mu',
    'INNER JOIN component c ON c.mukey = mu.mukey',
    'INNER JOIN chorizon h ON h.cokey = c.cokey',
    `WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(${lonNumber.toFixed(6)} ${latNumber.toFixed(6)})'))`,
    "AND c.majcompflag = 'Yes' AND h.hzdept_r < 30",
    'ORDER BY c.comppct_r DESC, c.cokey, h.hzdept_r',
  ].join(' ');
}

export function sdaRows(json) {
  const t = json?.Table;
  if (!Array.isArray(t) || t.length < 2) return [];
  const head = t[0];
  return t.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [String(h).toLowerCase(), r[i]])));
}

function weighted(rows, key) {
  let sum = 0;
  let w = 0;
  for (const r of rows) {
    const v = toNumber(r[key]);
    if (v === null) continue;
    const top = Math.max(0, toNumber(r.hzdept_r) ?? 0);
    const bottom = Math.min(30, toNumber(r.hzdepb_r) ?? top);
    const t = bottom - top;
    if (t <= 0) continue;
    sum += v * t;
    w += t;
  }
  return w > 0 ? sum / w : null;
}

const inRange = (v, lonNumber, high) => (v == null || !Number.isFinite(v) || v < lonNumber || v > high ? null : v);

export function sanitizeSoil(r) {
  if (!r) return r;
  return {
    ...r,
    ph: inRange(r.ph, 3, 10.5),
    om: inRange(r.om, 0, 100),
    sand: inRange(r.sand, 0, 100),
    silt: inRange(r.silt, 0, 100),
    clay: inRange(r.clay, 0, 100),
    slopePct: inRange(r.slopePct, 0, 100),
    depthIn: inRange(r.depthIn, 0, 400),
  };
}

export function parseSda(json) {
  const rows = sdaRows(json);
  if (!rows.length) return null;
  const firstCo = rows[0].cokey;
  const mine = rows.filter((r) => r.cokey === firstCo);
  const head = mine[0];
  const ph = weighted(mine, 'ph1to1h2o_r');
  const organicMatter = weighted(mine, 'om_r');
  const sand = weighted(mine, 'sandtotal_r');
  const silt = weighted(mine, 'silttotal_r');
  const clay = weighted(mine, 'claytotal_r');
  const waterCapacity = weighted(mine, 'awc_r');
  const resCm = toNumber(head.resdept_r);
  const notes = [];
  if (resCm === null) notes.push('No restrictive layer is recorded for this soil, so it is treated as deep.');
  const reading = {
    source: 'ssurgo',
    confidence: 'map',
    ph: round(ph, 1),
    om: round(organicMatter, 1),
    sand: round(sand, 0),
    silt: round(silt, 0),
    clay: round(clay, 0),
    texture: textureClass(sand, silt, clay),
    drainage: normalizeDrainage(head.drainagecl),
    slopePct: round(toNumber(head.slope_r), 0),
    depthIn: resCm === null ? 60 : round(resCm / 2.54, 0),
    awc: round(waterCapacity, 2),
    hydgrp: head.hydgrp || null,
    mapUnit: String(head.muname || '').slice(0, 120),
    component: String(head.compname || '').slice(0, 60),
    componentPct: toNumber(head.comppct_r),
    notes,
  };
  return sanitizeSoil(reading);
}

export function parseSoilGrids(json) {
  const layers = json?.properties?.layers;
  if (!Array.isArray(layers)) return null;
  const thickness = { '0-5cm': 5, '5-15cm': 10, '15-30cm': 15 };
  const getValue = (name) => {
    const layer = layers.find((l) => l.name === name);
    if (!layer) return null;
    const f = toNumber(layer.unit_measure?.d_factor) || 1;
    let s = 0;
    let w = 0;
    for (const d of layer.depths || []) {
      const t = thickness[d.label];
      const v = toNumber(d.values?.mean);
      if (!t || v === null) continue;
      s += (v / f) * t;
      w += t;
    }
    return w > 0 ? s / w : null;
  };
  const ph = getValue('phh2o');
  const carbonGramsPerKg = getValue('soc');
  const sandPct = getValue('sand');
  const siltPct = getValue('silt');
  const clayPct = getValue('clay');
  if (ph === null && carbonGramsPerKg === null && sandPct === null) return null;
  const organicMatter = carbonGramsPerKg == null ? null : (carbonGramsPerKg / 10) * 1.724;
  return sanitizeSoil({
    source: 'soilgrids',
    confidence: 'model',
    ph: round(ph, 1),
    om: round(organicMatter, 1),
    sand: round(sandPct, 0),
    silt: round(siltPct, 0),
    clay: round(clayPct, 0),
    texture: textureClass(sandPct, siltPct, clayPct),
    drainage: null,
    slopePct: null,
    depthIn: null,
    awc: null,
    hydgrp: null,
    mapUnit: 'SoilGrids 250 m model estimate',
    component: '',
    componentPct: null,
    notes: ['SoilGrids is a computer model at 250 m resolution. Use it as a starting guess and enter a lab pH if you have one. It does not provide drainage, slope or soil depth.'],
  });
}

export async function geocode(address, options = {}) {
  const q = String(address || '').trim().slice(0, 200);
  if (q.length < 5) throw new NetError('blocked', 'Type a fuller address (street, city, state).');
  const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=us&addressdetails=0&q=${encodeURIComponent(q)}`;
  const json = await fetchJson(url, { referrerPolicy: 'origin', timeoutMs: 12000, ...options });
  const hit = Array.isArray(json) ? json[0] : null;
  if (!hit) return null;
  const lat = toNumber(hit.lat);
  const lon = toNumber(hit.lon);
  if (lat === null || lon === null || lat < 24 || lat > 50 || lon < -125 || lon > -66) return null;
  return { lat, lon, label: String(hit.display_name || '').slice(0, 200), region: inferRegion(lon) };
}

export async function fetchSsurgo(lat, lon, options = {}) {
  const query = buildSdaQuery(lat, lon);
  const json = await fetchJson(SDA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'JSON+COLUMNNAME', query }),
    timeoutMs: 20000,
    ...options,
  });
  return parseSda(json);
}

export async function fetchSoilGrids(lat, lon, options = {}) {
  const latNumber = Number(lat);
  const lonNumber = Number(lon);
  if (!Number.isFinite(latNumber) || !Number.isFinite(lonNumber)) throw new Error('Invalid coordinates');
  const props = ['phh2o', 'soc', 'sand', 'silt', 'clay'].map((p) => `property=${p}`).join('&');
  const depths = ['0-5cm', '5-15cm', '15-30cm'].map((d) => `depth=${d}`).join('&');
  const url = `${SOILGRIDS}?lon=${lonNumber.toFixed(5)}&lat=${latNumber.toFixed(5)}&${props}&${depths}&value=mean`;
  const json = await fetchJson(url, { timeoutMs: 25000, ...options });
  return parseSoilGrids(json);
}

export async function lookupSoil(lat, lon, { fetchImpl } = {}) {
  const tried = [];
  const extra = fetchImpl ? { fetchImpl } : {};
  try {
    const reading = await fetchSsurgo(lat, lon, extra);
    tried.push({ source: 'ssurgo', ok: !!reading });
    if (reading) return { reading, tried };
  } catch (e) {
    tried.push({ source: 'ssurgo', ok: false, error: e?.message || String(e), kind: e?.kind });
  }
  try {
    const reading = await fetchSoilGrids(lat, lon, extra);
    tried.push({ source: 'soilgrids', ok: !!reading });
    if (reading) return { reading, tried };
  } catch (e) {
    tried.push({ source: 'soilgrids', ok: false, error: e?.message || String(e), kind: e?.kind });
  }
  return { reading: null, tried };
}
