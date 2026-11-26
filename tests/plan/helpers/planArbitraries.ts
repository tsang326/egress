// Test helper: random grid plans for the plan-import properties (Req 20.1, 20.8).
//
// A generated plan is a building of 1 to 3 floors. Every floor has the same wall layout: a grid of nx by ny
// rectangular rooms separated by one-cell-thick walls, inside a margin of free cells (the outside). Doors sit in the
// walls between rooms, exits in the outer wall. When the plan has a stair, room (0, 0) of every floor is the stair
// room, outlined on the stair layer, and floors f and f+1 are joined by one Stair_Link.
//
// The helper returns two things for each plan: the DXF text of each floor (written with ./dxfWriter) and what an
// importer must find again (Rooms, Doors, Exits, Stair_Links, wall masks). The expected values come from the layout
// numbers below, never from the code under test.
//
// Shrinking: a plan is built from a plain-data `GridPlanSpec` by the pure function `buildGridPlan`. The spec arbitrary
// uses fixed-size arrays and integers that are reduced modulo what fits, so fast-check shrinks toward one floor, one
// room, no optional doors, plain gaps, single-line walls, metres. All lengths are metres inside the helper.
import fc from 'fast-check';
import type {
  Door,
  DrawingUnit,
  FloorSettings,
  ImportSource,
  LayerMap,
  Room,
  StairLink,
  StairRegionInput,
} from '../../../src/core/plan/types';
import { doorBlock, rectOutline, writeDxf } from './dxfWriter';
import type { DxfBlock, DxfEntity } from './dxfWriter';

// ---- layout constants (fixture values, not model values) ---------------------------------------------------------

// Crowd Plan cell edge, Req 6 of the plan-import spec and crowd Req 1.1. Kept local so the helper does not import the
// code under test.
const CELL_M = 0.25;
// Smallest room interior edge in cells (1.5 m). Gives a room area of 2.25 m2, above the 1.0 m2 discard limit, and room
// for a door of up to 4 cells.
export const MIN_ROOM_CELLS = 6;
export const MAX_ROOM_CELLS = 12;
export const MIN_DOOR_CELLS = 2; // 0.5 m, the lowest width that gets no DOOR_WIDTH_RANGE warning
export const MAX_DOOR_CELLS = 4; // 1.0 m
export const MAX_GRID_ROOMS_PER_AXIS = 3;
// Free cells outside the building on every side. An exit door's swing arc or block can reach MAX_DOOR_CELLS cells out
// from the wall centre line, and the grid is the extent of every entity, so a margin of at least MAX_DOOR_CELLS keeps
// the grid the size the marker line says (the arc reaches MAX_DOOR_CELLS - 0.5 cells past the wall's outer face).
export const MIN_MARGIN_CELLS = MAX_DOOR_CELLS;
export const MAX_PLAN_FLOORS = 3;
// Up to 3 exits per floor keeps the vent count (doors + exits + stair vents) far below the fire limit of 60.
const MAX_EXITS_PER_FLOOR = 3;
const FLOOR_TO_FLOOR_M = 3.0; // fixture value
const CEILING_HEIGHT_M = 2.7; // fixture value, inside the 1.5 to 10 m range

export const WALL_LAYER = 'A-WALL';
export const DOOR_LAYER = 'A-DOOR';
export const STAIR_LAYER = 'A-FLOR-STRS';
// Holds one diagonal line over the whole grid, so the drawing extent (and with it the grid) includes the margin.
export const MARKER_LAYER = 'A-ANNO-MARK';
export const GRID_PLAN_LAYER_MAP: Readonly<LayerMap> = {
  [WALL_LAYER]: 'wall',
  [DOOR_LAYER]: 'door',
  [STAIR_LAYER]: 'stair',
  [MARKER_LAYER]: 'ignore',
};

// ---- spec (plain data) -------------------------------------------------------------------------------------------

export type WallStyle = 'line' | 'pair' | 'outline';
export type DoorStyle = 'gap' | 'block' | 'arc';
export const WALL_STYLES: readonly WallStyle[] = ['line', 'pair', 'outline'];
export const DOOR_STYLES: readonly DoorStyle[] = ['gap', 'block', 'arc'];
export const ALL_UNITS: readonly DrawingUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];

