// Shape of the fire-zone input and output. Types only, no logic.
// All quantities are SI (m, s, kg, K, W, Pa). Names carry the unit when it is not obvious.
import type { Warning } from "./validate/warnings";

export type { Warning } from "./validate/warnings";

export interface Scenario {
  schemaVersion: 1;
  title?: string;
  durationS: number;
  printIntervalS: number;
  seed: number; // Seeded_PRNG seed, unused by physics in v1 (Req 11.3)
  ambient: Ambient;
  options?: ScenarioOptions;
  compartments: Compartment[];
  vents: Vent[];
  fires: Fire[];
  unsupported?: UnsupportedItem[];
}

export interface ScenarioOptions {
  maxTimeStepS?: number;
  adiabatic?: boolean;
  // Req 6.13. false (default): upper-layer plume arguments in their intended meaning.
  // true: reproduce the argument order of CFAST 7.7.7 fire.f90, do_fire.
  cfastUpperPlumeArgOrder?: boolean;
  // Req 5.10. false (default): the Outside above a roof (ceiling-to-Outside) vent has the real ambient density at the
  // vent elevation. true: reproduce CFAST 7.7.7, flowvertical.f90 lines 261-262 after initialization.f90 line 120,
  // where the density comes out near 0.001 kg/m3.
  cfastRoofVentOutsideDensity?: boolean;
  // Req 6.14. true or absent (default, as CFAST option fdfire): unburned fuel that flows through a wall vent burns in the
  // jet, in the receiving compartment, when the jet is hot enough and entrains air (CFAST 7.7.7 fire.f90, vent_jets).
  // false: no door-jet fires. CFAST input: &DIAG DOOR_JET_FIRE_SUB_MODEL = 'OFF'.
  doorJetFires?: boolean;
}

export interface Ambient {
  interiorTempK: number;
  exteriorTempK: number;
  pressurePa: number; // absolute, at elevation 0
  species: { o2: number; co2: number; co: number; h2o: number; soot: number }; // mass fractions
}

export type CompartmentKind = "room" | "corridor" | "shaft";

export interface Compartment {
  id: string;
  widthM: number;
  depthM: number;
  heightM: number;
  floorElevationM: number;
  kind: CompartmentKind;
  isStair?: boolean;
  ceiling: Surface;
  floor: Surface;
  walls: Surface; // one construction shared by all four walls (Req 2.3)
  leakage?: { wallAreaRatio?: number; floorAreaRatio?: number }; // to the Outside only (Req 4.7)
}

// Exposed face first, 1 to 3 layers; or an explicit adiabatic surface (CFAST material OFF).
export type Surface = { layers: SurfaceLayer[] } | { adiabatic: true };

export interface SurfaceLayer {
  name: string;
  conductivityWPerMK: number;
  densityKgPerM3: number;
  specificHeatJPerKgK: number;
  thicknessM: number;
  emissivity: number; // emissivity of the exposed layer is used for radiation
}

export type Face = "front" | "back" | "left" | "right";
export type VentEnd = string; // a compartment id, or "OUTSIDE"
export interface OpenFractionTable {
  timesS: number[];
  fractions: number[];
} // 2 to 1,000 pairs

export type Vent = WallVent | CeilingFloorVent | LeakageVent;

export interface WallVent {
  kind: "wall";
  id: string;
  from: VentEnd;
  to: VentEnd;
  sillM: number;
  soffitM: number;
  widthM: number;
  face: Face;
  offsetM: number;
  open: number | OpenFractionTable;
}

export interface CeilingFloorVent {
  kind: "ceilingFloor";
  id: string;
  lower: VentEnd;
  upper: VentEnd;
  areaM2: number;
  shape: "round" | "square";
  offsetM?: [number, number];
  open: number | OpenFractionTable;
}

export interface LeakageVent {
  kind: "leakage";
  id: string;
  compartmentId: string; // the other end is always the Outside (Req 4.7)
  areaM2: number; // 0 < area <= 100
  orientation: "wall" | "floor";
}

export interface HrrRow {
  timeS: number;
  hrrW: number;
  heightM: number;
  areaM2: number;
  coYield: number; // kg/kg
  sootYield: number; // kg/kg
}

export interface Fire {
  id: string;
  compartmentId: string;
  xM: number;
  yM: number;
  radiativeFraction: number; // 0..1
  ignitionTimeS?: number; // default 0; table time is t - ignitionTimeS
  fuel: {
    c: number;
    h: number;
    o: number;
    n: number;
    cl: number;
    heatOfCombustionJPerKg: number;
  };
  table: HrrRow[]; // 2 to 10,000 rows
}

export interface UnsupportedItem {
  kind: "hvac" | "sprinkler" | "detector" | "suppression" | "target";
  id: string;
}

export type ResultStatus = "ok" | "invalid" | "failed";

export interface ResultFlag {
  warningIndex: number; // index into Result.warnings
  target: { kind: "compartment" | "vent"; id: string };
  quantities: "all" | string[];
}

export type SpeciesKey = "o2" | "co2" | "co" | "h2o" | "soot" | "n2" | "uhc";

export interface ResultStats {
  steps: number;
  rejected: number;
  newtonIterations: number;
  newtonFailures: number; // Newton solves that did not converge (each one cuts the step)
  jacobians: number;
  residualEvals: number; // residual evaluations, Jacobian columns included (performance diagnostics, Req 11.8)
  maxUpperBurnHrrW: number; // largest upper-layer burned HRR over the run (Property 35)
  // Req 8.10: species mass added (+) or removed (-) by the synchronisation after each accepted step, summed over all
  // layers and the whole run, kg. `net` is the signed sum, `abs` the sum of the absolute changes of each step.
  // Keys are the species names of the tracker: o2, co2, co, h2o, soot, n2, uhc.
  speciesSyncNetKg: Record<SpeciesKey, number>;
  speciesSyncAbsKg: Record<SpeciesKey, number>;
  stepSizesS?: Float64Array; // only filled when RunOptions.recordSteps is true
}

