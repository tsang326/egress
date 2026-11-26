// Defensive reading of ImportSettings (Req 22.3). Settings can come from a project file or a UI, so any field may have
// the wrong type; a field that is not usable reads as absent. Never throws. Keys come from untrusted data, so records
// are rebuilt with Object.fromEntries (an own key such as "__proto__" stays plain data) and read with Object.hasOwn.
import { LAYER_ROLES } from './layers';
import { isDrawingUnit } from './units';
import type {
  DrawingUnit,
  Edit,
  FloorSettings,
  FloorSourceSpec,
  ImportSettings,
  LayerMap,
  LayerRole,
  StairRegionInput,
} from './types';
import type { RoofOpeningInput } from './model/stairs';

export interface NormalizedSettings {
  layerMaps: Record<string, LayerMap>;
  drawingUnits: Record<string, DrawingUnit>;
  floorSources: FloorSourceSpec[] | undefined;
  floorSettings: Partial<FloorSettings>[] | undefined;
  floorOffsetsM: Record<string, { xM: number; yM: number }>;
  edits: Edit[];
  exitDoorIds: string[];
  stairRegions: StairRegionInput[];
  stairLinkOverrides: Record<string, { widthM?: number }>;
  roofVents: RoofOpeningInput[];
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const entriesOf = (v: unknown): [string, unknown][] => (isObject(v) ? Object.entries(v) : []);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

function layerMapOf(v: unknown): LayerMap {
  return Object.fromEntries(entriesOf(v).filter(([, role]) => LAYER_ROLES.includes(role as LayerRole))) as LayerMap;
}

function cellsOf(v: unknown): Int32Array {
  if (v instanceof Int32Array) return v;
  return Array.isArray(v) ? Int32Array.from(v.filter((c): c is number => Number.isInteger(c))) : new Int32Array(0);
}

export function normalizeSettings(raw: unknown): NormalizedSettings {
  const s: Partial<Record<keyof ImportSettings, unknown>> = isObject(raw) ? raw : {};
  const floorSources = Array.isArray(s.floorSources)
    ? s.floorSources.filter(isObject).flatMap((f): FloorSourceSpec[] =>
        typeof f.floorId === 'string' && typeof f.fileName === 'string'
          ? [{
              floorId: f.floorId,
              fileName: f.fileName,
              ...(isStringArray(f.layers) ? { layers: f.layers } : {}),
              ...(typeof f.blockName === 'string' ? { blockName: f.blockName } : {}),
            }]
          : [],
      )
    : undefined;
  return {
    layerMaps: Object.fromEntries(entriesOf(s.layerMaps).filter(([, m]) => isObject(m)).map(([k, m]) => [k, layerMapOf(m)])),
    drawingUnits: Object.fromEntries(entriesOf(s.drawingUnits).filter(([, u]) => isDrawingUnit(u))) as Record<string, DrawingUnit>,
    floorSources: floorSources !== undefined && floorSources.length > 0 ? floorSources : undefined,
    floorSettings: Array.isArray(s.floorSettings) ? (s.floorSettings.filter(isObject) as Partial<FloorSettings>[]) : undefined,
    floorOffsetsM: Object.fromEntries(
      entriesOf(s.floorOffsetsM).filter(([, o]) => isObject(o) && typeof o.xM === 'number' && typeof o.yM === 'number').map(([k, o]) => [k, o as { xM: number; yM: number }]),
    ),
    edits: Array.isArray(s.edits) ? (s.edits as Edit[]) : [],
    exitDoorIds: Array.isArray(s.exitDoorIds) ? s.exitDoorIds.filter((id): id is string => typeof id === 'string') : [],
    stairRegions: Array.isArray(s.stairRegions)
      ? s.stairRegions.filter(isObject).flatMap((r): StairRegionInput[] => (typeof r.floorId === 'string' ? [{ floorId: r.floorId, cells: cellsOf(r.cells) }] : []))
      : [],
    stairLinkOverrides: Object.fromEntries(
      entriesOf(s.stairLinkOverrides).filter(([, o]) => isObject(o)).map(([k, o]) => [k, typeof (o as { widthM?: unknown }).widthM === 'number' ? { widthM: (o as { widthM: number }).widthM } : {}]),
    ),
    roofVents: Array.isArray(s.roofVents)
      ? s.roofVents.filter(isObject).flatMap((r): RoofOpeningInput[] =>
          typeof r.floorId === 'string' && typeof r.areaM2 === 'number' && typeof r.openFraction === 'number'
            ? [{ floorId: r.floorId, areaM2: r.areaM2, openFraction: r.openFraction }]
            : [],
        )
      : [],
  };
}
