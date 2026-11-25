// Default-run performance smoke test (task 19.2; Requirement 8.5). Same Plan and fire Scenario as the benchmark, 60 s of
// simulated time. It has no time limit: it only catches a broken fixture or a failed fire or crowd run.
import { describe, expect, it } from 'vitest';
import { runFire } from '../../src/core/fire/index';
import { handleMessage } from '../../src/core/people/worker/handler';
import type { FromWorker } from '../../src/core/people/worker/protocol';
import { buildBenchCrowdInput, buildBenchFireScenario, buildBenchPlan, BENCH_AGENTS_PER_FLOOR, BENCH_FLOORS } from './fixtures/benchCase';

const SMOKE_DURATION_S = 60;

describe.skipIf(process.env['CROWD_BENCH'] === '1')('crowd performance smoke (60 s)', () => {
  it('the Plan builds, the fire Result is "ok" and the crowd Result is "ok"', () => {
    const plan = buildBenchPlan(); // throws with the Warnings when the Plan is invalid
    expect(plan.floors).toHaveLength(BENCH_FLOORS);
    expect(plan.exits.length).toBeGreaterThan(0);
    const fire = runFire(buildBenchFireScenario(SMOKE_DURATION_S));
    expect(fire.status, JSON.stringify(fire.warnings.slice(0, 3))).toBe('ok');
    const msgs: FromWorker[] = [];
    handleMessage({ type: 'run', id: 1, request: { input: buildBenchCrowdInput(plan, SMOKE_DURATION_S), fire } }, (m) => msgs.push(m));
    const last = msgs[msgs.length - 1]!;
    expect(last.type).toBe('result');
    if (last.type !== 'result') return;
    expect(last.result.status, JSON.stringify(last.result.warnings.slice(0, 3))).toBe('ok');
    expect(last.result.agents).toHaveLength(BENCH_FLOORS * BENCH_AGENTS_PER_FLOOR);
  }, 120_000);
});
