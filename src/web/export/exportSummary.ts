// "Download summary" (run-view spec, Requirement 7.2): the summary as plain text, and the plan at the current time as
// a PNG (canvas.toDataURL).
import { fireChoiceLabel } from '../../core/fire/library';
import { SAFETY_NOTICE } from '../plan/importScreen';
import type { RunResult } from '../run/pipeline';
import { metricsOf } from '../results/metrics';
import { fmtTime } from '../ui';

export function summaryText(run: RunResult): string {
  const m = metricsOf(run);
  const room = run.session.result.model!.rooms.find((r) => r.id === run.config.fireRoomId);
  const lines = [
    `Egress run: ${run.session.title}`,
    `Fire: ${run.config.fireChoice ? fireChoiceLabel(run.config.fireChoice) : '-'} in ${room?.name ?? '-'} (${room?.floorId ?? ''})`,
    `Alarm at ${run.config.alarmTimeS} s, run length ${run.config.durationS} s, seed ${run.config.seed}`,
    '',
    ...(run.crowd.summary?.text ?? []),
    '',
    `People: ${m.total}; out ${m.out}; incapacitated ${m.incapacitated}; still inside ${m.stillInside}`,
    `Evacuation time (last person out): ${m.out > 0 ? fmtTime(m.evacuationTimeS) : 'Nobody got out'}`,
    `Fire room smoke-logged at 1.6 m (visibility below ${m.fireRoomLimitM} m): ${m.fireRoomSmokeLoggedS === null ? 'not within the run' : fmtTime(m.fireRoomSmokeLoggedS)}`,
    '',
    SAFETY_NOTICE,
  ];
  const inc = run.crowd.agents.filter((a) => a.finalState === 'incapacitated');
  if (inc.length > 0) {
    lines.splice(lines.length - 2, 0, '', 'Incapacitated:', ...inc.map((a) => `  ${a.id} at ${fmtTime(a.incapacitatedTimeS)}: ${a.causes.join(', ')}`));
  }
  return lines.join('\n') + '\n';
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, fileName: string): void {
  let url = '';
  try {
    url = canvas.toDataURL('image/png');
  } catch {
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
