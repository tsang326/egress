// Decision rule of the Property 31 mass convergence check (requirements.md, Requirement 14.2, as amended).
//
// Two runs of the same Scenario: default tolerances (coarse) and RTOL and every ATOL divided by 100 (fine).
// Each run has a mass error and the tolerance of Requirement 14.2 computed with that run's own RTOL.
//  1. The fine error must ALWAYS stay within the fine tolerance.
//  2. The error must also fall by at least a factor of 2, but only when the coarse error exceeds 1 % of the coarse
//     tolerance. Below that the 0.025 s sampling sets the error, not the solver tolerance.

/** Fraction of the default tolerance above which the factor-of-2 drop is required (Requirement 14.2). */
export const CONVERGENCE_THRESHOLD_FRACTION = 0.01;
/** Required drop of the mass error between the default and the reduced tolerances (Requirement 14.2). */
export const CONVERGENCE_FACTOR = 2;

export interface MassConvergenceInput {
  coarseErr: number; // mass error at default tolerances, kg
  coarseTol: number; // Requirement 14.2 tolerance with the default RTOL, kg
  fineErr: number; // mass error at RTOL and all ATOL / 100, kg
  fineTol: number; // Requirement 14.2 tolerance with the reduced RTOL, kg
}

export interface MassConvergenceVerdict {
  ok: boolean;
  reason: string;
}

export function massConvergenceVerdict(i: MassConvergenceInput): MassConvergenceVerdict {
  if (i.fineErr > i.fineTol) {
    return { ok: false, reason: `reduced-tolerance error ${i.fineErr} kg exceeds its tolerance ${i.fineTol} kg` };
  }
  if (i.coarseErr > CONVERGENCE_THRESHOLD_FRACTION * i.coarseTol && !(i.fineErr <= i.coarseErr / CONVERGENCE_FACTOR)) {
    return {
      ok: false,
      reason: `mass error did not fall ${CONVERGENCE_FACTOR}-fold: ${i.coarseErr} kg at default tolerances (tolerance ${i.coarseTol} kg), ${i.fineErr} kg at reduced tolerances`,
    };
  }
  return { ok: true, reason: "within tolerance" };
}
