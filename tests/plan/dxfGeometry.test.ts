import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DXF_MAX_ENTITIES } from '../../src/core/plan/constants';
import { flattenEntities, readDrawing } from '../../src/core/plan/dxf/blocks';
import type { FlatEntity } from '../../src/core/plan/dxf/blocks';
import { tokenizeDxf } from '../../src/core/plan/dxf/tokenize';
import { bulgeToArc, insertTransform, multiply, applyToPoint } from '../../src/core/plan/dxf/transform';

// Builds DXF text from [code, value] pairs.
const dxf = (pairs: [number, string | number][]): string => pairs.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';
const section = (name: string, body: [number, string | number][]): [number, string | number][] => [
  [0, 'SECTION'], [2, name], ...body, [0, 'ENDSEC'],
];
const line = (layer: string, x1: number, y1: number, x2: number, y2: number): [number, string | number][] => [
  [0, 'LINE'], [8, layer], [10, x1], [20, y1], [11, x2], [21, y2],
];
const block = (name: string, body: [number, string | number][], base: [number, number] = [0, 0]): [number, string | number][] => [
  [0, 'BLOCK'], [8, '0'], [2, name], [70, 0], [10, base[0]], [20, base[1]], [3, name], ...body, [0, 'ENDBLK'],
];
const insert = (name: string, layer: string, x: number, y: number, sx = 1, sy = 1, rot = 0): [number, string | number][] => [
  [0, 'INSERT'], [8, layer], [2, name], [10, x], [20, y], [41, sx], [42, sy], [50, rot],
];

function flatten(text: string, metersPerUnit = 1) {
  const t = tokenizeDxf(text, 'f.dxf');
  if (!t.ok) throw new Error('tokenize failed');
  const d = readDrawing(t.pairs, 'f.dxf');
  if (!d.ok) return { read: d, flat: null };
  return { read: d, flat: flattenEntities(d.drawing, { fileName: 'f.dxf', metersPerUnit }) };
}
function entities(text: string, mpu = 1): FlatEntity[] {
  const r = flatten(text, mpu);
  if (r.flat === null || !r.flat.ok) throw new Error('flatten failed');
  return r.flat.entities;
}
function warnings(text: string, mpu = 1) {
  const r = flatten(text, mpu);
  if (r.read.ok && r.flat !== null && r.flat.ok) return [...r.read.warnings, ...r.flat.warnings];
  return [];
}

describe('transform', () => {
  it('bulge 1 is a half circle through the chord ends', () => {
    const a = bulgeToArc({ x: 0, y: 0 }, { x: 2, y: 0 }, 1);
    expect(a).not.toBeNull();
    expect(a!.cx).toBeCloseTo(1);
    expect(a!.cy).toBeCloseTo(0);
    expect(a!.r).toBeCloseTo(1);
    expect(a!.sweepRad).toBeCloseTo(Math.PI);
  });
  it('negative bulge is the clockwise arc, stored counter-clockwise', () => {
    const a = bulgeToArc({ x: 0, y: 0 }, { x: 2, y: 0 }, -1)!;
    expect(a.sweepRad).toBeCloseTo(Math.PI);
    expect(a.startRad).toBeCloseTo(0); // from p1 (angle 0) counter-clockwise to p0
  });
  it('90 degree rotation is exact', () => {
    const m = insertTransform(10, 20, 1, 1, 90, 0, 0);
    expect(applyToPoint(m, 1, 0)).toEqual({ x: 10, y: 21 });
  });
  it('composition applies the inner transform first', () => {
    const inner = insertTransform(1, 0, 1, 1, 0, 0, 0);
    const outer = insertTransform(0, 0, 2, 2, 0, 0, 0);
    expect(applyToPoint(multiply(outer, inner), 0, 0)).toEqual({ x: 2, y: 0 });
  });
});

