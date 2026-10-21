import { h, clear, num, money } from './dom.js';
import { app } from '../state.js';
import { toast, showModal, askText, askConfirm, field, numberInput, selectInput, sourceBadge, sourceList, callout, emptyState } from './common.js';
import { LIVESTOCK, GRAZING, getLivestock } from '../data/livestock.js';
import { CROPS, VEGETABLES, getCrop } from '../data/crops.js';
import { FENCES } from '../data/fences.js';
import { suggestPlans, emptyPlan, newId, zoneAcres } from '../planner.js';
import { USE_LABEL } from './labels.js';
import { adviseOnPlanAI, buildAIContext } from '../ai/tasks.js';

const MAX_PLANS = 20;

export function stockingMathText(l) {
  const capacity = l.capacity;
  if (capacity.method === 'forage') {
    return [
      `${num(l.acres, 2)} acres x ${num(capacity.forageLbPerAc)} lb forage per acre x ${Math.round(capacity.utilization * 100)}% usable = ${num(capacity.supplyLbPerYr)} lb of forage a year`,
      `1 ${l.unitLabel || 'head'} eats about ${num(capacity.demandLbPerHead)} lb a year`,
      `${num(capacity.supplyLbPerYr)} / ${num(capacity.demandLbPerHead)} = ${num(capacity.maxHeads)} head at most (start with ${num(l.startHeads)})`,
    ].join('\n');
  }
  return [
    `${num(l.acres, 2)} acres x ${num(capacity.perAcre, 1)} per acre = ${num(capacity.maxHeads)} at most (start with ${num(l.startHeads)})`,
    capacity.perAcre < getLivestock(l.item).perAcre ? 'The published density assumes you rotate paddocks; non-rotated ground holds fewer.' : 'This density assumes you rotate across paddocks.',
  ].join('\n');
}

function statBox(label, value, kind = '', subtitle = null) {
  return h('div', { class: `kpi ${kind}` }, h('div', { class: 'v' }, value), h('div', { class: 'l' }, label), subtitle ? h('div', { class: 'small muted' }, subtitle) : null);
}

