// Base Flow_Fields: one per exit group, all compartment multipliers 1 (Requirement 1.9).
import type { ExitField } from '../types';
import { nodeWeights, type Graph } from './costs';
import { computeField } from './dijkstra';

// `floorOffsets[i]` is the first node of the floor of exit group i and `cells[i]` its cell indices on that floor.
// Field i has exitIndex i. Weights come from `multByCompartment` (all 1 when absent). Exit cells that do not fit an
// agent are not nodes and are not seeds, so a closed (too narrow) exit gives a field of Infinity.
export function computeFieldsForExits(
  g: Graph,
  floorOffsets: number[],
  cells: Int32Array[],
  multByCompartment?: ArrayLike<number>,
): ExitField[] {
  const w = nodeWeights(g, multByCompartment);
  return cells.map((c, i) => {
    const seeds: number[] = [];
    for (const cell of c) {
      const node = floorOffsets[i]! + cell;
      const f = g.floors[g.nodeFloor[node]!]!;
      if (f.fitsAgent[cell] === 1) seeds.push(node);
    }
    return computeField(g, w, Int32Array.from(seeds), i);
  });
}
