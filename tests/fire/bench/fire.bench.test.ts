// Performance benchmark (task 19.1, Requirement 11.8, design "Performance strategy").
// Opt-in: runs only with FIRE_BENCH=1 (`npm run test:bench`), so `npm test` stays fast and machine-independent.
// Fixed Scenario: 30 compartments on 6 floors, 60 vents, 600 s, print interval 1 s. It runs through the worker_threads
// adapter (same handler as the browser Worker, Requirement 11.7). The median of 5 runs of start-message to
// result-message wall time must stay under 5 s.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validate } from "../../../src/core/fire/validate/validate";
import type { Compartment, Fire, Result, Scenario, Surface, Vent } from "../../../src/core/fire/types";
import { runFireInWorker, type WorkerFactory } from "../../../src/web/fire/fireClient";
import { disposeNodeWorkerBundle, prepareNodeWorker } from "../worker/nodeWorkerAdapter";

const ENABLED = process.env["FIRE_BENCH"] === "1";

const RUNS = 5;
const BUDGET_MS = 5000; // Requirement 11.8
const FLOORS = 6;
const ROOMS_PER_FLOOR = 5;
const FLOOR_HEIGHT_M = 3;
const DURATION_S = 600;

// Generic concrete-like construction (estimate for the benchmark only; not a measured building).
const surface = (): Surface => ({
  layers: [
    {
      name: "bench-concrete",
      conductivityWPerMK: 1.75,
      densityKgPerM3: 2200,
      specificHeatJPerKgK: 1000,
      thicknessM: 0.15,
      emissivity: 0.94,
    },
  ],
});

const cid = (floor: number, room: number): string => `c${floor}_${room}`;

/** 30 compartments (6 floors x 5 rooms), 60 vents, one growing fire on the ground floor. */
export function buildBenchScenario(): Scenario {
  const compartments: Compartment[] = [];
  for (let f = 0; f < FLOORS; f++) {
    for (let k = 0; k < ROOMS_PER_FLOOR; k++) {
      compartments.push({
        id: cid(f, k),
        widthM: 5,
        depthM: 4,
        heightM: FLOOR_HEIGHT_M,
        floorElevationM: f * FLOOR_HEIGHT_M,
        kind: "room",
        ceiling: surface(),
        floor: surface(),
        walls: surface(),
      });
    }
  }

  const vents: Vent[] = [];
  const wall = (from: string, to: string, face: "front" | "right", offsetM: number): void => {
    vents.push({
      kind: "wall",
      id: `v${vents.length}`,
      from,
      to,
      sillM: 0,
      soffitM: 2,
      widthM: 0.9,
      face,
      offsetM,
      open: 1,
    });
  };
  for (let f = 0; f < FLOORS; f++) {
    // Doors between neighbours (4) and between rooms two apart (3): 7 per floor, 42 in all.
    for (let k = 0; k + 1 < ROOMS_PER_FLOOR; k++) wall(cid(f, k), cid(f, k + 1), "right", 1);
    for (let k = 0; k + 2 < ROOMS_PER_FLOOR; k++) wall(cid(f, k), cid(f, k + 2), "front", 2);
  }
  // Stair-like openings between floors in rooms 0 and 1: 10. (With the openings in rooms 0 and 4 instead, the run
  // stopped with SPECIES_OUT_OF_RANGE, upper-layer o2 in c1_4, at 27 s for a 1 MW fire and at 86 s for 100 kW.)
  for (const k of [0, 1]) {
    for (let f = 0; f + 1 < FLOORS; f++) {
      vents.push({
        kind: "ceilingFloor",
        id: `v${vents.length}`,
        lower: cid(f, k),
        upper: cid(f + 1, k),
        areaM2: 1,
        shape: "square",
        open: 1,
      });
    }
  }
  // Doors and windows to the Outside: 8 (5 on the ground floor, 3 on the top floor).
  for (let k = 0; k < ROOMS_PER_FLOOR; k++) wall(cid(0, k), "OUTSIDE", "front", 3);
  for (let k = 0; k < 3; k++) wall(cid(FLOORS - 1, k), "OUTSIDE", "front", 3);

  const fire: Fire = {
    id: "fire0",
    compartmentId: cid(0, 0),
    xM: 2.5,
    yM: 2,
    radiativeFraction: 0.35,
    // Methane-like fuel, 20 MJ/kg: estimate for the benchmark only.
    fuel: { c: 1, h: 4, o: 0, n: 0, cl: 0, heatOfCombustionJPerKg: 20e6 },
    table: [
      { timeS: 0, hrrW: 0, heightM: 0.3, areaM2: 0.5, coYield: 0.01, sootYield: 0.02 },
      { timeS: 300, hrrW: 1e5, heightM: 0.3, areaM2: 0.5, coYield: 0.01, sootYield: 0.02 },
      { timeS: DURATION_S, hrrW: 1e5, heightM: 0.3, areaM2: 0.5, coYield: 0.01, sootYield: 0.02 },
    ],
  };

  return {
    schemaVersion: 1,
    title: "benchmark: 30 compartments, 6 floors, 60 vents",
    durationS: DURATION_S,
    printIntervalS: 1,
    seed: 1,
    ambient: {
      interiorTempK: 293.15,
      exteriorTempK: 293.15,
      pressurePa: 101325,
      species: { o2: 0.2314, co2: 0.0005, co: 0, h2o: 0.0065, soot: 0 },
    },
    compartments,
    vents,
    fires: [fire],
  };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

describe.skipIf(!ENABLED)("fire benchmark (FIRE_BENCH=1)", () => {
  let factory: WorkerFactory;
  beforeAll(async () => {
    factory = await prepareNodeWorker();
  });
  afterAll(async () => {
    await disposeNodeWorkerBundle();
  });

  it("the benchmark Scenario has the specified size and passes validate()", () => {
    const s = buildBenchScenario();
    expect(s.compartments).toHaveLength(30);
    expect(new Set(s.compartments.map((c) => c.floorElevationM)).size).toBe(6);
    expect(s.vents).toHaveLength(60);
    const v = validate(s);
    expect(v.warnings.filter((w) => w.severity === "error")).toEqual([]);
    expect(v.valid).toBe(true);
  });

  it(
    `median of ${RUNS} runs stays under ${BUDGET_MS / 1000} s`,
    async () => {
      const times: number[] = [];
      let last: Result | undefined;
      for (let i = 0; i < RUNS; i++) {
        const scenario = buildBenchScenario();
        const t0 = performance.now(); // start message is posted inside runFireInWorker
        const result = await runFireInWorker(scenario, () => {}, factory);
        times.push(performance.now() - t0);
        // A failed or invalid run fails the bench, whatever its time.
        expect(result.status, JSON.stringify(result.warnings.slice(0, 3))).toBe("ok");
        last = result;
      }
      const med = median(times);
      const st = last!.stats;
      console.log(
        [
          `fire bench: runs (ms) = ${times.map((t) => t.toFixed(0)).join(", ")}`,
          `fire bench: median = ${med.toFixed(0)} ms (budget ${BUDGET_MS} ms)`,
          `fire bench: steps = ${st.steps}, rejected = ${st.rejected}, newton iterations = ${st.newtonIterations}, newton failures = ${st.newtonFailures}, jacobians = ${st.jacobians}, residual evaluations = ${st.residualEvals}`,
        ].join("\n"),
      );
      expect(med).toBeLessThan(BUDGET_MS);
    },
    300_000,
  );
});
