import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stockingCapacity, suggestedStart, waterNeed, yieldMultiplier, cropEstimate, gardenEstimate, fenceSummary, fenceWarnings,
  evaluatePlan, emptyPlan, comparePlans, rankOptions, suggestPlans, scaleToBudget, usableAcres, boundaryAcres, acresByUse,
  inferRegion, DEFAULT_ASSUMPTIONS, livestockEcon, fenceCostPerFt, bestBoundaryFence, applyScenario,
} from '../src/planner.js';
import { CROPS } from '../src/data/crops.js';
import { LIVESTOCK } from '../src/data/livestock.js';
import { FENCE_CROSSCHECK, FENCES } from '../src/data/fences.js';
import { rectPolygon, toFeet, polygonPerimeter, M2_PER_ACRE } from '../src/geo.js';
import { squareLand, IDEAL_SOIL, near } from './helpers.js';

test('beef carrying capacity: 100 ac x 7,000 lb/ac x 40% / 9,490 lb per pair = 29 pairs', () => {
  const c = stockingCapacity('beef', 100, { forageLbPerAcOverride: 7000, grazing: 'rotational' });
  assert.equal(c.maxHeads, 29);
  assert.ok(near(c.acresPerHeadExact, 9490 / (7000 * 0.4), 1e-9));
  assert.ok(near(c.supplyLbPerYr, 280000));
});

test('continuous grazing carries fewer animals than rotational', () => {
  const rot = stockingCapacity('beef', 100, { forageLbPerAcOverride: 7000, grazing: 'rotational' }).maxHeads;
  const continuous = stockingCapacity('beef', 100, { forageLbPerAcOverride: 7000, grazing: 'continuous' }).maxHeads;
  assert.equal(continuous, 18);
  assert.ok(continuous < rot);
});

test('sheep and goats use their own animal-unit forage demand', () => {
  assert.equal(stockingCapacity('sheep', 100, { forageLbPerAcOverride: 7000 }).maxHeads, 147);
  assert.equal(stockingCapacity('goats', 100, { forageLbPerAcOverride: 7000 }).maxHeads, 196);
  assert.equal(stockingCapacity('horses', 100, { forageLbPerAcOverride: 7000 }).maxHeads, 23);
});

test('AU table arithmetic is internally consistent (yearly lb = AU x 9,490 within rounding)', () => {
  for (const id of ['beef', 'sheep', 'goats', 'horses']) {
    const species = LIVESTOCK[id];
    assert.ok(Math.abs(species.forageLbPerYr - species.au * 9490) / species.forageLbPerYr < 0.01, id);
  }
});

test('hogs and chickens use published densities, reduced without rotation', () => {
  assert.equal(stockingCapacity('hogs', 10, { grazing: 'rotational' }).maxHeads, 200);
  assert.equal(stockingCapacity('hogs', 10, { grazing: 'continuous' }).maxHeads, 120);
  assert.equal(stockingCapacity('chickens', 5, { grazing: 'rotational' }).maxHeads, 2000);
  assert.ok(near(43560 / 400, 108.9, 0.01));
});

test('zero acres means zero animals', () => {
  assert.equal(stockingCapacity('beef', 0, {}).maxHeads, 0);
  assert.equal(suggestedStart(0), 0);
});

test('suggested start is 75% of max but at least 1 when any fit', () => {
  assert.equal(suggestedStart(29), 21);
  assert.equal(suggestedStart(1), 1);
  assert.equal(suggestedStart(2), 1);
});

test('water: 10 beef pairs on a hot day need 236 gal', () => {
  assert.ok(near(waterNeed('beef', 10, true), 236));
  assert.ok(near(waterNeed('beef', 10, false), 145));
  assert.ok(near(waterNeed('chickens', 1000, false), 66));
  assert.ok(near(LIVESTOCK.beef.waterGal.hot / LIVESTOCK.beef.waterGal.typical, 1.63, 0.01));
  assert.ok(near(LIVESTOCK.chickens.waterGal.hot / LIVESTOCK.chickens.waterGal.typical, 1.5, 0.01));
});

test('yield multiplier is bounded', () => {
  assert.ok(near(yieldMultiplier(1), 1.1));
  assert.ok(near(yieldMultiplier(0), 0.4));
  assert.ok(near(yieldMultiplier(0.5), 0.75));
});

