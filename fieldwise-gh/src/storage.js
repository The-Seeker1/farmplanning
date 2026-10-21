import { cleanText, clampNum, pickEnum } from './ai/validate.js';
import { validatePhotoAnalysis } from './ai/validate.js';
import { TEXTURE_CLASSES, DRAINAGE_CLASSES } from './soilfit.js';
import { LIVESTOCK } from './data/livestock.js';
import { CROPS, VEGETABLES } from './data/crops.js';
import { FENCES } from './data/fences.js';
import { sanitizePoint, ensureCCW } from './geo.js';
import { newId } from './planner.js';

export const SCHEMA_VERSION = 1;
export const STORE_KEY = 'fieldwise.store.v1';
export const MAX_STORE_BYTES = 4_000_000;
export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_PROFILES = 25;

export const ZONE_USES = ['pasture', 'crop', 'garden', 'buildings', 'water', 'woods', 'exclude'];
export const FEATURE_KINDS = ['barn', 'house', 'tank', 'tree', 'gate', 'shade'];
export const MARKER_KINDS = [...Object.keys(LIVESTOCK), ...FEATURE_KINDS];
export const WATER_SOURCES = ['well', 'rural_water', 'pond', 'creek', 'none'];
export const SOIL_SOURCES = ['manual', 'ssurgo', 'soilgrids', 'photo'];

const ID_RE = /^[A-Za-z0-9_-]{1,48}$/;
const safeId = (v, prefix) => (typeof v === 'string' && ID_RE.test(v) ? v : newId(prefix));
const bool = (v) => v === true;
const intIn = (v, low, high, d) => {
  const n = clampNum(v, low, high, null);
  return n === null ? d : Math.round(n);
};

function points(list, max, min = 0) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list.slice(0, max)) {
    const s = sanitizePoint(p);
    if (s) out.push(s);
  }
  return out.length >= min ? out : [];
}

function sanitizeSoilBlock(s) {
  const r = s && typeof s === 'object' ? s : {};
  return {
    ph: clampNum(r.ph, 3, 10.5),
    om: clampNum(r.om, 0, 100),
    texture: TEXTURE_CLASSES.includes(r.texture) ? r.texture : null,
    drainage: DRAINAGE_CLASSES.includes(r.drainage) ? r.drainage : null,
    slopePct: clampNum(r.slopePct, 0, 100),
    depthIn: clampNum(r.depthIn, 0, 400),
    sand: clampNum(r.sand, 0, 100),
    silt: clampNum(r.silt, 0, 100),
    clay: clampNum(r.clay, 0, 100),
    source: pickEnum(r.source, SOIL_SOURCES, 'manual'),
    mapUnit: cleanText(r.mapUnit, 120),
    notes: (Array.isArray(r.notes) ? r.notes : []).map((n) => cleanText(n, 300)).filter(Boolean).slice(0, 5),
  };
}

