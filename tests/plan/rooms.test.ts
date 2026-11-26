import { describe, expect, it } from 'vitest';
import { CELL_DOOR, CELL_FREE, CELL_WALL } from '../../src/core/people/types';
import { NAME_LENGTH_MAX, NAME_LENGTH_MIN } from '../../src/core/plan/constants';
import type { DoorDraft } from '../../src/core/plan/grid/doors';
import { findRooms, isValidRoomName } from '../../src/core/plan/grid/rooms';

// Grid 24 x 12 cells (0.25 m). Outer wall on the grid border, inner wall at x = 12 with a door band at y = 5..7.
const W = 24;
const H = 12;
const idx = (x: number, y: number): number => y * W + x;

function twoRooms(withDoor: boolean): { cellType: Uint8Array; doors: DoorDraft[] } {
  const cellType = new Uint8Array(W * H).fill(CELL_FREE);
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) cellType[idx(x, y)] = CELL_WALL;
  for (let y = 0; y < H; y++) for (const x of [0, W - 1, 12]) cellType[idx(x, y)] = CELL_WALL;
  const doors: DoorDraft[] = [];
  if (withDoor) {
    const cells = Int32Array.from([idx(12, 5), idx(12, 6), idx(12, 7)]);
    for (const c of cells) cellType[c] = CELL_DOOR;
    doors.push({ id: 'f1:door1', floorId: 'f1', cells, widthM: 0.75, across: 3, direction: 'y', source: 'gap' });
  }
  return { cellType, doors };
}

const run = (cellType: Uint8Array, doors: DoorDraft[], w = W, h = H) =>
  findRooms({ floorId: 'f1', widthCells: w, heightCells: h, cellType, doors });
const codes = (r: ReturnType<typeof run>): string[] => r.warnings.map((x) => x.code);

