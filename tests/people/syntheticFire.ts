// A fire Result built without the fire solver, for crowd tests (Design, Testing Strategy).
// Each compartment has a start and an end state; samples between them are linear in time.
import { K_VIS } from '../../src/core/fire/constants';
import { emptyStats } from '../../src/core/fire/result';
import type { CompartmentSeries, LayerSeries, Result } from '../../src/core/fire/types';

// Mass fractions as the fire Result carries them (CFAST). 0.23 is the fire module's default ambient O2 fraction.
export interface LayerState {
  o2: number;
  co2: number;
  co: number;
  opticalDensityPerM: number; // 1/m, log10 basis; visibility is derived as K_VIS / (OD ln 10)
}

export interface CompartmentState {
  interfaceHeightM: number;
  upperTempK: number;
  lowerTempK: number;
  upper: LayerState;
  lower: LayerState;
}

export const AMBIENT_LAYER: LayerState = { o2: 0.23, co2: 0, co: 0, opticalDensityPerM: 0 };
// Ambient room: both layers at 293.15 K and no smoke. interfaceHeightM is replaced by the compartment's ceiling height.
export const AMBIENT_STATE: CompartmentState = {
  interfaceHeightM: 2.4,
  upperTempK: 293.15,
  lowerTempK: 293.15,
  upper: AMBIENT_LAYER,
  lower: AMBIENT_LAYER,
};

export interface SyntheticCompartment {
  id: string;
  start?: Partial<CompartmentState>; // default ambient
  end?: Partial<CompartmentState>; // default: same as start
}

export interface SyntheticFireSpec {
  durationS: number;
  sampleIntervalS?: number; // default 1
  compartments: SyntheticCompartment[];
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function layerSeries(a: LayerState, b: LayerState, t: Float64Array, dur: number): LayerSeries {
  const n = t.length;
  const mk = (f: (u: number) => number): Float64Array => Float64Array.from(t, (s) => f(dur > 0 ? s / dur : 0));
  const od = mk((u) => lerp(a.opticalDensityPerM, b.opticalDensityPerM, u));
  return {
    o2: mk((u) => lerp(a.o2, b.o2, u)),
    co2: mk((u) => lerp(a.co2, b.co2, u)),
    co: mk((u) => lerp(a.co, b.co, u)),
    h2o: new Float64Array(n),
    soot: new Float64Array(n),
    opticalDensityPerM: od,
    // The fire module reports Infinity when there is no soot.
    visibilityM: Float64Array.from(od, (v) => (v > 0 ? K_VIS / (v * Math.LN10) : Infinity)),
  };
}

export function syntheticFire(spec: SyntheticFireSpec): Result {
  const dt = spec.sampleIntervalS ?? 1;
  const n = Math.floor(spec.durationS / dt) + 1;
  const timesS = Float64Array.from({ length: n }, (_, i) => i * dt);
  const dur = timesS[n - 1]!;
  const compartments: CompartmentSeries[] = spec.compartments.map((c) => {
    const a: CompartmentState = { ...AMBIENT_STATE, ...c.start };
    const b: CompartmentState = { ...a, ...c.end };
    const mk = (f: (u: number) => number): Float64Array => Float64Array.from(timesS, (s) => f(dur > 0 ? s / dur : 0));
    return {
      id: c.id,
      upperTempK: mk((u) => lerp(a.upperTempK, b.upperTempK, u)),
      lowerTempK: mk((u) => lerp(a.lowerTempK, b.lowerTempK, u)),
      interfaceHeightM: mk((u) => lerp(a.interfaceHeightM, b.interfaceHeightM, u)),
      pressurePa: new Float64Array(n).fill(101325),
      upperVolumeM3: new Float64Array(n),
      upper: layerSeries(a.upper, b.upper, timesS, dur),
      lower: layerSeries(a.lower, b.lower, timesS, dur),
      burnedHrrW: [],
      doorJetHrrW: new Float64Array(n),
    };
  });
  return {
    status: 'ok',
    warnings: [],
    flags: [],
    timesS,
    compartments,
    vents: [],
    outsideDoorJetHrrW: new Float64Array(n),
    stats: emptyStats(),
  };
}
