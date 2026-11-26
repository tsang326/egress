// Floor settings (Req 10): defaults, range validation, stacking check and the elevation lookup shared by the crowd
// `FloorInput.elevationM` and the fire `Compartment.floorElevationM` (Req 10.7). Pure functions, no throws on bad input.
// Floors are ordered bottom to top in the array; a floor's neighbour above is the next entry.
import {
  CEILING_HEIGHT_MAX_M,
  CEILING_HEIGHT_MIN_M,
  DEFAULT_FLOOR_TO_FLOOR_HEIGHT_M,
  FLOOR_ELEVATION_MAX_M,
  FLOOR_ELEVATION_MIN_M,
  NAME_LENGTH_MAX,
  NAME_LENGTH_MIN,
} from '../constants';
import type { FloorSettings, ImportWarning } from '../types';
import { floorFieldInvalid, floorStacking } from '../warnings';

// Same 0.01 m as the fire model's stacking check (src/core/fire/validate/checks.ts STACKING_TOLERANCE_M), Req 10.3.
export const FLOOR_STACKING_TOLERANCE_M = 0.01;
// Estimate: slack for double rounding so a gap of exactly 0.01 m (e.g. 3.01 - 3) is not reported as "more than".
const STACKING_ROUNDING_SLACK_M = 1e-9;

export type FloorField = 'name' | 'elevationM' | 'ceilingHeightM';

export interface FloorSettingsResult {
  floors: FloorSettings[];
  warnings: ImportWarning[];
}

/** Default id of the n-th floor (1-based): floor1, floor2, ... (Req 10.2; ids as in the fixture helper). */
export const defaultFloorId = (n: number): string => `floor${n}`;

/** Default settings for `count` floors: elevation 0, 3, 6, ...; ceiling height = floor-to-floor height (Req 10.2, 10.3). */
export function defaultFloorSettings(floorIds: readonly string[]): FloorSettings[] {
  return floorIds.map((floorId, i) => ({
    floorId,
    name: `Floor ${i + 1}`,
    elevationM: i * DEFAULT_FLOOR_TO_FLOOR_HEIGHT_M,
    ceilingHeightM: DEFAULT_FLOOR_TO_FLOOR_HEIGHT_M,
  }));
}

const isFiniteIn = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Returns the accepted value, or null with the reason (Req 10.5; name length 1 to 60, Req 10.1). */
function validateField(field: FloorField, value: unknown): { ok: true } | { ok: false; detail: string } {
  if (field === 'elevationM') {
    return isFiniteIn(value, FLOOR_ELEVATION_MIN_M, FLOOR_ELEVATION_MAX_M)
      ? { ok: true }
      : { ok: false, detail: `elevation must be a number from ${FLOOR_ELEVATION_MIN_M} to ${FLOOR_ELEVATION_MAX_M} m` };
  }
  if (field === 'ceilingHeightM') {
    return isFiniteIn(value, CEILING_HEIGHT_MIN_M, CEILING_HEIGHT_MAX_M)
      ? { ok: true }
      : { ok: false, detail: `ceiling height must be a number from ${CEILING_HEIGHT_MIN_M} to ${CEILING_HEIGHT_MAX_M} m` };
  }
  return typeof value === 'string' && value.length >= NAME_LENGTH_MIN && value.length <= NAME_LENGTH_MAX
    ? { ok: true }
    : { ok: false, detail: `the name must have ${NAME_LENGTH_MIN} to ${NAME_LENGTH_MAX} characters` };
}

/**
 * Change one field of one floor (Req 10.1, 10.5). An invalid value is rejected: the previous value is kept and one
 * FLOOR_FIELD_INVALID warning names the field. An unknown floor id returns the floors unchanged with the same warning.
 * Stacking is not checked here; call `checkFloorStacking` on the result (Req 10.6).
 */
