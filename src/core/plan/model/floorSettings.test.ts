import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  checkFloorStacking,
  defaultFloorSettings,
  floorElevationM,
  resolveFloorSettings,
  setFloorField,
} from './floorSettings';

const ids = ['floor1', 'floor2', 'floor3'];

describe('floor settings', () => {
  it('defaults stack exactly with no warning (Req 10.2, 10.3)', () => {
    const f = defaultFloorSettings(ids);
    expect(f.map((x) => x.elevationM)).toEqual([0, 3, 6]);
    expect(checkFloorStacking(f)).toEqual([]);
    expect(resolveFloorSettings(ids, undefined).warnings).toEqual([]);
  });

  it('keeps a ceiling that breaks stacking and warns once naming both floors (Req 10.4)', () => {
    const r = setFloorField(defaultFloorSettings(ids), 'floor1', 'ceilingHeightM', 2.5);
    expect(r.floors[0]!.ceilingHeightM).toBe(2.5);
    const w = checkFloorStacking(r.floors);
    expect(w).toHaveLength(1);
    expect(w[0]!.code).toBe('FLOOR_STACKING');
    expect(w[0]!.message).toContain('floor1');
    expect(w[0]!.message).toContain('floor2');
  });

  it('accepts a 0.01 m stacking difference (Req 10.4)', () => {
    const r = setFloorField(defaultFloorSettings(ids), 'floor2', 'elevationM', 3.02);
    expect(checkFloorStacking(r.floors).map((w) => w.location?.floorId)).toEqual(['floor2', 'floor3']);
    const ok = setFloorField(defaultFloorSettings(['a', 'b']), 'b', 'elevationM', 3.01);
    expect(checkFloorStacking(ok.floors)).toEqual([]);
  });

  it('rejects out-of-range values, keeps the previous one, names the field (Req 10.5)', () => {
    const f = defaultFloorSettings(ids);
    for (const [field, v] of [
      ['elevationM', 100.5],
      ['elevationM', Number.NaN],
      ['ceilingHeightM', 1.4],
      ['ceilingHeightM', 10.1],
      ['ceilingHeightM', '3'],
    ] as const) {
      const r = setFloorField(f, 'floor2', field, v);
      expect(r.floors).toEqual(f);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]!.code).toBe('FLOOR_FIELD_INVALID');
      expect(r.warnings[0]!.location?.field).toBe(field);
    }
    expect(setFloorField(f, 'floor2', 'elevationM', -10).warnings).toEqual([]);
    expect(setFloorField(f, 'floor2', 'ceilingHeightM', 10).warnings).toEqual([]);
  });

  it('resolves provided settings and falls back per field (Req 10.1, 10.5)', () => {
    const r = resolveFloorSettings(['floor1', 'floor2'], [
      { floorId: 'floor1', name: 'Ground', elevationM: 0, ceilingHeightM: 99 },
      { floorId: 'floor2', elevationM: 3.5 },
      { floorId: 'nope', elevationM: 1 },
    ]);
    expect(r.floors[0]).toEqual({ floorId: 'floor1', name: 'Ground', elevationM: 0, ceilingHeightM: 3.5 });
    expect(r.floors[1]!.elevationM).toBe(3.5);
    expect(r.warnings.map((w) => w.code)).toEqual(['FLOOR_FIELD_INVALID']);
  });

  it('gives one elevation per floor (Req 10.7)', () => {
    const f = defaultFloorSettings(ids);
    expect(floorElevationM(f, 'floor3')).toBe(6);
    expect(floorElevationM(f, 'x')).toBeUndefined();
  });

  it('property: setFloorField never throws, always returns values inside the ranges (Req 10.5)', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: false }), fc.double({ noNaN: false }), (e, c) => {
        let f = defaultFloorSettings(ids);
        f = setFloorField(f, 'floor2', 'elevationM', e).floors;
        f = setFloorField(f, 'floor2', 'ceilingHeightM', c).floors;
        const x = f[1]!;
        return x.elevationM >= -10 && x.elevationM <= 100 && x.ceilingHeightM >= 1.5 && x.ceilingHeightM <= 10;
      }),
    );
  });
});
