// Source scans and environment tests of src/core/people (task 17.2; Requirements 7.2, 7.3, 7.7).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCrowd } from '../../src/core/people/index';
import { handleMessage } from '../../src/core/people/worker/handler';
import type { FromWorker } from '../../src/core/people/worker/protocol';
import { agentAtCell, crowdInput, noFire, SHORT_DELAY } from './runHelpers';
import { openRoom } from './samplePlans';
const ROOT = resolve(__dirname, '../..');
const PEOPLE = join(ROOT, 'src/core/people');
const CORE = join(ROOT, 'src/core');
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}
// Removes comments and the text of string and template literals, so a word in prose does not count as code.
function codeOnly(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
      i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
const files = sourceFiles(PEOPLE);
describe('src/core/people source scan (Requirements 7.2, 7.3, 7.7)', () => {
  it('finds the module files', () => {
    expect(files.length).toBeGreaterThan(20);
  });
  const banned: [string, RegExp][] = [
    ['Math.random', /\bMath\s*\.\s*random\b/],
    ['Date', /\bDate\b/],
    ['performance', /\bperformance\b/],
    ['window', /\bwindow\b/],
    ['document', /\bdocument\b/],
    ['Worker', /\bWorker\b/],
    ['self', /\bself\b/],
    ['globalThis', /\bglobalThis\b/],
    ['eval', /\beval\s*\(/],
    ['new Function', /\bnew\s+Function\b/],
  ];
  for (const [name, re] of banned) {
    it(`no file uses ${name}`, () => {
      const hits = files.filter((f) => re.test(codeOnly(readFileSync(f, 'utf8')))).map((f) => f.slice(ROOT.length + 1));
      expect(hits).toEqual([]);
    });
  }
  it('every import stays inside src/core and none names a package', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        if (!spec.startsWith('.')) {
          bad.push(`${f.slice(ROOT.length + 1)}: package import "${spec}"`);
          continue;
        }
        const target = resolve(dirname(f), spec);
        if (target !== CORE && !target.startsWith(CORE + sep)) bad.push(`${f.slice(ROOT.length + 1)}: "${spec}" leaves src/core`);
      }
      if (/\bimport\s*\(/.test(codeOnly(src))) bad.push(`${f.slice(ROOT.length + 1)}: dynamic import`);
    }
    expect(bad).toEqual([]);
  });
  it('package.json has no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys((pkg.dependencies as object | undefined) ?? {})).toEqual([]);
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
  });
});
describe('environment (Requirement 7.7)', () => {
  // Browser globals are removed and the clock and random source throw while the run executes; Node keeps its own.
  function withoutBrowserGlobals<T>(fn: () => T): T {
    const g = globalThis as Record<string, unknown>;
    const names = ['window', 'document', 'Worker', 'self', 'navigator', 'localStorage', 'requestAnimationFrame'];
    const saved = names.map((n) => Object.getOwnPropertyDescriptor(g, n));
    const realRandom = Math.random;
    const realNow = Date.now;
    const realPerfNow = performance.now.bind(performance);
    for (const n of names) Object.defineProperty(g, n, { value: undefined, configurable: true, writable: true });
    const boom = (): never => {
      throw new Error('forbidden call during a crowd run');
    };
    Math.random = boom;
    Date.now = boom;
    performance.now = boom;
    try {
      return fn();
    } finally {
      Math.random = realRandom;
      Date.now = realNow;
      performance.now = realPerfNow;
      names.forEach((n, i) => {
        if (saved[i]) Object.defineProperty(g, n, saved[i]!);
        else delete g[n];
      });
    }
  }
  it('runCrowd completes with browser globals undefined and no clock or random source', () => {
    const plan = openRoom().plan;
    const input = crowdInput(plan, [agentAtCell('a', 'staff', 'F0', 3, 3), agentAtCell('b', 'visitor', 'F0', 5, 2)], 20, { delay: SHORT_DELAY });
    const fire = noFire(plan, 20);
    const r = withoutBrowserGlobals(() => runCrowd(input, fire));
    expect(r.status).toBe('ok');
    expect(r.summary!.total).toBe(2);
  });
  it('handleMessage completes with browser globals undefined', () => {
    const plan = openRoom().plan;
    const input = crowdInput(plan, [agentAtCell('a', 'staff', 'F0', 3, 3)], 12, { delay: SHORT_DELAY });
    const posted: FromWorker[] = [];
    withoutBrowserGlobals(() => handleMessage({ type: 'run', id: 1, request: { input, fire: noFire(plan, 12) } }, (m) => posted.push(m)));
    expect(posted[posted.length - 1]!.type).toBe('result');
  });
});
