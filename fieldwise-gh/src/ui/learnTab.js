import { h, clear, num } from './dom.js';
import { app } from '../state.js';
import { toast, callout, field, selectInput } from './common.js';
import { TOPICS, TOPIC_LABEL, lessonFor, buildQuiz, factorCards } from '../learn.js';
import { buildAIContext, generateLessonAI, generateQuizAI } from '../ai/tasks.js';
import { seededRng } from '../geo.js';

const KIND_LABEL = { benefit: 'Benefit', limitation: 'Limitation', calculation: 'Calculation', concept: 'Concept' };
const LETTERS = ['A', 'B', 'C', 'D'];
const lower = (label) => (label === 'Soil pH' ? 'soil pH' : String(label).toLowerCase());
const COUNTS = [5, 8, 10];

let stateFor = null;
let view = 'lessons';
let topic = 'ph';
let setup = { count: 8, level: 'advanced', topic: '', source: 'template', focusWeak: true };
let session = null;
let busy = '';
let aiError = '';
let aiLesson = null;
let lessonSource = 'template';
let active = null;

function resetFor(profileId) {
  stateFor = profileId;
  session = null;
  busy = '';
  aiError = '';
  aiLesson = null;
  lessonSource = 'template';
}

function shuffleOptions(questions, seed) {
  const random = seededRng(Number(seed) % 2147483647 || 1);
  return questions.map((q) => {
    const order = q.options.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return { ...q, options: order.map((i) => q.options[i]), correctIndex: order.indexOf(q.correctIndex) };
  });
}