describe('findRooms', () => {
  it('a door band separates two rooms and joins them in the door record (Req 8.1)', () => {
    const { cellType, doors } = twoRooms(true);
    const r = run(cellType, doors);
    expect(r.rooms.map((x) => x.id)).toEqual(['f1:room1', 'f1:room2']);
    const [a, b] = r.rooms;
    expect(a!.cells).toHaveLength(11 * 10); // x 1..11, y 1..10
    expect(b!.cells).toHaveLength(10 * 10); // x 13..22, y 1..10
    expect(a!.areaM2).toBeCloseTo(110 * 0.0625, 10);
    expect(r.doors).toHaveLength(1);
    expect(r.doors[0]!.roomIdA).toBe('f1:room1');
    expect(r.doors[0]!.roomIdB).toBe('f1:room2');
    expect(r.warnings).toEqual([]);
  });

  it('door cells are not passable, so a closed door leaves the rooms unchanged (Req 8.1)', () => {
    const withDoor = run(twoRooms(true).cellType, twoRooms(true).doors);
    const solid = twoRooms(false);
    for (let y = 5; y <= 7; y++) solid.cellType[idx(12, y)] = CELL_WALL;
    const walled = run(solid.cellType, []);
    expect(withDoor.rooms.map((x) => Array.from(x.cells))).toEqual(walled.rooms.map((x) => Array.from(x.cells)));
    expect(withDoor.rooms.map((x) => x.id)).toEqual(walled.rooms.map((x) => x.id));
  });

  it('ids are stable: repeated runs are identical, numbered in row-major order of the first cell (Req 8.2)', () => {
    const { cellType, doors } = twoRooms(true);
    const first = run(cellType, doors);
    const second = run(cellType, doors);
    expect(second).toEqual(first);
    // room1's first cell (x=1,y=1) comes before room2's (x=13,y=1)
    expect(first.rooms[0]!.cells[0]).toBe(idx(1, 1));
    expect(first.rooms[1]!.cells[0]).toBe(idx(13, 1));
  });

  it('does not modify the input grid', () => {
    const { cellType, doors } = twoRooms(true);
    const copy = cellType.slice();
    run(cellType, doors);
    expect(cellType).toEqual(copy);
  });

  it('defaults: name from id, kind room, bounding box in metres (Req 8.3, 8.4)', () => {
    const r = run(twoRooms(true).cellType, twoRooms(true).doors);
    expect(r.rooms[0]!.name).toBe('Room 1');
    expect(r.rooms[1]!.name).toBe('Room 2');
    expect(r.rooms[0]!.kind).toBe('room');
    expect(r.rooms[0]!.bboxWidthM).toBeCloseTo(11 * 0.25, 10);
    expect(r.rooms[0]!.bboxHeightM).toBeCloseTo(10 * 0.25, 10);
  });

  it('name length bounds are 1 to 60 characters (Req 8.3)', () => {
    expect(NAME_LENGTH_MIN).toBe(1);
    expect(NAME_LENGTH_MAX).toBe(60);
    expect(isValidRoomName('')).toBe(false);
    expect(isValidRoomName('a')).toBe(true);
    expect(isValidRoomName('a'.repeat(60))).toBe(true);
    expect(isValidRoomName('a'.repeat(61))).toBe(false);
    expect(isValidRoomName(5)).toBe(false);
  });

  it('door cells take the lower room id; others take their own room (Req 8.7)', () => {
    const { cellType, doors } = twoRooms(true);
    const r = run(cellType, doors);
    for (let y = 5; y <= 7; y++) expect(r.roomIndexOfCell[idx(12, y)]).toBe(0);
    expect(r.roomIndexOfCell[idx(3, 3)]).toBe(0);
    expect(r.roomIndexOfCell[idx(20, 3)]).toBe(1);
    expect(r.roomIndexOfCell[idx(12, 2)]).toBe(-1); // wall
  });

  it('a door between a room and the outside takes the room (Req 8.7)', () => {
    // Room spans x 0..11 with its right wall at x = 11; the wall has a door at y = 5..7; x 12.. is outside.
    const cellType = new Uint8Array(W * H).fill(CELL_FREE);
    for (let x = 2; x <= 11; x++) for (const y of [2, 9]) cellType[idx(x, y)] = CELL_WALL;
    for (let y = 2; y <= 9; y++) for (const x of [2, 11]) cellType[idx(x, y)] = CELL_WALL;
    const cells = Int32Array.from([idx(11, 5), idx(11, 6), idx(11, 7)]);
    for (const c of cells) cellType[c] = CELL_DOOR;
    const door: DoorDraft = { id: 'f1:door1', floorId: 'f1', cells, widthM: 0.75, across: 3, direction: 'y', source: 'gap' };
    const r = run(cellType, [door]);
    expect(r.rooms).toHaveLength(1);
    expect(r.doors[0]!.roomIdA).toBe('f1:room1');
    expect(r.doors[0]!.roomIdB).toBe('OUTSIDE');
    for (const c of cells) expect(r.roomIndexOfCell[c]).toBe(0);
    expect(codes(r)).not.toContain('ROOM_OUTSIDE_LARGE');
  });

  it('the border-touching region creates no room (Req 8.5)', () => {
    const cellType = new Uint8Array(W * H).fill(CELL_FREE);
    const r = run(cellType, []);
    expect(r.rooms).toHaveLength(0);
    expect(r.outsideFractionOfGrid).toBe(1);
  });

  it('warns ROOM_OUTSIDE_LARGE when a large outside area has no exterior door (Req 8.5)', () => {
    const w = 40;
    const h = 40;
    const cellType = new Uint8Array(w * h).fill(CELL_FREE);
    for (let i = 10; i <= 29; i++) for (const [x, y] of [[i, 10], [i, 29], [10, i], [29, i]] as const) cellType[y * w + x] = CELL_WALL;
    const r = run(cellType, [], w, h);
    expect(r.rooms).toHaveLength(1);
    expect(codes(r)).toEqual(['ROOM_OUTSIDE_LARGE']);
    expect(r.outsideFractionOfGrid).toBeGreaterThan(0.25);
  });

  it('a sliver under 1 m2 is discarded, becomes wall and warns (Req 8.6)', () => {
    const w = 40;
    const h = 40;
    const cellType = new Uint8Array(w * h).fill(CELL_FREE);
    // 3 x 3 cells inside a wall ring: 9 cells = 0.5625 m2
    for (let i = 10; i <= 14; i++) for (const [x, y] of [[i, 10], [i, 14], [10, i], [14, i]] as const) cellType[y * w + x] = CELL_WALL;
    const r = run(cellType, [], w, h);
    expect(r.rooms).toHaveLength(0);
    expect(codes(r)).toContain('ROOM_TOO_SMALL');
    for (let y = 11; y <= 13; y++) for (let x = 11; x <= 13; x++) expect(r.cellType[y * w + x]).toBe(CELL_WALL);
  });

  it('a region of exactly 1 m2 (16 cells) is kept (Req 8.6)', () => {
    const w = 40;
    const h = 40;
    const cellType = new Uint8Array(w * h).fill(CELL_FREE);
    for (let i = 10; i <= 15; i++) for (const [x, y] of [[i, 10], [i, 15], [10, i], [15, i]] as const) cellType[y * w + x] = CELL_WALL;
    const r = run(cellType, [], w, h);
    expect(r.rooms).toHaveLength(1);
    expect(r.rooms[0]!.areaM2).toBe(1);
    expect(codes(r)).not.toContain('ROOM_TOO_SMALL');
  });

  it('drops a door with a wall on one side and warns DOOR_DISCARDED (Req 7.6)', () => {
    const { cellType } = twoRooms(false);
    // door band in the outer wall column x = 0 at y 5..7 would face the grid edge (outside) and a room: kept.
    // Put the band inside the thick wall instead: x = 12 and x = 13 are wall, door at x = 12 has a wall on side B.
    for (let y = 0; y < H; y++) cellType[idx(13, y)] = CELL_WALL;
    const cells = Int32Array.from([idx(12, 5), idx(12, 6), idx(12, 7)]);
    for (const c of cells) cellType[c] = CELL_DOOR;
    const door: DoorDraft = { id: 'f1:door1', floorId: 'f1', cells, widthM: 0.75, across: 3, direction: 'y', source: 'gap' };
    const r = run(cellType, [door]);
    expect(r.doors).toHaveLength(0);
    expect(codes(r)).toContain('DOOR_DISCARDED');
    for (const c of cells) expect(r.cellType[c]).toBe(CELL_WALL);
  });

  it('invalid grid input returns an empty result without throwing', () => {
    const r = findRooms({ floorId: 'f1', widthCells: 0, heightCells: 3, cellType: new Uint8Array(0), doors: [] });
    expect(r.rooms).toEqual([]);
    expect(r.doors).toEqual([]);
  });
});
