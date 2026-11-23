// Door-jet fires in full runs (Requirement 6.14, Property 37, energy balance with jets). The mass ledger hook of the driver
// (RunOptions.massLedger, read-only; a run is bit-identical with and without it) is wrapped to read the work space of every
// accepted step: the jets of each vent, the heat they release and the energy of the gas.
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { CP_J_PER_KG_K, GAMMA } from "../../src/core/fire/constants";
import { LAYER_UPPER, SPECIES_UHC, layerNode, massFraction } from "../../src/core/fire/species/tracker";
import type { Compartment, CompartmentSeries, Result, Scenario, Surface, WallVent } from "../../src/core/fire/types";
import { runLimited } from "./arbitraries";

interface Capture {
  timeS: number;
  jetHrrIntoEndW: [number, number][]; // per vent
  jetNetFuelIntoEndKgS: [number, number][];
  jetHocIntoEndJPerKg: [number, number][];
  transportedUpperFuelOutKgS: [number, number][]; // per vent and end: fuel fraction of the upper layer x routed upper-layer outflow
  doorJetHrrW: number[]; // per compartment, then the Outside
  burnedW: number;
  unburnedKgS: number;
  gasEnergyJ: number;
}
const hooks = vi.hoisted(() => ({ steps: [] as unknown[] }));
vi.mock("../../src/core/fire/massLedger", async (orig) => {
  const m = await orig<typeof import("../../src/core/fire/massLedger")>();
  const { CP_J_PER_KG_K: _cp, GAMMA: gamma } = await import("../../src/core/fire/constants");
  const { LAYER_UPPER: upper, SPECIES_UHC: uhc, layerNode: node, massFraction: frac } = await import("../../src/core/fire/species/tracker");
  const createMassLedger: typeof m.createMassLedger = (model, report) => {
    const inner = m.createMassLedger(model, report);
    const capture = (ws: Parameters<ReturnType<typeof m.createMassLedger>["start"]>[0], timeS: number): void => {
      const transported = model.vents.map((v, vi): [number, number] => {
        const out: [number, number] = [0, 0];
        const r = ws.ventResults[vi];
        for (const k of [0, 1] as const) {
          const c = v.ends[k];
          if (c < 0 || r === null || r === undefined) continue;
          const f = frac(ws.species, node(c, upper), uhc);
          let sum = 0;
          for (const t of r.transfers) if (t.kind === "flow" && t.fromEnd === k && t.fromLayer === "upper") sum += t.massKgS;
          out[k] = f * sum;
        }
        return out;
      });
      let energy = 0;
      model.compartments.forEach((c, i) => {
        const pAbs = model.ambient.pressurePa + (ws.ends[i]?.floorPressurePa ?? 0); // floor elevation 0 in these tests
        energy += (pAbs * c.volumeM3) / (gamma - 1);
      });
      let burned = 0;
      let unburned = 0;
      for (const e of ws.fireEvals) {
        burned += e.hrrW;
        unburned += e.unburnedFuelKgS;
      }
      const rec: Capture = {
        timeS,
        jetHrrIntoEndW: ws.ventJets.map((j) => [j.hrrIntoEndW[0], j.hrrIntoEndW[1]]),
        jetNetFuelIntoEndKgS: ws.ventJets.map((j) => [j.netFuelIntoEndKgS[0], j.netFuelIntoEndKgS[1]]),
        jetHocIntoEndJPerKg: ws.ventJets.map((j) => [j.heatOfCombustionJPerKg[0], j.heatOfCombustionJPerKg[1]]),
        transportedUpperFuelOutKgS: transported,
        doorJetHrrW: Array.from(ws.doorJetHrrW),
        burnedW: burned,
        unburnedKgS: unburned,
        gasEnergyJ: energy,
      };
      hooks.steps.push(rec);
    };
    return {
      start(ws) {
        capture(ws, 0);
        inner.start(ws);
      },
      accept(ws, timeS) {
        capture(ws, timeS);
        inner.accept(ws, timeS);
      },
    };
  };
  return { ...m, createMassLedger };
});

