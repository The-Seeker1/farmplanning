import { LIVESTOCK, getLivestock } from './data/livestock.js';
import { CROPS } from './data/crops.js';
import { getFence } from './data/fences.js';
import { FEATURE_KINDS } from './storage.js';
import { polygonArea, orientedBoundingBox, scatterInPolygon, fencePosts, fromFeet, polygonCentroid, bbox, pointInPolygon, seededRng } from './geo.js';
import { autoPartition, scanlines } from './layout.js';
import { boundaryAcres } from './planner.js';
import { pastureSoilFit } from './soilfit.js';

export const SLOPE_WORD_PCT = { flat: 1, gentle: 3, moderate: 8, steep: 15 };
export const MAX_ICONS_PER_SPECIES = 120;

export const CROP_LOOK = {
  wheat: { color: 0xd8c25a, height: 0.9 },
  corn: { color: 0x5c9a38, height: 1.9 },
  soybeans: { color: 0x72b24c, height: 0.7 },
  sorghum: { color: 0xb7603b, height: 1.5 },
  alfalfa: { color: 0x4d8c3b, height: 0.7 },
  hay: { color: 0x8dab4a, height: 0.8 },
};

export function latestPhotoSummary(land) {
  const photos = [...(land?.photos || [])].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return photos[0]?.summary || null;
}

export function effectiveSlopePct(land) {
  if (Number.isFinite(land?.soil?.slopePct)) return land.soil.slopePct;
  for (const p of [...(land?.photos || [])].sort((a, b) => (b.ts || 0) - (a.ts || 0))) {
    const w = p.summary?.slope;
    if (w && SLOPE_WORD_PCT[w]) return SLOPE_WORD_PCT[w];
  }
  return 1;
}

export function vegetationTone(land) {
  const photo = latestPhotoSummary(land);
  if (photo && photo.vegetationCondition && photo.vegetationCondition !== 'unknown') return { tone: photo.vegetationCondition, from: 'photo' };
  const fit = pastureSoilFit(land?.soil || {}, land?.region).fit;
  return { tone: fit >= 0.8 ? 'good' : fit >= 0.55 ? 'fair' : 'poor', from: 'soil' };
}

export function heightAt(t, x, y) {
  const s = t.slopePct / 100;
  const tilt = (x * Math.cos(t.dirAngle) + y * Math.sin(t.dirAngle)) * s;
  const bump = t.bumpiness * (Math.sin(x * 0.021 + t.seed) * Math.cos(y * 0.017 + t.seed * 1.7) + 0.5 * Math.sin((x + y) * 0.043 + t.seed * 2.3));
  return tilt + bump - t.base;
}

function makeTerrain(land, center) {
  const slopePct = effectiveSlopePct(land);
  const t = { slopePct, dirAngle: 0.6, bumpiness: Math.min(3.5, 0.3 + slopePct * 0.18), seed: 3.1, base: 0 };
  t.base = heightAt(t, center.x, center.y);
  return t;
}

function spiral(center, n, radius, random) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const r = radius * Math.sqrt((k + 0.5) / n);
    const a = k * 2.399963 + random() * 0.6;
    out.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  return out;
}

function pullInside(p, polygon, center) {
  if (pointInPolygon(p, polygon)) return p;
  let q = p;
  for (let i = 0; i < 12; i++) {
    q = { x: q.x + (center.x - q.x) * 0.35, y: q.y + (center.y - q.y) * 0.35 };
    if (pointInPolygon(q, polygon)) return q;
  }
  return { ...center };
}

