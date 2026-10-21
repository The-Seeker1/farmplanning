import test from 'node:test';
import assert from 'node:assert/strict';
import {
  textureClass, normalizeDrainage, phFactor, cropSoilFit, pastureSoilFit, pastureForageLbPerAc, limeAdvice, textureGroup,
} from '../src/soilfit.js';
import { IDEAL_SOIL, near } from './helpers.js';

test('USDA texture triangle', () => {
  assert.equal(textureClass(40, 40, 20), 'loam');
  assert.equal(textureClass(10, 70, 20), 'silt_loam');
  assert.equal(textureClass(20, 40, 40), 'silty_clay');
  assert.equal(textureClass(90, 5, 5), 'sand');
  assert.equal(textureClass(30, 30, 40), 'clay');
  assert.equal(textureClass(10, 55, 35), 'silty_clay_loam');
  assert.equal(textureClass(35, 35, 30), 'clay_loam');
  assert.equal(textureClass(60, 20, 20), 'sandy_clay_loam');
  assert.equal(textureClass(65, 25, 10), 'sandy_loam');
  assert.equal(textureClass(80, 12, 8), 'loamy_sand');
  assert.equal(textureClass(5, 90, 5), 'silt');
  assert.equal(textureClass(55, 5, 40), 'sandy_clay');
  assert.equal(textureClass(10, 10, 10), null);
  assert.equal(textureClass('x', 1, 1), null);
});

test('texture groups', () => {
  assert.equal(textureGroup('sand'), 'coarse');
  assert.equal(textureGroup('silt_loam'), 'medium');
  assert.equal(textureGroup('clay'), 'fine');
  assert.equal(textureGroup('mud'), null);
});

test('SSURGO drainage text maps to our classes', () => {
  assert.equal(normalizeDrainage('Well drained'), 'well');
  assert.equal(normalizeDrainage('Moderately well drained'), 'moderate');
  assert.equal(normalizeDrainage('Somewhat poorly drained'), 'somewhat_poor');
  assert.equal(normalizeDrainage('Poorly drained'), 'poor');
  assert.equal(normalizeDrainage('Very poorly drained'), 'very_poor');
  assert.equal(normalizeDrainage('Somewhat excessively drained'), 'excessive');
  assert.equal(normalizeDrainage('Excessively drained'), 'excessive');
  assert.equal(normalizeDrainage(''), null);
  assert.equal(normalizeDrainage('purple'), null);
});

test('phFactor follows the K-State MF-1065 thresholds', () => {
  assert.equal(phFactor(6.5).f, 1);
  assert.equal(phFactor(6.0).f, 1);
  assert.ok(near(phFactor(5.6).f, 0.7, 1e-9));
  assert.ok(near(phFactor(5.2).f, 0.4, 1e-9));
  assert.ok(phFactor(4.7).f < 0.4);
  assert.ok(phFactor(4.7).f >= 0.15);
  assert.equal(phFactor(7.8).f, 1);
  assert.equal(phFactor(7.9).f, 0.85);
  assert.equal(phFactor(8.4).f, 0.65);
  assert.equal(phFactor(9.0).f, 0.3);
  assert.ok(phFactor(6.2, { legume: true }).f < 1);
  assert.equal(phFactor(6.2, { legume: false }).f, 1);
  assert.equal(phFactor(5.7, { region: 'west' }).f, 1);
  assert.ok(phFactor(5.7, { region: 'east' }).f < 1);
  assert.ok(phFactor(8.0, { highTolerant: true }).f > phFactor(8.0).f);
  const u = phFactor(null);
  assert.equal(u.known, false);
  assert.equal(u.f, 0.85);
});

test('ideal soil scores ~100 for corn and wheat', () => {
  assert.ok(cropSoilFit('corn', IDEAL_SOIL).score >= 99);
  assert.ok(cropSoilFit('wheat', IDEAL_SOIL).score >= 99);
  assert.equal(cropSoilFit('corn', IDEAL_SOIL).limiting, null);
});

test('poor drainage wrecks alfalfa but wheat is hurt much less', () => {
  const wet = { ...IDEAL_SOIL, drainage: 'poor' };
  const alf = cropSoilFit('alfalfa', wet);
  const wheat = cropSoilFit('wheat', wet);
  assert.ok(alf.score < 50, `alfalfa ${alf.score}`);
  assert.ok(wheat.score > alf.score);
  assert.equal(alf.limiting, 'drainage');
});

test('high pH: sorghum and alfalfa tolerate it better than corn or soybeans', () => {
  const alk = { ...IDEAL_SOIL, ph: 8.1 };
  assert.ok(cropSoilFit('sorghum', alk).score > cropSoilFit('corn', alk).score);
  assert.ok(cropSoilFit('alfalfa', alk).score > cropSoilFit('soybeans', alk).score);
});

test('steep slope lowers every score', () => {
  const steep = { ...IDEAL_SOIL, slopePct: 12 };
  for (const id of ['corn', 'wheat', 'soybeans', 'sorghum', 'alfalfa', 'hay']) {
    assert.ok(cropSoilFit(id, steep).score < cropSoilFit(id, IDEAL_SOIL).score, id);
  }
});

test('missing soil data lowers confidence, not to zero', () => {
  const r = cropSoilFit('corn', {});
  assert.ok(r.confidence === 0);
  assert.ok(r.score > 40 && r.score < 100);
  assert.match(r.notes.join(' '), /Not entered/);
  const partial = cropSoilFit('corn', { ph: 6.5 });
  assert.ok(partial.confidence > 0 && partial.confidence < 1);
});

test('pasture forage maps soil fit onto 2-5 tons/acre (Hay & Forage Grower range)', () => {
  const best = pastureForageLbPerAc(IDEAL_SOIL);
  assert.ok(best >= 9900 && best <= 10000, `best ${best}`);
  const poor = pastureForageLbPerAc({ ph: 4.8, drainage: 'very_poor', texture: 'sand', slopePct: 30, depthIn: 6 });
  assert.ok(poor >= 4000 && poor < 6500, `poor ${poor}`);
  assert.ok(best > poor);
  assert.ok(pastureSoilFit(IDEAL_SOIL).fit > 0.99);
});

test('lime advice uses legume and region triggers and never invents a rate', () => {
  assert.equal(limeAdvice(5.8, { legume: false, region: 'east' }).needed, true);
  assert.equal(limeAdvice(6.2, { legume: false, region: 'east' }).needed, false);
  assert.equal(limeAdvice(6.2, { legume: true, region: 'east' }).needed, true);
  assert.equal(limeAdvice(6.2, { legume: true, region: 'west' }).needed, false);
  assert.match(limeAdvice(5.0).text, /buffer-pH/);
  assert.equal(limeAdvice(null).needed, null);
});