export interface DoorSpec {
  /** An optional door is only built when true. Doors that keep the building connected are built regardless. */
  present: boolean;
  /** Position along the wall segment: reduced modulo the room positions where the door fits. */
  offset: number;
  /** Door width in cells, MIN_DOOR_CELLS to MAX_DOOR_CELLS. */
  widthCells: number;
  style: DoorStyle;
  /** For block and arc doors: hinge at the far end of the gap (mirrored along the wall). */
  flipAlong: boolean;
  /** For block and arc doors: swing to the other side of the wall. */
  flipSwing: boolean;
}

export interface FloorSpec {
  /** 18 slots: 0..8 vertical walls (slot j*3+i, between room (i,j) and (i+1,j)); 9..17 horizontal walls
   * (slot 9 + j*3+i, between room (i,j) and (i,j+1)). Slots outside the room grid are unused. */
  internalDoors: DoorSpec[];
  /** 12 slots: side*3 + k with side 0 bottom, 1 top, 2 left, 3 right; k the room index along that side. Unused
   * slots are ignored; at most MAX_EXITS_PER_FLOOR are built. */
  exits: DoorSpec[];
}

export interface GridPlanSpec {
  colWidths: number[]; // interior width of each room column, cells
  rowHeights: number[]; // interior height of each room row, cells
  marginCells: number; // free cells outside the building on every side, at least MIN_MARGIN_CELLS
  wallStyle: WallStyle;
  unit: DrawingUnit;
  /** Ask for a stair room (0, 0) on every floor. Ignored with one floor. */
  withStair: boolean;
  floors: FloorSpec[]; // 1 to MAX_PLAN_FLOORS
}

// ---- result ------------------------------------------------------------------------------------------------------

export type ExpectedRoom = Omit<Room, 'name' | 'cells'> & {
  cells: Int32Array;
  /** Row-major position of the first cell; the room id is derived from the order of these. */
  firstCell: { x: number; y: number };
};
export type ExpectedDoor = Omit<Door, 'open'>;
export type ExpectedStairLink = Omit<StairLink, 'id'>;

export interface ExpectedFloor {
  floorId: string;
  fileName: string;
  widthCells: number;
  heightCells: number;
  /** 1 on wall cells (and on nothing else); door gaps, rooms, margin and the stair room are 0. */
  wallMask: Uint8Array;
  /** 1 on door and exit cells. */
  doorMask: Uint8Array;
}

export interface GridPlan {
  /** The spec after normalisation (see `normalizeSpec`). */
  spec: GridPlanSpec;
  files: ImportSource[]; // one per floor, in floor order
  floorSettings: FloorSettings[];
  layerMap: LayerMap;
  /** Grid size and masks of each floor, in floor order. */
  floors: ExpectedFloor[];
  expected: {
    rooms: ExpectedRoom[]; // sorted by id order (floor order, then row-major first cell)
    doors: ExpectedDoor[]; // includes exits
    exits: ExpectedDoor[]; // doors with isExit true
    stairLinks: ExpectedStairLink[];
    stairRegions: StairRegionInput[]; // the stair room interior on each floor that has a stair
  };
}

// ---- spec normalisation ------------------------------------------------------------------------------------------

/** Makes any spec buildable: sizes clamped to the allowed ranges, at least 1 and at most 3 floors, and a stair
 * plan with a single room gets a second room column (a stair on its own would have no door to anything). Pure. */
export function normalizeSpec(spec: GridPlanSpec): GridPlanSpec {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.trunc(v)));
  let colWidths = spec.colWidths.slice(0, MAX_GRID_ROOMS_PER_AXIS).map((v) => clamp(v, MIN_ROOM_CELLS, MAX_ROOM_CELLS));
  const rowHeights = spec.rowHeights.slice(0, MAX_GRID_ROOMS_PER_AXIS).map((v) => clamp(v, MIN_ROOM_CELLS, MAX_ROOM_CELLS));
  if (colWidths.length === 0) colWidths = [MIN_ROOM_CELLS];
  if (rowHeights.length === 0) rowHeights.push(MIN_ROOM_CELLS);
  const floors = spec.floors.slice(0, MAX_PLAN_FLOORS);
  const stairWanted = spec.withStair && floors.length > 1;
  if (stairWanted && colWidths.length * rowHeights.length === 1) colWidths = [...colWidths, MIN_ROOM_CELLS];
  return {
    colWidths,
    rowHeights,
    marginCells: clamp(spec.marginCells, MIN_MARGIN_CELLS, 8),
    wallStyle: spec.wallStyle,
    unit: spec.unit,
    withStair: stairWanted,
    floors,
  };
}

