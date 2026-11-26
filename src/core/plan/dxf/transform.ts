// 2D affine transforms, mirroring from a negative scale, and bulge-to-arc conversion for the DXF reader
// (Req 1.4, 1.5, 1.7). Pure functions over numbers; never throw. Coordinates are drawing units here.
import { ARC_TESSELLATION_STEP_RAD, BULGE_STRAIGHT_EPSILON, SIMILARITY_TOLERANCE } from '../constants';

export interface Point {
  x: number;
  y: number;
}

// x' = a*x + c*y + e ; y' = b*x + d*y + f
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface Vertex extends Point {
  bulge: number; // bulge of the segment that starts at this vertex (DXF group 42); 0 is straight
}

// Counter-clockwise arc: sweepRad is in (0, 2*pi].
export interface ArcGeom {
  cx: number;
  cy: number;
  r: number;
  startRad: number;
  sweepRad: number;
}

export const IDENTITY: Affine = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

// Mirror of X: the object coordinate system of an entity with extrusion direction (0,0,-1) (DXF reference).
export const MIRROR_X: Affine = Object.freeze({ a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 });

// outer after inner: multiply(o, i) applies i first, then o.
export function multiply(o: Affine, i: Affine): Affine {
  return {
    a: o.a * i.a + o.c * i.b,
    b: o.b * i.a + o.d * i.b,
    c: o.a * i.c + o.c * i.d,
    d: o.b * i.c + o.d * i.d,
    e: o.a * i.e + o.c * i.f + o.e,
    f: o.b * i.e + o.d * i.f + o.f,
  };
}

export function applyToPoint(m: Affine, x: number, y: number): Point {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

export function determinant(m: Affine): number {
  return m.a * m.d - m.b * m.c;
}

// True when the transform maps circles to circles (rotation, uniform scale, mirroring, any combination).
export function isSimilarity(m: Affine): boolean {
  const col1 = m.a * m.a + m.b * m.b;
  const col2 = m.c * m.c + m.d * m.d;
  const dot = m.a * m.c + m.b * m.d;
  const size = col1 + col2;
  if (!(size > 0) || !Number.isFinite(size)) return false;
  return Math.abs(col1 - col2) <= SIMILARITY_TOLERANCE * size && Math.abs(dot) <= SIMILARITY_TOLERANCE * size;
}

// cos and sin of an angle in degrees, exact for multiples of 90 so that axis-aligned plans stay on exact coordinates.
export function cosSinDeg(deg: number): { cos: number; sin: number } {
  if (Number.isFinite(deg)) {
    const turn = ((deg % 360) + 360) % 360;
    if (turn === 0) return { cos: 1, sin: 0 };
    if (turn === 90) return { cos: 0, sin: 1 };
    if (turn === 180) return { cos: -1, sin: 0 };
    if (turn === 270) return { cos: 0, sin: -1 };
  }
  const rad = (deg * Math.PI) / 180;
  return { cos: Math.cos(rad), sin: Math.sin(rad) };
}

// Block coordinates -> parent coordinates for an INSERT: translate(insert) * rotate * scale * translate(-base).
// A negative sx or sy gives a negative determinant, which is the mirroring of Req 1.5.
export function insertTransform(
  insertX: number,
  insertY: number,
  scaleX: number,
  scaleY: number,
  rotationDeg: number,
  baseX: number,
  baseY: number,
): Affine {
  const { cos, sin } = cosSinDeg(rotationDeg);
  const a = cos * scaleX;
  const b = sin * scaleX;
  const c = -sin * scaleY;
  const d = cos * scaleY;
  return { a, b, c, d, e: insertX - (a * baseX + c * baseY), f: insertY - (b * baseX + d * baseY) };
}

// ---- Bulge ------------------------------------------------------------------------------------------------------

interface SignedArc {
  cx: number;
  cy: number;
  r: number;
  startRad: number; // angle of p0 seen from the centre
  thetaRad: number; // signed included angle, from p0 to p1; positive is counter-clockwise
}

// DXF reference: bulge = tan(theta / 4), theta the included angle, positive counter-clockwise from p0 to p1.
function signedArcFromBulge(p0: Point, p1: Point, bulge: number): SignedArc | null {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < BULGE_STRAIGHT_EPSILON) return null;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const chord = Math.hypot(dx, dy);
  if (!(chord > 0) || !Number.isFinite(chord)) return null;
  const theta = 4 * Math.atan(bulge);
  const half = theta / 2;
  const r = chord / (2 * Math.abs(Math.sin(half)));
  // The centre lies on the left of p0->p1 by (chord/2)/tan(theta/2) (right when that is negative).
  const offset = chord / 2 / Math.tan(half);
  const cx = (p0.x + p1.x) / 2 + (-dy / chord) * offset;
  const cy = (p0.y + p1.y) / 2 + (dx / chord) * offset;
  return { cx, cy, r, startRad: Math.atan2(p0.y - cy, p0.x - cx), thetaRad: theta };
}

