import { LIME_TRIGGER, PH_THRESHOLDS, PASTURE_PROFILE, PASTURE_FORAGE, getCrop } from './data/crops.js';

export const DRAINAGE_CLASSES = ['excessive', 'well', 'moderate', 'somewhat_poor', 'poor', 'very_poor'];
export const DRAINAGE_LABEL = {
  excessive: 'Excessively drained (dries out fast)',
  well: 'Well drained',
  moderate: 'Moderately well drained',
  somewhat_poor: 'Somewhat poorly drained',
  poor: 'Poorly drained',
  very_poor: 'Very poorly drained',
};

export const TEXTURE_CLASSES = [
  'sand', 'loamy_sand', 'sandy_loam', 'loam', 'silt_loam', 'silt',
  'sandy_clay_loam', 'clay_loam', 'silty_clay_loam', 'sandy_clay', 'silty_clay', 'clay',
];
export const TEXTURE_LABEL = Object.fromEntries(TEXTURE_CLASSES.map((t) => [t, t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())]));
const TEXTURE_GROUP = {
  sand: 'coarse', loamy_sand: 'coarse', sandy_loam: 'coarse',
  loam: 'medium', silt_loam: 'medium', silt: 'medium', sandy_clay_loam: 'medium',
  clay_loam: 'fine', silty_clay_loam: 'fine', sandy_clay: 'fine', silty_clay: 'fine', clay: 'fine',
};
export const textureGroup = (t) => TEXTURE_GROUP[t] || null;

export function textureClass(sand, silt, clay) {
  const s = Number(sand);
  const siltValue = Number(silt);
  const c = Number(clay);
  if (![s, siltValue, c].every(Number.isFinite)) return null;
  const total = s + siltValue + c;
  if (total < 90 || total > 110) return null;
  if (siltValue + 1.5 * c < 15) return 'sand';
  if (siltValue + 1.5 * c >= 15 && siltValue + 2 * c < 30) return 'loamy_sand';
  if ((c >= 7 && c < 20 && s > 52 && siltValue + 2 * c >= 30) || (c < 7 && siltValue < 50 && siltValue + 2 * c >= 30)) return 'sandy_loam';
  if (c >= 7 && c < 27 && siltValue >= 28 && siltValue < 50 && s <= 52) return 'loam';
  if ((siltValue >= 50 && c >= 12 && c < 27) || (siltValue >= 50 && siltValue < 80 && c < 12)) return 'silt_loam';
  if (siltValue >= 80 && c < 12) return 'silt';
  if (c >= 20 && c < 35 && siltValue < 28 && s > 45) return 'sandy_clay_loam';
  if (c >= 27 && c < 40 && s > 20 && s <= 45) return 'clay_loam';
  if (c >= 27 && c < 40 && s <= 20) return 'silty_clay_loam';
  if (c >= 35 && s > 45) return 'sandy_clay';
  if (c >= 40 && siltValue >= 40) return 'silty_clay';
  if (c >= 40 && s <= 45 && siltValue < 40) return 'clay';
  return 'loam';
}

export function normalizeDrainage(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  if (t.includes('very poorly')) return 'very_poor';
  if (t.includes('somewhat poorly')) return 'somewhat_poor';
  if (t.includes('poorly')) return 'poor';
  if (t.includes('moderately well')) return 'moderate';
  if (t.includes('excessively')) return 'excessive';
  if (t.includes('well')) return 'well';
  return null;
}

function slopeFactor(breaks, slopePct) {
  for (const [max, f] of breaks) if (slopePct <= max) return f;
  return breaks[breaks.length - 1][1];
}

export function phFactor(ph, { legume = false, region = 'east', highTolerant = false } = {}) {
  if (ph == null || !Number.isFinite(ph)) return { f: 0.85, note: 'pH unknown', known: false };
  const trigger = (legume ? LIME_TRIGGER.legume : LIME_TRIGGER.nonlegume)[region === 'west' ? 'west' : 'east'];
  const phLimits = PH_THRESHOLDS;
  if (ph < trigger) {
    if (ph >= phLimits.aluminum) return { f: 1 - ((trigger - ph) / (trigger - phLimits.aluminum)) * 0.6, note: `below the ${trigger} lime trigger`, known: true };
    return { f: Math.max(0.15, 0.4 - (phLimits.aluminum - ph) * 0.35), note: 'aluminum toxicity is possible', known: true };
  }
  if (ph <= phLimits.carbonateLow) return { f: 1, note: 'in the comfortable range', known: true };
  const mild = highTolerant ? 0.92 : 0.85;
  if (ph <= phLimits.carbonateHigh) return { f: mild, note: 'free lime (calcium carbonate) is likely, which can tie up iron, zinc and phosphorus', known: true };
  if (ph <= phLimits.sodic) return { f: highTolerant ? 0.8 : 0.65, note: 'strongly alkaline', known: true };
  return { f: highTolerant ? 0.45 : 0.3, note: 'sodic soil risk (high sodium)', known: true };
}

