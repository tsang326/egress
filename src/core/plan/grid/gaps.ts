// Gap closing: small breaks in a wall line (Req 6.4, 6.5), with linear running time (Req 3.8). Pure and total: no
// clock, no random, never throws, the input arrays are not changed.
//
// WHY THE DRAWING AND NOT ONLY THE GRID. A cell is 0.25 m, more than twice the 0.10 m tolerance, so on the grid alone a
// gap of 0.09 m and one of 0.12 m can look the same (one free cell between two wall cells). The gap is therefore
// measured in metres on the wall geometry, and the grid is only changed where a leak is possible.
//
// RULE.
//   1. Every straight wall edge (a LINE, or a straight edge of a polyline, closed outlines included) has two ends.
//      Arcs and bulged edges are not looked at.
//   2. Two ends of different edges form a gap when they face each other along one line: the distance between them is
//      more than RASTER_EPS_M and less than GAP_TOLERANCE_M (a gap of exactly the tolerance is kept), the offset
//      between the two lines is at most GAP_COLLINEAR_TOLERANCE_M, and the two edges point the same way (sine of the
//      angle at most GAP_PARALLEL_SINE). Two lines of one wall drawn side by side are not collinear and never pair.
//   3. For each gap, a free cell is set to `wall` when its centre lies strictly between the two ends along the wall
//      direction, within WALL_PAIR_MAX_THICKNESS_M of the gap line across it, and a `wall` cell is found within
//      GAP_END_SCAN_CELLS cells on both sides of it along the grid axis nearest to the wall direction. The decision
//      reads the grid as it came in, so the result does not depend on the order of the gaps.
//   4. One GAP_CLOSED warning is given per gap, naming the floor and the cell that holds the gap's midpoint. It is given
//      also when the grid needed no change, because the rasterizer's end caps (grid/rasterize.ts) already join
//      single lines that are less than one cell apart; the warning tells the user that the drawing had a break.
//
// Cost: edges and ends are visited once; a hash with bucket size GAP_TOLERANCE_M gives each end a fixed 3 x 3 bucket
// neighbourhood; each gap looks at a fixed square of cells. No all-pairs step.
import { CELL_SIZE_M } from '../../people/constants';
import { CELL_FREE, CELL_WALL } from '../../people/types';
import { GAP_TOLERANCE_M } from '../constants';
import type { FlatEntity } from '../dxf/blocks';
import type { LayerMap, ImportWarning } from '../types';
import { gapClosed } from '../warnings';
import { RASTER_EPS_M, WALL_PAIR_MAX_THICKNESS_M } from './rasterConstants';
import type { GridSpec } from './rasterize';

// Estimate: largest offset between the lines of two wall pieces that still count as one line. Far below the gap
// tolerance, so the two lines of a thin wall drawn as a pair (0.05 m apart or more) never match.
export const GAP_COLLINEAR_TOLERANCE_M = 1e-3;

// Estimate: sine of the largest angle between the two wall edges of a gap (about 0.06 degrees).
export const GAP_PARALLEL_SINE = 1e-3;

// Estimate: how far along the grid axis a wall cell is looked for on each side of a gap cell. The gap is under one
// cell wide, so a wall cell belonging to either side is at most the tolerance in cells plus one cell away.
export const GAP_END_SCAN_CELLS = Math.ceil(GAP_TOLERANCE_M / CELL_SIZE_M) + 1;

// Cells around the gap midpoint that can hold a gap cell: the thickest wall plus the tolerance, in cells.
const GAP_BOX_CELLS = Math.ceil((WALL_PAIR_MAX_THICKNESS_M + GAP_TOLERANCE_M) / CELL_SIZE_M);

export interface CloseGapsInput {
  floorId: string;
  entities: readonly FlatEntity[]; // metres, the same list given to rasterize
  layerMap: LayerMap;
  grid: GridSpec;
  cellType: Uint8Array; // the rasterizer's output; not changed
}

export interface ClosedGap {
  xM: number; // midpoint of the gap
  yM: number;
  widthM: number;
  xCell: number;
  yCell: number;
  cellsSet: number; // cells changed from free to wall for this gap (may be 0)
}

export interface CloseGapsResult {
  cellType: Uint8Array; // new array
  gaps: ClosedGap[];
  warnings: ImportWarning[];
}

interface Edge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

interface End {
  x: number;
  y: number;
  ux: number; // unit direction pointing out of the edge at this end
  uy: number;
  edge: number;
}

function edgesOf(e: FlatEntity, out: Edge[]): void {
  if (e.kind === 'LINE') {
    out.push({ ax: e.x1, ay: e.y1, bx: e.x2, by: e.y2 });
    return;
  }
  if (e.kind !== 'POLYLINE') return;
  const v = e.vertices;
  const count = e.closed ? v.length : v.length - 1;
  for (let i = 0; i < count; i++) {
    const p = v[i];
    const q = v[(i + 1) % v.length];
    if (p === undefined || q === undefined) continue;
    if (p.bulge !== 0 && Number.isFinite(p.bulge)) continue; // arc piece: not a straight wall edge
    out.push({ ax: p.x, ay: p.y, bx: q.x, by: q.y });
  }
}

function endsOf(edges: readonly Edge[]): End[] {
  const ends: End[] = [];
  edges.forEach((s, edge) => {
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || !(len >= RASTER_EPS_M)) return;
    const ux = dx / len;
    const uy = dy / len;
    ends.push({ x: s.bx, y: s.by, ux, uy, edge });
    ends.push({ x: s.ax, y: s.ay, ux: -ux, uy: -uy, edge });
  });
  return ends;
}

