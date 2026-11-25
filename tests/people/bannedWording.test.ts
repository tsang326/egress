// Banned-wording scan of every user-visible string (task 20.1; Requirements 6.8, 6.9, 9.10).
// Sources: the templates of outputs/text.ts, the messages of warnings.ts, the notice, and every string in the CrowdResult
// of the sample plans and of generated runs. Nothing about a building may be called safe, compliant, certified, passing or
// meeting code. The notice is the only string with "fire-safety review". The time of the last exit is "evacuation time".
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runCrowd } from '../../src/core/people/index';
import * as text from '../../src/core/people/outputs/text';
import type { CrowdResult, CrowdWarningCode } from '../../src/core/people/types';
import * as w from '../../src/core/people/warnings';
import { arbRunCaseSmoke } from './runArbs';
import { agentAtCell, crowdInput, noFire, SHORT_DELAY } from './runHelpers';
import { allSamples } from './samplePlans';
import { syntheticFire } from './syntheticFire';

const BANNED = /\b(safe|safely|compliant|certified|passes|meets code)\b/i;
const NOTICE_PHRASE = 'fire-safety review';
// Phrases that name the time of the last exit under another name (RSET labels).
const OTHER_NAMES_FOR_LAST_EXIT = /\b(RSET|egress time|escape time|clearance time|last exit time)\b/i;

// Every string reachable from a value, typed arrays skipped.
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (typeof v === 'object' && v !== null && !ArrayBuffer.isView(v)) Object.values(v).forEach((x) => strings(x, out));
  return out;
}

// One sample per warning code; the Record type makes a new code without a sample a compile error.
const WARNING_SAMPLES: Record<CrowdWarningCode, () => ReturnType<typeof w.noExit>> = {
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

// Every template of outputs/text.ts, with arguments that reach each branch.
function templateStrings(): string[] {
  const out: string[] = [text.NOTICE, text.NO_ONE_OUT_TEXT, text.NO_AGENTS_TEXT, text.MEDIAN_DOSE_TEXT];
  for (const t of [0, 1, 59.4, 60, 161, 3600]) out.push(text.formatDuration(t), text.evacuationTimeText(t));
  for (const [o, n] of [[0, 0], [1, 1], [3, 5]] as const) out.push(text.outText(o, n));
  for (const [i, s] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 7]] as const) out.push(text.incapacitatedAndInsideText(i, s));
  for (const total of [0, 1, 5]) {
    for (const out_ of [0, Math.min(total, 1), total]) {
      for (const inc of [0, 1]) {
        const stillInside = Math.max(0, total - out_ - inc);
        out.push(...text.summaryText({ total, out: out_, incapacitated: Math.min(inc, total - out_), stillInside, evacuationTimeS: out_ === 0 ? null : 120 }));
      }
    }
  }
  return out;
}

// Runs of the sample plans, with delay, smoke, fire sites and material sites so the warnings and texts appear.
function sampleRunResults(): CrowdResult[] {
  const results: CrowdResult[] = [];
  for (const s of allSamples()) {
    const floorId = s.plan.floors[0]!.id;
    const agents = [agentAtCell('a1', 'staff', floorId, 3, 3), agentAtCell('a2', 'visitor', floorId, 4, 4), agentAtCell('a3', 'child', floorId, 5, 3)];
    const smoke = syntheticFire({
      durationS: 60,
      compartments: s.plan.compartmentIds.map((id) => ({
        id,
        end: { interfaceHeightM: 1, upperTempK: 700, lowerTempK: 330, upper: { o2: 0.1, co2: 0.1, co: 0.02, opticalDensityPerM: 3 }, lower: { o2: 0.2, co2: 0.02, co: 0.002, opticalDensityPerM: 0.5 } },
      })),
    });
    const extra = {
      delay: SHORT_DELAY,
      fireSites: [{ floorId, xM: 1, yM: 1 }],
      unmeasuredMaterialSites: [{ floorId, xM: 1, yM: 1, material: 'curtain' }],
    };
    results.push(runCrowd(crowdInput(s.plan, agents, 60, extra), smoke));
    results.push(runCrowd(crowdInput(s.plan, agents, 60, extra), noFire(s.plan, 60)));
    results.push(runCrowd(crowdInput(s.plan, agents, 0), noFire(s.plan, 60))); // invalid: durationS
  }
  return results;
}

function generatedRunResults(): CrowdResult[] {
  return fc.sample(arbRunCaseSmoke, { numRuns: 12, seed: 20 }).map((c) => runCrowd(c.input, c.fire));
}

function expectClean(all: string[]): void {
  const banned = all.filter((s) => BANNED.test(s)).map((s) => `${BANNED.exec(s)![0]}: ${s}`);
  expect(banned).toEqual([]);
  const noticeUses = all.filter((s) => s.includes(NOTICE_PHRASE));
  expect(noticeUses.every((s) => s === text.NOTICE)).toBe(true);
  const renamed = all.filter((s) => OTHER_NAMES_FOR_LAST_EXIT.test(s));
  expect(renamed).toEqual([]);
}

describe('banned wording in user-visible strings', () => {
  it('outputs/text.ts templates and the notice are clean, and the notice is the only fire-safety review string', () => {
    const all = templateStrings();
    expect(all.length).toBeGreaterThan(20);
    expectClean(all);
    expect(text.NOTICE).toContain(NOTICE_PHRASE);
    expect(all.filter((s) => s.includes(NOTICE_PHRASE)).length).toBeGreaterThan(0);
  });

  it('every Warning message is clean', () => {
    const all = Object.values(WARNING_SAMPLES).map((make) => make().message);
    expect(all).toHaveLength(Object.keys(WARNING_SAMPLES).length);
    expectClean(all);
  });

  it('every RSET label is "evacuation time"', () => {
    const lines = templateStrings().filter((s) => /last (person|exit)/i.test(s));
    expect(lines.length).toBeGreaterThan(0);
    for (const s of lines) expect(s).toContain('evacuation time');
    for (const t of [1, 90, 400]) expect(text.evacuationTimeText(t)).toContain('evacuation time');
  });

  it('every string of the CrowdResult of sample plans is clean and the notice is present', () => {
    const results = sampleRunResults();
    expect(results.some((r) => r.status === 'ok')).toBe(true);
    expect(results.some((r) => r.status === 'invalid')).toBe(true);
    const all = results.flatMap((r) => strings(r));
    expect(all.length).toBeGreaterThan(50);
    expect(results.every((r) => r.notice === text.NOTICE)).toBe(true);
    expectClean(all);
  });

  it('every string of generated runs is clean', () => {
    const results = generatedRunResults();
    expect(results).toHaveLength(12);
    const all = results.flatMap((r) => strings(r));
    expect(all.length).toBeGreaterThan(12);
    expectClean(all);
  });
});
