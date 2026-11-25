// Shared performance fixture (task 19.1; Requirements 8.1, 8.5). Invented building, not a real one.
// 6 floors of 96 x 64 cells (24 m x 16 m), 5 compartments per floor (rooms a to d and corridor e, named like the fire
// benchmark's c<floor>_<k>), one stair shaft in the corridor, 3 exits on the ground floor, 50 agents per floor.
// The fire Scenario is the one of the fire-zone benchmark (tests/fire/bench/fire.bench.test.ts), with the duration as a
// parameter; both describe the same 30 compartments.
import { floorFromAscii } from '../../../src/core/people/plan/ascii';
import { buildPlan } from '../../../src/core/people/plan/builder';
import { CELL_SIZE_M } from '../../../src/core/people/constants';
import type { AgentInput, CrowdInput, FloorInput, Plan, PlanResult, StairLinkInput } from '../../../src/core/people/types';
import type { Scenario } from '../../../src/core/fire/types';
import { buildBenchScenario } from '../../fire/bench/fire.bench.test';
export const BENCH_FLOORS = 6;
export const BENCH_WIDTH_CELLS = 96;
export const BENCH_HEIGHT_CELLS = 64;
export const BENCH_FLOOR_HEIGHT_M = 3; // same as the fire benchmark
export const BENCH_AGENTS_PER_FLOOR = 50;
export const BENCH_FULL_DURATION_S = 600;
// Design, Performance plan, fire run risk, lever 1: crowd runs use a 2 s fire print interval. The crowd interpolates
// linearly between samples, so smoke arrival moves by under 1 s. No fire physics changes.
export const BENCH_FIRE_PRINT_INTERVAL_S = 2;
// Rows of one floor. '#' wall, a to d rooms, e corridor with the stair S in its left end, D doors, E exits (ground only).
// The wall at x = 47 divides the rooms only (y < 28 and y > 35); the corridor (rows 29 to 34) runs the full width.
function floorRows(floor: number): string[] {
  const rows: string[][] = [];
  for (let y = 0; y < BENCH_HEIGHT_CELLS; y++) {
    const row: string[] = [];
    for (let x = 0; x < BENCH_WIDTH_CELLS; x++) {
      const border = x === 0 || y === 0 || x === BENCH_WIDTH_CELLS - 1 || y === BENCH_HEIGHT_CELLS - 1;
      const inCorridorRows = y > 28 && y < 35;
      let ch: string;
      if (border || y === 28 || y === 35 || (x === 47 && !inCorridorRows)) ch = '#';
      else if (y < 28) ch = x < 47 ? 'a' : 'b';
      else if (y > 35) ch = x < 47 ? 'c' : 'd';
      else ch = 'e';
      if (ch === 'e' && x >= 1 && x <= 6) ch = 'S';
      row.push(ch);
    }
    rows.push(row);
  }
  for (const x of [20, 21, 22, 23]) {
    rows[28]![x] = 'D';
    rows[35]![x] = 'D';
  }
  for (const x of [70, 71, 72, 73]) {
    rows[28]![x] = 'D';
    rows[35]![x] = 'D';
  }
  if (floor === 0) {
    for (let y = 29; y <= 34; y++) rows[y]![BENCH_WIDTH_CELLS - 1] = 'E';
    for (const x of [10, 11, 12, 13]) rows[0]![x] = 'E';
    for (const x of [80, 81, 82, 83]) rows[BENCH_HEIGHT_CELLS - 1]![x] = 'E';
  }
  return rows.map((r) => r.join(''));
}
const floorId = (f: number): string => `F${f}`;
function floorInput(f: number): FloorInput {
  const legend: Record<string, string> = { a: `c${f}_0`, b: `c${f}_1`, c: `c${f}_2`, d: `c${f}_3`, e: `c${f}_4`, S: `c${f}_4` };
  return floorFromAscii(floorRows(f), legend, { id: floorId(f), elevationM: f * BENCH_FLOOR_HEIGHT_M });
}
// The builder's own result, with its Warnings (the guard test reads them).
export function buildBenchPlanResult(): PlanResult {
  const stairLinks: StairLinkInput[] = [];
  for (let f = 0; f + 1 < BENCH_FLOORS; f++) stairLinks.push({ id: `stair${f}`, lowerFloorId: floorId(f), upperFloorId: floorId(f + 1) });
  const floors = Array.from({ length: BENCH_FLOORS }, (_, f) => floorInput(f));
  return buildPlan({ floors, stairLinks });
}
export function buildBenchPlan(): Plan {
  const r = buildBenchPlanResult();
  if (r.status !== 'valid' || !r.plan) throw new Error(`bench plan is invalid: ${r.warnings.map((w) => w.message).join(' | ')}`);
  return r.plan;
}
// 12 agents in each of the four rooms (a 4 x 3 lattice, one staff per room) and 2 in the corridor: 50 per floor.
function floorAgents(f: number): AgentInput[] {
  const out: AgentInput[] = [];
  const at = (id: string, type: string, cx: number, cy: number): void => {
    out.push({ id, type, floorId: floorId(f), xM: (cx + 0.5) * CELL_SIZE_M, yM: (cy + 0.5) * CELL_SIZE_M });
  };
  const rooms: [number, number][] = [[8, 6], [52, 6], [8, 40], [52, 40]];
  rooms.forEach(([x0, y0], r) => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) at(`f${f}r${r}_${i}${j}`, i === 0 && j === 0 ? 'staff' : 'visitor', x0 + 10 * i, y0 + 8 * j);
  });
  at(`f${f}e0`, 'visitor', 30, 31);
  at(`f${f}e1`, 'visitor', 60, 32);
  return out;
}
export function buildBenchAgents(): AgentInput[] {
  return Array.from({ length: BENCH_FLOORS }, (_, f) => floorAgents(f)).flat();
}
export function buildBenchCrowdInput(plan: Plan, durationS: number): CrowdInput {
  const fireSites = [{ floorId: floorId(0), xM: 5, yM: 3 }];
  return { schemaVersion: 1, durationS, seed: 1, plan, agents: buildBenchAgents(), fireSites };
}
// The fire-zone benchmark Scenario, run for durationS with the print interval of BENCH_FIRE_PRINT_INTERVAL_S.
export function buildBenchFireScenario(durationS: number): Scenario {
  const s = buildBenchScenario();
  return { ...s, durationS, printIntervalS: BENCH_FIRE_PRINT_INTERVAL_S };
}
