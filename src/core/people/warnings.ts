// Warning constructors for the crowd model. One constructor per CrowdWarningCode, each building a plain-language
// message. No message uses the words banned by Requirement 6.9 (see tests/people/warnings.test.ts).
import { MAX_WARNINGS_PER_CODE } from './constants';
import type { CrowdWarning, CrowdWarningCode } from './types';

type Location = CrowdWarning['location'];

function make(
  code: CrowdWarningCode,
  severity: CrowdWarning['severity'],
  message: string,
  location: Location,
  timeS: number | null = null,
  source?: string,
): CrowdWarning {
  const w: CrowdWarning = { code, severity, message, location, timeS };
  if (source !== undefined) w.source = source;
  return w;
}

const m1 = (v: number): string => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : 'unknown');
const at = (xM: number, yM: number): string => `x = ${m1(xM)} m, y = ${m1(yM)} m`;
const secs = (t: number): string => `${m1(t)} s`;

export function planLimit(limit: string, value: number, max: number): CrowdWarning {
  return make('PLAN_LIMIT', 'error', `The plan is too large: ${limit} is ${value}, and the limit is ${max}.`, { kind: 'plan', field: limit });
}
export function planCellType(floorId: string, x: number, y: number, value: string): CrowdWarning {
  return make('PLAN_CELL_TYPE', 'error', `Floor ${floorId}, cell (${x}, ${y}) has the type "${value}". Allowed types are wall, free, door, exit and stair.`, { kind: 'cell', floorId, id: `${x},${y}` });
}
export function planElevation(floorId: string, value: number): CrowdWarning {
  return make('PLAN_ELEVATION', 'error', `Floor ${floorId} has an elevation of ${String(value)} m. It must be a number from -10 m to 100 m.`, { kind: 'floor', floorId, field: 'elevationM' });
}
export function planLarge(nodeCount: number, threshold: number): CrowdWarning {
  return make('PLAN_LARGE', 'warning', `The plan has ${nodeCount} cells in total, above ${threshold}. The run may be slow. This threshold is an estimate.`, { kind: 'plan' });
}
export function stairLinkMismatch(linkId: string, lowerFloorId: string, upperFloorId: string, x: number, y: number): CrowdWarning {
  return make('STAIR_LINK_MISMATCH', 'error', `Stair link ${linkId} was rejected: floor ${lowerFloorId} and floor ${upperFloorId} do not both have a stair cell at (${x}, ${y}).`, { kind: 'stair', id: linkId, floorId: lowerFloorId });
}
export function stairGeometryRange(linkId: string, what: string, value: number, usedValue: number): CrowdWarning {
  return make('STAIR_GEOMETRY_RANGE', 'warning', `Stair link ${linkId} has a ${what} of ${m1(value)}, outside the measured table. The speed for ${m1(usedValue)} is used instead. This is an estimate.`, { kind: 'stair', id: linkId });
}
export function compartmentMissingInFire(floorId: string, x: number, y: number, compartmentId: string): CrowdWarning {
  return make('COMPARTMENT_MISSING_IN_FIRE', 'warning', `Floor ${floorId}, cell (${x}, ${y}) belongs to compartment "${compartmentId}", which is not in the fire result. Air at room temperature with no smoke is assumed there.`, { kind: 'cell', floorId, id: `${x},${y}` });
}
export function noExit(): CrowdWarning {
  return make('NO_EXIT', 'error', 'The plan has no exit cell, so nobody can leave the building. The run was not started.', { kind: 'plan' });
}
export function agentStartInvalid(agentId: string, floorId: string, xM: number, yM: number): CrowdWarning {
  return make('AGENT_START_INVALID', 'error', `Agent ${agentId} starts on a wall or outside floor ${floorId} (${at(xM, yM)}). The run was not started.`, { kind: 'agent', id: agentId, floorId, xM, yM });
}
export function unreachableRegion(floorId: string, x0: number, y0: number, x1: number, y1: number): CrowdWarning {
  return make('UNREACHABLE_REGION', 'warning', `On floor ${floorId}, the area from cell (${x0}, ${y0}) to cell (${x1}, ${y1}) has no walkable route to any exit. People there cannot get out.`, { kind: 'floor', floorId });
}
export function doorTooNarrow(floorId: string, label: string, widthM: number): CrowdWarning {
  return make('DOOR_TOO_NARROW', 'warning', `${label} on floor ${floorId} is ${m1(widthM)} m wide, too narrow for a person to pass. It is treated as closed.`, { kind: 'gate', floorId, id: label });
}
export function agentTypeRejected(agentId: string, type: string): CrowdWarning {
  return make('AGENT_TYPE_REJECTED', 'warning', `Agent ${agentId} has the type "${type}". Only visitor and staff are known, so this agent is left out of the run.`, { kind: 'agent', id: agentId });
}
export function entryExitEstimated(agentId: string, exitId: string): CrowdWarning {
  return make('ENTRY_EXIT_ESTIMATED', 'warning', `Visitor ${agentId} has no valid entry exit. The nearest exit (${exitId}) is assumed. This is an estimate.`, { kind: 'agent', id: agentId });
}
export function delayParamsRejected(agentType: string, medianS: number, logSd: number): CrowdWarning {
  return make('DELAY_PARAMS_REJECTED', 'warning', `The delay settings for ${agentType} (median ${String(medianS)} s, log standard deviation ${String(logSd)}) are not valid. The default values are used.`, { kind: 'field', field: `delay.${agentType}` });
}
export function fireStatus(status: string): CrowdWarning {
  return make('FIRE_STATUS', 'error', `The fire result has the status "${status}", not "ok". The run was not started.`, { kind: 'fire', field: 'status' });
}
export function fireResultEnded(endedAtS: number): CrowdWarning {
  return make('FIRE_RESULT_ENDED', 'warning', `The fire result ends at ${secs(endedAtS)}, before the crowd run ends. The last fire state is held for the remaining time.`, { kind: 'fire' }, endedAtS);
}
export function fedInputInvalid(agentId: string, input: string, timeS: number): CrowdWarning {
  return make('FED_INPUT_INVALID', 'warning', `Agent ${agentId}: the value of ${input} from the fire result is missing, negative or not a number at ${secs(timeS)}. The dose is left unchanged for that time.`, { kind: 'agent', id: agentId, field: input }, timeS);
}
export function agentBlocked(agentId: string, exitId: string, timeS: number): CrowdWarning {
  return make('AGENT_BLOCKED', 'warning', `Agent ${agentId} has no way forward to exit ${exitId} at ${secs(timeS)} and is held in place.`, { kind: 'agent', id: agentId }, timeS);
}
export function stairResult(linkId: string): CrowdWarning {
  return make('STAIR_RESULT', 'warning', `The result depends on stair ${linkId}. The fire model handles stairs and vertical shafts poorly, so times near it are less reliable.`, { kind: 'stair', id: linkId });
}
export function longCorridor(floorId: string, id: string, lengthM: number, limitM: number): CrowdWarning {
  return make('LONG_CORRIDOR', 'warning', `Corridor ${id} on floor ${floorId} is ${m1(lengthM)} m long, above ${m1(limitM)} m. The fire model was developed for rooms, so smoke times there are less reliable. The limit is an estimate.`, { kind: 'floor', floorId, id });
}
export function nearFire(agentId: string, floorId: string, xM: number, yM: number, distanceM: number, timeS: number): CrowdWarning {
  return make('NEAR_FIRE', 'warning', `Agent ${agentId} is ${m1(distanceM)} m from the fire at ${secs(timeS)} (floor ${floorId}, ${at(xM, yM)}). Heat from the fire is less accurate this close.`, { kind: 'agent', id: agentId, floorId, xM, yM }, timeS);
}
export function unmeasuredMaterial(material: string, floorId: string, xM: number, yM: number): CrowdWarning {
  return make('UNMEASURED_MATERIAL', 'warning', `The material "${material}" (floor ${floorId}, ${at(xM, yM)}) has no measured heat release data. Results near it are estimates.`, { kind: 'fire', floorId, xM, yM });
}
export function inputInvalid(field: string, reason: string): CrowdWarning {
  return make('INPUT_INVALID', 'error', `The input field "${field}" is not valid: ${reason}. The run was not started.`, { kind: 'field', field });
}
export function workerRequestInvalid(field: string, reason: string): CrowdWarning {
  return make('WORKER_REQUEST_INVALID', 'error', `The run request is not valid at "${field}": ${reason}. The run was not started.`, { kind: 'field', field });
}
export function internalError(detail: string, timeS: number | null): CrowdWarning {
  return make('INTERNAL_ERROR', 'error', `The run stopped because of an internal error: ${detail}. Results collected so far are kept.`, { kind: 'plan' }, timeS);
}

// Keeps at most `maxPerCode` warnings of each code, in input order, and appends one WARNINGS_TRUNCATED entry that
// names every code that lost warnings and how many. Returns the input unchanged when nothing is dropped.
export function capWarnings(warnings: readonly CrowdWarning[], maxPerCode: number = MAX_WARNINGS_PER_CODE): CrowdWarning[] {
  const seen = new Map<CrowdWarningCode, number>();
  const dropped = new Map<CrowdWarningCode, number>();
  const kept: CrowdWarning[] = [];
  for (const w of warnings) {
    const n = (seen.get(w.code) ?? 0) + 1;
    seen.set(w.code, n);
    if (n <= maxPerCode) kept.push(w);
    else dropped.set(w.code, (dropped.get(w.code) ?? 0) + 1);
  }
  if (dropped.size === 0) return kept;
  const parts = [...dropped].map(([code, count]) => `${count} more ${code}`);
  kept.push(make('WARNINGS_TRUNCATED', 'warning', `Some warnings were left out to keep the list short: ${parts.join(', ')}.`, { kind: 'plan' }));
  return kept;
}
