// Unit tests for the orchestration of importBuildingModel: size cap, limits at their boundaries, pending questions,
// argument types and the no-exit warning (task 14.10).
// Requirements: 2.3, 3.2, 3.7, 5.4, 13.8, 17.1, 17.2, 17.3, 17.6, 20.7, 20.10, 22.3
import { describe, expect, it } from 'vitest';
import { DXF_MAX_BYTES } from '../../src/core/plan/constants';
import { importBuildingModel } from '../../src/core/plan/import';
import { CROWD_MAX_CELLS_PER_FLOOR, FIRE_MAX_COMPARTMENTS, FIRE_MAX_FLOORS, FIRE_MAX_VENTS } from '../../src/core/plan/limits';
import type { ImportResult, ImportSettings, ImportSource, LayerMap } from '../../src/core/plan/types';
import { writeDxf } from './helpers/dxfWriter';
import type { DxfEntity } from './helpers/dxfWriter';

// ---- fixture: strips of 9 x 9 cell rooms (2.25 m, 5.06 m2) in a row, single-line walls on cell centres ------------

const LAYER_MAP: LayerMap = { 'A-WALL': 'wall', 'A-ANNO-MARK': 'ignore' };
const ROOM_PITCH = 10; // cells between wall lines
const GAP_FROM = 4; // door gap: cells 4, 5, 6 = 0.75 m
const GAP_TO = 6;
const cx = (i: number): number => 0.125 + 0.25 * i; // centre of cell i, metres

interface Strip {
  rooms: number;
  /** Internal doors in the wall between room k-1 and room k, k = 1..rooms-1. */
  internalDoors?: boolean;
  /** Number of outside doors per room, 0 to 2 (bottom wall, then top wall). */
  outsideDoorsPerRoom?: 0 | 1 | 2;
}

const seg = (layer: string, a: [number, number], b: [number, number]): DxfEntity => ({ type: 'LINE', layer, a, b });

/** A horizontal wall line along row `row` from cell x0 to x1, with the door gap cut out when `gap` is true. */
function hWall(row: number, x0: number, x1: number, gap: boolean): DxfEntity[] {
  const y = cx(row);
  if (!gap) return [seg('A-WALL', [cx(x0), y], [cx(x1), y])];
  return [seg('A-WALL', [cx(x0), y], [cx(x0 + GAP_FROM - 1), y]), seg('A-WALL', [cx(x0 + GAP_TO + 1), y], [cx(x1), y])];
}

function vWall(col: number, gap: boolean): DxfEntity[] {
  const x = cx(col);
  if (!gap) return [seg('A-WALL', [x, cx(0)], [x, cx(ROOM_PITCH)])];
  return [seg('A-WALL', [x, cx(0)], [x, cx(GAP_FROM - 1)]), seg('A-WALL', [x, cx(GAP_TO + 1)], [x, cx(ROOM_PITCH)])];
}

function stripEntities(s: Strip): DxfEntity[] {
  const out: DxfEntity[] = [];
  const perRoom = s.outsideDoorsPerRoom ?? 0;
  for (let k = 0; k < s.rooms; k++) {
    const x0 = k * ROOM_PITCH;
    out.push(...hWall(0, x0, x0 + ROOM_PITCH, perRoom >= 1));
    out.push(...hWall(ROOM_PITCH, x0, x0 + ROOM_PITCH, perRoom >= 2));
    out.push(...vWall(x0, k > 0 && (s.internalDoors ?? false)));
  }
  out.push(...vWall(s.rooms * ROOM_PITCH, false));
  // An ignored marker line keeps a free margin of 8 cells around the building, so outside doors lead to the outside.
  out.push(seg('A-ANNO-MARK', [cx(-8), cx(-8)], [cx(s.rooms * ROOM_PITCH + 8), cx(ROOM_PITCH + 8)]));
  return out;
}

const stripSource = (name: string, s: Strip): ImportSource => ({ fileName: name, text: writeDxf({ entities: stripEntities(s), unit: 'm' }) });

const layerMapsFor = (sources: readonly ImportSource[]): Record<string, LayerMap> =>
  Object.fromEntries(sources.map((f) => [f.fileName as string, { ...LAYER_MAP }])) as Record<string, LayerMap>;

