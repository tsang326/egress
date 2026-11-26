// Canvas 2D plan preview: each drawing layer in the colour of its layer role, plus a legend (Req 19.3).
// Draws only. Layer names are never written to the canvas; the legend names roles, which are our own fixed strings.
// Entities are the flattened DXF entities of one file, in drawing units (design.md, Import screen).
import type { FlatEntity } from '../../../core/plan/dxf/blocks';
import { bulgeToArc } from '../../../core/plan/dxf/transform';
import type { LayerMap, LayerRole } from '../../../core/plan/types';

// Colour choices are ours (not a physics value). Chosen to differ in hue and in lightness so the roles stay apart
// for users with colour-vision differences; the legend repeats the role in words.
export const ROLE_COLOURS: Readonly<Record<LayerRole, string>> = {
  wall: '#1f2933',
  door: '#b45309',
  window: '#0e7490',
  stair: '#6d28d9',
  furniture: '#4d7c0f',
  ignore: '#9aa5b1',
};
export const UNCONFIRMED_COLOUR = '#c2410c'; // a layer the user has not given a role yet
export const ROLE_LABELS: Readonly<Record<LayerRole, string>> = {
  wall: 'Wall',
  door: 'Door',
  window: 'Window',
  stair: 'Stair',
  furniture: 'Furniture',
  ignore: 'Ignored',
};
const ROLE_ORDER: readonly LayerRole[] = ['wall', 'door', 'window', 'stair', 'furniture', 'ignore'];

const MARGIN_PX = 16; // layout choice
const LEGEND_SWATCH_PX = 12;
const LEGEND_ROW_PX = 18;
const ARC_STEP_RAD = Math.PI / 32; // same step as the core tessellation (core constants.ts ARC_TESSELLATION_STEP_RAD)

export interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ViewTransform {
  scale: number; // pixels per drawing unit
  offsetX: number;
  offsetY: number;
  flipHeight: number; // canvas height, DXF y points up and the canvas y points down
}

type Pt = readonly [number, number];

// Points of one entity, in drawing units. Arcs and bulges are tessellated; a closed polyline repeats its first point.
export function entityPolylines(e: FlatEntity): Pt[][] {
  switch (e.kind) {
    case 'LINE':
      return [[[e.x1, e.y1], [e.x2, e.y2]]];
    case 'CIRCLE':
      return [arcPoints(e.cx, e.cy, e.r, 0, 2 * Math.PI)];
    case 'ARC':
      return [arcPoints(e.cx, e.cy, e.r, e.startRad, e.sweepRad)];
    case 'POLYLINE': {
      const pts: Pt[] = [];
      const n = e.vertices.length;
      const segs = e.closed ? n : n - 1;
      for (let i = 0; i < n; i++) {
        const v = e.vertices[i]!;
        pts.push([v.x, v.y]);
        if (i >= segs) continue;
        const w = e.vertices[(i + 1) % n]!;
        const arc = v.bulge !== 0 ? bulgeToArc(v, w, v.bulge) : null;
        if (arc) {
          // bulgeToArc returns the counter-clockwise arc; a negative bulge travels it from p1 to p0.
          const inner = arcPoints(arc.cx, arc.cy, arc.r, arc.startRad, arc.sweepRad).slice(1, -1);
          pts.push(...(v.bulge > 0 ? inner : inner.reverse()));
        }
      }
      if (e.closed && n > 0) pts.push([e.vertices[0]!.x, e.vertices[0]!.y]);
      return [pts];
    }
  }
}

function arcPoints(cx: number, cy: number, r: number, startRad: number, sweepRad: number): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(sweepRad) / ARC_STEP_RAD));
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const a = startRad + (sweepRad * k) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

// Bounding box of all entity points; null when there is nothing finite to draw.
export function entitiesExtent(entities: readonly FlatEntity[]): Extent | null {
  let ext: Extent | null = null;
  for (const e of entities) {
    for (const line of entityPolylines(e)) {
      for (const [x, y] of line) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (!ext) ext = { minX: x, minY: y, maxX: x, maxY: y };
        else {
          if (x < ext.minX) ext.minX = x;
          if (y < ext.minY) ext.minY = y;
          if (x > ext.maxX) ext.maxX = x;
          if (y > ext.maxY) ext.maxY = y;
        }
      }
    }
  }
  return ext;
}

