// RunOptions.checkpoint is test-only and must not change any result (types.ts).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runFire } from "../../src/core/fire";
import type { Scenario } from "../../src/core/fire/types";
import { arbScenario } from "./arbitraries";

/** Bit-level deep equality: Object.is on every number, typed arrays and plain objects compared structurally. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = a as unknown as ArrayLike<number>;
    const y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && same((a as never)[k], (b as never)[k]));
  }
  return false;
}

describe("RunOptions.checkpoint has no effect on results", () => {
  const scenarios = fc.sample(
    arbScenario({ maxCompartments: 2, maxFires: 1, maxVents: 2 }).map((s) => ({ ...s, durationS: Math.min(s.durationS, 20), printIntervalS: Math.min(s.printIntervalS, 20) })),
    { seed: 31, numRuns: 4 },
  ) as Scenario[];

  it("gives bit-identical numbers, warnings and step sequence with and without checkpoint", () => {
    for (const s of scenarios) {
      let calls = 0;
      const without = runFire(structuredClone(s), { recordSteps: true });
      const withCp = runFire(structuredClone(s), { recordSteps: true, checkpoint: () => void calls++ });
      expect(same(without, withCp)).toBe(true);
      expect(without.stats.stepSizesS?.length ?? 0).toBe(withCp.stats.stepSizesS?.length ?? 0);
      if (without.stats.steps > 0) expect(calls).toBeGreaterThanOrEqual(without.stats.steps);
      // Requirement 13.14: the hook is also called at every residual evaluation the solver makes.
      expect(calls).toBeGreaterThanOrEqual(without.stats.residualEvals);
    }
  });

  it("stops a run inside one step: a hook that throws at its k-th call ends the run before the next step", () => {
    const s = scenarios.find((x) => runFire(structuredClone(x)).stats.steps > 2);
    if (s === undefined) return;
    const total = runFire(structuredClone(s)).stats.residualEvals;
    let calls = 0;
    const stopAt = Math.max(2, Math.floor(total / 2));
    const r = runFire(structuredClone(s), {
      checkpoint: () => {
        if (++calls === stopAt) throw new Error("limit");
      },
    });
    expect(r.status).toBe("failed");
    expect(calls).toBe(stopAt); // no call after the throw: the run ended at once
    expect(r.warnings.some((w) => w.code === "INTERNAL_ERROR")).toBe(true);
  });
});
