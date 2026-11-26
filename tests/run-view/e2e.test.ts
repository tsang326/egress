// @vitest-environment happy-dom
// Each sample from setup to results, 60 s runs (run-view spec, Requirements 8 and 9.5): the plan builds without warnings,
// both models finish, nobody is unreachable, and the results screen renders.
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../../src/core/people/plan/builder';
import { SAMPLE_INFO, type SampleId } from '../../src/web/home/sampleConfigs';
import { createResultsScreen } from '../../src/web/results/resultsScreen';
import { runInThread } from '../../src/web/run/pipeline';
import { sampleSetup } from './helpers';

describe('samples end to end', () => {
  for (const id of SAMPLE_INFO.map((s) => s.id) as SampleId[]) {
    it(`${id}: plan without warnings, a 60 s run, results on screen`, () => {
      const { session, state } = sampleSetup(id, 60);
      expect(buildPlan(session.planInput).warnings).toEqual([]);
      const run = runInThread(session, state);
      expect(run.fire.status).toBe('ok');
      expect(run.crowd.status).toBe('ok');
      const codes = run.crowd.warnings.map((w) => w.code);
      expect(codes).not.toContain('UNREACHABLE');
      expect(codes).not.toContain('ENTRY_EXIT_ESTIMATED');
      // People start at least NEAR_FIRE_M from the fire; walking past it later is a real event and stays reported.
      for (const w of run.crowd.warnings.filter((x) => x.code === 'NEAR_FIRE')) expect(w.timeS).toBeGreaterThan(0);
      expect(run.crowd.agents.length).toBeGreaterThan(0);
      const box = document.createElement('div');
      createResultsScreen(box, { run, onBack: () => undefined, onHome: () => undefined, onCompare: () => undefined, raf: () => 0, caf: () => undefined });
      expect(box.querySelector('[data-testid="summary"]')).not.toBeNull();
    }, 60_000);
  }
});
