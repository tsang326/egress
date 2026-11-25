// fast-check generators for the crowd model, written once (task 3.3). Importing this file sets numRuns to 100 and
// verbose to 1, so a failing property prints the shrunk counterexample and the seed.
import fc from 'fast-check';
import type { Result } from '../../src/core/fire/types';
import { CELL_SIZE_M } from '../../src/core/people/constants';
import { floorFromAscii } from '../../src/core/people/plan/ascii';
import { buildPlan } from '../../src/core/people/plan/builder';
import type { AgentInput, FloorInput, Plan, StairLinkInput } from '../../src/core/people/types';
import { CELL_FREE } from '../../src/core/people/types';
import { syntheticFire } from './syntheticFire';

fc.configureGlobal({ numRuns: 100, verbose: 1 });

export interface PlanParams {
  floors: number; // 1..3
  twoRooms: boolean;
  roomW: number; // interior width of a room, 6..8
  roomH: number; // interior height, 6..10
  gap: number; // door gap, 2..6 (limited to the interior height)
  gapOffset: number;
  exits: number; // 0..3
  exitOffset: number; // 0..1
  stair: boolean; // used only when floors >= 2
  pocket: boolean; // sealed pocket variant
}

// Shrinks toward: one floor, one room, one exit, no stair, no pocket, smallest rooms. `exits` is a constantFrom so
// the first listed value (1) is the shrink target; 0 gives the no-exit variant.
export const arbPlanParams: fc.Arbitrary<PlanParams> = fc.record({
  floors: fc.integer({ min: 1, max: 3 }),
  twoRooms: fc.boolean(),
  roomW: fc.integer({ min: 6, max: 8 }),
  roomH: fc.integer({ min: 6, max: 10 }),
  gap: fc.integer({ min: 2, max: 6 }),
  gapOffset: fc.integer({ min: 0, max: 4 }),
  exits: fc.constantFrom(1, 0, 2, 3),
  exitOffset: fc.integer({ min: 0, max: 1 }),
  stair: fc.boolean(),
  pocket: fc.boolean(),
});

// One floor as a character grid. Outer wall at index 0 and at the last index.
function floorRows(p: PlanParams, floorIndex: number): string[] {
  const rooms = p.twoRooms ? 2 : 1;
  const midCol = p.twoRooms ? p.roomW + 1 : -1;
  const width = 2 + rooms * p.roomW + (p.twoRooms ? 1 : 0);
  const height = p.roomH + 2;
  const g: string[][] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const wall = x === 0 || y === 0 || x === width - 1 || y === height - 1 || x === midCol;
      row.push(wall ? '#' : x < midCol || midCol < 0 ? 'a' : 'b');
    }
    g.push(row);
  }
  if (p.twoRooms) {
    const gap = Math.min(p.gap, p.roomH);
    const y0 = 1 + Math.min(p.gapOffset, p.roomH - gap);
    for (let y = y0; y < y0 + gap; y++) g[y]![midCol] = 'D';
  }
  const lastCol = width - 1;
  const exitRow = 1 + p.exitOffset;
  if (floorIndex === 0) {
    // Exits on the ground floor only: right wall, left wall, top wall of the first room.
    if (p.exits >= 1) for (let y = exitRow; y < exitRow + 2; y++) g[y]![lastCol] = 'E';
    if (p.exits >= 2) for (let y = exitRow; y < exitRow + 2; y++) g[y]![0] = 'E';
    if (p.exits >= 3) for (let x = 4; x < 6; x++) g[0]![x] = 'E';
    // Sealed pocket: a 5 x 5 wall ring with a 3 x 3 free interior in the lower right corner of the last room.
    if (p.pocket && p.roomH >= 8) {
      const x1 = lastCol - 1;
      const y1 = height - 2;
      for (let y = y1 - 4; y <= y1; y++) {
        for (let x = x1 - 4; x <= x1; x++) {
          const inside = x >= x1 - 3 && x <= x1 - 1 && y >= y1 - 3 && y <= y1 - 1;
          g[y]![x] = inside ? '.' : '#';
        }
      }
    }
  }
  // Stair block 2 x 2 in the upper left of the first room, on every floor.
  if (p.stair && p.floors >= 2) for (let y = 1; y <= 2; y++) for (let x = 1; x <= 2; x++) g[y]![x] = 'S';
  return g.map((r) => r.join(''));
}

