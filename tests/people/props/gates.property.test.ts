// Feature: crowd, Property 6: Door flow limit and first-in first-out release
// Validates: Requirements 9.6, 2.9, 2.10
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DOOR_SPECIFIC_FLOW_PER_S_M, FLOW_WINDOW_S, TIME_STEP_S } from '../../../src/core/people/constants';
import { runCrowd } from '../../../src/core/people/index';
import type { AgentInput, CrowdInput } from '../../../src/core/people/types';
import { CELL_FREE } from '../../../src/core/people/types';
import { arbPlanWithExit } from '../arbitraries';
import { arbRunCaseWithExit } from '../runArbs';
import { agentAtCell, noFire, SHORT_DELAY } from '../runHelpers';
const WINDOW_STEPS = Math.round(FLOW_WINDOW_S / TIME_STEP_S);
const DOOR_BOUNDARY_M = 0.15; // Requirement 2.9: 0.15 m each side, so W_eff = W - 0.3 m
const SNAP = 1e-9; // snaps a product such as 13 * 0.7 that lands just below a whole number
const TIMEOUT_MS = 120_000; // a property run of 100 crowds with a per-step check is slower than the default 5 s
// Independent of the model: W_eff = max(W - 0.3 m, 0.25 m); limit = floor(10 s x 1.3 x W_eff).
const doorLimit = (widthM: number): number => Math.floor(FLOW_WINDOW_S * DOOR_SPECIFIC_FLOW_PER_S_M * Math.max(widthM - 2 * DOOR_BOUNDARY_M, 0.25) + SNAP);
interface Check {
  crossingSteps: number[][]; // per gate
  bad: string | null;
}
function runAndCheck(input: CrowdInput, fire: Parameters<typeof runCrowd>[1], gateCount: number): Check {
  const out: Check = { crossingSteps: Array.from({ length: gateCount }, () => []), bad: null };
  const queues: number[][] = Array.from({ length: gateCount }, () => []); // model FIFO per gate, agent numbers
  runCrowd(input, fire, {
    onStep: (v) => {
      const a = v.store;
      for (const e of v.enrolments) {
        const q = queues[e.gateId]!;
        const at = q.indexOf(e.agent);
        if (at >= 0) q.splice(at, 1); // enrolling again after leaving the queue puts the agent at the back
        q.push(e.agent);
      }
      const crossingNow = new Set<number>();
      for (const c of v.crossings) crossingNow.add(c.agent);
      // Entries that are no longer queued at the gate (left without crossing, or crossing now) are not in line any more.
      const live = (g: number, ag: number): boolean => a.gateEnrolled[ag] === g || crossingNow.has(ag);
      for (const c of v.crossings) {
        const q = queues[c.gateId]!;
        while (q.length > 0 && q[0] !== c.agent && !live(c.gateId, q[0]!)) q.shift();
        if (q[0] !== c.agent) out.bad ??= `step ${v.step}: agent ${c.agent} crossed gate ${c.gateId} out of order (head ${String(q[0])})`;
        else q.shift();
        out.crossingSteps[c.gateId]!.push(v.step);
      }
      for (let g = 0; g < gateCount; g++) if (queues[g]!.length > 0) queues[g] = queues[g]!.filter((ag) => a.gateEnrolled[ag] === g);
    },
  });
  return out;
}
// `steps` is ascending. For every half-open window [t, t + WINDOW_STEPS) starting at a crossing, count the crossings in it.
function windowViolation(steps: readonly number[], limit: number): string | null {
  let j = 0;
  for (let i = 0; i < steps.length; i++) {
    if (j < i) j = i;
    while (j < steps.length && steps[j]! < steps[i]! + WINDOW_STEPS) j++;
    if (j - i > limit) return `${j - i} crossings in the window starting at step ${steps[i]}, limit ${limit}`;
  }
  return null;
}
function checkGates(plan: CrowdInput['plan'], r: Check): void {
  plan.gates.forEach((g, id) => {
    let limit: number;
    if (g.kind === 'stair') limit = Math.floor(FLOW_WINDOW_S * g.specificFlowPerSM * g.effectiveWidthM + SNAP);
    else {
      limit = doorLimit(g.widthM);
      expect(g.effectiveWidthM).toBeCloseTo(Math.max(g.widthM - 0.3, 0.25), 12);
      expect(limit).toBeLessThanOrEqual(Math.floor(DOOR_SPECIFIC_FLOW_PER_S_M * FLOW_WINDOW_S * g.widthM + SNAP)); // at most 1.3 x 10 x W
    }
    expect(windowViolation(r.crossingSteps[id]!, Math.max(1, limit)), `gate ${g.label}`).toBeNull();
  });
}
describe('Property 6: door flow limit and first-in first-out release', () => {
  it(
    'no gate passes more than floor(10 x 1.3 x W_eff) persons in any 10 s window and releases in order of enrolment',
    () => {
      let crossingsSeen = 0;
      fc.assert(
        fc.property(arbRunCaseWithExit, (c) => {
          const r = runAndCheck(c.input, c.fire, c.plan.gates.length);
          expect(r.bad).toBeNull();
          for (const s of r.crossingSteps) crossingsSeen += s.length;
          checkGates(c.plan, r);
        }),
        { numRuns: 100 },
      );
      expect(crossingsSeen).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );
  it(
    'a dense crowd (one agent per free cell, all starting at once) also respects the limit and the order',
    () => {
      const arbCrowd = arbPlanWithExit.chain((plan) =>
        fc.integer({ min: 0, max: 0x7fffffff }).map((seed) => {
          const agents: AgentInput[] = [];
          for (const f of plan.floors) {
            for (let cell = 0; cell < f.cellType.length && agents.length < 40; cell++) {
              if (f.cellType[cell] !== CELL_FREE || f.fitsAgent[cell] !== 1) continue;
              const x = cell % f.widthCells;
              agents.push(agentAtCell(`a${agents.length}`, agents.length % 2 === 0 ? 'staff' : 'visitor', f.id, x, (cell - x) / f.widthCells));
            }
          }
          const input: CrowdInput = { schemaVersion: 1, durationS: 45, seed, plan, agents, delay: SHORT_DELAY };
          return { plan, input };
        }),
      );
      fc.assert(
        fc.property(arbCrowd, ({ plan, input }) => {
          const r = runAndCheck(input, noFire(plan, 45), plan.gates.length);
          expect(r.bad).toBeNull();
          checkGates(plan, r);
        }),
        { numRuns: 100 },
      );
    },
    TIMEOUT_MS,
  );
});
