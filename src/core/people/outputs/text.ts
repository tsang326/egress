// Every user-visible output string of a run is built here from fixed templates (Design, "Outputs"; Requirements 6.3, 6.6,
// 6.8, 6.9). No string says or implies that a building is acceptable. The time of the last exit is always called
// "evacuation time". The notice is the only string that contains "fire-safety review".
// Requirement 6.8: the notice shown with every result.
export const NOTICE =
  'This is a simplified simulation for understanding risks. It does not replace a fire-safety review by the authorities or an engineer.';
// Whole seconds as "2 min 41 s" (or "41 s" under a minute). Rounds to the nearest second.
export function formatDuration(timeS: number): string {
  const total = Math.max(0, Math.round(timeS));
  const min = Math.floor(total / 60);
  const s = total % 60;
  return min > 0 ? `${min} min ${s} s` : `${s} s`;
}
const persons = (n: number): string => (n === 1 ? '1 person' : `${n} people`);
export const NO_ONE_OUT_TEXT = 'No one got out.';
export const NO_AGENTS_TEXT = 'There were no people in this run.';
export function evacuationTimeText(timeS: number): string {
  return `The evacuation time (last person out) was ${formatDuration(timeS)}.`;
}
export function outText(out: number, total: number): string {
  return `${out} of ${total} people got out.`;
}
// Requirement 6.6: the two counts as separate integers, in one sentence.
export function incapacitatedAndInsideText(incapacitated: number, stillInside: number): string {
  const first = `${persons(incapacitated)} ${incapacitated === 1 ? 'was' : 'were'} incapacitated`;
  const second = `${stillInside} ${stillInside === 1 ? 'was' : 'were'} still inside`;
  return `${first} and ${second} at the end of the run.`;
}
// ISO 13571 treats a dose of 1 as the median incapacitating dose (Design, Tenability).
export const MEDIAN_DOSE_TEXT =
  'A dose (FED) of 1.0 is the median incapacitating dose: about half of a group is affected at a lower dose and half at a higher one.';
export interface SummaryCounts {
  total: number;
  out: number;
  incapacitated: number;
  stillInside: number;
  evacuationTimeS: number | null;
}
export function summaryText(c: SummaryCounts): string[] {
  const lines: string[] = [];
  if (c.total === 0) return [NO_AGENTS_TEXT];
  if (c.out === 0 || c.evacuationTimeS === null) lines.push(NO_ONE_OUT_TEXT);
  else {
    lines.push(outText(c.out, c.total));
    lines.push(evacuationTimeText(c.evacuationTimeS));
  }
  if (c.incapacitated > 0 || c.stillInside > 0) lines.push(incapacitatedAndInsideText(c.incapacitated, c.stillInside));
  if (c.incapacitated > 0) lines.push(MEDIAN_DOSE_TEXT);
  return lines;
}
