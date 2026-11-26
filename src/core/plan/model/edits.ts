// Edits: replay of the user's light edits on the imported grid (Req 8.3, 15.1 to 15.9). Pure and total: no clock, no
// random, never throws; a bad edit is ignored with EDIT_IGNORED and the rest still apply.
//
// REPLAY (Req 15.4). `applyEdits` starts from the imported grid of every floor (after placeDoors, before rooms) and
// walks the edit list in recorded order, so the same list always gives the same result (Req 15.8). Undo (Req 15.5) is
// `undoLastEdit`: the caller stores the shorter list and calls `applyEdits` again; nothing is kept between calls.
//  - paintWall / eraseWall change wall cells of the floor grid. An edit with any cell outside the grid, a cell that is
//    not a whole number, a door cell, or an empty cell list is ignored as a whole, never partly applied (Req 15.7).
//    Door cells are not paintable or erasable: a door is removed by the importer (DOOR_DISCARDED), not by a wall edit.
//    Windows are wall cells in the grid, so erasing a window's cells removes the wall but the window entry stays
//    (it only decides the fire vent, Req 15.9).
//  - setDoorOpen / setWindowOpen change `open` of a door or a window. The id must exist and be of the right kind,
//    otherwise the edit is ignored. A window is open only after setWindowOpen (default closed, Req 15.9).
//  - renameRoom / setRoomKind name a room by the id it has at that point of the replay: rooms are recomputed from the
//    grid as it stands after the earlier edits.
// IDENTITY (Req 8.3, 15.6). Rooms are numbered by first cell, so a wall edit can renumber them. A name or kind is
// therefore stored under (floor, first cell of the room). After the last edit a room keeps the name and kind stored
// under its own first cell. A stored name or kind whose first cell no longer starts a room (the room merged into an
// earlier one, or its first cell became wall) is dropped with one ROOM_IDENTITY_LOST naming the room by the id it
// had when the name or kind was set. Rooms without a stored name or kind have nothing to lose and add no warning.
import { CELL_DOOR, CELL_WALL, CELL_FREE } from '../../people/types';
import { findRooms, isValidRoomName } from '../grid/rooms';
import type { RoomsDoor, RoomsResult } from '../grid/rooms';
import type { DoorDraft } from '../grid/doors';
import type { Door, Edit, ImportWarning, Room, RoomKind } from '../types';
import { editIgnored, roomIdentityLost } from '../warnings';

const ROOM_KINDS: readonly RoomKind[] = ['room', 'corridor', 'stair'];

export interface EditFloorInput {
  floorId: string;
  widthCells: number;
  heightCells: number;
  cellType: Uint8Array; // after placeDoors: CELL_WALL, CELL_FREE, CELL_DOOR; not modified
  doors: readonly DoorDraft[];
}

export interface EditsInput {
  floors: readonly EditFloorInput[];
  windows: readonly Door[]; // doors with isWindow true; `open` is the state before the edits (false by default)
  edits: readonly Edit[];
}

export interface EditedFloor {
  floorId: string;
  widthCells: number;
  heightCells: number;
  rooms: RoomsResult; // final grid and rooms, with names, kinds and door open states applied
}

export interface EditsResult {
  floors: EditedFloor[]; // in input order
  windows: Door[]; // with `open` after the edits
  warnings: ImportWarning[]; // EDIT_IGNORED and ROOM_IDENTITY_LOST only; rooms.warnings of each floor stay on the floor
}

// Removes the last edit (Req 15.5). A new array; the input is not modified.
export function undoLastEdit(edits: readonly Edit[]): Edit[] {
  return edits.slice(0, Math.max(0, edits.length - 1));
}

// Appends an edit (Req 15.4). A new array.
export function appendEdit(edits: readonly Edit[], edit: Edit): Edit[] {
  return [...edits, edit];
}

