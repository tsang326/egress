// Sample drawings (task 16.3): the generator output matches the committed files byte for byte, each sample has the
// expected counts, the derived outputs are accepted by buildPlan and the fire input validator, and each file says
// the drawing is invented.
// Requirements: 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.10, 20.9
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateSamples } from '../../tools/samples/generate';
import { validate } from '../../src/core/fire/validate/validate';
import type { Fire, Scenario } from '../../src/core/fire/types';
import { buildPlan } from '../../src/core/people/plan/builder';
import { importBuildingModel } from '../../src/core/plan/import';
import type { ImportResult, ImportSettings, LayerMap } from '../../src/core/plan/types';

const ROOT = join(__dirname, '..', '..');
const LAYER_MAP: LayerMap = {
  'A-WALL': 'wall',
  'A-DOOR': 'door',
  'A-GLAZ': 'window',
  'A-FLOR-STRS': 'stair',
  'A-FURN': 'furniture',
  '0': 'ignore',
};

const generated = generateSamples();
const committed = (name: string): string => readFileSync(join(ROOT, 'public', 'samples', name), 'utf8');

/** Import a sample: confirm the layer map, confirm every outside door of the lowest floor as an exit, and for
 * multi-floor samples confirm the stair room of each floor as the stair region (what the user does on the screen). */
function importSample(fileName: string, stairProbe?: { xM: number; yM: number }): ImportResult {
  const text = generated[fileName]!;
  const base: ImportSettings = { layerMaps: { [fileName]: LAYER_MAP }, drawingUnits: { [fileName]: 'm' } };
  // The boarding house keeps its four floors as blocks FLOOR1 to FLOOR4 in one file (Req 4.2, 4.3).
  if (stairProbe) base.floorSources = [1, 2, 3, 4].map((k) => ({ floorId: `floor${k}`, fileName, blockName: `FLOOR${k}` }));
  const first = importBuildingModel([{ fileName, text }], base);
  expect(first.status).toBe('ok');
  const model = first.model!;
  const ground = [...model.floors].sort((a, b) => a.elevationM - b.elevationM)[0]!.floorId;
  const exitDoorIds = model.doors
    .filter((d) => !d.isWindow && d.floorId === ground && (d.roomIdA === 'OUTSIDE' || d.roomIdB === 'OUTSIDE'))
    .map((d) => d.id);
  const settings: ImportSettings = { ...base, exitDoorIds };
  if (stairProbe) {
    const cellM = 0.25;
    settings.stairRegions = model.floors.flatMap((f) => {
      const g = model.grids[f.floorId]!;
      const idx = Math.floor(stairProbe.yM / cellM) * g.widthCells + Math.floor(stairProbe.xM / cellM);
      const room = model.rooms.find((r) => r.floorId === f.floorId && r.cells.includes(idx));
      return room ? [{ floorId: f.floorId, cells: Int32Array.from(room.cells) }] : [];
    });
  }
  return importBuildingModel([{ fileName, text }], settings);
}

function counts(r: ImportResult) {
  const m = r.model!;
  const doors = m.doors.filter((d) => !d.isWindow);
  return {
    floors: m.floors.length,
    rooms: m.rooms.length,
    roomsPerFloor: m.floors.map((f) => m.rooms.filter((x) => x.floorId === f.floorId).length),
    doors: doors.length,
    exits: doors.filter((d) => d.isExit).length,
    stairLinks: m.stairLinks.length,
  };
}

