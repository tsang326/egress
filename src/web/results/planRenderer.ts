// Canvas 2D floor plan for the setup, results and compare screens (run-view spec, Requirements 2.1, 5.2, 5.3). The same
// orientation as the import screen's grid view: cell row 0 at the top. Draws nothing (and never throws) when the canvas
// has no 2D context, as in DOM tests.
import type { CompartmentSeries, Result } from '../../core/fire/types';
import { CELL_SIZE_M, EYE_HEIGHT_M, VIS_LIMIT_AREA_M2, VIS_LIMIT_LARGE_M, VIS_LIMIT_SMALL_M } from '../../core/people/constants';
import { CELL_DOOR, CELL_EXIT, CELL_STAIR, CELL_WALL, type FloorInput } from '../../core/people/types';
import type { BuildingModel, Door } from '../../core/plan/types';
import { SHOW_INCAPACITATED, SHOW_MOVING, SHOW_OUT, SHOW_QUEUED, SHOW_STAIR, SHOW_WAITING } from '../run/trajectory';

export interface Geometry {
  cellPx: number;
  originX: number;
  originY: number;
}

export function geometryFor(f: FloorInput, canvasW: number, canvasH: number): Geometry {
  const cellPx = Math.max(1, Math.min(canvasW / f.widthCells, canvasH / f.heightCells));
  return { cellPx, originX: (canvasW - f.widthCells * cellPx) / 2, originY: (canvasH - f.heightCells * cellPx) / 2 };
}

/** Canvas size for a floor: the width fits `maxW`, the height `maxH`, at a whole number of pixels per cell (at least 3). */
export function canvasSizeFor(f: FloorInput, maxW: number, maxH: number): { w: number; h: number } {
  const cellPx = Math.max(3, Math.floor(Math.min(maxW / f.widthCells, maxH / f.heightCells)));
  return { w: f.widthCells * cellPx, h: f.heightCells * cellPx };
}

export function cellIndexAt(f: FloorInput, g: Geometry, px: number, py: number): number | null {
  const x = Math.floor((px - g.originX) / g.cellPx);
  const y = Math.floor((py - g.originY) / g.cellPx);
  if (x < 0 || y < 0 || x >= f.widthCells || y >= f.heightCells) return null;
  return y * f.widthCells + x;
}

// --- smoke at eye height -------------------------------------------------------------------------------------------

export type SmokeBand = 'clear' | 'light' | 'dense' | 'untenable';

export const SMOKE_FILL: Record<SmokeBand, string> = {
  clear: '#ffffff',
  light: 'rgba(255, 150, 50, 0.30)',
  dense: 'rgba(255, 100, 0, 0.60)',
  untenable: 'rgba(180, 20, 0, 0.90)',
};
export const SMOKE_LABEL: Record<SmokeBand, string> = {
  clear: 'Clear',
  light: 'Light smoke (visibility 5 to 10 m)',
  dense: 'Dense smoke (visibility 1 to 5 m)',
  untenable: 'Visibility under 1 m',
};

/** Conditions a person breathes and sees through: the upper layer once the smoke interface is below eye height
 * (crowd model EYE_HEIGHT_M = 1.6 m, FDS+Evac HUMAN_SMOKE_HEIGHT), otherwise the lower layer. */
export function atEyeHeight(c: CompartmentSeries, i: number): { visibilityM: number; tempK: number; inSmoke: boolean } {
  const inSmoke = c.interfaceHeightM[i]! < EYE_HEIGHT_M;
  const layer = inSmoke ? c.upper : c.lower;
  return { visibilityM: layer.visibilityM[i]!, tempK: inSmoke ? c.upperTempK[i]! : c.lowerTempK[i]!, inSmoke };
}

/** Bands (run-view design, smoke colour table): clear at 10 m or more, light from 5 m, dense from 1 m. */
export function smokeBand(visibilityM: number): SmokeBand {
  if (!(visibilityM < 10)) return 'clear';
  if (visibilityM >= 5) return 'light';
  if (visibilityM >= 1) return 'dense';
  return 'untenable';
}

