// loadProject: parse and validate a project file, then rebuild the model with importBuildingModel (Req 2.5, 5.8, 12.7,
// 15.8, 16.3 to 16.6, 16.9, 16.10). Never throws for any string; the first invalid field is named. Nothing outside the
// returned value is touched, so a rejected file leaves the current project as it was (Req 16.5).
import { DXF_MAX_BYTES, PROJECT_FILE_MAX_BYTES } from '../constants';
import { importBuildingModel } from '../import';
import { LAYER_ROLES } from '../layers';
import type { DrawingUnit, Edit, FloorSettings, FloorSourceSpec, ImportResult, ImportSettings, ImportSource, ImportWarning, LayerMap, RoomKind } from '../types';
import { isDrawingUnit } from '../units';
import { dxfTooLarge, projectFieldInvalid, projectSchemaVersion } from '../warnings';
import { PROJECT_SCHEMA_VERSIONS_SUPPORTED } from './schema';
import type { ProjectFile } from './schema';

export type LoadProjectResult =
  | { status: 'ok'; project: ProjectFile; sources: ImportSource[]; settings: ImportSettings; result: ImportResult }
  | { status: 'invalid'; errors: ImportWarning[] };

const MB = 1024 * 1024;
const ROOM_KINDS: readonly string[] = ['room', 'corridor', 'stair'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

class FieldError {
  constructor(readonly field: string, readonly detail: string) {}
}
const bad = (field: string, detail: string): never => {
  throw new FieldError(field, detail);
};

function arr(v: unknown, field: string): unknown[] {
  return Array.isArray(v) ? v : bad(field, 'it must be a list');
}
function obj(v: unknown, field: string): Obj {
  return isObj(v) ? v : bad(field, 'it must be an object');
}
function str(v: unknown, field: string): string {
  return isStr(v) ? v : bad(field, 'it must be text');
}
function num(v: unknown, field: string): number {
  return isNum(v) ? v : bad(field, 'it must be a finite number');
}
function strList(v: unknown, field: string): string[] {
  return arr(v, field).map((s, i) => str(s, `${field}[${i}]`));
}
function record<T>(v: unknown, field: string, each: (x: unknown, f: string) => T): Record<string, T> {
  const o = obj(v, field);
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, each(x, `${field}.${k}`)]));
}

function cellList(v: unknown, field: string): { x: number; y: number }[] {
  return arr(v, field).map((c, i) => {
    const o = obj(c, `${field}[${i}]`);
    if (!isInt(o.x)) bad(`${field}[${i}].x`, 'it must be a whole number');
    if (!isInt(o.y)) bad(`${field}[${i}].y`, 'it must be a whole number');
    return { x: o.x as number, y: o.y as number };
  });
}

function edit(v: unknown, field: string): Edit {
  const o = obj(v, field);
  switch (o.kind) {
    case 'paintWall':
    case 'eraseWall':
      return { kind: o.kind, floorId: str(o.floorId, `${field}.floorId`), cells: cellList(o.cells, `${field}.cells`) };
    case 'setDoorOpen':
      if (typeof o.open !== 'boolean') bad(`${field}.open`, 'it must be true or false');
      return { kind: 'setDoorOpen', doorId: str(o.doorId, `${field}.doorId`), open: o.open as boolean };
    case 'setWindowOpen':
      if (typeof o.open !== 'boolean') bad(`${field}.open`, 'it must be true or false');
      return { kind: 'setWindowOpen', windowId: str(o.windowId, `${field}.windowId`), open: o.open as boolean };
    case 'renameRoom':
      return { kind: 'renameRoom', roomId: str(o.roomId, `${field}.roomId`), name: str(o.name, `${field}.name`) };
    case 'setRoomKind': {
      const k = str(o.roomKind, `${field}.roomKind`);
      if (!ROOM_KINDS.includes(k)) bad(`${field}.roomKind`, 'it must be room, corridor or stair');
      return { kind: 'setRoomKind', roomId: str(o.roomId, `${field}.roomId`), roomKind: k as RoomKind };
    }
    default:
      return bad(`${field}.kind`, 'it is not a known edit kind');
  }
}

