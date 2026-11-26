// Doors: door cells on the wall grid, between the rasterizer (with gap closing) and the room flood fill
// (Req 7.1 to 7.7). Pure and total: integer cell arithmetic, sorted order, no clock, no random, never throws.
//
// WHERE A DOOR IS. A door is a "gap strip": a run of non-wall cells along one grid axis with a wall cell at both ends,
// where the wall at the ends runs along the strip (the wall is cut by the gap) and not across it (the strip is not a
// row of a room between two side walls). "Runs along" means: from the end cell, the wall continues outward for more
// cells than it extends sideways (RunD > RunP). One collinear end is enough, because a door can sit next to a
// junction, where the wall on that side runs across. Neighbouring strips of the same extent (a wall thicker than one
// cell) are one door. This is the plain-gap case (Req 7.3) and also locates doors drawn with a block or an arc, since
// the drawn wall has the gap there.
// Door entities (door layer):
//   - an INSERT (all its flattened entities share `insert.id`) is one group, source `block` (Req 7.1);
//   - an ARC or CIRCLE with no INSERT is its own group, source `arc` (Req 7.2).
//   Each gap strip takes its source from the group whose bounding box (grown by half a cell, so a hinge on the wall
//   centre line counts) covers most of its cells. A group whose box covers no gap cell at all is drawn over a
//   continuous wall: the door is cut into
//   the wall inside its box, along the longest run of wall cells, and its width comes from the box (the block extent
//   along the wall, or the arc extent clamped to the grid) (Req 7.1, 7.2).
// WIDTH (Req 7.4). widthM = (door cells across the gap) * CELL_SIZE_M, computed once here. toFireGeometry reuses this
// number as the vent width. For a gap door the block or arc only locates the door; the cells decide the width.
// DISCARD (Req 7.6). A door needs, on both sides of its band, at least one cell that is not a wall (a room or the
// outside; a side beyond the grid edge counts as outside). Otherwise it is dropped with DOOR_DISCARDED, and a carved
// door is not cut. A door with no wall to sit in is a group that claimed no gap and found no wall cells in its box.
// IDS (Req 7.7). `${floorId}:door${k}`, k from 1 in row-major order of each door's first cell (row 0 is the lowest y).
// Known limit: a gap as long as the wall between two junctions looks like a row of a room and is not found.
import { CELL_SIZE_M } from '../../people/constants';
import { CELL_DOOR, CELL_WALL } from '../../people/types';
import { DOOR_WIDTH_MAX_M, DOOR_WIDTH_MIN_M } from '../constants';
import type { FlatEntity } from '../dxf/blocks';
import { bulgeToArc } from '../dxf/transform';
import type { ArcGeom } from '../dxf/transform';
import type { ImportWarning } from '../types';
import { doorDiscarded, doorWidthRange } from '../warnings';
import { RASTER_EPS_M, WALL_PAIR_MAX_THICKNESS_M } from './rasterConstants';

export interface DoorsInput {
  floorId: string;
  widthCells: number;
  heightCells: number;
  originXM: number; // common grid origin (floorSources.ts)
  originYM: number;
  cellType: Uint8Array; // rasterizer output after gap closing: CELL_WALL and CELL_FREE only; not modified
  entities: readonly FlatEntity[]; // door-role entities of the floor, metres, INSERTs flattened
}

export type DoorSource = 'gap' | 'block' | 'arc';

// A door before the rooms step: `Door` without the fields that need rooms and user choices.
export interface DoorDraft {
  id: string;
  floorId: string;
  cells: Int32Array; // ascending cell indices
  widthM: number; // across * CELL_SIZE_M
  across: number; // door cells across the gap, along the wall
  direction: 'x' | 'y'; // axis the width is measured on
  source: DoorSource;
}

export interface DoorsResult {
  cellType: Uint8Array; // copy of the input with CELL_DOOR on every door cell
  doors: DoorDraft[]; // in id order
  warnings: ImportWarning[];
}

type Dir = 'x' | 'y';

