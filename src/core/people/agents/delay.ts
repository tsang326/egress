// Pre-movement delay (Design, "Pre-movement delay"; Requirements 3.7 to 3.11, 7.2).
// Log-normal by Box-Muller from the seeded PRNG, two draws per input agent in input order.
import { createPrng } from '../../fire/prng';
import {
  PRE_MOVEMENT_LOG_SD,
  PRE_MOVEMENT_MEDIAN_STAFF_S,
  PRE_MOVEMENT_MEDIAN_VISITOR_S,
  TIME_STEP_S,
} from '../constants';
import type { CrowdWarning, DelayParams } from '../types';
import { delayParamsRejected } from '../warnings';
export const DEFAULT_DELAY_VISITOR: DelayParams = { medianS: PRE_MOVEMENT_MEDIAN_VISITOR_S, logSd: PRE_MOVEMENT_LOG_SD };
export const DEFAULT_DELAY_STAFF: DelayParams = { medianS: PRE_MOVEMENT_MEDIAN_STAFF_S, logSd: PRE_MOVEMENT_LOG_SD };
const MAX_INT32 = 2147483647;
// Requirement 3.10: the median must be finite and above 0 and the log standard deviation finite and 0 or more.
export function delayParamsValid(p: unknown): p is DelayParams {
  if (typeof p !== 'object' || p === null) return false;
  const { medianS, logSd } = p as { medianS?: unknown; logSd?: unknown };
  return typeof medianS === 'number' && typeof logSd === 'number' && Number.isFinite(medianS) && medianS > 0 && Number.isFinite(logSd) && logSd >= 0;
}
export interface DelayInput {
  visitor?: unknown;
  staff?: unknown;
}
export interface ResolvedDelayParams {
  visitor: DelayParams;
  staff: DelayParams;
  warnings: CrowdWarning[]; // DELAY_PARAMS_REJECTED, visitor first, then staff
}
// Input parameters replace the defaults only when valid (Requirements 3.10, 3.11).
export function resolveDelayParams(input: DelayInput | undefined): ResolvedDelayParams {
  const warnings: CrowdWarning[] = [];
  const pick = (name: 'visitor' | 'staff', fallback: DelayParams): DelayParams => {
    const given = input?.[name];
    if (given === undefined) return fallback;
    if (delayParamsValid(given)) return { medianS: given.medianS, logSd: given.logSd };
    const g = (typeof given === 'object' && given !== null ? given : {}) as { medianS?: unknown; logSd?: unknown };
    warnings.push(delayParamsRejected(name, g.medianS as number, g.logSd as number));
    return fallback;
  };
  const visitor = pick('visitor', DEFAULT_DELAY_VISITOR);
  const staff = pick('staff', DEFAULT_DELAY_STAFF);
  return { visitor, staff, warnings };
}
// Box-Muller (Design): z = sqrt(-2 ln(1 - u1)) cos(2 pi u2). u1 in [0, 1), so 1 - u1 is in (0, 1].
export function standardNormal(u1: number, u2: number): number {
  return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
}
export function delayFromNormal(p: DelayParams, z: number): number {
  return p.medianS * Math.exp(p.logSd * z);
}
export interface DelayDraws {
  delayS: Float64Array; // per input agent; 0 for an agent whose type is not visitor or staff
  delaySteps: Int32Array; // ceil(delayS / dt), capped at the largest Int32 (a delay that long never ends in a run)
}
// `types[i]` is the type string of input agent i. Every input agent, excluded ones included, consumes two draws so that
// excluding an agent does not shift the delays of the agents after it (Design).
export function drawDelays(types: readonly string[], seed: number, params: ResolvedDelayParams, dtS: number = TIME_STEP_S): DelayDraws {
  const prng = createPrng(seed);
  const delayS = new Float64Array(types.length);
  const delaySteps = new Int32Array(types.length);
  for (let i = 0; i < types.length; i++) {
    const u1 = prng();
    const u2 = prng();
    const t = types[i];
    if (t !== 'visitor' && t !== 'staff') continue;
    const d = delayFromNormal(t === 'staff' ? params.staff : params.visitor, standardNormal(u1, u2));
    delayS[i] = d;
    delaySteps[i] = Math.min(MAX_INT32, Math.ceil(d / dtS));
  }
  return { delayS, delaySteps };
}
