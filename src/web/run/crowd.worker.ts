// Web Worker entry for the crowd run (run-view spec, Requirement 4.1).
import { handleCrowdMessage, type ToCrowdWorker } from './crowdWorkerHandler';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (e: MessageEvent<ToCrowdWorker>): void => {
  handleCrowdMessage(e.data, (m, transfer) => scope.postMessage(m, transfer));
};
