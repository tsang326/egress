// @vitest-environment happy-dom
// DOM and source-scan tests for the plan import screen (task 18.4).
// Requirements: 3.9, 16.8, 19.8, 19.12, 19.14, 20.11, 21.3, 22.7
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSamples } from '../../tools/samples/generate';
import { importBuildingModel } from '../../src/core/plan/import';
import { inputInvalid } from '../../src/core/plan/warnings';
import type { ImportResult, ImportSettings, LayerMap } from '../../src/core/plan/types';
import { createImportScreen, SAFETY_NOTICE, type ImportScreen, type UsedPlan } from '../../src/web/plan/importScreen';
import { NOT_STORED_MESSAGE } from '../../src/web/plan/storage';
import type { PlanWorkerApi } from '../../src/web/plan/planWorker';
import { writeDxf } from './helpers/dxfWriter';

// The screen must never call the core entry point (Requirement 21.3). The spy wraps the real function so the test can
// build a reply with it before the screen exists; calls are counted after that.
vi.mock('../../src/core/plan/import', async (orig) => {
  const actual = await orig<typeof import('../../src/core/plan/import')>();
  return { ...actual, importBuildingModel: vi.fn(actual.importBuildingModel) };
});

const ROOT = join(__dirname, '..', '..');
const CAFE = 'cafe.dxf';
const LAYER_MAP: LayerMap = { 'A-WALL': 'wall', 'A-DOOR': 'door', 'A-GLAZ': 'window', 'A-FLOR-STRS': 'stair', 'A-FURN': 'furniture', '0': 'ignore' };
const BANNED = /\b(safe|compliant|certified|passes|meets code)\b/i;
const HOSTILE = '<img src=x onerror=alert(1)>';

const cafeText = generateSamples()[CAFE]!;

/** A real result for the café, built before the screen exists. */
function realResult(): ImportResult {
  const base: ImportSettings = { layerMaps: { [CAFE]: LAYER_MAP }, drawingUnits: { [CAFE]: 'm' } };
  const first = importBuildingModel([{ fileName: CAFE, text: cafeText }], base);
  const exitDoorIds = first.model!.doors.filter((d) => !d.isWindow && (d.roomIdA === 'OUTSIDE' || d.roomIdB === 'OUTSIDE')).map((d) => d.id);
  return importBuildingModel([{ fileName: CAFE, text: cafeText }], { ...base, exitDoorIds });
}

const MARKER = 'MOCK-REPLY-MARKER';
function mockApi(reply: ImportResult): PlanWorkerApi & { importInWorker: ReturnType<typeof vi.fn> } {
  return {
    importInWorker: vi.fn(async () => reply),
    loadProjectInWorker: vi.fn(async () => ({ status: 'invalid' as const, errors: [] })),
  };
}

let container: HTMLElement;
let screen: ImportScreen | null = null;
const okStorage = (): Storage => ({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined } as unknown as Storage);

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  screen?.destroy();
  screen = null;
});

async function load(reply: ImportResult, extra: { storage?: Storage | null; onUsePlan?: (p: UsedPlan) => void; text?: string; fileName?: string } = {}) {
  const api = mockApi(reply);
  screen = createImportScreen(container, { api, storage: extra.storage ?? okStorage(), ...(extra.onUsePlan ? { onUsePlan: extra.onUsePlan } : {}) });
  await screen.addSources([{ fileName: extra.fileName ?? CAFE, text: extra.text ?? cafeText }], { confirmSuggested: true });
  await screen.whenIdle();
  return api;
}

