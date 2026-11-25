// Feature: crowd, Property 11: Speed relations are bounded and monotone
// Validates: Requirements 2.5, 2.6, 2.7, 4.5
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { D_FREE_CAP, D_ZERO_SPEED, K_LEVEL_M_PER_S, SMOKE_LAW_IRRITANT, SMOKE_LAW_NON_IRRITANT, SPEED_DENSITY_SLOPE, STAIR_K_TABLE } from '../../../src/core/people/constants';
import { levelSpeed, smokeFactor, stairSpeed } from '../../../src/core/people/steering/speed';

const density = fc.double({ min: 0, max: 8, noNaN: true });
const stairK = fc.constantFrom(...STAIR_K_TABLE.map((t) => t.kMPerS));

describe('Property 11: Speed relations are bounded and monotone', () => {
  it('level and stair speed are in [0, S(0.54)], monotone non-increasing in D, and zero from 1/0.266', () => {
    fc.assert(
      fc.property(density, density, stairK, (d1, d2, k) => {
        const [lo, hi] = d1 <= d2 ? [d1, d2] : [d2, d1];
        const maxLevel = K_LEVEL_M_PER_S * (1 - SPEED_DENSITY_SLOPE * D_FREE_CAP);
        const maxStair = k * (1 - SPEED_DENSITY_SLOPE * D_FREE_CAP);
        const okLevel = levelSpeed(lo) >= levelSpeed(hi) && levelSpeed(lo) <= maxLevel && levelSpeed(hi) >= 0;
        const okStair = stairSpeed(k, lo) >= stairSpeed(k, hi) && stairSpeed(k, lo) <= maxStair && stairSpeed(k, hi) >= 0;
        const zero = hi < D_ZERO_SPEED || (levelSpeed(hi) === 0 && stairSpeed(k, hi) === 0);
        const maxAtCap = levelSpeed(0) === maxLevel && stairSpeed(k, 0) === maxStair;
        return okLevel && okStair && zero && maxAtCap;
      }),
    );
  });
  it('the smoke factor is in [floor, 1] and monotone non-increasing in K for both laws', () => {
    fc.assert(
      fc.property(fc.double({ min: -1, max: 20, noNaN: true }), fc.double({ min: -1, max: 20, noNaN: true }), fc.boolean(), (k1, k2, irritant) => {
        const law = irritant ? SMOKE_LAW_IRRITANT : SMOKE_LAW_NON_IRRITANT;
        const [lo, hi] = k1 <= k2 ? [k1, k2] : [k2, k1];
        const fLo = smokeFactor(lo, law);
        const fHi = smokeFactor(hi, law);
        return fLo >= fHi && fHi >= 0.3 / law.a && fLo <= 1;
      }),
    );
  });
});
