// What the import screen needs to know about one DXF file before the building model exists: the file sniff, the layers
// with their entity counts and suggested roles, the unit stated in the header, and the flattened entities for the
// preview. Reads through the core reader; it never builds a model (importBuildingModel runs in the worker only).
// Layer and block names come from untrusted files: they are kept as data and shown with textContent only.
import { METERS_PER_UNIT } from '../../core/plan/constants';
import { flattenEntities, type FlatEntity } from '../../core/plan/dxf/blocks';
import { readDxf } from '../../core/plan/dxf/reader';
import { countEntitiesPerLayer, suggestLayerRole } from '../../core/plan/layers';
import { drawingExtentInUnit, resolveDrawingUnit, type DrawingExtent } from '../../core/plan/units';
import type { DrawingUnit, ImportWarning, LayerRole } from '../../core/plan/types';

export const NOT_DXF_MESSAGE =
  'This file is not an ASCII DXF drawing. Save as DXF (ASCII) in your CAD program and load the new file.';

/** Bytes read from the start of a file for the sniff. */
export const SNIFF_BYTES = 1024;

/**
 * True when the file looks like a DXF: the name ends in `.dxf`, or the first non-empty line is `0` and the next
 * non-empty line is `SECTION` (Requirement 3, task 18.1). `head` is the first bytes of the file as text.
 */
export function looksLikeDxf(fileName: string, head: string): boolean {
  if (/\.dxf$/i.test(fileName)) return true;
  const lines = head.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
  return lines[0]?.trim() === '0' && lines[1]?.trim().toUpperCase() === 'SECTION';
}

export interface LayerInfo {
  name: string;
  entityCount: number;
  suggestedRole: LayerRole;
}

export interface Inspection {
  fileName: string;
  layers: LayerInfo[];
  entities: FlatEntity[]; // drawing units
  blockNames: string[];
  /** Unit stated by `$INSUNITS`, or null when the file does not state one. */
  headerUnit: DrawingUnit | null;
  /** Suggestion for a file without a stated unit (from `$MEASUREMENT`). */
  suggestedUnit: DrawingUnit;
}

export type InspectResult = { ok: true; inspection: Inspection } | { ok: false; warnings: ImportWarning[] };

export function inspectDxf(fileName: string, text: string): InspectResult {
  const read = readDxf(text, fileName);
  if (read.status === 'invalid') return { ok: false, warnings: [...read.errors, ...read.warnings] };
  const unit = resolveDrawingUnit(fileName, read.document.header);
  const headerUnit = unit.status === 'resolved' ? unit.unit : null;
  const suggestedUnit = unit.status === 'resolved' ? unit.unit : unit.question.suggestedUnit;
  const flat = flattenEntities(read.document.drawing, { fileName, metersPerUnit: METERS_PER_UNIT[suggestedUnit] });
  if (!flat.ok) return { ok: false, warnings: [flat.error] };
  const layers = [...countEntitiesPerLayer(flat.entities)].map(([name, entityCount]) => ({
    name,
    entityCount,
    suggestedRole: suggestLayerRole(name),
  }));
  const blockNames = [...read.document.drawing.blocks.values()].map((b) => b.name);
  return { ok: true, inspection: { fileName, layers, entities: flat.entities, blockNames, headerUnit, suggestedUnit } };
}

/** Width and depth of the drawing in metres if it were drawn in `unit`, shown next to the unit choice. */
export function extentInUnit(entities: readonly FlatEntity[], unit: DrawingUnit): DrawingExtent | null {
  return drawingExtentInUnit(entities, METERS_PER_UNIT[unit]);
}
