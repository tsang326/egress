// Harness behaviour with stub cases (fire-zone task 17.4): missing reference, error, unsupported, two runs.
import { describe, expect, it } from 'vitest';
import { emptyResult } from '../../src/core/fire/result';
import type { Result, RunOptions, Scenario } from '../../src/core/fire/types';
import { diagnoseDoorJetDifference, evaluateCase, mapVentIdsToReference, referencePaths, spreadsheetIntervalS } from './suite';
import { parseReferenceCsv } from './referenceCsv';

const CASE = `&HEAD VERSION = 7770 TITLE = 'stub' /
&TIME SIMULATION = 100 PRINT = 50 SMOKEVIEW = 10 SPREADSHEET = 10 /
&INIT PRESSURE = 101325 RELATIVE_HUMIDITY = 50 INTERIOR_TEMPERATURE = 20 EXTERIOR_TEMPERATURE = 20 /
&COMP ID = 'Room' DEPTH = 3 HEIGHT = 3 WIDTH = 3 CEILING_MATL_ID = 'OFF' WALL_MATL_ID = 'OFF' FLOOR_MATL_ID = 'OFF' ORIGIN = 0, 0, 0 /
`;
const PATH = 'validation/cases/stub/Stub.in';
const none = (): string | undefined => undefined;

