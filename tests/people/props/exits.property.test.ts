// Feature: crowd, Property 4: No exit or no reachable exit means nobody gets out
// Validates: Requirements 9.4, 1.6, 1.8, 2.12
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE_M } from '../../../src/core/people/constants';
import { STATE_MOVING, STATE_OUT } from '../../../src/core/people/agents/state';
import { runCrowd } from '../../../src/core/people/index';
import { isNode } from '../../../src/core/people/plan/grid';
import { buildPlan } from '../../../src/core/people/plan/builder';
import type { AgentInput, CrowdInput, Plan } from '../../../src/core/people/types';
import { arbAgents, arbFire, arbPlanParams, planInputFromParams } from '../arbitraries';
import { arbRunCase, arbRunCaseWithExit } from '../runArbs';
import { SHORT_DELAY } from '../runHelpers';
import { sealedExit } from '../samplePlans';
// Node of the cell under a start position (agents are generated on cell centres).
function startNode(plan: Plan, a: AgentInput): number {
  const f = plan.floors.find((fl) => fl.id === a.floorId)!;
  const cell = Math.floor(a.yM / CELL_SIZE_M) * f.widthCells + Math.floor(a.xM / CELL_SIZE_M);
  return plan.nodeOffset[f.index]! + cell;
}
const noFiniteCost = (plan: Plan, node: number): boolean => plan.baseFields.every((bf) => !Number.isFinite(bf.cost[node]!));
interface Seen {
  everMoving: boolean[];
  outCount: number;
}
function trackedRun(input: CrowdInput, fire: Parameters<typeof runCrowd>[1], n: number): { seen: Seen; result: ReturnType<typeof runCrowd> } {
  const seen: Seen = { everMoving: new Array<boolean>(n).fill(false), outCount: 0 };
  const result = runCrowd(input, fire, {
    onStep: (v) => {
      for (let i = 0; i < v.store.n; i++) {
        if (v.store.state[i] === STATE_MOVING) seen.everMoving[i] = true;
        if (v.store.state[i] === STATE_OUT) seen.outCount++;
      }
    },
  });
  return { seen, result };
}
describe('Property 4: no exit or no reachable exit means nobody gets out', () => {
  it('a plan with no exit cell is invalid with NO_EXIT and nobody is out', () => {
    let checked = 0;
    fc.assert(
      fc.property(arbRunCase, (c) => {
        if (c.plan.exits.length > 0) return;
        checked++;
        const r = runCrowd(c.input, c.fire);
        expect(r.status).toBe('invalid');
        expect(r.warnings.some((w) => w.code === 'NO_EXIT')).toBe(true);
        expect(r.agents.filter((a) => a.finalState === 'out')).toHaveLength(0);
        expect(r.summary).toBeNull();
      }),
      { numRuns: 100 },
    );
    expect(checked).toBeGreaterThan(0); // the generator does produce the no-exit variant
  });
  it('an agent with no finite cost to any exit is never out, and is flagged Blocked with AGENT_BLOCKED once it moves', () => {
    let trappedSeen = 0;
    fc.assert(
      fc.property(arbRunCaseWithExit, (c) => {
        const included = c.agents.filter((a) => a.type === 'visitor' || a.type === 'staff');
        const trapped = included.map((a) => noFiniteCost(c.plan, startNode(c.plan, a)));
        const { seen, result: r } = trackedRun(c.input, c.fire, included.length);
        r.agents.forEach((rec, i) => {
          if (!trapped[i]) return;
          trappedSeen++;
          expect(rec.finalState).not.toBe('out');
          expect(rec.exitTimeS).toBeNull();
          if (seen.everMoving[i]) {
            expect(rec.everBlocked).toBe(true);
            expect(r.warnings.some((w) => w.code === 'AGENT_BLOCKED' && w.location.id === rec.id)).toBe(true);
          }
        });
      }),
      { numRuns: 100 },
    );
    expect(trappedSeen).toBeGreaterThan(0); // pockets and stair-less upper floors do produce trapped agents
  });
  it('every exit sealed off from the agents: nobody is out at any step and every agent that moved is flagged Blocked', () => {
    const plan = sealedExit().plan;
    // Agents start only where no exit can be reached (the sealed pocket itself holds the exit, so it is left out).
    const arbTrapped = arbAgents(plan).map((list) => list.filter((a) => noFiniteCost(plan, startNode(plan, a))));
    fc.assert(
      fc.property(arbTrapped, arbFire(plan), fc.integer({ min: 0, max: 0x7fffffff }), (agents, gen, seed) => {
        const input: CrowdInput = { schemaVersion: 1, durationS: gen.durationS, seed, plan, agents, delay: SHORT_DELAY };
        const { seen, result: r } = trackedRun(input, gen.fire, agents.length);
        expect(seen.outCount).toBe(0);
        expect(r.status).toBe('ok');
        expect(r.agents.every((a) => a.finalState !== 'out')).toBe(true);
        expect(r.summary!.out).toBe(0);
        expect(r.summary!.evacuationTimeS).toBeNull();
        r.agents.forEach((rec, i) => {
          if (seen.everMoving[i]) expect(rec.everBlocked).toBe(true);
        });
      }),
      { numRuns: 100 },
    );
  });
  it('the Plan builder gives UNREACHABLE_REGION warnings exactly when some walkable node has no finite cost to any exit', () => {
    fc.assert(
      fc.property(arbPlanParams, (p) => {
        const r = buildPlan(planInputFromParams(p));
        expect(r.status).toBe('valid');
        const plan = r.plan!;
        let unreachedNodes = 0;
        for (const f of plan.floors) {
          for (let cell = 0; cell < f.cellType.length; cell++) {
            if (isNode(f, cell) && noFiniteCost(plan, plan.nodeOffset[f.index]! + cell)) unreachedNodes++;
          }
        }
        const regions = r.warnings.filter((w) => w.code === 'UNREACHABLE_REGION').length;
        expect(regions > 0).toBe(unreachedNodes > 0);
        expect(regions).toBeLessThanOrEqual(unreachedNodes);
      }),
      { numRuns: 100 },
    );
  });
});
