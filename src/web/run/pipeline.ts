// One run, both models, in the calling thread (tests, and the reference for what the workers do).
import { runFire } from '../../core/fire';
import type { Result } from '../../core/fire/types';
import { runCrowd } from '../../core/people/index';
import type { CrowdResult } from '../../core/people/types';
import type { PlanSession } from '../home/sampleConfigs';
import { buildRun, type BuiltRun, type SetupState } from '../setup/scenarioBuilder';
import { createRecorder, type Trajectory } from './trajectory';

export interface RunResult {
  session: PlanSession; // the plan as run (after door and window edits)
  config: SetupState;
  built: BuiltRun;
  fire: Result;
  crowd: CrowdResult;
  trajectory: Trajectory;
}

export function runInThread(session: PlanSession, config: SetupState): RunResult {
  const built = buildRun(session, config);
  const fire = runFire(built.scenario);
  const input = { ...built.crowd, plan: built.plan };
  const rec = createRecorder(input.agents.map((a) => a.id), input.durationS);
  const crowd = runCrowd(input, fire, { onStep: rec.onStep });
  return { session, config, built, fire, crowd, trajectory: rec.finish() };
}