// A short text naming an edit, for EDIT_IGNORED (Req 15.7).
export function describeEdit(edit: Edit): string {
  const e = edit as { kind?: unknown; floorId?: unknown; doorId?: unknown; windowId?: unknown; roomId?: unknown; cells?: unknown };
  const kind = typeof e.kind === 'string' ? e.kind : 'unknown edit';
  if (kind === 'paintWall' || kind === 'eraseWall') {
    const cells = Array.isArray(e.cells) ? (e.cells as { x?: unknown; y?: unknown }[]) : [];
    const first = cells[0];
    const at = first !== undefined && first !== null ? ` at cell (${String(first.x)}, ${String(first.y)})` : '';
    return `${kind} on floor ${String(e.floorId)}${at}`;
  }
  if (kind === 'setDoorOpen') return `${kind} on door ${String(e.doorId)}`;
  if (kind === 'setWindowOpen') return `${kind} on window ${String(e.windowId)}`;
  if (kind === 'renameRoom' || kind === 'setRoomKind') return `${kind} on room ${String(e.roomId)}`;
  return kind;
}

interface Identity {
  roomId: string; // id the room had when the name or kind was set (for the warning)
  name?: string;
  kind?: RoomKind;
}

interface FloorState {
  input: EditFloorInput;
  cellType: Uint8Array;
  dirty: boolean;
  cache: RoomsResult | null;
}

const validGrid = (n: number): boolean => Number.isInteger(n) && n > 0;

function recompute(f: FloorState): RoomsResult {
  if (f.cache === null || f.dirty) {
    f.cache = findRooms({
      floorId: f.input.floorId,
      widthCells: f.input.widthCells,
      heightCells: f.input.heightCells,
      cellType: f.cellType,
      doors: f.input.doors,
    });
    f.dirty = false;
  }
  return f.cache;
}

// Cell indices of a wall edit, or an ignore reason.
function resolveCells(f: FloorState, cells: unknown): Int32Array | string {
  if (!Array.isArray(cells) || cells.length === 0) return 'it names no cell';
  const { widthCells: w, heightCells: h } = f.input;
  const out = new Int32Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as { x?: unknown; y?: unknown } | null;
    const x = c?.x;
    const y = c?.y;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) return 'a cell is not a whole-number position';
    if (x < 0 || y < 0 || x >= w || y >= h) return `cell (${x}, ${y}) lies outside the grid`;
    const index = y * w + x;
    if (f.cellType[index] === CELL_DOOR) return `cell (${x}, ${y}) is a door`;
    out[i] = index;
  }
  return out;
}

