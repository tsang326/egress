// Counters for the benchmark (Design, Module layout "sim/stats.ts"). Filled only with CrowdRunOptions.recordStats.
import type { FieldManager } from '../flowfield/recompute';
import type { CrowdStats } from '../types';
export function buildStats(stepsDone: number, fields: FieldManager | null): CrowdStats {
  return {
    steps: stepsDone,
    fieldRecomputes: fields?.stats.recomputes ?? 0,
    dijkstraNodes: fields?.stats.nodesSettled ?? 0,
  };
}
