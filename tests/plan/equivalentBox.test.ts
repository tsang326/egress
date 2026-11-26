// Unit tests for the compartment mapper (tasks.md 9.2). Validates: Requirements 9.3, 9.4, 9.5, 9.7, 9.8, 20.10.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../../src/core/fire/types';
import { validate } from '../../src/core/fire/validate/validate';
import { NON_RECTANGULAR_WARN_FRACTION } from '../../src/core/plan/constants';
import { equivalentBox, fireKindOf, roomToCompartment } from '../../src/core/plan/derive/equivalentBox';
import type { Room } from '../../src/core/plan/types';
import { arbScenario } from '../fire/arbitraries';

const room = (over: Partial<Room> = {}): Room => ({
  id: 'r1',
  floorId: 'f1',
  name: 'Room',
  kind: 'room',
  cells: new Int32Array(0),
  areaM2: 20,
  bboxWidthM: 5,
  bboxHeightM: 4,
  touchesBorder: false,
  ...over,
});
const floor = { elevationM: 3, ceilingHeightM: 2.6 };

describe('roomToCompartment', () => {
  it('rectangular room: box matches area and ratio, no warning, zero area error (Req 9.2, 9.5)', () => {
    const r = roomToCompartment(room(), floor);
    const c = r.compartment!;
    expect(c.widthM * c.depthM).toBeCloseTo(20, 9);
    expect(c.widthM / c.depthM).toBeCloseTo(5 / 4, 9);
    expect(c.id).toBe('r1');
    expect(c.heightM).toBe(2.6);
    expect(c.floorElevationM).toBe(3);
    expect(r.warnings).toEqual([]);
    expect(Math.abs(r.boxAreaRelativeError)).toBeLessThan(1e-12);
    expect(r.bboxAreaRelativeError).toBeCloseTo(0, 12);
  });

  it('L-shaped room: one warning with both areas and the relative difference (Req 9.4)', () => {
    // 6 x 5 bounding box = 30 m2 with a 10 m2 notch, room area 20 m2: 50 percent bigger.
    const r = roomToCompartment(room({ areaM2: 20, bboxWidthM: 6, bboxHeightM: 5 }), floor);
    expect(r.warnings).toHaveLength(1);
    const w = r.warnings[0]!;
    expect(w.code).toBe('ROOM_NOT_RECTANGULAR');
    expect(w.message).toContain('r1');
    expect(w.message).toContain('20');
    expect(w.message).toContain('30');
    expect(w.message).toContain('50%');
    expect(w.message).toContain('not rectangular');
    expect(r.bboxAreaRelativeError).toBeCloseTo(0.5, 12);
    const c = r.compartment!;
    expect(c.widthM * c.depthM).toBeCloseTo(20, 9);
    expect(Math.abs(r.boxAreaRelativeError)).toBeLessThan(1e-12);
  });

  it('warns only above the 5 percent threshold', () => {
    const f = NON_RECTANGULAR_WARN_FRACTION;
    const at = roomToCompartment(room({ areaM2: 100, bboxWidthM: 10, bboxHeightM: 10 * (1 + f * 0.9) }), floor);
    const above = roomToCompartment(room({ areaM2: 100, bboxWidthM: 10, bboxHeightM: 10 * (1 + f * 1.2) }), floor);
    expect(at.warnings).toHaveLength(0);
    expect(above.warnings).toHaveLength(1);
  });

  it('maps room kinds (Req 9.3)', () => {
    expect(fireKindOf('room')).toEqual({ kind: 'room', isStair: false });
    expect(fireKindOf('corridor')).toEqual({ kind: 'corridor', isStair: false });
    expect(fireKindOf('stair')).toEqual({ kind: 'shaft', isStair: true });
    const stair = roomToCompartment(room({ kind: 'stair' }), floor).compartment!;
    expect(stair.kind).toBe('shaft');
    expect(stair.isStair).toBe(true);
    const corridor = roomToCompartment(room({ kind: 'corridor' }), floor).compartment!;
    expect(corridor.kind).toBe('corridor');
    expect(corridor.isStair).toBeUndefined();
  });

  it('returns no compartment and a warning for unusable numbers, never throws (Req 9.8)', () => {
    const bad = [
      room({ areaM2: 0 }),
      room({ areaM2: Number.NaN }),
      room({ bboxWidthM: 0 }),
      room({ bboxHeightM: -1 }),
      room({ bboxWidthM: Number.POSITIVE_INFINITY }),
    ];
    for (const r of bad) {
      const out = roomToCompartment(r, floor);
      expect(out.compartment).toBeNull();
      expect(out.warnings).toHaveLength(1);
    }
    expect(roomToCompartment(room(), { elevationM: 0, ceilingHeightM: 0 }).compartment).toBeNull();
    expect(roomToCompartment(room(), { elevationM: Number.NaN, ceilingHeightM: 2.5 }).compartment).toBeNull();
    expect(equivalentBox(0, 1, 1)).toBeNull();
  });

  it('gives each compartment its own copy of the default surfaces (Req 9.7)', () => {
    const a = roomToCompartment(room({ id: 'a' }), floor).compartment!;
    const b = roomToCompartment(room({ id: 'b' }), floor).compartment!;
    expect(a.walls).toEqual(b.walls);
    expect(a.walls).not.toBe(b.walls);
    expect(a.ceiling).not.toBe(a.walls);
    expect(a.floor).not.toBe(b.floor);
  });
});

describe('default surfaces and the fire input validator (Req 9.7, 9.8, 20.10)', () => {
  const base = fc.sample(arbScenario(), { numRuns: 1, seed: 1 })[0]!;

  it('a mapped room of each kind passes validation without errors', () => {
    const rooms = [room({ id: 'a' }), room({ id: 'b', kind: 'corridor' }), room({ id: 'c', kind: 'stair' })];
    const compartments = rooms.map((r, i) =>
      roomToCompartment(r, { elevationM: i * 4, ceilingHeightM: 2.6 }).compartment!,
    );
    const scenario: Scenario = {
      ...structuredClone(base),
      compartments,
      vents: [],
      fires: base.fires.slice(0, 1).map((f) => ({ ...f, compartmentId: 'a', xM: 0.5, yM: 0.5 })),
      unsupported: [],
    };
    const errors = validate(scenario).warnings.filter((w) => w.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('accepts any positive area, ratio and floor height (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 400, noNaN: true }),
        fc.double({ min: 0.2, max: 5, noNaN: true }),
        fc.double({ min: 2, max: 4, noNaN: true }),
        (area, ratio, h) => {
          const r = room({ areaM2: area, bboxWidthM: Math.sqrt(area) * ratio, bboxHeightM: Math.sqrt(area) });
          const c = roomToCompartment(r, { elevationM: 0, ceilingHeightM: h }).compartment!;
          const s: Scenario = {
            ...structuredClone(base),
            compartments: [c],
            vents: [],
            fires: base.fires.slice(0, 1).map((f) => ({ ...f, compartmentId: c.id, xM: c.widthM / 2, yM: c.depthM / 2 })),
            unsupported: [],
          };
          // Only surface and box errors matter here; the generated base fire may break size limits of its own.
          const codes = validate(s).warnings.filter((w) => w.severity === 'error' && /COMPARTMENT|SURFACE|LAYER/.test(w.code));
          expect(codes).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
