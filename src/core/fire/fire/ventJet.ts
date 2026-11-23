// Door-jet (vent-jet) fires, Requirement 6.14. Pure functions, SI units. Source: CFAST 7.7.7 fire.f90.
//
// What CFAST does, in words (all line numbers are CFAST 7.7.7 source, fire.f90):
//  1. do_fire (lines 423-439). Fuel that the plume could not burn stays in the upper layer. CFAST records what that fuel is:
//     it runs the combustion chemistry once more for the unburned fuel with a very large entrainment (1000 times what the
//     fuel needs) and an oxygen fraction just above the limit, so the fuel burns completely. The result is stored as ten
//     quantities that travel with the layer gas: moles of fuel, potential heat release, and the O2, CO2, CO, HCN, HCl,
//     H2O, soot and N2 that burning the fuel would consume or produce.
//  2. vent_jets (lines 685-766). For each wall vent and each direction, the fuel mass flow from the upper layer of the
//     source compartment is its fuel mass fraction times the flow through the vent from that layer (vss + vsa). The air
//     the spill plume of the vent entrains in the receiving compartment is vsas (flowhorizontal.f90, spill_plume).
//  3. vent_jet_fire (lines 780-846). If there is fuel, entrained air and a jet temperature at or above the ignition
//     temperature, and the source layer holds a record of unburned fuel, the fuel burns. The record gives the heat of
//     combustion, the molar mass and the product yields of the fuel; the chemistry of section 3.1 gives the burn rate
//     limited by the oxygen of the receiving compartment's lower layer. Heat and products go to the upper layer of the
//     receiving compartment, and the burned part of the record is taken out of that layer.
import {
  HEAT_PER_KG_OXYGEN_J_PER_KG,
  LOWER_OXYGEN_LIMIT,
  MOLAR_MASS_CO2_KG_PER_MOL,
  MOLAR_MASS_CO_KG_PER_MOL,
  MOLAR_MASS_H2O_KG_PER_MOL,
  MOLAR_MASS_HCL_KG_PER_MOL,
  MOLAR_MASS_HCN_KG_PER_MOL,
  MOLAR_MASS_N2_KG_PER_MOL,
  MOLAR_MASS_O2_KG_PER_MOL,
  MOLAR_MASS_SOOT_KG_PER_MOL,
  UNBURNED_FUEL_RECORD_ENTRAINMENT_FACTOR,
  UNBURNED_FUEL_RECORD_O2_MARGIN,
} from "../constants";
import {
  CARRIED_COUNT,
  CARRIED_FUEL_CO,
  CARRIED_FUEL_CO2,
  CARRIED_FUEL_H2O,
  CARRIED_FUEL_HCL,
  CARRIED_FUEL_HCN,
  CARRIED_FUEL_MOLES,
  CARRIED_FUEL_N2,
  CARRIED_FUEL_O2,
  CARRIED_FUEL_Q,
  CARRIED_FUEL_SOOT,
} from "../species/tracker";
import { fuelMolarMassKgPerMol, zeroRates, type FuelAtoms, type SpeciesRates } from "./chemistry";
import { oxygenFactor } from "./oxygenLimit";

export interface CfastChemistryInput {
  pyrolysisKgS: number; // fuel available to burn
  molarMassKgPerMol: number; // of the fuel, as given (CFAST does not recompute it from the atoms)
  entrainmentKgS: number;
  hocJPerKg: number;
  sootYield: number; // kg/kg
  coYield: number;
  hcnYield: number;
  atoms: FuelAtoms;
  sourceO2: number; // oxygen mass fraction of the layer that supplies the fire
}

export interface CfastChemistryResult {
  hrrW: number; // hrr_constrained
  burnedFuelKgS: number; // pyrolysis_rate_constrained
  rates: SpeciesRates; // fuel and O2 negative, products positive
}

