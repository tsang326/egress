// Test helper: writes ASCII DXF text for the plan-import tests (Req 20.1, 20.2, 20.3).
//
// All lengths in the input model are METRES. The writer divides them by the metres-per-unit factor of the chosen
// file unit, so the same model can be written in mm, cm, m, in or ft (Req 20.2). Angles are degrees (DXF
// convention); INSERT scales are unitless. Block geometry is scaled like the entities, because a DXF block holds
// coordinates in drawing units.
//
// Only what the reader needs is written. Output is deterministic: no clock, no random values.
import type { DrawingUnit } from '../../../src/core/plan/types';

// Exact definitions (inch 0.0254 m, foot 0.3048 m, SI prefixes). Same table as the reader, kept local so the helper
// does not depend on the code under test.
const METERS_PER_UNIT: Readonly<Record<DrawingUnit, number>> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
// DXF reference, $INSUNITS values.
const INSUNITS_CODE: Readonly<Record<DrawingUnit, number>> = { in: 1, ft: 2, mm: 4, cm: 5, m: 6 };

export type Pt = readonly [xM: number, yM: number];

export interface DxfVertex {
  xM: number;
  yM: number;
  /** DXF bulge: tan(sweep/4) of the arc to the next vertex; 0 or absent = straight. Positive = counter-clockwise. */
  bulge?: number;
}

export type DxfEntity =
  | { type: 'LINE'; layer: string; a: Pt; b: Pt }
  | { type: 'LWPOLYLINE'; layer: string; vertices: DxfVertex[]; closed?: boolean }
  // Old-style POLYLINE followed by VERTEX records and SEQEND.
  | { type: 'POLYLINE'; layer: string; vertices: DxfVertex[]; closed?: boolean }
  | { type: 'ARC'; layer: string; center: Pt; radiusM: number; startDeg: number; endDeg: number }
  | { type: 'CIRCLE'; layer: string; center: Pt; radiusM: number }
  | {
      type: 'INSERT';
      layer: string;
      block: string;
      at: Pt;
      /** Negative values mirror (Req 1.7). Default 1. */
      scaleX?: number;
      scaleY?: number;
      rotationDeg?: number;
    };

export interface DxfBlock {
  name: string;
  /** Block base point in metres (group codes 10/20). Default [0, 0]. */
  base?: Pt;
  entities: DxfEntity[]; // may contain INSERT, for nested blocks
}

export interface DxfDocument {
  entities: DxfEntity[];
  blocks?: DxfBlock[];
  /** Layer names for the LAYER table. Layers used by entities but not listed are added. */
  layers?: string[];
  /** File unit. Coordinates are written in it. Default 'm'. */
  unit?: DrawingUnit;
  /** $INSUNITS value written. Default: the code of `unit`. `null` omits the variable (unitless file); a number
   * writes that raw code, for example 0 or an unknown code. */
  insunits?: number | null;
  /** $MEASUREMENT value (0 English, 1 metric). `null` omits it. Default: omitted. */
  measurement?: number | null;
  /** $ACADVER. `null` omits it (Req 1.2). Default 'AC1027'. */
  acadVer?: string | null;
  /** Group code 999 comments written first. */
  comments?: string[];
  /** Line ending. Default '\n'. */
  eol?: '\n' | '\r\n';
}

// ---- number and pair formatting ---------------------------------------------------------------------------------

