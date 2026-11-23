// Lower oxygen limit of combustion (Tech Ref eq. 3.15). Pure function, shared by the plume fires (heatRelease.ts) and
// the door-jet fires (ventJet.ts).
import { LOWER_OXYGEN_LIMIT, OXYGEN_TANH_OFFSET, OXYGEN_TANH_SCALE, OXYGEN_TANH_SHIFT, OXYGEN_TANH_SLOPE } from "../constants";

// Tech Ref eq. 3.15 (same shape) in the form CFAST 7.7.7 uses (utilities.f90, tanhsmooth, called from fire.f90, chemistry):
// clamp(0.5 + 0.5025 tanh(600 (Y - 0.15) - 3), 0, 1). Exactly 0 at Y <= 0.15 and exactly 1 at Y >= 0.16.
// A non-finite oxygen fraction gives 0 (no burning).
export function oxygenFactor(o2MassFraction: number): number {
  if (!Number.isFinite(o2MassFraction)) return 0;
  const f =
    OXYGEN_TANH_OFFSET +
    OXYGEN_TANH_SCALE * Math.tanh(OXYGEN_TANH_SLOPE * (o2MassFraction - LOWER_OXYGEN_LIMIT) - OXYGEN_TANH_SHIFT);
  return Math.min(Math.max(f, 0), 1);
}
