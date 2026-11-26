// Position recording through runCrowd's onStep hook (run-view spec, Requirement 5.2).
import { describe, expect, it } from 'vitest';
import { runInThread } from '../../src/web/run/pipeline';
import { SHOW_OUT } from '../../src/web/run/trajectory';
import { agentsAt, stateCountsAt } from '../../src/web/results/runView';
import { sampleSetup } from './helpers';

describe('trajectory', () => {
  const { session, state } = sampleSetup('cafe', 120);
  const run = runInThread(session, state);

  it('records every agent every 0.5 s from t = 0', () => {
    const tr = run.trajectory;
    expect(tr.intervalS).toBe(0.5);
    expect(tr.n).toBe(run.built.crowd.agents.length);
    expect(new Set(tr.agentIds)).toEqual(new Set(run.built.crowd.agents.map((a) => a.id)));
    expect(tr.frames).toBeGreaterThan(10);
    expect(tr.x.length).toBe(tr.frames * tr.n);
    // Frame 0 is the start position of each agent.
    const byId = new Map(run.built.crowd.agents.map((a) => [a.id, a]));
    tr.agentIds.forEach((id, i) => {
      expect(tr.x[i]).toBeCloseTo(byId.get(id)!.xM, 3);
      expect(tr.y[i]).toBeCloseTo(byId.get(id)!.yM, 3);
    });
  });

  it('state counts at the end agree with the crowd summary', () => {
    const c = stateCountsAt(run, state.durationS);
    expect(c[SHOW_OUT] ?? 0).toBe(run.crowd.summary!.out);
    expect(agentsAt(run, 0, state.durationS).filter((a) => a.show !== SHOW_OUT).length).toBe(run.crowd.summary!.total - run.crowd.summary!.out);
  });
});
