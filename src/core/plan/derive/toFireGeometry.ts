// Building_Model -> fire Compartment[] and Vent[] (Req 9, 11.7-11.10, 12.4, 13, 14.2-14.5). Pure and total: bad input
// gives a result with warnings, never a throw (tech rules). Same model in, bit-identical output (Req 14.7).
//
// Face and offset follow CFAST 7.7.7 read_vent (see src/core/fire/cfast-input/toScenario.ts): front is the wall at
// y = 0 and back the wall at y = depth (offset along x, wall length = widthM); left is x = 0 and right is x = width
// (offset along y, wall length = depthM). Positions come from the grid, where x grows to the right and y downward.
import type { Compartment, CeilingFloorVent, Face, Vent, WallVent } from '../../fire/types';
import { CELL_SIZE_M } from '../../people/constants';
import {
  DOOR_VENT_SILL_M,
  DOOR_VENT_SOFFIT_M,
  WINDOW_VENT_SILL_M,
  WINDOW_VENT_SOFFIT_M,
} from '../constants';
import { FIRE_MAX_VENTS } from '../limits';
import type { RoofOpeningInput } from '../model/stairs';
import type { BuildingModel, Door, ImportWarning, Room, StairLink } from '../types';
import { editIgnored, inputInvalid, ventLimit, ventWidthClamped } from '../warnings';
import { equivalentBox, roomToCompartment, type EquivalentBox } from './equivalentBox';

const OUTSIDE = 'OUTSIDE';

export interface FireGeometryResult {
  compartments: Compartment[];
  vents: Vent[];
  warnings: ImportWarning[];
}

export interface FireGeometryOptions {
  /** Accepted roof openings on top stair compartments (`resolveStairs(...).roofOpenings`, Req 11.10). */
  roofOpenings?: readonly RoofOpeningInput[];
}

/** Id of the vent of a door or window (Req 13.9). */
export const ventIdOf = (doorOrWindowId: string): string => `${doorOrWindowId}:vent`;
/** Id of the roof opening vent of the top stair compartment of a floor. */
export const roofVentIdOf = (floorId: string): string => `${floorId}:roof:vent`;

interface RoomGeometry {
  index: number; // position in model.rooms, the order of "lower id" (row-major first cell, Req 8.2)
  room: Room;
  box: EquivalentBox;
  minX: number; // bounding box of the room cells, in cells
  minY: number;
  spanX: number;
  spanY: number;
}

/** Bounding box of the cells in cell units, or null for no cells or cells outside the grid width. */
function cellBounds(cells: ArrayLike<number>, widthCells: number): { minX: number; minY: number; spanX: number; spanY: number } | null {
  if (!(Number.isInteger(widthCells) && widthCells > 0) || cells.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as number;
    const x = c % widthCells;
    const y = (c - x) / widthCells;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, spanX: maxX - minX + 1, spanY: maxY - minY + 1 };
}

/** Centre of the cells in cell units (cell x covers x to x + 1). */
function cellCentre(cells: ArrayLike<number>, widthCells: number): { x: number; y: number } | null {
  if (!(Number.isInteger(widthCells) && widthCells > 0) || cells.length === 0) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as number;
    const x = c % widthCells;
    sx += x + 0.5;
    sy += (c - x) / widthCells + 0.5;
  }
  return { x: sx / cells.length, y: sy / cells.length };
}

/**
 * Face of the box nearest to a plan position, and the position along that wall (Req 13.4). The position is scaled from
 * the room's cell bounding box to the box. Ties go front, back, left, right, so the result is deterministic.
 */
function nearestFace(g: RoomGeometry, xCell: number, yCell: number): { face: Face; alongM: number; wallLengthM: number } {
  const { widthM, depthM } = g.box;
  const u = Math.min(Math.max(((xCell - g.minX) / g.spanX) * widthM, 0), widthM);
  const v = Math.min(Math.max(((yCell - g.minY) / g.spanY) * depthM, 0), depthM);
  const candidates: { face: Face; dist: number; alongM: number; wallLengthM: number }[] = [
    { face: 'front', dist: v, alongM: u, wallLengthM: widthM },
    { face: 'back', dist: depthM - v, alongM: u, wallLengthM: widthM },
    { face: 'left', dist: u, alongM: v, wallLengthM: depthM },
    { face: 'right', dist: widthM - u, alongM: v, wallLengthM: depthM },
  ];
  let best = candidates[0] as (typeof candidates)[number];
  for (const c of candidates) if (c.dist < best.dist) best = c;
  return best;
}

/** Offset so that offset + width <= wallLength holds in floating point (the fire validator compares exactly). */
function fitOffset(centreM: number, widthM: number, wallLengthM: number): number {
  let off = Math.min(Math.max(centreM - widthM / 2, 0), Math.max(wallLengthM - widthM, 0));
  for (let k = 0; k < 8 && off > 0 && off + widthM > wallLengthM; k++) off -= wallLengthM * Number.EPSILON;
  return Math.max(off, 0);
}

