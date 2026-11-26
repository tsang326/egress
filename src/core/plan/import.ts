// importBuildingModel: the whole plan-import pipeline in one pure call (Req 2.3, 3.8, 5.4, 5.5, 10.6, 14.7, 22.3, 22.4,
// 22.7). Stage order:
//   readDxf -> resolveDrawingUnit -> flattenEntities -> convertToMeters -> layer confirmation (per file)
//   -> buildFloorSources -> resolveFloorSettings -> per floor: rasterize -> closeGaps -> placeDoors
//   -> windows (from the rasterizer) -> applyEdits (replays the edits, runs findRooms) -> window sides
//   -> resolveStairs -> applyExits -> BuildingModel -> toPlanInput + toFireGeometry.
// Throws TypeError only for a `sources` that is not an array or an element whose `text` is not a string (programmer
// errors). Every other bad input returns `invalid` with warnings. No network, clock, random value or global state.
import { CELL_SIZE_M } from '../people/constants';
import { CELL_DOOR, CELL_FREE, CELL_STAIR, CELL_WALL } from '../people/types';
import { METERS_PER_UNIT } from './constants';
import { checkAgreement } from './agreement';
import { checkLimits } from './limitChecks';
import { toFireGeometry } from './derive/toFireGeometry';
import { toPlanInput } from './derive/toPlanInput';
import { flattenEntities } from './dxf/blocks';
import { readDxf } from './dxf/reader';
import { normalizeSettings } from './importInput';
import type { NormalizedSettings } from './importInput';
import { buildFloorSources } from './floorSources';
import type { FloorSource, FloorSourceFile } from './floorSources';
import { closeGaps } from './grid/gaps';
import { placeDoors } from './grid/doors';
import type { DoorDraft } from './grid/doors';
import { rasterize } from './grid/rasterize';
import type { GridSpec, RasterFeature } from './grid/rasterize';
import type { FlatEntity } from './dxf/blocks';
import { checkLayerConfirmation, countEntitiesPerLayer } from './layers';
import { applyEdits } from './model/edits';
import type { EditedFloor } from './model/edits';
import { applyExits } from './model/exits';
import { resolveFloorSettings } from './model/floorSettings';
import { proposeStairRegions, resolveStairs, stairRegionFromRoom } from './model/stairs';
import type { RoofOpeningInput } from './model/stairs';
import type {
  BuildingModel,
  Door,
  Edit,
  FloorSettings,
  FloorSourceSpec,
  ImportCounts,
  ImportResult,
  ImportSettings,
  ImportSource,
  ImportWarning,
  LayerMap,
  PendingQuestion,
  Room,
  StairRegionInput,
} from './types';
import { convertToMeters, resolveDrawingUnit } from './units';
import { editIgnored, inputInvalid } from './warnings';

export type { ImportResult, ImportSettings, ImportSource } from './types';

const OUTSIDE = 'OUTSIDE';

function invalidResult(warnings: ImportWarning[], pendingQuestions: PendingQuestion[] = [], counts?: ImportCounts): ImportResult {
  return counts === undefined
    ? { status: 'invalid', model: null, warnings, pendingQuestions }
    : { status: 'invalid', model: null, warnings, pendingQuestions, counts };
}

export function importBuildingModel(sources: ImportSource[], settings: ImportSettings = {}): ImportResult {
  if (!Array.isArray(sources)) throw new TypeError('importBuildingModel: sources must be an array');
  for (const s of sources) {
    if (s === null || typeof s !== 'object' || typeof (s as { text?: unknown }).text !== 'string') {
      throw new TypeError('importBuildingModel: every source needs a string `text`');
    }
  }
  try {
    return run(sources, normalizeSettings(settings));
  } catch {
    // Defensive only (Req 22.3): the stages are written not to throw.
    return invalidResult([inputInvalid('the import failed unexpectedly')]);
  }
}

// ---- helpers ------------------------------------------------------------------------------------------------------

function fileNameOf(s: ImportSource, i: number): string {
  return typeof s.fileName === 'string' && s.fileName !== '' ? s.fileName : `file${i + 1}.dxf`;
}

