import { LIVESTOCK, GRAZING, START_FRACTION, getLivestock } from './data/livestock.js';
import { CROPS, VEGETABLES, GARDEN_COST_PER_SQFT, getCrop } from './data/crops.js';
import { FENCES, GATE, getFence } from './data/fences.js';
import { cropSoilFit, pastureSoilFit, pastureForageLbPerAc, limeAdvice } from './soilfit.js';
import { polygonArea, polylineLength, toAcres, toFeet, fencePosts, fromFeet } from './geo.js';

export const DEFAULT_ASSUMPTIONS = {
  region: 'east',
  zone: 3,
  grazing: 'rotational',
  hotSummer: true,
  startFraction: START_FRACTION,
  hayDmFraction: 0.85,
  roadsBuildingsShare: 0.05,
  yearsProjected: 5,
};

export function inferRegion(lon) {
  if (!Number.isFinite(lon)) return 'east';
  return lon >= -98 ? 'east' : 'west';
}

export function livestockEcon(id, overrides = {}) {
  const base = getLivestock(id).econ;
  return { ...base, ...(overrides.livestock?.[id] || {}) };
}
export function cropEcon(id, overrides = {}) {
  const c = getCrop(id);
  return { price: c.price, costPerAcre: c.costPerAcre, ...(overrides.crops?.[id] || {}) };
}
export function fenceCostPerFt(id, overrides = {}) {
  return overrides.fence?.[id]?.costPerFt ?? getFence(id).costPerFt;
}
export function gateCost(overrides = {}) {
  return overrides.gateCost ?? GATE.cost;
}
export function vegetablePrice(id, overrides = {}) {
  return overrides.vegetables?.[id]?.price ?? VEGETABLES[id].price;
}

const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
const round = (x, d = 0) => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};

export function boundaryAcres(land) {
  return land?.boundary?.length >= 3 ? toAcres(polygonArea(land.boundary)) : 0;
}

export function zoneAcres(zone) {
  return zone.polygon?.length >= 3 ? toAcres(polygonArea(zone.polygon)) : 0;
}

export function acresByUse(land) {
  const out = {};
  for (const z of land?.zones || []) out[z.use] = (out[z.use] || 0) + zoneAcres(z);
  return out;
}

export function usableAcres(land, assumptions = DEFAULT_ASSUMPTIONS) {
  const total = boundaryAcres(land);
  const byUse = acresByUse(land);
  const blocked = (byUse.buildings || 0) + (byUse.water || 0) + (byUse.woods || 0) + (byUse.exclude || 0);
  if (!(land?.zones?.length)) return Math.max(0, total * (1 - assumptions.roadsBuildingsShare));
  return Math.max(0, total - blocked);
}

export function stockingCapacity(speciesId, acres, { soil = null, region = 'east', grazing = 'rotational', forageLbPerAcOverride = null } = {}) {
  const species = getLivestock(speciesId);
  const g = GRAZING[grazing] || GRAZING.rotational;
  if (acres <= 0) {
    return { method: species.method, maxHeads: 0, acresPerHead: null, forageLbPerAc: null, supplyLbPerYr: 0, demandLbPerHead: species.forageLbPerYr || null, utilization: g.utilization };
  }
  if (species.method === 'forage') {
    const forage = forageLbPerAcOverride ?? pastureForageLbPerAc(soil, region);
    const supply = acres * forage * g.utilization;
    const max = Math.floor(supply / species.forageLbPerYr + 1e-9);
    return {
      method: 'forage',
      maxHeads: max,
      acresPerHead: max > 0 ? acres / max : null,
      acresPerHeadExact: supply > 0 ? species.forageLbPerYr / (forage * g.utilization) : null,
      forageLbPerAc: forage,
      supplyLbPerYr: supply,
      demandLbPerHead: species.forageLbPerYr,
      utilization: g.utilization,
    };
  }
  const perAcre = species.perAcre * g.spaceFactor;
  const max = Math.floor(acres * perAcre + 1e-9);
  return {
    method: 'space',
    maxHeads: max,
    acresPerHead: max > 0 ? acres / max : null,
    acresPerHeadExact: 1 / perAcre,
    perAcre,
    utilization: g.utilization,
  };
}

export const suggestedStart = (maxHeads, fraction = START_FRACTION) => Math.max(maxHeads > 0 ? 1 : 0, Math.floor(maxHeads * fraction + 1e-9));

