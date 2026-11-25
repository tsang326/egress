// FED history per agent and flow and queue series per gate (Design, "Outputs"; Requirements 6.1, 6.4).
import { SERIES_INTERVAL_S } from '../constants';
import type { GateSeries, Plan } from '../types';
// Steps between two samples: SERIES_INTERVAL_S / dt, a whole number for dt = 0.05 s.
export const stepsPerSample = (dtS: number): number => Math.round(SERIES_INTERVAL_S / dtS);
export class FedHistory {
  private readonly times: number[][];
  private readonly values: number[][];
  constructor(n: number) {
    this.times = Array.from({ length: n }, () => []);
    this.values = Array.from({ length: n }, () => []);
  }
  push(agent: number, timeS: number, fed: number): void {
    this.times[agent]!.push(timeS);
    this.values[agent]!.push(fed);
  }
  of(agent: number): { timesS: Float64Array; fed: Float64Array } {
    return { timesS: Float64Array.from(this.times[agent]!), fed: Float64Array.from(this.values[agent]!) };
  }
}
// One sample per whole second from 0, plus a last sample at the end of the run when that is not a whole second. The flow
// of a sample is the number of crossings since the previous sample divided by SERIES_INTERVAL_S (an integer count, so the
// flow samples add up to the number of crossings). The queue length is the FIFO size at the sample time.
export class GateRecorder {
  private readonly times: number[] = [];
  private readonly flow: number[][];
  private readonly queue: number[][];
  constructor(private readonly plan: Plan) {
    this.flow = plan.gates.map(() => []);
    this.queue = plan.gates.map(() => []);
  }
  get sampleCount(): number {
    return this.times.length;
  }
  // `crossCount[g]` is read and reset to 0; `queueLength[g]` is the FIFO size.
  sample(timeS: number, crossCount: Int32Array, queueLength: (gateId: number) => number): void {
    this.times.push(timeS);
    for (let g = 0; g < this.flow.length; g++) {
      this.flow[g]!.push(crossCount[g]! / SERIES_INTERVAL_S);
      this.queue[g]!.push(queueLength(g));
      crossCount[g] = 0;
    }
  }
  series(): GateSeries[] {
    return this.plan.gates.map((g, i) => ({
      gateId: g.id,
      label: g.label,
      kind: g.kind,
      timesS: Float64Array.from(this.times),
      flowPersonsPerS: Float64Array.from(this.flow[i]!),
      queueLength: Float64Array.from(this.queue[i]!),
    }));
  }
}
