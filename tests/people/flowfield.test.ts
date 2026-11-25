// Unit tests for the Flow_Field (task 3.5; Requirements 1.9, 2.2, 2.3).
import { describe, expect, it } from 'vitest';
import { CELL_SIZE_M, V_FREE_M_PER_S } from '../../src/core/people/constants';
import { computeFieldsForExits } from '../../src/core/people/flowfield/baseFields';
import { buildGraph, edgeCost, nodeWeights } from '../../src/core/people/flowfield/costs';
import { computeField } from '../../src/core/people/flowfield/dijkstra';
import { floorFromAscii } from '../../src/core/people/plan/ascii';
import { buildPlan } from '../../src/core/people/plan/builder';
import type { Plan } from '../../src/core/people/types';
import { bellmanFord, closeEnough, referenceEdges } from './flowReference';
import { allSamples, openRoom, twoFloors, twoRooms } from './samplePlans';

const sameBytes = (a: Float64Array | Int32Array, b: Float64Array | Int32Array): boolean =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const fieldsWith = (plan: Plan, mult?: number[]): ReturnType<typeof computeFieldsForExits> =>
  computeFieldsForExits(buildGraph(plan), plan.exits.map((e) => plan.nodeOffset[e.floorIndex]!), plan.exits.map((e) => e.cells), mult);
const planOf = (rows: string[], legend: Record<string, string> = {}): Plan => {
  const r = buildPlan({ floors: [floorFromAscii(rows, legend)], stairLinks: [] });
  if (!r.plan) throw new Error('test plan is invalid');
  return r.plan;
};
// An open room of `w` x `h` interior cells with walls around it.
const box = (w: number, h: number): string[] =>
  Array.from({ length: h + 2 }, (_, y) => (y === 0 || y === h + 1 ? '#'.repeat(w + 2) : `#${'.'.repeat(w)}#`));
const withCells = (rows: string[], cells: [number, number, string][]): string[] => {
  const g = rows.map((r) => r.split(''));
  for (const [x, y, ch] of cells) g[y]![x] = ch;
  return g.map((r) => r.join(''));
};

describe('Flow_Field against Bellman-Ford (Requirements 2.2, 2.3)', () => {
  for (const s of allSamples()) {
    it(`${s.name}: every node cost matches`, () => {
      for (const field of s.plan.baseFields) {
        const ref = bellmanFord(s.plan, field.exitIndex);
        for (let v = 0; v < s.plan.nodeCount; v++) expect(closeEnough(field.cost[v]!, ref[v]!)).toBe(true);
      }
    });
  }
  it('matches with compartment multipliers (a smoky compartment costs more)', () => {
    const { plan } = twoRooms();
    const mult = plan.compartmentIds.map((id) => (id === 'A' ? 3 : 1));
    const [field] = fieldsWith(plan, mult);
    const ref = bellmanFord(plan, 0, mult);
    for (let v = 0; v < plan.nodeCount; v++) expect(closeEnough(field!.cost[v]!, ref[v]!)).toBe(true);
    expect(field!.cost.some((c, v) => c > plan.baseFields[0]!.cost[v]!)).toBe(true);
  });
});

describe('tie-breaking and determinism (Requirement 1.9)', () => {
  it('next[] is the first neighbour in visiting order that gives the final cost', () => {
    for (const s of [openRoom(), twoRooms(), twoFloors()]) {
      // The reference lists the edges of each node in the visiting order: 8 directions, then link edges.
      const { edges } = referenceEdges(s.plan);
      const field = s.plan.baseFields[0]!;
      for (let v = 0; v < s.plan.nodeCount; v++) {
        if (!(field.cost[v]! > 0) || field.cost[v] === Infinity) continue;
        let best = Infinity;
        let want = -1;
        for (const e of edges) {
          if (e.from !== v) continue;
          const cand = field.cost[e.to]! + e.cost;
          if (cand < best) {
            best = cand;
            want = e.to;
          }
        }
        expect(field.next[v]).toBe(want);
      }
    }
  });
  it('an exact tie goes to the earlier direction in the table', () => {
    // Exit straight below the start in a symmetric room: going down (+y) is direction 2 and diagonal moves are
    // longer, so next[] must be the cell below. With the exit to the right instead, next[] is direction 0 (+x).
    const down = planOf(withCells(box(5, 6), [[3, 7, 'E'], [2, 7, 'E'], [4, 7, 'E']]));
    const w = down.floors[0]!.widthCells;
    const start = 3 * w + 3;
    expect(down.baseFields[0]!.next[start]).toBe(start + w);
    const right = planOf(withCells(box(6, 5), [[7, 2, 'E'], [7, 3, 'E'], [7, 4, 'E']]));
    const w2 = right.floors[0]!.widthCells;
    expect(right.baseFields[0]!.next[3 * w2 + 3]).toBe(3 * w2 + 4);
  });
  it('building the same Plan twice gives bit-identical fields', () => {
    const a = twoFloors().plan;
    const b = twoFloors().plan;
    expect(a.baseFields).toHaveLength(b.baseFields.length);
    a.baseFields.forEach((fa, i) => {
      expect(sameBytes(fa.cost, b.baseFields[i]!.cost)).toBe(true);
      expect(sameBytes(fa.next, b.baseFields[i]!.next)).toBe(true);
    });
  });
});

