// Regression test for Requirement 9.9 (tasks.md 10.5): FIRE_PLUME_PASSES_NOT_CONVERGED.
// The scenario is the Property 29 counterexample of fast-check seed 953521908, path "65" (before shrinking), copied
// here so that a later change to the generators cannot change it. It is a closed 2.1 x 2.2 x 3.9 m concrete room at
// floor elevation 8 m, two wall vents with open fractions of about 1e-71 and 1e-130, and two methane-like fires
// (174 kW rising to 440 kW, and 106 kW, then 499 kW), 78 s. Measured with the current numerics (CFAST tolerances,
// task 10.5): the smoke layer interface first has a lower plume height within 1 mm of the 0.3 m fire base at 27.3 s,
// is below the base from the step ending at 27.76 s, stays below it, rises back and is within 1 mm of it again at
// 51.14 s. The run then finishes (status "ok") at 78 s with the interface 0.005 mm above the base (0.3000054 m). An
// earlier version stopped at 51.26 s with SOLVER_STEP_TOO_SMALL and FIRE_PLUME_PASSES_NOT_CONVERGED, where the five
// plume and chemistry passes of CFAST do_fire do not converge; the stopped-run branches below still cover that case.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Result, Scenario, Surface } from "../../src/core/fire/types";
import { runLimited } from "./arbitraries";

// Test-only hooks.
// 1. The solver reports an h-min failure (Requirement 9.6) at the first advance that starts at or after `failFromS`.
//    The physics is unchanged up to that point.
// 2. The mass ledger (RunOptions.massLedger, read-only, bit-identical Result) is wrapped to read, at every accepted
//    step, the lower plume height of each fire from the same evaluation the Requirement 9.9 check reads at a failure.
const hooks = vi.hoisted(() => ({ failFromS: Infinity, steps: [] as { timeS: number; lowerPlumeHeightsM: number[] }[] }));
vi.mock("../../src/core/fire/solver/stepControl", async (orig) => {
  const m = await orig<typeof import("../../src/core/fire/solver/stepControl")>();
  class HookedSolver extends m.ImplicitSolver {
    override advance(tEnd: number, hMax?: number) {
      if (this.t >= hooks.failFromS) return { ok: false as const, reason: "h-min" as const, t: this.t, h: 0 };
      return super.advance(tEnd, hMax);
    }
  }
  return { ...m, ImplicitSolver: HookedSolver };
});
vi.mock("../../src/core/fire/massLedger", async (orig) => {
  const m = await orig<typeof import("../../src/core/fire/massLedger")>();
  const createMassLedger: typeof m.createMassLedger = (model, report) => {
    const inner = m.createMassLedger(model, report);
    return {
      start: (ws) => inner.start(ws),
      accept(ws, timeS) {
        hooks.steps.push({ timeS, lowerPlumeHeightsM: ws.fireEvals.map((e) => e.lowerPlumeHeightM) });
        inner.accept(ws, timeS);
      },
    };
  };
  return { ...m, createMassLedger };
});
beforeEach(() => {
  hooks.failFromS = Infinity;
  hooks.steps = [];
});

// Same concrete-like layer as tests/fire/arbitraries.ts (generic estimate for tests only).
const concrete = (): Surface => ({
  layers: [
    { name: "test-concrete", conductivityWPerMK: 1.75, densityKgPerM3: 2200, specificHeatJPerKgK: 1000, thicknessM: 0.15, emissivity: 0.94 },
  ],
});
const row = (timeS: number, hrrW: number) => ({ timeS, hrrW, heightM: 0.3, areaM2: 0.5, coYield: 0.01, sootYield: 0.02 });

