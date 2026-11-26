// BuildingModel -> crowd PlanInput (Req 14.1, 14.5, 14.6, 14.7; 5.6, 5.7, 12.3, 13.6). Pure and total: bad model
// data gives a warning and a best-effort plan, never a throw (tech rules). Only a non-object model is a programmer
// error and throws TypeError.
//
// Cell rules, applied to a copy of each floor grid:
//  - window and furniture cells are `wall` (Req 5.6, 5.7). Furniture is already wall in the grid; window doors are
//    forced to wall here so a window can never be walked through.
//  - an open door keeps `door` cells; a closed door becomes `wall` (Req 13.6, 14.4).
//  - a confirmed exit door becomes `exit` over its full width, and the free cells just outside it (4-neighbours of a
//    door cell that belong to no room) become `exit` too (Req 12.3). A closed exit door stays wall.
//  - every stair link footprint is `stair` on both of its floors (Req 14.5), the shape builder.ts `buildLink` needs.
// Compartment ids: a cell of a room has that room's id (Req 14.1). A door cell has the lower-numbered room of its two
// sides (Req 8.7). Stair cells that lie in no room get `${floorId}:stair`, the id model/stairs.ts gives the stair
// compartment of a floor. Wall cells and outside cells have none.
import { CELL_DOOR, CELL_EXIT, CELL_FREE, CELL_STAIR, CELL_WALL } from '../../people/types';
import type { CompartmentInfo, FloorInput, PlanInput, StairLinkInput } from '../../people/types';
import { stairRegionId } from '../model/stairs';
import type { BuildingModel, Door, ImportWarning, Room } from '../types';
import { inputInvalid } from '../warnings';
import { fireKindOf } from './equivalentBox';

export interface PlanInputResult {
  planInput: PlanInput;
  warnings: ImportWarning[];
}

const roomNumber = (id: string): number => {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.NaN;
};

/** The lower-numbered of two room ids ("room9" before "room10"; plain string order when a number is missing). */
export function lowerRoomId(a: string, b: string): string {
  const na = roomNumber(a);
  const nb = roomNumber(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na < nb ? a : b;
  return a <= b ? a : b;
}

/** The compartment a door belongs to: the lower-id room among its sides, or null when both sides are outside. */
export function doorCompartmentId(door: Pick<Door, 'roomIdA' | 'roomIdB'>): string | null {
  const a = door.roomIdA === 'OUTSIDE' ? null : door.roomIdA;
  const b = door.roomIdB === 'OUTSIDE' ? null : door.roomIdB;
  if (a !== null && b !== null) return lowerRoomId(a, b);
  return a ?? b;
}

export function toPlanInput(model: BuildingModel): PlanInputResult {
  if (model === null || typeof model !== 'object') throw new TypeError('toPlanInput: model must be an object');
  const warnings: ImportWarning[] = [];
  const floors: FloorInput[] = [];
  const compartments: CompartmentInfo[] = model.rooms.map((r: Room) => ({ id: r.id, kind: fireKindOf(r.kind).kind }));
  const known = new Set(compartments.map((c) => c.id));

  for (const fl of model.floors) {
    const grid = model.grids[fl.floorId];
    if (!grid || !(grid.cellType instanceof Uint8Array) || grid.cellType.length !== grid.widthCells * grid.heightCells) {
      warnings.push(inputInvalid(`floor ${fl.floorId} has no usable cell grid`));
      continue;
    }
    const n = grid.cellType.length;
    const cells = Uint8Array.from(grid.cellType);
    const ids: (string | null)[] = new Array<string | null>(n).fill(null);
    const inRoom = new Uint8Array(n);
    const inRange = (c: number): boolean => Number.isInteger(c) && c >= 0 && c < n;

    for (const room of model.rooms) {
      if (room.floorId !== fl.floorId) continue;
      for (const c of room.cells) {
        if (!inRange(c)) { warnings.push(inputInvalid(`room ${room.id} has a cell outside floor ${fl.floorId}`)); break; }
        if (cells[c] !== CELL_WALL) ids[c] = room.id;
        inRoom[c] = 1;
      }
    }

    // Stairs first, so a door cell can still win over a stair cell below.
    for (const link of model.stairLinks) {
      if (link.lowerFloorId !== fl.floorId && link.upperFloorId !== fl.floorId) continue;
      for (const c of link.footprint) {
        if (!inRange(c)) { warnings.push(inputInvalid(`stair link ${link.id} has a cell outside floor ${fl.floorId}`)); break; }
        cells[c] = CELL_STAIR;
      }
    }
    for (let c = 0; c < n; c++) {
      if (cells[c] === CELL_STAIR && ids[c] === null) {
        ids[c] = stairRegionId(fl.floorId);
        if (!known.has(ids[c]!)) { known.add(ids[c]!); compartments.push({ id: ids[c]!, kind: 'shaft' }); }
      }
    }

    const w = grid.widthCells;
    for (const door of model.doors) {
      if (door.floorId !== fl.floorId) continue;
      const doorCells = [...door.cells].filter((c) => inRange(c));
      if (doorCells.length !== door.cells.length) warnings.push(inputInvalid(`door ${door.id} has a cell outside floor ${fl.floorId}`));
      if (door.isWindow || !door.open) { for (const c of doorCells) { cells[c] = CELL_WALL; ids[c] = null; } continue; }
      const comp = doorCompartmentId(door);
      for (const c of doorCells) {
        cells[c] = door.isExit ? CELL_EXIT : CELL_DOOR;
        ids[c] = comp;
      }
      if (!door.isExit) continue;
      // Matching exit cells on the outside side: free cells of no room next to a door cell (Req 12.3).
      for (const c of doorCells) {
        const x = c % w;
        for (const nb of [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, c - w, c + w]) {
          if (inRange(nb) && cells[nb] === CELL_FREE && inRoom[nb] === 0) cells[nb] = CELL_EXIT;
        }
      }
    }

    floors.push({ id: fl.floorId, elevationM: fl.elevationM, widthCells: w, heightCells: grid.heightCells, cells, compartmentIds: ids });
  }

  const floorIds = new Set(floors.map((f) => f.id));
  const stairLinks: StairLinkInput[] = [];
  for (const link of model.stairLinks) {
    if (!floorIds.has(link.lowerFloorId) || !floorIds.has(link.upperFloorId)) {
      warnings.push(inputInvalid(`stair link ${link.id} names a floor that has no grid`));
      continue;
    }
    stairLinks.push({ id: link.id, lowerFloorId: link.lowerFloorId, upperFloorId: link.upperFloorId, widthM: link.widthM });
  }
  return { planInput: { floors, stairLinks, compartments }, warnings };
}
