// Property tests for the species tracker and visibility (tasks.md 7.2).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  SPECIES_COUNT,
  SPECIES_NAMES,
  createSpeciesSyncChange,
  synchroniseSpecies,
  updateSpecies,
  type LayerTransfer,
  type SpeciesFlows,
  type SpeciesState,
} from "../../src/core/fire/species/tracker";
import {
  extinctionCoefficientPerMetre,
  layerSmoke,
  opticalDensityPerMetre,
  visibilityM,
} from "../../src/core/fire/species/visibility";
import { K_VIS, SPECIFIC_EXTINCTION_COEFFICIENT_M2_PER_KG as KM } from "../../src/core/fire/constants";
import { arbFlowNetwork, type FlowNetwork } from "./arbitraries";

// Absolute floor for tiny species (rounding of the shared LU is relative to the largest species in the system).
const ABS_TOL_KG = 1e-12;

function toState(net: FlowNetwork): SpeciesState {
  const n = net.layerMassKg.length;
  const speciesKg = new Float64Array(n * SPECIES_COUNT);
  const massKg = new Float64Array(n);
  net.layerMassKg.forEach((rec, k) => {
    SPECIES_NAMES.forEach((name, s) => {
      speciesKg[k * SPECIES_COUNT + s] = rec[name];
      massKg[k] = (massKg[k] as number) + rec[name];
    });
  });
  return { nodeCount: n, massKg, speciesKg };
}

function toFlows(net: FlowNetwork): SpeciesFlows {
  const n = net.layerMassKg.length;
  const transfers: LayerTransfer[] = [];
  const exterior = new Float64Array(n);
  for (const f of net.flows) {
    if (f.to < 0) exterior[f.from] = (exterior[f.from] as number) + f.massKgS;
    else transfers.push({ from: f.from, to: f.to, kgPerS: f.massKgS });
  }
  const source = new Float64Array(n * SPECIES_COUNT);
  net.sourcesKgS.forEach((rec, k) => SPECIES_NAMES.forEach((name, s) => (source[k * SPECIES_COUNT + s] = rec[name])));
  return { transfers, exteriorOutKgPerS: exterior, sourceKgPerS: source };
}

describe("Property 19: species mass conservation", () => {
  // Feature: fire-zone, Property 19: Species mass conservation
  // **Validates: Requirements 8.4, 8.7, 8.10**
  it("changes each species total by sources minus exterior outflow plus the synchronisation change; fractions stay in [0, 1] and sum to 1", () => {
    let accepted = 0;
    fc.assert(
      fc.property(arbFlowNetwork, fc.array(fc.double({ min: -0.01, max: 0.01, noNaN: true }), { minLength: 1, maxLength: 8 }), (net, drift) => {
        const state = toState(net);
        const flows = toFlows(net);
        const n = state.nodeCount;
        const before = state.speciesKg.slice();
        const massBefore = state.massKg.slice();
        // Precondition: no layer is asked to send out more gas than it holds. A real run cannot do this because every
        // layer keeps at least VMIN of gas; the tracker's explicit branch (layer mass <= 1e-9 kg) does not guard it.
        const outTotal = new Float64Array(n);
        for (const t of flows.transfers) outTotal[t.from] = (outTotal[t.from] as number) + t.kgPerS;
        for (let k = 0; k < n; k++) outTotal[k] = (outTotal[k] as number) + (flows.exteriorOutKgPerS[k] as number);
        for (let k = 0; k < n; k++) {
          let src = 0;
          for (let s = 0; s < SPECIES_COUNT; s++) src += flows.sourceKgPerS[k * SPECIES_COUNT + s] as number;
          if ((outTotal[k] as number) > 0 && (massBefore[k] as number) + net.stepS * src < net.stepS * (outTotal[k] as number) * (1 + 1e-6)) {
            return;
          }
        }
        const r = updateSpecies(state, flows, net.stepS);
        expect(r.ok).toBe(true); // the transport update itself never fails (Requirement 8.8 applies after synchronisation)
        accepted++;
        const h = net.stepS;
        for (let s = 0; s < SPECIES_COUNT; s++) {
          let total0 = 0;
          let total1 = 0;
          let sources = 0;
          let exteriorLoss = 0;
          let scale = 0;
          for (let k = 0; k < n; k++) {
            total0 += before[k * SPECIES_COUNT + s] as number;
            total1 += state.speciesKg[k * SPECIES_COUNT + s] as number;
            sources += h * (flows.sourceKgPerS[k * SPECIES_COUNT + s] as number);
            const out = flows.exteriorOutKgPerS[k] as number;
            if (out > 0 && (massBefore[k] as number) > 0) {
              // Exterior loss carries the layer composition (new fractions for implicit layers).
              const mNew = state.massKg[k] as number;
              const y = mNew > 0
                ? (state.speciesKg[k * SPECIES_COUNT + s] as number) / mNew
                : (before[k * SPECIES_COUNT + s] as number) / (massBefore[k] as number);
              exteriorLoss += h * out * y;
            }
            scale += (before[k * SPECIES_COUNT + s] as number) + Math.abs(h * (flows.sourceKgPerS[k * SPECIES_COUNT + s] as number));
          }
          expect(Math.abs(total1 - (total0 + sources - exteriorLoss))).toBeLessThanOrEqual(1e-9 * scale + ABS_TOL_KG);
        }
        // Requirement 8.10: synchronise with a layer gas mass that differs from the transported mass (the solver's
        // derived gas mass drifts from it within the integration tolerance). Each species total then changes by the
        // reported synchronisation change, and every layer is back in range.
        const transported = state.speciesKg.slice();
        const gasMass = Float64Array.from(state.massKg, (m, k) => Math.max(0, m * (1 + (drift[k % drift.length] as number))));
        const change = createSpeciesSyncChange();
        const sync = synchroniseSpecies(state, gasMass, change);
        expect(sync.ok).toBe(true);
        for (let s = 0; s < SPECIES_COUNT; s++) {
          let t0 = 0;
          let t1 = 0;
          let mag = 0;
          for (let k = 0; k < n; k++) {
            t0 += transported[k * SPECIES_COUNT + s] as number;
            t1 += state.speciesKg[k * SPECIES_COUNT + s] as number;
            mag += Math.abs(transported[k * SPECIES_COUNT + s] as number) + (state.speciesKg[k * SPECIES_COUNT + s] as number);
          }
          expect(Math.abs(t1 - (t0 + (change.netKg[s] as number)))).toBeLessThanOrEqual(1e-9 * mag + ABS_TOL_KG);
          expect(change.absKg[s] as number).toBeGreaterThanOrEqual(Math.abs(change.netKg[s] as number) * (1 - 1e-12));
        }
        for (let k = 0; k < n; k++) {
          const m = state.massKg[k] as number;
          expect(m).toBe(gasMass[k]);
          if (!(m > 0)) continue;
          let sum = 0;
          for (let s = 0; s < SPECIES_COUNT; s++) {
            const y = (state.speciesKg[k * SPECIES_COUNT + s] as number) / m;
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(1 + 1e-9);
            sum += y;
          }
          expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-9);
        }
      }),
      { numRuns: 300 },
    );
    expect(accepted).toBeGreaterThan(0);
  });
});

