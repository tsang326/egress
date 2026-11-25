// The documentation note (task 21.2; Requirements 6.8, 6.9, 9.10): README.md and src/core/people/README.md carry the
// notice and the phrase "reference simulation", and neither uses a banned word.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOTICE } from '../../src/core/people/outputs/text';

const BANNED = /\b(safe|safely|compliant|certified|passes|meets code)\b/i;
const FILES = ['README.md', 'src/core/people/README.md'];

describe.each(FILES)('%s', (file) => {
  const body = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  it('contains the notice text and the phrase "reference simulation"', () => {
    expect(body).toContain(NOTICE);
    expect(body.toLowerCase()).toContain('reference simulation');
  });
  it('uses no banned word', () => {
    expect(body.split('\n').filter((l) => BANNED.test(l))).toEqual([]);
  });
  it('names evacuation time and the benchmark script', () => {
    expect(body).toContain('evacuation time');
    expect(body).toContain('test:bench:crowd');
  });
});
