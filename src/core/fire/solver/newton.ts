// Modified Newton iteration for one implicit step: G(y) = F(t, y, alpha0 y + beta) = 0.
// The iteration matrix M = dF/dy + alpha0 dF/dy' is factored once and reused across iterations and steps.
// Refresh rules are DASSL's (CFAST 7.7.7 numerics.f90 ddastp): the matrix is rebuilt when alpha0 / alpha0 at the last rebuild
// leaves the window (0.6, 1.667) (lines 1935-1937), at a restart, and when a corrector attempt fails with an old matrix
// (lines 2069-2072). A rejected error test does not invalidate it (line 2095, jcalc = 1).
import {
  NEWTON_LS_ARMIJO,
  NEWTON_LS_MAX_BACKTRACKS,
  NEWTON_LS_REDUCTION,
  NEWTON_ACCEPT,
  NEWTON_MAX_ITER,
  NEWTON_NEGLIGIBLE_FACTOR,
  NEWTON_RATE_MAX,
  NEWTON_S_INITIAL,
  NEWTON_SLOW_RATIO,
  NEWTON_UROUND,
  NEWTON_XRATE,
} from '../constants';
import { colouredJacobian, createJacobianWork } from './jacobian';
import type { JacobianSparsity, JacobianWork, ResidualFn } from './jacobian';
import { luFactor, luSolve } from './linalg';

export interface IterationMatrix {
  readonly n: number;
  lu: Float64Array;
  piv: Int32Array;
  /** alpha0 used when the matrix was built. */
  alpha0: number;
  valid: boolean;
  /**
   * DASSL's rate factor s = rate / (1 - rate), carried from one step attempt to the next (CFAST 7.7.7 source,
   * numerics.f90 (ddastp), `save` at line 1841). Reset to NEWTON_S_INITIAL when the matrix is rebuilt or alpha0 changes.
   */
  s: number;
  /** alpha0 of the previous Newton call (DASSL's cjlast, numerics.f90 line 1936). */
  alpha0Last: number;
}

export function createIterationMatrix(n: number): IterationMatrix {
  return { n, lu: new Float64Array(n * n), piv: new Int32Array(n), alpha0: 0, valid: false, s: NEWTON_S_INITIAL, alpha0Last: 0 };
}

export interface NewtonWork {
  g: Float64Array;
  dy: Float64Array;
  yp: Float64Array;
  /** Line-search trial residual, correction and point. */
  gT: Float64Array;
  dyT: Float64Array;
  yT: Float64Array;
  /** Best line-search point so far: residual, correction and point. */
  gB: Float64Array;
  dyB: Float64Array;
  yB: Float64Array;
  jac: JacobianWork;
}

export function createNewtonWork(n: number): NewtonWork {
  return {
    g: new Float64Array(n),
    dy: new Float64Array(n),
    yp: new Float64Array(n),
    gT: new Float64Array(n),
    dyT: new Float64Array(n),
    yT: new Float64Array(n),
    gB: new Float64Array(n),
    dyB: new Float64Array(n),
    yB: new Float64Array(n),
    jac: createJacobianWork(n),
  };
}

export interface NewtonParams {
  maxIter: number;
  /** Line search only: a trial step with correction norm at most this fraction of the current one is not refined. */
  slowRatio: number;
  /** DASSL's xrate: the matrix is rebuilt when alpha0 / alpha0 at the last rebuild leaves the window of `jacobianWindow`. */
  xrate: number;
  lsMaxBacktracks: number;
  lsReduction: number;
  lsArmijo: number;
}

export const DEFAULT_NEWTON_PARAMS: NewtonParams = {
  maxIter: NEWTON_MAX_ITER,
  slowRatio: NEWTON_SLOW_RATIO,
  xrate: NEWTON_XRATE,
  lsMaxBacktracks: NEWTON_LS_MAX_BACKTRACKS,
  lsReduction: NEWTON_LS_REDUCTION,
  lsArmijo: NEWTON_LS_ARMIJO,
};

export type NewtonFailure = 'max-iterations' | 'slow' | 'singular' | 'non-finite';

export interface NewtonOutcome {
  converged: boolean;
  reason: NewtonFailure | null;
  iterations: number;
  /** True when this call rebuilt the iteration matrix. A failed call with this flag false may be retried with a fresh matrix. */
  matrixRebuilt: boolean;
  residualEvals: number;
}

/** Weighted RMS norm: sqrt(mean((v_i w_i)^2)). */
export function wrmsNorm(v: Float64Array, w: Float64Array): number {
  const n = v.length;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const x = (v[i] as number) * (w[i] as number);
    s += x * x;
  }
  return Math.sqrt(s / n);
}

export interface CorrectorTest {
  verdict: 'converged' | 'failed' | 'continue';
  /** Rate factor s to carry on. */
  s: number;
  /** Norm of the first correction of this solve to carry on. */
  oldNorm: number;
}