const buttonByText = (t: string): HTMLButtonElement | undefined => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === t);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}
/** Source without comments, so the scans look at code and strings only. */
function code(path: string): string {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
const WEB = sourceFiles(join(ROOT, 'src', 'web', 'plan'));
const CORE = sourceFiles(join(ROOT, 'src', 'core', 'plan'));

describe('source scans', () => {
  it('web/plan never writes markup (Req 3.9, 19.14)', () => {
    for (const f of WEB) expect(code(f), f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });

  it('core/plan and web/plan make no network call and run no dynamic code (Req 22.7)', () => {
    for (const f of [...CORE, ...WEB]) {
      const src = code(f);
      expect(src, f).not.toMatch(/\bfetch\s*\(/);
      expect(src, f).not.toMatch(/XMLHttpRequest/);
      expect(src, f).not.toMatch(/\beval\s*\(/);
      expect(src, f).not.toMatch(/new\s+Function\b/);
      expect(src, f).not.toMatch(/\bimport\s*\(/);
    }
  });

  it('string literals in web/plan hold no banned words (Req 19.14)', () => {
    for (const f of WEB) {
      const lits = code(f).match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
      for (const l of lits) expect(l, f).not.toMatch(BANNED);
    }
  });
});

describe('import screen', () => {
  it('shows DXF-derived text as text and creates no element from it (Req 3.9)', async () => {
    const text = writeDxf({
      layers: [HOSTILE, 'A-WALL'],
      blocks: [{ name: HOSTILE + 'B', entities: [{ type: 'LINE', layer: HOSTILE, a: [0, 0], b: [1, 0] }] }],
      entities: [
        { type: 'LINE', layer: 'A-WALL', a: [0, 0], b: [4, 0] },
        { type: 'LINE', layer: HOSTILE, a: [0, 1], b: [4, 1] },
      ],
    });
    await load(realResult(), { text, fileName: HOSTILE + '.dxf' });
    expect(container.querySelector('img')).toBeNull();
    const cellTexts = Array.from(container.querySelectorAll('td')).map((td) => td.textContent);
    expect(cellTexts).toContain(HOSTILE);
    expect(container.querySelector('h2')?.textContent).toContain(HOSTILE);
    // The block name is offered as a floor source, again as text.
    buttonByText('Add a floor')!.click();
    await screen!.whenIdle();
    expect(container.querySelector('img')).toBeNull();
    expect(Array.from(container.querySelectorAll('option')).map((o) => o.textContent)).toContain(HOSTILE + 'B');
  });

  it('runs the import through the injected worker API and shows its reply (Req 21.3)', async () => {
    const real = realResult();
    const reply: ImportResult = { ...real, warnings: [...real.warnings, inputInvalid(MARKER)] };
    vi.mocked(importBuildingModel).mockClear();
    const api = await load(reply);
    expect(api.importInWorker).toHaveBeenCalled();
    const [sent] = api.importInWorker.mock.calls[0] as [{ fileName: string }[]];
    expect(sent[0]!.fileName).toBe(CAFE);
    expect(vi.mocked(importBuildingModel)).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain(MARKER);
  });

  it('shows the safety notice on the results view and no banned word anywhere on screen (Req 19.12, 19.14)', async () => {
    await load(realResult());
    const notices = Array.from(container.querySelectorAll('[data-testid="safety-notice"]'));
    expect(notices.length).toBeGreaterThan(0);
    expect(notices[0]!.textContent).toBe(SAFETY_NOTICE);
    expect(container.textContent ?? '').not.toMatch(BANNED);
  });

  it('enables "Use this plan" only when the status is ok (Req 19.8)', async () => {
    const real = realResult();
    expect(real.status).toBe('ok');
    const used: UsedPlan[] = [];
    await load(real, { onUsePlan: (p) => used.push(p) });
    const btn = buttonByText('Use this plan')!;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(used).toHaveLength(1);
    expect(used[0]!.planInput).toBe(real.derived!.planInput);
    screen!.destroy();
    container.replaceChildren();

    await load({ ...real, status: 'invalid', warnings: [...real.warnings, inputInvalid('forced')] });
    expect(buttonByText('Use this plan')!.disabled).toBe(true);
  });

  it('shows the stair warning where a stair room exists (Req 22.8)', async () => {
    const real = realResult();
    const model = { ...real.model!, rooms: real.model!.rooms.map((r, i) => (i === 0 ? { ...r, kind: 'stair' as const } : r)) };
    await load({ ...real, model });
    const w = container.querySelector('[data-testid="stair-warning"]');
    expect(w).not.toBeNull();
    expect(w!.textContent).toMatch(/stair/i);
  });

  it('shows the message and continues when localStorage fails (Req 16.8)', async () => {
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    } as unknown as Storage;
    await load(realResult(), { storage: failing });
    expect(container.textContent).toContain(NOT_STORED_MESSAGE);
    // The screen still works: results and the save button are there.
    expect(container.querySelector('[data-testid="safety-notice"]')).not.toBeNull();
    expect(buttonByText('Save project')!.disabled).toBe(false);
  });
});
