// Feature: crowd, Property 5: Flow_Field is strictly descending and optimal
// Validates: Requirements 9.5, 2.2, 2.3, 1.9
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { floorOfNode } from '../../../src/core/people/plan/reachability';
import { arbPlan } from '../arbitraries';
import { bellmanFord, closeEnough, countExitGroups } from '../flowReference';

describe('Property 5: Flow_Field is strictly descending and optimal', () => {
  it('next[] descends strictly to an exit cell, values match Bellman-Ford, one field per exit group', () => {
    fc.assert(
      fc.property(arbPlan, (plan) => {
        if (plan.baseFields.length !== countExitGroups(plan)) return false;
        if (plan.baseFields.length !== plan.exits.length) return false;
        for (const field of plan.baseFields) {
          const exit = plan.exits[field.exitIndex]!;
          const ref = bellmanFord(plan, field.exitIndex);
          for (let v = 0; v < plan.nodeCount; v++) {
            if (!closeEnough(field.cost[v]!, ref[v]!)) return false;
            if (field.cost[v] === Infinity) {
              if (field.next[v] !== -1) return false;
              continue;
            }
            // Follow next[] to the exit: the sequence of values strictly decreases and ends at 0 in the exit group.
            let node = v;
            let steps = 0;
            while (field.cost[node]! > 0) {
              const nx = field.next[node]!;
              if (nx < 0 || !(field.cost[nx]! < field.cost[node]!)) return false;
              node = nx;
              if (++steps > plan.nodeCount) return false;
            }
            const floor = floorOfNode(plan.nodeOffset, node);
            if (floor !== exit.floorIndex) return false;
            if (!exit.cells.includes(node - plan.nodeOffset[floor]!)) return false;
          }
        }
        return true;
      }),
    );
  });
});
