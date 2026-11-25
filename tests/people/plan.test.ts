// Unit tests for the Plan_Builder (task 2.4; Requirements 1.1, 1.2, 1.3, 1.4, 1.6, 1.8).
import { describe, expect, it } from 'vitest';
import { floorFromAscii } from '../../src/core/people/plan/ascii';
import { buildPlan } from '../../src/core/people/plan/builder';
import type { CellTypeName, FloorInput, PlanInput } from '../../src/core/people/types';
import { noExit, noExitRows, twoFloors } from './samplePlans';

const roomFloor = (id: string, elevationM = 0): FloorInput => floorFromAscii(['####', '#aa#', '#aa#', '####'], { a: 'A' }, { id, elevationM });
const cellsOf = (f: FloorInput): (number | CellTypeName)[] => Array.from(f.cells);
const codes = (r: ReturnType<typeof buildPlan>): string[] => r.warnings.map((w) => w.code);

// Two rooms, a wall column with a door gap of `doorRows` rows, and a 2-cell exit.
function doorPlan(doorRows: number[]): FloorInput {
  const rows: string[] = [];
  for (let y = 0; y < 8; y++) {
    if (y === 0 || y === 7) rows.push('#############');
    else rows.push(`#aaaaa${doorRows.includes(y) ? 'D' : '#'}bbbbb${y === 3 || y === 4 ? 'E' : '#'}`);
  }
  return floorFromAscii(rows, { a: 'A', b: 'B' });
}

describe('buildPlan limits (Requirements 1.2, 1.3)', () => {
  it('rejects 13 floors and names the limit', () => {
    const r = buildPlan({ floors: Array.from({ length: 13 }, (_, i) => roomFloor(`F${i}`, i)), stairLinks: [] });
    expect(r.status).toBe('invalid');
    expect(r.plan).toBeNull();
    expect(r.warnings[0]!.code).toBe('PLAN_LIMIT');
    expect(r.warnings[0]!.message).toContain('floors');
  });
  it('accepts 12 floors', () => {
    const r = buildPlan({ floors: Array.from({ length: 12 }, (_, i) => roomFloor(`F${i}`, i)), stairLinks: [] });
    expect(r.status).toBe('valid');
  });
  it('rejects 101 compartments and accepts 100', () => {
    const mk = (n: number): PlanInput => ({
      floors: [{ id: 'F', elevationM: 0, widthCells: n, heightCells: 1, cells: Array(n).fill('free'), compartmentIds: Array.from({ length: n }, (_, i) => `c${i}`) }],
      stairLinks: [],
    });
    const bad = buildPlan(mk(101));
    expect(bad.status).toBe('invalid');
    expect(bad.warnings[0]!.message).toContain('compartments');
    expect(buildPlan(mk(100)).status).toBe('valid');
  });
  it('rejects 1,000,001 cells on a floor without reading them', () => {
    const r = buildPlan({
      floors: [{ id: 'Big', elevationM: 0, widthCells: 1_000_001, heightCells: 1, cells: { length: 1_000_001 }, compartmentIds: { length: 1_000_001 } }],
      stairLinks: [],
    });
    expect(r.status).toBe('invalid');
    expect(r.warnings[0]!.code).toBe('PLAN_LIMIT');
    expect(r.warnings[0]!.message).toContain('Big');
  });
});

describe('buildPlan checks (Requirements 1.1, 1.3)', () => {
  it('names floor and cell of a bad cell type', () => {
    const f = roomFloor('F0');
    const cells = cellsOf(f);
    cells[5] = 'lava' as CellTypeName; // deliberately outside the five types
    const r = buildPlan({ floors: [{ ...f, cells }], stairLinks: [] });
    expect(r.status).toBe('invalid');
    expect(r.warnings[0]!.code).toBe('PLAN_CELL_TYPE');
    expect(r.warnings[0]!.message).toContain('F0');
    expect(r.warnings[0]!.message).toContain('(1, 1)');
    expect(r.warnings[0]!.message).toContain('lava');
  });
  it('accepts numeric cell codes 0 to 4 and rejects 5', () => {
    const f = roomFloor('F0');
    const numeric = cellsOf(f).map((c) => ['wall', 'free', 'door', 'exit', 'stair'].indexOf(c as string));
    expect(buildPlan({ floors: [{ ...f, cells: numeric }], stairLinks: [] }).status).toBe('valid');
    numeric[5] = 5;
    expect(buildPlan({ floors: [{ ...f, cells: numeric }], stairLinks: [] }).status).toBe('invalid');
  });
  it.each([NaN, Infinity, -Infinity, 101, -11])('rejects elevation %s', (e) => {
    const r = buildPlan({ floors: [{ ...roomFloor('F0'), elevationM: e }], stairLinks: [] });
    expect(r.status).toBe('invalid');
    expect(r.warnings[0]!.code).toBe('PLAN_ELEVATION');
    expect(r.warnings[0]!.message).toContain('F0');
  });
  it('accepts the elevation bounds -10 and 100', () => {
    expect(buildPlan({ floors: [{ ...roomFloor('F0'), elevationM: -10 }], stairLinks: [] }).status).toBe('valid');
    expect(buildPlan({ floors: [{ ...roomFloor('F0'), elevationM: 100 }], stairLinks: [] }).status).toBe('valid');
  });
  it('gives wall cells no compartment', () => {
    const r = buildPlan({ floors: [{ ...roomFloor('F0'), compartmentIds: Array(16).fill('X') }], stairLinks: [] });
    expect(r.plan!.compartmentIds).toEqual(['X']);
    expect(r.plan!.floors[0]!.compartment[0]).toBe(0xffff);
  });
});