export function waterNeed(speciesId, heads, hot = true) {
  const w = getLivestock(speciesId).waterGal;
  return heads * (hot ? w.hot : w.typical);
}

export function yieldMultiplier(fit) {
  return clamp(0.4 + 0.7 * fit, 0.4, 1.1);
}

export function cropEstimate(cropId, acres, soil, { region = 'east', overrides = {} } = {}) {
  const c = getCrop(cropId);
  const fitInfo = cropSoilFit(cropId, soil, region);
  const m = yieldMultiplier(fitInfo.fit);
  const money = cropEcon(cropId, overrides);
  const makeYield = (y) => ({ perAcre: y * m, total: y * m * acres, revenue: y * m * acres * money.price });
  const low = makeYield(c.yieldLow);
  const base = makeYield(c.yieldBase);
  const high = makeYield(c.yieldHigh);
  const cost = money.costPerAcre * acres;
  return {
    cropId,
    acres,
    unit: c.unit,
    fit: fitInfo,
    multiplier: m,
    yield: { low, base, high },
    price: money.price,
    cost,
    net: { low: low.revenue - cost, base: base.revenue - cost, high: high.revenue - cost },
    volatility: c.yieldHigh > 0 ? (c.yieldHigh - c.yieldLow) / c.yieldHigh : 0,
    lime: limeAdvice(soil?.ph ?? null, { legume: c.legume, region }),
  };
}

export function gardenEstimate(areaSqFt, vegShares, { overrides = {} } = {}) {
  const ids = Object.keys(vegShares || {}).filter((id) => VEGETABLES[id] && vegShares[id] > 0);
  const totalShare = ids.reduce((s, id) => s + vegShares[id], 0) || 1;
  const items = ids.map((id) => {
    const v = VEGETABLES[id];
    const share = vegShares[id] / totalShare;
    const rowFt = (areaSqFt * share) / (((v.row[0] + v.row[1]) / 2) / 12);
    const plantSpacingFt = (v.plant[0] + v.plant[1]) / 2 / 12;
    const plants = Math.floor(rowFt / plantSpacingFt);
    const yieldTotal = (rowFt / 100) * v.per100;
    const value = yieldTotal * vegetablePrice(id, overrides);
    return { id, label: v.label, share, rowFt, plants, yield: yieldTotal, unit: v.unit, value };
  });
  const revenue = items.reduce((s, i) => s + i.value, 0);
  const cost = areaSqFt * GARDEN_COST_PER_SQFT;
  return { areaSqFt, items, revenue, cost, net: revenue - cost };
}

export function fenceRun(type, line, closed, overrides = {}) {
  const f = getFence(type);
  const lengthMeters = polylineLength(line) + (closed && line.length > 2 ? Math.hypot(line[0].x - line.at(-1).x, line[0].y - line.at(-1).y) : 0);
  const lenFt = toFeet(lengthMeters);
  const posts = fencePosts(line, fromFeet(f.postSpacingFt), !!closed).length;
  return { type, lengthFt: lenFt, posts, cost: lenFt * fenceCostPerFt(type, overrides), closed: !!closed };
}

export function fenceSummary(land, plan, overrides = {}) {
  const items = [];
  for (const fence of land?.fences || []) {
    if (!FENCES[fence.type] || !Array.isArray(fence.line) || fence.line.length < 2) continue;
    items.push({ id: fence.id, name: fence.name || 'Fence', ...fenceRun(fence.type, fence.line, fence.closed, overrides), gates: fence.gates ?? 1 });
  }
  if (plan?.fenceBoundary && land?.boundary?.length >= 3) {
    const type = plan.boundaryFence || 'barbed5';
    items.push({ id: 'boundary', name: 'Boundary fence', ...fenceRun(type, land.boundary, true, overrides), gates: plan.boundaryGates ?? 1 });
  }
  const totalFt = items.reduce((s, i) => s + i.lengthFt, 0);
  const gates = items.reduce((s, i) => s + i.gates, 0);
  const wireCost = items.reduce((s, i) => s + i.cost, 0);
  return { items, totalFt, posts: items.reduce((s, i) => s + i.posts, 0), gates, gateCost: gates * gateCost(overrides), wireCost, cost: wireCost + gates * gateCost(overrides) };
}

