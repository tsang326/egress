// Unit tests for the door flow limit and stairs (Requirements 2.8, 2.9, 2.10).
import { describe, expect, it } from 'vitest';
import { DOOR_BOUNDARY_LAYER_M, DOOR_SPECIFIC_FLOW_PER_S_M, FLOW_WINDOW_S, STAIR_MAX_DENSITY, TIME_STEP_S } from '../../src/core/people/constants';
import { advanceGate, createGate, enrol, leaveGate, recordCrossing, type GateState } from '../../src/core/people/gates/gate';
import {
  canEnterStair,
  createStairChannels,
  enterStair,
  stairDensity,
  stairWarnings,
  stepStairs,
  STATE_IN_STAIR,
  STATE_MOVING,
} from '../../src/core/people/gates/stairs';
import type { AgentStore } from '../../src/core/people/types';
import { twoFloors } from './samplePlans';

const W_EFF_1M = 1 - 2 * DOOR_BOUNDARY_LAYER_M; // a 1 m door
const doorSpec = { specificFlowPerSM: DOOR_SPECIFIC_FLOW_PER_S_M, effectiveWidthM: W_EFF_1M };

// Runs a gate with `n` agents already queued; every armed agent crosses in the step it is armed.
function drain(g: GateState, n: number, steps: number): { crossings: number[]; order: number[] } {
  for (let i = 0; i < n; i++) enrol(g, i);
  const crossings: number[] = [];
  const order: number[] = [];
  for (let s = 0; s < steps; s++) {
    advanceGate(g, s);
    if (g.armed >= 0) {
      order.push(g.armed);
      recordCrossing(g, g.armed, s);
      crossings.push(s);
    }
  }
  return { crossings, order };
}

describe('door flow limit', () => {
  it('releases a 1 m door at specific flow x effective width, about 0.91 persons/s (Pathfinder shows 0.92 for 1.316)', () => {
    const g = createGate(doorSpec, 500);
    const { crossings } = drain(g, 500, Math.round(100 / TIME_STEP_S));
    const perS = crossings.length / 100;
    expect(perS).toBeLessThanOrEqual(DOOR_SPECIFIC_FLOW_PER_S_M * W_EFF_1M + 0.02); // +1 person for the initial full bucket
    expect(perS).toBeGreaterThan(0.85);
    expect(perS).toBeCloseTo(0.92, 1);
  });
  it('lets no 10 s window hold more than floor(10 x 1.3 x W_eff) crossings', () => {
    const g = createGate(doorSpec, 500);
    const { crossings } = drain(g, 500, 4000);
    const limit = Math.floor(FLOW_WINDOW_S * DOOR_SPECIFIC_FLOW_PER_S_M * W_EFF_1M);
    expect(g.maxInWindow).toBe(limit);
    const win = g.windowSteps;
    for (let i = 0; i < crossings.length; i++) {
      let inWin = 0;
      for (let j = i; j < crossings.length && crossings[j]! < crossings[i]! + win; j++) inWin++;
      expect(inWin).toBeLessThanOrEqual(limit);
    }
  });
  it('holds the window limit even when the accumulator is rich, at the window boundary', () => {
    // A wide gate with a tiny window cap would exceed it by one with the accumulator alone; the ring must stop it.
    const g = createGate({ specificFlowPerSM: 1.3, effectiveWidthM: 3 }, 200);
    const { crossings } = drain(g, 200, 600);
    const win = g.windowSteps;
    for (let i = 0; i < crossings.length; i++) {
      let inWin = 0;
      for (let j = i; j < crossings.length && crossings[j]! < crossings[i]! + win; j++) inWin++;
      expect(inWin).toBeLessThanOrEqual(Math.floor(10 * 1.3 * 3));
    }
  });
  it('releases in first-in first-out order', () => {
    const g = createGate(doorSpec, 50);
    const { order } = drain(g, 30, 1000);
    expect(order).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });
  it('re-arms the next head in the same step when the armed agent leaves', () => {
    const g = createGate(doorSpec, 10);
    enrol(g, 7);
    enrol(g, 3);
    enrol(g, 9);
    advanceGate(g, 0);
    expect(g.armed).toBe(7);
    leaveGate(g, 7, 0);
    expect(g.armed).toBe(3);
    leaveGate(g, 9, 0); // a waiting agent leaves: the armed one stays
    expect(g.armed).toBe(3);
    leaveGate(g, 3, 0);
    expect(g.armed).toBe(-1);
  });
  it('arms nobody while credit is below 1', () => {
    const g = createGate(doorSpec, 10);
    enrol(g, 0);
    enrol(g, 1);
    advanceGate(g, 0);
    recordCrossing(g, 0, 0);
    advanceGate(g, 1);
    expect(g.armed).toBe(-1); // credit is about 0.05 after the crossing
  });
});

