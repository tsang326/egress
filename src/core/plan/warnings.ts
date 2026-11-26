// Constructors for every ImportWarningCode. Plain-language text a shop owner can read, with a location where the
// warning has one. No wording that calls a building safe, compliant, certified or code-conforming (safety rules).
// Values interpolated here may come from DXF files; the UI shows `message` with textContent only (Req 3.9).
import {
  DXF_MAX_BLOCK_DEPTH,
  DXF_MAX_BYTES,
  DXF_MAX_COORDINATE_M,
  DXF_MAX_ENTITIES,
  DOOR_WIDTH_MAX_M,
  DOOR_WIDTH_MIN_M,
} from './constants';
import type { ImportWarning, ImportWarningCode, ImportWarningLocation } from './types';

const MB = 1024 * 1024;

function mk(
  code: ImportWarningCode,
  severity: 'error' | 'warning',
  message: string,
  location?: ImportWarningLocation,
): ImportWarning {
  return location === undefined ? { code, severity, message } : { code, severity, message, location };
}
const err = (c: ImportWarningCode, m: string, l?: ImportWarningLocation) => mk(c, 'error', m, l);
const warn = (c: ImportWarningCode, m: string, l?: ImportWarningLocation) => mk(c, 'warning', m, l);
const fmt = (n: number, digits = 2): string => (Number.isFinite(n) ? String(Number(n.toFixed(digits))) : 'unknown');
const file = (fileName: string): ImportWarningLocation => ({ kind: 'file', fileName });
const floor = (floorId: string): ImportWarningLocation => ({ kind: 'floor', floorId });
const cell = (floorId: string, xCell: number, yCell: number): ImportWarningLocation => ({
  kind: 'cell',
  floorId,
  xCell,
  yCell,
});
const SAVE_AS = 'Save the drawing as DXF (ASCII) and try again. In your CAD program: Save as DXF (ASCII).';

// ---- DXF reading ------------------------------------------------------------------------------------------------

export const dxfVersionMissing = (fileName: string): ImportWarning =>
  warn('DXF_VERSION_MISSING', `${fileName}: the file does not state its DXF version. It is read as the oldest supported version (AC1009).`, file(fileName));

export const dxfVersionUnsupported = (fileName: string, version: string): ImportWarning =>
  err('DXF_VERSION_UNSUPPORTED', `${fileName}: DXF version "${version}" is not supported. Supported versions are AC1009 to AC1032. ${SAVE_AS}`, file(fileName));

export const dxfNotAscii = (fileName: string): ImportWarning =>
  err('DXF_NOT_ASCII', `${fileName}: this is not an ASCII DXF file (it looks like binary DXF, DWG, PDF or an image). ${SAVE_AS}`, file(fileName));

export const dxfEntitySkipped = (fileName: string, typeName: string, count: number): ImportWarning =>
  warn('DXF_ENTITY_SKIPPED', `${fileName}: ${count} ${typeName} entit${count === 1 ? 'y was' : 'ies were'} skipped because this type is not read.`, file(fileName));

export const dxfBlockCycleOrDepth = (fileName: string, blockName: string): ImportWarning =>
  warn('DXF_BLOCK_CYCLE_OR_DEPTH', `${fileName}: block "${blockName}" was skipped because it contains itself or nests deeper than ${DXF_MAX_BLOCK_DEPTH} levels.`, file(fileName));

export const dxfCoordinateOutOfRange = (fileName: string, layerName: string, entityType: string): ImportWarning =>
  warn('DXF_COORDINATE_OUT_OF_RANGE', `${fileName}: a ${entityType} on layer "${layerName}" was skipped because a coordinate is not a number or lies more than ${DXF_MAX_COORDINATE_M} m from the origin.`, { kind: 'layer', fileName, layerName });

export const dxfMalformed = (fileName: string, lineNumber: number, detail: string): ImportWarning =>
  err('DXF_MALFORMED', `${fileName}: the file cannot be read at line ${lineNumber}: ${detail}.`, file(fileName));

export const dxfTooLarge = (fileName: string, bytes: number): ImportWarning =>
  err('DXF_TOO_LARGE', `${fileName}: the file is ${fmt(bytes / MB, 1)} MB. The limit is ${DXF_MAX_BYTES / MB} MB.`, file(fileName));