// A candidate door band: rows (or columns) f0..f1 of the grid, cells start..end along the axis.
interface Band {
  dir: Dir;
  f0: number;
  f1: number;
  start: number;
  end: number;
  source: DoorSource;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Group {
  source: 'block' | 'arc';
  box: Box;
}

const ARC_SAMPLES = 32; // Estimate: bounding box of an arc to 0.1 percent of its radius, far below the half-cell margin

// ---- Boxes of door entities -------------------------------------------------------------------------------------

function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function grow(b: Box, x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  b.minX = Math.min(b.minX, x);
  b.maxX = Math.max(b.maxX, x);
  b.minY = Math.min(b.minY, y);
  b.maxY = Math.max(b.maxY, y);
}

function growArc(b: Box, arc: ArcGeom): void {
  for (let k = 0; k <= ARC_SAMPLES; k++) {
    const a = arc.startRad + (arc.sweepRad * k) / ARC_SAMPLES;
    grow(b, arc.cx + arc.r * Math.cos(a), arc.cy + arc.r * Math.sin(a));
  }
}

function growEntity(b: Box, e: FlatEntity): void {
  switch (e.kind) {
    case 'LINE':
      grow(b, e.x1, e.y1);
      grow(b, e.x2, e.y2);
      return;
    case 'POLYLINE': {
      const n = e.vertices.length;
      for (let i = 0; i < n; i++) {
        const p = e.vertices[i] as (typeof e.vertices)[number];
        grow(b, p.x, p.y);
        const q = e.vertices[(i + 1) % n] as (typeof e.vertices)[number];
        if ((i + 1 < n || e.closed) && p.bulge !== 0) {
          const arc = bulgeToArc(p, q, p.bulge);
          if (arc !== null) growArc(b, arc);
        }
      }
      return;
    }
    case 'ARC':
      growArc(b, e);
      return;
    case 'CIRCLE':
      grow(b, e.cx - e.r, e.cy - e.r);
      grow(b, e.cx + e.r, e.cy + e.r);
      return;
  }
}

// INSERT groups in order of first appearance, then each loose ARC or CIRCLE. A loose LINE or POLYLINE (a drawn leaf
// without a block) does not locate a door by itself and is ignored.
function groupsOf(entities: readonly FlatEntity[]): Group[] {
  const byInsert = new Map<number, Box>();
  const groups: Group[] = [];
  const loose: Group[] = [];
  for (const e of entities) {
    if (e.insert !== undefined) {
      let box = byInsert.get(e.insert.id);
      if (box === undefined) {
        box = emptyBox();
        byInsert.set(e.insert.id, box);
        groups.push({ source: 'block', box });
      }
      growEntity(box, e);
    } else if (e.kind === 'ARC' || e.kind === 'CIRCLE') {
      const box = emptyBox();
      growEntity(box, e);
      loose.push({ source: 'arc', box });
    }
  }
  return [...groups, ...loose].filter((g) => g.box.minX <= g.box.maxX && g.box.minY <= g.box.maxY);
}

// ---- Grid access ------------------------------------------------------------------------------------------------

class Grid {
  constructor(
    readonly w: number,
    readonly h: number,
    readonly cells: Uint8Array,
  ) {}
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  wall(x: number, y: number): boolean {
    return this.inside(x, y) && this.cells[y * this.w + x] === CELL_WALL;
  }
  // The cell is open to someone standing next to the door: not a wall; beyond the grid edge is the outside.
  open(x: number, y: number): boolean {
    return !this.inside(x, y) || this.cells[y * this.w + x] !== CELL_WALL;
  }
}

// (fixed, along) -> cell for each axis. Dir 'x': the strip runs along x in row `fixed`. Dir 'y': along y in column `fixed`.
const cellX = (d: Dir, f: number, a: number): number => (d === 'x' ? a : f);
const cellY = (d: Dir, f: number, a: number): number => (d === 'x' ? f : a);

function firstIndex(b: Band, w: number): number {
  return b.dir === 'x' ? b.f0 * w + b.start : b.start * w + b.f0;
}

function bandCells(b: Band, w: number): number[] {
  const out: number[] = [];
  for (let f = b.f0; f <= b.f1; f++) {
    for (let a = b.start; a <= b.end; a++) {
      out.push(cellY(b.dir, f, a) * w + cellX(b.dir, f, a));
    }
  }
  return out.sort((p, q) => p - q);
}

// ---- Gap strips -------------------------------------------------------------------------------------------------

// Widest wall the rasterizer draws as one wall, in cells (WALL_PAIR_MAX_THICKNESS_M = 0.6 m -> 3 cells).
const MAX_WALL_THICKNESS_CELLS = Math.ceil(WALL_PAIR_MAX_THICKNESS_M / CELL_SIZE_M - RASTER_EPS_M);

// True when the wall at the end cell runs along the strip: it continues outward for more cells than it is wide, and
// it is no wider than a wall. The second test (task 14.1) rejects an end cell that lies in a wall running across the
// strip, such as the corridor wall at a T-junction: without it, the corridor cells in line with a partition between
// two rooms read as a door across the corridor.
function endRunsAlong(g: Grid, d: Dir, f: number, a: number, step: 1 | -1): boolean {
  let runD = 0;
  for (let k = a; g.wall(cellX(d, f, k), cellY(d, f, k)); k += step) runD++;
  let runP = 1;
  for (let k = f + 1; g.wall(cellX(d, k, a), cellY(d, k, a)); k++) runP++;
  for (let k = f - 1; g.wall(cellX(d, k, a), cellY(d, k, a)); k--) runP++;
  return runD > runP && runP <= MAX_WALL_THICKNESS_CELLS;
}

function findStrips(g: Grid, d: Dir): Band[] {
  const lines = d === 'x' ? g.h : g.w;
  const length = d === 'x' ? g.w : g.h;
  const strips: Band[] = [];
  for (let f = 0; f < lines; f++) {
    let a = 0;
    while (a < length) {
      if (g.wall(cellX(d, f, a), cellY(d, f, a))) {
        a++;
        continue;
      }
      const s = a;
      while (a < length && !g.wall(cellX(d, f, a), cellY(d, f, a))) a++;
      const e = a - 1;
      if (s === 0 || a >= length) continue; // a run that reaches the grid edge has no wall at that end
      if (endRunsAlong(g, d, f, s - 1, -1) || endRunsAlong(g, d, f, e + 1, 1)) {
        strips.push({ dir: d, f0: f, f1: f, start: s, end: e, source: 'gap' });
      }
    }
  }
  return strips;
}

// Strips of the same extent on neighbouring rows (a wall thicker than one cell) become one band.
function mergeStrips(strips: readonly Band[]): Band[] {
  const sorted = [...strips].sort((p, q) => (p.dir === q.dir ? 0 : p.dir === 'x' ? -1 : 1) || p.start - q.start || p.end - q.end || p.f0 - q.f0);
  const out: Band[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && last.dir === s.dir && last.start === s.start && last.end === s.end && last.f1 + 1 === s.f0) last.f1 = s.f1;
    else out.push({ ...s });
  }
  return out;
}

