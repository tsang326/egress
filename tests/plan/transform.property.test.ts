import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { flattenEntities } from '../../src/core/plan/dxf/blocks';
import { readDxf } from '../../src/core/plan/dxf/reader';
import { closeGaps } from '../../src/core/plan/grid/gaps';
import { rasterize } from '../../src/core/plan/grid/rasterize';
import type { GridSpec } from '../../src/core/plan/grid/rasterize';
import { convertToMeters, resolveDrawingUnit } from '../../src/core/plan/units';
import { writeDxf } from './helpers/dxfWriter';
import type { DxfBlock, DxfEntity, Pt } from './helpers/dxfWriter';

// Feature: plan-import, Property 3: INSERT transform equivalence
// **Validates: Requirements 1.5, 1.7, 20.3**

// ---- independent model of the INSERT transform (DXF reference): p' = at + R(rot) * S * (p - base) -------------------

interface Aff {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}
const ID: Aff = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const mul = (o: Aff, i: Aff): Aff => ({
  a: o.a * i.a + o.c * i.b,
  b: o.b * i.a + o.d * i.b,
  c: o.a * i.c + o.c * i.d,
  d: o.b * i.c + o.d * i.d,
  e: o.a * i.e + o.c * i.f + o.e,
  f: o.b * i.e + o.d * i.f + o.f,
});
const ROT: Record<number, [number, number]> = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };

interface InsertSpec {
  at: Pt;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
}
const insertAff = (s: InsertSpec, base: Pt): Aff => {
  const [cos, sin] = ROT[s.rotationDeg] as [number, number];
  const rs: Aff = { a: cos * s.scaleX, b: sin * s.scaleX, c: -sin * s.scaleY, d: cos * s.scaleY, e: 0, f: 0 };
  const local = mul(rs, { ...ID, e: -base[0], f: -base[1] });
  return mul({ ...ID, e: s.at[0], f: s.at[1] }, local);
};
const apply = (m: Aff, p: Pt): Pt => [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
const det = (m: Aff): number => m.a * m.d - m.b * m.c;

function transformEntity(e: DxfEntity, m: Aff, layer: string): DxfEntity {
  if (e.type === 'LINE') return { type: 'LINE', layer, a: apply(m, e.a), b: apply(m, e.b) };
  if (e.type === 'LWPOLYLINE') {
    const flip = det(m) < 0 ? -1 : 1; // mirroring reverses the turning direction of a bulge
    return {
      type: 'LWPOLYLINE',
      layer,
      closed: e.closed ?? false,
      vertices: e.vertices.map((v) => {
        const p = apply(m, [v.xM, v.yM]);
        return { xM: p[0], yM: p[1], bulge: (v.bulge ?? 0) * flip };
      }),
    };
  }
  throw new Error('unsupported entity in test model');
}

// ---- generators ---------------------------------------------------------------------------------------------------

const STEP = 0.125; // exactly representable, so every transform below is exact in floating point
const coord = fc.integer({ min: 0, max: 16 }).map((n) => n * STEP); // 0 .. 2 m
const pt: fc.Arbitrary<Pt> = fc.tuple(coord, coord);

const WALL = 'WALL';
const wallLayer = fc.constantFrom(WALL, '0', 'OTHER');

const lineEnt: fc.Arbitrary<DxfEntity> = fc
  .tuple(wallLayer, pt, pt)
  .map(([layer, a, b]) => ({ type: 'LINE', layer, a, b }) as DxfEntity);
const rectEnt: fc.Arbitrary<DxfEntity> = fc
  .tuple(wallLayer, coord, coord, fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }))
  .map(
    ([layer, x, y, w, h]): DxfEntity => ({
      type: 'LWPOLYLINE',
      layer,
      closed: true,
      vertices: [
        { xM: x, yM: y },
        { xM: x + w * STEP, yM: y },
        { xM: x + w * STEP, yM: y + h * STEP },
        { xM: x, yM: y + h * STEP },
      ],
    }),
  );
const bulgeEnt: fc.Arbitrary<DxfEntity> = fc
  .tuple(wallLayer, pt, fc.integer({ min: 2, max: 8 }), fc.constantFrom(-1, 1))
  .map(([layer, p, len, bulge]): DxfEntity => ({
    type: 'LWPOLYLINE',
    layer,
    vertices: [
      { xM: p[0], yM: p[1], bulge },
      { xM: p[0] + len * STEP, yM: p[1] },
    ],
  }));
// Two collinear pieces of one wall with a 0.0625 m break (below GAP_TOLERANCE_M), so gap closing is exercised.
const gappedEnt: fc.Arbitrary<DxfEntity[]> = fc.tuple(pt, fc.integer({ min: 4, max: 8 }), fc.boolean()).map(([p, len, vertical]) => {
  const at = (t: number): Pt => (vertical ? [p[0], p[1] + t] : [p[0] + t, p[1]]);
  const l = len * STEP;
  return [
    { type: 'LINE', layer: WALL, a: at(0), b: at(l) },
    { type: 'LINE', layer: WALL, a: at(l + 0.0625), b: at(2 * l + 0.0625) },
  ];
});
const geometry: fc.Arbitrary<DxfEntity[]> = fc
  .tuple(fc.array(fc.oneof(lineEnt, rectEnt, bulgeEnt), { minLength: 0, maxLength: 4 }), fc.option(gappedEnt, { nil: undefined }))
  .map(([list, gap]) => [...list, ...(gap ?? [])]);

