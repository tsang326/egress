import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CELL_FREE, CELL_WALL } from '../../src/core/people/types';
import type { FlatEntity } from '../../src/core/plan/dxf/blocks';
import { rasterize } from '../../src/core/plan/grid/rasterize';
import type { GridSpec } from '../../src/core/plan/grid/rasterize';

const grid: GridSpec = { originXM: 0, originYM: 0, widthCells: 40, heightCells: 40 };
const map = { WALL: 'wall', WIN: 'window', FURN: 'furniture' } as const;
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
const run = (entities: FlatEntity[]) => rasterize({ floorId: 'f1', entities, layerMap: { ...map }, grid });
const wallCells = (r: ReturnType<typeof run>): string[] => {
  const out: string[] = [];
  r.cellType.forEach((v, i) => v === CELL_WALL && out.push(`${i % r.widthCells},${Math.floor(i / r.widthCells)}`));
  return out;
};

describe('rasterize', () => {
  it('a single line at a cell centre is one cell wide and covers its run', () => {
    const cells = wallCells(run([line(0, 1.125, 5, 1.125)]));
    expect(new Set(cells.map((c) => c.split(',')[1]))).toEqual(new Set(['4']));
    expect(cells.length).toBeGreaterThanOrEqual(20);
  });

  it('a single line on a cell boundary gives one cell row, whichever way it is drawn', () => {
    const a = wallCells(run([line(0, 1, 5, 1)]));
    const b = wallCells(run([line(5, 1, 0, 1)]));
    expect(a).toEqual(b);
    expect(new Set(a.map((c) => c.split(',')[1])).size).toBe(1);
  });

  it('a parallel pair takes its thickness from the drawing', () => {
    const r = run([line(0, 1, 5, 1), line(0, 1.5, 5, 1.5)]);
    expect(new Set(wallCells(r).map((c) => c.split(',')[1]))).toEqual(new Set(['4', '5']));
  });

  it('a closed rectangle outline fills exactly its cells', () => {
    const r = run([rect(1, 1, 1.5, 3)]);
    expect(wallCells(r).length).toBe(2 * 8);
  });

  it('window and furniture layers become wall cells and are listed separately', () => {
    const r = run([rect(1, 1, 2, 1.25, 'WIN'), rect(3, 3, 3.5, 3.5, 'FURN'), line(0, 0, 1, 1, 'OTHER')]);
    expect(r.windows).toHaveLength(1);
    expect(r.furniture).toHaveLength(1);
    expect(r.windows[0]?.cells.length).toBe(4);
    expect(r.furniture[0]?.cells.length).toBe(4);
    expect(wallCells(r).length).toBe(8);
  });

  it('is bit-identical on repeat and ignores geometry outside the grid', () => {
    const e = [line(-5, 2, 100, 2), rect(1, 1, 1.5, 3)];
    expect(run(e).cellType).toEqual(run(e).cellType);
    expect(run(e).cellType.length).toBe(1600);
  });

  it('returns an empty grid for an invalid grid spec instead of throwing', () => {
    const r = rasterize({ floorId: 'f', entities: [], layerMap: {}, grid: { ...grid, widthCells: 0 } });
    expect(r.cellType.length).toBe(0);
  });

  it('a wall run of any length and position leaves no gap along its length (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 60 }), (x0, len, y) => {
        const r = run([line(x0 * 0.0625, y * 0.0625 + 0.5, (x0 + len) * 0.0625 + 1, y * 0.0625 + 0.5)]);
        const rows = new Set<number>();
        const cols = new Set<number>();
        r.cellType.forEach((v, i) => {
          if (v !== CELL_WALL) return;
          rows.add(Math.floor(i / r.widthCells));
          cols.add(i % r.widthCells);
        });
        const sorted = [...cols].sort((a, b) => a - b);
        expect(rows.size).toBeGreaterThanOrEqual(1);
        expect(rows.size).toBeLessThanOrEqual(2);
        for (let k = 1; k < sorted.length; k++) expect((sorted[k] as number) - (sorted[k - 1] as number)).toBe(1);
        expect(r.cellType.some((v) => v === CELL_FREE)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
