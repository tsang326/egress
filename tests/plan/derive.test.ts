// Unit tests for toPlanInput and toFireGeometry on hand-built models (tasks.md 13.5).
// Validates: Requirements 11.8, 11.10, 12.3, 12.4, 13.2, 13.6, 13.7, 13.8, 13.9, 20.10.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Scenario, WallVent, CeilingFloorVent } from '../../src/core/fire/types';
import { validate } from '../../src/core/fire/validate/validate';
import { DOOR_VENT_SILL_M, DOOR_VENT_SOFFIT_M, WINDOW_VENT_SILL_M, WINDOW_VENT_SOFFIT_M } from '../../src/core/plan/constants';
import { roofVentIdOf, toFireGeometry, ventIdOf } from '../../src/core/plan/derive/toFireGeometry';
import { toPlanInput } from '../../src/core/plan/derive/toPlanInput';
import { FIRE_MAX_VENTS } from '../../src/core/plan/limits';
import type { BuildingModel, Door, Room } from '../../src/core/plan/types';
import { buildPlan } from '../../src/core/people/plan/builder';
import { CELL_DOOR, CELL_EXIT, CELL_FREE, CELL_STAIR, CELL_WALL } from '../../src/core/people/types';
import { CELL_SIZE_M } from '../../src/core/people/constants';
import { arbScenario } from '../fire/arbitraries';

const CEILING_M = 2.6;

// ---- Hand-built models ---------------------------------------------------------------------------------------------
// One floor, 44 x 20 cells. Outside margin x 0..1 and 42..43 is free floor. Outer wall x = 2 and x = 41, interior wall
// x = 21..22, room1 = x 3..20, room2 = x 23..40, both y 1..18 (4.5 m x 4.5 m).

const W = 44;
const H = 20;
const idx = (x: number, y: number): number => y * W + x;
const rect = (x0: number, x1: number, y0: number, y1: number): number[] => {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(idx(x, y));
  return out;
};
const roomOf = (id: string, cells: number[], over: Partial<Room> = {}): Room => ({
  id,
  floorId: 'f1',
  name: id,
  kind: 'room',
  cells: Int32Array.from(cells),
  areaM2: cells.length * CELL_SIZE_M * CELL_SIZE_M,
  bboxWidthM: 18 * CELL_SIZE_M,
  bboxHeightM: 18 * CELL_SIZE_M,
  touchesBorder: false,
  ...over,
});
const doorOf = (id: string, cells: number[], over: Partial<Door> = {}): Door => ({
  id,
  floorId: 'f1',
  cells: Int32Array.from(cells),
  widthM: 1,
  open: true,
  roomIdA: 'room1',
  roomIdB: 'room2',
  isWindow: false,
  isExit: false,
  ...over,
});

function twoRoomModel(doors: Door[]): BuildingModel {
  const cellType = new Uint8Array(W * H).fill(CELL_WALL);
  for (const c of [...rect(0, 1, 0, H - 1), ...rect(42, 43, 0, H - 1)]) cellType[c] = CELL_FREE;
  for (const c of [...rect(3, 20, 1, 18), ...rect(23, 40, 1, 18)]) cellType[c] = CELL_FREE;
  for (const d of doors) for (const c of d.cells) cellType[c] = CELL_DOOR;
  return {
    floors: [{ floorId: 'f1', name: 'Ground', elevationM: 0, ceilingHeightM: CEILING_M }],
    floorSources: [],
    layerMaps: {},
    grids: { f1: { widthCells: W, heightCells: H, cellType } },
    rooms: [roomOf('room1', rect(3, 20, 1, 18)), roomOf('room2', rect(23, 40, 1, 18))],
    doors,
    stairLinks: [],
    edits: [],
  };
}

const innerDoor = (over: Partial<Door> = {}): Door => doorOf('door1', rect(21, 22, 8, 11), over);
const exitDoor = (over: Partial<Door> = {}): Door =>
  doorOf('exit1', rect(2, 2, 8, 11), { roomIdA: 'room1', roomIdB: 'OUTSIDE', isExit: true, ...over });
const windowOf = (id: string, over: Partial<Door> = {}): Door =>
  doorOf(id, rect(41, 41, 8, 11), { roomIdA: 'room2', roomIdB: 'OUTSIDE', isWindow: true, open: false, ...over });

