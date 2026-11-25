// Static checks on src/core/people/constants.ts (Requirements 5.7, 5.8): every exported constant has a leading comment
// that names a source or says "estimate" or "numerical parameter".
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as constants from '../../src/core/people/constants';

const SOURCE = readFileSync(new URL('../../src/core/people/constants.ts', import.meta.url), 'utf8');
const LINES = SOURCE.split('\n');

const SOURCE_NAMES = /Requirement|SFPE|Cleary|Jin |ISO|Practice note|Tech Ref|CFAST|FDS|Pathfinder|Purser|FEMTC|definition of the inch/;
const LABELS = /estimate|numerical parameter/i;

function declared(): { name: string; comment: string }[] {
  const out: { name: string; comment: string }[] = [];
  LINES.forEach((line, i) => {
    const m = /^export const ([A-Z0-9_]+)\b/.exec(line);
    if (!m) return;
    const above = (LINES[i - 1] ?? '').trim();
    out.push({ name: m[1]!, comment: above.startsWith('//') ? above : '' });
  });
  return out;
}

describe('constants.ts source comments', () => {
  const list = declared();

  it('finds every constant the module exports as its own value', () => {
    const own = new Set(list.map((d) => d.name));
    const reExported = new Set(['K_VIS', 'MOLAR_MASS_CO_KG_PER_MOL', 'MOLAR_MASS_CO2_KG_PER_MOL', 'MOLAR_MASS_O2_KG_PER_MOL', 'MOLAR_MASS_N2_KG_PER_MOL']);
    for (const key of Object.keys(constants)) {
      if (reExported.has(key)) continue;
      expect(own.has(key), `${key} is exported but was not found by the comment check`).toBe(true);
    }
    expect(list.length).toBeGreaterThan(50);
  });

  it('gives every exported constant a leading comment that names a source or an estimate label', () => {
    const bad = list.filter((d) => d.comment === '' || d.comment.startsWith('// ---') || !(SOURCE_NAMES.test(d.comment) || LABELS.test(d.comment)));
    expect(bad.map((d) => d.name)).toEqual([]);
  });

  it('computes the unimpeded speed from the three SFPE values', () => {
    expect(constants.V_FREE_M_PER_S).toBeCloseTo(1.4 * (1 - 0.266 * 0.54), 12);
    expect(constants.V_FREE_M_PER_S).toBeCloseTo(1.19, 1);
    expect(constants.D_ZERO_SPEED).toBeCloseTo(3.7594, 4);
    expect(constants.K_LEVEL_M_PER_S * (1 - constants.SPEED_DENSITY_SLOPE * constants.D_ZERO_SPEED)).toBeCloseTo(0, 12);
  });
});