/** The crowd model's visibility limit for a room of this floor area (practice note 5.2: 5 m small, 10 m large). */
export function visibilityLimitM(areaM2: number): number {
  return areaM2 > VIS_LIMIT_AREA_M2 ? VIS_LIMIT_LARGE_M : VIS_LIMIT_SMALL_M;
}

/** Index of the last fire sample at or before `t` (clamped to the series). */
export function sampleIndexAt(timesS: ArrayLike<number>, t: number): number {
  const n = timesS.length;
  if (n === 0) return 0;
  if (!(t >= timesS[0]!)) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timesS[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Compartment series by the id a plan cell carries. Stair cells carry `${floorId}:stair`; the fire model has one
 * stair shaft compartment per floor or one shared, so an unknown stair id falls back to a stair compartment. */
export function seriesLookup(fire: Result, scenarioStairIds: readonly string[]): (cellCompId: string) => CompartmentSeries | undefined {
  const byId = new Map(fire.compartments.map((c) => [c.id, c]));
  const stair = scenarioStairIds.map((id) => byId.get(id)).find((c) => c !== undefined);
  return (id) => byId.get(id) ?? (id.endsWith(':stair') ? stair : undefined);
}

// --- furniture -----------------------------------------------------------------------------------------------------

const furnitureCache = new WeakMap<FloorInput, Uint8Array>();

/** 1 for wall cells that form furniture: a wall group (8-connected) whose open neighbours all lie in one room. The
 * crowd plan stores furniture as wall (plan-import Req 5.7); this only changes how it is drawn. */
export function furnitureMask(f: FloorInput): Uint8Array {
  const hit = furnitureCache.get(f);
  if (hit) return hit;
  const n = f.widthCells * f.heightCells;
  const w = f.widthCells;
  const mask = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const isWall = (c: number): boolean => Number(f.cells[c]) === CELL_WALL && (f.compartmentIds[c] ?? null) === null;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || !isWall(s)) continue;
    const group: number[] = [];
    let room: string | null | undefined;
    let ok = true;
    stack.push(s);
    seen[s] = 1;
    while (stack.length > 0) {
      const c = stack.pop()!;
      group.push(c);
      const x = c % w;
      const y = Math.floor(c / w);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= f.heightCells) { ok = false; continue; }
          const k = ny * w + nx;
          if (isWall(k)) {
            if (!seen[k]) { seen[k] = 1; stack.push(k); }
            continue;
          }
          const id = f.compartmentIds[k] ?? null;
          const t = Number(f.cells[k]);
          if (id === null || t !== 1) ok = false; // outside, a door, an exit or a stair next to it: part of the building
          else if (room === undefined) room = id;
          else if (room !== id) ok = false;
        }
      }
    }
    if (ok && room) for (const c of group) mask[c] = 1;
  }
  furnitureCache.set(f, mask);
  return mask;
}

// --- drawing --------------------------------------------------------------------------------------------------------

const COLOURS = {
  wall: '#3e4c59',
  furniture: '#c3cad4',
  floor: '#ffffff',
  stair: '#d9e2ec',
  stairLine: '#9aa5b1',
  exit: '#2f855a',
  doorOpen: '#7cc4a4',
  doorClosed: '#c05621',
  window: '#4299e1',
  windowOpen: '#90cdf4',
  selected: '#2b6cb0',
  label: '#52606d',
};

export const AGENT_FILL: Record<number, string> = {
  [SHOW_WAITING]: '#2b6cb0', // not moving yet (pre-movement time)
  [SHOW_MOVING]: '#2ecc71',
  [SHOW_STAIR]: '#2ecc71',
  [SHOW_QUEUED]: '#f1c40f',
  [SHOW_OUT]: '#95a5a6',
  [SHOW_INCAPACITATED]: '#e74c3c',
};
export const AGENT_LABEL: Record<number, string> = {
  [SHOW_WAITING]: 'Not moving yet',
  [SHOW_MOVING]: 'Moving',
  [SHOW_QUEUED]: 'Queued at a door',
  [SHOW_INCAPACITATED]: 'Incapacitated',
};