export function bestBoundaryFence(speciesIds = []) {
  const rate = { good: 2, ok: 1, poor: 0 };
  let best = 'barbed5';
  let bestScore = -1;
  for (const f of Object.values(FENCES)) {
    if (!f.perimeter) continue;
    const worst = speciesIds.length ? Math.min(...speciesIds.map((id) => rate[getLivestock(id).fenceFit[f.id]] ?? 1)) : 2;
    if (worst > bestScore) {
      best = f.id;
      bestScore = worst;
    }
  }
  return best;
}

export function fenceWarnings(fenceItems, speciesIds) {
  const out = [];
  for (const speciesId of speciesIds) {
    const species = getLivestock(speciesId);
    for (const it of fenceItems) {
      const fit = species.fenceFit[it.type];
      if (fit === 'poor') {
        out.push(`${getFence(it.type).label} is a poor choice for ${species.label.toLowerCase()} (${it.name}).`);
      }
    }
  }
  return [...new Set(out)];
}

export function newId(prefix = 'id') {
  const randomPart = typeof crypto !== 'undefined' && crypto.getRandomValues ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('') : Math.random().toString(16).slice(2, 14);
  return `${prefix}_${randomPart}`;
}

export function emptyPlan(name = 'New plan') {
  return { id: newId('plan'), name, allocations: [], grazing: 'rotational', fenceBoundary: false, boundaryFence: 'barbed5', boundaryGates: 1, notes: '' };
}

