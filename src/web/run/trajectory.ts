// Agent positions over time for the results plan (run-view spec, Requirement 5.2). CrowdResult has no per-step
// positions, so the crowd worker samples the agent store through runCrowd's onStep hook every FRAME_INTERVAL_S.
import type { StepView } from '../../core/people/types';

export const FRAME_INTERVAL_S = 0.5; // layout choice: smooth enough at 5x playback, 1200 frames for a 600 s run

// Display states. The crowd store has 0 pre-move, 1 moving, 2 in stair, 3 out, 4 incapacitated (people/types.ts,
// AgentStore.state); "queued" is a moving agent enrolled at a door or exit queue (AgentStore.gateEnrolled >= 0).
export const SHOW_WAITING = 0;
export const SHOW_MOVING = 1;
export const SHOW_STAIR = 2;
export const SHOW_OUT = 3;
export const SHOW_INCAPACITATED = 4;
export const SHOW_QUEUED = 5;

export interface Trajectory {
  intervalS: number;
  frames: number;
  n: number; // agents, in the order of `agentIds`
  agentIds: string[];
  x: Float32Array; // frames * n, metres on the agent's floor
  y: Float32Array;
  floor: Uint8Array; // floor index of the built Plan
  show: Uint8Array; // SHOW_* code
}

export interface Recorder {
  onStep: (v: StepView) => void;
  finish: () => Trajectory;
}

/** A recorder for a run of `durationS` with the given input agent ids. Frame k holds the state at k * intervalS
 * (frame 0 is taken at the first step). */
export function createRecorder(inputIds: readonly string[], durationS: number, intervalS = FRAME_INTERVAL_S): Recorder {
  const maxFrames = Math.floor(durationS / intervalS + 1e-9) + 1;
  let n = -1;
  let agentIds: string[] = [];
  let x = new Float32Array(0);
  let y = new Float32Array(0);
  let floor = new Uint8Array(0);
  let show = new Uint8Array(0);
  let frames = 0;
  const take = (v: StepView): void => {
    const s = v.store;
    const o = frames * n;
    for (let i = 0; i < n; i++) {
      x[o + i] = s.x[i]!;
      y[o + i] = s.y[i]!;
      floor[o + i] = s.floor[i]!;
      const st = s.state[i]!;
      show[o + i] = st === 1 && s.gateEnrolled[i]! >= 0 ? SHOW_QUEUED : st;
    }
    frames++;
  };
  return {
    onStep(v) {
      if (n < 0) {
        n = v.store.n;
        agentIds = Array.from({ length: n }, (_, i) => inputIds[v.inputIndex[i]!] ?? `agent${i}`);
        x = new Float32Array(maxFrames * n);
        y = new Float32Array(maxFrames * n);
        floor = new Uint8Array(maxFrames * n);
        show = new Uint8Array(maxFrames * n);
        take(v); // frame 0
        return;
      }
      if (frames < maxFrames && v.timeS + 1e-9 >= frames * intervalS) take(v);
    },
    finish() {
      if (n < 0) return { intervalS, frames: 0, n: 0, agentIds: [], x, y, floor, show };
      return { intervalS, frames, n, agentIds, x: x.slice(0, frames * n), y: y.slice(0, frames * n), floor: floor.slice(0, frames * n), show: show.slice(0, frames * n) };
    },
  };
}
