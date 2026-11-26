// The three sample buildings with the answers a user would give on the import screen (run-view spec, Requirement 1.2),
// and the door/window edit step (Requirement 2.5). Each toggle re-runs importBuildingModel, which takes a few
// milliseconds for the samples (plan-import benchmark: boarding house 4.1 ms median).
import { importBuildingModel } from '../../core/plan/import';
import { suggestExits } from '../../core/plan/model/exits';
import type { Edit, ImportSettings, ImportSource, LayerMap } from '../../core/plan/types';
import type { UsedPlan } from '../plan/importScreen';
import boardingHouseDxf from '../../../public/samples/boarding-house.dxf?raw';
import cafeDxf from '../../../public/samples/cafe.dxf?raw';
import karaokeDxf from '../../../public/samples/karaoke.dxf?raw';

/** A plan ready for the setup screen: what "Use this plan" hands on, plus a title. */
export interface PlanSession extends UsedPlan {
  title: string;
}

export type SampleId = 'cafe' | 'karaoke' | 'boarding-house';

export interface SampleInfo {
  id: SampleId;
  title: string;
  blurb: string;
}

export const SAMPLE_INFO: readonly SampleInfo[] = [
  { id: 'cafe', title: 'Café', blurb: 'One floor, about 120 m², two exits.' },
  { id: 'karaoke', title: 'Karaoke bar', blurb: 'Many small rooms off one corridor, one exit.' },
  { id: 'boarding-house', title: 'Boarding house', blurb: 'Four floors on a narrow lot, one stair, one exit.' },
];

// The layer names the sample generator writes (tools/samples/draw.ts).
const SAMPLE_LAYER_MAP: LayerMap = {
  'A-WALL': 'wall',
  'A-DOOR': 'door',
  'A-GLAZ': 'window',
  'A-FLOR-STRS': 'stair',
  'A-FURN': 'furniture',
  '0': 'ignore',
};

const SAMPLE_TEXT: Record<SampleId, string> = { cafe: cafeDxf, karaoke: karaokeDxf, 'boarding-house': boardingHouseDxf };
// A point inside the stair room of every boarding-house floor, in metres (tools/samples/boardingHouse.ts).
const BOARDING_STAIR_PROBE_M = { xM: 1.0, yM: 12.0 };
const CELL_M = 0.25; // crowd grid cell, CELL_SIZE_M

/** Imports a sample with the answers a user would give on the import screen: the layer roles, every outside door of
 * the lowest floor as an exit, and (boarding house) the stair room of each floor as the stair region. */
export function loadSample(id: SampleId): PlanSession {
  const fileName = `${id}.dxf`;
  const sources: ImportSource[] = [{ fileName, text: SAMPLE_TEXT[id] }];
  const base: ImportSettings = { layerMaps: { [fileName]: SAMPLE_LAYER_MAP }, drawingUnits: { [fileName]: 'm' }, edits: [] };
  if (id === 'boarding-house') base.floorSources = [1, 2, 3, 4].map((k) => ({ floorId: `floor${k}`, fileName, blockName: `FLOOR${k}` }));
  const first = importBuildingModel(sources, base);
  if (first.model === null) throw new Error(`sample ${id} did not import: ${first.warnings.map((w) => w.message).join('; ')}`);
  const model = first.model;
  const settings: ImportSettings = { ...base, exitDoorIds: suggestExits(model.doors, model.floors) };
  if (id === 'boarding-house') {
    settings.stairRegions = model.floors.flatMap((f) => {
      const g = model.grids[f.floorId]!;
      const idx = Math.floor(BOARDING_STAIR_PROBE_M.yM / CELL_M) * g.widthCells + Math.floor(BOARDING_STAIR_PROBE_M.xM / CELL_M);
      const room = model.rooms.find((r) => r.floorId === f.floorId && r.cells.includes(idx));
      return room ? [{ floorId: f.floorId, cells: Int32Array.from(room.cells) }] : [];
    });
  }
  const result = importBuildingModel(sources, settings);
  if (result.status !== 'ok' || !result.derived) throw new Error(`sample ${id} did not import: ${result.warnings.map((w) => w.message).join('; ')}`);
  const title = SAMPLE_INFO.find((s) => s.id === id)!.title;
  return { title, sources, settings, result, planInput: result.derived.planInput, fire: result.derived.fire };
}

/** The session with `openEdits` replacing the door/window open edits (other edits are kept). */
export function withOpenEdits(session: PlanSession, openEdits: Edit[]): PlanSession {
  const kept = (session.settings.edits ?? []).filter((e) => e.kind !== 'setDoorOpen' && e.kind !== 'setWindowOpen');
  const settings: ImportSettings = { ...session.settings, edits: [...kept, ...openEdits] };
  const result = importBuildingModel(session.sources, settings);
  if (result.status !== 'ok' || !result.derived) return { ...session, settings, result };
  return { ...session, settings, result, planInput: result.derived.planInput, fire: result.derived.fire };
}
