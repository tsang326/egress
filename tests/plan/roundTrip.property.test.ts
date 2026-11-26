import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CELL_DOOR, CELL_EXIT, CELL_WALL } from '../../src/core/people/types';
import { importBuildingModel } from '../../src/core/plan/import';
import type { BuildingModel } from '../../src/core/plan/types';
import { ALL_UNITS, gridPlanArb } from './helpers/planArbitraries';
import type { GridPlan } from './helpers/planArbitraries';

// Feature: plan-import, Property 1: DXF round trip of a generated grid plan
// **Validates: Requirements 1.3, 1.4, 1.5, 1.7, 7.1, 7.2, 7.3, 8.1, 8.2, 20.1**
// A generated plan is written as ASCII DXF (walls as lines, line pairs or outlines; gap, block-INSERT and bare-arc
// doors, mirrored and rotated through block transforms; a stair across floors), imported, and compared with what the
// generator placed: wall grid, Rooms, Doors, Exits and Stair_Links.

const importPlan = (plan: GridPlan) => {
  const layerMaps: Record<string, GridPlan['layerMap']> = {};
  for (const f of plan.files) layerMaps[f.fileName] = plan.layerMap;
  return importBuildingModel(plan.files, {
    layerMaps,
    drawingUnits: Object.fromEntries(plan.files.map((f) => [f.fileName, plan.spec.unit])),
    floorSettings: plan.floorSettings,
    stairRegions: plan.expected.stairRegions,
    exitDoorIds: plan.expected.exits.map((d) => d.id), // the user confirms the exits (Req 8.1)
  });
};

const ints = (a: ArrayLike<number>): number[] => Array.from(a);

function compare(plan: GridPlan, model: BuildingModel): void {
  // Grids: wall cells are the generator's wall cells, door and exit cells are the generator's door cells.
  expect(model.floors.map((f) => f.floorId)).toEqual(plan.floors.map((f) => f.floorId));
  for (const f of plan.floors) {
    const g = model.grids[f.floorId]!;
    expect([g.widthCells, g.heightCells]).toEqual([f.widthCells, f.heightCells]);
    for (let i = 0; i < f.wallMask.length; i++) {
      expect(g.cellType[i] === CELL_WALL).toBe(f.wallMask[i] === 1);
      expect(g.cellType[i] === CELL_DOOR || g.cellType[i] === CELL_EXIT).toBe(f.doorMask[i] === 1);
    }
  }
  // Rooms.
  expect(model.rooms.map((r) => r.id)).toEqual(plan.expected.rooms.map((r) => r.id));
  plan.expected.rooms.forEach((e, k) => {
    const r = model.rooms[k]!;
    expect(r.floorId).toBe(e.floorId);
    expect(r.kind).toBe(e.kind);
    expect(ints(r.cells)).toEqual(ints(e.cells));
    expect(r.areaM2).toBeCloseTo(e.areaM2, 9);
    expect(r.bboxWidthM).toBeCloseTo(e.bboxWidthM, 9);
    expect(r.bboxHeightM).toBeCloseTo(e.bboxHeightM, 9);
  });
  // Doors and exits.
  const doors = model.doors.filter((d) => !d.isWindow);
  expect(doors.map((d) => d.id)).toEqual(plan.expected.doors.map((d) => d.id));
  plan.expected.doors.forEach((e, k) => {
    const d = doors[k]!;
    expect(d.floorId).toBe(e.floorId);
    expect(ints(d.cells)).toEqual(ints(e.cells));
    expect(d.widthM).toBeCloseTo(e.widthM, 9);
    expect([d.roomIdA, d.roomIdB]).toEqual([e.roomIdA, e.roomIdB]);
    expect(d.isExit).toBe(e.isExit);
    expect(d.open).toBe(true);
  });
  expect(doors.filter((d) => d.isExit).map((d) => d.id)).toEqual(plan.expected.exits.map((d) => d.id));
  // Stair links.
  expect(model.stairLinks).toHaveLength(plan.expected.stairLinks.length);
  plan.expected.stairLinks.forEach((e, k) => {
    const s = model.stairLinks[k]!;
    expect([s.lowerFloorId, s.upperFloorId]).toEqual([e.lowerFloorId, e.upperFloorId]);
    expect(ints(s.footprint)).toEqual(ints(e.footprint));
    expect(s.widthM).toBeCloseTo(e.widthM, 9);
  });
}

describe('Property 1: DXF round trip of a generated grid plan', () => {
  it('imports back the Rooms, Doors, Exits and Stair_Links the generator placed', () => {
    fc.assert(
      fc.property(gridPlanArb(), (plan) => {
        const result = importPlan(plan);
        expect(result.status).toBe('ok');
        compare(plan, result.model!);
      }),
      { numRuns: 100 },
    );
  });

  it('holds in every drawing unit', () => {
    fc.assert(
      fc.property(gridPlanArb({ units: ALL_UNITS }), (plan) => {
        const result = importPlan(plan);
        expect(result.status).toBe('ok');
        compare(plan, result.model!);
      }),
      { numRuns: 50 },
    );
  });
});