describe('stair links (Requirement 1.4)', () => {
  it('rejects a link whose footprint does not match and names both floors and the coordinates', () => {
    const f0 = floorFromAscii(['#####', '#S..#', '#####'], {}, { id: 'F0', elevationM: 0 });
    const f1 = floorFromAscii(['#####', '#.S.#', '#####'], {}, { id: 'F1', elevationM: 3 });
    const r = buildPlan({ floors: [f0, f1], stairLinks: [{ id: 'L', lowerFloorId: 'F0', upperFloorId: 'F1' }] });
    expect(r.status).toBe('valid');
    expect(r.plan!.stairLinks).toHaveLength(0);
    const w = r.warnings.find((x) => x.code === 'STAIR_LINK_MISMATCH')!;
    expect(w.message).toContain('F0');
    expect(w.message).toContain('F1');
    expect(w.message).toContain('(1, 1)');
  });
  it('accepts a matching link and computes the incline length from the elevation difference', () => {
    const { plan } = twoFloors();
    expect(plan.stairLinks).toHaveLength(1);
    const l = plan.stairLinks[0]!;
    expect(l.inclineLengthM).toBeCloseTo(3 * Math.sqrt(1 + (0.279 / 0.178) ** 2), 9);
    expect(plan.gates.filter((g) => g.kind === 'stair')).toHaveLength(2);
    expect(l.footprint).toHaveLength(4);
  });
  it('warns and clamps when riser and tread are outside the table, and not for the default stair', () => {
    const rows = ['#####', '#SS.#', '#SS.#', '#####'];
    const f = [floorFromAscii(rows, {}, { id: 'A', elevationM: 0 }), floorFromAscii(rows, {}, { id: 'B', elevationM: 3 })];
    const steep = buildPlan({ floors: f, stairLinks: [{ id: 'L', lowerFloorId: 'A', upperFloorId: 'B', riserM: 0.25, treadM: 0.25 }] });
    expect(codes(steep)).toContain('STAIR_GEOMETRY_RANGE');
    expect(steep.plan!.stairLinks[0]!.speedFreeMPerS).toBe(1.0);
    const normal = buildPlan({ floors: f, stairLinks: [{ id: 'L', lowerFloorId: 'A', upperFloorId: 'B' }] });
    expect(codes(normal)).not.toContain('STAIR_GEOMETRY_RANGE');
  });
});

describe('door width (Requirement 2.9)', () => {
  it('warns DOOR_TOO_NARROW for a 1-cell door and passes a 2-cell door', () => {
    const one = buildPlan({ floors: [doorPlan([3])], stairLinks: [] });
    const doorWarnings = one.warnings.filter((w) => w.code === 'DOOR_TOO_NARROW');
    expect(doorWarnings).toHaveLength(1);
    expect(doorWarnings[0]!.message).toContain('door');
    const two = buildPlan({ floors: [doorPlan([3, 4])], stairLinks: [] });
    expect(two.warnings.filter((w) => w.code === 'DOOR_TOO_NARROW')).toHaveLength(0);
    const gate = two.plan!.gates.find((g) => g.kind === 'door')!;
    expect(gate.widthM).toBeCloseTo(0.5, 12);
    expect(gate.effectiveWidthM).toBeCloseTo(0.25, 12); // max(0.5 - 0.3, 0.25)
  });
  it('a 1-cell door leaves the far room unreachable', () => {
    const r = buildPlan({ floors: [doorPlan([3])], stairLinks: [] });
    expect(r.warnings.filter((w) => w.code === 'UNREACHABLE_REGION').length).toBeGreaterThan(0);
  });
  it('effective width follows W - 0.3 for a wider door', () => {
    const r = buildPlan({ floors: [doorPlan([2, 3, 4, 5])], stairLinks: [] });
    const gate = r.plan!.gates.find((g) => g.kind === 'door')!;
    expect(gate.widthM).toBeCloseTo(1.0, 12);
    expect(gate.effectiveWidthM).toBeCloseTo(0.7, 12);
  });
});

