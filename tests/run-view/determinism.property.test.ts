// Same setup, same results (run-view spec, Requirement 4.6): the setup -> inputs step is pure and both models are
// deterministic, so two runs agree bit for bit, trajectory included.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FIRE_LIBRARY } from '../../src/core/fire/library';
import { runInThread } from '../../src/web/run/pipeline';
import { buildRun } from '../../src/web/setup/scenarioBuilder';
import { sampleSetup } from './helpers';

describe('determinism', () => {
  it('buildRun is pure for any fire item, alarm time and seed', () => {
    const { session, state } = sampleSetup('karaoke');
    fc.assert(
      fc.property(fc.constantFrom(...FIRE_LIBRARY), fc.integer({ min: 0, max: 300 }), fc.integer({ min: 1, max: 1e6 }), (item, alarm, seed) => {
        const s = { ...state, fireChoice: item, alarmTimeS: alarm, seed };
        expect(buildRun(session, s)).toEqual(buildRun(session, s));
      }),
      { numRuns: 25 },
    );
  });

  it('two full runs of the same setup give identical results', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 1, max: 1000 }), (alarm, seed) => {
        const { session, state } = sampleSetup('cafe', 30);
        const s = { ...state, alarmTimeS: alarm, seed };
        const a = runInThread(session, s);
        const b = runInThread(session, s);
        expect(b.crowd).toEqual(a.crowd);
        expect(Array.from(b.fire.compartments[0]!.upperTempK)).toEqual(Array.from(a.fire.compartments[0]!.upperTempK));
        expect(Array.from(b.trajectory.x)).toEqual(Array.from(a.trajectory.x));
        expect(Array.from(b.trajectory.show)).toEqual(Array.from(a.trajectory.show));
      }),
      { numRuns: 3 },
    );
  }, 120_000);
});
