// Rasterizer: wall, window and furniture entities (in metres, INSERTs already flattened) -> crowd grid cells
// (Req 5.6, 5.7, 6.1, 6.2, 6.3, 6.6, 6.7). Pure and total: integer cell arithmetic, deterministic order, no clock, no
// random, never throws. The output cell codes are CELL_WALL and CELL_FREE only; doors, rooms and exits come later.
//
// COVERAGE RULE (Req 6.1). Every wall is turned into one of two shapes:
//   - a Band: a rectangle with a centre line, a thickness and a direction u (normal n = (-uy, ux));
//   - a Polygon: any other thin closed outline (a pillar, an L-shaped solid wall).
// A cell is a wall when the shape covers at least half of the cell's width measured along the thickness direction,
// on the line through the cell centre in that direction (the line is clipped to the cell square, so for a wall
// turned against the grid "the cell's width along n" is the length of that clipped chord).
//   - Band: the thickness direction is n. The cell centre must also lie within the band's run along u.
//   - Polygon: the thickness direction is not known, so the chord is taken along both grid axes and the smaller
//     coverage is used. For a wall aligned with the grid this equals the coverage across its thickness.
// Thickness (Req 6.2, 6.3):
//   - two parallel straight lines 1e-6 .. WALL_PAIR_MAX_THICKNESS_M apart (mutually nearest, sharing at least half of
//     the shorter line) are one Band whose thickness is their perpendicular distance;
//   - a closed rectangle with a short side up to WALL_PAIR_MAX_THICKNESS_M is one Band of that thickness;
//   - any other closed outline with 2*area/perimeter up to WALL_PAIR_MAX_THICKNESS_M is a solid Polygon;
//   - everything else is a single line: a Band of max(DEFAULT_WALL_THICKNESS_M, one cell) centred on the line, with
//     square end caps of half its thickness (a cell centre exactly at the end of a cap is left out, so a line that
//     stops on a cell edge at a door gap does not close the gap cell, Property 1 / design.md). A drawn thickness below one cell is widened to one cell about its centre
//     line for the same reason, so a thin wall can never vanish and leave a gap in the grid.
// A Band exactly one cell thick whose edge falls exactly on a cell centre covers two cells by half each. The tie goes
// to the cell on the +n side of the centre line (n from the canonical direction: ux > 0, or ux = 0 and uy > 0), so
// one line always gives one cell row, whichever way it was drawn.
// Grid: cell (ix, iy) spans [originX + ix*c, originX + (ix+1)*c) in x, the same in y; index = iy * width + ix; row 0
// holds the lowest y (Req 6.7; the origin comes from floorSources.ts).
import { CELL_SIZE_M } from '../../people/constants';
import { CELL_FREE, CELL_WALL } from '../../people/types';
import { ARC_TESSELLATION_STEP_RAD, BULGE_STRAIGHT_EPSILON, DEFAULT_WALL_THICKNESS_M } from '../constants';
import type { FlatEntity } from '../dxf/blocks';
import { bulgeToArc } from '../dxf/transform';
import type { ArcGeom, Vertex } from '../dxf/transform';
import type { LayerMap } from '../types';
import {
  PAIR_MIN_OFFSET_M,
  PAIR_MIN_OVERLAP_FRACTION,
  PARALLEL_ANGLE_TOLERANCE,
  RASTER_COVERAGE_FRACTION,
  RASTER_EPS_M,
  RECTANGLE_TOLERANCE,
  WALL_PAIR_MAX_THICKNESS_M,
} from './rasterConstants';

export interface GridSpec {
  originXM: number; // common origin, a multiple of CELL_SIZE_M (Req 6.7)
  originYM: number;
  widthCells: number;
  heightCells: number;
}

export interface RasterizeInput {
  floorId: string;
  entities: readonly FlatEntity[]; // metres, INSERTs flattened (layer-0 entities already carry their INSERT's layer)
  layerMap: LayerMap; // confirmed map of the file; a layer it does not name is ignored
  grid: GridSpec;
}

