// Moving agents (Design, "Steering and collision" steps 1 to 4 and "Gates and queues"; Requirements 2.2, 2.9 to 2.12).
// proposeMove computes where an agent would be at the end of the step. commitMove runs after separation and wall
// resolution, checks the result and records gate crossings and exits. Only the loop in sim/loop.ts calls them.
import { CELL_SIZE_M, GATE_ENROL_RADIUS_M, TIME_STEP_S } from '../constants';
import { STATE_MOVING, STATE_OUT } from '../agents/state';
import { enrol, leaveGate, recordCrossing, type GateState } from '../gates/gate';
import { canEnterStair, enterStair, type StairChannels } from '../gates/stairs';
import type { AgentStore, ExitField, Plan } from '../types';
import { CELL_EXIT } from '../types';
import { cellAt, stepKeepsOutOfWalls } from './separation';
export interface StairEntryEvent {
  agent: number;
  linkIndex: number;
  fromFloor: number;
  toFloor: number;
  cell: number;
  costFrom: number;
  costTo: number;
}
// Events of one step, filled only when a trace is wanted (tests).
export interface StepTrace {
  crossings: { gateId: number; agent: number }[];
  enrolments: { gateId: number; agent: number }[];
  stairEntries: StairEntryEvent[];
}
export interface MoveWorld {
  plan: Plan;
  a: AgentStore;
  fields: ExitField[];
  gates: GateState[];
  channels: StairChannels;
  nx: Float64Array; // positions at the end of the step (read and written by separation and wall resolution)
  ny: Float64Array;
  exitGate: Int16Array; // gate id an agent left by, -1 otherwise
  crossCount: Int32Array; // crossings of each gate since the last series sample
  trace: StepTrace | null;
  dtS: number;
}
// Numerical parameters: how many cells ahead (along the route) an agent looks for a gate to join its queue, and how
// many it keeps its place while it is farther away (twice the join distance, so a small push does not lose a place).
const ENROL_HOPS = Math.ceil(GATE_ENROL_RADIUS_M / CELL_SIZE_M);
const KEEP_HOPS = 2 * ENROL_HOPS;
export function nodeFloorOf(plan: Plan, node: number): number {
  for (let f = plan.floors.length - 1; f > 0; f--) if (node >= plan.nodeOffset[f]!) return f;
  return 0;
}
const DX8 = [1, -1, 0, 0, 1, 1, -1, -1];
const DY8 = [0, 0, 1, -1, 1, -1, 1, -1];
export interface Route {
  cost: number; // cost to go of the agent's cell; Infinity when there is no way forward
  next: number; // node to walk to, -1 when there is none
}
// Cost and next node of the chosen exit at the agent's cell. An agent whose cell is not a node of the field (a cell where
// no body fits, or a cell removed by smoke cost) is sent to the neighbouring node with the lowest finite cost, if any.
export function routeOf(plan: Plan, a: AgentStore, i: number, field: ExitField | undefined, out: Route): void {
  out.cost = Infinity;
  out.next = -1;
  if (!field) return;
  const f = a.floor[i]!;
  const fl = plan.floors[f]!;
  const off = plan.nodeOffset[f]!;
  const cell = a.cell[i]!;
  const c = field.cost[off + cell]!;
  if (Number.isFinite(c)) {
    out.cost = c;
    out.next = field.next[off + cell]!;
    return;
  }
  const x = cell % fl.widthCells;
  const y = (cell - x) / fl.widthCells;
  let best = Infinity;
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d]!;
    const ny = y + DY8[d]!;
    if (nx < 0 || ny < 0 || nx >= fl.widthCells || ny >= fl.heightCells) continue;
    const nc = field.cost[off + ny * fl.widthCells + nx]!;
    if (nc < best) {
      best = nc;
      out.next = off + ny * fl.widthCells + nx;
    }
  }
  if (Number.isFinite(best)) out.cost = best + 1;
  else out.next = -1;
}
function findLink(plan: Plan, fromFloor: number, toFloor: number, cell: number): number {
  for (let l = 0; l < plan.stairLinks.length; l++) {
    const k = plan.stairLinks[l]!;
    const ok = (k.lowerFloor === fromFloor && k.upperFloor === toFloor) || (k.upperFloor === fromFloor && k.lowerFloor === toFloor);
    if (ok && k.footprint.includes(cell)) return l;
  }
  return -1;
}
export const gateOfLink = (plan: Plan, link: number, fromFloor: number): number =>
  fromFloor === plan.stairLinks[link]!.lowerFloor ? plan.stairLinks[link]!.gateUp : plan.stairLinks[link]!.gateDown;