// The arc of one polyline segment as a counter-clockwise ArcGeom, or null when the segment is straight or degenerate.
export function bulgeToArc(p0: Point, p1: Point, bulge: number): ArcGeom | null {
  const s = signedArcFromBulge(p0, p1, bulge);
  if (s === null) return null;
  if (s.thetaRad > 0) return { cx: s.cx, cy: s.cy, r: s.r, startRad: s.startRad, sweepRad: s.thetaRad };
  // Clockwise from p0 to p1 is the counter-clockwise arc from p1 to p0.
  return { cx: s.cx, cy: s.cy, r: s.r, startRad: s.startRad + s.thetaRad, sweepRad: -s.thetaRad };
}

function stepCount(sweepRad: number): number {
  return Math.max(2, Math.ceil(Math.abs(sweepRad) / ARC_TESSELLATION_STEP_RAD));
}

// Points strictly between p0 and p1 on the bulge arc, in travel order from p0.
function bulgeInnerPoints(p0: Point, p1: Point, bulge: number): Point[] {
  const s = signedArcFromBulge(p0, p1, bulge);
  if (s === null) return [];
  const n = stepCount(s.thetaRad);
  const out: Point[] = [];
  for (let k = 1; k < n; k++) {
    const ang = s.startRad + (s.thetaRad * k) / n;
    out.push({ x: s.cx + s.r * Math.cos(ang), y: s.cy + s.r * Math.sin(ang) });
  }
  return out;
}

// ---- Transforming geometry --------------------------------------------------------------------------------------

export type TransformedArc =
  | { kind: 'arc'; arc: ArcGeom }
  | { kind: 'points'; points: Point[] }; // tessellated, in travel order

function arcPoint(arc: ArcGeom, ang: number): Point {
  return { x: arc.cx + arc.r * Math.cos(ang), y: arc.cy + arc.r * Math.sin(ang) };
}

// Arc under any transform. A similarity keeps an arc (Req 1.5, 1.7); anything else (non-uniform scale) makes an
// elliptical arc, which is returned as points.
export function transformArc(arc: ArcGeom, m: Affine): TransformedArc {
  if (isSimilarity(m)) {
    const centre = applyToPoint(m, arc.cx, arc.cy);
    const s = arcPoint(arc, arc.startRad);
    const e = arcPoint(arc, arc.startRad + arc.sweepRad);
    const ps = applyToPoint(m, s.x, s.y);
    const pe = applyToPoint(m, e.x, e.y);
    const scale = Math.sqrt(Math.abs(determinant(m)));
    // Mirroring turns the counter-clockwise arc into a clockwise one: its counter-clockwise start is the old end.
    const from = determinant(m) < 0 ? pe : ps;
    return {
      kind: 'arc',
      arc: {
        cx: centre.x,
        cy: centre.y,
        r: arc.r * scale,
        startRad: Math.atan2(from.y - centre.y, from.x - centre.x),
        sweepRad: arc.sweepRad,
      },
    };
  }
  const n = stepCount(arc.sweepRad);
  const points: Point[] = [];
  for (let k = 0; k <= n; k++) {
    const p = arcPoint(arc, arc.startRad + (arc.sweepRad * k) / n);
    points.push(applyToPoint(m, p.x, p.y));
  }
  return { kind: 'points', points };
}

// A full circle under a transform whose result is not a circle: a closed ring of points.
export function tessellateCircle(cx: number, cy: number, r: number, m: Affine): Point[] {
  const n = stepCount(2 * Math.PI);
  const points: Point[] = [];
  for (let k = 0; k < n; k++) {
    const ang = (2 * Math.PI * k) / n;
    points.push(applyToPoint(m, cx + r * Math.cos(ang), cy + r * Math.sin(ang)));
  }
  return points;
}

// Polyline vertices under a transform. A similarity keeps bulges (their sign flips when the transform mirrors, because
// mirroring reverses the turning direction). Any other transform replaces every arc segment by straight pieces.
export function transformVertices(vertices: readonly Vertex[], closed: boolean, m: Affine): Vertex[] {
  const out: Vertex[] = [];
  if (isSimilarity(m)) {
    const flip = determinant(m) < 0 ? -1 : 1;
    for (const v of vertices) {
      const p = applyToPoint(m, v.x, v.y);
      out.push({ x: p.x, y: p.y, bulge: v.bulge === 0 ? 0 : v.bulge * flip });
    }
    return out;
  }
  const count = vertices.length;
  for (let i = 0; i < count; i++) {
    const v = vertices[i] as Vertex;
    const p = applyToPoint(m, v.x, v.y);
    out.push({ x: p.x, y: p.y, bulge: 0 });
    const hasSegment = i + 1 < count || closed;
    if (hasSegment && v.bulge !== 0) {
      const next = vertices[(i + 1) % count] as Vertex;
      for (const q of bulgeInnerPoints(v, next, v.bulge)) {
        const t = applyToPoint(m, q.x, q.y);
        out.push({ x: t.x, y: t.y, bulge: 0 });
      }
    }
  }
  return out;
}
