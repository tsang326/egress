// Small named Plans for crowd tests. Every one is an invented building and says so (Safety: Content).
import { buildPlan } from '../../src/core/people/plan/builder';
import { floorFromAscii } from '../../src/core/people/plan/ascii';
import type { FloorInput, Plan, StairLinkInput } from '../../src/core/people/types';

export const INVENTED_NOTE = 'Invented building for tests. It is not a real building.';

export interface SamplePlan {
  name: string;
  note: string;
  plan: Plan;
}

function make(name: string, floors: FloorInput[], stairLinks: StairLinkInput[] = []): SamplePlan {
  const r = buildPlan({ floors, stairLinks });
  if (r.status !== 'valid' || !r.plan) throw new Error(`sample plan ${name} is invalid: ${r.warnings.map((w) => w.message).join(' | ')}`);
  return { name, note: INVENTED_NOTE, plan: r.plan };
}

// One room 10 x 6 cells with a 2-cell exit in the right wall.
export const openRoomRows: readonly string[] = [
  '############',
  '#aaaaaaaaaa#',
  '#aaaaaaaaaaE',
  '#aaaaaaaaaaE',
  '#aaaaaaaaaa#',
  '#aaaaaaaaaa#',
  '#aaaaaaaaaa#',
  '############',
];
export const openRoom = (): SamplePlan => make('open room with one exit', [floorFromAscii(openRoomRows, { a: 'A' })]);

// Two rooms joined by a 2-cell door, exit in the right room.
export const twoRoomsRows: readonly string[] = [
  '#############',
  '#aaaaa#bbbbb#',
  '#aaaaa#bbbbb#',
  '#aaaaaDbbbbbE',
  '#aaaaaDbbbbbE',
  '#aaaaa#bbbbb#',
  '#aaaaa#bbbbb#',
  '#############',
];
export const twoRooms = (): SamplePlan => make('two rooms with a door', [floorFromAscii(twoRoomsRows, { a: 'A', b: 'B' })]);

// Two floors, a 2 x 2 stair at the same place on both, exit on the ground floor.
export const twoFloorsRows0: readonly string[] = [
  '###########',
  '#aaaaaaaaa#',
  '#SSaaaaaaaE',
  '#SSaaaaaaaE',
  '#aaaaaaaaa#',
  '#aaaaaaaaa#',
  '###########',
];
export const twoFloorsRows1: readonly string[] = [
  '###########',
  '#bbbbbbbbb#',
  '#SSbbbbbbb#',
  '#SSbbbbbbb#',
  '#bbbbbbbbb#',
  '#bbbbbbbbb#',
  '###########',
];
export const twoFloors = (): SamplePlan =>
  make(
    'two floors with a stair',
    [
      floorFromAscii(twoFloorsRows0, { a: 'G', S: 'G' }, { id: 'F0', elevationM: 0 }),
      floorFromAscii(twoFloorsRows1, { b: 'U', S: 'U' }, { id: 'F1', elevationM: 3 }),
    ],
    [{ id: 'stair1', lowerFloorId: 'F0', upperFloorId: 'F1' }],
  );

// A room whose only exit sits in a sealed pocket, so nobody can reach it.
export const sealedExitRows: readonly string[] = [
  '###############',
  '#aaaaaaa#.....#',
  '#aaaaaaa#....E#',
  '#aaaaaaa#....E#',
  '#aaaaaaa#.....#',
  '#aaaaaaa#.....#',
  '###############',
];
export const sealedExit = (): SamplePlan => make('sealed exit', [floorFromAscii(sealedExitRows, { a: 'A' })]);

// A room with no exit cell at all.
export const noExitRows: readonly string[] = [
  '##########',
  '#aaaaaaaa#',
  '#aaaaaaaa#',
  '#aaaaaaaa#',
  '#aaaaaaaa#',
  '##########',
];
export const noExit = (): SamplePlan => make('no exit', [floorFromAscii(noExitRows, { a: 'A' })]);

export const allSamples = (): SamplePlan[] => [openRoom(), twoRooms(), twoFloors(), sealedExit(), noExit()];
