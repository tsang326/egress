// Unit tests of the spatial hash and steering (task 12.3; Requirements 2.2, 2.4, 2.5, 2.12). Invented buildings only.
import { describe, expect, it } from 'vitest';
import { AGENT_RADIUS_M, CELL_SIZE_M, DENSITY_RADIUS_M } from '../../src/core/people/constants';
import { createAgentStore, FLAG_BLOCKED, STATE_MOVING, STATE_OUT } from '../../src/core/people/agents/state';
import { runCrowd } from '../../src/core/people/index';
import { floorFromAscii } from '../../src/core/people/plan/ascii';
import { buildPlan } from '../../src/core/people/plan/builder';
import { SpatialHash } from '../../src/core/people/spatial/hash';
import { createSeparationScratch, resolveWalls, separateAgents, stepKeepsOutOfWalls } from '../../src/core/people/steering/separation';
import { CELL_WALL } from '../../src/core/people/types';
import type { StepView } from '../../src/core/people/types';
import { agentAtCell, crowdInput, noFire, SHORT_DELAY } from './runHelpers';
import * as samples from './samplePlans';
const AREA = Math.PI * DENSITY_RADIUS_M * DENSITY_RADIUS_M;
// A store of moving agents at the given points of floor 0 of a plan.
function storeAt(points: [number, number][]) {
  const a = createAgentStore(points.length, 1);
  points.forEach(([x, y], i) => {
    a.x[i] = x;
    a.y[i] = y;
    a.state[i] = STATE_MOVING;
  });
  return a;
}
describe('spatial hash and density (Requirements 2.5, 2.6)', () => {
  const plan = samples.openRoom().plan;
  it('density is 0 with no neighbour, 1 / (pi r^2) with one, and n / (pi r^2) with several', () => {
    const a = storeAt([
      [1, 1],
      [1.5, 1],
      [2.5, 1.2],
      [2.2, 1.6],
    ]);
    const hash = new SpatialHash(plan, a.n);
    hash.rebuild(a);
    // Agent 0 sees agent 1 (0.5 m) only; agent 3 is 1.3 m away and agent 2 is 1.5 m away.
    expect(hash.density(a, 0)).toBeCloseTo(1 / AREA, 12);
    // Agent 1 sees 0 (0.5 m) and 3 (0.7 m on x, 0.6 on y: 0.92 m); agent 2 is 1.0 m on x and 0.2 on y: outside.
    expect(hash.density(a, 1)).toBeCloseTo(2 / AREA, 12);
    const far = storeAt([[0.5, 0.5], [2.4, 1.4]]);
    const h2 = new SpatialHash(plan, far.n);
    h2.rebuild(far);
    expect(h2.density(far, 0)).toBe(0);
    expect(h2.density(far, 1)).toBe(0);
  });
  it('agents that are Out are not in the hash and do not count', () => {
    const a = storeAt([[1, 1], [1.2, 1]]);
    a.state[1] = STATE_OUT;
    const hash = new SpatialHash(plan, a.n);
    hash.rebuild(a);
    expect(hash.density(a, 0)).toBe(0);
    expect(hash.density(a, 1)).toBe(0);
  });
  it('neighbours come in bucket order then agent index, and a rebuild clears the old buckets', () => {
    const a = storeAt([[1.5, 1.5], [1.6, 1.5], [1.4, 1.5], [0.6, 1.5]]);
    const hash = new SpatialHash(plan, a.n);
    const out = new Int32Array(a.n);
    hash.rebuild(a);
    let m = hash.neighbours(0, 1, a.x, a.y, out);
    expect(Array.from(out.slice(0, m))).toEqual([3, 1, 2]); // bucket (0,1) holds agent 3; bucket (1,1) holds 1 and 2
    a.x[1] = 2.9;
    a.x[2] = 2.9;
    a.x[3] = 2.9;
    hash.rebuild(a);
    m = hash.neighbours(0, 1, a.x, a.y, out);
    expect(m).toBe(0);
    expect(hash.neighbours(1, 1, a.x, a.y, out)).toBe(2);
  });
});
describe('agent separation (Requirement 2.2)', () => {
  it('50 agents packed into a corner of an open floor keep pair distances of at least twice the radius once settled', () => {
    const rows: string[] = ['#'.repeat(32)];
    for (let y = 0; y < 30; y++) rows.push('#' + 'a'.repeat(30) + '#');
    rows.push('#'.repeat(32));
    const plan = buildPlan({ floors: [floorFromAscii(rows, { a: 'A' })], stairLinks: [] }).plan!;
    const pts: [number, number][] = [];
    for (let k = 0; k < 50; k++) pts.push([3 + (k % 10) * 0.3, 3 + Math.floor(k / 10) * 0.3]);
    const a = storeAt(pts);
    const hash = new SpatialHash(plan, a.n);
    const scratch = createSeparationScratch(a.n);
    const weight = new Float64Array(a.n).fill(1);
    const xs = Float64Array.from(a.x);
    const ys = Float64Array.from(a.y);
    for (let step = 0; step < 400; step++) {
      a.x.set(xs);
      a.y.set(ys);
      hash.rebuild(a);
      separateAgents(a, hash, xs, ys, weight, scratch);
    }
    let min = Infinity;
    for (let i = 0; i < a.n; i++) for (let j = i + 1; j < a.n; j++) min = Math.min(min, Math.hypot(xs[i]! - xs[j]!, ys[i]! - ys[j]!));
    // Two relaxation iterations per step leave a residual overlap that shrinks as the crowd settles. Floating point
    // rounding accounts for the 1e-9 m.
    expect(min).toBeGreaterThanOrEqual(2 * AGENT_RADIUS_M - 1e-9);
  });
});
describe('walls (Requirements 2.4, 2.12)', () => {
  // A 2 x 2 cell wall block (x and y from 0.75 m to 1.25 m) with free cells all around it.
  const rows = ['#########', '#aaaaaaa#', '#aaaaaaa#', '#aa##aaa#', '#aa##aaa#', '#aaaaaaa#', '#aaaaaaa#', '#########'];
  const plan = buildPlan({ floors: [floorFromAscii(rows, { a: 'A' })], stairLinks: [] }).plan!;
  const fl = plan.floors[0]!;
  it('resolveWalls leaves every moving centre at least one radius from every wall cell, also at a diagonal corner', () => {
    // On the block, beside it, and diagonally beside each of its four corners.
    const pts: [number, number][] = [[1.0, 1.0], [0.7, 0.7], [1.3, 0.7], [0.7, 1.3], [1.3, 1.3], [1.0, 0.6], [0.9, 1.4]];
    const a = storeAt(pts);
    const xs = Float64Array.from(a.x);
    const ys = Float64Array.from(a.y);
    resolveWalls(plan, a, xs, ys);
    for (let i = 0; i < a.n; i++) {
      for (let cy = 0; cy < fl.heightCells; cy++) {
        for (let cx = 0; cx < fl.widthCells; cx++) {
          if (fl.cellType[cy * fl.widthCells + cx] !== CELL_WALL) continue;
          const qx = Math.min((cx + 1) * CELL_SIZE_M, Math.max(cx * CELL_SIZE_M, xs[i]!));
          const qy = Math.min((cy + 1) * CELL_SIZE_M, Math.max(cy * CELL_SIZE_M, ys[i]!));
          expect(Math.hypot(xs[i]! - qx, ys[i]! - qy), `agent ${i}`).toBeGreaterThanOrEqual(AGENT_RADIUS_M - 1e-9);
        }
      }
    }
  });
  it('a step into a wall cell, or across the corner of one, is rejected', () => {
    expect(stepKeepsOutOfWalls(fl, 0.5, 0.6, 1.0, 1.0)).toBe(false); // ends in the block
    expect(stepKeepsOutOfWalls(fl, 0.6, 1.4, 1.4, 0.6)).toBe(false); // diagonal across the block
    expect(stepKeepsOutOfWalls(fl, 0.5, 0.5, 0.5, 0.7)).toBe(true);
    expect(stepKeepsOutOfWalls(fl, 0.5, 0.5, -0.1, 0.5)).toBe(false); // off the grid
  });
  it('in a run around a block no agent ever ends a step in a wall cell', () => {
    const rows2 = ['#########', '#aaaaaaa#', '#aaaaaaa#', '#aa###aa#', '#aa###aaE', '#aa###aaE', '#aaaaaaa#', '#aaaaaaa#', '#########'];
    const p2 = buildPlan({ floors: [floorFromAscii(rows2, { a: 'A' })], stairLinks: [] }).plan!;
    const f2 = p2.floors[0]!;
    const bad: string[] = [];
    const starts = Array.from({ length: 10 }, (_, k) => agentAtCell(`q${k}`, 'staff', 'F0', 1 + (k % 2), 1 + Math.floor(k / 2)));
    const r = runCrowd(crowdInput(p2, starts, 60, { delay: SHORT_DELAY }), noFire(p2, 60), {
      onStep: (v: StepView) => {
        for (let i = 0; i < v.store.n; i++) {
          if (v.store.state[i] === STATE_OUT) continue;
          const c = v.store.cell[i]!;
          if (f2.cellType[c] === CELL_WALL) bad.push(`step ${v.step} agent ${i}`);
        }
      },
    });
    expect(bad).toEqual([]);
    expect(r.summary!.out).toBe(10);
  });
});
describe('a blocked agent (Requirement 2.12)', () => {
  it('has no way to the only exit, stays where it is and carries the Blocked flag', () => {
    const plan = samples.sealedExit().plan;
    const start = agentAtCell('stuck', 'staff', 'F0', 3, 3);
    let flagSeen = false;
    let moved = false;
    const r = runCrowd(crowdInput(plan, [start], 20, { delay: SHORT_DELAY }), noFire(plan, 20), {
      onStep: (v) => {
        if (v.timeS < 1) return; // after the pre-movement delay
        if ((v.store.flags[0]! & FLAG_BLOCKED) !== 0) flagSeen = true;
        if (v.store.x[0] !== start.xM || v.store.y[0] !== start.yM) moved = true;
      },
    });
    expect(flagSeen).toBe(true);
    expect(moved).toBe(false);
    expect(r.agents[0]!.everBlocked).toBe(true);
    expect(r.agents[0]!.finalState).toBe('still inside');
    expect(r.warnings.map((w) => w.code)).toContain('AGENT_BLOCKED');
  });
});
