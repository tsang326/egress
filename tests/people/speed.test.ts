// Unit tests for the speed-density relation and the Smoke_Speed_Factor (Requirements 2.5, 2.6, 2.7, 4.5).
import { describe, expect, it } from 'vitest';
import {
  D_FREE_CAP,
  D_ZERO_SPEED,
  K_LEVEL_M_PER_S,
  SMOKE_DARKNESS_SPEED_M_PER_S,
  SMOKE_LAW_IRRITANT,
  SMOKE_LAW_NON_IRRITANT,
  SPEED_DENSITY_SLOPE,
  STAIR_K_TABLE,
  STAIR_DEFAULT_RISER_M,
  STAIR_DEFAULT_TREAD_M,
  V_FREE_M_PER_S,
} from '../../src/core/people/constants';
import { levelSpeed, smokeFactor, stairKForGeometry, stairSpeed } from '../../src/core/people/steering/speed';

const sfpe = (k: number, d: number): number => k * (1 - SPEED_DENSITY_SLOPE * d);

describe('levelSpeed', () => {
  it('follows k (1 - 0.266 D) with D held at 0.54 below it', () => {
    for (const d of [0, 0.3, 0.54]) expect(levelSpeed(d)).toBe(sfpe(K_LEVEL_M_PER_S, 0.54));
    expect(levelSpeed(1)).toBeCloseTo(sfpe(1.4, 1), 12);
    expect(levelSpeed(1.88)).toBeCloseTo(sfpe(1.4, 1.88), 12);
    expect(levelSpeed(1.88)).toBeCloseTo(0.7, 2);
  });
  it('has its maximum S(0.54) = V_FREE, about 1.2 m/s', () => {
    expect(levelSpeed(0)).toBe(V_FREE_M_PER_S);
    expect(V_FREE_M_PER_S).toBeCloseTo(1.2, 1);
  });
  it('is zero at and above 1 / 0.266 and positive just below it', () => {
    expect(levelSpeed(D_ZERO_SPEED)).toBe(0);
    expect(levelSpeed(3.76)).toBe(0);
    expect(levelSpeed(5)).toBe(0);
    expect(levelSpeed(D_ZERO_SPEED - 1e-9)).toBeGreaterThan(0);
  });
  it('is monotone non-increasing in D', () => {
    let prev = Infinity;
    for (let d = 0; d <= 6; d += 0.05) {
      const v = levelSpeed(d);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
  it('reads a non-finite or negative density as free flow', () => {
    for (const d of [NaN, -1, -Infinity]) expect(levelSpeed(d)).toBe(V_FREE_M_PER_S);
    expect(levelSpeed(Infinity)).toBe(0);
  });
});

describe('stairSpeed', () => {
  it('uses the table k with the same a, the same cap and the same zero density', () => {
    for (const t of STAIR_K_TABLE) {
      expect(stairSpeed(t.kMPerS, 0)).toBeCloseTo(sfpe(t.kMPerS, D_FREE_CAP), 12);
      expect(stairSpeed(t.kMPerS, 0.3)).toBe(stairSpeed(t.kMPerS, 0.54));
      expect(stairSpeed(t.kMPerS, 2)).toBeCloseTo(sfpe(t.kMPerS, 2), 12);
      expect(stairSpeed(t.kMPerS, D_ZERO_SPEED)).toBe(0);
    }
  });
  it('looks up the default 7 in / 11 in stair as 1.08 m/s and clamps outside the table', () => {
    expect(stairKForGeometry(STAIR_DEFAULT_RISER_M, STAIR_DEFAULT_TREAD_M)).toBe(1.08);
    expect(stairKForGeometry(0.3, 0.1)).toBe(STAIR_K_TABLE[0]!.kMPerS); // steepest, clamped to the first row
    expect(stairKForGeometry(0.1, 0.5)).toBe(STAIR_K_TABLE[3]!.kMPerS); // shallowest, clamped to the last row
  });
});

describe('smokeFactor', () => {
  const a = SMOKE_LAW_NON_IRRITANT.a;
  const b = SMOKE_LAW_NON_IRRITANT.b;
  it('is 1 without smoke, for K <= 0 and for non-finite K', () => {
    expect(smokeFactor(0)).toBe(1);
    expect(smokeFactor(-1)).toBe(1);
    expect(smokeFactor(NaN)).toBe(1);
  });
  it('follows the Jin non-irritant line, about 1 - 0.409 K', () => {
    expect(smokeFactor(0.5)).toBeCloseTo((a - b * 0.5) / a, 12);
    expect(smokeFactor(1)).toBeCloseTo(1 - 0.409, 3);
  });
  it('reaches the darkness-speed floor at about K = 1.75', () => {
    const floor = SMOKE_DARKNESS_SPEED_M_PER_S / a;
    expect(smokeFactor(1.76)).toBe(floor);
    expect(smokeFactor(10)).toBe(floor);
    expect(smokeFactor(1.75)).toBeCloseTo(floor, 3);
    expect(smokeFactor(1.7)).toBeGreaterThan(floor);
  });
  it('uses the irritant law when asked', () => {
    const { a: ai, b: bi } = SMOKE_LAW_IRRITANT;
    expect(smokeFactor(0.5, SMOKE_LAW_IRRITANT)).toBeCloseTo((ai - bi * 0.5) / ai, 12);
    expect(smokeFactor(5, SMOKE_LAW_IRRITANT)).toBe(SMOKE_DARKNESS_SPEED_M_PER_S / ai);
    expect(smokeFactor(0.5, SMOKE_LAW_IRRITANT)).toBeLessThan(smokeFactor(0.5));
  });
});
