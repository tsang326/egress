import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LAYER_ROLE_TABLE } from '../../src/core/plan/constants';
import { normalizeLayerName, suggestLayerRole } from '../../src/core/plan/layers';

// Feature: plan-import, Property 8: Layer name normalization is confluent

const SEPARATOR_CHARS = ['-', '_', ' '];

// Arbitrary text, biased towards separators, accents and case so collisions are likely.
const layerName = fc.oneof(
  fc.string({ maxLength: 24 }),
  fc.stringMatching(/^[A-Za-z\-_ Đđàáảãạâấầẩẫậăắằẳẵặêếềểễệôốồổỗộơớờởỡợưứừửữựỳýỷỹỵ]{0,20}$/),
);

// A spelling variant of a canonical key: random case per letter, random separators inserted, optional accent
// on a vowel via a combining mark (NFD form), and optional NFC recomposition.
const variantOf = (key: string): fc.Arbitrary<string> =>
  fc
    .tuple(
      fc.array(fc.boolean(), { minLength: key.length, maxLength: key.length }),
      fc.array(fc.option(fc.constantFrom(...SEPARATOR_CHARS), { nil: undefined }), {
        minLength: key.length + 1,
        maxLength: key.length + 1,
      }),
      fc.boolean(),
    )
    .map(([lower, seps, compose]) => {
      let s = seps[0] ?? '';
      for (let i = 0; i < key.length; i++) {
        const ch = key[i]!;
        s += lower[i] ? ch.toLowerCase() : ch;
        s += seps[i + 1] ?? '';
      }
      return compose ? s.normalize('NFC') : s.normalize('NFD');
    });

describe('Property 8: layer name normalization is confluent', () => {
  it('normalizing twice equals normalizing once', () => {
    // **Validates: Requirements 5.2, 5.3**
    fc.assert(
      fc.property(layerName, (name) => {
        const once = normalizeLayerName(name);
        expect(normalizeLayerName(once)).toBe(once);
      }),
      { numRuns: 300 },
    );
  });

  it('names with the same normalized key get the same suggested role', () => {
    // **Validates: Requirements 5.2, 5.3**
    fc.assert(
      fc.property(layerName, layerName, (a, b) => {
        fc.pre(normalizeLayerName(a) === normalizeLayerName(b));
        expect(suggestLayerRole(a)).toBe(suggestLayerRole(b));
      }),
      { numRuns: 300 },
    );
  });

  it('case, separator and diacritic variants of a table key collapse to that key and its role', () => {
    // **Validates: Requirements 5.2, 5.3**
    const keys = Object.keys(LAYER_ROLE_TABLE);
    fc.assert(
      fc.property(
        fc.constantFrom(...keys).chain((key) => fc.tuple(fc.constant(key), variantOf(key))),
        ([key, variant]) => {
          expect(normalizeLayerName(variant)).toBe(key);
          expect(suggestLayerRole(variant)).toBe(LAYER_ROLE_TABLE[key]);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('a name whose key is not in the table suggests ignore', () => {
    // **Validates: Requirements 5.3**
    fc.assert(
      fc.property(layerName, (name) => {
        fc.pre(!Object.hasOwn(LAYER_ROLE_TABLE, normalizeLayerName(name)));
        expect(suggestLayerRole(name)).toBe('ignore');
      }),
      { numRuns: 300 },
    );
  });
});

describe('named table entries (Requirement 5.2)', () => {
  it.each([
    ['A-WALL', 'wall'], ['TUONG', 'wall'], ['Tường', 'wall'],
    ['A-DOOR', 'door'], ['CUA', 'door'], ['Cửa', 'door'],
    ['A-GLAZ', 'window'], ['CUA SO', 'window'], ['Cửa sổ', 'window'],
    ['A-FLOR-STRS', 'stair'], ['CAU THANG', 'stair'], ['Cầu thang', 'stair'],
    ['A-FURN', 'furniture'],
  ] as const)('%s suggests %s, also without separators', (name, role) => {
    expect(suggestLayerRole(name)).toBe(role);
    expect(suggestLayerRole(name.replace(/[-_ ]/g, ''))).toBe(role);
  });

  it('an unmatched name suggests ignore (Requirement 5.3)', () => {
    expect(suggestLayerRole('Defpoints')).toBe('ignore');
  });
});