export function planInputFromParams(p: PlanParams): { floors: FloorInput[]; stairLinks: StairLinkInput[] } {
  const floors: FloorInput[] = [];
  for (let f = 0; f < p.floors; f++) {
    floors.push(floorFromAscii(floorRows(p, f), { a: `R${f}A`, b: `R${f}B`, S: `R${f}A` }, { id: `F${f}`, elevationM: 3 * f }));
  }
  const stairLinks: StairLinkInput[] = [];
  if (p.stair) for (let f = 0; f + 1 < p.floors; f++) stairLinks.push({ id: `L${f}`, lowerFloorId: `F${f}`, upperFloorId: `F${f + 1}` });
  return { floors, stairLinks };
}

function mustBuild(p: PlanParams): Plan {
  const r = buildPlan(planInputFromParams(p));
  if (r.status !== 'valid' || !r.plan) throw new Error(`generator built an invalid plan: ${r.warnings.map((w) => w.message).join(' | ')}`);
  return r.plan;
}

// A valid Plan (the generator is built so buildPlan never returns "invalid"; if it does, that is a bug here).
export const arbPlan: fc.Arbitrary<Plan> = arbPlanParams.map(mustBuild);

// Only plans that have at least one exit group, for properties that need somewhere to go.
export const arbPlanWithExit: fc.Arbitrary<Plan> = arbPlanParams.map((p) => mustBuild({ ...p, exits: Math.max(1, p.exits) }));

// Up to 30 agents on free cells, both types, some with a missing entry exit.
export function arbAgents(plan: Plan): fc.Arbitrary<AgentInput[]> {
  const cands: { floor: number; cell: number }[] = [];
  for (const f of plan.floors) {
    for (let c = 0; c < f.cellType.length; c++) if (f.cellType[c] === CELL_FREE && f.fitsAgent[c] === 1) cands.push({ floor: f.index, cell: c });
  }
  if (cands.length === 0) return fc.constant([]);
  const exitIds = plan.exits.map((e) => e.id);
  return fc
    .array(
      fc.record({
        pick: fc.integer({ min: 0, max: cands.length - 1 }),
        visitor: fc.boolean(),
        entry: fc.integer({ min: -1, max: Math.max(0, exitIds.length - 1) }),
      }),
      { maxLength: 30 },
    )
    .map((list) =>
      list.map((a, i): AgentInput => {
        const c = cands[a.pick]!;
        const f = plan.floors[c.floor]!;
        const x = c.cell % f.widthCells;
        const y = (c.cell - x) / f.widthCells;
        const agent: AgentInput = {
          id: `a${i}`,
          type: a.visitor ? 'visitor' : 'staff',
          floorId: f.id,
          xM: (x + 0.5) * CELL_SIZE_M,
          yM: (y + 0.5) * CELL_SIZE_M,
        };
        if (a.visitor && a.entry >= 0 && exitIds.length > 0) agent.entryExitId = exitIds[a.entry]!;
        return agent;
      }),
    );
}

export interface GeneratedFire {
  fire: Result;
  durationS: number;
}

const arbDuration = fc.integer({ min: 30, max: 120 });

// A fire with constant or linearly changing layer states in every compartment of the plan, built without the solver.
export function arbFire(plan: Plan): fc.Arbitrary<GeneratedFire> {
  const layer = fc.record({
    o2: fc.double({ min: 0.15, max: 0.23, noNaN: true }),
    co2: fc.double({ min: 0, max: 0.1, noNaN: true }),
    co: fc.double({ min: 0, max: 0.01, noNaN: true }),
    opticalDensityPerM: fc.double({ min: 0, max: 2, noNaN: true }),
  });
  const state = fc.record({
    interfaceHeightM: fc.double({ min: 0.3, max: 2.4, noNaN: true }),
    upperTempK: fc.double({ min: 293.15, max: 700, noNaN: true }),
    lowerTempK: fc.double({ min: 293.15, max: 400, noNaN: true }),
    upper: layer,
    lower: layer,
  });
  const n = plan.compartmentIds.length;
  return fc
    .record({ durationS: arbDuration, comps: fc.array(fc.record({ start: state, end: state }), { minLength: n, maxLength: n }) })
    .map(({ durationS, comps }) => ({
      durationS,
      fire: syntheticFire({
        durationS,
        compartments: plan.compartmentIds.map((id, i) => ({ id, start: comps[i]!.start, end: comps[i]!.end })),
      }),
    }));
}

// A fire result with ambient conditions everywhere.
export function arbNoFire(plan: Plan): fc.Arbitrary<GeneratedFire> {
  return arbDuration.map((durationS) => ({
    durationS,
    fire: syntheticFire({ durationS, compartments: plan.compartmentIds.map((id) => ({ id })) }),
  }));
}
