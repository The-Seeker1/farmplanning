import test from 'node:test';
import assert from 'node:assert/strict';
import { factorCards, lessonFor, buildQuiz, TOPICS, TOPIC_LABEL } from '../src/learn.js';
import { stockingCapacity, waterNeed, cropEstimate, fenceCostPerFt, evaluatePlan, emptyPlan, DEFAULT_ASSUMPTIONS } from '../src/planner.js';
import { pastureForageLbPerAc } from '../src/soilfit.js';
import { polygonPerimeter, toFeet } from '../src/geo.js';
import { validateQuiz, QUIZ_TOPICS } from '../src/ai/validate.js';
import { squareLand, IDEAL_SOIL } from './helpers.js';

const highPh = squareLand(40, { ...IDEAL_SOIL, ph: 8.0 });
const ctxOf = (land, extra = {}) => ({ land, overrides: {}, assumptions: DEFAULT_ASSUMPTIONS, evaluation: null, ...extra });
const emptyLand = () => ({ id: 'x', name: 'x', region: 'east', boundary: [], soil: {}, zones: [], fences: [], markers: [] });

function assertWellFormed(q) {
  assert.ok(q.prompt.length > 10, 'prompt');
  assert.ok(q.options.length >= 3 && q.options.length <= 4, `option count: ${q.prompt}`);
  assert.equal(new Set(q.options).size, q.options.length, `duplicate options: ${q.prompt}`);
  assert.ok(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.options.length, 'correctIndex');
  assert.ok(q.explanation.length > 5, 'explanation');
  assert.ok(TOPICS.includes(q.topic), `topic ${q.topic}`);
}

test('every topic has a label and a lesson, even with no land entered', () => {
  for (const t of TOPICS) {
    assert.ok(TOPIC_LABEL[t]);
    const lesson = lessonFor(t, ctxOf(emptyLand()));
    assert.equal(lesson.topic, t);
    assert.ok(lesson.title && lesson.sections.length >= 2, t);
    for (const s of lesson.sections) assert.ok(s.heading && s.body, `${t}: ${s.heading}`);
    assert.ok(lesson.takeaways.length >= 1 || lesson.missing.length >= 1, t);
  }
});

test('lessons list the numbers the student entered, and say when one is missing', () => {
  const lesson = lessonFor('ph', ctxOf(highPh));
  assert.ok(lesson.facts[0].known);
  assert.match(lesson.facts[0].value, /8/);
  assert.deepEqual(lesson.missing, []);
  const none = lessonFor('ph', ctxOf(emptyLand()));
  assert.equal(none.facts[0].known, false);
  assert.deepEqual(none.missing, ['ph']);
  assert.ok(none.sections.some((s) => /not entered/i.test(s.body)));
});

test('a high-pH lesson states a benefit AND a limitation of the student\'s own value', () => {
  const lesson = lessonFor('ph', ctxOf(highPh));
  const heads = lesson.sections.map((s) => s.heading);
  assert.ok(heads.includes('Benefits for your field'));
  assert.ok(heads.includes('Limits and what to do'));
  const text = lesson.sections.map((s) => s.body).join(' ');
  assert.match(text, /free lime|iron/i);
  assert.match(text, /no lime is needed|not needed/i);
});

test('pH bands follow the K-State thresholds', () => {
  const band = (ph, region = 'east') => factorCards({ region, soil: { ph } }).find((c) => c.topic === 'ph').band;
  assert.equal(band(5.0), 'very_acid');
  assert.equal(band(5.8), 'acid');
  assert.equal(band(6.2), 'legume_gap');
  assert.equal(band(6.8), 'good');
  assert.equal(band(7.9), 'free_lime');
  assert.equal(band(8.3), 'alkaline');
  assert.equal(band(8.7), 'sodic');
  assert.equal(band(5.8, 'west'), 'legume_gap');
  assert.equal(band(5.4, 'west'), 'acid');
});

test('unknown soil values make no card', () => {
  assert.deepEqual(factorCards(emptyLand()), []);
  const some = factorCards({ region: 'east', soil: { ph: 7 } });
  assert.deepEqual(some.map((c) => c.topic), ['ph']);
});

