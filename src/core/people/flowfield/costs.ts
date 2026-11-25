// Node graph and edge costs of the Flow_Field (Design, Algorithms, "Flow_Field"; Requirements 1.9, 2.2, 2.3).
// A node is (floor, cell) with index nodeOffset[floor] + cell, for every walkable cell that fits an agent.
import { CELL_SIZE_M, V_FREE_M_PER_S } from '../constants';
import { NEIGHBOUR_DX, NEIGHBOUR_LEN, neighbourNode } from '../plan/grid';
import type { PlanFloor, StairLinkModel } from '../types';
import { NO_COMPARTMENT } from '../types';

export interface LinkEdge {
  to: number; // node on the other floor
  base: number; // cost in cell lengths at multiplier 1, before the compartment weights
}

// The part of a Plan the flow field needs. Plan satisfies it.
export interface GraphParts {
  floors: PlanFloor[];
  nodeOffset: Int32Array;
  nodeCount: number;
  stairLinks: StairLinkModel[];
}

export interface Graph extends GraphParts {
  nodeFloor: Uint8Array; // floor index of every node
  linkEdges: Map<number, LinkEdge[]>; // stair link edges by node, in link order (both directions are stored)
  maxDegree: number; // scratch size: 8 plus the largest number of link edges of one node
}

// Stair link edge cost in cell lengths: the incline length walked at the table speed, converted to the time-equivalent
// length at free walking speed (Design, Flow_Field "link" formula).
export function linkBaseCost(link: StairLinkModel): number {
  return (link.inclineLengthM * V_FREE_M_PER_S) / link.speedFreeMPerS / CELL_SIZE_M;
}

export function buildGraph(parts: GraphParts): Graph {
  const nodeFloor = new Uint8Array(parts.nodeCount);
  for (const f of parts.floors) nodeFloor.fill(f.index, parts.nodeOffset[f.index]!, parts.nodeOffset[f.index]! + f.widthCells * f.heightCells);
  const linkEdges = new Map<number, LinkEdge[]>();
  const add = (from: number, to: number, base: number): void => {
    const list = linkEdges.get(from);
    if (list) list.push({ to, base });
    else linkEdges.set(from, [{ to, base }]);
  };
  for (const link of parts.stairLinks) {
    const base = linkBaseCost(link);
    const lo = parts.nodeOffset[link.lowerFloor]!;
    const up = parts.nodeOffset[link.upperFloor]!;
    const fl = parts.floors[link.lowerFloor]!;
    const fu = parts.floors[link.upperFloor]!;
    for (const c of link.footprint) {
      // Both ends must be nodes (a stair cell that does not fit an agent is closed).
      if (fl.fitsAgent[c] !== 1 || fu.fitsAgent[c] !== 1) continue;
      add(lo + c, up + c, base);
      add(up + c, lo + c, base);
    }
  }
  let maxDegree = NEIGHBOUR_DX.length;
  for (const l of linkEdges.values()) maxDegree = Math.max(maxDegree, NEIGHBOUR_DX.length + l.length);
  return { ...parts, nodeFloor, linkEdges, maxDegree };
}

// Per-node multiplier: mult[compartment index] for a cell with a compartment, else 1. `Infinity` removes the node.
// `multByCompartment` is indexed like Plan.compartmentIds; absent entries count as 1.
export function nodeWeights(g: Graph, multByCompartment?: ArrayLike<number>): Float64Array {
  const w = new Float64Array(g.nodeCount).fill(1);
  if (!multByCompartment) return w;
  for (const f of g.floors) {
    const off = g.nodeOffset[f.index]!;
    for (let c = 0; c < f.compartment.length; c++) {
      const k = f.compartment[c]!;
      if (k === NO_COMPARTMENT || k >= multByCompartment.length) continue;
      w[off + c] = multByCompartment[k]!;
    }
  }
  return w;
}

// Fills `toNodes`, `base` and `isLink` with the edges of `node` in the fixed visiting order (8 directions, then the
// link edges) and returns their count. Nodes with an infinite weight are skipped.
export function neighbours(g: Graph, w: Float64Array, node: number, toNodes: Int32Array, base: Float64Array, isLink: Uint8Array): number {
  const fi = g.nodeFloor[node]!;
  const f = g.floors[fi]!;
  const off = g.nodeOffset[fi]!;
  const cell = node - off;
  const x = cell % f.widthCells;
  const y = (cell - x) / f.widthCells;
  let n = 0;
  for (let d = 0; d < NEIGHBOUR_DX.length; d++) {
    const c = neighbourNode(f, x, y, d);
    if (c < 0 || w[off + c] === Infinity) continue;
    toNodes[n] = off + c;
    base[n] = NEIGHBOUR_LEN[d]!;
    isLink[n] = 0;
    n++;
  }
  const links = g.linkEdges.get(node);
  if (links) {
    for (const l of links) {
      if (w[l.to] === Infinity) continue;
      toNodes[n] = l.to;
      base[n] = l.base;
      isLink[n] = 1;
      n++;
    }
  }
  return n;
}

// Cost of one edge a-b (Design): same floor `len * 0.5 (w_a + w_b) + 0.5 (clr_a + clr_b)`; link `base * 0.5 (w_a + w_b)`.
// Symmetric in a and b, so a field computed from the exit outward is also the cost to go.
export function edgeCost(g: Graph, w: Float64Array, a: number, b: number, base: number, link: boolean): number {
  const mid = 0.5 * (w[a]! + w[b]!);
  if (link) return base * mid;
  const fa = g.nodeFloor[a]!;
  const clrA = g.floors[fa]!.clearanceCost[a - g.nodeOffset[fa]!]!;
  const fb = g.nodeFloor[b]!;
  const clrB = g.floors[fb]!.clearanceCost[b - g.nodeOffset[fb]!]!;
  return base * mid + 0.5 * (clrA + clrB);
}