// An entity of a window or furniture layer with the cells it covers, for the fire deriver (Req 5.6, 5.7).
export interface RasterFeature {
  entityIndex: number; // index in RasterizeInput.entities
  layer: string;
  cells: Int32Array; // sorted ascending, no duplicates, inside the grid
}

export interface RasterizeResult {
  floorId: string;
  widthCells: number;
  heightCells: number;
  cellType: Uint8Array; // CELL_WALL for walls, windows and furniture, CELL_FREE elsewhere
  windows: RasterFeature[];
  furniture: RasterFeature[];
}

// ---- Shapes -----------------------------------------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
}

interface Band {
  ax: number;
  ay: number; // start of the centre line
  ux: number;
  uy: number; // unit direction
  len: number; // run length along u
  thicknessM: number;
  tie: boolean; // one cell thick after widening: apply the tie rule
  capped?: boolean; // single line with end caps: a cell centre exactly at the end of a cap is not covered
}

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  ux: number;
  uy: number;
  len: number;
  theta: number;
}

interface Shapes {
  bands: Band[];
  polygons: Pt[][];
  pool: Seg[]; // straight segments that may pair up into a wall drawn as two lines
}
const newShapes = (): Shapes => ({ bands: [], polygons: [], pool: [] });

const C = CELL_SIZE_M;
const MIN_STROKE_THICKNESS_M = Math.max(DEFAULT_WALL_THICKNESS_M, C);

// Canonical direction: ux > 0, or ux = 0 (within rounding) and uy > 0, so a line has one direction however drawn.
function canonicalSwap(dx: number, dy: number, len: number): boolean {
  const ux = dx / len;
  return Math.abs(ux) < 1e-9 ? dy < 0 : ux < 0;
}

function bandFrom(a: Pt, b: Pt, thicknessM: number, capM: number, tie: boolean): Band {
  let p = a;
  let q = b;
  const dx0 = q.x - p.x;
  const dy0 = q.y - p.y;
  const len0 = Math.hypot(dx0, dy0);
  if (len0 < RASTER_EPS_M) return { ax: p.x - capM, ay: p.y, ux: 1, uy: 0, len: 2 * capM, thicknessM, tie };
  if (canonicalSwap(dx0, dy0, len0)) [p, q] = [q, p];
  const ux = (q.x - p.x) / len0;
  const uy = (q.y - p.y) / len0;
  return { ax: p.x - ux * capM, ay: p.y - uy * capM, ux, uy, len: len0 + 2 * capM, thicknessM, tie };
}

// One drawn line: widened to at least one cell, square caps of half its thickness (Req 6.3).
function strokeBand(a: Pt, b: Pt): Band {
  return { ...bandFrom(a, b, MIN_STROKE_THICKNESS_M, MIN_STROKE_THICKNESS_M / 2, true), capped: true };
}

function makeSeg(a: Pt, b: Pt): Seg | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len >= RASTER_EPS_M)) return null;
  let p = a;
  let q = b;
  if (canonicalSwap(dx, dy, len)) [p, q] = [q, p];
  let ux = (q.x - p.x) / len;
  const uy = (q.y - p.y) / len;
  if (Math.abs(ux) < 1e-9) ux = 0;
  return { ax: p.x, ay: p.y, bx: q.x, by: q.y, ux, uy, len, theta: Math.atan2(uy, ux) };
}

function addStroke(out: Shapes, a: Pt, b: Pt, pooled: boolean): void {
  if (pooled) {
    const s = makeSeg(a, b);
    if (s !== null) {
      out.pool.push(s);
      return;
    }
  }
  out.bands.push(strokeBand(a, b));
}

// ---- Entity -> shapes -------------------------------------------------------------------------------------------

function arcPoints(arc: ArcGeom): Pt[] {
  const n = Math.max(1, Math.ceil(arc.sweepRad / ARC_TESSELLATION_STEP_RAD));
  const pts: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const a = arc.startRad + (arc.sweepRad * k) / n;
    pts.push({ x: arc.cx + arc.r * Math.cos(a), y: arc.cy + arc.r * Math.sin(a) });
  }
  return pts;
}