/**
 * DASSL's convergence test for iteration m (0 for the first), CFAST 7.7.7 source, numerics.f90 (ddastp) lines 2039-2047.
 * delnrm is the weighted RMS norm of the Newton correction, pnorm the same norm of the predicted solution, s the carried rate factor.
 *  - delnrm <= 100 uround pnorm: converged (line 2040).
 *  - m = 0: oldnrm = delnrm, s unchanged (lines 2042-2043); m > 0: rate = (delnrm / oldnrm)^(1/m); rate > 0.9 fails (lines 2044-2045),
 *    otherwise s = rate / (1 - rate) (line 2046).
 *  - s delnrm <= 0.33: converged (line 2047). Otherwise the caller goes on to iteration m + 1 (lines 2054-2055).
 * `rateCanFail` false skips the rate > 0.9 failure (used after a damped line-search step, whose norm ratio does not measure the Newton rate).
 */
export function correctorTest(
  m: number,
  delnrm: number,
  oldNorm: number,
  s: number,
  pnorm: number,
  rateCanFail: boolean,
): CorrectorTest {
  if (delnrm <= NEWTON_NEGLIGIBLE_FACTOR * NEWTON_UROUND * pnorm) return { verdict: 'converged', s, oldNorm };
  let sNew = s;
  let oldNew = oldNorm;
  if (m === 0) {
    oldNew = delnrm;
  } else {
    const rate = Math.pow(delnrm / oldNorm, 1 / m);
    if (rate > NEWTON_RATE_MAX) {
      if (rateCanFail) return { verdict: 'failed', s, oldNorm };
    } else {
      sNew = rate / (1 - rate);
    }
  }
  return { verdict: sNew * delnrm <= NEWTON_ACCEPT ? 'converged' : 'continue', s: sNew, oldNorm: oldNew };
}

export interface NewtonArgs {
  residual: ResidualFn;
  sparsity: JacobianSparsity;
  matrix: IterationMatrix;
  work: NewtonWork;
  deltaMin: Float64Array;
  /** Weights 1 / (RTOL |y| + ATOL) that put the correction in units of the error tolerance. */
  weights: Float64Array;
  t: number;
  /** y'(n+1) = alpha0 y(n+1) + beta. */
  alpha0: number;
  beta: Float64Array;
  /** Initial guess on entry, solution on exit (also on failure: discard it). */
  y: Float64Array;
  /** Rebuild the iteration matrix at the first iterate even if it looks valid. */
  forceRefresh?: boolean;
  params?: NewtonParams;
}

/**
 * Solve one implicit step. The convergence test is DASSL's (see correctorTest) on the weighted RMS norm of the Newton
 * correction M^-1 G, the residual expressed in solution units, because the residual rows have different units.
 * As in DASSL's loop (numerics.f90 ddastp): every correction is scaled by 2 / (1 + cj / cjold) (line 2022; cjold is alpha0 at the
 * last rebuild, so the factor is 1 right after a rebuild); the matrix is rebuilt when alpha0 / cjold leaves the xrate window
 * (lines 1935-1937); s is reset to 100 on each rebuild (line 2005); at most maxit = 4 iterations are made (lines 1842, 2054).
 * Not in DASSL: a backtracking line search (numerical parameters NEWTON_LS_*). It stops the iteration from flipping between the two
 * sides of a kink in the residual (for example a vent flow near zero pressure difference). Its merit function is the norm of the
 * scaled correction, the same quantity DASSL tests, so the two do not conflict: the trial correction dyT is scaled with the same
 * factor as dy (the matrix and cjold do not change inside one solve after the first iteration). A full step, as DASSL takes, is the
 * first trial; a shorter step is taken only when the full one does not reduce the norm.
 */
