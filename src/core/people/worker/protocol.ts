// Messages between the main thread and the crowd Web Worker (Design, "Worker wrapper"; Requirements 7.4, 7.6).
// Types only. No logic.
import type { Result, ProgressEvent } from '../../fire/types';
import type { CrowdInput, CrowdResult } from '../types';
export interface CrowdRequest {
  input: CrowdInput;
  fire: Result;
  recordStats?: boolean; // benchmark only: fills CrowdResult.stats (see design.md, Decisions during implementation)
}
export type ToWorker = { type: 'run'; id: number; request: CrowdRequest };
export type FromWorker =
  | { type: 'progress'; id: number; event: ProgressEvent }
  | { type: 'result'; id: number; result: CrowdResult }
  | { type: 'error'; id: number; message: string };