export default function createPlansTab({ go }) {
  const element = h('div');
  let advice = null;
  let adviceBusy = false;
  let adviceQuestion = '';

  const mutatePlan = (listener) => {
    const id = app.plan?.id;
    if (!id) return;
    app.update((d) => {
      const p = d.plans.find((x) => x.id === id);
      if (p) listener(p, d);
    });
  };
  const mutateAlloc = (allocId, listener) => mutatePlan((p) => {
    const a = p.allocations.find((x) => x.id === allocId);
    if (a) listener(a, p);
  });

  const guard = async (listener) => {
    try {
      await listener();
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  function newBlank() {
    guard(async () => {
      const name = await askText('Name the new plan', `Plan ${app.profile.plans.length + 1}`);
      if (name) app.addPlan(emptyPlan(name));
    });
  }

  function suggestDialog() {
    const goals = { hobby: false, garden: true, budget: '', livestock: new Set(Object.keys(LIVESTOCK).filter((id) => !LIVESTOCK[id].econ.lifestyle)), crops: new Set(Object.keys(CROPS).filter((id) => id !== 'hay')) };
    showModal((box, close) => {
      const chips = (set, source, labelOf) => h('div', { class: 'row tight', role: 'group' }, Object.keys(source).filter((id) => !source[id].econ?.lifestyle).map((id) => {
        const b = h('button', { class: 'chip', 'aria-pressed': String(set.has(id)), type: 'button', onclick: () => {
          if (set.has(id)) set.delete(id);
          else set.add(id);
          b.setAttribute('aria-pressed', String(set.has(id)));
        } }, labelOf(id));
        return b;
      }));
      const hobby = h('input', { type: 'checkbox', onchange: (e) => { goals.hobby = e.target.checked; } });
      const garden = h('input', { type: 'checkbox', checked: true, onchange: (e) => { goals.garden = e.target.checked; } });
      const budget = h('input', { type: 'number', min: 0, step: 500, placeholder: 'No limit', 'aria-label': 'Start-up budget in dollars' });
      box.append(
        h('h3', {}, 'Suggest plans for my land'),
        h('p', { class: 'small' }, 'FieldWise ranks every animal and crop for your soil, then builds three starting plans: grazing focus, crop focus, and a balanced lower-risk mix. You can edit them afterward.'),
        h('h4', {}, 'Animals to consider'), chips(goals.livestock, LIVESTOCK, (id) => LIVESTOCK[id].label),
        h('h4', { class: 'mt' }, 'Crops to consider'), chips(goals.crops, CROPS, (id) => CROPS[id].label),
        h('label', { class: 'check mt' }, hobby, 'Include horses and other hobby animals (they cost money instead of earning it)'),
        h('label', { class: 'check' }, garden, 'Include a vegetable garden'),
        field('Start-up budget (optional)', budget, 'If set, the animals are scaled down to fit it.'),
        h('div', { class: 'row mt' },
          h('button', { onclick: () => guard(() => {
            const b = budget.value.trim() === '' ? null : Number(budget.value);
            const interests = { livestock: [...goals.livestock], crops: [...goals.crops] };
            const plans = suggestPlans(app.land, { interests, hobby: goals.hobby, garden: goals.garden, budget: Number.isFinite(b) ? b : null }, app.profile.overrides, app.assumptions);
            if (!plans.length) throw new Error('There is not enough usable land yet. Set your land size on the Land tab or draw it on the Map.');
            app.update((d) => {
              for (const p of plans) if (d.plans.length < MAX_PLANS) d.plans.push(p);
              d.activePlanId = plans[0].id;
            });
            close();
            toast(`Added ${plans.length} suggested plans. Open the Compare tab to rank them.`, 'good');
          }) }, 'Create plans'),
          h('button', { class: 'secondary', onclick: close }, 'Cancel')),
      );
    });
  }

  function planBar(land) {
    const plans = app.profile.plans;
    const bar = h('div', { class: 'card' });
    bar.append(h('div', { class: 'row' },
      plans.length ? h('div', { class: 'field tight' }, h('label', { for: 'plan-sel' }, 'Plan'), (() => {
        const s = selectInput({ value: app.plan?.id, key: 'plan-select', options: plans.map((p) => ({ value: p.id, label: p.name })), onChange: (v) => v && app.setActivePlan(v) });
        s.id = 'plan-sel';
        return s;
      })()) : null,
      h('span', { class: 'spacer' }),
      h('button', { onclick: suggestDialog, disabled: land.boundary.length < 3 }, 'Suggest plans for my land'),
      h('button', { class: 'secondary', onclick: newBlank }, 'New blank plan'),
      plans.length ? h('button', { class: 'secondary', onclick: () => guard(() => { app.duplicatePlan(); toast('Plan duplicated.', 'good'); }) }, 'Duplicate') : null,
      plans.length ? h('button', { class: 'secondary', onclick: () => guard(async () => { const n = await askText('Rename plan', app.plan.name); if (n) mutatePlan((p) => { p.name = n.slice(0, 60); }); }) }, 'Rename') : null,
      plans.length ? h('button', { class: 'danger', onclick: () => guard(async () => { if (await askConfirm(`Delete the plan "${app.plan.name}"?`, { yes: 'Delete', danger: true })) app.deletePlan(); }) }, 'Delete') : null,
    ));
    return bar;
  }

  function landChoice(a, land) {
    const options = [{ value: '', label: 'Type in acres' }, ...land.zones.map((z) => ({ value: z.id, label: `${z.name} (${USE_LABEL[z.use]}, ${num(zoneAcres(z), 1)} ac)` }))];
    return selectInput({ value: a.zoneId || '', key: `zone-${a.id}`, options, onChange: (v) => mutateAlloc(a.id, (x) => { x.zoneId = v; }) });
  }

  function allocRow(a, evaluation, land) {
    const isAnimal = a.kind === 'livestock';
    const isCrop = a.kind === 'crop';
    const animalResult = isAnimal ? evaluation.livestock.find((l) => l.allocId === a.id) : null;
    const cropResult = isCrop ? evaluation.crops.find((c) => c.allocId === a.id) : null;
    const zone = a.zoneId ? land.zones.find((z) => z.id === a.zoneId) : null;
    const itemOptions = isAnimal ? Object.values(LIVESTOCK).map((s) => ({ value: s.id, label: s.label })) : isCrop ? Object.values(CROPS).map((c) => ({ value: c.id, label: c.label })) : null;
    const box = h('div', { class: 'alloc' });
    box.append(h('div', { class: 'row' },
      h('strong', {}, isAnimal ? 'Animals' : isCrop ? 'Crop' : 'Vegetable garden'),
      itemOptions ? selectInput({ value: a.item, key: `item-${a.id}`, options: itemOptions, onChange: (v) => v && mutateAlloc(a.id, (x) => { x.item = v; x.heads = null; }) }) : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'danger small', 'aria-label': 'Remove this item', onclick: () => mutatePlan((p) => { p.allocations = p.allocations.filter((x) => x.id !== a.id); }) }, 'Remove'),
    ));
    const fields = h('div', { class: 'fields' });
    fields.append(field('Land', landChoice(a, land)));
    if (zone) fields.append(h('div', { class: 'field' }, h('label', {}, 'Acres'), h('div', { class: 'small' }, `${num(zoneAcres(zone), 2)} (from the zone you drew)`)));
    else {
      const acres = numberInput({ value: a.acres, min: 0, max: 100000, key: `acres-${a.id}`, onChange: (v) => mutateAlloc(a.id, (x) => { x.acres = v ?? 0; }) });
      const rest = evaluation.acres.unallocated;
      fields.append(field('Acres', acres, rest > 0.05 ? `${num(rest, 1)} usable acres are still unassigned.` : ''));
    }
    if (isAnimal && animalResult) {
      const heads = numberInput({ value: a.heads, min: 0, max: 100000, key: `heads-${a.id}`, placeholder: `${animalResult.startHeads} suggested`, onChange: (v) => mutateAlloc(a.id, (x) => { x.heads = v === null ? null : Math.floor(v); }) });
      fields.append(field(`How many ${animalResult.unitPlural}`, heads, `Most this land can feed: ${num(animalResult.capacity.maxHeads)}. Suggested start: ${num(animalResult.startHeads)}.`));
    }
    box.append(fields);

    if (a.kind === 'garden') {
      box.append(h('div', { class: 'small' }, 'Vegetables to grow (rows and plants are worked out from the garden size):'),
        h('div', { class: 'row tight', role: 'group', 'aria-label': 'Vegetables' }, Object.values(VEGETABLES).map((v) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!!a.vegetables?.[v.id]), onclick: () => mutateAlloc(a.id, (x) => {
          x.vegetables = { ...(x.vegetables || {}) };
          if (x.vegetables[v.id]) delete x.vegetables[v.id];
          else x.vegetables[v.id] = 1;
        }) }, v.label))));
    }

    if (animalResult) {
      if (animalResult.overstocked) box.append(callout('warn', `${num(animalResult.heads)} is above the ${num(animalResult.capacity.maxHeads)} this land can feed. Hay costs of ${money(animalResult.hayCost)} a year are included in the plan.`));
      box.append(h('details', {}, h('summary', {}, 'Show the stocking math'), h('div', { class: 'math' }, stockingMathText({ ...animalResult, unitLabel: getLivestock(animalResult.item).unitLabel })),
        h('p', { class: 'small' }, 'Sources: ', sourceBadge(getLivestock(animalResult.item).srcCapacity), ' ', sourceBadge(getLivestock(animalResult.item).srcEcon, 'Prices: starter'))));
    }
    if (cropResult) box.append(cropDetails(cropResult, a));
    return box;
  }

  function cropDetails(c, a) {
    const crop = getCrop(c.item);
    const fit = c.fit;
    const factors = Object.values(fit.factors).map((f) => h('tr', {}, h('td', {}, f.label), h('td', {}, f.note), h('td', { class: 'num' }, f.known ? num(f.f * 100) : `${num(f.f * 100)} (guess)`)));
    return h('details', {},
      h('summary', {}, `${crop.label}: soil fit ${fit.score}/100, about ${num(c.yield.base.total)} ${crop.unit} a year`),
      h('p', { class: 'small' }, `Per acre in a low / typical / high year: ${num(c.yield.low.perAcre, 1)} / ${num(c.yield.base.perAcre, 1)} / ${num(c.yield.high.perAcre, 1)} ${crop.unit}. State averages are scaled by soil fit (x${num(c.multiplier, 2)}).`),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Soil factor'), h('th', {}, 'Your land'), h('th', { class: 'num' }, 'Score'))), h('tbody', {}, factors))),
      c.lime?.text ? callout(c.lime.needed ? 'warn' : 'good', c.lime.text) : null,
      h('p', { class: 'small' }, `Planting (K-State zone ${app.assumptions.zone}): ${app.assumptions.zone === 4 ? crop.planting.z4 : crop.planting.z3}. ${crop.planting.seeding}.`),
      h('p', { class: 'small' }, 'Sources: ', sourceBadge(crop.srcYield), ' ', sourceBadge(crop.srcSoil), ' ', sourceBadge(crop.srcEcon, 'Prices: starter')),
    );
  }

  function planEditor(evaluation, land) {
    const p = app.plan;
    const card = h('div', { class: 'card' });
    card.append(h('h3', {}, p.name));
    const top = h('div', { class: 'fields' });
    top.append(
      field('How animals are moved', selectInput({ value: p.grazing, key: 'grazing', options: Object.values(GRAZING).map((g) => ({ value: g.id, label: g.label })), onChange: (v) => v && mutatePlan((x) => { x.grazing = v; }) })),
      h('div', { class: 'field' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.fenceBoundary, 'data-key': 'fence-boundary', onchange: (e) => mutatePlan((x) => { x.fenceBoundary = e.target.checked; }) }), 'Fence the whole boundary')),
    );
    if (p.fenceBoundary) {
      top.append(
        field('Boundary fence type', selectInput({ value: p.boundaryFence, key: 'boundary-fence', options: Object.values(FENCES).map((f) => ({ value: f.id, label: `${f.label} ($${f.costPerFt.toFixed(2)}/ft)` })), onChange: (v) => v && mutatePlan((x) => { x.boundaryFence = v; }) })),
        field('Gates on the boundary', numberInput({ value: p.boundaryGates, min: 0, max: 20, key: 'boundary-gates', onChange: (v) => mutatePlan((x) => { x.boundaryGates = Math.round(v ?? 0); }) })),
      );
    }
    card.append(top);

    const usable = evaluation.acres.usable;
    const used = evaluation.acres.allocated;
    const over = used > usable + 0.05;
    card.append(
      h('div', { class: 'small' }, `Land assigned: ${num(used, 1)} of ${num(usable, 1)} usable acres${over ? ' (more than you have)' : ''}`),
      h('div', { class: `meter ${over ? 'bad' : ''}`, role: 'img', 'aria-label': `${Math.round((used / Math.max(usable, 0.01)) * 100)} percent of usable land assigned` }, h('span', { style: { width: `${Math.min(100, (used / Math.max(usable, 0.01)) * 100)}%` } })),
    );

    const list = h('div', { class: 'mt' });
    if (!p.allocations.length) list.append(h('p', { class: 'muted' }, 'Nothing here yet. Add animals, a crop or a garden below, or use "Suggest plans for my land".'));
    for (const a of p.allocations) list.append(allocRow(a, evaluation, land));
    card.append(list);

    const add = (kind) => mutatePlan((x) => {
      if (x.allocations.length >= 40) throw new Error('A plan can have up to 40 items.');
      const rest = Math.max(0, Math.round(evaluation.acres.unallocated * 100) / 100);
      if (kind === 'livestock') x.allocations.push({ id: newId('al'), kind, item: 'beef', acres: rest, zoneId: null, heads: null });
      else if (kind === 'crop') x.allocations.push({ id: newId('al'), kind, item: 'wheat', acres: rest, zoneId: null });
      else x.allocations.push({ id: newId('al'), kind: 'garden', acres: Math.min(0.25, rest || 0.25), zoneId: null, vegetables: { tomatoes: 1, peppers: 1, bushbeans: 1, onions: 1 } });
    });
    card.append(h('div', { class: 'row mt' },
      h('button', { class: 'secondary', onclick: () => guard(() => add('livestock')) }, '+ Add animals'),
      h('button', { class: 'secondary', onclick: () => guard(() => add('crop')) }, '+ Add a crop'),
      h('button', { class: 'secondary', onclick: () => guard(() => add('garden')) }, '+ Add a garden'),
    ));
    return card;
  }

  function results(evaluation) {
    const card = h('div', { class: 'card' });
    const m = evaluation.money;
    const net = m.net;
    card.append(h('h3', {}, 'What this plan adds up to'));
    card.append(h('div', { class: 'kpis' },
      statBox('Net per year (typical)', money(net.base), net.base >= 0 ? 'good' : 'bad', `low ${money(net.low)} to high ${money(net.high)}`),
      statBox('Revenue per year', money(m.annualRevenue.base)),
      statBox('Costs per year', money(m.annualCost)),
      statBox('Start-up cost', money(m.setupCost), '', `animals ${money(m.setupLivestock)} + fence ${money(evaluation.fence.cost)}`),
      statBox('Payback', m.payback == null ? 'not within reach' : `${num(m.payback, 1)} years`),
      statBox('Soil fit', `${evaluation.fitScore}/100`, evaluation.fitScore >= 70 ? 'good' : evaluation.fitScore < 45 ? 'bad' : ''),
      statBox('Risk (0 = calm)', String(evaluation.risk), evaluation.risk < 35 ? 'good' : evaluation.risk > 60 ? 'bad' : ''),
    ));
    if (evaluation.basis.starterShare > 0.2) {
      card.append(callout('warn', h('strong', {}, `${Math.round(evaluation.basis.starterShare * 100)}% of these dollars use starter prices. `), 'They are placeholders so the math runs, not published figures. Replace them in Settings with current prices (a K-State farm management budget for your area is the best source) before you rely on any profit number.'));
    }
    if (evaluation.warnings.length) card.append(callout('warn', h('strong', {}, 'Things to look at'), h('ul', {}, evaluation.warnings.map((w) => h('li', {}, w)))));

    if (evaluation.livestock.length) {
      card.append(h('h4', { class: 'mt' }, 'Animals'), h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Animal', 'Acres', 'Head', 'Max', 'Water (hot day)', 'Net / year'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
        h('tbody', {}, evaluation.livestock.map((l) => h('tr', {}, h('td', {}, l.label), h('td', { class: 'num' }, num(l.acres, 1)), h('td', { class: 'num' }, num(l.heads)), h('td', { class: 'num' }, num(l.capacity.maxHeads)), h('td', { class: 'num' }, `${num(l.water.hot)} gal/day`), h('td', { class: 'num' }, money(l.econ.revenue - l.econ.cost))))))));
      card.append(h('p', { class: 'small' }, `Total water for the herd: about ${num(evaluation.water.typical)} gal/day normally and ${num(evaluation.water.hot)} gal/day on a 90°F day.`));
    }
    if (evaluation.crops.length) {
      card.append(h('h4', { class: 'mt' }, 'Crops'), h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Crop', 'Acres', 'Fit', 'Yield (typical)', 'Net low', 'Net typical', 'Net high'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
        h('tbody', {}, evaluation.crops.map((c) => h('tr', {}, h('td', {}, c.label), h('td', { class: 'num' }, num(c.acres, 1)), h('td', { class: 'num' }, `${c.fit.score}`), h('td', { class: 'num' }, `${num(c.yield.base.total)} ${c.unit}`), h('td', { class: 'num' }, money(c.net.low)), h('td', { class: 'num' }, money(c.net.base)), h('td', { class: 'num' }, money(c.net.high))))))));
    }
    if (evaluation.garden) {
      const g = evaluation.garden;
      card.append(h('h4', { class: 'mt' }, `Garden (${num(g.areaSqFt)} sq ft)`), h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Vegetable', 'Row feet', 'Plants', 'Yield', 'Value'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
        h('tbody', {}, g.items.map((i) => h('tr', {}, h('td', {}, i.label), h('td', { class: 'num' }, num(i.rowFt)), h('td', { class: 'num' }, num(i.plants)), h('td', { class: 'num' }, `${num(i.yield)} ${i.unit}`), h('td', { class: 'num' }, money(i.value))))))));
    }
    if (evaluation.fence.items.length) {
      card.append(h('h4', { class: 'mt' }, 'Fencing'), h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Fence', 'Type', 'Feet', 'Posts', 'Gates', 'Cost'].map((t, i) => h('th', { class: i > 1 ? 'num' : '' }, t)))),
        h('tbody', {}, evaluation.fence.items.map((f) => h('tr', {}, h('td', {}, f.name), h('td', {}, FENCES[f.type].label), h('td', { class: 'num' }, num(f.lengthFt)), h('td', { class: 'num' }, num(f.posts)), h('td', { class: 'num' }, num(f.gates)), h('td', { class: 'num' }, money(f.cost)))))),
      ), h('p', { class: 'small' }, `Wire, posts and labor ${money(evaluation.fence.wireCost)} plus ${num(evaluation.fence.gates)} gate${evaluation.fence.gates === 1 ? '' : 's'} at ${money(evaluation.fence.gateCost / Math.max(1, evaluation.fence.gates))} = ${money(evaluation.fence.cost)}. `, sourceBadge('mu_fence', 'Fence costs: Missouri Extension 2024'), ' ', sourceBadge('ksu_fence_2023', 'Cross-check: K-State 2023')));
    }
    return card;
  }

  function aiPanel(evaluation) {
    const card = h('div', { class: 'card' });
    card.append(h('h3', {}, 'AI review (optional)'));
    if (!app.hasKey()) {
      card.append(h('p', { class: 'small' }, 'Add a Gemini key in Settings and the AI will read this plan and point out the biggest risks and what to check with your county extension agent. Only non-identifying land numbers are sent: never your name, address or location.'));
      card.append(h('button', { class: 'secondary', onclick: () => go('settings') }, 'Open Settings'));
      return card;
    }
    const q = h('input', { type: 'text', maxlength: 300, placeholder: 'Optional question, like "is this too many animals for a beginner?"', value: adviceQuestion, 'data-key': 'advice-q', 'aria-label': 'Question for the AI', onchange: (e) => { adviceQuestion = e.target.value; } });
    card.append(h('div', { class: 'row' }, h('div', { style: { flex: 1, minWidth: '220px' } }, q), h('button', { disabled: adviceBusy, onclick: async () => {
      adviceQuestion = q.value;
      const ai = app.ai();
      if (!ai) return toast('Add a Gemini key in Settings first.', 'bad');
      adviceBusy = true;
      render();
      try {
        const data = await adviseOnPlanAI(ai, buildAIContext(app.profile, evaluation, app.profile.learning), adviceQuestion);
        advice = { planId: app.plan.id, data };
      } catch (e) {
        advice = { planId: app.plan.id, error: e.message };
      }
      adviceBusy = false;
      render();
    } }, adviceBusy ? 'Thinking...' : 'Review this plan')));
    if (advice && advice.planId === app.plan.id) {
      if (advice.error) card.append(callout('bad', advice.error));
      else {
        const d = advice.data;
        card.append(
          h('p', { class: 'small muted' }, 'AI generated. It can be wrong. Check it against the numbers above and with a local expert.'),
          h('p', {}, d.summary),
          d.suggestions?.length ? h('ul', {}, d.suggestions.map((s) => h('li', {}, h('strong', {}, s.title), ': ', s.detail))) : null,
          d.cautions?.length ? callout('warn', h('strong', {}, 'Cautions'), h('ul', {}, d.cautions.map((c) => h('li', {}, c)))) : null,
        );
      }
    }
    return card;
  }

  function render() {
    clear(element);
    const land = app.land;
    element.append(h('h2', {}, 'Plans'));
    if (land.boundary.length < 3) {
      element.append(emptyState('Start with your land', 'Plans work in acres. Enter a size on the Land tab or draw the outline on the Map, then come back and press "Suggest plans for my land".', h('div', { class: 'row' }, h('button', { onclick: () => go('land') }, 'Go to Land'), h('button', { class: 'secondary', onclick: () => go('map') }, 'Go to Map'))));
    }
    element.append(planBar(land));
    const plan = app.plan;
    if (!plan) {
      element.append(h('p', { class: 'muted mt' }, 'No plans yet.'));
      return;
    }
    const evaluation = app.evaluate(plan);
    element.append(h('div', { class: 'mt' }, planEditor(evaluation, land)), h('div', { class: 'mt' }, results(evaluation)));
    if (plan.notes) element.append(h('p', { class: 'small muted mt' }, plan.notes));
    element.append(h('div', { class: 'mt' }, aiPanel(evaluation)));
    element.append(h('div', { class: 'mt' }, h('details', {}, h('summary', {}, 'Where the numbers come from'), sourceList([...new Set([...evaluation.livestock.flatMap((l) => [getLivestock(l.item).srcCapacity, ...[getLivestock(l.item).srcWater].flat()]), ...evaluation.crops.flatMap((c) => [getCrop(c.item).srcYield, getCrop(c.item).srcPlanting]), 'kstate_lime', 'mu_fence', 'ksu_fence_2023'])]))));
  }

  return { el: element, render };
}
