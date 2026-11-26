// Setup screen (run-view spec, Requirement 2): where the fire starts and what burns, who is in the building, when the
// alarm sounds, which doors and windows are open. Clicking a room on the plan puts the fire there; clicking a door or
// window toggles it.
import { CELL_SIZE_M } from '../../core/people/constants';
import { buildPlan } from '../../core/people/plan/builder';
import type { Door } from '../../core/plan/types';
import { withOpenEdits, type PlanSession } from '../home/sampleConfigs';
import { createLibraryPicker } from '../library/libraryPicker';
import { SAFETY_NOTICE } from '../plan/importScreen';
import { canvasSizeFor, cellIndexAt, drawFloor, roomLabelsFor, type Geometry } from '../results/planRenderer';
import { button, el, labelled, numberInput } from '../ui';
import { DEFAULT_PRESET, PRESETS, presetCounts, type DensityPreset } from './densityPresets';
import { DEFAULT_ALARM_S, DEFAULT_DURATION_S, DEFAULT_SEED, problems, roomCentreM, type SetupState } from './scenarioBuilder';

export function defaultSetup(session: PlanSession): SetupState {
  return {
    fireRoomId: null,
    fireSiteM: null,
    fireChoice: null,
    preset: DEFAULT_PRESET,
    agentsByRoom: presetCounts(session.result.model!.rooms, DEFAULT_PRESET),
    entryExitId: null,
    alarmTimeS: DEFAULT_ALARM_S,
    durationS: DEFAULT_DURATION_S,
    openEdits: [],
    seed: DEFAULT_SEED,
  };
}

export interface SetupOptions {
  session: PlanSession;
  state: SetupState;
  onRun: (session: PlanSession, state: SetupState) => void;
  onBack: () => void;
  canvasMax?: { w: number; h: number };
}

/** The crowd plan's exits with the label of the exit door they come from (exit cells are the door's cells). */
export function exitOptions(session: PlanSession): { exitId: string; label: string }[] {
  const pr = buildPlan(session.planInput);
  if (pr.plan === null) return [];
  const plan = pr.plan;
  const model = session.result.model!;
  return plan.exits.map((e) => {
    const f = plan.floors[e.floorIndex]!;
    const cells = new Set(e.cells);
    const door = model.doors.find((d) => d.isExit && d.floorId === f.id && [...d.cells].some((c) => cells.has(c)));
    return { exitId: e.id, label: door ? doorLabel(session, door) : e.id };
  });
}

export function doorLabel(session: PlanSession, d: Door): string {
  const rooms = session.result.model!.rooms;
  const name = (id: string): string => (id === 'OUTSIDE' ? 'outside' : rooms.find((r) => r.id === id)?.name ?? id);
  const what = d.isWindow ? 'Window' : d.isExit ? 'Exit door' : 'Door';
  const a = name(d.roomIdA);
  const b = name(d.roomIdB);
  return `${what}, ${a === b ? a : `${a} – ${b}`} (${d.widthM.toFixed(1)} m)`;
}

/** The setOpen edits that turn `door` to `open`, replacing an earlier edit of the same door. */
export function toggleEdit(state: SetupState, d: Door, open: boolean): SetupState {
  const others = state.openEdits.filter((e) => !((e.kind === 'setDoorOpen' && e.doorId === d.id) || (e.kind === 'setWindowOpen' && e.windowId === d.id)));
  const edit = d.isWindow ? { kind: 'setWindowOpen' as const, windowId: d.id, open } : { kind: 'setDoorOpen' as const, doorId: d.id, open };
  return { ...state, openEdits: [...others, edit] };
}

