// Scrubber time -> sample index (run-view spec, Requirement 9.1) and playback advance.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sampleIndexAt } from '../../src/web/results/planRenderer';
import { advance } from '../../src/web/results/scrubber';

const times = fc
  .tuple(fc.integer({ min: 1, max: 400 }), fc.double({ min: 0.1, max: 10, noNaN: true }))
  .map(([n, dt]) => Float64Array.from({ length: n }, (_, i) => i * dt));

describe('scrubber', () => {
  it('the index for t lies in [0, n-1] with times[i] <= t < times[i+1], or i = n-1 at or after the last sample', () => {
    fc.assert(
      fc.property(times, fc.double({ min: 0, max: 1, noNaN: true }), (ts, u) => {
        const last = ts[ts.length - 1]!;
        const t = u * last;
        const i = sampleIndexAt(ts, t);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThanOrEqual(ts.length - 1);
        expect(ts[i]!).toBeLessThanOrEqual(t);
        if (i < ts.length - 1) expect(t).toBeLessThan(ts[i + 1]!);
        else expect(t).toBeGreaterThanOrEqual(last);
      }),
      { numRuns: 300 },
    );
  });

  it('times outside the run clamp to the first and last sample', () => {
    const ts = Float64Array.from([0, 2, 4, 6]);
    expect(sampleIndexAt(ts, -5)).toBe(0);
    expect(sampleIndexAt(ts, 99)).toBe(3);
    expect(sampleIndexAt(ts, 6)).toBe(3);
  });

  it('playback advances by real time x speed and stays inside the run', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 600, noNaN: true }), fc.double({ min: 0, max: 5000, noNaN: true }), fc.constantFrom(0.5, 1, 2, 5, 10), (t, ms, speed) => {
        const v = advance(t, ms, speed, 600);
        expect(v).toBeGreaterThanOrEqual(t);
        expect(v).toBeLessThanOrEqual(600);
        if (t + (ms * speed) / 1000 <= 600) expect(v).toBeCloseTo(t + (ms * speed) / 1000, 9);
      }),
      { numRuns: 300 },
    );
  });
});
