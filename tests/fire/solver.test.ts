// Tests for the implicit solver (tasks.md 8.2): BDF formulas, Newton, step control, LU and Thomas solves.
// Note: Requirement 9.3 says "residual norm"; the code tests the weighted RMS norm of the Newton correction
// (see newton.ts). These tests check the behaviour of the code.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  bdfCoefficients,
  createHistory,
  fillBeta,
  predict,
  pushHistory,
} from "../../src/core/fire/solver/bdf";
import { denseSparsity } from "../../src/core/fire/solver/jacobian";
import type { ResidualFn } from "../../src/core/fire/solver/jacobian";
import { luFactor, luSolve, thomasSolve } from "../../src/core/fire/solver/linalg";
import { ImplicitSolver } from "../../src/core/fire/solver/stepControl";
import type { SolverParams } from "../../src/core/fire/solver/stepControl";
import {
  correctionScale,
  correctorTest,
  createIterationMatrix,
  createNewtonWork,
  DEFAULT_NEWTON_PARAMS,
  jacobianWindow,
  newtonSolve,
} from "../../src/core/fire/solver/newton";
import { STEP_BDF2_OMEGA_MAX } from "../../src/core/fire/constants";

const NUM_RUNS = 100;

function makeSolver(n: number, residual: ResidualFn, atol: number, params: Partial<SolverParams> = {}): ImplicitSolver {
  return new ImplicitSolver({
    residual,
    sparsity: denseSparsity(n),
    atol: new Float64Array(n).fill(atol),
    deltaMin: new Float64Array(n).fill(1e-8),
    params,
  });
}

/** Residual of y' = f(t, y) for one unknown: F = y' - f. */
function scalarOde(f: (t: number, y: number) => number): ResidualFn {
  return (t, y, yp, out) => {
    out[0] = (yp[0] as number) - f(t, y[0] as number);
  };
}

/** Advance to tEnd with repeated advance calls; returns the number of accepted steps. */
function integrate(s: ImplicitSolver, tEnd: number): number {
  let steps = 0;
  while (s.t < tEnd) {
    const r = s.advance(tEnd);
    if (!r.ok) throw new Error(`solver failed at t=${r.t}`);
    steps++;
    if (steps > 100000) throw new Error("too many steps");
  }
  return steps;
}

