// Worker-side logic of the crowd run for the app, separate from the `self` wiring so Node tests call it directly
// (run-view spec, Requirement 4.1). It wraps the crowd model's own handler contract (people/worker/handler.ts) and adds
// the position recording the results plan needs (trajectory.ts).
import { runCrowd } from '../../core/people/index';
import type { ProgressEvent, Result } from '../../core/fire/types';
import type { CrowdInput, CrowdResult } from '../../core/people/types';
import { createRecorder, type Trajectory } from './trajectory';

export interface CrowdRunRequest {
  input: CrowdInput;
  fire: Result;
}
export type ToCrowdWorker = { type: 'run'; id: number; request: CrowdRunRequest };
export type FromCrowdWorker =
  | { type: 'progress'; id: number; event: ProgressEvent }
  | { type: 'result'; id: number; result: CrowdResult; trajectory: Trajectory }
  | { type: 'error'; id: number; message: string };

export type CrowdPost = (m: FromCrowdWorker, transfer: ArrayBuffer[]) => void;

/** Runs one request and posts progress, then the result with the trajectory (its buffers transferred). */
export function handleCrowdMessage(msg: ToCrowdWorker, post: CrowdPost): void {
  const { id, request } = msg;
  try {
    const rec = createRecorder(request.input.agents.map((a) => a.id), request.input.durationS);
    const result = runCrowd(request.input, request.fire, { onProgress: (event) => post({ type: 'progress', id, event }, []), onStep: rec.onStep });
    const trajectory = rec.finish();
    post({ type: 'result', id, result, trajectory }, [trajectory.x.buffer, trajectory.y.buffer, trajectory.floor.buffer, trajectory.show.buffer] as ArrayBuffer[]);
  } catch (e) {
    post({ type: 'error', id, message: e instanceof Error ? e.message : String(e) }, []);
  }
}