// Two floors, 12 x 12 cells. Stair room: x 1..8, y 1..8 (2 m x 2 m, 4 m2); footprint x 1..4 (2 m2) on both floors.
const SW = 12;
function stairModel(upperElevationM: number): BuildingModel {
  const sidx = (x: number, y: number): number => y * SW + x;
  const cells: number[] = [];
  for (let y = 1; y <= 8; y++) for (let x = 1; x <= 8; x++) cells.push(sidx(x, y));
  const footprint: number[] = [];
  for (let y = 1; y <= 8; y++) for (let x = 1; x <= 4; x++) footprint.push(sidx(x, y));
  const mkGrid = () => {
    const cellType = new Uint8Array(SW * SW).fill(CELL_WALL);
    for (const c of cells) cellType[c] = CELL_FREE;
    return { widthCells: SW, heightCells: SW, cellType };
  };
  const stairRoom = (id: string, floorId: string): Room => ({
    id,
    floorId,
    name: id,
    kind: 'stair',
    cells: Int32Array.from(cells),
    areaM2: 4,
    bboxWidthM: 2,
    bboxHeightM: 2,
    touchesBorder: false,
  });
  return {
    floors: [
      { floorId: 'f1', name: 'Ground', elevationM: 0, ceilingHeightM: CEILING_M },
      { floorId: 'f2', name: 'First', elevationM: upperElevationM, ceilingHeightM: CEILING_M },
    ],
    floorSources: [],
    layerMaps: {},
    grids: { f1: mkGrid(), f2: mkGrid() },
    rooms: [stairRoom('stair1', 'f1'), stairRoom('stair2', 'f2')],
    doors: [],
    stairLinks: [{ id: 'f1:f2:stair', lowerFloorId: 'f1', upperFloorId: 'f2', footprint: Int32Array.from(footprint), widthM: 1 }],
    edits: [],
  };
}

// ---- Validators (read only) ----------------------------------------------------------------------------------------
const base = fc.sample(arbScenario(), { numRuns: 1, seed: 1 })[0]!;
function fireErrors(model: BuildingModel, roofFloor?: string): string[] {
  const g = toFireGeometry(model, roofFloor ? { roofOpenings: [{ floorId: roofFloor, areaM2: 1, openFraction: 1 }] } : undefined);
  const first = g.compartments[0]!;
  const scenario: Scenario = {
    ...structuredClone(base),
    compartments: g.compartments,
    vents: g.vents,
    fires: base.fires.slice(0, 1).map((f) => ({ ...f, compartmentId: first.id, xM: first.widthM / 2, yM: first.depthM / 2 })),
    unsupported: [],
  };
  return validate(scenario).warnings
    .filter((w) => w.severity === 'error' && /VENT|COMPARTMENT|ELEVATION|STACK/.test(w.code))
    .map((w) => `${w.code}: ${w.message}`);
}

describe('toPlanInput', () => {
  it('open interior door keeps door cells; closed door becomes wall (Req 13.6)', () => {
    const open = toPlanInput(twoRoomModel([innerDoor()]));
    const closed = toPlanInput(twoRoomModel([innerDoor({ open: false })]));
    const cells = rect(21, 22, 8, 11);
    for (const c of cells) {
      expect(open.planInput.floors[0]!.cells[c]).toBe(CELL_DOOR);
      expect(open.planInput.floors[0]!.compartmentIds[c]).toBe('room1');
      expect(closed.planInput.floors[0]!.cells[c]).toBe(CELL_WALL);
      expect(closed.planInput.floors[0]!.compartmentIds[c]).toBeNull();
    }
    expect(open.warnings).toEqual([]);
    expect(closed.warnings).toEqual([]);
  });

  it('window cells are wall whether open or closed (Req 5.6)', () => {
    for (const open of [false, true]) {
      const r = toPlanInput(twoRoomModel([windowOf('w1', { open })]));
      for (const c of rect(41, 41, 8, 11)) expect(r.planInput.floors[0]!.cells[c]).toBe(CELL_WALL);
    }
  });

  it('confirmed exit: door cells and matching outside cells are exit (Req 12.3)', () => {
    const r = toPlanInput(twoRoomModel([exitDoor()]));
    const f = r.planInput.floors[0]!;
    for (const c of rect(2, 2, 8, 11)) expect(f.cells[c]).toBe(CELL_EXIT);
    for (const c of rect(1, 1, 8, 11)) expect(f.cells[c]).toBe(CELL_EXIT);
    // Other outside cells become wall (run-view spec Req 8: outside ground is not part of a route); the room side
    // stays free.
    expect(f.cells[idx(1, 7)]).toBe(CELL_WALL);
    expect(f.cells[idx(0, 9)]).toBe(CELL_WALL);
    expect(f.cells[idx(3, 9)]).toBe(CELL_FREE);
  });

  it('a closed exit door stays wall and adds no outside exit cells', () => {
    const f = toPlanInput(twoRoomModel([exitDoor({ open: false })])).planInput.floors[0]!;
    for (const c of rect(2, 2, 8, 11)) expect(f.cells[c]).toBe(CELL_WALL);
    for (const c of rect(1, 1, 8, 11)) expect(f.cells[c]).toBe(CELL_WALL); // outside ground, not an exit
  });

  it('passes the crowd buildPlan, with the exit as a gate (Req 20.10)', () => {
    const { planInput } = toPlanInput(twoRoomModel([innerDoor(), exitDoor()]));
    const plan = buildPlan(planInput);
    expect(plan.warnings.filter((w) => w.severity === 'error')).toEqual([]);
    expect(plan.status).toBe('valid');
  });

  it('stair links: footprint is stair on both floors, link keeps both floor ids (Req 14.5)', () => {
    const { planInput, warnings } = toPlanInput(stairModel(CEILING_M));
    expect(warnings).toEqual([]);
    expect(planInput.stairLinks).toEqual([{ id: 'f1:f2:stair', lowerFloorId: 'f1', upperFloorId: 'f2', widthM: 1 }]);
    for (const f of planInput.floors) {
      expect(f.cells[SW + 1]).toBe(CELL_STAIR);
      expect(f.cells[SW + 6]).toBe(CELL_FREE);
    }
    expect(planInput.compartments?.find((c) => c.id === 'stair1')?.kind).toBe('shaft');
    expect(buildPlan(planInput).status).toBe('valid');
  });
});

