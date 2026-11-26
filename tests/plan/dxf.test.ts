// Unit tests for the DXF reader through its public entry points: readDxf, flattenEntities and units.ts (task 2.4).
// dxfGeometry.test.ts covers the lower-level pieces; this file checks the behaviour a caller sees.
import { describe, expect, it } from 'vitest';
import { DXF_MAX_ENTITIES } from '../../src/core/plan/constants';
import { flattenEntities } from '../../src/core/plan/dxf/blocks';
import type { FlatEntity } from '../../src/core/plan/dxf/blocks';
import { readDxf } from '../../src/core/plan/dxf/reader';
import type { ReadDxfResult } from '../../src/core/plan/dxf/reader';
import { convertToMeters, drawingExtent, resolveDrawingUnit } from '../../src/core/plan/units';
import type { DrawingUnit } from '../../src/core/plan/types';
import { doorBlock, writeDxf } from './helpers/dxfWriter';

// ---- helpers ------------------------------------------------------------------------------------------------------

type Pair = [number, string | number];
const dxf = (pairs: Pair[]): string => pairs.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';
const section = (name: string, body: Pair[]): Pair[] => [[0, 'SECTION'], [2, name], ...body, [0, 'ENDSEC']];
const header = (vars: Pair[]): Pair[] => section('HEADER', vars);
const line = (layer: string, x1: number, y1: number, x2: number, y2: number): Pair[] => [
  [0, 'LINE'], [8, layer], [10, x1], [20, y1], [11, x2], [21, y2],
];
const block = (name: string, body: Pair[]): Pair[] => [[0, 'BLOCK'], [8, '0'], [2, name], [70, 0], [10, 0], [20, 0], [3, name], ...body, [0, 'ENDBLK']];
const insert = (name: string, layer: string, x = 0, y = 0): Pair[] => [[0, 'INSERT'], [8, layer], [2, name], [10, x], [20, y]];
const withVersion = (v: string): Pair[] => header([[9, '$ACADVER'], [1, v]]);

