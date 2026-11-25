// Independent Bellman-Ford reference for the Flow_Field (task 3.4 and 3.5). It rebuilds the graph from the Plan data
// (cell types, fit flags, clearance costs, stair links) and does not use src/core/people/flowfield.
import { CELL_SIZE_M, V_FREE_M_PER_S } from '../../src/core/people/constants';
import type { Plan } from '../../src/core/people/types';
import { CELL_EXIT, CELL_WALL, NO_COMPARTMENT } from '../../src/core/people/types';

const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export interface RefEdge {
  from: number;
  to: number;
  cost: number;
}

// Directed edges (both directions of every undirected edge), in the order: for each node, 8 directions, then links.
export function referenceEdges(plan: Plan, mult?: ArrayLike<number>): { edges: RefEdge[]; weight: Float64Array } {
  const weight = new Float64Array(plan.nodeCount).fill(1);
  if (mult) {
    for (const f of plan.floors) {
      for (let c = 0; c < f.compartment.length; c++) {
        const k = f.compartment[c]!;
        if (k !== NO_COMPARTMENT && k < mult.length) weight[plan.nodeOffset[f.index]! + c] = mult[k]!;
      }
    }
  }
  const isNode = (fi: number, c: number): boolean => {
    const f = plan.floors[fi]!;
    return f.cellType[c] !== CELL_WALL && f.fitsAgent[c] === 1 && weight[plan.nodeOffset[fi]! + c] !== Infinity;
  };
  const edges: RefEdge[] = [];
  for (const f of plan.floors) {
    const off = plan.nodeOffset[f.index]!;
    for (let y = 0; y < f.heightCells; y++) {
      for (let x = 0; x < f.widthCells; x++) {
        const c = y * f.widthCells + x;
        if (!isNode(f.index, c)) continue;
        for (const [dx, dy, len] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= f.widthCells || ny >= f.heightCells) continue;
          const n = ny * f.widthCells + nx;
          if (!isNode(f.index, n)) continue;
          if (dx !== 0 && dy !== 0) {
            const a = f.cellType[y * f.widthCells + nx] === CELL_WALL;
            const b = f.cellType[ny * f.widthCells + x] === CELL_WALL;
            if (a || b) continue;
          }
          const cost = len * 0.5 * (weight[off + c]! + weight[off + n]!) + 0.5 * (f.clearanceCost[c]! + f.clearanceCost[n]!);
          edges.push({ from: off + c, to: off + n, cost });
        }
      }
    }
  }
  for (const l of plan.stairLinks) {
    const base = (l.inclineLengthM * V_FREE_M_PER_S) / l.speedFreeMPerS / CELL_SIZE_M;
    for (const c of l.footprint) {
      if (!isNode(l.lowerFloor, c) || !isNode(l.upperFloor, c)) continue;
      const a = plan.nodeOffset[l.lowerFloor]! + c;
      const b = plan.nodeOffset[l.upperFloor]! + c;
      const cost = base * 0.5 * (weight[a]! + weight[b]!);
      edges.push({ from: a, to: b, cost }, { from: b, to: a, cost });
    }
  }
  return { edges, weight };
}

// Cost to go from every node to the exit group `exitIndex`, by repeated relaxation until nothing changes.
export function bellmanFord(plan: Plan, exitIndex: number, mult?: ArrayLike<number>): Float64Array {
  const { edges, weight } = referenceEdges(plan, mult);
  const dist = new Float64Array(plan.nodeCount).fill(Infinity);
  const e = plan.exits[exitIndex]!;
  const f = plan.floors[e.floorIndex]!;
  for (const c of e.cells) {
    const node = plan.nodeOffset[e.floorIndex]! + c;
    if (f.fitsAgent[c] === 1 && weight[node] !== Infinity) dist[node] = 0;
  }
  for (let pass = 0; pass < plan.nodeCount; pass++) {
    let changed = false;
    for (const ed of edges) {
      const cand = dist[ed.from]! + ed.cost;
      if (cand < dist[ed.to]!) {
        dist[ed.to] = cand;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return dist;
}

// Number of 4-neighbour connected groups of exit cells over all floors, counted independently.
export function countExitGroups(plan: Plan): number {
  let groups = 0;
  for (const f of plan.floors) {
    const seen = new Uint8Array(f.cellType.length);
    for (let s = 0; s < seen.length; s++) {
      if (f.cellType[s] !== CELL_EXIT || seen[s]) continue;
      groups++;
      const stack = [s];
      seen[s] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        const x = c % f.widthCells;
        const y = (c - x) / f.widthCells;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= f.widthCells || ny >= f.heightCells) continue;
          const n = ny * f.widthCells + nx;
          if (f.cellType[n] === CELL_EXIT && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
  }
  return groups;
}

export function closeEnough(a: number, b: number): boolean {
  if (a === Infinity || b === Infinity) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}