export function applyEdits(input: EditsInput): EditsResult {
  const warnings: ImportWarning[] = [];
  const states = new Map<string, FloorState>();
  for (const fl of Array.isArray(input.floors) ? input.floors : []) {
    if (states.has(fl.floorId)) continue;
    const ok = validGrid(fl.widthCells) && validGrid(fl.heightCells) && fl.cellType instanceof Uint8Array && fl.cellType.length === fl.widthCells * fl.heightCells;
    states.set(fl.floorId, { input: fl, cellType: ok ? fl.cellType.slice() : new Uint8Array(0), dirty: true, cache: null });
  }
  const doorIds = new Set<string>();
  for (const fl of states.values()) for (const d of fl.input.doors) doorIds.add(d.id);
  const doorOpen = new Map<string, boolean>();
  const windows: Door[] = (Array.isArray(input.windows) ? input.windows : []).map((d) => ({ ...d }));
  const windowById = new Map<string, Door>();
  for (const wnd of windows) windowById.set(wnd.id, wnd);
  const identities = new Map<string, Identity>(); // key: `${floorId}\u0000${first cell}`

  const ignore = (edit: Edit, reason: string): void => {
    warnings.push(editIgnored(`${describeEdit(edit)} (${reason})`));
  };
  // Floor and room an id names right now.
  const findRoom = (roomId: unknown): { f: FloorState; room: Room } | null => {
    if (typeof roomId !== 'string') return null;
    for (const f of states.values()) {
      if (f.cellType.length === 0 || !roomId.startsWith(`${f.input.floorId}:room`)) continue;
      const room = recompute(f).rooms.find((r) => r.id === roomId);
      if (room !== undefined) return { f, room };
    }
    return null;
  };
  const identityOf = (f: FloorState, room: Room): Identity => {
    const key = `${f.input.floorId}\u0000${room.cells[0]}`;
    let id = identities.get(key);
    if (id === undefined) {
      id = { roomId: room.id };
      identities.set(key, id);
    }
    id.roomId = room.id;
    return id;
  };

  for (const edit of Array.isArray(input.edits) ? input.edits : []) {
    const e = edit as { kind?: unknown } | null;
    switch (e?.kind) {
      case 'paintWall':
      case 'eraseWall': {
        const ed = edit as Extract<Edit, { kind: 'paintWall' | 'eraseWall' }>;
        const f = states.get(ed.floorId);
        if (f === undefined || f.cellType.length === 0) {
          ignore(edit, `floor ${String(ed.floorId)} does not exist`);
          break;
        }
        const cells = resolveCells(f, ed.cells);
        if (typeof cells === 'string') {
          ignore(edit, cells);
          break;
        }
        const value = ed.kind === 'paintWall' ? CELL_WALL : CELL_FREE;
        let changed = false;
        for (const c of cells) {
          if (f.cellType[c] !== value) {
            f.cellType[c] = value;
            changed = true;
          }
        }
        if (changed) f.dirty = true;
        break;
      }
      case 'setDoorOpen': {
        const ed = edit as Extract<Edit, { kind: 'setDoorOpen' }>;
        if (typeof ed.open !== 'boolean') ignore(edit, 'open must be true or false');
        else if (!doorIds.has(ed.doorId)) ignore(edit, `door ${String(ed.doorId)} does not exist`);
        else doorOpen.set(ed.doorId, ed.open);
        break;
      }
      case 'setWindowOpen': {
        const ed = edit as Extract<Edit, { kind: 'setWindowOpen' }>;
        const wnd = windowById.get(ed.windowId);
        if (typeof ed.open !== 'boolean') ignore(edit, 'open must be true or false');
        else if (wnd === undefined) ignore(edit, `window ${String(ed.windowId)} does not exist`);
        else wnd.open = ed.open;
        break;
      }
      case 'renameRoom': {
        const ed = edit as Extract<Edit, { kind: 'renameRoom' }>;
        const hit = findRoom(ed.roomId);
        if (hit === null) ignore(edit, `room ${String(ed.roomId)} does not exist`);
        else if (!isValidRoomName(ed.name)) ignore(edit, 'a room name has 1 to 60 characters');
        else identityOf(hit.f, hit.room).name = ed.name;
        break;
      }
      case 'setRoomKind': {
        const ed = edit as Extract<Edit, { kind: 'setRoomKind' }>;
        const hit = findRoom(ed.roomId);
        if (hit === null) ignore(edit, `room ${String(ed.roomId)} does not exist`);
        else if (!ROOM_KINDS.includes(ed.roomKind)) ignore(edit, 'the room kind must be room, corridor or stair');
        else identityOf(hit.f, hit.room).kind = ed.roomKind;
        break;
      }
      default:
        ignore(edit, 'unknown edit kind');
    }
  }

  // Final rooms, with identities, door states.
  const used = new Set<string>();
  const floors: EditedFloor[] = [];
  for (const fl of Array.isArray(input.floors) ? input.floors : []) {
    const f = states.get(fl.floorId) as FloorState;
    if (f.input !== fl) continue; // duplicate floor id: the first one wins
    const base = recompute(f);
    const rooms = base.rooms.map((r): Room => {
      const key = `${fl.floorId}\u0000${r.cells[0]}`;
      const id = identities.get(key);
      if (id === undefined) return r;
      used.add(key);
      return { ...r, name: id.name ?? r.name, kind: id.kind ?? r.kind };
    });
    const doors = base.doors.map((d): RoomsDoor => (doorOpen.has(d.id) ? { ...d, open: doorOpen.get(d.id) as boolean } : d));
    floors.push({
      floorId: fl.floorId,
      widthCells: fl.widthCells,
      heightCells: fl.heightCells,
      rooms: { ...base, rooms, doors },
    });
  }
  for (const [key, id] of identities) if (!used.has(key)) warnings.push(roomIdentityLost(id.roomId));

  return { floors, windows, warnings };
}
