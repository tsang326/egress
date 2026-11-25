// Helpers for tests that run the whole crowd model (Design, Testing Strategy). Invented buildings only.
import type { Result } from '../../src/core/fire/types';
import { CELL_SIZE_M } from '../../src/core/people/constants';
import type { AgentInput, CrowdInput, DelayParams, Plan } from '../../src/core/people/types';
import { syntheticFire } from './syntheticFire';
// An agent at the centre of cell (cx, cy) of a floor.
export function agentAtCell(id: string, type: string, floorId: string, cx: number, cy: number, entryExitId?: string): AgentInput {
  const a: AgentInput = { id, type, floorId, xM: (cx + 0.5) * CELL_SIZE_M, yM: (cy + 0.5) * CELL_SIZE_M };
  if (entryExitId !== undefined) a.entryExitId = entryExitId;
  return a;
}
// Everybody starts after the same short delay, so a queue forms at once. Median must be above 0.
export const SHORT_DELAY: { visitor: DelayParams; staff: DelayParams } = {
  visitor: { medianS: 0.1, logSd: 0 },
  staff: { medianS: 0.1, logSd: 0 },
};
export function crowdInput(plan: Plan, agents: AgentInput[], durationS: number, extra: Partial<CrowdInput> = {}): CrowdInput {
  return { schemaVersion: 1, durationS, seed: 1, plan, agents, ...extra };
}
// A fire result with ambient conditions in every compartment of the plan.
export function noFire(plan: Plan, durationS: number): Result {
  return syntheticFire({ durationS, compartments: plan.compartmentIds.map((id) => ({ id })) });
}
