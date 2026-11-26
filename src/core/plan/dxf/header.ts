// HEADER section variables the importer needs (Req 1.1, 1.2, 2.1, 2.2): $ACADVER, $INSUNITS, $MEASUREMENT and the
// stated extents. Never throws; a variable that is absent or has the wrong type reads as null.
import { findSection } from './entities';
import type { GroupPair } from './tokenize';

export interface DxfHeader {
  acadVer: string | null; // $ACADVER, e.g. "AC1015"
  insUnits: number | null; // $INSUNITS
  measurement: number | null; // $MEASUREMENT: 0 English, 1 metric
  extMin: { x: number; y: number } | null; // $EXTMIN, drawing units; often stale in real files, so informational only
  extMax: { x: number; y: number } | null;
}

// Value pairs of the first occurrence of each header variable. A variable starts at a group 9 pair and runs to the
// next group 9 pair.
function variables(pairs: readonly GroupPair[], start: number, end: number): Map<string, GroupPair[]> {
  const vars = new Map<string, GroupPair[]>();
  let current: GroupPair[] | null = null;
  for (let i = start; i < end; i++) {
    const p = pairs[i] as GroupPair;
    if (p.code === 9) {
      const name = String(p.value).toUpperCase();
      if (vars.has(name)) {
        current = null; // keep the first occurrence
      } else {
        current = [];
        vars.set(name, current);
      }
    } else if (current !== null) {
      current.push(p);
    }
  }
  return vars;
}

function valueOf(body: readonly GroupPair[] | undefined, code: number): string | number | null {
  if (body === undefined) return null;
  for (const p of body) if (p.code === code) return p.value;
  return null;
}

function intOf(body: readonly GroupPair[] | undefined, code: number): number | null {
  const v = valueOf(body, code);
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function pointOf(body: readonly GroupPair[] | undefined): { x: number; y: number } | null {
  const x = valueOf(body, 10);
  const y = valueOf(body, 20);
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function readHeader(pairs: readonly GroupPair[]): DxfHeader {
  const section = findSection(pairs, 'HEADER');
  const empty: DxfHeader = { acadVer: null, insUnits: null, measurement: null, extMin: null, extMax: null };
  if (section === null) return empty;
  const vars = variables(pairs, section.start, section.end);
  const ver = valueOf(vars.get('$ACADVER'), 1);
  return {
    acadVer: typeof ver === 'string' && ver !== '' ? ver : null,
    insUnits: intOf(vars.get('$INSUNITS'), 70),
    measurement: intOf(vars.get('$MEASUREMENT'), 70),
    extMin: pointOf(vars.get('$EXTMIN')),
    extMax: pointOf(vars.get('$EXTMAX')),
  };
}

export const ACADVER_MIN = 1009; // AC1009 (R12), Req 1.1
export const ACADVER_MAX = 1032; // AC1032 (2018), Req 1.1

// Numeric part of a supported-format version string "AC10nn", or null when the string is not of that form.
export function acadVerNumber(ver: string): number | null {
  const m = /^AC(\d{4})$/.exec(ver.trim().toUpperCase());
  return m === null ? null : Number(m[1]);
}

export function isSupportedVersion(ver: string): boolean {
  const n = acadVerNumber(ver);
  return n !== null && n >= ACADVER_MIN && n <= ACADVER_MAX;
}
