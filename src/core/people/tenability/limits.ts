// Tenability limits and compartment classes (Design, "Tenability" and "Recompute policy"; Requirements 4.6, 5.3 to 5.5).
import { FED_LIMIT, TEMP_LIMIT_K, VIS_LIMIT_AREA_M2, VIS_LIMIT_LARGE_M, VIS_LIMIT_SMALL_M } from '../constants';
import type { IncapCause } from '../types';
// Compartment class used for the Flow_Field cost (Design recompute table).
export const CLASS_CLEAR = 0;
export const CLASS_SMOKY = 1;
export const CLASS_BLOCKED = 2;
// Cause bits of AgentStore.causeMask, in the order of the output list.
export const CAUSE_ASPH = 1;
export const CAUSE_HEAT = 2;
export const CAUSE_TEMP = 4;
// Practice note Section 5.2: 10 m in spaces over 100 m2 of floor, else 5 m.
export function visibilityLimitM(floorAreaM2: number): number {
  return floorAreaM2 > VIS_LIMIT_AREA_M2 ? VIS_LIMIT_LARGE_M : VIS_LIMIT_SMALL_M;
}
// Requirement 5.4: the upper layer at eye height is hotter than the limit.
export function exceedsTemperatureLimit(upperActive: boolean, tempK: number): boolean {
  return upperActive && tempK > TEMP_LIMIT_K;
}
// Design recompute table: blocked when the active layer is the upper layer at or above the limit (Requirement 4.6),
// smoky when visibility is below the limit for the compartment, else clear.
export function compartmentClass(upperActive: boolean, tempK: number, visibilityM: number, floorAreaM2: number): number {
  if (upperActive && tempK >= TEMP_LIMIT_K) return CLASS_BLOCKED;
  if (visibilityM < visibilityLimitM(floorAreaM2)) return CLASS_SMOKY;
  return CLASS_CLEAR;
}
// Requirement 5.3: FED sum at or above 1.0.
export function fedLimitReached(fedAsph: number, fedHeat: number): boolean {
  return fedAsph + fedHeat >= FED_LIMIT;
}
// Requirement 5.5: causes of incapacitation as a bit mask. When the FED limit is reached, every positive term is a
// cause (Design). The temperature limit is a cause when it is exceeded.
export function causeMask(fedAsph: number, fedHeat: number, temperatureExceeded: boolean): number {
  let mask = 0;
  if (fedLimitReached(fedAsph, fedHeat)) {
    if (fedAsph > 0) mask |= CAUSE_ASPH;
    if (fedHeat > 0) mask |= CAUSE_HEAT;
  }
  if (temperatureExceeded) mask |= CAUSE_TEMP;
  return mask;
}
export function causesFromMask(mask: number): IncapCause[] {
  const out: IncapCause[] = [];
  if (mask & CAUSE_ASPH) out.push('asphyxiant FED');
  if (mask & CAUSE_HEAT) out.push('heat FED');
  if (mask & CAUSE_TEMP) out.push('temperature limit');
  return out;
}