export function evaluatePlan(plan, land, overrides = {}, assumptionsIn = {}) {
  const settings = { ...DEFAULT_ASSUMPTIONS, ...assumptionsIn, region: assumptionsIn.region || land?.region || DEFAULT_ASSUMPTIONS.region };
  const soil = land?.soil || {};
  const grazing = plan.grazing || settings.grazing;
  const total = boundaryAcres(land);
  const usable = usableAcres(land, settings);
  const warnings = [];

  const livestock = [];
  const crops = [];
  let garden = null;
  let allocatedAcres = 0;

  for (const a of plan.allocations || []) {
    const zone = a.zoneId ? (land?.zones || []).find((z) => z.id === a.zoneId) : null;
    const acres = zone ? zoneAcres(zone) : Math.max(0, Number(a.acres) || 0);
    allocatedAcres += acres;
    if (a.kind === 'livestock' && LIVESTOCK[a.item]) {
      const species = getLivestock(a.item);
      const capacity = stockingCapacity(a.item, acres, { soil, region: settings.region, grazing });
      const start = suggestedStart(capacity.maxHeads, settings.startFraction);
      const heads = Number.isFinite(a.heads) && a.heads >= 0 ? Math.floor(a.heads) : start;
      const money = livestockEcon(a.item, overrides);
      let hayCost = 0;
      let shortfallLb = 0;
      if (species.method === 'forage') {
        shortfallLb = Math.max(0, heads * species.forageLbPerYr - capacity.supplyLbPerYr);
        const hayPrice = cropEcon('hay', overrides).price;
        hayCost = (shortfallLb / settings.hayDmFraction / 2000) * hayPrice;
      }
      const over = heads > capacity.maxHeads;
      if (over) {
        warnings.push(
          species.method === 'forage'
            ? `${species.label}: ${heads} head is more than the ${capacity.maxHeads} this pasture can feed. The model adds $${round(hayCost)} of hay a year; reduce numbers or add acres.`
            : `${species.label}: ${heads} is above the ${capacity.maxHeads} the published density allows on ${round(acres, 1)} acres.`,
        );
      }
      if (species.acresPerHeadRange && capacity.acresPerHeadExact) {
        const [low, high] = species.acresPerHeadRange;
        if (capacity.acresPerHeadExact > high + 0.5) warnings.push(`Horses: the forage math needs ${round(capacity.acresPerHeadExact, 1)} ac/horse here, above K-State's 2-4 acres - this soil is weak for horse pasture, plan on hay.`);
        else if (capacity.acresPerHeadExact < low - 0.5) warnings.push(`Horses: the forage math gives ${round(capacity.acresPerHeadExact, 1)} ac/horse, below K-State's 2-4 acres; K-State's range is the safer planning figure.`);
      }
      const revenue = heads * money.annualRevenue;
      const cost = heads * money.annualCost + hayCost;
      livestock.push({
        allocId: a.id,
        item: a.item,
        label: species.label,
        unitPlural: species.unitPlural,
        acres,
        capacity: capacity,
        startHeads: start,
        heads,
        overstocked: over,
        shortfallLb,
        hayCost,
        water: { typical: waterNeed(a.item, heads, false), hot: waterNeed(a.item, heads, true) },
        econ: { ...money, revenue, cost, purchaseTotal: heads * money.purchase, shelterTotal: heads * money.shelter },
        lifestyle: !!money.lifestyle,
      });
    } else if (a.kind === 'crop' && CROPS[a.item]) {
      const estimate = cropEstimate(a.item, acres, soil, { region: settings.region, overrides });
      if (estimate.fit.score < 45) warnings.push(`${getCrop(a.item).label}: soil fit is only ${estimate.fit.score}/100 here (${estimate.fit.notes[0] || 'see details'}).`);
      crops.push({ allocId: a.id, item: a.item, label: getCrop(a.item).label, ...estimate });
    } else if (a.kind === 'garden') {
      const squareFeet = acres * 43560;
      garden = { allocId: a.id, acres, ...gardenEstimate(squareFeet, a.vegetables || {}, { overrides }) };
    }
  }

  if (allocatedAcres > usable + 0.05) {
    warnings.push(`You have assigned ${round(allocatedAcres, 1)} acres but only ${round(usable, 1)} usable acres are available.`);
  }

  const fence = fenceSummary(land, plan, overrides);
  const speciesIds = livestock.map((l) => l.item);
  warnings.push(...fenceWarnings(fence.items, speciesIds));

  const water = {
    typical: livestock.reduce((s, l) => s + l.water.typical, 0),
    hot: livestock.reduce((s, l) => s + l.water.hot, 0),
  };
  if (water.hot > 0 && !land?.waterSource) warnings.push('Livestock need a dependable water source - add one to the land details (a well, rural water, pond or creek).');
  if (land?.waterSource === 'pond' && water.hot > 0) warnings.push('Ponds can dry up or turn toxic in a hot, dry summer - plan a backup tank.');

  const livestockRevenue = livestock.reduce((s, l) => s + l.econ.revenue, 0);
  const livestockCost = livestock.reduce((s, l) => s + l.econ.cost, 0);
  const setupLivestock = livestock.reduce((s, l) => s + l.econ.purchaseTotal + l.econ.shelterTotal, 0);
  const cropRev = (k) => crops.reduce((s, c) => s + c.yield[k].revenue, 0);
  const cropCost = crops.reduce((s, c) => s + c.cost, 0);
  const gardenRev = garden?.revenue || 0;
  const gardenCost = garden?.cost || 0;

  const annualRevenue = { low: livestockRevenue + cropRev('low') + gardenRev, base: livestockRevenue + cropRev('base') + gardenRev, high: livestockRevenue + cropRev('high') + gardenRev };
  const annualCost = livestockCost + cropCost + gardenCost;
  const net = { low: annualRevenue.low - annualCost, base: annualRevenue.base - annualCost, high: annualRevenue.high - annualCost };
  const setupCost = setupLivestock + fence.cost;
  const years = settings.yearsProjected;
  const cumulative = Array.from({ length: years + 1 }, (_, y) => ({ year: y, base: -setupCost + net.base * y, low: -setupCost + net.low * y, high: -setupCost + net.high * y }));
  const payback = net.base > 0 ? setupCost / net.base : null;

  const weighted = [];
  for (const c of crops) weighted.push({ w: c.acres, fit: c.fit.fit, conf: c.fit.confidence });
  if (livestock.length) {
    const pastureFit = pastureSoilFit(soil, settings.region);
    for (const l of livestock) weighted.push({ w: l.acres, fit: pastureFit.fit, conf: pastureFit.confidence });
  }
  const totalWeight = weighted.reduce((s, x) => s + x.w, 0);
  const fitScore = totalWeight > 0 ? weighted.reduce((s, x) => s + x.w * x.fit, 0) / totalWeight : 0;
  const confidence = totalWeight > 0 ? weighted.reduce((s, x) => s + x.w * x.conf, 0) / totalWeight : 0;

  const revBase = Math.max(1, annualRevenue.base);
  const cropShare = crops.reduce((s, c) => s + c.yield.base.revenue, 0) / revBase;
  const cropVol = crops.length ? crops.reduce((s, c) => s + c.volatility * c.yield.base.revenue, 0) / Math.max(1, cropRev('base')) : 0;
  const overstockPenalty = livestock.some((l) => l.overstocked) ? 0.2 : 0;
  const waterPenalty = water.hot > 0 && !land?.waterSource ? 0.15 : 0;
  const downside = annualRevenue.base > 0 ? clamp((net.base - net.low) / Math.max(annualRevenue.base, 1), 0, 1) : 0;
  const risk =
    clamp(0.35 * cropVol * (cropShare > 0 ? 1 : 0) + 0.25 * (1 - fitScore) + 0.15 * (1 - confidence) + 0.25 * downside + overstockPenalty + waterPenalty, 0, 1) * 100;

  const nettingCost = fence.items.filter((i) => FENCES[i.type].srcCost === 'starter').reduce((s, i) => s + i.cost, 0);
  const sourcedDollars = fence.wireCost - nettingCost;
  const starterDollars = Math.abs(livestockRevenue) + livestockCost + setupLivestock + Math.abs(cropRev('base')) + cropCost + gardenRev + gardenCost + fence.gateCost + nettingCost;
  const starterShare = starterDollars + sourcedDollars > 0 ? starterDollars / (starterDollars + sourcedDollars) : 0;

  return {
    planId: plan.id,
    name: plan.name,
    acres: { total, usable, allocated: allocatedAcres, unallocated: Math.max(0, usable - allocatedAcres) },
    livestock,
    crops,
    garden,
    fence,
    water,
    money: { annualRevenue, annualCost, net, setupCost, setupLivestock, cumulative, payback },
    fitScore: round(fitScore * 100),
    confidence,
    risk: round(risk),
    netPerAcre: allocatedAcres > 0 ? net.base / allocatedAcres : 0,
    warnings,
    basis: { starterShare, starterDollars, sourcedDollars },
  };
}