test('NASS-derived yields: low/high/base are consistent', () => {
  for (const c of Object.values(CROPS)) {
    assert.ok(c.yieldLow <= c.yieldBase && c.yieldBase <= c.yieldHigh, c.id);
  }
  assert.equal(CROPS.corn.yieldHigh, 129);
  assert.equal(CROPS.corn.yieldLow, 119);
  assert.equal(CROPS.wheat.yieldHigh, 43);
  assert.equal(CROPS.wheat.yieldLow, 35);
  assert.equal(CROPS.alfalfa.yieldLow, 2.65);
  assert.equal(CROPS.alfalfa.yieldHigh, 3.05);
});

test('corn on ideal soil: 124 bu x 1.1 x 10 ac x $4.20 revenue, $4,300 cost', () => {
  const e = cropEstimate('corn', 10, IDEAL_SOIL);
  assert.ok(near(e.yield.base.perAcre, 124 * 1.1, 0.01));
  assert.ok(near(e.yield.base.revenue, 124 * 1.1 * 10 * 4.2, 0.5));
  assert.ok(near(e.cost, 4300));
  assert.ok(e.net.low < e.net.base && e.net.base < e.net.high);
});

test('lime advice rides along with a crop estimate', () => {
  const e = cropEstimate('alfalfa', 5, { ...IDEAL_SOIL, ph: 5.9 });
  assert.equal(e.lime.needed, true);
});

test('garden: 1,000 sq ft of tomatoes', () => {
  const g = gardenEstimate(1000, { tomatoes: 1 });
  const t = g.items[0];
  assert.ok(near(t.rowFt, 1000 / 3.5, 1e-6));
  assert.equal(t.plants, Math.floor(1000 / 3.5 / 2.5));
  assert.ok(near(t.yield, (1000 / 3.5 / 100) * 100, 1e-6));
  assert.ok(near(g.cost, 150));
  assert.ok(g.revenue > 0);
});

test('garden ignores unknown vegetables and normalizes shares', () => {
  const g = gardenEstimate(500, { tomatoes: 2, peppers: 2, bogus: 5 });
  assert.equal(g.items.length, 2);
  assert.ok(near(g.items.reduce((s, i) => s + i.share, 0), 1));
});

test('fence cross-check reproduces the K-State 2023 survey arithmetic', () => {
  assert.ok(near(FENCE_CROSSCHECK.materialsPerFt, 1.27, 0.005));
  assert.ok(near(FENCE_CROSSCHECK.laborPerFt, 1.55, 0.005));
  assert.ok(near(FENCE_CROSSCHECK.totalPerFt, 2.82, 0.01));
  assert.equal(FENCE_CROSSCHECK.quarterSectionFeet, 4 * 2640);
});

test('fence costs per foot match the Missouri Jan 2024 budgets', () => {
  assert.equal(FENCES.barbed5.costPerFt, 3.55);
  assert.equal(FENCES.woven47.costPerFt, 4.09);
  assert.equal(FENCES.hightensile6.costPerFt, 2.86);
  assert.equal(FENCES.electric2.costPerFt, 0.81);
});

test('boundary fence on a 10-acre square: length, posts, cost, one gate', () => {
  const land = squareLand(10);
  const plan = { ...emptyPlan(), fenceBoundary: true, boundaryFence: 'barbed5', boundaryGates: 1 };
  const fs = fenceSummary(land, plan);
  const perimFt = toFeet(polygonPerimeter(land.boundary));
  assert.ok(near(fs.totalFt, perimFt, 1e-6));
  assert.ok(near(fs.wireCost, perimFt * 3.55, 1e-6));
  assert.equal(fs.gates, 1);
  assert.ok(near(fs.cost, perimFt * 3.55 + 300, 1e-6));
  assert.equal(fs.posts, 220);
});

test('drawn fence lines are included; unknown types and 1-point lines are skipped', () => {
  const land = squareLand(10, IDEAL_SOIL, {
    fences: [
      { id: 'f1', type: 'electric2', line: [{ x: 0, y: 0 }, { x: 100, y: 0 }], gates: 0 },
      { id: 'f2', type: 'laser', line: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id: 'f3', type: 'barbed5', line: [{ x: 0, y: 0 }] },
    ],
  });
  const fs = fenceSummary(land, emptyPlan());
  assert.equal(fs.items.length, 1);
  assert.ok(near(fs.items[0].lengthFt, toFeet(100), 1e-6));
  assert.ok(near(fs.wireCost, toFeet(100) * 0.81, 1e-6));
  assert.equal(fs.gates, 0);
});