export function createSetupScreen(container: HTMLElement, opts: SetupOptions): void {
  let session = opts.session;
  let state = opts.state;
  const model0 = session.result.model!;
  let floorId = state.fireRoomId ? model0.rooms.find((r) => r.id === state.fireRoomId)?.floorId ?? model0.floors[0]!.floorId : model0.floors[0]!.floorId;
  let shownErrors: string[] = [];
  const max = opts.canvasMax ?? { w: 640, h: 640 };

  const render = (): void => {
    const model = session.result.model!;
    container.replaceChildren();
    const root = el('section', 'rv-setup');
    const head = el('div', 'rv-head');
    head.append(button('← Home', opts.onBack, 'rv-btn rv-btn-link'), el('h1', undefined, `${session.title}: set up the fire`));
    root.appendChild(head);
    const cols = el('div', 'rv-cols');

    // Left: floor tabs + plan.
    const left = el('div', 'rv-col-plan');
    if (model.floors.length > 1) {
      const tabs = el('div', 'rv-tabs');
      for (const f of model.floors) {
        const t = button(f.floorId === floorId ? `● ${f.name || f.floorId}` : (f.name || f.floorId), () => {
          floorId = f.floorId;
          render();
        }, 'rv-tab');
        t.setAttribute('aria-pressed', String(f.floorId === floorId));
        tabs.appendChild(t);
      }
      left.appendChild(tabs);
    }
    const floor = session.planInput.floors.find((f) => f.id === floorId)!;
    const size = canvasSizeFor(floor, max.w, max.h);
    const canvas = el('canvas', 'rv-plan');
    canvas.width = size.w;
    canvas.height = size.h;
    canvas.setAttribute('data-floor', floorId);
    canvas.setAttribute('aria-label', `Plan of ${floorId}. Click a room to start the fire there; click a door or window to open or close it.`);
    const doors = model.doors.filter((d) => d.floorId === floorId);
    const fireRoom = state.fireRoomId ? model.rooms.find((r) => r.id === state.fireRoomId) : undefined;
    const g = model.grids[floorId]!;
    let geo: Geometry = drawFloor(canvas, {
      floor,
      doors,
      roomLabels: roomLabelsFor(model, floorId),
      selectedRoomId: fireRoom?.floorId === floorId ? fireRoom.id : null,
      fireSite: fireRoom && fireRoom.floorId === floorId ? { ...(state.fireSiteM ?? roomCentreM(fireRoom, g.widthCells)), size: 0.5 } : null,
    });
    canvas.addEventListener('click', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width > 0 ? canvas.width / rect.width : 1;
      const sy = rect.height > 0 ? canvas.height / rect.height : 1;
      const px = (ev.clientX - rect.left) * sx;
      const py = (ev.clientY - rect.top) * sy;
      const c = cellIndexAt(floor, geo, px, py);
      if (c === null) return;
      const w = floor.widthCells;
      const near = doors.find((d) => [...d.cells].some((k) => Math.abs((k % w) - (c % w)) <= 1 && Math.abs(Math.floor(k / w) - Math.floor(c / w)) <= 1));
      if (near) {
        setOpen(near, !near.open);
        return;
      }
      const room = model.rooms.find((r) => r.floorId === floorId && r.kind !== 'stair' && r.cells.includes(c));
      if (room && session.fire.compartments.some((k) => k.id === room.id)) {
        state = { ...state, fireRoomId: room.id, fireSiteM: { xM: ((c % w) + 0.5) * CELL_SIZE_M, yM: (Math.floor(c / w) + 0.5) * CELL_SIZE_M } };
        shownErrors = [];
        render();
      }
    });
    left.appendChild(canvas);
    const legend = el('p', 'rv-small rv-legend');
    legend.textContent = 'Green: exit. Light green: open door. Orange: closed door. Blue: window (light blue when open). Grey squares: stair.';
    left.appendChild(legend);
    cols.appendChild(left);

    // Right: configuration.
    const right = el('div', 'rv-col-panel');
    const fireBox = el('div', 'rv-panel');
    fireBox.appendChild(el('h2', undefined, '1. Fire'));
    fireBox.appendChild(el('p', fireRoom ? undefined : 'rv-hint', fireRoom ? `Starts in ${fireRoom.name} (${fireRoom.floorId}, ${fireRoom.areaM2.toFixed(0)} m²).` : 'Click a room on the plan to start the fire there.'));
    fireBox.appendChild(createLibraryPicker(state.fireChoice, (c) => {
      state = { ...state, fireChoice: c };
      shownErrors = [];
    }));
    right.appendChild(fireBox);

    const people = el('div', 'rv-panel');
    people.appendChild(el('h2', undefined, '2. People'));
    const preset = el('select');
    for (const p of PRESETS) {
      const o = el('option', undefined, p.label);
      o.value = p.id;
      preset.appendChild(o);
    }
    const custom = el('option', undefined, 'Custom (edit the table)');
    custom.value = 'custom';
    preset.appendChild(custom);
    preset.value = state.preset;
    preset.addEventListener('change', () => {
      if (preset.value === 'custom') state = { ...state, preset: 'custom' };
      else state = { ...state, preset: preset.value as DensityPreset, agentsByRoom: presetCounts(model.rooms, preset.value as DensityPreset) };
      render();
    });
    people.appendChild(labelled('Occupancy', preset));
    const note = PRESETS.find((p) => p.id === state.preset)?.note;
    if (note) people.appendChild(el('p', 'rv-small', note));
    const table = el('table', 'rv-table');
    const hr = el('tr');
    hr.append(el('th', undefined, 'Room'), el('th', undefined, 'Visitors'), el('th', undefined, 'Staff'));
    table.appendChild(hr);
    let total = 0;
    for (const r of model.rooms.filter((x) => x.floorId === floorId)) {
      const cnt = state.agentsByRoom[r.id] ?? { visitors: 0, staff: 0 };
      total += cnt.visitors + cnt.staff;
      const tr = el('tr');
      const setCount = (k: 'visitors' | 'staff', v: number): void => {
        const n = Math.max(0, Math.floor(Number.isFinite(v) ? v : 0));
        state = { ...state, preset: 'custom', agentsByRoom: { ...state.agentsByRoom, [r.id]: { ...cnt, [k]: n } } };
        render();
      };
      tr.append(el('td', undefined, `${r.name} (${r.areaM2.toFixed(0)} m²)`));
      const tv = el('td');
      tv.appendChild(numberInput(cnt.visitors, 0, 1, (v) => setCount('visitors', v)));
      const ts = el('td');
      ts.appendChild(numberInput(cnt.staff, 0, 1, (v) => setCount('staff', v)));
      tr.append(tv, ts);
      table.appendChild(tr);
    }
    people.appendChild(table);
    const all = Object.values(state.agentsByRoom).reduce((a, r) => a + r.visitors + r.staff, 0);
    people.appendChild(el('p', 'rv-small', `${total} people on this floor, ${all} in the building. Staff know every exit; visitors know the way they came in.`));
    const exits = exitOptions(session);
    if (exits.length > 1) {
      const entry = el('select');
      for (const x of exits) {
        const o = el('option', undefined, x.label);
        o.value = x.exitId;
        entry.appendChild(o);
      }
      entry.value = state.entryExitId ?? exits[0]!.exitId;
      entry.addEventListener('change', () => {
        state = { ...state, entryExitId: entry.value };
      });
      people.appendChild(labelled('Visitors came in by', entry));
    }
    right.appendChild(people);

    const timing = el('div', 'rv-panel');
    timing.appendChild(el('h2', undefined, '3. Timing'));
    timing.appendChild(labelled('Alarm sounds at (s)', numberInput(state.alarmTimeS, 0, 5, (v) => (state = { ...state, alarmTimeS: v }))));
    timing.appendChild(labelled('Run length (s)', numberInput(state.durationS, 10, 30, (v) => (state = { ...state, durationS: v }))));
    timing.appendChild(el('p', 'rv-small', 'Each person starts to leave a random pre-movement time after the alarm, or after smoke reaches their room if that comes first (median 35 s for visitors, 16 s for staff; seeded, so a run repeats exactly).'));
    right.appendChild(timing);

    const openings = el('div', 'rv-panel');
    openings.appendChild(el('h2', undefined, '4. Doors and windows'));
    const list = el('ul', 'rv-doors');
    for (const d of model.doors.filter((x) => x.floorId === floorId)) {
      const li = el('li');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = d.open;
      cb.setAttribute('data-door', d.id);
      cb.addEventListener('change', () => setOpen(d, cb.checked));
      const lab = el('label');
      lab.append(cb, document.createTextNode(` ${doorLabel(session, d)}: ${d.open ? 'open' : 'closed'}`));
      li.appendChild(lab);
      list.appendChild(li);
    }
    openings.appendChild(list);
    right.appendChild(openings);

    const run = el('div', 'rv-panel rv-run-panel');
    const errBox = el('div', 'rv-errors');
    errBox.setAttribute('role', 'alert');
    for (const e of shownErrors) errBox.appendChild(el('p', 'rv-error', e));
    const runBtn = button('Run simulation', () => {
      const p = problems(session, state);
      if (p.length > 0) {
        shownErrors = p.map((x) => x.message);
        render();
        return;
      }
      opts.onRun(session, state);
    }, 'rv-btn rv-btn-primary');
    runBtn.setAttribute('data-action', 'run');
    run.append(errBox, runBtn, el('p', 'rv-notice', SAFETY_NOTICE));
    right.appendChild(run);
    cols.appendChild(right);
    root.appendChild(cols);
    container.appendChild(root);
    geo = drawFloor(canvas, {
      floor,
      doors,
      roomLabels: roomLabelsFor(model, floorId),
      selectedRoomId: fireRoom?.floorId === floorId ? fireRoom.id : null,
      fireSite: fireRoom && fireRoom.floorId === floorId ? { ...(state.fireSiteM ?? roomCentreM(fireRoom, g.widthCells)), size: 0.5 } : null,
    });
  };

  const setOpen = (d: Door, open: boolean): void => {
    state = toggleEdit(state, d, open);
    session = withOpenEdits(session, state.openEdits);
    render();
  };

  render();
}
