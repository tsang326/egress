// saveProject: serialize the current project as JSON, schemaVersion 1 (Req 2.5, 5.8, 12.7, 15.8, 16.1, 16.10).
// Pure; the source DXF text is written verbatim. Room names and kinds come from the built model when given.
import type { BuildingModel, ImportSettings, ImportSource } from '../types';
import type { ProjectFileV1 } from './schema';

export interface SaveProjectInput {
  sources: readonly ImportSource[];
  settings?: ImportSettings;
  model?: BuildingModel | null; // the model built from these sources and settings, if any
}

export function toProjectFile(input: SaveProjectInput): ProjectFileV1 {
  const s = input.settings ?? {};
  const model = input.model ?? null;
  const out: ProjectFileV1 = {
    schemaVersion: 1,
    sources: input.sources.map((src, i) => ({ fileName: src.fileName !== '' && typeof src.fileName === 'string' ? src.fileName : `file${i + 1}.dxf`, text: src.text })),
    layerMaps: s.layerMaps ?? model?.layerMaps ?? {},
    drawingUnits: s.drawingUnits ?? {},
    floorSources: s.floorSources ?? [],
    floorSettings: model !== null ? model.floors : s.floorSettings ?? [],
    edits: model !== null ? model.edits : s.edits ?? [],
    exitDoorIds: s.exitDoorIds ?? [],
    stairRegions: (s.stairRegions ?? []).map((r) => ({ floorId: r.floorId, cells: Array.from(r.cells) })),
    roomNames: Object.fromEntries((model?.rooms ?? []).map((r) => [r.id, r.name])),
    roomKinds: Object.fromEntries((model?.rooms ?? []).map((r) => [r.id, r.kind])),
  };
  if (s.floorOffsetsM !== undefined) out.floorOffsetsM = s.floorOffsetsM;
  if (s.stairLinkOverrides !== undefined) out.stairLinkOverrides = s.stairLinkOverrides;
  if (s.roofVents !== undefined) out.roofVents = s.roofVents;
  return out;
}

export function saveProject(input: SaveProjectInput): string {
  return JSON.stringify(toProjectFile(input));
}
