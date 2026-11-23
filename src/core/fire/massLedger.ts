// TEST-ONLY mass ledger (RunOptions.massLedger; Requirement 14.2). Integrates the pyrolysed fuel mass and the net vent
// inflow through the Outside over every ACCEPTED solver step with the trapezoid rule, using the rates of the
// evaluations at the two ends of the step. These are the same evaluations the solver's accepted states come from, so
// the ledger does not depend on the output interval. Read-only: it never writes to the model, workspace or solver.
import type { Model } from "./model";
import type { Workspace } from "./residual";
import type { MassLedgerStep } from "./types";
import { endFlows } from "./vents/ventTypes";

/** Fuel pyrolysis rate summed over all fires (kg/s), from the evaluation held in `ws` (design Fire modules step 3). */
function fuelRateKgS(model: Model, ws: Workspace): number {
  let sum = 0;
  for (const fm of model.fires) sum += ws.fireEvals[fm.index]?.pyrolysisKgS ?? 0;
  return sum;
}

/**
 * Net mass flow into the first end of each vent whose second end is the Outside (kg/s): in minus out over both layers.
 * Entrainment inside one end is excluded, as in the reported vent flows. Vents between two compartments give 0 here
 * because their flows cancel in the total gas mass.
 */
function ventNetInflowKgS(model: Model, ws: Workspace, out: Float64Array): void {
  for (let vi = 0; vi < model.vents.length; vi++) {
    const v = model.vents[vi];
    const r = ws.ventResults[vi];
    if (v === undefined || v.ends[1] >= 0 || r === null || r === undefined) {
      out[vi] = 0;
      continue;
    }
    const e = endFlows(r.transfers)[0];
    out[vi] = e.upperInKgS + e.lowerInKgS - e.upperOutKgS - e.lowerOutKgS;
  }
}

export interface MassLedger {
  /** Records the rates of the evaluation in `ws` as the start of the first step (time 0, or after a restart in place). */
  start(ws: Workspace): void;
  /** Adds the step from the previous rates to the rates of the evaluation in `ws` at `timeS`, and reports it. */
  accept(ws: Workspace, timeS: number): void;
}

export function createMassLedger(model: Model, report: (step: MassLedgerStep) => void): MassLedger {
  const nV = model.vents.length;
  let prevTimeS = 0;
  let prevFuel = 0;
  let prevVent = new Float64Array(nV);
  let nowVent = new Float64Array(nV);
  let cumFuelKg = 0;
  const cumVentKg = new Float64Array(nV);
  return {
    start(ws) {
      prevTimeS = 0;
      prevFuel = fuelRateKgS(model, ws);
      ventNetInflowKgS(model, ws, prevVent);
    },
    accept(ws, timeS) {
      const h = timeS - prevTimeS;
      const fuel = fuelRateKgS(model, ws);
      ventNetInflowKgS(model, ws, nowVent);
      cumFuelKg += 0.5 * (prevFuel + fuel) * h;
      let total = 0;
      for (let vi = 0; vi < nV; vi++) {
        cumVentKg[vi] = (cumVentKg[vi] as number) + 0.5 * ((prevVent[vi] as number) + (nowVent[vi] as number)) * h;
        total += cumVentKg[vi] as number;
      }
      report({
        timeS,
        cumulativeFuelKg: cumFuelKg,
        cumulativeVentInflowKg: total,
        cumulativeVentInflowByVentKg: Array.from(cumVentKg),
      });
      prevTimeS = timeS;
      prevFuel = fuel;
      const swap = prevVent;
      prevVent = nowVent;
      nowVent = swap;
    },
  };
}