describe('entities', () => {
  it('reads LINE, LWPOLYLINE with bulge, old POLYLINE, ARC and CIRCLE', () => {
    const text = dxf([
      ...section('ENTITIES', [
        ...line('A', 0, 0, 1, 0),
        [0, 'LWPOLYLINE'], [8, 'B'], [90, 3], [70, 1], [10, 0], [20, 0], [42, 1], [10, 2], [20, 0], [10, 2], [20, 2],
        [0, 'POLYLINE'], [8, 'C'], [70, 0], [0, 'VERTEX'], [8, 'C'], [10, 0], [20, 0], [0, 'VERTEX'], [8, 'C'], [10, 1], [20, 1], [0, 'SEQEND'],
        [0, 'ARC'], [8, 'D'], [10, 0], [20, 0], [40, 1], [50, 0], [51, 90],
        [0, 'CIRCLE'], [8, 'E'], [10, 0], [20, 0], [40, 2],
      ]),
      [0, 'EOF'],
    ]);
    const e = entities(text);
    expect(e.map((x) => x.kind)).toEqual(['LINE', 'POLYLINE', 'POLYLINE', 'ARC', 'CIRCLE']);
    const lw = e[1] as Extract<FlatEntity, { kind: 'POLYLINE' }>;
    expect(lw.closed).toBe(true);
    expect(lw.vertices[0]!.bulge).toBe(1);
    const old = e[2] as Extract<FlatEntity, { kind: 'POLYLINE' }>;
    expect(old.vertices).toHaveLength(2);
  });

  it('counts skipped entity types and warns once per type', () => {
    const text = dxf([
      ...section('ENTITIES', [[0, 'TEXT'], [8, 'T'], [0, 'TEXT'], [8, 'T'], [0, 'HATCH'], [8, 'T'], ...line('A', 0, 0, 1, 0)]),
      [0, 'EOF'],
    ]);
    const w = warnings(text).filter((x) => x.code === 'DXF_ENTITY_SKIPPED');
    expect(w).toHaveLength(2);
    expect(w.find((x) => x.message.includes('TEXT'))!.message).toContain('2 TEXT');
  });

  it('enforces the entity cap and reports the count found', () => {
    const body: [number, string | number][] = [];
    for (let i = 0; i < DXF_MAX_ENTITIES + 1; i++) body.push([0, 'TEXT']);
    const r = flatten(dxf([...section('ENTITIES', body), [0, 'EOF']]));
    expect(r.read.ok).toBe(false);
    if (!r.read.ok) expect(r.read.error.message).toContain(String(DXF_MAX_ENTITIES + 1));
  });
});

