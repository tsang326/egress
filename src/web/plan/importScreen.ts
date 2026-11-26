// Import screen (Requirement 19): load DXF files, check layer roles and unit, review the grid, rooms, doors, exits and
// stairs, read the warnings and limits, then "Use this plan". Plain DOM and Canvas 2D, no framework (Req 19.11).
// The import itself runs in a worker through `PlanWorkerApi`; this file never calls importBuildingModel (Req 21.3).
// Every string that comes from a DXF file (layer, block and file names, warning text, room names) is written with
// `textContent` or an input's `value`, never as markup (Req 3.9, safety rules). Estimates are labelled as estimates
// (Req 19.13). Wording follows the safety rules: no verdict about a building (Req 19.14).
import { CELL_SIZE_M, CORRIDOR_LENGTH_LIMIT_M } from '../../core/people/constants';
import { CELL_STAIR, type PlanInput } from '../../core/people/types';
import type { Compartment, Vent } from '../../core/fire/types';
import { stairOrShaftLimit } from '../../core/fire/validate/warnings';
import {
  DEFAULT_FLOOR_TO_FLOOR_HEIGHT_M,
  DEFAULT_WALL_THICKNESS_M,
  DOOR_VENT_SILL_M,
  DOOR_VENT_SOFFIT_M,
  DOOR_WIDTH_MAX_M,
  DOOR_WIDTH_MIN_M,
  DXF_MAX_BYTES,
  GAP_TOLERANCE_M,
  NAME_LENGTH_MAX,
  WINDOW_VENT_SILL_M,
  WINDOW_VENT_SOFFIT_M,
} from '../../core/plan/constants';
import { LAYER_ROLES } from '../../core/plan/layers';
import { suggestExits } from '../../core/plan/model/exits';
import { saveProject } from '../../core/plan/project/save';
import type {
  BuildingModel,
  DrawingUnit,
  Edit,
  FloorSettings,
  FloorSourceSpec,
  ImportCounts,
  ImportResult,
  ImportSettings,
  ImportSource,
  ImportWarning,
  ImportWarningLocation,
  LayerMap,
  LayerRole,
  PendingQuestion,
} from '../../core/plan/types';
import { dxfTooLarge } from '../../core/plan/warnings';
import { defaultPlanWorkerApi, type PlanWorkerApi } from './planWorker';
import { extentInUnit, inspectDxf, looksLikeDxf, NOT_DXF_MESSAGE, SNIFF_BYTES, type Inspection } from './inspect';
import { createGridView, ROOM_KIND_LABELS, withoutLastEdit, type GridFloorData, type GridView } from './render/gridView';
import { drawPreview, ROLE_LABELS } from './render/preview';
import { clearLastProject, NOT_STORED_MESSAGE, readLastProject, saveLastProject } from './storage';
import boardingHouseDxf from '../../../public/samples/boarding-house.dxf?raw';
import cafeDxf from '../../../public/samples/cafe.dxf?raw';
import karaokeDxf from '../../../public/samples/karaoke.dxf?raw';
import './importScreen.css';

/** Required notice on every screen that holds results of the import (Req 19.12). */
export const SAFETY_NOTICE =
  'This is a simplified simulation for understanding risks. It does not replace a fire-safety review by the authorities or an engineer.';

/** Shown where a stair exists (Req 22.8). Text and source come from the fire model's own warning (Tech Ref 1.5). */
export const STAIR_LIMIT_INTRO = 'Stair and vertical shaft limit of the fire model.';

/** Largest number of warnings listed at once; the count of the rest is always shown. */
const WARNING_LIST_MAX = 200; // layout choice
const PREVIEW_W_PX = 520; // layout choices for the preview canvas
const PREVIEW_H_PX = 340;

/** What "Use this plan" hands on (Req 19.8): the crowd plan input and the fire geometry. */
export interface UsedPlan {
  planInput: PlanInput;
  fire: { compartments: Compartment[]; vents: Vent[] };
}

export interface ImportScreenOptions {
  /** The worker API. Tests inject a mock; the default runs the import in a Web Worker. */
  api?: PlanWorkerApi;
  /** Where the last project is stored. `null` means no storage. Default: the browser's localStorage. */
  storage?: Storage | null;
  /** Called when the user presses "Use this plan" (only possible when the import status is "ok"). */
  onUsePlan?: (plan: UsedPlan) => void;
}

export interface AddSourcesOptions {
  settings?: ImportSettings;
  /** Take the suggested layer roles as the confirmed roles (used for the samples; the user can still change them). */
  confirmSuggested?: boolean;
}

export interface ImportScreen {
  addSources(sources: readonly ImportSource[], opts?: AddSourcesOptions): Promise<void>;
  loadFiles(files: readonly File[]): Promise<void>;
  loadProjectText(text: string): Promise<void>;
  /** Resolves when no import or project load is running. */
  whenIdle(): Promise<void>;
  destroy(): void;
}

interface SampleSpec {
  label: string;
  fileName: string;
  text: string;
  floorBlocks?: string[];
}

// The three sample drawings are invented (their first lines say so). They are bundled as text, so no request is made.
const SAMPLES: readonly SampleSpec[] = [
  { label: 'Café, one floor (invented drawing)', fileName: 'cafe.dxf', text: cafeDxf },
  { label: 'Karaoke bar, one floor (invented drawing)', fileName: 'karaoke.dxf', text: karaokeDxf },
  { label: 'Boarding house, four floors (invented drawing)', fileName: 'boarding-house.dxf', text: boardingHouseDxf, floorBlocks: ['FLOOR1', 'FLOOR2', 'FLOOR3', 'FLOOR4'] },
];

interface Draft {
  roles: LayerMap;
  unit: DrawingUnit | 'file';
}

const UNITS: readonly DrawingUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];
const fmt1 = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : 'unknown');
const fmt2 = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : 'unknown');

/** Starting point of the settings: every map exists, so the screen can write into it. */
function emptySettings(): ImportSettings {
  return { layerMaps: {}, drawingUnits: {}, edits: [], exitDoorIds: [], stairRegions: [] };
}

function withDefaults(s: ImportSettings): ImportSettings {
  return { ...emptySettings(), ...s, layerMaps: { ...(s.layerMaps ?? {}) }, drawingUnits: { ...(s.drawingUnits ?? {}) } };
}

