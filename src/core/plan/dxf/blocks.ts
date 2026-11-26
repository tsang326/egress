// BLOCKS section and INSERT flattening (Req 1.5, 1.7, 3.3, 3.4, 3.5). Block geometry is transformed into plain
// entity coordinates, nested INSERTs included. A depth counter and an "expanding" set of block names on the call
// stack stop cycles and deep nesting; the entity cap also bounds the number of expansions, so a file whose blocks
// nest many inserts cannot make the output grow past DXF_MAX_ENTITIES. Never throws.
import { DXF_MAX_BLOCK_DEPTH, DXF_MAX_COORDINATE_M, DXF_MAX_ENTITIES, EXTRUSION_MIRROR_Z } from '../constants';
import type { ImportWarning } from '../types';
import { dxfBlockCycleOrDepth, dxfCoordinateOutOfRange, dxfEntitySkipped, dxfTooManyEntities } from '../warnings';
import { findSection, newReadContext, readEntities } from './entities';
import type { RawEntity, RawInsert, ReadContext } from './entities';
import type { GroupPair } from './tokenize';
import { IDENTITY, MIRROR_X, applyToPoint, determinant, insertTransform, multiply, tessellateCircle, transformArc, transformVertices } from './transform';
import type { Affine, ArcGeom, Point, Vertex } from './transform';

export interface BlockDefinition {
  name: string;
  baseX: number;
  baseY: number;
  entities: RawEntity[];
}

// What the reader keeps of one file's geometry before any transform.
export interface RawDrawing {
  entities: RawEntity[]; // ENTITIES section
  blocks: Map<string, BlockDefinition>; // key: block name in upper case (AutoCAD block names ignore case)
}

export type ReadDrawingResult =
  | { ok: true; drawing: RawDrawing; warnings: ImportWarning[] }
  | { ok: false; error: ImportWarning };

const blockKey = (name: string): string => name.toUpperCase();

function readBlocks(pairs: readonly GroupPair[], ctx: ReadContext): Map<string, BlockDefinition> {
  const blocks = new Map<string, BlockDefinition>();
  const section = findSection(pairs, 'BLOCKS');
  if (section === null) return blocks;
  let i = section.start;
  while (i < section.end) {
    const p = pairs[i] as GroupPair;
    if (!(p.code === 0 && p.value === 'BLOCK')) {
      i++;
      continue;
    }
    let headEnd = i + 1;
    while (headEnd < section.end && (pairs[headEnd] as GroupPair).code !== 0) headEnd++;
    let name = '';
    let altName = '';
    let baseX = 0;
    let baseY = 0;
    for (let k = i + 1; k < headEnd; k++) {
      const q = pairs[k] as GroupPair;
      if (q.code === 2 && name === '') name = String(q.value);
      else if (q.code === 3 && altName === '') altName = String(q.value);
      else if (q.code === 10 && typeof q.value === 'number') baseX = q.value;
      else if (q.code === 20 && typeof q.value === 'number') baseY = q.value;
    }
    let endBlk = headEnd;
    while (endBlk < section.end && !((pairs[endBlk] as GroupPair).code === 0 && (pairs[endBlk] as GroupPair).value === 'ENDBLK')) endBlk++;
    const entities = readEntities(pairs, headEnd, endBlk, ctx);
    const key = blockKey(name !== '' ? name : altName);
    if (key !== '' && !blocks.has(key)) blocks.set(key, { name: name !== '' ? name : altName, baseX, baseY, entities });
    i = endBlk + 1;
  }
  return blocks;
}

// Reads the ENTITIES and BLOCKS sections. Enforces the entity cap (Req 3.3) and reports skipped entity types (Req 1.6).
export function readDrawing(pairs: readonly GroupPair[], fileName: string): ReadDrawingResult {
  const ctx = newReadContext();
  const blocks = readBlocks(pairs, ctx);
  const section = findSection(pairs, 'ENTITIES');
  const entities = section === null ? [] : readEntities(pairs, section.start, section.end, ctx);
  if (ctx.count > DXF_MAX_ENTITIES) return { ok: false, error: dxfTooManyEntities(fileName, ctx.count) };
  const warnings: ImportWarning[] = [];
  for (const typeName of [...ctx.skipped.keys()].sort()) {
    warnings.push(dxfEntitySkipped(fileName, typeName, ctx.skipped.get(typeName) ?? 0));
  }
  return { ok: true, drawing: { entities, blocks }, warnings };
}

// ---- Flattening -------------------------------------------------------------------------------------------------

// Where a flattened entity came from when it sits inside a block: the outermost INSERT. The door builder needs this to
// measure a door block as one unit (Req 7.1).
export interface InsertOrigin {
  id: number; // order of the outermost INSERT among all outermost INSERTs, from 0
  blockName: string;
  layer: string; // layer of that INSERT
}

