// buildPlan: checks a PlanInput and builds the Plan (Design, Algorithms, "Plan builder"; Requirements 1.1 to 1.9).
// Never throws for object input. A non-object argument is a programmer error and throws TypeError.
import {
  CELL_SIZE_M,
  ELEVATION_MAX_M,
  ELEVATION_MIN_M,
  MAX_CELLS_PER_FLOOR,
  MAX_COMPARTMENTS,
  MAX_FLOORS,
  PLAN_LARGE_NODES,
  STAIR_DEFAULT_RISER_M,
  STAIR_DEFAULT_TREAD_M,
  STAIR_K_TABLE,
} from '../constants';
import { computeFieldsForExits } from '../flowfield/baseFields';
import { buildGraph } from '../flowfield/costs';
import type {
  CrowdWarning,
  FloorInput,
  Plan,
  PlanFloor,
  PlanInput,
  PlanLimits,
  PlanResult,
  StairLinkInput,
  StairLinkModel,
} from '../types';
import { CELL_DOOR, CELL_EXIT, CELL_FREE, CELL_STAIR, CELL_WALL, NO_COMPARTMENT } from '../types';
import {
  inputInvalid,
  planCellType,
  planElevation,
  planLarge,
  planLimit,
  stairGeometryRange,
  stairLinkMismatch,
} from '../warnings';
import { gatesFromFloors, stairGatePair } from './gatesFromPlan';
import { computeFits, wallClearanceCosts } from './grid';
import { findUnreachable } from './reachability';

const CELL_CODES: Readonly<Record<string, number>> = {
  wall: CELL_WALL,
  free: CELL_FREE,
  door: CELL_DOOR,
  exit: CELL_EXIT,
  stair: CELL_STAIR,
};

// Gate ids are stored in an Int16Array (PlanFloor.gateOfCell), so a plan can have at most this many gates.
const MAX_GATES = 32767;

// Caller limits can only tighten the limits of constants.ts; a missing or non-numeric value keeps the default.
function effectiveLimits(l: PlanLimits | undefined): PlanLimits {
  const pick = (v: unknown, max: number): number => (typeof v === 'number' && v >= 0 ? Math.min(v, max) : max);
  return {
    maxFloors: pick(l?.maxFloors, MAX_FLOORS),
    maxCompartments: pick(l?.maxCompartments, MAX_COMPARTMENTS),
    maxCellsPerFloor: pick(l?.maxCellsPerFloor, MAX_CELLS_PER_FLOOR),
  };
}

function invalid(warnings: CrowdWarning[]): PlanResult {
  return { status: 'invalid', plan: null, warnings };
}

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

// Step 1: limits, sizes and elevation of every floor. Returns the warnings (empty when all pass).
function checkFloors(floors: FloorInput[], limits: PlanLimits): CrowdWarning[] {
  const out: CrowdWarning[] = [];
  if (floors.length > limits.maxFloors) out.push(planLimit('floors', floors.length, limits.maxFloors));
  const ids = new Set<string>();
  floors.forEach((f, i) => {
    if (f === null || typeof f !== 'object' || typeof f.id !== 'string' || f.id === '') {
      out.push(inputInvalid(`floors[${i}].id`, 'a floor needs a non-empty text id'));
      return;
    }
    if (ids.has(f.id)) out.push(inputInvalid(`floors[${i}].id`, `the floor id "${f.id}" is used twice`));
    ids.add(f.id);
    if (typeof f.elevationM !== 'number' || !Number.isFinite(f.elevationM) || f.elevationM < ELEVATION_MIN_M || f.elevationM > ELEVATION_MAX_M) {
      out.push(planElevation(f.id, f.elevationM));
    }
    if (!isPositiveInt(f.widthCells) || !isPositiveInt(f.heightCells)) {
      out.push(inputInvalid(`floors[${i}] (${f.id}) size`, 'width and height must be whole numbers above 0'));
      return;
    }
    const cells = f.widthCells * f.heightCells;
    if (cells > limits.maxCellsPerFloor) {
      out.push(planLimit(`cells on floor ${f.id}`, cells, limits.maxCellsPerFloor));
      return;
    }
    if (!f.cells || f.cells.length !== cells) out.push(inputInvalid(`floors[${i}] (${f.id}).cells`, `expected ${cells} cells`));
    if (!f.compartmentIds || f.compartmentIds.length !== cells) {
      out.push(inputInvalid(`floors[${i}] (${f.id}).compartmentIds`, `expected ${cells} entries`));
    }
  });
  return out;
}

// Step 2: cell types as codes. The first bad cell of a floor is reported.
function parseCells(f: FloorInput, warnings: CrowdWarning[]): Uint8Array {
  const out = new Uint8Array(f.widthCells * f.heightCells);
  for (let i = 0; i < out.length; i++) {
    const v = f.cells[i];
    let code: number | undefined;
    if (typeof v === 'string') code = Object.hasOwn(CELL_CODES, v) ? CELL_CODES[v] : undefined;
    else if (typeof v === 'number' && Number.isInteger(v) && v >= CELL_WALL && v <= CELL_STAIR) code = v;
    if (code === undefined) {
      warnings.push(planCellType(f.id, i % f.widthCells, Math.floor(i / f.widthCells), String(v)));
      return out;
    }
    out[i] = code;
  }
  return out;
}

