// Unit tests of the outputs (task 13.2; Requirements 6.1 to 6.6, 6.8, 6.9). Invented buildings only.
import { describe, expect, it } from 'vitest';
import { runCrowd } from '../../src/core/people/index';
import { buildSummary } from '../../src/core/people/outputs/summary';
import { incapacitatedAndInsideText, NOTICE, NO_ONE_OUT_TEXT, summaryText } from '../../src/core/people/outputs/text';
import type { AgentRecord, CrowdResult } from '../../src/core/people/types';
import { agentAtCell, crowdInput, noFire, SHORT_DELAY } from './runHelpers';
import * as samples from './samplePlans';
import { syntheticFire } from './syntheticFire';
const record = (id: string, finalState: AgentRecord['finalState'], exitTimeS: number | null): AgentRecord => ({
  id,
  type: 'staff',
  finalState,
  exitTimeS,
  exitId: exitTimeS === null ? null : 'F0:exit1',
  incapacitatedTimeS: finalState === 'incapacitated' ? 5 : null,
  causes: finalState === 'incapacitated' ? ['asphyxiant FED'] : [],
  preMovementDelayS: 1,
  everBlocked: false,
  fedHistory: { timesS: new Float64Array(0), fed: new Float64Array(0) },
  finalFloorId: 'F0',
  finalXM: 0,
  finalYM: 0,
});
describe('summary (Requirements 6.2, 6.3, 6.6)', () => {
  it('counts add up to the total and the evacuation time is the last exit time', () => {
    const s = buildSummary([record('a', 'out', 12.5), record('b', 'out', 30.25), record('c', 'incapacitated', null), record('d', 'still inside', null), record('e', 'still inside', null)]);
    expect(s.total).toBe(5);
    expect(s.out + s.incapacitated + s.stillInside).toBe(s.total);
    expect([s.out, s.incapacitated, s.stillInside]).toEqual([2, 1, 2]);
    expect(s.evacuationTimeS).toBe(30.25);
  });
  it('with nobody out the evacuation time is null and the text says no one got out', () => {
    const s = buildSummary([record('c', 'incapacitated', null), record('d', 'still inside', null)]);
    expect(s.evacuationTimeS).toBeNull();
    expect(s.text[0]).toBe(NO_ONE_OUT_TEXT);
    expect(s.text.join(' ')).not.toContain('evacuation time');
  });
  it('shows incapacitated and still inside as two separate integers', () => {
    expect(incapacitatedAndInsideText(3, 4)).toBe('3 people were incapacitated and 4 were still inside at the end of the run.');
    expect(incapacitatedAndInsideText(1, 0)).toBe('1 person was incapacitated and 0 were still inside at the end of the run.');
    const lines = summaryText({ total: 10, out: 3, incapacitated: 2, stillInside: 5, evacuationTimeS: 61 });
    expect(lines).toContain('The evacuation time (last person out) was 1 min 1 s.');
    expect(lines.some((l) => /2 people were incapacitated and 5 were still inside/.test(l))).toBe(true);
  });
  it('the notice has the required phrase and is the only text with "fire-safety review"', () => {
    expect(NOTICE).toContain('simplified simulation for understanding risks');
    expect(NOTICE).toContain('does not replace a fire-safety review by the authorities or an engineer');
    const lines = summaryText({ total: 2, out: 1, incapacitated: 1, stillInside: 0, evacuationTimeS: 10 });
    expect(lines.filter((l) => l.includes('fire-safety review'))).toEqual([]);
  });
});
describe('a whole run (Requirements 6.1, 6.4, 6.5, 6.8)', () => {
  const plan = samples.twoRooms().plan;
  const agents = [agentAtCell('a', 'staff', 'F0', 2, 3), agentAtCell('b', 'staff', 'F0', 3, 5), agentAtCell('c', 'visitor', 'F0', 4, 2)];
  const run = (durationS: number): CrowdResult => runCrowd(crowdInput(plan, agents, durationS, { delay: SHORT_DELAY }), noFire(plan, durationS));
  it('carries the notice and an evacuation time equal to the last exit', () => {
    const r = run(60);
    expect(r.notice).toBe(NOTICE);
    expect(r.summary!.out).toBe(3);
    expect(r.summary!.evacuationTimeS).toBe(Math.max(...r.agents.map((a) => a.exitTimeS!)));
  });
  it('the congestion map adds up to the inside time of every agent within 1e-6', () => {
    for (const durationS of [60, 4]) {
      const r = run(durationS); // the short run ends with people still inside
      const mapTotal = r.congestion.reduce((s, f) => s + f.personSeconds.reduce((x, y) => x + y, 0), 0);
      // Inside time of an agent: from time 0 until its exit step, or until the end of the run.
      const inside = r.agents.reduce((s, a) => s + (a.finalState === 'out' ? a.exitTimeS! : a.incapacitatedTimeS ?? durationS), 0);
      expect(Math.abs(mapTotal - inside)).toBeLessThan(1e-6);
    }
  });
  it('gate series cover every whole second from 0 to the duration, also when the run stops early', () => {
    for (const durationS of [60, 7]) {
      const r = run(durationS);
      for (const g of r.gates) {
        expect(g.timesS).toHaveLength(durationS + 1);
        expect(Array.from(g.timesS)).toEqual(Array.from({ length: durationS + 1 }, (_, k) => k));
        expect(g.flowPersonsPerS).toHaveLength(durationS + 1);
        expect(g.queueLength).toHaveLength(durationS + 1);
      }
      const flowTotal = r.gates.filter((g) => g.kind === 'exit').reduce((s, g) => s + g.flowPersonsPerS.reduce((x, y) => x + y, 0), 0);
      expect(flowTotal).toBe(r.summary!.out);
    }
  });
  it('FED history has a sample every second plus the final state sample', () => {
    const r = run(30);
    const a = r.agents[0]!;
    expect(a.fedHistory.timesS.length).toBeGreaterThan(1);
    expect(a.fedHistory.timesS[0]).toBe(0);
    expect(a.fedHistory.timesS[a.fedHistory.timesS.length - 1]).toBe(a.exitTimeS);
    expect(Array.from(a.fedHistory.fed).every((f) => f === 0)).toBe(true);
  });
});
describe('location warnings (Requirement 6.7)', () => {
  it('near-fire and unmeasured-material warnings appear for an agent close to the site', () => {
    const plan = samples.openRoom().plan;
    const site = { floorId: 'F0', xM: 1.0, yM: 0.9 };
    const r = runCrowd(
      crowdInput(plan, [agentAtCell('a', 'staff', 'F0', 3, 3)], 20, { delay: SHORT_DELAY, fireSites: [site], unmeasuredMaterialSites: [{ ...site, material: 'invented foam' }] }),
      syntheticFire({ durationS: 20, compartments: plan.compartmentIds.map((id) => ({ id })) }),
    );
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain('NEAR_FIRE');
    expect(codes).toContain('UNMEASURED_MATERIAL');
  });
});
