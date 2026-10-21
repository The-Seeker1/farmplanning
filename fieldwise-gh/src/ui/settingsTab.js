import { h, clear, downloadText } from './dom.js';
import { app } from '../state.js';
import { toast, askConfirm, field, numberInput, selectInput, sourceBadge, callout } from './common.js';
import { LIVESTOCK } from '../data/livestock.js';
import { CROPS, VEGETABLES } from '../data/crops.js';
import { FENCES, GATE } from '../data/fences.js';
import { SOURCES, CONFIDENCE_LABEL } from '../data/sources.js';
import { DEFAULT_ASSUMPTIONS } from '../planner.js';
import { PROVIDERS } from '../ai/provider.js';
import { NetError } from '../net.js';

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export default function createSettingsTab() {
  const element = h('div');
  let keyDraft = '';
  let ageOk = false;
  let remember = false;
  let models = null;
  let testing = false;
  let testResult = '';
  let includeLocation = false;

  const guard = async (listener) => {
    try {
      await listener();
    } catch (e) {
      toast(e.message, 'bad', 7000);
    }
  };

  function aiCard() {
    const definition = PROVIDERS[app.prefs.provider];
    const hasKey = app.hasKey();
    const card = h('div', { class: 'card' });
    card.append(h('h3', {}, 'AI features (optional)'),
      h('p', { class: 'small' }, 'Everything works without AI: lookups, drawing, stocking math, crop estimates, plans, comparison, lessons and quizzes. A key adds: reading a photo for crop condition, weeds, terrain and drainage; lessons and quizzes written for your exact land; and a plan review.'),
      h('p', { class: 'small' }, `Provider: ${definition.label}. The app talks to AI only through one small adapter file (src/ai/provider.js), so another model can be plugged in without changing the rest of the app.`));
    card.append(callout('warn', h('strong', {}, 'Before you add a key. '), definition.freeTierNotice, ' ', definition.keyHint));

    if (hasKey) {
      const ai = app.ai();
      card.append(callout('good', `A key is saved ${app.keyRemembered() ? 'on this device' : 'for this browser tab only (it is forgotten when you close the tab)'}.`,
        ai ? ` AI calls used this session: ${ai.calls} of ${ai.calls + ai.callsLeft}.` : ''));
      card.append(h('div', { class: 'row' },
        h('button', { class: 'secondary', disabled: testing, onclick: () => runTest('') }, testing ? 'Testing...' : 'Test connection'),
        h('button', { class: 'danger', onclick: () => { app.clearKey(); keyDraft = ''; models = null; testResult = ''; toast('Key removed.', 'good'); } }, 'Remove key')));
    } else {
      const input = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', maxlength: 100, placeholder: 'Paste your Gemini API key', value: keyDraft, 'data-key': 'api-key', 'aria-label': 'Gemini API key', oninput: (e) => { keyDraft = e.target.value.trim(); } });
      card.append(field('Gemini API key', input, 'The key stays in this browser. It is sent only to Google, in a request header, and never saved in your profile or exports.'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ageOk, 'data-key': 'age-ok', onchange: (e) => { ageOk = e.target.checked; } }), 'The person who owns this key is 18 or older, and I have their permission to use it.'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: remember, 'data-key': 'remember-key', onchange: (e) => { remember = e.target.checked; } }), 'Remember the key on this device (leave off on a shared or school computer)'),
        h('div', { class: 'row mt' },
          h('button', { onclick: () => guard(async () => {
            if (!ageOk) throw new Error('Please confirm the key owner is 18 or older and has given permission.');
            if (!definition.keyPattern.test(keyDraft)) throw new NetError('auth', 'That does not look like a valid API key.');
            app.saveKey(keyDraft, remember);
            app.updatePrefs({ ageConfirmed: true });
            keyDraft = '';
            toast('Key saved. Press "Test connection" to check it.', 'good');
          }) }, 'Save key'),
          h('button', { class: 'secondary', disabled: testing, onclick: () => runTest(keyDraft) }, testing ? 'Testing...' : 'Test without saving')));
    }

    if (testResult) card.append(h('p', { class: 'small', role: 'status' }, testResult));
    const list = models?.length ? models : [];
    const current = app.prefs.model;
    card.append(h('div', { class: 'fields mt' },
      field('Model', list.length
        ? selectInput({ value: list.includes(current) ? current : '', key: 'model', options: [{ value: '', label: `${current} (current)` }, ...list.map((m) => ({ value: m, label: m }))], onChange: (v) => v && app.updatePrefs({ model: v }) })
        : h('input', { type: 'text', value: current, maxlength: 60, 'data-key': 'model-text', 'aria-label': 'Model name', onchange: (e) => app.updatePrefs({ model: e.target.value.trim() || definition.defaultModel }) }),
      `Default: ${definition.defaultModel}. Press "Test connection" to list the models your key can use.`)));
    return card;
  }

  async function runTest(candidate) {
    testing = true;
    testResult = '';
    render();
    try {
      const r = await app.testKey(candidate);
      models = r.models || [];
      testResult = `Connected. ${models.length} model${models.length === 1 ? '' : 's'} available.`;
    } catch (e) {
      testResult = e instanceof NetError && e.kind === 'auth' ? 'Google did not accept that key.' : `Could not connect: ${e.message}`;
    }
    testing = false;
    render();
  }

  function setOverride(group, id, fieldName, v) {
    app.update((d) => {
      d.overrides[group] = d.overrides[group] || {};
      const row = { ...(d.overrides[group][id] || {}) };
      if (v === null) delete row[fieldName];
      else row[fieldName] = v;
      if (Object.keys(row).length) d.overrides[group][id] = row;
      else delete d.overrides[group][id];
    });
  }

  function priceInput(group, id, fieldName, base, label) {
    const current = app.profile.overrides?.[group]?.[id]?.[fieldName];
    const input = numberInput({ value: current ?? null, min: 0, max: 1e7, key: `ov-${group}-${id}-${fieldName}`, placeholder: String(base), onChange: (v) => setOverride(group, id, fieldName, v) });
    input.setAttribute('aria-label', label);
    if (current != null) input.style.fontWeight = '700';
    return input;
  }

  function pricesCard() {
    const overrides = app.profile.overrides || {};
    const card = h('div', { class: 'card' });
    const changed = ['livestock', 'crops', 'fence', 'vegetables'].reduce((n, g) => n + Object.keys(overrides[g] || {}).length, 0) + (overrides.gateCost != null ? 1 : 0);
    card.append(h('h3', {}, 'Prices and costs'),
      callout('warn', h('strong', {}, 'Most of these are starter estimates. '), 'They keep the math running but are not published numbers. Replace them with real quotes, a current sale-barn price, or the K-State farm management budget for your part of Kansas. Fence costs are from Missouri Extension (January 2024) and cross-checked against a K-State survey; Kansas prices differ. Leave a box empty to keep the starter value (shown in grey).'),
      h('div', { class: 'row' }, h('span', { class: 'small' }, changed ? `${changed} value${changed === 1 ? '' : 's'} changed in this profile.` : 'No values changed yet.'),
        changed ? h('button', { class: 'secondary small', onclick: () => guard(async () => { if (await askConfirm('Put every price and cost back to its starter value?', { yes: 'Reset all' })) app.update((d) => { d.overrides = {}; }); }) }, 'Reset all') : null));

    const livestock = h('table', {}, h('thead', {}, h('tr', {}, ['Animal', 'Buy ($/head)', 'Yearly cost ($/head)', 'Yearly income ($/head)', 'Shelter ($/head)', 'Source'].map((t) => h('th', {}, t)))),
      h('tbody', {}, Object.values(LIVESTOCK).map((species) => h('tr', {},
        h('td', {}, species.label),
        ...[['purchase', 'Buy'], ['annualCost', 'Yearly cost'], ['annualRevenue', 'Yearly income'], ['shelter', 'Shelter']].map(([f, l]) => h('td', {}, priceInput('livestock', species.id, f, species.econ[f], `${species.label} ${l}`))),
        h('td', {}, sourceBadge(species.srcEcon))))));
    const crops = h('table', {}, h('thead', {}, h('tr', {}, ['Crop', 'Price', 'Cost ($/acre)', 'Source'].map((t) => h('th', {}, t)))),
      h('tbody', {}, Object.values(CROPS).map((c) => h('tr', {}, h('td', {}, c.label), h('td', {}, priceInput('crops', c.id, 'price', c.price, `${c.label} price per ${c.unit}`), h('span', { class: 'small muted' }, ` per ${c.unit}`)), h('td', {}, priceInput('crops', c.id, 'costPerAcre', c.costPerAcre, `${c.label} cost per acre`)), h('td', {}, sourceBadge(c.srcEcon))))));
    const fences = h('table', {}, h('thead', {}, h('tr', {}, ['Fence', 'Installed ($/ft)', 'Source'].map((t) => h('th', {}, t)))),
      h('tbody', {}, [...Object.values(FENCES).map((f) => h('tr', {}, h('td', {}, f.label), h('td', {}, priceInput('fence', f.id, 'costPerFt', f.costPerFt, `${f.label} cost per foot`)), h('td', {}, sourceBadge(f.srcCost)))),
        h('tr', {}, h('td', {}, 'Gate (each)'), h('td', {}, (() => {
          const i = numberInput({ value: overrides.gateCost ?? null, min: 0, max: 1e5, key: 'ov-gate', placeholder: String(GATE.cost), onChange: (v) => app.update((d) => { if (v === null) delete d.overrides.gateCost; else d.overrides.gateCost = v; }) });
          i.setAttribute('aria-label', 'Gate cost');
          return i;
        })()), h('td', {}, sourceBadge(GATE.srcCost)))]));
    const vegetableTable = h('table', {}, h('thead', {}, h('tr', {}, ['Vegetable', 'Value per unit', 'Source'].map((t) => h('th', {}, t)))),
      h('tbody', {}, Object.values(VEGETABLES).map((v) => h('tr', {}, h('td', {}, v.label), h('td', {}, priceInput('vegetables', v.id, 'price', v.price, `${v.label} value per ${v.unit}`), h('span', { class: 'small muted' }, ` per ${v.unit}`)), h('td', {}, sourceBadge('starter'))))));
    const group = (title, table) => h('details', {}, h('summary', {}, title), h('div', { class: 'table-wrap' }, table));
    card.append(group('Animals', livestock), group('Crops', crops), group('Fences and gates', fences), group('Garden vegetables', vegetableTable));
    return card;
  }

  function assumptionsCard() {
    const a = app.assumptions;
    const set = (k, v) => app.update((d) => {
      d.overrides.assumptions = { ...(d.overrides.assumptions || {}) };
      if (v === null) delete d.overrides.assumptions[k];
      else d.overrides.assumptions[k] = v;
    });
    const card = h('div', { class: 'card' });
    card.append(h('h3', {}, 'Assumptions'), h('p', { class: 'small' }, 'These are planning choices, not facts. Change them to see how sensitive a plan is.'),
      h('div', { class: 'fields' },
        field('Start-up share of the maximum herd (%)', numberInput({ value: Math.round(a.startFraction * 100), min: 25, max: 100, key: 'as-start', onChange: (v) => set('startFraction', v === null ? null : v / 100) }), `Plans suggest starting with this share of the calculated maximum so you can learn the land first. Default ${Math.round(DEFAULT_ASSUMPTIONS.startFraction * 100)}%.`),
        field('Years in the cash projection', numberInput({ value: a.yearsProjected, min: 1, max: 10, key: 'as-years', onChange: (v) => set('yearsProjected', v === null ? null : Math.round(v)) }), `Default ${DEFAULT_ASSUMPTIONS.yearsProjected}.`),
        field('Share lost to roads and buildings if no zones are drawn (%)', numberInput({ value: Math.round(a.roadsBuildingsShare * 100), min: 0, max: 50, key: 'as-roads', onChange: (v) => set('roadsBuildingsShare', v === null ? null : v / 100) }), `Default ${Math.round(DEFAULT_ASSUMPTIONS.roadsBuildingsShare * 100)}%.`)),
      h('ul', { class: 'small' },
        h('li', {}, 'Rotational grazing uses 40% of the forage, season-long grazing 25%; the rest is trampled or left for regrowth (planning assumption, in data/livestock.js).'),
        h('li', {}, 'Pasture growth is 2 to 5 tons per acre, scaled by how well the soil fits grass (Hay & Forage Grower).'),
        h('li', {}, 'Crop yields start from the Kansas state averages for the last two years and are scaled by soil fit (x0.4 to x1.1).')),
      h('p', { class: 'small' }, 'Part of the state and the planting zone are set on the Land tab.'));
    return card;
  }

  function dataCard() {
    const card = h('div', { class: 'card' });
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Choose a FieldWise profile file', onchange: (e) => guard(async () => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > MAX_IMPORT_BYTES) throw new Error('That file is too big to be a FieldWise profile (limit 2 MB).');
      const p = app.importProfile(await f.text());
      toast(`Imported "${p.name}".`, 'good');
    }) });
    card.append(h('h3', {}, 'Your data'),
      h('p', { class: 'small' }, app.persistent ? 'Profiles are saved in this browser on this device. Nothing is uploaded, and there is no account.' : 'Your browser is blocking storage, so changes will be lost when you close the page. Export your profile before you leave.'),
      h('div', { class: 'row' },
        h('button', { onclick: () => guard(() => {
          const text = app.exportActive(includeLocation);
          downloadText(`${app.profile.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'farm'}.fieldwise.json`, text);
        }) }, 'Export this profile'),
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: includeLocation, 'data-key': 'export-loc', onchange: (e) => { includeLocation = e.target.checked; } }), 'Include the address and map position (leave off if you will share the file)')),
      h('div', { class: 'field mt' }, h('label', {}, 'Import a profile file'), fileInput, h('span', { class: 'hint' }, 'Imported files are checked and cleaned before use. Only profiles made by FieldWise are accepted.')),
      h('div', { class: 'mt' }, h('button', { class: 'danger', onclick: () => guard(async () => {
        if (await askConfirm('Erase every profile, plan, and saved key from this browser? This cannot be undone.', { yes: 'Erase everything', danger: true })) {
          app.eraseEverything();
          toast('Everything was erased from this device.', 'good');
        }
      }) }, 'Erase everything on this device')));
    return card;
  }

  function privacyCard() {
    return h('div', { class: 'card' },
      h('h3', {}, 'Privacy and security'),
      h('p', { class: 'small' }, 'FieldWise is a static web page. There is no FieldWise server, account, analytics or advertising. Here is every time something leaves your device, and what is sent:'),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Who receives it', 'What is sent'].map((t) => h('th', {}, t)))),
        h('tbody', {},
          [
            ['You press "Find address"', 'OpenStreetMap Nominatim', 'The address text you typed'],
            ['You press "Get soil data"', 'USDA Soil Data Access; SoilGrids (ISRIC) if USDA fails', 'The latitude and longitude of your land'],
            ['You open the Map', 'Esri and OpenStreetMap tile servers', 'Which map tiles are in view (so roughly where you are looking)'],
            ['You press "Use satellite view"', 'USGS National Map', 'The bounding box of your land'],
            ['You use AI (only with a key)', 'Google Gemini', 'Rounded land numbers and the plan. Photos only when you tick the box on that photo. Never your name, address, coordinates or profile name'],
          ].map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))) ),
      h('ul', { class: 'small' },
        h('li', {}, 'A strict Content-Security-Policy lets the page connect only to the services above and run only its own code. The app never builds HTML from text, so nothing typed, imported or returned by an AI can inject script.'),
        h('li', {}, 'Photos are re-drawn on a canvas before use, which removes hidden location data (EXIF) and rejects files that are not really JPEG, PNG or WebP.'),
        h('li', {}, 'AI answers are checked against strict shapes and limits before they are shown. Photo-based suggestions only change your land after you press Apply.'),
        h('li', {}, 'Your API key is kept out of profiles and exports, and is sent only in a header to Google. It is forgotten when you close the tab unless you chose to remember it.'),
        h('li', {}, 'The map layers use public servers that can see your IP address, as any website does.')));
  }

  function disclosureCard() {
    return h('div', { class: 'card' },
      h('h3', {}, 'About this app and AI'),
      h('p', { class: 'small' }, 'Without a key, photos are read by colors only, which cannot tell weeds, slope or drainage. With a Gemini key, the AI can judge those too. Everything else in the app works with no AI.'));
  }

  function sourcesCard() {
    const rows = Object.entries(SOURCES);
    return h('div', { class: 'card' },
      h('h3', {}, 'Sources'),
      h('p', { class: 'small' }, 'Every number in the app points to one of these. Badges show how much to trust it.'),
      h('details', {}, h('summary', {}, `All ${rows.length} sources`), h('ul', { class: 'small' }, rows.map(([id, source]) => h('li', {}, sourceBadge(id, CONFIDENCE_LABEL[source.confidence]), ' ', source.url ? h('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.title) : source.title)))));
  }

  function render() {
    clear(element);
    element.append(h('h2', {}, 'Settings'));
    for (const c of [aiCard(), pricesCard(), assumptionsCard(), dataCard(), privacyCard(), disclosureCard(), sourcesCard()]) element.append(h('div', { class: 'mt' }, c));
  }

  return { el: element, render };
}
