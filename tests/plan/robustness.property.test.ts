import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importBuildingModel } from '../../src/core/plan/import';
import type { ImportResult, ImportSettings, ImportSource } from '../../src/core/plan/types';
import { buildGridPlan, gridPlanSpecArb } from './helpers/planArbitraries';

// Feature: plan-import, Property 6: Malformed or truncated DXF never throws and never hangs
// **Validates: Requirements 3.1, 3.6, 3.8, 20.6, 22.3**

const TIME_LIMIT_MS = 5000;

// Calls the importer; fails the property when it throws, takes over 5 s, or returns anything but ok or invalid.
function checkImport(text: string, settings: ImportSettings = {}): void {
  const started = performance.now();
  let result: ImportResult;
  try {
    result = importBuildingModel([{ fileName: 'plan.dxf', text }], settings);
  } catch (e) {
    throw new Error(`importBuildingModel threw: ${String(e)}`);
  }
  const elapsed = performance.now() - started;
  expect(elapsed).toBeLessThan(TIME_LIMIT_MS);
  expect(['ok', 'invalid']).toContain(result.status);
  expect(Array.isArray(result.warnings)).toBe(true);
  if (result.status === 'invalid') expect(result.model).toBeNull();
}

// A valid DXF text (and its settings) from the shared plan generator, first floor only.
const validDxf = gridPlanSpecArb({ maxFloors: 1, maxRoomsPerAxis: 2 }).map((spec) => {
  const plan = buildGridPlan(spec);
  const file: ImportSource = plan.files[0]!;
  const settings: ImportSettings = { layerMaps: { [file.fileName]: plan.layerMap } };
  return { text: file.text, settings };
});

const noiseChar = fc.oneof(
  fc.integer({ min: 0, max: 255 }).map((n) => String.fromCharCode(n)),
  fc.constantFrom('\n', '\r', '\0', '\uFFFD', '0', '9', '-', '.', 'e', 'E', 'NaN', 'Infinity', '1e999', '-1e999'),
);

const mutation = fc.oneof(
  // random cut
  fc.record({ kind: fc.constant('cut' as const), at: fc.double({ min: 0, max: 1, noNaN: true }) }),
  // change one line
  fc.record({
    kind: fc.constant('line' as const),
    at: fc.double({ min: 0, max: 1, noNaN: true }),
    value: fc.oneof(fc.string({ maxLength: 12 }), fc.constantFrom('', '1e999', '-1e999', 'NaN', '0', '-1', '99999999999', 'ENDSEC', 'EOF', 'SECTION', 'LINE', 'INSERT', 'BLOCK')),
  }),
  // insert random bytes
  fc.record({
    kind: fc.constant('bytes' as const),
    at: fc.double({ min: 0, max: 1, noNaN: true }),
    bytes: fc.array(noiseChar, { minLength: 1, maxLength: 20 }).map((a) => a.join('')),
  }),
);

type Mutation = typeof mutation extends fc.Arbitrary<infer T> ? T : never;

function applyMutation(text: string, m: Mutation): string {
  const pos = Math.floor(m.at * text.length);
  if (m.kind === 'cut') return text.slice(0, pos);
  if (m.kind === 'bytes') return text.slice(0, pos) + m.bytes + text.slice(pos);
  const lines = text.split('\n');
  lines[Math.min(lines.length - 1, Math.floor(m.at * lines.length))] = m.value;
  return lines.join('\n');
}

describe('Property 6: malformed or truncated DXF never throws and never hangs', () => {
  it('survives random cuts, changed lines and random bytes on valid DXF text', () => {
    fc.assert(
      fc.property(validDxf, fc.array(mutation, { minLength: 1, maxLength: 4 }), ({ text, settings }, muts) => {
        checkImport(muts.reduce(applyMutation, text), settings);
      }),
      { numRuns: 200 },
    );
  });

  it('survives every truncation point of a small valid file', () => {
    const { text, settings } = fc.sample(validDxf, { numRuns: 1, seed: 6 })[0]!;
    const step = Math.max(1, Math.floor(text.length / 60));
    for (let n = 0; n <= text.length; n += step) checkImport(text.slice(0, n), settings);
  });

  it('survives arbitrary strings', () => {
    fc.assert(fc.property(fc.string({ maxLength: 400 }), (text) => checkImport(text)), { numRuns: 200 });
    fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 400 }), (text) => checkImport(text)), { numRuns: 100 });
  });

  it('survives strings made of DXF-like group-code lines', () => {
    const code = fc.constantFrom('0', '2', '8', '10', '11', '20', '21', '40', '42', '50', '70', '90', '100', '999', 'x', '-5');
    const value = fc.oneof(
      fc.constantFrom('SECTION', 'ENDSEC', 'EOF', 'ENTITIES', 'BLOCKS', 'HEADER', 'LINE', 'LWPOLYLINE', 'POLYLINE', 'VERTEX', 'SEQEND', 'INSERT', 'BLOCK', 'ENDBLK', 'ARC', 'CIRCLE', 'A-WALL', '1e999', 'NaN', '-1e300'),
      fc.double({ noNaN: false }).map(String),
      fc.string({ maxLength: 6 }),
    );
    fc.assert(
      fc.property(fc.array(fc.tuple(code, value), { maxLength: 80 }), (pairs) => {
        checkImport(pairs.map(([c, v]) => `${c}\n${v}`).join('\n'));
      }),
      { numRuns: 300 },
    );
  });
});