export function toFireGeometry(model: BuildingModel, options?: FireGeometryOptions): FireGeometryResult {
  const warnings: ImportWarning[] = [];
  const compartments: Compartment[] = [];
  const vents: Vent[] = [];

  // ---- Compartments, one per Room (stair rooms are shafts, Req 9.3, 11.7) -------------------------------------------
  const floorById = new Map(model.floors.map((f) => [f.floorId, f]));
  const geometry = new Map<string, RoomGeometry>();
  const compartmentById = new Map<string, Compartment>();
  model.rooms.forEach((room, index) => {
    const floor = floorById.get(room.floorId);
    const grid = model.grids[room.floorId];
    if (floor === undefined || grid === undefined) {
      warnings.push(inputInvalid(`room ${room.id} is on floor ${room.floorId}, which has no settings or grid`));
      return;
    }
    const made = roomToCompartment(room, { elevationM: floor.elevationM, ceilingHeightM: floor.ceilingHeightM });
    warnings.push(...made.warnings);
    const box = equivalentBox(room.areaM2, room.bboxWidthM, room.bboxHeightM);
    const bounds = cellBounds(room.cells, grid.widthCells);
    if (made.compartment === null || box === null || bounds === null) {
      if (made.compartment !== null) warnings.push(inputInvalid(`room ${room.id} has no cells on its floor grid`));
      return;
    }
    compartments.push(made.compartment);
    compartmentById.set(room.id, made.compartment);
    geometry.set(room.id, { index, room, box, ...bounds });
  });

  // ---- Stair links: one CeilingFloorVent each (Req 11.8, 14.5) -------------------------------------------------------
  const floorOrder = new Map(model.floors.map((f, i) => [f.floorId, i]));
  const stairRoomOf = (floorId: string, footprint: Int32Array): Room | null => {
    const grid = model.grids[floorId];
    if (grid === undefined) return null;
    const inFootprint = new Set<number>(footprint);
    let best: Room | null = null;
    let bestStair = false;
    let bestOverlap = 0;
    for (const room of model.rooms) {
      if (room.floorId !== floorId || !geometry.has(room.id)) continue;
      let overlap = 0;
      for (const c of room.cells) if (inFootprint.has(c)) overlap++;
      if (overlap === 0) continue;
      // A room of kind `stair` wins over a plain room; then more overlap; ties keep the first room (row-major order).
      const isStair = room.kind === 'stair';
      if (best === null || (isStair && !bestStair) || (isStair === bestStair && overlap > bestOverlap)) {
        best = room;
        bestStair = isStair;
        bestOverlap = overlap;
      }
    }
    return best;
  };
  const links = [...model.stairLinks].sort(
    (a: StairLink, b: StairLink) => (floorOrder.get(a.lowerFloorId) ?? 0) - (floorOrder.get(b.lowerFloorId) ?? 0),
  );
  for (const link of links) {
    const lowerRoom = stairRoomOf(link.lowerFloorId, link.footprint);
    const upperRoom = stairRoomOf(link.upperFloorId, link.footprint);
    const lower = lowerRoom && compartmentById.get(lowerRoom.id);
    const upper = upperRoom && compartmentById.get(upperRoom.id);
    if (!lowerRoom || !upperRoom || !lower || !upper) {
      warnings.push(inputInvalid(`stair link ${link.id} has no stair compartment on floor ${lowerRoom ? link.upperFloorId : link.lowerFloorId}`));
      continue;
    }
    // Req 11.8: the upper stair compartment starts where the lower one ends. Floor settings that break this already carry
    // a FLOOR_STACKING warning, so the override adds none.
    upper.floorElevationM = lower.floorElevationM + lower.heightM;
    const areaM2 = Math.min(link.footprint.length * CELL_SIZE_M * CELL_SIZE_M, lower.widthM * lower.depthM, upper.widthM * upper.depthM);
    const vent: CeilingFloorVent = {
      kind: 'ceilingFloor',
      id: ventIdOf(link.id),
      lower: lower.id,
      upper: upper.id,
      areaM2,
      shape: 'square',
      open: 1,
    };
    vents.push(vent);
  }

  // ---- Roof openings on top stair compartments (Req 11.10) ----------------------------------------------------------
  for (const roof of options?.roofOpenings ?? []) {
    const stairRooms = model.rooms.filter((r) => r.floorId === roof.floorId && r.kind === 'stair' && geometry.has(r.id));
    const top = stairRooms[0];
    const comp = top && compartmentById.get(top.id);
    if (!top || !comp) {
      warnings.push(editIgnored(`the roof opening on floor ${roof.floorId} was dropped because the floor has no stair compartment`));
      continue;
    }
    if (!(Number.isFinite(roof.areaM2) && roof.areaM2 > 0 && roof.openFraction >= 0 && roof.openFraction <= 1)) {
      warnings.push(editIgnored(`the roof opening on floor ${roof.floorId} was dropped because its area or open fraction is not valid`));
      continue;
    }
    if (roof.areaM2 > comp.widthM * comp.depthM) {
      warnings.push(editIgnored(`the roof opening on floor ${roof.floorId} was dropped because it is larger than the stair floor area`));
      continue;
    }
    vents.push({
      kind: 'ceilingFloor',
      id: roofVentIdOf(roof.floorId),
      lower: comp.id,
      upper: OUTSIDE,
      areaM2: roof.areaM2,
      shape: 'square',
      open: roof.openFraction,
    });
  }

  // ---- Wall vents: doors, exits, open windows (Req 12.4, 13.1-13.7, 13.9, 14.2-14.4) --------------------------------
  const seenIds = new Set<string>();
  for (const door of model.doors) {
    if (door.isWindow && !door.open) continue; // Req 13.2: a closed window gives no vent
    const vent = wallVentOf(door, geometry, model, warnings);
    if (vent === null) continue;
    if (seenIds.has(vent.id)) {
      warnings.push(inputInvalid(`two doors or windows share the id ${door.id}`));
      continue;
    }
    seenIds.add(vent.id);
    vents.push(vent);
  }

  // ---- Limit (Req 13.8) -------------------------------------------------------------------------------------------
  if (vents.length > FIRE_MAX_VENTS) warnings.push(ventLimit(vents.length, FIRE_MAX_VENTS));

  return { compartments, vents, warnings };
}

