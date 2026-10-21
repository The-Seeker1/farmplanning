import { h, s, clear, num, money } from './dom.js';
import { app } from '../state.js';
import { callout, emptyState, sourceBadge } from './common.js';
import { comparePlans, applyScenario } from '../planner.js';
import { DEFAULT_COMPARE_WEIGHTS } from '../storage.js';

const CRITERIA = [
  { id: 'profit', label: 'Profit per year', color: '#2f6b3a' },
  { id: 'fit', label: 'Soil fit', color: '#2a6f97' },
  { id: 'risk', label: 'Low risk', color: '#c9a227' },
  { id: 'startup', label: 'Low start-up cost', color: '#7a4f9a' },
];
const PRESETS = [
  { label: 'Balanced', w: { profit: 35, fit: 30, risk: 20, startup: 15 } },
  { label: 'Make the most money', w: { profit: 70, fit: 15, risk: 10, startup: 5 } },
  { label: 'Play it safe', w: { profit: 15, fit: 30, risk: 45, startup: 10 } },
  { label: 'Spend the least to start', w: { profit: 15, fit: 15, risk: 15, startup: 55 } },
  { label: 'Best match for my soil', w: { profit: 15, fit: 65, risk: 10, startup: 10 } },
];
const LINE_COLORS = ['#2f6b3a', '#c9a227', '#2a6f97', '#a63a2b', '#7a4f9a', '#4f7a7a'];
const DASHES = [null, '6 3', '2 3', '8 3 2 3', '10 4', '1 4'];

let scenario = { revenuePct: 0, costPct: 0 };
let excluded = new Set();

function cashChart(rows, years) {
  const W = 640;
  const chartHeight = 300;
  const m = { l: 62, r: 14, t: 14, b: 30 };
  const all = rows.flatMap((r) => r.eval.money.cumulative.map((c) => c.base));
  let low = Math.min(0, ...all);
  let high = Math.max(0, ...all);
  if (high - low < 1) high = low + 1;
  const padding = (high - low) * 0.08;
  low -= padding;
  high += padding;
  const x = (year) => m.l + ((W - m.l - m.r) * year) / years;
  const y = (v) => m.t + ((chartHeight - m.t - m.b) * (high - v)) / (high - low);
  const ticks = 5;
  const svg = s('svg', { viewBox: `0 0 ${W} ${chartHeight}`, class: 'chart', role: 'img', 'aria-label': `Cumulative cash after ${years} years for ${rows.length} plans. The numbers are in the table below the chart.` });
  for (let i = 0; i <= ticks; i++) {
    const v = low + ((high - low) * i) / ticks;
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: '#e5e0cf' }), s('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, money(Math.round(v / 100) * 100)));
  }
  svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), stroke: '#5d6a5d', 'stroke-width': 1.5 }));
  for (let year = 0; year <= years; year++) svg.append(s('text', { x: x(year), y: chartHeight - 8, 'text-anchor': 'middle' }, `Yr ${year}`));
  rows.forEach((r, i) => {
    const points = r.eval.money.cumulative.map((c) => `${x(c.year).toFixed(1)},${y(c.base).toFixed(1)}`).join(' ');
    svg.append(s('polyline', { points: points, fill: 'none', stroke: LINE_COLORS[i % LINE_COLORS.length], 'stroke-width': i === 0 ? 3.5 : 2.2, 'stroke-dasharray': DASHES[i % DASHES.length] || null }));
    for (const c of r.eval.money.cumulative) svg.append(s('circle', { cx: x(c.year), cy: y(c.base), r: 2.6, fill: LINE_COLORS[i % LINE_COLORS.length] }));
  });
  return svg;
}

