// Agent-agent separation and agent-wall resolution (Design, "Steering and collision" steps 5 and 6; Requirements 2.4, 2.12).
// All displacements of one iteration are computed from the same positions and applied together, so the result does not
// depend on agent order.
import { AGENT_RADIUS_M, CELL_SIZE_M } from '../constants';
import { STATE_MOVING, STATE_PRE_MOVE } from '../agents/state';
import type { SpatialHash } from '../spatial/hash';
import type { AgentStore, Plan, PlanFloor } from '../types';
import { CELL_WALL } from '../types';
// Numerical parameter (Design: "two relaxation iterations per step").
export const SEPARATION_ITERATIONS = 2;
// Numerical parameter (Design: "two iterations" of wall resolution).
export const WALL_ITERATIONS = 2;
// Numerical parameter: largest push of one agent in one separation iteration, m. Keeps a step far below one bucket (1 m)
// and below the thickness of a wall cell (0.25 m) when many agents overlap. Alternative: no cap (agents on the same point
// could jump through a thin wall).
export const MAX_PUSH_PER_ITERATION_M = 0.1;
// Numerical parameter: the wall push leaves the centre this far beyond one radius, m, so rounding cannot leave it short.
export const WALL_PUSH_MARGIN_M = 1e-9;
export interface SeparationScratch {
  dx: Float64Array;
  dy: Float64Array;
  nb: Int32Array;
}
export function createSeparationScratch(n: number): SeparationScratch {
  return { dx: new Float64Array(n), dy: new Float64Array(n), nb: new Int32Array(Math.max(1, n)) };
}
// `weight[i]` is how willing agent i is to give way: 0 for an agent that must stay (pre-movement), 1 for a moving agent,
// less than 1 for an agent that has priority (the armed agent of a gate). Incapacitated agents are ignored (Open item 9).
// Each overlapping pair is pushed apart along the line of centres by the overlap, shared in proportion to the weights.
export function separateAgents(
  a: AgentStore,
  hash: SpatialHash,
  xs: Float64Array,
  ys: Float64Array,
  weight: Float64Array,
  scratch: SeparationScratch,
  iterations: number = SEPARATION_ITERATIONS,
): void {
  const reach = 2 * AGENT_RADIUS_M;
  for (let it = 0; it < iterations; it++) {
    scratch.dx.fill(0);
    scratch.dy.fill(0);
    for (let i = 0; i < a.n; i++) {
      const si = a.state[i]!;
      if (si !== STATE_MOVING && si !== STATE_PRE_MOVE) continue;
      const m = hash.neighbours(i, reach, xs, ys, scratch.nb);
      for (let k = 0; k < m; k++) {
        const j = scratch.nb[k]!;
        if (j <= i) continue;
        const sj = a.state[j]!;
        if (sj !== STATE_MOVING && sj !== STATE_PRE_MOVE) continue;
        const wi = si === STATE_MOVING ? weight[i]! : 0;
        const wj = sj === STATE_MOVING ? weight[j]! : 0;
        const sum = wi + wj;
        if (!(sum > 0)) continue;
        let ux = xs[i]! - xs[j]!;
        let uy = ys[i]! - ys[j]!;
        const d = Math.hypot(ux, uy);
        if (d >= reach) continue;
        if (d < 1e-9) {
          // Same point: separate along x or y, chosen by index parity, so the result is deterministic.
          ux = (i + j) % 2 === 0 ? 1 : 0;
          uy = (i + j) % 2 === 0 ? 0 : 1;
        } else {
          ux /= d;
          uy /= d;
        }
        const overlap = reach - d;
        scratch.dx[i] = scratch.dx[i]! + (ux * overlap * wi) / sum;
        scratch.dy[i] = scratch.dy[i]! + (uy * overlap * wi) / sum;
        scratch.dx[j] = scratch.dx[j]! - (ux * overlap * wj) / sum;
        scratch.dy[j] = scratch.dy[j]! - (uy * overlap * wj) / sum;
      }
    }
    for (let i = 0; i < a.n; i++) {
      let px = scratch.dx[i]!;
      let py = scratch.dy[i]!;
      const mag = Math.hypot(px, py);
      if (mag === 0) continue;
      if (mag > MAX_PUSH_PER_ITERATION_M) {
        px *= MAX_PUSH_PER_ITERATION_M / mag;
        py *= MAX_PUSH_PER_ITERATION_M / mag;
      }
      xs[i] = xs[i]! + px;
      ys[i] = ys[i]! + py;
    }
  }
}
export function cellAt(f: PlanFloor, x: number, y: number): number {
  const cx = Math.min(f.widthCells - 1, Math.max(0, Math.floor(x / CELL_SIZE_M)));
  const cy = Math.min(f.heightCells - 1, Math.max(0, Math.floor(y / CELL_SIZE_M)));
  return cy * f.widthCells + cx;
}
const isWall = (f: PlanFloor, cx: number, cy: number): boolean =>
  cx >= 0 && cy >= 0 && cx < f.widthCells && cy < f.heightCells && f.cellType[cy * f.widthCells + cx] === CELL_WALL;