export const dxfTooManyEntities = (fileName: string, count: number): ImportWarning =>
  err('DXF_TOO_MANY_ENTITIES', `${fileName}: the drawing has ${count} entities. The limit is ${DXF_MAX_ENTITIES}.`, file(fileName));

// ---- Units, layers, floors --------------------------------------------------------------------------------------

export const unitUnknown = (fileName: string): ImportWarning =>
  warn('UNIT_UNKNOWN', `${fileName}: the drawing does not state its unit. Choose the unit it was drawn in.`, file(fileName));

export const floorNoWalls = (floorId: string): ImportWarning =>
  err('FLOOR_NO_WALLS', `Floor ${floorId} has no wall lines. Assign at least one layer to the role "wall".`, floor(floorId));

export const layerUnconfirmed = (fileName: string, layerName: string): ImportWarning =>
  warn('LAYER_UNCONFIRMED', `${fileName}: the role of layer "${layerName}" has not been confirmed.`, { kind: 'layer', fileName, layerName });

// ---- Grid, doors, rooms -----------------------------------------------------------------------------------------

export const gapClosed = (floorId: string, xCell: number, yCell: number): ImportWarning =>
  warn('GAP_CLOSED', `A small gap in a wall on floor ${floorId} was closed at cell (${xCell}, ${yCell}). Check that no doorway was meant here.`, cell(floorId, xCell, yCell));

export const doorWidthRange = (doorId: string, floorId: string, widthM: number): ImportWarning =>
  warn('DOOR_WIDTH_RANGE', `Door ${doorId} is ${fmt(widthM)} m wide, outside the usual ${fmt(DOOR_WIDTH_MIN_M, 1)} to ${fmt(DOOR_WIDTH_MAX_M, 1)} m. The width is an estimate from the drawing; check it.`, { kind: 'door', floorId, doorId });

export const doorDiscarded = (floorId: string, xCell: number, yCell: number): ImportWarning =>
  warn('DOOR_DISCARDED', `A door at cell (${xCell}, ${yCell}) on floor ${floorId} was dropped because it has no wall or no room on one side.`, cell(floorId, xCell, yCell));

export const roomOutsideLarge = (floorId: string, fractionOfGrid: number): ImportWarning =>
  warn('ROOM_OUTSIDE_LARGE', `On floor ${floorId}, the area outside the walls covers ${fmt(fractionOfGrid * 100, 0)}% of the plan and no exterior door leads to it. The outer wall may not be closed.`, floor(floorId));

export const roomTooSmall = (roomId: string, floorId: string, areaM2: number): ImportWarning =>
  warn('ROOM_TOO_SMALL', `Region ${roomId} on floor ${floorId} is only ${fmt(areaM2)} m2 and was treated as wall.`, { kind: 'room', floorId, roomId });

export const roomNotRectangular = (roomId: string, floorId: string, areaM2: number, bboxAreaM2: number): ImportWarning => {
  const rel = bboxAreaM2 > 0 ? Math.abs(bboxAreaM2 - areaM2) / areaM2 : Number.NaN;
  return warn('ROOM_NOT_RECTANGULAR', `Room ${roomId} is not rectangular: its area is ${fmt(areaM2)} m2 and its bounding box is ${fmt(bboxAreaM2)} m2 (${fmt(rel * 100, 0)}% different). The fire model uses a box of the same floor area, so smoke spreading in this room is approximate.`, { kind: 'room', floorId, roomId });
};

export const floorStacking = (lowerFloorId: string, upperFloorId: string, gapM: number): ImportWarning =>
  warn('FLOOR_STACKING', `Floors ${lowerFloorId} and ${upperFloorId} do not stack: the upper floor level differs from the lower ceiling by ${fmt(gapM)} m.`, floor(upperFloorId));

export const floorFieldInvalid = (floorId: string, field: string, detail: string): ImportWarning =>
  warn('FLOOR_FIELD_INVALID', `Floor ${floorId}: the value for ${field} was not accepted (${detail}). The previous value is kept.`, { kind: 'field', floorId, field });

// ---- Stairs, vents, exits ---------------------------------------------------------------------------------------

