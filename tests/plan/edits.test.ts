import { describe, expect, it } from 'vitest';
import { CELL_DOOR, CELL_FREE, CELL_WALL } from '../../src/core/people/types';
import type { DoorDraft } from '../../src/core/plan/grid/doors';
import { appendEdit, applyEdits, undoLastEdit } from '../../src/core/plan/model/edits';
import type { EditsInput } from '../../src/core/plan/model/edits';
import type { Door, Edit } from '../../src/core/plan/types';

// Grid 24 x 12 cells. Outer wall on the border, inner wall at x = 12 with a door at y = 5..7 (same plan as rooms.test.ts).
const W = 24;
const H = 12;
const idx = (x: number, y: number): number => y * W + x;

function plan(): { cellType: Uint8Array; doors: DoorDraft[] } {
  const cellType = new Uint8Array(W * H).fill(CELL_FREE);
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) cellType[idx(x, y)] = CELL_WALL;
  for (let y = 0; y < H; y++) for (const x of [0, W - 1, 12]) cellType[idx(x, y)] = CELL_WALL;
  const cells = Int32Array.from([idx(12, 5), idx(12, 6), idx(12, 7)]);
  for (const c of cells) cellType[c] = CELL_DOOR;
  return { cellType, doors: [{ id: 'f1:door1', floorId: 'f1', cells, widthM: 0.75, across: 3, direction: 'y', source: 'gap' }] };
}

const windowAt = (open = false): Door => ({
  id: 'f1:window1',
  floorId: 'f1',
  cells: Int32Array.from([idx(5, 0)]),
  widthM: 0.25,
  open,
  roomIdA: 'f1:room1',
  roomIdB: 'OUTSIDE',
  isWindow: true,
  isExit: false,
});

function run(edits: Edit[], windows: Door[] = [windowAt()]) {
  const p = plan();
  const input: EditsInput = {
    floors: [{ floorId: 'f1', widthCells: W, heightCells: H, cellType: p.cellType, doors: p.doors }],
    windows,
    edits,
  };
  return { result: applyEdits(input), input, original: p.cellType.slice() };
}

const cell = (x: number, y: number) => ({ x, y });
const col = (x: number, y0: number, y1: number) => Array.from({ length: y1 - y0 + 1 }, (_, i) => cell(x, y0 + i));
const codes = (r: ReturnType<typeof run>): string[] => r.result.warnings.map((w) => w.code);

