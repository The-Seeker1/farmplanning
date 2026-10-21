import test from 'node:test';
import assert from 'node:assert/strict';
import { sniffImageType, rgbToHsv, classifyPixel, classifyColors, baselineAnalysis, suggestedEdits } from '../src/photo.js';

function solid(w, h, rgb) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255;
  }
  return d;
}
function stack(w, h, rows) {
  const d = new Uint8ClampedArray(w * h * 4);
  let y0 = 0;
  for (const [f, rgb] of rows) {
    const y1 = Math.min(h, y0 + Math.round(f * h));
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      d[k] = rgb[0]; d[k + 1] = rgb[1]; d[k + 2] = rgb[2]; d[k + 3] = 255;
    }
    y0 = y1;
  }
  return d;
}

test('file signatures: only real JPEG, PNG and WebP pass', () => {
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(sniffImageType(webp), 'image/webp');
  assert.equal(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImageType(new TextEncoder().encode('GIF89a......')), null);
  assert.equal(sniffImageType(new Uint8Array([])), null);
});

test('rgbToHsv basics', () => {
  assert.deepEqual(rgbToHsv(255, 0, 0), { h: 0, s: 1, v: 1 });
  const g = rgbToHsv(0, 255, 0);
  assert.equal(g.h, 120);
  const b = rgbToHsv(0, 0, 255);
  assert.equal(b.h, 240);
  assert.equal(rgbToHsv(0, 0, 0).s, 0);
});

test('pixel classes: green grass, dark green trees, brown soil, blue water, gray ground', () => {
  assert.equal(classifyPixel(90, 160, 60), 'grass');
  assert.equal(classifyPixel(25, 70, 30), 'trees');
  assert.equal(classifyPixel(120, 85, 55), 'bare_soil');
  assert.equal(classifyPixel(40, 90, 150), 'water');
  assert.equal(classifyPixel(200, 180, 90), 'grass');
  assert.equal(classifyPixel(130, 130, 130), 'other');
  assert.equal(classifyPixel(130, 130, 130, { kind: 'aerial' }), 'buildings');
  assert.equal(classifyPixel(5, 5, 5), null);
});

test('sky in the top of a ground photo is ignored; the same blue lower down is water', () => {
  assert.equal(classifyPixel(140, 190, 235, { kind: 'ground', yFrac: 0.1 }), null);
  assert.equal(classifyPixel(235, 235, 240, { kind: 'ground', yFrac: 0.2 }), null);
  assert.equal(classifyPixel(40, 90, 150, { kind: 'ground', yFrac: 0.8 }), 'water');
});

test('a pasture photo: sky over green grass reports ~100% grass', () => {
  const w = 120, h = 80;
  const data = stack(w, h, [[0.4, [140, 190, 235]], [0.6, [90, 160, 60]]]);
  const r = classifyColors(data, w, h, { kind: 'ground' });
  assert.equal(r.landCover[0].cls, 'grass');
  assert.ok(r.landCover[0].pct > 99);
});

test('mixed aerial view: percentages follow the pixel areas', () => {
  const w = 100, h = 100;
  const data = stack(w, h, [[0.5, [90, 160, 60]], [0.3, [120, 85, 55]], [0.2, [40, 90, 150]]]);
  const r = classifyColors(data, w, h, { kind: 'aerial', step: 1 });
  const get = (c) => r.landCover.find((x) => x.cls === c)?.pct || 0;
  assert.ok(Math.abs(get('grass') - 50) < 1);
  assert.ok(Math.abs(get('bare_soil') - 30) < 1);
  assert.ok(Math.abs(get('water') - 20) < 1);
});

test('mask limits counting to pixels inside the field', () => {
  const w = 100, h = 100;
  const data = stack(w, h, [[0.5, [90, 160, 60]], [0.5, [120, 85, 55]]]);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < 50; y++) for (let x = 0; x < w; x++) mask[y * w + x] = 1;
  const r = classifyColors(data, w, h, { kind: 'aerial', mask, step: 1 });
  assert.equal(r.landCover.length, 1);
  assert.equal(r.landCover[0].cls, 'grass');
});

test('transparent pixels are skipped and an all-sky photo gives a helpful message instead of numbers', () => {
  const w = 60, h = 60;
  const sky = solid(w, h, [140, 190, 235]);
  const a = baselineAnalysis(sky, w, h, { kind: 'ground' });
  assert.deepEqual(a.landCover, []);
  assert.match(a.observations[0], /Too little/);
  assert.equal(a.confidence, 'low');
  const clear = new Uint8ClampedArray(w * h * 4);
  assert.equal(classifyColors(clear, w, h).classifiedPixels, 0);
});

test('baseline never claims to know slope, drainage or weeds', () => {
  const a = baselineAnalysis(solid(100, 100, [90, 160, 60]), 100, 100, { kind: 'aerial', step: 1 });
  assert.equal(a.slope, 'unknown');
  assert.equal(a.drainage, 'unknown');
  assert.deepEqual(a.weeds, []);
  assert.equal(a.vegetationCondition, 'unknown');
  assert.match(a.observations[0], /colors only/);
});

test('suggested edits only appear when they would change something, and need an explicit apply', () => {
  const land = { soil: { slopePct: 2, drainage: 'well' } };
  const edits = suggestedEdits({ slope: 'steep', drainage: 'poor', standingWater: true }, land);
  assert.deepEqual(edits.map((e) => e.id), ['slope', 'drainage', 'wet']);
  const draft = { land: { soil: { slopePct: 2, drainage: 'well' } } };
  edits[0].apply(draft);
  assert.equal(draft.land.soil.slopePct, 15);
  assert.equal(land.soil.slopePct, 2);
  assert.deepEqual(suggestedEdits({ slope: 'unknown', drainage: 'unknown' }, land), []);
  assert.deepEqual(suggestedEdits({ slope: 'gentle', drainage: 'well' }, { soil: { slopePct: 3, drainage: 'well' } }), []);
});