const steps = (): Capture[] => hooks.steps as Capture[];
const concrete = (): Surface => ({
  layers: [{ name: "test-concrete", conductivityWPerMK: 1.75, densityKgPerM3: 2200, specificHeatJPerKgK: 1000, thicknessM: 0.15, emissivity: 0.94 }],
});
const ADIABATIC: Surface = { adiabatic: true };

interface TwoRoomOptions {
  hrrW: number;
  doorWidthM: number;
  doorSoffitM: number;
  durationS: number;
  surface: () => Surface;
  doorJetFires?: boolean;
  hocJPerKg?: number;
  roomAWidthM?: number;
}

/** Room A (3 x 3 x 2.4 m) with a constant fire and a door to the closed room B (4 x 4 x 2.4 m). */
function twoRooms(o: TwoRoomOptions): Scenario {
  const room = (id: string, w: number, d: number): Compartment => ({
    id, widthM: w, depthM: d, heightM: 2.4, floorElevationM: 0, kind: "room", ceiling: o.surface(), floor: o.surface(), walls: o.surface(),
  });
  const door: WallVent = { kind: "wall", id: "door", from: "A", to: "B", sillM: 0, soffitM: o.doorSoffitM, widthM: o.doorWidthM, face: "front", offsetM: 0, open: 1 };
  const vents: WallVent[] = [door];
  const row = (timeS: number) => ({ timeS, hrrW: o.hrrW, heightM: 0.3, areaM2: 0.5, coYield: 0.01, sootYield: 0.02 });
  const s: Scenario = {
    schemaVersion: 1,
    durationS: o.durationS,
    printIntervalS: 0.5,
    seed: 1,
    ambient: { interiorTempK: 293.15, exteriorTempK: 293.15, pressurePa: 101325, species: { o2: 0.2314, co2: 0.0005, co: 0, h2o: 0.0065, soot: 0 } },
    compartments: [room("A", o.roomAWidthM ?? 3, 3), room("B", 4, 4)],
    vents,
    fires: [
      {
        id: "fire", compartmentId: "A", xM: 1.5, yM: 1.5, radiativeFraction: 0.35,
        fuel: { c: 1, h: 4, o: 0, n: 0, cl: 0, heatOfCombustionJPerKg: o.hocJPerKg ?? 50e6 },
        table: [row(0), row(o.durationS)],
      },
    ],
  };
  if (o.doorJetFires !== undefined) s.options = { doorJetFires: o.doorJetFires };
  return s;
}

function runCaptured(s: Scenario): Result {
  hooks.steps = [];
  return runLimited(structuredClone(s), { massLedger: () => {} });
}

const maxOf = (xs: number[]): number => xs.reduce((a, b) => Math.max(a, b), 0);

