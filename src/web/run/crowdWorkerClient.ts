// Main-thread wrapper around the crowd worker, the same shape as fire/fireClient.ts (run-view spec, Requirement 4).
import type { ProgressEvent, Result } from '../../core/fire/types';
import type { CrowdInput, CrowdResult } from '../../core/people/types';
import type { FromCrowdWorker, ToCrowdWorker } from './crowdWorkerHandler';
import type { Trajectory } from './trajectory';

export interface CrowdWorkerLike {
  onmessage: ((e: MessageEvent<FromCrowdWorker>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(message: ToCrowdWorker): void;
  terminate(): void;
}
export type CrowdWorkerFactory = () => CrowdWorkerLike;

export const defaultCrowdWorkerFactory: CrowdWorkerFactory = () =>
  new Worker(new URL('./crowd.worker.ts', import.meta.url), { type: 'module' }) as unknown as CrowdWorkerLike;

export interface CrowdRun {
  result: CrowdResult;
  trajectory: Trajectory;
}

export interface Cancellable<T> {
  promise: Promise<T>;
  cancel: () => void; // terminates the worker; the promise then never settles
}

let nextId = 1;

/** Starts the crowd run in a new worker. Rejects with an Error on a worker error. */
export function runCrowdInWorker(
  input: CrowdInput,
  fire: Result,
  onProgress: (e: ProgressEvent) => void = () => {},
  factory: CrowdWorkerFactory = defaultCrowdWorkerFactory,
): Cancellable<CrowdRun> {
  const id = nextId++;
  let worker: CrowdWorkerLike | null = null;
  const promise = new Promise<CrowdRun>((resolve, reject) => {
    try {
      worker = factory();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    const w = worker;
    const stop = (): void => {
      w.onmessage = null;
      w.onerror = null;
      w.terminate();
    };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'progress') onProgress(m.event);
      else if (m.type === 'result') {
        stop();
        resolve({ result: m.result, trajectory: m.trajectory });
      } else {
        stop();
        reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      stop();
      reject(new Error(e.message || 'unhandled error in the crowd worker'));
    };
    w.postMessage({ type: 'run', id, request: { input, fire } });
  });
  return {
    promise,
    cancel: () => {
      if (worker !== null) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
    },
  };
}
