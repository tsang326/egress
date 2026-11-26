// Compare table (run-view spec, Requirement 9.3): each value is the run's own number and the difference is B - A,
// computed from the two results, not from a re-run.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { diffRows } from '../../src/web/compare/diffTable';
import type { RunMetrics } from '../../src/web/results/metrics';

const time = fc.option(fc.double({ min: 0, max: 3600, noNaN: true }), { nil: null });
const metrics: fc.Arbitrary<RunMetrics> = fc.record({
  total: fc.integer({ min: 0, max: 1000 }),
  out: fc.integer({ min: 0, max: 1000 }),
  incapacitated: fc.integer({ min: 0, max: 1000 }),
  stillInside: fc.integer({ min: 0, max: 1000 }),
  evacuationTimeS: time,
  fireRoomLimitM: fc.constantFrom(5, 10),
  fireRoomSmokeLoggedS: time,
});

describe('compare difference table', () => {
  it('rows hold A, B and B - A (null when a side has no value)', () => {
    fc.assert(
      fc.property(metrics, metrics, (a, b) => {
        const rows = diffRows(a, b);
        expect(rows.map((r) => r.key)).toEqual(['out', 'incapacitated', 'evacuationTimeS', 'fireRoomSmokeLoggedS']);
        for (const r of rows) {
          expect(r.a).toBe(a[r.key]);
          expect(r.b).toBe(b[r.key]);
          if (r.a === null || r.b === null) expect(r.diff).toBeNull();
          else expect(r.diff).toBe(r.b - r.a);
        }
      }),
      { numRuns: 300 },
    );
  });
});