const found = { hops: 0 };
// The first gate on the route ahead of the agent within `maxHops` cells: a door or exit cell other than the one the
// agent stands in, or the stair gate when the route leaves the floor. -1 when there is none. `found.hops` gets the distance.
function headingGate(w: Readonly<MoveWorld>, i: number, field: ExitField, firstNext: number, maxHops: number): number {
  const { plan, a } = w;
  const f = a.floor[i]!;
  const fl = plan.floors[f]!;
  const off = plan.nodeOffset[f]!;
  const own = fl.gateOfCell[a.cell[i]!]!;
  let nxt = firstNext;
  for (let h = 1; h <= maxHops && nxt >= 0; h++) {
    const nf = nodeFloorOf(plan, nxt);
    if (nf !== f) {
      const link = findLink(plan, f, nf, a.cell[i]!);
      found.hops = h;
      return link < 0 ? -1 : gateOfLink(plan, link, f);
    }
    const g = fl.gateOfCell[nxt - off]!;
    if (g >= 0 && g !== own) {
      found.hops = h;
      return g;
    }
    nxt = field.next[nxt]!;
  }
  return -1;
}
// Joins or leaves gate queues for a moving agent that has a route (Design: enrolled when within GATE_ENROL_RADIUS_M of the
// gate cells; the queue order is the enrolment step, then agent index, because the loop calls this in agent order).
export function updateQueue(w: MoveWorld, i: number, route: Route, step: number): void {
  const { plan, a } = w;
  const fl = plan.floors[a.floor[i]!]!;
  const enrolled = a.gateEnrolled[i]!;
  let want = -1;
  if (fl.cellType[a.cell[i]!] === CELL_EXIT) {
    want = fl.gateOfCell[a.cell[i]!]!; // standing in an exit cell: it still has to pass the exit gate
  } else if (route.next >= 0) {
    const field = w.fields[a.exitChoice[i]!]!;
    const g = headingGate(w, i, field, route.next, KEEP_HOPS);
    if (g >= 0 && (g === enrolled || found.hops <= ENROL_HOPS)) want = g;
  }
  if (enrolled >= 0 && enrolled !== want) {
    leaveGate(w.gates[enrolled]!, i, step);
    a.gateEnrolled[i] = -1;
  }
  if (want >= 0 && a.gateEnrolled[i] !== want) {
    enrol(w.gates[want]!, i);
    a.gateEnrolled[i] = want;
    w.trace?.enrolments.push({ gateId: want, agent: i });
  }
}
// Removes an agent from the queue it is in (it is Out, incapacitated or has no way forward).
export function dropFromQueue(w: MoveWorld, i: number, step: number): void {
  const g = w.a.gateEnrolled[i]!;
  if (g < 0) return;
  leaveGate(w.gates[g]!, i, step);
  w.a.gateEnrolled[i] = -1;
}
// Sets nx, ny for a moving agent: a walk of v * dt along the route, over at most two cells, that stops at a gate cell
// the agent is not armed for. An agent whose route leaves the floor enters the stair channel when it is armed (the
// stair entry is the only thing that happens at once and not in commitMove).
export function proposeMove(w: MoveWorld, i: number, route: Route, speedMPerS: number, step: number): void {
  const { plan, a } = w;
  const f = a.floor[i]!;
  const fl = plan.floors[f]!;
  const off = plan.nodeOffset[f]!;
  let x = a.x[i]!;
  let y = a.y[i]!;
  w.nx[i] = x;
  w.ny[i] = y;
  let next = route.next;
  if (next < 0) return;
  const field = w.fields[a.exitChoice[i]!]!;
  const nf = nodeFloorOf(plan, next);
  if (nf !== f) {
    const link = findLink(plan, f, nf, a.cell[i]!);
    if (link < 0) return;
    const g = gateOfLink(plan, link, f);
    if (w.gates[g]!.armed !== i || !canEnterStair(plan, w.channels, link)) return;
    const costFrom = field.cost[off + a.cell[i]!]!;
    const costTo = field.cost[next]!;
    recordCrossing(w.gates[g]!, i, step);
    w.crossCount[g] = w.crossCount[g]! + 1;
    if (!enterStair(plan, w.channels, a, i, link, nf > f ? 1 : -1)) return; // cannot happen: canEnterStair held
    w.trace?.crossings.push({ gateId: g, agent: i });
    w.trace?.stairEntries.push({ agent: i, linkIndex: link, fromFloor: f, toFloor: nf, cell: a.cell[i]!, costFrom, costTo });
    return;
  }
  let remaining = speedMPerS * w.dtS;
  for (let hop = 0; hop < 2 && next >= 0 && remaining > 1e-12; hop++) {
    if (nodeFloorOf(plan, next) !== f) break;
    const tcell = next - off;
    const tx = ((tcell % fl.widthCells) + 0.5) * CELL_SIZE_M;
    const ty = (Math.floor(tcell / fl.widthCells) + 0.5) * CELL_SIZE_M;
    const dist = Math.hypot(tx - x, ty - y);
    const len = Math.min(dist, remaining);
    const px = dist > 0 ? x + ((tx - x) / dist) * len : x;
    const py = dist > 0 ? y + ((ty - y) / dist) * len : y;
    const g = fl.gateOfCell[cellAt(fl, px, py)]!;
    if (g >= 0 && g !== fl.gateOfCell[cellAt(fl, x, y)] && w.gates[g]!.armed !== i) break; // wait for the gate
    x = px;
    y = py;
    remaining -= len;
    if (len < dist) break;
    next = field.next[next]!;
  }
  w.nx[i] = x;
  w.ny[i] = y;
}
// After separation and wall resolution: accepts the new position or returns the agent to where it was, then records a
// crossing when the agent stands in a gate cell it is armed for, and marks it Out in an exit cell (Requirement 2.11).
export function commitMove(w: MoveWorld, i: number, step: number): void {
  const { plan, a } = w;
  const f = a.floor[i]!;
  const fl = plan.floors[f]!;
  const x0 = a.x[i]!;
  const y0 = a.y[i]!;
  let x1 = w.nx[i]!;
  let y1 = w.ny[i]!;
  let ok = stepKeepsOutOfWalls(fl, x0, y0, x1, y1);
  if (ok) {
    const g = fl.gateOfCell[cellAt(fl, x1, y1)]!;
    if (g >= 0 && g !== fl.gateOfCell[a.cell[i]!] && w.gates[g]!.armed !== i) ok = false; // pushed into a gate it may not use
  }
  if (!ok) {
    x1 = x0;
    y1 = y0;
  }
  a.x[i] = x1;
  a.y[i] = y1;
  a.cell[i] = cellAt(fl, x1, y1);
  const g = fl.gateOfCell[a.cell[i]!]!;
  if (g < 0 || w.gates[g]!.armed !== i) return;
  recordCrossing(w.gates[g]!, i, step);
  w.crossCount[g] = w.crossCount[g]! + 1;
  a.gateEnrolled[i] = -1;
  w.trace?.crossings.push({ gateId: g, agent: i });
  if (fl.cellType[a.cell[i]!] === CELL_EXIT) {
    a.state[i] = STATE_OUT;
    a.exitStep[i] = step;
    w.exitGate[i] = g;
  }
}
export const isMoving = (a: AgentStore, i: number): boolean => a.state[i] === STATE_MOVING;
export const DEFAULT_DT_S = TIME_STEP_S;