/** Window cells of one floor, grouped into 4-connected components (one window each), in row-major order of first cell. */
function windowComponents(features: readonly RasterFeature[], cellType: Uint8Array, w: number, h: number): Int32Array[] {
  const n = w * h;
  const mask = new Uint8Array(n);
  for (const f of features) for (const c of f.cells) if (c >= 0 && c < n && cellType[c] !== CELL_DOOR) mask[c] = 1;
  const out: Int32Array[] = [];
  for (let start = 0; start < n; start++) {
    if (mask[start] !== 1) continue;
    const cells: number[] = [];
    const stack = [start];
    mask[start] = 2;
    while (stack.length > 0) {
      const c = stack.pop() as number;
      cells.push(c);
      const x = c % w;
      const nbs = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, c >= w ? c - w : -1, c + w < n ? c + w : -1];
      for (const nb of nbs) {
        if (nb >= 0 && mask[nb] === 1) {
          mask[nb] = 2;
          stack.push(nb);
        }
      }
    }
    out.push(Int32Array.from(cells).sort());
  }
  return out;
}

/** The two sides of a window: rooms (lowest first) and the outside, from the cells next to the window. Null if < 2. */
function windowSides(
  cells: Int32Array,
  edited: EditedFloor,
  rooms: readonly Room[],
): { a: string; b: string } | null {
  const { widthCells: w, heightCells: h } = edited;
  const own = new Set<number>(cells);
  const roomIdx = new Set<number>();
  let outside = false;
  for (const c of cells) {
    const x = c % w;
    const y = (c - x) / w;
    const nbs: [number, number][] = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of nbs) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
        outside = true; // beyond the grid edge counts as outside, as in rooms.ts
        continue;
      }
      const nc = ny * w + nx;
      if (own.has(nc)) continue;
      const r = edited.rooms.roomIndexOfCell[nc] as number;
      if (r >= 0) roomIdx.add(r);
      else if (edited.rooms.outsideCells[nc] === 1) outside = true;
    }
  }
  const ids = [...roomIdx].sort((p, q) => p - q).map((i) => (rooms[i] as Room).id);
  const sides = outside ? [...ids.slice(0, 1), OUTSIDE] : ids.slice(0, 2);
  const [a, b] = sides;
  if (a === undefined || b === undefined) return null;
  return { a, b };
}

/** The layer map with every `furniture` layer read as `ignore`. */
function withoutFurniture(map: LayerMap): LayerMap {
  return Object.fromEntries(Object.entries(map).map(([k, role]) => [k, role === 'furniture' ? 'ignore' : role])) as LayerMap;
}

/**
 * Cells of the furniture of one floor (Req 5.7): the rasterized outline of every furniture entity plus, for a closed
 * outline, every cell whose centre lies inside it (even-odd, straight edges; a bulge is read as its chord). Filling
 * makes a table one solid block instead of a ring around a sliver room.
 */
function furnitureCells(floorId: string, entities: readonly FlatEntity[], layerMap: LayerMap, grid: GridSpec): Set<number> {
  const out = new Set<number>();
  if (entities.length === 0) return out;
  const ras = rasterize({ floorId, entities, layerMap, grid });
  for (const f of ras.furniture) for (const c of f.cells) out.add(c);
  const outlines = entities.flatMap((e) => (e.kind === 'POLYLINE' && e.closed ? [e.vertices.map((v) => ({ xM: v.x, yM: v.y }))] : []));
  for (const p of proposeStairRegions(floorId, grid, outlines)) for (const c of p.cells) out.add(c);
  return out;
}

/** Door sides in canonical order: two rooms by model order (row-major first cell), the outside always second. */
function canonicalSides(a: string, b: string, order: ReadonlyMap<string, number>): [string, string] {
  if (a === OUTSIDE) return [b, a];
  if (b === OUTSIDE) return [a, b];
  return (order.get(a) ?? 0) <= (order.get(b) ?? 0) ? [a, b] : [b, a];
}

function allCellsStair(cells: Int32Array, grid: Uint8Array): boolean {
  if (cells.length === 0) return false;
  for (const c of cells) if (grid[c] !== CELL_STAIR) return false;
  return true;
}

// ---- pipeline -----------------------------------------------------------------------------------------------------

