import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CELL_DOOR, CELL_FREE, CELL_WALL } from '../../src/core/people/types';
import type { DoorDraft } from '../../src/core/plan/grid/doors';
import { applyEdits, undoLastEdit } from '../../src/core/plan/model/edits';
import type { EditsInput } from '../../src/core/plan/model/edits';
import type { Door, Edit } from '../../src/core/plan/types';

// Feature: plan-import, Property 12: Edit application is replay-stable and out-of-range edits are no-ops
// **Validates: Requirements 15.4, 15.5, 15.7**

// Grid 24 x 12: outer wall, inner wall at x = 12 with a door at y = 5..7 (same plan as edits.test.ts).
const W = 24;
const H = 12;
const idx = (x: number, y: number): number => y * W + x;

function baseInput(edits: readonly Edit[]): EditsInput {
  const cellType = new Uint8Array(W * H).fill(CELL_FREE);
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) cellType[idx(x, y)] = CELL_WALL;
  for (let y = 0; y < H; y++) for (const x of [0, W - 1, 12]) cellType[idx(x, y)] = CELL_WALL;
  const cells = Int32Array.from([idx(12, 5), idx(12, 6), idx(12, 7)]);
  for (const c of cells) cellType[c] = CELL_DOOR;
  const doors: DoorDraft[] = [{ id: 'f1:door1', floorId: 'f1', cells, widthM: 0.75, across: 3, direction: 'y', source: 'gap' }];
  const windows: Door[] = [
    { id: 'f1:window1', floorId: 'f1', cells: Int32Array.from([idx(5, 0)]), widthM: 0.25, open: false, roomIdA: 'f1:room1', roomIdB: 'OUTSIDE', isWindow: true, isExit: false },
  ];
  return { floors: [{ floorId: 'f1', widthCells: W, heightCells: H, cellType, doors }], windows, edits };
}

// Derived outputs of a run (everything but the edit list).
const outputs = (edits: readonly Edit[]) => applyEdits(baseInput(edits));

// Cells strictly inside the free interior of the left room, away from the door column: always free in the base grid.
const freeCell = fc.record({ x: fc.integer({ min: 1, max: 11 }), y: fc.integer({ min: 1, max: 10 }) });
const freeCells = fc.uniqueArray(freeCell, { minLength: 1, maxLength: 12, selector: (c) => `${c.x},${c.y}` });

const outsideCell = fc.oneof(
  fc.record({ x: fc.integer({ min: -50, max: -1 }), y: fc.integer({ min: 0, max: H - 1 }) }),
  fc.record({ x: fc.integer({ min: W, max: W + 50 }), y: fc.integer({ min: 0, max: H - 1 }) }),
  fc.record({ x: fc.integer({ min: 0, max: W - 1 }), y: fc.integer({ min: -50, max: -1 }) }),
  fc.record({ x: fc.integer({ min: 0, max: W - 1 }), y: fc.integer({ min: H, max: H + 50 }) }),
);

const badEdit: fc.Arbitrary<Edit> = fc.oneof(
  // a cell outside the grid, possibly mixed with valid cells: the whole edit is ignored
  fc
    .tuple(fc.constantFrom('paintWall', 'eraseWall' as const), fc.array(freeCell, { maxLength: 3 }), outsideCell)
    .map(([kind, ok, bad]) => ({ kind, floorId: 'f1', cells: [...ok, bad] }) as Edit),
  // a floor that does not exist
  fc
    .tuple(fc.constantFrom('paintWall', 'eraseWall' as const), freeCells, fc.constantFrom('nofloor', 'f2', ''))
    .map(([kind, cells, floorId]) => ({ kind, floorId, cells }) as Edit),
  fc.constantFrom('nodoor', 'f9:door1').map((doorId): Edit => ({ kind: 'setDoorOpen', doorId, open: false })),
  fc.constantFrom('nowin', 'f9:window1').map((windowId): Edit => ({ kind: 'setWindowOpen', windowId, open: true })),
);

// Valid edits, each paired with its inverse.
const goodEdit: fc.Arbitrary<{ edit: Edit; inverse: Edit }> = fc.oneof(
  freeCells.map((cells) => ({
    edit: { kind: 'paintWall', floorId: 'f1', cells } as Edit,
    inverse: { kind: 'eraseWall', floorId: 'f1', cells } as Edit,
  })),
  fc.boolean().map(() => ({
    edit: { kind: 'setDoorOpen', doorId: 'f1:door1', open: false } as Edit,
    inverse: { kind: 'setDoorOpen', doorId: 'f1:door1', open: true } as Edit,
  })),
  fc.constant({
    edit: { kind: 'setWindowOpen', windowId: 'f1:window1', open: true } as Edit,
    inverse: { kind: 'setWindowOpen', windowId: 'f1:window1', open: false } as Edit,
  }),
);

describe('Property 12: edit application is replay-stable and out-of-range edits are no-ops', () => {
  it('replaying the same edit list gives identical results (Req 15.4)', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(goodEdit.map((g) => g.edit), badEdit), { maxLength: 8 }), (edits) => {
        expect(outputs(edits)).toEqual(outputs(edits));
      }),
      { numRuns: 100 },
    );
  });

  it('an edit outside the grid or on a missing floor changes nothing except one EDIT_IGNORED warning (Req 15.7)', () => {
    fc.assert(
      fc.property(fc.array(goodEdit.map((g) => g.edit), { maxLength: 4 }), badEdit, (prefix, bad) => {
        const before = outputs(prefix);
        const after = outputs([...prefix, bad]);
        expect(after.floors).toEqual(before.floors);
        expect(after.windows).toEqual(before.windows);
        expect(after.warnings.slice(0, before.warnings.length)).toEqual(before.warnings);
        const extra = after.warnings.slice(before.warnings.length);
        expect(extra.map((w) => w.code)).toEqual(['EDIT_IGNORED']);
      }),
      { numRuns: 100 },
    );
  });

  it('an edit followed by its inverse reproduces the pre-edit outputs (Req 15.4)', () => {
    fc.assert(
      fc.property(goodEdit, ({ edit, inverse }) => {
        const before = outputs([]);
        const after = outputs([edit, inverse]);
        expect(after.floors).toEqual(before.floors);
        expect(after.windows).toEqual(before.windows);
        expect(after.warnings).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('undoing the last edit reproduces the outputs without it (Req 15.5)', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(goodEdit.map((g) => g.edit), badEdit), { minLength: 1, maxLength: 8 }), (edits) => {
        expect(outputs(undoLastEdit(edits))).toEqual(outputs(edits.slice(0, -1)));
        expect(outputs(undoLastEdit([...edits, ...[]]).concat(edits.slice(-1)))).toEqual(outputs(edits));
      }),
      { numRuns: 100 },
    );
  });
});