export function applyScenario(evaluation, { revenuePct = 0, costPct = 0 } = {}) {
  if (!revenuePct && !costPct) return evaluation;
  const r = 1 + revenuePct / 100;
  const c = 1 + costPct / 100;
  const m = evaluation.money;
  const revenue = { low: m.annualRevenue.low * r, base: m.annualRevenue.base * r, high: m.annualRevenue.high * r };
  const cost = m.annualCost * c;
  const net = { low: revenue.low - cost, base: revenue.base - cost, high: revenue.high - cost };
  const cumulative = m.cumulative.map((row) => ({ year: row.year, low: -m.setupCost + net.low * row.year, base: -m.setupCost + net.base * row.year, high: -m.setupCost + net.high * row.year }));
  return { ...evaluation, money: { ...m, annualRevenue: revenue, annualCost: cost, net, cumulative, payback: net.base > 0 ? m.setupCost / net.base : null } };
}

export const DEFAULT_WEIGHTS = { profit: 0.35, fit: 0.3, risk: 0.2, startup: 0.15 };

function norm(values, higherBetter) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (high - low < 1e-9) return values.map(() => 0.5);
  return values.map((v) => (higherBetter ? (v - low) / (high - low) : (high - v) / (high - low)));
}

export function comparePlans(evals, weights = DEFAULT_WEIGHTS) {
  if (!evals.length) return [];
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const sum = w.profit + w.fit + w.risk + w.startup || 1;
  const profit = norm(evals.map((e) => e.money.net.base), true);
  const fit = norm(evals.map((e) => e.fitScore), true);
  const risk = norm(evals.map((e) => e.risk), false);
  const startup = norm(evals.map((e) => e.money.setupCost), false);
  const scored = evals.map((e, i) => {
    const score = (w.profit * profit[i] + w.fit * fit[i] + w.risk * risk[i] + w.startup * startup[i]) / sum;
    return { eval: e, score: round(score * 100), parts: { profit: profit[i], fit: fit[i], risk: risk[i], startup: startup[i] } };
  });
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 1) {
    const best = scored[0];
    const second = scored[1];
    const reasons = [];
    const d = (x, y) => x - y;
    if (d(best.eval.money.net.base, second.eval.money.net.base) > 1) reasons.push(`projects $${round(d(best.eval.money.net.base, second.eval.money.net.base)).toLocaleString('en-US')} more net a year`);
    if (best.eval.fitScore > second.eval.fitScore) reasons.push(`fits the soil better (${best.eval.fitScore} vs ${second.eval.fitScore})`);
    if (best.eval.risk < second.eval.risk) reasons.push(`carries less risk (${best.eval.risk} vs ${second.eval.risk})`);
    if (best.eval.money.setupCost < second.eval.money.setupCost) reasons.push(`costs $${round(second.eval.money.setupCost - best.eval.money.setupCost).toLocaleString('en-US')} less to start`);
    best.reasons = reasons;
  }
  return scored;
}

