import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ALL_UNITS, buildGridPlan, gridPlanArb, gridPlanSpecArb } from './planArbitraries';

describe('gridPlanArb', () => {
  it('builds consistent expectations within the model limits (Req 20.1, 20.8)', () => {
    fc.assert(
      fc.property(gridPlanArb({ units: ALL_UNITS }), (p) => {
        expect(p.files).toHaveLength(p.spec.floors.length);
        expect(p.expected.exits.length).toBeGreaterThan(0);
        expect(p.expected.rooms.length).toBeLessThanOrEqual(30);
        expect(p.expected.doors.length).toBeLessThanOrEqual(60);
        expect(p.expected.stairLinks).toHaveLength(p.spec.withStair ? p.spec.floors.length - 1 : 0);
        for (const d of p.expected.doors) {
          const floor = p.floors.find((f) => f.floorId === d.floorId)!;
          for (const c of d.cells) {
            expect(floor.wallMask[c]).toBe(0);
            expect(floor.doorMask[c]).toBe(1);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic for one spec', () => {
    fc.assert(
      fc.property(gridPlanSpecArb(), (spec) => {
        expect(buildGridPlan(spec).files).toEqual(buildGridPlan(spec).files);
      }),
      { numRuns: 20 },
    );
  });
});
