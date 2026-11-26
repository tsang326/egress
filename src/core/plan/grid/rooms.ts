// Rooms: 4-connected flood fill over the wall grid with doors placed (Req 8.1 to 8.7). Pure and total: integer cell
// arithmetic, row-major scan, iterative (no recursion), no clock, no random, never throws. Linear in the grid size.
//
// REGIONS. Cells that are neither CELL_WALL nor CELL_DOOR are grouped by 4-connectivity. Door cells are never passable,
// whether the door is open or closed, so closing a door cannot change the rooms (Req 8.1). Regions are found in
// row-major order of their first cell (row 0 is the lowest y), as for door ids.
// OUTSIDE (Req 8.5). A region with a cell on the grid border is the outside area. It creates no Room. If it covers more
// than OUTSIDE_REGION_WARN_FRACTION of the grid and no door has it on a side, ROOM_OUTSIDE_LARGE is added for the floor.
// SLIVERS (Req 8.6). A region of less than MIN_ROOM_AREA_M2 that is not outside is discarded: its cells become wall and
// ROOM_TOO_SMALL names the floor and the position of its first cell.
// IDS (Req 8.2). Surviving rooms are numbered `${floorId}:room${k}`, k from 1 in row-major order of the first cell.
// COMPARTMENT IDS (Req 8.7). `roomIndexOfCell[cell]` is the index into `rooms` of the room whose id is the compartment
// id of that cell, or -1 (wall, outside, no room). Free, exit and stair cells take their own room. A door cell takes the
// lower room id of the two sides (the lower k, not the string order); a door between a room and the outside takes the room.
// DOOR SIDES. For a door, side A is the cells next to the door band on the low coordinate side across the door, side B
// the high side (for direction 'x', across is y; for 'y', across is x). A side beyond the grid edge or in the outside
// region is 'OUTSIDE'. With several cells on a side (a wide door) the lowest room id wins. A door whose side has no room
// and no outside (all wall, or a discarded sliver) is dropped: its cells become wall and DOOR_DISCARDED is added (Req 7.6).
// Door ids are not renumbered after a drop, so ids stay the ones placeDoors gave.
import { CELL_SIZE_M } from '../../people/constants';
import { CELL_DOOR, CELL_WALL } from '../../people/types';
import { MIN_ROOM_AREA_M2, NAME_LENGTH_MAX, NAME_LENGTH_MIN, OUTSIDE_REGION_WARN_FRACTION } from '../constants';
import type { Door, ImportWarning, Room } from '../types';
import { doorDiscarded, roomOutsideLarge, roomTooSmall } from '../warnings';
import type { DoorDraft } from './doors';

export interface RoomsInput {
  floorId: string;
  widthCells: number;
  heightCells: number;
  cellType: Uint8Array; // after placeDoors: CELL_WALL, CELL_DOOR and non-wall cells; not modified
  doors: readonly DoorDraft[];
}

// A door with its sides known. `open` is true (the import default); `isWindow` and `isExit` are set by later steps.
export type RoomsDoor = Door & { direction: 'x' | 'y'; source: DoorDraft['source'] };

export interface RoomsResult {
  cellType: Uint8Array; // copy of the input; sliver cells and dropped-door cells are CELL_WALL
  rooms: Room[]; // in id order
  doors: RoomsDoor[]; // kept doors, in id order
  roomIndexOfCell: Int32Array; // index into `rooms` per cell, -1 for none (Req 8.7)
  outsideCells: Uint8Array; // 1 for cells of the outside area
  outsideFractionOfGrid: number; // share of the grid covered by the outside area
  warnings: ImportWarning[];
}

// Req 8.3: a room name has 1 to 60 characters.
export function isValidRoomName(name: unknown): name is string {
  return typeof name === 'string' && name.length >= NAME_LENGTH_MIN && name.length <= NAME_LENGTH_MAX;
}

const validGrid = (n: number): boolean => Number.isInteger(n) && n > 0;
const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