export function rankOptions(land, overrides = {}, assumptionsIn = {}) {
  const settings = { ...DEFAULT_ASSUMPTIONS, ...assumptionsIn, region: assumptionsIn.region || land?.region || 'east' };
  const soil = land?.soil || {};
  const livestock = Object.keys(LIVESTOCK).map((id) => {
    const capacity = stockingCapacity(id, 1, { soil, region: settings.region, grazing: assumptionsIn.grazing || settings.grazing });
    const headsPerAcre = (capacity.method === 'forage' ? capacity.supplyLbPerYr / getLivestock(id).forageLbPerYr : capacity.maxHeads) * settings.startFraction;
    const money = livestockEcon(id, overrides);
    const perHeadNet = money.annualRevenue - money.annualCost;
    return {
      kind: 'livestock',
      id,
      label: getLivestock(id).label,
      headsPerAcre,
      acresPerHead: headsPerAcre > 0 ? 1 / headsPerAcre : null,
      netPerAcre: headsPerAcre * perHeadNet,
      startPerAcre: headsPerAcre * (money.purchase + money.shelter),
      lifestyle: !!money.lifestyle,
    };
  });
  const crops = Object.keys(CROPS).map((id) => {
    const estimate = cropEstimate(id, 1, soil, { region: settings.region, overrides });
    return {
      kind: 'crop',
      id,
      label: getCrop(id).label,
      fit: estimate.fit.score,
      netPerAcre: estimate.net.base,
      netPerAcreLow: estimate.net.low,
      volatility: estimate.volatility,
      limiting: estimate.fit.limiting ? estimate.fit.factors[estimate.fit.limiting].label : null,
    };
  });
  return {
    livestock: [...livestock].sort((a, b) => b.netPerAcre - a.netPerAcre),
    crops: [...crops].sort((a, b) => b.netPerAcre - a.netPerAcre),
  };
}

const pick = (list, ok) => list.filter(ok);