describe('applyEdits', () => {
  it('with no edits returns the imported rooms and no warnings', () => {
    const r = run([]);
    expect(r.result.floors[0]!.rooms.rooms.map((x) => x.id)).toEqual(['f1:room1', 'f1:room2']);
    expect(r.result.warnings).toEqual([]);
  });

  it('paintWall splits a room and eraseWall merges rooms again (Req 15.4)', () => {
    const split = run([{ kind: 'paintWall', floorId: 'f1', cells: col(6, 1, 10) }]);
    expect(split.result.floors[0]!.rooms.rooms).toHaveLength(3);
    const back = run([
      { kind: 'paintWall', floorId: 'f1', cells: col(6, 1, 10) },
      { kind: 'eraseWall', floorId: 'f1', cells: col(6, 1, 10) },
    ]);
    expect(back.result.floors[0]!.rooms.rooms).toHaveLength(2);
    expect(back.result.warnings).toEqual([]);
  });

  it('does not modify the input grid', () => {
    const r = run([{ kind: 'paintWall', floorId: 'f1', cells: col(6, 1, 10) }]);
    expect(r.input.floors[0]!.cellType).toEqual(r.original);
  });

  it('setDoorOpen closes and reopens a door (Req 15.4)', () => {
    const closed = run([{ kind: 'setDoorOpen', doorId: 'f1:door1', open: false }]);
    expect(closed.result.floors[0]!.rooms.doors[0]!.open).toBe(false);
    const reopened = run([
      { kind: 'setDoorOpen', doorId: 'f1:door1', open: false },
      { kind: 'setDoorOpen', doorId: 'f1:door1', open: true },
    ]);
    expect(reopened.result.floors[0]!.rooms.doors[0]!.open).toBe(true);
  });

  it('setWindowOpen opens a window; windows are closed by default (Req 15.9)', () => {
    expect(run([]).result.windows[0]!.open).toBe(false);
    const r = run([{ kind: 'setWindowOpen', windowId: 'f1:window1', open: true }]);
    expect(r.result.windows[0]!.open).toBe(true);
  });

  it('renameRoom and setRoomKind change name and kind (Req 15.4)', () => {
    const r = run([
      { kind: 'renameRoom', roomId: 'f1:room2', name: 'Kitchen' },
      { kind: 'setRoomKind', roomId: 'f1:room1', roomKind: 'corridor' },
    ]);
    const [a, b] = r.result.floors[0]!.rooms.rooms;
    expect(b!.name).toBe('Kitchen');
    expect(a!.kind).toBe('corridor');
    expect(r.result.warnings).toEqual([]);
  });

  it('a name of 0 or 61 characters is ignored; 1 and 60 are kept (Req 15.4, 8.3)', () => {
    expect(codes(run([{ kind: 'renameRoom', roomId: 'f1:room1', name: '' }]))).toEqual(['EDIT_IGNORED']);
    expect(codes(run([{ kind: 'renameRoom', roomId: 'f1:room1', name: 'x'.repeat(61) }]))).toEqual(['EDIT_IGNORED']);
    const ok = run([{ kind: 'renameRoom', roomId: 'f1:room1', name: 'y'.repeat(60) }]);
    expect(ok.result.floors[0]!.rooms.rooms[0]!.name).toBe('y'.repeat(60));
  });

  it('undo removes the last edit and replay gives the earlier result (Req 15.5)', () => {
    const first: Edit = { kind: 'renameRoom', roomId: 'f1:room1', name: 'Hall' };
    const second: Edit = { kind: 'paintWall', floorId: 'f1', cells: col(6, 1, 10) };
    const list = appendEdit(appendEdit([], first), second);
    expect(list).toHaveLength(2);
    const undone = undoLastEdit(list);
    expect(undone).toEqual([first]);
    expect(list).toHaveLength(2); // input not modified
    expect(undoLastEdit([])).toEqual([]);
    expect(run(undone).result).toEqual(run([first]).result);
    expect(run(undone).result.floors[0]!.rooms.rooms).toHaveLength(2);
  });

  it('replay is deterministic (Req 15.4)', () => {
    const edits: Edit[] = [
      { kind: 'paintWall', floorId: 'f1', cells: col(6, 1, 10) },
      { kind: 'renameRoom', roomId: 'f1:room3', name: 'Back' },
    ];
    expect(run(edits).result).toEqual(run(edits).result);
  });

  describe('identity when rooms merge or split (Req 15.6)', () => {
    it('merge: the name of a room that no longer starts a room is dropped with ROOM_IDENTITY_LOST', () => {
      const r = run([
        { kind: 'renameRoom', roomId: 'f1:room1', name: 'Hall' },
        { kind: 'renameRoom', roomId: 'f1:room2', name: 'Store' },
        { kind: 'eraseWall', floorId: 'f1', cells: [cell(12, 1)] },
      ]);
      const rooms = r.result.floors[0]!.rooms.rooms;
      expect(rooms).toHaveLength(1);
      expect(rooms[0]!.name).toBe('Hall');
      const lost = r.result.warnings.filter((w) => w.code === 'ROOM_IDENTITY_LOST');
      expect(lost).toHaveLength(1);
      expect(lost[0]!.message).toContain('room2');
    });

    it('split: the room whose first cell is unchanged keeps name and kind; no warning', () => {
      const r = run([
        { kind: 'renameRoom', roomId: 'f1:room1', name: 'Hall' },
        { kind: 'setRoomKind', roomId: 'f1:room2', roomKind: 'corridor' },
        { kind: 'paintWall', floorId: 'f1', cells: col(6, 1, 10) },
      ]);
      const rooms = r.result.floors[0]!.rooms.rooms;
      expect(rooms.map((x) => x.id)).toEqual(['f1:room1', 'f1:room2', 'f1:room3']);
      expect(rooms[0]!.name).toBe('Hall'); // left part keeps its first cell
      expect(rooms[1]!.name).toBe('Room 2'); // new room, nothing stored
      expect(rooms[2]!.kind).toBe('corridor'); // old room2 is now room3, first cell unchanged
      expect(r.result.warnings).toEqual([]);
    });

    it('a room with no stored name or kind adds no warning when it merges', () => {
      const r = run([{ kind: 'eraseWall', floorId: 'f1', cells: [cell(12, 1)] }]);
      expect(r.result.warnings).toEqual([]);
    });
  });

  describe('edits that cannot apply are ignored with EDIT_IGNORED (Req 15.7)', () => {
    it('a cell outside the grid ignores the whole edit, even if other cells are valid', () => {
      const r = run([{ kind: 'paintWall', floorId: 'f1', cells: [cell(6, 3), cell(W, 3)] }]);
      expect(codes(r)).toEqual(['EDIT_IGNORED']);
      expect(r.result.floors[0]!.rooms.rooms).toHaveLength(2);
      const negative = run([{ kind: 'eraseWall', floorId: 'f1', cells: [cell(-1, 0)] }]);
      expect(codes(negative)).toEqual(['EDIT_IGNORED']);
    });

    it('a missing floor, a door cell, an empty list and a fractional cell are ignored', () => {
      expect(codes(run([{ kind: 'paintWall', floorId: 'nope', cells: [cell(3, 3)] }]))).toEqual(['EDIT_IGNORED']);
      expect(codes(run([{ kind: 'paintWall', floorId: 'f1', cells: [cell(12, 6)] }]))).toEqual(['EDIT_IGNORED']);
      expect(codes(run([{ kind: 'paintWall', floorId: 'f1', cells: [] }]))).toEqual(['EDIT_IGNORED']);
      expect(codes(run([{ kind: 'paintWall', floorId: 'f1', cells: [cell(2.5, 3)] }]))).toEqual(['EDIT_IGNORED']);
    });

    it('unknown door, window and room ids are ignored, and later edits still apply', () => {
      const r = run([
        { kind: 'setDoorOpen', doorId: 'f1:door9', open: false },
        { kind: 'setWindowOpen', windowId: 'f1:window9', open: true },
        { kind: 'renameRoom', roomId: 'f1:room9', name: 'X' },
        { kind: 'setRoomKind', roomId: 'f1:room9', roomKind: 'stair' },
        { kind: 'renameRoom', roomId: 'f1:room1', name: 'Hall' },
      ]);
      expect(codes(r)).toEqual(['EDIT_IGNORED', 'EDIT_IGNORED', 'EDIT_IGNORED', 'EDIT_IGNORED']);
      expect(r.result.floors[0]!.rooms.rooms[0]!.name).toBe('Hall');
    });

    it('an out-of-range edit changes nothing compared with no edit', () => {
      const base = run([]).result.floors;
      const r = run([{ kind: 'paintWall', floorId: 'f1', cells: [cell(100, 100)] }]);
      expect(r.result.floors).toEqual(base);
    });
  });
});
