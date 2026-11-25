// Walking speed relations (Design, "Speed"; Requirements 2.5 to 2.7, 4.5). Pure functions of density and smoke.
import {
  D_FREE_CAP,
  D_ZERO_SPEED,
  K_LEVEL_M_PER_S,
  SMOKE_DARKNESS_SPEED_M_PER_S,
  SMOKE_LAW_NON_IRRITANT,
  SPEED_DENSITY_SLOPE,
} from '../constants';
import { stairTableK } from '../plan/builder';

export type SmokeLaw = { readonly a: number; readonly b: number };

// SFPE: S = k (1 - a D) with D held at D_FREE_CAP when below it, and 0 at and above 1 / a.
// NaN or a negative D is read as 0 (the free speed); +Infinity gives speed 0. The result is always finite.
export function speedAtDensity(kMPerS: number, densityPerM2: number): number {
  const d = densityPerM2 > 0 ? densityPerM2 : 0; // false for NaN and negatives
  if (d >= D_ZERO_SPEED) return 0;
  return kMPerS * (1 - SPEED_DENSITY_SLOPE * Math.max(d, D_FREE_CAP));
}
export function levelSpeed(densityPerM2: number): number {
  return speedAtDensity(K_LEVEL_M_PER_S, densityPerM2);
}
export function stairSpeed(kStairMPerS: number, densityPerM2: number): number {
  return speedAtDensity(kStairMPerS, densityPerM2);
}
// Jin line, factor = (a - b K) / a, floored at the darkness speed over a (Design, Speed). 1 for K <= 0 or NaN.
export function smokeFactor(extinctionPerM: number, law: SmokeLaw = SMOKE_LAW_NON_IRRITANT): number {
  if (!(extinctionPerM > 0)) return 1;
  const floor = SMOKE_DARKNESS_SPEED_M_PER_S / law.a;
  return Math.min(1, Math.max(floor, (law.a - law.b * extinctionPerM) / law.a));
}
// SFPE stair table k (m/s) for a riser and tread in metres; clamped to the end points outside the table.
export function stairKForGeometry(riserM: number, treadM: number): number {
  return stairTableK(riserM / treadM).k;
}