test('a card\'s wrong answers never repeat its right answers', () => {
  for (const ph of [4.9, 5.7, 6.2, 6.8, 7.9, 8.3, 8.8]) {
    for (const soil of [{ ph, om: 1.2, texture: 'sand', drainage: 'excessive', slopePct: 1 }, { ph, om: 3, texture: 'silt_loam', drainage: 'moderate', slopePct: 4 }, { ph, om: 5, texture: 'clay', drainage: 'poor', slopePct: 8 }, { ph, slopePct: 14, drainage: 'well' }]) {
      for (const c of factorCards({ region: 'east', soil })) {
        assert.ok(c.benefit && c.limit && c.manage && c.summary, `${c.topic} ${c.band}`);
        assert.ok(!c.wrongBenefits.includes(c.benefit), `${c.topic}/${c.band}: wrong benefit equals the true one`);
        assert.ok(!c.wrongLimits.includes(c.limit), `${c.topic}/${c.band}: wrong limit equals the true one`);
        assert.ok(c.wrongBenefits.length >= 3 && c.wrongLimits.length >= 3);
        assert.ok(!c.wrongBenefits.includes(c.limit) && !c.wrongLimits.includes(c.benefit));
      }
    }
  }
});

test('the advanced quiz asks about benefits and limitations of the student\'s own pH', () => {
  const { questions, personalCount } = buildQuiz(ctxOf(highPh), { count: 8, level: 'advanced', seed: 7, topics: ['ph'] });
  assert.ok(questions.length >= 3);
  const kinds = new Set(questions.map((q) => q.kind));
  assert.ok(kinds.has('benefit') && kinds.has('limitation'), [...kinds].join());
  const benefit = questions.find((q) => q.kind === 'benefit');
  assert.match(benefit.prompt, /soil pH is 8/);
  assert.match(benefit.prompt, /BENEFIT/);
  assert.ok(personalCount >= 2);
  assert.match(benefit.options[benefit.correctIndex], /No lime is needed/);
  const limit = questions.find((q) => q.kind === 'limitation');
  assert.match(limit.options[limit.correctIndex], /tie up iron|iron, zinc/i);
});

test('quiz questions are well formed for many land profiles and seeds', () => {
  const lands = [
    highPh,
    squareLand(25, { ph: 5.2, om: 1.5, texture: 'loamy_sand', drainage: 'excessive', slopePct: 1, depthIn: 30 }),
    squareLand(160, { ph: 6.5, om: 4.5, texture: 'clay', drainage: 'poor', slopePct: 12 }, { region: 'west' }),
    squareLand(5, { ph: 8.8, om: 2.5, texture: 'silty_clay_loam', drainage: 'somewhat_poor', slopePct: 6 }),
    emptyLand(),
  ];
  for (const land of lands) {
    for (const level of ['advanced', 'basic']) {
      for (let seed = 1; seed <= 12; seed++) {
        const { questions } = buildQuiz(ctxOf(land), { count: 10, level, seed });
        assert.ok(questions.length >= 3, `${level} seed ${seed} gave ${questions.length}`);
        for (const q of questions) assertWellFormed(q);
        assert.equal(new Set(questions.map((q) => q.prompt)).size, questions.length, 'no repeated question');
      }
    }
  }
});

test('the same seed gives the same quiz and a different seed gives a different one', () => {
  const a = buildQuiz(ctxOf(highPh), { count: 8, seed: 42 });
  const b = buildQuiz(ctxOf(highPh), { count: 8, seed: 42 });
  assert.deepEqual(a.questions, b.questions);
  const c = buildQuiz(ctxOf(highPh), { count: 8, seed: 43 });
  assert.notDeepEqual(a.questions.map((q) => q.prompt), c.questions.map((q) => q.prompt));
});

test('correct answers are not always in the same position', () => {
  const positions = new Set();
  for (let seed = 1; seed <= 20; seed++) for (const q of buildQuiz(ctxOf(highPh), { count: 8, seed }).questions) positions.add(q.correctIndex);
  assert.ok(positions.size >= 3, [...positions].join());
});

