// All logic of the crowd Worker_Wrapper, with no Worker global (Design, "Worker wrapper"; Requirements 7.4, 7.5, 7.6).
// The browser glue (a later spec) only wires `self.onmessage` to `handleMessage`; Node tests call it directly.
// Progress comes from simulated time inside runCrowd (every PROGRESS_INTERVAL_S, and at the end), never from a clock.
import { runCrowd } from '../index';
import { NOTICE } from '../outputs/text';
import type { CrowdResult } from '../types';
import { workerRequestInvalid } from '../warnings';
import type { FromWorker } from './protocol';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
// The first problem of the message shape as [field, reason], or null. Deeper checks (plan, agents, fire status) belong to
// runCrowd, which returns INPUT_INVALID for them.
function requestProblem(msg: unknown): [string, string] | null {
  if (!isObj(msg)) return ['message', 'expected an object'];
  if (msg.type !== 'run') return ['type', 'expected "run"'];
  if (typeof msg.id !== 'number' || !Number.isFinite(msg.id)) return ['id', 'expected a finite number'];
  if (!isObj(msg.request)) return ['request', 'expected an object with input and fire'];
  const { input, fire } = msg.request;
  if (!isObj(input)) return ['request.input', 'expected an object'];
  if (!isObj(fire)) return ['request.fire', 'expected an object'];
  const d = input.durationS;
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return ['request.input.durationS', 'expected a finite number above 0'];
  return null;
}
function invalidResult(field: string, reason: string): CrowdResult {
  return { status: 'invalid', warnings: [workerRequestInvalid(field, reason)], notice: NOTICE, summary: null, agents: [], gates: [], congestion: [] };
}
export function handleMessage(msg: unknown, post: (m: FromWorker) => void): void {
  const problem = requestProblem(msg);
  if (problem !== null) {
    const id = isObj(msg) && typeof msg.id === 'number' && Number.isFinite(msg.id) ? msg.id : -1;
    post({ type: 'result', id, result: invalidResult(problem[0], problem[1]) });
    return;
  }
  const m = msg as { id: number; request: { input: Parameters<typeof runCrowd>[0]; fire: Parameters<typeof runCrowd>[1]; recordStats?: boolean } };
  let result: CrowdResult;
  try {
    result = runCrowd(m.request.input, m.request.fire, { onProgress: (event) => post({ type: 'progress', id: m.id, event }), recordStats: m.request.recordStats === true });
  } catch (e) {
    // runCrowd throws only for a programmer error; the wrapper reports it and posts no result.
    post({ type: 'error', id: m.id, message: e instanceof Error ? e.message : String(e) });
    return;
  }
  post({ type: 'result', id: m.id, result });
}
