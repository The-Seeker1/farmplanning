import { createStorage, createKeyStore, newProfile, sanitizeProfile, sanitizePrefs, exportProfileJson, importProfileJson, MAX_PROFILES } from './storage.js';
import { evaluatePlan, emptyPlan, DEFAULT_ASSUMPTIONS, newId } from './planner.js';
import { createProvider, guardProvider, PROVIDERS } from './ai/provider.js';

const storage = createStorage();
const keys = createKeyStore();
let store = storage.load();
const listeners = new Set();
let saveTimer = null;
let saveError = '';
let provider = null;
let providerSig = '';
const evalCache = new Map();

function notify(reason = 'change') {
  for (const listener of listeners) {
    try {
      listener(reason);
    } catch (e) {
      console.error(e);
    }
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
}

function saveNow() {
  clearTimeout(saveTimer);
  try {
    storage.save(store);
    saveError = '';
  } catch (e) {
    saveError = e.message;
  }
  notify('saved');
}

export const app = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  get store() {
    return store;
  },
  get prefs() {
    return store.prefs;
  },
  get profile() {
    return store.profiles.find((p) => p.id === store.activeProfileId) || store.profiles[0];
  },
  get land() {
    return this.profile.land;
  },
  get plan() {
    const p = this.profile;
    return p.plans.find((x) => x.id === p.activePlanId) || p.plans[0] || null;
  },
  get persistent() {
    return storage.persistent;
  },
  get saveError() {
    return saveError;
  },
  get assumptions() {
    const land = this.land;
    return { ...DEFAULT_ASSUMPTIONS, ...(this.profile.overrides?.assumptions || {}), region: land.region, zone: land.zone };
  },

  update(mutator, { quiet = false } = {}) {
    const index = store.profiles.findIndex((p) => p.id === store.activeProfileId);
    const draft = structuredClone(store.profiles[index]);
    mutator(draft);
    draft.updatedAt = Date.now();
    store.profiles[index] = sanitizeProfile(draft);
    evalCache.clear();
    scheduleSave();
    if (!quiet) notify('change');
  },

  updatePrefs(patch) {
    store.prefs = sanitizePrefs({ ...store.prefs, ...patch });
    provider = null;
    scheduleSave();
    notify('prefs');
  },

  evaluate(plan = this.plan) {
    if (!plan) return null;
    const key = `${this.profile.id}|${this.profile.updatedAt}|${plan.id}`;
    if (!evalCache.has(key)) evalCache.set(key, evaluatePlan(plan, this.land, this.profile.overrides, this.assumptions));
    return evalCache.get(key);
  },

  setActiveProfile(id) {
    if (store.profiles.some((p) => p.id === id)) {
      store.activeProfileId = id;
      scheduleSave();
      notify('profile');
    }
  },
  addProfile(name) {
    if (store.profiles.length >= MAX_PROFILES) throw new Error(`You can keep up to ${MAX_PROFILES} profiles. Export and delete one first.`);
    const p = newProfile(name || 'New farm');
    store.profiles.push(p);
    store.activeProfileId = p.id;
    scheduleSave();
    notify('profile');
    return p;
  },
  duplicateProfile() {
    if (store.profiles.length >= MAX_PROFILES) throw new Error(`You can keep up to ${MAX_PROFILES} profiles.`);
    const copy = sanitizeProfile({ ...structuredClone(this.profile), id: newId('prof'), name: `${this.profile.name} copy` });
    store.profiles.push(copy);
    store.activeProfileId = copy.id;
    scheduleSave();
    notify('profile');
  },
  renameProfile(name) {
    this.update((p) => {
      p.name = name;
    });
  },
  deleteProfile() {
    const id = store.activeProfileId;
    store.profiles = store.profiles.filter((p) => p.id !== id);
    if (!store.profiles.length) store.profiles.push(newProfile('My farm'));
    store.activeProfileId = store.profiles[0].id;
    evalCache.clear();
    scheduleSave();
    notify('profile');
  },
  exportActive(includeLocation = false) {
    return exportProfileJson(this.profile, { includeLocation });
  },
  importProfile(text) {
    if (store.profiles.length >= MAX_PROFILES) throw new Error(`You can keep up to ${MAX_PROFILES} profiles.`);
    const p = importProfileJson(text);
    store.profiles.push(p);
    store.activeProfileId = p.id;
    scheduleSave();
    notify('profile');
    return p;
  },
  eraseEverything() {
    storage.clear();
    keys.clear('gemini');
    store = storage.load();
    provider = null;
    evalCache.clear();
    notify('profile');
  },

  addPlan(plan = null) {
    const p = plan || emptyPlan(`Plan ${this.profile.plans.length + 1}`);
    this.update((d) => {
      if (d.plans.length >= 20) throw new Error('You can keep up to 20 plans per profile.');
      d.plans.push(p);
      d.activePlanId = p.id;
    });
    return p;
  },
  setActivePlan(id) {
    this.update((d) => {
      d.activePlanId = id;
    });
  },
  duplicatePlan(id = this.plan?.id) {
    const source = this.profile.plans.find((p) => p.id === id);
    if (!source) return;
    const copy = { ...structuredClone(source), id: newId('plan'), name: `${source.name} copy`.slice(0, 60), allocations: source.allocations.map((a) => ({ ...structuredClone(a), id: newId('al') })) };
    this.addPlan(copy);
  },
  deletePlan(id = this.plan?.id) {
    this.update((d) => {
      d.plans = d.plans.filter((p) => p.id !== id);
      d.activePlanId = d.plans[0]?.id || null;
    });
  },

  hasKey() {
    return !!keys.load(this.prefs.provider);
  },
  keyRemembered() {
    return keys.remembered(this.prefs.provider);
  },
  saveKey(key, remember) {
    keys.save(this.prefs.provider, key.trim(), remember);
    provider = null;
    this.updatePrefs({ rememberKey: remember });
  },
  clearKey() {
    keys.clear(this.prefs.provider);
    provider = null;
    notify('prefs');
  },
  ai() {
    const key = keys.load(this.prefs.provider);
    if (!key) return null;
    const signature = `${this.prefs.provider}|${this.prefs.model}|${key.length}|${key.slice(-4)}`;
    if (provider && providerSig === signature) return provider;
    try {
      provider = guardProvider(createProvider(this.prefs.provider, { apiKey: key, model: this.prefs.model }));
      providerSig = signature;
    } catch {
      provider = null;
    }
    return provider;
  },
  rawProvider(key) {
    return createProvider(this.prefs.provider, { apiKey: key, model: this.prefs.model });
  },
  async testKey(candidate = '') {
    const key = candidate || keys.load(this.prefs.provider);
    if (!key) throw new Error('Enter a key first.');
    return createProvider(this.prefs.provider, { apiKey: key, model: this.prefs.model }).testConnection();
  },
  providerInfo() {
    return PROVIDERS[this.prefs.provider];
  },
  flush: saveNow,
};

window.addEventListener('pagehide', () => saveNow());