function store(n: number): AgentStore {
  return {
    n,
    x: new Float64Array(n),
    y: new Float64Array(n),
    floor: new Uint8Array(n),
    cell: new Int32Array(n),
    state: new Uint8Array(n).fill(STATE_MOVING),
    flags: new Uint8Array(n),
    delaySteps: new Int32Array(n),
    alertStep: new Int32Array(n).fill(-1),
    exitChoice: new Int16Array(n),
    known: new Uint8Array(n),
    fedAsph: new Float64Array(n),
    fedHeat: new Float64Array(n),
    causeMask: new Uint8Array(n),
    stairLink: new Int16Array(n).fill(-1),
    stairS: new Float64Array(n),
    stairDir: new Int8Array(n),
    gateEnrolled: new Int16Array(n).fill(-1),
    insideSteps: new Int32Array(n),
    exitStep: new Int32Array(n).fill(-1),
    incapStep: new Int32Array(n).fill(-1),
  };
}

describe('stairs', () => {
  const plan = twoFloors().plan;
  const link = plan.stairLinks[0]!;
  it('lands an arriving agent on the same cell of the next floor in the step it arrives', () => {
    const a = store(1);
    a.x[0] = 1.25;
    a.y[0] = 0.75;
    a.cell[0] = 25;
    a.floor[0] = link.lowerFloor;
    const ch = createStairChannels(plan);
    expect(enterStair(plan, ch, a, 0, 0, 1)).toBe(true);
    expect(a.state[0]).toBe(STATE_IN_STAIR);
    let steps = 0;
    while (a.state[0] === STATE_IN_STAIR && steps < 10_000) {
      stepStairs(plan, ch, a);
      steps++;
    }
    expect(a.state[0]).toBe(STATE_MOVING);
    expect(a.floor[0]).toBe(link.upperFloor);
    expect([a.x[0], a.y[0], a.cell[0]]).toEqual([1.25, 0.75, 25]);
    expect(ch.count[0]).toBe(0);
    // Free-flow time along the incline at the table speed with the density cap: L / (k (1 - 0.266 x 0.54)).
    const expected = link.inclineLengthM / (link.speedFreeMPerS * (1 - 0.266 * 0.54)) / TIME_STEP_S;
    expect(Math.abs(steps - expected)).toBeLessThanOrEqual(2);
  });
  it('moves a downward agent from the upper to the lower floor', () => {
    const a = store(1);
    a.floor[0] = link.upperFloor;
    const ch = createStairChannels(plan);
    enterStair(plan, ch, a, 0, 0, -1);
    for (let s = 0; s < 10_000 && a.state[0] === STATE_IN_STAIR; s++) stepStairs(plan, ch, a);
    expect(a.floor[0]).toBe(link.lowerFloor);
  });
  it('blocks entry at the maximum density and changes nothing', () => {
    const ch = createStairChannels(plan);
    let n = 0;
    while (canEnterStair(plan, ch, 0)) {
      ch.count[0] = ++n;
      expect(n).toBeLessThan(10_000);
    }
    expect(stairDensity(plan, 0, ch.count[0]! + 1)).toBeGreaterThanOrEqual(STAIR_MAX_DENSITY);
    const a = store(1);
    const before = ch.count[0];
    expect(enterStair(plan, ch, a, 0, 0, 1)).toBe(false);
    expect(a.state[0]).toBe(STATE_MOVING);
    expect(ch.count[0]).toBe(before);
    expect(ch.used[0]).toBe(0);
  });
  it('slows the channel as it fills and reports one STAIR_RESULT per used link', () => {
    const ch = createStairChannels(plan);
    expect(stairWarnings(plan, ch)).toEqual([]);
    const a = store(2);
    enterStair(plan, ch, a, 0, 0, 1);
    enterStair(plan, ch, a, 1, 0, 1);
    stepStairs(plan, ch, a);
    const w = stairWarnings(plan, ch);
    expect(w).toHaveLength(1);
    expect(w[0]!.code).toBe('STAIR_RESULT');
  });
});
