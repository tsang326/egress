import { describe, expect, it } from 'vitest';
import { CELL_FREE, CELL_WALL } from '../../src/core/people/types';
import type { FlatEntity } from '../../src/core/plan/dxf/blocks';
import { buildFloorSources } from '../../src/core/plan/floorSources';
import type { FloorSourceFile } from '../../src/core/plan/floorSources';
import { closeGaps } from '../../src/core/plan/grid/gaps';
import { rasterize } from '../../src/core/plan/grid/rasterize';
import type { GridSpec } from '../../src/core/plan/grid/rasterize';
import type { LayerMap } from '../../src/core/plan/types';

const line = (x1: number, y1: number, x2: number, y2: number, layer = 'WALL'): FlatEntity => ({ kind: 'LINE', layer, x1, y1, x2, y2 });
const rect = (x0: number, y0: number, x1: number, y1: number, layer = 'WALL'): FlatEntity => ({
  kind: 'POLYLINE',
  layer,
  closed: true,
  vertices: [
    { x: x0, y: y0, bulge: 0 },
    { x: x1, y: y0, bulge: 0 },
    { x: x1, y: y1, bulge: 0 },
    { x: x0, y: y1, bulge: 0 },
  ],
});

const layerMap: LayerMap = { WALL: 'wall' };
const grid: GridSpec = { originXM: 0, originYM: 0, widthCells: 40, heightCells: 40 };
const raster = (entities: FlatEntity[]) => rasterize({ floorId: 'f1', entities, layerMap, grid });
const rowsOf = (cellType: Uint8Array): Set<number> => {
  const rows = new Set<number>();
  cellType.forEach((v, i) => v === CELL_WALL && rows.add(Math.floor(i / grid.widthCells)));
  return rows;
};
const isWall = (cellType: Uint8Array, x: number, y: number): boolean => cellType[y * grid.widthCells + x] === CELL_WALL;

describe('rasterize thickness (Req 6.1, 6.2, 6.3)', () => {
  it('a single line covers at least one cell width', () => {
    expect(rowsOf(raster([line(0, 1.125, 5, 1.125)]).cellType)).toEqual(new Set([4]));
  });

  it('a parallel pair takes its thickness from the drawing', () => {
    expect(rowsOf(raster([line(0, 1, 5, 1), line(0, 1.5, 5, 1.5)]).cellType)).toEqual(new Set([4, 5]));
  });

  it('a closed outline fills the cells it encloses', () => {
    const r = raster([rect(1, 1, 3, 1.5)]);
    expect(rowsOf(r.cellType)).toEqual(new Set([4, 5]));
  });
});

describe('closeGaps (Req 6.4, 6.5)', () => {
  // Rectangle walls have no end caps, so the gap between them is the drawn gap. Cell 12 (x 3.0 to 3.25) has its
  // centre between the two ends in both cases.
  const walls = (gapStart: number, gapEnd: number) => [rect(1, 1, gapStart, 1.25), rect(gapEnd, 1, 5, 1.25)];
  const run = (entities: FlatEntity[]) => {
    const r = raster(entities);
    return { before: r.cellType, ...closeGaps({ floorId: 'f1', entities, layerMap, grid, cellType: r.cellType }) };
  };

  it('closes a gap below 0.10 m and warns once with floor and cell position', () => {
    const r = run(walls(3.075, 3.15));
    expect(isWall(r.before, 12, 4)).toBe(false);
    expect(isWall(r.cellType, 12, 4)).toBe(true);
    // A rectangle wall has more than one edge facing the break, so the break can give more than one warning
    // (design.md, task 6.3); each names the floor and a cell next to the break.
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
    expect(r.warnings.every((w) => w.code === 'GAP_CLOSED' && w.location?.kind === 'cell' && w.location.floorId === 'f1')).toBe(true);
    expect(r.warnings.length).toBe(r.gaps.length);
  });

  it('keeps a gap of 0.10 m or more, without a warning', () => {
    const r = run(walls(3.0625, 3.1875)); // 0.125 m
    expect(isWall(r.cellType, 12, 4)).toBe(false);
    expect(r.warnings).toHaveLength(0);
    expect(r.gaps).toHaveLength(0);
  });

  it('does not change the input grid', () => {
    const e = walls(3.075, 3.15);
    const r0 = raster(e).cellType;
    const copy = new Uint8Array(r0);
    closeGaps({ floorId: 'f1', entities: e, layerMap, grid, cellType: r0 });
    expect(r0).toEqual(copy);
  });
});