test('fence warnings flag barbed wire for goats and chickens', () => {
  const w = fenceWarnings([{ type: 'barbed5', name: 'Boundary fence' }], ['goats', 'beef', 'chickens']);
  assert.equal(w.length, 2);
  assert.match(w.join(' '), /goats/i);
});

test('land helpers: acres, zones, usable acres', () => {
  const land = squareLand(40, IDEAL_SOIL, {
    zones: [
      { id: 'z1', use: 'pasture', polygon: rectPolygon(Math.sqrt(10 * M2_PER_ACRE), Math.sqrt(10 * M2_PER_ACRE)) },
      { id: 'z2', use: 'buildings', polygon: rectPolygon(Math.sqrt(2 * M2_PER_ACRE), Math.sqrt(2 * M2_PER_ACRE)) },
    ],
  });
  assert.ok(near(boundaryAcres(land), 40, 1e-6));
  const byUse = acresByUse(land);
  assert.ok(near(byUse.pasture, 10, 1e-6) && near(byUse.buildings, 2, 1e-6));
  assert.ok(near(usableAcres(land), 38, 1e-6));
  assert.ok(near(usableAcres(squareLand(40)), 38, 1e-6));
});

test('inferRegion', () => {
  assert.equal(inferRegion(-95.7), 'east');
  assert.equal(inferRegion(-100.5), 'west');
  assert.equal(inferRegion(NaN), 'east');
});

function beefPlan(acres, extra = {}) {
  return { ...emptyPlan('Beef'), allocations: [{ id: 'a1', kind: 'livestock', item: 'beef', acres, heads: null }], ...extra };
}

test('evaluatePlan: 100 ac of beef on ideal soil', () => {
  const land = squareLand(120);
  const evaluation = evaluatePlan(beefPlan(100), land);
  const l = evaluation.livestock[0];
  assert.equal(l.capacity.maxHeads, 42);
  assert.equal(l.heads, 31);
  assert.equal(l.overstocked, false);
  assert.equal(l.hayCost, 0);
  assert.ok(near(evaluation.money.annualRevenue.base, 31 * 1300));
  assert.ok(near(evaluation.money.annualCost, 31 * 450));
  assert.ok(near(evaluation.money.setupCost, 31 * 3000));
  assert.ok(near(evaluation.water.hot, 31 * 23.6));
  assert.equal(evaluation.fitScore, 100);
  assert.ok(evaluation.basis.starterShare > 0.9);
});

test('overstocking adds a hay bill and a warning', () => {
  const land = squareLand(120);
  const plan = beefPlan(100);
  plan.allocations[0].heads = 60;
  const evaluation = evaluatePlan(plan, land);
  const l = evaluation.livestock[0];
  assert.equal(l.overstocked, true);
  assert.ok(l.shortfallLb > 0 && l.hayCost > 0);
  const short = 60 * 9490 - 100 * 10000 * 0.4 * (evaluation.livestock[0].capacity.forageLbPerAc / 10000);
  assert.ok(near(l.shortfallLb, short, 1));
  assert.ok(evaluation.warnings.some((w) => /more than the 42/.test(w)));
  assert.ok(evaluation.risk > evaluatePlan(beefPlan(100), land).risk);
});

test('no water source triggers a warning for livestock', () => {
  const land = squareLand(120, IDEAL_SOIL, { waterSource: null });
  const evaluation = evaluatePlan(beefPlan(100), land);
  assert.ok(evaluation.warnings.some((w) => /water source/i.test(w)));
});

test('assigning more acres than usable warns', () => {
  const evaluation = evaluatePlan(beefPlan(500), squareLand(120));
  assert.ok(evaluation.warnings.some((w) => /usable acres/.test(w)));
});

test('crop plan: net low < base < high, and bad soil lowers net', () => {
  const plan = { ...emptyPlan('Corn'), allocations: [{ id: 'c1', kind: 'crop', item: 'corn', acres: 40 }] };
  const good = evaluatePlan(plan, squareLand(60));
  const bad = evaluatePlan(plan, squareLand(60, { ph: 4.9, drainage: 'poor', texture: 'sand', slopePct: 12, depthIn: 10 }));
  assert.ok(good.money.net.low < good.money.net.base && good.money.net.base < good.money.net.high);
  assert.ok(bad.money.net.base < good.money.net.base);
  assert.ok(bad.fitScore < good.fitScore);
  assert.ok(bad.warnings.some((w) => /soil fit/i.test(w)));
});