export const stairOverlapBelowTolerance = (
  lowerFloorId: string,
  upperFloorId: string,
  regions?: { lowerRegionId: string; upperRegionId: string; overlapCells: number; smallerCells: number },
): ImportWarning =>
  err(
    'STAIR_OVERLAP_BELOW_TOLERANCE',
    `The stair regions on floors ${lowerFloorId} and ${upperFloorId}${regions ? ` (${regions.lowerRegionId} and ${regions.upperRegionId})` : ''} do not overlap enough to form one staircase${regions ? `: ${regions.overlapCells} of ${regions.smallerCells} cells of the smaller region overlap` : ''}. Redraw or move one of them.`,
    floor(upperFloorId),
  );

export const stairRegionTrimmed = (floorId: string, cellCount: number): ImportWarning =>
  warn('STAIR_REGION_TRIMMED', `${cellCount} stair cell${cellCount === 1 ? '' : 's'} on floor ${floorId} lie outside the shared staircase footprint and became free floor.`, floor(floorId));

export const ventWidthClamped = (ventId: string, floorId: string, widthM: number): ImportWarning =>
  warn('VENT_WIDTH_CLAMPED', `The opening ${ventId} on floor ${floorId} was narrowed to ${fmt(widthM)} m to fit the wall.`, { kind: 'vent', floorId });

export const ventLimit = (count: number, limit: number): ImportWarning =>
  err('VENT_LIMIT', `The plan has ${count} openings (doors, open windows, roof openings). The limit is ${limit} vents, set by the fire model.`);

export const noExit = (): ImportWarning =>
  warn('NO_EXIT', 'No exit has been marked. People in the simulation have nowhere to go. Mark at least one outside-facing door as an exit.');

export const exitRejected = (doorId: string, floorId: string): ImportWarning =>
  warn('EXIT_REJECTED', `Door ${doorId} cannot be an exit because it does not lead outside.`, { kind: 'door', floorId, doorId });

// ---- Limits -----------------------------------------------------------------------------------------------------

export const limitFloors = (count: number, limit: number): ImportWarning =>
  err('LIMIT_FLOORS', `The plan has ${count} floors. The limit is ${limit} floors, set by the fire model.`);

export const limitCompartments = (count: number, limit: number): ImportWarning =>
  err('LIMIT_COMPARTMENTS', `The plan has ${count} rooms and stair compartments. The limit is ${limit} compartments, set by the fire model.`);

export const limitCells = (floorId: string, count: number, limit: number, gridCells?: { widthCells: number; heightCells: number }): ImportWarning =>
  err('LIMIT_CELLS', `Floor ${floorId} needs ${count} grid cells${gridCells ? ` (${gridCells.widthCells} by ${gridCells.heightCells})` : ''}. The limit is ${limit} cells per floor, set by the crowd model. Use a smaller drawing extent.`, floor(floorId));

// ---- Edits, project file, agreement, input ----------------------------------------------------------------------

export const editIgnored = (detail: string): ImportWarning =>
  warn('EDIT_IGNORED', `An edit was ignored: ${detail}.`);

export const roomIdentityLost = (roomId: string): ImportWarning =>
  warn('ROOM_IDENTITY_LOST', `The name or kind saved for room ${roomId} was dropped because that room no longer exists after the plan changed.`, { kind: 'room', roomId });

export const projectSchemaVersion = (found: unknown): ImportWarning =>
  err('PROJECT_SCHEMA_VERSION', `The project file has schema version ${typeof found === 'number' || typeof found === 'string' ? String(found) : 'unknown'}, which this version does not read. The current project is unchanged.`);

export const projectFieldInvalid = (field: string, detail: string): ImportWarning =>
  err('PROJECT_FIELD_INVALID', `The project file field "${field}" is not valid: ${detail}. The current project is unchanged.`, { kind: 'field', field });

export const agreementBroken = (detail: string): ImportWarning =>
  err('AGREEMENT_BROKEN', `The fire and crowd descriptions of the plan disagree: ${detail}.`);

export const inputInvalid = (detail: string): ImportWarning =>
  err('INPUT_INVALID', `The input is not valid: ${detail}.`);
