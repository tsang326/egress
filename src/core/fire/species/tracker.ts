// Species tracker: layer masses of O2, CO2, CO, H2O, soot, N2 and unburned hydrocarbon (UHC).
// Operator-split update after each accepted solver step (design.md, Species_Tracker; Tech Ref 6.2: soot and all
// other species are transported like the gas itself). Pure functions on typed arrays, no solver knowledge.
import { SPECIES_BOUND_TOL, SPECIES_MIN_LAYER_MASS_KG } from "../constants";

export const SPECIES_O2 = 0;
export const SPECIES_CO2 = 1;
export const SPECIES_CO = 2;
export const SPECIES_H2O = 3;
export const SPECIES_SOOT = 4;
export const SPECIES_N2 = 5;
export const SPECIES_UHC = 6;
export const SPECIES_COUNT = 7;
export const SPECIES_NAMES = ["o2", "co2", "co", "h2o", "soot", "n2", "uhc"] as const;
export type SpeciesName = (typeof SPECIES_NAMES)[number];

// Unburned-fuel record (Requirement 6.14). CFAST 7.7.7 source, cfast_parameters.f90 lines 133-142 (fuel_moles .. fuel_soot) keeps
// ten more quantities per layer, next to the nine species that make up the gas mass (ns_mass = 9, line 24). They describe
// the fuel that sits in the upper layer unburned: how much of it there is (moles), the heat it could release (J), and the
// kg of O2, CO2, CO, HCN, HCl, H2O, soot and N2 that burning it would consume or produce. They are transported with the
// layer gas like a species (solve.f90 transports all ns = 23 species; compartments.f90, layer_mixing, loops to ns), but they
// are not gas mass: synchronize_species_mass (compartments.f90 lines 82-179) scales only the first ns_mass species.
// Layout `node * CARRIED_COUNT + k`. Order of the CFAST indices 14 to 23 (fuel_moles, fuel_Q, fuel_n2, fuel_o2, fuel_co2,
// fuel_co, fuel_hcn, fuel_hcl, fuel_h2o, fuel_soot).
export const CARRIED_FUEL_MOLES = 0; // mol
export const CARRIED_FUEL_Q = 1; // J, potential heat release (CFAST integrates the rate in W)
export const CARRIED_FUEL_N2 = 2; // kg
export const CARRIED_FUEL_O2 = 3; // kg, oxygen that burning the fuel consumes (positive)
export const CARRIED_FUEL_CO2 = 4; // kg
export const CARRIED_FUEL_CO = 5; // kg
export const CARRIED_FUEL_HCN = 6; // kg
export const CARRIED_FUEL_HCL = 7; // kg
export const CARRIED_FUEL_H2O = 8; // kg
export const CARRIED_FUEL_SOOT = 9; // kg
export const CARRIED_COUNT = 10;
export const CARRIED_NAMES = [
  "fuelMoles",
  "fuelQ",
  "fuelN2",
  "fuelO2",
  "fuelCo2",
  "fuelCo",
  "fuelHcn",
  "fuelHcl",
  "fuelH2o",
  "fuelSoot",
] as const;

export const LAYER_LOWER = 0;
export const LAYER_UPPER = 1;

// Tech Ref 6.2 and eq. 2.5 to 2.8: the two layers of a compartment are the mass-balance nodes. Index helper, lower layer first.
/** Node index of a layer: two nodes per compartment, lower first. */
export function layerNode(compartmentIndex: number, layer: typeof LAYER_LOWER | typeof LAYER_UPPER): number {
  return 2 * compartmentIndex + layer;
}

export interface SpeciesState {
  nodeCount: number;
  /** Total gas mass of each layer node, kg. */
  massKg: Float64Array;
  /** Species masses, kg, laid out `node * SPECIES_COUNT + species`. */
  speciesKg: Float64Array;
  /** Unburned-fuel record (Requirement 6.14), laid out `node * CARRIED_COUNT + k`. Absent: nothing is carried. */
  carriedKg?: Float64Array;
}