test('wet ground makes alfalfa a worse bet than sorghum', () => {
  const land = squareLand(60, { ...IDEAL_SOIL, drainage: 'poor' });
  const r = rankOptions(land);
  const alf = r.crops.find((c) => c.id === 'alfalfa');
  const sor = r.crops.find((c) => c.id === 'sorghum');
  assert.ok(alf.fit < sor.fit);
  assert.equal(alf.limiting, 'Drainage');
});

test('rankOptions: horses are lifestyle, sorted by net per acre', () => {
  const r = rankOptions(squareLand(60));
  assert.ok(r.livestock.find((l) => l.id === 'horses').lifestyle);
  for (let i = 1; i < r.livestock.length; i++) assert.ok(r.livestock[i - 1].netPerAcre >= r.livestock[i].netPerAcre);
  for (let i = 1; i < r.crops.length; i++) assert.ok(r.crops[i - 1].netPerAcre >= r.crops[i].netPerAcre);
});

test('user price overrides change the math', () => {
  const land = squareLand(120);
  const plan = beefPlan(100);
  const base = evaluatePlan(plan, land);
  const overrides = { livestock: { beef: { annualRevenue: 2000 } } };
  const high = evaluatePlan(plan, land, overrides);
  assert.ok(high.money.net.base > base.money.net.base);
  assert.equal(livestockEcon('beef', overrides).annualRevenue, 2000);
  assert.equal(fenceCostPerFt('barbed5', { fence: { barbed5: { costPerFt: 5 } } }), 5);
});

test('comparePlans ranks the dominating plan first and explains why', () => {
  const land = squareLand(80);
  const good = evaluatePlan({ ...emptyPlan('Sheep'), allocations: [{ id: 'a', kind: 'livestock', item: 'sheep', acres: 60, heads: null }] }, land);
  const bad = evaluatePlan({ ...emptyPlan('Horses'), allocations: [{ id: 'a', kind: 'livestock', item: 'horses', acres: 60, heads: null }] }, land);
  const ranked = comparePlans([bad, good]);
  assert.equal(ranked[0].eval.name, 'Sheep');
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(ranked[0].reasons.length >= 1);
  assert.deepEqual(comparePlans([]), []);
  assert.equal(comparePlans([good]).length, 1);
});

test('comparePlans weights can flip the winner', () => {
  const land = squareLand(80);
  const cheap = evaluatePlan({ ...emptyPlan('Hay'), allocations: [{ id: 'a', kind: 'crop', item: 'hay', acres: 60 }] }, land);
  const rich = evaluatePlan({ ...emptyPlan('Beef'), allocations: [{ id: 'a', kind: 'livestock', item: 'beef', acres: 60, heads: null }] }, land);
  const byProfit = comparePlans([cheap, rich], { profit: 1, fit: 0, risk: 0, startup: 0 });
  const byStartup = comparePlans([cheap, rich], { profit: 0, fit: 0, risk: 0, startup: 1 });
  assert.notEqual(byProfit[0].eval.name, byStartup[0].eval.name);
});

test('suggestPlans builds three finite, evaluable plans', () => {
  const land = squareLand(80, IDEAL_SOIL, { fences: [] });
  const plans = suggestPlans(land, { garden: true });
  assert.equal(plans.length, 3);
  for (const p of plans) {
    const evaluation = evaluatePlan(p, land);
    assert.ok(Number.isFinite(evaluation.money.net.base) && Number.isFinite(evaluation.risk) && Number.isFinite(evaluation.fitScore), p.name);
    assert.ok(evaluation.acres.allocated <= evaluation.acres.usable + 0.1, `${p.name} allocated ${evaluation.acres.allocated} of ${evaluation.acres.usable}`);
  }
  assert.deepEqual(plans.map((p) => p.name), ['Grazing focus', 'Crop focus', 'Balanced, lower risk']);
});

test('suggestPlans respects interests and excludes horses unless hobby', () => {
  const land = squareLand(80);
  const only = suggestPlans(land, { interests: { livestock: ['goats'], crops: ['wheat'] } });
  const items = only.flatMap((p) => p.allocations.map((a) => a.item)).filter(Boolean);
  assert.ok(items.every((i) => ['goats', 'wheat', 'hay', undefined].includes(i)), items.join(','));
  const noHorses = suggestPlans(land, {});
  assert.ok(!noHorses.flatMap((p) => p.allocations.map((a) => a.item)).includes('horses'));
});