describe("door-jet fires in full runs (Requirement 6.14)", { timeout: 300_000 }, () => {
  // An under-ventilated fire: 3 MW in a 9 m2 room with a 0.5 m x 1.6 m door, which lets in air for about 1 MW, so much of
  // the fuel leaves room A unburned through the door.
  const BIG = (): TwoRoomOptions => ({ hrrW: 3_000_000, doorWidthM: 0.5, doorSoffitM: 1.6, durationS: 120, surface: concrete });

  it("a jet burns in the receiving room, releases heat to its upper layer, and the option switches it off", () => {
    const on = runCaptured(twoRooms(BIG()));
    expect(on.status).toBe("ok");
    const jetOn = steps().map((c) => c.doorJetHrrW);
    expect(maxOf(jetOn.map((h) => h[1] as number))).toBeGreaterThan(0); // room B (index 1) receives a jet
    // The Result carries it per compartment and sample (Requirement 6.14, CompartmentSeries.doorJetHrrW).
    expect(maxOf(Array.from((on.compartments[1] as CompartmentSeries).doorJetHrrW))).toBeGreaterThan(0);
    expect((on.compartments[0] as CompartmentSeries).doorJetHrrW.length).toBe(on.timesS.length);
    expect(Array.from(on.outsideDoorJetHrrW).every((v) => v === 0)).toBe(true); // no vent to the Outside
    const tOn = (on.compartments[1] as { upperTempK: Float64Array }).upperTempK;

    const off = runCaptured(twoRooms({ ...BIG(), doorJetFires: false }));
    expect(off.status).toBe("ok");
    expect(maxOf(steps().flatMap((c) => c.doorJetHrrW))).toBe(0);
    for (const c of off.compartments) expect(Array.from(c.doorJetHrrW).every((v) => v === 0)).toBe(true); // exactly 0 at every sample
    expect(Array.from(off.outsideDoorJetHrrW).every((v) => v === 0)).toBe(true);
    const tOff = (off.compartments[1] as { upperTempK: Float64Array }).upperTempK;
    expect(maxOf(Array.from(tOn))).toBeGreaterThan(maxOf(Array.from(tOff))); // the jet heats the downstream layer

    // Default is on, as CFAST (option fdfire).
    const dflt = runCaptured(twoRooms(BIG()));
    expect(Array.from((dflt.compartments[1] as { upperTempK: Float64Array }).upperTempK)).toEqual(Array.from(tOn));
  });

  it("a fire with no unburned fuel makes no jet", () => {
    // 50 kW in a big room burns completely in the plume, so no fuel is left to carry through the door.
    const r = runCaptured(twoRooms({ hrrW: 50_000, doorWidthM: 0.9, doorSoffitM: 2.0, durationS: 60, surface: concrete }));
    expect(r.status).toBe("ok");
    expect(maxOf(steps().flatMap((c) => c.doorJetHrrW))).toBe(0);
  });

  it("a jet into the Outside burns outside: its heat is reported for the Outside and added to no compartment", () => {
    // Door of room A straight to the Outside (second vent set up by the first end being A and the second the Outside).
    const s = twoRooms(BIG());
    s.vents = [{ kind: "wall", id: "door", from: "A", to: "OUTSIDE", sillM: 0, soffitM: 1.6, widthM: 0.5, face: "front", offsetM: 0, open: 1 }];
    const on = runCaptured(s);
    expect(on.status).toBe("ok");
    const outside = steps().map((c) => c.doorJetHrrW[2] as number);
    const compartments = steps().flatMap((c) => [c.doorJetHrrW[0] as number, c.doorJetHrrW[1] as number]);
    expect(maxOf(outside)).toBeGreaterThan(0);
    expect(maxOf(compartments)).toBe(0);
    expect(maxOf(Array.from(on.outsideDoorJetHrrW))).toBeGreaterThan(0); // reported separately in the Result, as CFAST does
    for (const c of on.compartments) expect(maxOf(Array.from(c.doorJetHrrW))).toBe(0);
    // With the jets off the temperatures are bit-identical: a jet to the Outside changes nothing inside.
    const off = runCaptured({ ...s, options: { doorJetFires: false } });
    expect(Array.from((on.compartments[0] as { upperTempK: Float64Array }).upperTempK)).toEqual(
      Array.from((off.compartments[0] as { upperTempK: Float64Array }).upperTempK),
    );
  });

  it("energy balance with jets on: the gas energy of two closed rooms with adiabatic surfaces gains the heat of the fire and of the jets", () => {
    // Extends Property 31 (energy part). Both rooms are closed except the door between them, every surface is adiabatic,
    // so the energy gained by the gas is the heat released by the fire plus the enthalpy of the unburned fuel (design Fire
    // modules step 8) plus the heat of the door jet (Requirement 6.14). Integrals use the trapezoid rule on the accepted steps.
    const r = runCaptured(twoRooms({ ...BIG(), surface: () => ADIABATIC, durationS: 60 }));
    expect(r.status).toBe("ok");
    const st = steps();
    const tAmb = 293.15;
    let released = 0;
    let fuelEnthalpy = 0;
    let jetHeat = 0;
    const e0 = (st[0] as Capture).gasEnergyJ;
    let worst = 0;
    for (let k = 1; k < st.length; k++) {
      const a = st[k - 1] as Capture;
      const b = st[k] as Capture;
      const h = b.timeS - a.timeS;
      released += 0.5 * (a.burnedW + b.burnedW) * h;
      fuelEnthalpy += 0.5 * CP_J_PER_KG_K * tAmb * (a.unburnedKgS + b.unburnedKgS) * h;
      jetHeat += 0.5 * ((a.doorJetHrrW[0] as number) + (a.doorJetHrrW[1] as number) + (b.doorJetHrrW[0] as number) + (b.doorJetHrrW[1] as number)) * h;
      const dE = b.gasEnergyJ - e0;
      const total = released + fuelEnthalpy + jetHeat;
      worst = Math.max(worst, Math.abs(total - dE) / Math.max(total, 1));
    }
    expect(jetHeat).toBeGreaterThan(0); // the jets took part in the balance
    expect(worst).toBeLessThanOrEqual(0.02);
  });

  // Feature: fire-zone, Property 37: Door-jet heat release bounded by transported fuel
  it("Property 37: door-jet heat release is bounded by the heat of combustion times the transported fuel", () => {
    // **Validates: Requirements 6.14**
    // For every accepted step of every generated two-room scenario and for each jet: 0 <= heat release <= (heat of
    // combustion of the unburned fuel) x (fuel mass flow in the jet), and that fuel flow is at most the unburned-fuel share of
    // the upper-layer outflow of the sending room through the vent (the flow routed by the vent code, an independent sum).
    // Two closed rooms and one door: a window to the Outside makes some generated runs stiff (about 10 s of wall time,
    // with the jets on or off), which is a solver matter outside this property. A jet into the Outside has its own test.
    let jetsSeen = 0;
    fc.assert(
      fc.property(
        fc.record({
          hrrKw: fc.integer({ min: 300, max: 3000 }),
          doorWidthM: fc.integer({ min: 4, max: 15 }).map((n) => n / 10),
          doorSoffitM: fc.integer({ min: 14, max: 22 }).map((n) => n / 10),
          hocMj: fc.integer({ min: 20, max: 50 }),
          roomAWidthM: fc.integer({ min: 2, max: 5 }),
        }),
        (g) => {
          const s = twoRooms({
            hrrW: g.hrrKw * 1000,
            doorWidthM: g.doorWidthM,
            doorSoffitM: g.doorSoffitM,
            durationS: 40,
            surface: concrete,
            hocJPerKg: g.hocMj * 1e6,
            roomAWidthM: g.roomAWidthM,
          });
          const r = runCaptured(s);
          expect(r.status).toBe("ok");
          for (const c of steps()) {
            c.jetHrrIntoEndW.forEach((hrr, vi) => {
              for (const end of [0, 1] as const) {
                const q = hrr[end] as number;
                const net = (c.jetNetFuelIntoEndKgS[vi] as [number, number])[end];
                const hoc = (c.jetHocIntoEndJPerKg[vi] as [number, number])[end];
                const sender = end === 0 ? 1 : 0;
                const routed = (c.transportedUpperFuelOutKgS[vi] as [number, number])[sender];
                expect(q).toBeGreaterThanOrEqual(0);
                expect(q).toBeLessThanOrEqual(hoc * net * (1 + 1e-9) + 1e-9);
                expect(net).toBeLessThanOrEqual(routed * (1 + 1e-9) + 1e-15);
                if (q > 0) jetsSeen++;
              }
            });
          }
        },
      ),
      { numRuns: 100 },
    );
    expect(jetsSeen).toBeGreaterThan(0); // the property was not vacuous
  });
});
