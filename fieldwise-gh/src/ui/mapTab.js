import L from 'leaflet';
import { h, clear, num, money } from './dom.js';
import { app } from '../state.js';
import { toast, selectInput } from './common.js';
import { geocode } from '../soil.js';
import { makeProjection, polygonArea, polylineLength, polygonPerimeter, toAcres, toFeet, isSimplePolygon, ensureCCW, fieldDimensions, fencePosts, fromFeet } from '../geo.js';
import { DEFAULT_ORIGIN, recenterOrigin } from '../landutil.js';
import { FENCES } from '../data/fences.js';
import { newId } from '../planner.js';
import { ZONE_USES } from '../storage.js';

import { USE_COLOR, USE_LABEL, MARKER_ICON, MARKER_LABEL } from './labels.js';
export { USE_COLOR, USE_LABEL, MARKER_ICON, MARKER_LABEL };
const FENCE_STYLE = {
  barbed5: { color: '#e8e8e8', weight: 3, dashArray: null },
  woven47: { color: '#c9c9ff', weight: 4, dashArray: null },
  hightensile6: { color: '#ffe9a8', weight: 3, dashArray: null },
  electric2: { color: '#ffd23f', weight: 2, dashArray: '6 6' },
  netting: { color: '#ff9f5a', weight: 3, dashArray: '2 5' },
};

const HINTS = {
  pan: 'Click a shape to select it, then drag its white handles to reshape.',
  boundary: 'Click each corner of your land. Double-click (or press Finish) to close the shape.',
  zone: 'Click the corners of the zone. Double-click or press Finish when done.',
  fence: 'Click along the fence line. Double-click or press Finish when done.',
  place: 'Tap as many spots as you like. Each tap drops one. Pick another type any time.',
  erase: 'Click anything you want to delete.',
  move: 'Click where the center of your land should be.',
};