/** Import, then confirm every door that leads outside as an exit (second pass with the ids from the first). */
function importConfirmingExits(sources: ImportSource[]): ImportResult {
  const settings: ImportSettings = { layerMaps: layerMapsFor(sources) };
  const first = importBuildingModel(sources, settings);
  const exitDoorIds = (first.model?.doors ?? []).filter((d) => !d.isWindow && d.roomIdB === 'OUTSIDE').map((d) => d.id);
  return importBuildingModel(sources, { ...settings, exitDoorIds });
}

const codes = (r: ImportResult): string[] => r.warnings.map((w) => w.code);
const errorCodes = (r: ImportResult): string[] => r.warnings.filter((w) => w.severity === 'error').map((w) => w.code);

// ---- tests -------------------------------------------------------------------------------------------------------

describe('fixture sanity', () => {
  it('a strip of rooms with doors imports as one room per strip cell and the expected vents', () => {
    const r = importConfirmingExits([stripSource('a.dxf', { rooms: 3, internalDoors: true, outsideDoorsPerRoom: 1 })]);
    expect(errorCodes(r)).toEqual([]);
    expect(r.status).toBe('ok');
    expect(r.model!.rooms).toHaveLength(3);
    expect(r.counts!.compartments).toMatchObject({ count: 3, limit: FIRE_MAX_COMPARTMENTS, exceeded: false });
    expect(r.counts!.vents.count).toBe(2 + 3); // two internal doors plus three exits
  });
});

describe('file size cap (Req 3.2, 20.7)', () => {
  it('refuses a file over 20 MB, names the limit, and stops before parsing', () => {
    const r = importBuildingModel([{ fileName: 'big.dxf', text: 'x'.repeat(DXF_MAX_BYTES + 1) }]);
    expect(r.status).toBe('invalid');
    expect(r.model).toBeNull();
    const errors = r.warnings.filter((w) => w.severity === 'error');
    expect(errors.map((w) => w.code)).toEqual(['DXF_TOO_LARGE']); // no parse error follows
    expect(errors[0]!.message).toContain('20 MB');
  });

  it('does not use the size error for a file of exactly 20 MB', () => {
    const r = importBuildingModel([{ fileName: 'edge.dxf', text: 'x'.repeat(DXF_MAX_BYTES) }]);
    expect(r.status).toBe('invalid');
    expect(codes(r)).not.toContain('DXF_TOO_LARGE');
  });
});

