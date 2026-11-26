import { describe, expect, it } from 'vitest';
import { DXF_MAX_BYTES, PROJECT_FILE_MAX_BYTES } from '../../src/core/plan/constants';
import { importBuildingModel } from '../../src/core/plan/import';
import { loadProject } from '../../src/core/plan/project/load';
import { saveProject } from '../../src/core/plan/project/save';
import type { ImportSource } from '../../src/core/plan/types';
import { rectOutline, writeDxf } from './helpers/dxfWriter';
import { GRID_PLAN_LAYER_MAP, WALL_LAYER } from './helpers/planArbitraries';

// A 6 m x 5 m room on the wall layer, written as a DXF file.
const dxfText = writeDxf({ entities: [rectOutline(WALL_LAYER, 0, 0, 6, 5)], unit: 'm' });
const sources: ImportSource[] = [{ fileName: 'ground.dxf', text: dxfText }];
const settings = { layerMaps: { 'ground.dxf': { ...GRID_PLAN_LAYER_MAP } }, drawingUnits: { 'ground.dxf': 'm' as const } };

function goodProject(): Record<string, unknown> {
  return JSON.parse(saveProject({ sources, settings })) as Record<string, unknown>;
}

function expectInvalid(text: string): { code: string; message: string; location?: unknown } {
  const r = loadProject(text);
  expect(r.status).toBe('invalid');
  if (r.status !== 'invalid') throw new Error('unreachable');
  expect(r.errors).toHaveLength(1);
  return r.errors[0] as { code: string; message: string; location?: unknown };
}

describe('project file load', () => {
  it('loads a saved project and keeps the source text verbatim', () => {
    const r = loadProject(saveProject({ sources, settings }));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.sources[0]?.text).toBe(dxfText);
    expect(r.project.schemaVersion).toBe(1);
  });

  it('rejects an unknown schemaVersion naming the version found and the versions supported (Req 16.5)', () => {
    const p = { ...goodProject(), schemaVersion: 7 };
    const e = expectInvalid(JSON.stringify(p));
    expect(e.code).toBe('PROJECT_SCHEMA_VERSION');
    expect(e.message).toContain('schema version 7');
    expect(e.message).toContain('Supported versions: 1');
    expect(e.message).toContain('The current project is unchanged');
  });

  it('rejects a missing schemaVersion without throwing', () => {
    const { schemaVersion: _drop, ...rest } = goodProject();
    expect(expectInvalid(JSON.stringify(rest)).code).toBe('PROJECT_SCHEMA_VERSION');
  });

  it.each(['', '{', 'not json', '{"schemaVersion":1,'])('returns an error for malformed JSON %j (Req 16.6)', (text) => {
    const e = expectInvalid(text);
    expect(e.code).toBe('PROJECT_FIELD_INVALID');
    expect(e.message).toContain('not valid JSON');
  });

  it.each(['[]', 'null', '42', '"text"'])('returns an error for JSON that is not an object: %s', (text) => {
    expect(expectInvalid(text).code).toBe('PROJECT_FIELD_INVALID');
  });

  it('names the field when a field has the wrong type (Req 16.6)', () => {
    const e = expectInvalid(JSON.stringify({ ...goodProject(), exitDoorIds: 'door1' }));
    expect(e.code).toBe('PROJECT_FIELD_INVALID');
    expect(e.message).toContain('"exitDoorIds"');
    expect(e.location).toEqual({ kind: 'field', field: 'exitDoorIds' });
  });

  it('names the first invalid field when several are wrong', () => {
    // sources comes before layerMaps in parse order, so it is the one named.
    const p = { ...goodProject(), layerMaps: [], sources: [{ fileName: 'a.dxf', text: 5 }] };
    expect(expectInvalid(JSON.stringify(p)).message).toContain('"sources[0].text"');
  });

  it('names a nested field with its path', () => {
    const p = { ...goodProject(), floorSettings: [{ floorId: 'f1', name: 'Ground', elevationM: 'high', ceilingHeightM: 2.7 }] };
    expect(expectInvalid(JSON.stringify(p)).message).toContain('"floorSettings[0].elevationM"');
  });

  it('rejects an unknown layer role by naming the layer entry', () => {
    const p = { ...goodProject(), layerMaps: { 'ground.dxf': { [WALL_LAYER]: 'lava' } } };
    expect(expectInvalid(JSON.stringify(p)).message).toContain(`"layerMaps.ground.dxf.${WALL_LAYER}"`);
  });

  it('rejects a source text over the DXF size limit (Req 16.9)', () => {
    const big = 'x'.repeat(DXF_MAX_BYTES + 1);
    const p = { ...goodProject(), sources: [{ fileName: 'big.dxf', text: big }] };
    const e = expectInvalid(JSON.stringify(p));
    expect(e.code).toBe('DXF_TOO_LARGE');
    expect(e.message).toContain('big.dxf');
  });

  it('rejects a project file over the project size limit before parsing (Req 16.9)', () => {
    const e = expectInvalid(' '.repeat(PROJECT_FILE_MAX_BYTES + 1));
    expect(e.code).toBe('PROJECT_FIELD_INVALID');
    expect(e.message).toContain('limit is 100 MB');
  });

  it('counts the limit in UTF-8 bytes, not characters', () => {
    // 3-byte characters: a string with fewer characters than the limit still exceeds it in bytes.
    const text = '\u20ac'.repeat(Math.floor(PROJECT_FILE_MAX_BYTES / 3) + 1);
    expect(expectInvalid(text).message).toContain('limit is 100 MB');
  });

  it('restores the layer maps without asking and builds the same model as the original import (Req 5.8)', () => {
    const r = loadProject(saveProject({ sources, settings }));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.settings.layerMaps).toEqual(settings.layerMaps);
    expect(r.result.model).not.toBeNull();
    // No step that asks for a layer map: nothing is reported as unmapped or needing confirmation.
    expect(r.result.warnings.map((w) => w.code)).not.toContain('LAYER_UNCONFIRMED');
    const direct = importBuildingModel(sources, settings);
    expect(r.result.model?.rooms.map((x) => [x.id, x.areaM2])).toEqual(direct.model?.rooms.map((x) => [x.id, x.areaM2]));
    expect(r.result.model?.layerMaps).toEqual(direct.model?.layerMaps);
  });
});
