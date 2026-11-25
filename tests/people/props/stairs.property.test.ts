// Feature: crowd, Property 8: Stair use follows a finite descending route
// Validates: Requirements 9.8, 2.8
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runCrowd } from '../../../src/core/people/index';
import { arbRunCaseWithExit } from '../runArbs';
describe('Property 8: stair use follows a finite descending route', () => {
  it('every stair entry and transfer keeps the grid cell and moves to a floor from which the chosen exit is reachable at a lower cost', () => {
    let entries = 0;
    let transfers = 0;
    fc.assert(
      fc.property(arbRunCaseWithExit, (c) => {
        const plan = c.plan;
        let bad: string | null = null;
        const entryCell = new Map<number, number>(); // agent -> cell where it entered the stair
        runCrowd(c.input, c.fire, {
          onStep: (v) => {
            const a = v.store;
            for (const e of v.stairEntries) {
              entries++;
              const link = plan.stairLinks[e.linkIndex]!;
              const choice = a.exitChoice[e.agent]!;
              const field = v.fields[choice]!;
              const from = plan.nodeOffset[e.fromFloor]! + e.cell;
              const to = plan.nodeOffset[e.toFloor]! + e.cell; // same grid position on the adjacent floor
              entryCell.set(e.agent, e.cell);
              if (!link.footprint.includes(e.cell)) bad ??= `step ${v.step}: agent ${e.agent} entered a stair outside its footprint`;
              if (Math.abs(e.fromFloor - e.toFloor) !== 1) bad ??= `step ${v.step}: stair link joins floors ${e.fromFloor} and ${e.toFloor}`;
              if (!(Number.isFinite(field.cost[to]!) && field.cost[to]! < field.cost[from]!)) {
                bad ??= `step ${v.step}: agent ${e.agent} entered a stair with cost ${field.cost[from]} -> ${field.cost[to]} to exit ${choice}`;
              }
            }
            for (const t of v.stairTransfers) {
              transfers++;
              if (entryCell.get(t.agent) !== t.cell) bad ??= `step ${v.step}: agent ${t.agent} arrived at cell ${t.cell}, entered at ${String(entryCell.get(t.agent))}`;
              if (Math.abs(t.fromFloor - t.toFloor) !== 1) bad ??= `step ${v.step}: transfer from floor ${t.fromFloor} to ${t.toFloor}`;
              if (a.floor[t.agent] !== t.toFloor || a.cell[t.agent] !== t.cell) bad ??= `step ${v.step}: agent ${t.agent} is not at the arrival cell`;
              // The arrival node still has a finite route to the chosen exit in the fields of this step.
              const choice = a.exitChoice[t.agent]!;
              const arrival = plan.nodeOffset[t.toFloor]! + t.cell;
              if (choice >= 0 && !Number.isFinite(v.fields[choice]!.cost[arrival]!)) {
                // Allowed only when the exit became unreachable on the whole route (no other exit has a finite cost either).
                const anyFinite = v.fields.some((f) => Number.isFinite(f.cost[arrival]!));
                if (anyFinite) bad ??= `step ${v.step}: agent ${t.agent} arrived on floor ${t.toFloor} with no route to its exit, though another exit is reachable`;
              }
            }
          },
        });
        expect(bad).toBeNull();
      }),
      { numRuns: 100 },
    );
    expect(entries).toBeGreaterThan(0);
    expect(transfers).toBeGreaterThan(0);
  });
});
