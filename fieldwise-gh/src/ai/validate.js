const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export function cleanText(s, max = 400) {
  if (typeof s !== 'string') return '';
  return s.replace(BAD_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function clampNum(v, low, high, fallback = null) {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(high, Math.max(low, n));
}

export function pickEnum(v, allowed, fallback) {
  return typeof v === 'string' && allowed.includes(v.toLowerCase()) ? v.toLowerCase() : fallback;
}

export function cleanList(list, maxItems, maxLen) {
  if (!Array.isArray(list)) return [];
  return list.map((x) => cleanText(typeof x === 'string' ? x : '', maxLen)).filter(Boolean).slice(0, maxItems);
}

export function parseModelJson(text) {
  if (typeof text !== 'string') throw new Error('The AI returned no text.');
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The AI did not return JSON.');
  const parsed = JSON.parse(t.slice(start, end + 1));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The AI returned an unexpected shape.');
  return parsed;
}

export const LAND_COVER_CLASSES = ['grass', 'crops', 'bare_soil', 'trees', 'water', 'buildings', 'other'];
export const CONDITION_LEVELS = ['poor', 'fair', 'good', 'excellent', 'unknown'];
export const SLOPE_LEVELS = ['flat', 'gentle', 'moderate', 'steep', 'unknown'];
export const DRAINAGE_LEVELS = ['well', 'moderate', 'poor', 'unknown'];
export const SEVERITY = ['light', 'moderate', 'heavy'];

export function validatePhotoAnalysis(response) {
  const r = response && typeof response === 'object' ? response : {};
  let cover = (Array.isArray(r.landCover) ? r.landCover : [])
    .map((x) => ({ cls: pickEnum(x?.cls ?? x?.class, LAND_COVER_CLASSES, null), pct: clampNum(x?.pct, 0, 100, null) }))
    .filter((x) => x.cls && x.pct !== null)
    .slice(0, 7);
  const merged = {};
  for (const c of cover) merged[c.cls] = (merged[c.cls] || 0) + c.pct;
  cover = Object.entries(merged).map(([coverType, percent]) => ({ cls: coverType, pct: percent }));
  const total = cover.reduce((s, c) => s + c.pct, 0);
  if (total > 0 && Math.abs(total - 100) > 1) cover = cover.map((c) => ({ cls: c.cls, pct: (c.pct / total) * 100 }));
  cover = cover.map((c) => ({ cls: c.cls, pct: Math.round(c.pct * 10) / 10 })).sort((a, b) => b.pct - a.pct);

  const weeds = (Array.isArray(r.weeds) ? r.weeds : [])
    .map((w) => ({ name: cleanText(w?.name, 60), severity: pickEnum(w?.severity, SEVERITY, 'light') }))
    .filter((w) => w.name)
    .slice(0, 8);

  return {
    landCover: cover,
    vegetationCondition: pickEnum(r.vegetationCondition, CONDITION_LEVELS, 'unknown'),
    slope: pickEnum(r.slope, SLOPE_LEVELS, 'unknown'),
    drainage: pickEnum(r.drainage, DRAINAGE_LEVELS, 'unknown'),
    erosionSigns: r.erosionSigns === true,
    standingWater: r.standingWater === true,
    weeds,
    observations: cleanList(r.observations, 6, 240),
    confidence: pickEnum(r.confidence, ['low', 'medium', 'high'], 'low'),
  };
}

export function validateLesson(response) {
  const r = response && typeof response === 'object' ? response : {};
  const sections = (Array.isArray(r.sections) ? r.sections : [])
    .map((s) => ({ heading: cleanText(s?.heading, 100), body: cleanText(s?.body, 1200) }))
    .filter((s) => s.heading && s.body)
    .slice(0, 8);
  return {
    title: cleanText(r.title, 120) || 'Lesson',
    sections,
    takeaways: cleanList(r.takeaways, 6, 200),
  };
}

export const QUIZ_TOPICS = ['ph', 'organic_matter', 'texture', 'drainage', 'slope', 'stocking', 'crops', 'water', 'fencing', 'economics'];

export function validateQuiz(response, { max = 12 } = {}) {
  const r = response && typeof response === 'object' ? response : {};
  const out = [];
  for (const q of Array.isArray(r.questions) ? r.questions : []) {
    const prompt = cleanText(q?.prompt, 360);
    const options = (Array.isArray(q?.options) ? q.options : []).map((o) => cleanText(typeof o === 'string' ? o : '', 200)).filter(Boolean);
    const unique = [...new Set(options)];
    const index = typeof q?.correctIndex === 'string' && /^\d$/.test(q.correctIndex) ? Number(q.correctIndex) : q?.correctIndex;
    if (!prompt || unique.length !== options.length || options.length < 3 || options.length > 4 || !Number.isInteger(index) || index < 0 || index >= options.length) continue;
    out.push({
      prompt,
      options,
      correctIndex: index,
      explanation: cleanText(q?.explanation, 600),
      topic: pickEnum(q?.topic, QUIZ_TOPICS, 'ph'),
      kind: pickEnum(q?.kind, ['benefit', 'limitation', 'calculation', 'concept'], 'concept'),
      difficulty: pickEnum(q?.difficulty, ['basic', 'advanced'], 'basic'),
    });
    if (out.length >= max) break;
  }
  return { questions: out };
}

export function validateAdvice(response) {
  const r = response && typeof response === 'object' ? response : {};
  return {
    summary: cleanText(r.summary, 600),
    suggestions: (Array.isArray(r.suggestions) ? r.suggestions : [])
      .map((s) => ({ title: cleanText(s?.title, 100), detail: cleanText(s?.detail, 400) }))
      .filter((s) => s.title && s.detail)
      .slice(0, 6),
    cautions: cleanList(r.cautions, 5, 240),
  };
}
