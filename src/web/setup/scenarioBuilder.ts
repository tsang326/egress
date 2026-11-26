// Setup choices + plan -> fire Scenario and crowd input (run-view spec, Requirements 2, 4.5). Pure: same arguments,
// same output, so a run can be repeated bit for bit (Requirement 4.6).
import { DEFAULT_AMBIENT_PRESSURE_PA, DEFAULT_AMBIENT_TEMP_K } from '../../core/fire/constants';
import { buildFire, type FireChoice } from '../../core/fire/library';
import type { Scenario } from '../../core/fire/types';
import { CELL_SIZE_M, NEAR_FIRE_M } from '../../core/people/constants';
import { buildPlan } from '../../core/people/plan/builder';
import { CELL_FREE, type AgentInput, type CrowdInput, type Plan } from '../../core/people/types';
import type { Edit, Room } from '../../core/plan/types';
import type { PlanSession } from '../home/sampleConfigs';
import type { DensityPreset, RoomCount } from './densityPresets';

export interface SetupState {
  fireRoomId: string | null; // a room id of the BuildingModel, also its fire compartment id
  fireSiteM: { xM: number; yM: number } | null; // where the user clicked, metres on the floor; null = room centre
  fireChoice: FireChoice | null;
  preset: DensityPreset | 'custom';
  agentsByRoom: Record<string, RoomCount>;
  entryExitId: string | null; // the exit visitors came in by, so the one they know
  alarmTimeS: number;
  durationS: number;
  openEdits: Edit[]; // setDoorOpen / setWindowOpen, applied through the import (Requirement 2.5)
  seed: number;
}

export const DEFAULT_ALARM_S = 30; // Requirement 2.4
export const DEFAULT_DURATION_S = 600; // Requirement 2.4
export const UI_PRINT_INTERVAL_S = 2; // Requirement 4.5
export const DEFAULT_SEED = 1;

// Ambient air. CFAST 7.7.7 defaults (cfast_parameters.f90): 20 C, 101325 Pa, 50 % relative humidity; the mass fractions
// below are the ones the fire tests use for that air (O2 0.2314 dry air, CO2 about 330 ppm by volume, H2O at 50 % RH).
const AMBIENT_SPECIES = { o2: 0.2314, co2: 0.0005, co: 0, h2o: 0.0065, soot: 0 };

export interface BuiltRun {
  scenario: Scenario;
  plan: Plan;
  crowd: Omit<CrowdInput, 'plan'>;
  fireSite: { floorId: string; xM: number; yM: number };
}

export type BuildProblem = { field: 'fireRoom' | 'fireChoice' | 'alarm' | 'duration' | 'plan' | 'people'; message: string };

/** Centre of a room's cells, in metres on its floor. */
export function roomCentreM(room: Room, widthCells: number): { xM: number; yM: number } {
  let sx = 0;
  let sy = 0;
  for (const c of room.cells) {
    sx += (c % widthCells) + 0.5;
    sy += Math.floor(c / widthCells) + 0.5;
  }
  const n = Math.max(1, room.cells.length);
  return { xM: (sx / n) * CELL_SIZE_M, yM: (sy / n) * CELL_SIZE_M };
}

/** Cells of a room where a person can start: free floor where a body fits (crowd model fitsAgent). The room's own id
 * is matched through the plan's compartment map. */
function startCells(plan: Plan, floorIndex: number, roomId: string, avoid: { floorId: string; xM: number; yM: number } | null, minCount: number): number[] {
  const f = plan.floors[floorIndex]!;
  const near = (c: number): boolean => {
    if (avoid === null || avoid.floorId !== f.id) return false;
    const dx = ((c % f.widthCells) + 0.5) * CELL_SIZE_M - avoid.xM;
    const dy = (Math.floor(c / f.widthCells) + 0.5) * CELL_SIZE_M - avoid.yM;
    return dx * dx + dy * dy < START_CLEAR_OF_FIRE_M * START_CLEAR_OF_FIRE_M;
  };
  const comp = plan.compartmentIds.indexOf(roomId);
  if (comp < 0) return [];
  const all: number[] = [];
  for (let c = 0; c < f.cellType.length; c++) if (f.compartment[c] === comp && f.cellType[c] === CELL_FREE && f.fitsAgent[c] === 1) all.push(c);
  const clear = all.filter((c) => !near(c));
  // A small fire room may have no cell 2 m from the fire; then people start anywhere in it and NEAR_FIRE is reported.
  return clear.length >= Math.min(all.length, minCount) ? clear : all;
}

// Nobody starts within the crowd model's NEAR_FIRE distance of the burning item, where it warns that heat is less
// accurate. If a room is too small for that, the cells closest to the limit are not dropped (see startCells).
export const START_CLEAR_OF_FIRE_M = NEAR_FIRE_M;

