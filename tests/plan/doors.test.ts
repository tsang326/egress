import { describe, expect, it } from 'vitest';
import { CELL_DOOR, CELL_FREE, CELL_WALL } from '../../src/core/people/types';
import type { FlatEntity } from '../../src/core/plan/dxf/blocks';
import { placeDoors } from '../../src/core/plan/grid/doors';

// Grids are written as text, top line = highest row. '#' wall, '.' free. Cell size 0.25 m, origin (0, 0).
function parse(rows: string[]): { w: number; h: number; cellType: Uint8Array } {
  const h = rows.length;
  const w = (rows[0] as string).length;
  const cellType = new Uint8Array(w * h).fill(CELL_FREE);
  rows.forEach((row, i) => {
    const y = h - 1 - i;
    for (let x = 0; x < w; x++) if (row[x] === '#') cellType[y * w + x] = CELL_WALL;
  });
  return { w, h, cellType };
}

// A wall row `y` over `w` cells with a gap from x0 to x1 (inclusive), the rest free.
function wallWithGaps(w: number, h: number, walls: { y: number; gaps: [number, number][] }[]): Uint8Array {
  const cellType = new Uint8Array(w * h).fill(CELL_FREE);
  for (const { y, gaps } of walls) {
    for (let x = 0; x < w; x++) if (!gaps.some(([a, b]) => x >= a && x <= b)) cellType[y * w + x] = CELL_WALL;
  }
  return cellType;
}

function run(w: number, h: number, cellType: Uint8Array, entities: FlatEntity[] = [], floorId = 'f1') {
  return placeDoors({ floorId, widthCells: w, heightCells: h, originXM: 0, originYM: 0, cellType, entities });
}

const insertOrigin = { id: 0, blockName: 'DOOR', layer: 'DOOR' };
const blockLine = (x1: number, x2: number, y: number): FlatEntity => ({ kind: 'LINE', layer: 'DOOR', x1, y1: y, x2, y2: y, insert: insertOrigin });
const codes = (r: ReturnType<typeof run>): string[] => r.warnings.map((x) => x.code);

