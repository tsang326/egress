// Feature: plan-import, Property 2: Unit scaling agreement.
// The same grid plan written in mm, cm, m, in or ft (with the matching $INSUNITS) imports to the same grid and the
// same compartment ids as the plan written in metres with $INSUNITS = 6. Variants are compared with each other,
// not with the helper's expected masks.
// **Validates: Requirements 2.1, 20.2**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importBuildingModel } from '../../src/core/plan/import';
import type { ImportResult, ImportSettings } from '../../src/core/plan/types';
import { ALL_UNITS, buildGridPlan, gridPlanSpecArb } from './helpers/planArbitraries';
import type { GridPlan, GridPlanSpec } from './helpers/planArbitraries';

function importPlan(plan: GridPlan): ImportResult {
  const layerMaps: NonNullable<ImportSettings['layerMaps']> = {};
  for (const f of plan.files) layerMaps[f.fileName] = plan.layerMap;
  return importBuildingModel(plan.files, { layerMaps, floorSettings: plan.floorSettings });
}

describe('Property 2: unit scaling agreement', () => {
  it('any known unit imports to the same grid and compartment ids as the metre version (Req 2.1, 20.2)', () => {
    fc.assert(
      fc.property(gridPlanSpecArb({ units: ALL_UNITS }), (spec: GridPlanSpec) => {
        const inUnit = buildGridPlan(spec);
        const inMetres = buildGridPlan({ ...spec, unit: 'm' });
        const a = importPlan(inUnit);
        const b = importPlan(inMetres);

        expect(a.pendingQuestions).toEqual([]);
        expect(a.status).toBe(b.status);
        // The metre plan is a valid building, so a null model would make the comparison vacuous.
        expect(b.model).not.toBeNull();
        expect(a.model).not.toBeNull();
        if (a.model === null || b.model === null) return;
        expect(a.model.floors.map((f) => f.floorId)).toEqual(b.model.floors.map((f) => f.floorId));
        for (const floor of b.model.floors) {
          const ga = a.model.grids[floor.floorId]!;
          const gb = b.model.grids[floor.floorId]!;
          expect(ga.widthCells).toBe(gb.widthCells);
          expect(ga.heightCells).toBe(gb.heightCells);
          expect(Array.from(ga.cellType)).toEqual(Array.from(gb.cellType));
        }
        expect(a.model.rooms.map((r) => r.id)).toEqual(b.model.rooms.map((r) => r.id));
        expect(a.model.rooms.map((r) => Array.from(r.cells))).toEqual(b.model.rooms.map((r) => Array.from(r.cells)));
        expect(a.model.doors.map((d) => [d.id, d.roomIdA, d.roomIdB])).toEqual(b.model.doors.map((d) => [d.id, d.roomIdA, d.roomIdB]));
      }),
      { numRuns: 100 },
    );
  });
});
