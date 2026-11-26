// Shared types of the plan-import module. Types only, no logic. SI units; names carry the unit (design.md, Data Models).

import type { Vent, Compartment } from '../fire/types';
import type { PlanInput } from '../people/types';

export type LayerRole = 'wall' | 'door' | 'window' | 'stair' | 'furniture' | 'ignore';
export type LayerMap = Record<string /* layer name */, LayerRole>;

export type DrawingUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export interface FloorSettings {
  floorId: string;
  name: string;
  elevationM: number;
  ceilingHeightM: number;
}

export type RoomKind = 'room' | 'corridor' | 'stair';
export interface Room {
  id: string;
  floorId: string;
  name: string;
  kind: RoomKind;
  cells: Int32Array; // cell indices on the floor grid, row-major
  areaM2: number;
  bboxWidthM: number;
  bboxHeightM: number;
  touchesBorder: boolean;
}

export interface Door {
  id: string;
  floorId: string;
  cells: Int32Array;
  widthM: number;
  open: boolean;
  roomIdA: string | 'OUTSIDE';
  roomIdB: string | 'OUTSIDE';
  isWindow: boolean;
  isExit: boolean;
}

export interface StairRegionInput {
  floorId: string;
  cells: Int32Array;
}

export interface StairLink {
  id: string;
  lowerFloorId: string;
  upperFloorId: string;
  footprint: Int32Array;
  widthM: number;
}

export type Edit =
  | { kind: 'paintWall'; floorId: string; cells: { x: number; y: number }[] }
  | { kind: 'eraseWall'; floorId: string; cells: { x: number; y: number }[] }
  | { kind: 'setDoorOpen'; doorId: string; open: boolean }
  | { kind: 'setWindowOpen'; windowId: string; open: boolean } // default closed: no fire vent (Req 15.9, 13.2)
  | { kind: 'renameRoom'; roomId: string; name: string }
  | { kind: 'setRoomKind'; roomId: string; roomKind: RoomKind }; // design.md names this field `kind`, which clashes with the tag

export type ImportWarningCode =
  | 'DXF_VERSION_MISSING' | 'DXF_VERSION_UNSUPPORTED' | 'DXF_NOT_ASCII' | 'DXF_ENTITY_SKIPPED'
  | 'DXF_BLOCK_CYCLE_OR_DEPTH' | 'DXF_COORDINATE_OUT_OF_RANGE' | 'DXF_MALFORMED' | 'DXF_TOO_LARGE'
  | 'DXF_TOO_MANY_ENTITIES' | 'UNIT_UNKNOWN' | 'FLOOR_NO_WALLS' | 'LAYER_UNCONFIRMED' | 'GAP_CLOSED'
  | 'DOOR_WIDTH_RANGE' | 'DOOR_DISCARDED' | 'ROOM_OUTSIDE_LARGE' | 'ROOM_TOO_SMALL' | 'ROOM_NOT_RECTANGULAR'
  | 'FLOOR_STACKING' | 'FLOOR_FIELD_INVALID' | 'STAIR_OVERLAP_BELOW_TOLERANCE' | 'STAIR_REGION_TRIMMED'
  | 'VENT_WIDTH_CLAMPED' | 'VENT_LIMIT' | 'NO_EXIT' | 'EXIT_REJECTED' | 'LIMIT_FLOORS' | 'LIMIT_COMPARTMENTS'
  | 'LIMIT_CELLS' | 'EDIT_IGNORED' | 'ROOM_IDENTITY_LOST' | 'PROJECT_SCHEMA_VERSION' | 'PROJECT_FIELD_INVALID'
  | 'AGREEMENT_BROKEN' | 'INPUT_INVALID';

export interface ImportWarningLocation {
  kind: 'file' | 'layer' | 'floor' | 'room' | 'door' | 'cell' | 'vent' | 'field';
  fileName?: string;
  layerName?: string;
  floorId?: string;
  roomId?: string;
  doorId?: string;
  xCell?: number;
  yCell?: number;
  field?: string;
}

export interface ImportWarning {
  code: ImportWarningCode;
  severity: 'error' | 'warning';
  message: string;
  location?: ImportWarningLocation;
}

export interface FloorSourceSpec {
  floorId: string;
  fileName: string;
  layers?: string[]; // Req 4.2: layer-set assignment
  blockName?: string; // Req 4.2: block assignment
}

export interface BuildingModel {
  floors: FloorSettings[];
  floorSources: FloorSourceSpec[];
  layerMaps: Record<string, LayerMap>;
  grids: Record<string /* floorId */, { widthCells: number; heightCells: number; cellType: Uint8Array }>;
  rooms: Room[];
  doors: Door[];
  stairLinks: StairLink[];
  edits: Edit[];
}

export interface ImportSource {
  fileName: string;
  text: string; // raw DXF text, as given (Req 16.10 keeps it verbatim)
}

export interface ImportSettings {
  layerMaps?: Record<string /* fileName */, LayerMap>; // confirmed maps; unconfirmed -> ask (Req 5.4)
  drawingUnits?: Record<string /* fileName */, DrawingUnit>; // chosen units for unitless files (Req 2.2)
  floorSources?: FloorSourceSpec[]; // Req 4.2: one floor per layer set or block; default is one floor per file
  floorSettings?: FloorSettings[];
  floorOffsetsM?: Record<string /* floorId */, { xM: number; yM: number }>;
  edits?: Edit[];
  exitDoorIds?: string[];
  stairRegions?: StairRegionInput[];
  stairLinkOverrides?: Record<string, { widthM?: number }>;
  roofVents?: { floorId: string; areaM2: number; openFraction: number }[];
}

// A question the importer cannot answer itself (Req 2.3, 5.4). The model stays null until it is answered.
export type PendingQuestion =
  | { kind: 'DRAWING_UNIT'; fileName: string; suggestedUnit: DrawingUnit } // Req 2.2, 2.3
  | { kind: 'LAYER_ROLES'; fileName: string; layerNames: string[] }; // Req 5.4

// One count next to its limit, for the import screen (Req 17.5).
export interface LimitCount {
  count: number;
  limit: number;
  exceeded: boolean;
}

export interface ImportCounts {
  floors: LimitCount;
  compartments: LimitCount;
  vents: LimitCount;
  cellsPerFloor: { floorId: string; widthCells: number; heightCells: number; count: number; limit: number; exceeded: boolean }[];
}

export interface ImportResult {
  // Counts and limits, present whenever the model stages ran far enough to count (also when a limit is exceeded).
  counts?: ImportCounts;
  status: 'ok' | 'invalid';
  model: BuildingModel | null;
  warnings: ImportWarning[];
  pendingQuestions: PendingQuestion[]; // unresolved unit choices, unconfirmed layer maps (Req 2.3, 5.4)
  // Outputs of toPlanInput and toFireGeometry for `model`, present exactly when `model` is. Carried here because the
  // roof openings (ImportSettings.roofVents) are not part of the BuildingModel.
  derived?: { planInput: PlanInput; fire: { compartments: Compartment[]; vents: Vent[] } };
}