describe('blocks', () => {
  const door = block('DOOR', [...line('0', 0, 0, 1, 0)]);

  it('applies insertion point, scale, rotation and base point', () => {
    const text = dxf([
      ...section('BLOCKS', block('B', line('0', 1, 0, 2, 0), [1, 0])),
      ...section('ENTITIES', insert('B', 'A-DOOR', 5, 5, 2, 2, 90)),
      [0, 'EOF'],
    ]);
    const e = entities(text)[0] as Extract<FlatEntity, { kind: 'LINE' }>;
    expect(e.layer).toBe('A-DOOR'); // layer 0 inside a block takes the INSERT layer
    expect([e.x1, e.y1, e.x2, e.y2]).toEqual([5, 5, 5, 7]);
    expect(e.insert?.blockName).toBe('B');
  });

  it('a negative scale mirrors', () => {
    const text = dxf([
      ...section('BLOCKS', door),
      ...section('ENTITIES', insert('DOOR', 'L', 10, 0, -1, 1)),
      [0, 'EOF'],
    ]);
    const e = entities(text)[0] as Extract<FlatEntity, { kind: 'LINE' }>;
    expect([e.x1, e.x2]).toEqual([10, 9]);
  });

  it('mirroring flips the bulge sign and keeps the arc', () => {
    const b = block('P', [[0, 'LWPOLYLINE'], [8, '0'], [90, 2], [70, 0], [10, 0], [20, 0], [42, 0.5], [10, 1], [20, 0]]);
    const text = dxf([...section('BLOCKS', b), ...section('ENTITIES', insert('P', 'L', 0, 0, -1, 1)), [0, 'EOF']]);
    const p = entities(text)[0] as Extract<FlatEntity, { kind: 'POLYLINE' }>;
    expect(p.vertices[0]!.bulge).toBeCloseTo(-0.5);
    expect(p.vertices[1]!.x).toBeCloseTo(-1);
  });

  it('non-uniform scale turns an arc into straight pieces', () => {
    const b = block('A', [[0, 'ARC'], [8, '0'], [10, 0], [20, 0], [40, 1], [50, 0], [51, 90]]);
    const text = dxf([...section('BLOCKS', b), ...section('ENTITIES', insert('A', 'L', 0, 0, 2, 1)), [0, 'EOF']]);
    const p = entities(text)[0]!;
    expect(p.kind).toBe('POLYLINE');
    const v = (p as Extract<FlatEntity, { kind: 'POLYLINE' }>).vertices;
    expect(v[0]!.x).toBeCloseTo(2);
    expect(v[v.length - 1]!.y).toBeCloseTo(1);
  });

  it('flattens nested inserts', () => {
    const text = dxf([
      ...section('BLOCKS', [...block('IN', line('0', 0, 0, 1, 0)), ...block('OUT', insert('IN', '0', 3, 0, 1, 1, 0))]),
      ...section('ENTITIES', insert('OUT', 'L', 0, 10, 1, 1, 0)),
      [0, 'EOF'],
    ]);
    const e = entities(text)[0] as Extract<FlatEntity, { kind: 'LINE' }>;
    expect([e.x1, e.y1, e.x2, e.y2]).toEqual([3, 10, 4, 10]);
  });

  it('skips a block that contains itself, with one warning naming it', () => {
    const text = dxf([
      ...section('BLOCKS', [...block('LOOP', [...line('0', 0, 0, 1, 0), ...insert('LOOP', '0', 0, 0)])]),
      ...section('ENTITIES', insert('LOOP', 'L', 0, 0)),
      [0, 'EOF'],
    ]);
    expect(entities(text)).toHaveLength(1);
    const w = warnings(text).filter((x) => x.code === 'DXF_BLOCK_CYCLE_OR_DEPTH');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toContain('LOOP');
  });

  it('allows 8 levels of nesting and skips the 9th', () => {
    const chain = (levels: number): string => {
      const blocks: [number, string | number][] = [...block('B0', line('0', 0, 0, 1, 0))];
      for (let i = 1; i < levels; i++) blocks.push(...block(`B${i}`, insert(`B${i - 1}`, '0', 0, 0)));
      return dxf([...section('BLOCKS', blocks), ...section('ENTITIES', insert(`B${levels - 1}`, 'L', 0, 0)), [0, 'EOF']]);
    };
    expect(entities(chain(8))).toHaveLength(1);
    expect(entities(chain(9))).toHaveLength(0);
    expect(warnings(chain(9)).some((x) => x.code === 'DXF_BLOCK_CYCLE_OR_DEPTH')).toBe(true);
  });

  it('stops an expansion bomb at the entity cap', () => {
    const blocks: [number, string | number][] = [...block('B0', line('0', 0, 0, 1, 0))];
    for (let i = 1; i < 8; i++) {
      const body: [number, string | number][] = [];
      for (let k = 0; k < 10; k++) body.push(...insert(`B${i - 1}`, '0', 0, 0));
      blocks.push(...block(`B${i}`, body));
    }
    const r = flatten(dxf([...section('BLOCKS', blocks), ...section('ENTITIES', insert('B7', 'L', 0, 0)), [0, 'EOF']]));
    expect(r.flat !== null && !r.flat.ok).toBe(true);
  });

  it('drops entities with coordinates beyond 1000 m, after unit conversion', () => {
    const text = dxf([...section('ENTITIES', [...line('A', 0, 0, 1500, 0), ...line('A', 0, 0, 5, 0)]), [0, 'EOF']]);
    expect(entities(text, 1)).toHaveLength(1);
    expect(warnings(text, 1).filter((x) => x.code === 'DXF_COORDINATE_OUT_OF_RANGE')).toHaveLength(1);
    expect(entities(text, 0.001)).toHaveLength(2); // the same numbers are millimetres
  });

  it('drops an entity with a non-finite coordinate', () => {
    const text = dxf([...section('ENTITIES', [[0, 'LINE'], [8, 'A'], [10, 0], [20, 0], [11, '1e999'], [21, 0]]), [0, 'EOF']]);
    expect(entities(text)).toHaveLength(0);
    expect(warnings(text)[0]!.message).toContain('"A"');
  });
});

describe('INSERT transform properties', () => {
  it('a block drawn at a rotation of a multiple of 90 degrees equals the rotated points', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: 0, max: 3 }), fc.constantFrom(-2, -1, 1, 2), fc.constantFrom(-2, -1, 1, 2),
        (x1, y1, x2, y2, quarter, sx, sy) => {
          const text = dxf([
            ...section('BLOCKS', block('B', line('0', x1, y1, x2, y2))),
            ...section('ENTITIES', insert('B', 'L', 3, 4, sx, sy, quarter * 90)),
            [0, 'EOF'],
          ]);
          const e = entities(text)[0] as Extract<FlatEntity, { kind: 'LINE' }>;
          const rot = (x: number, y: number): [number, number] => {
            const [px, py] = [x * sx, y * sy];
            return [[px, -py, -px, py][quarter]!, [py, px, -py, -px][quarter]!] as [number, number];
          };
          const [ex1, ey1] = rot(x1, y1);
          const [ex2, ey2] = rot(x2, y2);
          expect(e.x1 + 0).toBe(ex1 + 3 + 0);
          expect(e.y1 + 0).toBe(ey1 + 4 + 0);
          expect(e.x2 + 0).toBe(ex2 + 3 + 0);
          expect(e.y2 + 0).toBe(ey2 + 4 + 0);
        },
      ),
    );
  });
});
