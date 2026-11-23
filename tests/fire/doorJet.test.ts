// Door-jet (vent-jet) fire modules, Requirement 6.14: CFAST 7.7.7 fire.f90, do_fire lines 423-439 (unburned-fuel record),
// vent_jet_fire lines 780-845, and flowhorizontal.f90 (ventw, spill_plume) for the flows that feed the jets.
import { describe, expect, it } from "vitest";
import { HEAT_PER_KG_OXYGEN_J_PER_KG, LOWER_OXYGEN_LIMIT } from "../../src/core/fire/constants";
import { fuelMolarMassKgPerMol, speciesRates, stoichiometry } from "../../src/core/fire/fire/chemistry";
import { cfastChemistry, unburnedFuelRecord, ventJetFire, type VentJetInput } from "../../src/core/fire/fire/ventJet";
import {
  CARRIED_COUNT,
  CARRIED_FUEL_CO,
  CARRIED_FUEL_CO2,
  CARRIED_FUEL_H2O,
  CARRIED_FUEL_MOLES,
  CARRIED_FUEL_N2,
  CARRIED_FUEL_O2,
  CARRIED_FUEL_Q,
  CARRIED_FUEL_SOOT,
  SPECIES_COUNT,
  createSpeciesState,
  updateSpecies,
  synchroniseSpecies,
  createSpeciesSyncChange,
} from "../../src/core/fire/species/tracker";
import { wallVentFlows } from "../../src/core/fire/vents/wallVent";
import type { VentEndState } from "../../src/core/fire/vents/ventTypes";

const METHANE = { c: 1, h: 4, o: 0, n: 0, cl: 0 };
const YIELDS = { coYield: 0.01, sootYield: 0.02 };
const HOC = 50e6; // J/kg
const IGNITION_K = 293.15 + 200;

/** Record of 0.01 kg/s of unburned methane accumulated over 100 s: 1 kg of fuel in the layer, with its record. */
function layerWithRecord(): { upperFuelKg: number; carried: Float64Array } {
  const rate = unburnedFuelRecord(0.01, HOC, METHANE, YIELDS);
  const carried = Float64Array.from(rate, (r) => r * 100);
  return { upperFuelKg: 1, carried };
}

function jetInput(over: Partial<VentJetInput> = {}): VentJetInput {
  const { upperFuelKg, carried } = layerWithRecord();
  return {
    netFuelKgS: 0.005,
    entrainmentKgS: 2,
    jetTempK: 700,
    ignitionTempK: IGNITION_K,
    sourceO2: 0.2314,
    upperFuelKg,
    carried,
    ...over,
  };
}

describe("unburned-fuel record (fire.f90, do_fire lines 423-439)", () => {
  it("records moles, potential heat and the products of complete combustion; fuel and O2 balance the products", () => {
    const rec = unburnedFuelRecord(0.01, HOC, METHANE, YIELDS);
    const mF = fuelMolarMassKgPerMol(METHANE);
    expect(rec[CARRIED_FUEL_MOLES]).toBeCloseTo(0.01 / mF, 12);
    expect(rec[CARRIED_FUEL_Q]).toBeCloseTo(0.01 * HOC, 6);
    const nu = stoichiometry(METHANE, { ...YIELDS, hcnYield: 0 });
    const r = speciesRates(0.01, METHANE, nu);
    expect(rec[CARRIED_FUEL_O2]).toBeCloseTo(-r.o2, 12);
    expect(rec[CARRIED_FUEL_CO2]).toBeCloseTo(r.co2, 12);
    expect(rec[CARRIED_FUEL_CO]).toBeCloseTo(r.co, 12);
    expect(rec[CARRIED_FUEL_H2O]).toBeCloseTo(r.h2o, 12);
    expect(rec[CARRIED_FUEL_SOOT]).toBeCloseTo(r.soot, 12);
    expect(rec[CARRIED_FUEL_N2]).toBeCloseTo(r.n2, 12);
    // Mass balance of the record: 0.01 kg/s of fuel plus the O2 it needs is what the products weigh.
    const products = rec[CARRIED_FUEL_CO2]! + rec[CARRIED_FUEL_CO]! + rec[CARRIED_FUEL_H2O]! + rec[CARRIED_FUEL_SOOT]! + rec[CARRIED_FUEL_N2]!;
    expect(products).toBeCloseTo(0.01 + rec[CARRIED_FUEL_O2]!, 10);
  });

  it("is all zero when no fuel is left unburned", () => {
    expect(Array.from(unburnedFuelRecord(0, HOC, METHANE, YIELDS))).toEqual(new Array(CARRIED_COUNT).fill(0));
  });
});

