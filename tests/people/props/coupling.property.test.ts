// Feature: crowd, Property 12: Layer reading by interpolation
// Validates: Requirements 4.2, 4.4, 4.8
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createFireCoupling } from '../../../src/core/people/coupling/fireCoupling';
import { massToVolume, newReading } from '../../../src/core/people/coupling/layers';
import { EYE_HEIGHT_M } from '../../../src/core/people/constants';
import { openRoom } from '../samplePlans';
import { syntheticFire, type CompartmentState, type LayerState } from '../syntheticFire';
const layer = fc.record({
  o2: fc.double({ min: 0.1, max: 0.23, noNaN: true }),
  co2: fc.double({ min: 0, max: 0.2, noNaN: true }),
  co: fc.double({ min: 0, max: 0.01, noNaN: true }),
  opticalDensityPerM: fc.double({ min: 0, max: 2, noNaN: true }),
});
const state = fc.record({
  interfaceHeightM: fc.double({ min: 0.2, max: 3, noNaN: true }),
  upperTempK: fc.double({ min: 293, max: 900, noNaN: true }),
  lowerTempK: fc.double({ min: 293, max: 400, noNaN: true }),
  upper: layer,
  lower: layer,
});
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
describe('Property 12: Layer reading by interpolation', () => {
  it('equals the linear interpolation in time of the layer chosen by the interpolated interface height, and holds after the end', () => {
    fc.assert(
      fc.property(
        state,
        state,
        fc.integer({ min: 2, max: 20 }),
        fc.array(fc.double({ min: 0, max: 1.5, noNaN: true }), { minLength: 1, maxLength: 8 }),
        (a, b, dur, fractions) => {
          const plan = openRoom().plan;
          const fire = syntheticFire({ durationS: dur, compartments: [{ id: 'A', start: a as Partial<CompartmentState>, end: b as Partial<CompartmentState> }] });
          const r = createFireCoupling(fire, plan);
          if (!r.ok) return false;
          const reading = newReading();
          let held = false;
          for (const t of [...fractions].sort((x, y) => x - y).map((f) => f * dur)) {
            r.coupling.advance(t);
            r.coupling.read(0, reading);
            const u = Math.min(1, t / dur);
            const upper = !(lerp(a.interfaceHeightM, b.interfaceHeightM, u) >= EYE_HEIGHT_M);
            const la: LayerState = upper ? a.upper : a.lower;
            const lb: LayerState = upper ? b.upper : b.lower;
            const gas = massToVolume(lerp(la.o2, lb.o2, u), lerp(la.co2, lb.co2, u), lerp(la.co, lb.co, u), 0, 0);
            const temp = lerp(upper ? a.upperTempK : a.lowerTempK, upper ? b.upperTempK : b.lowerTempK, u);
            const k = lerp(la.opticalDensityPerM, lb.opticalDensityPerM, u) * Math.LN10;
            if (reading.upperActive !== upper || !close(reading.tempK, temp) || !close(reading.extinctionPerM, k)) return false;
            if (!close(reading.coPpm, gas.coPpm) || !close(reading.co2Pct, gas.co2Pct) || !close(reading.o2Pct, gas.o2Pct)) return false;
            if (t > dur) held = true;
          }
          // The end Warning appears exactly when a time past the last sample was read, and then only once.
          const ended = r.coupling.warnings.filter((w) => w.code === 'FIRE_RESULT_ENDED').length;
          expect(ended).toBe(held ? 1 : 0);
          return true;
        },
      ),
    );
  });
});
