// readDxf: the single entry point of the DXF reader (Req 1, 3). Caps, tokenize, header, entities and blocks in one
// call. Total: any string gives `ok` or `invalid`, never a throw (Req 3.1, 3.6, 3.8). Geometry stays raw and in
// drawing units; units.ts resolves the unit, then flattenEntities (blocks.ts) applies INSERT transforms.
import type { ImportWarning } from '../types';
import { dxfMalformed, dxfVersionMissing, dxfVersionUnsupported } from '../warnings';
import { readDrawing } from './blocks';
import type { RawDrawing } from './blocks';
import { isSupportedVersion, readHeader } from './header';
import type { DxfHeader } from './header';
import { tokenizeDxf } from './tokenize';

export interface DxfDocument {
  fileName: string;
  version: string; // "AC10nn"; AC1009 when the file states none (Req 1.2)
  header: DxfHeader;
  drawing: RawDrawing;
}

export type ReadDxfResult =
  | { status: 'ok'; document: DxfDocument; warnings: ImportWarning[] }
  | { status: 'invalid'; errors: ImportWarning[]; warnings: ImportWarning[] };

const DEFAULT_VERSION = 'AC1009'; // Req 1.2

function invalid(error: ImportWarning): ReadDxfResult {
  return { status: 'invalid', errors: [error], warnings: [] };
}

export function readDxf(text: string, fileName = 'drawing.dxf'): ReadDxfResult {
  try {
    return readUnchecked(text, fileName);
  } catch {
    // Defensive only: the stages below are written not to throw (Req 3.8).
    return invalid(dxfMalformed(fileName, 1, 'the file could not be read'));
  }
}

function readUnchecked(text: string, fileName: string): ReadDxfResult {
  const tokens = tokenizeDxf(text, fileName); // size cap and binary/DWG/PDF detection happen here (Req 1.8, 3.2)
  if (!tokens.ok) return invalid(tokens.error);
  const pairs = tokens.pairs;
  if (!pairs.some((p, i) => p.code === 0 && p.value === 'SECTION' && pairs[i + 1]?.code === 2)) {
    return invalid(dxfMalformed(fileName, pairs[0]?.line ?? 1, 'no DXF section was found, so this does not look like a DXF file'));
  }

  const header = readHeader(pairs);
  const warnings: ImportWarning[] = [];
  let version = DEFAULT_VERSION;
  if (header.acadVer === null) {
    warnings.push(dxfVersionMissing(fileName)); // Req 1.2
  } else if (isSupportedVersion(header.acadVer)) {
    version = header.acadVer.trim().toUpperCase();
  } else {
    return invalid(dxfVersionUnsupported(fileName, shorten(header.acadVer))); // Req 1.9
  }

  const drawing = readDrawing(pairs, fileName);
  if (!drawing.ok) return invalid(drawing.error);
  warnings.push(...drawing.warnings);
  return { status: 'ok', document: { fileName, version, header, drawing: drawing.drawing }, warnings };
}

// The version string comes from the file and goes into a message; keep it short.
function shorten(s: string): string {
  return s.length > 20 ? `${s.slice(0, 20)}...` : s;
}
