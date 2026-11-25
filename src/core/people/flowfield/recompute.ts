// Flow_Field recompute policy for smoke costs (Design, "Recompute policy for smoke costs"; Requirements 4.6, 4.7).
// The caller gives, every step, the class and the quantised cost multiplier of every plan compartment. The manager decides
// when the fields are rebuilt and rebuilds only the fields that an active agent needs.
import { FIELD_REFRESH_INTERVAL_S, SMOKE_QUANT_STEP, TIME_STEP_S, VIS_PENALTY_FACTOR } from '../constants';
import { smokeFactor, type SmokeLaw } from '../steering/speed';
import type { ExitField, Plan } from '../types';
import { CLASS_BLOCKED, CLASS_SMOKY } from '../tenability/limits';
import { buildGraph, nodeWeights, type Graph } from './costs';
import { computeField } from './dijkstra';
// Cost multiplier of a compartment (Design table): Infinity when blocked, else the smoke factor quantised to steps of
// SMOKE_QUANT_STEP (numerical parameter), inverted, times VIS_PENALTY_FACTOR when smoky. Exactly 1 for clear air.
export function compartmentMultiplier(cls: number, extinctionPerM: number, law?: SmokeLaw): number {
  if (cls === CLASS_BLOCKED) return Infinity;
  const steps = Math.max(1, Math.round(smokeFactor(extinctionPerM, law) / SMOKE_QUANT_STEP));
  const inverse = 1 / (steps * SMOKE_QUANT_STEP);
  return cls === CLASS_SMOKY ? VIS_PENALTY_FACTOR * inverse : inverse;
}
export interface RecomputeStats {
  recomputes: number; // fields rebuilt
  nodesSettled: number; // Dijkstra nodes settled over all rebuilds
}
export class FieldManager {
  readonly fields: ExitField[];
  readonly stats: RecomputeStats = { recomputes: 0, nodesSettled: 0 };
  private readonly graph: Graph;
  private readonly plan: Plan;
  private readonly stale: Uint8Array;
  private readonly appliedClass: Uint8Array;
  private readonly appliedMult: Float64Array;
  private lastRefreshStep = -Infinity;
  private readonly refreshSteps: number;
  constructor(plan: Plan, dtS: number = TIME_STEP_S) {
    this.plan = plan;
    this.graph = buildGraph(plan);
    this.fields = plan.baseFields.slice();
    this.stale = new Uint8Array(plan.exits.length);
    this.appliedClass = new Uint8Array(plan.compartmentIds.length);
    this.appliedMult = new Float64Array(plan.compartmentIds.length).fill(1);
    this.refreshSteps = Math.round(FIELD_REFRESH_INTERVAL_S / dtS);
  }
  // Called once at the start of every step, before any agent moves. `cls` and `mult` are indexed by plan compartment;
  // `needed[e]` is 1 when an active agent knows exit e; `anyMoving` is true when at least one agent is moving.
  // Returns the number of fields rebuilt in this call.
  update(step: number, cls: ArrayLike<number>, mult: ArrayLike<number>, needed: ArrayLike<number>, anyMoving: boolean): number {
    let classChanged = false;
    let multChanged = false;
    for (let c = 0; c < this.appliedClass.length; c++) {
      if (cls[c] !== this.appliedClass[c]) classChanged = true;
      if (mult[c] !== this.appliedMult[c]) multChanged = true;
    }
    // 1. Limit event: a class changed. The new costs apply now. 2. Drift: only the multiplier changed, at most once per
    // refresh interval and only while somebody moves.
    const apply = classChanged || (multChanged && anyMoving && step - this.lastRefreshStep >= this.refreshSteps);
    if (apply) {
      for (let c = 0; c < this.appliedClass.length; c++) {
        this.appliedClass[c] = cls[c]!;
        this.appliedMult[c] = mult[c]!;
      }
      this.stale.fill(1);
      this.lastRefreshStep = step;
    }
    // A stale field is rebuilt as soon as an active agent needs it, once per step at most.
    let rebuilt = 0;
    let weights: Float64Array | null = null;
    for (let e = 0; e < this.stale.length; e++) {
      if (this.stale[e] !== 1 || needed[e] !== 1) continue;
      weights ??= nodeWeights(this.graph, this.appliedMult);
      this.fields[e] = this.rebuild(e, weights);
      this.stale[e] = 0;
      rebuilt++;
    }
    return rebuilt;
  }
  private rebuild(e: number, weights: Float64Array): ExitField {
    const spec = this.plan.exits[e]!;
    const floor = this.plan.floors[spec.floorIndex]!;
    const offset = this.plan.nodeOffset[spec.floorIndex]!;
    const seeds: number[] = [];
    for (const cell of spec.cells) if (floor.fitsAgent[cell] === 1) seeds.push(offset + cell);
    const s = { settled: 0 };
    const field = computeField(this.graph, weights, Int32Array.from(seeds), e, s);
    this.stats.recomputes++;
    this.stats.nodesSettled += s.settled;
    return field;
  }
}
