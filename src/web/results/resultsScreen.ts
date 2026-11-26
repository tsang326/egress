// Results screen (run-view spec, Requirement 5): timeline, plan with people and smoke, summary, charts, the people
// who were incapacitated, warnings grouped by code, downloads, and the safety notice.
import { fireChoiceLabel } from '../../core/fire/library';
import { downloadCanvasPng, summaryText } from '../export/exportSummary';
import { download, runToJson, slug } from '../export/exportJson';
import { SAFETY_NOTICE, STAIR_LIMIT_INTRO } from '../plan/importScreen';
import type { RunResult } from '../run/pipeline';
import { button, el, fmtTime } from '../ui';
import { drawChart, peopleChart, roomChart } from './charts';
import { metricsOf } from './metrics';
import { sampleIndexAt, seriesLookup } from './planRenderer';
import { createRunView, fireSeries, stateCountsAt } from './runView';
import { createScrubber } from './scrubber';
import { SHOW_INCAPACITATED, SHOW_MOVING, SHOW_OUT, SHOW_QUEUED, SHOW_STAIR, SHOW_WAITING } from '../run/trajectory';
import { renderWarningList } from './warningList';

export interface ResultsOptions {
  run: RunResult;
  onBack: () => void; // to setup, same choices
  onHome: () => void;
  onCompare: () => void;
  canvasMax?: { w: number; h: number };
  raf?: (cb: (ms: number) => void) => number;
  caf?: (h: number) => void;
}

const INCAP_LIST_MAX = 30; // layout choice; the count always shows the total

