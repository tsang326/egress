// Compare (run-view spec, Requirement 6): variant B is run A with exactly one change (a door, a window, the fire
// room, or the alarm time). Both plans side by side on one timeline, and a table of differences read from the two results.
import { withOpenEdits, type PlanSession } from '../home/sampleConfigs';
import { SAFETY_NOTICE } from '../plan/importScreen';
import { metricsOf } from '../results/metrics';
import { createRunView } from '../results/runView';
import { createScrubber } from '../results/scrubber';
import type { RunResult } from '../run/pipeline';
import type { SetupState } from '../setup/scenarioBuilder';
import { doorLabel, toggleEdit } from '../setup/setupScreen';
import { button, el, fmtTime } from '../ui';
import { diffRows } from './diffTable';

export type OneChange = { kind: 'door'; doorId: string } | { kind: 'fireRoom'; roomId: string } | { kind: 'alarm'; alarmTimeS: number };

/** Alarm times offered in the compare panel, s. */
export const ALARM_CHOICES_S = [0, 30, 60, 120, 180, 300];

/** Variant B: run A's session and setup with one change applied. */
export function applyChange(run: RunResult, change: OneChange): { session: PlanSession; state: SetupState; label: string } {
  const model = run.session.result.model!;
  if (change.kind === 'alarm') {
    return { session: run.session, state: { ...run.config, alarmTimeS: change.alarmTimeS }, label: `alarm at ${change.alarmTimeS} s instead of ${run.config.alarmTimeS} s` };
  }
  if (change.kind === 'fireRoom') {
    const r = model.rooms.find((x) => x.id === change.roomId)!;
    return { session: run.session, state: { ...run.config, fireRoomId: r.id, fireSiteM: null }, label: `fire moved to ${r.name} (${r.floorId})` };
  }
  const d = model.doors.find((x) => x.id === change.doorId)!;
  const state = toggleEdit(run.config, d, !d.open);
  return { session: withOpenEdits(run.session, state.openEdits), state, label: `${doorLabel(run.session, d)} ${d.open ? 'closed' : 'opened'}` };
}

export interface ChangePanelOptions {
  run: RunResult;
  onRun: (session: PlanSession, state: SetupState, label: string) => void;
  onBack: () => void;
}

export function createChangePanel(container: HTMLElement, opts: ChangePanelOptions): void {
  const run = opts.run;
  const model = run.session.result.model!;
  container.replaceChildren();
  const root = el('section', 'rv-change');
  const head = el('div', 'rv-head');
  head.append(button('← Results', opts.onBack, 'rv-btn rv-btn-link'), el('h1', undefined, `${run.session.title}: compare with one change`));
  root.appendChild(head);
  root.appendChild(el('p', undefined, 'Variant A is the run you just saw. Variant B is the same run with exactly one change. Everything else, the seed included, stays the same, so the difference comes from that change.'));
  const panel = el('div', 'rv-panel');
  const kind = el('select');
  kind.setAttribute('aria-label', 'Kind of change');
  for (const [v, t] of [['door', 'Open or close a door'], ['window', 'Open or close a window'], ['fireRoom', 'Move the fire to another room'], ['alarm', 'Change when the alarm sounds']] as const) {
    const o = el('option', undefined, t);
    o.value = v;
    kind.appendChild(o);
  }
  const value = el('select');
  value.setAttribute('aria-label', 'What to change');
  const fill = (): void => {
    value.replaceChildren();
    if (kind.value === 'alarm') {
      for (const a of ALARM_CHOICES_S.filter((x) => x !== run.config.alarmTimeS)) {
        const o = el('option', undefined, a === 0 ? 'Alarm at 0 s (the moment the fire starts)' : `Alarm at ${a} s`);
        o.value = `alarm:${a}`;
        value.appendChild(o);
      }
    } else if (kind.value === 'fireRoom') {
      for (const r of model.rooms.filter((x) => x.kind !== 'stair' && x.id !== run.config.fireRoomId && run.session.fire.compartments.some((c) => c.id === x.id))) {
        const o = el('option', undefined, `${r.name} (${r.floorId}, ${r.areaM2.toFixed(0)} m²)`);
        o.value = `room:${r.id}`;
        value.appendChild(o);
      }
    } else {
      for (const d of model.doors.filter((x) => x.isWindow === (kind.value === 'window'))) {
        const o = el('option', undefined, `${d.open ? 'Close' : 'Open'}: ${doorLabel(run.session, d)} (${d.floorId})`);
        o.value = `door:${d.id}`;
        value.appendChild(o);
      }
    }
  };
  kind.addEventListener('change', fill);
  fill();
  const err = el('p', 'rv-error');
  const go = button('Run variant B', () => {
    const v = value.value;
    if (!v) {
      err.textContent = 'Choose what to change.';
      return;
    }
    const change: OneChange = v.startsWith('alarm:')
      ? { kind: 'alarm', alarmTimeS: Number(v.slice(6)) }
      : v.startsWith('room:')
        ? { kind: 'fireRoom', roomId: v.slice(5) }
        : { kind: 'door', doorId: v.slice(5) };
    const b = applyChange(run, change);
    if (b.session.result.status !== 'ok') {
      err.textContent = 'The plan has a problem after this change (for example no exit left). Choose another change.';
      return;
    }
    opts.onRun(b.session, b.state, b.label);
  }, 'rv-btn rv-btn-primary');
  go.setAttribute('data-action', 'run-b');
  panel.append(kind, value, go, err);
  root.appendChild(panel);
  root.appendChild(el('p', 'rv-notice', SAFETY_NOTICE));
  container.appendChild(root);
}