interface FlatBase {
  layer: string;
  insert?: InsertOrigin;
}
export interface FlatLine extends FlatBase {
  kind: 'LINE';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface FlatPolyline extends FlatBase {
  kind: 'POLYLINE';
  closed: boolean;
  vertices: Vertex[]; // bulge may be non-zero; arc segments are kept as arcs (Req 1.4)
}
export interface FlatArc extends FlatBase, ArcGeom {
  kind: 'ARC';
}
export interface FlatCircle extends FlatBase {
  kind: 'CIRCLE';
  cx: number;
  cy: number;
  r: number;
}
export type FlatEntity = FlatLine | FlatPolyline | FlatArc | FlatCircle;

export interface FlattenOptions {
  fileName: string;
  metersPerUnit: number; // for the coordinate range check (Req 3.5); coordinates in the result stay in drawing units
}

export type FlattenResult =
  | { ok: true; entities: FlatEntity[]; warnings: ImportWarning[]; missingBlocks: string[] }
  | { ok: false; error: ImportWarning };

interface FlattenState {
  opts: FlattenOptions;
  blocks: Map<string, BlockDefinition>;
  out: FlatEntity[];
  visited: number; // entities emitted plus INSERT expansions: bounded by DXF_MAX_ENTITIES
  nextInsertId: number;
  warnings: ImportWarning[];
  warnedBlocks: Set<string>;
  warnedCoords: Set<string>;
  missing: Set<string>;
  expanding: Set<string>;
}

export function flattenEntities(drawing: RawDrawing, opts: FlattenOptions): FlattenResult {
  const st: FlattenState = {
    opts,
    blocks: drawing.blocks,
    out: [],
    visited: 0,
    nextInsertId: 0,
    warnings: [],
    warnedBlocks: new Set(),
    warnedCoords: new Set(),
    missing: new Set(),
    expanding: new Set(),
  };
  for (const e of drawing.entities) {
    if (e.type === 'INSERT') {
      const origin: InsertOrigin = { id: st.nextInsertId++, blockName: e.blockName, layer: e.layer };
      expandInsert(st, e, IDENTITY, 1, e.layer, origin);
    } else {
      emit(st, e, IDENTITY, e.layer, undefined);
    }
    if (st.visited > DXF_MAX_ENTITIES) return { ok: false, error: dxfTooManyEntities(opts.fileName, st.visited) };
  }
  return { ok: true, entities: st.out, warnings: st.warnings, missingBlocks: [...st.missing].sort() };
}

function expandInsert(st: FlattenState, ins: RawInsert, parent: Affine, depth: number, insertLayer: string, origin: InsertOrigin): void {
  if (++st.visited > DXF_MAX_ENTITIES) return;
  const key = blockKey(ins.blockName);
  const block = st.blocks.get(key);
  if (block === undefined) {
    st.missing.add(ins.blockName);
    return;
  }
  if (depth > DXF_MAX_BLOCK_DEPTH || st.expanding.has(key)) {
    if (!st.warnedBlocks.has(key)) {
      st.warnedBlocks.add(key);
      st.warnings.push(dxfBlockCycleOrDepth(st.opts.fileName, block.name));
    }
    return;
  }
  const scaleOk = Number.isFinite(ins.scaleX) && Number.isFinite(ins.scaleY) && ins.scaleX !== 0 && ins.scaleY !== 0;
  const here = ocs(ins.extrusionZ);
  const local = insertTransform(ins.x, ins.y, ins.scaleX, ins.scaleY, ins.rotationDeg, block.baseX, block.baseY);
  const m = multiply(parent, multiply(here, local));
  if (!scaleOk || !allFinite(m.a, m.b, m.c, m.d, m.e, m.f) || determinant(m) === 0) {
    warnCoordinate(st, ins.layer, 'INSERT');
    return;
  }
  st.expanding.add(key);
  for (const e of block.entities) {
    if (st.visited > DXF_MAX_ENTITIES) break;
    if (e.type === 'INSERT') {
      // A layer-0 INSERT inside a block takes the layer of the INSERT around it, like any layer-0 entity.
      expandInsert(st, e, m, depth + 1, e.layer === '0' ? insertLayer : e.layer, origin);
    } else {
      emit(st, e, m, e.layer === '0' ? insertLayer : e.layer, origin);
    }
  }
  st.expanding.delete(key);
}

const ocs = (extrusionZ: number): Affine => (extrusionZ < EXTRUSION_MIRROR_Z ? MIRROR_X : IDENTITY);

const allFinite = (...v: number[]): boolean => v.every(Number.isFinite);

function warnCoordinate(st: FlattenState, layer: string, typeName: string): void {
  const key = `${layer}\u0000${typeName}`;
  if (st.warnedCoords.has(key)) return;
  st.warnedCoords.add(key);
  st.warnings.push(dxfCoordinateOutOfRange(st.opts.fileName, layer, typeName));
}

// A coordinate is usable when it is finite and within DXF_MAX_COORDINATE_M of the origin after unit conversion.
function inRange(st: FlattenState, ...v: number[]): boolean {
  const limit = DXF_MAX_COORDINATE_M / st.opts.metersPerUnit;
  return v.every((x) => Number.isFinite(x) && Math.abs(x) <= limit);
}

function emit(st: FlattenState, e: Exclude<RawEntity, RawInsert>, parent: Affine, layer: string, origin: InsertOrigin | undefined): void {
  if (++st.visited > DXF_MAX_ENTITIES) return;
  const m = multiply(parent, ocs(e.extrusionZ));
  const base = origin === undefined ? { layer } : { layer, insert: origin };
  const bad = (): void => warnCoordinate(st, layer, e.dxfType);

  switch (e.type) {
    case 'LINE': {
      if (!allFinite(e.x1, e.y1, e.x2, e.y2)) return bad();
      const p = applyToPoint(m, e.x1, e.y1);
      const q = applyToPoint(m, e.x2, e.y2);
      if (!inRange(st, p.x, p.y, q.x, q.y)) return bad();
      st.out.push({ ...base, kind: 'LINE', x1: p.x, y1: p.y, x2: q.x, y2: q.y });
      return;
    }
    case 'POLYLINE': {
      if (e.vertices.length < 2 || !e.vertices.every((v) => allFinite(v.x, v.y, v.bulge))) return bad();
      const vertices = transformVertices(e.vertices, e.closed, m);
      if (!vertices.every((v) => inRange(st, v.x, v.y))) return bad();
      st.out.push({ ...base, kind: 'POLYLINE', closed: e.closed, vertices });
      return;
    }
    case 'ARC': {
      if (!allFinite(e.cx, e.cy, e.r, e.startDeg, e.endDeg) || !(e.r > 0)) return bad();
      const start = (e.startDeg * Math.PI) / 180;
      let sweep = (((e.endDeg - e.startDeg) % 360) + 360) % 360;
      if (sweep === 0) sweep = 360; // equal start and end angles draw a full circle
      const arc: ArcGeom = { cx: e.cx, cy: e.cy, r: e.r, startRad: start, sweepRad: (sweep * Math.PI) / 180 };
      const t = transformArc(arc, m);
      if (t.kind === 'arc') {
        if (!inRange(st, t.arc.cx, t.arc.cy, t.arc.r)) return bad();
        const a = t.arc;
        const ends: Point[] = [pointOn(a, a.startRad), pointOn(a, a.startRad + a.sweepRad)];
        if (!ends.every((p) => inRange(st, p.x, p.y))) return bad();
        st.out.push({ ...base, kind: 'ARC', cx: a.cx, cy: a.cy, r: a.r, startRad: a.startRad, sweepRad: a.sweepRad });
      } else {
        if (!t.points.every((p) => inRange(st, p.x, p.y))) return bad();
        st.out.push({ ...base, kind: 'POLYLINE', closed: false, vertices: t.points.map((p) => ({ x: p.x, y: p.y, bulge: 0 })) });
      }
      return;
    }
    case 'CIRCLE': {
      if (!allFinite(e.cx, e.cy, e.r) || !(e.r > 0)) return bad();
      const similar = tessellateIfNeeded(m, e.cx, e.cy, e.r);
      if (similar === null) {
        const c = applyToPoint(m, e.cx, e.cy);
        const r = e.r * Math.sqrt(Math.abs(determinant(m)));
        if (!inRange(st, c.x, c.y, c.x - r, c.x + r, c.y - r, c.y + r)) return bad();
        st.out.push({ ...base, kind: 'CIRCLE', cx: c.x, cy: c.y, r });
      } else {
        if (!similar.every((p) => inRange(st, p.x, p.y))) return bad();
        st.out.push({ ...base, kind: 'POLYLINE', closed: true, vertices: similar.map((p) => ({ x: p.x, y: p.y, bulge: 0 })) });
      }
      return;
    }
  }
}

function pointOn(a: ArcGeom, ang: number): Point {
  return { x: a.cx + a.r * Math.cos(ang), y: a.cy + a.r * Math.sin(ang) };
}

// Null when the transform keeps the circle round; otherwise the ring of points of the resulting ellipse.
function tessellateIfNeeded(m: Affine, cx: number, cy: number, r: number): Point[] | null {
  const probe = transformArc({ cx, cy, r, startRad: 0, sweepRad: Math.PI }, m);
  return probe.kind === 'arc' ? null : tessellateCircle(cx, cy, r, m);
}
