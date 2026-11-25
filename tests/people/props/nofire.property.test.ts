// Feature: crowd, Property 7: No fire, no dose
// Validates: Requirements 9.7, 5.1, 5.2, 4.3
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { STATE_INCAPACITATED, STATE_IN_STAIR } from '../../../src/core/people/agents/state';
import { runCrowd } from '../../../src/core/people/index';
import { NO_COMPARTMENT } from '../../../src/core/people/types';
import { arbRunCaseNoFire, arbRunCaseSmoke } from '../runArbs';
describe('Property 7: no fire, no dose', () => {
  it('with ambient conditions everywhere every FED is exactly 0 at every step, nobody is incapacitated, every sample is 0', () => {
    fc.assert(
      fc.property(arbRunCaseNoFire, (c) => {
        let bad: string | null = null;
        const r = runCrowd(c.input, c.fire, {
          onStep: (v) => {
            const a = v.store;
            for (let i = 0; i < a.n; i++) {
              if (a.fedAsph[i] !== 0 || a.fedHeat[i] !== 0) bad ??= `step ${v.step}: agent ${i} has FED ${a.fedAsph[i]} + ${a.fedHeat[i]}`;
              if (a.state[i] === STATE_INCAPACITATED) bad ??= `step ${v.step}: agent ${i} is incapacitated`;
            }
          },
        });
        expect(bad).toBeNull();
        if (r.status === 'invalid') return;
        expect(r.summary!.incapacitated).toBe(0);
        for (const rec of r.agents) {
          expect(rec.finalState).not.toBe('incapacitated');
          expect(rec.causes).toEqual([]);
          expect(rec.fedHistory.fed.length).toBeGreaterThan(0);
          for (const f of rec.fedHistory.fed) expect(f).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });
  it('with a fire in every compartment, an agent in a cell that has no compartment takes no dose in that step', () => {
    let steps = 0;
    fc.assert(
      fc.property(arbRunCaseSmoke, (c) => {
        let prevDose: Float64Array | null = null;
        let prevInStair: Uint8Array | null = null;
        let bad: string | null = null;
        runCrowd(c.input, c.fire, {
          onStep: (v) => {
            const a = v.store;
            const dose = new Float64Array(a.n);
            for (let i = 0; i < a.n; i++) dose[i] = a.fedAsph[i]! + a.fedHeat[i]!;
            if (prevDose !== null) {
              for (let i = 0; i < a.n; i++) {
                if (a.state[i] === STATE_IN_STAIR || prevInStair![i] === 1) continue; // a stair agent is read in the layer of the floor it is on
                if (c.plan.floors[a.floor[i]!]!.compartment[a.cell[i]!] !== NO_COMPARTMENT) continue;
                steps++;
                if (dose[i] !== prevDose[i]) bad ??= `step ${v.step}: agent ${i} in a cell with no compartment gained dose ${dose[i]! - prevDose[i]!}`;
              }
            }
            prevDose = dose;
            prevInStair = Uint8Array.from(a.state, (s) => (s === STATE_IN_STAIR ? 1 : 0));
          },
        });
        expect(bad).toBeNull();
      }),
      { numRuns: 100 },
    );
    expect(steps).toBeGreaterThan(0); // door and exit cells have no compartment, so agents do stand in such cells
  });
});
