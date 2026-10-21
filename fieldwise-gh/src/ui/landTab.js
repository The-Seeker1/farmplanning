import { h, clear, num } from './dom.js';
import { app } from '../state.js';
import { toast, field, numberInput, selectInput, callout, sourceBadge } from './common.js';
import { geocode, lookupSoil } from '../soil.js';
import { fieldDimensions, makeProjection } from '../geo.js';
import { landPoint, rectangleBoundary, mergeSoilReading, DEFAULT_ORIGIN } from '../landutil.js';
import { TEXTURE_CLASSES, TEXTURE_LABEL, DRAINAGE_CLASSES, DRAINAGE_LABEL, limeAdvice } from '../soilfit.js';
import { prepareImage, analyzeOffline, fetchAerial, suggestedEdits } from '../photo.js';
import { analyzePhotoAI, buildAIContext } from '../ai/tasks.js';
import { newId } from '../planner.js';

export const COVER_COLOR = { grass: '#7bb661', crops: '#d9c15a', bare_soil: '#a67c52', trees: '#2f6b3a', water: '#3a7ca5', buildings: '#8a8a8a', other: '#c8c8c8' };
export const COVER_LABEL = { grass: 'Grass / green vegetation', crops: 'Crops', bare_soil: 'Bare soil', trees: 'Trees', water: 'Water', buildings: 'Roofs / pavement', other: 'Other' };

const SOURCE_TEXT = {
  manual: 'entered by you',
  ssurgo: 'USDA soil survey (SSURGO)',
  soilgrids: 'SoilGrids model estimate',
  photo: 'photo',
};