test('no personalized question is asked about a value the student has not entered', () => {
  const { questions, missing, personalCount } = buildQuiz(ctxOf(emptyLand()), { count: 10, level: 'advanced', seed: 3 });
  assert.equal(questions.filter((q) => q.kind === 'benefit' || q.kind === 'limitation').length, 0);
  assert.equal(questions.filter((q) => q.kind === 'calculation' && /fencing/.test(q.topic)).length, 0);
  assert.equal(personalCount, 0);
  assert.deepEqual(missing, ['pH', 'organic matter', 'texture', 'drainage', 'slope']);
  const only = buildQuiz(ctxOf({ ...emptyLand(), soil: { ph: 7.9 } }), { count: 10, seed: 5 });
  assert.ok(only.questions.some((q) => q.personal && q.topic === 'ph'));
  assert.ok(!only.questions.some((q) => q.personal && q.topic === 'texture'));
  assert.deepEqual(only.missing, ['organic matter', 'texture', 'drainage', 'slope']);
});

test('a topic filter keeps the quiz on that topic', () => {
  const { questions } = buildQuiz(ctxOf(highPh), { count: 6, seed: 9, topics: ['drainage', 'slope'] });
  assert.ok(questions.length >= 3);
  assert.ok(questions.every((q) => ['drainage', 'slope'].includes(q.topic)), questions.map((q) => q.topic).join());
});

test('topics the student missed come first', () => {
  const land = squareLand(40, { ph: 7.9, om: 3, texture: 'silt_loam', drainage: 'well', slopePct: 3 });
  for (let seed = 1; seed <= 8; seed++) {
    const { questions } = buildQuiz(ctxOf(land), { count: 4, seed, weakTopics: { slope: 3 } });
    assert.ok(questions.some((q) => q.topic === 'slope'), `seed ${seed}: ${questions.map((q) => q.topic).join()}`);
  }
});

test('calculation answers match the planner functions', () => {
  const land = squareLand(40, { ...IDEAL_SOIL, ph: 7.4 });
  const forage = pastureForageLbPerAc(land.soil, 'east');
  for (let seed = 1; seed <= 6; seed++) {
    const { questions } = buildQuiz(ctxOf(land), { count: 12, seed, topics: ['stocking'], level: 'advanced' });
    const q = questions.find((x) => x.kind === 'calculation');
    assert.ok(q, 'stocking calculation present');
    const right = stockingCapacity('beef', 40, { forageLbPerAcOverride: forage, grazing: 'rotational' }).maxHeads;
    assert.equal(q.options[q.correctIndex], `${right} pairs`);
    assert.match(q.prompt, new RegExp(`${forage.toLocaleString('en-US')} lb`));
  }
  const w = buildQuiz(ctxOf(land), { count: 12, seed: 2, topics: ['water'] }).questions.find((x) => x.kind === 'calculation');
  assert.ok(w);
  const hot = waterNeed('beef', 20, true);
  assert.equal(w.options[w.correctIndex], `${Math.round(hot).toLocaleString('en-US')} gallons a day`);
});

test('the fencing question uses the student\'s own boundary and the same cost function as plans', () => {
  const land = squareLand(40);
  const feet = toFeet(polygonPerimeter(land.boundary));
  const q = buildQuiz(ctxOf(land), { count: 12, seed: 1, topics: ['fencing'] }).questions.find((x) => x.kind === 'calculation');
  assert.ok(q);
  assert.match(q.prompt, new RegExp(Math.round(feet).toLocaleString('en-US')));
  const right = Math.round((feet * fenceCostPerFt('barbed5', {})) / 10) * 10;
  assert.equal(q.options[q.correctIndex], `$${right.toLocaleString('en-US')}`);
  const q2 = buildQuiz(ctxOf(land, { overrides: { fence: { barbed5: { costPerFt: 3 } } } }), { count: 12, seed: 1, topics: ['fencing'] }).questions.find((x) => x.kind === 'calculation');
  assert.notEqual(q2.options[q2.correctIndex], q.options[q.correctIndex]);
  const none = buildQuiz(ctxOf(emptyLand()), { count: 12, seed: 1, topics: ['fencing'] }).questions;
  assert.ok(none.every((x) => x.kind !== 'calculation'));
});

