// Floor sources and the common origin (Req 4, 3.7, 6.7). Input is geometry already flattened and converted to metres
// (units.ts). One Floor_Source per file, or per layer-set / block assignment within a file. Block floors are moved so
// their bounding-box minimum corners coincide; layer-set floors keep their coordinates (Req 4.3, 4.4). A manual
// offset in metres is added per floor (Req 4.5). All floors share one origin and one grid size, so a Stair_Region has
// the same cell index on adjacent floors. Pure and deterministic; never throws.
import { CELL_SIZE_M } from '../people/constants';
import type { FlatEntity } from './dxf/blocks';
import { entityBounds } from './units';
import type { Extent } from './units';
import { CROWD_MAX_CELLS_PER_FLOOR } from './limits';
import type { FloorSourceSpec, ImportWarning, LayerMap, LayerRole } from './types';
import { floorNoWalls, inputInvalid } from './warnings';

// Absorbs floating-point noise when an extent edge lies on a cell boundary (e.g. 12.5 / 0.25). Estimate; 1e-9 cells
// is far below any drawing precision.
const CELL_EPSILON = 1e-9;

export type GridRole = Exclude<LayerRole, 'ignore'>;

export interface FloorSourceFile {
  fileName: string;
  entitiesM: readonly FlatEntity[]; // flattened, in metres
}

export interface FloorSourceSettings {
  layerMaps?: Record<string /* fileName */, LayerMap>;
  floorOffsetsM?: Record<string /* floorId */, { xM: number; yM: number }>;
}

export interface FloorSource {
  floorId: string;
  fileName: string;
  defaultName: string; // "Floor 1", "Floor 2", ... (the user may rename; names live in FloorSettings)
  spec: FloorSourceSpec;
  entities: FlatEntity[]; // every entity of the floor in the common frame, metres, including `ignore` layers
  byRole: Record<GridRole, FlatEntity[]>; // same entities grouped by role; `ignore` is left out
  extent: Extent; // of `entities` in the common frame
  translationM: { xM: number; yM: number }; // total shift applied to the source coordinates
}

export type FloorSourcesResult =
  | {
      status: 'ok';
      floors: FloorSource[];
      originXM: number; // grid origin: minimum corner of the union extent, rounded down to a multiple of CELL_SIZE_M
      originYM: number;
      widthCells: number; // one grid size for every floor
      heightCells: number;
      warnings: ImportWarning[];
    }
  | { status: 'invalid'; warnings: ImportWarning[] };

function translate(e: FlatEntity, dx: number, dy: number): FlatEntity {
  switch (e.kind) {
    case 'LINE':
      return { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
    case 'POLYLINE':
      return { ...e, vertices: e.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy, bulge: v.bulge })) };
    case 'ARC':
    case 'CIRCLE':
      return { ...e, cx: e.cx + dx, cy: e.cy + dy };
  }
}

function roleOf(map: LayerMap | undefined, layer: string): LayerRole {
  if (map === undefined || !Object.hasOwn(map, layer)) return 'ignore';
  return map[layer] ?? 'ignore';
}

function finiteOffset(o: { xM: number; yM: number } | undefined): { xM: number; yM: number } {
  if (o === undefined || !Number.isFinite(o.xM) || !Number.isFinite(o.yM)) return { xM: 0, yM: 0 };
  return { xM: o.xM, yM: o.yM };
}

// Default specs: one whole-file floor per file, in upload order (Req 4.1).
function defaultSpecs(files: readonly FloorSourceFile[]): FloorSourceSpec[] {
  return files.map((f, i) => ({ floorId: `floor${i + 1}`, fileName: f.fileName }));
}

interface Selected {
  spec: FloorSourceSpec;
  entities: FlatEntity[];
  bounds: Extent | null;
}

function select(file: FloorSourceFile, spec: FloorSourceSpec): FlatEntity[] {
  let list = file.entitiesM as readonly FlatEntity[];
  if (spec.blockName !== undefined) {
    const key = spec.blockName.toUpperCase(); // block names ignore case, as in dxf/blocks.ts
    list = list.filter((e) => e.insert !== undefined && e.insert.blockName.toUpperCase() === key);
  }
  if (spec.layers !== undefined) {
    const layers = new Set(spec.layers);
    list = list.filter((e) => layers.has(e.layer));
  }
  return [...list];
}

