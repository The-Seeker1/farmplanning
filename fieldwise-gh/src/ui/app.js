import { h, clear } from './dom.js';
import { app } from '../state.js';
import { toast, showModal, askText, askConfirm } from './common.js';

const TABS = [
  { id: 'land', label: '1 · Land', load: () => import('./landTab.js') },
  { id: 'map', label: '2 · Map', load: () => import('./mapTab.js') },
  { id: 'plans', label: '3 · Plans', load: () => import('./plansTab.js') },
  { id: 'compare', label: '4 · Compare', load: () => import('./compareTab.js') },
  { id: 'view3d', label: '5 · 3D view', load: () => import('./view3dTab.js') },
  { id: 'learn', label: '6 · Learn', load: () => import('./learnTab.js') },
  { id: 'settings', label: 'Settings', load: () => import('./settingsTab.js') },
];
const TAB_IDS = TABS.map((t) => t.id);

export function startApp(root) {
  let current = null;
  let loading = 0;

  const header = h('div', { class: 'topbar' });
  const tabsEl = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' });
  const main = h('main', { id: 'main', tabindex: '-1' });
  const footer = h('footer', {}, 'FieldWise gives planning ESTIMATES for learning and early planning. It is not professional agronomic, veterinary, legal or financial advice. Confirm numbers with your county K-State Research and Extension office and a soil test. Dollar figures use starter prices unless you replace them in Settings.');
  root.append(header, tabsEl, main, footer);

  function drawHeader() {
    clear(header);
    const profileSelect = h('select', { 'aria-label': 'Farm profile', 'data-key': 'profile-select', onchange: (e) => app.setActiveProfile(e.target.value) }, app.store.profiles.map((p) => h('option', { value: p.id }, p.name)));
    profileSelect.value = app.profile.id;
    const run = async (listener) => {
      try {
        await listener();
      } catch (e) {
        toast(e.message, 'bad');
      }
    };
    header.append(
      h('div', { class: 'brand' }, 'FieldWise', h('small', {}, 'land planner')),
      h('div', { class: 'row tight' }, profileSelect,
        h('button', { class: 'ghost small', title: 'New profile', onclick: () => run(async () => { const n = await askText('Name the new farm profile', 'New farm'); if (n) app.addProfile(n); }) }, 'New'),
        h('button', { class: 'ghost small', onclick: () => run(async () => { const n = await askText('Rename this profile', app.profile.name); if (n) app.renameProfile(n); }) }, 'Rename'),
        h('button', { class: 'ghost small', onclick: () => run(() => { app.duplicateProfile(); toast('Profile duplicated.', 'good'); }) }, 'Duplicate'),
        h('button', { class: 'ghost small', onclick: () => run(async () => { if (await askConfirm(`Delete the profile "${app.profile.name}" from this device? This cannot be undone.`, { yes: 'Delete', danger: true })) app.deleteProfile(); }) }, 'Delete')),
      h('span', { class: 'spacer' }),
      app.saveError ? h('span', { class: 'pill bad' }, app.saveError) : app.persistent ? h('span', { class: 'pill', title: 'Saved in this browser only. Nothing is uploaded.' }, 'Saved on this device') : h('span', { class: 'pill warn', title: 'Your browser blocked storage. Export your profile before closing.' }, 'Not saving (storage blocked)'),
      h('span', { class: 'pill', title: app.hasKey() ? 'AI features are on for this session' : 'Add a Gemini key in Settings for AI features' }, app.hasKey() ? 'AI on' : 'AI off · offline mode'),
    );
  }

  function drawTabs(active) {
    clear(tabsEl);
    TABS.forEach((t) => {
      tabsEl.append(h('button', { role: 'tab', 'aria-selected': String(t.id === active), onclick: () => go(t.id) }, t.label));
    });
  }

  async function go(id) {
    if (!TAB_IDS.includes(id)) id = 'land';
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    const my = ++loading;
    current?.instance?.destroy?.();
    current = null;
    clear(main);
    drawTabs(id);
    const definition = TABS.find((t) => t.id === id);
    main.append(h('p', { class: 'muted' }, 'Loading...'));
    try {
      const tabModule = await definition.load();
      if (my !== loading) return;
      const instance = tabModule.default({ go });
      current = { id, instance };
      clear(main);
      main.append(instance.el);
      instance.render?.();
      window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      clear(main);
      main.append(h('div', { class: 'callout bad' }, `This section could not load: ${e.message}`));
    }
  }

  let redrawing = false;
  let queued = null;
  function rerender(reason) {
    if (redrawing) {
      queued = reason;
      return;
    }
    redrawing = true;
    try {
      redraw(reason);
    } finally {
      redrawing = false;
    }
    if (queued) {
      const next = queued;
      queued = null;
      rerender(next);
    }
  }

  function redraw(reason) {
    if (reason === 'saved' || reason === 'prefs' || reason === 'profile' || reason === 'change') drawHeader();
    if (reason === 'saved') return;
    const active = document.activeElement;
    const key = active?.dataset?.key;
    const caret = typeof active?.selectionStart === 'number' ? active.selectionStart : null;
    current?.instance?.render?.(reason);
    if (key) {
      const again = main.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (again && again !== active) {
        again.focus({ preventScroll: true });
        if (caret !== null && typeof again.setSelectionRange === 'function') {
          try {
            again.setSelectionRange(caret, caret);
          } catch {}
        }
      }
    }
  }

  app.subscribe(rerender);
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (TAB_IDS.includes(id) && id !== current?.id) go(id);
  });

  drawHeader();
  const start = TAB_IDS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'land';
  go(start);
  if (!app.prefs.seenWelcome) showWelcome();
}

function showWelcome() {
  showModal((box, close) => {
    box.append(
      h('h2', {}, 'Welcome to FieldWise'),
      h('p', {}, 'Plan crops and livestock for a piece of land: look up the soil, draw your fields and fences, see how many animals and how many acres of each crop fit, compare plans, and learn why with a quiz built from your own land.'),
      h('div', { class: 'callout good' }, h('strong', {}, 'Your data stays on this device. '), 'There is no account and no server. Profiles are saved in this browser only. You can export or erase them any time in Settings.'),
      h('ul', { class: 'small' },
        h('li', {}, 'When you press "Find address", the address is sent to OpenStreetMap to get a map position. When you press "Get soil data", the position is sent to the USDA soil survey.'),
        h('li', {}, 'AI is optional. Without a key, everything runs offline in your browser. With a Gemini key, photos you approve and non-identifying land numbers (never your address, name or coordinates) are sent to Google.'),
        h('li', {}, 'Results are planning estimates. Prices start as placeholders you can replace in Settings.')),
      h('div', { class: 'row mt' }, h('button', { onclick: () => { app.updatePrefs({ seenWelcome: true }); close(); } }, 'Get started')),
    );
  }, { dismissable: false });
}