function sanitizeLand(l) {
  const r = l && typeof l === 'object' ? l : {};
  const boundary = points(r.boundary, 500, 3);
  const location = r.location && typeof r.location === 'object' ? r.location : null;
  const lat = clampNum(location?.lat, 24, 50);
  const lon = clampNum(location?.lon, -125, -66);
  const originLat = clampNum(r.origin?.lat, 24, 50);
  const originLon = clampNum(r.origin?.lon, -125, -66);
  return {
    name: cleanText(r.name, 80) || 'My land',
    region: pickEnum(r.region, ['east', 'west'], 'east'),
    zone: r.zone === 4 ? 4 : 3,
    location: lat !== null && lon !== null ? { label: cleanText(location.label, 200), lat, lon } : null,
    origin: originLat !== null && originLon !== null ? { lat: originLat, lon: originLon } : null,
    boundary: boundary.length >= 3 ? ensureCCW(boundary) : [],
    soil: sanitizeSoilBlock(r.soil),
    waterSource: pickEnum(r.waterSource, WATER_SOURCES, null),
    zones: (Array.isArray(r.zones) ? r.zones : []).slice(0, 60).map((z) => ({
      id: safeId(z?.id, 'zone'),
      name: cleanText(z?.name, 60) || 'Zone',
      use: pickEnum(z?.use, ZONE_USES, 'pasture'),
      polygon: points(z?.polygon, 300, 3),
    })).filter((z) => z.polygon.length >= 3),
    fences: (Array.isArray(r.fences) ? r.fences : []).slice(0, 120).map((f) => ({
      id: safeId(f?.id, 'fence'),
      name: cleanText(f?.name, 60) || 'Fence',
      type: Object.hasOwn(FENCES, f?.type) ? f.type : 'barbed5',
      line: points(f?.line, 500, 2),
      closed: bool(f?.closed),
      gates: intIn(f?.gates, 0, 20, 1),
    })).filter((f) => f.line.length >= 2),
    markers: (Array.isArray(r.markers) ? r.markers : []).slice(0, 600).map((m) => {
      const p = sanitizePoint(m);
      return p && MARKER_KINDS.includes(m?.kind) ? { id: safeId(m?.id, 'mk'), kind: m.kind, x: p.x, y: p.y, label: cleanText(m?.label, 40) } : null;
    }).filter(Boolean),
    photos: (Array.isArray(r.photos) ? r.photos : []).slice(0, 12).map((p) => ({
      id: safeId(p?.id, 'ph'),
      ts: clampNum(p?.ts, 0, 4e12, 0),
      engine: pickEnum(p?.engine, ['baseline', 'gemini'], 'baseline'),
      kind: pickEnum(p?.kind, ['ground', 'aerial', 'satellite'], 'ground'),
      summary: validatePhotoAnalysis(p?.summary),
    })),
  };
}

function sanitizePlan(p) {
  const r = p && typeof p === 'object' ? p : {};
  const allocations = (Array.isArray(r.allocations) ? r.allocations : []).slice(0, 40).map((a) => {
    const kind = pickEnum(a?.kind, ['livestock', 'crop', 'garden'], null);
    if (!kind) return null;
    if (kind === 'livestock' && !Object.hasOwn(LIVESTOCK, a?.item)) return null;
    if (kind === 'crop' && !Object.hasOwn(CROPS, a?.item)) return null;
    const out = { id: safeId(a?.id, 'al'), kind, acres: clampNum(a?.acres, 0, 100000, 0), zoneId: typeof a?.zoneId === 'string' && ID_RE.test(a.zoneId) ? a.zoneId : null };
    if (kind === 'garden') {
      out.vegetables = {};
      for (const [vegetableId, share] of Object.entries(a?.vegetables && typeof a.vegetables === 'object' ? a.vegetables : {})) {
        if (Object.hasOwn(VEGETABLES, vegetableId)) {
          const n = clampNum(share, 0, 1, 0);
          if (n > 0) out.vegetables[vegetableId] = n;
        }
      }
    } else {
      out.item = a.item;
    }
    if (kind === 'livestock') {
      const h = clampNum(a?.heads, 0, 1e6, null);
      out.heads = h === null ? null : Math.floor(h);
    }
    return out;
  }).filter(Boolean);
  return {
    id: safeId(r.id, 'plan'),
    name: cleanText(r.name, 60) || 'Plan',
    notes: cleanText(r.notes, 600),
    grazing: pickEnum(r.grazing, ['continuous', 'rotational'], 'rotational'),
    fenceBoundary: bool(r.fenceBoundary),
    boundaryFence: Object.hasOwn(FENCES, r.boundaryFence) ? r.boundaryFence : 'barbed5',
    boundaryGates: intIn(r.boundaryGates, 0, 20, 1),
    allocations,
  };
}

function numMap(object, ids, fields, high = 1e7) {
  const out = {};
  if (!object || typeof object !== 'object') return out;
  for (const id of ids) {
    const source = Object.hasOwn(object, id) ? object[id] : null;
    if (!source || typeof source !== 'object') continue;
    const row = {};
    for (const f of fields) {
      const n = clampNum(source[f], 0, high, null);
      if (n !== null) row[f] = n;
    }
    if (Object.keys(row).length) out[id] = row;
  }
  return out;
}