/** Ambient mass fractions from the Scenario (Requirement 8.2). N2 is the remainder, UHC starts at 0. */
export interface AmbientFractions {
  o2: number;
  co2: number;
  co: number;
  h2o: number;
  soot: number;
}

// Tech Ref 6.2: layer species masses start at the ambient composition times the layer gas mass.
/** Requirement 8.2: every layer starts at the ambient composition. `layerMassKg[node]` is the initial gas mass. */
export function createSpeciesState(layerMassKg: ArrayLike<number>, ambient: AmbientFractions): SpeciesState {
  const nodeCount = layerMassKg.length;
  const massKg = new Float64Array(nodeCount);
  const speciesKg = new Float64Array(nodeCount * SPECIES_COUNT);
  const n2 = Math.max(0, 1 - ambient.o2 - ambient.co2 - ambient.co - ambient.h2o - ambient.soot);
  const y = [ambient.o2, ambient.co2, ambient.co, ambient.h2o, ambient.soot, n2, 0];
  for (let k = 0; k < nodeCount; k++) {
    const m = layerMassKg[k] as number;
    massKg[k] = m;
    for (let s = 0; s < SPECIES_COUNT; s++) speciesKg[k * SPECIES_COUNT + s] = (y[s] as number) * m;
  }
  return { nodeCount, massKg, speciesKg, carriedKg: new Float64Array(nodeCount * CARRIED_COUNT) };
}

// Tech Ref 6.2: copy of the layer species masses, used to keep the state when a step is rejected.
export function cloneSpeciesState(state: SpeciesState): SpeciesState {
  const copy: SpeciesState = { nodeCount: state.nodeCount, massKg: state.massKg.slice(), speciesKg: state.speciesKg.slice() };
  if (state.carriedKg !== undefined) copy.carriedKg = state.carriedKg.slice();
  return copy;
}

// Requirement 6.14, CFAST 7.7.7 source, fire.f90 (vent_jet_fire) reads room%species_mass(u, fuel_Q) and the other fuel_* amounts:
// the amount of one carried quantity (CARRIED_*) in one layer, 0 when the state carries none.
export function carriedAmount(state: SpeciesState, node: number, k: number): number {
  return state.carriedKg === undefined ? 0 : (state.carriedKg[node * CARRIED_COUNT + k] as number);
}

// Tech Ref 6.2: mass fraction Y_s = m_s / M of a layer.
/** Mass fraction of one species in one layer, kg/kg. Zero for an empty layer. */
export function massFraction(state: SpeciesState, node: number, species: number): number {
  const m = state.massKg[node] as number;
  return m > 0 ? (state.speciesKg[node * SPECIES_COUNT + species] as number) / m : 0;
}

/** Mass moved from layer `from` to layer `to`, kg/s. It carries the composition of the donor layer. */
export interface LayerTransfer {
  from: number;
  to: number;
  kgPerS: number;
}

export interface SpeciesFlows {
  /** Layer-to-layer flows: vent flows, plume entrainment, layer mixing. */
  transfers: readonly LayerTransfer[];
  /** Flow that leaves the system from each layer node (exterior vents), kg/s, with the donor composition. */
  exteriorOutKgPerS: ArrayLike<number>;
  /** Net species sources per node, kg/s, laid out like `speciesKg`. Includes exterior inflow with its own composition,
   *  pyrolysis and combustion products (negative for fuel burned and O2 consumed). */
  sourceKgPerS: ArrayLike<number>;
  /** Net sources of the carried quantities per node (Requirement 6.14), laid out like `carriedKg`; absent means zero. They
   *  are not part of the gas mass, so they do not enter the layer mass balance. */
  carriedSourcePerS?: ArrayLike<number>;
}

export interface SpeciesFailure {
  node: number;
  species: SpeciesName;
  /** The offending mass fraction. NaN is reported as NaN. */
  fraction: number;
}

export type SpeciesUpdateResult = { ok: true } | { ok: false; failure: SpeciesFailure };

