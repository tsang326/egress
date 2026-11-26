// One-pass limit checks of the importer (Req 13.8, 17.1-17.6). Every exceeded limit is returned, not only the first.
// Limits come from src/core/plan/limits.ts, which reads them from the fire and crowd modules (Req 17.4).
import { CROWD_MAX_CELLS_PER_FLOOR, FIRE_MAX_COMPARTMENTS, FIRE_MAX_FLOORS, FIRE_MAX_VENTS } from './limits';
import type { ImportCounts, ImportWarning } from './types';
import { limitCells, limitCompartments, limitFloors, ventLimit } from './warnings';

export interface LimitInput {
  floorCount: number;
  compartmentCount: number;
  ventCount: number;
  grids: readonly { floorId: string; widthCells: number; heightCells: number }[];
}

/** Counts next to their limits (Req 17.5). */
export function limitCounts(input: LimitInput): ImportCounts {
  return {
    floors: { count: input.floorCount, limit: FIRE_MAX_FLOORS, exceeded: input.floorCount > FIRE_MAX_FLOORS },
    compartments: { count: input.compartmentCount, limit: FIRE_MAX_COMPARTMENTS, exceeded: input.compartmentCount > FIRE_MAX_COMPARTMENTS },
    vents: { count: input.ventCount, limit: FIRE_MAX_VENTS, exceeded: input.ventCount > FIRE_MAX_VENTS },
    cellsPerFloor: input.grids.map((g) => {
      const count = g.widthCells * g.heightCells;
      return { floorId: g.floorId, widthCells: g.widthCells, heightCells: g.heightCells, count, limit: CROWD_MAX_CELLS_PER_FLOOR, exceeded: count > CROWD_MAX_CELLS_PER_FLOOR };
    }),
  };
}

/** Error warnings for every exceeded limit in `counts`, in the order floors, compartments, cells, vents. */
export function limitWarnings(counts: ImportCounts): ImportWarning[] {
  const out: ImportWarning[] = [];
  if (counts.floors.exceeded) out.push(limitFloors(counts.floors.count, counts.floors.limit));
  if (counts.compartments.exceeded) out.push(limitCompartments(counts.compartments.count, counts.compartments.limit));
  for (const c of counts.cellsPerFloor) {
    if (c.exceeded) out.push(limitCells(c.floorId, c.count, c.limit, { widthCells: c.widthCells, heightCells: c.heightCells }));
  }
  if (counts.vents.exceeded) out.push(ventLimit(counts.vents.count, counts.vents.limit));
  return out;
}

export function checkLimits(input: LimitInput): { counts: ImportCounts; warnings: ImportWarning[] } {
  const counts = limitCounts(input);
  return { counts, warnings: limitWarnings(counts) };
}
