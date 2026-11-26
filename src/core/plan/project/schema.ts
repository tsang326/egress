// Project file schema, version 1 (Req 16.1, design.md "Project file"). Types only, plus the supported version list.
// Cells of a stair region are stored as plain number arrays of cell indices (an Int32Array does not survive JSON).
import type { DrawingUnit, Edit, FloorSettings, FloorSourceSpec, LayerMap, RoomKind } from '../types';

export const PROJECT_SCHEMA_VERSIONS_SUPPORTED: readonly number[] = [1];

export interface ProjectStairRegion {
  floorId: string;
  cells: number[]; // cell indices on the floor grid, row-major
}

export interface ProjectFileV1 {
  schemaVersion: 1;
  sources: { fileName: string; text: string }[]; // raw DXF text, verbatim (Req 16.10)
  layerMaps: Record<string, LayerMap>; // fileName -> layer -> role (Req 5.8)
  drawingUnits: Record<string, DrawingUnit>; // fileName -> unit (Req 2.5)
  floorSources: FloorSourceSpec[];
  floorSettings: FloorSettings[];
  edits: Edit[]; // by floor id and cell coordinates (Req 15.8)
  exitDoorIds: string[]; // exit marks by door id (Req 12.7)
  stairRegions: ProjectStairRegion[];
  roomNames: Record<string, string>; // roomId -> name
  roomKinds: Record<string, RoomKind>; // roomId -> kind
  // Optional fields that the importer reads and the design's v1 list does not name (design.md, task 15.1).
  floorOffsetsM?: Record<string, { xM: number; yM: number }>;
  stairLinkOverrides?: Record<string, { widthM?: number }>;
  roofVents?: { floorId: string; areaM2: number; openFraction: number }[];
}

export type ProjectFile = ProjectFileV1; // widen with `| ProjectFileV2` when schemaVersion grows