describe('toFireGeometry wall vents', () => {
  it('interior door: one vent, from is the lower room, door width, door heights, open 1 (Req 13.1, 13.5)', () => {
    const g = toFireGeometry(twoRoomModel([innerDoor()]));
    expect(g.warnings).toEqual([]);
    expect(g.vents).toHaveLength(1);
    const v = g.vents[0] as WallVent;
    expect(v).toMatchObject({ kind: 'wall', id: 'door1:vent', from: 'room1', to: 'room2', widthM: 1, face: 'right', open: 1 });
    expect(v.sillM).toBe(DOOR_VENT_SILL_M);
    expect(v.soffitM).toBe(DOOR_VENT_SOFFIT_M);
    // Centred at y = 10 cells of 1..18: 2.25 m along the wall, so offset 2.25 - 0.5.
    expect(v.offsetM).toBeCloseTo(1.75, 9);
    expect(fireErrors(twoRoomModel([innerDoor()]))).toEqual([]);
  });

  it('`from` is the lower room even when the door lists the rooms the other way round', () => {
    const v = toFireGeometry(twoRoomModel([innerDoor({ roomIdA: 'room2', roomIdB: 'room1' })])).vents[0] as WallVent;
    expect(v.from).toBe('room1');
    expect(v.to).toBe('room2');
  });

  it('closed door: vent with open 0 and a wall in the crowd plan (Req 13.6)', () => {
    const model = twoRoomModel([innerDoor({ open: false })]);
    const v = toFireGeometry(model).vents[0] as WallVent;
    expect(v.open).toBe(0);
    expect(toPlanInput(model).planInput.floors[0]!.cells[idx(21, 9)]).toBe(CELL_WALL);
  });

  it('window: closed gives no vent, open gives an OUTSIDE vent with window heights (Req 13.2)', () => {
    expect(toFireGeometry(twoRoomModel([windowOf('w1')])).vents).toEqual([]);
    const model = twoRoomModel([windowOf('w1', { open: true })]);
    const g = toFireGeometry(model);
    expect(g.vents).toHaveLength(1);
    expect(g.vents[0]).toMatchObject({
      kind: 'wall',
      id: 'w1:vent',
      from: 'room2',
      to: 'OUTSIDE',
      sillM: WINDOW_VENT_SILL_M,
      soffitM: WINDOW_VENT_SOFFIT_M,
      face: 'right',
      open: 1,
    });
    expect(fireErrors(model)).toEqual([]);
  });

  it('confirmed exit: vent to OUTSIDE from the room, on the nearest side (Req 12.4)', () => {
    const model = twoRoomModel([exitDoor()]);
    const g = toFireGeometry(model);
    expect(g.vents[0]).toMatchObject({ id: 'exit1:vent', from: 'room1', to: 'OUTSIDE', face: 'left', open: 1 });
    expect(fireErrors(model)).toEqual([]);
  });

  it('vent wider than the wall is clamped to the wall length with VENT_WIDTH_CLAMPED (Req 13.7)', () => {
    const model = twoRoomModel([innerDoor({ widthM: 6 })]);
    const g = toFireGeometry(model);
    const v = g.vents[0] as WallVent;
    expect(v.widthM).toBe(4.5);
    expect(v.offsetM).toBe(0);
    const w = g.warnings.filter((x) => x.code === 'VENT_WIDTH_CLAMPED');
    expect(w).toHaveLength(1);
    expect(w[0]!.severity).toBe('warning');
    expect(w[0]!.message).toContain('door1:vent');
    expect(w[0]!.message).toContain('4.5');
    expect(fireErrors(model)).toEqual([]);
  });

  it('vent ids are `${id}:vent` and unique (Req 13.9)', () => {
    expect(ventIdOf('d7')).toBe('d7:vent');
    const g = toFireGeometry(twoRoomModel([innerDoor(), exitDoor(), windowOf('w1', { open: true })]));
    expect(g.vents.map((v) => v.id).sort()).toEqual(['door1:vent', 'exit1:vent', 'w1:vent']);
  });

  it('more vents than the fire limit give an error VENT_LIMIT naming the count (Req 13.8)', () => {
    const count = FIRE_MAX_VENTS + 1;
    const windows = Array.from({ length: count }, (_, i) => windowOf(`w${i}`, { open: true }));
    const g = toFireGeometry(twoRoomModel(windows));
    expect(g.vents).toHaveLength(count);
    const w = g.warnings.filter((x) => x.code === 'VENT_LIMIT');
    expect(w).toHaveLength(1);
    expect(w[0]!.severity).toBe('error');
    expect(w[0]!.message).toContain(String(count));
    // Exactly at the limit: no warning.
    const atLimit = toFireGeometry(twoRoomModel(windows.slice(0, FIRE_MAX_VENTS)));
    expect(atLimit.warnings.filter((x) => x.code === 'VENT_LIMIT')).toEqual([]);
  });

  it('is deterministic (Req 14.7)', () => {
    const model = twoRoomModel([innerDoor(), exitDoor(), windowOf('w1', { open: true })]);
    expect(toFireGeometry(model)).toEqual(toFireGeometry(model));
  });
});