describe("vent_jet_fire (fire.f90 lines 780-845)", () => {
  it("makes no jet below the ignition temperature and makes one at it", () => {
    expect(ventJetFire(jetInput({ jetTempK: IGNITION_K - 0.001 })).active).toBe(false);
    expect(ventJetFire(jetInput({ jetTempK: IGNITION_K - 0.001 })).hrrW).toBe(0);
    expect(ventJetFire(jetInput({ jetTempK: IGNITION_K })).active).toBe(true);
  });

  it("makes no jet without entrained air, without fuel in the flow, or without a record of fuel", () => {
    expect(ventJetFire(jetInput({ entrainmentKgS: 0 })).active).toBe(false);
    expect(ventJetFire(jetInput({ netFuelKgS: 0 })).active).toBe(false);
    expect(ventJetFire(jetInput({ carried: new Float64Array(CARRIED_COUNT) })).active).toBe(false);
    expect(ventJetFire(jetInput({ upperFuelKg: 0 })).active).toBe(false);
  });

  it("releases no heat when the oxygen of the receiving lower layer is at the limit, and burns nothing from the record", () => {
    const r = ventJetFire(jetInput({ sourceO2: LOWER_OXYGEN_LIMIT }));
    expect(r.active).toBe(true);
    expect(r.hrrW).toBe(0);
    expect(r.burnedFuelKgS).toBe(0);
    for (const x of r.carriedRates) expect(Math.abs(x)).toBe(0);
  });

  it("with plenty of air burns all the fuel of the flow: heat is fuel x heat of combustion, products are those of the record", () => {
    const r = ventJetFire(jetInput());
    expect(r.hrrW).toBeCloseTo(0.005 * HOC, 4);
    expect(r.burnedFuelKgS).toBeCloseTo(0.005, 12);
    const nu = stoichiometry(METHANE, { ...YIELDS, hcnYield: 0 });
    const want = speciesRates(0.005, METHANE, nu);
    expect(r.rates.fuel).toBeCloseTo(want.fuel, 12);
    expect(r.rates.o2).toBeCloseTo(want.o2, 12);
    expect(r.rates.co2).toBeCloseTo(want.co2, 12);
    expect(r.rates.co).toBeCloseTo(want.co, 12);
    expect(r.rates.h2o).toBeCloseTo(want.h2o, 12);
    expect(r.rates.soot).toBeCloseTo(want.soot, 12);
  });

  it("conserves mass and energy: the species rates of the chemistry net to zero, and the heat is the burned fuel x hoc", () => {
    const r = ventJetFire(jetInput());
    const net = r.rates.fuel + r.rates.o2 + r.rates.co2 + r.rates.co + r.rates.h2o + r.rates.soot + r.rates.hcl + r.rates.hcn + r.rates.n2;
    expect(Math.abs(net)).toBeLessThan(1e-12);
    expect(r.hrrW).toBeCloseTo(r.burnedFuelKgS * HOC, 4);
  });

  it("is limited by the entrained oxygen: heat = entrained air x O2 fraction x 13.1 MJ/kg", () => {
    const y = 0.2314;
    const r = ventJetFire(jetInput({ entrainmentKgS: 0.01, sourceO2: y }));
    // The 13.1 MJ/kg rule gives the upper bound; the stoichiometric O2 of that burn is a little above the O2 entrained,
    // so the burn is scaled down until it uses exactly the entrained O2 (chemistry lines 599-614).
    expect(r.hrrW).toBeLessThanOrEqual(0.01 * y * HEAT_PER_KG_OXYGEN_J_PER_KG);
    expect(r.hrrW).toBeGreaterThan(0.9 * 0.01 * y * HEAT_PER_KG_OXYGEN_J_PER_KG);
    expect(-r.rates.o2).toBeCloseTo(0.01 * y, 12);
    expect(r.hrrW).toBeLessThan(0.005 * HOC);
  });

  it("takes the burned share out of the record of moles, heat and products, and, as CFAST does, not out of soot and N2", () => {
    const { upperFuelKg, carried } = layerWithRecord();
    const r = ventJetFire(jetInput());
    const share = r.burnedFuelKgS / upperFuelKg;
    expect(r.carriedRates[CARRIED_FUEL_MOLES]).toBeCloseTo(-share * (carried[CARRIED_FUEL_MOLES] as number), 9);
    expect(r.carriedRates[CARRIED_FUEL_Q]).toBeCloseTo(-share * (carried[CARRIED_FUEL_Q] as number), 3);
    expect(r.carriedRates[CARRIED_FUEL_O2]).toBeCloseTo(-share * (carried[CARRIED_FUEL_O2] as number), 12);
    expect(r.carriedRates[CARRIED_FUEL_SOOT]).toBe(0);
    expect(r.carriedRates[CARRIED_FUEL_N2]).toBe(0);
    // Burning at the rate of the record's own heat of combustion: heat removed from the record equals the heat released.
    expect(-(r.carriedRates[CARRIED_FUEL_Q] as number)).toBeCloseTo(r.hrrW, 3);
  });
});

