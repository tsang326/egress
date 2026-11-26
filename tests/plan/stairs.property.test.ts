import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE_M } from '../../src/core/people/constants';
import { CELL_FREE, CELL_STAIR } from '../../src/core/people/types';
import { resolveStairs, type StairFloorGrid } from '../../src/core/plan/model/stairs';

// Feature: plan-import, Property 11: Stair overlap tolerance decides link creation
// **Validates: Requirements 11.3, 11.4, 11.5**

const W = 8;
const H = 8;
const N = W * H;

const grid = (floorId: string): StairFloorGrid => ({
  floorId,
  widthCells: W,
  heightCells: H,
  cellType: new Uint8Array(N).fill(CELL_FREE),
});

// A non-empty set of cells; a mix of random scatter and rectangles so that overlaps near 50% are common.
const rect = fc
  .tuple(fc.integer({ min: 0, max: W - 1 }), fc.integer({ min: 0, max: H - 1 }), fc.integer({ min: 1, max: W }), fc.integer({ min: 1, max: H }))
  .map(([x, y, w, h]) => {
    const cells: number[] = [];
    for (let j = y; j < Math.min(H, y + h); j++) for (let i = x; i < Math.min(W, x + w); i++) cells.push(j * W + i);
    return cells;
  });
const scatter = fc.uniqueArray(fc.integer({ min: 0, max: N - 1 }), { minLength: 1, maxLength: 20 });
const region = fc.oneof(rect, scatter);

// Two regions that overlap by a chosen count against a fixed smaller region, to hit the threshold from both sides.
const nearThreshold = fc
  .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 0, max: 12 }))
  .map(([smaller, over]) => {
    const overlap = Math.min(over, smaller);
    const lower = Array.from({ length: smaller }, (_, i) => i);
    const upper = [...lower.slice(0, overlap), ...Array.from({ length: 6 }, (_, i) => 32 + i)];
    return [lower, upper] as const;
  });

const pair = fc.oneof(fc.tuple(region, region), nearThreshold);

const boxShorterSideM = (cells: readonly number[]): number => {
  const xs = cells.map((c) => c % W);
  const ys = cells.map((c) => Math.floor(c / W));
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const h = Math.max(...ys) - Math.min(...ys) + 1;
  return Math.min(w, h) * CELL_SIZE_M;
};

describe('Property 11: Stair overlap tolerance decides link creation', () => {
  it('creates a link iff the overlap is at least 50% of the smaller region; footprint is the intersection, width its box side', () => {
    fc.assert(
      fc.property(pair, ([lowerCells, upperCells]) => {
        const lower = new Set(lowerCells);
        const upper = new Set(upperCells);
        const inter = [...lower].filter((c) => upper.has(c)).sort((a, b) => a - b);
        const smaller = Math.min(lower.size, upper.size);
        const expectLink = inter.length > 0 && 2 * inter.length >= smaller;

        const res = resolveStairs({
          floors: [grid('f0'), grid('f1')],
          regions: [
            { floorId: 'f0', cells: Int32Array.from(lower) },
            { floorId: 'f1', cells: Int32Array.from(upper) },
          ],
        });

        expect(res.links.length).toBe(expectLink ? 1 : 0);
        if (expectLink) {
          const link = res.links[0]!;
          expect([...link.footprint].sort((a, b) => a - b)).toEqual(inter);
          expect(link.widthM).toBeCloseTo(boxShorterSideM(inter), 12);
          expect(link.lowerFloorId).toBe('f0');
          expect(link.upperFloorId).toBe('f1');
          // Both floors end with exactly the footprint as stair cells.
          for (const f of res.floors) {
            const stair = [...f.cellType].flatMap((t, i) => (t === CELL_STAIR ? [i] : []));
            expect(stair).toEqual(inter);
          }
        } else {
          // No link: the failure is reported (Req 11.4), naming both floors.
          expect(res.warnings.length).toBeGreaterThan(0);
          const text = JSON.stringify(res.warnings);
          expect(text).toContain('f0');
          expect(text).toContain('f1');
        }
      }),
      { numRuns: 300 },
    );
  });
});