describe('toFireGeometry stairs and roof', () => {
  it('stair compartments are shafts with isStair (Req 11.7)', () => {
    const g = toFireGeometry(stairModel(CEILING_M));
    expect(g.compartments.map((c) => [c.id, c.kind, c.isStair])).toEqual([
      ['stair1', 'shaft', true],
      ['stair2', 'shaft', true],
    ]);
  });

  it('CeilingFloorVent: footprint area, open 1, upper elevation = lower elevation + lower height (Req 11.8)', () => {
    // The upper floor setting is 0.1 m too high; the compartment elevation is forced to 2.6.
    const g = toFireGeometry(stairModel(2.7));
    const v = g.vents[0] as CeilingFloorVent;
    expect(v).toMatchObject({ kind: 'ceilingFloor', id: 'f1:f2:stair:vent', lower: 'stair1', upper: 'stair2', open: 1 });
    expect(v.areaM2).toBeCloseTo(32 * CELL_SIZE_M * CELL_SIZE_M, 12);
    const lower = g.compartments.find((c) => c.id === 'stair1')!;
    const upper = g.compartments.find((c) => c.id === 'stair2')!;
    expect(upper.floorElevationM).toBe(lower.floorElevationM + lower.heightM);
    expect(upper.floorElevationM).toBeCloseTo(2.6, 12);
    expect(fireErrors(stairModel(CEILING_M))).toEqual([]);
  });

  it('roof opening: CeilingFloorVent from the top stair compartment to OUTSIDE (Req 11.10)', () => {
    const model = stairModel(CEILING_M);
    const g = toFireGeometry(model, { roofOpenings: [{ floorId: 'f2', areaM2: 1, openFraction: 0.5 }] });
    const roof = g.vents.find((v) => v.id === roofVentIdOf('f2')) as CeilingFloorVent;
    expect(roof).toMatchObject({ kind: 'ceilingFloor', lower: 'stair2', upper: 'OUTSIDE', areaM2: 1, open: 0.5 });
    expect(g.vents).toHaveLength(2);
    expect(fireErrors(model, 'f2')).toEqual([]);
  });

  it('a roof opening on a floor without a stair compartment is dropped with a warning', () => {
    const g = toFireGeometry(stairModel(CEILING_M), { roofOpenings: [{ floorId: 'f9', areaM2: 1, openFraction: 1 }] });
    expect(g.vents).toHaveLength(1);
    expect(g.warnings.map((w) => w.code)).toContain('EDIT_IGNORED');
  });

  it('door between a stair compartment and a room is a wall vent', () => {
    const model = twoRoomModel([innerDoor()]);
    model.rooms[1] = { ...model.rooms[1]!, kind: 'stair' };
    const g = toFireGeometry(model);
    expect(g.compartments.find((c) => c.id === 'room2')).toMatchObject({ kind: 'shaft', isStair: true });
    expect(g.vents[0]).toMatchObject({ kind: 'wall', from: 'room1', to: 'room2' });
  });
});