describe('placeDoors', () => {
  it('plain gap: a wall gap of 3 cells becomes one door of 0.75 m (Req 7.3, 7.4)', () => {
    const w = 20;
    const h = 12;
    const r = run(w, h, wallWithGaps(w, h, [{ y: 5, gaps: [[8, 10]] }]));
    expect(r.doors).toHaveLength(1);
    const d = r.doors[0]!;
    expect(d.source).toBe('gap');
    expect(d.across).toBe(3);
    expect(d.widthM).toBe(0.75);
    expect(d.direction).toBe('x');
    expect(Array.from(d.cells)).toEqual([5 * w + 8, 5 * w + 9, 5 * w + 10]);
    for (const i of d.cells) expect(r.cellType[i]).toBe(CELL_DOOR);
    expect(r.warnings).toEqual([]);
  });

  it('does not modify the input grid', () => {
    const w = 20;
    const h = 12;
    const input = wallWithGaps(w, h, [{ y: 5, gaps: [[8, 10]] }]);
    const copy = input.slice();
    run(w, h, input);
    expect(input).toEqual(copy);
  });

  it('vertical gap in a vertical wall is found with direction y', () => {
    const { w, h, cellType } = parse([
      '.....#.....',
      '.....#.....',
      '...........',
      '...........',
      '.....#.....',
      '.....#.....',
    ]);
    // The wall column 5 has a gap on rows 2 and 3 (two cells, 0.5 m).
    const r = run(w, h, cellType);
    expect(r.doors).toHaveLength(1);
    expect(r.doors[0]!.direction).toBe('y');
    expect(r.doors[0]!.widthM).toBe(0.5);
    expect(r.warnings).toEqual([]);
  });

  it('block door over a gap takes source block (Req 7.1)', () => {
    const w = 20;
    const h = 12;
    // Gap cells 8..10 span x = 2.0..2.75 m at y = 1.375 m.
    const r = run(w, h, wallWithGaps(w, h, [{ y: 5, gaps: [[8, 10]] }]), [blockLine(2, 2.75, 1.375)]);
    expect(r.doors).toHaveLength(1);
    expect(r.doors[0]!.source).toBe('block');
    expect(r.doors[0]!.widthM).toBe(0.75);
  });

  it('block door drawn over a continuous wall is cut into it, width from the block extent (Req 7.1)', () => {
    const w = 20;
    const h = 12;
    const r = run(w, h, wallWithGaps(w, h, [{ y: 5, gaps: [] }]), [blockLine(2, 2.75, 1.375)]);
    expect(r.doors).toHaveLength(1);
    const d = r.doors[0]!;
    expect(d.source).toBe('block');
    expect(d.widthM).toBe(0.75);
    expect(Array.from(d.cells)).toEqual([5 * w + 8, 5 * w + 9, 5 * w + 10]);
    expect(r.cellType[5 * w + 7]).toBe(CELL_WALL);
    expect(r.cellType[5 * w + 11]).toBe(CELL_WALL);
  });

  it('swing arc over a continuous wall: width from the arc radius, clamped to the grid (Req 7.2)', () => {
    const w = 20;
    const h = 12;
    const arc: FlatEntity = { kind: 'ARC', layer: 'DOOR', cx: 2, cy: 1.375, r: 0.75, startRad: 0, sweepRad: Math.PI / 2 };
    const r = run(w, h, wallWithGaps(w, h, [{ y: 5, gaps: [] }]), [arc]);
    expect(r.doors).toHaveLength(1);
    expect(r.doors[0]!.source).toBe('arc');
    expect(r.doors[0]!.widthM).toBe(0.75);

    // Hinge at the grid edge: the arc extends past x = 0, the door is clamped to the grid.
    const edge: FlatEntity = { kind: 'ARC', layer: 'DOOR', cx: 0.5, cy: 1.375, r: 1, startRad: Math.PI / 2, sweepRad: Math.PI / 2 };
    const c = run(w, h, wallWithGaps(w, h, [{ y: 5, gaps: [] }]), [edge]);
    expect(c.doors).toHaveLength(1);
    const cells = Array.from(c.doors[0]!.cells);
    expect(Math.min(...cells) % w).toBeGreaterThanOrEqual(0);
    expect(c.doors[0]!.widthM).toBeLessThanOrEqual(1);
  });

  it('swing arc and CIRCLE over a gap give source arc (Req 7.2)', () => {
    const w = 20;
    const h = 12;
    const gap = wallWithGaps(w, h, [{ y: 5, gaps: [[8, 10]] }]);
    const arc: FlatEntity = { kind: 'ARC', layer: 'DOOR', cx: 2, cy: 1.375, r: 0.75, startRad: 0, sweepRad: Math.PI / 2 };
    const circle: FlatEntity = { kind: 'CIRCLE', layer: 'DOOR', cx: 2.375, cy: 1.375, r: 0.375 };
    expect(run(w, h, gap, [arc]).doors.map((d) => d.source)).toEqual(['arc']);
    expect(run(w, h, gap, [circle]).doors.map((d) => d.source)).toEqual(['arc']);
  });

  it('widths are whole multiples of 0.25 m', () => {
    const w = 40;
    const h = 12;
    const r = run(w, h, wallWithGaps(w, h, [{ y: 3, gaps: [[3, 5]] }, { y: 8, gaps: [[10, 16]] }]));
    expect(r.doors.map((d) => d.widthM)).toEqual([0.75, 1.75]);
    for (const d of r.doors) expect(d.widthM / 0.25).toBe(d.across);
  });

  it('keeps a door under 0.5 m or over 3.0 m with one DOOR_WIDTH_RANGE warning each (Req 7.5)', () => {
    const w = 40;
    const h = 12;
    const narrow = run(w, h, wallWithGaps(w, h, [{ y: 5, gaps: [[8, 8]] }]));
    expect(narrow.doors).toHaveLength(1);
    expect(narrow.doors[0]!.widthM).toBe(0.25);
    expect(codes(narrow)).toEqual(['DOOR_WIDTH_RANGE']);
    expect(narrow.warnings[0]!.message).toContain(narrow.doors[0]!.id);
    expect(narrow.warnings[0]!.message).toContain('0.25');

    const wide = run(w, h, wallWithGaps(w, h, [{ y: 5, gaps: [[8, 20]] }]));
    expect(wide.doors).toHaveLength(1);
    expect(wide.doors[0]!.widthM).toBe(3.25);
    expect(codes(wide)).toEqual(['DOOR_WIDTH_RANGE']);
  });

  it('widths exactly 0.5 m and 3.0 m raise no warning', () => {
    const w = 40;
    const h = 12;
    const r = run(w, h, wallWithGaps(w, h, [{ y: 3, gaps: [[3, 4]] }, { y: 8, gaps: [[5, 16]] }]));
    expect(r.doors.map((d) => d.widthM)).toEqual([0.5, 3]);
    expect(r.warnings).toEqual([]);
  });

  it('discards a gap with a wall on one side and warns with the cell (Req 7.6)', () => {
    // Niche: gap in the upper wall row, backed by a solid wall row.
    const { w, h, cellType } = parse([
      '............',
      '............',
      '............',
      '............',
      '............',
      '####....####',
      '############',
      '............',
    ]);
    const r = run(w, h, cellType);
    expect(r.doors).toHaveLength(0);
    expect(codes(r)).toEqual(['DOOR_DISCARDED']);
    expect(r.cellType).toEqual(cellType);
  });

  it('discards a door drawing that lies over no wall (Req 7.6)', () => {
    const w = 20;
    const h = 12;
    const empty = new Uint8Array(w * h).fill(CELL_FREE);
    const r = run(w, h, empty, [blockLine(2, 2.75, 1.375)]);
    expect(r.doors).toHaveLength(0);
    expect(codes(r)).toEqual(['DOOR_DISCARDED']);
  });

  it('ids are `${floorId}:door${k}` in row-major order of the first cell, whatever the entity order (Req 7.7)', () => {
    const w = 20;
    const h = 12;
    const cellType = wallWithGaps(w, h, [{ y: 8, gaps: [[4, 6]] }, { y: 3, gaps: [[12, 14]] }]);
    const r = run(w, h, cellType, [], 'ground');
    expect(r.doors.map((d) => d.id)).toEqual(['ground:door1', 'ground:door2']);
    expect(r.doors[0]!.cells[0]).toBe(3 * w + 12);
    expect(r.doors[1]!.cells[0]).toBe(8 * w + 4);
    expect(r.doors.every((d) => d.floorId === 'ground')).toBe(true);
    expect(run(w, h, cellType, [], 'ground')).toEqual(r);
  });

  it('bad input returns an empty result instead of throwing', () => {
    const r = placeDoors({ floorId: 'f', widthCells: 0, heightCells: 3, originXM: 0, originYM: 0, cellType: new Uint8Array(0), entities: [] });
    expect(r.doors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});