describe("synchroniseSpecies (Requirement 8.10, CFAST 7.7.7 compartments.f90 synchronize_species_mass)", () => {
  const S = SPECIES_COUNT;
  const layer = (...kg: number[]): SpeciesState => {
    const speciesKg = new Float64Array(S);
    kg.forEach((v, i) => (speciesKg[i] = v));
    return { nodeCount: 1, massKg: Float64Array.of(kg.reduce((a, b) => a + Math.max(b, 0), 0)), speciesKg };
  };

  it("sets negative masses to 0 and scales the rest to the gas mass, and reports the change per species", () => {
    const st = layer(0.2, -0.01, 0, 0, 0, 0.8); // o2 0.2, co2 -0.01, n2 0.8
    const ch = createSpeciesSyncChange();
    expect(synchroniseSpecies(st, Float64Array.of(1.1), ch).ok).toBe(true);
    expect(st.speciesKg[1]).toBe(0);
    expect(st.speciesKg[0]).toBeCloseTo(0.22, 14);
    expect(st.speciesKg[5]).toBeCloseTo(0.88, 14);
    expect(st.massKg[0]).toBe(1.1);
    expect(ch.netKg[1]).toBeCloseTo(0.01, 14);
    expect(ch.netKg[0]).toBeCloseTo(0.02, 14);
    expect(ch.netKg[5]).toBeCloseTo(0.08, 14);
  });

  it("uses factor 1 when the species masses add up to 0", () => {
    const st = layer(0, -1e-12);
    const ch = createSpeciesSyncChange();
    expect(synchroniseSpecies(st, Float64Array.of(2), ch).ok).toBe(true);
    expect(Array.from(st.speciesKg)).toEqual(new Array(S).fill(0));
    expect(ch.netKg[1]).toBe(1e-12);
  });

  it("fails on a NaN and leaves the state and the change unchanged (Requirement 8.8)", () => {
    const st = layer(0.2, Number.NaN, 0, 0, 0, 0.8);
    const before = Array.from(st.speciesKg);
    const ch = createSpeciesSyncChange();
    const r = synchroniseSpecies(st, Float64Array.of(1), ch);
    expect(r.ok).toBe(false);
    expect(Array.from(st.speciesKg)).toEqual(before);
    expect(Array.from(ch.netKg)).toEqual(new Array(S).fill(0));
  });
});

describe("Property 20: optical density and visibility", () => {
  // Feature: fire-zone, Property 20: Optical density and visibility
  // **Validates: Requirements 8.5, 8.6**
  // Zero or a normal-range soot fraction; subnormal fractions make 3 / K overflow to Infinity.
  const arbFraction = fc.oneof(fc.constant(0), fc.double({ min: 1e-9, max: 1, noNaN: true }));
  const arbDensity = fc.double({ min: 0.1, max: 3, noNaN: true });

  it("Du = Km m_s / ln 10, non-decreasing in soot, and S = 3 / (Km m_s)", () => {
    fc.assert(
      fc.property(arbFraction, arbFraction, arbDensity, (y1, y2, rho) => {
        const lo = Math.min(y1, y2);
        const hi = Math.max(y1, y2);
        const a = layerSmoke(lo, rho);
        const b = layerSmoke(hi, rho);
        expect(b.opticalDensityPerM).toBeGreaterThanOrEqual(a.opticalDensityPerM);
        const soot = hi * rho;
        expect(b.opticalDensityPerM).toBeCloseTo((KM * soot) / Math.LN10, 9);
        expect(b.opticalDensityPerM).toBe(opticalDensityPerMetre(soot));
        if (soot > 0) {
          expect(Math.abs(b.visibilityM - K_VIS / (KM * soot))).toBeLessThanOrEqual(1e-12 * b.visibilityM);
          expect(visibilityM(soot)).toBe(b.visibilityM);
          expect(extinctionCoefficientPerMetre(soot)).toBe(KM * soot);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("zero soot gives optical density 0 and visibility Infinity", () => {
    fc.assert(
      fc.property(arbDensity, (rho) => {
        const s = layerSmoke(0, rho);
        expect(s.opticalDensityPerM).toBe(0);
        expect(s.visibilityM).toBe(Infinity);
      }),
      { numRuns: 100 },
    );
  });
});
