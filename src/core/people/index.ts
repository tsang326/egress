// Public API of the crowd model (Design, "Public API"): buildPlan and runCrowd, plus the types.
// runCrowd never throws for object arguments; a wrong shape returns status "invalid" with a Warning that names the field.
// An argument that is not an object is a programmer error and throws TypeError.
import type { Result } from '../fire/types';
import { AMBIENT_TEMP_K, SMOKE_LAW_IRRITANT, SMOKE_LAW_NON_IRRITANT, TIME_STEP_S } from './constants';
import { createAgentStore, FLAG_STAFF, STATE_INCAPACITATED, STATE_OUT } from './agents/state';
import { drawDelays, resolveDelayParams } from './agents/delay';
import { classifyAgents, initKnowledge, type AgentStart } from './agents/knowledge';
import { createFireCoupling } from './coupling/fireCoupling';
import { validateRun } from './input/validate';
import { stairWarnings } from './gates/stairs';
import { heatMapsFromCounts } from './outputs/heatmap';
import { buildSummary } from './outputs/summary';
import { NOTICE } from './outputs/text';
import { createLoopState, runLoop, type Site } from './sim/loop';
import { buildStats } from './sim/stats';
import { cellAt } from './steering/separation';
import { causesFromMask } from './tenability/limits';
import type { AgentRecord, AgentType, CrowdInput, CrowdResult, CrowdRunOptions, CrowdWarning, Plan } from './types';
import { capWarnings, internalError } from './warnings';
export { buildPlan } from './plan/builder';
export type * from './types';
function invalidResult(warnings: CrowdWarning[], options: CrowdRunOptions): CrowdResult {
  const result: CrowdResult = {
    status: 'invalid',
    warnings: capWarnings(warnings),
    notice: NOTICE,
    summary: null,
    agents: [],
    gates: [],
    congestion: [],
  };
  if (options.recordStats) result.stats = buildStats(0, null);
  return result;
}
const toSites = (plan: Plan, sites: { floorId: string; xM: number; yM: number; material?: string }[] | undefined): Site[] => {
  const out: Site[] = [];
  for (const s of sites ?? []) {
    const floorIndex = plan.floors.findIndex((f) => f.id === s.floorId);
    if (floorIndex < 0) continue; // a site on a floor that is not in the plan cannot be near anyone
    const site: Site = { floorIndex, xM: s.xM, yM: s.yM };
    if (s.material !== undefined) site.material = s.material;
    out.push(site);
  }
  return out;
};
export function runCrowd(input: CrowdInput, fire: Result, options: CrowdRunOptions = {}): CrowdResult {
  if (typeof input !== 'object' || input === null) throw new TypeError('runCrowd: input must be an object');
  if (typeof fire !== 'object' || fire === null) throw new TypeError('runCrowd: fire must be an object');
  if (typeof options !== 'object' || options === null) throw new TypeError('runCrowd: options must be an object');
  const checked = validateRun(input as unknown as Record<string, unknown>, fire as unknown as Record<string, unknown>);
  if (!checked.ok) return invalidResult(checked.warnings, options);
  const plan = input.plan;
  const dtS = TIME_STEP_S;
  const warnings: CrowdWarning[] = [];
  // Agents that run, in input order. Excluded agents still consume their two PRNG draws (Design, Pre-movement delay).
  const classified = classifyAgents(input.agents);
  warnings.push(...classified.warnings);
  const params = resolveDelayParams(input.delay);
  warnings.push(...params.warnings);
  const draws = drawDelays(input.agents.map((a) => String(a.type)), input.seed, params, dtS);
  const nE = plan.exits.length;
  const included = classified.included;
  const a = createAgentStore(included.length, nE);
  const starts: AgentStart[] = [];
  included.forEach((idx, k) => {
    const ag = input.agents[idx]!;
    const floorIndex = plan.floors.findIndex((f) => f.id === ag.floorId);
    const fl = plan.floors[floorIndex]!;
    a.x[k] = ag.xM;
    a.y[k] = ag.yM;
    a.floor[k] = floorIndex;
    a.cell[k] = cellAt(fl, ag.xM, ag.yM);
    a.delaySteps[k] = draws.delaySteps[idx]!;
    // No alarm time: the run starts at the cue, so every delay counts from step 0 (the original crowd behaviour).
    if (typeof input.alarmTimeS !== 'number') a.alertStep[k] = 0;
    if (ag.type === 'staff') a.flags[k] = FLAG_STAFF;
    starts.push({ id: ag.id, type: ag.type as AgentType, floorIndex, xM: ag.xM, yM: ag.yM, entryExitId: ag.entryExitId });
  });
  warnings.push(...initKnowledge(plan, starts, a.known));
  const coupled = createFireCoupling(fire, plan, input.ambientTempK ?? AMBIENT_TEMP_K);
  if (!coupled.ok) return invalidResult([...warnings, ...coupled.warnings], options);
  warnings.push(...coupled.warnings);
  const st = createLoopState(plan, a, input.durationS, dtS);
  let failure: CrowdWarning | null = null;
  try {
    runLoop(st, {
      plan,
      dtS,
      durationS: input.durationS,
      coupling: coupled.coupling,
      law: input.smokeLaw === 'jin-irritant' ? SMOKE_LAW_IRRITANT : SMOKE_LAW_NON_IRRITANT,
      alarmTimeS: typeof input.alarmTimeS === 'number' ? input.alarmTimeS : null,
      signExitIds: input.guidance?.signExitIds,
      ambientTempK: input.ambientTempK ?? AMBIENT_TEMP_K,
      agentIds: included.map((idx) => input.agents[idx]!.id),
      inputIndex: included,
      fireSites: toSites(plan, input.fireSites),
      materialSites: toSites(plan, input.unmeasuredMaterialSites),
      onProgress: options.onProgress,
      onStep: options.onStep,
    });
  } catch (e) {
    failure = internalError(e instanceof Error ? e.message : String(e), st.stepsDone * dtS);
  }
  warnings.push(...st.warnings);
  if (failure === null) warnings.push(...stairWarnings(plan, st.channels));
  else warnings.push(failure);
  const records: AgentRecord[] = included.map((idx, k) => {
    const ag = input.agents[idx]!;
    const state = a.state[k]!;
    const out = state === STATE_OUT;
    const incap = state === STATE_INCAPACITATED;
    return {
      id: ag.id,
      type: ag.type as AgentType,
      finalState: out ? 'out' : incap ? 'incapacitated' : 'still inside',
      exitTimeS: out ? (a.exitStep[k]! + 1) * dtS : null,
      exitId: out ? plan.gates[st.exitGate[k]!]!.label : null,
      incapacitatedTimeS: incap ? (a.incapStep[k]! + 1) * dtS : null,
      causes: incap ? causesFromMask(a.causeMask[k]!) : [],
      preMovementDelayS: draws.delayS[idx]!,
      everBlocked: (a.flags[k]! & 4) !== 0,
      fedHistory: st.history.of(k),
      finalFloorId: plan.floors[a.floor[k]!]!.id,
      finalXM: a.x[k]!,
      finalYM: a.y[k]!,
    };
  });
  const result: CrowdResult = {
    status: failure === null ? 'ok' : 'failed',
    warnings: capWarnings(warnings),
    notice: NOTICE,
    summary: buildSummary(records),
    agents: records,
    gates: st.recorder.series(),
    congestion: heatMapsFromCounts(plan, st.heat, dtS),
  };
  if (options.recordStats) result.stats = buildStats(st.stepsDone, st.fields);
  return result;
}
