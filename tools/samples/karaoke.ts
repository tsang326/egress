// Sample 2: a karaoke bar, one floor, eight small rooms off one corridor, one exit (Requirement 18.3).
// INVENTED drawing, not a real building (Requirement 18.1, 18.7). MIT licence, like the rest of the project.
import { doorBlocksFor, HDoor, LAYER, Sheet, writeDxf } from './draw';

/** Outer walls x 0..20, y 0..11. Corridor interior y 4.25..5.75; south rooms y 0.25..4.0; north rooms y 6.0..10.75. */
export function buildKaraoke(): string {
  const s = new Sheet();
  const W = 20.0;
  const H = 11.0;
  // Room interiors start at 0.25 and repeat every 5 m (a 0.25 m partition after each 4.75 m room).
  const roomStartsX = [0.25, 5.25, 10.25, 15.25];

  // Doors: each room has a 1.0 m door 1.5 m from its left partition, swinging into the room.
  const southDoors: HDoor[] = roomStartsX.map((x) => ({ at: x + 1.5, widthM: 1.0, swing: 'south' }));
  const northDoors: HDoor[] = roomStartsX.map((x) => ({ at: x + 1.5, widthM: 1.0, swing: 'north' }));

  s.hwall(0, 0, W);
  s.hwall(H - 0.25, 0, W);
  s.hwall(4.0, 0, W, southDoors); // corridor south wall
  s.hwall(5.75, 0, W, northDoors); // corridor north wall
  s.vwall(W - 0.25, 0, H);
  // The only exit: west end of the corridor, 1.0 m, swinging outward.
  s.vwall(0, 0, H, [{ at: 4.5, widthM: 1.0, swing: 'west' }]);
  // Partitions between rooms.
  for (const x of [5.0, 10.0, 15.0]) {
    s.vwall(x, 0, 4.25);
    s.vwall(x, 5.75, H);
  }

  // Glazing on the east end of the corridor.
  s.window(W - 0.25, 4.5, W, 5.5);

  // Each room: a sofa against the outer wall and a low table.
  for (const x of roomStartsX) {
    const sofaW = 3.0;
    s.furniture(x, 0.25, x + sofaW, 0.75); // south room sofa
    s.furniture(x + 1.0, 1.25, x + 3.0, 2.25); // south room table
    s.furniture(x, 10.25, x + sofaW, 10.75); // north room sofa
    s.furniture(x + 1.0, 8.0, x + 3.0, 9.0); // north room table
  }

  return writeDxf({
    comments: [
      'INVENTED SAMPLE DRAWING. This is not a real building. Made for the Egress app (MIT licence).',
      'Sample: karaoke bar, one floor, eight small rooms off one corridor, one exit. Units: metres. Layers: ' +
        [LAYER.wall, LAYER.door, LAYER.glaz, LAYER.stair, LAYER.furn].join(', ') +
        '.',
    ],
    blocks: doorBlocksFor(s.doorWidths),
    entities: s.entities,
  });
}
