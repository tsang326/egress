// Tests for the test helpers floorFromAscii and syntheticFire (task 2.3).
import { describe, expect, it } from 'vitest';
import { floorFromAscii } from '../../src/core/people/plan/ascii';
import { syntheticFire } from './syntheticFire';

describe('floorFromAscii', () => {
  it('maps characters to cell types and compartments', () => {
    const f = floorFromAscii(['#DE', 'S.a'], { a: 'A', D: 'H' }, { id: 'G', elevationM: 2 });
    expect(f).toMatchObject({ id: 'G', elevationM: 2, widthCells: 3, heightCells: 2 });
    expect(Array.from(f.cells)).toEqual(['wall', 'door', 'exit', 'stair', 'free', 'free']);
    expect(Array.from(f.compartmentIds)).toEqual([null, 'H', null, null, null, 'A']);
  });
  it('throws on ragged rows or unknown characters (programmer error)', () => {
    expect(() => floorFromAscii(['##', '#'])).toThrow();
    expect(() => floorFromAscii(['#x'])).toThrow();
  });
});

describe('syntheticFire', () => {
  it('builds an ok Result with linear layer states and Infinity visibility without smoke', () => {
    const r = syntheticFire({
      durationS: 10,
      compartments: [{ id: 'A', start: { upperTempK: 300 }, end: { upperTempK: 400, upper: { o2: 0.2, co2: 0.01, co: 0.001, opticalDensityPerM: 1 } } }, { id: 'B' }],
    });
    expect(r.status).toBe('ok');
    expect(Array.from(r.timesS)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const a = r.compartments[0]!;
    expect(a.upperTempK[0]).toBe(300);
    expect(a.upperTempK[5]).toBeCloseTo(350, 12);
    expect(a.upperTempK[10]).toBe(400);
    expect(a.upper.visibilityM[0]).toBe(Infinity);
    expect(a.upper.visibilityM[10]).toBeCloseTo(3 / Math.LN10, 12);
    const b = r.compartments[1]!;
    expect(b.lowerTempK.every((t) => t === 293.15)).toBe(true);
    expect(b.upper.visibilityM.every((v) => v === Infinity)).toBe(true);
  });
});
