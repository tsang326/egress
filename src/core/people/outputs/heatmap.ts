// Congestion map (Design, "Outputs"; Requirement 6.5). Integer agent-step counts per cell, multiplied by dt at the end, so
// the sum over the map equals the sum of the agents' inside steps times dt exactly.
import type { FloorHeatMap, Plan } from '../types';
export function createHeatCounts(plan: Plan): Uint32Array[] {
  return plan.floors.map((f) => new Uint32Array(f.widthCells * f.heightCells));
}
export function heatMapsFromCounts(plan: Plan, counts: readonly Uint32Array[], dtS: number): FloorHeatMap[] {
  return plan.floors.map((f, i) => ({
    floorId: f.id,
    widthCells: f.widthCells,
    heightCells: f.heightCells,
    personSeconds: Float64Array.from(counts[i]!, (c) => c * dtS),
  }));
}