const bucket = (v: number): number => Math.floor(v / GAP_TOLERANCE_M);
const bucketKey = (bx: number, by: number): string => `${bx},${by}`;

// For each end, the nearest facing end of another edge; pairs are returned once, in sorted order.
function findGapPairs(ends: readonly End[]): [number, number][] {
  const hash = new Map<string, number[]>();
  ends.forEach((p, i) => {
    const key = bucketKey(bucket(p.x), bucket(p.y));
    const list = hash.get(key);
    if (list === undefined) hash.set(key, [i]);
    else list.push(i);
  });
  const limit = GAP_TOLERANCE_M - RASTER_EPS_M;
  const seen = new Set<number>();
  const pairs: [number, number][] = [];
  ends.forEach((p, i) => {
    let best = -1;
    let bestDist = Infinity;
    const bx = bucket(p.x);
    const by = bucket(p.y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of hash.get(bucketKey(bx + dx, by + dy)) ?? []) {
          const q = ends[j] as End;
          if (q.edge === p.edge) continue;
          const rx = q.x - p.x;
          const ry = q.y - p.y;
          const along = rx * p.ux + ry * p.uy; // positive: q lies beyond the end of p's edge
          const across = Math.abs(rx * p.uy - ry * p.ux);
          if (!(along > RASTER_EPS_M && along < limit) || across > GAP_COLLINEAR_TOLERANCE_M) continue;
          if (Math.abs(p.ux * q.uy - p.uy * q.ux) > GAP_PARALLEL_SINE || p.ux * q.ux + p.uy * q.uy >= 0) continue; // must face p
          if (along < bestDist || (along === bestDist && j < best)) {
            best = j;
            bestDist = along;
          }
        }
      }
    }
    if (best < 0) return;
    const key = Math.min(i, best) * ends.length + Math.max(i, best);
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([Math.min(i, best), Math.max(i, best)]);
  });
  return pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const inGrid = (g: GridSpec, ix: number, iy: number): boolean => ix >= 0 && iy >= 0 && ix < g.widthCells && iy < g.heightCells;

export function closeGaps(input: CloseGapsInput): CloseGapsResult {
  const { grid } = input;
  const out: CloseGapsResult = { cellType: new Uint8Array(input.cellType), gaps: [], warnings: [] };
  const gridOk =
    Number.isInteger(grid.widthCells) &&
    Number.isInteger(grid.heightCells) &&
    grid.widthCells > 0 &&
    grid.heightCells > 0 &&
    Number.isFinite(grid.originXM) &&
    Number.isFinite(grid.originYM) &&
    input.cellType.length === grid.widthCells * grid.heightCells;
  if (!gridOk) return out;

  const edges: Edge[] = [];
  for (const e of input.entities) {
    if (Object.hasOwn(input.layerMap, e.layer) && input.layerMap[e.layer] === 'wall') edgesOf(e, edges);
  }
  const ends = endsOf(edges);
  const before = input.cellType; // decisions read the grid as it came in
  const w = grid.widthCells;
  const wallAt = (ix: number, iy: number): boolean => inGrid(grid, ix, iy) && before[iy * w + ix] === CELL_WALL;

  for (const [i, j] of findGapPairs(ends)) {
    const p = ends[i] as End;
    const q = ends[j] as End;
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const widthM = Math.hypot(q.x - p.x, q.y - p.y);
    const mxCell = Math.floor((mx - grid.originXM) / CELL_SIZE_M);
    const myCell = Math.floor((my - grid.originYM) / CELL_SIZE_M);
    if (!inGrid(grid, mxCell, myCell)) continue; // the gap lies outside the grid
    const horizontal = Math.abs(p.ux) >= Math.abs(p.uy);
    const stepX = horizontal ? 1 : 0;
    const stepY = horizontal ? 0 : 1;

    let cellsSet = 0;
    for (let iy = myCell - GAP_BOX_CELLS; iy <= myCell + GAP_BOX_CELLS; iy++) {
      for (let ix = mxCell - GAP_BOX_CELLS; ix <= mxCell + GAP_BOX_CELLS; ix++) {
        if (!inGrid(grid, ix, iy) || before[iy * w + ix] !== CELL_FREE) continue;
        const cx = grid.originXM + (ix + 0.5) * CELL_SIZE_M - p.x;
        const cy = grid.originYM + (iy + 0.5) * CELL_SIZE_M - p.y;
        // p -> q runs along -q.u, which equals p.u up to the parallel tolerance.
        const along = cx * p.ux + cy * p.uy;
        const across = Math.abs(cx * p.uy - cy * p.ux);
        if (!(along > 0 && along < widthM) || across > WALL_PAIR_MAX_THICKNESS_M) continue;
        let lo = false;
        let hi = false;
        for (let k = 1; k <= GAP_END_SCAN_CELLS && !(lo && hi); k++) {
          lo = lo || wallAt(ix - k * stepX, iy - k * stepY);
          hi = hi || wallAt(ix + k * stepX, iy + k * stepY);
        }
        if (!lo || !hi) continue;
        out.cellType[iy * w + ix] = CELL_WALL;
        cellsSet++;
      }
    }
    out.gaps.push({ xM: mx, yM: my, widthM, xCell: mxCell, yCell: myCell, cellsSet });
    out.warnings.push(gapClosed(input.floorId, mxCell, myCell));
  }
  return out;
}
