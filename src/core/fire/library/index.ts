// Fire library (run-view spec, Requirement 3): measured furniture fires from the NIST Fire Calorimetry Database and
// t-squared design fires. Pure data and pure builders; no DOM.
import type { Fire, HrrRow } from '../types';
import items from './fcdItems.json';

export const FCD_DOI = 'https://doi.org/10.18434/mds2-2314';

export interface FireItem {
  kind: 'measured';
  id: string;
  name: string;
  testId: string; // NIST FCD test, e.g. "Test016"
  source: string; // dataset DOI and test id
  sourceUrl: string; // the test page
  dataUrl: string; // the CSV file the curve was built from
  phrrKW: number; // Table 2 of the test page
  thrMJ: number;
  heatOfCombustionJPerKg: number; // net effective heat of combustion, Table 2
  coYield: number; // kg/kg, Table 2
  sootYield: number; // kg/kg, Table 2
  areaM2: number; // Estimate (footprint of the item), not measured by the FCD
  baseHeightM: number; // Estimate (height of the burning surface), not measured by the FCD
  curve: { timeS: number; hrrW: number }[]; // tools/library/fcd.ts, 10 s bin averages of specimen HRR
}

interface RawItem {
  id: string;
  name: string;
  test: string;
  pageUrl: string;
  dataPath: string;
  phrrKW: number;
  thrMJ: number;
  heatOfCombustionMJPerKg: number;
  coYield: number;
  sootYield: number;
  areaM2: number;
  baseHeightM: number;
  curve: { timeS: number; hrrW: number }[];
}

export const FIRE_LIBRARY: readonly FireItem[] = (items as RawItem[]).map((r) => ({
  kind: 'measured',
  id: r.id,
  name: r.name,
  testId: r.test,
  source: `NIST Fire Calorimetry Database, ${FCD_DOI}, ${r.test}`,
  sourceUrl: r.pageUrl,
  dataUrl: r.dataPath,
  phrrKW: r.phrrKW,
  thrMJ: r.thrMJ,
  heatOfCombustionJPerKg: r.heatOfCombustionMJPerKg * 1e6,
  coYield: r.coYield,
  sootYield: r.sootYield,
  areaM2: r.areaM2,
  baseHeightM: r.baseHeightM,
  curve: r.curve,
}));

export type TSquaredClass = 'slow' | 'medium' | 'fast' | 'ultraFast';

// NFPA 72 (2022), Annex B, Table B.2.3.2.3 growth times to 1055 kW (1000 Btu/s): slow 600 s, medium 300 s, fast 150 s,
// ultra-fast 75 s. alpha = 1055 kW / tg^2, in kW/s^2, so the values below are multiplied by 1000 to give W/s^2.
export const T_SQUARED_ALPHA_KW_PER_S2: Readonly<Record<TSquaredClass, number>> = {
  slow: 0.00293,
  medium: 0.01172,
  fast: 0.0469,
  ultraFast: 0.1876,
};

export interface TSquaredConfig {
  kind: 'tSquared';
  growth: TSquaredClass;
  peakKW: number;
}

// Fuel and yields of a t-squared fire. Estimates (no item is named): a polyurethane-like fuel with the yields of the
// sofa test (NIST FCD Test035), the largest measured item here.
export const T_SQUARED_HEAT_OF_COMBUSTION_J_PER_KG = 17.27e6; // NIST FCD Test035, Table 2
export const T_SQUARED_CO_YIELD = 0.0356; // NIST FCD Test035, Table 2
export const T_SQUARED_SOOT_YIELD = 0.0155; // NIST FCD Test035, Table 2
export const T_SQUARED_AREA_M2 = 1.0; // Estimate
export const T_SQUARED_BASE_HEIGHT_M = 0.4; // Estimate

// Fuel formula for every library fire. Estimate: the FCD reports yields, not the elemental composition; a CH2-like
// hydrocarbon keeps the oxygen demand close to the measured O2 yields (about 1.1 to 2.7 kg/kg).
export const LIBRARY_FUEL_FORMULA = { c: 1, h: 2, o: 0, n: 0, cl: 0 } as const;
// Radiative fraction of the flames. Estimate: 0.35, a common value for upholstered furniture (CFAST default is 0.35).
export const LIBRARY_RADIATIVE_FRACTION = 0.35;

const T_SQUARED_STEP_S = 10; // table resolution of a t-squared fire, layout choice

/** HRR table of a t-squared fire: alpha t^2 up to the peak, then held at the peak until `durationS`. */
export function tSquaredCurve(cfg: TSquaredConfig, durationS: number): { timeS: number; hrrW: number }[] {
  const alphaW = T_SQUARED_ALPHA_KW_PER_S2[cfg.growth] * 1000;
  const peakW = Math.max(0, cfg.peakKW) * 1000;
  const tPeak = Math.sqrt(peakW / alphaW);
  const out: { timeS: number; hrrW: number }[] = [];
  for (let t = 0; t < tPeak && t <= durationS; t += T_SQUARED_STEP_S) out.push({ timeS: t, hrrW: alphaW * t * t });
  out.push({ timeS: tPeak, hrrW: peakW });
  if (durationS > tPeak) out.push({ timeS: durationS, hrrW: peakW });
  return out;
}

export type FireChoice = FireItem | TSquaredConfig;

export function fireChoiceLabel(c: FireChoice): string {
  if (c.kind === 'measured') return `${c.name} (NIST FCD ${c.testId}, peak ${Math.round(c.phrrKW)} kW)`;
  const names: Record<TSquaredClass, string> = { slow: 'slow', medium: 'medium', fast: 'fast', ultraFast: 'ultra-fast' };
  return `t-squared fire, ${names[c.growth]} growth, peak ${Math.round(c.peakKW)} kW`;
}

/** The fire model's Fire for a library choice, centred at (xM, yM) in the compartment. */
export function buildFire(c: FireChoice, compartmentId: string, xM: number, yM: number, durationS: number): Fire {
  const measured = c.kind === 'measured';
  const curve = measured ? c.curve : tSquaredCurve(c, durationS);
  const area = measured ? c.areaM2 : T_SQUARED_AREA_M2;
  const height = measured ? c.baseHeightM : T_SQUARED_BASE_HEIGHT_M;
  const co = measured ? c.coYield : T_SQUARED_CO_YIELD;
  const soot = measured ? c.sootYield : T_SQUARED_SOOT_YIELD;
  const table: HrrRow[] = curve.map((p) => ({ timeS: p.timeS, hrrW: p.hrrW, heightM: height, areaM2: area, coYield: co, sootYield: soot }));
  return {
    id: 'fire1',
    compartmentId,
    xM,
    yM,
    radiativeFraction: LIBRARY_RADIATIVE_FRACTION,
    fuel: { ...LIBRARY_FUEL_FORMULA, heatOfCombustionJPerKg: measured ? c.heatOfCombustionJPerKg : T_SQUARED_HEAT_OF_COMBUSTION_J_PER_KG },
    table,
  };
}
