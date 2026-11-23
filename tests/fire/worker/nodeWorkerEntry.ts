// Entry that runs inside a Node worker_threads Worker. It wires the same handler module the browser worker uses
// (src/web/fire/workerHandler.ts) to the worker's parentPort. Bundled by nodeWorkerAdapter.ts; not imported by tests.
import { parentPort } from "node:worker_threads";
import type { ToWorker } from "../../../src/core/fire/worker/protocol";
import { handleMessage } from "../../../src/web/fire/workerHandler";

const port = parentPort;
if (port === null) throw new Error("nodeWorkerEntry must run inside a worker_threads Worker");

port.on("message", (msg: ToWorker) => {
  handleMessage(msg, (message, transfer) => port.postMessage(message, transfer), () => performance.now());
});
