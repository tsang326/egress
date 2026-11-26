// Stairs (Req 11): Stair_Region proposal from `stair`-layer outlines, Stair_Link creation between adjacent floors, and
// the stair cells that the crowd Plan_Builder needs. Pure functions, no throws on bad input, no clock or random.
//
// Rules for identical stair cells (read from src/core/people/plan/builder.ts `buildLink`): for every link, the set of
// `stair` cells on the lower floor must equal the set on the upper floor, and any stair cell on either floor that is
// not on both makes the builder reject the link with `StairLinkMismatch`. So the footprint of a link has to be the
// complete stair cell set of both floors. For a stair that runs over three or more floors the middle floor takes part
// in two links, so the footprints must be equal: all floors of a run of linked floors end with the same cells, the
// intersection of all their regions (design.md, Decisions during implementation, Task 10.2).
//
// Floors are given bottom to top; two floors are adjacent when they are neighbours in that array. Cell indices are
// row-major in the shared grid width (Req 4.5).
import { CELL_SIZE_M } from '../../people/constants';
import { CELL_FREE, CELL_STAIR } from '../../people/types';
import { STAIR_OVERLAP_MIN_FRACTION } from '../constants';
import type { ImportWarning, Room, StairLink, StairRegionInput } from '../types';
import { editIgnored, stairOverlapBelowTolerance, stairRegionTrimmed } from '../warnings';

/** The cell grid of one floor, as far as stairs need it. `cellType` uses the crowd codes (CELL_FREE, CELL_STAIR, ...). */
export interface StairFloorGrid {
  floorId: string;
  widthCells: number;
  heightCells: number;
  cellType: Uint8Array;
}

/** A Stair_Region proposed from a closed `stair`-layer outline. It counts only after the user confirms it (Req 11.2). */
export interface StairProposal {
  floorId: string;
  cells: Int32Array;
  confirmed: false;
}

export interface RoofOpeningInput {
  floorId: string;
  areaM2: number;
  openFraction: number;
}

/** One stair compartment per floor that holds a Stair_Region (Req 11.7). `cells` are the final stair cells. */
export interface StairCompartment {
  floorId: string;
  regionId: string;
  cells: Int32Array;
}

export interface StairsInput {
  floors: readonly StairFloorGrid[];
  /** Confirmed regions: user cells, cells of a room set to kind `stair`, confirmed proposals. Several per floor merge. */
  regions: readonly StairRegionInput[];
  linkOverrides?: Readonly<Record<string, { widthM?: number }>>;
  roofVents?: readonly RoofOpeningInput[];
}

export interface StairsResult {
  /** Copies of the input grids: stair cells set to CELL_STAIR, trimmed cells back to CELL_FREE. Same order as input. */
  floors: StairFloorGrid[];
  links: StairLink[];
  compartments: StairCompartment[];
  /** Accepted roof openings on the top stair compartment (Req 11.10). */
  roofOpenings: RoofOpeningInput[];
  warnings: ImportWarning[];
}

/** Id of the stair region of a floor (all confirmed regions of a floor are one stair compartment). */
export const stairRegionId = (floorId: string): string => `${floorId}:stair`;
/** Id of the link between two adjacent floors. */
export const stairLinkId = (lowerFloorId: string, upperFloorId: string): string => `${lowerFloorId}:${upperFloorId}:stair`;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const sortedUnique = (cells: Iterable<number>): Int32Array => Int32Array.from(new Set(cells)).sort();

// ---- Regions -----------------------------------------------------------------------------------------------------

/** A flood-filled Room whose kind is `stair` gives a Stair_Region of its cells (Req 11.1). Other rooms give null. */
export function stairRegionFromRoom(room: Pick<Room, 'floorId' | 'kind' | 'cells'>): StairRegionInput | null {
  return room.kind === 'stair' ? { floorId: room.floorId, cells: Int32Array.from(room.cells).sort() } : null;
}

export interface OutlineGrid {
  originXM: number;
  originYM: number;
  widthCells: number;
  heightCells: number;
}

/**
 * Propose one unconfirmed Stair_Region per closed outline on the `stair` layer (Req 11.2). `outlinesM` holds each
 * outline as its vertices in metres (in the floor's grid frame, y as in the grid). A cell belongs to an outline when
 * its centre lies inside it (even-odd rule). Outlines with fewer than 3 vertices, a non-finite vertex or no cell are
 * skipped. The proposals are not applied by `resolveStairs`; the caller passes the confirmed ones as `regions`.
 */
