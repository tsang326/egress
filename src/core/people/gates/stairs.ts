// Stair channels (Design, "Stairs"; Requirements 2.7, 2.8, 6.7). One channel per Stair_Link; every agent in it shares
// one density and one speed. Entry through the link's gate is decided by the caller; this module checks the density
// limit, moves agents along the incline and transfers them to the adjacent floor.
import { STAIR_MAX_DENSITY, TIME_STEP_S } from '../constants';
import type { AgentStore, CrowdWarning, Plan } from '../types';
import { stairResult } from '../warnings';
import { stairSpeed } from '../steering/speed';

export const STATE_MOVING = 1;
export const STATE_IN_STAIR = 2;

export interface StairChannels {
  count: Int32Array; // agents inside each link's channel
  used: Uint8Array; // 1 once any agent entered the link (for STAIR_RESULT)
}
export function createStairChannels(plan: Plan): StairChannels {
  return { count: new Int32Array(plan.stairLinks.length), used: new Uint8Array(plan.stairLinks.length) };
}
// Persons per m2 with `n` agents in the channel of the link.
export function stairDensity(plan: Plan, linkIndex: number, n: number): number {
  const link = plan.stairLinks[linkIndex]!;
  return n / (link.inclineLengthM * link.widthM);
}
// Entry is allowed when the density after entry stays below STAIR_MAX_DENSITY.
export function canEnterStair(plan: Plan, ch: StairChannels, linkIndex: number): boolean {
  return stairDensity(plan, linkIndex, ch.count[linkIndex]! + 1) < STAIR_MAX_DENSITY;
}
// Puts agent `i` in the channel (dir +1 up from the lower floor, -1 down from the upper floor). Returns false and
// changes nothing when the density limit blocks it. The caller removes the agent from the spatial hash.
export function enterStair(plan: Plan, ch: StairChannels, a: AgentStore, i: number, linkIndex: number, dir: 1 | -1): boolean {
  if (!canEnterStair(plan, ch, linkIndex)) return false;
  a.state[i] = STATE_IN_STAIR;
  a.stairLink[i] = linkIndex;
  a.stairS[i] = 0;
  a.stairDir[i] = dir;
  a.gateEnrolled[i] = -1;
  ch.count[linkIndex]!++;
  ch.used[linkIndex] = 1;
  return true;
}
// Moves every agent in a channel by one step. The speed comes from the density at the start of the step. `smokeFactorOf`
// (optional) gives the walking-speed factor for agent `i`, `secondHalf` true after half of the incline.
// Arrivals are placed in the same step at the same x, y and cell on the adjacent floor, state moving. Returns the arrival count.
export function stepStairs(
  plan: Plan,
  ch: StairChannels,
  a: AgentStore,
  smokeFactorOf?: (agent: number, linkIndex: number, secondHalf: boolean) => number,
  dtS: number = TIME_STEP_S,
): number {
  const speed = new Float64Array(plan.stairLinks.length);
  for (let l = 0; l < speed.length; l++) {
    speed[l] = stairSpeed(plan.stairLinks[l]!.speedFreeMPerS, stairDensity(plan, l, ch.count[l]!));
  }
  let arrived = 0;
  for (let i = 0; i < a.n; i++) {
    if (a.state[i] !== STATE_IN_STAIR) continue;
    const l = a.stairLink[i]!;
    const link = plan.stairLinks[l]!;
    const secondHalf = a.stairS[i]! >= link.inclineLengthM / 2;
    const f = smokeFactorOf ? smokeFactorOf(i, l, secondHalf) : 1;
    a.stairS[i] = a.stairS[i]! + speed[l]! * f * dtS;
    if (a.stairS[i]! < link.inclineLengthM) continue;
    // Transfer to the same grid cell on the adjacent floor (x, y and cell are kept).
    a.floor[i] = a.stairDir[i] === 1 ? link.upperFloor : link.lowerFloor;
    a.state[i] = STATE_MOVING;
    a.stairLink[i] = -1;
    a.stairS[i] = 0;
    a.stairDir[i] = 0;
    ch.count[l]!--;
    arrived++;
  }
  return arrived;
}
// One STAIR_RESULT warning per link that was used (Requirement 6.7).
export function stairWarnings(plan: Plan, ch: StairChannels): CrowdWarning[] {
  const out: CrowdWarning[] = [];
  plan.stairLinks.forEach((l, i) => {
    if (ch.used[i] === 1) out.push(stairResult(l.id));
  });
  return out;
}