interface Region {
  first: number; // first cell, row-major
  count: number;
  border: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// Labels every passable cell with a region number (0-based, in order of first cell); -1 for wall and door cells.
function labelRegions(w: number, h: number, cellType: Uint8Array): { label: Int32Array; regions: Region[] } {
  const label = new Int32Array(w * h).fill(-1);
  const regions: Region[] = [];
  const stack = new Int32Array(w * h);
  const passable = (i: number): boolean => cellType[i] !== CELL_WALL && cellType[i] !== CELL_DOOR;
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || !passable(start)) continue;
    const id = regions.length;
    const r: Region = { first: start, count: 0, border: false, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    let sp = 0;
    stack[sp++] = start;
    label[start] = id;
    while (sp > 0) {
      const i = stack[--sp] as number;
      const x = i % w;
      const y = (i - x) / w;
      r.count++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) r.border = true;
      if (x < r.minX) r.minX = x;
      if (x > r.maxX) r.maxX = x;
      if (y < r.minY) r.minY = y;
      if (y > r.maxY) r.maxY = y;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (label[n] === -1 && passable(n)) {
          label[n] = id;
          stack[sp++] = n;
        }
      }
    }
    regions.push(r);
  }
  return { label, regions };
}

const OUTSIDE = 'OUTSIDE' as const;
type Side = { kind: 'outside' } | { kind: 'room'; index: number } | { kind: 'none' };