// Tech Ref 6.2: species are transported with the layer gas flows; mass balance of eq. 2.5 to 2.8 applied per species.
/**
 * Advances every layer by `hS` seconds (design.md, Species_Tracker steps 2 and 3; step 4 is `synchroniseSpecies`).
 *
 * Total mass: M(n+1) = M(n) + h (inflow - outflow + sources).
 * Species, implicit upwind in flux form:
 *   m_s,k(n+1) = m_s,k(n) + h (sum_j f_jk m_s,j(n+1)/M_j(n+1) - r_k m_s,k(n+1)/M_k(n+1) + S_s,k).
 * The matrix is the same for all species, so one LU factorisation serves all seven right-hand sides.
 * What leaves a donor enters the receiver, so each species is conserved up to rounding (Requirement 8.4).
 * A layer with M(n+1) at or below SPECIES_MIN_LAYER_MASS_KG sends its outflow with the fractions of the previous
 * step (explicit), and a layer with no mass at the start of the step sends nothing.
 * The result is not clamped and not checked: `synchroniseSpecies` follows it in the driver (Requirements 8.8, 8.10).
 * The update itself never fails; the return type is shared with `synchroniseSpecies`.
 */
export function updateSpecies(state: SpeciesState, flows: SpeciesFlows, hS: number): SpeciesUpdateResult {
  const n = state.nodeCount;
  const S = SPECIES_COUNT;
  // Columns of the shared linear system: the seven species, then the carried quantities of Requirement 6.14 when the
  // state has them. The carried quantities move with the same flows but are not part of the layer gas mass (step 2).
  const C = state.carriedKg === undefined ? 0 : CARRIED_COUNT;
  const W = S + C;
  const old = new Float64Array(n * W);
  const sourceAt = new Float64Array(n * W);
  for (let k = 0; k < n; k++) {
    for (let s = 0; s < S; s++) {
      old[k * W + s] = state.speciesKg[k * S + s] as number;
      sourceAt[k * W + s] = flows.sourceKgPerS[k * S + s] as number;
    }
    for (let c = 0; c < C; c++) {
      old[k * W + S + c] = (state.carriedKg as Float64Array)[k * C + c] as number;
      sourceAt[k * W + S + c] = flows.carriedSourcePerS === undefined ? 0 : (flows.carriedSourcePerS[k * C + c] as number);
    }
  }

  // Outflow per node. A layer without mass at the start of the step cannot send anything.
  const outflow = new Float64Array(n);
  const usable = (node: number): boolean => (state.massKg[node] as number) > 0;
  for (const t of flows.transfers) if (t.kgPerS > 0 && usable(t.from)) outflow[t.from] = (outflow[t.from] as number) + t.kgPerS;
  for (let k = 0; k < n; k++) {
    const e = flows.exteriorOutKgPerS[k] as number;
    if (e > 0 && usable(k)) outflow[k] = (outflow[k] as number) + e;
  }

  // Step 2: total layer mass, plain accumulation.
  const inflow = new Float64Array(n);
  for (const t of flows.transfers) if (t.kgPerS > 0 && usable(t.from)) inflow[t.to] = (inflow[t.to] as number) + t.kgPerS;
  const massNew = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let src = 0;
    for (let s = 0; s < S; s++) src += flows.sourceKgPerS[k * S + s] as number;
    massNew[k] = (state.massKg[k] as number) + hS * ((inflow[k] as number) - (outflow[k] as number) + src);
  }

  // Step 3: A m(n+1) = rhs. Implicit nodes put their outflow on the diagonal; explicit nodes use old fractions.
  const implicit = new Uint8Array(n);
  for (let k = 0; k < n; k++) implicit[k] = (massNew[k] as number) > SPECIES_MIN_LAYER_MASS_KG ? 1 : 0;

  const a = new Float64Array(n * n);
  const rhs = new Float64Array(n * W);
  for (let k = 0; k < n; k++) {
    a[k * n + k] = 1;
    for (let s = 0; s < W; s++) {
      rhs[k * W + s] = (old[k * W + s] as number) + hS * (sourceAt[k * W + s] as number);
    }
  }
  // Outflow coefficient of each donor, kg/s per kg of layer gas.
  const addLoss = (k: number, rate: number): void => {
    if (!(rate > 0)) return;
    if (implicit[k]) {
      a[k * n + k] = (a[k * n + k] as number) + (hS * rate) / (massNew[k] as number);
    } else {
      const mOld = state.massKg[k] as number;
      for (let s = 0; s < W; s++) {
        rhs[k * W + s] = (rhs[k * W + s] as number) - hS * rate * ((old[k * W + s] as number) / mOld);
      }
    }
  };
  for (let k = 0; k < n; k++) addLoss(k, outflow[k] as number);
  for (const t of flows.transfers) {
    if (!(t.kgPerS > 0) || !usable(t.from)) continue;
    if (implicit[t.from]) {
      const idx = t.to * n + t.from;
      a[idx] = (a[idx] as number) - (hS * t.kgPerS) / (massNew[t.from] as number);
    } else {
      const mOld = state.massKg[t.from] as number;
      for (let s = 0; s < W; s++) {
        rhs[t.to * W + s] = (rhs[t.to * W + s] as number) + hS * t.kgPerS * ((old[t.from * W + s] as number) / mOld);
      }
    }
  }

  const solution = solveShared(a, rhs, n, W);

  // Step 4: the new species masses. Nothing is clamped or checked here: `synchroniseSpecies` does that, as CFAST does
  // (Requirements 8.8, 8.10). An empty layer has no fractions; its species masses are set to zero.
  for (let k = 0; k < n; k++) {
    const m = massNew[k] as number;
    for (let s = 0; s < S; s++) {
      state.speciesKg[k * S + s] = m > 0 ? (solution[k * W + s] as number) : 0;
    }
    for (let c = 0; c < C; c++) {
      (state.carriedKg as Float64Array)[k * C + c] = m > 0 ? (solution[k * W + S + c] as number) : 0;
    }
  }
  state.massKg.set(massNew);
  return { ok: true };
}

