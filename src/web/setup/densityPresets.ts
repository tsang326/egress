// Occupancy presets (run-view spec, Requirement 2.3): how many visitors and staff start in each room. The densities are
// estimates for comparing layouts, not occupant loads for a design; the setup screen labels them so.
import type { Room } from '../../core/plan/types';

export type DensityPreset = 'visitors_light' | 'visitors_heavy' | 'visitors_plus_staff';

export interface PresetInfo {
  id: DensityPreset;
  label: string;
  visitorsPerM2: number;
  staffPerRoom: number;
  note: string;
}

export const PRESETS: readonly PresetInfo[] = [
  // Estimate: a quiet hour, one person per 20 m2.
  { id: 'visitors_light', label: 'Few visitors (0.05 per m²)', visitorsPerM2: 0.05, staffPerRoom: 0, note: 'Estimate: a quiet hour.' },
  // Estimate: a busy evening, one person per 10 m2, plus one member of staff per room (Requirement 2.3).
  { id: 'visitors_plus_staff', label: 'Visitors (0.1 per m²) and 1 staff per room', visitorsPerM2: 0.1, staffPerRoom: 1, note: 'Estimate: a busy evening.' },
  // IBC 2021 Table 1004.5, assembly "unconcentrated (tables and chairs)": 15 ft2 net per person = 1.39 m2, about
  // 0.7 per m2. That is a design maximum for code occupant loads, used here as "full".
  { id: 'visitors_heavy', label: 'Full (0.7 per m², IBC table-and-chairs load)', visitorsPerM2: 0.7, staffPerRoom: 0, note: 'IBC 2021 Table 1004.5, 1.39 m² per person: the most a room of tables and chairs is designed for.' },
];

export const DEFAULT_PRESET: DensityPreset = 'visitors_plus_staff';

export interface RoomCount {
  visitors: number;
  staff: number;
}

/** People per room for a preset. Corridors and stairs start empty; every other room gets the preset's staff first and
 * round(area x density) visitors. */
export function presetCounts(rooms: readonly Room[], preset: DensityPreset): Record<string, RoomCount> {
  const info = PRESETS.find((p) => p.id === preset)!;
  const out: Record<string, RoomCount> = {};
  for (const r of rooms) {
    if (r.kind !== 'room') {
      out[r.id] = { visitors: 0, staff: 0 };
      continue;
    }
    out[r.id] = { visitors: Math.round(r.areaM2 * info.visitorsPerM2), staff: info.staffPerRoom };
  }
  return out;
}
