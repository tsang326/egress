import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importBuildingModel } from '../../src/core/plan/import';
import { loadProject } from '../../src/core/plan/project/load';
import { saveProject } from '../../src/core/plan/project/save';
import type { Edit, ImportSettings, RoomKind } from '../../src/core/plan/types';
import { ALL_UNITS, gridPlanArb } from './helpers/planArbitraries';
import type { GridPlan } from './helpers/planArbitraries';

// Feature: plan-import, Property 5: Project file save/load round trip
// **Validates: Requirements 16.3, 16.4, 20.5**
// A generated grid plan is imported with layer maps, units, floor settings, exit marks, stair regions, roof vents and
// user edits (room names, room kinds, door and window open/closed). The model is saved and the text loaded again.
// The reloaded sources, settings, model and derived PlanInput, Compartments and Vents must equal the originals
// exactly (toStrictEqual: same values, same typed-array types, bit-identical numbers).

const KINDS: readonly RoomKind[] = ['room', 'corridor', 'stair'];

const editSeedArb = fc.record({
  pick: fc.nat(1000),
  name: fc.string({ maxLength: 12 }),
  kind: fc.constantFrom(...KINDS),
  open: fc.boolean(),
  what: fc.constantFrom('rename', 'kind', 'door', 'none'),
});

function baseSettings(plan: GridPlan, withExits: boolean): ImportSettings {
  const layerMaps: NonNullable<ImportSettings['layerMaps']> = {};
  for (const f of plan.files) layerMaps[f.fileName] = plan.layerMap;
  return {
    layerMaps,
    drawingUnits: Object.fromEntries(plan.files.map((f) => [f.fileName, plan.spec.unit])),
    floorSettings: plan.floorSettings,
    stairRegions: plan.expected.stairRegions,
    exitDoorIds: withExits ? plan.expected.exits.map((d) => d.id) : [],
  };
}

describe('Property 5: project file save/load round trip', () => {
  it('reloading a saved project reproduces the PlanInput, Compartments and Vents bit for bit', () => {
    fc.assert(
      fc.property(
        gridPlanArb({ units: ALL_UNITS }),
        fc.array(editSeedArb, { maxLength: 6 }),
        fc.boolean(),
        fc.option(fc.double({ min: 0.1, max: 4, noNaN: true }), { nil: undefined }),
        (plan, seeds, withExits, roofArea) => {
          const settings = baseSettings(plan, withExits);
          if (roofArea !== undefined) settings.roofVents = [{ floorId: plan.floors[0]!.floorId, areaM2: roofArea, openFraction: 0.5 }];
          // First pass: find the ids the user could edit.
          const first = importBuildingModel(plan.files, settings);
          expect(first.model).not.toBeNull();
          const rooms = first.model!.rooms;
          const doors = first.model!.doors;
          const edits: Edit[] = [];
          for (const s of seeds) {
            if (s.what === 'rename' && rooms.length > 0) edits.push({ kind: 'renameRoom', roomId: rooms[s.pick % rooms.length]!.id, name: s.name });
            else if (s.what === 'kind' && rooms.length > 0) edits.push({ kind: 'setRoomKind', roomId: rooms[s.pick % rooms.length]!.id, roomKind: s.kind });
            else if (s.what === 'door' && doors.length > 0) {
              const d = doors[s.pick % doors.length]!;
              edits.push(d.isWindow ? { kind: 'setWindowOpen', windowId: d.id, open: s.open } : { kind: 'setDoorOpen', doorId: d.id, open: s.open });
            }
          }
          settings.edits = edits;
          const before = importBuildingModel(plan.files, settings);
          expect(before.model).not.toBeNull();
          expect(before.derived).toBeDefined();

          const text = saveProject({ sources: plan.files, settings, model: before.model });
          const loaded = loadProject(text);
          expect(loaded.status).toBe('ok');
          if (loaded.status !== 'ok') return;

          expect(loaded.sources).toStrictEqual(plan.files.map((f) => ({ fileName: f.fileName, text: f.text })));
          expect(loaded.result.model).toStrictEqual(before.model);
          expect(loaded.result.derived!.planInput).toStrictEqual(before.derived!.planInput);
          expect(loaded.result.derived!.fire.compartments).toStrictEqual(before.derived!.fire.compartments);
          expect(loaded.result.derived!.fire.vents).toStrictEqual(before.derived!.fire.vents);

          // Saving what was loaded gives the same text: the file is a fixed point.
          const again = saveProject({ sources: loaded.sources, settings: loaded.settings, model: loaded.result.model });
          expect(again).toBe(text);
        },
      ),
      { numRuns: 25 },
    );
  });
});
