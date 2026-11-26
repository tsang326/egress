// The time loop (Design, "Run lifecycle" and Algorithms; Requirements 2.1 to 2.12, 3.9, 4.2, 4.6, 4.7, 5.1 to 5.4, 6.1, 6.4,
// 6.5, 7.4). A fixed step of TIME_STEP_S. Only this file changes agent arrays, in the order the design gives:
// fire state and classes, alert and field recompute, delays, hash, route and queues, gates, moves, separation, walls,
// stairs, FED and final states, series and progress.
import {
  CELL_SIZE_M,
  CORRIDOR_LENGTH_LIMIT_M,
  NEAR_FIRE_M,
  PROGRESS_INTERVAL_S,
  SWITCH_MARGIN_CELLS,
  TIME_STEP_S,
} from '../constants';
import {
  FLAG_ALERTED,
  FLAG_BLOCKED,
  FLAG_EVER_BLOCKED,
  FLAG_NEAR_FIRE_WARNED,
  FLAG_STAFF,
  STATE_INCAPACITATED,
  STATE_IN_STAIR,
  STATE_MOVING,
  STATE_OUT,
  STATE_PRE_MOVE,
} from '../agents/state';
import { addGuidance, guidanceMask, isAlert } from '../agents/knowledge';
import type { SmokeLaw } from '../steering/speed';
import { levelSpeed, smokeFactor } from '../steering/speed';
import type { FireCoupling } from '../coupling/fireCoupling';
import { newReading, setAmbient, type LayerReading } from '../coupling/layers';
import { chooseExit } from '../flowfield/choose';
import { compartmentMultiplier, FieldManager } from '../flowfield/recompute';
import { advanceGate, createGate, queueLength, type GateState } from '../gates/gate';
import { createStairChannels, stepStairs, type StairChannels } from '../gates/stairs';
import { FedHistory, GateRecorder, stepsPerSample } from '../outputs/series';
import { createHeatCounts } from '../outputs/heatmap';
import { SpatialHash } from '../spatial/hash';
import {
  commitMove,
  dropFromQueue,
  proposeMove,
  routeOf,
  updateQueue,
  type MoveWorld,
  type Route,
  type StepTrace,
} from '../steering/move';
import { createSeparationScratch, resolveWalls, separateAgents } from '../steering/separation';
import { causeMask, compartmentClass, exceedsTemperatureLimit, fedLimitReached } from '../tenability/limits';
import { fedIncrement } from '../tenability/fed';
import type { AgentStore, CrowdWarning, Plan, StepView } from '../types';
import { NO_COMPARTMENT } from '../types';
import { agentBlocked, fedInputInvalid, longCorridor, nearFire, unmeasuredMaterial } from '../warnings';
export interface Site {
  floorIndex: number;
  xM: number;
  yM: number;
  material?: string;
}
export interface LoopConfig {
  plan: Plan;
  dtS: number;
  durationS: number;
  coupling: FireCoupling;
  law: SmokeLaw;
  alarmTimeS: number | null;
  signExitIds: readonly string[] | undefined;
  ambientTempK: number;
  agentIds: readonly string[]; // per agent in the store
  inputIndex: readonly number[];
  fireSites: readonly Site[];
  materialSites: readonly Site[];
  onProgress: ((e: { simTimeS: number; fraction: number }) => void) | undefined;
  onStep: ((v: StepView) => void) | undefined;
}
// Everything the loop writes. The caller creates it before the loop, so a run that fails midway still has its data so far.
export interface LoopState {
  a: AgentStore;
  stepsDone: number;
  nSteps: number;
  exitGate: Int16Array;
  history: FedHistory;
  finalSampled: Uint8Array;
  recorder: GateRecorder;
  heat: Uint32Array[];
  channels: StairChannels;
  fields: FieldManager;
  warnings: CrowdWarning[]; // in event order
}
export function createLoopState(plan: Plan, a: AgentStore, durationS: number, dtS: number = TIME_STEP_S): LoopState {
  return {
    a,
    stepsDone: 0,
    nSteps: Math.max(0, Math.ceil(durationS / dtS - 1e-9)),
    exitGate: new Int16Array(a.n).fill(-1),
    history: new FedHistory(a.n),
    finalSampled: new Uint8Array(a.n),
    recorder: new GateRecorder(plan),
    heat: createHeatCounts(plan),
    channels: createStairChannels(plan),
    fields: new FieldManager(plan, dtS),
    warnings: [],
  };
}
// Longest side, m, of the bounding box of each compartment's cells on any floor (for LONG_CORRIDOR).
function compartmentLengthsM(plan: Plan): Float64Array {
  const out = new Float64Array(plan.compartmentIds.length);
  for (const f of plan.floors) {
    const minX = new Int32Array(out.length).fill(f.widthCells);
    const maxX = new Int32Array(out.length).fill(-1);
    const minY = new Int32Array(out.length).fill(f.heightCells);
    const maxY = new Int32Array(out.length).fill(-1);
    for (let c = 0; c < f.compartment.length; c++) {
      const k = f.compartment[c]!;
      if (k === NO_COMPARTMENT) continue;
      const x = c % f.widthCells;
      const y = (c - x) / f.widthCells;
      minX[k] = Math.min(minX[k]!, x);
      maxX[k] = Math.max(maxX[k]!, x);
      minY[k] = Math.min(minY[k]!, y);
      maxY[k] = Math.max(maxY[k]!, y);
    }
    for (let k = 0; k < out.length; k++) {
      if (maxX[k]! < 0) continue;
      out[k] = Math.max(out[k]!, (maxX[k]! - minX[k]! + 1) * CELL_SIZE_M, (maxY[k]! - minY[k]! + 1) * CELL_SIZE_M);
    }
  }
  return out;
}
// Floor area, m2, of each compartment (cells of every floor), for the visibility limit class.
function compartmentAreasM2(plan: Plan): Float64Array {
  const out = new Float64Array(plan.compartmentIds.length);
  for (const f of plan.floors) {
    for (let c = 0; c < f.compartment.length; c++) {
      const k = f.compartment[c]!;
      if (k !== NO_COMPARTMENT) out[k] = out[k]! + CELL_SIZE_M * CELL_SIZE_M;
    }
  }
  return out;
}
const isActive = (s: number): boolean => s === STATE_PRE_MOVE || s === STATE_MOVING || s === STATE_IN_STAIR;
export function runLoop(st: LoopState, cfg: LoopConfig): void {
  const { plan, dtS } = cfg;
  const a = st.a;
  const n = a.n;
  const nE = plan.exits.length;
  const nC = plan.compartmentIds.length;
  const AMB = nC; // reading index for a cell with no compartment
  const readings: LayerReading[] = Array.from({ length: nC + 1 }, () => newReading());
  setAmbient(readings[AMB]!, cfg.ambientTempK);
  const cls = new Uint8Array(nC);
  const mult = new Float64Array(nC).fill(1);
  const areas = compartmentAreasM2(plan);
  const corridorLengthM = compartmentLengthsM(plan);
  const corridorWarned = new Uint8Array(nC);
  const needed = new Uint8Array(nE);
  const hash = new SpatialHash(plan, n);
  const gates: GateState[] = plan.gates.map((g) => createGate(g, n, dtS));
  const channels = st.channels;
  const fm = st.fields;
  const scratch = createSeparationScratch(n);
  const weight = new Float64Array(n);
  const reeval = new Uint8Array(n);
  const routeNext = new Int32Array(n).fill(-1);
  const movable = new Uint8Array(n);
  const costs = new Float64Array(Math.max(1, nE));
  const knownRow = new Uint8Array(Math.max(1, nE));
  const route: Route = { cost: Infinity, next: -1 };
  const crossCount = new Int32Array(plan.gates.length);
  const world: MoveWorld = {
    plan,
    a,
    fields: fm.fields,
    gates,
    channels,
    nx: new Float64Array(n),
    ny: new Float64Array(n),
    exitGate: st.exitGate,
    crossCount,
    trace: null,
    dtS,
  };
  const everyStep = stepsPerSample(dtS);
  const progressSteps = Math.round(PROGRESS_INTERVAL_S / dtS);
  const fedStamp = new Int32Array(nC + 1).fill(-1);
  const incAsph = new Float64Array(nC + 1);
  const incHeat = new Float64Array(nC + 1);
  const incInvalid: (string | null)[] = new Array<string | null>(nC + 1).fill(null);
  const fedWarned = new Set<string>();
  const materialWarned = new Uint8Array(n * Math.max(1, cfg.materialSites.length));
  const staffChoice = new Int16Array(n);
  let couplingWarningsSeen = 0;
  const compOf = (i: number, floor: number = a.floor[i]!): number => {
    const k = plan.floors[floor]!.compartment[a.cell[i]!]!;
    return k === NO_COMPARTMENT ? AMB : k;
  };
  const traceOn = cfg.onStep !== undefined;
  const staffAgent = (i: number): boolean => (a.flags[i]! & FLAG_STAFF) !== 0;
  // The head of a gate queue (armed or waiting for credit) has priority: it walks at the unimpeded speed and others give
  // way to it. Without this the head, packed into the crowd, could not reach the gate and the queue would stop (see
  // design.md, Decisions during implementation).
  const isHead = (i: number): boolean => {
    const g = a.gateEnrolled[i]!;
    if (g < 0) return false;
    const q = gates[g]!;
    return q.qCount > 0 && q.queue[q.qHead] === i;
  };
  const finalSample = (i: number, timeS: number): void => {
    if (st.finalSampled[i] === 1) return;
    st.finalSampled[i] = 1;
    st.history.push(i, timeS, a.fedAsph[i]! + a.fedHeat[i]!);
  };
  const exitIdOf = (i: number): string => {
    const k = a.exitChoice[i]!;
    if (k >= 0) return plan.exits[k]!.id;
    for (let e = 0; e < nE; e++) if (a.known[i * nE + e] === 1) return plan.exits[e]!.id;
    return plan.exits[0]?.id ?? 'none';
  };
  let nextProgressStep = progressSteps;
  let lastProgressStep = -1;
  const emitProgress = (stepEnd: number): void => {
    lastProgressStep = stepEnd;
    cfg.onProgress?.({ simTimeS: stepEnd * dtS, fraction: st.nSteps > 0 ? Math.min(1, stepEnd / st.nSteps) : 1 });
  };
  for (let s = 0; s < st.nSteps; s++) {
    const t = s * dtS;
    const trace: StepTrace | null = traceOn ? { crossings: [], enrolments: [], stairEntries: [] } : null;
    world.trace = trace;
    const transfers: { agent: number; fromFloor: number; toFloor: number; cell: number }[] = [];
    // [A] Fire state and compartment classes.
    cfg.coupling.advance(t);
    while (couplingWarningsSeen < cfg.coupling.warnings.length) st.warnings.push(cfg.coupling.warnings[couplingWarningsSeen++]!);
    for (let c = 0; c < nC; c++) {
      const r = readings[c]!;
      cfg.coupling.read(c, r);
      cls[c] = compartmentClass(r.upperActive, r.tempK, r.visibilityM, areas[c]!);
      mult[c] = compartmentMultiplier(cls[c]!, r.extinctionPerM, cfg.law);
    }
    // [B] Inside time and congestion counts: every agent without a final state at the start of the step.
    for (let i = 0; i < n; i++) {
      if (!isActive(a.state[i]!)) continue;
      a.insideSteps[i] = a.insideSteps[i]! + 1;
      const h = st.heat[a.floor[i]!]!;
      h[a.cell[i]!] = h[a.cell[i]!]! + 1;
    }
    // [C] Samples every whole second: FED history and gate series.
    if (s % everyStep === 0) {
      for (let i = 0; i < n; i++) if (isActive(a.state[i]!)) st.history.push(i, t, a.fedAsph[i]! + a.fedHeat[i]!);
      st.recorder.sample(t, crossCount, (g) => queueLength(gates[g]!));
    }
    // [D] Alert, knowledge, needed fields and the field recompute.
    reeval.fill(0);
    let guidance: Uint8Array | null = null;
    for (let i = 0; i < n; i++) {
      const si = a.state[i]!;
      if ((si !== STATE_PRE_MOVE && si !== STATE_MOVING) || (a.flags[i]! & FLAG_ALERTED) !== 0) continue;
      if (!isAlert(readings[compOf(i)]!.extinctionPerM, t, cfg.alarmTimeS)) continue;
      a.flags[i] = a.flags[i]! | FLAG_ALERTED;
      if (a.alertStep[i]! < 0) a.alertStep[i] = s;
      if (staffAgent(i) || nE === 0) continue;
      if (guidance === null) {
        for (let k = 0; k < n; k++) staffChoice[k] = staffAgent(k) ? a.exitChoice[k]! : -1;
        guidance = guidanceMask(plan, cfg.signExitIds, staffChoice);
      }
      if (addGuidance(a.known, i, nE, guidance)) reeval[i] = 1;
    }
    needed.fill(0);
    let anyMoving = false;
    for (let i = 0; i < n; i++) {
      const si = a.state[i]!;
      if (!isActive(si)) continue;
      if (si === STATE_MOVING) anyMoving = true;
      for (let e = 0; e < nE; e++) if (a.known[i * nE + e] === 1) needed[e] = 1;
    }
    const rebuilt = fm.update(s, cls, mult, needed, anyMoving);
    // [E] End of the pre-movement delay (Requirement 3.9, amended): the delay counts from the moment the agent is
    // alerted by the alarm or by smoke at eye height: pre-movement time is the time from the warning or cue to the
    // start of travel (ISO/TR 16738 and the SFPE Handbook use this definition). Without an alarm time the run starts at
    // the cue and delays count from step 0 (index.ts). With one, an agent that is never alerted stays put.
    for (let i = 0; i < n; i++) {
      if (a.state[i] === STATE_PRE_MOVE && a.alertStep[i]! >= 0 && s >= a.alertStep[i]! + a.delaySteps[i]!) {
        a.state[i] = STATE_MOVING;
        reeval[i] = 1;
      }
    }
    // [F] Spatial hash.
    hash.rebuild(a);
    // [G] Exit choice, blocked flag and queues, in agent order.
    for (let i = 0; i < n; i++) {
      movable[i] = 0;
      if (a.state[i] !== STATE_MOVING) continue;
      if (rebuilt > 0 || a.exitChoice[i]! < 0 || reeval[i] === 1) {
        for (let e = 0; e < nE; e++) {
          knownRow[e] = a.known[i * nE + e]!;
          routeOf(plan, a, i, fm.fields[e], route);
          costs[e] = route.cost;
        }
        a.exitChoice[i] = chooseExit(a.exitChoice[i]!, costs, knownRow, SWITCH_MARGIN_CELLS);
      }
      const k = a.exitChoice[i]!;
      routeOf(plan, a, i, k >= 0 ? fm.fields[k] : undefined, route);
      if (k < 0 || !Number.isFinite(route.cost)) {
        if ((a.flags[i]! & FLAG_EVER_BLOCKED) === 0) st.warnings.push(agentBlocked(cfg.agentIds[i]!, exitIdOf(i), t));
        a.flags[i] = a.flags[i]! | FLAG_BLOCKED | FLAG_EVER_BLOCKED;
        dropFromQueue(world, i, s);
        continue;
      }
      a.flags[i] = a.flags[i]! & ~FLAG_BLOCKED;
      routeNext[i] = route.next;
      movable[i] = 1;
      updateQueue(world, i, route, s);
    }
    // [H] Gates: refill the accumulators and arm the head of each queue.
    for (let g = 0; g < gates.length; g++) advanceGate(gates[g]!, s);
    // [I] Moves.
    world.nx.set(a.x);
    world.ny.set(a.y);
    for (let i = 0; i < n; i++) weight[i] = a.state[i] === STATE_MOVING && !isHead(i) ? 1 : 0;
    for (let i = 0; i < n; i++) {
      if (movable[i] !== 1 || a.state[i] !== STATE_MOVING) continue;
      const fl = plan.floors[a.floor[i]!]!;
      const free = fl.gateOfCell[a.cell[i]!]! >= 0 || isHead(i);
      const d = free ? 0 : hash.density(a, i);
      const v = levelSpeed(d) * smokeFactor(readings[compOf(i)]!.extinctionPerM, cfg.law);
      route.next = routeNext[i]!;
      route.cost = 0;
      proposeMove(world, i, route, v, s);
    }
    // [J] Separation, walls, then accept or revert each move.
    separateAgents(a, hash, world.nx, world.ny, weight, scratch);
    resolveWalls(plan, a, world.nx, world.ny);
    for (let i = 0; i < n; i++) if (movable[i] === 1 && a.state[i] === STATE_MOVING) commitMove(world, i, s);
    // [K] Stairs.
    const inStairBefore: number[] = [];
    const floorBefore: number[] = [];
    if (traceOn) {
      for (let i = 0; i < n; i++) {
        if (a.state[i] === STATE_IN_STAIR) {
          inStairBefore.push(i);
          floorBefore.push(a.floor[i]!);
        }
      }
    }
    stepStairs(
      plan,
      channels,
      a,
      (i, link, secondHalf) => {
        const l = plan.stairLinks[link]!;
        const other = a.stairDir[i] === 1 ? l.upperFloor : l.lowerFloor;
        return smokeFactor(readings[compOf(i, secondHalf ? other : a.floor[i]!)]!.extinctionPerM, cfg.law);
      },
      dtS,
    );
    if (traceOn) {
      inStairBefore.forEach((i, k) => {
        if (a.state[i] === STATE_MOVING) transfers.push({ agent: i, fromFloor: floorBefore[k]!, toFloor: a.floor[i]!, cell: a.cell[i]! });
      });
    }
    // [L] FED, incapacitation and location warnings.
    for (let i = 0; i < n; i++) {
      const si = a.state[i]!;
      if (!isActive(si)) continue;
      let ci: number;
      if (si === STATE_IN_STAIR) {
        const l = plan.stairLinks[a.stairLink[i]!]!;
        const other = a.stairDir[i] === 1 ? l.upperFloor : l.lowerFloor;
        ci = compOf(i, a.stairS[i]! >= l.inclineLengthM / 2 ? other : a.floor[i]!);
      } else ci = compOf(i);
      const r = readings[ci]!;
      if (fedStamp[ci] !== s) {
        fedStamp[ci] = s;
        const inc = fedIncrement(r.tempK, r.coPpm, r.co2Pct, r.o2Pct, dtS);
        incAsph[ci] = inc.asph;
        incHeat[ci] = inc.heat;
        incInvalid[ci] = inc.invalid;
      }
      const bad = incInvalid[ci]!;
      if (bad !== null) {
        const key = `${i}:${bad}`;
        if (!fedWarned.has(key)) {
          fedWarned.add(key);
          st.warnings.push(fedInputInvalid(cfg.agentIds[i]!, bad, t));
        }
      } else {
        a.fedAsph[i] = a.fedAsph[i]! + incAsph[ci]!;
        a.fedHeat[i] = a.fedHeat[i]! + incHeat[ci]!;
      }
      const hot = exceedsTemperatureLimit(r.upperActive, r.tempK);
      if (fedLimitReached(a.fedAsph[i]!, a.fedHeat[i]!) || hot) {
        if (si === STATE_IN_STAIR) channels.count[a.stairLink[i]!]!--;
        a.state[i] = STATE_INCAPACITATED;
        a.incapStep[i] = s;
        a.causeMask[i] = causeMask(a.fedAsph[i]!, a.fedHeat[i]!, hot);
        dropFromQueue(world, i, s);
        continue;
      }
      if (si === STATE_PRE_MOVE || si === STATE_MOVING) {
        const fl = plan.floors[a.floor[i]!]!;
        for (const site of cfg.fireSites) {
          if (site.floorIndex !== a.floor[i] || (a.flags[i]! & FLAG_NEAR_FIRE_WARNED) !== 0) continue;
          const dist = Math.hypot(a.x[i]! - site.xM, a.y[i]! - site.yM);
          if (dist <= NEAR_FIRE_M) {
            a.flags[i] = a.flags[i]! | FLAG_NEAR_FIRE_WARNED;
            st.warnings.push(nearFire(cfg.agentIds[i]!, fl.id, a.x[i]!, a.y[i]!, dist, t));
          }
        }
        cfg.materialSites.forEach((site, k) => {
          if (site.floorIndex !== a.floor[i] || materialWarned[i * cfg.materialSites.length + k] === 1) return;
          if (Math.hypot(a.x[i]! - site.xM, a.y[i]! - site.yM) > NEAR_FIRE_M) return;
          materialWarned[i * cfg.materialSites.length + k] = 1;
          st.warnings.push(unmeasuredMaterial(site.material ?? 'unknown', fl.id, site.xM, site.yM));
        });
        if (si === STATE_MOVING && ci < nC && corridorLengthM[ci]! > CORRIDOR_LENGTH_LIMIT_M && corridorWarned[ci] !== 1) {
          if (plan.compartmentKinds?.[ci] === 'corridor') {
            corridorWarned[ci] = 1;
            st.warnings.push(longCorridor(fl.id, plan.compartmentIds[ci]!, corridorLengthM[ci]!, CORRIDOR_LENGTH_LIMIT_M));
          }
        }
      }
    }
    // [M] Final samples, trace, progress and the early stop.
    let active = 0;
    for (let i = 0; i < n; i++) {
      const si = a.state[i]!;
      if (si === STATE_OUT || si === STATE_INCAPACITATED) finalSample(i, (s + 1) * dtS);
      else active++;
    }
    st.stepsDone = s + 1;
    if (cfg.onStep) {
      cfg.onStep({
        step: s,
        timeS: (s + 1) * dtS,
        store: a,
        inputIndex: cfg.inputIndex,
        fields: fm.fields,
        crossings: trace!.crossings,
        enrolments: trace!.enrolments,
        stairEntries: trace!.stairEntries,
        stairTransfers: transfers,
      });
    }
    if (s + 1 >= nextProgressStep) {
      emitProgress(s + 1);
      nextProgressStep += progressSteps;
    }
    if (active === 0) break;
  }
  // After the last step: final FED samples of agents still inside, series for the rest of the run, progress to the end.
  const endStep = st.nSteps;
  for (let i = 0; i < n; i++) finalSample(i, endStep * dtS);
  for (let k = st.recorder.sampleCount; k * everyStep <= endStep; k++) {
    st.recorder.sample(k * everyStep * dtS, crossCount, (g) => queueLength(gates[g]!));
  }
  if (endStep % everyStep !== 0) st.recorder.sample(endStep * dtS, crossCount, (g) => queueLength(gates[g]!));
  while (nextProgressStep <= endStep) {
    emitProgress(nextProgressStep);
    nextProgressStep += progressSteps;
  }
  if (lastProgressStep !== endStep) emitProgress(endStep);
}