// ---- Claiming and carving ---------------------------------------------------------------------------------------

function centreInBox(b: Box, xM: number, yM: number, marginM: number): boolean {
  return xM >= b.minX - marginM && xM <= b.maxX + marginM && yM >= b.minY - marginM && yM <= b.maxY + marginM;
}

function overlapCells(input: DoorsInput, band: Band, box: Box): number {
  let n = 0;
  const margin = CELL_SIZE_M / 2 + RASTER_EPS_M;
  for (let f = band.f0; f <= band.f1; f++) {
    for (let a = band.start; a <= band.end; a++) {
      const x = cellX(band.dir, f, a);
      const y = cellY(band.dir, f, a);
      if (centreInBox(box, input.originXM + (x + 0.5) * CELL_SIZE_M, input.originYM + (y + 0.5) * CELL_SIZE_M, margin)) n++;
    }
  }
  return n;
}

// Longest run of wall cells inside the box along one axis; ties go to the lowest row (or column), then the lowest start.
function longestWallRun(g: Grid, d: Dir, range: { x0: number; x1: number; y0: number; y1: number }): { len: number; f: number; start: number } {
  const best = { len: 0, f: 0, start: 0 };
  const fLo = d === 'x' ? range.y0 : range.x0;
  const fHi = d === 'x' ? range.y1 : range.x1;
  const aLo = d === 'x' ? range.x0 : range.y0;
  const aHi = d === 'x' ? range.x1 : range.y1;
  for (let f = fLo; f <= fHi; f++) {
    let run = 0;
    for (let a = aLo; a <= aHi + 1; a++) {
      if (a <= aHi && g.wall(cellX(d, f, a), cellY(d, f, a))) {
        run++;
        continue;
      }
      if (run > best.len) {
        best.len = run;
        best.f = f;
        best.start = a - run;
      }
      run = 0;
    }
  }
  return best;
}

function carve(input: DoorsInput, g: Grid, group: Group): Band | null {
  const c = CELL_SIZE_M;
  const eps = RASTER_EPS_M;
  const lo = (min: number, origin: number): number => Math.max(0, Math.ceil((min - eps - origin) / c - 0.5));
  const hi = (max: number, origin: number, size: number): number => Math.min(size - 1, Math.floor((max + eps - origin) / c - 0.5));
  const range = {
    x0: lo(group.box.minX, input.originXM),
    x1: hi(group.box.maxX, input.originXM, g.w),
    y0: lo(group.box.minY, input.originYM),
    y1: hi(group.box.maxY, input.originYM, g.h),
  };
  if (range.x1 < range.x0 || range.y1 < range.y0) return null;
  const rx = longestWallRun(g, 'x', range);
  const ry = longestWallRun(g, 'y', range);
  if (rx.len === 0 && ry.len === 0) return null;
  const dir: Dir = rx.len >= ry.len ? 'x' : 'y';
  const r = dir === 'x' ? rx : ry;
  const band: Band = { dir, f0: r.f, f1: r.f, start: r.start, end: r.start + r.len - 1, source: group.source };
  const rowIsWall = (f: number): boolean => {
    for (let a = band.start; a <= band.end; a++) if (!g.wall(cellX(dir, f, a), cellY(dir, f, a))) return false;
    return true;
  };
  while (rowIsWall(band.f0 - 1)) band.f0--; // the rest of the wall thickness
  while (rowIsWall(band.f1 + 1)) band.f1++;
  return band;
}

