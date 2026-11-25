// Input checks of runCrowd (Design, "Error handling"; Requirements 1.6, 1.7, 4.1, 7.5). Nothing here throws for an object
// argument. Shape errors are collected first; the fire status, the missing exit and the agent starts are only checked when
// the shape is good, because they need the fields that the shape check proves.
import { CELL_SIZE_M, MAX_AGENTS } from '../constants';
import { cellAt } from '../steering/separation';
import type { CrowdWarning, PlanFloor } from '../types';
import { CELL_WALL } from '../types';
import { agentStartInvalid, fireStatus, inputInvalid, noExit } from '../warnings';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
// Shape of the Plan that runCrowd relies on. A Plan from buildPlan passes.
function planShapeProblem(plan: unknown): string | null {
  if (!isObj(plan)) return 'expected a Plan object';
  if (!Array.isArray(plan.floors) || plan.floors.length === 0) return 'expected a list of floors';
  for (const f of plan.floors as unknown[]) {
    if (!isObj(f) || typeof f.id !== 'string' || !(f.cellType instanceof Uint8Array) || !(f.compartment instanceof Uint16Array)) return 'a floor is not built';
    if (!(f.gateOfCell instanceof Int16Array) || !(f.fitsAgent instanceof Uint8Array)) return 'a floor is not built';
    if (!isFiniteNum(f.widthCells) || !isFiniteNum(f.heightCells)) return 'a floor has no size';
  }
  if (!Array.isArray(plan.compartmentIds) || !Array.isArray(plan.gates) || !Array.isArray(plan.exits)) return 'expected compartments, gates and exits';
  if (!Array.isArray(plan.stairLinks) || !Array.isArray(plan.baseFields)) return 'expected stair links and base fields';
  if (!(plan.nodeOffset instanceof Int32Array) || !isFiniteNum(plan.nodeCount)) return 'expected node offsets';
  if (plan.baseFields.length !== plan.exits.length) return 'expected one base field per exit';
  return null;
}
function agentShapeProblem(a: unknown): string | null {
  if (!isObj(a)) return 'expected an object';
  if (typeof a.id !== 'string') return 'id must be a string';
  if (typeof a.floorId !== 'string') return 'floorId must be a string';
  if (typeof a.xM !== 'number') return 'xM must be a number';
  if (typeof a.yM !== 'number') return 'yM must be a number';
  if (a.entryExitId !== undefined && typeof a.entryExitId !== 'string') return 'entryExitId must be a string';
  return null;
}
// Returns every problem found. `ok` is true when there is none.
export function validateRun(input: Record<string, unknown>, fire: Record<string, unknown>): { ok: boolean; warnings: CrowdWarning[] } {
  const w: CrowdWarning[] = [];
  const bad = (field: string, reason: string): void => {
    w.push(inputInvalid(field, reason));
  };
  if (input.schemaVersion !== 1) bad('schemaVersion', 'expected the number 1');
  if (!isFiniteNum(input.durationS) || input.durationS <= 0) bad('durationS', 'expected a finite number above 0');
  if (!isFiniteNum(input.seed)) bad('seed', 'expected a finite number');
  const planProblem = planShapeProblem(input.plan);
  if (planProblem !== null) bad('plan', planProblem);
  if (!Array.isArray(input.agents)) bad('agents', 'expected a list');
  else if (input.agents.length > MAX_AGENTS) bad('agents', `at most ${MAX_AGENTS} agents are accepted, got ${input.agents.length}`);
  else {
    (input.agents as unknown[]).forEach((a, i) => {
      const p = agentShapeProblem(a);
      if (p !== null) bad(`agents[${i}]`, p);
    });
  }
  const alarm = input.alarmTimeS;
  if (alarm !== undefined && alarm !== null && typeof alarm !== 'number') bad('alarmTimeS', 'expected a number or null');
  const amb = input.ambientTempK;
  if (amb !== undefined && !(isFiniteNum(amb) && amb > 0)) bad('ambientTempK', 'expected a finite number above 0');
  if (input.smokeLaw !== undefined && input.smokeLaw !== 'jin-non-irritant' && input.smokeLaw !== 'jin-irritant') bad('smokeLaw', 'expected "jin-non-irritant" or "jin-irritant"');
  for (const key of ['fireSites', 'unmeasuredMaterialSites'] as const) {
    const v = input[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) bad(key, 'expected a list');
    else if ((v as unknown[]).some((s) => !isObj(s) || typeof s.floorId !== 'string' || !isFiniteNum(s.xM) || !isFiniteNum(s.yM))) bad(key, 'each entry needs floorId, xM and yM');
  }
  if (input.guidance !== undefined && !isObj(input.guidance)) bad('guidance', 'expected an object');
  if (input.delay !== undefined && !isObj(input.delay)) bad('delay', 'expected an object');
  if (w.length > 0) return { ok: false, warnings: w };
  // Requirement 4.1: a fire result that is not "ok", or has no samples, is rejected before any step.
  const times = fire.timesS as { length?: unknown } | undefined;
  if (fire.status !== 'ok') w.push(fireStatus(String(fire.status)));
  else if (!Array.isArray(fire.compartments)) bad('fire', 'expected a fire result with a list of compartments');
  else if (!times || typeof times.length !== 'number' || times.length === 0) w.push(fireStatus('no samples'));
  const plan = input.plan as { exits: unknown[]; floors: PlanFloor[] };
  // Requirement 1.6.
  if (plan.exits.length === 0) w.push(noExit());
  // Requirement 1.7: an agent that runs starts on a cell that is not a wall, inside its floor.
  for (const a of input.agents as { id: string; type: unknown; floorId: string; xM: number; yM: number }[]) {
    if (a.type !== 'visitor' && a.type !== 'staff') continue; // left out of the run with AGENT_TYPE_REJECTED
    const f = plan.floors.find((fl) => fl.id === a.floorId);
    const inside =
      f !== undefined &&
      Number.isFinite(a.xM) &&
      Number.isFinite(a.yM) &&
      a.xM >= 0 &&
      a.yM >= 0 &&
      a.xM < f.widthCells * CELL_SIZE_M &&
      a.yM < f.heightCells * CELL_SIZE_M;
    if (!inside || f.cellType[cellAt(f, a.xM, a.yM)] === CELL_WALL) w.push(agentStartInvalid(a.id, a.floorId, a.xM, a.yM));
  }
  return { ok: w.length === 0, warnings: w };
}