function floorSource(v: unknown, field: string): FloorSourceSpec {
  const o = obj(v, field);
  const out: FloorSourceSpec = { floorId: str(o.floorId, `${field}.floorId`), fileName: str(o.fileName, `${field}.fileName`) };
  if (o.layers !== undefined) out.layers = strList(o.layers, `${field}.layers`);
  if (o.blockName !== undefined) out.blockName = str(o.blockName, `${field}.blockName`);
  return out;
}

function floorSetting(v: unknown, field: string): FloorSettings {
  const o = obj(v, field);
  return {
    floorId: str(o.floorId, `${field}.floorId`),
    name: str(o.name, `${field}.name`),
    elevationM: num(o.elevationM, `${field}.elevationM`),
    ceilingHeightM: num(o.ceilingHeightM, `${field}.ceilingHeightM`),
  };
}

function layerMap(v: unknown, field: string): LayerMap {
  return record(v, field, (r, f) => (LAYER_ROLES.includes(r as never) ? (r as LayerMap[string]) : bad(f, 'it must be wall, door, window, stair, furniture or ignore')));
}

function parseProject(raw: unknown): ProjectFile {
  const o = obj(raw, 'project');
  const sources = arr(o.sources, 'sources').map((s, i) => {
    const so = obj(s, `sources[${i}]`);
    return { fileName: str(so.fileName, `sources[${i}].fileName`), text: str(so.text, `sources[${i}].text`) };
  });
  const project: ProjectFile = {
    schemaVersion: 1,
    sources,
    layerMaps: record(o.layerMaps, 'layerMaps', layerMap),
    drawingUnits: record(o.drawingUnits, 'drawingUnits', (u, f) => (isDrawingUnit(u) ? (u as DrawingUnit) : bad(f, 'it must be mm, cm, m, in or ft'))),
    floorSources: arr(o.floorSources, 'floorSources').map((f, i) => floorSource(f, `floorSources[${i}]`)),
    floorSettings: arr(o.floorSettings, 'floorSettings').map((f, i) => floorSetting(f, `floorSettings[${i}]`)),
    edits: arr(o.edits, 'edits').map((e, i) => edit(e, `edits[${i}]`)),
    exitDoorIds: strList(o.exitDoorIds, 'exitDoorIds'),
    stairRegions: arr(o.stairRegions, 'stairRegions').map((r, i) => {
      const ro = obj(r, `stairRegions[${i}]`);
      const cells = arr(ro.cells, `stairRegions[${i}].cells`).map((c, j) => (isInt(c) && c >= 0 ? c : bad(`stairRegions[${i}].cells[${j}]`, 'it must be a cell index, a whole number of 0 or more')));
      return { floorId: str(ro.floorId, `stairRegions[${i}].floorId`), cells };
    }),
    roomNames: record(o.roomNames, 'roomNames', str),
    roomKinds: record(o.roomKinds, 'roomKinds', (k, f) => (isStr(k) && ROOM_KINDS.includes(k) ? (k as RoomKind) : bad(f, 'it must be room, corridor or stair'))),
  };
  if (o.floorOffsetsM !== undefined) {
    project.floorOffsetsM = record(o.floorOffsetsM, 'floorOffsetsM', (v, f) => {
      const p = obj(v, f);
      return { xM: num(p.xM, `${f}.xM`), yM: num(p.yM, `${f}.yM`) };
    });
  }
  if (o.stairLinkOverrides !== undefined) {
    project.stairLinkOverrides = record(o.stairLinkOverrides, 'stairLinkOverrides', (v, f) => {
      const p = obj(v, f);
      return p.widthM === undefined ? {} : { widthM: num(p.widthM, `${f}.widthM`) };
    });
  }
  if (o.roofVents !== undefined) {
    project.roofVents = arr(o.roofVents, 'roofVents').map((v, i) => {
      const p = obj(v, `roofVents[${i}]`);
      return { floorId: str(p.floorId, `roofVents[${i}].floorId`), areaM2: num(p.areaM2, `roofVents[${i}].areaM2`), openFraction: num(p.openFraction, `roofVents[${i}].openFraction`) };
    });
  }
  return project;
}