function acceptedDownstream(r: ImportResult): void {
  const { planInput, fire } = r.derived!;
  const plan = buildPlan(planInput);
  expect(plan.warnings.filter((w) => w.severity === 'error')).toEqual([]);
  expect(plan.status).toBe('valid');
  const first = fire.compartments[0]!;
  const f: Fire = {
    id: 'fire1',
    compartmentId: first.id,
    xM: first.widthM / 2,
    yM: first.depthM / 2,
    radiativeFraction: 0.3,
    fuel: { c: 1, h: 4, o: 0, n: 0, cl: 0, heatOfCombustionJPerKg: 5e7 },
    table: [
      { timeS: 0, hrrW: 0, heightM: 0, areaM2: 0.1, coYield: 0.01, sootYield: 0.01 },
      { timeS: 60, hrrW: 1e5, heightM: 0, areaM2: 0.5, coYield: 0.01, sootYield: 0.01 },
    ],
  };
  const scenario: Scenario = {
    schemaVersion: 1,
    durationS: 60,
    printIntervalS: 10,
    seed: 1,
    ambient: {
      interiorTempK: 293.15,
      exteriorTempK: 293.15,
      pressurePa: 101325,
      species: { o2: 0.2314, co2: 0.0005, co: 0, h2o: 0.0065, soot: 0 },
    },
    compartments: fire.compartments,
    vents: fire.vents,
    fires: [f],
  };
  const checked = validate(scenario);
  expect(checked.warnings.filter((w) => w.severity === 'error')).toEqual([]);
  expect(checked.valid).toBe(true);
}

describe('sample drawings', () => {
  it('generates exactly the three expected files', () => {
    expect(Object.keys(generated).sort()).toEqual(['boarding-house.dxf', 'cafe.dxf', 'karaoke.dxf']);
  });

  for (const name of ['cafe.dxf', 'karaoke.dxf', 'boarding-house.dxf']) {
    it(`${name}: committed file equals generator output byte for byte`, () => {
      expect(Buffer.from(committed(name), 'utf8').equals(Buffer.from(generated[name]!, 'utf8'))).toBe(true);
    });

    it(`${name}: the header comment says the drawing is invented`, () => {
      const lines = committed(name).split(/\r?\n/);
      const i = lines.findIndex((l) => l.trim() === '999');
      expect(i).toBeGreaterThanOrEqual(0);
      expect(lines[i + 1]).toMatch(/INVENTED/);
      expect(lines[i + 1]).toMatch(/not a real building/i);
    });

    it(`${name}: generator is deterministic`, () => {
      expect(generateSamples()[name]).toBe(generated[name]);
    });
  }

  it('cafe: one floor, 3 rooms, 2 exits, accepted downstream', () => {
    const r = importSample('cafe.dxf');
    expect(r.status).toBe('ok');
    const c = counts(r);
    expect(c.floors).toBe(1);
    expect(c.rooms).toBe(3);
    expect(c.exits).toBe(2);
    expect(c.doors).toBe(DOORS.cafe);
    acceptedDownstream(r);
  });

  it('karaoke: one floor, 9 rooms including the corridor, 1 exit, accepted downstream', () => {
    const r = importSample('karaoke.dxf');
    expect(r.status).toBe('ok');
    const c = counts(r);
    expect(c.floors).toBe(1);
    expect(c.rooms).toBe(9);
    expect(c.exits).toBe(1);
    expect(c.doors).toBe(DOORS.karaoke);
    expect(r.model!.rooms.filter((x) => x.kind === 'corridor').length).toBeLessThanOrEqual(1);
    acceptedDownstream(r);
  });

  it('boarding house: 4 floors, 5 rooms per floor, 1 stair, 1 ground exit, accepted downstream', () => {
    const r = importSample('boarding-house.dxf', { xM: 1.0, yM: 12.0 });
    expect(r.status).toBe('ok');
    const c = counts(r);
    expect(c.floors).toBe(4);
    expect(c.roomsPerFloor).toEqual([5, 5, 5, 5]);
    expect(c.exits).toBe(1);
    expect(c.doors).toBe(DOORS.boarding);
    expect(c.stairLinks).toBe(3);
    acceptedDownstream(r);
  });
});

// Door counts (not windows) per sample, read from the drawings: see design.md "Decisions during implementation".
const DOORS = { cafe: 4, karaoke: 9, boarding: 17 };