const SEED_953521908: Scenario = {
  schemaVersion: 1,
  durationS: 78,
  printIntervalS: 1.56,
  seed: 1,
  ambient: {
    interiorTempK: 293.15,
    exteriorTempK: 293.15,
    pressurePa: 101325,
    species: { o2: 0.2314, co2: 0.0005, co: 0, h2o: 0.0065, soot: 0 },
  },
  compartments: [
    { id: "c0", widthM: 2.1, depthM: 2.2, heightM: 3.9, floorElevationM: 8, kind: "room", ceiling: concrete(), floor: concrete(), walls: concrete() },
  ],
  vents: [
    { kind: "wall", id: "vent0", from: "c0", to: "OUTSIDE", sillM: 1.6157691062095067e-25, soffitM: 0.6242924205409243, widthM: 0.47927822963876593, face: "front", offsetM: 0, open: 1.1100239482549332e-71 },
    { kind: "wall", id: "vent1", from: "c0", to: "OUTSIDE", sillM: 6e-323, soffitM: 1.4999999999999964, widthM: 0.491357981085004, face: "left", offsetM: 0, open: 5.110666831354721e-130 },
  ],
  fires: [
    {
      id: "fire0", compartmentId: "c0", xM: 0.9332060688173416, yM: 0.42744598509521364, radiativeFraction: 0.35,
      fuel: { c: 1, h: 4, o: 0, n: 0, cl: 0, heatOfCombustionJPerKg: 48e6 },
      table: [row(0, 174_000), row(39, 440_000), row(71.75999999999999, 208_000), row(73.32, 114_000), row(96.33, 404_000)],
    },
    {
      id: "fire1", compartmentId: "c0", xM: 0.21000000000000013, yM: 0.22000000000000025, radiativeFraction: 0.4,
      fuel: { c: 1, h: 4, o: 0, n: 0, cl: 0, heatOfCombustionJPerKg: 50e6 },
      table: [row(0, 106_000), row(39, 7_000), row(39.78, 499_000), row(42.51, 499_000), row(44.46, 4_000)],
    },
  ],
};

// Each run is aborted at its own 10 s limit (runLimited, Requirement 14.9). The Vitest per-test timeouts below are one
// such limit plus margin per run in the test; they do not lengthen the run limit.
const RUN_LIMIT_MS = 10_000;
const TEST_TIMEOUT_1_RUN_MS = RUN_LIMIT_MS + 5_000;
const TEST_TIMEOUT_2_RUNS_MS = 2 * RUN_LIMIT_MS + 5_000;
const PLUME_BASE_TOL_M = 1e-3; // Requirement 9.9: lower plume height at most 1 mm

// The massLedger option only switches on the read-only ledger wrapped above; the Result is bit-identical without it.
const run = (): Result => runLimited(structuredClone(SEED_953521908), { massLedger: () => {} });

/**
 * End time of the first accepted step of the last run at which some fire has a lower plume height in (0, 1 mm]: the
 * interface is within 1 mm above the fire base (Requirement 9.9). At or below 0 the interface is under the base, the
 * lower-layer passes are not run (heatRelease.ts), so they cannot fail to converge there. Null if no step qualifies.
 */
function firstStepAtFireBase(): number | null {
  for (const s of hooks.steps) if (s.lowerPlumeHeightsM.some((h) => h > 0 && h <= PLUME_BASE_TOL_M)) return s.timeS;
  return null;
}

/** Every sample of `a` equals the same sample of `b` bit for bit (Object.is). */
function samplesArePrefix(a: Result, b: Result): boolean {
  const same = (x: ArrayLike<number>, y: ArrayLike<number>): boolean => {
    for (let k = 0; k < a.timesS.length; k++) if (!Object.is(x[k], y[k])) return false;
    return true;
  };
  if (!same(a.timesS, b.timesS)) return false;
  return a.compartments.every((ca, i) => {
    const cb = b.compartments[i]!;
    return (
      same(ca.upperTempK, cb.upperTempK) && same(ca.lowerTempK, cb.lowerTempK) && same(ca.interfaceHeightM, cb.interfaceHeightM) &&
      same(ca.pressurePa, cb.pressurePa) && same(ca.upper.o2, cb.upper.o2) && same(ca.lower.o2, cb.lower.o2)
    );
  });
}

