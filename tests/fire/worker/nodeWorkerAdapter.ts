// Test-side adapter: a `WorkerLike` backed by Node `worker_threads`, running the same handler module as the browser
// worker (Requirement 11.7). Reused by the benchmark (task 19.1).
//
// TS loading: Node 24 type stripping cannot load the sources, because they use extensionless imports. Instead the
// entry (nodeWorkerEntry.ts) is bundled once with esbuild (already installed as a dependency of vite) into a
// temporary .mjs file, and the Worker loads that file. No source file is changed or duplicated.
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { WorkerFactory, WorkerLike } from "../../../src/web/fire/fireClient";
import type { FromWorker, ToWorker } from "../../../src/core/fire/worker/protocol";

const ENTRY = fileURLToPath(new URL("./nodeWorkerEntry.ts", import.meta.url));

let bundle: Promise<{ file: string; dir: string }> | undefined;

/** Bundles the worker entry once per process. */
function getBundle(): Promise<{ file: string; dir: string }> {
  bundle ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), "egress-fire-worker-"));
    const file = join(dir, "worker.mjs");
    await build({ entryPoints: [ENTRY], outfile: file, bundle: true, format: "esm", platform: "node", target: "node24", logLevel: "silent" });
    return { file, dir };
  })();
  return bundle;
}

/** Removes the temporary bundle. Call from afterAll. */
export async function disposeNodeWorkerBundle(): Promise<void> {
  if (bundle === undefined) return;
  const { dir } = await bundle;
  bundle = undefined;
  rmSync(dir, { recursive: true, force: true });
}

/** Node adapter with the `WorkerLike` shape. The bundle must be ready (`await prepareNodeWorker()`). */
class NodeWorkerAdapter implements WorkerLike {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  private readonly worker: Worker;

  constructor(file: string) {
    this.worker = new Worker(file);
    this.worker.on("message", (data: FromWorker) => this.onmessage?.({ data } as MessageEvent<FromWorker>));
    this.worker.on("error", (err: Error) => this.onerror?.({ message: err.message } as ErrorEvent));
    this.worker.on("messageerror", (err: Error) => this.onmessageerror?.({ data: err } as MessageEvent));
  }

  postMessage(message: ToWorker): void {
    this.worker.postMessage(message);
  }

  terminate(): void {
    void this.worker.terminate();
  }
}

/** Builds the bundle and returns a factory that starts a fresh Node worker per call. */
export async function prepareNodeWorker(): Promise<WorkerFactory> {
  const { file } = await getBundle();
  return () => new NodeWorkerAdapter(file);
}
