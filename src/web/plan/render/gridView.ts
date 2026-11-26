// Per-floor grid view on a Canvas 2D element (Req 19.4, 19.5) with the light edits of Req 15: paint and erase wall
// cells, set doors open or closed, rename rooms, set room kind, mark exits and stair regions, undo, and highlight a
// warning location (Req 19.7). The view holds no model state: every action goes out through a handler and the screen
// feeds the recomputed floor back through `update`. Names from the DXF-derived model go to the canvas with fillText
// and into the DOM only through textContent or an input's value, never as markup.
import { CELL_DOOR, CELL_WALL } from '../../../core/people/types';
import type { Door, Edit, ImportWarningLocation, Room, RoomKind } from '../../../core/plan/types';

export type GridTool = 'select' | 'paintWall' | 'eraseWall' | 'exit' | 'stair';

export interface GridFloorData {
  floorId: string;
  widthCells: number;
  heightCells: number;
  cellType: Uint8Array; // row-major, CELL_* from core/people/types
  rooms: readonly Room[]; // rooms of this floor only
  doors: readonly Door[]; // doors of this floor only
  stairCells?: ReadonlySet<number>; // cells of user-marked Stair_Regions on this floor
}

export interface GridViewHandlers {
  onEdit(edit: Edit): void; // paintWall, eraseWall, setDoorOpen, setWindowOpen, renameRoom, setRoomKind
  onToggleExit(doorId: string): void; // mark or unmark one door as an exit
  onToggleStairRegion(floorId: string, roomId: string): void; // mark or unmark one room as a Stair_Region
  onUndo(): void; // the screen removes the last Edit (Req 15.5) and recomputes
}

export interface GridView {
  update(data: GridFloorData): void;
  setTool(tool: GridTool): void;
  highlight(location: ImportWarningLocation | null): void;
  destroy(): void;
}

// Layout choices, not physics values.
const DEFAULT_CANVAS_W = 800;
const DEFAULT_CANVAS_H = 560;
const GOLDEN_ANGLE_DEG = 137.508; // spreads hues evenly for any number of rooms
const LABEL_MIN_CELL_PX = 3; // below this the grid is too small to read names
const COLOUR_WALL = '#1f2933';
const COLOUR_OUTSIDE = '#f5f7fa';
const COLOUR_DOOR = '#f59e0b';
const COLOUR_DOOR_CLOSED = '#92400e';
const COLOUR_EXIT = '#15803d';
const COLOUR_STAIR = '#6d28d9';
const COLOUR_HIGHLIGHT = '#dc2626';

export const TOOL_LABELS: Readonly<Record<GridTool, string>> = {
  select: 'Select',
  paintWall: 'Paint wall',
  eraseWall: 'Erase wall',
  exit: 'Mark exit',
  stair: 'Mark stair',
};
export const ROOM_KIND_LABELS: Readonly<Record<RoomKind, string>> = {
  room: 'Room',
  corridor: 'Corridor',
  stair: 'Stair',
};

// Distinct, deterministic room colour from the room's position in the list (light enough for black labels).
export function roomColour(index: number): string {
  const hue = Math.round((index * GOLDEN_ANGLE_DEG) % 360);
  const lightness = 78 + (index % 3) * 4;
  return `hsl(${hue}, 60%, ${lightness}%)`;
}

