// Static checks on src/core/people/warnings.ts (Requirement 6.9): no message uses a banned word about a building.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as w from '../../src/core/people/warnings';
import type { CrowdWarning, CrowdWarningCode } from '../../src/core/people/types';

const BANNED = /\b(safe|safely|compliant|certified|passes|meets code)\b/i;

// One sample per code. The Record type makes the compiler fail when a code is added without a constructor here.
const SAMPLES: Record<CrowdWarningCode, () => CrowdWarning> = {
  PLAN_LIMIT: () => w.planLimit('floors', 13, 12),
  PLAN_CELL_TYPE: () => w.planCellType('F1', 3, 4, 'lava'),
  PLAN_ELEVATION: () => w.planElevation('F1', Number.NaN),
  PLAN_LARGE: () => w.planLarge(300000, 250000),
  STAIR_LINK_MISMATCH: () => w.stairLinkMismatch('S1', 'F1', 'F2', 5, 6),
  STAIR_GEOMETRY_RANGE: () => w.stairGeometryRange('S1', 'riser', 0.3, 0.19),
  COMPARTMENT_MISSING_IN_FIRE: () => w.compartmentMissingInFire('F1', 1, 2, 'C9'),
  NO_EXIT: () => w.noExit(),
  AGENT_START_INVALID: () => w.agentStartInvalid('a1', 'F1', -1, 2.5),
  UNREACHABLE_REGION: () => w.unreachableRegion('F1', 1, 2, 3, 4),
  DOOR_TOO_NARROW: () => w.doorTooNarrow('F1', 'door 2', 0.25),
  AGENT_TYPE_REJECTED: () => w.agentTypeRejected('a1', 'child'),
  ENTRY_EXIT_ESTIMATED: () => w.entryExitEstimated('a1', 'E1'),
  DELAY_PARAMS_REJECTED: () => w.delayParamsRejected('staff', -1, Number.NaN),
  FIRE_STATUS: () => w.fireStatus('failed'),
  FIRE_RESULT_ENDED: () => w.fireResultEnded(120),
  FED_INPUT_INVALID: () => w.fedInputInvalid('a1', 'CO', 12.5),
  AGENT_BLOCKED: () => w.agentBlocked('a1', 'E1', 30),
  STAIR_RESULT: () => w.stairResult('S1'),
  LONG_CORRIDOR: () => w.longCorridor('F1', 'corridor', 25, 20),
  NEAR_FIRE: () => w.nearFire('a1', 'F1', 1, 2, 1.5, 40),
  UNMEASURED_MATERIAL: () => w.unmeasuredMaterial('curtain', 'F1', 1, 2),
  INPUT_INVALID: () => w.inputInvalid('durationS', 'must be greater than zero'),
  WORKER_REQUEST_INVALID: () => w.workerRequestInvalid('seed', 'must be a number'),
  WARNINGS_TRUNCATED: () => w.capWarnings(Array.from({ length: 3 }, () => w.noExit()), 1)[1]!,
  INTERNAL_ERROR: () => w.internalError('index out of range', 3),
};

describe('warnings.ts messages', () => {
  it('has a constructor sample for every code, and each builds that code', () => {
    for (const [code, make] of Object.entries(SAMPLES)) {
      const warning = make();
      expect(warning.code).toBe(code);
      expect(warning.message.length).toBeGreaterThan(10);
    }
  });

  it('contains none of the banned words in any message', () => {
    const offenders = Object.values(SAMPLES)
      .map((make) => make())
      .filter((x) => BANNED.test(x.message))
      .map((x) => `${x.code}: ${x.message}`);
    expect(offenders).toEqual([]);
  });

  it('contains none of the banned words in any string literal of the source file', () => {
    const source = readFileSync(new URL('../../src/core/people/warnings.ts', import.meta.url), 'utf8');
    const literals = source.split('\n').filter((l) => !l.trim().startsWith('//')).flatMap((l) => l.match(/'[^']*'|`[^`]*`/g) ?? []);
    expect(literals.length).toBeGreaterThan(20);
    expect(literals.filter((s) => BANNED.test(s))).toEqual([]);
  });
});

describe('capWarnings', () => {
  it('keeps the first N per code and adds one WARNINGS_TRUNCATED entry', () => {
    const input = [...Array.from({ length: 5 }, () => w.noExit()), w.fireStatus('x')];
    const out = w.capWarnings(input, 2);
    expect(out.filter((x) => x.code === 'NO_EXIT')).toHaveLength(2);
    expect(out.filter((x) => x.code === 'FIRE_STATUS')).toHaveLength(1);
    const trunc = out.filter((x) => x.code === 'WARNINGS_TRUNCATED');
    expect(trunc).toHaveLength(1);
    expect(trunc[0]!.message).toContain('3 more NO_EXIT');
  });

  it('adds nothing when no code exceeds the cap', () => {
    const input = [w.noExit(), w.fireStatus('x')];
    expect(w.capWarnings(input, 2)).toEqual(input);
  });
});