export interface Result {
  status: ResultStatus;
  warnings: Warning[];
  flags: ResultFlag[];
  timesS: Float64Array; // sample times
  compartments: CompartmentSeries[];
  vents: VentSeries[];
  // Heat release rate, W per sample, of the door-jet fires that burn in the Outside (a jet through a vent whose receiving end
  // is the Outside). CFAST reports it separately: it is the last entry of roominfo%qdot_doorjet (index n_rooms+1), written
  // under the device name 'Outside' (outputspreadsheet.f90, lines 1297-1298). That heat goes to no compartment. Exactly 0
  // when door-jet fires are off. Empty when there are no samples.
  outsideDoorJetHrrW: Float64Array;
  stats: ResultStats;
}

export interface LayerSeries {
  o2: Float64Array;
  co2: Float64Array;
  co: Float64Array;
  h2o: Float64Array;
  soot: Float64Array;
  opticalDensityPerM: Float64Array;
  visibilityM: Float64Array; // Infinity when soot is 0
}

export interface CompartmentSeries {
  id: string;
  upperTempK: Float64Array;
  lowerTempK: Float64Array;
  interfaceHeightM: Float64Array;
  pressurePa: Float64Array; // absolute
  upperVolumeM3: Float64Array;
  upper: LayerSeries;
  lower: LayerSeries;
  burnedHrrW: { fireId: string; values: Float64Array }[];
  // Heat release rate of the door-jet fires (Requirement 6.14) that burn in this compartment, W, per sample: unburned fuel
  // carried through wall vents from another compartment and burned here. It is added to this compartment's upper layer, and
  // is NOT included in `burnedHrrW` (that is the Fire's own burn). CFAST 7.7.7: roominfo%qdot_doorjet, set in fire.f90
  // (door_jet, lines 762-764) and written to the spreadsheet output by outputspreadsheet.f90 (lines 1294-1296). Exactly 0 at
  // every sample when `options.doorJetFires` is false or no jet burns.
  doorJetHrrW: Float64Array;
}

export interface VentEndSeries {
  compartmentId: string; // a compartment id, or "OUTSIDE"
  upperInKgS: Float64Array;
  upperOutKgS: Float64Array;
  lowerInKgS: Float64Array;
  lowerOutKgS: Float64Array;
}

export interface VentSeries {
  id: string;
  // ends[0] is ALWAYS the vent's FIRST compartment: `from` of a wall vent, `upper` of a ceiling/floor vent (CFAST lists the
  // top compartment first in COMP_IDS), the leaking compartment of a leakage vent. ends[1] is the other end, which is
  // "OUTSIDE" for leakage. The CFAST CSV layer flows of a wall vent are relative to the first compartment and those of a
  // ceiling/floor vent are the net layer flows of the bottom compartment; validation/harness/compare.ts compares them with
  // ends[0] and ends[1] respectively, so this order is part of the Result contract.
  ends: [VentEndSeries, VentEndSeries];
  openFraction: Float64Array;
}

export interface ProgressEvent {
  simTimeS: number;
  fraction: number; // 0..1
}

export interface RunOptions {
  onProgress?: (e: ProgressEvent) => void; // Req 10.5
  // Wall clock for the 1 s progress rule, injected so core stays pure (Req 11.4). Returns milliseconds, like
  // performance.now. Wall-clock values never reach the Result.
  now?: () => number;
  recordSteps?: boolean; // fill stats.stepSizesS (Req 9.8)
  // Test-only numerical override (Requirement 14.2 convergence check). Default behaviour is unchanged when absent.
  // atolScale multiplies every absolute tolerance (pressure, volume, temperature) by the same factor; rtol replaces RTOL.
  numerical?: { rtol?: number; atolScale?: number };
  // TEST-ONLY abort hook (Requirement 14.9 time limit); the app never sets it. Called once per attempted solver step,
  // including rejected and retried ones, and before every residual evaluation the solver makes (Requirement 13.14), so a
  // single long step can be stopped. It may throw to stop a run; the run then ends "failed" with INTERNAL_ERROR
  // (Requirement 11.6) and keeps its samples. A hook that returns normally has NO effect on the Result: every number,
  // warning and stat, including the step sequence, is bit-identical with and without it (tests/fire/run.checkpoint.test.ts).
  checkpoint?: () => void;
  // TEST-ONLY mass ledger (Requirement 14.2); the app never sets it. Called once per ACCEPTED solver step with the
  // cumulative pyrolysed fuel mass and the cumulative net vent inflow through the Outside, integrated inside the driver
  // with the trapezoid rule over each accepted step from the rates at the step ends, so it does not depend on the output
  // interval. It only reads. A hook that returns normally has NO effect on the Result: every number, warning and stat,
  // including the step sequence, is bit-identical with and without it (tests/fire/run.massLedger.test.ts). It is not
  // part of the Result.
  massLedger?: (step: MassLedgerStep) => void;
}

export interface MassLedgerStep {
  timeS: number; // end of the accepted step
  cumulativeFuelKg: number; // fuel pyrolysed since t = 0
  cumulativeVentInflowKg: number; // net inflow through vents to the Outside (leakage included), since t = 0
  cumulativeVentInflowByVentKg: number[]; // the same per vent, in model order (Scenario.vents, then leakage from area ratios); 0 for vents between compartments
}