/** Species mass changed by one synchronisation, per species (SPECIES_COUNT entries), kg. */
export interface SpeciesSyncChange {
  /** Signed sum over layers of (mass after - mass before). */
  netKg: Float64Array;
  /** Sum over layers of |mass after - mass before|. */
  absKg: Float64Array;
}

// Requirement 8.10, CFAST 7.7.7 source, compartments.f90 (synchronize_species_mass): empty change accumulator.
export function createSpeciesSyncChange(): SpeciesSyncChange {
  return { netKg: new Float64Array(SPECIES_COUNT), absKg: new Float64Array(SPECIES_COUNT) };
}

// Requirement 8.10, CFAST 7.7.7 source, compartments.f90 (synchronize_species_mass, called from solve.f90 after every
// step): each negative species mass is set to 0, then the species masses of the layer are multiplied by one factor
// so that they add up to the layer gas mass (factor 1 when they add up to 0). All seven tracked species count toward
// the layer mass, as the nine species of CFAST (ns_mass, cfast_parameters.f90) do; HCN and HCl are kept with N2.
// The two smoke components that CFAST also scales by the soot ratio are optical-density terms we do not carry: we
// derive optical density from the soot mass fraction (Tech Ref 6.2).
// `gasMassKg[node]` is the layer gas mass of the accepted solver state, m = rho V (Tech Ref eq. 2.4). The layer mass
// of the state is set to it. The change of every species mass is added to `change`.
// Requirement 8.8: after the synchronisation, a mass fraction outside 0 to 1 by more than SPECIES_BOUND_TOL, or a NaN,
// fails; then `state` and `change` are left unchanged.
export function synchroniseSpecies(
  state: SpeciesState,
  gasMassKg: ArrayLike<number>,
  change: SpeciesSyncChange,
): SpeciesUpdateResult {
  const n = state.nodeCount;
  const S = SPECIES_COUNT;
  const after = new Float64Array(n * S);
  // The carried quantities (Requirement 6.14) are not gas mass: no scaling, no bound check. CFAST 7.7.7 source, solve.f90
  // (update_data) reads every species mass as max(value, 0), so a negative carried amount is read as 0; it is set to 0 here.
  let carried: Float64Array | undefined;
  if (state.carriedKg !== undefined) {
    carried = state.carriedKg.slice();
    for (let i = 0; i < carried.length; i++) {
      const v = carried[i] as number;
      if (!Number.isFinite(v)) return { ok: false, failure: { node: Math.floor(i / CARRIED_COUNT), species: "uhc", fraction: NaN } };
      if (v < 0) carried[i] = 0;
    }
  }
  for (let k = 0; k < n; k++) {
    const gas = gasMassKg[k] as number;
    let sum = 0;
    for (let s = 0; s < S; s++) {
      const v = state.speciesKg[k * S + s] as number;
      if (Number.isNaN(v)) return { ok: false, failure: { node: k, species: SPECIES_NAMES[s] as SpeciesName, fraction: NaN } };
      if (v >= 0) sum += v;
    }
    if (!(gas >= 0) || !Number.isFinite(gas) || !Number.isFinite(sum)) {
      return { ok: false, failure: { node: k, species: SPECIES_NAMES[0], fraction: NaN } };
    }
    const factor = sum > 0 ? gas / sum : 1;
    for (let s = 0; s < S; s++) {
      const v = state.speciesKg[k * S + s] as number;
      const mass = v >= 0 ? factor * v : 0;
      after[k * S + s] = mass;
      const y = gas > 0 ? mass / gas : 0;
      if (!(y >= -SPECIES_BOUND_TOL && y <= 1 + SPECIES_BOUND_TOL)) {
        return { ok: false, failure: { node: k, species: SPECIES_NAMES[s] as SpeciesName, fraction: y } };
      }
    }
  }
  for (let k = 0; k < n; k++) {
    for (let s = 0; s < S; s++) {
      const d = (after[k * S + s] as number) - (state.speciesKg[k * S + s] as number);
      change.netKg[s] = (change.netKg[s] as number) + d;
      change.absKg[s] = (change.absKg[s] as number) + Math.abs(d);
    }
    state.massKg[k] = gasMassKg[k] as number;
  }
  state.speciesKg.set(after);
  if (carried !== undefined) (state.carriedKg as Float64Array).set(carried);
  return { ok: true };
}
// Dense LU with partial pivoting, factorised once, then one back-substitution per column of `rhs`
// (`rhs` is laid out row * columns + column). Returns the solution in the same layout. `a` is overwritten.
function solveShared(a: Float64Array, rhs: Float64Array, n: number, columns: number): Float64Array {
  const perm = new Int32Array(n);
  for (let i = 0; i < n; i++) perm[i] = i;
  for (let c = 0; c < n; c++) {
    let p = c;
    let best = Math.abs(a[c * n + c] as number);
    for (let r = c + 1; r < n; r++) {
      const v = Math.abs(a[r * n + c] as number);
      if (v > best) {
        best = v;
        p = r;
      }
    }
    if (p !== c) {
      for (let j = 0; j < n; j++) {
        const t = a[c * n + j] as number;
        a[c * n + j] = a[p * n + j] as number;
        a[p * n + j] = t;
      }
      const tp = perm[c] as number;
      perm[c] = perm[p] as number;
      perm[p] = tp;
    }
    const pivot = a[c * n + c] as number;
    for (let r = c + 1; r < n; r++) {
      const f = (a[r * n + c] as number) / pivot;
      a[r * n + c] = f;
      if (f !== 0) for (let j = c + 1; j < n; j++) a[r * n + j] = (a[r * n + j] as number) - f * (a[c * n + j] as number);
    }
  }
  const out = new Float64Array(n * columns);
  const y = new Float64Array(n);
  for (let col = 0; col < columns; col++) {
    for (let i = 0; i < n; i++) {
      let v = rhs[(perm[i] as number) * columns + col] as number;
      for (let j = 0; j < i; j++) v -= (a[i * n + j] as number) * (y[j] as number);
      y[i] = v;
    }
    for (let i = n - 1; i >= 0; i--) {
      let v = y[i] as number;
      for (let j = i + 1; j < n; j++) v -= (a[i * n + j] as number) * (out[j * columns + col] as number);
      out[i * columns + col] = v / (a[i * n + i] as number);
    }
  }
  return out;
}
