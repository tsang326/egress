// Checks that the crowd generators cover the variants the property tests rely on (task 3.3).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CELL_WALL } from '../../src/core/people/types';
import { arbAgents, arbFire, arbNoFire, arbPlan, arbPlanWithExit } from './arbitraries';
import { allSamples, INVENTED_NOTE } from './samplePlans';

describe('crowd generators', () => {
  it('arbPlan covers 1 to 3 floors, stair links, doors, sealed pockets and no-exit plans', () => {
    const plans = fc.sample(arbPlan, { numRuns: 300, seed: 1 });
    const floors = new Set(plans.map((p) => p.floors.length));
    expect([...floors].sort()).toEqual([1, 2, 3]);
    expect(plans.some((p) => p.stairLinks.length > 0)).toBe(true);
    expect(plans.some((p) => p.exits.length === 0)).toBe(true);
    expect(plans.some((p) => p.exits.length === 3)).toBe(true);
    expect(plans.some((p) => p.gates.some((g) => g.kind === 'door'))).toBe(true);
    // Sealed pocket: a walkable node on the ground floor with no route to the first exit.
    const hasPocket = plans.some((p) => {
      const field = p.baseFields[0];
      if (!field) return false;
      const f = p.floors[0]!;
      for (let c = 0; c < f.cellType.length; c++) if (f.cellType[c] !== CELL_WALL && f.fitsAgent[c] === 1 && field.cost[c] === Infinity) return true;
      return false;
    });
    expect(hasPocket).toBe(true);
  });
  it('arbPlanWithExit always has an exit', () => {
    for (const p of fc.sample(arbPlanWithExit, { numRuns: 100, seed: 2 })) expect(p.exits.length).toBeGreaterThan(0);
  });
  it('arbAgents places agents on free cells of the plan, both types, at most 30', () => {
    const plan = fc.sample(arbPlanWithExit, { numRuns: 1, seed: 3 })[0]!;
    const lists = fc.sample(arbAgents(plan), { numRuns: 100, seed: 4 });
    for (const l of lists) expect(l.length).toBeLessThanOrEqual(30);
    const all = lists.flat();
    expect(all.some((a) => a.type === 'visitor')).toBe(true);
    expect(all.some((a) => a.type === 'staff')).toBe(true);
    expect(all.some((a) => a.type === 'visitor' && a.entryExitId === undefined)).toBe(true);
  });
  it('arbFire and arbNoFire give an ok fire Result with every plan compartment and 30 to 120 s', () => {
    const plan = fc.sample(arbPlanWithExit, { numRuns: 1, seed: 5 })[0]!;
    for (const g of [...fc.sample(arbFire(plan), { numRuns: 20, seed: 6 }), ...fc.sample(arbNoFire(plan), { numRuns: 20, seed: 7 })]) {
      expect(g.fire.status).toBe('ok');
      expect(g.durationS).toBeGreaterThanOrEqual(30);
      expect(g.durationS).toBeLessThanOrEqual(120);
      expect(g.fire.compartments.map((c) => c.id)).toEqual(plan.compartmentIds);
    }
  });
  it('every sample plan says it is invented', () => {
    for (const s of allSamples()) expect(s.note).toBe(INVENTED_NOTE);
    expect(INVENTED_NOTE).toContain('Invented');
  });
});
