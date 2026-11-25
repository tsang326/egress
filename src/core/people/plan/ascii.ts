// floorFromAscii: builds a FloorInput from text rows, for tests and fixtures (Design, Module layout).
import type { CellTypeName, FloorInput } from '../types';

// Fixed characters: '#' wall, '.' free, 'D' door, 'E' exit, 'S' stair. Any other character is a free cell that belongs
// to the compartment `legend[char]`. A legend entry for one of the fixed characters (except '#') gives the cells of
// that character a compartment, for example `{ D: 'hall' }`. Wall cells never carry a compartment.
const FIXED: Readonly<Record<string, CellTypeName>> = { '#': 'wall', '.': 'free', D: 'door', E: 'exit', S: 'stair' };

export interface AsciiOptions {
  id?: string; // default 'F0'
  elevationM?: number; // default 0
}

// Throws on a ragged row or an unknown character without a legend entry: this is a helper for code, so a bad call is a
// programmer error (Tech conventions), not input to be validated.
export function floorFromAscii(rows: readonly string[], legend: Readonly<Record<string, string>> = {}, opts: AsciiOptions = {}): FloorInput {
  const heightCells = rows.length;
  const widthCells = rows[0]?.length ?? 0;
  if (heightCells === 0 || widthCells === 0) throw new Error('floorFromAscii: no rows');
  const cells: CellTypeName[] = [];
  const compartmentIds: (string | null)[] = [];
  rows.forEach((row, y) => {
    if (row.length !== widthCells) throw new Error(`floorFromAscii: row ${y} has ${row.length} characters, expected ${widthCells}`);
    for (const ch of row) {
      const fixed = FIXED[ch];
      if (fixed === undefined && !Object.hasOwn(legend, ch)) throw new Error(`floorFromAscii: unknown character "${ch}" in row ${y}`);
      cells.push(fixed ?? 'free');
      compartmentIds.push(ch === '#' ? null : (legend[ch] ?? null));
    }
  });
  return { id: opts.id ?? 'F0', elevationM: opts.elevationM ?? 0, widthCells, heightCells, cells, compartmentIds };
}
