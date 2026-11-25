// Reachability of exits over the base graph (Requirement 1.8, Design Plan builder step 6).
import type { CrowdWarning, PlanFloor } from '../types';
import { unreachableRegion } from '../warnings';
import { NEIGHBOUR_DX, isNode, neighbourNode } from './grid';

export interface LinkEdges {
  lowerFloor: number;
  upperFloor: number;
  footprint: Int32Array;
}

// Flood fill from every exit cell that is a node, over 8-neighbour moves (same corner rule as the Flow_Field) and the
// stair links. Returns the reached flag per node (index nodeOffset[floor] + cell) and one UNREACHABLE_REGION Warning
// per connected region (within one floor, same moves) of node cells that were not reached. A plan with no exit gets
// one Warning per region as well, since Requirement 1.8 applies to every walkable cell.
// Shortcut: a region is connected within one floor only; a region that spans floors through a stair gives one Warning
// per floor. Upgrade if a per-building region count is needed.
export function findUnreachable(
  floors: PlanFloor[],
  nodeOffset: Int32Array,
  nodeCount: number,
  links: LinkEdges[],
  exitCellsByFloor: { floorIndex: number; cells: Int32Array }[],
): { reached: Uint8Array; warnings: CrowdWarning[] } {
  const reached = new Uint8Array(nodeCount);
  const queue = new Int32Array(nodeCount);
  let head = 0;
  let tail = 0;
  const push = (node: number): void => {
    if (reached[node] === 1) return;
    reached[node] = 1;
    queue[tail++] = node;
  };
  for (const e of exitCellsByFloor) {
    const f = floors[e.floorIndex]!;
    for (const c of e.cells) if (isNode(f, c)) push(nodeOffset[e.floorIndex]! + c);
  }
  // Stair partner lookup: cell -> nodes on the other floor of every link whose footprint holds the cell.
  const partners = floors.map(() => new Map<number, number[]>());
  const addPartner = (floor: number, cell: number, other: number): void => {
    const m = partners[floor]!;
    const list = m.get(cell);
    if (list) list.push(other);
    else m.set(cell, [other]);
  };
  for (const l of links) {
    for (const c of l.footprint) {
      addPartner(l.lowerFloor, c, nodeOffset[l.upperFloor]! + c);
      addPartner(l.upperFloor, c, nodeOffset[l.lowerFloor]! + c);
    }
  }
  while (head < tail) {
    const node = queue[head++]!;
    const fi = floorOfNode(nodeOffset, node);
    const f = floors[fi]!;
    const cell = node - nodeOffset[fi]!;
    const x = cell % f.widthCells;
    const y = (cell - x) / f.widthCells;
    for (let d = 0; d < NEIGHBOUR_DX.length; d++) {
      const n = neighbourNode(f, x, y, d);
      if (n >= 0) push(nodeOffset[fi]! + n);
    }
    const p = partners[fi]!.get(cell);
    if (p) {
      for (const other of p) {
        const of = floorOfNode(nodeOffset, other);
        if (isNode(floors[of]!, other - nodeOffset[of]!)) push(other);
      }
    }
  }
  const warnings: CrowdWarning[] = [];
  for (const f of floors) {
    const off = nodeOffset[f.index]!;
    const w = f.widthCells;
    const seen = new Uint8Array(w * f.heightCells);
    const stack: number[] = [];
    for (let s = 0; s < seen.length; s++) {
      if (seen[s] === 1 || !isNode(f, s) || reached[off + s] === 1) continue;
      let minX = w, maxX = 0, minY = f.heightCells, maxY = 0;
      seen[s] = 1;
      stack.push(s);
      while (stack.length > 0) {
        const c = stack.pop()!;
        const x = c % w;
        const y = (c - x) / w;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (let d = 0; d < NEIGHBOUR_DX.length; d++) {
          const n = neighbourNode(f, x, y, d);
          if (n >= 0 && seen[n] === 0 && reached[off + n] === 0) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
      warnings.push(unreachableRegion(f.id, minX, minY, maxX, maxY));
    }
  }
  return { reached, warnings };
}

// Floor index of a node: largest f with nodeOffset[f] <= node (binary search over at most 12 floors).
export function floorOfNode(nodeOffset: Int32Array, node: number): number {
  let lo = 0;
  let hi = nodeOffset.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (nodeOffset[mid]! <= node) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