test('the crop yield question uses cropEstimate', () => {
  const land = squareLand(40, { ...IDEAL_SOIL, ph: 6.9 });
  const q = buildQuiz(ctxOf(land), { count: 12, seed: 4, topics: ['crops'] }).questions.find((x) => x.kind === 'calculation');
  assert.ok(q);
  const m = q.prompt.match(/factor for ([a-z ]+) is (\d\.\d+)\./);
  assert.ok(m, q.prompt);
  const id = { 'winter wheat': 'wheat', corn: 'corn', soybeans: 'soybeans', 'grain sorghum': 'sorghum' }[m[1]] || m[1];
  const estimate = cropEstimate(id, 1, land.soil, { region: 'east', overrides: {} });
  assert.equal(Number(m[2]), Number(estimate.multiplier.toFixed(2)));
  assert.match(q.options[q.correctIndex], new RegExp(`^${(Math.round(estimate.yield.base.perAcre * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1 })}`));
});

test('lime question: needs lime exactly when the pH is below the K-State trigger', () => {
  for (const [ph, region] of [[5.4, 'east'], [6.2, 'east'], [7.0, 'east'], [5.6, 'west'], [6.1, 'west']]) {
    const land = squareLand(40, { ...IDEAL_SOIL, ph }, { region });
    for (let seed = 1; seed <= 10; seed++) {
      const q = buildQuiz(ctxOf(land), { count: 12, seed, topics: ['ph'] }).questions.find((x) => x.kind === 'calculation');
      if (!q) continue;
      const trigger = Number(q.prompt.match(/pH ([\d.]+)\. Your/)[1]);
      const needs = ph < trigger;
      assert.match(q.options[q.correctIndex], needs ? /buffer-pH test/ : /Skip lime/, `${ph} ${region} trigger ${trigger}`);
    }
  }
});

test('stocking and economics lessons use plan numbers when a plan exists', () => {
  const land = squareLand(80);
  const plan = { ...emptyPlan('t'), allocations: [{ id: 'a1', kind: 'livestock', item: 'beef', heads: 10, acres: 40, grazing: 'rotational' }] };
  const evaluation = evaluatePlan(plan, land, {}, DEFAULT_ASSUMPTIONS);
  const stock = lessonFor('stocking', ctxOf(land, { evaluation }));
  assert.ok(stock.facts.some((f) => /your plan/.test(f.value)));
  assert.match(stock.sections.map((s) => s.body).join(' '), /pairs/);
  const money = lessonFor('economics', ctxOf(land, { evaluation }));
  assert.ok(money.facts[0].known);
  const water = lessonFor('water', ctxOf(land, { evaluation }));
  assert.match(water.sections.map((s) => s.body).join(' '), /gallons a day/);
});

test('fencing lesson prices every fence once and uses the boundary', () => {
  const land = squareLand(40);
  const lesson = lessonFor('fencing', ctxOf(land));
  const prices = lesson.sections.find((s) => s.heading === 'Installed cost per foot').body;
  assert.ok(!prices.includes('$0.00') && !prices.includes('NaN'), prices);
  assert.match(prices, /\$\d+\.\d\d per foot/);
  assert.ok(lesson.facts[0].known);
});

test('the quiz shape is accepted by the same validator used for AI quizzes (so one UI handles both)', () => {
  const { questions } = buildQuiz(ctxOf(highPh), { count: 10, seed: 11 });
  const checked = validateQuiz({ questions }, { max: 12 });
  assert.equal(checked.questions.length, questions.length);
  for (const q of checked.questions) assert.ok(QUIZ_TOPICS.includes(q.topic));
});

test('the learning topics match the AI quiz topics', () => {
  assert.deepEqual([...TOPICS].sort(), [...QUIZ_TOPICS].sort());
});
