// One run drawn on its plan at a chosen time: floor tabs, smoke at eye height per room, people, the fire. Used by the
// results screen and twice by the compare screen (run-view spec, Requirements 5.2, 5.3, 6.2).
import type { CompartmentSeries } from '../../core/fire/types';
import type { RunResult } from '../run/pipeline';
import { SHOW_INCAPACITATED, SHOW_OUT } from '../run/trajectory';
import { button, el } from '../ui';
import {
  AGENT_FILL,
  AGENT_LABEL,
  atEyeHeight,
  canvasSizeFor,
  cellIndexAt,
  drawFloor,
  roomLabelsFor,
  sampleIndexAt,
  seriesLookup,
  SMOKE_FILL,
  SMOKE_LABEL,
  smokeBand,
  type AgentDot,
  type Geometry,
  type SmokeBand,
} from './planRenderer';

const SMOKE_ABOVE_HEAD = 'rgba(110, 110, 110, 0.14)'; // a smoke layer has formed but is still above eye height

export interface RunViewOptions {
  canvasMax: { w: number; h: number };
  onRoomClick?: (roomId: string) => void;
  showTabs?: boolean;
}

export interface RunView {
  el: HTMLElement;
  setTime(t: number): void;
  setFloor(floorId: string): void;
  floorId(): string;
  selectRoom(id: string | null): void;
  canvas(): HTMLCanvasElement;
}

const eventCache = new WeakMap<RunResult, { outAt: Float64Array; incAt: Float64Array }>();

/** Exit and incapacitation times per trajectory agent, from the crowd records (Infinity = never). The records are
 * the reference: the last recorded frame can be up to one frame before the run stopped. */
function eventsOf(run: RunResult): { outAt: Float64Array; incAt: Float64Array } {
  const hit = eventCache.get(run);
  if (hit) return hit;
  const by = new Map(run.crowd.agents.map((a) => [a.id, a]));
  const n = run.trajectory.n;
  const outAt = new Float64Array(n).fill(Infinity);
  const incAt = new Float64Array(n).fill(Infinity);
  run.trajectory.agentIds.forEach((id, i) => {
    const a = by.get(id);
    if (a?.exitTimeS != null) outAt[i] = a.exitTimeS;
    if (a?.incapacitatedTimeS != null) incAt[i] = a.incapacitatedTimeS;
  });
  const v = { outAt, incAt };
  eventCache.set(run, v);
  return v;
}

function showAt(run: RunResult, i: number, k: number, t: number): number {
  const e = eventsOf(run);
  if (t >= e.outAt[i]!) return SHOW_OUT;
  if (t >= e.incAt[i]!) return SHOW_INCAPACITATED;
  return run.trajectory.show[k * run.trajectory.n + i]!;
}

const frameAt = (run: RunResult, t: number): number => Math.min(run.trajectory.frames - 1, Math.max(0, Math.floor(t / run.trajectory.intervalS + 1e-9)));

/** People on screen at time t, from the recorded trajectory (frame at or before t). */
export function agentsAt(run: RunResult, floorIndex: number, t: number): AgentDot[] {
  const tr = run.trajectory;
  if (tr.frames === 0) return [];
  const k = frameAt(run, t);
  const o = k * tr.n;
  const out: AgentDot[] = [];
  for (let i = 0; i < tr.n; i++) if (tr.floor[o + i] === floorIndex) out.push({ xM: tr.x[o + i]!, yM: tr.y[o + i]!, show: showAt(run, i, k, t) });
  return out;
}

