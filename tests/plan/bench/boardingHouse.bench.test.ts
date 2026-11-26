// Performance benchmark (task 17.1, Requirements 21.1, 21.2, design "Performance strategy").
// Two modes in this file:
//   - plain `npm test`: one warm-up run, then one timed run. Hard ceilings: import 1 s, edit recompute 200 ms (Estimate).
//   - strict, opt-in with PLAN_BENCH=1 (`npm run test:bench:plan`): median of 5 timed runs after one warm-up run, same
//     ceilings. The strict mode runs alone; the plain mode is skipped there.
// The input is the invented boarding house sample (four floors as blocks, one stair), with the stair regions confirmed
// the way the UI does it: one region per floor, taken from the room that holds the stair.
import { describe, expect, it } from 'vitest';
import { importBuildingModel } from '../../../src/core/plan/import';
import type { Edit, FloorSourceSpec, ImportSettings, ImportSource, LayerMap, StairRegionInput } from '../../../src/core/plan/types';
import { buildBoardingHouse } from '../../../tools/samples/boardingHouse';

const STRICT = process.env['PLAN_BENCH'] === '1';

const RUNS = 5;
const IMPORT_BUDGET_MS = 1000; // Requirement 21.1
const EDIT_BUDGET_MS = 200; // Requirement 21.2 (Estimate)
const FILE_NAME = 'boarding-house.dxf';
const FLOORS = 4;
const STAIR_ROOM_MAX_WIDTH_M = 2; // the stair room is 1.5 m wide; the other rooms are wider

// Layer roles of the sample (Requirement 18.5), as the user would confirm them.
const LAYER_MAP: LayerMap = { '0': 'ignore', 'A-WALL': 'wall', 'A-DOOR': 'door', 'A-GLAZ': 'window', 'A-FLOR-STRS': 'stair', 'A-FURN': 'furniture' };

const source: ImportSource = { fileName: FILE_NAME, text: buildBoardingHouse() };
const floorSources: FloorSourceSpec[] = Array.from({ length: FLOORS }, (_, i) => ({ floorId: `floor${i + 1}`, fileName: FILE_NAME, blockName: `FLOOR${i + 1}` }));
const baseSettings: ImportSettings = { layerMaps: { [FILE_NAME]: LAYER_MAP }, drawingUnits: { [FILE_NAME]: 'm' }, floorSources };

function timeMs(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}

/** Confirmed stair regions: on each floor the narrow room that lies furthest north (the stair room). */
function confirmedStairRegions(settings: ImportSettings): StairRegionInput[] {
  const res = importBuildingModel([source], settings);
  expect(res.status).toBe('ok');
  const model = res.model!;
  const regions: StairRegionInput[] = [];
  for (const f of model.floors) {
    const w = model.grids[f.floorId]!.widthCells;
    const narrow = model.rooms.filter((r) => r.floorId === f.floorId && r.bboxWidthM < STAIR_ROOM_MAX_WIDTH_M);
    const centreY = (cells: Int32Array): number => cells.reduce((s, c) => s + Math.floor(c / w), 0) / cells.length;
    const stair = narrow.sort((a, b) => centreY(b.cells) - centreY(a.cells))[0];
    if (stair !== undefined) regions.push({ floorId: f.floorId, cells: Int32Array.from(stair.cells) });
  }
  return regions;
}

const stairRegions = confirmedStairRegions(baseSettings);
const importSettings: ImportSettings = { ...baseSettings, stairRegions };

/** The edit of the benchmark: one wall cell painted in a room of the top floor, which changes the grid and the rooms. */
function editSettings(): ImportSettings {
  const probe = importBuildingModel([source], importSettings).model!;
  const room = probe.rooms.find((r) => r.floorId === 'floor4' && r.kind === 'room')!;
  const w = probe.grids['floor4']!.widthCells;
  const c = room.cells[Math.floor(room.cells.length / 2)] as number;
  const edit: Edit = { kind: 'paintWall', floorId: 'floor4', cells: [{ x: c % w, y: Math.floor(c / w) }] };
  return { ...importSettings, edits: [edit] };
}

function runImport(settings: ImportSettings): void {
  const res = importBuildingModel([source], settings);
  if (res.status !== 'ok') throw new Error(`import is not ok: ${res.warnings.map((w) => w.code).join(', ')}`);
}

describe('boarding house sample set-up', () => {
  it('imports ok with all four floors and a stair link per floor pair', () => {
    const res = importBuildingModel([source], importSettings);
    expect(res.status).toBe('ok');
    expect(res.model!.floors).toHaveLength(FLOORS);
    expect(stairRegions).toHaveLength(FLOORS);
    expect(res.model!.stairLinks).toHaveLength(FLOORS - 1);
  });
});

describe.skipIf(STRICT)('plan import benchmark, plain mode (one warm-up, one timed run)', () => {
  it('imports the boarding house in under 1 s (Requirement 21.1)', () => {
    runImport(importSettings); // warm-up
    const ms = timeMs(() => runImport(importSettings));
    console.log(`plan bench (plain): import ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(IMPORT_BUDGET_MS);
  });

  it('recomputes after one edit in under 200 ms (Estimate, Requirement 21.2)', () => {
    const settings = editSettings();
    runImport(settings); // warm-up
    const ms = timeMs(() => runImport(settings));
    console.log(`plan bench (plain): edit recompute ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(EDIT_BUDGET_MS);
  });
});

describe.skipIf(!STRICT)('plan import benchmark, strict mode (median of 5 after one warm-up)', () => {
  it('imports the boarding house in under 1 s (Requirement 21.1)', () => {
    runImport(importSettings); // warm-up
    const times = Array.from({ length: RUNS }, () => timeMs(() => runImport(importSettings)));
    const m = median(times);
    console.log(`plan bench (strict): import median ${m.toFixed(1)} ms of [${times.map((t) => t.toFixed(1)).join(', ')}]`);
    expect(m).toBeLessThan(IMPORT_BUDGET_MS);
  });

  it('recomputes after one edit in under 200 ms (Estimate, Requirement 21.2)', () => {
    const settings = editSettings();
    runImport(settings); // warm-up
    const times = Array.from({ length: RUNS }, () => timeMs(() => runImport(settings)));
    const m = median(times);
    console.log(`plan bench (strict): edit recompute median ${m.toFixed(1)} ms of [${times.map((t) => t.toFixed(1)).join(', ')}]`);
    expect(m).toBeLessThan(EDIT_BUDGET_MS);
  });
});
