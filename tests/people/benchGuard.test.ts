// Guards on the benchmark fixture (task 23). They keep the 300-agent building honest without running the fire solver:
// the Plan has no unreachable region, and with an ambient fire Result every agent gets out. The benchmark's outcome
// then reflects the fire, not a fixture mistake such as a wall that closes the corridor.
import { describe, expect, it } from 'vitest';
import { runCrowd } from '../../src/core/people/index';
import { BENCH_AGENTS_PER_FLOOR, BENCH_FLOORS, buildBenchCrowdInput, buildBenchPlan, buildBenchPlanResult } from './fixtures/benchCase';
import { noFire } from './runHelpers';
const GUARD_DURATION_S = 600;
describe('benchmark fixture guards', () => {
  it('the benchmark Plan is valid and has no UNREACHABLE_REGION Warning', () => {
    const r = buildBenchPlanResult();
    expect(r.status).toBe('valid');
    expect(r.warnings.filter((w) => w.code === 'UNREACHABLE_REGION')).toEqual([]);
  });
  it('with no fire all 300 agents are out within 600 s', () => {
    const plan = buildBenchPlan();
    const input = buildBenchCrowdInput(plan, GUARD_DURATION_S);
    expect(input.agents).toHaveLength(BENCH_FLOORS * BENCH_AGENTS_PER_FLOOR);
    const r = runCrowd(input, noFire(plan, GUARD_DURATION_S));
    expect(r.status, JSON.stringify(r.warnings.slice(0, 3))).toBe('ok');
    const stuck = r.agents.filter((a) => a.finalState !== 'out').map((a) => `${a.id} ${a.finalState} at ${a.finalFloorId} (${a.finalXM.toFixed(1)}, ${a.finalYM.toFixed(1)})`);
    expect(stuck).toEqual([]);
    expect(r.summary?.out).toBe(300);
    expect(r.summary?.evacuationTimeS ?? Infinity).toBeLessThanOrEqual(GUARD_DURATION_S);
  }, 120_000);
});