// Points of one polyline segment p0 -> p1 with its bulge, both ends included, in travel order.
function segmentPoints(p0: Pt, p1: Pt, bulge: number): Pt[] {
  if (!(Math.abs(bulge) > BULGE_STRAIGHT_EPSILON)) return [p0, p1];
  const arc = bulgeToArc(p0, p1, bulge);
  if (arc === null) return [p0, p1];
  const pts = arcPoints(arc);
  const first = pts[0] as Pt;
  const last = pts[pts.length - 1] as Pt;
  const forward = Math.hypot(first.x - p0.x, first.y - p0.y) + Math.hypot(last.x - p1.x, last.y - p1.y);
  const backward = Math.hypot(last.x - p0.x, last.y - p0.y) + Math.hypot(first.x - p1.x, first.y - p1.y);
  if (backward < forward) pts.reverse();
  pts[0] = p0;
  pts[pts.length - 1] = p1;
  return pts;
}

function strokeChain(out: Shapes, pts: readonly Pt[]): void {
  for (let i = 0; i + 1 < pts.length; i++) out.bands.push(strokeBand(pts[i] as Pt, pts[i + 1] as Pt));
}

const isStraight = (bulge: number): boolean => !(Math.abs(bulge) > BULGE_STRAIGHT_EPSILON);

function dedupeVertices(vertices: readonly Vertex[]): Vertex[] {
  const out: Vertex[] = [];
  for (const v of vertices) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.hypot(v.x - last.x, v.y - last.y) < RASTER_EPS_M) continue;
    out.push(v);
  }
  while (out.length > 1) {
    const f = out[0] as Vertex;
    const l = out[out.length - 1] as Vertex;
    if (Math.hypot(f.x - l.x, f.y - l.y) < RASTER_EPS_M) out.pop();
    else break;
  }
  return out;
}

function polygonAreaPerimeter(pts: readonly Pt[]): { area: number; perimeter: number } {
  let twice = 0;
  let perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const q = pts[(i + 1) % pts.length] as Pt;
    twice += p.x * q.y - q.x * p.y;
    perimeter += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return { area: Math.abs(twice) / 2, perimeter };
}

// Rectangle band of a closed 4-vertex outline, or null when it is not a rectangle.
function rectangleBand(v: readonly Vertex[]): { band: Band; shortSideM: number } | null {
  if (v.length !== 4) return null;
  const [p0, p1, p2, p3] = v as [Vertex, Vertex, Vertex, Vertex];
  const e0x = p1.x - p0.x;
  const e0y = p1.y - p0.y;
  const e1x = p2.x - p1.x;
  const e1y = p2.y - p1.y;
  const l0 = Math.hypot(e0x, e0y);
  const l1 = Math.hypot(e1x, e1y);
  if (!(l0 > RASTER_EPS_M) || !(l1 > RASTER_EPS_M)) return null;
  if (Math.abs(e0x * e1x + e0y * e1y) > RECTANGLE_TOLERANCE * l0 * l1) return null;
  const closeTol = RECTANGLE_TOLERANCE * Math.max(l0, l1) + RASTER_EPS_M;
  if (Math.abs(p0.x + p2.x - p1.x - p3.x) > closeTol || Math.abs(p0.y + p2.y - p1.y - p3.y) > closeTol) return null;
  const cx = (p0.x + p1.x + p2.x + p3.x) / 4;
  const cy = (p0.y + p1.y + p2.y + p3.y) / 4;
  const longIsE0 = l0 >= l1;
  const longLen = longIsE0 ? l0 : l1;
  const shortLen = longIsE0 ? l1 : l0;
  const ux = (longIsE0 ? e0x : e1x) / longLen;
  const uy = (longIsE0 ? e0y : e1y) / longLen;
  const half = Math.max(longLen, C) / 2; // a pillar smaller than one cell still fills one
  const a = { x: cx - ux * half, y: cy - uy * half };
  const b = { x: cx + ux * half, y: cy + uy * half };
  const t = Math.max(shortLen, C);
  return { band: bandFrom(a, b, t, 0, t <= C + RASTER_EPS_M), shortSideM: shortLen };
}