describe('limits at their boundaries (Req 17.1, 17.2, 13.8)', () => {
  it('accepts 6 floors and refuses 7, naming the limit, the count and the model', () => {
    const six = Array.from({ length: FIRE_MAX_FLOORS }, (_, i) => stripSource(`f${i}.dxf`, { rooms: 1 }));
    const ok = importBuildingModel(six, { layerMaps: layerMapsFor(six) });
    expect(ok.status).toBe('ok');
    expect(ok.counts!.floors).toMatchObject({ count: 6, limit: 6, exceeded: false });

    const seven = Array.from({ length: FIRE_MAX_FLOORS + 1 }, (_, i) => stripSource(`f${i}.dxf`, { rooms: 1 }));
    const bad = importBuildingModel(seven, { layerMaps: layerMapsFor(seven) });
    expect(bad.status).toBe('invalid');
    expect(bad.model).toBeNull();
    expect(errorCodes(bad)).toEqual(['LIMIT_FLOORS']);
    const msg = bad.warnings.find((w) => w.code === 'LIMIT_FLOORS')!.message;
    expect(msg).toContain('7 floors');
    expect(msg).toContain('6 floors');
    expect(msg).toContain('fire model');
  });

  it('accepts 30 compartments and refuses 31, naming the limit and the count', () => {
    const ok = importConfirmingExits([stripSource('a.dxf', { rooms: FIRE_MAX_COMPARTMENTS, internalDoors: true })]);
    expect(ok.status).toBe('ok');
    expect(ok.counts!.compartments).toMatchObject({ count: 30, limit: 30, exceeded: false });

    const bad = importConfirmingExits([stripSource('a.dxf', { rooms: FIRE_MAX_COMPARTMENTS + 1, internalDoors: true })]);
    expect(bad.status).toBe('invalid');
    expect(errorCodes(bad)).toEqual(['LIMIT_COMPARTMENTS']);
    const msg = bad.warnings.find((w) => w.code === 'LIMIT_COMPARTMENTS')!.message;
    expect(msg).toContain('31 rooms');
    expect(msg).toContain('30 compartments');
  });

  it('accepts 60 vents and refuses 61, naming the limit and the count', () => {
    // 30 rooms with an exit in the bottom and the top wall: 60 vents, 30 compartments.
    const ok = importConfirmingExits([stripSource('a.dxf', { rooms: 30, outsideDoorsPerRoom: 2 })]);
    expect(ok.counts!.vents).toMatchObject({ count: FIRE_MAX_VENTS, limit: 60, exceeded: false });
    expect(ok.status).toBe('ok');
  });

  it('refuses 61 vents (one internal door more, still 30 compartments)', () => {
    const entities = stripEntities({ rooms: 30, outsideDoorsPerRoom: 2 });
    // Replace the solid wall between rooms 0 and 1 (column 10) with a wall that has a door gap.
    const col = cx(ROOM_PITCH);
    const kept = entities.filter((e) => !(e.type === 'LINE' && e.a[0] === col && e.b[0] === col));
    const sources: ImportSource[] = [{ fileName: 'a.dxf', text: writeDxf({ entities: [...kept, ...vWall(ROOM_PITCH, true)], unit: 'm' }) }];
    const r = importConfirmingExits(sources);
    expect(r.counts!.vents).toMatchObject({ count: FIRE_MAX_VENTS + 1, limit: 60, exceeded: true });
    expect(r.status).toBe('invalid');
    expect(r.model).toBeNull();
    expect(errorCodes(r)).toEqual(['VENT_LIMIT']);
    const msg = r.warnings.find((w) => w.code === 'VENT_LIMIT')!.message;
    expect(msg).toContain('61');
    expect(msg).toContain('60 vents');
  });

  it('returns every exceeded limit of floors, compartments and vents in one result (Req 17.6)', () => {
    // 7 floors of 5 rooms: 35 compartments, and an exit in the bottom and top wall of each room: 70 vents.
    const sources = Array.from({ length: 7 }, (_, i) => stripSource(`f${i}.dxf`, { rooms: 5, outsideDoorsPerRoom: 2 }));
    const r = importConfirmingExits(sources);
    expect(r.status).toBe('invalid');
    expect(r.model).toBeNull();
    expect(errorCodes(r)).toEqual(['LIMIT_FLOORS', 'LIMIT_COMPARTMENTS', 'VENT_LIMIT']);
    expect(r.counts!.floors).toMatchObject({ count: 7, exceeded: true });
    expect(r.counts!.compartments).toMatchObject({ count: 35, exceeded: true });
    expect(r.counts!.vents).toMatchObject({ count: 70, exceeded: true });
  });
});

describe('cell limit (Req 3.7, 17.3)', () => {
  // 1,000 x 1,000 cells = 1,000,000 cells is the limit. The extent is set by two ignored marker lines, so the test file
  // stays small. Origin 0, so a line to 249.875 m ends in cell 999 and the grid is 1000 cells wide.
  const gridText = (widthCells: number, heightCells: number): string =>
    writeDxf({
      entities: [seg('A-WALL', [cx(1), cx(1)], [cx(3), cx(1)]), seg('A-ANNO-MARK', [cx(0), cx(0)], [cx(widthCells - 1), cx(heightCells - 1)])],
      unit: 'm',
    });
  const run = (w: number, h: number): ImportResult =>
    importBuildingModel([{ fileName: 'big.dxf', text: gridText(w, h) }], { layerMaps: { 'big.dxf': { ...LAYER_MAP } } });

  it('refuses a floor of 1,000,001 cells, naming the limit, the grid size and the extent', () => {
    const r = run(1001, 1000);
    expect(r.status).toBe('invalid');
    expect(r.model).toBeNull();
    expect(codes(r)).toContain('LIMIT_CELLS');
    const msg = r.warnings.find((w) => w.code === 'LIMIT_CELLS')!.message;
    expect(msg).toContain(`${CROWD_MAX_CELLS_PER_FLOOR} cells`);
    expect(msg).toContain('1001 by 1000');
    expect(msg).toMatch(/drawing extent of [\d.]+ m by [\d.]+ m/);
  });

  it('does not report the cell limit for a floor of exactly 1,000,000 cells', () => {
    const r = run(1000, 1000);
    expect(codes(r)).not.toContain('LIMIT_CELLS');
  });
});