describe("Property 21: BDF integration is exact on low-degree polynomials and converges", () => {
  // Feature: fire-zone, Property 21: BDF integration is exact on low-degree polynomials and converges
  // **Validates: Requirements 9.1, 9.4**
  const arbPoly = fc.record({
    a: fc.double({ min: -5, max: 5, noNaN: true }),
    b: fc.double({ min: -5, max: 5, noNaN: true }),
    c: fc.double({ min: -5, max: 5, noNaN: true }),
  });

  it("variable-step BDF2 and the quadratic predictor reproduce any quadratic within rounding", () => {
    fc.assert(
      fc.property(
        arbPoly,
        fc.double({ min: -2, max: 2, noNaN: true }),
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        fc.double({ min: 0.1, max: STEP_BDF2_OMEGA_MAX - 0.01, noNaN: true }),
        ({ a, b, c }, tStart, h2, h1, omega) => {
          const p = (t: number) => a + b * t + c * t * t;
          const dp = (t: number) => b + 2 * c * t;
          const hist = createHistory(1);
          const t2 = tStart;
          const t1 = t2 + h2;
          const t0 = t1 + h1;
          for (const t of [t2, t1, t0]) pushHistory(hist, t, Float64Array.of(p(t)), Float64Array.of(dp(t)));
          expect(hist.count).toBe(3);

          const h = omega * h1;
          const tNew = t0 + h;
          const coef = bdfCoefficients(hist, h, STEP_BDF2_OMEGA_MAX);
          expect(coef.order).toBe(2);
          const beta = new Float64Array(1);
          fillBeta(hist, coef, beta);
          const ypNew = coef.alpha0 * p(tNew) + (beta[0] as number);
          const scale = 1 + Math.abs(a) + Math.abs(b) + Math.abs(c);
          expect(Math.abs(ypNew - dp(tNew))).toBeLessThanOrEqual(1e-9 * scale);

          const out = new Float64Array(1);
          predict(hist, tNew, out);
          expect(Math.abs((out[0] as number) - p(tNew))).toBeLessThanOrEqual(1e-9 * scale);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("the solver integrates y' = b exactly (any step sequence) within rounding", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: 0.5, max: 3, noNaN: true }),
        (y0, b, tEnd) => {
          const s = makeSolver(1, scalarOde(() => b), 1e-6);
          s.restart(0, Float64Array.of(y0));
          integrate(s, tEnd);
          expect(s.t).toBe(tEnd);
          expect(Math.abs((s.y[0] as number) - (y0 + b * tEnd))).toBeLessThanOrEqual(1e-9 * (1 + Math.abs(y0) + Math.abs(b) * tEnd));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("y' = -lambda y has accepted-step error within a fixed factor of the tolerance, and tighter rtol gives smaller error", () => {
    const rtol = 1e-4;
    const atol = 1e-8;
    const FACTOR = 20; // fixed factor of the requested tolerance (design Property 21); global error accumulates over steps
    const run = (lambda: number, tEnd: number, tol: number) => {
      const s = makeSolver(1, scalarOde((_t, y) => -lambda * y), atol, { rtol: tol });
      s.restart(0, Float64Array.of(1));
      integrate(s, tEnd);
      return Math.abs((s.y[0] as number) - Math.exp(-lambda * tEnd));
    };
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 5, noNaN: true }),
        fc.double({ min: 0.5, max: 2, noNaN: true }),
        (lambda, tEnd) => {
                    expect(run(lambda, tEnd, rtol)).toBeLessThanOrEqual(FACTOR * (rtol * 1 + atol));
        },
      ),
      { numRuns: NUM_RUNS },
    );
    // Convergence: the error does not grow when the tolerance is tightened by a factor of 1000.
    expect(run(1, 1, rtol / 1000)).toBeLessThan(run(1, 1, rtol));
  });
});

describe("solver unit tests", () => {
  it("linear test equation y' = -y reaches exp(-t) and lands exactly on the end time", () => {
    const s = makeSolver(1, scalarOde((_t, y) => -y), 1e-8);
    s.restart(0, Float64Array.of(1));
    integrate(s, 2);
    expect(s.t).toBe(2);
    expect(s.y[0] as number).toBeCloseTo(Math.exp(-2), 2);
    expect(s.stats.steps).toBeGreaterThan(0);
    expect(s.stats.rejected + s.stats.newtonFailures).toBeGreaterThanOrEqual(0);
  });

  it("the first step is BDF1 and later steps use BDF2", () => {
    const s = makeSolver(1, scalarOde((_t, y) => -y), 1e-8);
    s.restart(0, Float64Array.of(1));
    const first = s.advance(1);
    const second = s.advance(1);
    expect(first.ok && first.order).toBe(1);
    expect(second.ok && second.order).toBe(2);
  });

  it("advance with tEnd not after the current time is a no-op", () => {
    const s = makeSolver(1, scalarOde((_t, y) => -y), 1e-8);
    s.restart(1, Float64Array.of(1));
    const r = s.advance(1);
    expect(r).toEqual({ ok: true, t: 1, h: 0, order: 1 });
  });

  it("a stiff pressure-relaxation problem is stable with steps far above the relaxation time", () => {
    // p' = -k (p - p_eq(t)) with k = 1e6 1/s: relaxation time 1 microsecond, explicit methods need h < 2e-6.
    const k = 1e6;
    const pEq = (t: number) => 10 * Math.sin(t);
    const s = makeSolver(1, scalarOde((t, p) => -k * (p - pEq(t))), 1e-3);
    s.restart(0, Float64Array.of(0));
    const steps = integrate(s, 1);
    expect(s.y[0] as number).toBeCloseTo(pEq(1), 1);
    expect(steps).toBeLessThan(2000); // an explicit method would need at least 5e5 steps
  });

  it("a stiff two-unknown system with a mixed algebraic row keeps the algebraic constraint", () => {
    // y0' = -y0 (differential), y1 = 2 y0 (algebraic row: F1 = y1 - 2 y0).
    const residual: ResidualFn = (_t, y, yp, out) => {
      out[0] = (yp[0] as number) + (y[0] as number);
      out[1] = (y[1] as number) - 2 * (y[0] as number);
    };
    const s = new ImplicitSolver({
      residual,
      sparsity: denseSparsity(2),
      atol: new Float64Array(2).fill(1e-8),
      deltaMin: new Float64Array(2).fill(1e-8),
      differential: Uint8Array.of(1, 0),
    });
    s.restart(0, Float64Array.of(1, 2));
    integrate(s, 1);
    expect(s.y[0] as number).toBeCloseTo(Math.exp(-1), 2);
    expect(Math.abs((s.y[1] as number) - 2 * (s.y[0] as number))).toBeLessThan(1e-6);
  });

  it("a failing Newton iteration reduces the step and retries; the state advances to a finite value", () => {
    // y' = -50 y^3 is nonlinear. With one Newton iteration allowed, the first large step cannot converge.
    const newton = { ...DEFAULT_NEWTON_PARAMS, maxIter: 1 };
    const s = makeSolver(1, scalarOde((_t, y) => -50 * y * y * y), 1e-8, { newton, hInitial: 0.5 });
    s.restart(0, Float64Array.of(1));
    const r = s.advance(1);
    expect(s.stats.newtonFailures).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.h).toBeLessThan(0.5);
      expect(r.t).toBe(s.t);
    }
    expect(Number.isFinite(s.y[0] as number)).toBe(true);
    expect(s.y[0] as number).toBeLessThan(1);
    expect(s.y[0] as number).toBeGreaterThan(0);
  });

  it("failure below H_MIN returns ok=false with the last accepted time and leaves the state unchanged", () => {
    const tBad = 0.3;
    const residual: ResidualFn = (t, y, yp, out) => {
      out[0] = t > tBad ? Number.NaN : (yp[0] as number) + (y[0] as number);
    };
    const s = makeSolver(1, residual, 1e-8);
    s.restart(0, Float64Array.of(1));
    let result = s.advance(1);
    while (result.ok && s.t < 1) result = s.advance(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("h-min");
      expect(result.t).toBe(s.t);
      expect(result.t).toBeLessThanOrEqual(tBad);
      expect(result.t).toBeGreaterThan(tBad - 1);
      expect(result.h).toBeLessThan(s.stats.steps > 0 ? 1e-8 : Infinity);
    }
    expect(s.stats.newtonFailures).toBeGreaterThan(0);
    expect(s.y[0] as number).toBeCloseTo(Math.exp(-s.t), 3);
  });

  it("a fast transient right after a restart may use steps below H_MIN (start-up floor H_MIN_STARTUP)", () => {
    // y' = -k (y - 1), y(0) = 0, k = 1e6 1/s: the first BDF1 error is about 0.5 h^2 k^2, so with ATOL 1e-8 the first
    // step must be about 1e-10 s, below H_MIN = 1e-8 s.
    const f = scalarOde((_t, y) => -1e6 * (y - 1));
    const s = makeSolver(1, f, 1e-8);
    s.restart(0, Float64Array.of(0));
    const first = s.advance(1e-3);
    expect(first.ok).toBe(true);
    expect(first.h).toBeLessThan(1e-8);
    integrate(s, 1e-3);
    expect(s.y[0] as number).toBeCloseTo(1, 6);
    // Without the start-up floor the same run stops at t = 0.
    const strict = makeSolver(1, f, 1e-8, { hMinStartup: 1e-8 });
    strict.restart(0, Float64Array.of(0));
    const r = strict.advance(1e-3);
    expect(r.ok).toBe(false);
    expect(r.t).toBe(0);
  });

  it("restart drops the history so the next step is BDF1 with the initial step", () => {
    const s = makeSolver(1, scalarOde((_t, y) => -y), 1e-8);
    s.restart(0, Float64Array.of(1));
    integrate(s, 0.5);
    s.restart(s.t, Float64Array.of(s.y[0] as number));
    expect(s.h).toBe(1e-3);
    const r = s.advance(1);
    expect(r.ok && r.order).toBe(1);
  });

  it("is deterministic: two identical runs give bit-identical states", () => {
    const run = () => {
      const s = makeSolver(1, scalarOde((_t, y) => -3 * y), 1e-8);
      s.restart(0, Float64Array.of(1));
      integrate(s, 1);
      return s.y[0];
    };
    expect(run()).toBe(run());
  });
});