/** Counts of each display state at time t (all floors). */
export function stateCountsAt(run: RunResult, t: number): Record<number, number> {
  const tr = run.trajectory;
  const out: Record<number, number> = {};
  if (tr.frames === 0) return out;
  const k = frameAt(run, t);
  for (let i = 0; i < tr.n; i++) {
    const s = showAt(run, i, k, t);
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

export function fireSeries(run: RunResult): CompartmentSeries | undefined {
  return run.fire.compartments.find((c) => c.id === run.config.fireRoomId);
}

export function hrrFractionAt(run: RunResult, i: number): number {
  const c = fireSeries(run);
  const v = c?.burnedHrrW[0]?.values;
  if (!v || v.length === 0) return 0;
  let peak = 0;
  for (const x of v) peak = Math.max(peak, x);
  return peak > 0 ? v[Math.min(i, v.length - 1)]! / peak : 0;
}

export function createRunView(run: RunResult, opts: RunViewOptions): RunView {
  const model = run.session.result.model!;
  const stairIds = run.built.scenario.compartments.filter((c) => c.isStair).map((c) => c.id);
  const lookup = seriesLookup(run.fire, stairIds);
  const fireRoom = model.rooms.find((r) => r.id === run.config.fireRoomId);
  let floorId = fireRoom?.floorId ?? model.floors[0]!.floorId;
  let t = 0;
  let selected: string | null = null;
  let geo: Geometry | null = null;

  const root = el('div', 'rv-runview');
  const tabs = el('div', 'rv-tabs');
  const canvas = el('canvas', 'rv-plan');
  const legend = el('div', 'rv-legend-row');
  root.append(tabs, canvas, legend);

  const floorOf = () => run.session.planInput.floors.find((f) => f.id === floorId)!;
  const sizeCanvas = (): void => {
    const s = canvasSizeFor(floorOf(), opts.canvasMax.w, opts.canvasMax.h);
    canvas.width = s.w;
    canvas.height = s.h;
  };

  const renderTabs = (): void => {
    tabs.replaceChildren();
    if (model.floors.length < 2 || opts.showTabs === false) return;
    for (const f of model.floors) {
      const label = `${f.name || f.floorId}${fireRoom?.floorId === f.floorId ? ' (fire)' : ''}`;
      const b = button(label, () => setFloor(f.floorId), 'rv-tab');
      b.setAttribute('aria-pressed', String(f.floorId === floorId));
      tabs.appendChild(b);
    }
  };

  const draw = (): void => {
    const floor = floorOf();
    const i = sampleIndexAt(run.fire.timesS, t);
    const bands = new Map<string, string | undefined>();
    const fillOf = (id: string): string | undefined => {
      if (bands.has(id)) return bands.get(id);
      const c = lookup(id);
      let fill: string | undefined;
      if (c) {
        const eye = atEyeHeight(c, i);
        const band: SmokeBand = smokeBand(eye.visibilityM);
        if (band !== 'clear') fill = SMOKE_FILL[band];
        else if (c.upper.visibilityM[i]! < 10 && c.interfaceHeightM[i]! < c.interfaceHeightM[0]! - 0.05) fill = SMOKE_ABOVE_HEAD;
      }
      bands.set(id, fill);
      return fill;
    };
    const fi = run.built.plan.floors.findIndex((f) => f.id === floorId);
    geo = drawFloor(canvas, {
      floor,
      doors: model.doors.filter((d) => d.floorId === floorId),
      roomLabels: roomLabelsFor(model, floorId),
      fillOf,
      selectedRoomId: selected,
      fireSite: run.built.fireSite.floorId === floorId ? { xM: run.built.fireSite.xM, yM: run.built.fireSite.yM, size: hrrFractionAt(run, i) } : null,
      agents: agentsAt(run, fi, t),
    });
  };

  const renderLegend = (): void => {
    legend.replaceChildren();
    const item = (colour: string, text: string, round: boolean): HTMLElement => {
      const s = el('span', 'rv-key');
      const sw = el('i', round ? 'rv-swatch rv-swatch-round' : 'rv-swatch');
      sw.style.background = colour;
      s.append(sw, document.createTextNode(text));
      return s;
    };
    for (const [k, v] of Object.entries(AGENT_LABEL)) legend.appendChild(item(AGENT_FILL[Number(k)]!, v, true));
    legend.appendChild(item(SMOKE_ABOVE_HEAD, 'Smoke layer above head height', false));
    for (const b of ['light', 'dense', 'untenable'] as SmokeBand[]) legend.appendChild(item(SMOKE_FILL[b], SMOKE_LABEL[b] + ' at 1.6 m', false));
  };

  canvas.addEventListener('click', (ev) => {
    if (geo === null || !opts.onRoomClick) return;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? canvas.width / rect.width : 1;
    const sy = rect.height > 0 ? canvas.height / rect.height : 1;
    const c = cellIndexAt(floorOf(), geo, (ev.clientX - rect.left) * sx, (ev.clientY - rect.top) * sy);
    if (c === null) return;
    const room = model.rooms.find((r) => r.floorId === floorId && r.cells.includes(c));
    if (room) opts.onRoomClick(room.id);
  });

  const setFloor = (id: string): void => {
    floorId = id;
    sizeCanvas();
    renderTabs();
    draw();
  };

  sizeCanvas();
  renderTabs();
  renderLegend();
  draw();
  return {
    el: root,
    setTime(v) {
      t = v;
      draw();
    },
    setFloor,
    floorId: () => floorId,
    selectRoom(id) {
      selected = id;
      draw();
    },
    canvas: () => canvas,
  };
}
