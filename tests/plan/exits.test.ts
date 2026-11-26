import { describe, expect, it } from 'vitest';
import { applyExits, groundFloorId, isOutsideFacing, suggestExits } from '../../src/core/plan/model/exits';
import type { Door, FloorSettings } from '../../src/core/plan/types';

// Unit tests for exits. Req 12.1, 12.2, 12.5, 12.6, 12.7.

const floor = (floorId: string, elevationM: number): FloorSettings => ({
  floorId,
  name: floorId,
  elevationM,
  ceilingHeightM: 2.5,
});
const door = (id: string, floorId: string, a: string, b: string, extra: Partial<Door> = {}): Door => ({
  id,
  floorId,
  cells: Int32Array.of(1, 2),
  widthM: 0.9,
  open: false,
  roomIdA: a,
  roomIdB: b,
  isWindow: false,
  isExit: false,
  ...extra,
});
const codes = (ws: readonly { code: string }[]) => ws.map((w) => w.code);

// Floors listed upper first so that "first listed" cannot pass for "lowest".
const floors = [floor('F1', 3), floor('F0', 0)];
const doors = [
  door('g-out', 'F0', 'R0', 'OUTSIDE'),
  door('g-out2', 'F0', 'OUTSIDE', 'R0'),
  door('g-inner', 'F0', 'R0', 'R1'),
  door('g-window', 'F0', 'R0', 'OUTSIDE', { isWindow: true }),
  door('u-out', 'F1', 'R2', 'OUTSIDE'),
  door('u-inner', 'F1', 'R2', 'R3'),
];

describe('suggestExits (Req 12.1)', () => {
  it('suggests only outside-facing doors on the lowest floor', () => {
    expect(groundFloorId(floors)).toBe('F0');
    expect(suggestExits(doors, floors)).toEqual(['g-out', 'g-out2']);
  });

  it('does not mark anything: suggestions stay unconfirmed', () => {
    suggestExits(doors, floors);
    expect(doors.every((d) => !d.isExit)).toBe(true);
    expect(applyExits(doors, []).doors.every((d) => !d.isExit)).toBe(true);
  });

  it('returns nothing without floors', () => {
    expect(groundFloorId([])).toBeUndefined();
    expect(suggestExits(doors, [])).toEqual([]);
  });

  it('treats windows and doors between rooms as not outside-facing', () => {
    expect(isOutsideFacing(doors[3]!)).toBe(false);
    expect(isOutsideFacing(doors[2]!)).toBe(false);
    expect(isOutsideFacing(doors[0]!)).toBe(true);
  });
});

describe('applyExits (Req 12.2, 12.5, 12.6, 12.7)', () => {
  it('confirms exits on any floor with an outside-facing door', () => {
    const r = applyExits(doors, ['g-out', 'u-out']);
    expect(r.warnings).toEqual([]);
    expect(r.exitDoorIds).toEqual(['g-out', 'u-out']);
    expect(r.doors.filter((d) => d.isExit).map((d) => d.id)).toEqual(['g-out', 'u-out']);
  });

  it('removes an exit by leaving it out of the next set, without touching the input', () => {
    const first = applyExits(doors, ['g-out', 'g-out2']);
    const second = applyExits(first.doors, ['g-out2']);
    expect(second.doors.filter((d) => d.isExit).map((d) => d.id)).toEqual(['g-out2']);
    expect(doors.every((d) => !d.isExit)).toBe(true);
  });

  it('rejects a mark on a door with no outside side and names the door', () => {
    const r = applyExits(doors, ['g-inner', 'g-out']);
    expect(codes(r.warnings)).toEqual(['EXIT_REJECTED']);
    expect(r.warnings[0]!.message).toContain('g-inner');
    expect(r.exitDoorIds).toEqual(['g-out']);
    expect(r.doors.find((d) => d.id === 'g-inner')!.isExit).toBe(false);
  });

  it('rejects a window mark', () => {
    const r = applyExits(doors, ['g-window']);
    expect(codes(r.warnings)).toEqual(['EXIT_REJECTED', 'NO_EXIT']);
  });

  it('ignores an unknown id with EDIT_IGNORED', () => {
    const r = applyExits(doors, ['nope', 'g-out']);
    expect(codes(r.warnings)).toEqual(['EDIT_IGNORED']);
    expect(r.exitDoorIds).toEqual(['g-out']);
  });

  it('warns NO_EXIT once when none is confirmed and still returns every door', () => {
    const r = applyExits(doors, []);
    expect(codes(r.warnings)).toEqual(['NO_EXIT']);
    expect(r.doors).toHaveLength(doors.length);
    expect(applyExits([], []).warnings.map((w) => w.code)).toEqual(['NO_EXIT']);
  });

  it('keys marks by door id, in order, without duplicates', () => {
    const r = applyExits(doors, ['u-out', 'g-out', 'u-out']);
    expect(r.exitDoorIds).toEqual(['u-out', 'g-out']);
    expect(r.warnings).toEqual([]);
  });
});
