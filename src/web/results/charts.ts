// Line charts on Canvas 2D (run-view spec, Requirement 5.5): people out over time, and room temperature and smoke
// interface height. A cursor marks the scrubber time. Draws nothing without a 2D context.
import type { CompartmentSeries } from '../../core/fire/types';
import type { AgentRecord } from '../../core/people/types';

export interface Line {
  label: string;
  colour: string;
  xs: ArrayLike<number>;
  ys: ArrayLike<number>;
  axis: 'left' | 'right';
  dashed?: boolean;
  step?: boolean;
}

export interface ChartSpec {
  title: string;
  xMax: number;
  left: { label: string; max: number };
  right?: { label: string; max: number };
  lines: Line[];
  cursorX?: number | null;
}

const PAD = { l: 44, r: 44, t: 22, b: 26 };

function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function drawChart(canvas: HTMLCanvasElement, spec: ChartSpec): void {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (ctx === null || typeof ctx.fillRect !== 'function') return;
  const W = canvas.width;
  const H = canvas.height;
  const pw = W - PAD.l - (spec.right ? PAD.r : 12);
  const ph = H - PAD.t - PAD.b;
  const lMax = niceMax(spec.left.max);
  const rMax = spec.right ? niceMax(spec.right.max) : 1;
  const xMax = Math.max(1, spec.xMax);
  const X = (x: number): number => PAD.l + (x / xMax) * pw;
  const Y = (y: number, axis: 'left' | 'right'): number => PAD.t + ph - (y / (axis === 'left' ? lMax : rMax)) * ph;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#1f2933';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillText(spec.title, PAD.l, 14);
  ctx.font = '11px system-ui, sans-serif';
  // Grid and axes.
  ctx.strokeStyle = '#e4e7eb';
  ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const y = PAD.t + (ph * k) / 4;
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(PAD.l + pw, y);
    ctx.stroke();
    ctx.fillStyle = '#52606d';
    ctx.textAlign = 'right';
    ctx.fillText(String(+(lMax * (1 - k / 4)).toFixed(1)), PAD.l - 4, y + 4);
    if (spec.right) {
      ctx.textAlign = 'left';
      ctx.fillText(String(+(rMax * (1 - k / 4)).toFixed(1)), PAD.l + pw + 4, y + 4);
    }
  }
  ctx.textAlign = 'center';
  for (let k = 0; k <= 5; k++) {
    const x = (xMax * k) / 5;
    ctx.fillText(`${Math.round(x)} s`, X(x), H - 8);
  }
  ctx.save();
  ctx.translate(11, PAD.t + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(spec.left.label, 0, 0);
  ctx.restore();
  if (spec.right) {
    ctx.save();
    ctx.translate(W - 6, PAD.t + ph / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(spec.right.label, 0, 0);
    ctx.restore();
  }
  // Lines.
  for (const l of spec.lines) {
    ctx.strokeStyle = l.colour;
    ctx.lineWidth = 2;
    ctx.setLineDash(l.dashed ? [5, 4] : []);
    ctx.beginPath();
    let prevY: number | null = null;
    for (let i = 0; i < l.xs.length; i++) {
      const x = X(l.xs[i]!);
      const y = Y(l.ys[i]!, l.axis);
      if (i === 0) ctx.moveTo(x, y);
      else {
        if (l.step && prevY !== null) ctx.lineTo(x, prevY);
        ctx.lineTo(x, y);
      }
      prevY = y;
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Legend.
  let lx = PAD.l + 8;
  const ly = PAD.t + 12;
  ctx.textAlign = 'left';
  for (const l of spec.lines) {
    ctx.strokeStyle = l.colour;
    ctx.setLineDash(l.dashed ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(lx, ly - 4);
    ctx.lineTo(lx + 16, ly - 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#1f2933';
    ctx.fillText(l.label, lx + 20, ly);
    lx += 28 + ctx.measureText(l.label).width;
  }
  // Cursor.
  if (spec.cursorX !== undefined && spec.cursorX !== null) {
    ctx.strokeStyle = '#2b6cb0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(spec.cursorX), PAD.t);
    ctx.lineTo(X(spec.cursorX), PAD.t + ph);
    ctx.stroke();
  }
}

/** Step series of a count over time from event times (null = never). */
export function cumulative(times: readonly (number | null)[], durationS: number): { xs: number[]; ys: number[] } {
  const ts = times.filter((t): t is number => t !== null).sort((a, b) => a - b);
  const xs = [0];
  const ys = [0];
  ts.forEach((t, i) => {
    xs.push(t);
    ys.push(i + 1);
  });
  xs.push(durationS);
  ys.push(ts.length);
  return { xs, ys };
}

export function peopleChart(agents: readonly AgentRecord[], durationS: number, cursor: number | null): ChartSpec {
  const out = cumulative(agents.map((a) => a.exitTimeS), durationS);
  const inc = cumulative(agents.map((a) => a.incapacitatedTimeS), durationS);
  return {
    title: 'People over time',
    xMax: durationS,
    left: { label: 'people', max: Math.max(1, agents.length) },
    lines: [
      { label: 'Out', colour: '#2f855a', xs: out.xs, ys: out.ys, axis: 'left', step: true },
      { label: 'Incapacitated', colour: '#c53030', xs: inc.xs, ys: inc.ys, axis: 'left', step: true },
    ],
    cursorX: cursor,
  };
}

export function roomChart(timesS: Float64Array, rooms: { name: string; series: CompartmentSeries; dashed: boolean }[], heightM: number, cursor: number | null): ChartSpec {
  const lines: Line[] = [];
  let tMax = 40;
  for (const r of rooms) {
    const c = Array.from(r.series.upperTempK, (k) => k - 273.15);
    tMax = Math.max(tMax, ...c);
    lines.push({ label: `${r.name} smoke °C`, colour: '#c05621', xs: timesS, ys: c, axis: 'left', dashed: r.dashed });
    lines.push({ label: `${r.name} smoke height m`, colour: '#2b6cb0', xs: timesS, ys: r.series.interfaceHeightM, axis: 'right', dashed: r.dashed });
  }
  return {
    title: 'Hot layer temperature and smoke interface height',
    xMax: timesS.length > 0 ? timesS[timesS.length - 1]! : 1,
    left: { label: '°C', max: tMax },
    right: { label: 'm above floor', max: heightM },
    lines,
    cursorX: cursor,
  };
}