// Fit the extent into the canvas keeping the aspect ratio, centred, y up.
export function fitTransform(ext: Extent, widthPx: number, heightPx: number, marginPx = MARGIN_PX): ViewTransform {
  const w = Math.max(ext.maxX - ext.minX, 1e-9);
  const h = Math.max(ext.maxY - ext.minY, 1e-9);
  const availW = Math.max(widthPx - 2 * marginPx, 1);
  const availH = Math.max(heightPx - 2 * marginPx, 1);
  const scale = Math.min(availW / w, availH / h);
  const offsetX = marginPx + (availW - w * scale) / 2 - ext.minX * scale;
  const offsetY = marginPx + (availH - h * scale) / 2 - ext.minY * scale;
  return { scale, offsetX, offsetY, flipHeight: heightPx };
}

export function toCanvas(t: ViewTransform, x: number, y: number): Pt {
  return [x * t.scale + t.offsetX, t.flipHeight - (y * t.scale + t.offsetY)];
}

// Colour of a layer: the role in the map, or the "no role yet" colour when the layer is not in the map.
export function layerColour(layer: string, map: LayerMap | undefined): string {
  if (!map || !Object.hasOwn(map, layer)) return UNCONFIRMED_COLOUR;
  return ROLE_COLOURS[map[layer]!];
}

export interface PreviewOptions {
  hasUnconfirmed?: boolean; // adds the "no role yet" entry to the legend
}

// Draws the entities of one file. `map` holds the roles chosen or suggested for its layers.
export function drawPreview(
  canvas: HTMLCanvasElement,
  entities: readonly FlatEntity[],
  map: LayerMap | undefined,
  opts: PreviewOptions = {},
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const ext = entitiesExtent(entities);
  if (ext) {
    const t = fitTransform(ext, w, h);
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    // Draw ignored layers first so wall lines stay on top.
    const rank = (layer: string) => (map && Object.hasOwn(map, layer) && map[layer] === 'ignore' ? 0 : 1);
    const order = entities.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e.layer) - rank(b.e.layer) || a.i - b.i);
    for (const { e } of order) {
      ctx.strokeStyle = layerColour(e.layer, map);
      for (const line of entityPolylines(e)) {
        ctx.beginPath();
        let started = false;
        for (const [x, y] of line) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          const [px, py] = toCanvas(t, x, y);
          if (started) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
          started = true;
        }
        ctx.stroke();
      }
    }
  } else {
    ctx.fillStyle = '#52606d';
    ctx.font = '14px sans-serif';
    ctx.fillText('Nothing to draw in this file.', MARGIN_PX, MARGIN_PX + 14);
  }
  drawLegend(ctx, w, h, opts.hasUnconfirmed === true);
}

export function legendEntries(hasUnconfirmed: boolean): { label: string; colour: string }[] {
  const out = ROLE_ORDER.map((r) => ({ label: ROLE_LABELS[r], colour: ROLE_COLOURS[r] }));
  if (hasUnconfirmed) out.push({ label: 'No role chosen yet', colour: UNCONFIRMED_COLOUR });
  return out;
}

function drawLegend(ctx: CanvasRenderingContext2D, w: number, h: number, hasUnconfirmed: boolean): void {
  const entries = legendEntries(hasUnconfirmed);
  const boxW = 150;
  const boxH = entries.length * LEGEND_ROW_PX + 8;
  const x0 = w - boxW - 8;
  const y0 = h - boxH - 8;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = '#cbd2d9';
  ctx.lineWidth = 1;
  ctx.fillRect(x0, y0, boxW, boxH);
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, boxW, boxH);
  ctx.font = '12px sans-serif';
  ctx.textBaseline = 'middle';
  entries.forEach((en, i) => {
    const cy = y0 + 4 + i * LEGEND_ROW_PX + LEGEND_ROW_PX / 2;
    ctx.fillStyle = en.colour;
    ctx.fillRect(x0 + 8, cy - LEGEND_SWATCH_PX / 2, LEGEND_SWATCH_PX, LEGEND_SWATCH_PX);
    ctx.fillStyle = '#1f2933';
    ctx.fillText(en.label, x0 + 8 + LEGEND_SWATCH_PX + 8, cy);
  });
  ctx.textBaseline = 'alphabetic';
}