export function createImportScreen(container: HTMLElement, options: ImportScreenOptions = {}): ImportScreen {
  const doc = container.ownerDocument;
  const api = options.api ?? defaultPlanWorkerApi;

  // ---- state --------------------------------------------------------------------------------------------------
  let sources: ImportSource[] = [];
  let settings: ImportSettings = emptySettings();
  const inspections = new Map<string, Inspection | null>(); // null: the file could not be read
  const drafts = new Map<string, Draft>();
  let result: ImportResult | null = null;
  let currentFloorId: string | null = null;
  let used = false;
  let running = 0; // runs and loads in flight
  let runCounter = 0;
  let inflight: Promise<void> = Promise.resolve();
  const messages: string[] = []; // plain messages of the screen itself (not DXF text)
  let storageMessage: string | null = null;
  let restoreText: string | null = null;
  let loadErrors: ImportWarning[] = [];
  let destroyed = false;

  // ---- DOM helpers (textContent only) ---------------------------------------------------------------------------
  function mk<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = doc.createElement(tag);
    if (cls !== undefined) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
    const b = mk('button', undefined, label);
    b.type = 'button';
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  }
  function select(options: readonly (readonly [string, string])[], value: string, onChange: (v: string) => void): HTMLSelectElement {
    const s = mk('select');
    for (const [v, label] of options) {
      const o = mk('option', undefined, label);
      o.value = v;
      o.selected = v === value;
      s.appendChild(o);
    }
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }
  function numberInput(value: number, label: string, onCommit: (v: number) => void): HTMLInputElement {
    const i = mk('input');
    i.type = 'number';
    i.step = 'any';
    i.value = String(Number(value.toFixed(3)));
    i.setAttribute('aria-label', label);
    i.addEventListener('change', () => {
      const v = Number.parseFloat(i.value);
      if (Number.isFinite(v)) onCommit(v);
      else {
        messages.push(`"${label}" needs a number. The previous value is kept.`);
        renderAll();
      }
    });
    return i;
  }

  // ---- static frame ---------------------------------------------------------------------------------------------
  const root = mk('div', 'import-screen');
  const title = mk('h1', undefined, 'Egress: import a building plan');
  const intro = mk(
    'p',
    undefined,
    'Load one DXF drawing per floor (or one drawing with several floors). Check the layers, the unit, the rooms, the doors and the exits, then use the plan. Files stay in this browser.',
  );
  const restoreBox = mk('div', 'is-panel');
  const toolbar = mk('div', 'is-toolbar');
  const drop = mk('div', 'is-drop');
  const dropText = mk('span', undefined, 'Drop DXF files here, or ');
  const fileInput = mk('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.setAttribute('aria-label', 'Choose DXF files');
  drop.append(dropText, fileInput);
  const projectInput = mk('input');
  projectInput.type = 'file';
  projectInput.style.display = 'none';
  projectInput.setAttribute('aria-label', 'Choose a project file');
  const messageBox = mk('div');
  messageBox.setAttribute('role', 'status');
  const columns = mk('div', 'is-columns');
  const leftCol = mk('div');
  const rightCol = mk('div');
  const filesBox = mk('div');
  const sourcesBox = mk('div');
  const estimatesBox = mk('div', 'is-panel');
  const resultsBox = mk('div');
  const gridPanel = mk('div', 'is-panel');
  const gridTabs = mk('div', 'is-tabs');
  const gridHost = mk('div');
  const afterGridBox = mk('div');
  gridPanel.append(mk('h2', undefined, 'Floor grid'), gridTabs, gridHost);
  leftCol.append(filesBox, sourcesBox, estimatesBox);
  rightCol.append(resultsBox, gridPanel, afterGridBox);
  columns.append(leftCol, rightCol);
  root.append(title, intro, restoreBox, toolbar, projectInput, messageBox, columns);
  container.appendChild(root);

  const grid: GridView = createGridView(gridHost, {
    onEdit: (edit) => applyEdit(edit),
    onToggleExit: (doorId) => toggleExit(doorId),
    onToggleStairRegion: (floorId, roomId) => toggleStairRegion(floorId, roomId),
    onUndo: () => {
      settings = { ...settings, edits: withoutLastEdit(settings.edits ?? []) };
      void runImport();
    },
  });

  // Toolbar: samples, project buttons.
  const sampleLabel = mk('span', 'is-small', 'Samples (all invented, not real buildings):');
  const sampleButtons = SAMPLES.map((s) => button(s.label, () => void loadSample(s)));
  const saveBtn = button('Save project', () => downloadProject());
  const loadBtn = button('Load project', () => projectInput.click());
  const resetBtn = button('Start over', () => resetAll());
  toolbar.append(drop, sampleLabel, ...sampleButtons, saveBtn, loadBtn, resetBtn);

  // Events.
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    void track(loadFiles(files));
  });
  projectInput.addEventListener('change', () => {
    const f = projectInput.files?.[0];
    projectInput.value = '';
    if (f) void track(readText(f).then((t) => loadProjectText(t)));
  });
  drop.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    drop.classList.remove('is-over');
    const files = Array.from(ev.dataTransfer?.files ?? []);
    void track(loadFiles(files));
  });

  // ---- work tracking --------------------------------------------------------------------------------------------
  function track(p: Promise<void>): Promise<void> {
    running++;
    renderStatusOnly();
    const done = p.catch(() => undefined).then(() => {
      running--;
      if (!destroyed) renderAll();
    });
    const prev = inflight;
    inflight = Promise.all([prev, done]).then(() => undefined);
    return done;
  }

  async function readText(file: File): Promise<string> {
    return file.text();
  }

  // ---- loading --------------------------------------------------------------------------------------------------
  async function loadFiles(files: readonly File[]): Promise<void> {
    const accepted: ImportSource[] = [];
    messages.length = 0;
    loadErrors = [];
    for (const f of files) {
      if (f.size > DXF_MAX_BYTES) {
        loadErrors = [...loadErrors, dxfTooLarge(f.name, f.size)];
        continue;
      }
      let head = '';
      try {
        head = await f.slice(0, SNIFF_BYTES).text();
      } catch {
        head = '';
      }
      if (!looksLikeDxf(f.name, head)) {
        messages.push(`${f.name}: ${NOT_DXF_MESSAGE}`);
        continue;
      }
      try {
        accepted.push({ fileName: f.name, text: await readText(f) });
      } catch {
        messages.push(`${f.name}: the file could not be read.`);
      }
    }
    if (accepted.length > 0) await addSourcesInternal(accepted, {});
    else renderAll();
  }

  async function addSourcesInternal(added: readonly ImportSource[], opts: AddSourcesOptions): Promise<void> {
    const incoming = withDefaults(opts.settings ?? {});
    for (const src of added) {
      const idx = sources.findIndex((s) => s.fileName === src.fileName);
      if (idx >= 0) sources[idx] = src;
      else sources.push(src);
      const r = inspectDxf(src.fileName, src.text);
      inspections.set(src.fileName, r.ok ? r.inspection : null);
      if (!r.ok) {
        messages.push(`${src.fileName}: this file could not be read as a DXF drawing. The warnings below say why.`);
        continue;
      }
      const roles: LayerMap = {};
      for (const l of r.inspection.layers) roles[l.name] = l.suggestedRole;
      const given = incoming.layerMaps?.[src.fileName];
      if (given !== undefined) Object.assign(roles, given);
      const unit = incoming.drawingUnits?.[src.fileName] ?? (r.inspection.headerUnit !== null ? 'file' : r.inspection.suggestedUnit);
      drafts.set(src.fileName, { roles, unit });
      if (opts.confirmSuggested === true || given !== undefined) (settings.layerMaps as Record<string, LayerMap>)[src.fileName] = { ...roles };
      if (incoming.drawingUnits?.[src.fileName] !== undefined) (settings.drawingUnits as Record<string, DrawingUnit>)[src.fileName] = incoming.drawingUnits[src.fileName] as DrawingUnit;
    }
    // Only what the caller gave replaces current settings (the maps were merged above).
    const { layerMaps: _l, drawingUnits: _d, ...given } = opts.settings ?? {};
    void _l;
    void _d;
    settings = { ...settings, ...given };
    used = false;
    await runIfReady();
  }

  async function loadSample(s: SampleSpec): Promise<void> {
    resetState();
    const preset: ImportSettings = {};
    if (s.floorBlocks !== undefined) {
      preset.floorSources = s.floorBlocks.map((b, i): FloorSourceSpec => ({ floorId: `floor${i + 1}`, fileName: s.fileName, blockName: b }));
    }
    await track(addSourcesInternal([{ fileName: s.fileName, text: s.text }], { settings: preset, confirmSuggested: true }));
  }

  async function loadProjectText(text: string): Promise<void> {
    messages.length = 0;
    const my = ++runCounter;
    const r = await api.loadProjectInWorker(text);
    if (my !== runCounter) return;
    if (r.status === 'invalid') {
      loadErrors = r.errors; // the current project stays as it was (Req 16.5)
      messages.push('The project file was not loaded. The current project is unchanged.');
      return;
    }
    loadErrors = [];
    resetState();
    sources = r.sources.map((s) => ({ ...s }));
    settings = withDefaults(r.settings);
    for (const src of sources) {
      const ins = inspectDxf(src.fileName, src.text);
      inspections.set(src.fileName, ins.ok ? ins.inspection : null);
      if (!ins.ok) continue;
      const roles: LayerMap = {};
      for (const l of ins.inspection.layers) roles[l.name] = l.suggestedRole;
      Object.assign(roles, settings.layerMaps?.[src.fileName] ?? {});
      drafts.set(src.fileName, { roles, unit: settings.drawingUnits?.[src.fileName] ?? (ins.inspection.headerUnit !== null ? 'file' : ins.inspection.suggestedUnit) });
    }
    result = r.result;
    afterResult();
    persist();
  }

  function resetState(): void {
    sources = [];
    settings = emptySettings();
    inspections.clear();
    drafts.clear();
    result = null;
    currentFloorId = null;
    used = false;
    messages.length = 0;
    loadErrors = [];
    runCounter++;
  }

  function resetAll(): void {
    resetState();
    renderAll();
  }

  // ---- import ---------------------------------------------------------------------------------------------------
  function isConfirmed(fileName: string): boolean {
    return Object.hasOwn(settings.layerMaps ?? {}, fileName);
  }
  function ready(): boolean {
    return sources.length > 0 && sources.every((s) => inspections.get(s.fileName) === null || isConfirmed(s.fileName));
  }

  async function runIfReady(): Promise<void> {
    if (ready()) await runImport();
    else {
      result = null;
      renderAll();
    }
  }

  function cloneSettings(): ImportSettings {
    return structuredClone(settings);
  }

  async function runImport(): Promise<void> {
    if (!ready()) {
      result = null;
      renderAll();
      return;
    }
    const my = ++runCounter;
    const p = (async () => {
      const r = await api.importInWorker(sources.map((s) => ({ ...s })), cloneSettings());
      if (my !== runCounter || destroyed) return;
      result = r;
      used = false;
      afterResult();
      persist();
    })();
    await track(p);
  }

  function afterResult(): void {
    const floors = result?.model?.floors ?? [];
    if (floors.length > 0 && !floors.some((f) => f.floorId === currentFloorId)) currentFloorId = (floors[0] as FloorSettings).floorId;
    if (floors.length === 0) currentFloorId = null;
  }

  function persist(): void {
    if (sources.length === 0) return;
    const out = saveLastProject(projectText(), options.storage);
    storageMessage = out.ok ? null : out.message;
  }

  function projectText(): string {
    return saveProject({ sources, settings, model: result?.model ?? null });
  }

  function downloadProject(): void {
    if (sources.length === 0) {
      messages.push('There is nothing to save yet. Load a drawing first.');
      renderAll();
      return;
    }
    try {
      const blob = new Blob([projectText()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = mk('a');
      a.href = url;
      a.download = 'egress-project.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      messages.push('The project file could not be created for download.');
      renderAll();
    }
  }

  // ---- edits from the grid view and the controls ----------------------------------------------------------------
  function applyEdit(edit: Edit): void {
    settings = { ...settings, edits: [...(settings.edits ?? []), edit] };
    void runImport();
  }

  function toggleExit(doorId: string): void {
    const ids = settings.exitDoorIds ?? [];
    settings = { ...settings, exitDoorIds: ids.includes(doorId) ? ids.filter((d) => d !== doorId) : [...ids, doorId] };
    void runImport();
  }

  function toggleStairRegion(floorId: string, roomId: string): void {
    const room = result?.model?.rooms.find((r) => r.id === roomId);
    if (room === undefined) return;
    const same = (cells: Int32Array): boolean => cells.length === room.cells.length && cells.every((c, i) => c === room.cells[i]);
    const regions = settings.stairRegions ?? [];
    const has = regions.some((r) => r.floorId === floorId && same(r.cells));
    settings = {
      ...settings,
      stairRegions: has
        ? regions.filter((r) => !(r.floorId === floorId && same(r.cells)))
        : [...regions, { floorId, cells: Int32Array.from(room.cells) }],
    };
    void runImport();
  }

  function setFloorSettings(next: FloorSettings[]): void {
    settings = { ...settings, floorSettings: next };
    void runImport();
  }

  function setFloorField(floorId: string, patch: Partial<FloorSettings>): void {
    const floors = result?.model?.floors ?? [];
    setFloorSettings(floors.map((f) => (f.floorId === floorId ? { ...f, ...patch } : { ...f })));
  }

  function moveFloor(index: number, delta: -1 | 1): void {
    const floors = (result?.model?.floors ?? []).map((f) => ({ ...f }));
    const j = index + delta;
    if (j < 0 || j >= floors.length) return;
    const a = floors[index] as FloorSettings;
    floors[index] = floors[j] as FloorSettings;
    floors[j] = a;
    // The importer orders floors by elevation, so a new order needs new elevations: the lowest stays, the others stack.
    let e = Math.min(...floors.map((f) => f.elevationM));
    for (const f of floors) {
      f.elevationM = e;
      e += f.ceilingHeightM;
    }
    setFloorSettings(floors);
  }

  function setFloorOffset(floorId: string, axis: 'xM' | 'yM', v: number): void {
    const cur = settings.floorOffsetsM?.[floorId] ?? { xM: 0, yM: 0 };
    settings = { ...settings, floorOffsetsM: { ...(settings.floorOffsetsM ?? {}), [floorId]: { ...cur, [axis]: v } } };
    void runImport();
  }

  function confirmFile(fileName: string): void {
    const d = drafts.get(fileName);
    if (d === undefined) return;
    (settings.layerMaps as Record<string, LayerMap>)[fileName] = { ...d.roles };
    const units = settings.drawingUnits as Record<string, DrawingUnit>;
    if (d.unit === 'file') delete units[fileName];
    else units[fileName] = d.unit;
    void runIfReady();
  }

  /** A change to a confirmed file's roles or unit applies at once; before the confirmation it only changes the draft. */
  function draftChanged(fileName: string): void {
    if (isConfirmed(fileName)) confirmFile(fileName);
    else renderAll();
  }

  function removeFile(fileName: string): void {
    sources = sources.filter((s) => s.fileName !== fileName);
    inspections.delete(fileName);
    drafts.delete(fileName);
    delete (settings.layerMaps as Record<string, LayerMap>)[fileName];
    delete (settings.drawingUnits as Record<string, DrawingUnit>)[fileName];
    const fs = (settings.floorSources ?? []).filter((f) => f.fileName !== fileName);
    const { floorSources: _fs, ...rest } = settings;
    void _fs;
    settings = fs.length > 0 ? { ...rest, floorSources: fs } : rest;
    if (sources.length === 0) result = null;
    void runIfReady();
  }

  function setFloorSources(specs: FloorSourceSpec[]): void {
    const { floorSources: _fs, ...rest } = settings;
    void _fs;
    settings = specs.length > 0 ? { ...rest, floorSources: specs } : rest;
    // New sources mean new floors: drop floor-bound settings that no longer apply.
    const { floorSettings: _fl, floorOffsetsM: _fo, ...rest2 } = settings;
    void _fl;
    void _fo;
    settings = rest2;
    void runIfReady();
  }

  // ---- jump to a warning location ---------------------------------------------------------------------------------
  const GRID_KINDS: readonly ImportWarningLocation['kind'][] = ['floor', 'room', 'door', 'cell', 'vent'];
  function canJump(loc: ImportWarningLocation | undefined): loc is ImportWarningLocation {
    return loc !== undefined && GRID_KINDS.includes(loc.kind) && loc.floorId !== undefined && (result?.model?.floors.some((f) => f.floorId === loc.floorId) ?? false);
  }
  function jumpTo(loc: ImportWarningLocation): void {
    if (loc.floorId !== undefined) currentFloorId = loc.floorId; // highlight works on the shown floor only
    renderGrid();
    grid.highlight(loc);
    gridPanel.scrollIntoView?.({ block: 'nearest' });
  }

  // ---- rendering ------------------------------------------------------------------------------------------------
  function renderAll(): void {
    if (destroyed) return;
    renderRestore();
    renderMessages();
    renderFiles();
    renderSources();
    renderEstimates();
    renderResults();
    renderGrid();
    renderAfterGrid();
    saveBtn.disabled = sources.length === 0;
  }

  function renderStatusOnly(): void {
    if (destroyed) return;
    renderResults();
  }

  function renderRestore(): void {
    restoreBox.replaceChildren();
    if (restoreText === null) {
      restoreBox.style.display = 'none';
      return;
    }
    restoreBox.style.display = '';
    restoreBox.append(
      mk('p', undefined, 'A project from your last visit is stored in this browser. Do you want to restore it?'),
      button('Restore it', () => {
        const t = restoreText;
        restoreText = null;
        if (t !== null) void track(loadProjectText(t));
        renderAll();
      }),
      button('Discard it', () => {
        restoreText = null;
        clearLastProject(options.storage);
        renderAll();
      }),
    );
  }

  function renderMessages(): void {
    messageBox.replaceChildren();
    const lines: string[] = [...messages];
    if (storageMessage !== null) lines.push(storageMessage);
    for (const l of lines) messageBox.appendChild(mk('p', 'is-notice', l));
    if (loadErrors.length > 0) messageBox.appendChild(warningList(loadErrors, false));
  }

  function renderFiles(): void {
    filesBox.replaceChildren();
    for (const src of sources) {
      const ins = inspections.get(src.fileName) ?? null;
      const panel = mk('div', 'is-panel');
      panel.appendChild(mk('h2', undefined, src.fileName));
      const row = mk('div', 'is-row');
      row.appendChild(button('Remove this file', () => removeFile(src.fileName)));
      panel.appendChild(row);
      if (ins === null) {
        panel.appendChild(mk('p', undefined, 'This file could not be read as a DXF drawing. See the warnings.'));
        filesBox.appendChild(panel);
        continue;
      }
      const draft = drafts.get(src.fileName) as Draft;
      const confirmed = isConfirmed(src.fileName);

      // Unit question (Req 2.2, 2.6, 19.6) with the drawing size in metres.
      const unitOptions: [string, string][] = [];
      if (ins.headerUnit !== null) unitOptions.push(['file', `As stated in the file (${ins.headerUnit})`]);
      for (const u of UNITS) unitOptions.push([u, ins.headerUnit === null && u === ins.suggestedUnit ? `${u} (suggested)` : u]);
      const unitRow = mk('div', 'is-row');
      const unitLabel = mk('label', undefined, 'Drawing unit ');
      unitLabel.appendChild(
        select(unitOptions, draft.unit, (v) => {
          draft.unit = v === 'file' ? 'file' : (v as DrawingUnit);
          draftChanged(src.fileName);
        }),
      );
      unitRow.appendChild(unitLabel);
      panel.appendChild(unitRow);
      const effective: DrawingUnit = draft.unit === 'file' ? (ins.headerUnit ?? ins.suggestedUnit) : draft.unit;
      const ext = extentInUnit(ins.entities, effective);
      panel.appendChild(
        mk(
          'p',
          'is-small',
          (ins.headerUnit === null ? 'This file does not state its unit. Choose the unit it was drawn in. ' : '') +
            (ext === null
              ? 'The drawing has no lines to measure.'
              : `At ${effective} the drawing is ${fmt1(ext.widthM)} m wide and ${fmt1(ext.depthM)} m deep. Check that this fits the building.`),
        ),
      );

      // Layer-role table (Req 19.2).
      const table = mk('table');
      const head = mk('tr');
      for (const t of ['Layer', 'Entities', 'Suggested role', 'Role']) head.appendChild(mk('th', undefined, t));
      table.appendChild(head);
      for (const layer of ins.layers) {
        const tr = mk('tr');
        tr.appendChild(mk('td', undefined, layer.name));
        tr.appendChild(mk('td', undefined, String(layer.entityCount)));
        tr.appendChild(mk('td', undefined, `${ROLE_LABELS[layer.suggestedRole]} (suggestion)`));
        const td = mk('td');
        td.appendChild(
          select(
            LAYER_ROLES.map((r): [string, string] => [r, ROLE_LABELS[r]]),
            draft.roles[layer.name] ?? layer.suggestedRole,
            (v) => {
              draft.roles[layer.name] = v as LayerRole;
              draftChanged(src.fileName);
            },
          ),
        );
        tr.appendChild(td);
        table.appendChild(tr);
      }
      panel.appendChild(table);
      const confirmRow = mk('div', 'is-row');
      confirmRow.appendChild(button(confirmed ? 'Apply roles and unit again' : 'Confirm roles and unit', () => confirmFile(src.fileName)));
      if (!confirmed) confirmRow.appendChild(mk('span', 'is-small', 'The plan is built after you confirm.'));
      panel.appendChild(confirmRow);

      // Preview (Req 19.3).
      const canvas = mk('canvas');
      canvas.width = PREVIEW_W_PX;
      canvas.height = PREVIEW_H_PX;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Preview of ${src.fileName}, layers coloured by role`);
      panel.appendChild(canvas);
      drawPreview(canvas, ins.entities, draft.roles, { hasUnconfirmed: false });
      filesBox.appendChild(panel);
    }
  }

  /** Layer or block assignment for a single file that holds several floors (Req 4.2). */
  function renderSources(): void {
    sourcesBox.replaceChildren();
    if (sources.length !== 1) return;
    const file = sources[0] as ImportSource;
    const ins = inspections.get(file.fileName) ?? null;
    if (ins === null) return;
    const specs = settings.floorSources ?? [];
    const panel = mk('div', 'is-panel');
    panel.appendChild(mk('h2', undefined, 'Several floors in this one file'));
    panel.appendChild(
      mk('p', 'is-small', specs.length === 0 ? 'By default the whole file is one floor. Add a floor for each block or each set of layers that holds one floor.' : 'Each row is one floor. A floor is a block, or a set of layers.'),
    );
    specs.forEach((spec, i) => {
      const row = mk('div', 'is-row');
      row.appendChild(mk('span', undefined, `Floor ${i + 1}:`));
      const mode = spec.blockName !== undefined ? 'block' : 'layers';
      row.appendChild(
        select([['block', 'Block'], ['layers', 'Layers']], mode, (v) => {
          const next = specs.map((s) => ({ ...s }));
          const base: FloorSourceSpec = { floorId: spec.floorId, fileName: spec.fileName };
          next[i] = v === 'block' ? { ...base, blockName: ins.blockNames[0] ?? '' } : { ...base, layers: ins.layers[0] ? [ins.layers[0].name] : [] };
          setFloorSources(next);
        }),
      );
      if (mode === 'block') {
        row.appendChild(
          select(ins.blockNames.map((b): [string, string] => [b, b]), spec.blockName ?? '', (v) => {
            const next = specs.map((s) => ({ ...s }));
            next[i] = { floorId: spec.floorId, fileName: spec.fileName, blockName: v };
            setFloorSources(next);
          }),
        );
      } else {
        const sel = mk('select');
        sel.multiple = true;
        sel.size = Math.min(4, Math.max(2, ins.layers.length));
        sel.setAttribute('aria-label', `Layers of floor ${i + 1}`);
        for (const l of ins.layers) {
          const o = mk('option', undefined, l.name);
          o.value = l.name;
          o.selected = (spec.layers ?? []).includes(l.name);
          sel.appendChild(o);
        }
        sel.addEventListener('change', () => {
          const chosen = Array.from(sel.selectedOptions).map((o) => o.value);
          const next = specs.map((s) => ({ ...s }));
          next[i] = { floorId: spec.floorId, fileName: spec.fileName, layers: chosen };
          setFloorSources(next);
        });
        row.appendChild(sel);
      }
      row.appendChild(button('Remove floor', () => setFloorSources(specs.filter((_, k) => k !== i))));
      panel.appendChild(row);
    });
    const addRow = mk('div', 'is-row');
    addRow.appendChild(
      button('Add a floor', () => {
        const n = specs.length + 1;
        const spec: FloorSourceSpec =
          ins.blockNames.length > 0
            ? { floorId: `floor${n}`, fileName: file.fileName, blockName: ins.blockNames[0] as string }
            : { floorId: `floor${n}`, fileName: file.fileName, layers: ins.layers[0] ? [ins.layers[0].name] : [] };
        setFloorSources([...specs, spec]);
      }),
    );
    if (specs.length > 0) addRow.appendChild(button('Back to one floor', () => setFloorSources([])));
    panel.appendChild(addRow);
    sourcesBox.appendChild(panel);
  }

  function renderEstimates(): void {
    estimatesBox.replaceChildren();
    estimatesBox.appendChild(mk('h2', undefined, 'Values the import estimates'));
    estimatesBox.appendChild(
      mk('p', 'is-small', 'No source gives these for your building, so they are estimates. Wall, floor and ceiling surfaces also use estimate materials until you choose others.'),
    );
    const list = mk('ul');
    const items: string[] = [
      `Wall thickness of a single drawn line: ${fmt2(DEFAULT_WALL_THICKNESS_M)} m (estimate)`,
      `Gap in a wall closed up to: ${fmt2(GAP_TOLERANCE_M)} m (estimate)`,
      `Floor-to-floor height when you do not set one: ${fmt1(DEFAULT_FLOOR_TO_FLOOR_HEIGHT_M)} m (estimate)`,
      `Door opening: from ${fmt1(DOOR_VENT_SILL_M)} m to ${fmt1(DOOR_VENT_SOFFIT_M)} m above the floor (estimate)`,
      `Window opening: from ${fmt1(WINDOW_VENT_SILL_M)} m to ${fmt1(WINDOW_VENT_SOFFIT_M)} m above the floor (estimate)`,
      `Doors outside ${fmt1(DOOR_WIDTH_MIN_M)} to ${fmt1(DOOR_WIDTH_MAX_M)} m wide are flagged (estimate)`,
    ];
    for (const t of items) list.appendChild(mk('li', undefined, t));
    estimatesBox.appendChild(list);
  }

  function warningList(ws: readonly ImportWarning[], withJump: boolean): HTMLElement {
    const ul = mk('ul', 'is-warnings');
    const sorted = [...ws].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
    for (const w of sorted.slice(0, WARNING_LIST_MAX)) {
      const li = mk('li');
      li.appendChild(mk('span', `is-sev is-sev-${w.severity}`, w.severity === 'error' ? 'Problem' : 'Check'));
      li.appendChild(mk('span', 'is-msg', w.message));
      if (withJump && canJump(w.location)) {
        const loc = w.location;
        li.appendChild(button('Show location', () => jumpTo(loc)));
      }
      ul.appendChild(li);
    }
    if (sorted.length > WARNING_LIST_MAX) ul.appendChild(mk('li', undefined, `${sorted.length - WARNING_LIST_MAX} more are not listed here.`));
    return ul;
  }

  function pendingText(q: PendingQuestion): string {
    return q.kind === 'DRAWING_UNIT'
      ? `Choose the drawing unit of ${q.fileName}.`
      : `Confirm the role of each layer in ${q.fileName} (${q.layerNames.length} not confirmed yet).`;
  }

  function limitsTable(counts: ImportCounts): HTMLElement {
    const table = mk('table');
    const head = mk('tr');
    for (const t of ['Count', 'Used', 'Limit', 'Set by']) head.appendChild(mk('th', undefined, t));
    table.appendChild(head);
    const add = (name: string, count: number, limit: number, exceeded: boolean, by: string): void => {
      const tr = mk('tr');
      tr.appendChild(mk('td', undefined, name));
      tr.appendChild(mk('td', exceeded ? 'is-over-limit' : undefined, exceeded ? `${count} (over the limit)` : String(count)));
      tr.appendChild(mk('td', undefined, String(limit)));
      tr.appendChild(mk('td', undefined, by));
      table.appendChild(tr);
    };
    add('Floors', counts.floors.count, counts.floors.limit, counts.floors.exceeded, 'fire model');
    add('Rooms and stair compartments', counts.compartments.count, counts.compartments.limit, counts.compartments.exceeded, 'fire model');
    add('Vents (doors, open windows, roof openings)', counts.vents.count, counts.vents.limit, counts.vents.exceeded, 'fire model');
    for (const c of counts.cellsPerFloor) {
      add(`Grid cells, floor ${c.floorId} (${c.widthCells} by ${c.heightCells})`, c.count, c.limit, c.exceeded, 'crowd model');
    }
    return table;
  }

  function floorName(model: BuildingModel, floorId: string): string {
    return model.floors.find((f) => f.floorId === floorId)?.name ?? floorId;
  }

  function renderResults(): void {
    resultsBox.replaceChildren();
    const panel = mk('div', 'is-panel');
    panel.appendChild(mk('h2', undefined, 'Import result'));
    if (running > 0) panel.appendChild(mk('p', undefined, 'Working on it…'));
    if (result === null) {
      panel.appendChild(
        mk(
          'p',
          undefined,
          sources.length === 0
            ? 'Load a DXF drawing or open a sample to begin.'
            : 'Check the unit and the layer roles on the left, then press "Confirm roles and unit". The plan is built after that.',
        ),
      );
      resultsBox.appendChild(panel);
      return;
    }
    const r = result;
    const errors = r.warnings.filter((w) => w.severity === 'error').length;
    // Required notice on every screen with results (Req 19.12).
    const notice = mk('p', 'is-notice', SAFETY_NOTICE);
    notice.setAttribute('data-testid', 'safety-notice');
    panel.appendChild(notice);
    panel.appendChild(
      mk(
        'p',
        undefined,
        r.status === 'ok'
          ? `The plan was built. ${r.warnings.length === 0 ? 'No warnings.' : `${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'} to read below.`}`
          : `The plan cannot be used yet. ${errors} problem${errors === 1 ? '' : 's'} to fix, listed below.`,
      ),
    );
    for (const q of r.pendingQuestions) panel.appendChild(mk('p', undefined, pendingText(q)));
    if (r.warnings.length > 0) {
      panel.appendChild(mk('h3', undefined, 'Warnings'));
      panel.appendChild(warningList(r.warnings, true));
    }
    if (r.counts !== undefined) {
      panel.appendChild(mk('h3', undefined, 'Limits'));
      panel.appendChild(limitsTable(r.counts));
    }
    resultsBox.appendChild(panel);
  }

  function gridData(model: BuildingModel, floorId: string): GridFloorData | null {
    const g = model.grids[floorId];
    if (g === undefined) return null;
    const stairCells = new Set<number>();
    for (let i = 0; i < g.cellType.length; i++) if (g.cellType[i] === CELL_STAIR) stairCells.add(i);
    return {
      floorId,
      widthCells: g.widthCells,
      heightCells: g.heightCells,
      cellType: g.cellType,
      rooms: model.rooms.filter((rm) => rm.floorId === floorId),
      doors: model.doors.filter((d) => d.floorId === floorId),
      stairCells,
    };
  }

  function renderGrid(): void {
    gridTabs.replaceChildren();
    const model = result?.model ?? null;
    gridPanel.style.display = model === null ? 'none' : '';
    if (model === null) return;
    for (const f of model.floors) {
      const b = button(f.name, () => {
        currentFloorId = f.floorId;
        renderGrid();
      });
      b.setAttribute('aria-pressed', String(f.floorId === currentFloorId));
      gridTabs.appendChild(b);
    }
    const data = currentFloorId === null ? null : gridData(model, currentFloorId);
    if (data !== null) grid.update(data);
  }

  function renderAfterGrid(): void {
    afterGridBox.replaceChildren();
    const r = result;
    if (r === null || r.model === null) return;
    const model = r.model;

    afterGridBox.appendChild(exitsPanel(model));
    afterGridBox.appendChild(floorsPanel(model));
    const limits = lessReliablePanel(model);
    if (limits !== null) afterGridBox.appendChild(limits);

    const usePanel = mk('div', 'is-panel');
    const note = mk('p', 'is-notice', SAFETY_NOTICE);
    note.setAttribute('data-testid', 'safety-notice');
    usePanel.appendChild(note);
    const ok = r.status === 'ok' && r.derived !== undefined;
    const useBtn = button('Use this plan', () => {
      if (r.derived === undefined || r.status !== 'ok') return;
      used = true;
      options.onUsePlan?.({ planInput: r.derived.planInput, fire: r.derived.fire });
      renderAfterGrid();
    }, !ok);
    usePanel.appendChild(useBtn);
    if (!ok) usePanel.appendChild(mk('p', 'is-small', 'This button works once the plan has no problems.'));
    afterGridBox.appendChild(usePanel);
    if (used && r.derived !== undefined) afterGridBox.appendChild(summaryPanel(model, r.derived));
  }

  function exitsPanel(model: BuildingModel): HTMLElement {
    const panel = mk('div', 'is-panel');
    panel.appendChild(mk('h2', undefined, 'Exits'));
    const exits = model.doors.filter((d) => d.isExit);
    panel.appendChild(
      mk(
        'p',
        undefined,
        exits.length === 0
          ? 'No exit is marked. With the "Mark exit" tool, click a door that leads outside.'
          : `${exits.length} exit${exits.length === 1 ? '' : 's'} marked. Use the "Mark exit" tool to add or remove one.`,
      ),
    );
    const suggested = suggestExits(model.doors, model.floors);
    if (exits.length === 0 && suggested.length > 0) {
      panel.appendChild(mk('p', 'is-small', `Suggestion: the ${suggested.length} outside-facing door${suggested.length === 1 ? '' : 's'} on the lowest floor. This is a suggestion until you confirm it.`));
      panel.appendChild(
        button('Mark the suggested exits', () => {
          settings = { ...settings, exitDoorIds: suggested };
          void runImport();
        }),
      );
    }
    return panel;
  }

  function floorsPanel(model: BuildingModel): HTMLElement {
    const panel = mk('div', 'is-panel');
    panel.appendChild(mk('h2', undefined, 'Floors'));
    panel.appendChild(
      mk('p', 'is-small', 'Floors are listed from the lowest. Elevation and ceiling height are estimates (3 m per floor) until you change them. Offset moves a floor drawing in metres so the stairs line up.'),
    );
    const table = mk('table');
    const head = mk('tr');
    for (const t of ['Order', 'Name', 'Elevation (m)', 'Ceiling height (m)', 'Offset x, y (m)']) head.appendChild(mk('th', undefined, t));
    table.appendChild(head);
    const own = new Set((settings.floorSettings ?? []).map((f) => f.floorId));
    model.floors.forEach((f, i) => {
      const tr = mk('tr');
      const order = mk('td');
      order.append(button('Up', () => moveFloor(i, -1), i === 0), button('Down', () => moveFloor(i, 1), i === model.floors.length - 1));
      const nameTd = mk('td');
      const name = mk('input');
      name.type = 'text';
      name.maxLength = NAME_LENGTH_MAX;
      name.value = f.name;
      name.setAttribute('aria-label', `Name of ${f.floorId}`);
      name.addEventListener('change', () => setFloorField(f.floorId, { name: name.value }));
      nameTd.appendChild(name);
      const elev = mk('td');
      elev.appendChild(numberInput(f.elevationM, `Elevation of ${f.floorId}`, (v) => setFloorField(f.floorId, { elevationM: v })));
      const ceil = mk('td');
      ceil.appendChild(numberInput(f.ceilingHeightM, `Ceiling height of ${f.floorId}`, (v) => setFloorField(f.floorId, { ceilingHeightM: v })));
      if (!own.has(f.floorId)) ceil.appendChild(mk('div', 'is-small', 'estimate'));
      const off = mk('td');
      const o = settings.floorOffsetsM?.[f.floorId] ?? { xM: 0, yM: 0 };
      off.append(
        numberInput(o.xM, `Offset x of ${f.floorId}`, (v) => setFloorOffset(f.floorId, 'xM', v)),
        numberInput(o.yM, `Offset y of ${f.floorId}`, (v) => setFloorOffset(f.floorId, 'yM', v)),
      );
      tr.append(order, nameTd, elev, ceil, off);
      table.appendChild(tr);
    });
    panel.appendChild(table);
    return panel;
  }

  /** Visible warnings where the model handles a case poorly (Req 22.8): stairs, long corridors, materials. */
  function lessReliablePanel(model: BuildingModel): HTMLElement | null {
    const stairRooms = model.rooms.filter((rm) => rm.kind === 'stair');
    const hasStair = stairRooms.length > 0 || model.stairLinks.length > 0 || (settings.stairRegions ?? []).length > 0;
    const longCorridors = model.rooms.filter((rm) => rm.kind === 'corridor' && Math.max(rm.bboxWidthM, rm.bboxHeightM) > CORRIDOR_LENGTH_LIMIT_M);
    if (!hasStair && longCorridors.length === 0) return null;
    const panel = mk('div', 'is-panel');
    panel.appendChild(mk('h2', undefined, 'Where results will be less reliable'));
    if (hasStair) {
      const w = stairOrShaftLimit({ kind: 'compartment', id: stairRooms[0]?.id ?? 'stair' });
      const box = mk('div', 'is-stair-warning');
      box.setAttribute('data-testid', 'stair-warning');
      box.appendChild(mk('p', undefined, `${STAIR_LIMIT_INTRO} ${w.message} (${w.source ?? 'Tech Ref 1.5'})`));
      const list = mk('ul');
      for (const rm of stairRooms) {
        const li = mk('li');
        li.appendChild(mk('span', undefined, `Stair "${rm.name}" on ${floorName(model, rm.floorId)}. `));
        li.appendChild(button('Show location', () => jumpTo({ kind: 'room', floorId: rm.floorId, roomId: rm.id })));
        list.appendChild(li);
      }
      for (const link of model.stairLinks) {
        list.appendChild(mk('li', undefined, `Stair link between ${floorName(model, link.lowerFloorId)} and ${floorName(model, link.upperFloorId)}.`));
      }
      box.appendChild(list);
      panel.appendChild(box);
    }
    for (const rm of longCorridors) {
      const li = mk('p', 'is-stair-warning');
      li.appendChild(
        mk(
          'span',
          undefined,
          `Corridor "${rm.name}" on ${floorName(model, rm.floorId)} is about ${fmt1(Math.max(rm.bboxWidthM, rm.bboxHeightM))} m long, above ${fmt1(CORRIDOR_LENGTH_LIMIT_M)} m (estimate). The fire model was developed for rooms, so smoke times there are less reliable (Tech Ref 1.5). `,
        ),
      );
      li.appendChild(button('Show location', () => jumpTo({ kind: 'room', floorId: rm.floorId, roomId: rm.id })));
      panel.appendChild(li);
    }
    panel.appendChild(
      mk('p', 'is-small', 'Materials without measured data: this import gives walls, floors and ceilings estimate materials. Furniture is added later, and any item without a measured heat release curve will carry its own warning.'),
    );
    return panel;
  }

  function summaryPanel(model: BuildingModel, derived: NonNullable<ImportResult['derived']>): HTMLElement {
    const panel = mk('div', 'is-panel');
    panel.setAttribute('data-testid', 'plan-summary');
    panel.appendChild(mk('h2', undefined, 'What the simulation will use'));
    const note = mk('p', 'is-notice', SAFETY_NOTICE);
    note.setAttribute('data-testid', 'safety-notice');
    panel.appendChild(note);

    // Compartments (Req 19.9).
    panel.appendChild(mk('h3', undefined, 'Compartments'));
    const ct = mk('table');
    const ch = mk('tr');
    for (const t of ['Id', 'Name', 'Kind', 'Width (m)', 'Depth (m)', 'Height (m)', 'Area error']) ch.appendChild(mk('th', undefined, t));
    ct.appendChild(ch);
    for (const c of derived.fire.compartments) {
      const room = model.rooms.find((rm) => rm.id === c.id);
      const areaErr = room !== undefined && room.areaM2 > 0 ? `${((Math.abs(c.widthM * c.depthM - room.areaM2) / room.areaM2) * 100).toFixed(1)} %` : 'not known';
      const tr = mk('tr');
      for (const t of [c.id, room?.name ?? c.id, room ? ROOM_KIND_LABELS[room.kind] : c.kind, fmt2(c.widthM), fmt2(c.depthM), fmt2(c.heightM), areaErr]) tr.appendChild(mk('td', undefined, t));
      ct.appendChild(tr);
    }
    panel.appendChild(ct);
    panel.appendChild(mk('p', 'is-small', 'Area error compares width times depth with the room area on the plan. Rooms that are not rectangular are replaced by a box of the same floor area.'));

    // Vents.
    panel.appendChild(mk('h3', undefined, 'Vents'));
    const vt = mk('table');
    const vh = mk('tr');
    for (const t of ['Id', 'From', 'To', 'Width', 'Open fraction']) vh.appendChild(mk('th', undefined, t));
    vt.appendChild(vh);
    for (const v of derived.fire.vents) {
      const tr = mk('tr');
      let cells: string[];
      if (v.kind === 'wall') cells = [v.id, v.from, v.to, `${fmt2(v.widthM)} m`, typeof v.open === 'number' ? fmt2(v.open) : 'changes over time'];
      else if (v.kind === 'ceilingFloor') cells = [v.id, v.lower, v.upper, `${fmt2(v.areaM2)} m² opening`, typeof v.open === 'number' ? fmt2(v.open) : 'changes over time'];
      else cells = [v.id, v.compartmentId, 'OUTSIDE', `${fmt2(v.areaM2)} m² leak`, 'not applicable'];
      for (const t of cells) tr.appendChild(mk('td', undefined, t));
      vt.appendChild(tr);
    }
    panel.appendChild(vt);

    // Crowd plan.
    panel.appendChild(mk('h3', undefined, 'Crowd plan'));
    const first = derived.planInput.floors[0];
    const doors = model.doors.filter((d) => !d.isWindow && !d.isExit).length;
    const exits = model.doors.filter((d) => d.isExit).length;
    const list = mk('ul');
    for (const t of [
      `Floors: ${derived.planInput.floors.length}`,
      `Grid: ${first?.widthCells ?? 0} by ${first?.heightCells ?? 0} cells of ${fmt2(CELL_SIZE_M)} m per floor`,
      `Doors (not marked as exits): ${doors}`,
      `Exits: ${exits}`,
      `Stair links: ${derived.planInput.stairLinks.length}`,
    ]) {
      list.appendChild(mk('li', undefined, t));
    }
    panel.appendChild(list);
    return panel;
  }

  // ---- start ----------------------------------------------------------------------------------------------------
  restoreText = readLastProject(options.storage);
  renderAll();

  return {
    addSources: (added, opts = {}) => track(addSourcesInternal(added, opts)),
    loadFiles: (files) => track(loadFiles(files)),
    loadProjectText: (text) => track(loadProjectText(text)),
    async whenIdle() {
      let p: Promise<void>;
      do {
        p = inflight;
        await p;
      } while (p !== inflight);
    },
    destroy() {
      destroyed = true;
      grid.destroy();
      root.remove();
    },
  };
}