export default function createLearnTab({ go }) {
  const element = h('div');
  let pendingFocus = null;
  const instance = {
    el: element,
    render() {
      render();
    },
    destroy() {
      if (active === instance) active = null;
    },
  };
  active = instance;

  const context = () => {
    const plan = app.plan;
    return { land: app.land, evaluation: plan ? app.evaluate(plan) : null, overrides: app.profile.overrides || {}, assumptions: app.assumptions };
  };
  const learning = () => app.profile.learning || { weakTopics: {}, quizHistory: [] };
  const weakList = () => Object.entries(learning().weakTopics || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const redraw = () => active?.render();

  function recordAnswer(t, right) {
    app.update((d) => {
      d.learning = d.learning || { weakTopics: {}, quizHistory: [] };
      const w = { ...(d.learning.weakTopics || {}) };
      const current = w[t] || 0;
      const next = right ? Math.max(0, current - 1) : Math.min(999, current + 1);
      if (next === 0) delete w[t];
      else w[t] = next;
      d.learning.weakTopics = w;
    }, { quiet: true });
  }

  function recordResult(s) {
    if (s.recorded) return;
    s.recorded = true;
    const score = s.questions.filter((q, i) => s.answers[i] === q.correctIndex).length;
    app.update((d) => {
      d.learning = d.learning || { weakTopics: {}, quizHistory: [] };
      d.learning.quizHistory = [...(d.learning.quizHistory || []), { ts: Date.now(), score, total: s.questions.length, source: s.source }].slice(-50);
    }, { quiet: true });
  }

  async function startQuiz(over = {}) {
    const options = { ...setup, ...over };
    const topics = over.topics || (options.topic ? [options.topic] : null);
    const c = context();
    const useAI = options.source === 'ai' && app.ai();
    aiError = '';
    if (useAI) {
      busy = 'Asking the AI to write a quiz for your land. This can take 10 to 20 seconds...';
      session = null;
      view = 'quiz';
      redraw();
      try {
        const aiCtx = buildAIContext(app.profile, c.evaluation, options.focusWeak ? learning() : null);
        const { questions } = await generateQuizAI(app.ai(), aiCtx, { count: options.count, topics, difficulty: options.level });
        if (questions.length < 3) throw new Error('The AI sent back too few usable questions.');
        const seed = Date.now();
        const checked = shuffleOptions(questions, seed).map((q) => ({ ...q, personal: q.kind !== 'concept' }));
        session = { questions: checked, i: 0, answers: [], source: 'ai', recorded: false, finished: false, opts: { ...options, topics } };
        pendingFocus = '[data-key="q-heading"]';
      } catch (e) {
        aiError = e.message || 'The AI could not write a quiz.';
      }
      busy = '';
      redraw();
      return;
    }
    const weak = options.focusWeak ? learning().weakTopics || {} : {};
    const { questions } = buildQuiz(c, { count: options.count, level: options.level, topics, weakTopics: weak, seed: Date.now() });
    if (!questions.length) {
      toast('There are no questions for that mix. Try "All topics" or the basic level.', 'bad');
      return;
    }
    session = { questions, i: 0, answers: [], source: 'template', recorded: false, finished: false, opts: { ...options, topics } };
    view = 'quiz';
    pendingFocus = '[data-key="q-heading"]';
    redraw();
  }

  function answer(index) {
    const s = session;
    if (!s || s.finished || s.answers[s.i] !== undefined) return;
    const q = s.questions[s.i];
    s.answers[s.i] = index;
    recordAnswer(q.topic, index === q.correctIndex);
    pendingFocus = '[data-key="next"]';
    redraw();
  }

  function next() {
    const s = session;
    if (!s || s.answers[s.i] === undefined) return;
    if (s.i + 1 >= s.questions.length) {
      s.finished = true;
      recordResult(s);
      pendingFocus = '[data-key="results-heading"]';
    } else {
      s.i += 1;
      pendingFocus = '[data-key="q-heading"]';
    }
    redraw();
  }

  async function writeLessonWithAI(t) {
    const ai = app.ai();
    if (!ai) return toast('Add a Gemini key in Settings first.', 'bad');
    busy = 'Asking the AI to write this lesson for your land...';
    aiError = '';
    redraw();
    try {
      const c = context();
      const aiCtx = buildAIContext(app.profile, c.evaluation, learning());
      const data = await generateLessonAI(ai, aiCtx, t);
      if (!data.sections.length) throw new Error('The AI sent back an empty lesson.');
      aiLesson = { key: JSON.stringify(buildAIContext(app.profile, c.evaluation, null)), topic: t, data };
      lessonSource = 'ai';
    } catch (e) {
      aiError = e.message || 'The AI could not write the lesson.';
    }
    busy = '';
    redraw();
  }

  function glance() {
    const land = app.land;
    const cards = factorCards(land);
    const card = h('div', { class: 'card' });
    card.append(h('h3', {}, 'Your field at a glance'));
    if (!cards.length) {
      card.append(h('p', { class: 'small' }, 'You have not entered any soil facts yet. Use "Get soil data for my land" on the Land tab, or type in numbers from a soil test (like pH). Then every lesson and quiz question will be about YOUR field.'),
        h('button', { onclick: () => go('land') }, 'Go to Land'));
      return card;
    }
    card.append(h('p', { class: 'small' }, 'Each value on your land brings a benefit and a limit. The quiz asks about these.'));
    card.append(h('div', { class: 'grid two' }, cards.map((c) => h('div', { class: 'factor-card' },
      h('div', { class: 'row tight' }, h('strong', {}, `${c.noun.replace(/^./, (x) => x.toUpperCase())}: ${c.value}`), h('span', { class: 'badge rule' }, c.bandLabel)),
      h('p', { class: 'small mt-s' }, h('strong', {}, 'Benefit: '), c.benefit),
      h('p', { class: 'small' }, h('strong', {}, 'Watch out: '), c.limit)))));
    const soil = land.soil || {};
    const missing = [];
    if (!Number.isFinite(soil.ph)) missing.push('pH');
    if (!Number.isFinite(soil.om)) missing.push('organic matter');
    if (!soil.texture) missing.push('texture');
    if (!soil.drainage) missing.push('drainage');
    if (!Number.isFinite(soil.slopePct)) missing.push('slope');
    if (missing.length) card.append(h('p', { class: 'small muted' }, `Not entered yet: ${missing.join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} on the Land tab for more questions about your field.`));
    return card;
  }

  function viewSwitch() {
    return h('div', { class: 'row tight mt', role: 'group', 'aria-label': 'Learn sections' },
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(view === 'lessons'), 'data-key': 'view-lessons', onclick: () => { view = 'lessons'; redraw(); } }, 'Lessons'),
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(view === 'quiz'), 'data-key': 'view-quiz', onclick: () => { view = 'quiz'; redraw(); } }, 'Quiz'));
  }

  function lessonsView() {
    const wrap = h('div', { class: 'mt' });
    const weak = new Set(weakList().map(([t]) => t));
    wrap.append(h('div', { class: 'row tight', role: 'group', 'aria-label': 'Lesson topics' }, TOPICS.map((t) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(t === topic), 'data-key': `topic-${t}`,
      title: weak.has(t) ? 'You missed questions on this topic' : '',
      onclick: () => { topic = t; lessonSource = 'template'; aiError = ''; redraw(); },
    }, TOPIC_LABEL[t], weak.has(t) ? ' •' : ''))));
    if (weak.size) wrap.append(h('p', { class: 'small muted' }, '• = you missed questions on this topic.'));

    const c = context();
    const base = lessonFor(topic, c);
    const aiReady = aiLesson && aiLesson.topic === topic && aiLesson.key === JSON.stringify(buildAIContext(app.profile, c.evaluation, null));
    const showAI = lessonSource === 'ai' && aiReady;
    const data = showAI ? aiLesson.data : base;

    const card = h('div', { class: 'card mt' });
    card.append(h('h3', {}, data.title || base.title));
    if (showAI) card.append(callout('warn', h('strong', {}, 'AI generated. '), 'This lesson was written by the AI from your land numbers. It can be wrong, so check it against the numbers on your other tabs and with your county extension agent.'));

    card.append(h('h4', {}, 'Your numbers'));
    card.append(h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, base.facts.map((f) => h('tr', {}, h('td', {}, f.label), h('td', { class: f.known ? '' : 'muted' }, f.value)))))));
    if (base.missing.length) card.append(h('p', { class: 'small' }, 'Some of your numbers are missing, so this lesson is more general. ', h('button', { class: 'secondary small', onclick: () => go(base.missing.includes('boundary') ? 'map' : 'land') }, base.missing.includes('boundary') ? 'Draw your land' : 'Enter them on the Land tab')));

    for (const s of data.sections) card.append(h('h4', { class: 'mt' }, s.heading), h('p', {}, s.body));
    if (data.takeaways?.length) card.append(h('h4', { class: 'mt' }, 'Remember'), h('ul', {}, data.takeaways.map((t) => h('li', {}, t))));

    const actions = h('div', { class: 'row mt' });
    actions.append(h('button', { 'data-key': 'quiz-topic', onclick: () => startQuiz({ topics: [topic], count: 5, topic }) }, `Quiz me on ${lower(TOPIC_LABEL[topic])}`));
    if (app.hasKey()) {
      if (aiReady) actions.append(h('button', { class: 'secondary', type: 'button', onclick: () => { lessonSource = showAI ? 'template' : 'ai'; redraw(); } }, showAI ? 'Show the built-in lesson' : 'Show the AI lesson'));
      else actions.append(h('button', { class: 'secondary', disabled: !!busy, onclick: () => writeLessonWithAI(topic) }, busy ? 'Working...' : 'Write this lesson with AI'));
    } else {
      actions.append(h('button', { class: 'secondary', onclick: () => go('settings') }, 'Add an AI key for lessons written for your land'));
    }
    card.append(actions);
    if (busy) card.append(h('p', { class: 'small', role: 'status' }, busy));
    if (aiError) card.append(callout('bad', aiError));
    wrap.append(card);
    return wrap;
  }

  function quizSetup() {
    const wrap = h('div', { class: 'mt' });
    const hasKey = app.hasKey();
    if (setup.source === 'ai' && !hasKey) setup.source = 'template';
    const card = h('div', { class: 'card' });
    card.append(h('h3', {}, 'Quiz about your own field'),
      h('p', { class: 'small' }, 'The advanced quiz asks what your own numbers are GOOD for and what they LIMIT, and has you do the math with your land. For example, if your pH is high, you will be asked about the benefits and the problems of a high pH.'));
    const { missing, personalCount } = buildQuiz(context(), { count: 10, level: 'advanced', seed: 1 });
    if (missing.length >= 5) card.append(callout('warn', 'You have not entered soil facts yet, so questions will be general. Enter them on the Land tab for questions about YOUR field.'));
    else if (missing.length) card.append(callout('', `Missing: ${missing.join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} on the Land tab for more questions about your field.`));
    else if (personalCount) card.append(callout('good', 'All your soil facts are filled in, so the questions can use your own numbers.'));

    const weak = weakList();
    card.append(h('div', { class: 'fields mt' },
      field('Questions', selectInput({ value: String(setup.count), key: 'qs-count', options: COUNTS.map((n) => ({ value: String(n), label: String(n) })), onChange: (v) => { setup.count = Number(v) || 8; } })),
      field('Level', selectInput({ value: setup.level, key: 'qs-level', options: [{ value: 'advanced', label: 'Advanced: my land, benefits, limits, math' }, { value: 'basic', label: 'Basic: simple ideas' }], onChange: (v) => { setup.level = v === 'basic' ? 'basic' : 'advanced'; } })),
      field('Topic', selectInput({ value: setup.topic, key: 'qs-topic', options: [{ value: '', label: 'All topics' }, ...TOPICS.map((t) => ({ value: t, label: TOPIC_LABEL[t] }))], onChange: (v) => { setup.topic = v || ''; } })),
      field('Who writes the questions?', selectInput({ value: setup.source, key: 'qs-source', options: [{ value: 'template', label: 'Built-in (works offline)' }, ...(hasKey ? [{ value: 'ai', label: 'AI, written for my land' }] : [])], onChange: (v) => { setup.source = v === 'ai' ? 'ai' : 'template'; } }))));
    if (!hasKey) card.append(h('p', { class: 'small muted' }, 'With a Gemini key (Settings) the AI can write new questions each time about the benefits and limits of your exact numbers, and it learns which topics you missed.'));
    if (weak.length) card.append(h('label', { class: 'check mt' }, h('input', { type: 'checkbox', checked: setup.focusWeak, 'data-key': 'qs-weak', onchange: (e) => { setup.focusWeak = e.target.checked; } }), `Start with topics I missed (${weak.slice(0, 3).map(([t]) => TOPIC_LABEL[t]).join(', ')})`));
    card.append(h('div', { class: 'row mt' }, h('button', { 'data-key': 'start-quiz', disabled: !!busy, onclick: () => startQuiz() }, busy ? 'Working...' : 'Start quiz')));
    if (busy) card.append(h('p', { class: 'small', role: 'status' }, busy));
    if (aiError) card.append(callout('bad', h('div', {}, aiError), h('div', { class: 'row mt' }, h('button', { class: 'secondary small', onclick: () => startQuiz({ source: 'template' }) }, 'Use the built-in quiz instead'))));
    wrap.append(card);

    const recent = (learning().quizHistory || []).slice(-5).reverse();
    if (recent.length || weak.length) {
      const progressCard = h('div', { class: 'card' }, h('h3', {}, 'Your progress'));
      if (recent.length) progressCard.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['When', 'Score', 'Written by'].map((t) => h('th', {}, t)))),
        h('tbody', {}, recent.map((r) => h('tr', {}, h('td', {}, new Date(r.ts).toLocaleDateString()), h('td', {}, `${r.score} of ${r.total}`), h('td', {}, r.source === 'ai' ? 'AI' : 'Built-in')))))));
      if (weak.length) {
        progressCard.append(h('p', { class: 'small mt' }, h('strong', {}, 'Topics to practice: '), weak.map(([t, n]) => `${TOPIC_LABEL[t]} (${n})`).join(', ')),
          h('button', { class: 'secondary small', onclick: () => { app.update((d) => { d.learning.weakTopics = {}; }, { quiet: true }); redraw(); } }, 'Clear this list'));
      }
      wrap.append(progressCard);
    }
    return wrap;
  }

  function questionView() {
    const s = session;
    const q = s.questions[s.i];
    const done = s.answers[s.i] !== undefined;
    const picked = s.answers[s.i];
    const right = picked === q.correctIndex;
    const wrap = h('div', { class: 'mt' });
    const card = h('div', { class: 'card quiz-q' });
    card.append(h('div', { class: 'row tight' },
      h('span', { class: 'small', role: 'status' }, `Question ${s.i + 1} of ${s.questions.length}`),
      h('span', { class: 'badge' }, TOPIC_LABEL[q.topic] || q.topic),
      h('span', { class: `badge ${q.personal ? 'derived' : 'rule'}` }, q.personal ? 'About your land' : KIND_LABEL[q.kind] || 'Concept'),
      q.personal && q.kind !== 'concept' ? h('span', { class: 'badge' }, KIND_LABEL[q.kind]) : null,
      s.source === 'ai' ? h('span', { class: 'badge starter' }, 'AI written') : null));
    card.append(h('progress', { max: s.questions.length, value: s.i + (done ? 1 : 0), 'aria-label': 'Quiz progress' }));
    card.append(h('h3', { class: 'mt', tabindex: '-1', 'data-key': 'q-heading' }, q.prompt));
    const options = h('div', { role: 'group', 'aria-label': 'Answer choices' });
    q.options.forEach((text, i) => {
      const isRight = done && i === q.correctIndex;
      const isWrong = done && i === picked && !right;
      options.append(h('button', {
        class: `quiz-opt${isRight ? ' right' : ''}${isWrong ? ' wrong' : ''}`, type: 'button', disabled: done, 'data-key': `opt-${i}`,
        onclick: () => answer(i),
      }, h('strong', {}, `${LETTERS[i]}. `), text, isRight ? h('strong', { class: 'small' }, '  ✓ correct answer') : null, isWrong ? h('strong', { class: 'small' }, '  ✗ your answer') : null));
    });
    card.append(options);
    if (done) {
      card.append(callout(right ? 'good' : 'bad', h('strong', {}, right ? 'Correct. ' : `Not quite. The answer is ${LETTERS[q.correctIndex]}. `), q.explanation));
      if (s.source === 'ai') card.append(h('p', { class: 'small muted' }, 'AI-written question. If an answer looks odd, check it against the lesson or ask your county extension agent.'));
      card.append(h('div', { class: 'row' }, h('button', { 'data-key': 'next', onclick: next }, s.i + 1 >= s.questions.length ? 'See my results' : 'Next question'), h('button', { class: 'secondary', onclick: () => { topic = q.topic; lessonSource = 'template'; view = 'lessons'; redraw(); } }, `Read the ${lower(TOPIC_LABEL[q.topic] || 'lesson')} lesson`)));
    }
    wrap.append(card, h('div', { class: 'row mt' }, h('button', { class: 'secondary small', onclick: () => { session = null; redraw(); } }, 'Stop this quiz')));
    return wrap;
  }

  function resultsView() {
    const s = session;
    const total = s.questions.length;
    const score = s.questions.filter((q, i) => s.answers[i] === q.correctIndex).length;
    const percent = Math.round((score / total) * 100);
    const byTopic = {};
    s.questions.forEach((q, i) => {
      const t = (byTopic[q.topic] = byTopic[q.topic] || { asked: 0, right: 0 });
      t.asked += 1;
      if (s.answers[i] === q.correctIndex) t.right += 1;
    });
    const missed = s.questions.map((q, i) => ({ q, i })).filter(({ q, i }) => s.answers[i] !== q.correctIndex);
    const wrap = h('div', { class: 'mt' });
    const card = h('div', { class: 'card' });
    card.append(h('h3', { tabindex: '-1', 'data-key': 'results-heading' }, `You got ${score} of ${total} (${num(percent)}%)`),
      h('p', {}, percent === 100 ? 'A perfect score. Try the advanced level or a different topic.' : percent >= 70 ? 'Solid. Read the explanations for the ones you missed below.' : 'This is a hard subject. The lessons use your own numbers, and every wrong answer is explained below.'));
    card.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, [h('th', {}, 'Topic'), h('th', { class: 'num' }, 'Right'), h('th', { class: 'num' }, 'Asked')])),
      h('tbody', {}, Object.entries(byTopic).map(([t, v]) => h('tr', {}, h('td', {}, TOPIC_LABEL[t] || t), h('td', { class: 'num' }, v.right), h('td', { class: 'num' }, v.asked)))))));
    if (missed.length) {
      card.append(h('h4', { class: 'mt' }, 'Review what you missed'));
      for (const { q, i } of missed) {
        card.append(h('div', { class: 'review' },
          h('p', {}, h('strong', {}, q.prompt)),
          h('p', { class: 'small' }, h('strong', {}, 'You chose: '), q.options[s.answers[i]] ?? '(no answer)'),
          h('p', { class: 'small' }, h('strong', {}, 'Correct answer: '), q.options[q.correctIndex]),
          h('p', { class: 'small' }, q.explanation)));
      }
    }
    const again = { ...s.opts };
    card.append(h('div', { class: 'row mt' },
      h('button', { 'data-key': 'again', onclick: () => startQuiz(again) }, 'New quiz, same settings'),
      missed.length ? h('button', { class: 'secondary', onclick: () => startQuiz({ ...again, topics: [...new Set(missed.map(({ q }) => q.topic))], count: Math.max(5, Math.min(10, missed.length + 2)) }) }, 'Practice what I missed') : null,
      h('button', { class: 'secondary', onclick: () => { topic = missed[0]?.q.topic || topic; lessonSource = 'template'; session = null; view = 'lessons'; redraw(); } }, 'Back to the lessons'),
      h('button', { class: 'secondary', onclick: () => { session = null; redraw(); } }, 'Quiz settings')));
    wrap.append(card);
    return wrap;
  }

  function quizView() {
    if (busy && !session) return h('div', { class: 'mt' }, h('div', { class: 'card' }, h('p', { role: 'status' }, busy)));
    if (!session) return quizSetup();
    return session.finished ? resultsView() : questionView();
  }

  function render() {
    if (stateFor !== app.profile.id) resetFor(app.profile.id);
    clear(element);
    element.append(h('h2', {}, 'Learn'),
      h('p', { class: 'small' }, 'Lessons and quizzes built from YOUR land: your soil pH, texture, drainage, slope and plan. Change a number on the Land tab and the lessons and questions change with it.'));
    element.append(glance(), viewSwitch(), view === 'lessons' ? lessonsView() : quizView());
    if (pendingFocus) {
      const focusTarget = pendingFocus;
      pendingFocus = null;
      const target = element.querySelector(focusTarget);
      if (target) target.focus({ preventScroll: false });
    }
  }

  return instance;
}
