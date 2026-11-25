// Opt-in crowd benchmark (task 19.3; Requirements 8.1 to 8.4). Runs only with CROWD_BENCH=1 (`npm run test:bench:crowd`).
// 600 s case, 5 consecutive runs, none discarded. Each run builds the Plan, runs the fire, then the crowd through the
// in-process Worker_Wrapper logic (handleMessage). The combined median must stay under 10 s.
import { describe, expect, it } from 'vitest';
import { runFire } from '../../../src/core/fire/index';
import { handleMessage } from '../../../src/core/people/worker/handler';
import type { FromWorker } from '../../../src/core/people/worker/protocol';
import type { CrowdResult } from '../../../src/core/people/types';
import { buildBenchCrowdInput, buildBenchFireScenario, buildBenchPlan, BENCH_FULL_DURATION_S } from '../fixtures/benchCase';
const ENABLED = process.env['CROWD_BENCH'] === '1';
const RUNS = 5;
const BUDGET_MS = 10_000; // Requirement 8.1. Never loosened.
interface RunTimes {
  totalMs: number;
  planMs: number;
  fireMs: number;
  crowdMs: number;
  result: CrowdResult;
}
// Throws an Error that names the run when it does not complete.
function oneRun(run: number): RunTimes {
  try {
    const t0 = performance.now();
    const plan = buildBenchPlan();
    const t1 = performance.now();
    const fire = runFire(buildBenchFireScenario(BENCH_FULL_DURATION_S));
    const t2 = performance.now();
    if (fire.status !== 'ok') throw new Error(`fire status ${fire.status}: ${JSON.stringify(fire.warnings.slice(0, 3))}`);
    const msgs: FromWorker[] = [];
    handleMessage({ type: 'run', id: run, request: { input: buildBenchCrowdInput(plan, BENCH_FULL_DURATION_S), fire, recordStats: true } }, (m) => msgs.push(m));
    const t3 = performance.now();
    const last = msgs[msgs.length - 1];
    if (last === undefined || last.type !== 'result') throw new Error(`no result message (last: ${last?.type ?? 'none'})`);
    if (last.result.status !== 'ok') throw new Error(`crowd status ${last.result.status}: ${JSON.stringify(last.result.warnings.slice(0, 3))}`);
    return { totalMs: t3 - t0, planMs: t1 - t0, fireMs: t2 - t1, crowdMs: t3 - t2, result: last.result };
  } catch (e) {
    throw new Error(`benchmark run ${run} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
describe.skipIf(!ENABLED)('crowd benchmark (CROWD_BENCH=1)', () => {
  it(
    `combined median of ${RUNS} runs stays under ${BUDGET_MS / 1000} s`,
    () => {
      const runs: RunTimes[] = [];
      for (let i = 1; i <= RUNS; i++) runs.push(oneRun(i)); // a failing run throws with its number and no median is printed
      const medTotal = median(runs.map((r) => r.totalMs));
      const medFire = median(runs.map((r) => r.fireMs));
      const first = runs[0]!.result;
      const s = first.summary;
      const st = first.stats;
      console.log(
        [
          ...runs.map((r, i) => `crowd bench: run ${i + 1} = ${r.totalMs.toFixed(0)} ms (plan ${r.planMs.toFixed(0)}, fire ${r.fireMs.toFixed(0)}, crowd ${r.crowdMs.toFixed(0)})`),
          `crowd bench: median combined = ${medTotal.toFixed(0)} ms (limit ${BUDGET_MS} ms)`,
          `crowd bench: median fire = ${medFire.toFixed(0)} ms`,
          `crowd bench: fire share = ${((100 * medFire) / medTotal).toFixed(1)} % of the combined median`,
          `crowd bench: outcome out ${s?.out} / incapacitated ${s?.incapacitated} / still inside ${s?.stillInside} of ${s?.total}, evacuation time ${s?.evacuationTimeS ?? 'none'} s`,
          `crowd bench: steps ${st?.steps}, field recomputes ${st?.fieldRecomputes}, Dijkstra nodes settled ${st?.dijkstraNodes}`,
        ].join('\n'),
      );
      expect(medTotal).toBeLessThan(BUDGET_MS);
    },
    600_000,
  );
});