// ---- building one floor ------------------------------------------------------------------------------------------

interface Layout {
  nx: number;
  ny: number;
  wallCols: number[]; // cell column of each vertical wall, length nx + 1
  wallRows: number[]; // cell row of each horizontal wall, length ny + 1
  widthCells: number;
  heightCells: number;
}

function layoutOf(spec: GridPlanSpec): Layout {
  const wallCols = [spec.marginCells];
  for (const w of spec.colWidths) wallCols.push(wallCols[wallCols.length - 1]! + w + 1);
  const wallRows = [spec.marginCells];
  for (const h of spec.rowHeights) wallRows.push(wallRows[wallRows.length - 1]! + h + 1);
  return {
    nx: spec.colWidths.length,
    ny: spec.rowHeights.length,
    wallCols,
    wallRows,
    widthCells: wallCols[wallCols.length - 1]! + 1 + spec.marginCells,
    heightCells: wallRows[wallRows.length - 1]! + 1 + spec.marginCells,
  };
}

type RoomPos = readonly [i: number, j: number];

/** A door resolved to cells. `h`: the gap runs along x in wall row `fixed`; `v`: along y in wall column `fixed`. */
interface ResolvedDoor {
  dir: 'h' | 'v';
  fixed: number;
  start: number;
  lenCells: number;
  roomA: RoomPos;
  roomB: RoomPos | null; // null = outside
  style: DoorStyle;
  flipAlong: boolean;
  flipSwing: boolean;
}

const slot = (arr: readonly DoorSpec[], index: number): DoorSpec | undefined => arr[index];

function placeDoor(
  s: DoorSpec,
  dir: 'h' | 'v',
  fixed: number,
  spanStart: number,
  span: number,
  roomA: RoomPos,
  roomB: RoomPos | null,
): ResolvedDoor {
  const len = Math.min(Math.max(Math.trunc(s.widthCells), MIN_DOOR_CELLS), MAX_DOOR_CELLS, span);
  const fits = span - len + 1; // number of start positions, at least 1
  const start = spanStart + (Math.abs(Math.trunc(s.offset)) % fits);
  return { dir, fixed, start, lenCells: len, roomA, roomB, style: s.style, flipAlong: s.flipAlong, flipSwing: s.flipSwing };
}

const FALLBACK_DOOR: DoorSpec = { present: false, offset: 0, widthCells: MIN_DOOR_CELLS, style: 'gap', flipAlong: false, flipSwing: false };

function resolveDoors(spec: GridPlanSpec, lay: Layout, floor: FloorSpec, floorIndex: number): ResolvedDoor[] {
  const out: ResolvedDoor[] = [];
  const { nx, ny, wallCols, wallRows } = lay;
  // Doors that connect every room: the first row left to right, every other room to the room below it (lower y).
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const s = slot(floor.internalDoors, j * 3 + i) ?? FALLBACK_DOOR;
      if (!s.present && j !== 0) continue;
      out.push(placeDoor(s, 'v', wallCols[i + 1]!, wallRows[j]! + 1, spec.rowHeights[j]!, [i, j], [i + 1, j]));
    }
  }
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx; i++) {
      const s = slot(floor.internalDoors, 9 + j * 3 + i) ?? FALLBACK_DOOR;
      out.push(placeDoor(s, 'h', wallRows[j + 1]!, wallCols[i]! + 1, spec.colWidths[i]!, [i, j], [i, j + 1]));
    }
  }
  // Exits: slots in order, at most MAX_EXITS_PER_FLOOR. The ground floor always gets one (slot 0 when none is asked).
  const wanted: { side: number; k: number; s: DoorSpec }[] = [];
  for (let side = 0; side < 4; side++) {
    const count = side < 2 ? nx : ny;
    for (let k = 0; k < count; k++) {
      const s = slot(floor.exits, side * 3 + k) ?? FALLBACK_DOOR;
      if (s.present) wanted.push({ side, k, s });
    }
  }
  if (floorIndex === 0 && wanted.length === 0) wanted.push({ side: 0, k: 0, s: floor.exits[0] ?? FALLBACK_DOOR });
  for (const { side, k, s } of wanted.slice(0, MAX_EXITS_PER_FLOOR)) {
    if (side === 0) out.push(placeDoor(s, 'h', wallRows[0]!, wallCols[k]! + 1, spec.colWidths[k]!, [k, 0], null));
    else if (side === 1) out.push(placeDoor(s, 'h', wallRows[ny]!, wallCols[k]! + 1, spec.colWidths[k]!, [k, ny - 1], null));
    else if (side === 2) out.push(placeDoor(s, 'v', wallCols[0]!, wallRows[k]! + 1, spec.rowHeights[k]!, [0, k], null));
    else out.push(placeDoor(s, 'v', wallCols[nx]!, wallRows[k]! + 1, spec.rowHeights[k]!, [nx - 1, k], null));
  }
  return out;
}