describe('Validation harness', () => {
  it('maps a case path to its reference files and reads SPREADSHEET', () => {
    expect(referencePaths(PATH)).toEqual({
      compartments: 'validation/reference/stub/Stub_compartments.csv',
      vents: 'validation/reference/stub/Stub_vents.csv',
    });
    expect(spreadsheetIntervalS(CASE)).toBe(10);
  });

  it('marks a missing reference as outside tolerance and names the path', () => {
    const ev = evaluateCase({ path: PATH, text: CASE, readText: none }, () => emptyResult('ok', [], []));
    expect(ev.result.verdict).toBe('outside tolerance');
    expect(ev.result.reason).toContain('validation/reference/stub/Stub_compartments.csv');
  });

  it('reports an unsupported reader result as unsupported with the reason', () => {
    const ev = evaluateCase({ path: PATH, text: CASE + "&CONN ID = 'x' /\n", readText: none });
    expect(ev.result.verdict).toBe('unsupported');
    expect(ev.result.reason).toMatch(/^unsupported: /);
    expect(ev.runs).toBe(0);
  });

  it('marks a model error and a non-ok status as outside tolerance, and runs the verdict run plus one run per option off', () => {
    const csv = 'Time,Room\nx\nTime,Room\ns,C\n';
    const read = (): string => csv;
    const options: Array<[boolean | undefined, boolean | undefined]> = [];
    const stub = (s: Scenario): Result => {
      options.push([s.options?.cfastUpperPlumeArgOrder, s.options?.cfastRoofVentOutsideDensity]);
      expect(s.printIntervalS).toBe(10);
      return emptyResult('failed', [], []);
    };
    const ev = evaluateCase({ path: PATH, text: CASE, readText: read }, stub);
    // Verdict run first: both CFAST options on (Req 6.13, 5.10); then plume order off; then roof-vent density off.
    expect(options).toEqual([
      [true, true],
      [false, true],
      [true, false],
    ]);
    expect(ev.result.verdict).toBe('outside tolerance');
    expect(ev.result.reason).toContain('status "failed"');

    const thrown = evaluateCase({ path: PATH, text: CASE, readText: read }, () => {
      throw new Error('boom');
    });
    expect(thrown.result.verdict).toBe('outside tolerance');
    expect(thrown.result.reason).toContain('boom');
  });

  // Req 13.14 with an injected clock: every clock reading advances 100 s, so the 7th reading of one run passes 600 s.
  const slowClock = (): (() => number) => {
    let t = 0;
    return () => (t += 100_000);
  };
  const csv = 'Time,Room\nx\nTime,Room\ns,C\n';
  // Mimics the driver: a throwing checkpoint ends the run as "failed" and keeps the samples written so far.
  const stoppableRun = (stopOnCall: number | undefined): ((s: Scenario, o?: RunOptions) => Result) => {
    let calls = 0;
    return (_s, o) => {
      calls++;
      if (calls !== stopOnCall) return emptyResult('ok', [], []);
      try {
        for (let i = 0; i < 100; i++) o?.checkpoint?.();
      } catch {
        return { ...emptyResult('failed', [], []), timesS: Float64Array.of(0, 10, 20) };
      }
      return emptyResult('ok', [], []);
    };
  };

  it('stops the verdict run at 600 s of wall clock, fails the case with simulated and wall time, and skips the other runs', () => {
    const ev = evaluateCase({ path: PATH, text: CASE, readText: () => csv }, stoppableRun(1), { clock: slowClock() });
    expect(ev.result.verdict).toBe('outside tolerance');
    expect(ev.result.reason).toContain('Simulated time reached: 20 s of 100 s');
    expect(ev.result.reason).toContain('Wall-clock time: 700 s');
    expect(ev.result.reason).toContain('wall-clock limit');
    expect(ev.runs).toBe(1);
    expect(ev.result.runDifferenceUnavailable).toContain('not started');
    expect(ev.result.roofVentDifferenceUnavailable).toContain('not started');
  });

  it('fails the case when a comparison run is stopped and says so in that comparison block', () => {
    const ev = evaluateCase({ path: PATH, text: CASE, readText: () => csv }, stoppableRun(3), { clock: slowClock() });
    expect(ev.runs).toBe(3);
    expect(ev.result.verdict).toBe('outside tolerance');
    expect(ev.result.reason).toContain('The ambient-density run was stopped');
    expect(ev.result.roofVentDifferenceUnavailable).toContain('stopped');
    expect(ev.result.runDifferenceUnavailable).toBeUndefined();
  });

  // Req 13.14: the limit is checked at every residual evaluation too. Real driver, fake clock that passes the limit at its
  // 3rd reading: with only per-step checks the run would get through its first step (many residual evaluations) first.
  it('stops a real run at a residual evaluation inside a step, not only between steps', () => {
    let readings = 0;
    const clock = (): number => (++readings >= 3 ? 700_000 : 0);
    const ev = evaluateCase({ path: PATH, text: CASE, readText: () => csv }, undefined, { clock });
    expect(ev.result.verdict).toBe('outside tolerance');
    expect(ev.result.reason).toContain('wall-clock limit');
    expect(ev.runs).toBe(1);
    expect(readings).toBe(3); // start, then the checks of the first two residual evaluations; none after the throw
  });

  // Req 6.14: the verdict run takes the door-jet setting of the CFAST input. There is no comparison run in the suite.
  const JET_CASE = `&HEAD VERSION = 7770 TITLE = 'stub' /
&TIME SIMULATION = 100 PRINT = 50 SMOKEVIEW = 10 SPREADSHEET = 10 /
&INIT PRESSURE = 101325 RELATIVE_HUMIDITY = 50 INTERIOR_TEMPERATURE = 20 EXTERIOR_TEMPERATURE = 20 /
&COMP ID = 'A' DEPTH = 3 HEIGHT = 3 WIDTH = 3 CEILING_MATL_ID = 'OFF' WALL_MATL_ID = 'OFF' FLOOR_MATL_ID = 'OFF' ORIGIN = 0, 0, 0 /
&COMP ID = 'B' DEPTH = 3 HEIGHT = 3 WIDTH = 3 CEILING_MATL_ID = 'OFF' WALL_MATL_ID = 'OFF' FLOOR_MATL_ID = 'OFF' ORIGIN = 3, 0, 0 /
&VENT TYPE = 'WALL' ID = 'door' COMP_IDS = 'A', 'B' BOTTOM = 0 HEIGHT = 2 WIDTH = 1 FACE = 'FRONT' OFFSET = 1 /
&CHEM ID = 'f' CARBON = 1 HYDROGEN = 4 OXYGEN = 0 NITROGEN = 0 CHLORINE = 0 HEAT_OF_COMBUSTION = 50000 RADIATIVE_FRACTION = 0.35 /
&TABL ID = 'f' LABELS = 'TIME', 'HRR', 'HEIGHT', 'AREA', 'CO_YIELD', 'SOOT_YIELD' /
&TABL ID = 'f' DATA = 0, 0, 0, 0.5, 0.01, 0.02 /
&TABL ID = 'f' DATA = 100, 100000, 0, 0.5, 0.01, 0.02 /
&FIRE ID = 'fire' COMP_ID = 'A' FIRE_ID = 'f' LOCATION = 1.5, 1.5 /
`;
  it('makes three runs for a case with a door between two compartments, all with the door-jet setting of the input', () => {
    const csv = 'Time,A\nx\nTime,A\ns,C\n';
    const seen: Array<boolean | undefined> = [];
    const stub = (s: Scenario): Result => {
      seen.push(s.options?.doorJetFires);
      return emptyResult('failed', [], []);
    };
    const ev = evaluateCase({ path: PATH, text: JET_CASE, readText: () => csv }, stub);
    expect(seen).toEqual([true, true, true]);
    expect(ev.result.doorJetSetting).toBe('on');
    expect(ev.runs).toBe(3);

    const off = evaluateCase({ path: PATH, text: JET_CASE + "&DIAG DOOR_JET_FIRE_SUB_MODEL = 'OFF' /\n", readText: () => csv }, (s) => {
      seen.push(s.options?.doorJetFires);
      return emptyResult('failed', [], []);
    });
    expect(seen.slice(3)).toEqual([false, false, false]);
    expect(off.result.doorJetSetting).toBe('off');
  });

  it('diagnoseDoorJetDifference (test-only) runs the verdict setting and the opposite one', () => {
    const seen: Array<boolean | undefined> = [];
    const d = diagnoseDoorJetDifference({ text: JET_CASE }, (s) => {
      seen.push(s.options?.doorJetFires);
      return emptyResult('ok', [], []);
    });
    expect(seen).toEqual([true, false]);
    expect(d.unavailable).toBeUndefined();
    expect(d.difference).toBeDefined();
    expect(diagnoseDoorJetDifference({ text: CASE }, () => emptyResult('ok', [], [])).unavailable).toContain('same result');
  });

  it('renames a vent id to the CFAST spelling of the reference entity', () => {
    const vents = parseReferenceCsv(
      'Time,L_Room_1_Outside_1\nSimulation Time,Net Inflow\nTime,floor  leak Comp 1\ns,kg/s\n0,0\n',
      'vents',
    );
    const r = { ...emptyResult('ok', [], []), vents: [{ id: 'Floor Leak Comp 1' }] } as unknown as Result;
    expect(mapVentIdsToReference(r, vents).vents[0]?.id).toBe('floor  leak Comp 1');
  });
});
