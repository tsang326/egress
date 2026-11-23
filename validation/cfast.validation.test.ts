// Validation_Suite (fire-zone Req 13, 9.9, 6.13, 15.3): one test per CFAST input file under validation/cases/.
// Run with `npm run test:validation`. Writes validation/REPORT.md in afterAll, also when cases fail.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { writeReport, type CaseResult } from './harness/report';
import { evaluateCase, findCaseFiles, repoPath, worstOf } from './harness/suite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CASES_DIR = resolve(ROOT, 'validation', 'cases');
// One case runs the model twice; the longest cases take well over the default 5 s.
const CASE_TIMEOUT_MS = 600_000;

const readText = (path: string): string | undefined => {
  const p = resolve(ROOT, path);
  return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
};

const results = new Map<string, CaseResult>();
const lines: string[] = [];

describe('CFAST validation suite', () => {
  afterAll(() => {
    writeReport([...results.values()]);
    console.log(`Validation summary (${results.size} cases)\n${lines.join('\n')}`);
  });

  for (const file of findCaseFiles(CASES_DIR)) {
    const path = repoPath(ROOT, file);
    it(
      path,
      () => {
        const ev = evaluateCase({ path, text: readFileSync(file, 'utf8'), readText });
        results.set(path, ev.result);
        lines.push(
          `${ev.result.verdict.padEnd(17)} ${path}  ${(ev.runTimeMs / 1000).toFixed(1)} s  worst: ${worstOf(ev.result.comparison)}` +
            (ev.result.comparison ? '' : `  reason: ${ev.result.reason ?? ''}`),
        );
        if (ev.result.verdict === 'unsupported') expect.fail(ev.result.reason ?? 'unsupported');
        expect(ev.result.verdict, ev.result.reason).toBe('within tolerance');
      },
      CASE_TIMEOUT_MS,
    );
  }
});
