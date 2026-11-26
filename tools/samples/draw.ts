// Shared drawing helpers for the sample builders (plan-import spec, Requirement 18).
//
// Everything here is pure: no clock, no random values, no file access. Identical calls give identical text
// (Requirement 18.6). All lengths are metres and the file is written with $INSUNITS 6 (metres, Requirement 18.5).
//
// The sample drawings are INVENTED. They are not copies of any real building (Requirement 18.1, 18.7).

/** Wall thickness of every sample wall: one crowd-grid cell (CELL_SIZE_M = 0.25 m in src/core/people/constants.ts).
 * Every wall rectangle starts and ends on a multiple of this value, so the rasterizer covers whole cells. */
export const WALL_T = 0.25;

/** Layer names of Requirement 18.5. */
export const LAYER = {
  wall: 'A-WALL',
  door: 'A-DOOR',
  glaz: 'A-GLAZ',
  stair: 'A-FLOR-STRS',
  furn: 'A-FURN',
} as const;

const LAYER_TABLE: readonly string[] = ['0', LAYER.wall, LAYER.door, LAYER.glaz, LAYER.stair, LAYER.furn];

export type Pt = readonly [number, number];

export type Entity =
  | { t: 'LWPOLYLINE'; layer: string; pts: readonly Pt[] }
  | { t: 'LINE'; layer: string; a: Pt; b: Pt }
  | { t: 'ARC'; layer: string; c: Pt; r: number; a0: number; a1: number }
  | { t: 'INSERT'; layer: string; name: string; at: Pt; scaleY: number; rotDeg: number };

export interface Block {
  name: string;
  entities: readonly Entity[];
}

export type HorizontalSwing = 'north' | 'south';
export type VerticalSwing = 'east' | 'west';

export interface HDoor {
  /** x of the start (hinge side) of the opening, metres. */
  at: number;
  widthM: number;
  swing: HorizontalSwing;
}
export interface VDoor {
  /** y of the start (hinge side) of the opening, metres. */
  at: number;
  widthM: number;
  swing: VerticalSwing;
}

function assertOnGrid(v: number, what: string): void {
  if (Math.abs(v / WALL_T - Math.round(v / WALL_T)) > 1e-9) {
    // Programmer error in a sample builder, not user input.
    throw new RangeError(`${what} ${v} is not a multiple of ${WALL_T} m`);
  }
}

export function doorBlockName(widthM: number): string {
  return `DOOR_W${Math.round(widthM * 100)}`;
}

/** A door block: origin at the hinge, closed leaf along +x, 90 degree swing arc into +y.
 * Its extent along the wall (x) equals the door width (Requirement 18.5; design "Doors", case 1). */
export function doorBlock(widthM: number): Block {
  return {
    name: doorBlockName(widthM),
    entities: [
      { t: 'LINE', layer: LAYER.door, a: [0, 0], b: [widthM, 0] },
      { t: 'ARC', layer: LAYER.door, c: [0, 0], r: widthM, a0: 0, a1: 90 },
    ],
  };
}

/** Collects the entities of one floor (or one single-floor drawing). */
export class Sheet {
  readonly entities: Entity[] = [];
  readonly doorWidths = new Set<number>();

