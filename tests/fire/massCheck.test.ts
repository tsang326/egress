import { describe, expect, it } from "vitest";
import { massConvergenceVerdict } from "./massCheck";

const TOL = 1e-3;

describe("massConvergenceVerdict (Requirement 14.2)", () => {
  it("fails an error above 1 % of the tolerance that does not shrink", () => {
    const v = massConvergenceVerdict({ coarseErr: 1e-4, coarseTol: TOL, fineErr: 9e-5, fineTol: TOL });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/did not fall/);
  });

  it("passes an error above 1 % of the tolerance that halves", () => {
    expect(massConvergenceVerdict({ coarseErr: 1e-4, coarseTol: TOL, fineErr: 5e-5, fineTol: TOL }).ok).toBe(true);
  });

  it("fails a reduced-tolerance error above its tolerance even when the default error is tiny", () => {
    const v = massConvergenceVerdict({ coarseErr: 1e-12, coarseTol: TOL, fineErr: 2e-6, fineTol: 1e-6 });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/exceeds its tolerance/);
  });

  it("passes a tiny default error whose fine error is within tolerance, whatever the ratio", () => {
    expect(massConvergenceVerdict({ coarseErr: 3.248e-7, coarseTol: 0.0605, fineErr: 4e-7, fineTol: 0.0605 }).ok).toBe(true);
  });

  it("requires the drop only above 1 % of the tolerance (boundary)", () => {
    const at = massConvergenceVerdict({ coarseErr: 0.01 * TOL, coarseTol: TOL, fineErr: 0.01 * TOL, fineTol: TOL });
    expect(at.ok).toBe(true);
    const above = massConvergenceVerdict({ coarseErr: 0.01 * TOL * (1 + 1e-9), coarseTol: TOL, fineErr: 0.01 * TOL, fineTol: TOL });
    expect(above.ok).toBe(false);
  });
});