// CFAST 7.7.7 source, fire.f90 (chemistry, lines 543-630): the same kinetics as Tech Ref eq. 3.1 to 3.9 and 3.14, with the
// fuel molar mass passed in. The O2 available is the entrained air times its O2 fraction times the smooth oxygen factor
// (line 568); the heat release is the smaller of fuel x heat of combustion and O2 available x 1.31e7 J/kg (line 569).
// Unlike `burn` in heatRelease.ts it takes the HCN yield (the vent-jet fire has HCN in the record). Returns all zeros
// when the heat of combustion or the molar mass is not positive.
export function cfastChemistry(i: CfastChemistryInput): CfastChemistryResult {
  const none: CfastChemistryResult = { hrrW: 0, burnedFuelKgS: 0, rates: zeroRates() };
  if (!(i.hocJPerKg > 0) || !(i.molarMassKgPerMol > 0) || !(i.pyrolysisKgS > 0)) return none;
  const m = i.molarMassKgPerMol;
  const o2Available = i.entrainmentKgS * i.sourceO2 * oxygenFactor(i.sourceO2); // lines 566-568
  let hrrW = Math.max(0, Math.min(i.pyrolysisKgS * i.hocJPerKg, o2Available * HEAT_PER_KG_OXYGEN_J_PER_KG)); // line 569
  let burned = hrrW / i.hocJPerKg; // line 571
  // Lines 574-583.
  const nuSoot = (m / MOLAR_MASS_SOOT_KG_PER_MOL) * i.sootYield;
  const nuHcn = Math.min(i.atoms.n, (m / MOLAR_MASS_HCN_KG_PER_MOL) * i.hcnYield);
  const nuHcl = i.atoms.cl;
  const nuCo = (m / MOLAR_MASS_CO_KG_PER_MOL) * i.coYield;
  const nuH2o = (i.atoms.h - nuHcl - nuHcn) / 2;
  const nuCo2 = i.atoms.c - nuCo - nuHcn - nuSoot;
  const nuO2 = nuCo2 + (nuH2o + nuCo - i.atoms.o) / 2;
  const nuN2 = (i.atoms.n - nuHcn) / 2;
  // Lines 587-597, per kg of fuel burned.
  const perKg = burned / m;
  let rates: SpeciesRates = {
    fuel: -burned,
    o2: -perKg * nuO2 * MOLAR_MASS_O2_KG_PER_MOL,
    co2: perKg * nuCo2 * MOLAR_MASS_CO2_KG_PER_MOL,
    co: perKg * nuCo * MOLAR_MASS_CO_KG_PER_MOL,
    h2o: perKg * nuH2o * MOLAR_MASS_H2O_KG_PER_MOL,
    soot: perKg * nuSoot * MOLAR_MASS_SOOT_KG_PER_MOL,
    hcl: perKg * nuHcl * MOLAR_MASS_HCL_KG_PER_MOL,
    hcn: perKg * nuHcn * MOLAR_MASS_HCN_KG_PER_MOL,
    n2: perKg * nuN2 * MOLAR_MASS_N2_KG_PER_MOL,
  };
  // Lines 599-614: if the products need more O2 than is available, everything is scaled down.
  if (-rates.o2 > o2Available && rates.o2 < 0) {
    const f = -o2Available / rates.o2;
    burned *= f;
    hrrW *= f;
    rates = {
      fuel: rates.fuel * f, o2: rates.o2 * f, co2: rates.co2 * f, co: rates.co * f, h2o: rates.h2o * f,
      soot: rates.soot * f, hcl: rates.hcl * f, hcn: rates.hcn * f, n2: rates.n2 * f,
    };
  }
  return { hrrW, burnedFuelKgS: burned, rates };
}

