import { fetchJson, NetError } from '../net.js';
import { parseModelJson } from './validate.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_RE = /^[a-z0-9][a-z0-9._-]{1,60}$/i;

export function extractText(json) {
  if (json?.promptFeedback?.blockReason) {
    throw new NetError('blocked', 'Gemini declined to process that input. Try a different photo or wording.', { detail: json.promptFeedback.blockReason });
  }
  const candidate = json?.candidates?.[0];
  if (!candidate) throw new NetError('parse', 'Gemini returned no answer.');
  const text = (candidate.content?.parts || []).map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
  if (!text) {
    const reason = candidate.finishReason || 'unknown';
    throw new NetError('parse', reason === 'SAFETY' ? 'Gemini stopped for safety reasons.' : `Gemini returned an empty answer (${reason}).`);
  }
  if (candidate.finishReason === 'MAX_TOKENS') throw new NetError('parse', 'Gemini ran out of room mid-answer. Try again.');
  return text;
}

export function createGemini({ apiKey, model = 'gemini-flash-latest', fetchImpl } = {}) {
  if (!MODEL_RE.test(model)) throw new Error('Invalid model name.');
  const common = fetchImpl ? { fetchImpl } : {};
  return {
    id: 'gemini',
    label: 'Google Gemini',
    needsKey: true,
    model,

    async generateJson({ system, prompt, image = null, maxOutputTokens = 2500, temperature = 0.4 }) {
      const parts = [{ text: prompt }];
      if (image) {
        if (!/^image\/(jpeg|png|webp)$/.test(image.mimeType) || typeof image.base64 !== 'string') throw new Error('Unsupported image.');
        parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
      }
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature, maxOutputTokens },
      };
      const json = await fetchJson(`${BASE}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        timeoutMs: 60000,
        maxBytes: 1_500_000,
        ...common,
      });
      try {
        return parseModelJson(extractText(json));
      } catch (e) {
        if (e instanceof NetError) throw e;
        throw new NetError('parse', 'Gemini answered, but not in a form the app could read. Try again.', { cause: e });
      }
    },

    async testConnection() {
      const json = await fetchJson(`${BASE}/models?pageSize=100`, {
        headers: { 'x-goog-api-key': apiKey },
        timeoutMs: 15000,
        ...common,
      });
      const models = (json?.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter((n) => MODEL_RE.test(n) && /gemini/i.test(n));
      return { ok: true, models };
    },
  };
}
