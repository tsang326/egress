// Minimum and maximum layer volume, and the single-zone (shaft) helpers. Pure functions, SI units.
import { LOWER_LAYER_MIN_DEPTH_M, VMIN_CAP_M3, VMIN_FRACTION } from "../constants";

// CFAST 7.7.7 source, solve.f90 (update_data): VMIN = min(VMINFRAC V, 1 m3). Requirement 3.5.
export function minLayerVolumeM3(compartmentVolumeM3: number): number {
  return Math.min(VMIN_FRACTION * compartmentVolumeM3, VMIN_CAP_M3);
}

// CFAST 7.7.7 source, solve.f90 (update_data): VMAX = V - VMIN.
export function maxLayerVolumeM3(compartmentVolumeM3: number): number {
  return compartmentVolumeM3 - minLayerVolumeM3(compartmentVolumeM3);
}

// CFAST 7.7.7 source, solve.f90 (update_data): upper layer volume clamped to [VMIN, VMAX]. Requirement 3.6.
export function clampUpperVolumeM3(upperVolumeM3: number, compartmentVolumeM3: number): number {
  const vmin = minLayerVolumeM3(compartmentVolumeM3);
  const vmax = compartmentVolumeM3 - vmin;
  return Math.min(Math.max(upperVolumeM3, vmin), vmax);
}

// CFAST 7.7.7 source, solve.f90 (update_data): lower layer volume = V - Vu, clamped to [VMIN, VMAX].
export function lowerVolumeM3(upperVolumeM3: number, compartmentVolumeM3: number): number {
  const vmin = minLayerVolumeM3(compartmentVolumeM3);
  const vmax = compartmentVolumeM3 - vmin;
  return Math.min(Math.max(compartmentVolumeM3 - upperVolumeM3, vmin), vmax);
}

// CFAST 7.7.7 source, solve.f90 lines 1406-1411 (update_data, radiation_fix = 1): when the lower layer is thinner than
// 0.1 m, the lower layer is 0.1 m deep (volume 0.1 m x floor area) and the upper layer has the rest of the volume.
// Takes the upper volume already clamped to [VMIN, VMAX]. The guard on the room height keeps the interface inside the
// room for rooms 0.1 m high or lower, which are outside the CFAST range. Requirement 3.4.
export function flooredUpperVolumeM3(
  clampedUpperVolumeM3: number,
  compartmentVolumeM3: number,
  floorAreaM2: number,
  heightM: number,
): number {
  const lowerM3 = lowerVolumeM3(clampedUpperVolumeM3, compartmentVolumeM3);
  if (lowerM3 < LOWER_LAYER_MIN_DEPTH_M * floorAreaM2 && heightM > LOWER_LAYER_MIN_DEPTH_M) {
    return compartmentVolumeM3 - LOWER_LAYER_MIN_DEPTH_M * floorAreaM2;
  }
  return clampedUpperVolumeM3;
}

// CFAST 7.7.7 source, initialization.f90 (initialize_state_variables): initial upper volume is VMIN,
// or VMAX for a shaft (Requirements 3.5, 5.8).
export function initialUpperVolumeM3(compartmentVolumeM3: number, isShaft: boolean): number {
  return isShaft ? maxLayerVolumeM3(compartmentVolumeM3) : minLayerVolumeM3(compartmentVolumeM3);
}

// CFAST 7.7.7 source, solve.f90 (shaft handling): a shaft keeps Vu constant, so dVu/dt is 0.
export function shaftUpperVolumeRate(isShaft: boolean, dVudtM3PerS: number): number {
  return isShaft ? 0 : dVudtM3PerS;
}

// CFAST 7.7.7 source, solve.f90 (shaft handling): the lower layer temperature equals the upper layer temperature.
export function shaftLowerTempK(upperTempK: number): number {
  return upperTempK;
}

export interface LayerFlows {
  qUpperW: number;
  qLowerW: number;
  mdotUpperKgPerS: number;
  mdotLowerKgPerS: number;
}

// CFAST 7.7.7 source, solve.f90 (shaft handling): all heat and mass flows of the lower layer are added to the upper layer.
export function mergeShaftFlows(flows: LayerFlows): LayerFlows {
  return {
    qUpperW: flows.qUpperW + flows.qLowerW,
    qLowerW: 0,
    mdotUpperKgPerS: flows.mdotUpperKgPerS + flows.mdotLowerKgPerS,
    mdotLowerKgPerS: 0,
  };
}

// CFAST 7.7.7 source, solve.f90 (shaft handling): lower layer species fractions are copied from the upper layer.
// `upperFractions` and `lowerFractions` have the same length; the result is written into `lowerFractions`.
export function copyShaftSpeciesFractions(upperFractions: ArrayLike<number>, lowerFractions: Float64Array): void {
  const n = Math.min(upperFractions.length, lowerFractions.length);
  for (let i = 0; i < n; i++) lowerFractions[i] = upperFractions[i] as number;
}