export function createResultsScreen(container: HTMLElement, opts: ResultsOptions): { destroy: () => void } {
  const run = opts.run;
  const model = run.session.result.model!;
  const m = metricsOf(run);
  container.replaceChildren();
  const root = el('section', 'rv-results');

  const head = el('div', 'rv-head');
  head.append(button('← Home', opts.onHome, 'rv-btn rv-btn-link'), el('h1', undefined, `${run.session.title}: results`));
  const actions = el('div', 'rv-actions');
  actions.append(button('Change setup', opts.onBack, 'rv-btn'));
  const cmp = button('Compare with one change', opts.onCompare, 'rv-btn rv-btn-primary');
  cmp.setAttribute('data-action', 'compare');
  actions.append(cmp);
  head.appendChild(actions);
  root.appendChild(head);
  const room = model.rooms.find((r) => r.id === run.config.fireRoomId);
  root.appendChild(el('p', 'rv-small', `Fire: ${run.config.fireChoice ? fireChoiceLabel(run.config.fireChoice) : '-'}, in ${room?.name ?? '-'} on ${room?.floorId ?? '-'}. Alarm at ${run.config.alarmTimeS} s. ${m.total} people.`));
  const notice = el('p', 'rv-notice', SAFETY_NOTICE);
  notice.setAttribute('data-testid', 'safety-notice');
  root.appendChild(notice);

  const cols = el('div', 'rv-cols');
  const left = el('div', 'rv-col-plan');
  const right = el('div', 'rv-col-panel');
  cols.append(left, right);
  root.appendChild(cols);

  // Summary.
  const sum = el('div', 'rv-panel rv-summary');
  sum.setAttribute('data-testid', 'summary');
  const stat = (n: string, label: string, cls: string): HTMLElement => {
    const b = el('div', `rv-stat ${cls}`);
    b.append(el('strong', undefined, n), el('span', undefined, label));
    return b;
  };
  const stats = el('div', 'rv-stats');
  stats.append(stat(String(m.out), 'out', 'rv-stat-out'), stat(String(m.incapacitated), 'incapacitated', 'rv-stat-inc'), stat(String(m.stillInside), 'still inside', 'rv-stat-in'));
  sum.appendChild(stats);
  sum.appendChild(el('p', 'rv-evac', m.out > 0 ? `Evacuation time (last person out): ${fmtTime(m.evacuationTimeS)}` : 'Nobody got out.'));
  sum.appendChild(el('p', 'rv-small', `Fire room smoke-logged at 1.6 m (visibility below ${m.fireRoomLimitM} m): ${m.fireRoomSmokeLoggedS === null ? 'not within the run' : `after ${fmtTime(m.fireRoomSmokeLoggedS)}`}.`));
  for (const line of run.crowd.summary?.text.slice(2) ?? []) sum.appendChild(el('p', 'rv-small', line));
  const live = el('p', 'rv-live');
  sum.appendChild(live);
  right.appendChild(sum);

  // Incapacitated list (Requirement 5.6).
  const inc = run.crowd.agents.filter((a) => a.finalState === 'incapacitated').sort((a, b) => (a.incapacitatedTimeS ?? 0) - (b.incapacitatedTimeS ?? 0));
  if (inc.length > 0) {
    const box = el('div', 'rv-panel');
    box.appendChild(el('h2', undefined, `Incapacitated (${inc.length})`));
    const t = el('table', 'rv-table');
    const hr = el('tr');
    hr.append(el('th', undefined, 'Person'), el('th', undefined, 'When'), el('th', undefined, 'Cause'));
    t.appendChild(hr);
    for (const a of inc.slice(0, INCAP_LIST_MAX)) {
      const tr = el('tr');
      tr.append(el('td', undefined, a.id), el('td', undefined, fmtTime(a.incapacitatedTimeS)), el('td', undefined, a.causes.join(', ')));
      t.appendChild(tr);
    }
    box.appendChild(t);
    if (inc.length > INCAP_LIST_MAX) box.appendChild(el('p', 'rv-small', `and ${inc.length - INCAP_LIST_MAX} more (all are in the JSON download).`));
    box.appendChild(el('p', 'rv-small', 'Incapacitated means the dose of toxic gas or heat reached the median incapacitating dose (ISO 13571 FED = 1), or the air at head height passed the temperature limit.'));
    right.appendChild(box);
  }

  // Plan + scrubber.
  let selected: string | null = run.config.fireRoomId;
  const charts = el('div', 'rv-charts');
  const peopleCanvas = el('canvas', 'rv-chart');
  peopleCanvas.width = 560;
  peopleCanvas.height = 200;
  const roomCanvas = el('canvas', 'rv-chart');
  roomCanvas.width = 560;
  roomCanvas.height = 220;
  const roomNote = el('p', 'rv-small');
  charts.append(peopleCanvas, roomCanvas, roomNote);

  const view = createRunView(run, {
    canvasMax: opts.canvasMax ?? { w: 640, h: 640 },
    onRoomClick: (id) => {
      selected = id;
      view.selectRoom(id);
      drawCharts(scrub.time());
    },
  });
  view.selectRoom(selected);
  left.appendChild(view.el);
  left.appendChild(el('p', 'rv-small', 'Click a room to plot its temperature and smoke height. Colours show the air at 1.6 m, the eye height the crowd model uses.'));

  const stairIds = run.built.scenario.compartments.filter((c) => c.isStair).map((c) => c.id);
  const lookup = seriesLookup(run.fire, stairIds);
  const stairFlagged = new Set(run.fire.flags.filter((f) => run.fire.warnings[f.warningIndex]?.code === 'STAIR_OR_SHAFT_LIMIT').map((f) => f.target.id));

  const showLive = (t: number): void => {
    const c = stateCountsAt(run, t);
    const g = (k: number): number => c[k] ?? 0;
    live.textContent = `At ${fmtTime(t)}: ${g(SHOW_WAITING)} not moving yet, ${g(SHOW_MOVING) + g(SHOW_STAIR)} moving, ${g(SHOW_QUEUED)} queued, ${g(SHOW_OUT)} out, ${g(SHOW_INCAPACITATED)} incapacitated.`;
  };
  const drawCharts = (t: number): void => {
    drawChart(peopleCanvas, peopleChart(run.crowd.agents, run.config.durationS, t));
    const rooms: { name: string; series: NonNullable<ReturnType<typeof lookup>>; dashed: boolean }[] = [];
    const fs = fireSeries(run);
    if (fs) rooms.push({ name: room?.name ?? 'Fire room', series: fs, dashed: false });
    const selRoom = selected ? model.rooms.find((r) => r.id === selected) : undefined;
    const ss = selRoom && selRoom.id !== run.config.fireRoomId ? lookup(selRoom.id) : undefined;
    if (selRoom && ss) rooms.push({ name: selRoom.name, series: ss, dashed: true });
    const heightM = Math.max(...run.built.scenario.compartments.map((c) => c.heightM));
    drawChart(roomCanvas, roomChart(run.fire.timesS, rooms, heightM, t));
    const i = sampleIndexAt(run.fire.timesS, t);
    const parts: string[] = [];
    for (const r of rooms) parts.push(`${r.name}: hot layer ${(r.series.upperTempK[i]! - 273.15).toFixed(0)} °C, smoke down to ${r.series.interfaceHeightM[i]!.toFixed(2)} m`);
    roomNote.textContent = parts.join(' · ');
    if (selRoom && (stairFlagged.has(selRoom.id) || selRoom.kind === 'stair' || stairIds.some((id) => stairFlagged.has(id) && lookup(selRoom.id)?.id === id))) {
      roomNote.appendChild(el('span', 'rv-stair-warning', ` ${STAIR_LIMIT_INTRO}`));
    }
  };

  const scrub = createScrubber({
    durationS: run.config.durationS,
    onTime: (t) => {
      view.setTime(t);
      drawCharts(t);
      showLive(t);
    },
    ...(opts.raf ? { raf: opts.raf } : {}),
    ...(opts.caf ? { caf: opts.caf } : {}),
  });
  left.insertBefore(scrub.el, view.el);
  left.appendChild(charts);
  drawCharts(0);
  showLive(0);

  // Stair limit (Requirement 5.9).
  if (stairFlagged.size > 0) {
    const s = el('div', 'rv-panel rv-stair-warning');
    const msg = run.fire.warnings.find((w) => w.code === 'STAIR_OR_SHAFT_LIMIT')?.message ?? '';
    s.appendChild(el('p', undefined, `${STAIR_LIMIT_INTRO} ${msg} Flagged here: ${[...stairFlagged].join(', ')}.`));
    right.appendChild(s);
  }

  // Downloads.
  const dl = el('div', 'rv-panel');
  dl.appendChild(el('h2', undefined, 'Save'));
  const name = slug(run.session.title);
  dl.append(
    button('Download JSON', () => download(`egress-${name}.json`, runToJson(run)), 'rv-btn'),
    button('Download summary (text)', () => download(`egress-${name}-summary.txt`, summaryText(run), 'text/plain'), 'rv-btn'),
    button('Download plan image (PNG)', () => downloadCanvasPng(view.canvas(), `egress-${name}-${Math.round(scrub.time())}s.png`), 'rv-btn'),
  );
  right.appendChild(dl);

  // Warnings (Requirement 5.7).
  const wbox = el('div', 'rv-panel');
  wbox.appendChild(el('h2', undefined, 'Warnings'));
  wbox.appendChild(renderWarningList([...run.fire.warnings, ...run.crowd.warnings]));
  right.appendChild(wbox);

  container.appendChild(root);
  return { destroy: () => scrub.destroy() };
}
