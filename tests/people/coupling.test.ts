// Unit tests for fire coupling (Requirements 1.5, 4.1 to 4.4, 4.8).
import { describe, expect, it } from 'vitest';
import { AMBIENT_TEMP_K, EYE_HEIGHT_M, K_VIS, O2_AMBIENT_PCT } from '../../src/core/people/constants';
import { createFireCoupling } from '../../src/core/people/coupling/fireCoupling';
import { extinctionFromOpticalDensity, extinctionFromVisibility, isUpperAtEyeHeight, massToVolume, newReading } from '../../src/core/people/coupling/layers';
import { floorFromAscii } from '../../src/core/people/plan/ascii';
import { buildPlan } from '../../src/core/people/plan/builder';
import { openRoom } from './samplePlans';
import { AMBIENT_LAYER, syntheticFire } from './syntheticFire';
const SMOKE = { o2: 0.2, co2: 0.05, co: 0.002, opticalDensityPerM: 1 };
const coupled = (fire: ReturnType<typeof syntheticFire>) => {
  const r = createFireCoupling(fire, openRoom().plan);
  if (!r.ok) throw new Error('coupling rejected');
  return r;
};
describe('interpolation and hold', () => {
  const fire = syntheticFire({
    durationS: 10,
    compartments: [{ id: 'A', start: { upperTempK: 300, interfaceHeightM: 2.4 }, end: { upperTempK: 500, interfaceHeightM: 1 } }],
  });
  it('reads a sample exactly and a point between samples linearly', () => {
    const { coupling } = coupled(fire);
    const r = newReading();
    coupling.advance(0);
    coupling.read(0, r);
    expect(r.upperActive).toBe(false);
    expect(r.tempK).toBe(AMBIENT_TEMP_K); // the lower layer is read while the interface is above eye height
    // Between samples: the interface is 2.4 - 1.4 * 0.75 = 1.35 m at 7.5 s, so the upper layer is 300 + 200 * 0.75.
    coupling.advance(7.5);
    coupling.read(0, r);
    expect(r.upperActive).toBe(true);
    expect(r.tempK).toBeCloseTo(450, 9);
    coupling.advance(10);
    coupling.read(0, r);
    expect(r.tempK).toBe(500);
  });
  it('holds the last sample after the end and warns exactly once with the end time', () => {
    const { coupling } = coupled(fire);
    const r = newReading();
    for (const t of [10, 10.05, 20, 30]) {
      coupling.advance(t);
      coupling.read(0, r);
      expect(r.tempK).toBe(500);
    }
    const ended = coupling.warnings.filter((w) => w.code === 'FIRE_RESULT_ENDED');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.timeS).toBe(10);
    expect(ended[0]!.message).toContain('10');
  });
  it('does not warn while the time is at or before the last sample', () => {
    const { coupling } = coupled(fire);
    coupling.advance(10);
    expect(coupling.warnings).toHaveLength(0);
  });
  it('holds a single sample for all times', () => {
    const one = syntheticFire({ durationS: 0, compartments: [{ id: 'A', start: { upperTempK: 400, interfaceHeightM: 1 } }] });
    expect(one.timesS.length).toBe(1);
    const { coupling } = coupled(one);
    const r = newReading();
    coupling.advance(0);
    coupling.read(0, r);
    expect(r.tempK).toBe(400);
    coupling.advance(100);
    coupling.read(0, r);
    expect(r.tempK).toBe(400);
    expect(coupling.warnings.filter((w) => w.code === 'FIRE_RESULT_ENDED')).toHaveLength(1);
  });
  it('never moves the cursor backwards', () => {
    const { coupling } = coupled(fire);
    const r = newReading();
    coupling.advance(8);
    coupling.advance(2);
    coupling.read(0, r);
    expect(r.tempK).toBeCloseTo(300 + 200 * 0.8, 9);
  });
});
describe('layer choice at eye height', () => {
  it('uses the lower layer at or above 1.6 m and the upper layer below', () => {
    expect(isUpperAtEyeHeight(EYE_HEIGHT_M)).toBe(false);
    expect(isUpperAtEyeHeight(EYE_HEIGHT_M + 0.01)).toBe(false);
    expect(isUpperAtEyeHeight(EYE_HEIGHT_M - 1e-9)).toBe(true);
    expect(isUpperAtEyeHeight(0)).toBe(true);
    const start = { upperTempK: 600, lowerTempK: 310, upper: SMOKE, lower: AMBIENT_LAYER };
    for (const [h, upper] of [[1.7, false], [1.6, false], [1.59, true]] as const) {
      const { coupling } = coupled(syntheticFire({ durationS: 2, compartments: [{ id: 'A', start: { ...start, interfaceHeightM: h } }] }));
      const r = newReading();
      coupling.advance(1);
      coupling.read(0, r);
      expect(r.upperActive).toBe(upper);
      expect(r.tempK).toBe(upper ? 600 : 310);
      expect(r.extinctionPerM > 0).toBe(upper);
    }
  });
});
describe('extinction coefficient and gas fractions', () => {
  it('K from a visibility of Infinity is 0', () => {
    expect(extinctionFromVisibility(Infinity)).toBe(0);
    expect(extinctionFromOpticalDensity(0)).toBe(0);
    expect(extinctionFromOpticalDensity(NaN)).toBe(0);
  });
  it('K = optical density x ln 10 equals K_VIS / visibility', () => {
    const vis = K_VIS / (0.4 * Math.LN10);
    expect(extinctionFromVisibility(vis)).toBeCloseTo(extinctionFromOpticalDensity(0.4), 12);
  });
  it('gives ambient air as 20.9 % O2 volume from the fire module default mass fraction', () => {
    const v = massToVolume(0.23, 0, 0, 0, 0);
    expect(v.o2Pct).toBeCloseTo(O2_AMBIENT_PCT, 0);
    expect(v.coPpm).toBe(0);
    expect(v.co2Pct).toBe(0);
  });
  it('turns CO mass fraction into ppm by volume, and flags an invalid input with NaN for that species only', () => {
    // 0.001 kg/kg CO: n_CO = 0.001 / 0.02801, n_O2 = 0.23 / 0.032, n_N2 = 0.769 / 0.02802, so X_CO is about 1030 ppm.
    const v = massToVolume(0.23, 0, 0.001, 0, 0);
    expect(v.coPpm).toBeGreaterThan(1000);
    expect(v.coPpm).toBeLessThan(1060);
    const bad = massToVolume(0.23, NaN, -1, 0, 0);
    expect(Number.isNaN(bad.co2Pct)).toBe(true);
    expect(Number.isNaN(bad.coPpm)).toBe(true);
    expect(Number.isFinite(bad.o2Pct)).toBe(true);
  });
  it('reads K at the smoke layer from the optical density', () => {
    const { coupling } = coupled(syntheticFire({ durationS: 2, compartments: [{ id: 'A', start: { interfaceHeightM: 1, upper: SMOKE } }] }));
    const r = newReading();
    coupling.advance(1);
    coupling.read(0, r);
    expect(r.extinctionPerM).toBeCloseTo(Math.LN10, 12);
    expect(r.visibilityM).toBeCloseTo(K_VIS / Math.LN10, 12);
  });
});
describe('rejected and missing fire data', () => {
  it('a status other than ok gives FIRE_STATUS and no coupling', () => {
    const fire = { ...syntheticFire({ durationS: 2, compartments: [{ id: 'A' }] }), status: 'failed' as const };
    const r = createFireCoupling(fire as never, openRoom().plan);
    expect(r.ok).toBe(false);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.code).toBe('FIRE_STATUS');
    expect(r.warnings[0]!.message).toContain('failed');
  });
  it('an empty series gives FIRE_STATUS', () => {
    const fire = syntheticFire({ durationS: 2, compartments: [{ id: 'A' }] });
    const r = createFireCoupling({ ...fire, timesS: new Float64Array(0) }, openRoom().plan);
    expect(r.ok).toBe(false);
    expect(r.warnings[0]!.code).toBe('FIRE_STATUS');
  });
  it('an unknown compartment reads as ambient and gives one Warning per cell', () => {
    const rows = ['#####', '#aab#', '#aaEE', '#####'];
    const plan = buildPlan({ floors: [floorFromAscii(rows, { a: 'A', b: 'MISSING' })], stairLinks: [] }).plan!;
    const fire = syntheticFire({ durationS: 2, compartments: [{ id: 'A', start: { upperTempK: 500, interfaceHeightM: 1 } }] });
    const r = createFireCoupling(fire, plan);
    if (!r.ok) throw new Error('rejected');
    const missing = r.warnings.filter((w) => w.code === 'COMPARTMENT_MISSING_IN_FIRE');
    expect(missing).toHaveLength(1); // one free cell in MISSING
    expect(missing[0]!.message).toContain('MISSING');
    const idx = plan.compartmentIds.indexOf('MISSING');
    const reading = newReading();
    r.coupling.advance(1);
    r.coupling.read(idx, reading);
    expect(reading.ambient).toBe(true);
    expect(reading.tempK).toBe(AMBIENT_TEMP_K);
    expect(reading.extinctionPerM).toBe(0);
    expect(reading.upperActive).toBe(false);
    r.coupling.read(-1, reading);
    expect(reading.ambient).toBe(true);
  });
  it('uses the ambient temperature from the input for cells outside the fire Result', () => {
    const fire = syntheticFire({ durationS: 2, compartments: [{ id: 'other' }] });
    const r = createFireCoupling(fire, openRoom().plan, 280);
    if (!r.ok) throw new Error('rejected');
    const reading = newReading();
    r.coupling.read(0, reading);
    expect(reading.tempK).toBe(280);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