function doorCells(d: ResolvedDoor, widthCells: number): number[] {
  const cells: number[] = [];
  for (let t = 0; t < d.lenCells; t++) cells.push(d.dir === 'h' ? d.fixed * widthCells + d.start + t : (d.start + t) * widthCells + d.fixed);
  return cells;
}

// ---- drawing -----------------------------------------------------------------------------------------------------

const m = (cells: number): number => cells * CELL_M;
const centre = (cell: number): number => (cell + 0.5) * CELL_M;

// One run of wall cells: cells `a..b` on the row (dir 'h') or column (dir 'v') `fixed`.
function wallRun(style: WallStyle, dir: 'h' | 'v', fixed: number, a: number, b: number): DxfEntity[] {
  const lo = m(a);
  const hi = m(b + 1);
  if (dir === 'h') {
    if (style === 'line') return [{ type: 'LINE', layer: WALL_LAYER, a: [lo, centre(fixed)], b: [hi, centre(fixed)] }];
    if (style === 'pair') {
      return [
        { type: 'LINE', layer: WALL_LAYER, a: [lo, m(fixed)], b: [hi, m(fixed)] },
        { type: 'LINE', layer: WALL_LAYER, a: [lo, m(fixed + 1)], b: [hi, m(fixed + 1)] },
      ];
    }
    return [rectOutline(WALL_LAYER, lo, m(fixed), hi, m(fixed + 1))];
  }
  if (style === 'line') return [{ type: 'LINE', layer: WALL_LAYER, a: [centre(fixed), lo], b: [centre(fixed), hi] }];
  if (style === 'pair') {
    return [
      { type: 'LINE', layer: WALL_LAYER, a: [m(fixed), lo], b: [m(fixed), hi] },
      { type: 'LINE', layer: WALL_LAYER, a: [m(fixed + 1), lo], b: [m(fixed + 1), hi] },
    ];
  }
  return [rectOutline(WALL_LAYER, m(fixed), lo, m(fixed + 1), hi)];
}

function wallEntities(style: WallStyle, lay: Layout, wall: Uint8Array): DxfEntity[] {
  const out: DxfEntity[] = [];
  const W = lay.widthCells;
  const x0 = lay.wallCols[0]!;
  const x1 = lay.wallCols[lay.nx]!;
  const y0 = lay.wallRows[0]!;
  const y1 = lay.wallRows[lay.ny]!;
  for (const row of lay.wallRows) {
    let runStart = -1;
    for (let x = x0; x <= x1 + 1; x++) {
      const on = x <= x1 && wall[row * W + x] === 1;
      if (on && runStart < 0) runStart = x;
      if (!on && runStart >= 0) {
        out.push(...wallRun(style, 'h', row, runStart, x - 1));
        runStart = -1;
      }
    }
  }
  for (const col of lay.wallCols) {
    let runStart = -1;
    for (let y = y0; y <= y1 + 1; y++) {
      const on = y <= y1 && wall[y * W + col] === 1;
      if (on && runStart < 0) runStart = y;
      if (!on && runStart >= 0) {
        out.push(...wallRun(style, 'v', col, runStart, y - 1));
        runStart = -1;
      }
    }
  }
  return out;
}