export default function createLandTab({ go }) {
  const element = h('div');
  let busy = '';
  let status = '';
  let lastDiag = null;
  let photoState = null;

  const setBusy = (what) => {
    busy = what;
    render();
  };

  async function findAddress(text) {
    if (!text) return toast('Type an address first.', 'bad');
    setBusy('address');
    try {
      const g = await geocode(text);
      if (!g) {
        status = 'No match in the United States. Try adding the city and state.';
      } else {
        app.update((d) => {
          d.land.location = { label: g.label, lat: g.lat, lon: g.lon };
          d.land.region = g.region;
          if (!d.land.origin) d.land.origin = { lat: g.lat, lon: g.lon };
        });
        status = `Found: ${g.label}`;
      }
    } catch (e) {
      status = e.message;
      toast(e.message, 'bad');
    }
    busy = '';
    render();
  }

  async function getSoil() {
    const point = landPoint(app.land);
    if (!point) return toast('Find your address or draw your land on the Map first, so there is a position to look up.', 'bad');
    setBusy('soil');
    try {
      const { reading, tried } = await lookupSoil(point.lat, point.lon);
      lastDiag = tried;
      if (reading) {
        app.update((d) => {
          d.land.soil = mergeSoilReading(d.land.soil, reading);
        });
        toast(reading.source === 'ssurgo' ? 'Soil survey data loaded.' : 'Used the SoilGrids estimate (the USDA service could not be reached).', 'good');
      } else {
        toast('No soil data came back. You can enter your own numbers below.', 'bad');
      }
    } catch (e) {
      toast(e.message, 'bad');
    }
    busy = '';
    render();
  }

  function makeRectangle(l, w) {
    try {
      const boundary = rectangleBoundary(l, w);
      app.update((d) => {
        d.land.boundary = boundary;
        if (!d.land.origin) d.land.origin = d.land.location ? { lat: d.land.location.lat, lon: d.land.location.lon } : { ...DEFAULT_ORIGIN };
      });
      toast('Rectangle created. Open the Map tab to move it into place or reshape it.', 'good');
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  async function onFile(file, kind) {
    if (!file) return;
    setBusy('photo');
    try {
      const prepared = await prepareImage(file);
      const result = await analyzeOffline(prepared, kind);
      photoState = { prepared, kind, result, saved: false };
      saveAnalysis(result.analysis, result.engine, kind);
    } catch (e) {
      toast(e.message, 'bad');
    }
    busy = '';
    render();
  }

  async function onAerial() {
    const land = app.land;
    if (land.boundary.length < 3 || !land.origin) return toast('Draw or enter your land first, then place it on the Map.', 'bad');
    setBusy('photo');
    try {
      const projection = makeProjection(land.origin);
      const prepared = await fetchAerial(land.boundary.map((p) => projection.toLatLon(p)));
      const result = await analyzeOffline(prepared, 'satellite', prepared.mask);
      photoState = { prepared, kind: 'satellite', result, saved: false };
      saveAnalysis(result.analysis, result.engine, 'satellite');
    } catch (e) {
      toast(e.message, 'bad', 8000);
    }
    busy = '';
    render();
  }

  async function onAI(note, consented) {
    const ai = app.ai();
    if (!ai) return toast('Add a Gemini key in Settings first.', 'bad');
    if (!photoState) return toast('Choose a photo first.', 'bad');
    if (!consented) return toast('Tick the box to confirm you are happy to send this photo to Google.', 'bad');
    setBusy('ai');
    try {
      const context = buildAIContext(app.profile);
      const analysis = await analyzePhotoAI(ai, { mimeType: photoState.prepared.mimeType, base64: photoState.prepared.base64 }, { hint: note, context });
      photoState.result = { analysis, engine: 'gemini' };
      saveAnalysis(analysis, 'gemini', photoState.kind);
      toast('AI analysis done. Review the suggestions below before applying any.', 'good');
    } catch (e) {
      toast(e.message, 'bad', 8000);
    }
    busy = '';
    render();
  }

  function saveAnalysis(analysis, engine, kind) {
    const id = newId('ph');
    app.update((d) => {
      d.land.photos.unshift({ id, ts: Date.now(), engine, kind: kind === 'satellite' ? 'satellite' : kind === 'aerial' ? 'aerial' : 'ground', summary: analysis });
      d.land.photos = d.land.photos.slice(0, 12);
    }, { quiet: true });
    if (photoState) photoState.saved = true;
  }

  function quickStart() {
    const land = app.land;
    const steps = [
      [!!land.location || land.boundary.length >= 3, 'Find your address (or skip it and draw on the map)'],
      [land.boundary.length >= 3, 'Outline your land: type its size here, or draw it on the Map tab'],
      [land.soil.ph != null, 'Get soil data, or type in your own pH and other numbers'],
      [app.profile.plans.length > 0, 'Build a plan on the Plans tab'],
    ];
    if (steps.every((s) => s[0])) return null;
    return h('div', { class: 'card tint-green' },
      h('h3', {}, 'Start here'),
      h('ol', {}, steps.map(([done, text]) => h('li', {}, done ? '✓ ' : '', done ? h('span', { class: 'muted' }, text) : text))),
      h('p', { class: 'small muted' }, 'You can do these in any order, and every number you enter by hand overrides what the lookups find.'));
  }

  function locationCard() {
    const land = app.land;
    const addressInput = h('input', { type: 'text', 'data-key': 'addr', maxlength: 200, placeholder: 'Street, city, state (for example: 1 Main St, Topeka, KS)', 'aria-label': 'Address' });
    addressInput.value = land.location?.label || '';
    addressInput.addEventListener('keydown', (e) => e.key === 'Enter' && findAddress(addressInput.value));
    return h('div', { class: 'card' },
      h('h2', {}, 'Where is the land?'),
      h('div', { class: 'row' }, h('div', { style: { flex: '1 1 320px' } }, field('Address (optional)', addressInput, 'Used only to center the map and look up soil. It stays on your device and is never sent to the AI.')),
        h('button', { disabled: busy === 'address', onclick: () => findAddress(addressInput.value) }, busy === 'address' ? 'Searching...' : 'Find address')),
      status ? h('p', { class: 'small', role: 'status' }, status) : null,
      h('div', { class: 'fields' },
        field('Part of Kansas', selectInput({ value: land.region, key: 'region', options: [{ value: 'east', label: 'Eastern Kansas' }, { value: 'west', label: 'Western Kansas' }], onChange: (v) => app.update((d) => { d.land.region = v; }) }), 'Changes the lime trigger pH (K-State).'),
        field('K-State planting zone', selectInput({ value: String(land.zone), key: 'zone', options: [{ value: '3', label: 'Zone 3 (east central / northeast)' }, { value: '4', label: 'Zone 4 (southeast)' }], onChange: (v) => app.update((d) => { d.land.zone = Number(v); }) }), 'Zone 4 is southeastern Kansas.'),
        field('Water source', selectInput({ value: land.waterSource || '', key: 'water', options: [{ value: '', label: 'Not set' }, { value: 'well', label: 'Well' }, { value: 'rural_water', label: 'Rural water district' }, { value: 'pond', label: 'Pond' }, { value: 'creek', label: 'Creek' }, { value: 'none', label: 'None yet' }], onChange: (v) => app.update((d) => { d.land.waterSource = v; }) }), 'Livestock plans warn if there is none.')));
  }

  function sizeCard() {
    const land = app.land;
    const lengthIn = numberInput({ value: '', min: 10, max: 40000, key: 'rect-l', placeholder: 'e.g. 1320', onChange: () => {} });
    const widthIn = numberInput({ value: '', min: 10, max: 40000, key: 'rect-w', placeholder: 'e.g. 660', onChange: () => {} });
    let size = null;
    if (land.boundary.length >= 3) size = fieldDimensions(land.boundary);
    return h('div', { class: 'card' },
      h('h2', {}, 'How big is it?'),
      size
        ? h('div', { class: 'kpis mb' },
          statBox('Area', `${num(size.acres, 1)} acres`),
          statBox('Length x width', `${num(size.boxLengthFt)} x ${num(size.boxWidthFt)} ft`, 'Smallest rectangle that fits your outline'),
          statBox('Fence around it', `${num(size.perimeterFt)} ft`, `${num(size.perimeterFt / 5280, 2)} miles`),
          size.boxFill < 0.9 ? statBox('Shape', `${Math.round(size.boxFill * 100)}% of its box`, 'Irregular shape: use the area, not length x width') : null)
        : callout('', 'No outline yet. Type a length and width below for a simple rectangle, or draw the real shape on the ', h('strong', {}, 'Map'), ' tab.'),
      h('div', { class: 'fields' }, field('Length (feet)', lengthIn, '1 acre is about 209 x 209 ft'), field('Width (feet)', widthIn)),
      h('div', { class: 'row' },
        h('button', { class: 'secondary', onclick: () => makeRectangle(lengthIn.value, widthIn.value) }, size ? 'Replace with this rectangle' : 'Create rectangle'),
        h('button', { onclick: () => go('map') }, 'Draw it on the map')));
  }

  function statBox(label, value, hint) {
    return h('div', { class: 'kpi', title: hint || '' }, h('div', { class: 'v' }, value), h('div', { class: 'l' }, label));
  }

  function soilCard() {
    const land = app.land;
    const soil = land.soil;
    const set = (k) => (v) => app.update((d) => { d.land.soil[k] = v; d.land.soil.source = d.land.soil.source === 'ssurgo' || d.land.soil.source === 'soilgrids' ? d.land.soil.source : 'manual'; });
    const lime = limeAdvice(soil.ph, { legume: false, region: land.region });
    const limeLeg = limeAdvice(soil.ph, { legume: true, region: land.region });
    return h('div', { class: 'card' },
      h('h2', {}, 'Soil and site'),
      h('div', { class: 'row mb' },
        h('button', { disabled: busy === 'soil', onclick: getSoil }, busy === 'soil' ? 'Looking up...' : 'Get soil data for my land'),
        h('span', { class: 'small muted' }, 'Uses the USDA soil survey for the middle of your land; falls back to a coarser model if the survey cannot be reached.')),
      soil.source !== 'manual' ? callout('', h('strong', {}, 'Source: '), SOURCE_TEXT[soil.source] || soil.source, soil.mapUnit ? ` - ${soil.mapUnit}` : '', '. ', 'This is the typical topsoil for the mapped area, not a lab test of your field. ', ...soil.notes.map((n) => `${n} `)) : null,
      lastDiag && lastDiag.some((t) => !t.ok) ? callout('warn', h('strong', {}, 'Lookup details: '), lastDiag.map((t) => `${t.source}: ${t.ok ? 'worked' : `not available (${t.error || 'no data'})`}`).join('; ')) : null,
      h('div', { class: 'fields' },
        field('Soil pH', numberInput({ value: soil.ph, min: 3, max: 10.5, step: 0.1, key: 'ph', onChange: set('ph') }), 'From a soil test is best.'),
        field('Organic matter (%)', numberInput({ value: soil.om, min: 0, max: 100, step: 0.1, key: 'om', onChange: set('om') })),
        field('Texture', selectInput({ value: soil.texture || '', key: 'texture', options: [{ value: '', label: 'Not set' }, ...TEXTURE_CLASSES.map((t) => ({ value: t, label: TEXTURE_LABEL[t] }))], onChange: set('texture') })),
        field('Drainage', selectInput({ value: soil.drainage || '', key: 'drainage', options: [{ value: '', label: 'Not set' }, ...DRAINAGE_CLASSES.map((t) => ({ value: t, label: DRAINAGE_LABEL[t] }))], onChange: set('drainage') })),
        field('Slope (%)', numberInput({ value: soil.slopePct, min: 0, max: 100, step: 1, key: 'slope', onChange: set('slopePct') }), '3% drops 3 ft per 100 ft.'),
        field('Depth to rock or hardpan (in.)', numberInput({ value: soil.depthIn, min: 0, max: 400, step: 1, key: 'depth', onChange: set('depthIn') }))),
      soil.ph != null ? h('div', { class: 'callout ' + (lime.needed || limeLeg.needed ? 'warn' : 'good') }, h('strong', {}, 'Lime check: '), lime.text, lime.needed === false && limeLeg.needed ? ` But legumes like alfalfa and soybeans want ${limeLeg.trigger} or higher in this part of Kansas, so they may need lime.` : '', ' ', sourceBadge('kstate_lime', 'K-State MF-1065')) : null);
  }

  function photoCard() {
    const land = app.land;
    const kind = h('select', { 'data-key': 'photo-kind', 'aria-label': 'Photo type' }, [
      h('option', { value: 'ground' }, 'Ground-level photo (standing in the field)'),
      h('option', { value: 'aerial' }, 'Aerial / satellite screenshot (looking straight down)'),
    ]);
    if (photoState) kind.value = photoState.kind === 'satellite' ? 'aerial' : photoState.kind;
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Choose a photo', onchange: () => onFile(file.files[0], kind.value) });
    const note = h('input', { type: 'text', maxlength: 300, placeholder: 'Optional note for the AI, e.g. "north pasture after a week of rain"', 'data-key': 'photo-note', 'aria-label': 'Note for the AI' });
    const consent = h('input', { type: 'checkbox', id: 'ai-consent' });
    const hasKey = app.hasKey();

    return h('div', { class: 'card' },
      h('h2', {}, 'Photos of the land'),
      h('p', { class: 'small muted' }, 'A photo is cleaned in your browser (location and camera data removed) and read for land cover. The free reader works offline using colors. With a Gemini key, the AI can also judge condition, weeds, slope and drainage.'),
      h('div', { class: 'fields' }, field('Photo type', kind), field('Choose a photo', file)),
      h('div', { class: 'row mb' },
        h('button', { class: 'secondary', disabled: busy === 'photo' || land.boundary.length < 3, onclick: onAerial, title: land.boundary.length < 3 ? 'Draw your land first' : 'Gets a USGS aerial image of your outline' }, busy === 'photo' ? 'Working...' : 'Use a satellite image of my outline'),
        h('span', { class: 'small muted' }, 'USGS aerial photos (about 1 m detail). If the browser blocks reading them, upload a screenshot instead.')),
      photoState ? photoResult(note, consent, hasKey) : null,
      land.photos.length ? h('details', { class: 'mt' }, h('summary', {}, `Saved photo analyses (${land.photos.length})`),
        land.photos.map((p) => h('div', { class: 'row', style: { padding: '0.4rem 0' } },
          h('span', { class: 'small' }, `${new Date(p.ts).toLocaleString()} - ${p.engine === 'gemini' ? 'AI' : 'color reader'} (${p.kind})`),
          coverBar(p.summary.landCover),
          h('button', { class: 'danger small', onclick: () => app.update((d) => { d.land.photos = d.land.photos.filter((x) => x.id !== p.id); }) }, 'Delete')))) : null);
  }

  function coverBar(cover) {
    if (!cover?.length) return h('span', { class: 'small muted' }, 'no land-cover data');
    return h('div', { style: { flex: '1 1 200px' } },
      h('div', { class: 'cover-bar', role: 'img', 'aria-label': cover.map((c) => `${COVER_LABEL[c.cls]} ${c.pct}%`).join(', ') }, cover.map((c) => h('span', { style: { width: `${c.pct}%`, background: COVER_COLOR[c.cls] }, title: `${COVER_LABEL[c.cls]} ${c.pct}%` }))),
      h('div', { class: 'small' }, cover.map((c) => h('span', { style: { marginRight: '0.7rem', whiteSpace: 'nowrap' } }, h('span', { class: 'legend-dot', style: { background: COVER_COLOR[c.cls] } }), `${COVER_LABEL[c.cls]} ${num(c.pct, 0)}%`))));
  }

  function photoResult(note, consent, hasKey) {
    const { prepared, result } = photoState;
    const a = result.analysis;
    const edits = suggestedEdits(a, app.land);
    const img = h('img', { class: 'photo-prev', alt: 'The photo you chose, as it will be analyzed (shrunk, with metadata removed)', src: prepared.dataUrl });
    return h('div', { class: 'card flat tint-blue' },
      h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', {}, img, h('p', { class: 'small muted' }, `${prepared.width} x ${prepared.height} px, metadata removed`)),
        h('div', { style: { flex: '1 1 300px' } },
          h('h3', {}, 'What was found'),
          h('p', { class: 'small' }, h('span', { class: 'badge' }, result.engine === 'gemini' ? 'Gemini AI' : 'Color reader (offline)'), ' ', h('span', { class: 'badge' }, `confidence: ${a.confidence}`)),
          coverBar(a.landCover),
          a.vegetationCondition !== 'unknown' || a.slope !== 'unknown' || a.drainage !== 'unknown' ? h('p', { class: 'small mt' }, `Condition: ${a.vegetationCondition}. Slope: ${a.slope}. Drainage: ${a.drainage}.${a.erosionSigns ? ' Erosion signs seen.' : ''}${a.standingWater ? ' Standing water seen.' : ''}`) : null,
          a.weeds.length ? h('p', { class: 'small' }, h('strong', {}, 'Possible weeds: '), a.weeds.map((w) => `${w.name} (${w.severity})`).join(', ')) : null,
          a.observations.length ? h('ul', { class: 'small' }, a.observations.map((o) => h('li', {}, o))) : null,
          edits.length ? h('div', { class: 'mt' }, h('strong', {}, 'Suggested changes to your land details'), edits.map((e) => h('div', { class: 'row tight mt' }, h('button', { class: 'small', onclick: () => { app.update((d) => e.apply(d)); toast('Applied.', 'good'); } }, 'Apply'), h('span', { class: 'small' }, e.label)))) : null)),
      h('hr'),
      hasKey
        ? h('div', {},
          h('div', { class: 'field' }, note),
          h('label', { class: 'check', for: 'ai-consent' }, consent, h('span', {}, 'I am happy to send this photo to Google Gemini. It shows no people, faces or license plates. (On the free tier, Google may use it to improve products and humans may review it.)')),
          h('div', { class: 'row mt' }, h('button', { disabled: busy === 'ai', onclick: () => onAI(note.value, consent.checked) }, busy === 'ai' ? 'Asking the AI...' : 'Analyze with AI (Gemini)')))
        : h('p', { class: 'small muted' }, 'Want the AI to judge condition, weeds, slope and drainage too? Add a Gemini key in Settings.'));
  }

  function render() {
    clear(element);
    element.append(...[quickStart(), locationCard(), sizeCard(), soilCard(), photoCard()].filter(Boolean));
  }

  return { el: element, render };
}