describe('pending questions withhold the model (Req 2.3, 5.4, 20.7)', () => {
  const unitless = (s: Strip): ImportSource => ({ fileName: 'u.dxf', text: writeDxf({ entities: stripEntities(s), unit: 'm', insunits: null }) });

  it('a unitless file gives a unit question and no model, even with a confirmed layer map', () => {
    const r = importBuildingModel([unitless({ rooms: 1 })], { layerMaps: { 'u.dxf': { ...LAYER_MAP } } });
    expect(r.status).toBe('invalid');
    expect(r.model).toBeNull();
    expect(r.derived).toBeUndefined();
    expect(r.pendingQuestions.map((q) => q.kind)).toContain('DRAWING_UNIT');
  });

  it('the same file imports once the user has chosen the unit', () => {
    const r = importBuildingModel([unitless({ rooms: 1 })], { layerMaps: { 'u.dxf': { ...LAYER_MAP } }, drawingUnits: { 'u.dxf': 'm' } });
    expect(r.pendingQuestions).toEqual([]);
    expect(r.status).toBe('ok');
    expect(r.model).not.toBeNull();
  });

  it('unconfirmed layers give one question per file and no model', () => {
    const src = stripSource('a.dxf', { rooms: 1 });
    const r = importBuildingModel([src], {});
    expect(r.status).toBe('invalid');
    expect(r.model).toBeNull();
    const layerQuestions = r.pendingQuestions.filter((q) => q.kind === 'LAYER_ROLES');
    expect(layerQuestions.length).toBeGreaterThan(0);
  });

  it('a layer map that leaves one used layer out keeps the model withheld', () => {
    const src = stripSource('a.dxf', { rooms: 1 });
    const r = importBuildingModel([src], { layerMaps: { 'a.dxf': { 'A-WALL': 'wall' } } });
    expect(r.model).toBeNull();
    expect(r.pendingQuestions.some((q) => q.kind === 'LAYER_ROLES')).toBe(true);
  });
});

describe('argument types (Req 22.3)', () => {
  it('throws TypeError when sources is not an array', () => {
    for (const bad of [undefined, null, 'text', 42, {}, { text: 'x' }]) {
      expect(() => importBuildingModel(bad as unknown as ImportSource[])).toThrow(TypeError);
    }
  });

  it('throws TypeError when an element has no string text', () => {
    for (const bad of [{ fileName: 'a.dxf' }, { text: 5 }, { text: null }, null, 'x']) {
      expect(() => importBuildingModel([bad as unknown as ImportSource])).toThrow(TypeError);
    }
  });

  it('does not throw for an empty array or for settings of the wrong type', () => {
    expect(importBuildingModel([]).status).toBe('invalid');
    const src = stripSource('a.dxf', { rooms: 1 });
    expect(() => importBuildingModel([src], 'nonsense' as unknown as ImportSettings)).not.toThrow();
    expect(() => importBuildingModel([src], { layerMaps: 7, edits: 'x' } as unknown as ImportSettings)).not.toThrow();
  });
});

describe('no exit (Req 12.6, 20.10)', () => {
  it('warns NO_EXIT and still returns a valid model', () => {
    const src = stripSource('a.dxf', { rooms: 2, internalDoors: true });
    const r = importBuildingModel([src], { layerMaps: layerMapsFor([src]) });
    expect(r.status).toBe('ok');
    expect(r.model).not.toBeNull();
    expect(r.derived).toBeDefined();
    const w = r.warnings.find((x) => x.code === 'NO_EXIT');
    expect(w).toBeDefined();
    expect(w!.severity).toBe('warning');
    expect(r.model!.doors.some((d) => d.isExit)).toBe(false);
  });
});