// Req 7.6: both sides of the band must have a cell that is not a wall.
function hasBothSides(g: Grid, b: Band): boolean {
  const side = (f: number): boolean => {
    for (let a = b.start; a <= b.end; a++) if (g.open(cellX(b.dir, f, a), cellY(b.dir, f, a))) return true;
    return false;
  };
  return side(b.f0 - 1) && side(b.f1 + 1);
}

// ---- Entry point ------------------------------------------------------------------------------------------------

const validGrid = (n: number): boolean => Number.isInteger(n) && n > 0;

export function placeDoors(input: DoorsInput): DoorsResult {
  const ok =
    validGrid(input.widthCells) &&
    validGrid(input.heightCells) &&
    input.cellType.length === input.widthCells * input.heightCells &&
    Number.isFinite(input.originXM) &&
    Number.isFinite(input.originYM);
  if (!ok) return { cellType: input.cellType.slice(), doors: [], warnings: [] };

  const g = new Grid(input.widthCells, input.heightCells, input.cellType);
  const w = g.w;
  const warnings: ImportWarning[] = [];
  const cellWarn = (idx: number): void => void warnings.push(doorDiscarded(input.floorId, idx % w, Math.floor(idx / w)));

  const bands = mergeStrips([...findStrips(g, 'x'), ...findStrips(g, 'y')]).sort((p, q) => firstIndex(p, w) - firstIndex(q, w));
  const groups = groupsOf(input.entities);

  // Each gap goes to the group that covers most of it (Req 7.1, 7.2); a group with no gap is carved into the wall.
  const claimed = new Uint8Array(groups.length);
  for (const band of bands) {
    let best = 0;
    let bestIndex = -1;
    groups.forEach((grp, i) => {
      const n = overlapCells(input, band, grp.box);
      if (n > 0) claimed[i] = 1; // a drawing over any gap is that gap's door, even if a neighbour covers it more
      if (n > best) {
        best = n;
        bestIndex = i;
      }
    });
    if (bestIndex >= 0) band.source = (groups[bestIndex] as Group).source;
  }
  const candidates: Band[] = [...bands];
  groups.forEach((grp, i) => {
    if (claimed[i] === 1) return;
    const carved = carve(input, g, grp);
    if (carved !== null) {
      candidates.push(carved);
      return;
    }
    // No wall under the drawing: report at the cell nearest the middle of the box (clamped to the grid).
    const cx = Math.min(w - 1, Math.max(0, Math.floor(((grp.box.minX + grp.box.maxX) / 2 - input.originXM) / CELL_SIZE_M)));
    const cy = Math.min(g.h - 1, Math.max(0, Math.floor(((grp.box.minY + grp.box.maxY) / 2 - input.originYM) / CELL_SIZE_M)));
    cellWarn(cy * w + cx);
  });
  candidates.sort((p, q) => firstIndex(p, w) - firstIndex(q, w));

  const taken = new Uint8Array(g.cells.length);
  const kept: { band: Band; cells: number[] }[] = [];
  for (const band of candidates) {
    const cells = bandCells(band, w);
    if (!hasBothSides(g, band) || cells.some((i) => taken[i] === 1)) {
      cellWarn(firstIndex(band, w));
      continue;
    }
    for (const i of cells) taken[i] = 1;
    kept.push({ band, cells });
  }

  const cellType = input.cellType.slice();
  const doors: DoorDraft[] = kept.map(({ band, cells }, k) => {
    for (const i of cells) cellType[i] = CELL_DOOR;
    const across = band.end - band.start + 1;
    const id = `${input.floorId}:door${k + 1}`;
    const widthM = across * CELL_SIZE_M;
    if (widthM < DOOR_WIDTH_MIN_M || widthM > DOOR_WIDTH_MAX_M) warnings.push(doorWidthRange(id, input.floorId, widthM));
    return { id, floorId: input.floorId, cells: Int32Array.from(cells), widthM, across, direction: band.dir, source: band.source };
  });
  return { cellType, doors, warnings };
}
