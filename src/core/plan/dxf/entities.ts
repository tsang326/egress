// Entity readers: group-code pairs -> raw entities (Req 1.3, 1.4, 1.6, 3.3). Values stay in drawing units and in the
// entity's own coordinate system; transforms and range checks happen when blocks are flattened (blocks.ts).
// Never throws. Linear in the number of pairs.
import { DXF_MAX_ENTITIES } from '../constants';
import type { GroupPair } from './tokenize';
import type { Vertex } from './transform';

export type DxfEntityTypeName = 'LINE' | 'LWPOLYLINE' | 'POLYLINE' | 'ARC' | 'CIRCLE' | 'INSERT';

interface RawBase {
  layer: string;
  extrusionZ: number; // group 230; 1 when absent
  line: number; // 1-based line number of the entity's `0` group code
  dxfType: DxfEntityTypeName; // the type name as written, for messages
}
export interface RawLine extends RawBase {
  type: 'LINE';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface RawPolyline extends RawBase {
  type: 'POLYLINE'; // LWPOLYLINE and 2D POLYLINE share this shape
  closed: boolean;
  vertices: Vertex[];
}
export interface RawArc extends RawBase {
  type: 'ARC';
  cx: number;
  cy: number;
  r: number;
  startDeg: number;
  endDeg: number;
}
export interface RawCircle extends RawBase {
  type: 'CIRCLE';
  cx: number;
  cy: number;
  r: number;
}
export interface RawInsert extends RawBase {
  type: 'INSERT';
  blockName: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
}
export type RawEntity = RawLine | RawPolyline | RawArc | RawCircle | RawInsert;

// Shared state of one file's entity reading (entities of ENTITIES and of every block).
export interface ReadContext {
  count: number; // entities seen so far, kept or skipped
  skipped: Map<string, number>; // entity type name -> count of skipped entities (Req 1.6)
}
export function newReadContext(): ReadContext {
  return { count: 0, skipped: new Map() };
}

export interface SectionRange {
  start: number; // first pair after the `2 NAME` pair
  end: number; // index of the ENDSEC pair, or pairs.length when missing
}

// Pair range of the section with the given name (HEADER, BLOCKS, ENTITIES, ...), or null.
export function findSection(pairs: readonly GroupPair[], name: string): SectionRange | null {
  for (let i = 0; i + 1 < pairs.length; i++) {
    const p = pairs[i] as GroupPair;
    const n = pairs[i + 1] as GroupPair;
    if (p.code === 0 && p.value === 'SECTION' && n.code === 2 && n.value === name) {
      for (let j = i + 2; j < pairs.length; j++) {
        const q = pairs[j] as GroupPair;
        if (q.code === 0 && q.value === 'ENDSEC') return { start: i + 2, end: j };
      }
      return { start: i + 2, end: pairs.length };
    }
  }
  return null;
}

// Index of the next pair with group code 0 at or after `from`, or `end`.
function nextEntityStart(pairs: readonly GroupPair[], from: number, end: number): number {
  let i = from;
  while (i < end && (pairs[i] as GroupPair).code !== 0) i++;
  return i;
}

function num(p: GroupPair): number {
  return typeof p.value === 'number' ? p.value : Number.NaN;
}
function str(p: GroupPair): string {
  return typeof p.value === 'string' ? p.value : String(p.value);
}

const POLYLINE_CLOSED = 1; // DXF reference, group 70 of POLYLINE and LWPOLYLINE: bit 1 closed
const POLYLINE_NOT_2D = 8 | 16 | 64; // 3D polyline, polygon mesh, polyface mesh
const VERTEX_SPLINE_FRAME = 16; // group 70 of VERTEX: spline frame control point, not on the curve

interface Common {
  layer: string;
  extrusionZ: number;
}
function readCommon(body: readonly GroupPair[]): Common {
  let layer = '0';
  let extrusionZ = 1;
  for (const p of body) {
    if (p.code === 8) layer = str(p);
    else if (p.code === 230) extrusionZ = num(p);
  }
  return { layer, extrusionZ };
}

// First value of a group code in an entity body, or NaN when absent. Coordinates of single-point entities use this.
function first(body: readonly GroupPair[], code: number, fallback = Number.NaN): number {
  for (const p of body) if (p.code === code) return num(p);
  return fallback;
}

function readLwPolyline(body: readonly GroupPair[]): { closed: boolean; vertices: Vertex[] } {
  let flags = 0;
  const vertices: Vertex[] = [];
  let pendingX: number | null = null;
  for (const p of body) {
    if (p.code === 70 && vertices.length === 0 && pendingX === null) flags = num(p);
    else if (p.code === 10) pendingX = num(p);
    else if (p.code === 20 && pendingX !== null) {
      vertices.push({ x: pendingX, y: num(p), bulge: 0 });
      pendingX = null;
    } else if (p.code === 42 && vertices.length > 0) (vertices[vertices.length - 1] as Vertex).bulge = num(p);
  }
  return { closed: (flags & POLYLINE_CLOSED) !== 0, vertices };
}

function readVertex(body: readonly GroupPair[]): Vertex | null {
  const flags = first(body, 70, 0);
  if (Number.isFinite(flags) && (flags & VERTEX_SPLINE_FRAME) !== 0) return null;
  return { x: first(body, 10), y: first(body, 20), bulge: first(body, 42, 0) };
}

function skip(ctx: ReadContext, typeName: string): void {
  ctx.skipped.set(typeName, (ctx.skipped.get(typeName) ?? 0) + 1);
}

// Entities of pairs[start, end). Entities past DXF_MAX_ENTITIES are counted but not kept; the caller compares
// ctx.count with the cap and reports the count found (Req 3.3).
export function readEntities(pairs: readonly GroupPair[], start: number, end: number, ctx: ReadContext): RawEntity[] {
  const out: RawEntity[] = [];
  let i = nextEntityStart(pairs, start, end);
  while (i < end) {
    const head = pairs[i] as GroupPair;
    const typeName = str(head);
    const bodyEnd = nextEntityStart(pairs, i + 1, end);
    const body = pairs.slice(i + 1, bodyEnd);
    i = bodyEnd;

    if (typeName === 'SEQEND' || typeName === 'ENDBLK') continue; // structure markers, not entities

    ctx.count++;
    const keep = ctx.count <= DXF_MAX_ENTITIES;
    const common = readCommon(body);
    const base = { ...common, line: head.line };
    // Paper-space entities (group 67 = 1) are layout drawing, not the building; they are not counted as skipped.
    const paper = first(body, 67, 0) === 1;

    switch (typeName) {
      case 'LINE':
        if (keep && !paper)
          out.push({ ...base, type: 'LINE', dxfType: 'LINE', x1: first(body, 10), y1: first(body, 20), x2: first(body, 11), y2: first(body, 21) });
        break;
      case 'LWPOLYLINE':
        if (keep && !paper) out.push({ ...base, type: 'POLYLINE', dxfType: 'LWPOLYLINE', ...readLwPolyline(body) });
        break;
      case 'POLYLINE': {
        // Old style: the VERTEX entities that follow, up to SEQEND, belong to this entity.
        const flags = first(body, 70, 0);
        const vertices: Vertex[] = [];
        while (i < end && (pairs[i] as GroupPair).value === 'VERTEX') {
          const vEnd = nextEntityStart(pairs, i + 1, end);
          const v = readVertex(pairs.slice(i + 1, vEnd));
          if (v !== null) vertices.push(v);
          i = vEnd;
        }
        if (!Number.isFinite(flags) || (flags & POLYLINE_NOT_2D) !== 0) {
          if (!paper) skip(ctx, 'POLYLINE (3D or mesh)');
        } else if (keep && !paper) {
          out.push({ ...base, type: 'POLYLINE', dxfType: 'POLYLINE', closed: (flags & POLYLINE_CLOSED) !== 0, vertices });
        }
        break;
      }
      case 'ARC':
        if (keep && !paper)
          out.push({ ...base, type: 'ARC', dxfType: 'ARC', cx: first(body, 10), cy: first(body, 20), r: first(body, 40), startDeg: first(body, 50, 0), endDeg: first(body, 51, 360) });
        break;
      case 'CIRCLE':
        if (keep && !paper) out.push({ ...base, type: 'CIRCLE', dxfType: 'CIRCLE', cx: first(body, 10), cy: first(body, 20), r: first(body, 40) });
        break;
      case 'INSERT': {
        if (keep && !paper) {
          let name = '';
          for (const p of body) if (p.code === 2) { name = str(p); break; }
          out.push({
            ...base,
            type: 'INSERT',
            dxfType: 'INSERT',
            blockName: name,
            x: first(body, 10),
            y: first(body, 20),
            scaleX: first(body, 41, 1),
            scaleY: first(body, 42, 1),
            rotationDeg: first(body, 50, 0),
          });
        }
        break;
      }
      case 'VERTEX':
        break; // stray vertex outside a POLYLINE: nothing to read, not worth a message
      default:
        if (!paper) skip(ctx, typeName);
    }
  }
  return out;
}
