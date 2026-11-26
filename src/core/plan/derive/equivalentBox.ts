// Room -> fire Compartment as an equivalent floor-area box (Req 9). Pure and total: bad input returns a result with
// no compartment and a warning, never throws (tech rules). CFAST User's Guide, Input_File_Chapter.tex line 134:
// odd shapes are modelled as equivalent floor area parallelepipeds.
import type { Compartment, CompartmentKind, Surface } from '../../fire/types';
import {
  DEFAULT_CEILING_SURFACE,
  DEFAULT_FLOOR_SURFACE,
  DEFAULT_WALL_SURFACE,
  NON_RECTANGULAR_WARN_FRACTION,
} from '../constants';
import type { ImportWarning, Room, RoomKind } from '../types';
import { inputInvalid, roomNotRectangular } from '../warnings';

export interface EquivalentBox {
  widthM: number; // along the grid x axis
  depthM: number;
}

export interface FloorHeights {
  elevationM: number;
  ceilingHeightM: number;
}

export interface RoomCompartment {
  /** Null when the room or floor numbers cannot give a box with width, depth and height above 0 (Req 9.8). */
  compartment: Compartment | null;
  /** (box area - room area) / room area. Zero by construction up to rounding (Req 9.5). */
  boxAreaRelativeError: number;
  /** (bounding-box area - room area) / room area. Not rectangular rooms have a positive value (Req 9.4, 9.5). */
  bboxAreaRelativeError: number;
  warnings: ImportWarning[];
}

const isPositive = (v: number): boolean => Number.isFinite(v) && v > 0;

/**
 * Equivalent_Box of a room: widthM * depthM = areaM2 and widthM / depthM = bboxWidthM / bboxHeightM (Req 9.2).
 * Returns null unless all three inputs are finite and greater than 0.
 */
export function equivalentBox(areaM2: number, bboxWidthM: number, bboxHeightM: number): EquivalentBox | null {
  if (!isPositive(areaM2) || !isPositive(bboxWidthM) || !isPositive(bboxHeightM)) return null;
  const ratio = bboxWidthM / bboxHeightM; // r
  const widthM = Math.sqrt(areaM2 * ratio);
  const depthM = Math.sqrt(areaM2 / ratio);
  if (!isPositive(widthM) || !isPositive(depthM)) return null; // overflow or underflow at extreme ratios
  return { widthM, depthM };
}

/** Room_Kind to fire kind (Req 9.3). */
export function fireKindOf(kind: RoomKind): { kind: CompartmentKind; isStair: boolean } {
  switch (kind) {
    case 'corridor':
      return { kind: 'corridor', isStair: false };
    case 'stair':
      return { kind: 'shaft', isStair: true };
    default:
      return { kind: 'room', isStair: false };
  }
}

// Own copy per compartment, so no two compartments share a mutable object.
function cloneSurface(s: Surface): Surface {
  return 'layers' in s ? { layers: s.layers.map((l) => ({ ...l })) } : { adiabatic: true };
}

/** Maps one Room to a fire Compartment with default surfaces (Req 9.1, 9.3, 9.4, 9.5, 9.7, 9.8). */
export function roomToCompartment(room: Room, floor: FloorHeights): RoomCompartment {
  const box = equivalentBox(room.areaM2, room.bboxWidthM, room.bboxHeightM);
  if (box === null || !isPositive(floor.ceilingHeightM) || !Number.isFinite(floor.elevationM)) {
    return {
      compartment: null,
      boxAreaRelativeError: Number.NaN,
      bboxAreaRelativeError: Number.NaN,
      warnings: [inputInvalid(`room ${room.id} has no usable area, size or floor height, so it has no fire compartment`)],
    };
  }
  const { kind, isStair } = fireKindOf(room.kind);
  const compartment: Compartment = {
    id: room.id, // Req 14.1: the same id in the crowd plan and the fire geometry
    widthM: box.widthM,
    depthM: box.depthM,
    heightM: floor.ceilingHeightM,
    floorElevationM: floor.elevationM,
    kind,
    ...(isStair ? { isStair: true } : {}),
    ceiling: cloneSurface(DEFAULT_CEILING_SURFACE),
    floor: cloneSurface(DEFAULT_FLOOR_SURFACE),
    walls: cloneSurface(DEFAULT_WALL_SURFACE),
  };
  const bboxAreaM2 = room.bboxWidthM * room.bboxHeightM;
  // Same quantity as the message in warnings.roomNotRectangular: |bbox area - room area| / room area.
  const bboxAreaRelativeError = (bboxAreaM2 - room.areaM2) / room.areaM2;
  const boxAreaRelativeError = (box.widthM * box.depthM - room.areaM2) / room.areaM2;
  const warnings: ImportWarning[] =
    Math.abs(bboxAreaRelativeError) > NON_RECTANGULAR_WARN_FRACTION
      ? [roomNotRectangular(room.id, room.floorId, room.areaM2, bboxAreaM2)]
      : [];
  return { compartment, boxAreaRelativeError, bboxAreaRelativeError, warnings };
}
