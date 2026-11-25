// Unit tests for the Flow_Field recompute policy and exit choice (Requirements 4.6, 4.7).
import { describe, expect, it } from 'vitest';
import { FIELD_REFRESH_INTERVAL_S, SWITCH_MARGIN_CELLS, TIME_STEP_S, VIS_PENALTY_FACTOR } from '../../src/core/people/constants';
import { newReading } from '../../src/core/people/coupling/layers';
import { createFireCoupling } from '../../src/core/people/coupling/fireCoupling';
import { chooseExit } from '../../src/core/people/flowfield/choose';
import { compartmentMultiplier, FieldManager } from '../../src/core/people/flowfield/recompute';
import { floorFromAscii } from '../../src/core/people/plan/ascii';
import { buildPlan } from '../../src/core/people/plan/builder';
import { CLASS_BLOCKED, CLASS_CLEAR, CLASS_SMOKY, compartmentClass } from '../../src/core/people/tenability/limits';
import type { Plan } from '../../src/core/people/types';
import { syntheticFire } from './syntheticFire';
// Invented building: rooms A and B joined by a 4-cell door, an exit in the far wall of each room.
const ROWS = [
  '#############',
  '#aaaaaDbbbbb#',
  'EaaaaaDbbbbbE',
  'EaaaaaDbbbbbE',
  '#aaaaaDbbbbb#',
  '#############',
];
function plan2(): Plan {
  const r = buildPlan({ floors: [floorFromAscii(ROWS, { a: 'A', b: 'B' })], stairLinks: [] });
  if (r.status !== 'valid' || !r.plan) throw new Error('invalid sample plan');
  return r.plan;
}
const cellOf = (x: number, y: number): number => y * ROWS[0]!.length + x;
const INTERVAL_STEPS = Math.round(FIELD_REFRESH_INTERVAL_S / TIME_STEP_S);
describe('compartmentMultiplier', () => {
  it('is exactly 1 for clear air, penalised and inverted for smoke, and Infinity when blocked', () => {
    expect(compartmentMultiplier(CLASS_CLEAR, 0)).toBe(1);
    const clear = compartmentMultiplier(CLASS_CLEAR, 1);
    expect(clear).toBeGreaterThan(1);
    expect(compartmentMultiplier(CLASS_SMOKY, 1)).toBeCloseTo(VIS_PENALTY_FACTOR * clear, 12);
    expect(compartmentMultiplier(CLASS_BLOCKED, 1)).toBe(Infinity);
  });
  it('does not change for a tiny change of K (quantised)', () => {
    expect(compartmentMultiplier(CLASS_CLEAR, 1)).toBe(compartmentMultiplier(CLASS_CLEAR, 1.001));
  });
});
describe('FieldManager', () => {
  const nComp = 2;
  const clear = Uint8Array.from({ length: nComp }, () => CLASS_CLEAR);
  const ones = new Float64Array(nComp).fill(1);
  const both = [1, 1];
  it('keeps the base fields and rebuilds nothing while nothing changes', () => {
    const plan = plan2();
    const m = new FieldManager(plan);
    for (let s = 0; s < 5; s++) expect(m.update(s, clear, ones, both, true)).toBe(0);
    expect(m.fields[0]).toBe(plan.baseFields[0]);
    expect(m.stats.recomputes).toBe(0);
  });
  it('a class change rebuilds the needed fields in the same step, and not before', () => {
    const plan = plan2();
    const m = new FieldManager(plan);
    expect(m.update(0, clear, ones, both, true)).toBe(0);
    expect(m.update(1, clear, ones, both, true)).toBe(0);
    const smoky = Uint8Array.from([CLASS_SMOKY, CLASS_CLEAR]);
    const mult = Float64Array.from([2, 1]);
    expect(m.update(2, smoky, mult, both, true)).toBe(2);
    expect(m.fields[0]).not.toBe(plan.baseFields[0]);
    expect(m.update(3, smoky, mult, both, true)).toBe(0);
  });
  it('a class change rebuilds even when nobody is moving', () => {
    const m = new FieldManager(plan2());
    expect(m.update(0, Uint8Array.from([CLASS_SMOKY, CLASS_CLEAR]), Float64Array.from([2, 1]), both, false)).toBe(2);
  });
  it('several compartments changing in one step cause one rebuild per needed field', () => {
    const m = new FieldManager(plan2());
    const cls = Uint8Array.from([CLASS_SMOKY, CLASS_BLOCKED]);
    expect(m.update(0, cls, Float64Array.from([2, Infinity]), both, true)).toBe(2);
    expect(m.stats.recomputes).toBe(2);
    expect(m.stats.nodesSettled).toBeGreaterThan(0);
  });
  it('rebuilds only the fields that an active agent needs, and the others on first need', () => {
    const m = new FieldManager(plan2());
    const cls = Uint8Array.from([CLASS_SMOKY, CLASS_CLEAR]);
    const mult = Float64Array.from([2, 1]);
    expect(m.update(0, cls, mult, [1, 0], true)).toBe(1);
    expect(m.update(1, cls, mult, [1, 0], true)).toBe(0);
    expect(m.update(2, cls, mult, [1, 1], true)).toBe(1); // exit 1 was stale
    expect(m.update(3, cls, mult, [1, 1], true)).toBe(0);
  });
  it('a blocked compartment removes its nodes from the rebuilt fields', () => {
    const plan = plan2();
    const m = new FieldManager(plan);
    const cls = Uint8Array.from([CLASS_CLEAR, CLASS_BLOCKED]);
    m.update(0, cls, Float64Array.from([1, Infinity]), both, true);
    const inA = cellOf(2, 2);
    const inB = cellOf(9, 2);
    const leftExit = plan.exits.findIndex((e) => e.cells[0]! % 13 === 0);
    const rightExit = 1 - leftExit;
    expect(m.fields[leftExit]!.cost[inA]).toBeLessThan(Infinity);
    expect(m.fields[rightExit]!.cost[inA]).toBe(Infinity);
    expect(m.fields[leftExit]!.cost[inB]).toBe(Infinity);
  });
  it('a drift of the multiplier alone refreshes at most once per interval and only while somebody moves', () => {
    const m = new FieldManager(plan2());
    const mult = (v: number): Float64Array => Float64Array.from([v, 1]);
    // Nobody moves: no refresh, however much the multiplier drifts.
    expect(m.update(0, clear, mult(1.2), both, false)).toBe(0);
    // First drift while moving: allowed at once.
    expect(m.update(1, clear, mult(1.2), both, true)).toBe(2);
    // More drift inside the interval: held back.
    expect(m.update(2, clear, mult(1.4), both, true)).toBe(0);
    expect(m.update(INTERVAL_STEPS, clear, mult(1.4), both, true)).toBe(0);
    // At exactly one interval after the last refresh: applied.
    expect(m.update(1 + INTERVAL_STEPS, clear, mult(1.4), both, true)).toBe(2);
    // Same multiplier again: nothing to do.
    expect(m.update(2 + 2 * INTERVAL_STEPS, clear, mult(1.4), both, true)).toBe(0);
  });
  it('a class change is applied inside the refresh interval, with no throttle', () => {
    const m = new FieldManager(plan2());
    m.update(0, clear, Float64Array.from([1.2, 1]), both, true);
    const cls = Uint8Array.from([CLASS_SMOKY, CLASS_CLEAR]);
    expect(m.update(1, cls, Float64Array.from([2.4, 1]), both, true)).toBe(2);
  });
  it('a fire that crosses the visibility limit at sample k triggers a rebuild in that step and not earlier', () => {
    const plan = plan2();
    // Room A upper layer: optical density 0.1 per second, interface at 1 m, so eye height is in the upper layer.
    const fire = syntheticFire({
      durationS: 20,
      compartments: [
        { id: 'A', start: { interfaceHeightM: 1, upper: { o2: 0.23, co2: 0, co: 0, opticalDensityPerM: 0 } }, end: { upper: { o2: 0.23, co2: 0, co: 0, opticalDensityPerM: 2 } } },
        { id: 'B' },
      ],
    });
    const c = createFireCoupling(fire, plan);
    if (!c.ok) throw new Error('rejected');
    const m = new FieldManager(plan);
    const reading = newReading();
    const cls = new Uint8Array(nComp);
    const mult = new Float64Array(nComp).fill(1);
    const rebuiltAt: number[] = [];
    // anyMoving is false, so only a class change can rebuild a field here (drift refreshes need movement).
    for (let s = 0; s <= 400; s++) {
      c.coupling.advance(s * TIME_STEP_S);
      for (let k = 0; k < nComp; k++) {
        c.coupling.read(k, reading);
        cls[k] = compartmentClass(reading.upperActive, reading.tempK, reading.visibilityM, 25 * 0.0625);
        mult[k] = compartmentMultiplier(cls[k]!, reading.extinctionPerM);
      }
      if (m.update(s, cls, mult, both, false) > 0) rebuiltAt.push(s);
    }
    // Optical density is 0.1 t, so the visibility 3 / (0.1 t ln 10) falls below 5 m from t = 2.6058 s.
    let expected = 1;
    while (!(3 / (0.1 * expected * TIME_STEP_S * Math.LN10) < 5)) expected++;
    expect(expected).toBe(53);
    expect(rebuiltAt).toEqual([expected]);
  });
});
describe('chooseExit', () => {
  const known = [1, 1, 1];
  it('takes the cheapest known exit with no margin when none is chosen yet', () => {
    expect(chooseExit(-1, [30, 20, 25], known, SWITCH_MARGIN_CELLS)).toBe(1);
  });
  it('switches only when the best cost is lower by more than the margin', () => {
    const m = SWITCH_MARGIN_CELLS;
    expect(chooseExit(0, [50, 50 - m + 1, 99], known, m)).toBe(0);
    expect(chooseExit(0, [50, 50 - m, 99], known, m)).toBe(0); // exactly the margin: stay
    expect(chooseExit(0, [50, 50 - m - 0.001, 99], known, m)).toBe(1);
  });
  it('ties go to the lowest exit index', () => {
    expect(chooseExit(-1, [10, 10, 10], known, 20)).toBe(0);
    expect(chooseExit(2, [10, 10, 100], known, 20)).toBe(0);
  });
  it('ignores exits the agent does not know', () => {
    expect(chooseExit(0, [50, 1, 2], [1, 0, 1], 20)).toBe(2);
    expect(chooseExit(0, [50, 1, 2], [1, 0, 0], 20)).toBe(0);
  });
  it('leaves the choice alone when nothing is known or nothing is reachable', () => {
    expect(chooseExit(1, [5, 5], [0, 0], 20)).toBe(1);
    expect(chooseExit(0, [Infinity, Infinity], [1, 1], 20)).toBe(0);
    expect(chooseExit(-1, [Infinity, Infinity], [1, 1], 20)).toBe(-1);
  });
  it('leaves an unreachable current exit for a reachable one', () => {
    expect(chooseExit(0, [Infinity, 40], [1, 1], 20)).toBe(1);
  });
  it('takes the best known exit when the current one is not known', () => {
    expect(chooseExit(1, [30, 29], [1, 0], 20)).toBe(0);
  });
});
