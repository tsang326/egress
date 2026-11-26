// Fire library (run-view spec, Requirement 3): sources, units, and that each curve keeps the measured heat.
import { describe, expect, it } from 'vitest';
import { buildFire, FCD_DOI, FIRE_LIBRARY, T_SQUARED_ALPHA_KW_PER_S2, tSquaredCurve } from '../../src/core/fire/library';
import { validate } from '../../src/core/fire/validate/validate';
import { sampleSetup } from './helpers';
import { buildRun } from '../../src/web/setup/scenarioBuilder';

describe('fire library', () => {
  it('has 6 to 10 measured items, each citing the FCD DOI and its test (Req 3.1, 3.2)', () => {
    expect(FIRE_LIBRARY.length).toBeGreaterThanOrEqual(6);
    expect(FIRE_LIBRARY.length).toBeLessThanOrEqual(10);
    for (const item of FIRE_LIBRARY) {
      expect(item.source).toContain(FCD_DOI);
      expect(item.source).toContain(item.testId);
      expect(item.testId).toMatch(/^Test\d{3}$/);
      expect(item.sourceUrl).toContain(item.testId.toLowerCase());
      expect(item.curve[0]!.timeS).toBe(0);
    }
  });

  it('each curve releases the measured total heat within 6 % and peaks within 12 % (10 s averages lower the peak)', () => {
    for (const item of FIRE_LIBRARY) {
      let energyJ = 0;
      for (let i = 1; i < item.curve.length; i++) energyJ += (item.curve[i]!.timeS - item.curve[i - 1]!.timeS) * item.curve[i - 1]!.hrrW; // bin averages, held over the bin
      expect(Math.abs(energyJ / 1e6 - item.thrMJ) / item.thrMJ, item.testId).toBeLessThan(0.06);
      const peakKW = Math.max(...item.curve.map((p) => p.hrrW)) / 1000;
      expect(Math.abs(peakKW - item.phrrKW) / item.phrrKW, item.testId).toBeLessThan(0.12);
    }
  });

  it('t-squared alpha values are NFPA 72 kW/s2 and are used as W/s2 x 1000 (Req 3.3)', () => {
    expect(T_SQUARED_ALPHA_KW_PER_S2).toEqual({ slow: 0.00293, medium: 0.01172, fast: 0.0469, ultraFast: 0.1876 });
    // Fast growth reaches 1055 kW (1000 Btu/s) in about 150 s.
    const c = tSquaredCurve({ kind: 'tSquared', growth: 'fast', peakKW: 2000 }, 600);
    const at150 = c.find((p) => p.timeS === 150)!;
    expect(at150.hrrW / 1000).toBeCloseTo(1055, -1);
    expect(c[c.length - 1]!.hrrW).toBe(2_000_000);
  });

  it('every library fire passes the fire model validator in a real compartment', () => {
    const { session, state } = sampleSetup('cafe');
    for (const choice of [...FIRE_LIBRARY, { kind: 'tSquared' as const, growth: 'medium' as const, peakKW: 500 }]) {
      const built = buildRun(session, { ...state, fireChoice: choice, durationS: 600 });
      const v = validate(built.scenario);
      const errors = (v.warnings ?? []).filter((w) => w.severity === 'error');
      expect(errors, choice.kind === 'measured' ? choice.testId : 'tsq').toEqual([]);
      expect(buildFire(choice, 'x', 1, 1, 600).table.length).toBeGreaterThan(2);
    }
  });
});
