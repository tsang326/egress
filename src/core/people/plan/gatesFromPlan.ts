// Door runs, exit groups and stair entries become Gate descriptors (Design, Plan builder step 3).
import {
  CELL_SIZE_M,
  DOOR_BOUNDARY_LAYER_M,
  DOOR_SPECIFIC_FLOW_PER_S_M,
  EFFECTIVE_WIDTH_MIN_M,
  SPEED_DENSITY_SLOPE,
} from '../constants';
import type { CrowdWarning, ExitSpec, GateSpec, PlanFloor } from '../types';
import { CELL_DOOR, CELL_EXIT } from '../types';
import { doorTooNarrow } from '../warnings';

// Requirement 2.9 and SFPE effective width: W_eff = max(W - 2 * boundary layer, minimum), m.
export const effectiveWidthM = (widthM: number): number => Math.max(widthM - 2 * DOOR_BOUNDARY_LAYER_M, EFFECTIVE_WIDTH_MIN_M);

// Specific flow of a stair entry, persons/(s m): the maximum of S(D) * D for S = k (1 - a D), which is k / (4 a)
// at D = 1 / (2 a) (SFPE). For k = 1.4 this gives 1.316, the door value 1.3 rounded down (Design, Gates).
export const stairSpecificFlowPerSM = (kStairMPerS: number): number => kStairMPerS / (4 * SPEED_DENSITY_SLOPE);

interface Run {
  cells: Int32Array; // ascending cell indices
  widthCellsBox: number;
  heightCellsBox: number;
}

// Connected runs (4-neighbour) of cells of type `type`, in row-major order of their first cell.
function findRuns(f: PlanFloor, type: number): Run[] {
  const { widthCells: w, heightCells: h, cellType } = f;
  const seen = new Uint8Array(w * h);
  const runs: Run[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (cellType[start] !== type || seen[start] === 1) continue;
    const cells: number[] = [];
    let minX = w, maxX = 0, minY = h, maxY = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const c = stack.pop()!;
      cells.push(c);
      const x = c % w;
      const y = (c - x) / w;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (x + 1 < w) visit(c + 1);
      if (x > 0) visit(c - 1);
      if (y + 1 < h) visit(c + w);
      if (y > 0) visit(c - w);
    }
    runs.push({ cells: Int32Array.from(cells).sort(), widthCellsBox: maxX - minX + 1, heightCellsBox: maxY - minY + 1 });
  }
  return runs;
  function visit(n: number): void {
    if (cellType[n] === type && seen[n] === 0) {
      seen[n] = 1;
      stack.push(n);
    }
  }
}

export interface GatesFromFloors {
  gates: GateSpec[];
  exits: ExitSpec[];
  warnings: CrowdWarning[];
}

// Doors first, then exit groups, per floor in floor order. Sets `gateOfCell` on the floors. A run none of whose cells
// fits an agent gets DOOR_TOO_NARROW; its cells are not nodes, so it is closed in the Flow_Field (step 4).
// Labels and exit ids are `<floorId>:door<k>` and `<floorId>:exit<k>`, k counted from 1 in row-major order.
export function gatesFromFloors(floors: PlanFloor[]): GatesFromFloors {
  const gates: GateSpec[] = [];
  const exits: ExitSpec[] = [];
  const warnings: CrowdWarning[] = [];
  for (const f of floors) {
    for (const [type, kind, word] of [[CELL_DOOR, 'door', 'door'], [CELL_EXIT, 'exit', 'exit']] as const) {
      findRuns(f, type).forEach((run, k) => {
        // The longer side of the bounding box, assuming the run is drawn across the flow (Design, step 3).
        const widthM = Math.max(run.widthCellsBox, run.heightCellsBox) * CELL_SIZE_M;
        const label = `${f.id}:${word}${k + 1}`;
        const gateId = gates.length;
        gates.push({
          id: gateId,
          kind,
          label,
          floorIndex: f.index,
          cells: run.cells,
          widthM,
          effectiveWidthM: effectiveWidthM(widthM),
          specificFlowPerSM: DOOR_SPECIFIC_FLOW_PER_S_M,
          linkIndex: -1,
        });
        for (const c of run.cells) f.gateOfCell[c] = gateId;
        if (kind === 'exit') exits.push({ id: label, floorIndex: f.index, cells: run.cells, gateId });
        if (!run.cells.some((c) => f.fitsAgent[c] === 1)) warnings.push(doorTooNarrow(f.id, label, widthM));
      });
    }
  }
  return { gates, exits, warnings };
}

// The two gates of a stair link: up (entered on the lower floor) and down (entered on the upper floor). Ids start at
// `firstId`. Width is the link width; the specific flow comes from the link's table speed.
export function stairGatePair(
  firstId: number,
  linkIndex: number,
  linkId: string,
  lowerFloor: number,
  upperFloor: number,
  footprint: Int32Array,
  widthM: number,
  kStairMPerS: number,
): [GateSpec, GateSpec] {
  const make = (id: number, dir: string, floorIndex: number): GateSpec => ({
    id,
    kind: 'stair',
    label: `stair ${linkId} ${dir}`,
    floorIndex,
    cells: footprint,
    widthM,
    effectiveWidthM: effectiveWidthM(widthM),
    specificFlowPerSM: stairSpecificFlowPerSM(kStairMPerS),
    linkIndex,
  });
  return [make(firstId, 'up', lowerFloor), make(firstId + 1, 'down', upperFloor)];
}