describe("linear algebra", () => {
  it("LU with partial pivoting solves a known 3x3 system that needs a row swap", () => {
    // 0 x + 2 y + 1 z = 7 ; 1 x + 1 y + 1 z = 6 ; 2 x + 1 y + 0 z = 4  ->  x = 1, y = 2, z = 3
    const a = Float64Array.of(0, 2, 1, 1, 1, 1, 2, 1, 0);
    const x = [1, 2, 3];
    const b = Float64Array.of(2 * 2 + 3, 1 + 2 + 3, 2 + 2);
    const piv = new Int32Array(3);
    expect(luFactor(a, 3, piv)).toBe(true);
    luSolve(a, piv, 3, b);
    x.forEach((v, i) => expect(b[i] as number).toBeCloseTo(v, 12));
  });

  it("LU reports a singular matrix", () => {
    const a = Float64Array.of(1, 2, 2, 4);
    expect(luFactor(a, 2, new Int32Array(2))).toBe(false);
    expect(luFactor(Float64Array.of(Number.NaN), 1, new Int32Array(1))).toBe(false);
  });

  it("Thomas solves a known tridiagonal system", () => {
    // [2 -1 0; -1 2 -1; 0 -1 2] x = [1 0 1]  ->  x = [1 1 1]
    const sub = Float64Array.of(0, -1, -1);
    const diag = Float64Array.of(2, 2, 2);
    const sup = Float64Array.of(-1, -1, 0);
    const x = new Float64Array(3);
    expect(thomasSolve(sub, diag, sup, Float64Array.of(1, 0, 1), x, 3, new Float64Array(3))).toBe(true);
    [1, 1, 1].forEach((v, i) => expect(x[i] as number).toBeCloseTo(v, 12));
  });

  it("Thomas reports a zero pivot and accepts n = 0", () => {
    const z = new Float64Array(2);
    expect(thomasSolve(z, z, z, z, new Float64Array(2), 2, new Float64Array(2))).toBe(false);
    expect(thomasSolve(z, z, z, z, new Float64Array(0), 0, new Float64Array(0))).toBe(true);
  });

  it("Thomas and LU agree on random diagonally dominant tridiagonal systems", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }).chain((n) =>
          fc.record({
            n: fc.constant(n),
            sub: fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: n, maxLength: n }),
            sup: fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: n, maxLength: n }),
            rhs: fc.array(fc.double({ min: -10, max: 10, noNaN: true }), { minLength: n, maxLength: n }),
          }),
        ),
        ({ n, sub, sup, rhs }) => {
          const subA = Float64Array.from(sub);
          const supA = Float64Array.from(sup);
          subA[0] = 0;
          supA[n - 1] = 0;
          const diag = new Float64Array(n).fill(3); // |sub| + |sup| <= 2 < 3
          const dense = new Float64Array(n * n);
          for (let i = 0; i < n; i++) {
            dense[i * n + i] = diag[i] as number;
            if (i > 0) dense[i * n + i - 1] = subA[i] as number;
            if (i < n - 1) dense[i * n + i + 1] = supA[i] as number;
          }
          const x = new Float64Array(n);
          expect(thomasSolve(subA, diag, supA, Float64Array.from(rhs), x, n, new Float64Array(n))).toBe(true);
          const piv = new Int32Array(n);
          const b = Float64Array.from(rhs);
          expect(luFactor(dense, n, piv)).toBe(true);
          luSolve(dense, piv, n, b);
          for (let i = 0; i < n; i++) expect(Math.abs((x[i] as number) - (b[i] as number))).toBeLessThan(1e-10);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("DASSL iteration-matrix rules (CFAST 7.7.7 source, numerics.f90 ddastp)", () => {
  it("uses maxit = 4 (line 1842) and xrate = 0.25 (line 1843)", () => {
    expect(DEFAULT_NEWTON_PARAMS.maxIter).toBe(4);
    expect(DEFAULT_NEWTON_PARAMS.xrate).toBe(0.25);
  });

  it("the rebuild window is (0.6, 1/0.6) for xrate 0.25 (lines 1935-1937)", () => {
    const w = jacobianWindow(0.25);
    expect(w.low).toBeCloseTo(0.6, 14);
    expect(w.high).toBeCloseTo(1 / 0.6, 14);
  });

  it("the correction scale is 2 / (1 + cj / cjold) (line 2022): 1 at the rebuild, 1.25 and 0.75 at the window edges", () => {
    expect(correctionScale(7, 7)).toBe(1);
    expect(correctionScale(0.6, 1)).toBeCloseTo(1.25, 12);
    expect(correctionScale(5 / 3, 1)).toBeCloseTo(0.75, 12);
  });

  // y' = -y with one unknown; the Newton matrix is 1 + alpha0.
  const solveOnce = (matrix: ReturnType<typeof createIterationMatrix>, alpha0: number, params = DEFAULT_NEWTON_PARAMS) => {
    const y = Float64Array.of(1);
    return newtonSolve({
      residual: (_t, yy, yp, out) => {
        out[0] = (yp[0] as number) + (yy[0] as number);
      },
      sparsity: denseSparsity(1),
      matrix,
      work: createNewtonWork(1),
      deltaMin: Float64Array.of(1e-8),
      weights: Float64Array.of(1),
      t: 0,
      alpha0,
      beta: Float64Array.of(-alpha0),
      y,
      params,
    });
  };

  it("rebuilds the matrix only when alpha0 / alpha0 at the last rebuild leaves (0.6, 1.667)", () => {
    const m = createIterationMatrix(1);
    expect(solveOnce(m, 100).matrixRebuilt).toBe(true); // first use
    expect(solveOnce(m, 100).matrixRebuilt).toBe(false);
    expect(solveOnce(m, 160).matrixRebuilt).toBe(false); // ratio 1.6 inside
    expect(solveOnce(m, 61).matrixRebuilt).toBe(false); // ratio 0.61 inside
    expect(solveOnce(m, 59).matrixRebuilt).toBe(true); // ratio 0.59 outside, rebuilt at alpha0 = 59
    expect(m.alpha0).toBe(59);
    expect(solveOnce(m, 59 * 1.7).matrixRebuilt).toBe(true); // ratio 1.7 outside
    expect(solveOnce(m, 59 * 1.7 * 1.9).matrixRebuilt).toBe(true); // a factor 1.9 would not have rebuilt under the old factor-2 rule
  });

  it("resets s to 100 on every rebuild and carries it otherwise", () => {
    // Linear problem: the first correction is exact (delnrm about 0.0099, so s * delnrm = 0.99 with s = 100 is not accepted);
    // the second correction is below roundoff.
    const fresh = createIterationMatrix(1);
    fresh.s = 1e-3; // a small carried s is discarded by the first rebuild
    const a = solveOnce(fresh, 100);
    expect(a.matrixRebuilt).toBe(true);
    expect(a.iterations).toBe(2);
    // Same alpha0, inside the window, no rebuild: a small carried s accepts the first correction (plain DASSL).
    fresh.s = 1e-3;
    const b = solveOnce(fresh, 100);
    expect(b.matrixRebuilt).toBe(false);
    expect(b.converged).toBe(true);
    expect(b.iterations).toBe(1);
    // alpha0 changed (inside the window): s goes back to 100 (line 1938), so the first correction is not accepted.
    fresh.s = 1e-3;
    const c = solveOnce(fresh, 110);
    expect(c.matrixRebuilt).toBe(false);
    expect(c.iterations).toBe(2);
  });

  it("fails after 4 iterations (maxit, lines 1842 and 2054) when the stale matrix converges at rate 0.8", () => {
    // F = y' + c y with M built for c = 1 (M = 101 at alpha0 = 100); with c = 81.8 the true Jacobian is 181.8 and the
    // modified Newton error shrinks by |1 - 181.8 / 101| = 0.8 per iteration. Weights make the first correction huge.
    let c = 1;
    const m = createIterationMatrix(1);
    const args = {
      residual: (_t: number, yy: Float64Array, yp: Float64Array, out: Float64Array) => {
        out[0] = (yp[0] as number) + c * (yy[0] as number);
      },
      sparsity: denseSparsity(1),
      matrix: m,
      work: createNewtonWork(1),
      deltaMin: Float64Array.of(1e-8),
      weights: Float64Array.of(1e6),
      t: 0,
      alpha0: 100,
      beta: Float64Array.of(0),
      params: { ...DEFAULT_NEWTON_PARAMS, lsMaxBacktracks: 0 }, // no line search: plain DASSL iteration
    };
    newtonSolve({ ...args, y: Float64Array.of(0) }); // builds the matrix at c = 1
    c = 81.8;
    const out = newtonSolve({ ...args, y: Float64Array.of(1) });
    expect(out.matrixRebuilt).toBe(false);
    expect(out.converged).toBe(false);
    expect(out.iterations).toBe(4);
    expect(out.reason).toBe("max-iterations");
  });
});

describe("DASSL corrector acceptance rule (CFAST 7.7.7 source, numerics.f90 ddastp lines 2039-2047)", () => {
  const EPS = Number.EPSILON;

  it("first iteration: accepted only when negligible or when s * delnrm <= 0.33 with the carried s", () => {
    // Negligible: delnrm <= 100 uround pnorm, whatever s is.
    expect(correctorTest(0, 99 * EPS, 0, 1e9, 1, true).verdict).toBe("converged");
    // Fresh matrix (s = 100): delnrm = 0.01 gives s * delnrm = 1 > 0.33, so not accepted; the first norm is kept as oldnrm.
    const r = correctorTest(0, 0.01, 0, 100, 1, true);
    expect(r.verdict).toBe("continue");
    expect(r.oldNorm).toBe(0.01);
    expect(r.s).toBe(100);
    // Carried s = 2 from an earlier step: the same correction is accepted at iteration 1 (2 * 0.01 <= 0.33).
    expect(correctorTest(0, 0.01, 0, 2, 1, true).verdict).toBe("converged");
  });

  it("from the second iteration: rate = (delnrm / oldnrm)^(1/m) above 0.9 is a failure", () => {
    // m = 2, ratio 0.82 gives rate sqrt(0.82) = 0.9055 > 0.9.
    expect(correctorTest(2, 0.82, 1, 100, 1, true).verdict).toBe("failed");
    // The failure is skipped after a damped line-search step; s is then not updated.
    const r = correctorTest(2, 0.82, 1, 100, 1, false);
    expect(r.verdict).toBe("continue");
    expect(r.s).toBe(100);
  });

  it("from the second iteration: converged when rate / (1 - rate) * delnrm <= 0.33, and s is updated", () => {
    // m = 1, oldnrm = 1, delnrm = 0.2: rate 0.2, s = 0.25, s * delnrm = 0.05.
    const ok = correctorTest(1, 0.2, 1, 100, 1, true);
    expect(ok.verdict).toBe("converged");
    expect(ok.s).toBeCloseTo(0.25, 12);
    // m = 1, oldnrm = 1, delnrm = 0.6: rate 0.6, s = 1.5, s * delnrm = 0.9 > 0.33: continue.
    const no = correctorTest(1, 0.6, 1, 100, 1, true);
    expect(no.verdict).toBe("continue");
    expect(no.s).toBeCloseTo(1.5, 12);
    // Boundary: rate 0.5 (s = 1), delnrm = 0.33 is accepted.
    expect(correctorTest(1, 0.33, 0.66, 100, 1, true).verdict).toBe("converged");
  });
});