function addClosed(out: Shapes, rawVertices: readonly Vertex[], pooled: boolean): void {
  const v = dedupeVertices(rawVertices);
  if (v.length < 2) {
    if (v.length === 1) out.bands.push(strokeBand(v[0] as Pt, v[0] as Pt));
    return;
  }
  const straightOnly = v.every((p) => isStraight(p.bulge));
  const rect = straightOnly ? rectangleBand(v) : null;
  if (rect !== null) {
    if (rect.shortSideM <= WALL_PAIR_MAX_THICKNESS_M) {
      out.bands.push(rect.band);
      return;
    }
  } else if (v.length >= 3) {
    const pts: Pt[] = [];
    for (let i = 0; i < v.length; i++) {
      const p0 = v[i] as Vertex;
      const p1 = v[(i + 1) % v.length] as Vertex;
      const seg = segmentPoints(p0, p1, p0.bulge);
      for (let k = 0; k < seg.length - 1; k++) pts.push(seg[k] as Pt);
    }
    const { area, perimeter } = polygonAreaPerimeter(pts);
    if (perimeter > 0 && (2 * area) / perimeter <= WALL_PAIR_MAX_THICKNESS_M) {
      out.polygons.push(pts);
      return;
    }
  }
  // Too wide to be a wall cross-section: the outline is drawn with single lines along the wall centres.
  for (let i = 0; i < v.length; i++) {
    const p0 = v[i] as Vertex;
    const p1 = v[(i + 1) % v.length] as Vertex;
    if (isStraight(p0.bulge)) addStroke(out, p0, p1, pooled);
    else strokeChain(out, segmentPoints(p0, p1, p0.bulge));
  }
}

function addOpen(out: Shapes, v: readonly Vertex[], pooled: boolean): void {
  if (v.length === 1) out.bands.push(strokeBand(v[0] as Pt, v[0] as Pt));
  for (let i = 0; i + 1 < v.length; i++) {
    const p0 = v[i] as Vertex;
    const p1 = v[i + 1] as Vertex;
    if (isStraight(p0.bulge)) addStroke(out, p0, p1, pooled);
    else strokeChain(out, segmentPoints(p0, p1, p0.bulge));
  }
}

function addEntity(out: Shapes, e: FlatEntity, pooled: boolean): void {
  switch (e.kind) {
    case 'LINE':
      addStroke(out, { x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }, pooled);
      return;
    case 'POLYLINE':
      if (e.closed) addClosed(out, e.vertices, pooled);
      else addOpen(out, e.vertices, pooled);
      return;
    case 'ARC':
      strokeChain(out, arcPoints(e));
      return;
    case 'CIRCLE': {
      const n = Math.max(3, Math.ceil((2 * Math.PI) / ARC_TESSELLATION_STEP_RAD));
      const pts: Pt[] = [];
      for (let k = 0; k < n; k++) {
        const a = (2 * Math.PI * k) / n;
        pts.push({ x: e.cx + e.r * Math.cos(a), y: e.cy + e.r * Math.sin(a) });
      }
      if (e.r <= WALL_PAIR_MAX_THICKNESS_M) out.polygons.push(pts); // a round pillar
      else strokeChain(out, [...pts, pts[0] as Pt]); // a round wall drawn by its centre line
      return;
    }
  }
}

// ---- Pairing of parallel lines (Req 6.2) ------------------------------------------------------------------------

interface PairResult {
  bands: Band[];
  strokes: [Pt, Pt][]; // unpaired lines and the parts of paired lines outside the shared run
}

