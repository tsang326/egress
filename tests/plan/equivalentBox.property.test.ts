// Feature: plan-import, Property 10: Equivalent box matches Room area and aspect ratio.
// Validates: Requirements 9.2, 9.5, 9.7, 9.8, 20.8
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE_M } from '../../src/core/people/constants';
import { buildPlan } from '../../src/core/people/plan/builder';
import { CELL_FREE, CELL_WALL } from '../../src/core/people/types';
import type { Scenario } from '../../src/core/fire/types';
import { validate } from '../../src/core/fire/validate/validate';
import { roomToCompartment } from '../../src/core/plan/derive/equivalentBox';
import { toFireGeometry } from '../../src/core/plan/derive/toFireGeometry';
import { toPlanInput } from '../../src/core/plan/derive/toPlanInput';
import type { BuildingModel, Door, Room } from '../../src/core/plan/types';
import { arbScenario } from '../fire/arbitraries';

const base = fc.sample(arbScenario(), { numRuns: 1, seed: 1 })[0]!;

interface Shape {
  w: number; // room width in cells
  h: number; // room height in cells
  notchW: number; // missing corner block, in cells (0 = rectangle)
  notchH: number;
  kind: 'room' | 'corridor';
  ceilingHeightM: number;
  elevationM: number;
}

// Rooms from 3 m x 2 m up to 12 m x 9 m; an optional corner notch keeps the bounding box but lowers the area.
const arbShape: fc.Arbitrary<Shape> = fc
  .record({
    w: fc.integer({ min: 12, max: 48 }),
    h: fc.integer({ min: 8, max: 36 }),
    kind: fc.constantFrom<'room' | 'corridor'>('room', 'corridor'),
    ceilingHeightM: fc.double({ min: 2, max: 4, noNaN: true }),
    elevationM: fc.double({ min: 0, max: 20, noNaN: true }),
    notchFracW: fc.double({ min: 0, max: 0.5, noNaN: true }),
    notchFracH: fc.double({ min: 0, max: 0.5, noNaN: true }),
  })
  .map((s) => ({
    w: s.w,
    h: s.h,
    notchW: Math.floor(s.w * s.notchFracW),
    notchH: Math.floor(s.h * s.notchFracH),
    kind: s.kind,
    ceilingHeightM: s.ceilingHeightM,
    elevationM: s.elevationM,
  }));

// One floor: outer wall ring, the room inside, a 4-cell exit door in the left wall (rows 2..5 of the room).
function modelOf(s: Shape): BuildingModel {
  const W = s.w + 6;
  const H = s.h + 4;
  const idx = (x: number, y: number): number => y * W + x;
  const cellType = new Uint8Array(W * H).fill(CELL_WALL);
  for (let y = 0; y < H; y++) for (const x of [0, 1, W - 2, W - 1]) cellType[idx(x, y)] = CELL_FREE;
  const cells: number[] = [];
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (x >= s.w - s.notchW && y >= s.h - s.notchH) continue; // notch at the far corner
      cells.push(idx(3 + x, 2 + y));
      cellType[idx(3 + x, 2 + y)] = CELL_FREE;
    }
  }
  const doorCells = [4, 5, 6, 7].map((dy) => idx(2, 2 + dy));
  const door: Door = {
    id: 'exit1',
    floorId: 'f1',
    cells: Int32Array.from(doorCells),
    widthM: 4 * CELL_SIZE_M,
    open: true,
    roomIdA: 'room1',
    roomIdB: 'OUTSIDE',
    isWindow: false,
    isExit: true,
  };
  const room: Room = {
    id: 'room1',
    floorId: 'f1',
    name: 'room1',
    kind: s.kind,
    cells: Int32Array.from(cells),
    areaM2: cells.length * CELL_SIZE_M * CELL_SIZE_M,
    bboxWidthM: s.w * CELL_SIZE_M,
    bboxHeightM: s.h * CELL_SIZE_M,
    touchesBorder: false,
  };
  return {
    floors: [{ floorId: 'f1', name: 'Ground', elevationM: s.elevationM, ceilingHeightM: s.ceilingHeightM }],
    floorSources: [],
    layerMaps: {},
    grids: { f1: { widthCells: W, heightCells: H, cellType } },
    rooms: [room],
    doors: [door],
    stairLinks: [],
    edits: [],
  };
}

describe('Property 10: equivalent box matches Room area and aspect ratio', () => {
  it('box area and ratio match the Room; the compartment passes the fire validator and the crowd buildPlan', () => {
    fc.assert(
      fc.property(arbShape, (s) => {
        const model = modelOf(s);
        const room = model.rooms[0]!;

        // Req 9.2, 9.5: width * depth = room area, width / depth = bounding-box ratio, zero area error.
        const mapped = roomToCompartment(room, { elevationM: s.elevationM, ceilingHeightM: s.ceilingHeightM });
        const c = mapped.compartment!;
        expect(c).not.toBeNull();
        expect(c.widthM * c.depthM).toBeCloseTo(room.areaM2, 9);
        expect(c.widthM / c.depthM).toBeCloseTo(room.bboxWidthM / room.bboxHeightM, 9);
        expect(Math.abs(mapped.boxAreaRelativeError)).toBeLessThan(1e-12);
        expect(c.widthM).toBeGreaterThan(0); // Req 9.8
        expect(c.depthM).toBeGreaterThan(0);
        expect(c.heightM).toBeGreaterThan(0);

        // Req 9.7, 9.8: the whole-model geometry (default surfaces) passes the fire Input_Validator.
        const g = toFireGeometry(model);
        expect(g.compartments).toHaveLength(1);
        const gc = g.compartments[0]!;
        expect(gc).toEqual(c);
        const scenario: Scenario = {
          ...structuredClone(base),
          compartments: g.compartments,
          vents: g.vents,
          fires: base.fires.slice(0, 1).map((f) => ({ ...f, compartmentId: gc.id, xM: gc.widthM / 2, yM: gc.depthM / 2 })),
          unsupported: [],
        };
        const fireErrors = validate(scenario)
          .warnings.filter((w) => w.severity === 'error' && /VENT|COMPARTMENT|SURFACE|LAYER|ELEVATION|STACK/.test(w.code))
          .map((w) => `${w.code}: ${w.message}`);
        expect(fireErrors).toEqual([]);

        // Req 20.8: the matching compartment entry passes the crowd buildPlan.
        const { planInput } = toPlanInput(model);
        const entry = planInput.compartments?.find((e) => e.id === room.id);
        expect(entry).toBeDefined();
        const plan = buildPlan(planInput);
        expect(plan.warnings.filter((w) => w.severity === 'error')).toEqual([]);
        expect(plan.status).toBe('valid');
      }),
      { numRuns: 100 },
    );
  });
});