/** UTF-8 byte length of a string, without allocating a buffer. */
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

export function settingsOf(p: ProjectFile): ImportSettings {
  return {
    layerMaps: p.layerMaps,
    drawingUnits: p.drawingUnits,
    ...(p.floorSources.length > 0 ? { floorSources: p.floorSources } : {}),
    floorSettings: p.floorSettings,
    ...(p.floorOffsetsM !== undefined ? { floorOffsetsM: p.floorOffsetsM } : {}),
    edits: p.edits,
    exitDoorIds: p.exitDoorIds,
    stairRegions: p.stairRegions.map((r) => ({ floorId: r.floorId, cells: Int32Array.from(r.cells) })),
    ...(p.stairLinkOverrides !== undefined ? { stairLinkOverrides: p.stairLinkOverrides } : {}),
    ...(p.roofVents !== undefined ? { roofVents: p.roofVents } : {}),
  };
}

export function loadProject(text: string): LoadProjectResult {
  if (typeof text !== 'string') return { status: 'invalid', errors: [projectFieldInvalid('project', 'it must be text')] };
  const bytes = utf8Bytes(text);
  if (bytes > PROJECT_FILE_MAX_BYTES) {
    return { status: 'invalid', errors: [projectFieldInvalid('project', `the file is ${(bytes / MB).toFixed(1)} MB and the limit is ${PROJECT_FILE_MAX_BYTES / MB} MB`)] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: 'invalid', errors: [projectFieldInvalid('project', 'it is not valid JSON')] };
  }
  if (!isObj(raw)) return { status: 'invalid', errors: [projectFieldInvalid('project', 'it must be a JSON object')] };
  if (!PROJECT_SCHEMA_VERSIONS_SUPPORTED.includes(raw.schemaVersion as number)) {
    const w = projectSchemaVersion(raw.schemaVersion);
    return { status: 'invalid', errors: [{ ...w, message: `${w.message} Supported versions: ${PROJECT_SCHEMA_VERSIONS_SUPPORTED.join(', ')}.` }] };
  }
  let project: ProjectFile;
  try {
    project = parseProject(raw);
  } catch (e) {
    if (e instanceof FieldError) return { status: 'invalid', errors: [projectFieldInvalid(e.field, e.detail)] };
    return { status: 'invalid', errors: [projectFieldInvalid('project', 'it could not be read')] };
  }
  for (let i = 0; i < project.sources.length; i++) {
    const src = project.sources[i] as { fileName: string; text: string };
    const b = utf8Bytes(src.text);
    if (b > DXF_MAX_BYTES) return { status: 'invalid', errors: [dxfTooLarge(src.fileName, b)] };
  }

  const sources: ImportSource[] = project.sources.map((s) => ({ fileName: s.fileName, text: s.text }));
  let settings = settingsOf(project);
  let result = importBuildingModel(sources, settings);
  // Saved room names and kinds that the replayed edits did not give are applied as two more edits at the end, where
  // room ids are the final ones. A saved id that no longer exists is skipped.
  if (result.model !== null) {
    const extra: Edit[] = [];
    for (const r of result.model.rooms) {
      const name = Object.hasOwn(project.roomNames, r.id) ? (project.roomNames[r.id] as string) : r.name;
      const kind = Object.hasOwn(project.roomKinds, r.id) ? (project.roomKinds[r.id] as RoomKind) : r.kind;
      if (name !== r.name) extra.push({ kind: 'renameRoom', roomId: r.id, name });
      if (kind !== r.kind) extra.push({ kind: 'setRoomKind', roomId: r.id, roomKind: kind });
    }
    if (extra.length > 0) {
      project = { ...project, edits: [...project.edits, ...extra] };
      settings = settingsOf(project);
      result = importBuildingModel(sources, settings);
    }
  }
  return { status: 'ok', project, sources, settings, result };
}
