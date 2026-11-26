import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importBuildingModel } from '../../src/core/plan/import';
import type { ImportSettings, ImportSource } from '../../src/core/plan/types';
import { buildGridPlan, gridPlanSpecArb } from './helpers/planArbitraries';

// Feature: plan-import, Property 13: No throw on any object-shaped input
// **Validates: Requirements 20.6, 22.3**

const SETTING_KEYS = [
  'layerMaps', 'drawingUnits', 'floorSources', 'floorSettings', 'floorOffsetsM',
  'edits', 'exitDoorIds', 'stairRegions', 'stairLinkOverrides', 'roofVents',
] as const;

const junk = fc.anything({ withNullPrototype: true, withBigInt: true, withBoxedValues: true, withNaN: true } as fc.OneOfConstraints & Record<string, unknown>);

// Settings: any subset of the known keys holding arbitrary values, plus unknown keys.
const settingsArb = fc
  .tuple(
    fc.dictionary(fc.constantFrom(...SETTING_KEYS), junk),
    fc.dictionary(fc.string({ maxLength: 8 }), junk, { maxKeys: 3 }),
  )
  .map(([known, extra]) => ({ ...extra, ...known }) as unknown as ImportSettings);

const validPlan = gridPlanSpecArb({ maxFloors: 2, maxRoomsPerAxis: 2 }).map((spec) => buildGridPlan(spec));

const textArb = fc.oneof(fc.string({ maxLength: 300 }), fc.constantFrom('', '0\nEOF', '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF'));

// Sources: every element has a string text (the one thing the importer may reject), other fields are arbitrary.
const sourceArb = fc
  .tuple(textArb, junk)
  .map(([text, fileName]) => ({ fileName, text }) as unknown as ImportSource);

function check(sources: ImportSource[], settings: unknown): void {
  let status: string | undefined;
  try {
    const r = importBuildingModel(sources, settings as ImportSettings);
    status = r.status;
    expect(Array.isArray(r.warnings)).toBe(true);
  } catch (e) {
    throw new Error(`importBuildingModel threw: ${String(e)}`);
  }
  expect(['ok', 'invalid']).toContain(status);
}

describe('Property 13: no throw on any object-shaped input', () => {
  it('returns a result for arbitrary settings with arbitrary-text sources', () => {
    fc.assert(
      fc.property(fc.array(sourceArb, { maxLength: 3 }), settingsArb, (sources, settings) => check(sources, settings)),
      { numRuns: 200 },
    );
  });

  it('returns a result for a valid plan combined with arbitrary settings', () => {
    fc.assert(
      fc.property(validPlan, settingsArb, (plan, settings) => check(plan.files, settings)),
      { numRuns: 150 },
    );
  });

  it('returns a result for a valid plan with its layer map and arbitrary other settings', () => {
    fc.assert(
      fc.property(validPlan, settingsArb, (plan, settings) => {
        const layerMaps = Object.fromEntries(plan.files.map((f) => [f.fileName, plan.layerMap]));
        check(plan.files, { ...settings, layerMaps: { ...layerMaps } });
      }),
      { numRuns: 150 },
    );
  });

  it('returns a result for a missing, null or non-object settings argument', () => {
    for (const s of [undefined, null, 0, 'x', true, [], [1, 2]]) check([], s);
  });

  it('throws TypeError only for a non-array sources or a non-string text', () => {
    expect(() => importBuildingModel({} as unknown as ImportSource[])).toThrow(TypeError);
    expect(() => importBuildingModel([{ fileName: 'a.dxf', text: 5 } as unknown as ImportSource])).toThrow(TypeError);
  });
});
