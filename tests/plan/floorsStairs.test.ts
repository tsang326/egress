import { describe, expect, it } from 'vitest';
import { CELL_FREE, CELL_STAIR } from '../../src/core/people/types';
import {
  checkFloorStacking,
  defaultFloorSettings,
  floorElevationM,
  resolveFloorSettings,
  setFloorField,
} from '../../src/core/plan/model/floorSettings';
import { resolveStairs, type StairFloorGrid } from '../../src/core/plan/model/stairs';

// Unit tests for floor settings and stairs. Req 10.2 to 10.5, 11.3, 11.4, 11.6, 11.10, 11.12, 20.10.

const W = 8;
const H = 8;
const grid = (floorId: string): StairFloorGrid => ({
  floorId,
  widthCells: W,
  heightCells: H,
  cellType: new Uint8Array(W * H).fill(CELL_FREE),
});
const cells = (...c: number[]) => Int32Array.from(c);
const codes = (ws: readonly { code: string }[]) => ws.map((w) => w.code);
const stairCells = (g: StairFloorGrid) => [...g.cellType].flatMap((t, i) => (t === CELL_STAIR ? [i] : []));

describe('floor settings', () => {
  it('defaults: elevation 0, 3, 6; ceiling height equals the floor-to-floor height (Req 10.2, 10.3)', () => {
    const f = defaultFloorSettings(['a', 'b', 'c']);
    expect(f.map((x) => x.elevationM)).toEqual([0, 3, 6]);
    expect(f.map((x) => x.ceilingHeightM)).toEqual([3, 3, 3]);
    expect(f.map((x) => x.name)).toEqual(['Floor 1', 'Floor 2', 'Floor 3']);
    expect(resolveFloorSettings(['a', 'b', 'c'], undefined).warnings).toEqual([]);
  });

  it('a missing ceiling height defaults to the distance to the next floor (Req 10.3)', () => {
    const r = resolveFloorSettings(['a', 'b'], [{ floorId: 'b', elevationM: 3.5 }]);
    expect(r.floors[0]!.ceilingHeightM).toBe(3.5);
    expect(r.floors[1]!.ceilingHeightM).toBe(3);
    expect(r.warnings).toEqual([]);
  });

  it.each([-10.5, 100.5, Number.NaN, Infinity, '2' as unknown as number])('rejects elevation %s and keeps the previous value (Req 10.5)', (v) => {
    const floors = defaultFloorSettings(['a', 'b']);
    const r = setFloorField(floors, 'b', 'elevationM', v);
    expect(r.floors[1]!.elevationM).toBe(3);
    expect(codes(r.warnings)).toEqual(['FLOOR_FIELD_INVALID']);
    expect(r.warnings[0]!.message).toContain('elevationM');
    expect(floors[1]!.elevationM).toBe(3); // input not mutated
  });

  it.each([1.49, 10.01, 0, -3, Number.NaN])('rejects ceiling height %s and keeps the previous value (Req 10.5)', (v) => {
    const floors = defaultFloorSettings(['a']);
    const r = setFloorField(floors, 'a', 'ceilingHeightM', v);
    expect(r.floors[0]!.ceilingHeightM).toBe(3);
    expect(codes(r.warnings)).toEqual(['FLOOR_FIELD_INVALID']);
    expect(r.warnings[0]!.message).toContain('ceilingHeightM');
  });

  it('accepts values at the range limits (Req 10.5)', () => {
    let floors = defaultFloorSettings(['a']);
    for (const [field, v] of [['elevationM', -10], ['elevationM', 100], ['ceilingHeightM', 1.5], ['ceilingHeightM', 10]] as const) {
      const r = setFloorField(floors, 'a', field, v);
      expect(r.warnings).toEqual([]);
      expect(r.floors[0]![field]).toBe(v);
      floors = r.floors;
    }
  });

  it('invalid input in resolveFloorSettings falls back to the defaults with a warning (Req 10.5)', () => {
    const r = resolveFloorSettings(['a', 'b'], [
      { floorId: 'a', ceilingHeightM: 99 },
      { floorId: 'b', elevationM: 500 },
    ]);
    expect(r.floors.map((f) => f.elevationM)).toEqual([0, 3]);
    expect(r.floors.map((f) => f.ceilingHeightM)).toEqual([3, 3]);
    expect(codes(r.warnings)).toEqual(['FLOOR_FIELD_INVALID', 'FLOOR_FIELD_INVALID']);
  });

  it('an unknown floor id changes nothing and warns, without throwing (Req 20.10)', () => {
    const floors = defaultFloorSettings(['a']);
    const r = setFloorField(floors, 'zz', 'name', 'x');
    expect(r.floors).toEqual(floors);
    expect(codes(r.warnings)).toEqual(['FLOOR_FIELD_INVALID']);
  });

  it('warns FLOOR_STACKING naming both floors when the gap is above 0.01 m, and keeps the values (Req 10.4)', () => {
    const floors = defaultFloorSettings(['low', 'up']);
    const r = setFloorField(floors, 'up', 'elevationM', 3.02);
    expect(r.floors[1]!.elevationM).toBe(3.02);
    const w = checkFloorStacking(r.floors);
    expect(codes(w)).toEqual(['FLOOR_STACKING']);
    expect(w[0]!.message).toContain('low');
    expect(w[0]!.message).toContain('up');
    expect(codes(resolveFloorSettings(['low', 'up'], [{ floorId: 'up', elevationM: 3.5, ceilingHeightM: 3 }]).warnings)).toEqual([]);
  });

  it('a gap of exactly 0.01 m is not reported (Req 10.4)', () => {
    const floors = setFloorField(defaultFloorSettings(['a', 'b']), 'b', 'elevationM', 3.01).floors;
    expect(checkFloorStacking(floors)).toEqual([]);
  });

  it('floorElevationM gives the one elevation of a floor (Req 10.7)', () => {
    const floors = defaultFloorSettings(['a', 'b']);
    expect(floorElevationM(floors, 'b')).toBe(3);
    expect(floorElevationM(floors, 'nope')).toBeUndefined();
  });
});