/** Plain decimal, no exponent, at most 9 decimals, trailing zeros trimmed. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const s = n.toFixed(9);
  const trimmed = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return trimmed === '-0' || trimmed === '' ? '0' : trimmed;
}

class Out {
  readonly lines: string[] = [];
  s(code: number, value: string): void {
    this.lines.push(String(code), value);
  }
  n(code: number, value: number): void {
    this.s(code, formatNumber(value));
  }
  i(code: number, value: number): void {
    this.s(code, String(Math.trunc(value)));
  }
}

// ---- entity writers ---------------------------------------------------------------------------------------------

function writeEntity(o: Out, e: DxfEntity, k: number): void {
  const L = (m: number): number => m / k;
  o.s(0, e.type);
  o.s(8, e.layer);
  switch (e.type) {
    case 'LINE':
      o.n(10, L(e.a[0]));
      o.n(20, L(e.a[1]));
      o.n(30, 0);
      o.n(11, L(e.b[0]));
      o.n(21, L(e.b[1]));
      o.n(31, 0);
      break;
    case 'LWPOLYLINE':
      o.s(100, 'AcDbEntity');
      // Layer is group 8 and must follow the subclass marker in real files; readers key on codes, so order is free.
      o.s(100, 'AcDbPolyline');
      o.i(90, e.vertices.length);
      o.i(70, e.closed ? 1 : 0);
      for (const v of e.vertices) {
        o.n(10, L(v.xM));
        o.n(20, L(v.yM));
        if (v.bulge !== undefined && v.bulge !== 0) o.n(42, v.bulge);
      }
      break;
    case 'POLYLINE':
      o.i(66, 1);
      o.n(10, 0);
      o.n(20, 0);
      o.n(30, 0);
      o.i(70, e.closed ? 1 : 0);
      for (const v of e.vertices) {
        o.s(0, 'VERTEX');
        o.s(8, e.layer);
        o.n(10, L(v.xM));
        o.n(20, L(v.yM));
        o.n(30, 0);
        if (v.bulge !== undefined && v.bulge !== 0) o.n(42, v.bulge);
      }
      o.s(0, 'SEQEND');
      o.s(8, e.layer);
      break;
    case 'ARC':
      o.n(10, L(e.center[0]));
      o.n(20, L(e.center[1]));
      o.n(30, 0);
      o.n(40, L(e.radiusM));
      o.n(50, e.startDeg);
      o.n(51, e.endDeg);
      break;
    case 'CIRCLE':
      o.n(10, L(e.center[0]));
      o.n(20, L(e.center[1]));
      o.n(30, 0);
      o.n(40, L(e.radiusM));
      break;
    case 'INSERT':
      o.s(2, e.block);
      o.n(10, L(e.at[0]));
      o.n(20, L(e.at[1]));
      o.n(30, 0);
      o.n(41, e.scaleX ?? 1);
      o.n(42, e.scaleY ?? 1);
      o.n(43, 1);
      o.n(50, e.rotationDeg ?? 0);
      break;
  }
}

function collectLayers(entities: DxfEntity[], blocks: DxfBlock[], into: Set<string>): void {
  for (const e of entities) into.add(e.layer);
  for (const b of blocks) for (const e of b.entities) into.add(e.layer);
}

/** Writes the document as ASCII DXF text. Total for well-typed input. */
export function writeDxf(doc: DxfDocument): string {
  const unit: DrawingUnit = doc.unit ?? 'm';
  const k = METERS_PER_UNIT[unit];
  const blocks = doc.blocks ?? [];
  const o = new Out();

  for (const c of doc.comments ?? []) o.s(999, c);

  // HEADER
  o.s(0, 'SECTION');
  o.s(2, 'HEADER');
  const ver = doc.acadVer === undefined ? 'AC1027' : doc.acadVer;
  if (ver !== null) {
    o.s(9, '$ACADVER');
    o.s(1, ver);
  }
  const ins = doc.insunits === undefined ? INSUNITS_CODE[unit] : doc.insunits;
  if (ins !== null) {
    o.s(9, '$INSUNITS');
    o.i(70, ins);
  }
  if (doc.measurement !== undefined && doc.measurement !== null) {
    o.s(9, '$MEASUREMENT');
    o.i(70, doc.measurement);
  }
  o.s(0, 'ENDSEC');

  // TABLES: LAYER
  const layerSet = new Set<string>(doc.layers ?? []);
  collectLayers(doc.entities, blocks, layerSet);
  o.s(0, 'SECTION');
  o.s(2, 'TABLES');
  o.s(0, 'TABLE');
  o.s(2, 'LAYER');
  o.i(70, layerSet.size);
  for (const name of layerSet) {
    o.s(0, 'LAYER');
    o.s(2, name);
    o.i(70, 0);
    o.i(62, 7);
    o.s(6, 'CONTINUOUS');
  }
  o.s(0, 'ENDTAB');
  o.s(0, 'ENDSEC');

  // BLOCKS
  o.s(0, 'SECTION');
  o.s(2, 'BLOCKS');
  for (const b of blocks) {
    o.s(0, 'BLOCK');
    o.s(8, '0');
    o.s(2, b.name);
    o.i(70, 0);
    o.n(10, (b.base?.[0] ?? 0) / k);
    o.n(20, (b.base?.[1] ?? 0) / k);
    o.n(30, 0);
    o.s(3, b.name);
    o.s(1, '');
    for (const e of b.entities) writeEntity(o, e, k);
    o.s(0, 'ENDBLK');
    o.s(8, '0');
  }
  o.s(0, 'ENDSEC');

  // ENTITIES
  o.s(0, 'SECTION');
  o.s(2, 'ENTITIES');
  for (const e of doc.entities) writeEntity(o, e, k);
  o.s(0, 'ENDSEC');
  o.s(0, 'EOF');

  const eol = doc.eol ?? '\n';
  return o.lines.join(eol) + eol;
}

// ---- small builders ---------------------------------------------------------------------------------------------

/** Closed LWPOLYLINE rectangle from corner (x0, y0) to (x1, y1), in metres. */
export function rectOutline(layer: string, x0: number, y0: number, x1: number, y1: number): DxfEntity {
  return {
    type: 'LWPOLYLINE',
    layer,
    closed: true,
    vertices: [
      { xM: x0, yM: y0 },
      { xM: x1, yM: y0 },
      { xM: x1, yM: y1 },
      { xM: x0, yM: y1 },
    ],
  };
}

/** A door block: a leaf line along +x of length widthM plus a quarter-circle swing arc. For INSERT tests (Req 7.1). */
export function doorBlock(name: string, widthM: number, layer = 'A-DOOR'): DxfBlock {
  return {
    name,
    entities: [
      { type: 'LINE', layer, a: [0, 0], b: [widthM, 0] },
      { type: 'ARC', layer, center: [0, 0], radiusM: widthM, startDeg: 0, endDeg: 90 },
    ],
  };
}