// Start angle of the quarter circle between the wall direction and the swing direction, counter-clockwise.
// `xs` and `ys` are the signs of the x and y extent of the quarter.
function quarterStart(xs: 1 | -1, ys: 1 | -1): number {
  if (xs === 1 && ys === 1) return 0;
  if (xs === -1 && ys === 1) return 90;
  if (xs === -1 && ys === -1) return 180;
  return 270;
}

// Door leaf and swing of one door, as an INSERT of a block (style 'block') or a bare ARC (style 'arc').
// The hinge is at one end of the gap on the wall centre line; the arc radius equals the gap width, so the arc ends on
// the wall line at the other end of the gap. Which end, and which side of the wall, come from the two flip flags.
function doorGraphics(d: ResolvedDoor, blocks: Map<string, DxfBlock>): DxfEntity[] {
  if (d.style === 'gap') return [];
  const widthM = m(d.lenCells);
  const along = d.flipAlong ? -1 : 1;
  const side = d.flipSwing ? -1 : 1;
  const startM = m(d.start);
  const endM = m(d.start + d.lenCells);
  const hinge = d.flipAlong ? endM : startM;
  const cross = centre(d.fixed);
  if (d.style === 'arc') {
    const startDeg = d.dir === 'h' ? quarterStart(along, side) : quarterStart(side, along);
    const center: readonly [number, number] = d.dir === 'h' ? [hinge, cross] : [cross, hinge];
    return [{ type: 'ARC', layer: DOOR_LAYER, center, radiusM: widthM, startDeg, endDeg: startDeg + 90 }];
  }
  const name = `DOOR${d.lenCells}`;
  if (!blocks.has(name)) blocks.set(name, doorBlock(name, widthM, DOOR_LAYER));
  return [
    {
      type: 'INSERT',
      layer: DOOR_LAYER,
      block: name,
      at: d.dir === 'h' ? [hinge, cross] : [cross, hinge],
      scaleX: along,
      scaleY: side,
      rotationDeg: d.dir === 'h' ? 0 : 90,
    },
  ];
}

// ---- the builder -------------------------------------------------------------------------------------------------

interface FloorBuild {
  expectedFloor: ExpectedFloor;
  source: ImportSource;
  rooms: { pos: RoomPos; firstIndex: number; cells: Int32Array; w: number; h: number }[];
  doors: { rd: ResolvedDoor; cells: Int32Array }[];
}

function buildFloor(spec: GridPlanSpec, lay: Layout, floorIndex: number): FloorBuild {
  const W = lay.widthCells;
  const H = lay.heightCells;
  const floorId = `floor${floorIndex + 1}`;
  const fileName = `${floorId}.dxf`;
  const resolved = resolveDoors(spec, lay, spec.floors[floorIndex]!, floorIndex);

  const wall = new Uint8Array(W * H);
  const x0 = lay.wallCols[0]!;
  const x1 = lay.wallCols[lay.nx]!;
  const y0 = lay.wallRows[0]!;
  const y1 = lay.wallRows[lay.ny]!;
  for (const row of lay.wallRows) for (let x = x0; x <= x1; x++) wall[row * W + x] = 1;
  for (const col of lay.wallCols) for (let y = y0; y <= y1; y++) wall[y * W + col] = 1;
  const doorMask = new Uint8Array(W * H);
  const doors = resolved.map((rd) => ({ rd, cells: Int32Array.from(doorCells(rd, W)) }));
  for (const d of doors) {
    for (const c of d.cells) {
      wall[c] = 0;
      doorMask[c] = 1;
    }
  }

  const blocks = new Map<string, DxfBlock>();
  const entities: DxfEntity[] = [
    { type: 'LINE', layer: MARKER_LAYER, a: [0, 0], b: [m(W), m(H)] },
    ...wallEntities(spec.wallStyle, lay, wall),
  ];
  for (const d of doors) entities.push(...doorGraphics(d.rd, blocks));
  const hasStair = spec.withStair;
  if (hasStair) {
    entities.push(rectOutline(STAIR_LAYER, m(lay.wallCols[0]! + 1), m(lay.wallRows[0]! + 1), m(lay.wallCols[1]!), m(lay.wallRows[1]!)));
  }
  const text = writeDxf({ entities, blocks: [...blocks.values()], unit: spec.unit });

  const rooms: FloorBuild['rooms'] = [];
  for (let j = 0; j < lay.ny; j++) {
    for (let i = 0; i < lay.nx; i++) {
      const w = spec.colWidths[i]!;
      const h = spec.rowHeights[j]!;
      const left = lay.wallCols[i]! + 1;
      const bottom = lay.wallRows[j]! + 1;
      const cells: number[] = [];
      for (let y = bottom; y < bottom + h; y++) for (let x = left; x < left + w; x++) cells.push(y * W + x);
      rooms.push({ pos: [i, j], firstIndex: bottom * W + left, cells: Int32Array.from(cells), w, h });
    }
  }
  rooms.sort((a, b) => a.firstIndex - b.firstIndex);

  return {
    expectedFloor: { floorId, fileName, widthCells: W, heightCells: H, wallMask: wall, doorMask },
    source: { fileName, text },
    rooms,
    doors,
  };
}

