import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { doorBlock, formatNumber, rectOutline, writeDxf, type DxfDocument } from './dxfWriter';

// Group-code pairs of the written text, as [code, value].
function pairs(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const out: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1] ?? '']);
  return out;
}

describe('dxfWriter', () => {
  const doc: DxfDocument = {
    entities: [
      { type: 'LINE', layer: 'A-WALL', a: [0, 0], b: [3, 0] },
      { type: 'INSERT', layer: 'A-DOOR', block: 'D', at: [1, 0], scaleX: -1, rotationDeg: 90 },
    ],
    blocks: [doorBlock('D', 0.9)],
  };

  it('writes sections in order and an even number of lines', () => {
    const text = writeDxf(doc);
    const p = pairs(text);
    const sections = p.flatMap(([c, v], i) => (c === 0 && v === 'SECTION' ? [p[i + 1]![1]] : []));
    expect(sections).toEqual(['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES']);
    expect(p[p.length - 1]).toEqual([0, 'EOF']);
  });

  it('writes coordinates in the chosen unit with the matching $INSUNITS', () => {
    const mm = pairs(writeDxf({ ...doc, unit: 'mm' }));
    expect(mm).toContainEqual([11, '3000']);
    const i = mm.findIndex(([, v]) => v === '$INSUNITS');
    expect(mm[i + 1]).toEqual([70, '4']);
    const ft = pairs(writeDxf({ ...doc, unit: 'ft' }));
    expect(ft[ft.findIndex(([, v]) => v === '$INSUNITS') + 1]).toEqual([70, '2']);
  });

  it('writes negative scale, rotation, bulge, and lets header variables be omitted', () => {
    const p = pairs(
      writeDxf({
        ...doc,
        entities: [
          ...doc.entities,
          { type: 'LWPOLYLINE', layer: 'A-WALL', vertices: [{ xM: 0, yM: 0, bulge: 0.5 }, { xM: 1, yM: 0 }] },
        ],
        acadVer: null,
        insunits: null,
      }),
    );
    expect(p).toContainEqual([41, '-1']);
    expect(p).toContainEqual([50, '90']);
    expect(p).toContainEqual([42, '0.5']);
    expect(p.some(([, v]) => v === '$ACADVER' || v === '$INSUNITS')).toBe(false);
  });

  it('is deterministic and supports CRLF', () => {
    expect(writeDxf(doc)).toBe(writeDxf(doc));
    expect(writeDxf({ ...doc, eol: '\r\n' })).toContain('\r\n');
  });

  it('property: formatNumber never uses an exponent and round-trips within 1e-9', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (x) => {
        const s = formatNumber(x);
        expect(s).not.toMatch(/e/i);
        expect(Math.abs(Number(s) - x)).toBeLessThanOrEqual(5e-10);
      }),
    );
  });

  it('rectOutline is a closed four-vertex polyline', () => {
    const e = rectOutline('A-WALL', 0, 0, 2, 3);
    expect(e.type === 'LWPOLYLINE' && e.closed && e.vertices.length).toBe(4);
  });
});
