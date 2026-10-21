import fs from 'node:fs';
import path from 'node:path';
import { serve, launch } from './lib.mjs';

const SHOTS = process.env.SHOTS || path.resolve('smoke-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

const { server, url } = await serve();
const TEST_KEY = 'fake-test-key-not-real-1234567890';
const geminiCalls = [];
const aiPrompts = [];
const geminiMock = (route, request, u, json) => {
  geminiCalls.push({ method: request.method(), url: request.url(), key: request.headers()['x-goog-api-key'] });
  if (request.method() === 'GET') return json({ models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }] });
  const body = JSON.parse(request.postData() || '{}');
  const prompt = body.contents?.[0]?.parts?.[0]?.text || '';
  aiPrompts.push(prompt);
  let out = {};
  if (/Review this farm plan/.test(prompt)) out = { summary: 'Mock review: the herd is sized sensibly for this soil.', suggestions: [{ title: 'Add a backup water tank', detail: 'Ponds can dry up in August.' }], cautions: ['Check lime needs with a soil test.'] };
  else if (/Write a short lesson/.test(prompt)) out = { title: 'Mock lesson', sections: [{ heading: 'What your number means', body: 'Mock body.' }], takeaways: ['Mock takeaway'] };
  else if (/multiple-choice questions/.test(prompt)) out = { questions: [0, 1, 2].map((i) => ({ prompt: `Mock question ${i + 1}?`, options: ['A', 'B', 'C', 'D'], correctIndex: i, explanation: 'Because mock.', topic: 'ph', kind: i === 0 ? 'benefit' : 'limitation', difficulty: 'advanced' })) };
  return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] });
};
const b = await launch({ mocks: { gemini: geminiMock } });
const { page } = b;
try {
  await page.goto(url);
  await page.waitForSelector('.modal', { timeout: 10000 });
  check('welcome dialog shows on first run', true);
  await page.screenshot({ path: path.join(SHOTS, '01-welcome.png') });
  await page.click('text=Get started');
  check('tabs rendered', (await page.locator('.tabs button').count()) === 7);
  await page.screenshot({ path: path.join(SHOTS, '02-land-empty.png'), fullPage: true });

  await page.fill('[data-key=addr]', '900 SW Jackson St, Topeka, KS');
  await page.click('text=Find address');
  await page.waitForSelector('text=Found: Topeka');
  check('address lookup works through the CSP', true);

  await page.fill('[data-key=rect-l]', '1320');
  await page.fill('[data-key=rect-w]', '660');
  await page.click('text=Create rectangle');
  await page.waitForSelector('text=20.0 acres');
  check('1320 x 660 ft rectangle reports 20.0 acres', true);

  await page.click('text=Get soil data for my land');
  await page.waitForSelector('text=Kennebec');
  const ph = await page.inputValue('[data-key=ph]');
  check('SSURGO soil fills pH (6.5)', ph === '6.5', `pH=${ph}`);
  check('texture is silt loam', (await page.inputValue('[data-key=texture]')) === 'silt_loam');
  await page.screenshot({ path: path.join(SHOTS, '03-land-filled.png'), fullPage: true });

  const grass = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = '#87b9e8'; g.fillRect(0, 0, 400, 120);
    g.fillStyle = '#5b9a3a'; g.fillRect(0, 120, 400, 180);
    return c.toDataURL('image/png');
  });
  await page.setInputFiles('input[type=file][aria-label="Choose a photo"]', { name: 'pasture.png', mimeType: 'image/png', buffer: Buffer.from(grass.split(',')[1], 'base64') });
  await page.waitForSelector('text=What was found', { timeout: 20000 });
  check('ground photo is read by the offline color reader', (await page.locator('.badge:has-text("Color reader")').count()) >= 1);
  const bar0 = await page.locator('.cover-bar').first().getAttribute('aria-label');
  check('color reader finds mostly grass and ignores the sky', /Grass[^,]* (\d+(?:\.\d+)?)%/.test(bar0) && Number(bar0.match(/Grass[^,]* (\d+(?:\.\d+)?)%/)[1]) > 80, bar0);
  await page.setInputFiles('input[type=file][aria-label="Choose a photo"]', { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image at all') });
  await page.waitForSelector('.toast.bad:has-text("Only JPEG, PNG or WebP")');
  check('a file that is not really an image is refused', true);

  await page.click('.tabs button:has-text("Map")');
  await page.waitForSelector('#map .leaflet-container, #map.leaflet-container');
  const box = await page.locator('#map').boundingBox();
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  check('map tab shows existing 20-acre boundary tooltip', (await page.locator('.leaflet-tooltip').filter({ hasText: '20.0 ac' }).count()) >= 1);
  await page.click('button:has-text("Redraw boundary")');
  for (const [dx, dy] of [[-150, -100], [150, -100], [150, 100], [-150, 100]]) await page.mouse.click(centerX + dx, centerY + dy);
  await page.mouse.dblclick(centerX - 150, centerY + 100);
  await page.waitForSelector('text=Boundary set');
  const status1 = await page.locator('[role=status]').first().innerText();
  check('hand-drawn boundary is measured', /Boundary set: [\d.]+ acres/.test(status1), status1);
  await page.selectOption('[data-key=zone-use]', 'pasture');
  await page.click('button:has-text("Draw pasture")');
  for (const [dx, dy] of [[-120, -80], [0, -80], [0, 80], [-120, 80]]) await page.mouse.click(centerX + dx, centerY + dy);
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Pasture added');
  check('zone drawn and measured', true);
  await page.click('button:has-text("Draw fence line")');
  for (const [dx, dy] of [[-150, -100], [150, -100], [150, 100]]) await page.mouse.click(centerX + dx, centerY + dy);
  await page.click('button:has-text("Finish")');
  await page.waitForSelector('text=Fence added');
  check('fence drawn with length and cost', true);
  await page.click('button.chip:has-text("Cattle")');
  for (const [dx, dy] of [[-80, -30], [-60, 10], [-40, 40]]) await page.mouse.click(centerX + dx, centerY + dy);
  await page.click('button.chip:has-text("Chickens")');
  await page.mouse.click(centerX + 90, centerY);
  const nIcons = await page.locator('.animal-icon').count();
  check('4 tapped animals appear on the map', nIcons === 4, `icons=${nIcons}`);
  await page.screenshot({ path: path.join(SHOTS, '04-map-drawn.png') });
  await page.click('button:has-text("Undo")');
  check('undo removes the last placement', (await page.locator('.animal-icon').count()) === 3);
  await page.click('button:has-text("Select / reshape")');
  await page.mouse.click(centerX - 105, centerY + 60);
  await page.waitForSelector('.vertex-handle');
  check('selected zone shows reshape handles', (await page.locator('.vertex-handle').count()) >= 3);

  await page.click('.tabs button:has-text("Plans")');
  await page.waitForSelector('button:has-text("Suggest plans for my land")');
  await page.click('button:has-text("Suggest plans for my land")');
  await page.waitForSelector('.modal button:has-text("Create plans")');
  await page.click('.modal button:has-text("Create plans")');
  await page.waitForSelector('.kpis');
  const planOpts = await page.locator('[data-key=plan-select] option').count();
  check('suggestions create three plans', planOpts === 3, `plans=${planOpts}`);
  const kpiText = await page.locator('.kpis').innerText();
  check('results show net per year and soil fit', /Net per year/i.test(kpiText) && /Soil fit/i.test(kpiText));
  await page.screenshot({ path: path.join(SHOTS, '04b-plans.png'), fullPage: true });
  check('starter-price warning is shown', (await page.locator('text=starter prices').count()) > 0);
  const headsInput = page.locator('[data-key^=heads-]').first();
  if (await headsInput.count()) {
    await headsInput.fill('999');
    await headsInput.dispatchEvent('change');
    await page.waitForSelector('text=is above the');
    check('too many animals triggers an overstock warning', true);
  }

  await page.click('.tabs button:has-text("Compare")');
  await page.waitForSelector('text=Best fit:');
  check('compare ranks three plans', (await page.locator('table tbody tr').count()) >= 3);
  check('cash chart is drawn', (await page.locator('svg.chart polyline').count()) === 3);
  const bestBefore = await page.locator('.card.tint-green h3').innerText();
  await page.click('button.chip:has-text("Play it safe")');
  await page.waitForSelector('text=Best fit:');
  const bestAfter = await page.locator('.card.tint-green h3').innerText();
  check('weights re-rank without errors', bestAfter.startsWith('Best fit:'), `${bestBefore} -> ${bestAfter}`);
  const netBefore = await page.locator('tr.best td').nth(3).innerText();
  await page.locator('#sc-revenuePct').fill('-30');
  await page.locator('#sc-revenuePct').dispatchEvent('change');
  await page.waitForFunction((n) => document.querySelector('tr.best td:nth-child(4)')?.innerText !== n, netBefore);
  check('price scenario changes the projected net', true);
  await page.screenshot({ path: path.join(SHOTS, '04c-compare.png'), fullPage: true });

  await page.click('.tabs button:has-text("Settings")');
  await page.waitForSelector('[data-key=api-key]');
  await page.click('button:has-text("Save key")');
  check('saving a key without the 18+ confirmation is refused', (await page.locator('.toast.bad').count()) > 0 && !(await page.evaluate(() => Object.keys(sessionStorage).some((k) => k.includes('key')))));
  await page.fill('[data-key=api-key]', TEST_KEY);
  await page.check('[data-key=age-ok]');
  await page.click('button:has-text("Save key")');
  await page.waitForSelector('text=A key is saved');
  check('key is kept in sessionStorage by default, not localStorage', await page.evaluate((k) => Object.values(sessionStorage).includes(k) && !Object.values(localStorage).some((v) => v.includes(k)), TEST_KEY));
  await page.click('button:has-text("Test connection")');
  await page.waitForSelector('text=Connected. 2 models available');
  check('test connection lists only Gemini models that can generate content', true);
  check('key is sent in the header, never in the URL', geminiCalls.length > 0 && geminiCalls.every((c) => c.key === TEST_KEY && !c.url.includes(TEST_KEY)));
  const priceInput = page.locator('[data-key=ov-crops-corn-price]');
  await page.locator('summary:has-text("Crops")').click();
  await priceInput.fill('6.25');
  await priceInput.dispatchEvent('change');
  await page.waitForSelector('text=1 value changed');
  check('price override is counted', true);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export this profile")')]);
  const exported = await (await import('node:fs')).promises.readFile(await download.path(), 'utf8');
  check('export never contains the API key', !exported.includes(TEST_KEY));
  check('export leaves out location by default', !/"lat"|"lon"|Topeka/.test(exported));
  check('export keeps the price override', /6\.25/.test(exported));

  const exportedPath = await download.path();
  const profilesBefore = await page.locator('[data-key=profile-select] option').count();
  await page.setInputFiles('input[type=file][aria-label="Choose a FieldWise profile file"]', exportedPath);
  await page.waitForFunction((n) => document.querySelectorAll('[data-key=profile-select] option').length === n + 1, profilesBefore);
  check('exported profile imports back as a new profile', true);
  const hostile = JSON.stringify({ format: 'fieldwise-profile', version: 1, profile: { id: '../../x', name: '<img src=x onerror="window.__pwned=1">', land: { soil: { ph: 'abc', om: 9999 }, boundary: 'nope' }, plans: 'nope', overrides: { gateCost: -5 } } });
  await page.setInputFiles('input[type=file][aria-label="Choose a FieldWise profile file"]', { name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(hostile) });
  await page.waitForTimeout(800);
  check('a hostile profile never runs script or creates elements', (await page.evaluate(() => !window.__pwned && !document.querySelector('img[src="x"]'))));
  const toasts = await page.locator('.toast').allInnerTexts();
  console.log('      import toasts:', toasts.slice(-2).join(' | '));
  check('the hostile profile name is shown as plain text', toasts.some((t) => t.includes('<img src=x')));
  await page.selectOption('[data-key=profile-select]', { index: 0 });
  await page.waitForTimeout(300);

  await page.screenshot({ path: path.join(SHOTS, '04d-settings.png'), fullPage: true });

  await page.click('.tabs button:has-text("Plans")');
  await page.waitForSelector('button:has-text("Review this plan")');
  await page.click('button:has-text("Review this plan")');
  await page.waitForSelector('text=Mock review', { timeout: 20000 });
  check('AI plan review shows validated answer', true);

  await page.click('.tabs button:has-text("Learn")');
  await page.waitForSelector('text=Your field at a glance');
  const glanceText = await page.locator('.factor-card').first().innerText();
  check('Learn shows the student\'s own pH with a benefit and a limit', /6\.5/.test(glanceText) && /Benefit:/.test(glanceText) && /Watch out:/.test(glanceText), glanceText.slice(0, 80));
  const lessonText = await page.locator('.card', { hasText: 'Your numbers' }).first().innerText();
  check('pH lesson lists the student\'s numbers and a lime check', /6\.5/.test(lessonText) && /lime check/i.test(lessonText));
  await page.screenshot({ path: path.join(SHOTS, '08-learn-lesson.png'), fullPage: true });
  await page.click('[data-key=topic-slope]');
  await page.waitForSelector('h3:has-text("Slope and erosion")');
  check('switching lesson topic works', true);
  await page.click('[data-key=topic-ph]');
  await page.waitForSelector('h3:has-text("Soil pH")');

  await page.click('[data-key=quiz-topic]');
  await page.waitForSelector('text=Question 1 of 5');
  const prompts = [];
  for (let i = 0; i < 5; i++) {
    prompts.push(await page.locator('[data-key=q-heading]').innerText());
    check(`question ${i + 1} has 3-4 answer choices`, [3, 4].includes(await page.locator('.quiz-opt').count()));
    await page.locator('.quiz-opt').first().click();
    await page.waitForSelector('[data-key=next]');
    const fb = await page.locator('.callout').last().innerText();
    if (i === 0) check('answer feedback explains the answer', /Correct\.|Not quite/.test(fb) && fb.length > 25, fb.slice(0, 60));
    if (i === 0) await page.screenshot({ path: path.join(SHOTS, '09-learn-feedback.png'), fullPage: true });
    await page.click('[data-key=next]');
  }
  await page.waitForSelector('[data-key=results-heading]');
  const response = await page.locator('[data-key=results-heading]').innerText();
  check('quiz finishes with a score out of 5', /You got \d of 5/.test(response), response);
  check('quiz asked about the student\'s own pH (6.5)', prompts.some((p) => /soil pH is 6\.5/.test(p)), prompts.join(' | ').slice(0, 160));
  check('quiz asked both a benefit and a limitation of that value', prompts.some((p) => /BENEFIT/.test(p)) && prompts.some((p) => /MOST likely/.test(p)));
  await page.screenshot({ path: path.join(SHOTS, '10-learn-results.png'), fullPage: true });
  await page.waitForTimeout(700);
  const savedLearning = await page.evaluate(() => Object.values(localStorage).find((v) => v.includes('quizHistory')) || '');
  check('quiz result is saved in the profile on this device', /"total":5/.test(savedLearning) && /"source":"template"/.test(savedLearning));
  await page.click('button:has-text("Quiz settings")');
  await page.waitForSelector('text=Quiz about your own field');
  check('quiz settings show past results', (await page.locator('text=Your progress').count()) === 1);

  const aiBefore = aiPrompts.length;
  await page.selectOption('[data-key=qs-source]', 'ai');
  await page.selectOption('[data-key=qs-topic]', 'ph');
  await page.click('[data-key=start-quiz]');
  await page.waitForSelector('.badge:has-text("AI written")', { timeout: 30000 });
  check('AI quiz shows AI-written questions with a label', true);
  for (let i = 0; i < 3; i++) {
    await page.locator('.quiz-opt').first().click();
    await page.waitForSelector('[data-key=next]');
    await page.click('[data-key=next]');
  }
  await page.waitForSelector('[data-key=results-heading]');
  check('AI quiz finishes with a score out of 3', /of 3/.test(await page.locator('[data-key=results-heading]').innerText()));
  const quizPrompt = aiPrompts.slice(aiBefore).find((p) => /multiple-choice questions/.test(p)) || '';
  check('AI quiz request carries the pH and tells the model to cover benefits and limits', /"pH":6\.5/.test(quizPrompt) && /benefit/.test(quizPrompt) && /limitation/.test(quizPrompt));
  check('AI quiz request has no address or coordinates', quizPrompt.length > 0 && !/Topeka|Jackson|latitude|longitude|-9\d\.\d{3}/i.test(quizPrompt));
  await page.click('button:has-text("Back to the lessons")');
  await page.waitForSelector('button:has-text("Write this lesson with AI")');
  await page.click('button:has-text("Write this lesson with AI")');
  await page.waitForSelector('text=Mock lesson', { timeout: 30000 });
  check('AI lesson is labeled as AI generated', (await page.locator('text=AI generated.').count()) >= 1);
  await page.click('button:has-text("Show the built-in lesson")');
  await page.waitForSelector('h3:has-text("Soil pH")');
  check('student can switch back to the built-in lesson', true);
  check('AI requests during Learn never include the address or coordinates', aiPrompts.every((p) => !/Topeka|Jackson|latitude|longitude|-9\d\.\d{3}/i.test(p)));

  await page.click('.tabs button:has-text("3D view")');
  await page.waitForSelector('.view3d canvas', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('[data-ready]'), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const ds = await page.evaluate(() => ({ ...document.querySelector('[data-ready]').dataset }));
  check('3D view started WebGL', ds.ready === 'true', JSON.stringify(ds));
  check('3D view drew animals and fence posts', Number(ds.animals) > 0 && Number(ds.posts) > 0, `animals=${ds.animals} posts=${ds.posts}`);
  check('3D view issued draw calls', Number(ds.drawCalls) > 3, `calls=${ds.drawCalls}`);
  await page.screenshot({ path: path.join(SHOTS, '05-3d-home.png') });
  await page.click('button:has-text("Ground view")');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '06-3d-ground.png') });
  await page.click('button:has-text("Top view")');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '07-3d-top.png') });
  const stored = await page.evaluate(() => Object.keys(localStorage).join(','));
  check('profile saved on the device', stored.length > 0, stored);
} catch (e) {
  check('smoke run threw', false, e.message);
}
console.log('network calls:', b.calls.join(' | '));
check('no console errors or CSP violations', b.problems.length === 0, b.problems.join(' || '));
await b.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
