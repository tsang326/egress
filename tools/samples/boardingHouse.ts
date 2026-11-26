// Sample 3: a four-storey boarding house on a narrow lot, one stair, one ground-floor exit (Requirement 18.4).
// INVENTED drawing, not a real building (Requirement 18.1, 18.7). MIT licence, like the rest of the project.
//
// All four floors are in one file, as separate blocks FLOOR1 to FLOOR4 placed side by side (Requirement 4.3: the
// importer translates each block so that the minimum corners coincide). Each floor has the same plan, so the stair
// has the same cell coordinates on adjacent floors.
import { Block, doorBlocksFor, Entity, LAYER, Sheet, writeDxf } from './draw';

const FLOORS = 4;
/** Distance between the floor blocks in the file, so that they do not overlap in a preview. Outer width is 6 m. */
const FLOOR_SPACING_X_M = 10.0;
const W = 6.0;
const H = 14.0;

/** One floor. Narrow lot: outer 6.0 m x 14.0 m. Corridor on the west side, stair at the north end of it, three rooms
 * on the east side. Only the ground floor has an outside door. */
function floorSheet(level: number): Sheet {
  const s = new Sheet();

  // Outer walls. Ground floor: the exit is a 1.0 m door at the south end of the corridor, swinging outward.
  s.hwall(0, 0, W, level === 1 ? [{ at: 0.5, widthM: 1.0, swing: 'south' }] : []);
  s.hwall(H - 0.25, 0, W);
  s.vwall(0, 0, H);
  s.vwall(W - 0.25, 0, H);

  // Wall between the corridor and the rooms, with one 1.0 m door per room, swinging into the room.
  s.vwall(1.75, 0, H, [
    { at: 1.5, widthM: 1.0, swing: 'east' },
    { at: 5.75, widthM: 1.0, swing: 'east' },
    { at: 9.0, widthM: 1.0, swing: 'east' },
  ]);
  // Partitions between the rooms.
  s.hwall(4.25, 1.75, W);
  s.hwall(8.25, 1.75, W);

  // Stair room at the north end of the corridor: interior x 0.25..1.75, y 10.5..13.75. Door from the corridor.
  s.hwall(10.25, 0, 2.0, [{ at: 0.5, widthM: 1.0, swing: 'north' }]);
  s.rect(LAYER.stair, 0.25, 10.5, 1.75, 13.75);
  for (let y = 10.75; y < 13.75; y += 0.25) s.line(LAYER.stair, [0.25, y], [1.75, y]);

  // Glazing on top of the east wall and the south wall.
  s.window(W - 0.25, 1.5, W, 3.0);
  s.window(W - 0.25, 5.75, W, 7.25);
  s.window(W - 0.25, 10.0, W, 11.5);
  s.window(3.0, 0, 5.0, 0.25);

  // Furniture: a bed in each room, a wardrobe in the first room and a table in the third.
  s.furniture(4.5, 0.5, 5.5, 2.5);
  s.furniture(2.25, 3.5, 3.25, 4.0);
  s.furniture(4.5, 4.75, 5.5, 6.75);
  s.furniture(4.5, 11.5, 5.5, 13.5);
  s.furniture(2.5, 12.5, 3.5, 13.5);

  return s;
}

export function buildBoardingHouse(): string {
  const widths = new Set<number>();
  const blocks: Block[] = [];
  const placed: Entity[] = [];

  for (let level = 1; level <= FLOORS; level++) {
    const sheet = floorSheet(level);
    for (const w of sheet.doorWidths) widths.add(w);
    const name = `FLOOR${level}`;
    blocks.push({ name, entities: sheet.entities });
    placed.push({
      t: 'INSERT',
      layer: '0', // the floor frame itself is not a wall, door or window
      name,
      at: [(level - 1) * FLOOR_SPACING_X_M, 0],
      scaleY: 1,
      rotDeg: 0,
    });
  }

  return writeDxf({
    comments: [
      'INVENTED SAMPLE DRAWING. This is not a real building. Made for the Egress app (MIT licence).',
      'Sample: boarding house, four floors as blocks FLOOR1 to FLOOR4, one stair, one ground-floor exit. Units: metres.',
    ],
    blocks: [...doorBlocksFor(widths), ...blocks],
    entities: placed,
  });
}
