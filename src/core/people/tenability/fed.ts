// Fractional effective dose (Design, "Tenability"; Requirements 5.1, 5.2, 5.6). One function per relation. Units inside
// the ISO relations: CO in ppm, CO2 and O2 in volume percent, temperature in degC, rates per minute.
import {
  CO_FED_COEFF,
  CO_FED_EXP,
  D_COHB_PCT,
  HEAT_FED_COEFF,
  HEAT_FED_EXP,
  HEAT_FED_MIN_C,
  KELVIN_AT_0C,
  O2_AMBIENT_PCT,
  O2_FED_A,
  O2_FED_B,
  O2_FED_CUTOFF_PCT,
  RMV_L_PER_MIN,
  VCO2_A,
  VCO2_B,
  VCO2_DIV,
} from '../constants';
// ISO 13571 form (FDS source comment): R_CO = 3.317e-5 ppm^1.036 RMV / D per minute. 0 at 0 ppm.
export function coRatePerMin(coPpm: number): number {
  return coPpm > 0 ? (CO_FED_COEFF * Math.pow(coPpm, CO_FED_EXP) * RMV_L_PER_MIN) / D_COHB_PCT : 0;
}
// CO2 hyperventilation factor V = exp(A pct + B) / DIV (estimate coefficients, see constants.ts).
export function co2HyperventilationFactor(co2Pct: number): number {
  return Math.exp(VCO2_A * co2Pct + VCO2_B) / VCO2_DIV;
}
// ISO 13571 low-oxygen rate R_O2 = 1 / exp(A - B (20.9 - pct)) per minute, 0 at or above the cutoff (estimate).
export function o2RatePerMin(o2Pct: number): number {
  if (o2Pct >= O2_FED_CUTOFF_PCT) return 0;
  return 1 / Math.exp(O2_FED_A - O2_FED_B * (O2_AMBIENT_PCT - o2Pct));
}
// R_asph = R_CO V_CO2 + R_O2 per minute (Design). Never negative.
export function asphyxiantRatePerMin(coPpm: number, co2Pct: number, o2Pct: number): number {
  return Math.max(0, coRatePerMin(coPpm) * co2HyperventilationFactor(co2Pct) + o2RatePerMin(o2Pct));
}
// ISO 13571:2012 Eq. (9), clothed: R_heat = T_C^3.61 / 4.1e8 per minute above HEAT_FED_MIN_C (estimate), else 0.
export function heatRatePerMin(tempC: number): number {
  return tempC > HEAT_FED_MIN_C ? Math.pow(tempC, HEAT_FED_EXP) / HEAT_FED_COEFF : 0;
}
export const kelvinToCelsius = (tempK: number): number => tempK - KELVIN_AT_0C;
// Requirement 5.6: the name of the first layer input that is missing, negative or not finite, else null. NaN gas values
// come from coupling/layers.ts massToVolume; the temperature is in K.
export function invalidInputName(tempK: number, coPpm: number, co2Pct: number, o2Pct: number): string | null {
  if (!(Number.isFinite(tempK) && tempK >= 0)) return 'temperature';
  if (!(Number.isFinite(coPpm) && coPpm >= 0)) return 'CO';
  if (!(Number.isFinite(co2Pct) && co2Pct >= 0)) return 'CO2';
  if (!(Number.isFinite(o2Pct) && o2Pct >= 0)) return 'O2';
  return null;
}
export interface FedIncrement {
  asph: number; // added to the asphyxiant FED, never negative
  heat: number; // added to the heat FED, never negative
  invalid: string | null; // name of the invalid input; both increments are 0 then
}
// Increments for one step of `dtS` seconds in one layer: rate per minute x dt / 60 (Design).
export function fedIncrement(tempK: number, coPpm: number, co2Pct: number, o2Pct: number, dtS: number): FedIncrement {
  const invalid = invalidInputName(tempK, coPpm, co2Pct, o2Pct);
  if (invalid !== null) return { asph: 0, heat: 0, invalid };
  return {
    asph: (asphyxiantRatePerMin(coPpm, co2Pct, o2Pct) * dtS) / 60,
    heat: (heatRatePerMin(kelvinToCelsius(tempK)) * dtS) / 60,
    invalid: null,
  };
}
