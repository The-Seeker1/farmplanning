import { createGemini } from './gemini.js';
import { NetError } from '../net.js';

export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    create: createGemini,
    keyHint: 'Create a key in Google AI Studio. Free keys are for adults 18+ and the free tier may use what you send to improve Google products.',
    keyPattern: /^[A-Za-z0-9_-]{20,80}$/,
    defaultModel: 'gemini-flash-latest',
    freeTierNotice:
      'On the free tier, Google may use prompts and responses to improve its products and humans may review them. FieldWise sends only land numbers (no address, name or coordinates) and photos you approve.',
  },
};

export function createProvider(id, config) {
  const definition = PROVIDERS[id];
  if (!definition) throw new Error(`Unknown AI provider: ${id}`);
  if (!definition.keyPattern.test(config?.apiKey || '')) throw new NetError('auth', 'That does not look like a valid API key.');
  return definition.create({ model: definition.defaultModel, ...config });
}

export function guardProvider(provider, { minIntervalMs = 4000, cacheMs = 10 * 60 * 1000, maxCalls = 60, now = () => Date.now(), sleep = (milliseconds) => new Promise((r) => setTimeout(r, milliseconds)) } = {}) {
  const cache = new Map();
  let last = 0;
  let calls = 0;
  let chain = Promise.resolve();
  const keyOf = (request) => JSON.stringify([request.system, request.prompt, request.image ? request.image.base64.length + request.image.base64.slice(0, 64) : null, request.temperature ?? null]);

  const guarded = {
    id: provider.id,
    label: provider.label,
    needsKey: provider.needsKey,
    get calls() {
      return calls;
    },
    get callsLeft() {
      return Math.max(0, maxCalls - calls);
    },
    testConnection: () => provider.testConnection(),
    generateJson(request) {
      const k = keyOf(request);
      const hit = cache.get(k);
      if (hit && now() - hit.at < cacheMs) return Promise.resolve(structuredClone(hit.value));
      const run = async () => {
        const again = cache.get(k);
        if (again && now() - again.at < cacheMs) return structuredClone(again.value);
        if (calls >= maxCalls) throw new NetError('quota', `This session reached its limit of ${maxCalls} AI calls. Reload the page to continue.`);
        const waitMs = last + minIntervalMs - now();
        if (waitMs > 0) await sleep(waitMs);
        calls++;
        last = now();
        const value = await provider.generateJson(request);
        cache.set(k, { at: now(), value: structuredClone(value) });
        if (cache.size > 40) cache.delete(cache.keys().next().value);
        return value;
      };
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    },
  };
  return guarded;
}
