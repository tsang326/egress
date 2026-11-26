// Feature: plan-import, Property 4: Agreement of the two derived outputs.
// Whole pipeline: importBuildingModel on generated grid plans, then the crowd PlanInput and the fire geometry are
// compared with the BuildingModel, fed to buildPlan, and (inside a minimal Scenario) to the fire input validator.
// **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 20.4, 20.8**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validate } from '../../src/core/fire/validate/validate';
import type { CeilingFloorVent, Fire, Scenario, WallVent } from '../../src/core/fire/types';
import { buildPlan } from '../../src/core/people/plan/builder';
import { CELL_DOOR, CELL_EXIT, CELL_WALL } from '../../src/core/people/types';
import { checkAgreement } from '../../src/core/plan/agreement';
import { fireKindOf } from '../../src/core/plan/derive/equivalentBox';
import { ventIdOf } from '../../src/core/plan/derive/toFireGeometry';
import { importBuildingModel } from '../../src/core/plan/import';
import type { ImportSettings } from '../../src/core/plan/types';
import { ALL_UNITS, gridPlanArb } from './helpers/planArbitraries';
import type { GridPlan } from './helpers/planArbitraries';

const OUTSIDE = 'OUTSIDE';

function settingsOf(p: GridPlan): ImportSettings {
  return {
    layerMaps: Object.fromEntries(p.files.map((f) => [f.fileName, { ...p.layerMap }])),
    drawingUnits: Object.fromEntries(p.files.map((f) => [f.fileName, p.spec.unit])),
    floorSettings: p.floorSettings,
    stairRegions: p.expected.stairRegions,
    exitDoorIds: p.expected.exits.map((d) => d.id),
  };
}

// A minimal fire scenario: the derived geometry plus one fire at the centre of the first compartment.
function minimalScenario(compartments: Scenario['compartments'], vents: Scenario['vents']): Scenario {
  const first = compartments[0]!;
  const fire: Fire = {
    id: 'fire1',
    compartmentId: first.id,
    xM: first.widthM / 2,
    yM: first.depthM / 2,
    radiativeFraction: 0.3,
    fuel: { c: 1, h: 4, o: 0, n: 0, cl: 0, heatOfCombustionJPerKg: 5e7 },
    table: [
      { timeS: 0, hrrW: 0, heightM: 0, areaM2: 0.1, coYield: 0.01, sootYield: 0.01 },
      { timeS: 60, hrrW: 1e5, heightM: 0, areaM2: 0.5, coYield: 0.01, sootYield: 0.01 },
    ],
  };
  return {
    schemaVersion: 1,
    durationS: 60,
    printIntervalS: 10,
    seed: 1,
    ambient: {
      interiorTempK: 293.15,
      exteriorTempK: 293.15,
      pressurePa: 101325,
      species: { o2: 0.2314, co2: 0.0005, co: 0, h2o: 0.0065, soot: 0 },
    },
    compartments,
    vents,
    fires: [fire],
  };
}

describe('Property 4: agreement of the two derived outputs', () => {
  it('crowd PlanInput and fire geometry agree with the model, and both are accepted downstream', () => {
    fc.assert(
      fc.property(gridPlanArb({ units: ALL_UNITS }), (p) => {
        const result = importBuildingModel(p.files, settingsOf(p));
        expect(result.status).toBe('ok');
        const model = result.model!;
        const { planInput, fire } = result.derived!;
        expect(result.warnings.filter((w) => w.code === 'AGREEMENT_BROKEN')).toEqual([]);
        expect(checkAgreement(model, planInput, fire)).toEqual([]);

        // 14.1 equal compartment id sets, 14.6 equal kind mapping
        const planKinds = new Map((planInput.compartments ?? []).map((c) => [c.id, c.kind]));
        expect([...planKinds.keys()].sort()).toEqual(fire.compartments.map((c) => c.id).sort());
        for (const r of model.rooms) {
          const want = fireKindOf(r.kind).kind;
          expect(planKinds.get(r.id)).toBe(want);
          expect(fire.compartments.find((c) => c.id === r.id)!.kind).toBe(want);
        }

        // 14.2-14.4 one wall vent per door, same sides and width, open 1 or 0; exits lead to OUTSIDE
        const cellsOf = new Map(planInput.floors.map((f) => [f.id, f.cells]));
        for (const d of model.doors) {
          const vents = fire.vents.filter((v) => v.id === ventIdOf(d.id));
          expect(vents).toHaveLength(1);
          const v = vents[0] as WallVent;
          expect(v.kind).toBe('wall');
          expect([v.from, v.to].sort()).toEqual([d.roomIdA, d.roomIdB].sort());
          expect(v.widthM).toBe(d.widthM);
          expect(v.open).toBe(d.open ? 1 : 0);
          if (d.isExit) expect([v.from, v.to]).toContain(OUTSIDE);
          const cells = cellsOf.get(d.floorId)!;
          for (const c of d.cells) {
            if (!d.open) expect([CELL_DOOR, CELL_EXIT]).not.toContain(cells[c]);
            else expect(cells[c]).toBe(d.isExit ? CELL_EXIT : CELL_DOOR);
          }
        }
        expect(model.doors.filter((d) => d.isExit).map((d) => d.id).sort()).toEqual(p.expected.exits.map((d) => d.id).sort());

        // 14.5 one CeilingFloorVent and one StairLinkInput per link, on the same two floors
        expect(planInput.stairLinks).toHaveLength(model.stairLinks.length);
        for (const link of model.stairLinks) {
          const vents = fire.vents.filter((v) => v.id === ventIdOf(link.id));
          expect(vents).toHaveLength(1);
          const v = vents[0] as CeilingFloorVent;
          expect(v.kind).toBe('ceilingFloor');
          const floorOf = (id: string) => model.rooms.find((r) => r.id === id)!.floorId;
          expect([floorOf(v.lower), floorOf(v.upper)]).toEqual([link.lowerFloorId, link.upperFloorId]);
          const inputs = planInput.stairLinks.filter((s) => s.id === link.id);
          expect(inputs).toHaveLength(1);
          expect([inputs[0]!.lowerFloorId, inputs[0]!.upperFloorId]).toEqual([link.lowerFloorId, link.upperFloorId]);
        }
        for (const g of model.floors) expect(cellsOf.has(g.floorId)).toBe(true);
        // wall cells are never overwritten by door cells in the crowd grid
        for (const [id, g] of Object.entries(model.grids)) {
          const cells = cellsOf.get(id)!;
          for (let i = 0; i < g.cellType.length; i++) if (g.cellType[i] === CELL_WALL) expect(cells[i]).toBe(CELL_WALL);
        }

        // 20.4, 20.8 downstream acceptance
        const plan = buildPlan(planInput);
        expect(plan.warnings.filter((w) => w.severity === 'error')).toEqual([]);
        expect(plan.status).toBe('valid');
        const checked = validate(minimalScenario(fire.compartments, fire.vents));
        expect(checked.warnings.filter((w) => w.severity === 'error')).toEqual([]);
        expect(checked.valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