export function setFloorField(
  floors: readonly FloorSettings[],
  floorId: string,
  field: FloorField,
  value: unknown,
): FloorSettingsResult {
  const index = floors.findIndex((f) => f.floorId === floorId);
  if (index < 0) {
    return { floors: floors.slice(), warnings: [floorFieldInvalid(floorId, field, 'there is no such floor')] };
  }
  const check = validateField(field, value);
  if (!check.ok) {
    return { floors: floors.slice(), warnings: [floorFieldInvalid(floorId, field, check.detail)] };
  }
  const next = floors.slice();
  next[index] = { ...floors[index]!, [field]: value } as FloorSettings;
  return { floors: next, warnings: [] };
}

/**
 * Settings for the given floors from user input (Req 10.1 to 10.5). Floors without input get the defaults; each
 * invalid field falls back to its default (the previous value) with a FLOOR_FIELD_INVALID warning. Input for ids
 * that are not in `floorIds` is ignored. A missing ceiling height defaults to the distance to the next floor's
 * elevation when that lies in the allowed range, otherwise to DEFAULT_FLOOR_TO_FLOOR_HEIGHT_M (Req 10.3).
 * Stacking warnings are included.
 */
export function resolveFloorSettings(
  floorIds: readonly string[],
  provided: readonly Partial<FloorSettings>[] | undefined,
): FloorSettingsResult {
  const warnings: ImportWarning[] = [];
  const defaults = defaultFloorSettings(floorIds);
  const byId = new Map<string, Partial<FloorSettings>>();
  for (const p of provided ?? []) if (p && typeof p.floorId === 'string' && !byId.has(p.floorId)) byId.set(p.floorId, p);

  // Pass 1: names and elevations.
  const partial = defaults.map((d) => {
    const p = byId.get(d.floorId);
    const out = { ...d };
    if (!p) return out;
    for (const field of ['name', 'elevationM'] as const) {
      if (p[field] === undefined) continue;
      const check = validateField(field, p[field]);
      if (check.ok) (out as Record<string, unknown>)[field] = p[field];
      else warnings.push(floorFieldInvalid(d.floorId, field, check.detail));
    }
    return out;
  });

  // Pass 2: ceiling heights, whose default depends on the elevation of the floor above.
  const floors = partial.map((f, i) => {
    const p = byId.get(f.floorId);
    const above = partial[i + 1];
    const toNext = above ? above.elevationM - f.elevationM : Number.NaN;
    const fallback = isFiniteIn(toNext, CEILING_HEIGHT_MIN_M, CEILING_HEIGHT_MAX_M) ? toNext : DEFAULT_FLOOR_TO_FLOOR_HEIGHT_M;
    if (p?.ceilingHeightM === undefined) return { ...f, ceilingHeightM: fallback };
    const check = validateField('ceilingHeightM', p.ceilingHeightM);
    if (check.ok) return { ...f, ceilingHeightM: p.ceilingHeightM };
    warnings.push(floorFieldInvalid(f.floorId, 'ceilingHeightM', check.detail));
    return { ...f, ceilingHeightM: fallback };
  });

  warnings.push(...checkFloorStacking(floors));
  return { floors, warnings };
}

/** One FLOOR_STACKING warning per adjacent pair whose levels differ by more than 0.01 m; values are kept (Req 10.4). */
export function checkFloorStacking(floors: readonly FloorSettings[]): ImportWarning[] {
  const out: ImportWarning[] = [];
  for (let i = 0; i + 1 < floors.length; i++) {
    const lower = floors[i]!;
    const upper = floors[i + 1]!;
    const gapM = upper.elevationM - (lower.elevationM + lower.ceilingHeightM);
    if (Math.abs(gapM) > FLOOR_STACKING_TOLERANCE_M + STACKING_ROUNDING_SLACK_M) {
      out.push(floorStacking(lower.floorId, upper.floorId, Math.abs(gapM)));
    }
  }
  return out;
}

/**
 * The one elevation for a floor, used for the crowd `FloorInput.elevationM` and for `floorElevationM` of every
 * compartment of that floor (Req 10.7). Undefined for an unknown floor id.
 */
export function floorElevationM(floors: readonly FloorSettings[], floorId: string): number | undefined {
  return floors.find((f) => f.floorId === floorId)?.elevationM;
}