function pairSegments(segs: readonly Seg[]): PairResult {
  const n = segs.length;
  const result: PairResult = { bands: [], strokes: [] };
  if (n === 0) return result;
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((i, j) => {
    const a = segs[i] as Seg;
    const b = segs[j] as Seg;
    return a.theta - b.theta || a.ax - b.ax || a.ay - b.ay || a.bx - b.bx || a.by - b.by || i - j;
  });
  const bestJ = new Int32Array(n).fill(-1);
  const bestGap = new Float64Array(n).fill(Infinity);

  const consider = (i: number, j: number): void => {
    const si = segs[i] as Seg;
    const sj = segs[j] as Seg;
    const nx = -si.uy;
    const ny = si.ux;
    const off = ((sj.ax + sj.bx) / 2 - si.ax) * nx + ((sj.ay + sj.by) / 2 - si.ay) * ny;
    const gap = Math.abs(off);
    if (gap < PAIR_MIN_OFFSET_M || gap > WALL_PAIR_MAX_THICKNESS_M) return;
    const sa = (sj.ax - si.ax) * si.ux + (sj.ay - si.ay) * si.uy;
    const sb = (sj.bx - si.ax) * si.ux + (sj.by - si.ay) * si.uy;
    const overlap = Math.min(si.len, Math.max(sa, sb)) - Math.max(0, Math.min(sa, sb));
    if (overlap <= RASTER_EPS_M || overlap < PAIR_MIN_OVERLAP_FRACTION * Math.min(si.len, sj.len)) return;
    if (gap < (bestGap[i] as number) || (gap === bestGap[i] && j < (bestJ[i] as number))) {
      bestGap[i] = gap;
      bestJ[i] = j;
    }
  };

  let start = 0;
  while (start < n) {
    let end = start + 1;
    while (end < n && (segs[order[end] as number] as Seg).theta - (segs[order[end - 1] as number] as Seg).theta <= PARALLEL_ANGLE_TOLERANCE) end++;
    if (end - start >= 2) {
      const ref = segs[order[start] as number] as Seg;
      const rx = -ref.uy;
      const ry = ref.ux;
      const members = order.slice(start, end);
      const dn = new Map<number, number>();
      for (const i of members) {
        const s = segs[i] as Seg;
        dn.set(i, ((s.ax + s.bx) / 2) * rx + ((s.ay + s.by) / 2) * ry);
      }
      members.sort((i, j) => (dn.get(i) as number) - (dn.get(j) as number) || i - j);
      for (let k = 0; k < members.length; k++) {
        const i = members[k] as number;
        const di = dn.get(i) as number;
        for (let m = k + 1; m < members.length && (dn.get(members[m] as number) as number) - di <= WALL_PAIR_MAX_THICKNESS_M + RASTER_EPS_M; m++) {
          consider(i, members[m] as number);
          consider(members[m] as number, i);
        }
      }
    }
    start = end;
  }

  const paired = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const j = bestJ[i] as number;
    if (j < 0 || (bestJ[j] as number) !== i || j < i) continue;
    paired[i] = 1;
    paired[j] = 1;
    emitPair(segs[i] as Seg, segs[j] as Seg, result);
  }
  for (let i = 0; i < n; i++) {
    if (paired[i] === 1) continue;
    const s = segs[i] as Seg;
    result.strokes.push([
      { x: s.ax, y: s.ay },
      { x: s.bx, y: s.by },
    ]);
  }
  return result;
}

function emitPair(si: Seg, sj: Seg, out: PairResult): void {
  const nx = -si.uy;
  const ny = si.ux;
  const off = ((sj.ax + sj.bx) / 2 - si.ax) * nx + ((sj.ay + sj.by) / 2 - si.ay) * ny;
  const d = Math.abs(off);
  const sa = (sj.ax - si.ax) * si.ux + (sj.ay - si.ay) * si.uy;
  const sb = (sj.bx - si.ax) * si.ux + (sj.by - si.ay) * si.uy;
  const loJ = Math.min(sa, sb);
  const hiJ = Math.max(sa, sb);
  const lo = Math.max(0, loJ);
  const hi = Math.min(si.len, hiJ);
  const tEff = Math.max(d, C);
  const at = (s: number): Pt => ({ x: si.ax + si.ux * s + (nx * off) / 2, y: si.ay + si.uy * s + (ny * off) / 2 });
  out.bands.push(bandFrom(at(lo), at(hi), tEff, 0, tEff <= C + RASTER_EPS_M));

  // The parts of the two lines outside the shared run are walls too. A part no longer than the wall is thick is the
  // corner where a perpendicular wall meets; that wall covers it.
  const min = d + RASTER_EPS_M;
  const onI = (s: number): Pt => ({ x: si.ax + si.ux * s, y: si.ay + si.uy * s });
  if (lo > min) out.strokes.push([onI(0), onI(lo)]);
  if (si.len - hi > min) out.strokes.push([onI(hi), onI(si.len)]);
  // sj runs from sa to sb along u_i; when sb < sa its stored start is the far end, so measure from its own start.
  const jStart = sa <= sb ? sa : sb;
  const jAt = (s: number): Pt => {
    const base = sa <= sb ? { x: sj.ax, y: sj.ay } : { x: sj.bx, y: sj.by };
    return { x: base.x + si.ux * (s - jStart), y: base.y + si.uy * (s - jStart) };
  };
  if (lo - loJ > min) out.strokes.push([jAt(loJ), jAt(lo)]);
  if (hiJ - hi > min) out.strokes.push([jAt(hi), jAt(hiJ)]);
}