function wallVentOf(
  door: Door,
  geometry: ReadonlyMap<string, RoomGeometry>,
  model: BuildingModel,
  warnings: ImportWarning[],
): WallVent | null {
  const a = door.roomIdA === OUTSIDE ? null : geometry.get(door.roomIdA);
  const b = door.roomIdB === OUTSIDE ? null : geometry.get(door.roomIdB);
  if ((door.roomIdA !== OUTSIDE && a === undefined) || (door.roomIdB !== OUTSIDE && b === undefined)) {
    // A side names a room that has no compartment; the cause is already in the warnings of the compartment step.
    warnings.push(inputInvalid(`opening ${door.id} touches a room that has no fire compartment, so it has no vent`));
    return null;
  }
  if (!a && !b) {
    warnings.push(inputInvalid(`opening ${door.id} has no room on either side`));
    return null;
  }
  if (a && b && a.room.id === b.room.id) {
    warnings.push(inputInvalid(`opening ${door.id} has the same room on both sides`));
    return null;
  }
  // `from` is the room with the lower id (Req 13.1); with the outside on one side it is the room (Req 12.4, 13.3).
  const fromGeo = (a && b ? (a.index <= b.index ? a : b) : a ?? b) as RoomGeometry;
  const toId = a && b ? (fromGeo === a ? b.room.id : a.room.id) : OUTSIDE;

  const grid = model.grids[door.floorId];
  const centre = grid ? cellCentre(door.cells, grid.widthCells) : null;
  if (centre === null) {
    warnings.push(inputInvalid(`opening ${door.id} has no cells on the grid of floor ${door.floorId}`));
    return null;
  }
  if (!(Number.isFinite(door.widthM) && door.widthM > 0)) {
    warnings.push(inputInvalid(`opening ${door.id} has no usable width`));
    return null;
  }

  const placement = nearestFace(fromGeo, centre.x, centre.y);
  const id = ventIdOf(door.id);
  let widthM = door.widthM;
  if (widthM > placement.wallLengthM) {
    widthM = placement.wallLengthM; // Req 13.7
    warnings.push(ventWidthClamped(id, door.floorId, widthM));
  }
  const heightM = (model.floors.find((f) => f.floorId === fromGeo.room.floorId)?.ceilingHeightM) ?? DOOR_VENT_SOFFIT_M;
  const sillM = door.isWindow ? WINDOW_VENT_SILL_M : DOOR_VENT_SILL_M;
  const soffitM = Math.min(door.isWindow ? WINDOW_VENT_SOFFIT_M : DOOR_VENT_SOFFIT_M, heightM); // the validator needs soffit <= height
  return {
    kind: 'wall',
    id,
    from: fromGeo.room.id,
    to: toId,
    sillM,
    soffitM,
    widthM,
    face: placement.face,
    offsetM: fitOffset(placement.alongM, widthM, placement.wallLengthM),
    open: door.open ? 1 : 0, // Req 13.5, 13.6, 14.4
  };
}