export function proposeStairRegions(
  floorId: string,
  grid: OutlineGrid,
  outlinesM: readonly (readonly { xM: number; yM: number }[])[],
): StairProposal[] {
  const out: StairProposal[] = [];
  const w = grid.widthCells;
  const h = grid.heightCells;
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && Number.isFinite(grid.originXM) && Number.isFinite(grid.originYM))) {
    return out;
  }
  for (const poly of outlinesM) {
    if (!Array.isArray(poly) || poly.length < 3 || !poly.every((p) => p && Number.isFinite(p.xM) && Number.isFinite(p.yM))) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p.xM); maxX = Math.max(maxX, p.xM);
      minY = Math.min(minY, p.yM); maxY = Math.max(maxY, p.yM);
    }
    const x0 = Math.max(0, Math.floor((minX - grid.originXM) / CELL_SIZE_M));
    const x1 = Math.min(w - 1, Math.floor((maxX - grid.originXM) / CELL_SIZE_M));
    const y0 = Math.max(0, Math.floor((minY - grid.originYM) / CELL_SIZE_M));
    const y1 = Math.min(h - 1, Math.floor((maxY - grid.originYM) / CELL_SIZE_M));
    const cells: number[] = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (insidePolygon(grid.originXM + (x + 0.5) * CELL_SIZE_M, grid.originYM + (y + 0.5) * CELL_SIZE_M, poly)) cells.push(y * w + x);
      }
    }
    if (cells.length > 0) out.push({ floorId, cells: Int32Array.from(cells), confirmed: false });
  }
  return out;
}

function insidePolygon(px: number, py: number, poly: readonly { xM: number; yM: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.yM > py !== b.yM > py && px < ((b.xM - a.xM) * (py - a.yM)) / (b.yM - a.yM) + a.xM) inside = !inside;
  }
  return inside;
}

// ---- Resolution --------------------------------------------------------------------------------------------------

/** The region cells of one floor: in the grid and on a free or stair cell, merged and sorted. Others are ignored. */
function regionCellsOf(floor: StairFloorGrid, regions: readonly StairRegionInput[]): Int32Array {
  const set = new Set<number>();
  for (const r of regions) {
    if (!r || r.floorId !== floor.floorId || !r.cells) continue;
    for (const c of r.cells) {
      if (!isCount(c) || c >= floor.cellType.length) continue;
      const t = floor.cellType[c];
      if (t === CELL_FREE || t === CELL_STAIR) set.add(c);
    }
  }
  return sortedUnique(set);
}

const intersect = (a: Int32Array, b: Int32Array): Int32Array => {
  const inB = new Set(b);
  return Int32Array.from(a.filter((c) => inB.has(c)));
};

/** Shorter side of the bounding box of the cells, in metres (Req 11.5; same rule as the crowd builder's default). */
function shorterBoxSideM(cells: Int32Array, widthCells: number): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of cells) {
    const x = c % widthCells;
    const y = Math.floor(c / widthCells);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return Math.min(maxX - minX + 1, maxY - minY + 1) * CELL_SIZE_M;
}

/**
 * Link rule (Req 11.3, 11.4): two adjacent regions link when they overlap in at least STAIR_OVERLAP_MIN_FRACTION of
 * the smaller one. The compared sets are the merged, valid cells of each floor.
 */
export const overlapReachesTolerance = (overlapCells: number, smallerCells: number): boolean =>
  overlapCells > 0 && overlapCells >= STAIR_OVERLAP_MIN_FRACTION * smallerCells;

