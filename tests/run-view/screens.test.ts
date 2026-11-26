// @vitest-environment happy-dom
// Run-view screens in a DOM (run-view spec, Requirements 1, 2, 5, 6, 9.4): navigation hooks, input errors, the safety
// notice, warnings grouped by code, the compare table, and a source scan for network calls and banned words.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCompareScreen, createChangePanel } from '../../src/web/compare/compareScreen';
import { createHomeScreen } from '../../src/web/home/homeScreen';
import { SAFETY_NOTICE } from '../../src/web/plan/importScreen';
import { createResultsScreen } from '../../src/web/results/resultsScreen';
import { runInThread, type RunResult } from '../../src/web/run/pipeline';
import { createSetupScreen, defaultSetup } from '../../src/web/setup/setupScreen';
import { loadSample } from '../../src/web/home/sampleConfigs';
import { sampleSetup } from './helpers';

const ROOT = join(__dirname, '..', '..');
const BANNED = /\b(safe|compliant|certified|passes|meets code)\b/i; // same list as the plan screen (plan-import Req 19.14)
const noRaf = { raf: () => 0, caf: () => undefined };

let box: HTMLElement;
beforeEach(() => {
  box = document.createElement('div');
  document.body.appendChild(box);
});
afterEach(() => box.remove());

const click = (sel: string): void => (box.querySelector(sel) as HTMLElement).click();

let cafeRun: RunResult | null = null;
const cafe = (): RunResult => (cafeRun ??= runInThread(sampleSetup('cafe', 90).session, sampleSetup('cafe', 90).state));

describe('home', () => {
  it('lists the three samples and an import button; a card reports its id (Req 1.1, 1.2)', () => {
    const got: string[] = [];
    let imported = 0;
    createHomeScreen(box, { onSample: (id) => got.push(id), onImport: () => imported++ });
    const cards = [...box.querySelectorAll('button.rv-card[data-sample]')].map((b) => b.getAttribute('data-sample'));
    expect(cards).toEqual(['cafe', 'karaoke', 'boarding-house']);
    click('[data-sample="karaoke"]');
    click('[data-action="import"]');
    expect(got).toEqual(['karaoke']);
    expect(imported).toBe(1);
    expect(box.textContent).toContain(SAFETY_NOTICE);
  });
});

describe('setup', () => {
  it('Run with no fire room shows the error and does not start (Req 2.6)', () => {
    const session = loadSample('cafe');
    let runs = 0;
    createSetupScreen(box, { session, state: defaultSetup(session), onRun: () => runs++, onBack: () => undefined });
    click('[data-action="run"]');
    expect(runs).toBe(0);
    const err = box.querySelector('[role="alert"]')!;
    expect(err.textContent).toContain('Click a room on the plan');
    expect(err.textContent).toContain('Choose what is burning');
  });

  it('a complete setup starts the run with the chosen state', () => {
    const { session, state } = sampleSetup('cafe');
    const got: unknown[] = [];
    createSetupScreen(box, { session, state, onRun: (_s, st) => got.push(st), onBack: () => undefined });
    click('[data-action="run"]');
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ fireRoomId: state.fireRoomId });
  });

  it('every door has a checkbox and unchecking one records a setDoorOpen edit (Req 2.5)', () => {
    const { session, state } = sampleSetup('karaoke');
    const got: { openEdits: unknown[] }[] = [];
    createSetupScreen(box, { session, state, onRun: (_s, st) => got.push(st), onBack: () => undefined });
    const boxes = [...box.querySelectorAll('input[data-door]')] as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(0);
    const first = boxes.find((b) => b.checked)!;
    first.checked = false;
    first.dispatchEvent(new Event('change'));
    click('[data-action="run"]');
    expect(got.at(-1)!.openEdits).toContainEqual(expect.objectContaining({ doorId: first.getAttribute('data-door'), open: false }));
  });
});

describe('results', () => {
  it('shows the safety notice, the summary counts and warnings grouped by code (Req 5.4, 5.7, 5.8)', () => {
    const run = cafe();
    createResultsScreen(box, { run, onBack: () => undefined, onHome: () => undefined, onCompare: () => undefined, ...noRaf });
    expect(box.querySelector('[data-testid="safety-notice"]')!.textContent).toBe(SAFETY_NOTICE);
    const sum = box.querySelector('[data-testid="summary"]')!.textContent!;
    expect(sum).toContain(`${run.crowd.summary!.out}out`);
    const codes = [...box.querySelectorAll('details[data-code]')].map((d) => d.getAttribute('data-code'));
    expect(new Set(codes).size).toBe(codes.length);
    const all = new Set([...run.fire.warnings, ...run.crowd.warnings].map((w) => w.code));
    expect(new Set(codes)).toEqual(all);
  });

  it('the compare button leads to a change panel whose run uses exactly one change (Req 6.1)', () => {
    const run = cafe();
    let compared = 0;
    createResultsScreen(box, { run, onBack: () => undefined, onHome: () => undefined, onCompare: () => compared++, ...noRaf });
    click('[data-action="compare"]');
    expect(compared).toBe(1);
    box.replaceChildren();
    const got: string[] = [];
    createChangePanel(box, { run, onRun: (_s, _st, label) => got.push(label), onBack: () => undefined });
    click('[data-action="run-b"]');
    expect(got).toHaveLength(1);
  });

  it('the compare screen shows a difference row per metric (Req 6.3)', () => {
    const run = cafe();
    const c = createCompareScreen(box, { a: run, b: run, changeLabel: 'nothing', onBack: () => undefined, onHome: () => undefined });
    expect(box.querySelectorAll('tr[data-row]').length).toBe(4);
    c.destroy();
  });
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('source scan', () => {
  const web = files(join(ROOT, 'src', 'web')).filter((f) => !f.includes(`${join('src', 'web', 'plan')}`));
  it('the run-view code makes no network call and evaluates no code (everything runs in the browser)', () => {
    for (const f of web) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|\beval\s*\(|new\s+Function\b|WebSocket/);
    }
  });
  it('string literals hold no banned words (Req 1.4)', () => {
    for (const f of web) {
      const lits = readFileSync(f, 'utf8').match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
      for (const l of lits) expect(l, f).not.toMatch(BANNED);
    }
  });
});
