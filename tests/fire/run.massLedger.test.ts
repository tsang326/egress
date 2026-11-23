// RunOptions.massLedger is test-only and must not change any result (types.ts).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runFire } from "../../src/core/fire";
import type { MassLedgerStep, Scenario } from "../../src/core/fire/types";
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

describe("RunOptions.massLedger has no effect on results", () => {
  const scenarios = fc.sample(
    arbScenario({ maxCompartments: 2, maxFires: 1, maxVents: 2 }).map((s) => ({ ...s, durationS: Math.min(s.durationS, 20), printIntervalS: Math.min(s.printIntervalS, 20) })),
    { seed: 31, numRuns: 4 },
  ) as Scenario[];

  it("gives bit-identical numbers, warnings, stats and step sequence with and without massLedger", () => {
    for (const s of scenarios) {
      const steps: MassLedgerStep[] = [];
      const without = runFire(structuredClone(s), { recordSteps: true });
      const withLedger = runFire(structuredClone(s), { recordSteps: true, massLedger: (e) => void steps.push(e) });
      expect(same(without, withLedger)).toBe(true);
      expect(steps.length).toBe(without.stats.steps); // one report per accepted step
      let prev = 0;
      for (const e of steps) {
        expect(e.timeS).toBeGreaterThan(prev);
        prev = e.timeS;
      }
    }
  });
});
