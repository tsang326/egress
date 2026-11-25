// Feature: crowd, Property 9: FED is non-negative, monotone and consistent with incapacitation
// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AMBIENT_TEMP_K, FED_LIMIT } from '../../../src/core/people/constants';
import { STATE_INCAPACITATED, STATE_OUT } from '../../../src/core/people/agents/state';
import { runCrowd } from '../../../src/core/people/index';
import { fedIncrement } from '../../../src/core/people/tenability/fed';
import { arbRunCaseSmoke } from '../runArbs';
describe('Property 9: FED is non-negative, monotone and consistent with incapacitation', () => {
  it('the FED increments are at least 0 for any finite non-negative layer state and exactly 0 at ambient', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1500, noNaN: true }),
        fc.double({ min: 0, max: 50000, noNaN: true }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        (tempK, coPpm, co2Pct, o2Pct, dtS) => {
          const inc = fedIncrement(tempK, coPpm, co2Pct, o2Pct, dtS);
          expect(inc.invalid).toBeNull();
          expect(inc.asph).toBeGreaterThanOrEqual(0);
          expect(inc.heat).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(inc.asph) && Number.isFinite(inc.heat)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
    const ambient = fedIncrement(AMBIENT_TEMP_K, 0, 0.04, 20.9, 0.05);
    expect(ambient.asph).toBe(0);
    expect(ambient.heat).toBe(0);
  });
  it('in a run the total FED never decreases, freezes at exit and incapacitation, and incapacitation matches its cause', () => {
    let incapSeen = 0;
    fc.assert(
      fc.property(arbRunCaseSmoke, (c) => {
        let prevTotal: Float64Array | null = null;
        let prevState: Uint8Array | null = null;
        let prevX: Float64Array | null = null;
        let prevY: Float64Array | null = null;
        let bad: string | null = null;
        const r = runCrowd(c.input, c.fire, {
          onStep: (v) => {
            const a = v.store;
            const total = new Float64Array(a.n);
            for (let i = 0; i < a.n; i++) {
              total[i] = a.fedAsph[i]! + a.fedHeat[i]!;
              if (a.fedAsph[i]! < 0 || a.fedHeat[i]! < 0) bad ??= `step ${v.step}: agent ${i} has a negative FED term`;
              if (a.state[i] !== STATE_INCAPACITATED && total[i]! >= FED_LIMIT && a.causeMask[i] === 0) {
                bad ??= `step ${v.step}: agent ${i} has FED ${total[i]} and is not incapacitated`;
              }
              if (prevTotal !== null) {
                if (total[i]! < prevTotal[i]!) bad ??= `step ${v.step}: agent ${i} FED fell from ${prevTotal[i]} to ${total[i]}`;
                const was = prevState![i]!;
                if ((was === STATE_OUT || was === STATE_INCAPACITATED) && total[i] !== prevTotal[i]) bad ??= `step ${v.step}: agent ${i} FED changed after a final state`;
                if (was === STATE_INCAPACITATED && (a.x[i] !== prevX![i] || a.y[i] !== prevY![i])) bad ??= `step ${v.step}: incapacitated agent ${i} moved (speed above 0)`;
                if (was === STATE_INCAPACITATED && a.state[i] !== STATE_INCAPACITATED) bad ??= `step ${v.step}: agent ${i} left the incapacitated state`;
              }
            }
            prevTotal = total;
            prevState = Uint8Array.from(a.state);
            prevX = Float64Array.from(a.x);
            prevY = Float64Array.from(a.y);
          },
        });
        expect(bad).toBeNull();
        for (const rec of r.agents) {
          const h = rec.fedHistory;
          for (let k = 0; k < h.fed.length; k++) {
            expect(h.fed[k]).toBeGreaterThanOrEqual(0);
            if (k > 0) expect(h.fed[k]!).toBeGreaterThanOrEqual(h.fed[k - 1]!);
          }
          if (rec.finalState === 'incapacitated') {
            incapSeen++;
            expect(rec.causes.length).toBeGreaterThanOrEqual(1);
            expect(rec.incapacitatedTimeS).not.toBeNull();
            // A FED cause means the dose reached the limit; the temperature cause needs no dose.
            if (rec.causes.includes('asphyxiant FED') || rec.causes.includes('heat FED')) {
              expect(h.fed[h.fed.length - 1]!).toBeGreaterThanOrEqual(FED_LIMIT);
            }
          } else {
            expect(rec.causes).toEqual([]);
            expect(rec.incapacitatedTimeS).toBeNull();
            if (h.fed.length > 0) expect(h.fed[h.fed.length - 1]!).toBeLessThan(FED_LIMIT);
          }
        }
      }),
      { numRuns: 100 },
    );
    expect(incapSeen).toBeGreaterThan(0); // the generated fires are hot enough to incapacitate some agents
  });
});