describe('field count (Requirement 1.9)', () => {
  it('one field per edge-connected exit group', () => {
    const plan = planOf(withCells(box(8, 6), [[9, 1, 'E'], [9, 2, 'E'], [9, 5, 'E'], [9, 6, 'E'], [3, 0, 'E'], [4, 0, 'E']]));
    expect(plan.exits).toHaveLength(3);
    expect(plan.baseFields).toHaveLength(3);
    plan.baseFields.forEach((f, i) => expect(f.exitIndex).toBe(i));
    expect(openRoom().plan.baseFields).toHaveLength(1);
  });
  it('exit cells that touch only at a corner are separate groups', () => {
    // (8, 0) on the top wall and (9, 1) on the right wall meet diagonally.
    const plan = planOf(withCells(box(8, 6), [[8, 0, 'E'], [9, 1, 'E']]));
    expect(plan.exits).toHaveLength(2);
    expect(plan.baseFields).toHaveLength(2);
  });
  it('a plan with no exit has no fields', () => {
    expect(allSamples().find((s) => s.name === 'no exit')!.plan.baseFields).toHaveLength(0);
  });
});

describe('stair link cost (Requirement 2.3)', () => {
  it('crossing the link adds incline length * V_FREE / k / cell size', () => {
    const { plan } = twoFloors();
    const link = plan.stairLinks[0]!;
    const base = (link.inclineLengthM * V_FREE_M_PER_S) / link.speedFreeMPerS / CELL_SIZE_M;
    const field = plan.baseFields[0]!;
    const lo = plan.nodeOffset[link.lowerFloor]!;
    const up = plan.nodeOffset[link.upperFloor]!;
    const minLow = Math.min(...Array.from(link.footprint, (c) => field.cost[lo + c]!));
    const minUp = Math.min(...Array.from(link.footprint, (c) => field.cost[up + c]!));
    expect(minUp - minLow).toBeCloseTo(base, 9);
    expect(base).toBeGreaterThan(10); // a 3 m storey at stair speed costs far more than one cell
  });
  it('every upper-floor node has a finite route through the stair', () => {
    const { plan } = twoFloors();
    const field = plan.baseFields[0]!;
    const up = plan.nodeOffset[1]!;
    const f1 = plan.floors[1]!;
    for (let c = 0; c < f1.cellType.length; c++) {
      if (f1.fitsAgent[c] === 1) expect(field.cost[up + c]).toBeLessThan(Infinity);
    }
  });
});

describe('wall-clearance cost (Requirement 2.3)', () => {
  it('adds half the sum of the two cell costs to a step', () => {
    const plan = planOf(box(8, 7));
    const g = buildGraph(plan);
    const w = nodeWeights(g);
    const at = (x: number, y: number): number => y * 10 + x;
    // Row 1 touches the wall (cost 1.0), row 2 is two cells away (0.5), row 3 and below are free of the cost.
    expect(plan.floors[0]!.clearanceCost[at(4, 1)]).toBe(1);
    expect(plan.floors[0]!.clearanceCost[at(4, 2)]).toBe(0.5);
    expect(plan.floors[0]!.clearanceCost[at(4, 3)]).toBe(0);
    expect(edgeCost(g, w, at(3, 1), at(4, 1), 1, false)).toBeCloseTo(2, 12); // 1 + 0.5 (1 + 1)
    expect(edgeCost(g, w, at(3, 2), at(4, 2), 1, false)).toBeCloseTo(1.5, 12); // 1 + 0.5 (0.5 + 0.5)
    expect(edgeCost(g, w, at(3, 3), at(4, 3), 1, false)).toBeCloseTo(1, 12);
    expect(edgeCost(g, w, at(3, 3), at(4, 2), Math.SQRT2, false)).toBeCloseTo(Math.SQRT2 + 0.25, 12);
  });
  it('the cheapest route keeps away from the wall where it can', () => {
    // Wide room, exit in the middle of the right wall: the route from the left middle runs along the centre rows.
    const plan = planOf(withCells(box(12, 9), [[13, 4, 'E'], [13, 5, 'E'], [13, 6, 'E']]));
    const f = plan.baseFields[0]!;
    const w = plan.floors[0]!.widthCells;
    let node = 5 * w + 1;
    while (f.cost[node]! > 0) {
      const y = Math.floor(node / w);
      const x = node % w;
      if (x >= 3 && x <= 10) expect(y === 4 || y === 5 || y === 6).toBe(true);
      node = f.next[node]!;
    }
    // Same distance to the exit column: a cell on the wall row costs more than one in the middle.
    expect(f.cost[1 * w + 2]!).toBeGreaterThan(f.cost[5 * w + 2]!);
  });
});

describe('blocked compartment (Requirement 2.3)', () => {
  it('an infinite multiplier removes the nodes of that compartment', () => {
    const { plan } = twoRooms();
    const a = plan.compartmentIds.indexOf('A');
    const b = plan.compartmentIds.indexOf('B');
    const [field] = fieldsWith(plan, plan.compartmentIds.map((_, i) => (i === a ? Infinity : 1)));
    const f = plan.floors[0]!;
    for (let c = 0; c < f.cellType.length; c++) {
      if (f.compartment[c] === a) expect(field!.cost[c]).toBe(Infinity);
      if (f.compartment[c] === b && f.fitsAgent[c] === 1) expect(field!.cost[c]).toBeLessThan(Infinity);
    }
  });
  it('an infinite multiplier on the compartment of the exit cells gives an all-infinite field', () => {
    const plan = planOf(['#####', '#aaEE', '#aaEE', '#####'], { a: 'A', E: 'X' });
    const x = plan.compartmentIds.indexOf('X');
    const g = buildGraph(plan);
    const w = nodeWeights(g, plan.compartmentIds.map((_, i) => (i === x ? Infinity : 1)));
    const field = computeField(g, w, Int32Array.from(plan.exits[0]!.cells), 0);
    expect(field.cost.every((c) => c === Infinity)).toBe(true);
    expect(field.next.every((n) => n === -1)).toBe(true);
  });
});
