// Door, exit and stair-entry flow limiter (Design, "Gates and queues"; Requirements 2.9 to 2.11).
// Integer step counters only for the window, so there is no floating point edge at its boundary.
import { FLOW_WINDOW_S, TIME_STEP_S } from '../constants';
import type { GateSpec } from '../types';

export interface GateState {
  rate: number; // persons per step = specificFlow * effectiveWidth * dt
  credit: number; // token accumulator, capped at max(1, rate)
  windowSteps: number; // FLOW_WINDOW_S / dt
  maxInWindow: number; // floor(window * specificFlow * effectiveWidth), at least 1
  ring: Int32Array; // step indices of the last maxInWindow crossings (circular, oldest at ringHead)
  ringHead: number;
  ringCount: number;
  queue: Int32Array; // FIFO of agent ids (circular)
  qHead: number;
  qCount: number;
  armed: number; // agent id allowed to cross now, -1 none
}

// `queueCapacity` is the number of agents: an agent is in a queue at most once, so the queue cannot overflow.
export function createGate(spec: Pick<GateSpec, 'specificFlowPerSM' | 'effectiveWidthM'>, queueCapacity: number, dtS: number = TIME_STEP_S): GateState {
  const flowPerS = spec.specificFlowPerSM * spec.effectiveWidthM;
  const windowSteps = Math.round(FLOW_WINDOW_S / dtS);
  const maxInWindow = Math.max(1, Math.floor(FLOW_WINDOW_S * flowPerS));
  const rate = flowPerS * dtS;
  return {
    rate,
    credit: Math.max(1, rate), // a full bucket at the start: the first agent at the head may cross at once
    windowSteps,
    maxInWindow,
    ring: new Int32Array(maxInWindow),
    ringHead: 0,
    ringCount: 0,
    queue: new Int32Array(Math.max(1, queueCapacity)),
    qHead: 0,
    qCount: 0,
    armed: -1,
  };
}

// Step 1 and 2 of the design: refill the accumulator, then arm the head of the queue if credit and window allow.
export function advanceGate(g: GateState, step: number): void {
  g.credit = Math.min(g.credit + g.rate, Math.max(1, g.rate));
  tryArm(g, step);
}
function windowHasRoom(g: GateState, step: number): boolean {
  return g.ringCount < g.maxInWindow || g.ring[g.ringHead]! <= step - g.windowSteps;
}
function tryArm(g: GateState, step: number): void {
  if (g.armed < 0 && g.qCount > 0 && g.credit >= 1 && windowHasRoom(g, step)) g.armed = g.queue[g.qHead]!;
}
// Append to the FIFO. Callers enrol in agent index order within a step, which gives the order "enrolment step, then agent index".
export function enrol(g: GateState, agent: number): void {
  if (g.qCount >= g.queue.length) return; // cannot happen when each agent enrols once; never throw
  g.queue[(g.qHead + g.qCount) % g.queue.length] = agent;
  g.qCount++;
}
export function isQueued(g: GateState, agent: number): boolean {
  for (let i = 0; i < g.qCount; i++) if (g.queue[(g.qHead + i) % g.queue.length] === agent) return true;
  return false;
}
function removeFromQueue(g: GateState, agent: number): void {
  const cap = g.queue.length;
  let w = 0;
  for (let i = 0; i < g.qCount; i++) {
    const a = g.queue[(g.qHead + i) % cap]!;
    if (a === agent) continue;
    g.queue[(g.qHead + w) % cap] = a;
    w++;
  }
  g.qCount = w;
}
// Step 3: the armed agent's centre has entered a gate cell. Records the crossing in the same step.
export function recordCrossing(g: GateState, agent: number, step: number): void {
  g.credit -= 1;
  if (g.ringCount === g.ring.length) {
    g.ring[g.ringHead] = step;
    g.ringHead = (g.ringHead + 1) % g.ring.length;
  } else {
    g.ring[(g.ringHead + g.ringCount) % g.ring.length] = step;
    g.ringCount++;
  }
  removeFromQueue(g, agent);
  if (g.armed === agent) g.armed = -1;
}
// Step 4: an agent leaves the queue without crossing (Out, incapacitated, blocked). If it was armed, the next head is armed in the same step.
export function leaveGate(g: GateState, agent: number, step: number): void {
  removeFromQueue(g, agent);
  if (g.armed === agent) {
    g.armed = -1;
    tryArm(g, step);
  }
}
export function queueLength(g: GateState): number {
  return g.qCount;
}