// ---- Marking cells ----------------------------------------------------------------------------------------------

interface Marker {
  originX: number;
  originY: number;
  w: number;
  h: number;
  emit: (index: number) => void;
}

function cellRange(m: Marker, minX: number, maxX: number, minY: number, maxY: number): [number, number, number, number] | null {
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
  const x0 = Math.max(0, Math.floor((minX - m.originX) / C));
  const x1 = Math.min(m.w - 1, Math.floor((maxX - m.originX) / C));
  const y0 = Math.max(0, Math.floor((minY - m.originY) / C));
  const y1 = Math.min(m.h - 1, Math.floor((maxY - m.originY) / C));
  return x1 < x0 || y1 < y0 ? null : [x0, x1, y0, y1];
}

function markBand(b: Band, m: Marker): void {
  const nx = -b.uy;
  const ny = b.ux;
  const h = b.thicknessM / 2;
  const ex = b.ax + b.ux * b.len;
  const ey = b.ay + b.uy * b.len;
  const r = cellRange(
    m,
    Math.min(b.ax, ex) - Math.abs(nx) * h,
    Math.max(b.ax, ex) + Math.abs(nx) * h,
    Math.min(b.ay, ey) - Math.abs(ny) * h,
    Math.max(b.ay, ey) + Math.abs(ny) * h,
  );
  if (r === null) return;
  const sMax = (C / 2) / Math.max(Math.abs(nx), Math.abs(ny)); // half the chord of the cell square along n
  const need = sMax * 2 * RASTER_COVERAGE_FRACTION;
  for (let iy = r[2]; iy <= r[3]; iy++) {
    for (let ix = r[0]; ix <= r[1]; ix++) {
      const dx = m.originX + (ix + 0.5) * C - b.ax;
      const dy = m.originY + (iy + 0.5) * C - b.ay;
      const su = dx * b.ux + dy * b.uy;
      // A cell centre exactly on the end of a capped line is not covered: a line that ends on a cell edge (a wall
      // stopping at a door gap) must not close the gap cell next to it by its cap. A line ending inside a cell, or on
      // a cell centre, still covers that cell.
      const lo = b.capped ? RASTER_EPS_M : -RASTER_EPS_M;
      const hi = b.capped ? b.len - RASTER_EPS_M : b.len + RASTER_EPS_M;
      if (su < lo || su > hi) continue;
      const sn = dx * nx + dy * ny; // centre of the cell relative to the centre line, along n
      const covered = Math.min(sMax, h - sn) - Math.max(-sMax, -h - sn);
      if (covered < need - RASTER_EPS_M) continue;
      if (b.tie && Math.abs(covered - need) <= RASTER_EPS_M && sn < -RASTER_EPS_M) continue;
      m.emit(iy * m.w + ix);
    }
  }
}

