// Feature: crowd, Property 1: Agent count conservation
// Validates: Requirements 9.1, 6.2, 2.11
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runCrowd } from '../../../src/core/people/index';
import { STATE_INCAPACITATED, STATE_OUT } from '../../../src/core/people/agents/state';
import '../arbitraries';
import { arbRunCase } from '../runArbs';
describe('Property 1: agent count conservation', () => {
  it('out + incapacitated + inside equals the number of agents at every step and in the summary', () => {
    fc.assert(
      fc.property(arbRunCase, (c) => {
        const included = c.agents.filter((a) => a.type === 'visitor' || a.type === 'staff').length;
        let bad: string | null = null;
        const r = runCrowd(c.input, c.fire, {
          onStep: (v) => {
            const a = v.store;
            let out = 0;
            let incap = 0;
            for (let i = 0; i < a.n; i++) {
              if (a.state[i] === STATE_OUT) out++;
              else if (a.state[i] === STATE_INCAPACITATED) incap++;
            }
            const inside = a.n - out - incap;
            if (a.n !== included || inside < 0 || out + incap + inside !== a.n) bad ??= `step ${v.step}: ${out} + ${incap} + ${inside} != ${included}`;
          },
        });
        expect(bad).toBeNull();
        if (r.status === 'invalid') {
          // The only invalid case here is a plan with no exit cell; nobody is out.
          expect(r.agents).toHaveLength(0);
          return;
        }
        const s = r.summary!;
        expect(s.out + s.incapacitated + s.stillInside).toBe(s.total);
        expect(s.total).toBe(included);
        expect(r.agents.filter((a) => a.finalState === 'out')).toHaveLength(s.out);
      }),
    );
  });
});
