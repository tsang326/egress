// Feature: crowd, Property 2: No agent in or through a wall
// Validates: Requirements 9.2, 2.4
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE_M } from '../../../src/core/people/constants';
import { STATE_IN_STAIR } from '../../../src/core/people/agents/state';
import { runCrowd } from '../../../src/core/people/index';
import type { Plan } from '../../../src/core/people/types';
import { CELL_WALL } from '../../../src/core/people/types';
import '../arbitraries';
import { arbRunCaseWithExit } from '../runArbs';
const wallAt = (plan: Plan, floor: number, x: number, y: number): boolean => {
  const f = plan.floors[floor]!;
  const cx = Math.floor(x / CELL_SIZE_M);
  const cy = Math.floor(y / CELL_SIZE_M);
  if (cx < 0 || cy < 0 || cx >= f.widthCells || cy >= f.heightCells) return true; // outside the grid counts as blocked
  return f.cellType[cy * f.widthCells + cx] === CELL_WALL;
};
// Independent of the model: samples the segment every 5 mm (the longest step is far below one cell).
function segmentCrossesWall(plan: Plan, floor: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(len / 0.005));
  for (let k = 0; k <= n; k++) if (wallAt(plan, floor, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n)) return true;
  return false;
}
describe('Property 2: no agent in or through a wall', () => {
  it('every agent centre is outside wall cells at every step and no step crosses a wall', () => {
    fc.assert(
      fc.property(arbRunCaseWithExit, (c) => {
        let prevX: Float64Array | null = null;
        let prevY: Float64Array | null = null;
        let prevFloor: Uint8Array | null = null;
        let bad: string | null = null;
        const included = c.agents.filter((a) => a.type === 'visitor' || a.type === 'staff');
        runCrowd(c.input, c.fire, {
          onStep: (v) => {
            const a = v.store;
            if (prevX === null) {
              prevX = Float64Array.from(included, (g) => g.xM);
              prevY = Float64Array.from(included, (g) => g.yM);
              prevFloor = Uint8Array.from(a.floor);
            }
            for (let i = 0; i < a.n; i++) {
              if (a.state[i] === STATE_IN_STAIR) continue;
              const f = a.floor[i]!;
              if (wallAt(c.plan, f, a.x[i]!, a.y[i]!)) bad ??= `step ${v.step}: agent ${i} centre in a wall at (${a.x[i]}, ${a.y[i]}) on floor ${f}`;
              else if (prevFloor![i] === f && segmentCrossesWall(c.plan, f, prevX![i]!, prevY![i]!, a.x[i]!, a.y[i]!)) {
                bad ??= `step ${v.step}: agent ${i} crossed a wall from (${prevX![i]}, ${prevY![i]}) to (${a.x[i]}, ${a.y[i]})`;
              }
            }
            prevX = Float64Array.from(a.x);
            prevY = Float64Array.from(a.y);
            prevFloor = Uint8Array.from(a.floor);
          },
        });
        expect(bad).toBeNull();
      }),
    );
  });
});
