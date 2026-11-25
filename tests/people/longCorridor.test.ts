// LONG_CORRIDOR warning (Requirement 6.7): issued once, for a compartment of kind "corridor" whose longest side is above
// CORRIDOR_LENGTH_LIMIT_M, when an agent moves in it. Invented buildings.
import { describe, expect, it } from 'vitest';
import { CELL_SIZE_M, CORRIDOR_LENGTH_LIMIT_M } from '../../src/core/people/constants';
import { floorFromAscii } from '../../src/core/people/plan/ascii';
import { buildPlan } from '../../src/core/people/plan/builder';
import { runCrowd } from '../../src/core/people/index';
import type { CompartmentKind } from '../../src/core/people/types';
import { agentAtCell, crowdInput, noFire, SHORT_DELAY } from './runHelpers';
// A straight corridor of `cells` cells and 2 rows, with an exit at its right end.
function corridorWarnings(cells: number, kind: CompartmentKind): string[] {
  const rows = ['#'.repeat(cells + 2), `#${'h'.repeat(cells)}E`, `#${'h'.repeat(cells)}E`, '#'.repeat(cells + 2)];
  const r = buildPlan({ floors: [floorFromAscii(rows, { h: 'hall' })], stairLinks: [], compartments: [{ id: 'hall', kind }] });
  if (r.status !== 'valid' || !r.plan) throw new Error('corridor plan invalid');
  const out = runCrowd(crowdInput(r.plan, [agentAtCell('a', 'visitor', 'F0', 1, 1), agentAtCell('b', 'visitor', 'F0', 3, 2)], 120, { delay: SHORT_DELAY }), noFire(r.plan, 120));
  expect(out.status).toBe('ok');
  return out.warnings.filter((w) => w.code === 'LONG_CORRIDOR').map((w) => w.message);
}
const cellsFor = (lengthM: number): number => Math.round(lengthM / CELL_SIZE_M);
describe('LONG_CORRIDOR warning (Requirement 6.7)', () => {
  it('a corridor above the limit gives one warning, naming the corridor, even with two agents in it', () => {
    const w = corridorWarnings(cellsFor(CORRIDOR_LENGTH_LIMIT_M) + 8, 'corridor');
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('hall');
    expect(w[0]).toContain('estimate');
  });
  it('a corridor at the limit gives none', () => {
    expect(corridorWarnings(cellsFor(CORRIDOR_LENGTH_LIMIT_M), 'corridor')).toEqual([]);
  });
  it('a long room (kind "room") gives none', () => {
    expect(corridorWarnings(cellsFor(CORRIDOR_LENGTH_LIMIT_M) + 8, 'room')).toEqual([]);
  });
});
