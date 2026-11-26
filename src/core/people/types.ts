// Types of the crowd model (types and cell-code constants only, no logic). Shapes follow the Data Models section of
// .kiro/specs/crowd/design.md. SI units; names carry the unit where it is not obvious.
import type { ProgressEvent } from '../fire/types';
// ---------------------------------------------------------------------------------------------
// Plan input and built Plan
// ---------------------------------------------------------------------------------------------
export type CellTypeName = 'wall' | 'free' | 'door' | 'exit' | 'stair';
// Uint8 codes of the cell types, as stored in PlanFloor.cellType.
export const CELL_WALL = 0;
export const CELL_FREE = 1;
export const CELL_DOOR = 2;
export const CELL_EXIT = 3;
export const CELL_STAIR = 4;
// Uint16 value in PlanFloor.compartment for a cell with no compartment.
export const NO_COMPARTMENT = 0xffff;
export interface FloorInput {
  id: string;
  elevationM: number; // finite, -10..100 (Requirement 1.1)
  widthCells: number;
  heightCells: number;
  cells: ArrayLike<number | CellTypeName>; // row-major, y * widthCells + x
  compartmentIds: ArrayLike<string | null>; // same indexing; null for none
}
export interface StairLinkInput {
  id: string;
  lowerFloorId: string;
  upperFloorId: string; // adjacent floor
  riserM?: number; // default STAIR_DEFAULT_RISER_M
  treadM?: number; // default STAIR_DEFAULT_TREAD_M
  widthM?: number; // default: shorter side of the footprint box
}
export type CompartmentKind = 'room' | 'corridor' | 'shaft';
export interface CompartmentInfo {
  id: string;
  kind?: CompartmentKind;
}
export interface PlanInput {
  floors: FloorInput[];
  stairLinks: StairLinkInput[];
  compartments?: CompartmentInfo[]; // optional kinds for the long-corridor warning
}
export interface PlanLimits {
  maxFloors: number;
  maxCompartments: number;
  maxCellsPerFloor: number;
}
export interface PlanResult {
  status: 'valid' | 'invalid';
  plan: Plan | null; // null when invalid
  warnings: CrowdWarning[];
}
export interface PlanFloor {
  id: string;
  index: number;
  elevationM: number;
  widthCells: number;
  heightCells: number;
  cellType: Uint8Array;
  compartment: Uint16Array;
  gateOfCell: Int16Array; // gate id of a door or exit cell, -1 otherwise
  fitsAgent: Uint8Array; // 1 when a body disc of Agent_Radius fits in the cell
  clearanceCost: Float32Array; // wall-clearance cost of the cell, in cell lengths
}
export interface GateSpec {
  id: number;
  kind: 'door' | 'exit' | 'stair';
  label: string;
  floorIndex: number;
  cells: Int32Array; // cell indices (for stairs: the entry footprint on its floor)
  widthM: number;
  effectiveWidthM: number;
  specificFlowPerSM: number; // persons / (s m) of effective width
  linkIndex: number; // stair link, else -1
}
export interface ExitSpec {
  id: string;
  floorIndex: number;
  cells: Int32Array;
  gateId: number;
}
export interface StairLinkModel {
  id: string;
  lowerFloor: number;
  upperFloor: number;
  footprint: Int32Array; // cell indices, identical on both floors
  inclineLengthM: number; // dz * sqrt(1 + (tread / riser)^2)
  widthM: number;
  speedFreeMPerS: number; // SFPE k for riser/tread (constants.ts)
  gateUp: number;
  gateDown: number; // gate ids for the two directions
}
export interface ExitField {
  exitIndex: number;
  cost: Float64Array; // cost to go, in cell lengths; Infinity when unreachable
  next: Int32Array; // node of the cheapest neighbour, -1 at exits and unreachable nodes
}
// Node index of cell c on floor f is nodeOffset[f] + c.
export interface Plan {
  floors: PlanFloor[];
  compartmentIds: string[]; // index = compartment index used in Uint16 maps
  compartmentKinds?: readonly (CompartmentKind | null)[]; // same index; from PlanInput.compartments, for LONG_CORRIDOR
  nodeOffset: Int32Array; // first node index of each floor
  nodeCount: number;
  gates: GateSpec[]; // doors, exits, stair entries
  exits: ExitSpec[]; // exit groups, one Flow_Field each
  stairLinks: StairLinkModel[];
  baseFields: ExitField[]; // one per exit group, no smoke (Requirement 1.9)
}
// ---------------------------------------------------------------------------------------------
// Crowd input and result
// ---------------------------------------------------------------------------------------------
export type AgentType = 'visitor' | 'staff';
export interface AgentInput {
  id: string;
  type: AgentType | string; // other strings are excluded with a Warning (Requirement 3.2)
  floorId: string;
  xM: number;
  yM: number; // metres from the floor's origin corner
  entryExitId?: string; // visitors (Requirement 3.3)
}
export interface DelayParams {
  medianS: number;
  logSd: number;
}
export interface CrowdInput {
  schemaVersion: 1;
  durationS: number; // finite, > 0
  seed: number;
  plan: Plan; // a valid Plan from buildPlan
  agents: AgentInput[];
  alarmTimeS?: number | null; // Alert for everyone at this time
  guidance?: { signExitIds?: string[] };
  delay?: { visitor?: DelayParams; staff?: DelayParams };
  smokeLaw?: 'jin-non-irritant' | 'jin-irritant'; // default non-irritant
  ambientTempK?: number; // default AMBIENT_TEMP_K, used where no compartment applies
  fireSites?: { floorId: string; xM: number; yM: number }[]; // for the near-fire Warning
  unmeasuredMaterialSites?: { floorId: string; xM: number; yM: number; material: string }[];
}
export type FinalState = 'out' | 'incapacitated' | 'still inside';
export type IncapCause = 'asphyxiant FED' | 'heat FED' | 'temperature limit';
export interface AgentRecord {
  id: string;
  type: AgentType;
  finalState: FinalState;
  exitTimeS: number | null;
  exitId: string | null;
  incapacitatedTimeS: number | null;
  causes: IncapCause[];
  preMovementDelayS: number;
  everBlocked: boolean;
  fedHistory: { timesS: Float64Array; fed: Float64Array }; // every 1 s plus the final sample
  finalFloorId: string;
  finalXM: number;
  finalYM: number;
}
export interface GateSeries {
  gateId: number;
  label: string;
  kind: 'door' | 'exit' | 'stair';
  timesS: Float64Array; // 0, 1, 2, ... duration
  flowPersonsPerS: Float64Array; // persons crossing during the last second
  queueLength: Float64Array; // persons waiting at the sample time
}
export interface FloorHeatMap {
  floorId: string;
  widthCells: number;
  heightCells: number;
  personSeconds: Float64Array;
}
export interface CrowdSummary {
  total: number;
  out: number;
  incapacitated: number;
  stillInside: number;
  evacuationTimeS: number | null; // last exit time, null if nobody is out
  text: string[]; // plain-language lines, all built in outputs/text.ts
}
// Counters recorded only with CrowdRunOptions.recordStats (benchmark).
export interface CrowdStats {
  steps: number;
  fieldRecomputes: number;
  dijkstraNodes: number;
}
export interface CrowdResult {
  status: 'ok' | 'invalid' | 'failed';
  warnings: CrowdWarning[];
  notice: string; // Requirement 6.8
  summary: CrowdSummary | null; // null when invalid
  agents: AgentRecord[];
  gates: GateSeries[];
  congestion: FloorHeatMap[];
  stats?: CrowdStats;
}
// What a test sees after every step (CrowdRunOptions.onStep). Agent numbers index the live `store`; `inputIndex[k]` is the
// position of agent k in CrowdInput.agents. Nothing here is used by the app.
export interface StepView {
  step: number; // index of the step that just ran
  timeS: number; // (step + 1) * dt
  store: Readonly<AgentStore>;
  inputIndex: readonly number[];
  fields: readonly ExitField[]; // the Flow_Fields in force during the step
  crossings: readonly { gateId: number; agent: number }[]; // crossings recorded in this step, in order
  enrolments: readonly { gateId: number; agent: number }[]; // queue joins in this step, in order
  stairEntries: readonly { agent: number; linkIndex: number; fromFloor: number; toFloor: number; cell: number; costFrom: number; costTo: number }[];
  stairTransfers: readonly { agent: number; fromFloor: number; toFloor: number; cell: number }[];
}
export interface CrowdRunOptions {
  onProgress?: (e: ProgressEvent) => void;
  recordStats?: boolean; // fills CrowdResult.stats
  onStep?: (view: StepView) => void; // test hook, called after every step; costs time and memory, off by default
}
// ---------------------------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------------------------
export type CrowdWarningCode =
  | 'PLAN_LIMIT' | 'PLAN_CELL_TYPE' | 'PLAN_ELEVATION' | 'PLAN_LARGE' | 'STAIR_LINK_MISMATCH' | 'STAIR_GEOMETRY_RANGE'
  | 'COMPARTMENT_MISSING_IN_FIRE' | 'NO_EXIT' | 'AGENT_START_INVALID' | 'UNREACHABLE_REGION'
  | 'DOOR_TOO_NARROW' | 'AGENT_TYPE_REJECTED' | 'ENTRY_EXIT_ESTIMATED' | 'DELAY_PARAMS_REJECTED'
  | 'FIRE_STATUS' | 'FIRE_RESULT_ENDED' | 'FED_INPUT_INVALID' | 'AGENT_BLOCKED'
  | 'STAIR_RESULT' | 'LONG_CORRIDOR' | 'NEAR_FIRE' | 'UNMEASURED_MATERIAL'
  | 'INPUT_INVALID' | 'WORKER_REQUEST_INVALID' | 'WARNINGS_TRUNCATED' | 'INTERNAL_ERROR';