// Cells on the straight line between two cells, ends included (Bresenham). Used for dragged paint and erase.
export function cellsOnLine(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

export interface GridGeometry {
  cellPx: number;
  originX: number;
  originY: number;
}

// Fit the grid into the canvas, centred, square cells.
export function gridGeometry(widthCells: number, heightCells: number, canvasW: number, canvasH: number): GridGeometry {
  const cellPx = Math.max(Math.min(canvasW / Math.max(widthCells, 1), canvasH / Math.max(heightCells, 1)), 0.01);
  return { cellPx, originX: (canvasW - widthCells * cellPx) / 2, originY: (canvasH - heightCells * cellPx) / 2 };
}

// Cell under a canvas pixel, or null outside the grid.
export function cellAtPixel(g: GridGeometry, widthCells: number, heightCells: number, px: number, py: number): { x: number; y: number } | null {
  const x = Math.floor((px - g.originX) / g.cellPx);
  const y = Math.floor((py - g.originY) / g.cellPx);
  if (x < 0 || y < 0 || x >= widthCells || y >= heightCells) return null;
  return { x, y };
}

// Cell indices a warning location points at on this floor; empty when the location is not on this floor or names
// nothing that exists here. A `cell` location is one cell; a room or door location is all of its cells.
export function locationCells(loc: ImportWarningLocation, data: GridFloorData): number[] {
  if (loc.floorId !== undefined && loc.floorId !== data.floorId) return [];
  if (loc.kind === 'cell' && loc.xCell !== undefined && loc.yCell !== undefined) {
    const { xCell: x, yCell: y } = loc;
    return x >= 0 && y >= 0 && x < data.widthCells && y < data.heightCells ? [y * data.widthCells + x] : [];
  }
  if (loc.kind === 'room' && loc.roomId !== undefined) {
    const r = data.rooms.find((room) => room.id === loc.roomId);
    return r ? Array.from(r.cells) : [];
  }
  if (loc.kind === 'door' && loc.doorId !== undefined) {
    const d = data.doors.find((door) => door.id === loc.doorId);
    return d ? Array.from(d.cells) : [];
  }
  return [];
}

export function createGridView(container: HTMLElement, handlers: GridViewHandlers): GridView {
  const doc = container.ownerDocument;
  let data: GridFloorData | null = null;
  let tool: GridTool = 'select';
  let selectedRoomId: string | null = null;
  let selectedDoorId: string | null = null;
  let highlightCells: ReadonlySet<number> = new Set();
  let drag: { tool: 'paintWall' | 'eraseWall'; cells: { x: number; y: number }[]; last: { x: number; y: number } } | null = null;

  const root = doc.createElement('div');
  root.className = 'grid-view';
  const toolbar = doc.createElement('div');
  toolbar.className = 'grid-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Grid tools');
  const toolButtons = new Map<GridTool, HTMLButtonElement>();
  for (const t of Object.keys(TOOL_LABELS) as GridTool[]) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = TOOL_LABELS[t];
    b.addEventListener('click', () => setTool(t));
    toolButtons.set(t, b);
    toolbar.appendChild(b);
  }
  const undoBtn = doc.createElement('button');
  undoBtn.type = 'button';
  undoBtn.textContent = 'Undo last edit';
  undoBtn.addEventListener('click', () => handlers.onUndo());
  toolbar.appendChild(undoBtn);

  const canvas = doc.createElement('canvas');
  canvas.width = DEFAULT_CANVAS_W;
  canvas.height = DEFAULT_CANVAS_H;
  canvas.style.maxWidth = '100%';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Floor grid with rooms, doors, exits and stairs');

  const panel = doc.createElement('div');
  panel.className = 'grid-panel';
  const legend = doc.createElement('p');
  legend.className = 'grid-legend';
  legend.textContent =
    'Dark cells are walls. Amber cells are open doors, brown cells are closed doors. A green outline marks an exit. ' +
    'Violet hatching marks a stair region. A red outline marks the selected warning.';

  root.append(toolbar, canvas, panel, legend);
  container.appendChild(root);

  function geometry(): GridGeometry | null {
    return data ? gridGeometry(data.widthCells, data.heightCells, canvas.width, canvas.height) : null;
  }

  function setTool(t: GridTool): void {
    tool = t;
    for (const [name, b] of toolButtons) b.setAttribute('aria-pressed', String(name === t));
  }

  function doorsAt(i: number): Door | undefined {
    return data?.doors.find((d) => d.cells.includes(i));
  }
  function roomAt(i: number): Room | undefined {
    return data?.rooms.find((r) => r.cells.includes(i));
  }

  function draw(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!data) return;
    const g = geometry()!;
    const { widthCells: w, heightCells: h } = data;
    const px = (x: number) => g.originX + x * g.cellPx;
    const py = (y: number) => g.originY + y * g.cellPx;

    ctx.fillStyle = COLOUR_OUTSIDE;
    ctx.fillRect(px(0), py(0), w * g.cellPx, h * g.cellPx);

    // Room fills, one distinct colour per room.
    data.rooms.forEach((room, idx) => {
      ctx.fillStyle = roomColour(idx);
      for (const i of room.cells) ctx.fillRect(px(i % w), py(Math.floor(i / w)), g.cellPx + 0.5, g.cellPx + 0.5);
    });

    // Walls and doors from the cell types.
    for (let i = 0; i < data.cellType.length; i++) {
      const t = data.cellType[i];
      if (t === CELL_WALL) ctx.fillStyle = COLOUR_WALL;
      else if (t === CELL_DOOR) ctx.fillStyle = COLOUR_DOOR;
      else continue;
      ctx.fillRect(px(i % w), py(Math.floor(i / w)), g.cellPx + 0.5, g.cellPx + 0.5);
    }
    // Closed doors are brown, so open and closed differ by more than a label.
    for (const d of data.doors) {
      if (d.open) continue;
      ctx.fillStyle = COLOUR_DOOR_CLOSED;
      for (const i of d.cells) ctx.fillRect(px(i % w), py(Math.floor(i / w)), g.cellPx + 0.5, g.cellPx + 0.5);
    }

    // Stair regions: diagonal hatching.
    if (data.stairCells && data.stairCells.size > 0) {
      ctx.strokeStyle = COLOUR_STAIR;
      ctx.lineWidth = Math.max(1, g.cellPx / 6);
      ctx.beginPath();
      for (const i of data.stairCells) {
        const x = px(i % w);
        const y = py(Math.floor(i / w));
        ctx.moveTo(x, y + g.cellPx);
        ctx.lineTo(x + g.cellPx, y);
      }
      ctx.stroke();
    }

    // Exits: green outline on each door cell, so the mark does not hide the door colour.
    ctx.strokeStyle = COLOUR_EXIT;
    ctx.lineWidth = Math.max(2, g.cellPx / 4);
    for (const d of data.doors) {
      if (!d.isExit) continue;
      for (const i of d.cells) ctx.strokeRect(px(i % w) + 0.5, py(Math.floor(i / w)) + 0.5, g.cellPx - 1, g.cellPx - 1);
    }

    // Selection.
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;
    const selCells: ArrayLike<number> =
      (selectedDoorId !== null ? data.doors.find((d) => d.id === selectedDoorId)?.cells : undefined) ??
      (selectedRoomId !== null ? data.rooms.find((r) => r.id === selectedRoomId)?.cells : undefined) ??
      [];
    for (let k = 0; k < selCells.length; k++) {
      const i = selCells[k]!;
      ctx.strokeRect(px(i % w) + 1, py(Math.floor(i / w)) + 1, g.cellPx - 2, g.cellPx - 2);
    }

    // Warning highlight.
    ctx.strokeStyle = COLOUR_HIGHLIGHT;
    ctx.lineWidth = 3;
    for (const i of highlightCells) ctx.strokeRect(px(i % w) + 1, py(Math.floor(i / w)) + 1, g.cellPx - 2, g.cellPx - 2);

    // Labels last. Room names and door/exit markers are drawn with fillText.
    if (g.cellPx >= LABEL_MIN_CELL_PX) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fontPx = Math.max(10, Math.min(16, g.cellPx * 2));
      ctx.font = `${fontPx}px sans-serif`;
      for (const room of data.rooms) {
        if (room.cells.length === 0) continue;
        let sx = 0;
        let sy = 0;
        for (const i of room.cells) {
          sx += i % w;
          sy += Math.floor(i / w);
        }
        const cx = px(sx / room.cells.length + 0.5);
        const cy = py(sy / room.cells.length + 0.5);
        const label = room.kind === 'room' ? room.name : `${room.name} (${ROOM_KIND_LABELS[room.kind].toLowerCase()})`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.strokeText(label, cx, cy);
        ctx.fillStyle = '#102a43';
        ctx.fillText(label, cx, cy);
      }
      ctx.font = `bold ${Math.max(9, fontPx - 3)}px sans-serif`;
      for (const d of data.doors) {
        if (!d.isExit || d.cells.length === 0) continue;
        const i = d.cells[Math.floor(d.cells.length / 2)]!;
        const cx = px((i % w) + 0.5);
        const cy = py(Math.floor(i / w) - 0.8);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText('Exit', cx, cy);
        ctx.fillStyle = COLOUR_EXIT;
        ctx.fillText('Exit', cx, cy);
      }
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  function rebuildPanel(): void {
    panel.replaceChildren();
    if (!data) return;
    const door = selectedDoorId !== null ? data.doors.find((d) => d.id === selectedDoorId) : undefined;
    const room = !door && selectedRoomId !== null ? data.rooms.find((r) => r.id === selectedRoomId) : undefined;
    if (door) {
      const title = doc.createElement('p');
      title.textContent = `${door.isWindow ? 'Window' : 'Door'} ${door.id}, width ${door.widthM.toFixed(2)} m`;
      const label = doc.createElement('label');
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.checked = door.open;
      box.addEventListener('change', () => {
        handlers.onEdit(
          door.isWindow
            ? { kind: 'setWindowOpen', windowId: door.id, open: box.checked }
            : { kind: 'setDoorOpen', doorId: door.id, open: box.checked },
        );
      });
      label.append(box, doc.createTextNode(door.isWindow ? ' Window open' : ' Door open'));
      panel.append(title, label);
    } else if (room) {
      const title = doc.createElement('p');
      title.textContent = `Room ${room.id}, about ${room.areaM2.toFixed(1)} m²`;
      const nameLabel = doc.createElement('label');
      const nameInput = doc.createElement('input');
      nameInput.type = 'text';
      nameInput.value = room.name; // value, not markup
      nameInput.maxLength = 60; // NAME_LENGTH_MAX in core/plan/constants.ts
      nameInput.addEventListener('change', () => {
        handlers.onEdit({ kind: 'renameRoom', roomId: room.id, name: nameInput.value });
      });
      nameLabel.append(doc.createTextNode('Name '), nameInput);
      const kindLabel = doc.createElement('label');
      const kindSelect = doc.createElement('select');
      for (const k of Object.keys(ROOM_KIND_LABELS) as RoomKind[]) {
        const o = doc.createElement('option');
        o.value = k;
        o.textContent = ROOM_KIND_LABELS[k];
        o.selected = k === room.kind;
        kindSelect.appendChild(o);
      }
      kindSelect.addEventListener('change', () => {
        handlers.onEdit({ kind: 'setRoomKind', roomId: room.id, roomKind: kindSelect.value as RoomKind });
      });
      kindLabel.append(doc.createTextNode(' Kind '), kindSelect);
      panel.append(title, nameLabel, kindLabel);
    } else {
      const hint = doc.createElement('p');
      hint.textContent = 'Select a room or a door to rename it, change its kind or open and close it.';
      panel.appendChild(hint);
    }
  }

  function eventCell(ev: PointerEvent): { x: number; y: number } | null {
    const g = geometry();
    if (!g || !data) return null;
    const r = canvas.getBoundingClientRect();
    const sx = r.width > 0 ? canvas.width / r.width : 1;
    const sy = r.height > 0 ? canvas.height / r.height : 1;
    return cellAtPixel(g, data.widthCells, data.heightCells, (ev.clientX - r.left) * sx, (ev.clientY - r.top) * sy);
  }

  function applyClick(c: { x: number; y: number }): void {
    if (!data) return;
    const i = c.y * data.widthCells + c.x;
    const door = doorsAt(i);
    const room = roomAt(i);
    if (tool === 'exit') {
      if (door && !door.isWindow) handlers.onToggleExit(door.id);
    } else if (tool === 'stair') {
      if (room) handlers.onToggleStairRegion(data.floorId, room.id);
    } else {
      selectedDoorId = door ? door.id : null;
      selectedRoomId = door ? null : (room?.id ?? null);
      rebuildPanel();
      draw();
    }
  }

  canvas.addEventListener('pointerdown', (ev) => {
    const c = eventCell(ev);
    if (!c) return;
    if (tool === 'paintWall' || tool === 'eraseWall') {
      drag = { tool, cells: [c], last: c };
      canvas.setPointerCapture?.(ev.pointerId);
    } else {
      applyClick(c);
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const c = eventCell(ev);
    if (!c || (c.x === drag.last.x && c.y === drag.last.y)) return;
    // Fill the line between the last and the new cell so a fast drag leaves no gaps.
    for (const p of cellsOnLine(drag.last.x, drag.last.y, c.x, c.y).slice(1)) drag.cells.push(p);
    drag.last = c;
  });
  const endDrag = () => {
    if (!data || !drag) return;
    const cells = dedupe(drag.cells);
    const kind = drag.tool === 'paintWall' ? 'paintWall' : 'eraseWall';
    drag = null;
    handlers.onEdit({ kind, floorId: data.floorId, cells }); // one Edit per drag, so one undo removes it
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => {
    drag = null;
  });

  setTool('select');
  rebuildPanel();
  draw();

  return {
    update(next) {
      const floorChanged = data?.floorId !== next.floorId;
      data = next;
      if (floorChanged) {
        selectedRoomId = null;
        selectedDoorId = null;
        highlightCells = new Set();
      }
      // Drop a selection that no longer exists after a recompute (rooms may merge or split).
      if (selectedRoomId !== null && !next.rooms.some((r) => r.id === selectedRoomId)) selectedRoomId = null;
      if (selectedDoorId !== null && !next.doors.some((d) => d.id === selectedDoorId)) selectedDoorId = null;
      rebuildPanel();
      draw();
    },
    setTool,
    highlight(loc) {
      highlightCells = loc && data ? new Set(locationCells(loc, data)) : new Set();
      if (loc && data) {
        if (loc.kind === 'room' && loc.roomId !== undefined) {
          selectedRoomId = loc.roomId;
          selectedDoorId = null;
        } else if (loc.kind === 'door' && loc.doorId !== undefined) {
          selectedDoorId = loc.doorId;
          selectedRoomId = null;
        }
        rebuildPanel();
      }
      draw();
    },
    destroy() {
      root.remove();
    },
  };
}

function dedupe(cells: { x: number; y: number }[]): { x: number; y: number }[] {
  const seen = new Set<string>();
  const out: { x: number; y: number }[] = [];
  for (const c of cells) {
    const k = `${c.x},${c.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// What "undo" does to the edit list (Req 15.5): the list without its last Edit. The screen passes the result to the
// importer as the new `settings.edits`.
export function withoutLastEdit(edits: readonly Edit[]): Edit[] {
  return edits.slice(0, -1);
}