describe("cfastChemistry (fire.f90, chemistry lines 543-630)", () => {
  it("scales every rate down when the products need more oxygen than is available (lines 599-614)", () => {
    const base = {
      pyrolysisKgS: 0.01, molarMassKgPerMol: fuelMolarMassKgPerMol(METHANE), entrainmentKgS: 0.05, hocJPerKg: HOC,
      sootYield: 0.02, coYield: 0.01, hcnYield: 0, atoms: METHANE, sourceO2: 0.2314,
    };
    const r = cfastChemistry(base);
    const o2Available = 0.05 * 0.2314;
    // The 13.1 MJ/kg rule alone would allow 0.05 x 0.2314 x 13.1e6 = 151.6 kW. The stoichiometric O2 of that burn is a
    // little above the O2 available, so the second limit scales the burn down until the O2 consumed equals the O2 available.
    expect(-r.rates.o2).toBeLessThanOrEqual(o2Available * (1 + 1e-12));
    expect(r.hrrW).toBeLessThan(o2Available * HEAT_PER_KG_OXYGEN_J_PER_KG);
    expect(r.hrrW).toBeLessThan(0.01 * HOC);
    expect(r.hrrW).toBeCloseTo(r.burnedFuelKgS * HOC, 4);
  });
});

describe("carried quantities in the species tracker (Requirement 6.14)", () => {
  const ambient = { o2: 0.23, co2: 0, co: 0, h2o: 0, soot: 0 };

  it("move with the layer flow, are not part of the gas mass, and are not scaled by the synchronisation", () => {
    const state = createSpeciesState([1, 1], ambient);
    (state.carriedKg as Float64Array)[1 * CARRIED_COUNT + CARRIED_FUEL_Q] = 100; // layer 1 holds a record
    updateSpecies(
      state,
      {
        transfers: [{ from: 1, to: 0, kgPerS: 0.5 }],
        exteriorOutKgPerS: [0, 0],
        sourceKgPerS: new Float64Array(2 * SPECIES_COUNT),
      },
      0.1,
    );
    const moved = (state.carriedKg as Float64Array)[0 * CARRIED_COUNT + CARRIED_FUEL_Q] as number;
    expect(moved).toBeGreaterThan(0);
    const kept = (state.carriedKg as Float64Array)[1 * CARRIED_COUNT + CARRIED_FUEL_Q] as number;
    expect(moved + kept).toBeCloseTo(100, 9); // what leaves one layer enters the other
    // A source of a carried quantity does not change the layer mass.
    const state2 = createSpeciesState([1, 1], ambient);
    const carriedSource = new Float64Array(2 * CARRIED_COUNT);
    carriedSource[CARRIED_FUEL_Q] = 5;
    updateSpecies(state2, { transfers: [], exteriorOutKgPerS: [0, 0], sourceKgPerS: new Float64Array(2 * SPECIES_COUNT), carriedSourcePerS: carriedSource }, 0.1);
    expect(state2.massKg[0]).toBe(1);
    expect((state2.carriedKg as Float64Array)[CARRIED_FUEL_Q]).toBeCloseTo(0.5, 12);
    // Synchronisation sets the layer mass and leaves the carried amount alone.
    expect(synchroniseSpecies(state2, [2, 1], createSpeciesSyncChange()).ok).toBe(true);
    expect((state2.carriedKg as Float64Array)[CARRIED_FUEL_Q]).toBeCloseTo(0.5, 12);
  });
});

describe("flows for the jets (flowhorizontal.f90, ventw and spill_plume)", () => {
  const end = (over: Partial<VentEndState>): VentEndState => ({
    isOutside: false,
    floorElevationM: 0,
    heightM: 2.4,
    interfaceHeightM: 1.2,
    floorPressurePa: 0,
    upperTempK: 293.15,
    lowerTempK: 293.15,
    upperDensityKgPerM3: 1.2,
    lowerDensityKgPerM3: 1.2,
    ...over,
  });

  it("reports the upper-layer outflow of the hot end as vss + vsa and the entrained air as vsas of the receiving end", () => {
    // Hot, pressurised end 1 (interface 0.6 m), cool end 2 (interface 1.8 m): the flow leaves end 1 above its interface.
    const hot = end({ interfaceHeightM: 0.6, upperTempK: 700, lowerTempK: 400, upperDensityKgPerM3: 0.5, lowerDensityKgPerM3: 0.9, floorPressurePa: 5 });
    const cold = end({ interfaceHeightM: 1.8 });
    const r = wallVentFlows({ sillM: 0, soffitM: 2, widthM: 0.9, openFraction: 1 }, hot, cold);
    const jet = r.jet;
    expect(jet).toBeDefined();
    const upperOut = (jet?.upperToUpperKgS[0] ?? 0) + (jet?.upperToLowerKgS[0] ?? 0);
    expect(upperOut).toBeGreaterThan(0);
    // What the routing sends out of the upper layer of end 1 bounds vss + vsa (each is one slab's flow).
    const routed = r.transfers.filter((t) => t.kind === "flow" && t.fromEnd === 0 && t.fromLayer === "upper").reduce((a, t) => a + t.massKgS, 0);
    expect(upperOut).toBeLessThanOrEqual(routed * (1 + 1e-9));
    expect(jet?.entrainedIntoUpperKgS[1]).toBeGreaterThan(0);
    expect(jet?.entrainedIntoUpperKgS[0]).toBe(0);
  });
});