// Pushes the disc of one agent out of the wall cells around its centre. Returns the new position through `out`.
function pushOutOfWalls(f: PlanFloor, x: number, y: number, out: { x: number; y: number }): void {
  const r = AGENT_RADIUS_M + WALL_PUSH_MARGIN_M;
  const ccx = Math.floor(x / CELL_SIZE_M);
  const ccy = Math.floor(y / CELL_SIZE_M);
  let px = x;
  let py = y;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const wx = ccx + dx;
      const wy = ccy + dy;
      if (!isWall(f, wx, wy)) continue;
      const x0 = wx * CELL_SIZE_M;
      const y0 = wy * CELL_SIZE_M;
      const x1 = x0 + CELL_SIZE_M;
      const y1 = y0 + CELL_SIZE_M;
      const qx = Math.min(x1, Math.max(x0, px));
      const qy = Math.min(y1, Math.max(y0, py));
      const ex = px - qx;
      const ey = py - qy;
      const d = Math.hypot(ex, ey);
      if (d >= r) continue;
      if (d > 0) {
        px = qx + (ex / d) * r;
        py = qy + (ey / d) * r;
      } else {
        // The centre is inside the wall cell: leave through the nearest edge.
        const left = px - x0;
        const right = x1 - px;
        const up = py - y0;
        const down = y1 - py;
        const m = Math.min(left, right, up, down);
        if (m === left) px = x0 - r;
        else if (m === right) px = x1 + r;
        else if (m === up) py = y0 - r;
        else py = y1 + r;
      }
    }
  }
  out.x = px;
  out.y = py;
}
// Requirement 2.4: keeps the centre of every moving agent at least one radius from every wall cell where space allows.
export function resolveWalls(plan: Plan, a: AgentStore, xs: Float64Array, ys: Float64Array, iterations: number = WALL_ITERATIONS): void {
  const tmp = { x: 0, y: 0 };
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < a.n; i++) {
      if (a.state[i] !== STATE_MOVING) continue;
      pushOutOfWalls(plan.floors[a.floor[i]!]!, xs[i]!, ys[i]!, tmp);
      xs[i] = tmp.x;
      ys[i] = tmp.y;
    }
  }
}
// True when the closed segment (x0, y0)-(x1, y1) meets the closed square [sx, sx + s] x [sy, sy + s] (slab test).
function segmentMeetsSquare(x0: number, y0: number, x1: number, y1: number, sx: number, sy: number, s: number): boolean {
  let tmin = 0;
  let tmax = 1;
  const d = [x1 - x0, y1 - y0];
  const lo = [sx, sy];
  const o = [x0, y0];
  for (let k = 0; k < 2; k++) {
    const dk = d[k]!;
    if (dk === 0) {
      if (o[k]! < lo[k]! || o[k]! > lo[k]! + s) return false;
      continue;
    }
    let t1 = (lo[k]! - o[k]!) / dk;
    let t2 = (lo[k]! + s - o[k]!) / dk;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}
// Property 2: the end point lies inside the grid in a cell that is not a wall, and the straight segment from the start of
// the step to the end point meets no wall cell.
export function stepKeepsOutOfWalls(f: PlanFloor, x0: number, y0: number, x1: number, y1: number): boolean {
  const wM = f.widthCells * CELL_SIZE_M;
  const hM = f.heightCells * CELL_SIZE_M;
  if (!(x1 >= 0 && y1 >= 0 && x1 < wM && y1 < hM)) return false;
  if (isWall(f, Math.floor(x1 / CELL_SIZE_M), Math.floor(y1 / CELL_SIZE_M))) return false;
  const cx0 = Math.floor(Math.min(x0, x1) / CELL_SIZE_M);
  const cx1 = Math.floor(Math.max(x0, x1) / CELL_SIZE_M);
  const cy0 = Math.floor(Math.min(y0, y1) / CELL_SIZE_M);
  const cy1 = Math.floor(Math.max(y0, y1) / CELL_SIZE_M);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      if (isWall(f, cx, cy) && segmentMeetsSquare(x0, y0, x1, y1, cx * CELL_SIZE_M, cy * CELL_SIZE_M, CELL_SIZE_M)) return false;
    }
  }
  return true;
}
