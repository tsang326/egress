// Difference table of two runs (run-view spec, Requirement 6.3). Values come from each run's own result; the
// difference is B minus A, null when either side has no value.
import type { RunMetrics } from '../results/metrics';

export interface DiffRow {
  key: 'out' | 'incapacitated' | 'evacuationTimeS' | 'fireRoomSmokeLoggedS';
  label: string;
  a: number | null;
  b: number | null;
  diff: number | null;
  unit: 'people' | 's';
}

export function diffRows(a: RunMetrics, b: RunMetrics): DiffRow[] {
  const row = (key: DiffRow['key'], label: string, unit: DiffRow['unit']): DiffRow => {
    const va = a[key];
    const vb = b[key];
    return { key, label, a: va, b: vb, diff: va === null || vb === null ? null : vb - va, unit };
  };
  return [
    row('out', 'People out', 'people'),
    row('incapacitated', 'Incapacitated', 'people'),
    row('evacuationTimeS', 'Evacuation time (last person out)', 's'),
    row('fireRoomSmokeLoggedS', 'Fire room smoke-logged at 1.6 m', 's'),
  ];
}