const WEIGHTS = { ph: 0.3, drainage: 0.28, texture: 0.14, slope: 0.16, depth: 0.12 };

export function soilFitFor(profile, soil, region = 'east') {
  const p = profile.soil;
  const notes = [];
  const factors = {};

  const ph = phFactor(soil?.ph ?? null, { legume: profile.legume, region, highTolerant: p.phHighTolerant });
  factors.ph = { f: ph.f, known: ph.known, label: 'Soil pH', note: ph.note };

  const drainageScore = soil?.drainage && p.drainage[soil.drainage] != null ? p.drainage[soil.drainage] : null;
  factors.drainage = {
    f: drainageScore ?? 0.85, known: drainageScore != null, label: 'Drainage',
    note: drainageScore == null ? 'drainage unknown' : DRAINAGE_LABEL[soil.drainage].toLowerCase(),
  };

  const group = textureGroup(soil?.texture);
  const textureScore = group ? p.texture[group] : null;
  factors.texture = {
    f: textureScore ?? 0.9, known: textureScore != null, label: 'Texture',
    note: group ? `${TEXTURE_LABEL[soil.texture].toLowerCase()} (${group} textured)` : 'texture unknown',
  };

  const slopeKnown = Number.isFinite(soil?.slopePct);
  factors.slope = {
    f: slopeKnown ? slopeFactor(p.slopeBreaks, soil.slopePct) : 0.9, known: slopeKnown, label: 'Slope',
    note: slopeKnown ? `${soil.slopePct}% slope` : 'slope unknown',
  };

  const depthKnown = Number.isFinite(soil?.depthIn);
  let drainageFactor = 0.9;
  if (depthKnown) drainageFactor = soil.depthIn >= p.minDepthIn ? 1 : Math.max(0.2, soil.depthIn / p.minDepthIn);
  factors.depth = {
    f: drainageFactor, known: depthKnown, label: 'Soil depth',
    note: depthKnown ? `${soil.depthIn} in. to a restrictive layer` : 'depth unknown',
  };

  let logSum = 0;
  let known = 0;
  let wKnown = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    logSum += w * Math.log(Math.max(factors[k].f, 0.02));
    if (factors[k].known) {
      known++;
      wKnown += w;
    }
  }
  const geo = Math.exp(logSum);
  const worst = Math.min(...Object.values(factors).map((x) => x.f));
  const fit = 0.5 * geo + 0.5 * worst;
  let limiting = null;
  for (const [k, v] of Object.entries(factors)) if (!limiting || v.f < factors[limiting].f) limiting = k;
  if (factors[limiting].f >= 0.95) limiting = null;
  if (limiting) notes.push(`Biggest limit: ${factors[limiting].label.toLowerCase()} (${factors[limiting].note}).`);
  const missing = Object.values(factors).filter((x) => !x.known).map((x) => x.label.toLowerCase());
  if (missing.length) notes.push(`Not entered: ${missing.join(', ')}. Add them to tighten this estimate.`);

  return {
    fit,
    score: Math.round(fit * 100),
    factors,
    limiting,
    confidence: wKnown,
    knownCount: known,
    notes,
  };
}

export function cropSoilFit(cropId, soil, region = 'east') {
  return soilFitFor(getCrop(cropId), soil, region);
}

export function pastureSoilFit(soil, region = 'east') {
  return soilFitFor(PASTURE_PROFILE, soil, region);
}

export function pastureForageLbPerAc(soil, region = 'east') {
  const { fit } = pastureSoilFit(soil, region);
  const tons = PASTURE_FORAGE.minTonsPerAc + (PASTURE_FORAGE.maxTonsPerAc - PASTURE_FORAGE.minTonsPerAc) * fit;
  return Math.round(tons * 2000);
}

export function limeAdvice(ph, { legume = false, region = 'east' } = {}) {
  if (ph == null || !Number.isFinite(ph)) return { needed: null, trigger: null, text: 'Enter a soil pH to see lime advice.' };
  const trigger = (legume ? LIME_TRIGGER.legume : LIME_TRIGGER.nonlegume)[region === 'west' ? 'west' : 'east'];
  if (ph < trigger) {
    return {
      needed: true,
      trigger,
      text: `pH ${ph} is below ${trigger.toFixed(1)}, the K-State lime trigger for ${legume ? 'legumes' : 'non-legumes'} in ${region === 'west' ? 'western' : 'eastern'} Kansas. Ask the K-State soil lab for a buffer-pH test to get a lime rate; pH alone cannot tell you how much.`,
    };
  }
  return { needed: false, trigger, text: `pH ${ph} is at or above the ${trigger.toFixed(1)} lime trigger, so lime is not needed for ${legume ? 'legumes' : 'non-legumes'}.` };
}
