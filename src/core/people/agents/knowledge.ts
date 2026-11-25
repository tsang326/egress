// Agent types, known exits and Alert (Design, "Agents, knowledge and Alert"; Requirements 3.1 to 3.6, 3.9).
import { CELL_SIZE_M, K_ALERT_PER_M } from '../constants';
import type { AgentInput, CrowdWarning, Plan } from '../types';
import { agentTypeRejected, entryExitEstimated } from '../warnings';
export type KnownAgentType = 'visitor' | 'staff';
// Requirement 3.1 and 3.2: splits the input into agents that run and agents that are left out with a Warning.
// `included[k]` is the input index of the k-th agent that runs, in input order.
export function classifyAgents(agents: readonly AgentInput[]): { included: number[]; warnings: CrowdWarning[] } {
  const included: number[] = [];
  const warnings: CrowdWarning[] = [];
  agents.forEach((a, i) => {
    if (a.type === 'visitor' || a.type === 'staff') included.push(i);
    else warnings.push(agentTypeRejected(String(a.id), String(a.type)));
  });
  return { included, warnings };
}
// Straight-line distance, m, from a point on a floor to the nearest cell centre of an exit group. A different floor adds
// the elevation difference (3-D distance, Design).
function distanceToExitM(plan: Plan, exitIndex: number, floorIndex: number, xM: number, yM: number): number {
  const e = plan.exits[exitIndex]!;
  const f = plan.floors[e.floorIndex]!;
  const dz = f.elevationM - plan.floors[floorIndex]!.elevationM;
  let best = Infinity;
  for (const c of e.cells) {
    const cx = ((c % f.widthCells) + 0.5) * CELL_SIZE_M;
    const cy = (Math.floor(c / f.widthCells) + 0.5) * CELL_SIZE_M;
    const d = Math.hypot(cx - xM, cy - yM, dz);
    if (d < best) best = d;
  }
  return best;
}
// Nearest exit by straight-line distance, preferring the agent's own floor, then any floor by 3-D distance (Design).
// Ties go to the lowest exit index. -1 when the plan has no exit.
export function nearestExit(plan: Plan, floorIndex: number, xM: number, yM: number): number {
  let best = -1;
  let bestD = Infinity;
  for (const sameFloor of [true, false]) {
    for (let i = 0; i < plan.exits.length; i++) {
      if ((plan.exits[i]!.floorIndex === floorIndex) !== sameFloor) continue;
      const d = distanceToExitM(plan, i, floorIndex, xM, yM);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) return best;
  }
  return best;
}
export interface AgentStart {
  id: string;
  type: KnownAgentType;
  floorIndex: number;
  xM: number;
  yM: number;
  entryExitId?: string | undefined;
}
// Fills `known` (row i = agent i, `nExits` columns) and returns the warnings.
// Staff know every exit (3.6). A visitor knows the one exit it entered by (3.3); when that is missing or not an exit of
// the Plan, the nearest exit is used with ENTRY_EXIT_ESTIMATED (3.4).
export function initKnowledge(plan: Plan, starts: readonly AgentStart[], known: Uint8Array): CrowdWarning[] {
  const nExits = plan.exits.length;
  const warnings: CrowdWarning[] = [];
  starts.forEach((a, i) => {
    const row = i * nExits;
    if (a.type === 'staff') {
      known.fill(1, row, row + nExits);
      return;
    }
    let idx = a.entryExitId === undefined ? -1 : plan.exits.findIndex((e) => e.id === a.entryExitId);
    if (idx < 0) {
      idx = nearestExit(plan, a.floorIndex, a.xM, a.yM);
      if (idx >= 0) warnings.push(entryExitEstimated(a.id, plan.exits[idx]!.id));
    }
    if (idx >= 0) known[row + idx] = 1;
  });
  return warnings;
}
// Requirement Glossary "Alert": smoke at eye height above K_ALERT_PER_M, or the alarm time reached.
export function isAlert(extinctionPerM: number, timeS: number, alarmTimeS: number | null | undefined): boolean {
  if (extinctionPerM > K_ALERT_PER_M) return true;
  return typeof alarmTimeS === 'number' && Number.isFinite(alarmTimeS) && timeS >= alarmTimeS;
}
// Exit indices named by `guidance.signExitIds`, as a 0/1 mask over the exits. Unknown ids are ignored.
export function signExitMask(plan: Plan, signExitIds: readonly string[] | undefined): Uint8Array {
  const mask = new Uint8Array(plan.exits.length);
  if (signExitIds) plan.exits.forEach((e, i) => { if (signExitIds.includes(e.id)) mask[i] = 1; });
  return mask;
}
// Requirement 3.5: adds the guidance exits to the exits the agent knows. Nothing is removed. Returns true when a new exit
// was added.
export function addGuidance(known: Uint8Array, agent: number, nExits: number, guidance: Uint8Array): boolean {
  let added = false;
  const row = agent * nExits;
  for (let e = 0; e < nExits; e++) {
    if (guidance[e] === 1 && known[row + e] === 0) {
      known[row + e] = 1;
      added = true;
    }
  }
  return added;
}
// Guidance mask = sign exits plus the exits that staff agents have chosen (`staffChoices`: exit index per staff agent,
// -1 for none).
export function guidanceMask(plan: Plan, signExitIds: readonly string[] | undefined, staffChoices: ArrayLike<number>): Uint8Array {
  const mask = signExitMask(plan, signExitIds);
  for (let i = 0; i < staffChoices.length; i++) {
    const c = staffChoices[i]!;
    if (c >= 0 && c < mask.length) mask[c] = 1;
  }
  return mask;
}
