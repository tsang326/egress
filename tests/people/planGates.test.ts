// Plan_Builder details: stair table lookup, stair gates, caller limits and the PLAN_LARGE warning (tasks 2.1, 2.2, 3.2).
import { describe, expect, it } from 'vitest';
import { buildPlan as buildPlanPublic } from '../../src/core/people';
import { PLAN_LARGE_NODES } from '../../src/core/people/constants';
import { floorFromAscii } from '../../src/core/people/plan/ascii';
import { buildPlan, stairTableK } from '../../src/core/people/plan/builder';
import { effectiveWidthM, stairSpecificFlowPerSM } from '../../src/core/people/plan/gatesFromPlan';
import type { CellTypeName } from '../../src/core/people/types';
import { twoFloors } from './samplePlans';

describe('SFPE stair table lookup', () => {
  it('returns the table k at each table slope', () => {
    expect(stairTableK(7.5 / 10)).toEqual({ k: 1.0, tableSlope: 0.75, inRange: true });
    expect(stairTableK(7 / 11).k).toBe(1.08);
    expect(stairTableK(6.5 / 12).k).toBe(1.16);
    expect(stairTableK(6.5 / 13).k).toBe(1.23);
  });
  it('uses the nearest table point inside the range and clamps outside it', () => {
    expect(stairTableK(0.178 / 0.279).k).toBe(1.08); // default 7/11 stair in metres
    expect(stairTableK(0.7)).toMatchObject({ k: 1.0, inRange: true });
    expect(stairTableK(0.9)).toMatchObject({ k: 1.0, inRange: false });
    expect(stairTableK(0.3)).toMatchObject({ k: 1.23, inRange: false });
  });
  it('gives the default stair link k = 1.08 without a range warning', () => {
    const { plan } = twoFloors();
    expect(plan.stairLinks[0]!.speedFreeMPerS).toBe(1.08);
  });
});

describe('gate descriptors', () => {
  it('stair gates use the derived specific flow k / (4 a), 1.015 for k = 1.08 (Design, Finding 4)', () => {
    expect(stairSpecificFlowPerSM(1.08)).toBeCloseTo(1.015, 3);
    expect(stairSpecificFlowPerSM(1.4)).toBeCloseTo(1.316, 3);
    const { plan } = twoFloors();
    const stairs = plan.gates.filter((g) => g.kind === 'stair');
    expect(stairs.map((g) => g.floorIndex)).toEqual([0, 1]);
    expect(stairs.map((g) => g.linkIndex)).toEqual([0, 0]);
    expect(plan.stairLinks[0]!.gateUp).toBe(stairs[0]!.id);
    expect(plan.stairLinks[0]!.gateDown).toBe(stairs[1]!.id);
    for (const g of stairs) expect(g.specificFlowPerSM).toBeCloseTo(stairSpecificFlowPerSM(1.08), 12);
  });
  it('effective width is max(W - 0.3, 0.25) and a 1 m door gives 0.7 m', () => {
    expect(effectiveWidthM(1)).toBeCloseTo(0.7, 12);
    expect(effectiveWidthM(0.25)).toBe(0.25);
    expect(1.3 * effectiveWidthM(1)).toBeCloseTo(0.91, 12);
  });
  it('door and exit cells point to their gate', () => {
    const { plan } = twoFloors();
    const f = plan.floors[0]!;
    const exitGate = plan.gates[plan.exits[0]!.gateId]!;
    expect(exitGate.kind).toBe('exit');
    for (const c of exitGate.cells) expect(f.gateOfCell[c]).toBe(exitGate.id);
    expect(plan.exits[0]!.id).toBe('F0:exit1');
  });
});

describe('caller limits and PLAN_LARGE', () => {
  const room = floorFromAscii(['####', '#..E', '#..E', '####']);
  it('limits can tighten the constants but not raise them', () => {
    const two = { floors: [room, { ...room, id: 'F1', elevationM: 3 }], stairLinks: [] };
    expect(buildPlan(two, { maxFloors: 1, maxCompartments: 100, maxCellsPerFloor: 1_000_000 }).status).toBe('invalid');
    expect(buildPlan(two, { maxFloors: 50, maxCompartments: 100, maxCellsPerFloor: 1_000_000 }).status).toBe('valid');
    const thirteen = { floors: Array.from({ length: 13 }, (_, i) => ({ ...room, id: `F${i}`, elevationM: i })), stairLinks: [] };
    expect(buildPlan(thirteen, { maxFloors: 50, maxCompartments: 100, maxCellsPerFloor: 1_000_000 }).status).toBe('invalid');
  });
  it('adds PLAN_LARGE above the node threshold and still builds', () => {
    const w = 501;
    const h = Math.ceil((PLAN_LARGE_NODES + 1) / w);
    const r = buildPlan({
      floors: [{ id: 'Big', elevationM: 0, widthCells: w, heightCells: h, cells: new Array<CellTypeName>(w * h).fill('free'), compartmentIds: new Array<null>(w * h).fill(null) }],
      stairLinks: [],
    });
    expect(r.status).toBe('valid');
    expect(r.warnings.map((x) => x.code)).toContain('PLAN_LARGE');
  });
  it('index.ts exports buildPlan', () => {
    expect(buildPlanPublic).toBe(buildPlan);
  });
});
