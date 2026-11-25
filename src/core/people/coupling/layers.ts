// Layer reading at eye height (Design, "Fire coupling": layer at eye height, extinction coefficient, gas concentrations).
// Pure conversions from the fire Result's layer values to what the crowd model uses.
import { MOLAR_MASS_H2O_KG_PER_MOL } from '../../fire/constants';
import {
  EYE_HEIGHT_M,
  K_VIS,
  MOLAR_MASS_CO2_KG_PER_MOL,
  MOLAR_MASS_CO_KG_PER_MOL,
  MOLAR_MASS_N2_KG_PER_MOL,
  MOLAR_MASS_O2_KG_PER_MOL,
  O2_AMBIENT_PCT,
} from '../constants';
// What one compartment looks like at eye height at one time. Gas values are NaN when the fire Result gave a missing,
// negative or non-finite value (Requirement 5.6), so the FED code can name the invalid input.
export interface LayerReading {
  upperActive: boolean; // the layer at eye height is the upper layer
  tempK: number;
  coPpm: number; // volume fraction in ppm
  co2Pct: number; // volume percent
  o2Pct: number; // volume percent
  extinctionPerM: number; // K, 1/m, natural-log basis; 0 for clear air
  visibilityM: number; // K_VIS / K, Infinity for clear air
  ambient: boolean; // true when the compartment is not in the fire Result
}
export function newReading(): LayerReading {
  return { upperActive: false, tempK: NaN, coPpm: 0, co2Pct: 0, o2Pct: O2_AMBIENT_PCT, extinctionPerM: 0, visibilityM: Infinity, ambient: true };
}
export function setAmbient(out: LayerReading, ambientTempK: number): void {
  out.upperActive = false;
  out.tempK = ambientTempK;
  out.coPpm = 0;
  out.co2Pct = 0;
  out.o2Pct = O2_AMBIENT_PCT;
  out.extinctionPerM = 0;
  out.visibilityM = Infinity;
  out.ambient = true;
}
// Requirement 4.4: the lower layer when the interface is at or above eye height, else the upper layer. The interface
// height is above the compartment floor, as in the fire model.
export function isUpperAtEyeHeight(interfaceHeightM: number): boolean {
  return !(interfaceHeightM >= EYE_HEIGHT_M);
}
// K = optical density per metre (log10 basis) x ln 10 (Design). 0 for clear air, and for a value that is not above 0.
export function extinctionFromOpticalDensity(opticalDensityPerM: number): number {
  return opticalDensityPerM > 0 ? opticalDensityPerM * Math.LN10 : 0;
}
// Same relation from a visibility: K = K_VIS / visibility. Infinity (no smoke) gives exactly 0.
export function extinctionFromVisibility(visibilityM: number): number {
  return visibilityM > 0 && Number.isFinite(visibilityM) ? K_VIS / visibilityM : 0;
}
export function visibilityFromExtinction(extinctionPerM: number): number {
  return extinctionPerM > 0 ? K_VIS / extinctionPerM : Infinity;
}
export interface GasVolumes {
  coPpm: number;
  co2Pct: number;
  o2Pct: number;
}
const valid = (y: number): boolean => Number.isFinite(y) && y >= 0;
// Mass fractions to volume fractions, wet basis, soot not counted as gas, the rest taken as N2 (Design). A species that is
// missing, negative or not finite gives NaN for itself and counts as 0 in the others' denominator.
export function massToVolume(o2: number, co2: number, co: number, h2o: number, soot: number): GasVolumes {
  const y = (v: number): number => (valid(v) ? v : 0);
  const nO2 = y(o2) / MOLAR_MASS_O2_KG_PER_MOL;
  const nCO2 = y(co2) / MOLAR_MASS_CO2_KG_PER_MOL;
  const nCO = y(co) / MOLAR_MASS_CO_KG_PER_MOL;
  const nH2O = y(h2o) / MOLAR_MASS_H2O_KG_PER_MOL;
  const nRest = Math.max(0, 1 - y(o2) - y(co2) - y(co) - y(h2o) - y(soot)) / MOLAR_MASS_N2_KG_PER_MOL;
  const total = nO2 + nCO2 + nCO + nH2O + nRest;
  return {
    coPpm: valid(co) ? (1e6 * nCO) / total : NaN,
    co2Pct: valid(co2) ? (100 * nCO2) / total : NaN,
    o2Pct: valid(o2) ? (100 * nO2) / total : NaN,
  };
}