export default function createMapTab() {
  const element = h('div');
  const mapDiv = h('div', { id: 'map', role: 'application', 'aria-label': 'Map for drawing your land' });
  const hintEl = h('div', { class: 'map-hint' });
  const mapBox = h('div', { class: 'map-box' }, mapDiv, hintEl);
  const panel = h('div', { class: 'toolbox' });
  element.append(h('div', { class: 'map-wrap' }, panel, mapBox));

  let map = null;
  let layers = null;
  let mode = 'pan';
  let zoneUse = 'pasture';
  let fenceType = 'barbed5';
  let fenceClosed = false;
  let placeKind = 'beef';
  let draft = null;
  let selection = null;
  let handles = [];
  let history = [];
  let firstFit = true;
  let status = '';
  const shapeKey = (land) => JSON.stringify({ origin: land.origin, boundary: land.boundary, zones: land.zones, fences: land.fences, markers: land.markers });

  const projection = () => (app.land.origin ? makeProjection(app.land.origin) : null);
  const toLatLng = (p) => {
    const latLng = projection().toLatLon(p);
    return L.latLng(latLng.lat, latLng.lon);
  };
  const toLocal = (latLng) => projection().toLocal({ lat: latLng.lat, lon: latLng.lng });

  function pushHistory() {
    history.push(shapeKey(app.land));
    if (history.length > 25) history.shift();
  }
  function undo() {
    const prev = history.pop();
    if (!prev) return toast('Nothing to undo.');
    const g = JSON.parse(prev);
    app.update((d) => {
      d.land.origin = g.origin;
      d.land.boundary = g.boundary;
      d.land.zones = g.zones;
      d.land.fences = g.fences;
      d.land.markers = g.markers;
    });
    selection = null;
  }

  function commit(mutator, { push = true } = {}) {
    if (push) pushHistory();
    app.update(mutator);
  }

  function ensureOrigin(latLng) {
    if (!app.land.origin) {
      app.update((d) => {
        d.land.origin = { lat: latLng.lat, lon: latLng.lng };
      }, { quiet: true });
    }
  }

  function startDraw(newMode) {
    cancelDraw();
    mode = newMode;
    selection = null;
    if (newMode === 'boundary' || newMode === 'zone' || newMode === 'fence') map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    mapDiv.style.cursor = newMode === 'pan' ? '' : 'crosshair';
    render();
  }

  function cancelDraw() {
    if (draft) {
      layers.draft.clearLayers();
      draft = null;
    }
  }

  function addVertex(latLng) {
    ensureOrigin(latLng);
    if (!draft) draft = { pts: [] };
    draft.pts.push(latLng);
    drawDraft();
    renderPanel();
  }

  function drawDraft(cursor = null) {
    layers.draft.clearLayers();
    if (!draft) return;
    const points = cursor ? [...draft.pts, cursor] : draft.pts;
    const style = { color: '#ffd23f', weight: 3, dashArray: '6 6' };
    if (mode === 'fence') L.polyline(points, { ...style, interactive: false }).addTo(layers.draft);
    else L.polygon(points, { ...style, fillColor: mode === 'zone' ? USE_COLOR[zoneUse] : '#ffd23f', fillOpacity: 0.25, interactive: false }).addTo(layers.draft);
    draft.pts.forEach((p, i) => L.circleMarker(p, { radius: i === 0 ? 7 : 5, color: '#fff', fillColor: i === 0 ? '#2f6b3a' : '#ffd23f', fillOpacity: 1, weight: 2, interactive: false }).addTo(layers.draft));
  }

  function dedupe(local, min = 0.5) {
    const out = [];
    for (const p of local) {
      const q = out[out.length - 1];
      if (!q || Math.hypot(p.x - q.x, p.y - q.y) >= min) out.push(p);
    }
    if (out.length > 2 && Math.hypot(out[0].x - out.at(-1).x, out[0].y - out.at(-1).y) < min) out.pop();
    return out;
  }

  function finishDraw() {
    if (!draft) return;
    const local = dedupe(draft.pts.map(toLocal));
    const kind = mode;
    if (kind === 'fence') {
      if (local.length < 2) return toast('A fence needs at least two points.', 'bad');
      const n = app.land.fences.length + 1;
      commit((d) => {
        d.land.fences.push({ id: newId('fence'), name: `Fence ${n}`, type: fenceType, line: local, closed: fenceClosed && local.length >= 3, gates: 1 });
      });
      status = `Fence added (${num(toFeet(polylineLength(local)))} ft).`;
    } else {
      if (local.length < 3) return toast('An area needs at least three corners.', 'bad');
      if (!isSimplePolygon(local)) return toast('The outline crosses itself. Undo and click the corners in order around the edge.', 'bad');
      const polygon = ensureCCW(local);
      if (kind === 'boundary') {
        commit((d) => {
          d.land.boundary = polygon;
        });
        status = `Boundary set: ${num(toAcres(polygonArea(polygon)), 1)} acres.`;
        mode = 'pan';
        map.doubleClickZoom.enable();
        mapDiv.style.cursor = '';
      } else {
        const n = app.land.zones.filter((z) => z.use === zoneUse).length + 1;
        commit((d) => {
          d.land.zones.push({ id: newId('zone'), name: `${USE_LABEL[zoneUse]} ${n}`, use: zoneUse, polygon: polygon });
        });
        status = `${USE_LABEL[zoneUse]} added (${num(toAcres(polygonArea(polygon)), 1)} acres).`;
      }
    }
    cancelDraw();
  }

  function placeMarker(latLng) {
    ensureOrigin(latLng);
    const p = toLocal(latLng);
    commit((d) => {
      if (d.land.markers.length >= 600) return;
      d.land.markers.push({ id: newId('mk'), kind: placeKind, x: p.x, y: p.y, label: '' });
    });
  }

  function moveField(latLng) {
    commit((d) => {
      d.land.origin = recenterOrigin(d.land, { lat: latLng.lat, lon: latLng.lng });
    });
    if (!app.land.boundary.length) {
      toast('Draw your land first, then use this to slide it into place.', 'bad');
      return;
    }
    map.panTo(latLng);
    mode = 'pan';
    mapDiv.style.cursor = '';
    status = 'Land moved.';
    render();
  }

  function eraseItem(type, id) {
    commit((d) => {
      if (type === 'zone') d.land.zones = d.land.zones.filter((z) => z.id !== id);
      else if (type === 'fence') d.land.fences = d.land.fences.filter((f) => f.id !== id);
      else if (type === 'marker') d.land.markers = d.land.markers.filter((m) => m.id !== id);
      else if (type === 'boundary') d.land.boundary = [];
    });
    if (selection?.id === id) selection = null;
  }

  function select(type, id) {
    selection = { type, id };
    render();
  }

  function selectedItem() {
    if (!selection) return null;
    const land = app.land;
    if (selection.type === 'boundary') return land.boundary.length ? { points: land.boundary, closed: true } : null;
    if (selection.type === 'zone') {
      const z = land.zones.find((x) => x.id === selection.id);
      return z ? { points: z.polygon, closed: true, item: z } : null;
    }
    if (selection.type === 'fence') {
      const f = land.fences.find((x) => x.id === selection.id);
      return f ? { points: f.line, closed: f.closed, item: f } : null;
    }
    return null;
  }

  function drawHandles() {
    layers.handles.clearLayers();
    handles = [];
    const selected = selectedItem();
    if (!selected || mode !== 'pan') return;
    const type = selection.type;
    const minPts = type === 'fence' ? 2 : 3;
    const latLngs = selected.points.map((p) => toLatLng(p));
    const livePoly = type === 'fence' ? L.polyline(latLngs, { color: '#ffd23f', weight: 3, interactive: false }) : L.polygon(latLngs, { color: '#ffd23f', weight: 3, fillOpacity: 0, interactive: false });
    livePoly.addTo(layers.handles);
    selected.points.forEach((p, i) => {
      const icon = L.divIcon({ className: '', html: h('div', { class: 'vertex-handle' }), iconSize: [14, 14], iconAnchor: [7, 7] });
      const m = L.marker(latLngs[i], { draggable: true, icon, keyboard: false, zIndexOffset: 1000, title: 'Drag to move. Double-click to remove this corner.' }).addTo(layers.handles);
      m.on('drag', () => {
        latLngs[i] = m.getLatLng();
        livePoly.setLatLngs(latLngs);
      });
      m.on('dragend', () => {
        const newPoint = toLocal(m.getLatLng());
        commit((d) => {
          const points = type === 'boundary' ? d.land.boundary : type === 'zone' ? d.land.zones.find((z) => z.id === selection.id)?.polygon : d.land.fences.find((f) => f.id === selection.id)?.line;
          if (points) points[i] = newPoint;
        });
      });
      m.on('dblclick', (e) => {
        L.DomEvent.stopPropagation(e);
        if (selected.points.length <= minPts) return toast(`A ${type === 'fence' ? 'fence' : 'shape'} needs at least ${minPts} points.`);
        commit((d) => {
          const points = type === 'boundary' ? d.land.boundary : type === 'zone' ? d.land.zones.find((z) => z.id === selection.id)?.polygon : d.land.fences.find((f) => f.id === selection.id)?.line;
          if (points) points.splice(i, 1);
        });
      });
      handles.push(m);
    });
  }

  function label(text) {
    return h('span', {}, text);
  }

  function drawLand() {
    const land = app.land;
    for (const g of ['boundary', 'zones', 'fences', 'markers']) layers[g].clearLayers();
    if (!land.origin) return;
    const interactive = mode === 'pan' || mode === 'erase';
    const click = (type, id) => (e) => {
      L.DomEvent.stopPropagation(e);
      if (mode === 'erase') eraseItem(type, id);
      else select(type, id);
    };

    if (land.boundary.length >= 3) {
      const polygon = L.polygon(land.boundary.map(toLatLng), { color: '#ffd23f', weight: 3, dashArray: '8 6', fillColor: '#ffffff', fillOpacity: 0.06, interactive }).addTo(layers.boundary);
      const d = fieldDimensions(land.boundary);
      polygon.bindTooltip(label(`${num(d.acres, 1)} ac  ·  ${num(d.boxLengthFt)} x ${num(d.boxWidthFt)} ft`), { permanent: true, direction: 'center', className: 'small' });
      polygon.on('click', click('boundary', 'boundary'));
    }
    for (const z of land.zones) {
      const polygon = L.polygon(z.polygon.map(toLatLng), { color: USE_COLOR[z.use], weight: 2, fillColor: USE_COLOR[z.use], fillOpacity: 0.4, interactive }).addTo(layers.zones);
      polygon.bindTooltip(label(`${z.name} · ${num(toAcres(polygonArea(z.polygon)), 1)} ac`), { sticky: true });
      polygon.on('click', click('zone', z.id));
    }
    let postBudget = 900;
    for (const f of land.fences) {
      const style = FENCE_STYLE[f.type] || FENCE_STYLE.barbed5;
      const points = f.line.map(toLatLng);
      const line = (f.closed ? L.polygon(points, { ...style, fill: false, interactive }) : L.polyline(points, { ...style, interactive })).addTo(layers.fences);
      const lenFt = toFeet(polylineLength(f.line) + (f.closed ? Math.hypot(f.line[0].x - f.line.at(-1).x, f.line[0].y - f.line.at(-1).y) : 0));
      line.bindTooltip(label(`${f.name} · ${FENCES[f.type].label} · ${num(lenFt)} ft · ${money(lenFt * FENCES[f.type].costPerFt)}`), { sticky: true });
      line.on('click', click('fence', f.id));
      const posts = fencePosts(f.line, fromFeet(FENCES[f.type].postSpacingFt), f.closed);
      for (const p of posts) {
        if (postBudget-- <= 0) break;
        L.circleMarker(toLatLng(p), { radius: p.corner ? 3.5 : 2, color: '#3b2a14', fillColor: p.corner ? '#8b5a2b' : '#c9a36b', fillOpacity: 1, weight: 1, interactive: false }).addTo(layers.fences);
      }
    }
    for (const m of land.markers) {
      const icon = L.divIcon({ className: 'animal-icon', html: h('span', {}, MARKER_ICON[m.kind] || '📍'), iconSize: [26, 26], iconAnchor: [13, 13] });
      const marker = L.marker(toLatLng(m), { icon, interactive, keyboard: false, title: MARKER_LABEL[m.kind] }).addTo(layers.markers);
      marker.on('click', click('marker', m.id));
    }
  }

  function toolButton(id, text, extra = {}) {
    return h('button', { 'aria-pressed': String(mode === id), onclick: () => startDraw(id), ...extra }, text);
  }

  function summary() {
    const land = app.land;
    const rows = [];
    const size = land.boundary.length >= 3 ? fieldDimensions(land.boundary) : null;
    if (size) rows.push(`Land: ${num(size.acres, 1)} ac, ${num(size.boxLengthFt)} x ${num(size.boxWidthFt)} ft`);
    const byUse = {};
    for (const z of land.zones) byUse[z.use] = (byUse[z.use] || 0) + toAcres(polygonArea(z.polygon));
    for (const [u, a] of Object.entries(byUse)) rows.push(`${USE_LABEL[u]}: ${num(a, 1)} ac`);
    let fenceFt = 0;
    let fenceCost = 0;
    for (const f of land.fences) {
      const feet = toFeet(polylineLength(f.line) + (f.closed ? Math.hypot(f.line[0].x - f.line.at(-1).x, f.line[0].y - f.line.at(-1).y) : 0));
      fenceFt += feet;
      fenceCost += feet * FENCES[f.type].costPerFt;
    }
    if (land.fences.length) rows.push(`Fences: ${num(fenceFt)} ft, about ${money(fenceCost)}`);
    const counts = {};
    for (const m of land.markers) counts[m.kind] = (counts[m.kind] || 0) + 1;
    if (land.markers.length) rows.push(`Placed: ${Object.entries(counts).map(([k, n]) => `${n} ${MARKER_LABEL[k].toLowerCase()}`).join(', ')}`);
    return rows.length ? h('div', { class: 'small' }, rows.map((r) => h('div', {}, r))) : h('p', { class: 'small muted' }, 'Nothing drawn yet.');
  }

  function selectionPanel() {
    const selected = selectedItem();
    if (!selected || !selection) return null;
    const type = selection.type;
    const box = h('div', { class: 'group' });
    if (type === 'boundary') {
      box.append(h('h4', {}, 'Selected: boundary'), h('p', { class: 'small' }, `${num(toAcres(polygonArea(selected.points)), 2)} acres, ${num(toFeet(polygonPerimeter(selected.points)))} ft around`));
    } else if (type === 'zone') {
      const z = selected.item;
      box.append(h('h4', {}, 'Selected: zone'),
        h('input', { type: 'text', value: z.name, maxlength: 60, 'data-key': 'sel-name', 'aria-label': 'Zone name', onchange: (e) => commit((d) => { const t = d.land.zones.find((x) => x.id === z.id); if (t) t.name = e.target.value.trim() || t.name; }) }),
        selectInput({ value: z.use, key: 'sel-use', options: ZONE_USES.map((u) => ({ value: u, label: USE_LABEL[u] })), onChange: (v) => commit((d) => { const t = d.land.zones.find((x) => x.id === z.id); if (t && v) t.use = v; }) }),
        h('p', { class: 'small' }, `${num(toAcres(polygonArea(z.polygon)), 2)} acres. Link a plan item to this zone on the Plans tab.`));
    } else if (type === 'fence') {
      const f = selected.item;
      const length = toFeet(polylineLength(f.line) + (f.closed ? Math.hypot(f.line[0].x - f.line.at(-1).x, f.line[0].y - f.line.at(-1).y) : 0));
      box.append(h('h4', {}, 'Selected: fence'),
        h('input', { type: 'text', value: f.name, maxlength: 60, 'data-key': 'sel-name', 'aria-label': 'Fence name', onchange: (e) => commit((d) => { const t = d.land.fences.find((x) => x.id === f.id); if (t) t.name = e.target.value.trim() || t.name; }) }),
        selectInput({ value: f.type, key: 'sel-type', options: Object.values(FENCES).map((t) => ({ value: t.id, label: t.label })), onChange: (v) => commit((d) => { const t = d.land.fences.find((x) => x.id === f.id); if (t && v) t.type = v; }) }),
        h('div', { class: 'row tight' }, h('label', { for: 'gates' }, 'Gates'), h('input', { id: 'gates', type: 'number', min: 0, max: 20, value: f.gates, 'data-key': 'sel-gates', style: { width: '5rem' }, onchange: (e) => commit((d) => { const t = d.land.fences.find((x) => x.id === f.id); if (t) t.gates = Math.max(0, Math.min(20, Math.round(Number(e.target.value) || 0))); }) })),
        h('p', { class: 'small' }, `${num(length)} ft · ${fencePosts(f.line, fromFeet(FENCES[f.type].postSpacingFt), f.closed).length} posts · ${money(length * FENCES[f.type].costPerFt)}`));
    }
    box.append(h('button', { class: 'danger small', onclick: () => eraseItem(type, selection.id) }, 'Delete this'));
    return box;
  }

  function renderPanel() {
    clear(panel);
    const land = app.land;
    const addressInput = h('input', { type: 'text', placeholder: 'Go to address...', maxlength: 200, 'data-key': 'map-addr', 'aria-label': 'Go to address', onkeydown: (e) => e.key === 'Enter' && go(addressInput.value) });
    const go = async (text) => {
      try {
        const g = await geocode(text);
        if (!g) return toast('No match in the United States.', 'bad');
        app.update((d) => {
          d.land.location = { label: g.label, lat: g.lat, lon: g.lon };
          d.land.region = g.region;
          if (!d.land.origin) d.land.origin = { lat: g.lat, lon: g.lon };
        }, { quiet: true });
        map.setView([g.lat, g.lon], 17);
        render();
      } catch (e) {
        toast(e.message, 'bad');
      }
    };
    panel.append(
      h('div', { class: 'row tight' }, h('div', { style: { flex: 1 } }, addressInput), h('button', { class: 'small', onclick: () => go(addressInput.value) }, 'Go')),
      h('button', { class: 'secondary small', onclick: () => fitLand(true) }, 'Zoom to my land'),
      h('div', { class: 'group' }, h('h4', {}, 'Outline'),
        toolButton('boundary', land.boundary.length ? 'Redraw boundary' : 'Draw boundary'),
        toolButton('move', 'Move my land here', { disabled: !land.boundary.length })),
      h('div', { class: 'group' }, h('h4', {}, 'Zones'),
        selectInput({ value: zoneUse, key: 'zone-use', options: ZONE_USES.map((u) => ({ value: u, label: USE_LABEL[u] })), onChange: (v) => { zoneUse = v; render(); } }),
        toolButton('zone', `Draw ${USE_LABEL[zoneUse].toLowerCase()}`)),
      h('div', { class: 'group' }, h('h4', {}, 'Fences'),
        selectInput({ value: fenceType, key: 'fence-type', options: Object.values(FENCES).map((t) => ({ value: t.id, label: `${t.label} ($${t.costPerFt.toFixed(2)}/ft)` })), onChange: (v) => { fenceType = v; render(); } }),
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: fenceClosed, onchange: (e) => { fenceClosed = e.target.checked; } }), 'Close the loop (3+ points)'),
        toolButton('fence', 'Draw fence line')),
      h('div', { class: 'group' }, h('h4', {}, 'Place on the land'),
        h('div', { class: 'row tight', role: 'group', 'aria-label': 'What to place' }, Object.keys(MARKER_ICON).map((k) => h('button', { class: 'chip', 'aria-pressed': String(mode === 'place' && placeKind === k), title: MARKER_LABEL[k], onclick: () => { placeKind = k; startDraw('place'); } }, `${MARKER_ICON[k]} ${MARKER_LABEL[k]}`))),
        h('p', { class: 'small muted' }, 'Pick a type, then tap the map as many times as you like. Each tapped spot becomes a group of animals in the 3D view.')),
      draft ? h('div', { class: 'group row tight' }, h('button', { onclick: () => { finishDraw(); render(); } }, 'Finish'), h('button', { class: 'secondary', onclick: () => { cancelDraw(); render(); } }, 'Cancel')) : null,
      h('div', { class: 'group' }, h('h4', {}, 'Edit'),
        toolButton('pan', 'Select / reshape'),
        toolButton('erase', 'Delete tool'),
        h('button', { class: 'secondary', onclick: () => { undo(); render(); }, disabled: !history.length }, `Undo (${history.length})`)),
      selectionPanel(),
      h('div', { class: 'group' }, h('h4', {}, 'On the map'), summary()),
      status ? h('p', { class: 'small', role: 'status' }, status) : null,
    );
    hintEl.textContent = draft ? `${HINTS[mode]} (${draft.pts.length} point${draft.pts.length === 1 ? '' : 's'})` : HINTS[mode];
  }

  function fitLand(force = false) {
    const land = app.land;
    if (land.boundary.length >= 3 && land.origin) map.fitBounds(L.latLngBounds(land.boundary.map(toLatLng)).pad(0.3), { maxZoom: 18 });
    else if (land.location) map.setView([land.location.lat, land.location.lon], 16);
    else if (land.origin) map.setView([land.origin.lat, land.origin.lon], 16);
    else if (force) map.setView([DEFAULT_ORIGIN.lat, DEFAULT_ORIGIN.lon], 12);
  }

  function initMap() {
    map = L.map(mapDiv, { zoomControl: true, maxZoom: 20, doubleClickZoom: true, attributionControl: true });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }).addTo(map);
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' });
    L.control.layers({ Satellite: satellite, Streets: streets }, null, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: true, metric: false }).addTo(map);
    layers = { boundary: L.layerGroup().addTo(map), zones: L.layerGroup().addTo(map), fences: L.layerGroup().addTo(map), markers: L.layerGroup().addTo(map), handles: L.layerGroup().addTo(map), draft: L.layerGroup().addTo(map) };
    map.on('click', (e) => {
      if (mode === 'boundary' || mode === 'zone' || mode === 'fence') addVertex(e.latlng);
      else if (mode === 'place') placeMarker(e.latlng);
      else if (mode === 'move') moveField(e.latlng);
      else if (mode === 'pan' && selection) {
        selection = null;
        render();
      }
    });
    map.on('dblclick', () => {
      if (draft) {
        finishDraw();
        render();
      }
    });
    map.on('mousemove', (e) => {
      if (draft && draft.pts.length) drawDraft(e.latlng);
    });
    fitLand();
    if (!app.land.origin && !app.land.location) map.setView([DEFAULT_ORIGIN.lat, DEFAULT_ORIGIN.lon], 12);
    setTimeout(() => map.invalidateSize(), 50);
  }

  const onKey = (e) => {
    if (!map) return;
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (e.key === 'Escape') {
      if (draft) cancelDraw();
      else if (mode !== 'pan') mode = 'pan';
      else selection = null;
      map.doubleClickZoom.enable();
      render();
    } else if (e.key === 'Enter' && draft && !typing) {
      finishDraw();
      render();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection && !typing) {
      eraseItem(selection.type, selection.id);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      undo();
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', onKey);

  function render() {
    if (!map) {
      initMap();
    }
    renderPanel();
    drawLand();
    drawHandles();
    if (firstFit && app.land.boundary.length) firstFit = false;
  }

  return {
    el: element,
    render,
    destroy() {
      document.removeEventListener('keydown', onKey);
      cancelDraw();
      map?.remove();
      map = null;
    },
  };
}