describe('reachability (Requirement 1.8)', () => {
  it('gives one UNREACHABLE_REGION per sealed pocket, with floor and bounding box', () => {
    const rows = [
      '####################',
      '#..................E',
      '#..................E',
      '#.#####...#####....#',
      '#.#...#...#...#....#',
      '#.#...#...#...#....#',
      '#.#...#...#...#....#',
      '#.#####...#####....#',
      '#..................#',
      '#..................#',
      '####################',
    ];
    const r = buildPlan({ floors: [floorFromAscii(rows, {}, { id: 'G' })], stairLinks: [] });
    const regions = r.warnings.filter((w) => w.code === 'UNREACHABLE_REGION');
    expect(regions).toHaveLength(2);
    expect(regions[0]!.message).toContain('floor G');
    expect(regions[0]!.message).toContain('(3, 4)');
    expect(regions[0]!.message).toContain('(5, 6)');
    expect(regions[1]!.message).toContain('(11, 4)');
    expect(regions[1]!.message).toContain('(13, 6)');
  });
  const twoStoreys = (links: boolean): ReturnType<typeof buildPlan> =>
    buildPlan({
      floors: [
        floorFromAscii(['#######', '#SS...E', '#SS...E', '#######'], {}, { id: 'F0', elevationM: 0 }),
        floorFromAscii(['#######', '#SS...#', '#SS...#', '#######'], {}, { id: 'F1', elevationM: 3 }),
      ],
      stairLinks: links ? [{ id: 'L', lowerFloorId: 'F0', upperFloorId: 'F1' }] : [],
    });
  it('reaches the upper floor through the stair', () => {
    expect(twoStoreys(true).warnings.filter((w) => w.code === 'UNREACHABLE_REGION')).toHaveLength(0);
  });
  it('an upper floor without a stair link is unreachable', () => {
    const regions = twoStoreys(false).warnings.filter((w) => w.code === 'UNREACHABLE_REGION');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.message).toContain('floor F1');
  });
  it('a plan with no exit is valid, has no fields and one region warning for its one room', () => {
    const { plan } = noExit();
    expect(plan.exits).toHaveLength(0);
    expect(plan.baseFields).toHaveLength(0);
    const r = buildPlan({ floors: [floorFromAscii(noExitRows, { a: 'A' })], stairLinks: [] });
    expect(r.status).toBe('valid');
    expect(codes(r)).toEqual(['UNREACHABLE_REGION']);
    expect(r.warnings[0]!.message).toContain('(1, 1)');
    expect(r.warnings[0]!.message).toContain('(8, 4)');
  });
});

describe('no throw (Requirement 1.3)', () => {
  const weird: unknown[] = [
    {},
    { floors: null },
    { floors: [null] },
    { floors: [{}] },
    { floors: [{ id: 'F', elevationM: 0, widthCells: 0, heightCells: 0, cells: [], compartmentIds: [] }] },
    { floors: [{ id: 'F', elevationM: 0, widthCells: 2.5, heightCells: 1, cells: [], compartmentIds: [] }] },
    { floors: [{ id: 'F', elevationM: 0, widthCells: 2, heightCells: 1, cells: ['free'], compartmentIds: [null, null] }] },
    { floors: [{ id: 'F', elevationM: 0, widthCells: 1, heightCells: 1, cells: [{}], compartmentIds: [3] }] },
    { floors: [roomFloor('F0'), roomFloor('F0')], stairLinks: [] },
    { floors: [roomFloor('F0'), roomFloor('F1', 3)], stairLinks: [null, { id: 1 }, { id: 'x', lowerFloorId: 'F1', upperFloorId: 'F0' }] },
  ];
  it.each(weird.map((w, i) => [i, w] as const))('input %i returns a result', (_i, input) => {
    expect(() => buildPlan(input as PlanInput)).not.toThrow();
    const r = buildPlan(input as PlanInput);
    expect(['valid', 'invalid']).toContain(r.status);
    if (r.status === 'invalid') {
      expect(r.plan).toBeNull();
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });
  it('throws TypeError only for a non-object argument', () => {
    expect(() => buildPlan(null as unknown as PlanInput)).toThrow(TypeError);
    expect(() => buildPlan(5 as unknown as PlanInput)).toThrow(TypeError);
  });
});
