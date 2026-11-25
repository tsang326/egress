// Unit tests for the FED formulas and tenability limits (Requirements 4.6, 5.1 to 5.6).
import { describe, expect, it } from 'vitest';
import { AMBIENT_TEMP_K, FED_LIMIT, HEAT_FED_MIN_C, O2_AMBIENT_PCT, O2_FED_CUTOFF_PCT, TEMP_LIMIT_K, TIME_STEP_S } from '../../src/core/people/constants';
import {
  asphyxiantRatePerMin,
  co2HyperventilationFactor,
  coRatePerMin,
  fedIncrement,
  heatRatePerMin,
  invalidInputName,
  o2RatePerMin,
} from '../../src/core/people/tenability/fed';
import {
  CAUSE_ASPH,
  CAUSE_HEAT,
  CAUSE_TEMP,
  CLASS_BLOCKED,
  CLASS_CLEAR,
  CLASS_SMOKY,
  causeMask,
  causesFromMask,
  compartmentClass,
  exceedsTemperatureLimit,
  fedLimitReached,
  visibilityLimitM,
} from '../../src/core/people/tenability/limits';
describe('FED rates', () => {
  it('CO at 2000 ppm gives about 0.0728 per minute', () => {
    expect(coRatePerMin(2000)).toBeCloseTo(0.0728, 3);
  });
  it('CO at 0 ppm gives exactly 0', () => {
    expect(coRatePerMin(0)).toBe(0);
  });
  it('O2 at 15 % gives 1/140 per minute, at 10 % about 1/9.4', () => {
    expect(o2RatePerMin(15)).toBeCloseTo(1 / 140, 4);
    expect(1 / o2RatePerMin(10)).toBeCloseTo(9.4, 1);
  });
  it('O2 at and above the cutoff gives exactly 0, just below it a positive rate', () => {
    expect(o2RatePerMin(O2_AMBIENT_PCT)).toBe(0);
    expect(o2RatePerMin(O2_FED_CUTOFF_PCT)).toBe(0);
    expect(o2RatePerMin(O2_FED_CUTOFF_PCT - 0.01)).toBeGreaterThan(0);
  });
  it('heat at 100 degC reaches FED 1 in 24.7 min and at 150 degC in 5.7 min', () => {
    expect(1 / heatRatePerMin(100)).toBeCloseTo(24.7, 1);
    expect(1 / heatRatePerMin(150)).toBeCloseTo(5.7, 1);
  });
  it('heat at or below the lower threshold gives exactly 0', () => {
    expect(heatRatePerMin(20)).toBe(0);
    expect(heatRatePerMin(HEAT_FED_MIN_C)).toBe(0);
    expect(heatRatePerMin(HEAT_FED_MIN_C + 0.1)).toBeGreaterThan(0);
  });
  it('V_CO2 at 0 % and 5 %', () => {
    expect(co2HyperventilationFactor(0)).toBeCloseTo(Math.exp(1.9086) / 6.8, 12);
    expect(co2HyperventilationFactor(0)).toBeCloseTo(0.9917, 3);
    expect(co2HyperventilationFactor(5)).toBeCloseTo(Math.exp(0.2496 * 5 + 1.9086) / 6.8, 12);
    expect(co2HyperventilationFactor(5)).toBeCloseTo(3.4545, 3);
  });
  it('CO2 raises the CO term but adds nothing without CO', () => {
    expect(asphyxiantRatePerMin(0, 5, O2_AMBIENT_PCT)).toBe(0);
    expect(asphyxiantRatePerMin(1000, 5, O2_AMBIENT_PCT)).toBeGreaterThan(asphyxiantRatePerMin(1000, 0, O2_AMBIENT_PCT));
  });
  it('the asphyxiant rate is the CO term times V_CO2 plus the O2 term', () => {
    expect(asphyxiantRatePerMin(1500, 3, 15)).toBeCloseTo(coRatePerMin(1500) * co2HyperventilationFactor(3) + o2RatePerMin(15), 12);
  });
});
describe('fedIncrement', () => {
  it('ambient air gives exactly 0 for both terms', () => {
    const inc = fedIncrement(AMBIENT_TEMP_K, 0, 0, O2_AMBIENT_PCT, TIME_STEP_S);
    expect(inc).toEqual({ asph: 0, heat: 0, invalid: null });
  });
  it('is the rate per minute times the step over 60', () => {
    const inc = fedIncrement(373.15, 2000, 0, O2_AMBIENT_PCT, TIME_STEP_S);
    expect(inc.asph).toBeCloseTo((coRatePerMin(2000) * co2HyperventilationFactor(0) * TIME_STEP_S) / 60, 15);
    expect(inc.heat).toBeCloseTo((heatRatePerMin(100) * TIME_STEP_S) / 60, 15);
  });
  it('accumulates to 1 after 24.7 min of 100 degC air', () => {
    const per = fedIncrement(373.15, 0, 0, O2_AMBIENT_PCT, TIME_STEP_S).heat;
    expect(FED_LIMIT / per / (60 / TIME_STEP_S)).toBeCloseTo(24.7, 1);
  });
  it.each([
    ['temperature', NaN, 0, 0, 20.9],
    ['temperature', -1, 0, 0, 20.9],
    ['temperature', Infinity, 0, 0, 20.9],
    ['CO', 300, NaN, 0, 20.9],
    ['CO', 300, -5, 0, 20.9],
    ['CO2', 300, 0, Infinity, 20.9],
    ['CO2', 300, 0, -0.1, 20.9],
    ['O2', 300, 0, 0, NaN],
    ['O2', 300, 0, 0, -1],
  ])('names the invalid %s input and adds nothing (%f, %f, %f, %f)', (name, t, co, co2, o2) => {
    const inc = fedIncrement(t, co, co2, o2, TIME_STEP_S);
    expect(inc).toEqual({ asph: 0, heat: 0, invalid: name });
    expect(invalidInputName(t, co, co2, o2)).toBe(name);
  });
  it('is never negative for valid inputs', () => {
    for (const t of [250, 293.15, 400, 800]) for (const co of [0, 10, 5000]) for (const o2 of [5, 15, 20.9, 25]) {
      const inc = fedIncrement(t, co, 2, o2, TIME_STEP_S);
      expect(inc.asph).toBeGreaterThanOrEqual(0);
      expect(inc.heat).toBeGreaterThanOrEqual(0);
    }
  });
});
describe('limits and causes', () => {
  it('incapacitates when the FED sum reaches 1', () => {
    expect(fedLimitReached(0.6, 0.39)).toBe(false);
    expect(fedLimitReached(0.6, 0.4)).toBe(true);
    expect(fedLimitReached(1, 0)).toBe(true);
  });
  it('the cause list names every positive term when the FED limit is reached', () => {
    expect(causesFromMask(causeMask(0.7, 0.3, false))).toEqual(['asphyxiant FED', 'heat FED']);
    expect(causesFromMask(causeMask(1, 0, false))).toEqual(['asphyxiant FED']);
    expect(causesFromMask(causeMask(0, 1.2, false))).toEqual(['heat FED']);
    expect(causeMask(0.2, 0.1, false)).toBe(0);
  });
  it('the temperature limit is its own cause and does not list a FED term below the FED limit', () => {
    expect(causeMask(0.2, 0.1, true)).toBe(CAUSE_TEMP);
    expect(causesFromMask(causeMask(0.2, 0.1, true))).toEqual(['temperature limit']);
    expect(causeMask(0.9, 0.2, true)).toBe(CAUSE_ASPH | CAUSE_HEAT | CAUSE_TEMP);
  });
  it('temperature-limit incapacitation needs the upper layer above 100 degC', () => {
    expect(exceedsTemperatureLimit(true, TEMP_LIMIT_K + 0.01)).toBe(true);
    expect(exceedsTemperatureLimit(true, TEMP_LIMIT_K)).toBe(false);
    expect(exceedsTemperatureLimit(false, 900)).toBe(false);
  });
  it('classifies a compartment as blocked, smoky or clear', () => {
    expect(compartmentClass(true, TEMP_LIMIT_K, Infinity, 20)).toBe(CLASS_BLOCKED);
    expect(compartmentClass(false, 900, Infinity, 20)).toBe(CLASS_CLEAR);
    expect(compartmentClass(true, 350, 4.9, 20)).toBe(CLASS_SMOKY);
    expect(compartmentClass(true, 350, 5, 20)).toBe(CLASS_CLEAR);
    expect(compartmentClass(false, 300, 9, 150)).toBe(CLASS_SMOKY);
    expect(compartmentClass(false, 300, 9, 20)).toBe(CLASS_CLEAR);
  });
  it('uses 10 m above 100 m2 and 5 m otherwise', () => {
    expect(visibilityLimitM(100)).toBe(5);
    expect(visibilityLimitM(100.01)).toBe(10);
  });
  it('exposes the cause bits used by the agent store', () => {
    expect([CAUSE_ASPH, CAUSE_HEAT, CAUSE_TEMP]).toEqual([1, 2, 4]);
  });
});