export function suggestPlans(land, goals = {}, overrides = {}, assumptionsIn = {}) {
  const settings = { ...DEFAULT_ASSUMPTIONS, ...assumptionsIn, region: assumptionsIn.region || land?.region || 'east' };
  const usable = usableAcres(land, settings);
  if (usable <= 0) return [];
  const rank = rankOptions(land, overrides, settings);
  const allowL = (o) => (!goals.interests?.livestock || goals.interests.livestock.includes(o.id)) && (goals.hobby || !o.lifestyle);
  const allowC = (o) => !goals.interests?.crops || goals.interests.crops.includes(o.id);
  const grazers = pick(rank.livestock, (o) => allowL(o) && getLivestock(o.id).method === 'forage' && o.netPerAcre > 0);
  const smallStock = pick(rank.livestock, (o) => allowL(o) && getLivestock(o.id).method === 'space' && o.netPerAcre > 0);
  const hobbyHorses = pick(rank.livestock, (o) => goals.hobby && o.lifestyle && allowL(o));
  const cropList = pick(rank.crops, (o) => allowC(o) && o.fit >= 40 && o.id !== 'hay');
  const hayOpt = rank.crops.find((o) => o.id === 'hay');

  const makePlan = (name, notes, allocs, extra = {}) => {
    const plan = { ...emptyPlan(name), notes, allocations: allocs.filter((a) => a.acres > 0.01).map((a) => ({ id: newId('al'), ...a, acres: round(a.acres, 2) })), ...extra };
    if (plan.fenceBoundary) plan.boundaryFence = bestBoundaryFence(plan.allocations.filter((a) => a.kind === 'livestock').map((a) => a.item));
    return plan;
  };
  const gardenAcres = goals.garden ? Math.min(0.25, usable * 0.02) : 0;
  const makeAnimal = (item, acres) => ({ kind: 'livestock', item, acres, heads: null });
  const makeCrop = (item, acres) => ({ kind: 'crop', item, acres });
  const makeGarden = (acres) => ({ kind: 'garden', acres, vegetables: { tomatoes: 0.25, peppers: 0.15, bushbeans: 0.2, cucumbers: 0.1, onions: 0.15, carrots: 0.15 } });

  const plans = [];

  {
    const rest = usable - gardenAcres;
    const firstAnimal = grazers[0];
    const secondAnimal = grazers[1];
    const allocs = [];
    if (firstAnimal) {
      const small = smallStock[0] ? rest * 0.08 : 0;
      const pasture = rest - small;
      if (secondAnimal) {
        allocs.push(makeAnimal(firstAnimal.id, pasture * 0.65), makeAnimal(secondAnimal.id, pasture * 0.35));
      } else allocs.push(makeAnimal(firstAnimal.id, pasture));
      if (smallStock[0]) allocs.push(makeAnimal(smallStock[0].id, small));
    } else if (hobbyHorses[0]) allocs.push(makeAnimal(hobbyHorses[0].id, rest));
    if (gardenAcres) allocs.push(makeGarden(gardenAcres));
    if (allocs.length) plans.push(makePlan('Grazing focus', 'Most of the land in pasture, using the animals that earn the most per acre on this soil.', allocs, { grazing: 'rotational', fenceBoundary: true }));
  }

  {
    const firstCrop = cropList[0];
    const secondCrop = cropList[1];
    const rest = usable - gardenAcres;
    const allocs = [];
    if (firstCrop) {
      const pastureShare = grazers[0] ? 0.1 : 0;
      const cropAcres = rest * (1 - pastureShare);
      if (secondCrop) allocs.push(makeCrop(firstCrop.id, cropAcres * 0.6), makeCrop(secondCrop.id, cropAcres * 0.4));
      else allocs.push(makeCrop(firstCrop.id, cropAcres));
      if (pastureShare) allocs.push(makeAnimal(grazers[0].id, rest * pastureShare));
    } else if (hayOpt) allocs.push(makeCrop('hay', rest));
    if (gardenAcres) allocs.push(makeGarden(gardenAcres));
    if (allocs.length) plans.push(makePlan('Crop focus', 'Row crops on the best-fitting ground, with a small pasture.', allocs, { grazing: 'rotational', fenceBoundary: false }));
  }

  {
    const rest = usable - gardenAcres;
    const allocs = [];
    const steady = [...cropList].sort((a, b) => a.volatility - b.volatility)[0] || hayOpt;
    if (grazers[0]) allocs.push(makeAnimal(grazers[0].id, rest * 0.5));
    if (steady) allocs.push(makeCrop(steady.id, rest * (grazers[0] ? 0.35 : 0.85)));
    if (hayOpt && steady?.id !== 'hay') allocs.push(makeCrop('hay', rest * 0.15));
    if (gardenAcres) allocs.push(makeGarden(gardenAcres));
    if (allocs.length) plans.push(makePlan('Balanced, lower risk', 'Pasture, one steadier crop and hay, so one bad year does not sink the whole plan.', allocs, { grazing: 'rotational', fenceBoundary: true }));
  }

  if (goals.budget != null && Number.isFinite(goals.budget)) {
    return plans.map((p) => scaleToBudget(p, land, goals.budget, overrides, settings));
  }
  return plans;
}

export function scaleToBudget(plan, land, budget, overrides = {}, assumptions = {}) {
  const copy = JSON.parse(JSON.stringify(plan));
  let evaluation = evaluatePlan(copy, land, overrides, assumptions);
  if (evaluation.money.setupCost <= budget) return copy;
  const livestockAllocs = copy.allocations.filter((a) => a.kind === 'livestock');
  if (!livestockAllocs.length) return copy;
  for (let f = 0.9; f >= 0.25 - 1e-9; f -= 0.05) {
    for (const a of livestockAllocs) {
      const current = evaluation.livestock.find((l) => l.allocId === a.id);
      a.heads = Math.max(1, Math.floor((current?.startHeads || 1) * f));
    }
    evaluation = evaluatePlan(copy, land, overrides, assumptions);
    if (evaluation.money.setupCost <= budget) {
      copy.notes = `${copy.notes} Livestock scaled to ${Math.round(f * 100)}% of the suggested start to fit a $${Math.round(budget).toLocaleString('en-US')} budget.`.trim();
      return copy;
    }
  }
  copy.notes = `${copy.notes} Even at 25% of the suggested herd the start-up cost is above the budget.`.trim();
  return copy;
}
