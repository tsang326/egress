// Case evaluation for the Validation_Suite (fire-zone Req 13.2, 13.3, 13.9, 9.9, 6.13, 15.3). Node and test use only.
// `evaluateCase` turns one CFAST input file into a CaseResult for report.ts. It never throws on bad input and never
// changes a tolerance; the verdict comes from the CFAST-order run only.

import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseCfastInput } from '../../src/core/fire/cfast-input';
import { runFire } from '../../src/core/fire';
import type { Result, RunOptions, Scenario, VentSeries, Warning } from '../../src/core/fire/types';
import { compareRuns, compareWithReference, type CaseComparison, type RunDifference } from './compare';
import { parseReferenceCsv, type ReferenceTable } from './referenceCsv';
import type { CaseResult } from './report';

/** Every `.in` file below `casesDir`, as absolute paths in code-unit order. */
export function findCaseFiles(casesDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.in')) out.push(p);
    }
  };
  walk(casesDir);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Repository-relative path with `/` separators. */
export function repoPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}

/** `validation/cases/<dir>/<name>.in` -> the two reference CSV paths under `validation/reference/<dir>/`. */
export function referencePaths(casePath: string): { compartments: string; vents: string } {
  const m = /^validation\/cases\/(.*)\.in$/.exec(casePath);
  const stem = m ? `validation/reference/${m[1]}` : casePath.replace(/\.in$/, '');
  return { compartments: `${stem}_compartments.csv`, vents: `${stem}_vents.csv` };
}