/** Spreads `k` people over the start cells, evenly through the list (row-major order), one per cell at most. */
function spread(cells: number[], k: number): number[] {
  const n = Math.min(k, cells.length);
  const out: number[] = [];
  for (let j = 0; j < n; j++) out.push(cells[Math.floor(((j + 0.5) * cells.length) / n)]!);
  return out;
}

export function problems(session: PlanSession, s: SetupState): BuildProblem[] {
  const out: BuildProblem[] = [];
  if (s.fireRoomId === null) out.push({ field: 'fireRoom', message: 'Click a room on the plan to say where the fire starts.' });
  if (s.fireChoice === null) out.push({ field: 'fireChoice', message: 'Choose what is burning.' });
  if (!(Number.isFinite(s.alarmTimeS) && s.alarmTimeS >= 0)) out.push({ field: 'alarm', message: 'The alarm time must be 0 s or more.' });
  if (!(Number.isFinite(s.durationS) && s.durationS > 0 && s.durationS <= 3600)) out.push({ field: 'duration', message: 'The run length must be between 1 s and 3600 s.' });
  if (session.result.status !== 'ok' || !session.result.derived) out.push({ field: 'plan', message: 'The plan has problems after the last door or window change. Undo it.' });
  const total = Object.values(s.agentsByRoom).reduce((a, r) => a + r.visitors + r.staff, 0);
  if (total === 0) out.push({ field: 'people', message: 'Put at least one person in the building.' });
  return out;
}

/** Builds the two model inputs. Call only when `problems` is empty. */
export function buildRun(session: PlanSession, s: SetupState): BuiltRun {
  const model = session.result.model!;
  const pr = buildPlan(session.planInput);
  if (pr.plan === null) throw new Error('plan did not build: ' + pr.warnings.map((w) => w.message).join('; '));
  const plan = pr.plan;
  const room = model.rooms.find((r) => r.id === s.fireRoomId)!;
  const comp = session.fire.compartments.find((c) => c.id === room.id);
  if (comp === undefined) throw new Error(`room ${room.id} has no fire compartment`);
  // The zone model places the fire in the room's equivalent box; CFAST uses the position only for targets and
  // detectors, so the centre is used there. The plan (and the crowd's near-fire check) use the clicked spot.
  const fire = buildFire(s.fireChoice!, comp.id, comp.widthM / 2, comp.depthM / 2, s.durationS);
  const scenario: Scenario = {
    schemaVersion: 1,
    title: session.title,
    durationS: s.durationS,
    printIntervalS: UI_PRINT_INTERVAL_S,
    seed: s.seed,
    ambient: { interiorTempK: DEFAULT_AMBIENT_TEMP_K, exteriorTempK: DEFAULT_AMBIENT_TEMP_K, pressurePa: DEFAULT_AMBIENT_PRESSURE_PA, species: { ...AMBIENT_SPECIES } },
    compartments: session.fire.compartments,
    vents: session.fire.vents,
    fires: [fire],
  };

  const g = model.grids[room.floorId]!;
  const fireSite = { floorId: room.floorId, ...(s.fireSiteM ?? roomCentreM(room, g.widthCells)) };
  const agents: AgentInput[] = [];
  const entry = s.entryExitId !== null && plan.exits.some((e) => e.id === s.entryExitId) ? s.entryExitId : plan.exits[0]?.id;
  for (const r of model.rooms) {
    const count = s.agentsByRoom[r.id];
    if (count === undefined || count.visitors + count.staff <= 0) continue;
    const fi = plan.floors.findIndex((f) => f.id === r.floorId);
    if (fi < 0) continue;
    const w = plan.floors[fi]!.widthCells;
    const cells = spread(startCells(plan, fi, r.id, fireSite, count.staff + count.visitors), count.staff + count.visitors);
    cells.forEach((c, j) => {
      const isStaff = j < count.staff;
      const a: AgentInput = { id: `${r.id}:${isStaff ? 's' : 'v'}${j + 1}`, type: isStaff ? 'staff' : 'visitor', floorId: r.floorId, xM: ((c % w) + 0.5) * CELL_SIZE_M, yM: (Math.floor(c / w) + 0.5) * CELL_SIZE_M };
      if (!isStaff && entry !== undefined) a.entryExitId = entry;
      agents.push(a);
    });
  }
  const crowd: Omit<CrowdInput, 'plan'> = { schemaVersion: 1, durationS: s.durationS, seed: s.seed, agents, alarmTimeS: s.alarmTimeS, fireSites: [fireSite] };
  return { scenario, plan, crowd, fireSite };
}