export function resolveStairs(input: StairsInput): StairsResult {
  const warnings: ImportWarning[] = [];
  const grids: StairFloorGrid[] = input.floors.map((f) => ({ ...f, cellType: Uint8Array.from(f.cellType) }));
  const regions = Array.isArray(input.regions) ? input.regions : [];
  const original = grids.map((g) => regionCellsOf(g, regions));
  const final: Int32Array[] = original.map((c) => c);

  // Pair check on the original region sets (Req 11.3, 11.4). A side with no region has no link and no warning (11.12).
  const pairOk: boolean[] = [];
  for (let i = 0; i + 1 < grids.length; i++) {
    const lo = original[i]!;
    const up = original[i + 1]!;
    if (lo.length === 0 || up.length === 0) { pairOk.push(false); continue; }
    const overlap = intersect(lo, up).length;
    const smaller = Math.min(lo.length, up.length);
    if (overlapReachesTolerance(overlap, smaller)) pairOk.push(true);
    else {
      pairOk.push(false);
      warnings.push(belowTolerance(grids[i]!.floorId, grids[i + 1]!.floorId, overlap, smaller));
    }
  }

  // Runs of consecutive linked floors share one cell set, the intersection of all their regions.
  const links: StairLink[] = [];
  for (let i = 0; i < pairOk.length; i++) {
    if (!pairOk[i]) continue;
    let end = i;
    while (end + 1 < pairOk.length && pairOk[end + 1]) end++;
    let shared = original[i]!;
    for (let k = i + 1; k <= end + 1; k++) shared = intersect(shared, original[k]!);
    if (shared.length === 0) {
      for (let k = i; k <= end; k++) warnings.push(belowTolerance(grids[k]!.floorId, grids[k + 1]!.floorId, 0, Math.min(original[k]!.length, original[k + 1]!.length)));
    } else {
      for (let k = i; k <= end + 1; k++) final[k] = shared;
      for (let k = i; k <= end; k++) links.push(makeLink(grids[k]!, grids[k + 1]!.floorId, shared, input.linkOverrides));
    }
    i = end;
  }

  // Apply to the grids and report trimmed cells (Req 11.6).
  const compartments: StairCompartment[] = [];
  grids.forEach((g, i) => {
    const keep = new Set(final[i]);
    let trimmed = 0;
    for (const c of original[i]!) {
      if (!keep.has(c)) { g.cellType[c] = CELL_FREE; trimmed++; }
    }
    for (const c of final[i]!) g.cellType[c] = CELL_STAIR;
    if (trimmed > 0) warnings.push(stairRegionTrimmed(g.floorId, trimmed));
    if (final[i]!.length > 0) compartments.push({ floorId: g.floorId, regionId: stairRegionId(g.floorId), cells: final[i]! });
  });

  const roofOpenings = acceptRoofOpenings(input.roofVents, grids, final, links, warnings);
  return { floors: grids, links, compartments, roofOpenings, warnings };
}

const belowTolerance = (lowerId: string, upperId: string, overlapCells: number, smallerCells: number): ImportWarning =>
  stairOverlapBelowTolerance(lowerId, upperId, {
    lowerRegionId: stairRegionId(lowerId),
    upperRegionId: stairRegionId(upperId),
    overlapCells,
    smallerCells,
  });

function makeLink(
  lower: StairFloorGrid,
  upperFloorId: string,
  footprint: Int32Array,
  overrides: StairsInput['linkOverrides'],
): StairLink {
  const id = stairLinkId(lower.floorId, upperFloorId);
  const o = overrides && Object.hasOwn(overrides, id) ? overrides[id]?.widthM : undefined;
  const widthM = typeof o === 'number' && Number.isFinite(o) && o > 0 ? o : shorterBoxSideM(footprint, lower.widthCells);
  return { id, lowerFloorId: lower.floorId, upperFloorId, footprint, widthM };
}

/**
 * A roof opening belongs on the top stair compartment of a stair: a floor with a stair compartment and no link to a
 * floor above (Req 11.10). Area must be above 0 and the open fraction in [0, 1]. Others are ignored with a warning.
 */
function acceptRoofOpenings(
  roofVents: StairsInput['roofVents'],
  grids: readonly StairFloorGrid[],
  final: readonly Int32Array[],
  links: readonly StairLink[],
  warnings: ImportWarning[],
): RoofOpeningInput[] {
  const out: RoofOpeningInput[] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(roofVents) ? roofVents : []) {
    const name = String(v?.floorId);
    const idx = grids.findIndex((g) => g.floorId === v?.floorId);
    if (idx < 0 || final[idx]!.length === 0) { warnings.push(editIgnored(`the roof opening on floor ${name} was dropped because the floor has no stair`)); continue; }
    if (links.some((l) => l.lowerFloorId === v.floorId)) { warnings.push(editIgnored(`the roof opening on floor ${name} was dropped because it is not the top floor of the stair`)); continue; }
    if (!(Number.isFinite(v.areaM2) && v.areaM2 > 0 && Number.isFinite(v.openFraction) && v.openFraction >= 0 && v.openFraction <= 1)) {
      warnings.push(editIgnored(`the roof opening on floor ${name} was dropped because its area must be above 0 and its open fraction from 0 to 1`));
      continue;
    }
    if (seen.has(v.floorId)) { warnings.push(editIgnored(`a second roof opening on floor ${name} was dropped`)); continue; }
    seen.add(v.floorId);
    out.push({ floorId: v.floorId, areaM2: v.areaM2, openFraction: v.openFraction });
  }
  return out;
}