function sanitizeOverrides(o) {
  const r = o && typeof o === 'object' ? o : {};
  const out = {
    livestock: numMap(r.livestock, Object.keys(LIVESTOCK), ['purchase', 'annualCost', 'annualRevenue', 'shelter']),
    crops: numMap(r.crops, Object.keys(CROPS), ['price', 'costPerAcre']),
    fence: numMap(r.fence, Object.keys(FENCES), ['costPerFt'], 1000),
    vegetables: numMap(r.vegetables, Object.keys(VEGETABLES), ['price'], 1000),
  };
  const gate = clampNum(r.gateCost, 0, 1e5, null);
  if (gate !== null) out.gateCost = gate;
  const a = r.assumptions && typeof r.assumptions === 'object' ? r.assumptions : {};
  const assumptions = {};
  const startShare = clampNum(a.startFraction, 0.25, 1, null);
  if (startShare !== null) assumptions.startFraction = startShare;
  const years = clampNum(a.yearsProjected, 1, 10, null);
  if (years !== null) assumptions.yearsProjected = Math.round(years);
  const roadsShare = clampNum(a.roadsBuildingsShare, 0, 0.5, null);
  if (roadsShare !== null) assumptions.roadsBuildingsShare = roadsShare;
  out.assumptions = assumptions;
  return out;
}

function sanitizeLearning(l) {
  const r = l && typeof l === 'object' ? l : {};
  const weak = {};
  if (r.weakTopics && typeof r.weakTopics === 'object') {
    for (const [k, v] of Object.entries(r.weakTopics).slice(0, 20)) {
      if (/^[a-z_]{2,20}$/.test(k)) weak[k] = intIn(v, 0, 999, 0);
    }
  }
  return {
    weakTopics: weak,
    quizHistory: (Array.isArray(r.quizHistory) ? r.quizHistory : []).slice(-50).map((q) => ({
      ts: clampNum(q?.ts, 0, 4e12, 0),
      score: intIn(q?.score, 0, 50, 0),
      total: intIn(q?.total, 0, 50, 0),
      source: pickEnum(q?.source, ['template', 'ai'], 'template'),
    })),
  };
}

export function newProfile(name = 'My farm') {
  const now = Date.now();
  return sanitizeProfile({
    id: newId('prof'),
    name,
    createdAt: now,
    updatedAt: now,
    land: { name: 'My land', soil: {}, zones: [], fences: [], markers: [], photos: [] },
    plans: [],
    overrides: {},
    learning: {},
  });
}

export function sanitizeProfile(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('That is not a FieldWise profile.');
  const plans = (Array.isArray(response.plans) ? response.plans : []).slice(0, 20).map(sanitizePlan);
  return {
    id: safeId(response.id, 'prof'),
    name: cleanText(response.name, 60) || 'My farm',
    createdAt: clampNum(response.createdAt, 0, 4e12, Date.now()),
    updatedAt: clampNum(response.updatedAt, 0, 4e12, Date.now()),
    land: sanitizeLand(response.land),
    plans,
    activePlanId: plans.some((p) => p.id === response.activePlanId) ? response.activePlanId : plans[0]?.id || null,
    overrides: sanitizeOverrides(response.overrides),
    learning: sanitizeLearning(response.learning),
  };
}

export function sanitizePrefs(p) {
  const r = p && typeof p === 'object' ? p : {};
  return {
    provider: pickEnum(r.provider, ['gemini'], 'gemini'),
    model: typeof r.model === 'string' && /^[a-z0-9][a-z0-9._-]{1,60}$/i.test(r.model) ? r.model : 'gemini-flash-latest',
    rememberKey: bool(r.rememberKey),
    ageConfirmed: bool(r.ageConfirmed),
    sendPhotosToAI: bool(r.sendPhotosToAI),
    seenWelcome: bool(r.seenWelcome),
    compareWeights: sanitizeWeights(r.compareWeights),
  };
}