// SFPE stair table lookup (Design, Plan builder step 5): the table point whose riser/tread slope is nearest to the
// stair's slope (riseIn / treadIn, the unit cancels). `inRange` is false outside the table's slope range (0.5 to 0.75),
// where the result is clamped to the nearest end point. Ties go to the earlier table row.
export function stairTableK(slope: number): { k: number; tableSlope: number; inRange: boolean } {
  let best = STAIR_K_TABLE[0]!;
  let bestDist = Infinity;
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of STAIR_K_TABLE) {
    const s = t.riseIn / t.treadIn;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
    const d = Math.abs(s - slope);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return { k: best.kMPerS, tableSlope: best.riseIn / best.treadIn, inRange: slope >= lo && slope <= hi };
}

// Step 5: one stair link, or null with a Warning. The footprint is the set of cells that are stair on both floors.
function buildLink(
  link: StairLinkInput,
  i: number,
  floors: PlanFloor[],
  warnings: CrowdWarning[],
): Omit<StairLinkModel, 'gateUp' | 'gateDown'> | null {
  const name = `stairLinks[${i}] (${String(link?.id)})`;
  const lower = floors.find((f) => f.id === link?.lowerFloorId);
  const upper = floors.find((f) => f.id === link?.upperFloorId);
  if (typeof link?.id !== 'string' || !lower || !upper) {
    warnings.push(inputInvalid(name, 'the link needs a text id and the ids of two floors of this plan'));
    return null;
  }
  if (upper.index !== lower.index + 1) {
    warnings.push(inputInvalid(name, `floors ${lower.id} and ${upper.id} are not adjacent, lower floor first`));
    return null;
  }
  const w = lower.widthCells;
  if (upper.widthCells !== w || upper.heightCells !== lower.heightCells) {
    warnings.push(stairLinkMismatch(link.id, lower.id, upper.id, 0, 0));
    return null;
  }
  const cells: number[] = [];
  let unmatched = -1;
  for (let c = 0; c < lower.cellType.length; c++) {
    const lo = lower.cellType[c] === CELL_STAIR;
    const up = upper.cellType[c] === CELL_STAIR;
    if (lo && up) cells.push(c);
    else if ((lo || up) && unmatched < 0) unmatched = c;
  }
  if (unmatched >= 0) {
    warnings.push(stairLinkMismatch(link.id, lower.id, upper.id, unmatched % w, Math.floor(unmatched / w)));
    return null;
  }
  if (cells.length === 0) {
    warnings.push(inputInvalid(name, `floors ${lower.id} and ${upper.id} have no stair cells`));
    return null;
  }
  const riserM = link.riserM ?? STAIR_DEFAULT_RISER_M;
  const treadM = link.treadM ?? STAIR_DEFAULT_TREAD_M;
  const dz = upper.elevationM - lower.elevationM;
  if (!(Number.isFinite(riserM) && riserM > 0 && Number.isFinite(treadM) && treadM > 0)) {
    warnings.push(inputInvalid(`${name}.riserM/treadM`, 'riser and tread must be numbers above 0'));
    return null;
  }
  if (!(dz > 0)) {
    warnings.push(inputInvalid(name, `floor ${upper.id} must be higher than floor ${lower.id}`));
    return null;
  }
  let minX = w, maxX = 0, minY = lower.heightCells, maxY = 0;
  for (const c of cells) {
    const x = c % w;
    const y = (c - x) / w;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // Shortcut: the default width is the shorter side of the footprint's bounding box, so two separate shafts on the
  // same floor pair count as one wide stair. Upgrade by giving each shaft its own link.
  const boxWidthM = Math.min(maxX - minX + 1, maxY - minY + 1) * CELL_SIZE_M;
  const widthM = link.widthM !== undefined && Number.isFinite(link.widthM) && link.widthM > 0 ? link.widthM : boxWidthM;
  const slope = riserM / treadM;
  const t = stairTableK(slope);
  if (!t.inRange) warnings.push(stairGeometryRange(link.id, 'riser-to-tread ratio (percent)', slope * 100, t.tableSlope * 100));
  return {
    id: link.id,
    lowerFloor: lower.index,
    upperFloor: upper.index,
    footprint: Int32Array.from(cells),
    inclineLengthM: dz * Math.sqrt(1 + (treadM / riserM) ** 2),
    widthM,
    speedFreeMPerS: t.k,
  };
}

export function buildPlan(input: PlanInput, limits?: PlanLimits): PlanResult {
  if (input === null || typeof input !== 'object') throw new TypeError('buildPlan: input must be an object');
  if (!Array.isArray(input.floors)) return invalid([inputInvalid('floors', 'must be a list of floors')]);
  const lim = effectiveLimits(limits);
  const stairLinkInputs: StairLinkInput[] = Array.isArray(input.stairLinks) ? input.stairLinks : [];
  const warnings: CrowdWarning[] = [];

  // 1: limits, sizes, elevation.
  const limitWarnings = checkFloors(input.floors, lim);
  if (limitWarnings.length > 0) return invalid(limitWarnings);

  // 2: cell types.
  const types = input.floors.map((f) => parseCells(f, warnings));
  if (warnings.length > 0) return invalid(warnings);

  // 3: compartment interning, in cell order over non-wall cells. Wall cells carry no compartment.
  const compartmentIds: string[] = [];
  const interned = new Map<string, number>();
  const compartmentMaps = input.floors.map((f, fi) => {
    const m = new Uint16Array(f.widthCells * f.heightCells).fill(NO_COMPARTMENT);
    for (let c = 0; c < m.length; c++) {
      const id = f.compartmentIds[c];
      if (typeof id !== 'string' || id === '' || types[fi]![c] === CELL_WALL) continue;
      let k = interned.get(id);
      if (k === undefined) {
        k = compartmentIds.length;
        interned.set(id, k);
        compartmentIds.push(id);
      }
      m[c] = k < NO_COMPARTMENT ? k : NO_COMPARTMENT; // the limit check below rejects the plan long before the cap
    }
    return m;
  });
  if (compartmentIds.length > lim.maxCompartments) {
    return invalid([planLimit('compartments', compartmentIds.length, lim.maxCompartments)]);
  }

  const floors: PlanFloor[] = input.floors.map((f, index) => {
    const grid = { widthCells: f.widthCells, heightCells: f.heightCells, cellType: types[index]! };
    return {
      id: f.id,
      index,
      elevationM: f.elevationM,
      widthCells: f.widthCells,
      heightCells: f.heightCells,
      cellType: types[index]!,
      compartment: compartmentMaps[index]!,
      gateOfCell: new Int16Array(f.widthCells * f.heightCells).fill(-1),
      fitsAgent: computeFits(grid),
      clearanceCost: wallClearanceCosts(grid),
    };
  });
  const nodeOffset = new Int32Array(floors.length);
  let nodeCount = 0;
  floors.forEach((f, i) => {
    nodeOffset[i] = nodeCount;
    nodeCount += f.widthCells * f.heightCells;
  });

  // 4: gates and narrow passages.
  const g = gatesFromFloors(floors);
  if (g.gates.length + 2 * stairLinkInputs.length > MAX_GATES) {
    return invalid([planLimit('gates', g.gates.length + 2 * stairLinkInputs.length, MAX_GATES)]);
  }
  warnings.push(...g.warnings);

  // 5: stair links.
  const stairLinks: StairLinkModel[] = [];
  stairLinkInputs.forEach((li, i) => {
    const m = buildLink(li, i, floors, warnings);
    if (!m) return;
    const linkIndex = stairLinks.length;
    const [up, down] = stairGatePair(g.gates.length, linkIndex, m.id, m.lowerFloor, m.upperFloor, m.footprint, m.widthM, m.speedFreeMPerS);
    g.gates.push(up, down);
    stairLinks.push({ ...m, gateUp: up.id, gateDown: down.id });
  });

  // 6: reachability (no region Warnings when the plan has no exit).
  const reach = findUnreachable(
    floors,
    nodeOffset,
    nodeCount,
    stairLinks,
    g.exits.map((e) => ({ floorIndex: e.floorIndex, cells: e.cells })),
  );
  warnings.push(...reach.warnings);
  if (nodeCount > PLAN_LARGE_NODES) warnings.push(planLarge(nodeCount, PLAN_LARGE_NODES));

  // 7: a plan with no exit cell is a valid Plan (NO_EXIT is raised by runCrowd, Requirement 1.6).
  // Compartment kinds for the long-corridor warning (Requirement 6.7): same index as compartmentIds, null when
  // PlanInput.compartments does not list the id. Absent when PlanInput.compartments is absent.
  const listed = Array.isArray(input.compartments) ? input.compartments : null;
  const compartmentKinds = listed ? compartmentIds.map((id) => listed.find((c) => c?.id === id)?.kind ?? null) : undefined;

  // 8: base fields, one per exit group, all multipliers 1 (Requirement 1.9).
  const plan: Plan = { floors, compartmentIds, ...(compartmentKinds ? { compartmentKinds } : {}), nodeOffset, nodeCount, gates: g.gates, exits: g.exits, stairLinks, baseFields: [] };
  plan.baseFields = computeFieldsForExits(buildGraph(plan), plan.exits.map((e) => nodeOffset[e.floorIndex]!), plan.exits.map((e) => e.cells));
  return { status: 'valid', plan, warnings };
}
