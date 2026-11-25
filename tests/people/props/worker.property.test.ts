// Feature: crowd, Property 13: Worker protocol and input robustness
// Validates: Requirements 7.4, 7.5, 7.6
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PROGRESS_INTERVAL_S } from '../../../src/core/people/constants';
import { runCrowd } from '../../../src/core/people/index';
import { handleMessage } from '../../../src/core/people/worker/handler';
import type { FromWorker } from '../../../src/core/people/worker/protocol';
import { arbRunCase } from '../runArbs';
const post = (msgs: FromWorker[]) => (m: FromWorker) => void msgs.push(m);
describe('Property 13: worker protocol and input robustness', () => {
  it('posts progress at most 5 s apart, first at or before 5 s, last at the end, then exactly one result as the last message', () => {
    fc.assert(
      fc.property(arbRunCase, fc.integer({ min: 0, max: 1000 }), (c, id) => {
        const msgs: FromWorker[] = [];
        handleMessage({ type: 'run', id, request: { input: c.input, fire: c.fire } }, post(msgs));
        const results = msgs.filter((m) => m.type === 'result');
        expect(results).toHaveLength(1);
        expect(msgs[msgs.length - 1]).toBe(results[0]);
        expect(msgs.every((m) => m.id === id)).toBe(true);
        const progress = msgs.filter((m) => m.type === 'progress').map((m) => (m as Extract<FromWorker, { type: 'progress' }>).event);
        const result = (results[0] as Extract<FromWorker, { type: 'result' }>).result;
        if (result.status === 'invalid') {
          expect(progress).toHaveLength(0);
          return;
        }
        expect(progress.length).toBeGreaterThanOrEqual(1);
        expect(progress[0]!.simTimeS).toBeLessThanOrEqual(Math.min(PROGRESS_INTERVAL_S, c.durationS) + 1e-9);
        expect(progress[progress.length - 1]!.simTimeS).toBeCloseTo(c.durationS, 6);
        expect(progress[progress.length - 1]!.fraction).toBe(1);
        let prev = 0;
        for (const e of progress) {
          expect(e.simTimeS - prev).toBeLessThanOrEqual(PROGRESS_INTERVAL_S + 1e-9);
          expect(e.simTimeS).toBeGreaterThanOrEqual(prev);
          expect(e.fraction).toBeGreaterThanOrEqual(0);
          expect(e.fraction).toBeLessThanOrEqual(1);
          prev = e.simTimeS;
        }
      }),
      { numRuns: 100 },
    );
  });
  it('a malformed request or a bad duration gives one invalid result naming the field, no progress, and never throws', () => {
    const badDuration = fc.constantFrom<unknown>(0, -1, -0.5, NaN, Infinity, -Infinity, '10', null, undefined, {}, [], true);
    fc.assert(
      fc.property(arbRunCase, badDuration, (c, d) => {
        const msgs: FromWorker[] = [];
        expect(() => handleMessage({ type: 'run', id: 5, request: { input: { ...c.input, durationS: d }, fire: c.fire } }, post(msgs))).not.toThrow();
        expect(msgs).toHaveLength(1);
        const m = msgs[0] as Extract<FromWorker, { type: 'result' }>;
        expect(m.type).toBe('result');
        expect(m.result.status).toBe('invalid');
        expect(m.result.warnings.some((w) => w.code === 'WORKER_REQUEST_INVALID' && w.location.field === 'request.input.durationS' && w.message.includes('durationS'))).toBe(true);
        // runCrowd on the same input also returns invalid and names the field.
        const direct = runCrowd({ ...c.input, durationS: d as number }, c.fire);
        expect(direct.status).toBe('invalid');
        expect(direct.warnings.some((w) => w.code === 'INPUT_INVALID' && w.location.field === 'durationS')).toBe(true);
      }),
      { numRuns: 100 },
    );
    const junk = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.integer(),
      fc.string(),
      fc.array(fc.anything()),
      fc.record({ type: fc.string(), id: fc.anything(), request: fc.anything() }),
      fc.record({ type: fc.constant('run'), id: fc.anything(), request: fc.anything() }),
      fc.record({ type: fc.constant('run'), id: fc.integer(), request: fc.record({ input: fc.anything(), fire: fc.anything() }) }),
    );
    fc.assert(
      fc.property(junk, (msg) => {
        const msgs: FromWorker[] = [];
        expect(() => handleMessage(msg, post(msgs))).not.toThrow();
        expect(msgs).toHaveLength(1);
        const m = msgs[0] as Extract<FromWorker, { type: 'result' }>;
        expect(m.type).toBe('result');
        expect(m.result.status).toBe('invalid');
        const w = m.result.warnings[0]!;
        expect(w.code).toBe('WORKER_REQUEST_INVALID');
        expect(typeof w.location.field).toBe('string');
        expect(w.message).toContain(w.location.field!);
      }),
      { numRuns: 100 },
    );
  });
  it('runCrowd returns invalid and names the field for a missing or wrong-typed field, without throwing', () => {
    // An empty list is a valid `agents`, so the wrong values exclude it.
    const fields = ['schemaVersion', 'seed', 'plan', 'agents'] as const;
    fc.assert(
      fc.property(arbRunCase, fc.constantFrom(...fields), fc.constantFrom<unknown>(undefined, null, 'x', {}), (c, field, value) => {
        const input = { ...c.input, [field]: value } as unknown as typeof c.input;
        let r: ReturnType<typeof runCrowd> | undefined;
        expect(() => (r = runCrowd(input, c.fire))).not.toThrow();
        expect(r!.status).toBe('invalid');
        expect(r!.warnings.some((w) => w.code === 'INPUT_INVALID' && w.location.field === field)).toBe(true);
        // The same request through the handler gives an invalid result and no progress.
        const msgs: FromWorker[] = [];
        handleMessage({ type: 'run', id: 1, request: { input, fire: c.fire } }, post(msgs));
        expect(msgs.filter((m) => m.type === 'progress')).toHaveLength(0);
        expect(msgs).toHaveLength(1);
        expect((msgs[0] as Extract<FromWorker, { type: 'result' }>).result.status).toBe('invalid');
      }),
      { numRuns: 100 },
    );
  });
});
