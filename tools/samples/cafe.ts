// Sample 1: a small café, one floor of about 120 m², two exits (Requirement 18.2).
// INVENTED drawing, not a real building (Requirement 18.1, 18.7). MIT licence, like the rest of the project.
import { doorBlocksFor, LAYER, Sheet, writeDxf } from './draw';

/** Interior 12.0 m x 10.0 m = 120 m² before the kitchen and toilet partitions. Outer walls x 0..12.5, y 0..10.5. */
export function buildCafe(): string {
  const s = new Sheet();
  const W = 12.5;
  const H = 10.5;

  // Outer walls. Exit 1: front door in the south wall, 1.5 m. Exit 2: side door in the east wall, 1.0 m.
  s.hwall(0, 0, W, [{ at: 5.0, widthM: 1.5, swing: 'south' }]);
  s.hwall(H - 0.25, 0, W);
  s.vwall(0, 0, H);
  s.vwall(W - 0.25, 0, H, [{ at: 2.0, widthM: 1.0, swing: 'east' }]);

  // Kitchen, north-east: interior x 8.25..12.25, y 6.25..10.25.
  s.hwall(6.0, 8.0, W);
  s.vwall(8.0, 6.0, H, [{ at: 7.0, widthM: 1.0, swing: 'east' }]);

  // Toilet, north-west: interior x 0.25..3.25, y 7.25..10.25.
  s.hwall(7.0, 0, 3.5, [{ at: 1.0, widthM: 1.0, swing: 'north' }]);
  s.vwall(3.25, 7.0, H);

  // Glazing on top of the front and west walls.
  s.window(1.5, 0, 4.0, 0.25);
  s.window(7.5, 0, 10.5, 0.25);
  s.window(0, 2.0, 0.25, 5.0);

  // Dining tables (1 m x 1 m) and the service counter.
  for (const [x, y] of [
    [1.0, 1.0],
    [3.0, 1.0],
    [1.0, 3.0],
    [3.0, 3.0],
    [8.0, 1.0],
    [8.0, 3.0],
    // 1 m aisles between the four tables of this group, so a person fits between them (run-view spec Req 8).
    [4.0, 7.0],
    [6.0, 7.0],
    [4.0, 9.0],
    [6.0, 9.0],
  ] as const) {
    s.furniture(x, y, x + 1.0, y + 1.0);
  }
  s.furniture(8.5, 4.5, 12.0, 5.25); // counter
  s.furniture(9.5, 7.0, 11.5, 8.0); // kitchen prep table
  s.furniture(9.0, 9.0, 11.0, 9.75); // kitchen cooker

  return writeDxf({
    comments: [
      'INVENTED SAMPLE DRAWING. This is not a real building. Made for the Egress app (MIT licence).',
      'Sample: small cafe, one floor, two exits. Units: metres. Layers: ' +
        [LAYER.wall, LAYER.door, LAYER.glaz, LAYER.stair, LAYER.furn].join(', ') +
        '.',
    ],
    blocks: doorBlocksFor(s.doorWidths),
    entities: s.entities,
  });
}