export function buildFloorSources(
  files: readonly FloorSourceFile[],
  specs: readonly FloorSourceSpec[] | undefined,
  settings: FloorSourceSettings = {},
): FloorSourcesResult {
  const warnings: ImportWarning[] = [];
  const list = specs === undefined || specs.length === 0 ? defaultSpecs(files) : specs;

  const byName = new Map<string, FloorSourceFile>();
  for (const f of files) if (!byName.has(f.fileName)) byName.set(f.fileName, f);

  // Req 4.6: unique floor ids; every spec names a loaded file.
  const seen = new Set<string>();
  for (const spec of list) {
    if (seen.has(spec.floorId)) warnings.push(inputInvalid(`floor id "${spec.floorId}" is used twice`));
    seen.add(spec.floorId);
    if (!byName.has(spec.fileName)) warnings.push(inputInvalid(`floor "${spec.floorId}" names a file that is not loaded`));
  }
  if (list.length === 0) warnings.push(inputInvalid('no drawing is loaded'));
  if (warnings.length > 0) return { status: 'invalid', warnings };

  const selected: Selected[] = list.map((spec) => {
    const entities = select(byName.get(spec.fileName) as FloorSourceFile, spec);
    return { spec, entities, bounds: entityBounds(entities) };
  });

  // Req 4.7: a floor without a wall entity makes the import invalid.
  for (const s of selected) {
    const map = settings.layerMaps !== undefined && Object.hasOwn(settings.layerMaps, s.spec.fileName) ? settings.layerMaps[s.spec.fileName] : undefined;
    if (!s.entities.some((e) => roleOf(map, e.layer) === 'wall')) warnings.push(floorNoWalls(s.spec.floorId));
  }
  if (warnings.length > 0) return { status: 'invalid', warnings };

  // Req 4.3: block floors share one minimum corner, that of the first block floor (design.md decision).
  const firstBlock = selected.find((s) => s.spec.blockName !== undefined && s.bounds !== null);
  const ref = firstBlock?.bounds ?? null;

  const floors: FloorSource[] = [];
  let union: Extent | null = null;
  selected.forEach((s, i) => {
    const off = finiteOffset(settings.floorOffsetsM !== undefined && Object.hasOwn(settings.floorOffsetsM, s.spec.floorId) ? settings.floorOffsetsM[s.spec.floorId] : undefined);
    let dx = off.xM;
    let dy = off.yM;
    if (s.spec.blockName !== undefined && s.bounds !== null && ref !== null) {
      dx += ref.minX - s.bounds.minX;
      dy += ref.minY - s.bounds.minY;
    }
    const entities = dx === 0 && dy === 0 ? s.entities : s.entities.map((e) => translate(e, dx, dy));
    const extent = entityBounds(entities) as Extent; // walls exist, so geometry exists
    const map = settings.layerMaps !== undefined && Object.hasOwn(settings.layerMaps, s.spec.fileName) ? settings.layerMaps[s.spec.fileName] : undefined;
    const byRole: Record<GridRole, FlatEntity[]> = { wall: [], door: [], window: [], stair: [], furniture: [] };
    for (const e of entities) {
      const role = roleOf(map, e.layer);
      if (role !== 'ignore') byRole[role].push(e);
    }
    union =
      union === null
        ? extent
        : { minX: Math.min(union.minX, extent.minX), minY: Math.min(union.minY, extent.minY), maxX: Math.max(union.maxX, extent.maxX), maxY: Math.max(union.maxY, extent.maxY) };
    floors.push({
      floorId: s.spec.floorId,
      fileName: s.spec.fileName,
      defaultName: `Floor ${i + 1}`,
      spec: s.spec,
      entities,
      byRole,
      extent,
      translationM: { xM: dx, yM: dy },
    });
  });

  const u = union as unknown as Extent;
  // Req 6.7: origin = minimum corner of the common extent, rounded down to a multiple of CELL_SIZE_M.
  const originXM = Math.floor(u.minX / CELL_SIZE_M + CELL_EPSILON) * CELL_SIZE_M;
  const originYM = Math.floor(u.minY / CELL_SIZE_M + CELL_EPSILON) * CELL_SIZE_M;
  const widthCells = Math.max(1, Math.ceil((u.maxX - originXM) / CELL_SIZE_M - CELL_EPSILON));
  const heightCells = Math.max(1, Math.ceil((u.maxY - originYM) / CELL_SIZE_M - CELL_EPSILON));

  // Req 3.7: the grid of one floor must stay within the crowd model's cell limit.
  if (widthCells * heightCells > CROWD_MAX_CELLS_PER_FLOOR) {
    const w = u.maxX - u.minX;
    const d = u.maxY - u.minY;
    for (const f of floors) {
      warnings.push({
        code: 'LIMIT_CELLS',
        severity: 'error',
        message: `Floor ${f.floorId} needs ${widthCells * heightCells} grid cells (${widthCells} by ${heightCells}) for a drawing extent of ${Number(w.toFixed(1))} m by ${Number(d.toFixed(1))} m. The limit is ${CROWD_MAX_CELLS_PER_FLOOR} cells per floor. Check the drawing unit or use a smaller drawing extent.`,
        location: { kind: 'floor', floorId: f.floorId },
      });
    }
    return { status: 'invalid', warnings };
  }

  return { status: 'ok', floors, originXM, originYM, widthCells, heightCells, warnings };
}