  /** Closed rectangle outline on a layer. */
  rect(layer: string, x0: number, y0: number, x1: number, y1: number): void {
    this.entities.push({
      t: 'LWPOLYLINE',
      layer,
      pts: [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
    });
  }

  /** Horizontal wall whose lower edge is at `y`, from x0 to x1, with door openings cut out and door blocks inserted. */
  hwall(y: number, x0: number, x1: number, doors: readonly HDoor[] = []): void {
    assertOnGrid(y, 'wall y');
    const sorted = [...doors].sort((a, b) => a.at - b.at);
    let cursor = x0;
    for (const d of sorted) {
      assertOnGrid(d.at, 'door x');
      assertOnGrid(d.widthM, 'door width');
      if (d.at > cursor) this.rect(LAYER.wall, cursor, y, d.at, y + WALL_T);
      cursor = d.at + d.widthM;
      this.doorWidths.add(d.widthM);
      this.entities.push({
        t: 'INSERT',
        layer: LAYER.door,
        name: doorBlockName(d.widthM),
        at: [d.at, y + WALL_T / 2],
        scaleY: d.swing === 'north' ? 1 : -1,
        rotDeg: 0,
      });
    }
    if (x1 > cursor) this.rect(LAYER.wall, cursor, y, x1, y + WALL_T);
  }

  /** Vertical wall whose left edge is at `x`, from y0 to y1, with door openings cut out and door blocks inserted.
   * The block is rotated 90 degrees: its +x runs along +y, its +y swing points west; scaleY -1 swings east. */
  vwall(x: number, y0: number, y1: number, doors: readonly VDoor[] = []): void {
    assertOnGrid(x, 'wall x');
    const sorted = [...doors].sort((a, b) => a.at - b.at);
    let cursor = y0;
    for (const d of sorted) {
      assertOnGrid(d.at, 'door y');
      assertOnGrid(d.widthM, 'door width');
      if (d.at > cursor) this.rect(LAYER.wall, x, cursor, x + WALL_T, d.at);
      cursor = d.at + d.widthM;
      this.doorWidths.add(d.widthM);
      this.entities.push({
        t: 'INSERT',
        layer: LAYER.door,
        name: doorBlockName(d.widthM),
        at: [x + WALL_T / 2, d.at],
        scaleY: d.swing === 'west' ? 1 : -1,
        rotDeg: 90,
      });
    }
    if (y1 > cursor) this.rect(LAYER.wall, x, cursor, x + WALL_T, y1);
  }

  /** Window drawn on top of a continuous wall: same footprint, glazing layer. */
  window(x0: number, y0: number, x1: number, y1: number): void {
    this.rect(LAYER.glaz, x0, y0, x1, y1);
  }

  furniture(x0: number, y0: number, x1: number, y1: number): void {
    this.rect(LAYER.furn, x0, y0, x1, y1);
  }

  line(layer: string, a: Pt, b: Pt): void {
    this.entities.push({ t: 'LINE', layer, a, b });
  }
}

// ---- DXF text -----------------------------------------------------------------------------------------------------

/** Plain decimal, at most 4 decimals, trailing zeros trimmed. Same value, same text. */
function num(n: number): string {
  const s = n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' || s === '' ? '0' : s;
}

function writeEntity(out: string[], e: Entity): void {
  const pair = (code: number, value: string): void => {
    out.push(String(code), value);
  };
  pair(0, e.t);
  pair(8, e.layer);
  switch (e.t) {
    case 'LINE':
      pair(10, num(e.a[0]));
      pair(20, num(e.a[1]));
      pair(30, '0');
      pair(11, num(e.b[0]));
      pair(21, num(e.b[1]));
      pair(31, '0');
      break;
    case 'LWPOLYLINE':
      pair(100, 'AcDbPolyline');
      pair(90, String(e.pts.length));
      pair(70, '1');
      for (const p of e.pts) {
        pair(10, num(p[0]));
        pair(20, num(p[1]));
      }
      break;
    case 'ARC':
      pair(10, num(e.c[0]));
      pair(20, num(e.c[1]));
      pair(30, '0');
      pair(40, num(e.r));
      pair(50, num(e.a0));
      pair(51, num(e.a1));
      break;
    case 'INSERT':
      pair(2, e.name);
      pair(10, num(e.at[0]));
      pair(20, num(e.at[1]));
      pair(30, '0');
      pair(41, '1');
      pair(42, num(e.scaleY));
      pair(43, '1');
      pair(50, num(e.rotDeg));
      break;
  }
}

export interface DxfInput {
  /** Group code 999 comment lines, written first. Must state that the drawing is invented (Requirement 18.7). */
  comments: readonly string[];
  blocks: readonly Block[];
  entities: readonly Entity[];
}

/** Writes ASCII DXF text with $ACADVER AC1015, $INSUNITS 6 (metres) and $MEASUREMENT 1 (metric). */
export function writeDxf(input: DxfInput): string {
  const out: string[] = [];
  const pair = (code: number, value: string): void => {
    out.push(String(code), value);
  };
  for (const c of input.comments) pair(999, c);

  pair(0, 'SECTION');
  pair(2, 'HEADER');
  pair(9, '$ACADVER');
  pair(1, 'AC1015');
  pair(9, '$INSUNITS');
  pair(70, '6'); // Requirement 18.5: metres
  pair(9, '$MEASUREMENT');
  pair(70, '1');
  pair(0, 'ENDSEC');

  pair(0, 'SECTION');
  pair(2, 'TABLES');
  pair(0, 'TABLE');
  pair(2, 'LAYER');
  pair(70, String(LAYER_TABLE.length));
  for (const name of LAYER_TABLE) {
    pair(0, 'LAYER');
    pair(2, name);
    pair(70, '0');
    pair(62, '7');
    pair(6, 'CONTINUOUS');
  }
  pair(0, 'ENDTAB');
  pair(0, 'ENDSEC');

  pair(0, 'SECTION');
  pair(2, 'BLOCKS');
  for (const b of input.blocks) {
    pair(0, 'BLOCK');
    pair(8, '0');
    pair(2, b.name);
    pair(70, '0');
    pair(10, '0');
    pair(20, '0');
    pair(30, '0');
    pair(3, b.name);
    for (const e of b.entities) writeEntity(out, e);
    pair(0, 'ENDBLK');
    pair(8, '0');
  }
  pair(0, 'ENDSEC');

  pair(0, 'SECTION');
  pair(2, 'ENTITIES');
  for (const e of input.entities) writeEntity(out, e);
  pair(0, 'ENDSEC');
  pair(0, 'EOF');
  return out.join('\n') + '\n';
}

/** Door blocks for every width used, ascending, so the output order never depends on insertion order. */
export function doorBlocksFor(widths: Iterable<number>): Block[] {
  return [...new Set(widths)].sort((a, b) => a - b).map(doorBlock);
}
