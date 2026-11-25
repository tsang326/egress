// Feature: crowd, Property 10: Congestion map and series conserve what they count
// Validates: Requirements 6.4, 6.5
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SERIES_INTERVAL_S, TIME_STEP_S } from '../../../src/core/people/constants';
import { runCrowd } from '../../../src/core/people/index';
import { arbRunCaseWithExit } from '../runArbs';
const stepsOf = (timeS: number): number => Math.round(timeS / TIME_STEP_S);
describe('Property 10: congestion map and series conserve what they count', () => {
  it('the map adds up to the inside time of the agents, and each gate series adds up to its crossings', () => {
    let crossings = 0;
    fc.assert(
      fc.property(arbRunCaseWithExit, (c) => {
        const crossingsAt: number[][] = c.plan.gates.map(() => []); // step of each crossing, per gate
        const r = runCrowd(c.input, c.fire, {
          onStep: (v) => {
            for (const x of v.crossings) crossingsAt[x.gateId]!.push(v.step);
          },
        });
        expect(r.status).toBe('ok');
        // Map: sum of person-seconds equals the sum of the agents' inside times (final-state step included).
        let mapSteps = 0;
        let mapSeconds = 0;
        for (const m of r.congestion) {
          for (const ps of m.personSeconds) {
            mapSeconds += ps;
            mapSteps += stepsOf(ps);
            expect(Math.abs(ps / TIME_STEP_S - stepsOf(ps))).toBeLessThan(1e-6); // a whole number of steps
          }
        }
        let agentSteps = 0;
        let agentSeconds = 0;
        for (const a of r.agents) {
          const t = a.finalState === 'out' ? a.exitTimeS! : a.finalState === 'incapacitated' ? a.incapacitatedTimeS! : c.durationS;
          agentSeconds += t;
          agentSteps += stepsOf(t);
        }
        expect(mapSteps).toBe(agentSteps);
        expect(Math.abs(mapSeconds - agentSeconds)).toBeLessThanOrEqual(1e-6 * Math.max(1, agentSeconds));
        // Series: one sample per whole second from 0 to the duration; flow adds up to the crossings.
        const nSamples = Math.floor(c.durationS / SERIES_INTERVAL_S) + 1;
        let exitCrossings = 0;
        for (const s of r.gates) {
          expect(s.timesS).toHaveLength(nSamples);
          expect(s.flowPersonsPerS).toHaveLength(nSamples);
          expect(s.queueLength).toHaveLength(nSamples);
          for (let k = 0; k < nSamples; k++) expect(s.timesS[k]).toBe(k * SERIES_INTERVAL_S);
          let total = 0;
          for (let k = 0; k < nSamples; k++) {
            total += s.flowPersonsPerS[k]! * SERIES_INTERVAL_S;
            expect(s.queueLength[k]).toBeGreaterThanOrEqual(0);
            // The flow of sample k counts the crossings in the steps before time k.
            const lo = stepsOf((k - 1) * SERIES_INTERVAL_S);
            const hi = stepsOf(k * SERIES_INTERVAL_S);
            const n = crossingsAt[s.gateId]!.filter((st) => st >= lo && st < hi && k > 0).length;
            expect(s.flowPersonsPerS[k]! * SERIES_INTERVAL_S).toBe(n);
          }
          expect(total).toBe(crossingsAt[s.gateId]!.length);
          crossings += total;
          if (s.kind === 'exit') exitCrossings += total;
        }
        expect(exitCrossings).toBe(r.summary!.out);
      }),
      { numRuns: 100 },
    );
    expect(crossings).toBeGreaterThan(0);
  });
});
