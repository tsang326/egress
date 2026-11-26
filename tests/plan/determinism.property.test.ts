import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importBuildingModel } from '../../src/core/plan/import';
import type { ImportSettings, ImportSource } from '../../src/core/plan/types';
import { buildBoardingHouse } from '../../tools/samples/boardingHouse';
import { buildCafe } from '../../tools/samples/cafe';
import { buildKaraoke } from '../../tools/samples/karaoke';
import { ALL_UNITS, gridPlanArb } from './helpers/planArbitraries';

// Feature: plan-import, Property 7: Determinism
// **Validates: Requirements 6.6, 14.7, 18.6, 22.4**

// Deep clone that keeps typed arrays, so the second call gets deep-equal but not identical arguments.
const clone = <T>(v: T): T => structuredClone(v);

describe('Property 7: importBuildingModel is deterministic', () => {
  it('two calls with deep-equal generated plans give deep-equal results, including cell grids', () => {
    fc.assert(
      fc.property(gridPlanArb({ units: ALL_UNITS }), (plan) => {
        const settings: ImportSettings = {
          layerMaps: Object.fromEntries(plan.files.map((f) => [f.fileName, plan.layerMap])),
          floorSettings: plan.floorSettings,
          drawingUnits: Object.fromEntries(plan.files.map((f) => [f.fileName, plan.spec.unit])),
        };
        const a = importBuildingModel(clone(plan.files), clone(settings));
        const b = importBuildingModel(clone(plan.files), clone(settings));
        expect(b).toStrictEqual(a);
        // Byte-level check of the cell grids, on top of the deep equality above.
        for (const [id, g] of Object.entries(a.model?.grids ?? {})) {
          expect(Buffer.from(b.model!.grids[id]!.cellType).equals(Buffer.from(g.cellType))).toBe(true);
        }
      }),
      { numRuns: 25 },
    );
  });

  it('the sample buildings give deep-equal results on repeated calls', () => {
    const samples: ImportSource[] = [
      { fileName: 'cafe.dxf', text: buildCafe() },
      { fileName: 'karaoke.dxf', text: buildKaraoke() },
      { fileName: 'boarding.dxf', text: buildBoardingHouse() },
    ];
    for (const s of samples) {
      const a = importBuildingModel([{ ...s }]);
      const b = importBuildingModel([{ ...s }]);
      expect(b).toStrictEqual(a);
    }
  });
});
