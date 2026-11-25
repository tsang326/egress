// Unit tests of the Worker_Wrapper (task 18.3; Requirements 7.4, 7.5, 7.6).
import { describe, expect, it } from 'vitest';
import { handleMessage } from '../../src/core/people/worker/handler';
import type { FromWorker } from '../../src/core/people/worker/protocol';
import { agentAtCell, crowdInput, noFire, SHORT_DELAY } from './runHelpers';
import { openRoom } from './samplePlans';
const plan = openRoom().plan;
const agents = [agentAtCell('a', 'staff', 'F0', 3, 3)];
// The fire result always has a finite length, whatever the (possibly invalid) run duration is.
const request = (durationS: number) => ({
  input: crowdInput(plan, agents, durationS, { delay: SHORT_DELAY }),
  fire: noFire(plan, Number.isFinite(durationS) && durationS > 1 ? durationS : 1),
});
function run(msg: unknown): FromWorker[] {
  const msgs: FromWorker[] = [];
  handleMessage(msg, (m) => msgs.push(m));
  return msgs;
}
const progressTimes = (msgs: FromWorker[]): number[] => msgs.flatMap((m) => (m.type === 'progress' ? [m.event.simTimeS] : []));
describe('Worker_Wrapper', () => {
  it('posts progress at most 5 s apart, the first at or before 5 s, the last at the end', () => {
    const t = progressTimes(run({ type: 'run', id: 1, request: request(23) }));
    expect(t[0]).toBeLessThanOrEqual(5);
    expect(t[t.length - 1]).toBe(23);
    for (let i = 0; i < t.length; i++) expect(t[i]! - (i === 0 ? 0 : t[i - 1]!)).toBeLessThanOrEqual(5);
  });
  it('a run shorter than 5 s posts only the final progress', () => {
    const t = progressTimes(run({ type: 'run', id: 1, request: request(3) }));
    expect(t).toEqual([3]);
  });
  it('posts exactly one result and it is the last message, with the id of the request', () => {
    const msgs = run({ type: 'run', id: 42, request: request(12) });
    expect(msgs.filter((m) => m.type === 'result')).toHaveLength(1);
    expect(msgs[msgs.length - 1]!.type).toBe('result');
    expect(msgs.every((m) => m.id === 42)).toBe(true);
    const last = msgs[msgs.length - 1] as Extract<FromWorker, { type: 'result' }>;
    expect(last.result.status).toBe('ok');
  });
  const field = (msgs: FromWorker[]): string | undefined => (msgs[0] as Extract<FromWorker, { type: 'result' }>).result.warnings[0]?.location.field;
  const expectInvalid = (msgs: FromWorker[], name: string): void => {
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.type).toBe('result');
    const r = (msgs[0] as Extract<FromWorker, { type: 'result' }>).result;
    expect(r.status).toBe('invalid');
    expect(r.warnings[0]!.code).toBe('WORKER_REQUEST_INVALID');
    expect(field(msgs)).toBe(name);
    expect(r.warnings[0]!.message).toContain(name);
    expect(msgs.some((m) => m.type === 'progress')).toBe(false);
  };
  it('a malformed request gives status "invalid" naming the field and no progress', () => {
    expectInvalid(run('hello'), 'message');
    expectInvalid(run(null), 'message');
    expectInvalid(run({ type: 'stop', id: 1 }), 'type');
    expectInvalid(run({ type: 'run', id: 'x', request: request(5) }), 'id');
    expectInvalid(run({ type: 'run', id: 1, request: 3 }), 'request');
  });
  it('a missing field gives status "invalid" naming the field', () => {
    expectInvalid(run({ type: 'run', id: 1, request: { fire: noFire(plan, 5) } }), 'request.input');
    expectInvalid(run({ type: 'run', id: 1, request: { input: request(5).input } }), 'request.fire');
    expectInvalid(run({ type: 'run', id: 1, request: { input: { ...request(5).input, durationS: undefined }, fire: noFire(plan, 5) } }), 'request.input.durationS');
  });
  it('a non-positive or non-finite duration gives status "invalid" naming durationS', () => {
    for (const d of [0, -3, NaN, Infinity]) {
      expectInvalid(run({ type: 'run', id: 1, request: request(d) }), 'request.input.durationS');
    }
  });
  it('a problem deeper in the input comes back from runCrowd as an invalid result with no progress', () => {
    const bad = { ...request(5), input: { ...request(5).input, seed: 'x' } };
    const msgs = run({ type: 'run', id: 1, request: bad });
    expect(msgs).toHaveLength(1);
    const r = (msgs[0] as Extract<FromWorker, { type: 'result' }>).result;
    expect(r.status).toBe('invalid');
    expect(r.warnings.some((w) => w.code === 'INPUT_INVALID' && w.location.field === 'seed')).toBe(true);
  });
});
