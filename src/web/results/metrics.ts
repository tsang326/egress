// Numbers shown on the results and compare screens, all read from the two model results (no re-run).
import type { RunResult } from '../run/pipeline';
import { atEyeHeight, visibilityLimitM } from './planRenderer';
import { fireSeries } from './runView';

export interface RunMetrics {
  total: number;
  out: number;
  incapacitated: number;
  stillInside: number;
  evacuationTimeS: number | null; // last person out (crowd summary)
  fireRoomLimitM: number; // the crowd model's visibility limit for the fire room
  fireRoomSmokeLoggedS: number | null; // first sample where visibility at 1.6 m drops below that limit
}

export function fireRoomSmokeLoggedS(run: RunResult): { limitM: number; timeS: number | null } {
  const room = run.session.result.model!.rooms.find((r) => r.id === run.config.fireRoomId);
  const limitM = visibilityLimitM(room?.areaM2 ?? 0);
  const c = fireSeries(run);
  if (!c) return { limitM, timeS: null };
  for (let i = 0; i < run.fire.timesS.length; i++) if (atEyeHeight(c, i).visibilityM < limitM) return { limitM, timeS: run.fire.timesS[i]! };
  return { limitM, timeS: null };
}

export function metricsOf(run: RunResult): RunMetrics {
  const s = run.crowd.summary;
  const f = fireRoomSmokeLoggedS(run);
  return {
    total: s?.total ?? 0,
    out: s?.out ?? 0,
    incapacitated: s?.incapacitated ?? 0,
    stillInside: s?.stillInside ?? 0,
    evacuationTimeS: s?.evacuationTimeS ?? null,
    fireRoomLimitM: f.limitM,
    fireRoomSmokeLoggedS: f.timeS,
  };
}