describe('buildFloorSources (Req 4.3, 4.4, 4.5, 4.7, 6.7, 3.7)', () => {
  const fileMap = (name: string): Record<string, LayerMap> => ({ [name]: { WALL: 'wall' } });
  const file = (fileName: string, entitiesM: FlatEntity[]): FloorSourceFile => ({ fileName, entitiesM });

  it('rounds the common origin down to a multiple of the cell size', () => {
    const r = buildFloorSources([file('a.dxf', [line(1.3, 2.6, 6.3, 2.6)])], undefined, { layerMaps: fileMap('a.dxf') });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.originXM).toBe(1.25);
    expect(r.originYM).toBe(2.5);
    expect(r.widthCells).toBe(Math.ceil((6.3 - 1.25) / 0.25));
  });

  it('takes the origin from the union of all floors, with one grid size for every floor', () => {
    const maps = { ...fileMap('a.dxf'), ...fileMap('b.dxf') };
    const r = buildFloorSources([file('a.dxf', [line(2, 2, 4, 2)]), file('b.dxf', [line(0.6, 1, 9, 1)])], undefined, { layerMaps: maps });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.floors.map((f) => f.floorId)).toEqual(['floor1', 'floor2']);
    expect(r.originXM).toBe(0.5);
    expect(r.originYM).toBe(1);
    expect(r.widthCells).toBe(Math.ceil((9 - 0.5) / 0.25));
  });

  it('applies a manual offset in metres to one floor', () => {
    const r = buildFloorSources([file('a.dxf', [line(2, 2, 4, 2)])], undefined, {
      layerMaps: fileMap('a.dxf'),
      floorOffsetsM: { floor1: { xM: 1, yM: -0.5 } },
    });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.floors[0]?.extent).toMatchObject({ minX: 3, minY: 1.5, maxX: 5, maxY: 1.5 });
    expect(r.floors[0]?.translationM).toEqual({ xM: 1, yM: -0.5 });
  });

  it('moves block floors so their minimum corners coincide, and keeps layer-set floors in place', () => {
    const inBlock = (name: string, e: FlatEntity): FlatEntity => ({ ...e, insert: { id: name === 'F1' ? 1 : 2, blockName: name, layer: '0' } });
    const f = file('a.dxf', [inBlock('F1', line(0, 0, 4, 0)), inBlock('F2', line(20, 10, 24, 10)), line(50, 50, 52, 50, 'WALL2')]);
    const maps = { 'a.dxf': { WALL: 'wall', WALL2: 'wall' } as LayerMap };
    const blocks = buildFloorSources([f], [
      { floorId: 'f1', fileName: 'a.dxf', blockName: 'F1' },
      { floorId: 'f2', fileName: 'a.dxf', blockName: 'F2' },
    ], { layerMaps: maps });
    if (blocks.status !== 'ok') throw new Error('expected ok');
    expect(blocks.floors[1]?.extent).toMatchObject({ minX: 0, minY: 0 });
    const layers = buildFloorSources([f], [{ floorId: 'f3', fileName: 'a.dxf', layers: ['WALL2'] }], { layerMaps: maps });
    if (layers.status !== 'ok') throw new Error('expected ok');
    expect(layers.floors[0]?.extent).toMatchObject({ minX: 50, minY: 50 });
  });

  it('is invalid with FLOOR_NO_WALLS when a floor has no wall entity', () => {
    const r = buildFloorSources([file('a.dxf', [line(0, 0, 4, 0, 'OTHER')])], undefined, { layerMaps: fileMap('a.dxf') });
    expect(r.status).toBe('invalid');
    expect(r.warnings.some((w) => w.code === 'FLOOR_NO_WALLS')).toBe(true);
  });

  it('is invalid and names the limit and the drawing extent when the grid is too large', () => {
    const r = buildFloorSources([file('a.dxf', [line(0, 0, 300, 300)])], undefined, { layerMaps: fileMap('a.dxf') });
    expect(r.status).toBe('invalid');
    const w = r.warnings.find((x) => x.code === 'LIMIT_CELLS');
    expect(w?.message).toContain('1000000');
    expect(w?.message).toContain('300 m by 300 m');
  });
});

describe('determinism (Req 20.10)', () => {
  it('repeats bit-identically through rasterize and closeGaps', () => {
    const e = [rect(1, 1, 3.075, 1.25), rect(3.15, 1, 5, 1.25), line(0, 6, 7, 6.5)];
    const a = raster(e);
    const b = raster(e);
    expect(a.cellType).toEqual(b.cellType);
    const ga = closeGaps({ floorId: 'f1', entities: e, layerMap, grid, cellType: a.cellType });
    const gb = closeGaps({ floorId: 'f1', entities: e, layerMap, grid, cellType: b.cellType });
    expect(ga).toEqual(gb);
    expect(ga.cellType.some((v) => v === CELL_FREE)).toBe(true);
  });
});
