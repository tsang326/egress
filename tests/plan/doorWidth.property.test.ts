// Feature: plan-import, Property 9: Door width equals the fire vent width.
// Stage-level: placeDoors -> findRooms -> toFireGeometry on generated two-room grids (no import.ts).
// **Validates: Requirements 7.4, 14.2**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE_M } from '../../src/core/people/constants';
import { CELL_FREE, CELL_WALL } from '../../src/core/people/types';
import { toFireGeometry, ventIdOf } from '../../src/core/plan/derive/toFireGeometry';
import { placeDoors } from '../../src/core/plan/grid/doors';
import { findRooms } from '../../src/core/plan/grid/rooms';
import type { BuildingModel, Door } from '../../src/core/plan/types';
import type { WallVent } from '../../src/core/fire/types';

// Layout (cells): outside margin 0..1, outer wall ring at 2 and (W-3)/(H-3), interior wall column at x = split.
// Left room x 3..split-1, right room x split+1..W-4, both y 3..H-4. One interior gap and one exit gap in the bottom wall.
interface Layout {
  split: number;
  rightWidth: number;
  interiorGap: [number, number]; // inclusive rows on the interior wall
  exitGap: [number, number]; // inclusive columns on the bottom wall, inside the left room span
}

const H = 28; // inner rows 3..24 (22 cells = 5.5 m)
const gapArb = (lo: number, hi: number): fc.Arbitrary<[number, number]> =>
  // 2..8 cells = 0.5..2.0 m, inside DOOR_WIDTH_MIN_M..DOOR_WIDTH_MAX_M; never longer than the span lo..hi.
  fc.integer({ min: 2, max: Math.min(8, hi - lo + 1) }).chain((len) => fc.integer({ min: lo, max: hi - len + 1 }).map((s): [number, number] => [s, s + len - 1]));

const layoutArb: fc.Arbitrary<Layout> = fc
  .record({ split: fc.integer({ min: 12, max: 20 }), rightWidth: fc.integer({ min: 9, max: 16 }) })
  .chain(({ split, rightWidth }) =>
    fc.record({
      split: fc.constant(split),
      rightWidth: fc.constant(rightWidth),
      interiorGap: gapArb(6, H - 7),
      exitGap: gapArb(5, split - 3),
    }),
  );

function buildGrid(l: Layout): { w: number; cellType: Uint8Array } {
  const w = l.split + l.rightWidth + 7;
  const cellType = new Uint8Array(w * H).fill(CELL_FREE);
  const wall = (x: number, y: number): void => { cellType[y * w + x] = CELL_WALL; };
  for (let x = 2; x <= w - 3; x++) for (const y of [2, H - 3]) wall(x, y);
  for (let y = 2; y <= H - 3; y++) for (const x of [2, w - 3, l.split]) wall(x, y);
  for (let y = l.interiorGap[0]; y <= l.interiorGap[1]; y++) cellType[y * w + l.split] = CELL_FREE;
  for (let x = l.exitGap[0]; x <= l.exitGap[1]; x++) cellType[2 * w + x] = CELL_FREE;
  return { w, cellType };
}

function runStages(l: Layout) {
  const { w, cellType } = buildGrid(l);
  const placed = placeDoors({ floorId: 'f1', widthCells: w, heightCells: H, originXM: 0, originYM: 0, cellType, entities: [] });
  const found = findRooms({ floorId: 'f1', widthCells: w, heightCells: H, cellType: placed.cellType, doors: placed.doors });
  const doors: Door[] = found.doors.map((d) => ({
    id: d.id,
    floorId: d.floorId,
    cells: d.cells,
    widthM: d.widthM,
    open: d.open,
    roomIdA: d.roomIdA,
    roomIdB: d.roomIdB,
    isWindow: false,
    isExit: d.roomIdA === 'OUTSIDE' || d.roomIdB === 'OUTSIDE',
  }));
  const model: BuildingModel = {
    floors: [{ floorId: 'f1', name: 'Ground', elevationM: 0, ceilingHeightM: 2.6 }],
    floorSources: [],
    layerMaps: {},
    grids: { f1: { widthCells: w, heightCells: H, cellType: found.cellType } },
    rooms: found.rooms,
    doors,
    stairLinks: [],
    edits: [],
  };
  return { placed, found, model, geometry: toFireGeometry(model) };
}

describe('Property 9: door width equals the fire vent width', () => {
  it('every door width is across * 0.25 m and equals its WallVent width', () => {
    fc.assert(
      fc.property(layoutArb, (l) => {
        const { placed, model, geometry } = runStages(l);
        expect(model.doors).toHaveLength(2);
        expect(model.rooms).toHaveLength(2);
        for (const door of model.doors) {
          const draft = placed.doors.find((d) => d.id === door.id)!;
          expect(door.widthM).toBe(draft.across * CELL_SIZE_M);
          const vent = geometry.vents.find((v) => v.id === ventIdOf(door.id)) as WallVent | undefined;
          expect(vent).toBeDefined();
          expect(vent!.kind).toBe('wall');
          expect(vent!.widthM).toBe(door.widthM);
        }
        expect(geometry.warnings.filter((w) => w.code === 'VENT_WIDTH_CLAMPED')).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('example: a 3-cell gap is a 0.75 m door and a 0.75 m vent', () => {
    const { model, geometry } = runStages({ split: 14, rightWidth: 10, interiorGap: [10, 12], exitGap: [6, 8] });
    expect(model.doors.map((d) => d.widthM)).toEqual([0.75, 0.75]);
    expect(geometry.vents.map((v) => (v as WallVent).widthM)).toEqual([0.75, 0.75]);
  });
});
