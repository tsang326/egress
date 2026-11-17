import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

describe('toolchain', () => {
  it('runs a property test', () => {
    fc.assert(fc.property(fc.integer(), (n) => n + 0 === n));
    expect(true).toBe(true);
  });
});
