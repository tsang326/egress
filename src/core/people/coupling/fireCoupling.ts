// Reads the finished fire Result for the crowd model (Design, "Fire coupling"; Requirements 1.5, 4.1 to 4.4, 4.8).
// One forward-only time cursor, linear interpolation between the two samples that bracket the time, last sample held.
import type { CompartmentSeries, LayerSeries, Result } from '../../fire/types';
import { AMBIENT_TEMP_K } from '../constants';
import type { CrowdWarning, Plan } from '../types';
import { CELL_DOOR, CELL_FREE, CELL_STAIR, NO_COMPARTMENT } from '../types';
import { compartmentMissingInFire, fireResultEnded, fireStatus } from '../warnings';
import {
  extinctionFromOpticalDensity,
  isUpperAtEyeHeight,
  massToVolume,
  setAmbient,
  visibilityFromExtinction,
  type LayerReading,
} from './layers';
export interface FireCoupling {
  // Maps a plan compartment index to the fire compartment index, -1 when the fire Result has no such compartment.
  readonly fireIndex: Int16Array;
  // Moves the time cursor to `timeS` (never backwards). Adds FIRE_RESULT_ENDED the first time the time is past the last
  // sample.
  advance(timeS: number): void;
  // Fills `out` for a plan compartment index (NO_COMPARTMENT or -1 gives ambient conditions).
  read(planCompartment: number, out: LayerReading): void;
  // Warnings raised while running (FIRE_RESULT_ENDED), in order.
  readonly warnings: CrowdWarning[];
}
export type CouplingResult =
  | { ok: true; coupling: FireCoupling; warnings: CrowdWarning[] }
  | { ok: false; warnings: CrowdWarning[] };
const at = (a: Float64Array | undefined, k: number): number => a?.[k] ?? NaN;
// Requirement 4.1: a status other than "ok" or no samples is rejected before any step. `warnings` of an ok result hold one
// COMPARTMENT_MISSING_IN_FIRE per free, door or stair cell whose compartment is not in the fire Result (Requirements 1.5,
// 4.3), in floor then cell order.
export function createFireCoupling(fire: Result, plan: Plan, ambientTempK: number = AMBIENT_TEMP_K): CouplingResult {
  if (fire.status !== 'ok') return { ok: false, warnings: [fireStatus(String(fire.status))] };
  if (!fire.timesS || fire.timesS.length === 0) return { ok: false, warnings: [fireStatus('no samples')] };
  const times = fire.timesS;
  const nSamples = times.length;
  const byId = new Map<string, number>();
  fire.compartments.forEach((c, i) => {
    if (!byId.has(c.id)) byId.set(c.id, i);
  });
  const fireIndex = new Int16Array(plan.compartmentIds.length);
  plan.compartmentIds.forEach((id, i) => {
    fireIndex[i] = byId.get(id) ?? -1;
  });
  const warnings: CrowdWarning[] = [];
  for (const f of plan.floors) {
    for (let c = 0; c < f.cellType.length; c++) {
      const t = f.cellType[c]!;
      if (t !== CELL_FREE && t !== CELL_DOOR && t !== CELL_STAIR) continue;
      const k = f.compartment[c]!;
      if (k === NO_COMPARTMENT || fireIndex[k]! >= 0) continue;
      const x = c % f.widthCells;
      warnings.push(compartmentMissingInFire(f.id, x, (c - x) / f.widthCells, plan.compartmentIds[k]!));
    }
  }
  const run: CrowdWarning[] = [];
  let cursor = 0;
  let u = 0; // interpolation weight between samples cursor and cursor + 1
  let ended = false;
  const coupling: FireCoupling = {
    fireIndex,
    warnings: run,
    advance(timeS: number): void {
      const last = nSamples - 1;
      while (cursor < last && times[cursor + 1]! <= timeS) cursor++;
      if (cursor >= last) {
        u = 0;
        if (timeS > times[last]! && !ended) {
          ended = true;
          run.push(fireResultEnded(times[last]!));
        }
        return;
      }
      const t0 = times[cursor]!;
      const span = times[cursor + 1]! - t0;
      u = timeS <= t0 || !(span > 0) ? 0 : (timeS - t0) / span;
    },
    read(planCompartment: number, out: LayerReading): void {
      const fi = planCompartment >= 0 && planCompartment < fireIndex.length ? fireIndex[planCompartment]! : -1;
      const comp: CompartmentSeries | undefined = fi >= 0 ? fire.compartments[fi] : undefined;
      if (!comp) {
        setAmbient(out, ambientTempK);
        return;
      }
      const k = cursor;
      const lerp = (arr: Float64Array | undefined): number => {
        const a = at(arr, k);
        if (u === 0 || k >= nSamples - 1) return a;
        return a + u * (at(arr, k + 1) - a);
      };
      const upper = isUpperAtEyeHeight(lerp(comp.interfaceHeightM));
      const layer: LayerSeries = upper ? comp.upper : comp.lower;
      const temp = lerp(upper ? comp.upperTempK : comp.lowerTempK);
      const gas = massToVolume(lerp(layer.o2), lerp(layer.co2), lerp(layer.co), lerp(layer.h2o), lerp(layer.soot));
      const extinction = extinctionFromOpticalDensity(lerp(layer.opticalDensityPerM));
      out.upperActive = upper;
      out.tempK = Number.isFinite(temp) && temp >= 0 ? temp : NaN;
      out.coPpm = gas.coPpm;
      out.co2Pct = gas.co2Pct;
      out.o2Pct = gas.o2Pct;
      out.extinctionPerM = extinction;
      out.visibilityM = visibilityFromExtinction(extinction);
      out.ambient = false;
    },
  };
  return { ok: true, coupling, warnings };
}
