// Agent store: structure of arrays (Design, Data Models "Agent store"). Types live in ../types; this file creates the
// store and names the state codes and flag bits. No logic beyond allocation.
import type { AgentStore } from '../types';
// AgentStore.state codes.
export const STATE_PRE_MOVE = 0;
export const STATE_MOVING = 1;
export const STATE_IN_STAIR = 2;
export const STATE_OUT = 3;
export const STATE_INCAPACITATED = 4;
// AgentStore.flags bits. Bits 0 to 3 are the design's. Bit 4 marks a staff agent (the design has no type array; see
// "Decisions during implementation" in design.md).
export const FLAG_BLOCKED = 1;
export const FLAG_ALERTED = 2;
export const FLAG_EVER_BLOCKED = 4;
export const FLAG_NEAR_FIRE_WARNED = 8;
export const FLAG_STAFF = 16;
// `n` agents and `nExits` exit groups. Exit choice, gate, stair link, exit step and incapacitation step start at -1.
export function createAgentStore(n: number, nExits: number): AgentStore {
  return {
    n,
    x: new Float64Array(n),
    y: new Float64Array(n),
    floor: new Uint8Array(n),
    cell: new Int32Array(n),
    state: new Uint8Array(n).fill(STATE_PRE_MOVE),
    flags: new Uint8Array(n),
    delaySteps: new Int32Array(n),
    exitChoice: new Int16Array(n).fill(-1),
    known: new Uint8Array(n * nExits),
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