export const DEFAULT_COMPARE_WEIGHTS = { profit: 35, fit: 30, risk: 20, startup: 15 };
function sanitizeWeights(w) {
  const r = w && typeof w === 'object' ? w : {};
  const out = {};
  for (const k of Object.keys(DEFAULT_COMPARE_WEIGHTS)) out[k] = intIn(r[k], 0, 100, DEFAULT_COMPARE_WEIGHTS[k]);
  if (Object.values(out).every((v) => v === 0)) return { ...DEFAULT_COMPARE_WEIGHTS };
  return out;
}

export function emptyStore() {
  const p = newProfile('My farm');
  return { version: SCHEMA_VERSION, activeProfileId: p.id, profiles: [p], prefs: sanitizePrefs({}) };
}

export function sanitizeStore(response) {
  if (!response || typeof response !== 'object') return emptyStore();
  let profiles = [];
  for (const p of (Array.isArray(response.profiles) ? response.profiles : []).slice(0, MAX_PROFILES)) {
    try {
      profiles.push(sanitizeProfile(p));
    } catch {}
  }
  const seen = new Set();
  profiles = profiles.filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
  if (!profiles.length) return emptyStore();
  return {
    version: SCHEMA_VERSION,
    activeProfileId: profiles.some((p) => p.id === response.activeProfileId) ? response.activeProfileId : profiles[0].id,
    profiles,
    prefs: sanitizePrefs(response.prefs),
  };
}

export function createStorage(backend = globalThis.localStorage) {
  let memory = null;
  let persistent = true;
  const get = () => {
    try {
      return backend.getItem(STORE_KEY);
    } catch {
      persistent = false;
      return memory;
    }
  };
  return {
    get persistent() {
      return persistent;
    },
    load() {
      const text = get();
      if (!text) return emptyStore();
      try {
        return sanitizeStore(JSON.parse(text));
      } catch {
        return emptyStore();
      }
    },
    save(store) {
      const text = JSON.stringify(sanitizeStore(store));
      if (text.length > MAX_STORE_BYTES) throw new Error('Your saved data is too large. Export and delete old profiles.');
      memory = text;
      try {
        backend.setItem(STORE_KEY, text);
        persistent = true;
      } catch {
        persistent = false;
      }
      return text.length;
    },
    clear() {
      memory = null;
      try {
        backend.removeItem(STORE_KEY);
      } catch {}
    },
  };
}

export function exportProfileJson(profile, { includeLocation = false } = {}) {
  const clean = sanitizeProfile(profile);
  if (!includeLocation) {
    clean.land.location = null;
    clean.land.origin = null;
  }
  return JSON.stringify({ format: 'fieldwise-profile', version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), profile: clean }, null, 2);
}

export function importProfileJson(text) {
  if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) throw new Error('That file is too large to be a FieldWise profile.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (data?.format !== 'fieldwise-profile' || !data.profile) throw new Error('That file is not a FieldWise profile export.');
  if (typeof data.version === 'number' && data.version > SCHEMA_VERSION) throw new Error('That profile was made by a newer version of FieldWise.');
  const p = sanitizeProfile(data.profile);
  return { ...p, id: newId('prof'), name: `${p.name} (imported)`.slice(0, 60), updatedAt: Date.now() };
}

export function createKeyStore({ session = globalThis.sessionStorage, local = globalThis.localStorage } = {}) {
  const name = (provider) => `fieldwise.key.${provider}`;
  const safe = (listener, fallback = null) => {
    try {
      return listener();
    } catch {
      return fallback;
    }
  };
  return {
    save(provider, key, remember = false) {
      safe(() => session.removeItem(name(provider)));
      safe(() => local.removeItem(name(provider)));
      (remember ? local : session).setItem(name(provider), key);
    },
    load(provider) {
      return safe(() => session.getItem(name(provider))) || safe(() => local.getItem(name(provider))) || '';
    },
    remembered(provider) {
      return !!safe(() => local.getItem(name(provider)));
    },
    clear(provider) {
      safe(() => session.removeItem(name(provider)));
      safe(() => local.removeItem(name(provider)));
    },
  };
}
