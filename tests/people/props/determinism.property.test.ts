// Feature: crowd, Property 3: Determinism
// Validates: Requirements 9.3, 7.1, 2.1, 3.8, 1.9
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runCrowd } from '../../../src/core/people/index';
import { buildPlan } from '../../../src/core/people/plan/builder';
import type { CrowdResult } from '../../../src/core/people/types';
import { arbPlanParams, planInputFromParams } from '../arbitraries';
import { arbRunCase } from '../runArbs';
// First difference between two values as a path, or null. Numbers are compared with Object.is, typed arrays element by
// element, objects by their own keys in order (so a different order of keys or of warnings is a difference).
function firstDifference(a: unknown, b: unknown, path: string): string | null {
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b) ? null : `${path}: ${String(a)} vs ${String(b)}`;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (a === null || b === null || !ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor) return `${path}: array kinds differ`;
    const x = a as unknown as ArrayLike<number>;
    const y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return `${path}: length ${x.length} vs ${y.length}`;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return `${path}[${i}]: ${x[i]} vs ${y[i]}`;
    return null;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return Object.is(a, b) ? null : `${path}: ${String(a)} vs ${String(b)}`;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return `${path}: keys differ`;
  for (const k of ka) {
    const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d !== null) return d;
  }
  return null;
}
interface Recorded {
  result: CrowdResult;
  positions: number[]; // x, y, floor, state of every agent at every step, in order
}
function record(c: { input: Parameters<typeof runCrowd>[0]; fire: Parameters<typeof runCrowd>[1] }): Recorded {
  const positions: number[] = [];
  const result = runCrowd(c.input, c.fire, {
    recordStats: true,
    onStep: (v) => {
      const a = v.store;
      for (let i = 0; i < a.n; i++) positions.push(a.x[i]!, a.y[i]!, a.floor[i]!, a.state[i]!);
    },
  });
  return { result, positions };
}
describe('Property 3: determinism', () => {
  it('runs A, B and A again return bit-identical results, positions at every step, delays and warnings in order', () => {
    fc.assert(
      fc.property(arbRunCase, (c) => {
        const a1 = record(c);
        const b = record(c);
        const a2 = record(c);
        for (const other of [b, a2]) {
          expect(firstDifference(a1.result, other.result, 'result')).toBeNull();
          expect(firstDifference(a1.positions, other.positions, 'positions')).toBeNull();
        }
        expect(a1.result.agents.map((x) => x.preMovementDelayS)).toEqual(b.result.agents.map((x) => x.preMovementDelayS));
        expect(a1.result.warnings.map((w) => w.code)).toEqual(a2.result.warnings.map((w) => w.code));
      }),
      { numRuns: 100 },
    );
  });
  it('a different seed can change the delays (the seed is used)', () => {
    let changed = false;
    fc.assert(
      fc.property(arbRunCase, (c) => {
        if (c.input.delay !== undefined) return; // a fixed-delay case has no randomness
        const other = { ...c, input: { ...c.input, seed: (c.input.seed + 1) % 0x7fffffff } };
        const x = runCrowd(c.input, c.fire);
        const y = runCrowd(other.input, other.fire);
        if (x.agents.length > 0 && x.agents.some((a, i) => !Object.is(a.preMovementDelayS, y.agents[i]!.preMovementDelayS))) changed = true;
      }),
      { numRuns: 100 },
    );
    expect(changed).toBe(true);
  });
  it('building the same Plan twice gives bit-identical Plans and Flow_Fields', () => {
    fc.assert(
      fc.property(arbPlanParams, (p) => {
        const r1 = buildPlan(planInputFromParams(p));
        const r2 = buildPlan(planInputFromParams(p));
        expect(firstDifference(r1, r2, 'plan')).toBeNull();
        expect(r1.plan?.baseFields.length).toBe(r2.plan?.baseFields.length);
      }),
      { numRuns: 100 },
    );
  });
});
