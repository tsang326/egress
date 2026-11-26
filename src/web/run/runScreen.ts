// Run screen (run-view spec, Requirement 4): fire model first, then the crowd model, each in its own Web Worker, with a
// progress bar each and Cancel. Cancel terminates the worker that is running and drops the partial run.
import { defaultWorkerFactory, runFireInWorker, type WorkerFactory, type WorkerLike } from '../fire/fireClient';
import type { PlanSession } from '../home/sampleConfigs';
import { SAFETY_NOTICE } from '../plan/importScreen';
import { buildRun, type SetupState } from '../setup/scenarioBuilder';
import { button, el } from '../ui';
import { defaultCrowdWorkerFactory, runCrowdInWorker, type CrowdWorkerFactory } from './crowdWorkerClient';
import type { RunResult } from './pipeline';

export interface RunOptions {
  session: PlanSession;
  state: SetupState;
  label?: string; // e.g. "Variant B"
  onDone: (r: RunResult) => void;
  onCancel: () => void;
  onFailed: (message: string) => void;
  fireFactory?: WorkerFactory;
  crowdFactory?: CrowdWorkerFactory;
}

export function createRunScreen(container: HTMLElement, opts: RunOptions): { cancel: () => void } {
  container.replaceChildren();
  const box = el('section', 'rv-run');
  box.appendChild(el('h1', undefined, `Running ${opts.session.title}${opts.label ? `, ${opts.label}` : ''}`));
  const fireLabel = el('p', 'rv-stage', 'Running fire…');
  const fireBar = el('progress');
  fireBar.max = 1;
  fireBar.value = 0;
  fireBar.setAttribute('data-bar', 'fire');
  const crowdLabel = el('p', 'rv-stage rv-muted', 'Crowd: waiting for the fire run');
  const crowdBar = el('progress');
  crowdBar.max = 1;
  crowdBar.value = 0;
  crowdBar.setAttribute('data-bar', 'crowd');
  let cancelled = false;
  let active: { terminate: () => void } | null = null;
  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    active?.terminate();
    opts.onCancel();
  };
  const cancelBtn = button('Cancel', cancel, 'rv-btn');
  cancelBtn.setAttribute('data-action', 'cancel');
  box.append(fireLabel, fireBar, crowdLabel, crowdBar, cancelBtn, el('p', 'rv-small', 'The fire model solves the zone equations for every room; the crowd model then walks every person through that smoke. Both run on this device.'), el('p', 'rv-notice', SAFETY_NOTICE));
  container.appendChild(box);

  const built = buildRun(opts.session, opts.state);
  const fireFactory: WorkerFactory = () => {
    const w: WorkerLike = (opts.fireFactory ?? defaultWorkerFactory)();
    active = w;
    return w;
  };
  const t0 = Date.now();
  void runFireInWorker(built.scenario, (e) => {
    fireBar.value = e.fraction;
    fireLabel.textContent = `Running fire… ${Math.round(e.simTimeS)} s of ${built.scenario.durationS} s simulated`;
  }, fireFactory).then((fire) => {
    if (cancelled) return;
    if (fire.status === 'failed' || fire.status === 'invalid') {
      opts.onFailed(`The fire run stopped: ${fire.warnings.map((w) => w.message).join(' ')}`);
      return;
    }
    fireBar.value = 1;
    fireLabel.textContent = `Fire done in ${((Date.now() - t0) / 1000).toFixed(1)} s.`;
    crowdLabel.textContent = 'Running crowd…';
    crowdLabel.classList.remove('rv-muted');
    const run = runCrowdInWorker({ ...built.crowd, plan: built.plan }, fire, (e) => {
      crowdBar.value = e.fraction;
      crowdLabel.textContent = `Running crowd… ${Math.round(e.simTimeS)} s of ${built.crowd.durationS} s`;
    }, opts.crowdFactory ?? defaultCrowdWorkerFactory);
    active = { terminate: run.cancel };
    run.promise.then(
      ({ result, trajectory }) => {
        if (cancelled) return;
        if (result.status !== 'ok') {
          opts.onFailed(`The crowd run stopped: ${result.warnings.map((w) => w.message).join(' ')}`);
          return;
        }
        opts.onDone({ session: opts.session, config: opts.state, built, fire, crowd: result, trajectory });
      },
      (e: unknown) => {
        if (!cancelled) opts.onFailed(`The crowd run stopped: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
  });
  return { cancel };
}