export interface CompareOptions {
  a: RunResult;
  b: RunResult;
  changeLabel: string;
  onBack: () => void;
  onHome: () => void;
  canvasMax?: { w: number; h: number };
}

export function createCompareScreen(container: HTMLElement, opts: CompareOptions): { destroy: () => void } {
  container.replaceChildren();
  const root = el('section', 'rv-compare');
  const head = el('div', 'rv-head');
  head.append(button('← Home', opts.onHome, 'rv-btn rv-btn-link'), el('h1', undefined, `${opts.a.session.title}: A vs B`));
  head.appendChild(button('Back to results A', opts.onBack, 'rv-btn'));
  root.appendChild(head);
  root.appendChild(el('p', undefined, `B = A with one change: ${opts.changeLabel}.`));
  const notice = el('p', 'rv-notice', SAFETY_NOTICE);
  notice.setAttribute('data-testid', 'safety-notice');
  root.appendChild(notice);

  const ma = metricsOf(opts.a);
  const mb = metricsOf(opts.b);
  const table = el('table', 'rv-table rv-diff');
  const hr = el('tr');
  hr.append(el('th', undefined, ''), el('th', undefined, 'A'), el('th', undefined, 'B'), el('th', undefined, 'B − A'));
  table.appendChild(hr);
  for (const r of diffRows(ma, mb)) {
    const tr = el('tr');
    tr.setAttribute('data-row', r.key);
    const f = (v: number | null): string => (v === null ? (r.key === 'fireRoomSmokeLoggedS' ? 'not in run' : '–') : r.unit === 's' ? fmtTime(v) : String(v));
    const d = r.diff === null ? '–' : `${r.diff > 0 ? '+' : r.diff < 0 ? '−' : '±'}${r.unit === 's' ? fmtTime(Math.abs(r.diff)) : Math.abs(r.diff)}`;
    tr.append(el('th', undefined, r.label), el('td', undefined, f(r.a)), el('td', undefined, f(r.b)), el('td', 'rv-diff-cell', d));
    table.appendChild(tr);
  }
  root.appendChild(table);

  const duration = Math.max(opts.a.config.durationS, opts.b.config.durationS);
  const max = opts.canvasMax ?? { w: 520, h: 460 };
  const va = createRunView(opts.a, { canvasMax: max });
  const vb = createRunView(opts.b, { canvasMax: max });
  // Same floor on both sides when the user changes floor on one.
  const sync = (from: typeof va, to: typeof vb): void => {
    from.el.addEventListener('click', () => {
      if (to.floorId() !== from.floorId()) to.setFloor(from.floorId());
    });
  };
  sync(va, vb);
  sync(vb, va);
  if (vb.floorId() !== va.floorId()) vb.setFloor(va.floorId());
  const scrub = createScrubber({
    durationS: duration,
    onTime: (t) => {
      va.setTime(t);
      vb.setTime(t);
    },
  });
  root.appendChild(scrub.el);
  const pair = el('div', 'rv-pair');
  const colA = el('div', 'rv-pair-col');
  colA.append(el('h2', undefined, 'A'), va.el);
  const colB = el('div', 'rv-pair-col');
  colB.append(el('h2', undefined, 'B'), vb.el);
  pair.append(colA, colB);
  root.appendChild(pair);
  container.appendChild(root);
  return { destroy: () => scrub.destroy() };
}
