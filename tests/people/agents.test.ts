// Unit tests for the Pre_Movement_Delay and agent knowledge (Requirements 3.2 to 3.5, 3.7, 3.8, 3.10, 3.11).
import { describe, expect, it } from 'vitest';
import { createAgentStore, STATE_PRE_MOVE } from '../../src/core/people/agents/state';
import { DEFAULT_DELAY_STAFF, DEFAULT_DELAY_VISITOR, drawDelays, resolveDelayParams } from '../../src/core/people/agents/delay';
import { addGuidance, classifyAgents, guidanceMask, initKnowledge, isAlert, nearestExit, type AgentStart } from '../../src/core/people/agents/knowledge';
import { K_ALERT_PER_M, PRE_MOVEMENT_LOG_SD, PRE_MOVEMENT_MEDIAN_VISITOR_S, TIME_STEP_S } from '../../src/core/people/constants';
import { floorFromAscii } from '../../src/core/people/plan/ascii';
import { buildPlan } from '../../src/core/people/plan/builder';
import type { AgentInput, Plan } from '../../src/core/people/types';
// Invented building: one room, 11 x 4 cells, with a 2-cell exit in the left wall and one in the right wall.
const TWO_EXIT_ROWS = [
  '#############',
  '#aaaaaaaaaaa#',
  'Eaaaaaaaaaaa' + 'E',
  'Eaaaaaaaaaaa' + 'E',
  '#aaaaaaaaaaa#',
  '#############',
];
function twoExitPlan(): Plan {
  const r = buildPlan({ floors: [floorFromAscii(TWO_EXIT_ROWS, { a: 'A' })], stairLinks: [] });
  if (r.status !== 'valid' || !r.plan) throw new Error('sample plan invalid');
  return r.plan;
}
describe('drawDelays', () => {
  const types = ['visitor', 'staff', 'visitor', 'staff', 'visitor'];
  const params = resolveDelayParams(undefined);
  it('gives the same delays for the same seed and different ones for another seed', () => {
    const a = drawDelays(types, 42, params);
    const b = drawDelays(types, 42, params);
    const c = drawDelays(types, 43, params);
    expect(Array.from(a.delayS)).toEqual(Array.from(b.delayS));
    expect(Array.from(a.delaySteps)).toEqual(Array.from(b.delaySteps));
    expect(Array.from(a.delayS)).not.toEqual(Array.from(c.delayS));
  });
  it('has a sample median of 2000 draws within 5 % of the parameter', () => {
    const n = 2000;
    const medianOf = (type: string, seed: number): number => {
      const d = Array.from(drawDelays(Array.from({ length: n }, () => type), seed, params).delayS).sort((x, y) => x - y);
      return (d[n / 2 - 1]! + d[n / 2]!) / 2;
    };
    expect(Math.abs(medianOf('visitor', 7) / PRE_MOVEMENT_MEDIAN_VISITOR_S - 1)).toBeLessThan(0.05);
    expect(Math.abs(medianOf('staff', 9) / DEFAULT_DELAY_STAFF.medianS - 1)).toBeLessThan(0.05);
  });
  it('rounds the delay up to whole steps', () => {
    const d = drawDelays(types, 1, params);
    for (let i = 0; i < types.length; i++) {
      expect(d.delaySteps[i]! * TIME_STEP_S).toBeGreaterThanOrEqual(d.delayS[i]! - 1e-12);
      expect((d.delaySteps[i]! - 1) * TIME_STEP_S).toBeLessThan(d.delayS[i]!);
    }
  });
  it('a zero log standard deviation gives exactly the median', () => {
    const p = resolveDelayParams({ visitor: { medianS: 12, logSd: 0 } });
    expect(p.warnings).toHaveLength(0);
    expect(drawDelays(['visitor'], 3, p).delayS[0]).toBe(12);
  });
  it('an excluded agent still consumes its two draws', () => {
    const withBad = drawDelays(['visitor', 'robot', 'visitor'], 5, params);
    const allGood = drawDelays(['visitor', 'visitor', 'visitor'], 5, params);
    expect(withBad.delayS[1]).toBe(0);
    expect(withBad.delayS[0]).toBe(allGood.delayS[0]);
    expect(withBad.delayS[2]).toBe(allGood.delayS[2]);
  });
  it('caps the step count of an extreme delay instead of overflowing', () => {
    const p = resolveDelayParams({ staff: { medianS: 1e300, logSd: 0 } });
    expect(drawDelays(['staff'], 1, p).delaySteps[0]).toBe(2147483647);
  });
});
describe('resolveDelayParams', () => {
  it('uses the defaults when nothing is given', () => {
    const p = resolveDelayParams(undefined);
    expect(p.visitor).toEqual(DEFAULT_DELAY_VISITOR);
    expect(p.staff).toEqual(DEFAULT_DELAY_STAFF);
    expect(p.visitor.logSd).toBe(PRE_MOVEMENT_LOG_SD);
    expect(p.warnings).toHaveLength(0);
  });
  it('accepts valid input values for the named type only', () => {
    const p = resolveDelayParams({ staff: { medianS: 5, logSd: 0.2 } });
    expect(p.staff).toEqual({ medianS: 5, logSd: 0.2 });
    expect(p.visitor).toEqual(DEFAULT_DELAY_VISITOR);
  });
  it.each([
    [{ medianS: NaN, logSd: 0.4 }],
    [{ medianS: 0, logSd: 0.4 }],
    [{ medianS: -3, logSd: 0.4 }],
    [{ medianS: 10, logSd: -0.1 }],
    [{ medianS: 10, logSd: Infinity }],
    [{ medianS: '10', logSd: 0.4 }],
    [null],
  ])('falls back to the defaults with a Warning for %j', (bad) => {
    const p = resolveDelayParams({ visitor: bad });
    expect(p.visitor).toEqual(DEFAULT_DELAY_VISITOR);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]!.code).toBe('DELAY_PARAMS_REJECTED');
    expect(p.warnings[0]!.message).toContain('visitor');
  });
});
describe('classifyAgents', () => {
  it('excludes an unknown type with a Warning and keeps the rest', () => {
    const agents: AgentInput[] = [
      { id: 'a', type: 'visitor', floorId: 'F0', xM: 1, yM: 1 },
      { id: 'b', type: 'ghost', floorId: 'F0', xM: 1, yM: 1 },
      { id: 'c', type: 'staff', floorId: 'F0', xM: 1, yM: 1 },
    ];
    const r = classifyAgents(agents);
    expect(r.included).toEqual([0, 2]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.code).toBe('AGENT_TYPE_REJECTED');
    expect(r.warnings[0]!.message).toContain('b');
    expect(r.warnings[0]!.message).toContain('ghost');
  });
});
describe('initKnowledge', () => {
  const plan = twoExitPlan();
  const n = plan.exits.length;
  const w = plan.floors[0]!.widthCells;
  const left = plan.exits.findIndex((e) => e.cells[0]! % w === 0);
  const right = 1 - left;
  const start = (over: Partial<AgentStart>): AgentStart => ({ id: 'v', type: 'visitor', floorIndex: 0, xM: 1.0, yM: 0.9, ...over });
  const count = (known: Uint8Array): number => known.reduce((s, v) => s + v, 0);
  it('has two exits in the sample plan', () => {
    expect(n).toBe(2);
    expect(left).toBeGreaterThanOrEqual(0);
  });
  it('a visitor knows only its entry exit', () => {
    const known = new Uint8Array(n);
    const warnings = initKnowledge(plan, [start({ entryExitId: plan.exits[right]!.id })], known);
    expect(warnings).toHaveLength(0);
    expect(count(known)).toBe(1);
    expect(known[right]).toBe(1);
  });
  it('staff know every exit', () => {
    const known = new Uint8Array(n);
    initKnowledge(plan, [start({ type: 'staff' })], known);
    expect(Array.from(known)).toEqual([1, 1]);
  });
  it('a visitor with no or a wrong entry exit gets the nearest exit and a Warning', () => {
    for (const entryExitId of [undefined, 'nowhere']) {
      const known = new Uint8Array(n);
      const warnings = initKnowledge(plan, [start({ entryExitId })], known);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.code).toBe('ENTRY_EXIT_ESTIMATED');
      expect(known[left]).toBe(1);
      expect(count(known)).toBe(1);
    }
  });
  it('picks the nearest exit by straight-line distance and breaks ties to the lowest index', () => {
    expect(nearestExit(plan, 0, 0.5, 0.9)).toBe(left);
    expect(nearestExit(plan, 0, 2.7, 0.9)).toBe(right);
    // Exit cell centres are at x = 0.125 m and x = 3.125 m, so x = 1.625 m is exactly in the middle.
    expect(nearestExit(plan, 0, 1.625, 0.9)).toBe(0);
  });
});
describe('Alert and guidance', () => {
  const plan = twoExitPlan();
  const n = plan.exits.length;
  it('adds guidance exits and keeps the exits already known', () => {
    const known = new Uint8Array(n);
    known[1] = 1;
    const mask = guidanceMask(plan, [plan.exits[0]!.id], []);
    expect(addGuidance(known, 0, n, mask)).toBe(true);
    expect(Array.from(known)).toEqual([1, 1]);
    expect(addGuidance(known, 0, n, mask)).toBe(false);
  });
  it('never removes an exit when the guidance names another one', () => {
    const known = new Uint8Array(n);
    known[0] = 1;
    addGuidance(known, 0, n, guidanceMask(plan, [plan.exits[1]!.id], []));
    expect(Array.from(known)).toEqual([1, 1]);
  });
  it('includes the exits staff lead to and ignores unknown sign ids', () => {
    expect(Array.from(guidanceMask(plan, ['unknown'], [-1, 1]))).toEqual([0, 1]);
  });
  it('alerts on smoke above the limit or at the alarm time', () => {
    expect(isAlert(K_ALERT_PER_M, 5, null)).toBe(false);
    expect(isAlert(K_ALERT_PER_M * 1.01, 5, undefined)).toBe(true);
    expect(isAlert(0, 9.99, 10)).toBe(false);
    expect(isAlert(0, 10, 10)).toBe(true);
    expect(isAlert(0, 10, NaN)).toBe(false);
  });
});
describe('createAgentStore', () => {
  it('starts every agent pre-movement with unset ids', () => {
    const s = createAgentStore(3, 2);
    expect(s.known.length).toBe(6);
    expect(Array.from(s.state)).toEqual([STATE_PRE_MOVE, STATE_PRE_MOVE, STATE_PRE_MOVE]);
    expect(Array.from(s.exitChoice)).toEqual([-1, -1, -1]);
    expect(Array.from(s.incapStep)).toEqual([-1, -1, -1]);
  });
});
