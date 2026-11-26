// Drawing units (Req 2): resolve the unit of one file, convert flattened geometry to metres once, and report the
// drawing extent. Pure; never throws. Every factor comes from constants.ts (INSUNITS_TABLE, METERS_PER_UNIT).
import { INSUNITS_TABLE, MEASUREMENT_SUGGESTED_UNIT, METERS_PER_UNIT } from './constants';
import type { FlatEntity } from './dxf/blocks';
import type { DxfHeader } from './dxf/header';
import { bulgeToArc } from './dxf/transform';
import type { ArcGeom, Point } from './dxf/transform';
import type { DrawingUnit, ImportWarning, PendingQuestion } from './types';
import { unitUnknown } from './warnings';

export type UnitSource = 'insunits' | 'user';

export type UnitResolution =
  | { status: 'resolved'; unit: DrawingUnit; metersPerUnit: number; source: UnitSource; overridesInsUnits: boolean }
  | { status: 'pending'; question: Extract<PendingQuestion, { kind: 'DRAWING_UNIT' }>; warning: ImportWarning };

// Fallback suggestion when a unitless file has no $MEASUREMENT either (see design.md, Decisions during implementation).
const SUGGESTION_WITHOUT_MEASUREMENT: DrawingUnit = 'mm';

export function isDrawingUnit(v: unknown): v is DrawingUnit {
  return typeof v === 'string' && Object.hasOwn(METERS_PER_UNIT, v);
}

// $INSUNITS code -> unit, or null for 0, absent or any code outside the table (Req 2.1, 2.2, 2.4).
export function unitFromInsUnits(code: number | null): { unit: DrawingUnit; metersPerUnit: number } | null {
  if (code === null || !Object.hasOwn(INSUNITS_TABLE, code)) return null;
  return INSUNITS_TABLE[code] ?? null;
}

export function suggestUnit(measurement: number | null): DrawingUnit {
  if (measurement === null || !Object.hasOwn(MEASUREMENT_SUGGESTED_UNIT, measurement)) return SUGGESTION_WITHOUT_MEASUREMENT;
  return MEASUREMENT_SUGGESTED_UNIT[measurement] ?? SUGGESTION_WITHOUT_MEASUREMENT;
}

// `chosen` is the user's answer (ImportSettings.drawingUnits[fileName]); it wins over $INSUNITS (Req 2.5). An invalid
// `chosen` value is ignored. Without a usable unit the result is a pending question and the file's model is withheld
// (Req 2.3); `suggestedUnit` is only a suggestion (Req 2.2).
export function resolveDrawingUnit(fileName: string, header: Pick<DxfHeader, 'insUnits' | 'measurement'>, chosen?: unknown): UnitResolution {
  const fromHeader = unitFromInsUnits(header.insUnits);
  if (isDrawingUnit(chosen)) {
    return {
      status: 'resolved',
      unit: chosen,
      metersPerUnit: METERS_PER_UNIT[chosen],
      source: 'user',
      overridesInsUnits: fromHeader !== null && fromHeader.unit !== chosen,
    };
  }
  if (fromHeader !== null) {
    return { status: 'resolved', unit: fromHeader.unit, metersPerUnit: fromHeader.metersPerUnit, source: 'insunits', overridesInsUnits: false };
  }
  return {
    status: 'pending',
    question: { kind: 'DRAWING_UNIT', fileName, suggestedUnit: suggestUnit(header.measurement) },
    warning: unitUnknown(fileName),
  };
}

// ---- Conversion -------------------------------------------------------------------------------------------------

// All coordinates and lengths times `metersPerUnit`. Bulges and angles have no unit and stay as they are.
export function convertToMeters(entities: readonly FlatEntity[], metersPerUnit: number): FlatEntity[] {
  const k = metersPerUnit;
  return entities.map((e): FlatEntity => {
    switch (e.kind) {
      case 'LINE':
        return { ...e, x1: e.x1 * k, y1: e.y1 * k, x2: e.x2 * k, y2: e.y2 * k };
      case 'POLYLINE':
        return { ...e, vertices: e.vertices.map((v) => ({ x: v.x * k, y: v.y * k, bulge: v.bulge })) };
      case 'ARC':
        return { ...e, cx: e.cx * k, cy: e.cy * k, r: e.r * k };
      case 'CIRCLE':
        return { ...e, cx: e.cx * k, cy: e.cy * k, r: e.r * k };
    }
  });
}

// ---- Extent -----------------------------------------------------------------------------------------------------

export interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DrawingExtent extends Extent {
  widthM: number;
  depthM: number;
}

class Bounds {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  add(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }
}

const HALF_PI = Math.PI / 2;

// Exact bounds of a counter-clockwise arc: its two end points plus every axis extreme the sweep passes through.
function addArc(b: Bounds, a: ArcGeom): void {
  b.add(a.cx + a.r * Math.cos(a.startRad), a.cy + a.r * Math.sin(a.startRad));
  const end = a.startRad + a.sweepRad;
  b.add(a.cx + a.r * Math.cos(end), a.cy + a.r * Math.sin(end));
  const first = Math.ceil(a.startRad / HALF_PI);
  for (let q = first; q * HALF_PI <= end; q++) {
    const ang = q * HALF_PI;
    b.add(a.cx + a.r * Math.cos(ang), a.cy + a.r * Math.sin(ang));
  }
}

function addPolyline(b: Bounds, vertices: readonly { x: number; y: number; bulge: number }[], closed: boolean): void {
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const v = vertices[i] as { x: number; y: number; bulge: number };
    b.add(v.x, v.y);
    if (v.bulge !== 0 && (closed || i + 1 < n)) {
      const next = vertices[(i + 1) % n] as Point;
      const arc = bulgeToArc(v, next, v.bulge);
      if (arc !== null) addArc(b, arc);
    }
  }
}

// Bounding box of the entities in their own units, or null when there is no geometry.
export function entityBounds(entities: readonly FlatEntity[]): Extent | null {
  const b = new Bounds();
  for (const e of entities) {
    switch (e.kind) {
      case 'LINE':
        b.add(e.x1, e.y1);
        b.add(e.x2, e.y2);
        break;
      case 'POLYLINE':
        addPolyline(b, e.vertices, e.closed);
        break;
      case 'ARC':
        addArc(b, e);
        break;
      case 'CIRCLE':
        b.add(e.cx - e.r, e.cy - e.r);
        b.add(e.cx + e.r, e.cy + e.r);
        break;
    }
  }
  return b.minX > b.maxX ? null : { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
}

// Width (x) and depth (y) of the drawing in metres, shown next to the unit choice so the user can check the scale
// (Req 2.6). Takes entities in metres (after convertToMeters). Null when the drawing has no geometry.
export function drawingExtent(entitiesM: readonly FlatEntity[]): DrawingExtent | null {
  const e = entityBounds(entitiesM);
  return e === null ? null : { ...e, widthM: e.maxX - e.minX, depthM: e.maxY - e.minY };
}

// Same, for entities still in drawing units: lets the screen show the extent for each candidate unit of a unitless
// file before the user chooses.
export function drawingExtentInUnit(entities: readonly FlatEntity[], metersPerUnit: number): DrawingExtent | null {
  const e = entityBounds(entities);
  if (e === null) return null;
  const k = metersPerUnit;
  return { minX: e.minX * k, minY: e.minY * k, maxX: e.maxX * k, maxY: e.maxY * k, widthM: (e.maxX - e.minX) * k, depthM: (e.maxY - e.minY) * k };
}