const insertSpec: fc.Arbitrary<InsertSpec> = fc.record({
  at: fc.tuple(fc.integer({ min: -16, max: 16 }), fc.integer({ min: -16, max: 16 })).map(([x, y]): Pt => [x * STEP, y * STEP]),
  scaleX: fc.constantFrom(1, -1, 2, -2),
  scaleY: fc.constantFrom(1, -1, 2, -2),
  rotationDeg: fc.constantFrom(0, 90, 180, 270),
});
// Uniform (equal magnitude) or mirrored (any sign): both axes share one magnitude, as drawings use (Req 1.5, 1.7).
const uniformOrMirrored = insertSpec.map((s) => ({ ...s, scaleY: Math.sign(s.scaleY) * Math.abs(s.scaleX) }));

interface Scenario {
  direct: DxfEntity[];
  viaInsert: { entities: DxfEntity[]; blocks: DxfBlock[] };
}

const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    top: geometry,
    outerGeom: geometry,
    innerGeom: geometry,
    outer: uniformOrMirrored,
    inner: uniformOrMirrored,
    outerBase: pt,
    innerBase: pt,
    nested: fc.boolean(),
    second: fc.option(uniformOrMirrored, { nil: undefined }),
  })
  .map(({ top, outerGeom, innerGeom, outer, inner, outerBase, innerBase, nested, second }) => {
    const insertLayer = WALL;
    const effective = (layer: string): string => (layer === '0' ? insertLayer : layer);
    const direct: DxfEntity[] = [...top];
    const blocks: DxfBlock[] = [];
    const outerEntities: DxfEntity[] = [...outerGeom];
    const innerBlock: DxfBlock = { name: 'Inner', base: innerBase, entities: innerGeom };
    const outerBlock: DxfBlock = { name: 'Outer', base: outerBase, entities: outerEntities };
    const entities: DxfEntity[] = [...top];

    const placements: InsertSpec[] = [outer, ...(second === undefined ? [] : [second])];
    if (nested) outerEntities.push({ type: 'INSERT', layer: insertLayer, block: 'Inner', at: inner.at, scaleX: inner.scaleX, scaleY: inner.scaleY, rotationDeg: inner.rotationDeg });
    blocks.push(outerBlock, innerBlock);
    for (const p of placements) {
      entities.push({ type: 'INSERT', layer: insertLayer, block: 'Outer', at: p.at, scaleX: p.scaleX, scaleY: p.scaleY, rotationDeg: p.rotationDeg });
      const mo = insertAff(p, outerBase);
      for (const e of outerGeom) direct.push(transformEntity(e, mo, effective(e.layer)));
      if (nested) {
        const mi = mul(mo, insertAff(inner, innerBase));
        for (const e of innerGeom) direct.push(transformEntity(e, mi, effective(e.layer)));
      }
    }
    return { direct, viaInsert: { entities, blocks } };
  });

// ---- pipeline under test ------------------------------------------------------------------------------------------

const GRID: GridSpec = { originXM: -20, originYM: -20, widthCells: 160, heightCells: 160 }; // origin is a multiple of 0.25 m
const LAYER_MAP = { [WALL]: 'wall' } as const;

function importCells(entities: DxfEntity[], blocks: DxfBlock[]): { cells: Uint8Array; gaps: number } {
  const text = writeDxf({ entities, blocks, unit: 'm' });
  const read = readDxf(text, 'p3.dxf');
  if (read.status !== 'ok') throw new Error('generated DXF was rejected');
  const unit = resolveDrawingUnit('p3.dxf', read.document.header);
  if (unit.status !== 'resolved') throw new Error('unit not resolved');
  const flat = flattenEntities(read.document.drawing, { fileName: 'p3.dxf', metersPerUnit: unit.metersPerUnit });
  if (!flat.ok) throw new Error('flatten failed');
  const entitiesM = convertToMeters(flat.entities, unit.metersPerUnit);
  const layerMap = { ...LAYER_MAP };
  const raster = rasterize({ floorId: 'f1', entities: entitiesM, layerMap, grid: GRID });
  const closed = closeGaps({ floorId: 'f1', entities: entitiesM, layerMap, grid: GRID, cellType: raster.cellType });
  return { cells: closed.cellType, gaps: closed.gaps.length };
}

describe('Property 3: INSERT transform equivalence', () => {
  it('an INSERT (rotation by 90 degrees, uniform or mirrored scale, nested) gives the same cells as the transformed geometry drawn directly', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const viaInsert = importCells(s.viaInsert.entities, s.viaInsert.blocks);
        const direct = importCells(s.direct, []);
        expect(Array.from(viaInsert.cells)).toEqual(Array.from(direct.cells));
        expect(viaInsert.gaps).toBe(direct.gaps);
      }),
      { numRuns: 100 },
    );
  });

  it('a mirrored, rotated door-like block lands where the direct drawing puts it (example)', () => {
    const block: DxfBlock = { name: 'L', entities: [{ type: 'LINE', layer: WALL, a: [0, 0], b: [1, 0] }] };
    const ins: DxfEntity = { type: 'INSERT', layer: WALL, block: 'L', at: [2, 3], scaleX: -1, scaleY: 1, rotationDeg: 90 };
    const direct: DxfEntity = { type: 'LINE', layer: WALL, a: [2, 3], b: [2, 2] };
    const a = importCells([ins], [block]);
    const b = importCells([direct], []);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(a.cells.some((v) => v !== 0)).toBe(true);
  });
});