export interface AgentDot {
  xM: number;
  yM: number;
  show: number;
}

export interface FloorDrawing {
  floor: FloorInput; // the crowd plan input floor (cells after door state, compartment ids)
  doors: readonly Door[]; // doors and windows of this floor, from the BuildingModel
  roomLabels?: readonly { text: string; xM: number; yM: number }[];
  fillOf?: (compId: string) => string | undefined; // room fill, e.g. smoke band colour
  selectedRoomId?: string | null;
  fireSite?: { xM: number; yM: number; size: number } | null; // size 0..1, flame scale
  agents?: readonly AgentDot[];
  hoverDoorId?: string | null;
}

export function drawFloor(canvas: HTMLCanvasElement, d: FloorDrawing): Geometry {
  const f = d.floor;
  const g = geometryFor(f, canvas.width, canvas.height);
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (ctx === null || typeof ctx.fillRect !== 'function') return g;
  const p = g.cellPx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f5f7fa';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cells = f.cells;
  const ids = f.compartmentIds;
  const furniture = furnitureMask(f);
  for (let y = 0; y < f.heightCells; y++) {
    for (let x = 0; x < f.widthCells; x++) {
      const c = y * f.widthCells + x;
      const t = Number(cells[c]);
      const id = ids[c] ?? null;
      let fill: string | undefined;
      if (t === CELL_WALL) fill = id === null ? undefined : COLOURS.wall;
      else if (t === CELL_EXIT) fill = COLOURS.exit;
      else if (t === CELL_STAIR) fill = COLOURS.stair;
      else fill = COLOURS.floor;
      if (furniture[c]) fill = COLOURS.furniture;
      else if (t === CELL_WALL && id === null) {
        // Outside ground or a wall: draw walls only where a neighbour is inside the building.
        const inside = (k: number): boolean => k >= 0 && k < cells.length && (ids[k] ?? null) !== null;
        if (inside(c - 1) || inside(c + 1) || inside(c - f.widthCells) || inside(c + f.widthCells) || inside(c - f.widthCells - 1) || inside(c - f.widthCells + 1) || inside(c + f.widthCells - 1) || inside(c + f.widthCells + 1)) fill = COLOURS.wall;
      }
      if (fill === undefined) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(g.originX + x * p, g.originY + y * p, Math.ceil(p), Math.ceil(p));
      if (id !== null && t !== CELL_WALL && t !== CELL_EXIT && d.fillOf) {
        const over = d.fillOf(id);
        if (over !== undefined && over !== '#ffffff') {
          ctx.fillStyle = over;
          ctx.fillRect(g.originX + x * p, g.originY + y * p, Math.ceil(p), Math.ceil(p));
        }
      }
      if (t === CELL_STAIR && (x + y) % 2 === 0) {
        ctx.fillStyle = COLOURS.stairLine;
        ctx.fillRect(g.originX + x * p + p * 0.35, g.originY + y * p + p * 0.35, p * 0.3, p * 0.3);
      }
      if (t === CELL_DOOR) {
        ctx.fillStyle = COLOURS.doorOpen;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(g.originX + x * p, g.originY + y * p, Math.ceil(p), Math.ceil(p));
        ctx.globalAlpha = 1;
      }
    }
  }
  // Closed doors and windows on top of the wall they became.
  for (const door of d.doors) {
    const colour = door.isWindow ? (door.open ? COLOURS.windowOpen : COLOURS.window) : door.open ? null : COLOURS.doorClosed;
    const hover = d.hoverDoorId === door.id;
    if (colour === null && !hover) continue;
    ctx.fillStyle = hover ? COLOURS.selected : colour!;
    for (const c of door.cells) {
      const x = c % f.widthCells;
      const y = Math.floor(c / f.widthCells);
      const inset = door.isWindow ? p * 0.25 : 0;
      ctx.fillRect(g.originX + x * p + inset, g.originY + y * p + inset, Math.ceil(p - 2 * inset), Math.ceil(p - 2 * inset));
    }
  }
  // Selected room: a light tint, drawn over the smoke colour.
  if (d.selectedRoomId) {
    ctx.fillStyle = 'rgba(43, 108, 176, 0.13)';
    for (let c = 0; c < ids.length; c++) {
      if (ids[c] !== d.selectedRoomId || Number(cells[c]) === CELL_WALL) continue;
      ctx.fillRect(g.originX + (c % f.widthCells) * p, g.originY + Math.floor(c / f.widthCells) * p, Math.ceil(p), Math.ceil(p));
    }
  }
  // Room labels.
  if (d.roomLabels && p >= 5) {
    ctx.fillStyle = COLOURS.label;
    ctx.font = `${Math.max(10, Math.min(13, p * 1.4))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of d.roomLabels) {
      const lx = g.originX + (l.xM / CELL_SIZE_M) * p;
      const ly = g.originY + (l.yM / CELL_SIZE_M) * p;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.strokeText(l.text, lx, ly);
      ctx.fillText(l.text, lx, ly);
    }
  }
  // Agents.
  if (d.agents) {
    const r = Math.max(2.5, p * 0.9);
    for (const a of d.agents) {
      if (a.show === SHOW_OUT) continue;
      ctx.beginPath();
      ctx.arc(g.originX + (a.xM / CELL_SIZE_M) * p, g.originY + (a.yM / CELL_SIZE_M) * p, r, 0, Math.PI * 2);
      ctx.fillStyle = AGENT_FILL[a.show] ?? '#2ecc71';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(31, 41, 51, 0.6)';
      ctx.stroke();
    }
  }
  // Fire marker: a drawn flame (no emoji, so it looks the same on every system), scaled by the current HRR.
  if (d.fireSite) {
    const cx = g.originX + (d.fireSite.xM / CELL_SIZE_M) * p;
    const cy = g.originY + (d.fireSite.yM / CELL_SIZE_M) * p;
    const s = Math.max(10, p * 1.6) * (0.55 + 0.9 * Math.max(0, Math.min(1, d.fireSite.size)));
    drawFlame(ctx, cx, cy, s);
  }
  return g;
}

function drawFlame(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const flame = (scale: number, colour: string): void => {
    const h = s * 1.6 * scale;
    const w = s * scale;
    ctx.beginPath();
    ctx.moveTo(cx, cy - h * 0.75);
    ctx.bezierCurveTo(cx + w * 0.9, cy - h * 0.2, cx + w * 0.7, cy + h * 0.35, cx, cy + h * 0.35);
    ctx.bezierCurveTo(cx - w * 0.7, cy + h * 0.35, cx - w * 0.9, cy - h * 0.2, cx, cy - h * 0.75);
    ctx.fillStyle = colour;
    ctx.fill();
  };
  flame(1, '#c53030');
  flame(0.68, '#ed8936');
  flame(0.38, '#faf089');
}

/** Room label positions (centre of each room's cells) for a floor. */
export function roomLabelsFor(model: BuildingModel, floorId: string): { text: string; xM: number; yM: number }[] {
  const g = model.grids[floorId];
  if (!g) return [];
  return model.rooms
    .filter((r) => r.floorId === floorId)
    .map((r) => {
      let sx = 0;
      let sy = 0;
      for (const c of r.cells) {
        sx += (c % g.widthCells) + 0.5;
        sy += Math.floor(c / g.widthCells) + 0.5;
      }
      const n = Math.max(1, r.cells.length);
      return { text: r.name, xM: (sx / n) * CELL_SIZE_M, yM: (sy / n) * CELL_SIZE_M };
    });
}
