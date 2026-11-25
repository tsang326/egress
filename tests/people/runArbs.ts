// Generators for whole crowd runs, built on the generators of arbitraries.ts (written once in task 3.3, not changed here).
// Used by the run-level property tests of section 15 (and the determinism property).
import fc from 'fast-check';
import type { Result } from '../../src/core/fire/types';
import type { AgentInput, CrowdInput, DelayParams, Plan } from '../../src/core/people/types';
import { arbAgents, arbFire, arbNoFire, arbPlan, arbPlanWithExit } from './arbitraries';
import { SHORT_DELAY } from './runHelpers';
export interface RunCase {
  plan: Plan;
  agents: AgentInput[];
  fire: Result;
  durationS: number;
  seed: number;
  noFire: boolean;
  input: CrowdInput;
}
const arbDelay: fc.Arbitrary<{ visitor?: DelayParams; staff?: DelayParams } | undefined> = fc.constantFrom(undefined, SHORT_DELAY);
function runCaseFor(plan: Plan, fireKind: 'smoke' | 'none' | 'either'): fc.Arbitrary<RunCase> {
  const arbFireResult =
    fireKind === 'smoke' ? arbFire(plan).map((f) => ({ ...f, noFire: false })) : fireKind === 'none' ? arbNoFire(plan).map((f) => ({ ...f, noFire: true })) : fc.oneof(arbFire(plan).map((f) => ({ ...f, noFire: false })), arbNoFire(plan).map((f) => ({ ...f, noFire: true })));
  return fc.record({ agents: arbAgents(plan), gen: arbFireResult, seed: fc.integer({ min: 0, max: 0x7fffffff }), delay: arbDelay }).map(({ agents, gen, seed, delay }) => {
    const input: CrowdInput = { schemaVersion: 1, durationS: gen.durationS, seed, plan, agents };
    if (delay !== undefined) input.delay = delay;
    return { plan, agents, fire: gen.fire, durationS: gen.durationS, seed, noFire: gen.noFire, input };
  });
}
// Any generated plan (with or without exits, with or without stairs), a smoke or ambient fire.
export const arbRunCase: fc.Arbitrary<RunCase> = arbPlan.chain((p) => runCaseFor(p, 'either'));
// Plans that always have an exit, so the run is not rejected as invalid.
export const arbRunCaseWithExit: fc.Arbitrary<RunCase> = arbPlanWithExit.chain((p) => runCaseFor(p, 'either'));
export const arbRunCaseNoFire: fc.Arbitrary<RunCase> = arbPlanWithExit.chain((p) => runCaseFor(p, 'none'));
export const arbRunCaseSmoke: fc.Arbitrary<RunCase> = arbPlanWithExit.chain((p) => runCaseFor(p, 'smoke'));