// Ids count from 1 in row-major order of the first cell, like the crowd gate labels (gatesFromPlan.ts).
const ID_BASE = 1;

/** Builds the DXF text and the expected import result for a spec. Pure and deterministic. */
export function buildGridPlan(specIn: GridPlanSpec): GridPlan {
  const spec = normalizeSpec(specIn);
  const lay = layoutOf(spec);
  const builds = spec.floors.map((_, f) => buildFloor(spec, lay, f));

  const rooms: ExpectedRoom[] = [];
  const doors: ExpectedDoor[] = [];
  const stairRegions: StairRegionInput[] = [];
  const stairCells = new Map<string, Int32Array>();

  builds.forEach((b) => {
    const { floorId, widthCells } = b.expectedFloor;
    const idOf = new Map<string, string>();
    b.rooms.forEach((r, k) => idOf.set(`${r.pos[0]},${r.pos[1]}`, `${floorId}:room${k + ID_BASE}`));
    for (const r of b.rooms) {
      const isStair = spec.withStair && r.pos[0] === 0 && r.pos[1] === 0;
      if (isStair) {
        stairRegions.push({ floorId, cells: r.cells });
        stairCells.set(floorId, r.cells);
      }
      rooms.push({
        id: idOf.get(`${r.pos[0]},${r.pos[1]}`)!,
        floorId,
        kind: isStair ? 'stair' : 'room',
        cells: r.cells,
        areaM2: r.w * r.h * CELL_M * CELL_M,
        bboxWidthM: r.w * CELL_M,
        bboxHeightM: r.h * CELL_M,
        touchesBorder: false,
        firstCell: { x: r.firstIndex % widthCells, y: Math.floor(r.firstIndex / widthCells) },
      });
    }
    const sorted = b.doors.slice().sort((p, q) => p.cells[0]! - q.cells[0]!);
    sorted.forEach((d, k) => {
      const a = idOf.get(`${d.rd.roomA[0]},${d.rd.roomA[1]}`)!;
      const bId = d.rd.roomB === null ? 'OUTSIDE' : idOf.get(`${d.rd.roomB[0]},${d.rd.roomB[1]}`)!;
      // Room ids order like their first cells, so the lower id comes first; the outside is always second.
      const [roomIdA, roomIdB] = bId === 'OUTSIDE' || a < bId ? [a, bId] : [bId, a];
      doors.push({
        id: `${floorId}:door${k + ID_BASE}`,
        floorId,
        cells: d.cells,
        widthM: d.rd.lenCells * CELL_M,
        roomIdA,
        roomIdB,
        isWindow: false,
        isExit: d.rd.roomB === null,
      });
    });
  });

  const stairLinks: ExpectedStairLink[] = [];
  if (spec.withStair) {
    const s0 = spec.colWidths[0]!;
    const h0 = spec.rowHeights[0]!;
    for (let f = 0; f + 1 < builds.length; f++) {
      const lower = builds[f]!.expectedFloor.floorId;
      const upper = builds[f + 1]!.expectedFloor.floorId;
      stairLinks.push({ lowerFloorId: lower, upperFloorId: upper, footprint: stairCells.get(lower)!, widthM: Math.min(s0, h0) * CELL_M });
    }
  }

  const floorSettings: FloorSettings[] = builds.map((b, f) => ({
    floorId: b.expectedFloor.floorId,
    name: `Floor ${f + 1}`,
    elevationM: f * FLOOR_TO_FLOOR_M,
    ceilingHeightM: CEILING_HEIGHT_M,
  }));

  return {
    spec,
    files: builds.map((b) => b.source),
    floorSettings,
    layerMap: { ...GRID_PLAN_LAYER_MAP },
    floors: builds.map((b) => b.expectedFloor),
    expected: { rooms, doors, exits: doors.filter((d) => d.isExit), stairLinks, stairRegions },
  };
}