describe('stairs', () => {
  const run = (lower: Int32Array, upper: Int32Array) =>
    resolveStairs({
      floors: [grid('f0'), grid('f1')],
      regions: [
        { floorId: 'f0', cells: lower },
        { floorId: 'f1', cells: upper },
      ],
    });

  it('overlap just below the tolerance: no link and an error naming both floors (Req 11.4)', () => {
    // 4 cells each, 1 shared: 25% < 50%. 7 cells vs 4 cells with 1 shared: 1 < 2.
    const r = run(cells(0, 1, 2, 3), cells(3, 40, 41, 42));
    expect(r.links).toEqual([]);
    expect(codes(r.warnings)).toEqual(['STAIR_OVERLAP_BELOW_TOLERANCE']);
    expect(r.warnings[0]!.severity).toBe('error');
    expect(r.warnings[0]!.message).toContain('f0');
    expect(r.warnings[0]!.message).toContain('f1');
    expect(r.compartments.map((c) => c.floorId)).toEqual(['f0', 'f1']);
  });

  it('overlap exactly at the tolerance: link created (Req 11.3)', () => {
    // 4 cells each, 2 shared: 50% of the smaller region.
    const r = run(cells(0, 1, 2, 3), cells(2, 3, 40, 41));
    expect(r.links).toHaveLength(1);
    expect([...r.links[0]!.footprint]).toEqual([2, 3]);
    expect(codes(r.warnings)).not.toContain('STAIR_OVERLAP_BELOW_TOLERANCE');
  });

  it('the tolerance is relative to the smaller region (Req 11.3)', () => {
    // 2 cells inside a 10-cell region: 100% of the smaller one.
    const big = cells(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
    const r = run(big, cells(0, 1));
    expect(r.links).toHaveLength(1);
    expect(r.links[0]!.widthM).toBeGreaterThan(0);
  });

  it('cells outside the footprint revert to free with STAIR_REGION_TRIMMED on each floor (Req 11.6)', () => {
    const r = run(cells(0, 1, 2, 3), cells(2, 3, 40, 41));
    expect(codes(r.warnings)).toEqual(['STAIR_REGION_TRIMMED', 'STAIR_REGION_TRIMMED']);
    expect(stairCells(r.floors[0]!)).toEqual([2, 3]);
    expect(stairCells(r.floors[1]!)).toEqual([2, 3]);
    expect(r.floors[0]!.cellType[0]).toBe(CELL_FREE);
    expect(r.floors[1]!.cellType[40]).toBe(CELL_FREE);
    expect(r.warnings[0]!.message).toContain('2 stair cells');
  });

  it('identical regions: no trimming warning, identical stair cells on both floors (Req 11.5, 11.6)', () => {
    const r = run(cells(9, 10, 17, 18), cells(9, 10, 17, 18));
    expect(r.warnings).toEqual([]);
    expect(stairCells(r.floors[0]!)).toEqual(stairCells(r.floors[1]!));
  });

  it('does not change the input grids (Req 20.10)', () => {
    const g = grid('f0');
    resolveStairs({ floors: [g], regions: [{ floorId: 'f0', cells: cells(0, 1) }] });
    expect(g.cellType.every((t) => t === CELL_FREE)).toBe(true);
  });

  it('a stair on the only (top and bottom) floor: compartment, no link, no warning (Req 11.12)', () => {
    const r = resolveStairs({ floors: [grid('f0')], regions: [{ floorId: 'f0', cells: cells(0, 1, 2) }] });
    expect(r.links).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.compartments).toHaveLength(1);
    expect(stairCells(r.floors[0]!)).toEqual([0, 1, 2]);
  });

  it('bottom and top floor stairs without a region on the neighbour get no link and no warning (Req 11.12)', () => {
    const bottom = resolveStairs({
      floors: [grid('f0'), grid('f1')],
      regions: [{ floorId: 'f0', cells: cells(0, 1) }],
    });
    expect(bottom.links).toEqual([]);
    expect(bottom.warnings).toEqual([]);
    expect(bottom.compartments.map((c) => c.floorId)).toEqual(['f0']);

    const top = resolveStairs({
      floors: [grid('f0'), grid('f1')],
      regions: [{ floorId: 'f1', cells: cells(0, 1) }],
    });
    expect(top.links).toEqual([]);
    expect(top.warnings).toEqual([]);
    expect(top.compartments.map((c) => c.floorId)).toEqual(['f1']);
  });

  it('three floors: the middle floor keeps one footprint shared by both links (Req 11.3)', () => {
    const r = resolveStairs({
      floors: [grid('f0'), grid('f1'), grid('f2')],
      regions: [
        { floorId: 'f0', cells: cells(0, 1, 2, 3) },
        { floorId: 'f1', cells: cells(0, 1, 2, 3) },
        { floorId: 'f2', cells: cells(0, 1, 2, 3) },
      ],
    });
    expect(r.links).toHaveLength(2);
    expect(r.warnings).toEqual([]);
  });

  describe('roof opening (Req 11.10)', () => {
    const base = {
      floors: [grid('f0'), grid('f1')],
      regions: [
        { floorId: 'f0', cells: cells(0, 1) },
        { floorId: 'f1', cells: cells(0, 1) },
      ],
    };

    it('is accepted on the top stair compartment', () => {
      const r = resolveStairs({ ...base, roofVents: [{ floorId: 'f1', areaM2: 1.2, openFraction: 0.5 }] });
      expect(r.roofOpenings).toEqual([{ floorId: 'f1', areaM2: 1.2, openFraction: 0.5 }]);
      expect(r.warnings).toEqual([]);
    });

    it('is dropped with a warning on a floor that has a link above', () => {
      const r = resolveStairs({ ...base, roofVents: [{ floorId: 'f0', areaM2: 1, openFraction: 1 }] });
      expect(r.roofOpenings).toEqual([]);
      expect(codes(r.warnings)).toEqual(['EDIT_IGNORED']);
    });

    it.each([
      { areaM2: 0, openFraction: 0.5 },
      { areaM2: -1, openFraction: 0.5 },
      { areaM2: 1, openFraction: 1.5 },
      { areaM2: Number.NaN, openFraction: 0.5 },
    ])('is dropped with a warning for invalid values %j', (v) => {
      const r = resolveStairs({ ...base, roofVents: [{ floorId: 'f1', ...v }] });
      expect(r.roofOpenings).toEqual([]);
      expect(r.warnings).toHaveLength(1);
    });

    it('is dropped on a floor without a stair', () => {
      const r = resolveStairs({ floors: [grid('f0')], regions: [], roofVents: [{ floorId: 'f0', areaM2: 1, openFraction: 1 }] });
      expect(r.roofOpenings).toEqual([]);
      expect(r.warnings).toHaveLength(1);
    });
  });

  it('bad input does not throw (Req 20.10)', () => {
    expect(() =>
      resolveStairs({
        floors: [grid('f0')],
        regions: [{ floorId: 'f0', cells: cells(-1, 9999, 1.5 as unknown as number) }, null as never],
      }),
    ).not.toThrow();
  });
});