describe("Requirement 9.9: fire at the smoke layer interface (seed 953521908)", () => {
  it("unforced, the run finishes; it may only fail with FIRE_PLUME_PASSES_NOT_CONVERGED (Property 29)", () => {
    const r = run();
    if (r.status === "failed") {
      expect(r.warnings.map((w) => w.code)).toContain("FIRE_PLUME_PASSES_NOT_CONVERGED");
    } else {
      expect(r.status).toBe("ok");
    }
    // The interface reaches the 0.3 m fire base (lower plume height at most 1 mm) before the end. A run that finishes
    // (seen in an earlier version with the species synchronisation of Requirement 8.10: 0.30001 m at 78 s) is checked
    // at its end sample against the 1 mm plume height of Requirement 9.9.
    // Reason for 5 mm on a stopped run: a failed run keeps only the samples before the failing step (Requirement 9.6),
    // and samples are 1.56 s apart, so the last kept sample can be up to one interval before the interface arrives at
    // the base. Measured values: before the synchronisation the solver stopped at about 50.9 s with the last kept
    // sample (49.92 s) 2.6 mm below the base; with an intermediate version of the numerics it stopped at 51.26 s with
    // the interface 0.13 mm above the base and the last kept sample (49.92 s) 4.94 mm below it. With the current
    // numerics (CFAST tolerances, task 10.5) the run finishes at 78 s with the interface 0.005 mm above the base, so
    // the stopped-run tolerance is not used here. The check only shows that the run ended with the interface at the
    // fire base, which is the situation of Requirement 9.9; 5 mm is far below the 0.3 m base height.
    const z = r.compartments[0]!.interfaceHeightM;
    expect(Math.abs((z[z.length - 1] as number) - 0.3)).toBeLessThanOrEqual(r.status === "failed" ? 5e-3 : PLUME_BASE_TOL_M);
  }, TEST_TIMEOUT_1_RUN_MS);

  it("a step-size failure with the interface at the fire base adds the warning next to SOLVER_STEP_TOO_SMALL and keeps the samples", () => {
    const full = run();
    // Requirement 9.9 applies once the lower plume height is at most 1 mm, not at a fixed time. The hook time is read
    // from the unforced run: the end of its first accepted step with a lower plume height in (0, 1 mm] (27.3 s
    // with the current numerics). The forced failure is at the first advance that starts at or after it, so the
    // failing state has the interface at the fire base.
    const tBase = firstStepAtFireBase();
    expect(tBase).not.toBeNull();
    hooks.failFromS = tBase as number;
    hooks.steps = [];
    const r = run();
    expect(r.status).toBe("failed");
    const step = r.warnings.filter((w) => w.code === "SOLVER_STEP_TOO_SMALL");
    expect(step.length).toBe(1);
    const tFail = step[0]!.timeS as number;
    expect(tFail).toBeGreaterThanOrEqual(tBase as number);
    // The failing state is the last accepted step of the forced run; its lower plume height is within 1 mm.
    const last = hooks.steps[hooks.steps.length - 1]!;
    expect(last.timeS).toBe(tFail);
    expect(last.lowerPlumeHeightsM.some((h) => h > 0 && h <= PLUME_BASE_TOL_M)).toBe(true);
    const plume = r.warnings.filter((w) => w.code === "FIRE_PLUME_PASSES_NOT_CONVERGED");
    expect(plume.length).toBeGreaterThanOrEqual(1);
    for (const w of plume) {
      expect(w.timeS).toBe(tFail);
      expect(w.location.kind).toBe("fire");
      expect(["fire0", "fire1"]).toContain(w.location.id);
      expect(w.message).toContain(`"${w.location.id}"`);
      expect(w.message).toContain('compartment "c0"');
      expect(w.message).toContain(`${tFail} s`);
    }
    // Samples before the failure are kept, unchanged.
    expect(r.timesS.length).toBeGreaterThan(1);
    // An unforced run that also stops (see the first test) may have the same samples.
    expect(r.timesS.length).toBeLessThanOrEqual(full.timesS.length);
    expect(r.timesS[r.timesS.length - 1] as number).toBeLessThanOrEqual(tFail);
    expect(samplesArePrefix(r, full)).toBe(true);
  }, TEST_TIMEOUT_2_RUNS_MS);

  it("a step-size failure while the interface is far above the fire base gives only SOLVER_STEP_TOO_SMALL", () => {
    hooks.failFromS = 5; // the interface is still above 1.2 m at 5 s
    const r = run();
    expect(r.status).toBe("failed");
    expect(r.warnings.map((w) => w.code)).toEqual(["SOLVER_STEP_TOO_SMALL"]);
  }, TEST_TIMEOUT_1_RUN_MS);
});
