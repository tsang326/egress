// Unit and integration tests of runCrowd (task 14.4; Requirements 1.6, 1.7, 2.8, 2.9, 2.10, 4.1, 4.7, 5.3, 7.5).
// Invented buildings only.
import { describe, expect, it } from 'vitest';
import { runFire } from '../../src/core/fire/index';
import type { Compartment, Scenario, Surface } from '../../src/core/fire/types';
import { runCrowd } from '../../src/core/people/index';
import { floorFromAscii } from '../../src/core/people/plan/ascii';
import { buildPlan } from '../../src/core/people/plan/builder';
import { V_FREE_M_PER_S } from '../../src/core/people/constants';
import type { AgentInput, CrowdResult, CrowdWarning, StepView } from '../../src/core/people/types';
import { agentAtCell, crowdInput, noFire, SHORT_DELAY } from './runHelpers';
import * as samples from './samplePlans';
import { syntheticFire } from './syntheticFire';
const codes = (r: CrowdResult): string[] => r.warnings.map((w) => w.code);
const fieldOf = (ws: CrowdWarning[], code: string): string | undefined => ws.find((w) => w.code === code)?.location.field;
describe('runCrowd input validation (Requirements 1.6, 1.7, 4.1, 7.5)', () => {
  const plan = samples.openRoom().plan;
  const fire = noFire(plan, 10);
  const ok = () => crowdInput(plan, [agentAtCell('a', 'staff', 'F0', 3, 3)], 5);
  it('throws TypeError only when an argument is not an object', () => {
    expect(() => runCrowd(null as never, fire)).toThrow(TypeError);
    expect(() => runCrowd(ok(), 3 as never)).toThrow(TypeError);
    expect(() => runCrowd(ok(), fire, null as never)).toThrow(TypeError);
  });
  it('a wrong type, a missing field and a bad duration give "invalid" and name the field', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['durationS', { durationS: '5' }],
      ['durationS', { durationS: 0 }],
      ['durationS', { durationS: -1 }],
      ['durationS', { durationS: NaN }],
      ['durationS', { durationS: Infinity }],
      ['agents', { agents: undefined }],
      ['seed', { seed: 'x' }],
      ['plan', { plan: undefined }],
      ['plan', { plan: {} }],
      ['schemaVersion', { schemaVersion: 2 }],
      ['alarmTimeS', { alarmTimeS: 'now' }],
    ];
    for (const [field, patch] of cases) {
      const r = runCrowd({ ...ok(), ...patch } as never, fire);
      expect(r.status, field).toBe('invalid');
      expect(fieldOf(r.warnings, 'INPUT_INVALID'), field).toBe(field);
      expect(r.summary).toBeNull();
      expect(r.stats).toBeUndefined();
    }
  });
  it('a malformed agent names its index', () => {
    const r = runCrowd({ ...ok(), agents: [{ id: 1 }] } as never, fire);
    expect(r.status).toBe('invalid');
    expect(fieldOf(r.warnings, 'INPUT_INVALID')).toBe('agents[0]');
  });
  it('a plan with no exit cell is invalid with NO_EXIT', () => {
    const p = samples.noExit().plan;
    const r = runCrowd(crowdInput(p, [agentAtCell('a', 'staff', 'F0', 3, 3)], 5), noFire(p, 5));
    expect(r.status).toBe('invalid');
    expect(codes(r)).toContain('NO_EXIT');
    expect(r.agents).toHaveLength(0);
  });
  it('an agent on a wall cell or outside the grid is invalid with AGENT_START_INVALID naming the agent', () => {
    for (const a of [agentAtCell('wallguy', 'staff', 'F0', 0, 0), agentAtCell('farguy', 'staff', 'F0', 500, 3), agentAtCell('nofloor', 'staff', 'NOPE', 3, 3)]) {
      const r = runCrowd(crowdInput(plan, [a], 5), fire);
      expect(r.status).toBe('invalid');
      expect(r.warnings.find((w) => w.code === 'AGENT_START_INVALID')?.location.id).toBe(a.id);
    }
  });
  it('a fire result that is not "ok", or has no samples, is rejected with FIRE_STATUS', () => {
    const failed = { ...fire, status: 'failed' as const };
    const r = runCrowd(ok(), failed);
    expect(r.status).toBe('invalid');
    expect(codes(r)).toContain('FIRE_STATUS');
    expect(r.warnings.find((w) => w.code === 'FIRE_STATUS')?.message).toContain('failed');
    const empty = runCrowd(ok(), { ...fire, timesS: new Float64Array(0) });
    expect(empty.status).toBe('invalid');
    expect(codes(empty)).toContain('FIRE_STATUS');
  });
  it('an unknown agent type is left out with a Warning and the run continues', () => {
    const r = runCrowd(crowdInput(plan, [agentAtCell('a', 'staff', 'F0', 3, 3), agentAtCell('b', 'robot', 'F0', 4, 3)], 5, { delay: SHORT_DELAY }), fire);
    expect(r.status).toBe('ok');
    expect(codes(r)).toContain('AGENT_TYPE_REJECTED');
    expect(r.agents.map((a) => a.id)).toEqual(['a']);
  });
});
describe('runCrowd basic runs', () => {
  it('one agent walks out of an open room and the result carries the notice', () => {
    const plan = samples.openRoom().plan;
    const r = runCrowd(crowdInput(plan, [agentAtCell('a', 'staff', 'F0', 2, 3)], 60, { delay: SHORT_DELAY }), noFire(plan, 60));
    expect(r.status).toBe('ok');
    expect(r.agents[0]!.finalState).toBe('out');
    expect(r.agents[0]!.exitId).toBe('F0:exit1');
    expect(r.summary!.evacuationTimeS).toBe(r.agents[0]!.exitTimeS);
    expect(r.notice).toContain('fire-safety review');
    // 8 cells (2 m) to the exit at about V_FREE, after a 0.1 s delay.
    const t = r.agents[0]!.exitTimeS!;
    expect(t).toBeGreaterThan(0.1 + 1.5 / V_FREE_M_PER_S);
    expect(t).toBeLessThan(0.1 + 3.5 / V_FREE_M_PER_S + 1);
  });
  it('a run that stops early still returns series for every whole second of the duration', () => {
    const plan = samples.openRoom().plan;
    const r = runCrowd(crowdInput(plan, [agentAtCell('a', 'staff', 'F0', 2, 3)], 30, { delay: SHORT_DELAY }), noFire(plan, 30), { recordStats: true });
    expect(r.stats!.steps).toBeLessThan(600);
    for (const g of r.gates) {
      expect(g.timesS).toHaveLength(31);
      expect(g.timesS[30]).toBe(30);
    }
  });
});
describe('two floors: stair transfer (Requirement 2.8)', () => {
  it('an agent on the upper floor arrives on the same grid cell of the floor below and gets out', () => {
    const plan = samples.twoFloors().plan;
    const transfers: StepView['stairTransfers'][number][] = [];
    const entries: StepView['stairEntries'][number][] = [];
    const r = runCrowd(crowdInput(plan, [agentAtCell('up', 'staff', 'F1', 6, 3)], 90, { delay: SHORT_DELAY }), noFire(plan, 90), {
      onStep: (v) => {
        transfers.push(...v.stairTransfers);
        entries.push(...v.stairEntries);
      },
    });
    expect(r.status).toBe('ok');
    expect(r.agents[0]!.finalState).toBe('out');
    expect(transfers).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.fromFloor).toBe(1);
    expect(transfers[0]!.toFloor).toBe(0);
    expect(transfers[0]!.cell).toBe(entries[0]!.cell);
    expect(codes(r)).toContain('STAIR_RESULT');
  });
});
describe('a 1 m exit drains a crowd at the SFPE flow (Requirements 2.9, 2.10)', () => {
  // A room of 40 x 24 cells (10 m x 6 m), one 1 m exit (4 cells) in the right wall.
  const rows: string[] = [];
  for (let y = 0; y < 24; y++) {
    if (y === 0 || y === 23) rows.push('#'.repeat(41));
    else rows.push('#' + 'a'.repeat(39) + (y >= 10 && y < 14 ? 'E' : '#'));
  }
  const build = () => buildPlan({ floors: [floorFromAscii(rows, { a: 'A' })], stairLinks: [] }).plan!;
  it('100 people leave in about 100 / 0.92 s plus the walk, within 15 %', () => {
    const plan = build();
    const agents: AgentInput[] = [];
    // 100 people on a grid of 10 columns x 10 rows, 0.75 m apart, well below the density that slows walking.
    for (let k = 0; k < 100; k++) agents.push(agentAtCell(`p${k}`, 'staff', 'F0', 4 + (k % 10) * 3, 3 + Math.floor(k / 10) * 2));
    const r = runCrowd(crowdInput(plan, agents, 240, { delay: SHORT_DELAY }), noFire(plan, 240));
    expect(r.status).toBe('ok');
    expect(r.summary!.out).toBe(100);
    // Walking time of the farthest person: about 9 m at the unimpeded speed.
    const expected = 100 / 0.92 + 9 / V_FREE_M_PER_S;
    const got = r.summary!.evacuationTimeS!;
    expect(Math.abs(got - expected) / expected).toBeLessThan(0.15);
  });
});
describe('exit choice margin (Requirement 4.7)', () => {
  // A room 40 cells wide with an exit at each end. The visitor enters by the right exit.
  const rows: string[] = [];
  for (let y = 0; y < 8; y++) {
    if (y === 0 || y === 7) rows.push('#'.repeat(42));
    else rows.push((y >= 2 && y < 5 ? 'E' : '#') + 'a'.repeat(40) + (y >= 2 && y < 5 ? 'E' : '#'));
  }
  const plan = buildPlan({ floors: [floorFromAscii(rows, { a: 'A' })], stairLinks: [] }).plan!;
  const left = plan.exits.find((e) => e.cells[0]! % 42 === 0)!.id;
  const right = plan.exits.find((e) => e.cells[0]! % 42 === 41)!.id;
  const run = (cx: number): string | null => {
    // Smoke at eye height alerts the visitor at about 0.5 s and a sign points to the left exit; the visitor already
    // walks towards the right one (no alarm time, so its pre-movement delay counts from the start of the run).
    // Optical density rises linearly from 0 to 8 /m over 90 s and crosses K_ALERT_PER_M / ln 10 at about 0.49 s.
    const smoke = syntheticFire({ durationS: 90, compartments: [{ id: 'A', end: { lower: { o2: 0.23, co2: 0, co: 0, opticalDensityPerM: 8 } } }] });
    const r = runCrowd(
      crowdInput(plan, [agentAtCell('v', 'visitor', 'F0', cx, 3, right)], 90, { delay: SHORT_DELAY, guidance: { signExitIds: [left] } }),
      smoke,
    );
    return r.agents[0]!.exitId;
  };
  it('switches to the sign exit when it is cheaper by more than the margin, and keeps its exit otherwise', () => {
    expect(run(8)).toBe(left); // about 8 cells to the left and 33 to the right: a difference of 25 cells, above 20
    expect(run(15)).toBe(right); // 15 and 26 cells: a difference of 11, below 20
  });
});
describe('an incapacitated agent stops and does not block others (Requirement 5.3, Open item 9)', () => {
  // A 2-cell wide corridor, 40 cells long, exit at the right end. The middle 6 cells are compartment "h" with a lot of CO.
  const rows = [
    '#'.repeat(41),
    '#' + 'a'.repeat(16) + 'h'.repeat(6) + 'a'.repeat(17) + 'E',
    '#' + 'a'.repeat(16) + 'h'.repeat(6) + 'a'.repeat(17) + 'E',
    '#'.repeat(41),
  ];
  const plan = buildPlan({ floors: [floorFromAscii(rows, { a: 'A', h: 'H' })], stairLinks: [] }).plan!;
  it('the person in the CO zone is incapacitated where they stand and the person behind walks through', () => {
    const fire = syntheticFire({
      durationS: 120,
      compartments: [
        { id: 'A' },
        { id: 'H', start: { lower: { o2: 0.23, co2: 0, co: 0.1, opticalDensityPerM: 0 }, interfaceHeightM: 2.4 } },
      ],
    });
    const hurt = agentAtCell('hurt', 'staff', 'F0', 19, 1);
    const behind = agentAtCell('behind', 'visitor', 'F0', 3, 1, plan.exits[0]!.id);
    const r = runCrowd(
      crowdInput(plan, [hurt, behind], 120, { delay: { staff: { medianS: 100, logSd: 0 }, visitor: { medianS: 30, logSd: 0 } } }),
      fire,
    );
    expect(r.status).toBe('ok');
    const [h, b] = r.agents;
    expect(h!.finalState).toBe('incapacitated');
    expect(h!.causes).toContain('asphyxiant FED');
    expect(h!.finalXM).toBe(hurt.xM); // did not move
    expect(h!.incapacitatedTimeS!).toBeGreaterThan(5);
    expect(h!.incapacitatedTimeS!).toBeLessThan(30);
    expect(b!.finalState).toBe('out');
    expect(b!.exitTimeS!).toBeGreaterThan(30);
    expect(b!.exitTimeS!).toBeLessThan(60);
  });
});
describe('the real fire solver feeds the crowd model', () => {
  const surface = (): Surface => ({
    layers: [{ name: 'concrete (estimate)', conductivityWPerMK: 1.75, densityKgPerM3: 2200, specificHeatJPerKgK: 1000, thicknessM: 0.15, emissivity: 0.94 }],
  });
  const room = (id: string): Compartment => ({
    id,
    widthM: 3,
    depthM: 3,
    heightM: 2.4,
    floorElevationM: 0,
    kind: 'room',
    ceiling: surface(),
    floor: surface(),
    walls: surface(),
  });
  it('a two-room scenario run by runFire gives a crowd run with status "ok"', () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      title: 'two rooms, invented',
      durationS: 60,
      printIntervalS: 1,
      seed: 1,
      ambient: { interiorTempK: 293.15, exteriorTempK: 293.15, pressurePa: 101325, species: { o2: 0.2314, co2: 0.0005, co: 0, h2o: 0.0065, soot: 0 } },
      compartments: [room('A'), room('B')],
      vents: [
        { kind: 'wall', id: 'door', from: 'A', to: 'B', sillM: 0, soffitM: 2, widthM: 0.9, face: 'right', offsetM: 1, open: 1 },
        { kind: 'wall', id: 'out', from: 'B', to: 'OUTSIDE', sillM: 0, soffitM: 2, widthM: 0.9, face: 'right', offsetM: 1, open: 1 },
      ],
      fires: [
        {
          id: 'f',
          compartmentId: 'A',
          xM: 1.5,
          yM: 1.5,
          radiativeFraction: 0.35,
          fuel: { c: 1, h: 4, o: 0, n: 0, cl: 0, heatOfCombustionJPerKg: 20e6 },
          table: [
            { timeS: 0, hrrW: 0, heightM: 0.3, areaM2: 0.5, coYield: 0.01, sootYield: 0.02 },
            { timeS: 60, hrrW: 5e4, heightM: 0.3, areaM2: 0.5, coYield: 0.01, sootYield: 0.02 },
          ],
        },
      ],
    };
    const fire = runFire(scenario);
    expect(fire.status).toBe('ok');
    const floor = floorFromAscii(['###############', '#bbbbbbaaaaaaa#', '#bbbbbbaaaaaaaE', '#bbbbbbaaaaaaaE', '###############'], { a: 'A', b: 'B' });
    const built = buildPlan({ floors: [floor], stairLinks: [] });
    expect(built.status).toBe('valid');
    const r = runCrowd(crowdInput(built.plan!, [agentAtCell('p', 'staff', 'F0', 3, 2)], 60, { delay: SHORT_DELAY }), fire);
    expect(r.status).toBe('ok');
    expect(r.agents).toHaveLength(1);
  });
});
describe('pre-movement counts from the alarm (Requirement 3.9, amended)', () => {
  const rows = ['#'.repeat(12), '#' + 'a'.repeat(10) + 'E', '#' + 'a'.repeat(10) + 'E', '#'.repeat(12)];
  const plan = buildPlan({ floors: [floorFromAscii(rows, { a: 'A' })], stairLinks: [] }).plan!;
  const exitAt = (alarmTimeS: number): number => {
    const r = runCrowd(crowdInput(plan, [agentAtCell('v', 'staff', 'F0', 1, 1)], 200, { delay: SHORT_DELAY, alarmTimeS }), noFire(plan, 200));
    return r.agents[0]!.exitTimeS!;
  };
  it('moving the alarm 60 s later moves the exit time 60 s later when there is no smoke', () => {
    const early = exitAt(10);
    const late = exitAt(70);
    expect(early).toBeGreaterThan(10);
    expect(late - early).toBeCloseTo(60, 0);
  });
});