// ---- arbitraries -------------------------------------------------------------------------------------------------

export interface GridPlanOptions {
  maxFloors?: number; // 1 to MAX_PLAN_FLOORS, default MAX_PLAN_FLOORS
  maxRoomsPerAxis?: number; // 1 to MAX_GRID_ROOMS_PER_AXIS, default MAX_GRID_ROOMS_PER_AXIS
  wallStyles?: readonly WallStyle[]; // default all three
  doorStyles?: readonly DoorStyle[]; // default all three
  units?: readonly DrawingUnit[]; // default metres only; pass ALL_UNITS for Req 20.2
  /** true: always a stair when there are 2+ floors; false: never; default: random. */
  withStair?: boolean;
}

export function doorSpecArb(styles: readonly DoorStyle[] = DOOR_STYLES): fc.Arbitrary<DoorSpec> {
  return fc.record({
    present: fc.boolean(),
    offset: fc.nat(40),
    widthCells: fc.integer({ min: MIN_DOOR_CELLS, max: MAX_DOOR_CELLS }),
    style: fc.constantFrom(...styles),
    flipAlong: fc.boolean(),
    flipSwing: fc.boolean(),
  });
}

export function floorSpecArb(styles: readonly DoorStyle[] = DOOR_STYLES): fc.Arbitrary<FloorSpec> {
  return fc.record({
    internalDoors: fc.array(doorSpecArb(styles), { minLength: 18, maxLength: 18 }),
    exits: fc.array(doorSpecArb(styles), { minLength: 12, maxLength: 12 }),
  });
}

/** Arbitrary for the plain-data spec. Shrinks toward one floor, one room, plain gaps, line walls, metres. */
export function gridPlanSpecArb(options: GridPlanOptions = {}): fc.Arbitrary<GridPlanSpec> {
  const maxFloors = Math.min(MAX_PLAN_FLOORS, Math.max(1, options.maxFloors ?? MAX_PLAN_FLOORS));
  const maxAxis = Math.min(MAX_GRID_ROOMS_PER_AXIS, Math.max(1, options.maxRoomsPerAxis ?? MAX_GRID_ROOMS_PER_AXIS));
  const doorStyles = options.doorStyles ?? DOOR_STYLES;
  const roomSize = fc.integer({ min: MIN_ROOM_CELLS, max: MAX_ROOM_CELLS });
  const stair = options.withStair === undefined ? fc.boolean() : fc.constant(options.withStair);
  return fc.record({
    colWidths: fc.array(roomSize, { minLength: 1, maxLength: maxAxis }),
    rowHeights: fc.array(roomSize, { minLength: 1, maxLength: maxAxis }),
    marginCells: fc.integer({ min: MIN_MARGIN_CELLS, max: MIN_MARGIN_CELLS + 3 }),
    wallStyle: fc.constantFrom(...(options.wallStyles ?? WALL_STYLES)),
    unit: fc.constantFrom(...(options.units ?? (['m'] as const))),
    withStair: stair,
    floors: fc.array(floorSpecArb(doorStyles), { minLength: 1, maxLength: maxFloors }),
  });
}

/** Arbitrary for a full plan: DXF text per floor plus the expected Rooms, Doors, Exits and Stair_Links. */
export function gridPlanArb(options: GridPlanOptions = {}): fc.Arbitrary<GridPlan> {
  return gridPlanSpecArb(options).map(buildGridPlan);
}