export function findRooms(input: RoomsInput): RoomsResult {
  const { floorId, widthCells: w, heightCells: h } = input;
  if (!validGrid(w) || !validGrid(h) || !(input.cellType instanceof Uint8Array) || input.cellType.length !== w * h) {
    const n = validGrid(w) && validGrid(h) ? w * h : 0;
    return {
      cellType: input.cellType instanceof Uint8Array ? input.cellType.slice() : new Uint8Array(0),
      rooms: [],
      doors: [],
      roomIndexOfCell: new Int32Array(n).fill(-1),
      outsideCells: new Uint8Array(n),
      outsideFractionOfGrid: 0,
      warnings: [],
    };
  }
  const warnings: ImportWarning[] = [];
  const cellType = input.cellType.slice();
  const { label, regions } = labelRegions(w, h, cellType);

  // Which regions become rooms: not border, area at least MIN_ROOM_AREA_M2. Numbered in region (first-cell) order.
  const roomOfRegion = new Int32Array(regions.length).fill(-1);
  const rooms: Room[] = [];
  const roomRegion: number[] = [];
  const cellAreaM2 = CELL_SIZE_M * CELL_SIZE_M;
  regions.forEach((r, ri) => {
    if (r.border) return;
    const areaM2 = r.count * cellAreaM2;
    if (areaM2 < MIN_ROOM_AREA_M2) {
      const x = r.first % w;
      warnings.push(roomTooSmall(`(${x}, ${Math.floor(r.first / w)})`, floorId, areaM2));
      return;
    }
    const k = rooms.length + 1;
    roomOfRegion[ri] = rooms.length;
    roomRegion.push(ri);
    rooms.push({
      id: `${floorId}:room${k}`,
      floorId,
      name: `Room ${k}`, // Req 8.3: default name from the id
      kind: 'room', // Req 8.4
      cells: new Int32Array(r.count),
      areaM2,
      bboxWidthM: (r.maxX - r.minX + 1) * CELL_SIZE_M,
      bboxHeightM: (r.maxY - r.minY + 1) * CELL_SIZE_M,
      touchesBorder: false,
    });
  });

  // Cells: ascending fill of each room's cell list, room index per cell, sliver cells to wall, outside mask.
  const roomIndexOfCell = new Int32Array(w * h).fill(-1);
  const outsideCells = new Uint8Array(w * h);
  const fill = new Int32Array(rooms.length);
  let outsideCount = 0;
  for (let i = 0; i < w * h; i++) {
    const ri = label[i] as number;
    if (ri < 0) continue;
    const room = roomOfRegion[ri] as number;
    if (room >= 0) {
      roomIndexOfCell[i] = room;
      const slot = fill[room] as number;
      (rooms[room] as Room).cells[slot] = i;
      fill[room] = slot + 1;
    } else if ((regions[ri] as Region).border) {
      outsideCells[i] = 1;
      outsideCount++;
    } else {
      cellType[i] = CELL_WALL; // Req 8.6
    }
  }

  // Sides of doors.
  const sideOf = (x: number, y: number): Side => {
    if (x < 0 || y < 0 || x >= w || y >= h) return { kind: 'outside' };
    const i = y * w + x;
    if (outsideCells[i] === 1) return { kind: 'outside' };
    const room = roomIndexOfCell[i] as number;
    return room >= 0 ? { kind: 'room', index: room } : { kind: 'none' };
  };
  const better = (a: Side, b: Side): Side => {
    // room (lowest index) over outside over none
    if (a.kind === 'room' && b.kind === 'room') return a.index <= b.index ? a : b;
    if (a.kind === 'room') return a;
    if (b.kind === 'room') return b;
    return a.kind === 'outside' ? a : b;
  };

  const doors: RoomsDoor[] = [];
  const touchedOutside = new Uint8Array(regions.length);
  const labelAt = (i: number): number => label[i] as number;
  for (const d of input.doors) {
    const inDoor = new Set<number>(d.cells);
    let sideA: Side = { kind: 'none' };
    let sideB: Side = { kind: 'none' };
    const sidesRegions: number[] = [];
    for (const c of d.cells) {
      const x = c % w;
      const y = (c - x) / w;
      const [dx, dy] = d.direction === 'x' ? [0, 1] : [1, 0]; // across the door
      const probe = (nx: number, ny: number): Side | null => {
        const inGrid = nx >= 0 && ny >= 0 && nx < w && ny < h;
        if (inGrid && inDoor.has(ny * w + nx)) return null; // another cell of the same door band
        if (inGrid) sidesRegions.push(labelAt(ny * w + nx));
        return sideOf(nx, ny);
      };
      const a = probe(x - dx, y - dy);
      if (a !== null) sideA = better(sideA, a);
      const b = probe(x + dx, y + dy);
      if (b !== null) sideB = better(sideB, b);
    }
    if (sideA.kind === 'none' || sideB.kind === 'none') {
      const first = d.cells[0] as number;
      warnings.push(doorDiscarded(floorId, first % w, Math.floor(first / w)));
      for (const c of d.cells) cellType[c] = CELL_WALL;
      continue;
    }
    for (const r of sidesRegions) if (r >= 0 && (regions[r] as Region).border) touchedOutside[r] = 1;
    const idOf = (s: Side): string | typeof OUTSIDE => (s.kind === 'room' ? (rooms[s.index] as Room).id : OUTSIDE);
    doors.push({
      id: d.id,
      floorId: d.floorId,
      cells: d.cells,
      widthM: d.widthM,
      open: true,
      roomIdA: idOf(sideA),
      roomIdB: idOf(sideB),
      isWindow: false,
      isExit: false,
      direction: d.direction,
      source: d.source,
    });
    // Req 8.7: door cells take the lower room id of the sides.
    const low = sideA.kind === 'room' && sideB.kind === 'room' ? Math.min(sideA.index, sideB.index) : sideA.kind === 'room' ? sideA.index : sideB.kind === 'room' ? sideB.index : -1;
    for (const c of d.cells) roomIndexOfCell[c] = low;
  }

  // Req 8.5: a large outside region that no door opens onto.
  const gridCells = w * h;
  let outsideFractionOfGrid = outsideCount / gridCells;
  regions.forEach((r, ri) => {
    if (!r.border) return;
    const fraction = r.count / gridCells;
    if (fraction > OUTSIDE_REGION_WARN_FRACTION && touchedOutside[ri] !== 1) warnings.push(roomOutsideLarge(floorId, fraction));
  });
  if (!Number.isFinite(outsideFractionOfGrid)) outsideFractionOfGrid = 0;

  return { cellType, rooms, doors, roomIndexOfCell, outsideCells, outsideFractionOfGrid, warnings };
}
