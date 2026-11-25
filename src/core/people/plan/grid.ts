// Grid helpers of the Plan: index math, the fixed 8-neighbour table, wall-clearance cost and the agent-fit test.
// Design: Algorithms, "Plan builder" steps 3 and 4 and "Flow_Field". Pure functions over typed arrays, no allocation
// in the per-cell helpers.
import {
  AGENT_RADIUS_M,
  CELL_SIZE_M,
  WALL_CLEARANCE_COST_1_CELL,
  WALL_CLEARANCE_COST_2_CELLS,
  WALL_CLEARANCE_RANGE_CELLS,
} from '../constants';
import { CELL_WALL } from '../types';

export const cellIndex = (x: number, y: number, widthCells: number): number => y * widthCells + x;

// The 8 neighbour directions in the fixed visiting order the design requires (orthogonal first, then diagonal), so
// tie-breaking is the same in every run. Geometry, not a physics constant: lengths are in cell lengths.
export const NEIGHBOUR_DX: readonly number[] = [1, -1, 0, 0, 1, 1, -1, -1];
export const NEIGHBOUR_DY: readonly number[] = [0, 0, 1, -1, 1, -1, 1, -1];
export const NEIGHBOUR_LEN: readonly number[] = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

// The slice of a floor that the helpers need (PlanFloor satisfies it).
export interface GridView {
  widthCells: number;
  heightCells: number;
  cellType: Uint8Array;
  fitsAgent: Uint8Array;
}

// A node is a walkable cell (not a wall) in which an agent body fits.
export const isNode = (g: GridView, cell: number): boolean => g.cellType[cell] !== CELL_WALL && g.fitsAgent[cell] === 1;

const isWallAt = (g: Pick<GridView, 'widthCells' | 'heightCells' | 'cellType'>, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < g.widthCells && y < g.heightCells && g.cellType[y * g.widthCells + x] === CELL_WALL;

// Cell reached from (x, y) by direction `d`, or -1 when it is off the grid, not a node, or a diagonal move would cut a
// wall corner (Design, Flow_Field: "a diagonal move is dropped when either adjacent orthogonal cell is a wall").
export function neighbourNode(g: GridView, x: number, y: number, d: number): number {
  const dx = NEIGHBOUR_DX[d]!;
  const dy = NEIGHBOUR_DY[d]!;
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || ny < 0 || nx >= g.widthCells || ny >= g.heightCells) return -1;
  const n = ny * g.widthCells + nx;
  if (!isNode(g, n)) return -1;
  if (dx !== 0 && dy !== 0) {
    if (isWallAt(g, x + dx, y) || isWallAt(g, x, y + dy)) return -1;
  }
  return n;
}

// Chebyshev distance (in cells, 1..range) to the nearest wall cell, or 0 when no wall is within `range`.
// Cells outside the grid are not walls. Wall cells themselves give 0.
function nearestWall(g: Pick<GridView, 'widthCells' | 'heightCells' | 'cellType'>, x: number, y: number, range: number): number {
  for (let r = 1; r <= range; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isWallAt(g, x + dx, y + dy)) return r;
      }
    }
  }
  return 0;
}

// Requirement 2.3: wall-clearance cost per cell, in cell lengths. 1 cell from a wall costs
// WALL_CLEARANCE_COST_1_CELL, 2 cells costs WALL_CLEARANCE_COST_2_CELLS, farther or a wall cell costs 0.
export function wallClearanceCosts(g: Pick<GridView, 'widthCells' | 'heightCells' | 'cellType'>): Float32Array {
  const out = new Float32Array(g.widthCells * g.heightCells);
  for (let y = 0; y < g.heightCells; y++) {
    for (let x = 0; x < g.widthCells; x++) {
      const i = y * g.widthCells + x;
      if (g.cellType[i] === CELL_WALL) continue;
      const d = nearestWall(g, x, y, WALL_CLEARANCE_RANGE_CELLS);
      out[i] = d === 1 ? WALL_CLEARANCE_COST_1_CELL : d === 2 ? WALL_CLEARANCE_COST_2_CELLS : 0;
    }
  }
  return out;
}

// Distance from a point to the axis-aligned square of wall cell (wx, wy), m.
function distanceToWallCell(px: number, py: number, wx: number, wy: number): number {
  const x0 = wx * CELL_SIZE_M;
  const y0 = wy * CELL_SIZE_M;
  const dx = Math.max(x0 - px, 0, px - (x0 + CELL_SIZE_M));
  const dy = Math.max(y0 - py, 0, py - (y0 + CELL_SIZE_M));
  return Math.hypot(dx, dy);
}

// Design, Plan builder step 4: a cell "fits" when one of 9 sample points (centre, edge midpoints, corners) is at least
// AGENT_RADIUS_M from every wall cell within 2 cells. Cells with no wall within 2 cells fit without sampling.
export function fitsAgentAt(g: Pick<GridView, 'widthCells' | 'heightCells' | 'cellType'>, x: number, y: number): boolean {
  if (g.cellType[y * g.widthCells + x] === CELL_WALL) return false;
  if (nearestWall(g, x, y, WALL_CLEARANCE_RANGE_CELLS) === 0) return true;
  for (let sy = 0; sy <= 2; sy++) {
    for (let sx = 0; sx <= 2; sx++) {
      const px = (x + sx / 2) * CELL_SIZE_M;
      const py = (y + sy / 2) * CELL_SIZE_M;
      let ok = true;
      for (let dy = -WALL_CLEARANCE_RANGE_CELLS; dy <= WALL_CLEARANCE_RANGE_CELLS && ok; dy++) {
        for (let dx = -WALL_CLEARANCE_RANGE_CELLS; dx <= WALL_CLEARANCE_RANGE_CELLS; dx++) {
          if (isWallAt(g, x + dx, y + dy) && distanceToWallCell(px, py, x + dx, y + dy) < AGENT_RADIUS_M) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return true;
    }
  }
  return false;
}

export function computeFits(g: Pick<GridView, 'widthCells' | 'heightCells' | 'cellType'>): Uint8Array {
  const out = new Uint8Array(g.widthCells * g.heightCells);
  for (let y = 0; y < g.heightCells; y++) {
    for (let x = 0; x < g.widthCells; x++) out[y * g.widthCells + x] = fitsAgentAt(g, x, y) ? 1 : 0;
  }
  return out;
}