function run(sources: readonly ImportSource[], input: NormalizedSettings): ImportResult {
  const warnings: ImportWarning[] = [];
  const pending: PendingQuestion[] = [];
  let failed = false;

  if (sources.length === 0) return invalidResult([inputInvalid('no drawing is loaded')]);

  // 1. Read, unit, flatten, layer confirmation, per file.
  const files: FloorSourceFile[] = [];
  const layerMaps: Record<string, LayerMap> = {};
  const seenNames = new Set<string>();
  sources.forEach((src, i) => {
    const fileName = fileNameOf(src, i);
    if (seenNames.has(fileName)) {
      warnings.push(inputInvalid(`the file name "${fileName}" is used twice`));
      failed = true;
      return;
    }
    seenNames.add(fileName);
    const read = readDxf(src.text, fileName);
    if (read.status === 'invalid') {
      warnings.push(...read.errors, ...read.warnings);
      failed = true;
      return;
    }
    warnings.push(...read.warnings);
    const unit = resolveDrawingUnit(fileName, read.document.header, Object.hasOwn(input.drawingUnits, fileName) ? input.drawingUnits[fileName] : undefined);
    const resolved = unit.status === 'resolved';
    // A pending unit still needs a factor, so the layer question can be asked in the same round (Req 2.3, 5.4).
    const factor = unit.status === 'resolved' ? unit.metersPerUnit : METERS_PER_UNIT[unit.question.suggestedUnit];
    if (unit.status === 'pending') {
      pending.push(unit.question);
      warnings.push(unit.warning);
    }
    const flat = flattenEntities(read.document.drawing, { fileName, metersPerUnit: factor });
    if (!flat.ok) {
      warnings.push(flat.error);
      failed = true;
      return;
    }
    if (resolved) warnings.push(...flat.warnings);
    const map = Object.hasOwn(input.layerMaps, fileName) ? input.layerMaps[fileName] : undefined;
    const conf = checkLayerConfirmation(fileName, countEntitiesPerLayer(flat.entities), map);
    pending.push(...conf.pendingQuestions);
    warnings.push(...conf.warnings);
    if (map !== undefined) layerMaps[fileName] = map;
    if (resolved) files.push({ fileName, entitiesM: convertToMeters(flat.entities, factor) });
  });
  // Req 2.3, 5.4: while a question is open the model is withheld.
  if (failed || pending.length > 0) return invalidResult(warnings, pending);

  // 2. Floor sources and the common grid.
  const fsr = buildFloorSources(files, input.floorSources, { layerMaps, floorOffsetsM: input.floorOffsetsM });
  warnings.push(...fsr.warnings);
  if (fsr.status === 'invalid') return invalidResult(warnings);
  const sourceOf = new Map<string, FloorSource>(fsr.floors.map((f) => [f.floorId, f]));

  // 3. Floor settings (Req 10), floors bottom to top. The sort is stable, so equal elevations keep the user's order.
  const fsetRes = resolveFloorSettings(fsr.floors.map((f) => f.floorId), input.floorSettings);
  warnings.push(...fsetRes.warnings);
  const floorSettings: FloorSettings[] = fsetRes.floors.slice().sort((p, q) => p.elevationM - q.elevationM);

  // 4. Grid per floor: rasterize, close gaps, place doors, find window cells.
  const w = fsr.widthCells;
  const h = fsr.heightCells;
  const grid = { originXM: fsr.originXM, originYM: fsr.originYM, widthCells: w, heightCells: h };
  const editFloors: { floorId: string; widthCells: number; heightCells: number; cellType: Uint8Array; doors: DoorDraft[] }[] = [];
  const windowShells: Door[] = [];
  const windowCells = new Map<string, Int32Array>();
  for (const fl of floorSettings) {
    const src = sourceOf.get(fl.floorId) as FloorSource;
    const layerMap = Object.hasOwn(layerMaps, src.fileName) ? (layerMaps[src.fileName] as LayerMap) : {};
    // Structure first (walls and windows), furniture after the doors: furniture edges must not pair with wall lines,
    // close gaps or look like door jambs (design.md, task 14.1).
    const structuralMap = withoutFurniture(layerMap);
    const ras = rasterize({ floorId: fl.floorId, entities: src.entities, layerMap: structuralMap, grid });
    const gaps = closeGaps({ floorId: fl.floorId, entities: src.entities, layerMap: structuralMap, grid, cellType: ras.cellType });
    warnings.push(...gaps.warnings);
    const doors = placeDoors({ floorId: fl.floorId, widthCells: w, heightCells: h, originXM: fsr.originXM, originYM: fsr.originYM, cellType: gaps.cellType, entities: src.byRole.door });
    warnings.push(...doors.warnings);
    const cellType = doors.cellType;
    for (const c of furnitureCells(fl.floorId, src.byRole.furniture, layerMap, grid)) if (cellType[c] === CELL_FREE) cellType[c] = CELL_WALL; // Req 5.7
    editFloors.push({ floorId: fl.floorId, widthCells: w, heightCells: h, cellType, doors: doors.doors });
    windowComponents(ras.windows, doors.cellType, w, h).forEach((cells, k) => {
      const id = `${fl.floorId}:window${k + 1}`;
      windowCells.set(id, cells);
      windowShells.push({
        id,
        floorId: fl.floorId,
        cells,
        widthM: windowWidthM(cells, w), // Estimate: the longer side of the window's cell bounding box
        open: false, // Req 13.2: a window is closed until the user opens it
        roomIdA: OUTSIDE,
        roomIdB: OUTSIDE,
        isWindow: true,
        isExit: false,
      });
    });
  }

  // 5. Edits replay and rooms (Req 15). findRooms runs inside applyEdits, once per floor on the final grid.
  const edits: Edit[] = input.edits;
  const edited = applyEdits({ floors: editFloors, windows: windowShells, edits });
  warnings.push(...edited.warnings);
  const roomsOfFloor = new Map<string, Room[]>();
  const rooms: Room[] = [];
  for (const ef of edited.floors) {
    warnings.push(...ef.rooms.warnings);
    roomsOfFloor.set(ef.floorId, ef.rooms.rooms);
    rooms.push(...ef.rooms.rooms);
  }
  const editedOf = new Map<string, EditedFloor>(edited.floors.map((f) => [f.floorId, f]));
  const roomIndexIn = (floorId: string): Room[] => roomsOfFloor.get(floorId) ?? [];

  // Window sides come from the final grid. A window with fewer than two sides gives no vent (warning).
  const windows: Door[] = [];
  for (const wnd of edited.windows) {
    const ef = editedOf.get(wnd.floorId);
    const sides = ef === undefined ? null : windowSides(windowCells.get(wnd.id) as Int32Array, ef, roomIndexIn(wnd.floorId));
    if (sides === null) {
      warnings.push({ code: 'INPUT_INVALID', severity: 'warning', message: `Window ${wnd.id} does not separate two rooms or a room and the outside, so it gives no fire vent.`, location: { kind: 'floor', floorId: wnd.floorId } });
      continue;
    }
    windows.push({ ...wnd, roomIdA: sides.a, roomIdB: sides.b }); // already canonical: lowest room first, outside second
  }

  // 6. Stairs (Req 11). Regions: user input and rooms of kind `stair`. Only cells that lie in a room are kept, so every
  // stair cell has a room id and the crowd and fire sides share the compartment (design.md, task 14.1).
  const known = new Set(floorSettings.map((f) => f.floorId));
  const regions: StairRegionInput[] = [];
  for (const r of input.stairRegions) {
    if (!known.has(r.floorId)) {
      warnings.push(editIgnored(`the stair region on floor "${r.floorId}" was dropped because there is no such floor`));
      continue;
    }
    regions.push(r);
  }
  for (const r of rooms) {
    const reg = stairRegionFromRoom(r);
    if (reg !== null) regions.push(reg);
  }
  const inRoomRegions = regions.map((r): StairRegionInput => {
    const ef = editedOf.get(r.floorId) as EditedFloor;
    return { floorId: r.floorId, cells: r.cells.filter((c) => c >= 0 && c < ef.rooms.roomIndexOfCell.length && (ef.rooms.roomIndexOfCell[c] as number) >= 0) };
  });
  const stairs = resolveStairs({
    floors: floorSettings.map((f) => {
      const ef = editedOf.get(f.floorId) as EditedFloor;
      return { floorId: f.floorId, widthCells: ef.widthCells, heightCells: ef.heightCells, cellType: ef.rooms.cellType };
    }),
    regions: inRoomRegions,
    linkOverrides: input.stairLinkOverrides,
    roofVents: input.roofVents,
  });
  warnings.push(...stairs.warnings);
  const gridOf = new Map(stairs.floors.map((g) => [g.floorId, g]));
  // A room that the stair cells cover entirely is the stair compartment: kind `stair` (Req 11.7, 14.6).
  const finalRooms = rooms.map((r): Room => {
    const g = gridOf.get(r.floorId);
    return g !== undefined && r.kind !== 'stair' && allCellsStair(r.cells, g.cellType) ? { ...r, kind: 'stair' } : r;
  });

  // 7. Doors in model order and exit marks (Req 12). Windows follow the doors of the same floor. Sides are stored in a
  // canonical order: the lower room id first, the outside always second (design.md, task 14.1).
  const roomOrder = new Map<string, number>(finalRooms.map((r, i) => [r.id, i]));
  const plainDoors: Door[] = [];
  for (const ef of edited.floors) {
    for (const d of ef.rooms.doors) {
      const [roomIdA, roomIdB] = canonicalSides(d.roomIdA, d.roomIdB, roomOrder);
      plainDoors.push({ id: d.id, floorId: d.floorId, cells: d.cells, widthM: d.widthM, open: d.open, roomIdA, roomIdB, isWindow: false, isExit: false });
    }
  }
  const exits = applyExits(plainDoors, input.exitDoorIds);
  warnings.push(...exits.warnings);
  const doors: Door[] = [];
  for (const fl of floorSettings) {
    doors.push(...exits.doors.filter((d) => d.floorId === fl.floorId), ...windows.filter((d) => d.floorId === fl.floorId));
  }

  // 8. The model and its two derived outputs.
  const grids: BuildingModel['grids'] = {};
  for (const fl of floorSettings) {
    const g = gridOf.get(fl.floorId) as { widthCells: number; heightCells: number; cellType: Uint8Array };
    grids[fl.floorId] = { widthCells: g.widthCells, heightCells: g.heightCells, cellType: g.cellType };
  }
  const model: BuildingModel = {
    floors: floorSettings,
    floorSources: fsr.floors.map((f) => f.spec as FloorSourceSpec),
    layerMaps,
    grids,
    rooms: finalRooms,
    doors,
    stairLinks: stairs.links,
    edits: edits.slice(),
  };
  const plan = toPlanInput(model);
  const roofOpenings: RoofOpeningInput[] = stairs.roofOpenings;
  const fire = toFireGeometry(model, { roofOpenings });
  // The vent limit is checked once, with the other limits (Req 13.8, 17.6); the deriver's own VENT_LIMIT is dropped.
  const fireWarnings = fire.warnings.filter((wn) => wn.code !== 'VENT_LIMIT');
  warnings.push(...plan.warnings, ...fireWarnings);

  // 9. Limits in one pass (Req 17) and agreement of the two outputs (Req 14.8). Both run, so one result carries every
  // problem found.
  const limits = checkLimits({
    floorCount: floorSettings.length,
    compartmentCount: Math.max(finalRooms.length, fire.compartments.length),
    ventCount: fire.vents.length,
    grids: floorSettings.map((f) => ({ floorId: f.floorId, widthCells: (grids[f.floorId] as { widthCells: number }).widthCells, heightCells: (grids[f.floorId] as { heightCells: number }).heightCells })),
  });
  const broken = checkAgreement(model, plan.planInput, fire, fireWarnings);
  warnings.push(...limits.warnings, ...broken);
  if (limits.warnings.length > 0 || broken.length > 0) return invalidResult(warnings, [], limits.counts);
  return {
    status: 'ok',
    model,
    warnings,
    pendingQuestions: [],
    counts: limits.counts,
    derived: { planInput: plan.planInput, fire: { compartments: fire.compartments, vents: fire.vents } },
  };
}

function windowWidthM(cells: Int32Array, w: number): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of cells) {
    const x = c % w;
    const y = (c - x) / w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.max(maxX - minX + 1, maxY - minY + 1) * CELL_SIZE_M;
}

