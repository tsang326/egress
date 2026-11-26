// App shell (run-view spec, design "Navigation state machine"): home -> setup -> run -> results -> compare, plus the
// plan import screen. One screen at a time; going back never re-runs a model.
import './app.css';
import { createChangePanel, createCompareScreen } from './compare/compareScreen';
import { createHomeScreen } from './home/homeScreen';
import { loadSample, type PlanSession } from './home/sampleConfigs';
import { createImportScreen, type UsedPlan } from './plan/importScreen';
import type { RunResult } from './run/pipeline';
import { createResultsScreen } from './results/resultsScreen';
import { createRunScreen } from './run/runScreen';
import type { SetupState } from './setup/scenarioBuilder';
import { createSetupScreen, defaultSetup } from './setup/setupScreen';
import { button, el } from './ui';

export type AppState =
  | { view: 'home' }
  | { view: 'import' }
  | { view: 'setup'; session: PlanSession; config: SetupState | null }
  | { view: 'run'; session: PlanSession; config: SetupState; variant: 'A' | 'B'; runA?: RunResult; changeLabel?: string }
  | { view: 'results'; runA: RunResult }
  | { view: 'change'; runA: RunResult }
  | { view: 'compare'; runA: RunResult; runB: RunResult; changeLabel: string };

/** The plan the user accepted with "Use this plan" (plan-import Req 19.8, 19.9). */
let usedPlan: UsedPlan | null = null;
export function getUsedPlan(): UsedPlan | null {
  return usedPlan;
}

const root = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

function go(s: AppState): void {
  cleanup?.();
  cleanup = null;
  window.scrollTo?.(0, 0);
  switch (s.view) {
    case 'home':
      createHomeScreen(root, {
        onSample: (id) => go({ view: 'setup', session: loadSample(id), config: null }),
        onImport: () => go({ view: 'import' }),
      });
      return;
    case 'import': {
      root.replaceChildren();
      const bar = el('div', 'rv-head');
      bar.appendChild(button('← Home', () => go({ view: 'home' }), 'rv-btn rv-btn-link'));
      const host = el('div');
      root.append(bar, host);
      createImportScreen(host, {
        onUsePlan: (plan) => {
          usedPlan = plan;
          go({ view: 'setup', session: { ...plan, title: plan.sources[0]?.fileName.replace(/\.dxf$/i, '') ?? 'Your building' }, config: null });
        },
      });
      return;
    }
    case 'setup':
      createSetupScreen(root, {
        session: s.session,
        state: s.config ?? defaultSetup(s.session),
        onBack: () => go({ view: 'home' }),
        onRun: (session, config) => go({ view: 'run', session, config, variant: 'A' }),
      });
      return;
    case 'run': {
      createRunScreen(root, {
        session: s.session,
        state: s.config,
        ...(s.variant === 'B' ? { label: 'variant B' } : {}),
        onCancel: () => (s.variant === 'B' && s.runA ? go({ view: 'change', runA: s.runA }) : go({ view: 'setup', session: s.session, config: s.config })),
        onFailed: (msg) => {
          root.replaceChildren();
          const box = el('section', 'rv-run');
          box.append(el('h1', undefined, 'The run did not finish'), el('p', 'rv-error', msg), button('Back to setup', () => go({ view: 'setup', session: s.session, config: s.config }), 'rv-btn'));
          root.appendChild(box);
        },
        onDone: (run) => (s.variant === 'B' && s.runA ? go({ view: 'compare', runA: s.runA, runB: run, changeLabel: s.changeLabel ?? '' }) : go({ view: 'results', runA: run })),
      });
      return;
    }
    case 'results': {
      const r = createResultsScreen(root, {
        run: s.runA,
        onHome: () => go({ view: 'home' }),
        onBack: () => go({ view: 'setup', session: s.runA.session, config: s.runA.config }),
        onCompare: () => go({ view: 'change', runA: s.runA }),
      });
      cleanup = r.destroy;
      return;
    }
    case 'change':
      createChangePanel(root, {
        run: s.runA,
        onBack: () => go({ view: 'results', runA: s.runA }),
        onRun: (session, config, label) => go({ view: 'run', session, config, variant: 'B', runA: s.runA, changeLabel: label }),
      });
      return;
    case 'compare': {
      const r = createCompareScreen(root, {
        a: s.runA,
        b: s.runB,
        changeLabel: s.changeLabel,
        onHome: () => go({ view: 'home' }),
        onBack: () => go({ view: 'results', runA: s.runA }),
      });
      cleanup = r.destroy;
      return;
    }
  }
}

go({ view: 'home' });