export interface CrowdWarning {
  code: CrowdWarningCode;
  severity: 'error' | 'warning';
  message: string; // plain language
  location: {
    kind: 'plan' | 'floor' | 'cell' | 'agent' | 'gate' | 'stair' | 'fire' | 'field';
    id?: string;
    floorId?: string;
    xM?: number;
    yM?: number;
    field?: string;
  };
  timeS: number | null;
  source?: string;
}
// ---------------------------------------------------------------------------------------------
// Agent store (structure of arrays)
// ---------------------------------------------------------------------------------------------
export interface AgentStore {
  n: number;
  x: Float64Array;
  y: Float64Array; // metres on the agent's floor
  floor: Uint8Array;
  cell: Int32Array; // cell index on the floor
  state: Uint8Array; // 0 pre-move, 1 moving, 2 in stair, 3 out, 4 incapacitated
  flags: Uint8Array; // bit 0 blocked, 1 alerted, 2 ever blocked, 3 near-fire warned
  delaySteps: Int32Array; // pre-movement delay as a step index
  alertStep: Int32Array; // step at which the agent was alerted (alarm or smoke), -1 before; the delay counts from here
  exitChoice: Int16Array; // exit index
  known: Uint8Array; // n * nExits, 1 when the agent knows the exit
  fedAsph: Float64Array;
  fedHeat: Float64Array;
  causeMask: Uint8Array;
  stairLink: Int16Array;
  stairS: Float64Array;
  stairDir: Int8Array;
  gateEnrolled: Int16Array; // gate id the agent is queued at, -1 none
  insideSteps: Int32Array; // steps spent inside the model (integer)
  exitStep: Int32Array;
  incapStep: Int32Array; // -1 when not set
}