export function newtonSolve(args: NewtonArgs): NewtonOutcome {
  const { residual, sparsity, matrix, work, deltaMin, weights, t, alpha0, beta, y } = args;
  const p = args.params ?? DEFAULT_NEWTON_PARAMS;
  const n = y.length;
  const { g, dy, yp, gT, dyT, yT } = work;
  const out: NewtonOutcome = { converged: false, reason: null, iterations: 0, matrixRebuilt: false, residualEvals: 0 };
  let oldNorm = 0;
  let previousDamped = false;
  if (alpha0 !== matrix.alpha0Last) matrix.s = NEWTON_S_INITIAL; // numerics.f90 line 1938
  matrix.alpha0Last = alpha0;
  const pnorm = wrmsNorm(y, weights); // numerics.f90 line 1974: norm of the predicted solution
  let carried = false; // g and dy already hold the residual and correction at the current y (from the line search)
  let norm = 0;
  let forceRefresh = args.forceRefresh === true;

  for (let k = 1; k <= p.maxIter; k++) {
    out.iterations = k;
    if (!carried) {
      for (let i = 0; i < n; i++) yp[i] = alpha0 * (y[i] as number) + (beta[i] as number);
      residual(t, y, yp, g);
      out.residualEvals++;
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(g[i])) {
          out.reason = 'non-finite';
          return out;
        }
      }

      if (forceRefresh || needsRefresh(matrix, alpha0, p.xrate)) {
        forceRefresh = false;
        const evals = colouredJacobian(residual, sparsity, t, y, yp, alpha0, g, deltaMin, matrix.lu, work.jac);
        out.residualEvals += evals;
        out.matrixRebuilt = true;
        matrix.alpha0 = alpha0; // cjold = cj, numerics.f90 line 2004
        matrix.s = NEWTON_S_INITIAL; // numerics.f90 line 2005
        matrix.valid = luFactor(matrix.lu, n, matrix.piv);
        if (!matrix.valid) {
          out.reason = 'singular';
          return out;
        }
      }

      // numerics.f90 lines 2022-2026: the residual is multiplied by 2 / (1 + cj / cjold) before the back-substitution.
      const scale = correctionScale(alpha0, matrix.alpha0);
      for (let i = 0; i < n; i++) dy[i] = -scale * (g[i] as number);
      luSolve(matrix.lu, matrix.piv, n, dy);
      norm = wrmsNorm(dy, weights);
    }
    carried = false;
    if (!Number.isFinite(norm)) {
      out.reason = 'non-finite';
      return out;
    }

    const test = correctorTest(k - 1, norm, oldNorm, matrix.s, pnorm, !previousDamped);
    matrix.s = test.s;
    oldNorm = test.oldNorm;
    if (test.verdict !== 'continue') {
      for (let i = 0; i < n; i++) y[i] = (y[i] as number) + (dy[i] as number);
      if (test.verdict === 'converged') out.converged = true;
      else out.reason = 'slow';
      return out;
    }

    // Backtracking line search on the norm of the Newton correction at the trial point. The first step length that
    // passes the Armijo test is accepted. When that step only gives a weak decrease (the next iteration would be judged
    // slow), shorter steps are also tried and the best one is kept, as long as the norm keeps falling. This catches the
    // Newton cycle y -> -y on a sign(x) sqrt|x| term (vent flow near zero pressure difference, where the full step lands
    // on the mirror point with an almost equal norm), for which the half step lands near the root.
    let lambda = 1;
    let accepted = false;
    let bestLambda = 1;
    let bestNorm = Infinity;
    for (let j = 0; j <= p.lsMaxBacktracks; j++) {
      for (let i = 0; i < n; i++) yT[i] = (y[i] as number) + lambda * (dy[i] as number);
      for (let i = 0; i < n; i++) yp[i] = alpha0 * (yT[i] as number) + (beta[i] as number);
      residual(t, yT, yp, gT);
      out.residualEvals++;
      let finite = true;
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(gT[i])) {
          finite = false;
          break;
        }
      }
      if (finite) {
        const scaleT = correctionScale(alpha0, matrix.alpha0);
        for (let i = 0; i < n; i++) dyT[i] = -scaleT * (gT[i] as number);
        luSolve(matrix.lu, matrix.piv, n, dyT);
        const normT = wrmsNorm(dyT, weights);
        if (accepted) {
          if (!(normT < bestNorm)) break; // the shorter step is no better: keep the best one found
          keepBest(work);
          bestLambda = lambda;
          bestNorm = normT;
        } else if (Number.isFinite(normT) && normT <= (1 - p.lsArmijo * lambda) * norm) {
          accepted = true;
          keepBest(work);
          bestLambda = lambda;
          bestNorm = normT;
        }
        if (accepted && bestNorm <= p.slowRatio * norm) break; // strong decrease: no need to look further
      } else if (accepted) {
        break;
      }
      if (j === p.lsMaxBacktracks) break;
      lambda *= p.lsReduction;
    }
    if (accepted) {
      y.set(work.yB);
      g.set(work.gB);
      dy.set(work.dyB);
      norm = bestNorm;
      carried = true;
      previousDamped = bestLambda < 1;
    } else {
      // No decrease found: take the full step, as plain modified Newton does, and let the slow-convergence test judge it.
      for (let i = 0; i < n; i++) y[i] = (y[i] as number) + (dy[i] as number);
      previousDamped = false;
    }
  }
  out.reason = 'max-iterations';
  return out;
}

function keepBest(work: NewtonWork): void {
  work.yB.set(work.yT);
  work.gB.set(work.gT);
  work.dyB.set(work.dyT);
}

/** DASSL's correction scale 2 / (1 + cj / cjold), numerics.f90 line 2022. cjold is alpha0 at the last rebuild. */
export function correctionScale(alpha0: number, alpha0AtRebuild: number): number {
  return 2 / (1 + alpha0 / alpha0AtRebuild);
}

/** Window (low, high) of cj / cjold inside which the matrix is kept: ((1 - xrate)/(1 + xrate), its inverse), numerics.f90 lines 1935-1937. */
export function jacobianWindow(xrate: number): { low: number; high: number } {
  const low = (1 - xrate) / (1 + xrate);
  return { low, high: 1 / low };
}

function needsRefresh(matrix: IterationMatrix, alpha0: number, xrate: number): boolean {
  if (!matrix.valid) return true;
  const { low, high } = jacobianWindow(xrate);
  const r = alpha0 / matrix.alpha0;
  return r < low || r > high; // numerics.f90 line 1937
}