/** `SPREADSHEET` of the `&TIME` group (CSV output interval, s), or undefined. Plain text scan, nothing is evaluated. */
export function spreadsheetIntervalS(text: string): number | undefined {
  const group = /&TIME\b([^/]*)\//i.exec(text);
  if (!group) return undefined;
  const m = /\bSPREADSHEET\s*=\s*([-+0-9.eE]+)/i.exec(group[1] as string);
  if (!m) return undefined;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

const normalise = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Gives each model vent the entity name CFAST writes in the vents CSV (header row 3). Ratio-built leakage vents are
 * named like CFAST `initialize_leakage` ("Wall Leak <compartment>", "Floor Leak <compartment>"); a vent whose id differs
 * from the CSV entity only in case or spacing is renamed to the CSV spelling. Vents without a CSV entity keep their id and
 * are then reported as "no reference column", never dropped.
 */
export function mapVentIdsToReference(result: Result, vents: ReferenceTable): Result {
  const csvNames = new Map<string, string>();
  for (const c of vents.columns) if (!csvNames.has(normalise(c.entity))) csvNames.set(normalise(c.entity), c.entity);
  const mapped: VentSeries[] = result.vents.map((v) => {
    const name = csvNames.get(normalise(v.id));
    return name !== undefined && name !== v.id ? { ...v, id: name } : v;
  });
  return { ...result, vents: mapped };
}

export interface CaseInput {
  /** Repository-relative path of the `.in` file. */
  readonly path: string;
  readonly text: string;
  /** Text of a repository-relative file, or undefined when it does not exist. */
  readonly readText: (path: string) => string | undefined;
}

/** Wall-clock limit of one `runFire` call in the suite (Req 13.14), ms. */
export const CASE_RUN_WALL_LIMIT_MS = 600_000;

/** Thrown by the checkpoint hook when a run passes its wall-clock limit. The driver turns it into a failed Result. */
export class WallClockLimitError extends Error {
  constructor(readonly elapsedMs: number) {
    super(`wall-clock limit passed after ${elapsedMs} ms`);
    this.name = 'WallClockLimitError';
  }
}

export interface RunLimits {
  /** Default CASE_RUN_WALL_LIMIT_MS. */
  readonly wallLimitMs?: number;
  /** Milliseconds, like performance.now. Tests inject a fake one. */
  readonly clock?: () => number;
}

interface RunOutcome {
  readonly result?: Result;
  readonly error?: string;
  /** Set when the run was stopped at the wall-clock limit: the text for the report. */
  readonly stopped?: string;
}

function stopMessage(label: string, reachedS: number, durationS: number, wallMs: number, limitMs: number): string {
  return (
    `${label} was stopped at the ${formatSeconds(limitMs)} s wall-clock limit (Req 13.14). Simulated time reached: ` +
    `${reachedS} s of ${durationS} s (time of the last sample). Wall-clock time: ${formatSeconds(wallMs)} s.`
  );
}

function formatSeconds(ms: number): string {
  return String(Number((ms / 1000).toPrecision(5)));
}

/** True when a door-jet fire can add heat to a compartment: the case has a fire and a wall vent between two compartments. */
export function hasDoorJetPath(s: Scenario): boolean {
  return s.fires.length > 0 && s.vents.some((v) => v.kind === 'wall' && v.from !== 'OUTSIDE' && v.to !== 'OUTSIDE');
}

export type RunFn = (scenario: Scenario, options?: RunOptions) => Result;

export interface CaseEvaluation {
  readonly result: CaseResult;
  /** Wall time of both runs in ms (harness only, never part of a Result). */
  readonly runTimeMs: number;
  /** Number of `runFire` calls made. */
  readonly runs: number;
}

function warningText(w: Warning): string {
  return `${w.code}${w.timeS !== null ? ` at ${w.timeS} s` : ''}: ${w.message}`;
}

function failed(path: string, reason: string, extra: Partial<CaseResult> = {}): CaseResult {
  return { path, verdict: 'outside tolerance', reason, ...extra };
}

/** Why the run itself disqualifies the case (Req 9.9, 13.3), or undefined when it can be compared. */
export function runFailureReason(r: Result): string | undefined {
  const gate = r.warnings.filter((w) => w.code === 'FIRE_PLUME_PASSES_NOT_CONVERGED');
  if (gate.length > 0) {
    return `Plume pass iteration did not converge (FIRE_PLUME_PASSES_NOT_CONVERGED, Req 9.9), so the case counts as outside tolerance. ${warningText(gate[0] as Warning)}`;
  }
  if (r.status !== 'ok') {
    const shown = r.warnings.slice(0, 5).map(warningText).join(' | ');
    return `The run ended with status "${r.status}"${shown ? `. Warnings: ${shown}` : ''}`;
  }
  return undefined;
}

/** The scenario of a case with the CSV output interval of the CFAST input (Req 13.1). */
function baseScenario(text: string, scenario: Scenario): Scenario {
  const interval = spreadsheetIntervalS(text);
  return interval !== undefined ? { ...scenario, printIntervalS: interval } : scenario;
}

/** `base` with the model options of one run. The door-jet setting defaults to the one of the CFAST input. */
function withOptions(base: Scenario, cfastOrder: boolean, cfastRoofDensity: boolean, doorJets: boolean = base.options?.doorJetFires !== false): Scenario {
  return {
    ...base,
    options: {
      ...base.options,
      cfastUpperPlumeArgOrder: cfastOrder,
      cfastRoofVentOutsideDensity: cfastRoofDensity,
      doorJetFires: doorJets,
    },
  };
}

// Req 13.14: every run gets its own wall-clock limit. The limit is checked through RunOptions.checkpoint, which the driver
// calls before every attempted step and before every residual evaluation, so one long step cannot overrun it.
function limitedRunner(run: RunFn, limits: RunLimits, onRun: () => void): (label: string, s: Scenario) => RunOutcome {
  const clock = limits.clock ?? (() => performance.now());
  const limitMs = limits.wallLimitMs ?? CASE_RUN_WALL_LIMIT_MS;
  return (label, s) => {
    const start = clock();
    let stoppedAfterMs: number | undefined;
    const checkpoint = (): void => {
      const elapsed = clock() - start;
      if (elapsed > limitMs) {
        stoppedAfterMs = elapsed;
        throw new WallClockLimitError(elapsed);
      }
    };
    onRun();
    let result: Result | undefined;
    let error: unknown;
    try {
      result = run(s, { checkpoint });
    } catch (e) {
      error = e;
    }
    if (stoppedAfterMs !== undefined) {
      // The driver keeps the samples written before the stop; the last sample time is the simulated time reached.
      const reached = result && result.timesS.length > 0 ? (result.timesS[result.timesS.length - 1] as number) : 0;
      return { stopped: stopMessage(label, reached, s.durationS, stoppedAfterMs, limitMs) };
    }
    if (error !== undefined) return { error: error instanceof Error ? error.message : String(error) };
    return { result: result as Result };
  };
}

export interface DoorJetDiagnosis {
  /** Largest difference between the verdict run and the run with the opposite door-jet setting. */
  readonly difference?: RunDifference;
  /** Why there is no difference: no door-jet path, a failed or stopped run, or an unreadable case. */
  readonly unavailable?: string;
}

/**
 * DIAGNOSIS ONLY (Req 6.14): runs a case twice, with the door-jet setting of the CFAST input (the verdict run) and with the
 * opposite setting, and returns the largest difference. It is not called by `npm run test:validation` and nothing in
 * REPORT.md depends on it; use it from a test or a scratch script when a downstream layer differs from CFAST. It needs no
 * reference files. Both runs use the CFAST plume order and the CFAST roof-vent density, like the verdict run.
 */
export function diagnoseDoorJetDifference(input: Pick<CaseInput, 'text'>, run: RunFn = (s, o) => runFire(s, o), limits: RunLimits = {}): DoorJetDiagnosis {
  const parsed = parseCfastInput(input.text);
  if (parsed.unsupported.length > 0 || parsed.scenario === null) return { unavailable: 'the case could not be read or is unsupported.' };
  const base = baseScenario(input.text, parsed.scenario);
  if (!hasDoorJetPath(base)) {
    return { unavailable: 'no wall vent joins two compartments, or the case has no fire, so the two settings give the same result.' };
  }
  const runLimited = limitedRunner(run, limits, () => undefined);
  const cfastDoorJets = base.options?.doorJetFires !== false;
  const verdict = runLimited('The verdict run', withOptions(base, true, true));
  const flipped = runLimited('The door-jet comparison run', withOptions(base, true, true, !cfastDoorJets));
  for (const o of [verdict, flipped]) {
    if (o.stopped !== undefined) return { unavailable: o.stopped };
    if (o.result === undefined) return { unavailable: `the model raised an error: ${o.error ?? 'unknown'}` };
    if (o.result.status !== 'ok') return { unavailable: `a run ended with status "${o.result.status}".` };
  }
  return { difference: compareRuns(verdict.result as Result, flipped.result as Result) };
}

/** Evaluates one case. `run` defaults to `runFire`; tests inject a stub. */
export function evaluateCase(input: CaseInput, run: RunFn = (s, o) => runFire(s, o), limits: RunLimits = {}): CaseEvaluation {
  const { path } = input;
  const t0 = performance.now();
  let runs = 0;
  const done = (result: CaseResult): CaseEvaluation => ({ result, runTimeMs: performance.now() - t0, runs });

  const parsed = parseCfastInput(input.text);
  if (parsed.unsupported.length > 0) {
    const reason = parsed.unsupported.map((u) => `${u.code} (line ${u.line}): ${u.detail}`).join('; ');
    return done({ path, verdict: 'unsupported', reason: `unsupported: ${reason}` });
  }
  if (parsed.scenario === null) {
    return done(failed(path, `The input could not be read: ${parsed.warnings.slice(0, 3).map(warningText).join(' | ')}`));
  }
  const refs = referencePaths(path);
  const compText = input.readText(refs.compartments);
  const ventText = input.readText(refs.vents);
  const missing = [compText === undefined ? refs.compartments : '', ventText === undefined ? refs.vents : ''].filter((m) => m !== '');
  if (compText === undefined || ventText === undefined) {
    return done(failed(path, `Missing reference file: ${missing.join(', ')}`));
  }
  const compartments = parseReferenceCsv(compText, 'compartments');
  const vents = parseReferenceCsv(ventText, 'vents');

  const base = baseScenario(input.text, parsed.scenario);
  // Verdict run: CFAST plume argument order (Req 6.13), CFAST roof-vent outside density (Req 5.10) and the door-jet setting
  // of the CFAST input (Req 6.14, on unless the input says &DIAG DOOR_JET_FIRE_SUB_MODEL = 'OFF').
  // Two more runs change one option each, for the difference blocks of the report; they never change a verdict.
  // The door-jet comparison run is not part of the suite; see diagnoseDoorJetDifference.
  const cfastDoorJets = base.options?.doorJetFires !== false;
  const runLimited = limitedRunner(run, limits, () => void runs++);

  const verdictOutcome = runLimited('The CFAST-order run (verdict run)', withOptions(base, true, true));
  if (verdictOutcome.stopped !== undefined) {
    const skipped = 'the verdict run was stopped at the wall-clock limit, so this comparison run was not started.';
    return done(
      failed(path, verdictOutcome.stopped, {
        runDifferenceUnavailable: skipped,
        roofVentDifferenceUnavailable: skipped,
      }),
    );
  }
  if (verdictOutcome.result === undefined) {
    return done(failed(path, `The model raised an error: ${verdictOutcome.error ?? 'unknown'}`));
  }
  const cfastRun = verdictOutcome.result;
  const intended = runLimited('The intended-order run', withOptions(base, false, true));
  const runDifference = intended.result && intended.result.status === 'ok' ? compareRuns(cfastRun, intended.result) : undefined;
  const realDensity = runLimited('The ambient-density run', withOptions(base, true, false));
  const roofVentDifference = realDensity.result && realDensity.result.status === 'ok' ? compareRuns(cfastRun, realDensity.result) : undefined;
  const diffs = {
    ...(runDifference ? { runDifference } : {}),
    ...(roofVentDifference ? { roofVentDifference } : {}),
    doorJetSetting: cfastDoorJets ? ('on' as const) : ('off' as const),
    ...(intended.stopped !== undefined ? { runDifferenceUnavailable: `the run was stopped. ${intended.stopped}` } : {}),
    ...(realDensity.stopped !== undefined ? { roofVentDifferenceUnavailable: `the run was stopped. ${realDensity.stopped}` } : {}),
  };
  // A stopped comparison run fails the case (Req 13.14) even when the verdict run compares within tolerance.
  const stoppedReasons = [intended.stopped, realDensity.stopped].filter((m): m is string => m !== undefined);

  const bad = runFailureReason(cfastRun);
  const speciesSync = { netKg: cfastRun.stats.speciesSyncNetKg, absKg: cfastRun.stats.speciesSyncAbsKg };
  if (bad !== undefined) return done(failed(path, [bad, ...stoppedReasons].join('; '), { ...diffs, speciesSync }));

  const comparison: CaseComparison = compareWithReference(mapVentIdsToReference(cfastRun, vents), compartments, vents);
  // A case with no vents has a vents CSV with no value columns; that is not a reader problem.
  const ventWarnings = cfastRun.vents.length === 0 ? vents.warnings.filter((w) => w !== 'no recognised columns found') : vents.warnings;
  const refWarnings = [...compartments.warnings, ...ventWarnings];
  const reasons: string[] = [];
  if (!comparison.passed) {
    if (comparison.failures.length > 0) reasons.push(`${comparison.failures.length} time points outside tolerance`);
    if (comparison.missingModelTimesS.length > 0) reasons.push(`${comparison.missingModelTimesS.length} reference times have no model sample`);
    if (comparison.missingReference.length > 0) reasons.push(`${comparison.missingReference.length} model quantities have no reference column`);
    if (comparison.pointsChecked === 0) reasons.push('no points were checked');
  }
  if (refWarnings.length > 0) reasons.push(`reference reader warnings: ${refWarnings.slice(0, 3).join(' | ')}`);
  reasons.push(...stoppedReasons);
  return done({
    path,
    verdict: comparison.passed && stoppedReasons.length === 0 ? 'within tolerance' : 'outside tolerance',
    ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    comparison,
    ...diffs,
    speciesSync,
  });
}

/** One line per case for the console: worst quantity and its difference against the allowed difference. */
export function worstOf(c: CaseComparison | undefined): string {
  if (!c || c.summaries.length === 0) return 'n/a';
  let w = c.summaries[0]!;
  for (const s of c.summaries) if (s.worstRatio > w.worstRatio) w = s;
  const diff = Math.abs(w.worstModelValue - w.worstCfastValue);
  const allowed = w.worstRatio > 0 ? diff / w.worstRatio : Number.NaN;
  return `${w.entity} ${w.quantity} at ${w.worstTimeS} s: |diff| ${diff.toPrecision(4)} vs allowed ${allowed.toPrecision(4)} (ratio ${w.worstRatio.toPrecision(6)}), CFAST ${w.worstCfastValue.toPrecision(6)}, model ${w.worstModelValue.toPrecision(6)}`;
}