test('scaleToBudget shrinks the herd to fit', () => {
  const land = squareLand(120);
  const plan = beefPlan(100);
  const full = evaluatePlan(plan, land).money.setupCost;
  const scaled = scaleToBudget(plan, land, 50000);
  const evaluation = evaluatePlan(scaled, land);
  assert.ok(evaluation.money.setupCost <= 50000, `${evaluation.money.setupCost}`);
  assert.ok(evaluation.money.setupCost < full);
  assert.match(scaled.notes, /scaled/i);
  const impossible = scaleToBudget(plan, land, 100);
  assert.match(impossible.notes, /above the budget/);
});

test('empty land or empty plan never throws and gives zeros', () => {
  const evaluation = evaluatePlan(emptyPlan(), squareLand(10));
  assert.equal(evaluation.money.net.base, 0);
  assert.equal(evaluation.fitScore, 0);
  assert.deepEqual(suggestPlans({ boundary: [], soil: {}, zones: [], fences: [] }), []);
  assert.doesNotThrow(() => evaluatePlan(emptyPlan(), {}));
});

test('five-year cumulative cash starts at minus the start-up cost', () => {
  const evaluation = evaluatePlan(beefPlan(100), squareLand(120));
  assert.equal(evaluation.money.cumulative.length, DEFAULT_ASSUMPTIONS.yearsProjected + 1);
  assert.ok(near(evaluation.money.cumulative[0].base, -evaluation.money.setupCost));
  assert.ok(near(evaluation.money.cumulative[5].base, -evaluation.money.setupCost + 5 * evaluation.money.net.base));
});

test('an allocation linked to a drawn zone takes its acres from the zone', () => {
  const square = Math.sqrt(10 * M2_PER_ACRE);
  const land = squareLand(40, IDEAL_SOIL, { zones: [{ id: 'z1', use: 'pasture', polygon: rectPolygon(square, square) }] });
  const plan = { ...emptyPlan('Linked'), allocations: [{ id: 'a1', kind: 'livestock', item: 'sheep', acres: 999, zoneId: 'z1', heads: null }] };
  const evaluation = evaluatePlan(plan, land);
  assert.ok(near(evaluation.livestock[0].acres, 10, 1e-6));
  const stale = { ...plan, allocations: [{ ...plan.allocations[0], zoneId: 'gone', acres: 5 }] };
  assert.ok(near(evaluatePlan(stale, land).livestock[0].acres, 5, 1e-9));
});

test('boundary fence suits the animals: cattle get barbed wire, sheep/goats/hens get woven wire', () => {
  assert.equal(bestBoundaryFence(['beef']), 'barbed5');
  assert.equal(bestBoundaryFence(['goats', 'sheep']), 'woven47');
  assert.equal(bestBoundaryFence([]), 'barbed5');
  const land = squareLand(80, IDEAL_SOIL, { fences: [] });
  const plans = suggestPlans(land, { interests: { livestock: ['goats', 'sheep'], crops: ['wheat'] }, garden: false });
  for (const p of plans.filter((x) => x.fenceBoundary)) {
    const kinds = p.allocations.filter((a) => a.kind === 'livestock').map((a) => a.item);
    if (kinds.length) assert.notEqual(p.boundaryFence, 'barbed5', p.name);
    assert.deepEqual(evaluatePlan(p, land).warnings.filter((w) => /poor choice/.test(w)), [], p.name);
  }
});

test('price scenarios move revenue and cost but not the start-up cost', () => {
  const land = squareLand(120);
  const evaluation = evaluatePlan(beefPlan(100), land);
  assert.equal(applyScenario(evaluation, {}), evaluation);
  const down = applyScenario(evaluation, { revenuePct: -20, costPct: 10 });
  assert.ok(near(down.money.annualRevenue.base, evaluation.money.annualRevenue.base * 0.8));
  assert.ok(near(down.money.annualCost, evaluation.money.annualCost * 1.1));
  assert.ok(near(down.money.net.base, evaluation.money.annualRevenue.base * 0.8 - evaluation.money.annualCost * 1.1));
  assert.equal(down.money.setupCost, evaluation.money.setupCost);
  assert.ok(near(down.money.cumulative[3].base, -evaluation.money.setupCost + 3 * down.money.net.base));
  assert.equal(evaluation.money.net.base, evaluatePlan(beefPlan(100), land).money.net.base);
});
