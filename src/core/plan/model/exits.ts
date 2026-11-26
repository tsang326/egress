// Exits (Req 12): suggestion on the ground floor, confirmation by door id, rejection of marks on doors that do not face
// the outside area, and the NO_EXIT warning. Pure functions, no throws on bad input. The crowd `exit` cells (Req 12.3)
// and the fire vent to the outside (Req 12.4) are made later by the derivers from `Door.isExit`.
// An outside-facing door is a non-window door with 'OUTSIDE' on one side and a room on the other. Windows are never
// exits. A door with 'OUTSIDE' on both sides cannot come from rooms.ts and is not outside-facing.
import type { Door, FloorSettings, ImportWarning } from '../types';
import { editIgnored, exitRejected, noExit } from '../warnings';

const OUTSIDE = 'OUTSIDE';

export interface ExitsResult {
  doors: Door[]; // copies of the input doors with `isExit` set from the marks; input untouched
  exitDoorIds: string[]; // accepted marks, in input order, no duplicates (Req 12.7)
  warnings: ImportWarning[];
}

/** True when the door is a door (not a window) with the outside area on exactly one side and a room on the other. */
export function isOutsideFacing(door: Door): boolean {
  if (door.isWindow) return false;
  return (door.roomIdA === OUTSIDE) !== (door.roomIdB === OUTSIDE);
}

/** Id of the lowest-elevation floor (the ground floor, Req 12.1); the first one listed on a tie; undefined if none. */
export function groundFloorId(floors: readonly FloorSettings[]): string | undefined {
  let best: FloorSettings | undefined;
  for (const f of floors) if (best === undefined || f.elevationM < best.elevationM) best = f;
  return best?.floorId;
}

/**
 * Suggested, unconfirmed exits (Req 12.1): ids of the outside-facing doors on the ground floor, in door order.
 * The result is a suggestion only; nothing is marked until the caller passes the ids to `applyExits`.
 */
export function suggestExits(doors: readonly Door[], floors: readonly FloorSettings[]): string[] {
  const ground = groundFloorId(floors);
  if (ground === undefined) return [];
  return doors.filter((d) => d.floorId === ground && isOutsideFacing(d)).map((d) => d.id);
}

/**
 * Marks the confirmed exits (Req 12.2, 12.5, 12.6, 12.7). Confirm, add or remove is the same call: the marks are the
 * full set, so a door missing from `confirmedDoorIds` is not an exit. A mark on a door that does not face the outside is
 * rejected with EXIT_REJECTED naming the door; a mark on an unknown id is ignored with EDIT_IGNORED. Exits may be on
 * any floor. NO_EXIT is added when no door ends up marked; the doors are returned either way.
 */
export function applyExits(doors: readonly Door[], confirmedDoorIds: readonly string[]): ExitsResult {
  const byId = new Map<string, Door>();
  for (const d of doors) byId.set(d.id, d);
  const accepted = new Set<string>();
  const exitDoorIds: string[] = [];
  const warnings: ImportWarning[] = [];
  const seen = new Set<string>();
  for (const id of confirmedDoorIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const door = byId.get(id);
    if (door === undefined) {
      warnings.push(editIgnored(`the exit mark for door "${id}" was dropped because no such door exists`));
    } else if (!isOutsideFacing(door)) {
      warnings.push(exitRejected(door.id, door.floorId));
    } else {
      accepted.add(id);
      exitDoorIds.push(id);
    }
  }
  if (accepted.size === 0) warnings.push(noExit());
  return {
    doors: doors.map((d) => ({ ...d, isExit: accepted.has(d.id) })),
    exitDoorIds,
    warnings,
  };
}
