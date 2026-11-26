// Timeline scrubber (run-view spec, Requirement 5.1): a range input over simulated time with play, pause and speed.
// Time is continuous; the screens turn it into a fire sample index (sampleIndexAt) and a position frame.

export const SPEEDS = [0.5, 1, 2, 5, 10] as const; // Requirement 5.1 names 0.5x to 5x; 10x added for long runs

export interface Scrubber {
  el: HTMLElement;
  setTime(t: number): void;
  time(): number;
  destroy(): void;
}

export interface ScrubberOptions {
  durationS: number;
  onTime: (t: number) => void;
  // Injected for tests; default requestAnimationFrame / cancelAnimationFrame / performance.now.
  raf?: (cb: (ms: number) => void) => number;
  caf?: (h: number) => void;
}

const fmt = (t: number): string => {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Advances `t` by a real-time delta at `speed`, clamped to the run. Pure, for the property test. */
export function advance(t: number, realDeltaMs: number, speed: number, durationS: number): number {
  return Math.min(durationS, Math.max(0, t + (Math.max(0, realDeltaMs) * speed) / 1000));
}

export function createScrubber(opts: ScrubberOptions): Scrubber {
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((h) => cancelAnimationFrame(h));
  const el = document.createElement('div');
  el.className = 'rv-scrubber';
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'rv-play';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = String(opts.durationS);
  range.step = '0.5';
  range.value = '0';
  range.setAttribute('aria-label', 'Time in the run');
  const label = document.createElement('span');
  label.className = 'rv-time';
  const speed = document.createElement('select');
  speed.setAttribute('aria-label', 'Playback speed');
  for (const s of SPEEDS) {
    const o = document.createElement('option');
    o.value = String(s);
    o.textContent = `${s}×`;
    if (s === 5) o.selected = true;
    speed.appendChild(o);
  }
  el.append(play, range, label, speed);

  let t = 0;
  let handle: number | null = null;
  let last: number | null = null;
  const show = (): void => {
    range.value = String(t);
    label.textContent = `${fmt(t)} / ${fmt(opts.durationS)}`;
    play.textContent = handle === null ? '▶ Play' : '❚❚ Pause';
  };
  const set = (v: number, notify = true): void => {
    t = Math.min(opts.durationS, Math.max(0, v));
    show();
    if (notify) opts.onTime(t);
  };
  const frame = (ms: number): void => {
    if (last !== null) set(advance(t, ms - last, Number(speed.value), opts.durationS));
    last = ms;
    if (t >= opts.durationS) {
      stop();
      return;
    }
    handle = raf(frame);
  };
  const stop = (): void => {
    if (handle !== null) caf(handle);
    handle = null;
    last = null;
    show();
  };
  play.addEventListener('click', () => {
    if (handle !== null) return stop();
    if (t >= opts.durationS) set(0);
    handle = raf(frame);
    show();
  });
  range.addEventListener('input', () => set(Number(range.value)));
  show();
  return { el, setTime: (v) => set(v, false), time: () => t, destroy: stop };
}