export default function createCompareTab({ go }) {
  const element = h('div');

  const setWeights = (w) => app.updatePrefs({ compareWeights: w });

  function weightsCard(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
    const card = h('div', { class: 'card' });
    card.append(h('h3', {}, 'What matters most to you?'), h('p', { class: 'small' }, 'Slide each bar. The ranking recomputes right away. The weights only change the ranking, never the numbers.'));
    card.append(h('div', { class: 'row tight', role: 'group', 'aria-label': 'Weight presets' }, PRESETS.map((p) => h('button', { class: 'chip', type: 'button', onclick: () => setWeights(p.w) }, p.label))));
    const grid = h('div', { class: 'fields mt' });
    for (const c of CRITERIA) {
      const input = h('input', { type: 'range', min: 0, max: 100, step: 5, value: weights[c.id], 'data-key': `w-${c.id}`, id: `w-${c.id}`, onchange: (e) => setWeights({ ...weights, [c.id]: Number(e.target.value) }) });
      grid.append(h('div', { class: 'field' }, h('label', { for: `w-${c.id}` }, h('span', { class: 'legend-dot', style: { background: c.color } }), `${c.label}: ${Math.round((weights[c.id] / total) * 100)}%`), input));
    }
    card.append(grid);
    return card;
  }

  function scenarioCard() {
    const card = h('div', { class: 'card' });
    const slider = (key, label, hint) => {
      const id = `sc-${key}`;
      return h('div', { class: 'field' },
        h('label', { for: id }, `${label}: ${scenario[key] > 0 ? '+' : ''}${scenario[key]}%`),
        h('input', { id, type: 'range', min: -40, max: 40, step: 5, value: scenario[key], 'data-key': id, onchange: (e) => { scenario = { ...scenario, [key]: Number(e.target.value) }; render(); } }),
        h('span', { class: 'hint' }, hint));
    };
    card.append(h('h3', {}, 'What if prices change?'), h('p', { class: 'small' }, 'Cost prediction: test every plan against a bad (or good) year for prices. This does not change your saved plans.'),
      h('div', { class: 'fields' },
        slider('revenuePct', 'Prices you get for products', 'Cattle, grain, eggs, hay...'),
        slider('costPct', 'Cost of feed, seed and supplies', 'Fertilizer, hay you buy, vet bills...')),
      (scenario.revenuePct || scenario.costPct) ? h('button', { class: 'secondary small', onclick: () => { scenario = { revenuePct: 0, costPct: 0 }; render(); } }, 'Reset to today\'s prices') : null);
    return card;
  }

  function explainBest(best, second, weights) {
    const e = best.eval;
    const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
    const card = h('div', { class: 'card tint-green' });
    card.append(h('h3', {}, `Best fit: ${e.name}`), h('p', {}, `Score ${best.score} out of 100 for what you said matters.`));
    if (second && best.reasons?.length) card.append(h('p', {}, `Compared with ${second.eval.name}, it ${best.reasons.join(', ')}.`));
    else if (second) card.append(h('p', {}, `It edges out ${second.eval.name} on your weighting, but the differences are small.`));
    const topReason = CRITERIA.map((c) => ({ c, v: (weights[c.id] / total) * best.parts[c.id] })).sort((a, b) => b.v - a.v)[0];
    card.append(h('p', { class: 'small' }, `Its biggest score comes from ${topReason.c.label.toLowerCase()}. `, `Typical year: ${money(e.money.net.base)} net (range ${money(e.money.net.low)} to ${money(e.money.net.high)}), start-up ${money(e.money.setupCost)}, soil fit ${e.fitScore}/100, risk ${e.risk}.`));
    if (e.warnings.length) card.append(callout('warn', h('strong', {}, `Open this plan to look at ${e.warnings.length} warning${e.warnings.length === 1 ? '' : 's'}: `), e.warnings[0]));
    if (e.basis.starterShare > 0.2) card.append(callout('warn', `${Math.round(e.basis.starterShare * 100)}% of this plan's dollars use starter prices, so treat the profit numbers as a way to compare plans, not as a forecast. Replace them in Settings.`));
    if (e.confidence < 0.6) card.append(callout('info', 'The soil-fit score rests on guesses for some soil facts you have not entered yet (pH, drainage, texture, slope or depth). Fill them in on the Land tab to tighten the ranking.'));
    card.append(h('div', { class: 'row mt' }, h('button', { onclick: () => { app.setActivePlan(e.planId); go('plans'); } }, 'Open this plan'), h('button', { class: 'secondary', onclick: () => { app.setActivePlan(e.planId); go('view3d'); } }, 'See it in 3D')));
    return card;
  }

  function table(rows) {
    const t = h('table', {},
      h('thead', {}, h('tr', {}, ['#', 'Plan', 'Score', 'Net / year (low to high)', 'Start-up', 'Payback', 'Soil fit', 'Risk', 'Acres'].map((x, i) => h('th', { class: i > 1 ? 'num' : '' }, x)))),
      h('tbody', {}, rows.map((r, i) => {
        const m = r.eval.money;
        return h('tr', { class: i === 0 ? 'best' : '' },
          h('td', {}, String(i + 1)),
          h('td', {}, r.eval.name),
          h('td', { class: 'num' }, String(r.score)),
          h('td', { class: 'num' }, `${money(m.net.base)} (${money(m.net.low)} to ${money(m.net.high)})`),
          h('td', { class: 'num' }, money(m.setupCost)),
          h('td', { class: 'num' }, m.payback == null ? 'never' : `${num(m.payback, 1)} yr`),
          h('td', { class: 'num' }, `${r.eval.fitScore}`),
          h('td', { class: 'num' }, `${r.eval.risk}`),
          h('td', { class: 'num' }, num(r.eval.acres.allocated, 1)));
      })));
    return h('div', { class: 'table-wrap' }, t);
  }

  function breakdown(rows, weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
    const wrap = h('div', {});
    wrap.append(h('div', { class: 'row tight small' }, CRITERIA.map((c) => h('span', {}, h('span', { class: 'legend-dot', style: { background: c.color } }), c.label))));
    for (const r of rows) {
      const bar = h('div', { class: 'cover-bar', role: 'img', 'aria-label': `${r.eval.name}: ${CRITERIA.map((c) => `${c.label} ${Math.round((weights[c.id] / total) * r.parts[c.id] * 100)} points`).join(', ')}` });
      for (const c of CRITERIA) {
        const points = (weights[c.id] / total) * r.parts[c.id] * 100;
        bar.append(h('span', { style: { width: `${points}%`, background: c.color }, title: `${c.label}: ${num(points, 0)} points` }));
      }
      bar.style.background = '#f1eee0';
      wrap.append(h('div', { class: 'mt' }, h('div', { class: 'small' }, `${r.eval.name}: ${r.score} of 100`), bar));
    }
    return wrap;
  }

  function costCard(best) {
    const e = best.eval;
    const rows = [];
    for (const l of e.livestock) rows.push([l.label, `${num(l.heads)} head`, l.econ.cost - l.hayCost, l.hayCost]);
    for (const c of e.crops) rows.push([c.label, `${num(c.acres, 1)} ac`, c.cost, 0]);
    if (e.garden) rows.push(['Garden', `${num(e.garden.areaSqFt)} sq ft`, e.garden.cost, 0]);
    const costFactor = 1 + scenario.costPct / 100;
    const card = h('div', { class: 'card' });
    card.append(h('h3', {}, `Where the money goes in "${e.name}"`));
    card.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Item', 'Amount', 'Yearly costs', 'Hay you would buy'].map((x, i) => h('th', { class: i > 1 ? 'num' : '' }, x)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r[0]), h('td', {}, r[1]), h('td', { class: 'num' }, money(r[2] * costFactor)), h('td', { class: 'num' }, r[3] ? money(r[3] * costFactor) : '-')))))));
    card.append(h('p', { class: 'small' }, `One-time: animals and shelters ${money(e.money.setupLivestock)}, fencing ${money(e.fence.cost)}. `, sourceBadge('mu_fence', 'Fence: Missouri Extension 2024'), ' ', sourceBadge('starter', 'Animals, seed, feed: starter prices')));
    return card;
  }

  function render() {
    clear(element);
    element.append(h('h2', {}, 'Compare plans'));
    const plans = app.profile.plans;
    if (plans.length < 2) {
      element.append(emptyState('You need at least two plans to compare', 'Open the Plans tab and press "Suggest plans for my land" to get three starting plans, or duplicate a plan and change it.', h('button', { onclick: () => go('plans') }, 'Go to Plans')));
      return;
    }
    const weights = app.prefs.compareWeights || DEFAULT_COMPARE_WEIGHTS;
    const picked = plans.filter((p) => !excluded.has(p.id)).slice(0, 6);

    const chooser = h('div', { class: 'card' }, h('h3', {}, 'Plans to compare'), h('div', { class: 'row tight', role: 'group', 'aria-label': 'Plans to compare' }, plans.map((p) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!excluded.has(p.id)), onclick: () => {
      if (excluded.has(p.id)) excluded.delete(p.id);
      else excluded.add(p.id);
      render();
    } }, p.name))), plans.length > 6 ? h('p', { class: 'small muted' }, 'Up to six plans are compared at once.') : null);
    element.append(chooser);

    if (picked.length < 2) {
      element.append(callout('warn', 'Pick at least two plans above.'));
      return;
    }

    const evals = picked.map((p) => applyScenario(app.evaluate(p), scenario));
    const ranked = comparePlans(evals, weights);
    element.append(h('div', { class: 'grid two mt' }, weightsCard(weights), scenarioCard()));
    element.append(h('div', { class: 'mt' }, explainBest(ranked[0], ranked[1], weights)));
    element.append(h('div', { class: 'card mt' }, h('h3', {}, 'Side by side'), table(ranked),
      h('p', { class: 'small muted' }, 'Net = revenue minus yearly costs. Low and high use the weaker and stronger of the last two Kansas yield years for crops. Risk is a 0 to 100 score from yield swings, soil fit, missing data, overstocking and water.')));
    element.append(h('div', { class: 'card mt' }, h('h3', {}, 'Cash over five years (typical year)'), cashChart(ranked, ranked[0].eval.money.cumulative.length - 1),
      h('div', { class: 'row tight small' }, ranked.map((r, i) => h('span', {}, h('span', { class: 'legend-dot', style: { background: LINE_COLORS[i % LINE_COLORS.length] } }), r.eval.name))),
      h('details', { class: 'mt' }, h('summary', {}, 'Show the numbers'), h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, [h('th', {}, 'Plan'), ...ranked[0].eval.money.cumulative.map((c) => h('th', { class: 'num' }, `Year ${c.year}`))])),
        h('tbody', {}, ranked.map((r) => h('tr', {}, h('td', {}, r.eval.name), ...r.eval.money.cumulative.map((c) => h('td', { class: 'num' }, money(c.base)))))))))));
    element.append(h('div', { class: 'card mt' }, h('h3', {}, 'How each plan earned its score'), breakdown(ranked, weights)));
    element.append(h('div', { class: 'mt' }, costCard(ranked[0])));
  }

  return { el: element, render };
}