function readOk(text: string) {
  const r = readDxf(text, 'plan.dxf');
  if (r.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`);
  return r;
}
function errorOf(r: ReadDxfResult) {
  if (r.status !== 'invalid') throw new Error('expected invalid');
  return r.errors[0]!;
}
function flat(text: string, metersPerUnit = 1) {
  const r = readOk(text);
  const f = flattenEntities(r.document.drawing, { fileName: 'plan.dxf', metersPerUnit });
  return { read: r, flat: f };
}
function flatEntities(text: string, metersPerUnit = 1): FlatEntity[] {
  const { flat: f } = flat(text, metersPerUnit);
  if (!f.ok) throw new Error('flatten failed');
  return f.entities;
}
function flatWarnings(text: string, metersPerUnit = 1) {
  const { read, flat: f } = flat(text, metersPerUnit);
  return [...read.warnings, ...(f.ok ? f.warnings : [])];
}

// ---- version (Req 1.2, 1.9) -------------------------------------------------------------------------------------

describe('DXF version', () => {
  it('a missing $ACADVER reads as AC1009 with one DXF_VERSION_MISSING warning (Req 1.2)', () => {
    const r = readOk(dxf([...header([[9, '$INSUNITS'], [70, 6]]), ...section('ENTITIES', line('A', 0, 0, 1, 0)), [0, 'EOF']]));
    expect(r.document.version).toBe('AC1009');
    expect(r.warnings.filter((w) => w.code === 'DXF_VERSION_MISSING')).toHaveLength(1);
  });

  it('a stated supported version raises no version warning', () => {
    const r = readOk(writeDxf({ entities: [{ type: 'LINE', layer: 'A', a: [0, 0], b: [1, 0] }], acadVer: 'AC1032' }));
    expect(r.document.version).toBe('AC1032');
    expect(r.warnings.some((w) => w.code === 'DXF_VERSION_MISSING')).toBe(false);
  });

  it.each(['AC1006', 'AC1033', 'AC9999', 'banana'])('version %s is invalid and the message names it and the way out (Req 1.9)', (v) => {
    const e = errorOf(readDxf(dxf([...withVersion(v), ...section('ENTITIES', []), [0, 'EOF']]), 'plan.dxf'));
    expect(e.code).toBe('DXF_VERSION_UNSUPPORTED');
    expect(e.message).toContain(v);
    expect(e.message).toContain('Save as DXF (ASCII)');
  });

  it('a very long version string is shortened in the message', () => {
    const e = errorOf(readDxf(dxf([...withVersion('AC' + 'x'.repeat(500)), [0, 'EOF']]), 'plan.dxf'));
    expect(e.message.length).toBeLessThan(300);
  });
});

// ---- not ASCII DXF (Req 1.8) --------------------------------------------------------------------------------------

describe('files that are not ASCII DXF', () => {
  const cases: [string, string][] = [
    ['binary DXF', 'AutoCAD Binary DXF\r\n\x1a\x00rest'],
    ['DWG', 'AC1015\x00\x00\x00\x00\x00\x00\x00binary'],
    ['PDF', '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj'],
    ['PNG', '\u0089PNG\r\n\x1a\n\x00\x00\x00\rIHDR'],
  ];
  it.each(cases)('%s gives an error that says "Save as DXF (ASCII)"', (_name, text) => {
    const e = errorOf(readDxf(text, 'plan.dxf'));
    expect(e.code).toBe('DXF_NOT_ASCII');
    expect(e.message).toContain('Save as DXF (ASCII)');
  });
});

// ---- skipped entities (Req 1.6) ----------------------------------------------------------------------------------

describe('skipped entity types', () => {
  it('counts each skipped type and gives one warning per type', () => {
    const body: Pair[] = [
      [0, 'TEXT'], [8, 'T'], [0, 'TEXT'], [8, 'T'], [0, 'TEXT'], [8, 'T'],
      [0, 'HATCH'], [8, 'H'],
      [0, 'DIMENSION'], [8, 'D'], [0, 'DIMENSION'], [8, 'D'],
      ...line('A', 0, 0, 1, 0),
    ];
    const w = readOk(dxf([...withVersion('AC1027'), ...section('ENTITIES', body), [0, 'EOF']])).warnings.filter((x) => x.code === 'DXF_ENTITY_SKIPPED');
    expect(w).toHaveLength(3);
    expect(w.find((x) => x.message.includes('TEXT'))!.message).toContain('3 TEXT');
    expect(w.find((x) => x.message.includes('HATCH'))!.message).toContain('1 HATCH');
    expect(w.find((x) => x.message.includes('DIMENSION'))!.message).toContain('2 DIMENSION');
  });
});

// ---- geometry through the public path (Req 1.4, 1.5) -------------------------------------------------------------

describe('bulge and blocks', () => {
  it('an LWPOLYLINE bulge of 1 is kept as a half-circle arc segment (Req 1.4)', () => {
    const text = dxf([
      ...section('ENTITIES', [[0, 'LWPOLYLINE'], [8, 'W'], [90, 2], [70, 0], [10, 0], [20, 0], [42, 1], [10, 2], [20, 0]]),
      [0, 'EOF'],
    ]);
    const p = flatEntities(text)[0] as Extract<FlatEntity, { kind: 'POLYLINE' }>;
    expect(p.kind).toBe('POLYLINE');
    expect(p.vertices[0]!.bulge).toBe(1);
    const ext = drawingExtent([p])!;
    expect(ext.widthM).toBeCloseTo(2); // chord length
    expect(ext.depthM).toBeCloseTo(1); // half circle of radius 1 bulges by 1
  });

  it('a nested INSERT is flattened with both insertion points applied (Req 1.5)', () => {
    const text = writeDxf({
      blocks: [
        { name: 'LEAF', entities: [{ type: 'LINE', layer: '0', a: [0, 0], b: [1, 0] }] },
        { name: 'MID', entities: [{ type: 'INSERT', layer: '0', block: 'LEAF', at: [2, 0] }] },
      ],
      entities: [{ type: 'INSERT', layer: 'A-DOOR', block: 'MID', at: [10, 5] }],
    });
    const e = flatEntities(text)[0] as Extract<FlatEntity, { kind: 'LINE' }>;
    expect([e.x1, e.y1, e.x2, e.y2]).toEqual([12, 5, 13, 5]);
    expect(e.layer).toBe('A-DOOR');
  });

  it('a door block written by the helper keeps its swing arc', () => {
    const text = writeDxf({ blocks: [doorBlock('DOOR', 0.9)], entities: [{ type: 'INSERT', layer: 'A-DOOR', block: 'DOOR', at: [0, 0] }] });
    expect(flatEntities(text).map((x) => x.kind)).toEqual(['LINE', 'ARC']);
  });
});

// ---- block cycle, depth, range, cap (Req 3.3, 3.4, 3.5) ----------------------------------------------------------

describe('limits on untrusted drawings', () => {
  it('a block that contains itself is skipped once, with one warning naming it (Req 3.4)', () => {
    const text = dxf([
      ...section('BLOCKS', block('LOOP', [...line('0', 0, 0, 1, 0), ...insert('LOOP', '0')])),
      ...section('ENTITIES', insert('LOOP', 'A')),
      [0, 'EOF'],
    ]);
    const w = flatWarnings(text).filter((x) => x.code === 'DXF_BLOCK_CYCLE_OR_DEPTH');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toContain('"LOOP"');
  });

  it('two blocks that contain each other are skipped without hanging (Req 3.4)', () => {
    const text = dxf([
      ...section('BLOCKS', [...block('PING', [...line('0', 0, 0, 1, 0), ...insert('PONG', '0')]), ...block('PONG', insert('PING', '0'))]),
      ...section('ENTITIES', insert('PING', 'A')),
      [0, 'EOF'],
    ]);
    expect(flatWarnings(text).some((x) => x.code === 'DXF_BLOCK_CYCLE_OR_DEPTH')).toBe(true);
  });

  const chain = (levels: number): string => {
    const blocks: Pair[] = [...block('B0', line('0', 0, 0, 1, 0))];
    for (let i = 1; i < levels; i++) blocks.push(...block(`B${i}`, insert(`B${i - 1}`, '0')));
    return dxf([...section('BLOCKS', blocks), ...section('ENTITIES', insert(`B${levels - 1}`, 'A')), [0, 'EOF']]);
  };

  it('nesting 8 levels deep is read (Req 3.4)', () => {
    expect(flatEntities(chain(8))).toHaveLength(1);
    expect(flatWarnings(chain(8)).some((x) => x.code === 'DXF_BLOCK_CYCLE_OR_DEPTH')).toBe(false);
  });

  it('nesting 9 levels deep is skipped with a warning naming the block (Req 3.4)', () => {
    expect(flatEntities(chain(9))).toHaveLength(0);
    const w = flatWarnings(chain(9)).filter((x) => x.code === 'DXF_BLOCK_CYCLE_OR_DEPTH');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toContain('"B0"');
  });

  it('a coordinate 1500 m from the origin is dropped, one warning names layer and type (Req 3.5)', () => {
    const text = dxf([...section('ENTITIES', [...line('A-WALL', 0, 0, 1500, 0), ...line('A-WALL', 0, 0, 5, 0)]), [0, 'EOF']]);
    expect(flatEntities(text, 1)).toHaveLength(1);
    const w = flatWarnings(text, 1).filter((x) => x.code === 'DXF_COORDINATE_OUT_OF_RANGE');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toContain('"A-WALL"');
    expect(w[0]!.message).toContain('LINE');
  });

  it('the range is checked in metres: the same numbers in millimetres are kept (Req 3.5)', () => {
    const text = dxf([...section('ENTITIES', line('A', 0, 0, 1500, 0)), [0, 'EOF']]);
    expect(flatEntities(text, 0.001)).toHaveLength(1);
  });

  it('a coordinate of exactly 1000 m is kept, 1000.5 m is dropped (Req 3.5)', () => {
    const at = (x: number): string => dxf([...section('ENTITIES', line('A', 0, 0, x, 0)), [0, 'EOF']]);
    expect(flatEntities(at(1000))).toHaveLength(1);
    expect(flatEntities(at(1000.5))).toHaveLength(0);
  });

  it('the entity cap is exact: the cap is accepted, one more is an error naming the count (Req 3.3)', () => {
    const many = (n: number): string => dxf([...section('ENTITIES', Array.from({ length: n }, (): Pair[] => [[0, 'TEXT'], [8, 'T']]).flat()), [0, 'EOF']]);
    expect(readDxf(many(DXF_MAX_ENTITIES), 'plan.dxf').status).toBe('ok');
    const e = errorOf(readDxf(many(DXF_MAX_ENTITIES + 1), 'plan.dxf'));
    expect(e.code).toBe('DXF_TOO_MANY_ENTITIES');
    expect(e.message).toContain(String(DXF_MAX_ENTITIES + 1));
    expect(e.message).toContain(String(DXF_MAX_ENTITIES));
  });
});

// ---- malformed text (Req 3.6) -----------------------------------------------------------------------------------

describe('malformed files name the line', () => {
  const valid = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'A', '10', '0', '20', '0', '11', '1', '21', '0', '0', 'ENDSEC', '0', 'EOF'];

  it('baseline file reads', () => {
    expect(readDxf(valid.join('\n') + '\n', 'plan.dxf').status).toBe('ok');
  });

  it('an odd line count (group code with no value) names its line', () => {
    const text = valid.slice(0, 9).join('\n'); // ends on the code "10"
    const e = errorOf(readDxf(text, 'plan.dxf'));
    expect(e.code).toBe('DXF_MALFORMED');
    expect(e.message).toContain('line 9');
  });

  it('a group code that is not a whole number names its line', () => {
    const lines = [...valid];
    lines[8] = 'ten'; // code line of the "10" pair, line 9
    const e = errorOf(readDxf(lines.join('\n') + '\n', 'plan.dxf'));
    expect(e.code).toBe('DXF_MALFORMED');
    expect(e.message).toContain('line 9');
    expect(e.message).toContain('"ten"');
  });

  it('a group code outside 0 to 1071 names its line', () => {
    const lines = [...valid];
    lines[8] = '5000';
    const e = errorOf(readDxf(lines.join('\n') + '\n', 'plan.dxf'));
    expect(e.message).toContain('line 9');
  });

  it('an unparseable number names the line of the value', () => {
    const lines = [...valid];
    lines[9] = '1.2.3'; // value of the "10" pair, line 10
    const e = errorOf(readDxf(lines.join('\n') + '\n', 'plan.dxf'));
    expect(e.code).toBe('DXF_MALFORMED');
    expect(e.message).toContain('line 10');
    expect(e.message).toContain('"1.2.3"');
  });

  it('text with no SECTION is invalid, not a throw', () => {
    expect(readDxf('0\nEOF\n', 'plan.dxf').status).toBe('invalid');
    expect(readDxf('', 'plan.dxf').status).toBe('invalid');
  });

  it('CRLF line endings read the same as LF', () => {
    expect(readDxf(valid.join('\r\n') + '\r\n', 'plan.dxf').status).toBe('ok');
  });
});

// ---- units (Req 2.1, 2.2, 2.4, 2.5) -----------------------------------------------------------------------------

describe('drawing units', () => {
  const headerOf = (insUnits: number | null, measurement: number | null = null) => {
    const vars: Pair[] = [];
    if (insUnits !== null) vars.push([9, '$INSUNITS'], [70, insUnits]);
    if (measurement !== null) vars.push([9, '$MEASUREMENT'], [70, measurement]);
    return readOk(dxf([...header(vars), ...section('ENTITIES', []), [0, 'EOF']])).document.header;
  };

  const table: [number, DrawingUnit, number][] = [
    [1, 'in', 0.0254],
    [2, 'ft', 0.3048],
    [4, 'mm', 0.001],
    [5, 'cm', 0.01],
    [6, 'm', 1],
  ];
  it.each(table)('$INSUNITS %i resolves to %s at %f m per unit (Req 2.1)', (code, unit, mpu) => {
    const r = resolveDrawingUnit('plan.dxf', headerOf(code));
    expect(r).toMatchObject({ status: 'resolved', unit, metersPerUnit: mpu, source: 'insunits', overridesInsUnits: false });
  });

  it('a 3 m wall drawn in each unit measures 3 m after conversion (Req 2.1)', () => {
    for (const [code, , mpu] of table) {
      const text = writeDxf({ entities: [{ type: 'LINE', layer: 'A', a: [0, 0], b: [3, 0] }], unit: ({ 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' } as const)[code as 1 | 2 | 4 | 5 | 6] });
      const doc = readOk(text).document;
      const u = resolveDrawingUnit('plan.dxf', doc.header);
      expect(u.status).toBe('resolved');
      const ents = convertToMeters(flatEntities(text, mpu), mpu);
      expect(drawingExtent(ents)!.widthM).toBeCloseTo(3, 6);
    }
  });

  it('$INSUNITS 0 asks the user and suggests inches for $MEASUREMENT 0 (Req 2.2)', () => {
    const r = resolveDrawingUnit('plan.dxf', headerOf(0, 0));
    expect(r.status).toBe('pending');
    if (r.status === 'pending') {
      expect(r.question).toMatchObject({ kind: 'DRAWING_UNIT', fileName: 'plan.dxf', suggestedUnit: 'in' });
      expect(r.warning.code).toBe('UNIT_UNKNOWN');
    }
  });

  it('$INSUNITS 0 with $MEASUREMENT 1 suggests millimetres (Req 2.2)', () => {
    const r = resolveDrawingUnit('plan.dxf', headerOf(0, 1));
    expect(r.status === 'pending' && r.question.suggestedUnit).toBe('mm');
  });

  it('an absent $INSUNITS is unitless too (Req 2.2)', () => {
    expect(resolveDrawingUnit('plan.dxf', headerOf(null, 0)).status).toBe('pending');
  });

  it.each([3, 7, 21, 99])('an $INSUNITS value outside the table (%i) is unknown and asks the user (Req 2.4)', (code) => {
    expect(resolveDrawingUnit('plan.dxf', headerOf(code, 1)).status).toBe('pending');
  });

  it('a user-chosen unit answers a pending question (Req 2.5)', () => {
    const r = resolveDrawingUnit('plan.dxf', headerOf(0), 'cm');
    expect(r).toMatchObject({ status: 'resolved', unit: 'cm', metersPerUnit: 0.01, source: 'user', overridesInsUnits: false });
  });

  it('a user-chosen unit wins over $INSUNITS and is flagged as an override (Req 2.5)', () => {
    const r = resolveDrawingUnit('plan.dxf', headerOf(4), 'm');
    expect(r).toMatchObject({ status: 'resolved', unit: 'm', metersPerUnit: 1, source: 'user', overridesInsUnits: true });
  });

  it('a user choice equal to $INSUNITS is not an override', () => {
    const r = resolveDrawingUnit('plan.dxf', headerOf(4), 'mm');
    expect(r).toMatchObject({ status: 'resolved', overridesInsUnits: false });
  });

  it('an invalid user choice is ignored', () => {
    expect(resolveDrawingUnit('plan.dxf', headerOf(4), 'furlong')).toMatchObject({ status: 'resolved', unit: 'mm', source: 'insunits' });
    expect(resolveDrawingUnit('plan.dxf', headerOf(0), 'toString').status).toBe('pending');
  });
});