// CFAST 7.7.7 source, fire.f90 (do_fire, lines 423-439): the record of the unburned fuel added to the upper layer by one fire.
// Returns the rates of the CARRIED_* quantities: mol/s, W, and kg/s. `unburnedKgS` is the fuel mass rate that the plume
// did not burn (species_mass_rate(u, fuel) at line 424). The chemistry is run with the O2 fraction of the oxygen limit
// plus 0.02 and with 1000 times the entrainment that the fuel needs (lines 426-428), so the fuel burns completely.
export function unburnedFuelRecord(
  unburnedKgS: number,
  hocJPerKg: number,
  fuel: FuelAtoms,
  yields: { coYield: number; sootYield: number },
): Float64Array {
  const out = new Float64Array(CARRIED_COUNT);
  if (!(unburnedKgS > 0) || !(hocJPerKg > 0)) return out;
  const molarMass = fuelMolarMassKgPerMol(fuel);
  const sourceO2 = LOWER_OXYGEN_LIMIT + UNBURNED_FUEL_RECORD_O2_MARGIN; // line 426
  const entrainment =
    (UNBURNED_FUEL_RECORD_ENTRAINMENT_FACTOR * (unburnedKgS * hocJPerKg)) / (HEAT_PER_KG_OXYGEN_J_PER_KG * sourceO2); // line 427
  const chem = cfastChemistry({
    pyrolysisKgS: unburnedKgS,
    molarMassKgPerMol: molarMass,
    entrainmentKgS: entrainment,
    hocJPerKg,
    sootYield: yields.sootYield,
    coYield: yields.coYield,
    hcnYield: 0, // v1 passes no HCN yield (design Fire modules): the fuel nitrogen goes to N2
    atoms: fuel,
    sourceO2,
  });
  const r = chem.rates;
  out[CARRIED_FUEL_MOLES] = molarMass > 0 ? unburnedKgS / molarMass : 0; // line 430
  out[CARRIED_FUEL_Q] = chem.hrrW; // line 431
  out[CARRIED_FUEL_O2] = -r.o2; // line 432
  out[CARRIED_FUEL_CO2] = r.co2; // line 433
  out[CARRIED_FUEL_CO] = r.co; // line 434
  out[CARRIED_FUEL_HCN] = r.hcn; // line 435
  out[CARRIED_FUEL_HCL] = r.hcl; // line 436
  out[CARRIED_FUEL_H2O] = r.h2o; // line 437
  out[CARRIED_FUEL_SOOT] = r.soot; // line 438
  out[CARRIED_FUEL_N2] = r.n2; // line 439
  return out;
}

export interface VentJetInput {
  netFuelKgS: number; // fuel mass fraction of the source upper layer times the flow through the vent from it (vss + vsa)
  entrainmentKgS: number; // vsas: air entrained into the jet in the receiving compartment
  jetTempK: number; // upper layer temperature of the source compartment
  ignitionTempK: number; // interior ambient + 200 K
  sourceO2: number; // oxygen mass fraction of the lower layer of the receiving compartment (the Outside: ambient)
  upperFuelKg: number; // unburned fuel (UHC) mass in the upper layer of the source compartment
  carried: ArrayLike<number>; // CARRIED_* amounts in the upper layer of the source compartment
}

export interface VentJetResult {
  active: boolean;
  hrrW: number; // heat released in the jet, to the upper layer of the receiving compartment
  burnedFuelKgS: number;
  rates: SpeciesRates; // species rates into the upper layer of the receiving compartment (fuel and O2 negative)
  carriedRates: Float64Array; // CARRIED_COUNT rates into the same layer; the burned part of the record, so not positive
}

const NO_JET: VentJetResult = {
  active: false,
  hrrW: 0,
  burnedFuelKgS: 0,
  rates: zeroRates(),
  carriedRates: new Float64Array(CARRIED_COUNT),
};