export function buildScene(profile, plan, evaluation) {
  const land = profile?.land || {};
  const boundary = land.boundary || [];
  if (boundary.length < 3) return { empty: true, reason: 'Draw or enter your land first.' };

  const center = polygonCentroid(boundary);
  const box = bbox(boundary);
  const outline = orientedBoundingBox(boundary);
  const terrain = makeTerrain(land, center);
  const random = seededRng(11);
  const tone = vegetationTone(land);
  const photo = latestPhotoSummary(land);

  const regions = [];
  const allocs = plan?.allocations || [];
  const zonesById = new Map((land.zones || []).map((z) => [z.id, z]));
  const unlinked = [];
  const regionOf = new Map();
  for (const a of allocs) {
    const z = a.zoneId ? zonesById.get(a.zoneId) : null;
    if (z) regionOf.set(a.id, z.polygon);
    else unlinked.push(a);
  }
  if (unlinked.length) {
    const total = polygonArea(boundary) || 1;
    const items = unlinked.map((a) => {
      const acres = evaluation
        ? (evaluation.livestock.find((l) => l.allocId === a.id)?.acres ?? evaluation.crops.find((c) => c.allocId === a.id)?.acres ?? evaluation.garden?.acres ?? a.acres)
        : a.acres;
      return { id: a.id, fraction: (acres * 4046.8564224) / total };
    });
    for (const part of autoPartition(boundary, items)) if (part.id !== '__rest' && part.polygon.length >= 3) regionOf.set(part.id, part.polygon);
  }

  const kindOfAlloc = (a) => (a.kind === 'livestock' ? 'pasture' : a.kind === 'garden' ? 'garden' : 'crop');
  for (const a of allocs) {
    const polygon = regionOf.get(a.id);
    if (!polygon) continue;
    const label = a.kind === 'garden' ? 'Garden' : a.kind === 'livestock' ? getLivestock(a.item).label : CROPS[a.item]?.label || a.item;
    regions.push({ id: a.id, kind: kindOfAlloc(a), item: a.item || null, polygon: polygon, label, linked: !!a.zoneId });
  }
  const linkedZoneIds = new Set(allocs.map((a) => a.zoneId).filter(Boolean));
  for (const z of land.zones || []) {
    if (linkedZoneIds.has(z.id)) continue;
    regions.push({ id: z.id, kind: z.use, item: null, polygon: z.polygon, label: z.name, linked: false, zone: true });
  }

  const crops = [];
  for (const r of regions) {
    if (r.kind === 'crop' && CROPS[r.item]) {
      const look = CROP_LOOK[r.item];
      const angle = orientedBoundingBox(r.polygon).angle;
      crops.push({ regionId: r.id, item: r.item, color: look.color, height: look.height, rows: scanlines(r.polygon, angle, 3, { inset: 1.5, maxRows: 220 }), rowWidth: 1.9 });
    } else if (r.kind === 'garden') {
      const angle = orientedBoundingBox(r.polygon).angle;
      crops.push({ regionId: r.id, item: 'garden', color: 0x4f9a3a, height: 0.5, rows: scanlines(r.polygon, angle, 1.2, { inset: 0.4, maxRows: 120 }), rowWidth: 0.6 });
    }
  }

  const fences = [];
  const addFence = (id, type, line, closed, name) => {
    const f = getFence(type);
    const posts = fencePosts(line, fromFeet(f.postSpacingFt), closed);
    const spans = [];
    for (let i = 0; i < posts.length - 1; i++) spans.push([posts[i], posts[i + 1]]);
    if (closed && posts.length > 2) spans.push([posts[posts.length - 1], posts[0]]);
    fences.push({ id, name, type, strands: f.strands, heightM: fromFeet(f.heightFt), posts, spans, closed: !!closed });
  };
  for (const f of land.fences || []) addFence(f.id, f.type, f.line, f.closed, f.name);
  if (plan?.fenceBoundary) addFence('boundary', plan.boundaryFence || 'barbed5', boundary, true, 'Boundary fence');

  const animals = [];
  const legend = [];
  const markers = land.markers || [];
  const resultBySpecies = new Map();
  for (const l of evaluation?.livestock || []) {
    const current = resultBySpecies.get(l.item) || { heads: 0, allocIds: [] };
    current.heads += l.heads;
    current.allocIds.push(l.allocId);
    resultBySpecies.set(l.item, current);
  }
  const speciesToShow = new Set([...resultBySpecies.keys(), ...markers.filter((m) => LIVESTOCK[m.kind]).map((m) => m.kind)]);
  for (const speciesId of speciesToShow) {
    const planned = resultBySpecies.get(speciesId);
    const heads = planned?.heads ?? 0;
    const spots = markers.filter((m) => m.kind === speciesId);
    const preview = !planned || heads === 0;
    let icons;
    let perIcon = 1;
    if (preview) icons = spots.length * 6;
    else {
      perIcon = Math.max(1, Math.ceil(heads / MAX_ICONS_PER_SPECIES));
      icons = Math.ceil(heads / perIcon);
    }
    const placed = [];
    if (spots.length) {
      const base = Math.floor(icons / spots.length);
      let extra = icons - base * spots.length;
      spots.forEach((m) => {
        const n = base + (extra-- > 0 ? 1 : 0);
        if (n <= 0) return;
        const radius = Math.min(26, Math.max(3, Math.sqrt(n) * 3.6));
        for (const p of spiral(m, n, radius, random)) placed.push(pullInside(p, boundary, center));
      });
    } else if (planned) {
      const region = regions.find((r) => planned.allocIds.includes(r.id));
      const polygon = region?.polygon?.length >= 3 ? region.polygon : boundary;
      placed.push(...scatterInPolygon(polygon, icons, 5 + speciesId.length));
    }
    for (const p of placed) animals.push({ kind: speciesId, x: p.x, y: p.y, rot: random() * Math.PI * 2, preview });
    if (placed.length) legend.push({ kind: speciesId, label: getLivestock(speciesId).label, heads, perIcon, preview, shown: placed.length });
  }

  const features = markers.filter((m) => FEATURE_KINDS.includes(m.kind)).map((m) => ({ kind: m.kind, x: m.x, y: m.y, rot: (m.x * 7 + m.y * 3) % 6.28, label: m.label || '' }));

  const trees = [];
  for (const z of land.zones || []) {
    if (z.use === 'woods') {
      const n = Math.min(250, Math.max(6, Math.round(polygonArea(z.polygon) / 90)));
      for (const p of scatterInPolygon(z.polygon, n, 17)) trees.push({ x: p.x, y: p.y, s: 0.8 + random() * 0.8 });
    }
  }
  const treePct = photo?.landCover?.find((c) => c.cls === 'trees')?.pct || 0;
  if (treePct > 3) {
    const n = Math.min(60, Math.round(treePct * 0.8));
    for (const p of scatterInPolygon(boundary, n, 29)) trees.push({ x: p.x, y: p.y, s: 0.7 + random() * 0.7 });
  }
  for (const f of features) if (f.kind === 'tree') trees.push({ x: f.x, y: f.y, s: 1.1 });

  const patches = [];
  const bareSoil = photo?.landCover?.find((c) => c.cls === 'bare_soil')?.pct || 0;
  if (bareSoil > 4) {
    const n = Math.min(8, Math.max(1, Math.round(bareSoil / 6)));
    for (const p of scatterInPolygon(boundary, n, 41)) patches.push({ kind: 'bare', x: p.x, y: p.y, r: 4 + random() * 7 });
  }
  const weedCount = (photo?.weeds || []).reduce((s, w) => s + (w.severity === 'heavy' ? 3 : w.severity === 'moderate' ? 2 : 1), 0);
  if (weedCount) for (const p of scatterInPolygon(boundary, Math.min(10, weedCount), 53)) patches.push({ kind: 'weeds', x: p.x, y: p.y, r: 2.5 + random() * 3 });
  const wet = photo?.standingWater || (photo?.landCover?.find((c) => c.cls === 'water')?.pct || 0) >= 5;
  if (wet && !(land.zones || []).some((z) => z.use === 'water')) {
    const down = { x: center.x - Math.cos(terrain.dirAngle) * outline.length * 0.25, y: center.y - Math.sin(terrain.dirAngle) * outline.length * 0.25 };
    const at = pointInPolygon(down, boundary) ? down : center;
    patches.push({ kind: 'pond', x: at.x, y: at.y, r: Math.max(6, outline.width * 0.08) });
  }

  return {
    empty: false,
    bounds: box,
    center,
    boundary,
    longSide: outline.length,
    terrain,
    tone,
    soilDark: Math.min(1, Math.max(0, ((land.soil?.om ?? 2.5) - 1) / 4)),
    regions,
    crops,
    fences,
    animals,
    features: features.filter((f) => f.kind !== 'tree'),
    trees,
    patches,
    legend,
    stats: {
      acres: boundaryAcres(land),
      posts: fences.reduce((s, f) => s + f.posts.length, 0),
      animals: animals.length,
      rows: crops.reduce((s, c) => s + c.rows.length, 0),
    },
  };
}