// Length of the part of the chord through (cx, cy) along (nx, ny), clipped to +-sMax, that lies inside the polygon.
// Even-odd rule with the half-open vertex rule, so a vertex exactly on the chord is counted once.
function chordInside(pts: readonly Pt[], cx: number, cy: number, nx: number, ny: number, sMax: number, scratch: number[]): number {
  scratch.length = 0;
  const mx = -ny;
  const my = nx;
  let prev = pts[pts.length - 1] as Pt;
  let dPrev = (prev.x - cx) * mx + (prev.y - cy) * my;
  for (const p of pts) {
    const d = (p.x - cx) * mx + (p.y - cy) * my;
    if (dPrev < 0 !== d < 0) {
      const t = dPrev / (dPrev - d);
      const sx = prev.x + (p.x - prev.x) * t;
      const sy = prev.y + (p.y - prev.y) * t;
      scratch.push((sx - cx) * nx + (sy - cy) * ny);
    }
    prev = p;
    dPrev = d;
  }
  scratch.sort((a, b) => a - b);
  let covered = 0;
  for (let k = 0; k + 1 < scratch.length; k += 2) {
    covered += Math.max(0, Math.min(scratch[k + 1] as number, sMax) - Math.max(scratch[k] as number, -sMax));
  }
  return covered;
}

function markPolygon(pts: readonly Pt[], m: Marker): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const r = cellRange(m, minX, maxX, minY, maxY);
  if (r === null) return;
  const need = C * RASTER_COVERAGE_FRACTION - RASTER_EPS_M;
  const scratch: number[] = [];
  for (let iy = r[2]; iy <= r[3]; iy++) {
    for (let ix = r[0]; ix <= r[1]; ix++) {
      const cx = m.originX + (ix + 0.5) * C;
      const cy = m.originY + (iy + 0.5) * C;
      const along = Math.min(chordInside(pts, cx, cy, 1, 0, C / 2, scratch), chordInside(pts, cx, cy, 0, 1, C / 2, scratch));
      if (along >= need) m.emit(iy * m.w + ix);
    }
  }
}

function markShapes(s: Shapes, m: Marker): void {
  for (const b of s.bands) markBand(b, m);
  for (const p of s.polygons) markPolygon(p, m);
}

// ---- Entry point ------------------------------------------------------------------------------------------------

function roleOf(map: LayerMap, layer: string): string {
  return Object.hasOwn(map, layer) ? (map[layer] as string) : 'ignore';
}

const validCount = (n: number): boolean => Number.isInteger(n) && n > 0;

export function rasterize(input: RasterizeInput): RasterizeResult {
  const { grid } = input;
  const ok = validCount(grid.widthCells) && validCount(grid.heightCells) && Number.isFinite(grid.originXM) && Number.isFinite(grid.originYM);
  const w = ok ? grid.widthCells : 0;
  const h = ok ? grid.heightCells : 0;
  const cellType = new Uint8Array(w * h).fill(CELL_FREE);
  const result: RasterizeResult = { floorId: input.floorId, widthCells: w, heightCells: h, cellType, windows: [], furniture: [] };
  if (!ok) return result;

  const toWall: Marker = { originX: grid.originXM, originY: grid.originYM, w, h, emit: (i) => void (cellType[i] = CELL_WALL) };

  // Walls: one pass collects shapes, parallel lines are paired over the whole floor, then cells are marked.
  const walls = newShapes();
  const featureEntities: { index: number; role: 'window' | 'furniture' }[] = [];
  input.entities.forEach((e, index) => {
    const role = roleOf(input.layerMap, e.layer);
    if (role === 'wall') addEntity(walls, e, true);
    else if (role === 'window' || role === 'furniture') featureEntities.push({ index, role });
  });
  const paired = pairSegments(walls.pool);
  walls.bands.push(...paired.bands);
  for (const [a, b] of paired.strokes) walls.bands.push(strokeBand(a, b));
  markShapes(walls, toWall);

  // Windows and furniture: each entity on its own, so its cells can be reported (Req 5.6, 5.7).
  for (const { index, role } of featureEntities) {
    const e = input.entities[index] as FlatEntity;
    const shapes = newShapes();
    addEntity(shapes, e, false);
    const cells = new Set<number>();
    markShapes(shapes, { ...toWall, emit: (i) => void cells.add(i) });
    for (const i of cells) cellType[i] = CELL_WALL;
    const feature: RasterFeature = { entityIndex: index, layer: e.layer, cells: Int32Array.from([...cells].sort((a, b) => a - b)) };
    (role === 'window' ? result.windows : result.furniture).push(feature);
  }
  return result;
}
