// Worker_Wrapper around src/core/plan (design.md; Requirement 21.3). It only moves arguments and results across
// postMessage. All logic stays in src/core/plan/. Same file is the worker entry and the main-thread client; the
// worker listener is installed only when this module runs inside a dedicated worker scope.
import { importBuildingModel, type ImportResult, type ImportSettings, type ImportSource } from "../../core/plan/import";
import { loadProject, type LoadProjectResult } from "../../core/plan/project/load";
import { inputInvalid, projectFieldInvalid } from "../../core/plan/warnings";

export type PlanToWorker =
  | { type: "import"; id: number; sources: ImportSource[]; settings: ImportSettings }
  | { type: "loadProject"; id: number; text: string };

export type PlanFromWorker =
  | { type: "importResult"; id: number; result: ImportResult }
  | { type: "projectResult"; id: number; result: LoadProjectResult }
  | { type: "error"; id: number; message: string };

/** Worker-side logic, separate from the `self` wiring so tests can call it directly. */
export function handlePlanMessage(msg: PlanToWorker, post: (m: PlanFromWorker) => void): void {
  const { id } = msg;
  try {
    if (msg.type === "import") post({ type: "importResult", id, result: importBuildingModel(msg.sources, msg.settings) });
    else if (msg.type === "loadProject") post({ type: "projectResult", id, result: loadProject(msg.text) });
  } catch (e) {
    post({ type: "error", id, message: e instanceof Error ? e.message : String(e) });
  }
}

declare const WorkerGlobalScope: (new () => unknown) | undefined;

if (typeof WorkerGlobalScope !== "undefined" && self instanceof (WorkerGlobalScope as unknown as new () => object)) {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  scope.onmessage = (e: MessageEvent<PlanToWorker>): void => {
    handlePlanMessage(e.data, (m) => scope.postMessage(m));
  };
}

// ---- Main-thread client ------------------------------------------------------------------------------------------

/** The part of `Worker` the client uses, so tests can inject a fake. */
export interface PlanWorkerLike {
  onmessage: ((e: MessageEvent<PlanFromWorker>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onmessageerror: ((e: MessageEvent) => void) | null;
  postMessage(message: PlanToWorker): void;
  terminate(): void;
}

export type PlanWorkerFactory = () => PlanWorkerLike;

// Vite bundles the worker from the app's own files; no other origin is used.
export const defaultPlanWorkerFactory: PlanWorkerFactory = () =>
  new Worker(new URL("./planWorker.ts", import.meta.url), { type: "module" });

/** The import entry the import screen calls; a mock with this shape can be injected in tests. */
export interface PlanWorkerApi {
  importInWorker(sources: ImportSource[], settings?: ImportSettings): Promise<ImportResult>;
  loadProjectInWorker(text: string): Promise<LoadProjectResult>;
}

let nextId = 1;

function request<T>(
  message: (id: number) => PlanToWorker,
  pick: (m: PlanFromWorker) => T | undefined,
  failed: (detail: string) => T,
  factory: PlanWorkerFactory,
): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = nextId++;
    let worker: PlanWorkerLike;
    try {
      worker = factory();
    } catch (e) {
      resolve(failed(e instanceof Error ? e.message : String(e)));
      return;
    }
    let done = false;
    const finish = (value: T): void => {
      if (done) return;
      done = true;
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      resolve(value);
    };
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === "error") finish(failed(m.message));
      else {
        const v = pick(m);
        if (v !== undefined) finish(v);
      }
    };
    worker.onerror = (e) => finish(failed(e.message || "unhandled error in worker"));
    worker.onmessageerror = () => finish(failed("the worker sent a message that could not be read"));
    worker.postMessage(message(id));
  });
}

const failedImport = (detail: string): ImportResult => ({
  status: "invalid",
  model: null,
  warnings: [inputInvalid(`the import could not run (${detail})`)],
  pendingQuestions: [],
});

/** Runs importBuildingModel in a new worker. A worker failure resolves to an invalid result with a warning. */
export function importInWorker(
  sources: ImportSource[],
  settings: ImportSettings = {},
  factory: PlanWorkerFactory = defaultPlanWorkerFactory,
): Promise<ImportResult> {
  return request(
    (id) => ({ type: "import", id, sources, settings }),
    (m) => (m.type === "importResult" ? m.result : undefined),
    failedImport,
    factory,
  );
}

/** Runs loadProject in a new worker. A worker failure resolves to status "invalid". */
export function loadProjectInWorker(text: string, factory: PlanWorkerFactory = defaultPlanWorkerFactory): Promise<LoadProjectResult> {
  return request(
    (id) => ({ type: "loadProject", id, text }),
    (m) => (m.type === "projectResult" ? m.result : undefined),
    (detail): LoadProjectResult => ({ status: "invalid", errors: [projectFieldInvalid("project", `the worker failed (${detail})`)] }),
    factory,
  );
}

export const defaultPlanWorkerApi: PlanWorkerApi = { importInWorker, loadProjectInWorker };