// CFAST 7.7.7 source, fire.f90 (vent_jet_fire, lines 780-845).
// The jet burns only if there is fuel in it, air entrained into it, a jet temperature at or above the ignition
// temperature, and a record of unburned fuel with positive heat and moles in the source layer (lines 800-801).
// The molar mass, heat of combustion and yields come from the record (lines 807-820); the atom counts of the fuel are
// rebuilt from it so that the chemistry returns the recorded products (lines 822-826).
// CFAST removes from the receiving layer the burned share of the record of moles, heat, O2, CO2, CO, HCN, HCl and H2O
// (lines 835-842). It does not remove the recorded soot and N2; this function does the same, so those two keep growing
// relative to the fuel, as in CFAST 7.7.7. The recorded N2 is not used by the chemistry (n_n = nu_hcn, line 822), so the
// fuel nitrogen that goes to N2 is not in the jet and the species mass of a jet of a fuel with nitrogen is not balanced,
// as in CFAST.
export function ventJetFire(i: VentJetInput): VentJetResult {
  const q = i.carried[CARRIED_FUEL_Q] as number;
  const moles = i.carried[CARRIED_FUEL_MOLES] as number;
  if (
    !(i.netFuelKgS > 0 && i.entrainmentKgS > 0 && i.jetTempK >= i.ignitionTempK && q > 0 && moles > 0) ||
    !(i.upperFuelKg > 0)
  ) {
    return NO_JET;
  }
  const fuel = i.upperFuelKg;
  const hoc = q / fuel; // line 807
  const molarMass = fuel / moles; // line 808
  const ratio = (k: number): number => ((i.carried[k] as number) / fuel) * molarMass; // mol of species per mol of fuel x its molar mass
  const ySoot = (i.carried[CARRIED_FUEL_SOOT] as number) / fuel; // line 809
  const yCo = (i.carried[CARRIED_FUEL_CO] as number) / fuel; // line 812
  const yHcn = (i.carried[CARRIED_FUEL_HCN] as number) / fuel; // line 813
  const nuSoot = (ySoot * molarMass) / MOLAR_MASS_SOOT_KG_PER_MOL; // line 814
  const nuCo = (yCo * molarMass) / MOLAR_MASS_CO_KG_PER_MOL;
  const nuHcn = (yHcn * molarMass) / MOLAR_MASS_HCN_KG_PER_MOL;
  const nuHcl = ratio(CARRIED_FUEL_HCL) / MOLAR_MASS_HCL_KG_PER_MOL; // line 817
  const nuCo2 = ratio(CARRIED_FUEL_CO2) / MOLAR_MASS_CO2_KG_PER_MOL;
  const nuH2o = ratio(CARRIED_FUEL_H2O) / MOLAR_MASS_H2O_KG_PER_MOL;
  const nuO2 = ratio(CARRIED_FUEL_O2) / MOLAR_MASS_O2_KG_PER_MOL;
  const atoms: FuelAtoms = {
    n: nuHcn, // line 822
    cl: nuHcl, // line 823
    h: 2 * nuH2o + nuHcn + nuHcl, // line 824
    c: nuCo2 + nuHcn + nuCo + nuSoot, // line 825
    o: Math.max(0, 2 * nuCo2 - 2 * nuO2 + nuH2o + nuCo), // line 826
  };
  const chem = cfastChemistry({
    pyrolysisKgS: i.netFuelKgS,
    molarMassKgPerMol: molarMass,
    entrainmentKgS: i.entrainmentKgS,
    hocJPerKg: hoc,
    sootYield: ySoot,
    coYield: yCo,
    hcnYield: yHcn,
    atoms,
    sourceO2: i.sourceO2,
  });
  // Lines 834-842: the share of the fuel in the layer that burned, applied to the record.
  const flowFraction = chem.burnedFuelKgS / fuel;
  const carriedRates = new Float64Array(CARRIED_COUNT);
  for (const k of [
    CARRIED_FUEL_MOLES,
    CARRIED_FUEL_Q,
    CARRIED_FUEL_O2,
    CARRIED_FUEL_CO2,
    CARRIED_FUEL_CO,
    CARRIED_FUEL_HCN,
    CARRIED_FUEL_HCL,
    CARRIED_FUEL_H2O,
  ]) {
    carriedRates[k] = -flowFraction * (i.carried[k] as number);
  }
  return { active: true, hrrW: chem.hrrW, burnedFuelKgS: chem.burnedFuelKgS, rates: chem.rates, carriedRates };
}
