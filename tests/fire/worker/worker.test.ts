// Worker_Wrapper tests (task 16.2). Requirements 10.11, 10.12, 11.7.
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { runFire } from "../../../src/core/fire";
import type { ProgressEvent, Scenario } from "../../../src/core/fire/types";
import type { FromWorker, ToWorker } from "../../../src/core/fire/worker/protocol";
import { runFireInWorker, type WorkerLike } from "../../../src/web/fire/fireClient";
import { handleMessage } from "../../../src/web/fire/workerHandler";
import { arbScenario } from "../arbitraries";
import { disposeNodeWorkerBundle, prepareNodeWorker } from "./nodeWorkerAdapter";

/** Small, fixed-seed Scenarios (at most 2 compartments, 1 fire, 2 vents, 20 s). */
const scenarios = fc.sample(
  arbScenario({ maxCompartments: 2, maxFires: 1, maxVents: 2 }).map((s) => ({
    ...s,
    durationS: Math.min(s.durationS, 20),
    printIntervalS: Math.min(s.printIntervalS, 20),
  })),
  { seed: 16, numRuns: 3 },
) as Scenario[];

/** Bit-level deep equality: Object.is on every number, typed arrays and plain objects compared structurally. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = a as unknown as ArrayLike<number>;
    const y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && same((a as never)[k], (b as never)[k]));
  }
  return false;
}

/** Fake Worker. `onRun` stands in for the worker side and may call `emit` to send messages to the client. */
class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  terminated = 0;
  constructor(private readonly onRun: (msg: ToWorker, w: FakeWorker) => void) {}
  postMessage(message: ToWorker): void {
    this.onRun(message, this);
  }
  terminate(): void {
    this.terminated++;
  }
  emit(m: FromWorker): void {
    this.onmessage?.({ data: m } as MessageEvent<FromWorker>);
  }
}

/** A fake worker that runs the real handler synchronously, with the given clock. */
const handlerWorker = (now: () => number) =>
  new FakeWorker((msg, w) => handleMessage(msg, (m) => w.emit(m), now));

describe("Worker_Wrapper with a fake Worker", () => {
  it("smoke: runs a Scenario, forwards progress, resolves the Result and terminates the worker", async () => {
    const s = scenarios[0]!;
    const w = handlerWorker(() => 0);
    const events: ProgressEvent[] = [];
    const result = await runFireInWorker(structuredClone(s), (e) => events.push(e), () => w);
    expect(same(result, runFire(structuredClone(s)))).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.fraction).toBe(0);
    expect(events[events.length - 1]!.fraction).toBe(1);
    expect(w.terminated).toBe(1);
  });

  describe("error path: failed Result with WORKER_ERROR, worker terminated", () => {
    const expectWorkerError = (r: Awaited<ReturnType<typeof runFireInWorker>>): void => {
      expect(r.status).toBe("failed");
      expect(r.warnings.some((x) => x.code === "WORKER_ERROR")).toBe(true);
    };

    it("worker error event", async () => {
      const w = new FakeWorker((_m, self) => self.onerror?.({ message: "boom" } as ErrorEvent));
      const r = await runFireInWorker(scenarios[0]!, undefined, () => w);
      expectWorkerError(r);
      expect(w.terminated).toBe(1);
    });

    it("worker messageerror event", async () => {
      const w = new FakeWorker((_m, self) => self.onmessageerror?.({} as MessageEvent));
      const r = await runFireInWorker(scenarios[0]!, undefined, () => w);
      expectWorkerError(r);
      expect(w.terminated).toBe(1);
    });

    it("posted error message", async () => {
      const w = new FakeWorker((m, self) => self.emit({ type: "error", id: m.id, message: "bad" }));
      const r = await runFireInWorker(scenarios[0]!, undefined, () => w);
      expectWorkerError(r);
      expect(w.terminated).toBe(1);
    });

    it("handler turns a throw inside runFire into a posted error", () => {
      const posted: FromWorker[] = [];
      // A null Scenario makes runFire throw (programmer error); the handler must report it, not throw.
      handleMessage({ type: "run", id: 7, scenario: null as unknown as Scenario }, (m) => posted.push(m), () => 0);
      expect(posted).toHaveLength(1);
      expect(posted[0]!.type).toBe("error");
    });

    it("factory throws (no worker exists to terminate)", async () => {
      const r = await runFireInWorker(scenarios[0]!, undefined, () => {
        throw new Error("cannot start");
      });
      expectWorkerError(r);
    });

    it("ignores later messages after the first failure", async () => {
      const w = new FakeWorker((m, self) => {
        self.onerror?.({ message: "boom" } as ErrorEvent);
        self.emit({ type: "progress", id: m.id, event: { simTimeS: 1, fraction: 0.5 } });
      });
      const events: ProgressEvent[] = [];
      const r = await runFireInWorker(scenarios[0]!, (e) => events.push(e), () => w);
      expectWorkerError(r);
      expect(events).toHaveLength(0);
      expect(w.terminated).toBe(1);
    });
  });

  it("posts each progress event at the moment it is emitted, not batched (fake clock)", () => {
    const s = scenarios[0]!;
    // One shared log. The clock advances 1500 ms per reading, so the 1 s wall-clock rule fires on every step and
    // progress events interleave with clock readings. Batching would put every post after every clock reading.
    const log: ("now" | "progress" | "result")[] = [];
    let t = 0;
    const now = (): number => {
      log.push("now");
      return (t += 1500);
    };
    handleMessage({ type: "run", id: 1, scenario: structuredClone(s) }, (m) => log.push(m.type as "progress" | "result"), now);

    const progressIdx = log.flatMap((x, i) => (x === "progress" ? [i] : []));
    expect(progressIdx.length).toBeGreaterThanOrEqual(3);
    const lastNow = log.lastIndexOf("now");
    expect(log.lastIndexOf("result")).toBe(log.length - 1);
    // Posts occur before the last clock reading, and clock readings occur between consecutive posts.
    expect(progressIdx[0]!).toBeLessThan(lastNow);
    const gaps = progressIdx.slice(1).filter((p, i) => log.slice(progressIdx[i]! + 1, p).includes("now"));
    expect(gaps.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Worker_Wrapper over Node worker_threads (same handler module)", () => {
  afterAll(disposeNodeWorkerBundle);

  it("matches a direct runFire call on every value (Object.is)", async () => {
    const factory = await prepareNodeWorker();
    for (const s of scenarios) {
      const events: ProgressEvent[] = [];
      const viaWorker = await runFireInWorker(structuredClone(s), (e) => events.push(e), factory);
      const direct = runFire(structuredClone(s));
      expect(same(viaWorker, direct)).toBe(true);
      expect(events[0]!.fraction).toBe(0);
      expect(events[events.length - 1]!.fraction).toBe(1);
    }
  }, 60_000);
});
