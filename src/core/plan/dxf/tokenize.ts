// ASCII DXF tokenizer: text -> group-code/value pairs with line numbers (Req 1.8, 3.1, 3.2, 3.6, 3.8).
// Total over any string: it never throws and returns an error result instead (Req 3.1). One pass over the lines, so
// running time is linear in the input size, which is capped by DXF_MAX_BYTES (Req 3.8).
import { DXF_MAX_BYTES } from '../constants';
import { dxfMalformed, dxfNotAscii, dxfTooLarge } from '../warnings';
import type { ImportWarning } from '../types';

export interface GroupPair {
  code: number;
  value: string | number; // number for numeric group codes, trimmed string otherwise
  line: number; // 1-based line number of the group code line
}

export type TokenizeResult =
  | { ok: true; pairs: GroupPair[] }
  | { ok: false; error: ImportWarning };

// Largest group code defined by the DXF reference (extended data 1071).
const MAX_GROUP_CODE = 1071;

// Numeric syntax accepted for numeric group codes. Plain decimal with optional exponent, as written by CAD programs.
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const INTEGER_RE = /^[+-]?\d+$/;

// Value type by group code range, from the Autodesk DXF reference "Group Code Value Types".
// Handles (105, 320-369, 390-399, 480-481) and binary chunks (310-319) are strings and stay strings.
export function isNumericGroupCode(code: number): boolean {
  return (
    (code >= 10 && code <= 99) || // doubles 10-59, int16 60-79, int32 90-99; 80-89 unused
    (code >= 110 && code <= 149) || // doubles
    (code >= 160 && code <= 179) || // int64 160-169, int16 170-179
    (code >= 210 && code <= 239) || // doubles
    (code >= 270 && code <= 299) || // int16 270-289, bool 290-299
    (code >= 370 && code <= 389) || // int16
    (code >= 400 && code <= 409) || // int16
    (code >= 420 && code <= 429) || // int32
    (code >= 440 && code <= 469) || // int32, long, double
    (code >= 1010 && code <= 1071) // extended data doubles and ints
  );
}

// Signatures of files that are not ASCII DXF. A text DXF starts with a group code line (digits), never with these.
function looksNotAscii(text: string): boolean {
  if (text.startsWith('AutoCAD Binary DXF')) return true; // binary DXF sentinel
  if (/^AC10\d\d/.test(text)) return true; // DWG version stamp, e.g. AC1015
  if (text.startsWith('%PDF')) return true;
  const head = text.slice(0, 1024);
  if (head.slice(1, 4) === 'PNG') return true; // PNG (0x89 'PNG'), read as text
  if (head.startsWith('GIF8') || head.startsWith('BM') || head.startsWith('PK')) return true;
  if (head.charCodeAt(0) === 0xff || head.charCodeAt(0) === 0xfffd) return true; // JPEG / undecodable bytes
  // NUL or other C0 control characters (except tab, LF, CR) never occur in an ASCII DXF.
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(head);
}

function byteLengthExceeds(text: string, maxBytes: number): number | null {
  // A UTF-16 string of n code units needs at least n bytes and at most 3n bytes in UTF-8.
  if (text.length > maxBytes) return text.length; // already over the cap; exact size not needed for the message
  if (text.length * 3 <= maxBytes) return null;
  const bytes = new TextEncoder().encode(text).length;
  return bytes > maxBytes ? bytes : null;
}

export function tokenizeDxf(text: string, fileName: string): TokenizeResult {
  try {
    return tokenizeUnchecked(text, fileName);
  } catch {
    // Defensive only: the code below is written not to throw (Req 3.1).
    return { ok: false, error: dxfMalformed(fileName, 1, 'the file could not be read') };
  }
}

function tokenizeUnchecked(text: string, fileName: string): TokenizeResult {
  if (typeof text !== 'string') {
    return { ok: false, error: dxfMalformed(fileName, 1, 'the file content is not text') };
  }
  const tooBig = byteLengthExceeds(text, DXF_MAX_BYTES); // before any parsing (Req 3.2)
  if (tooBig !== null) return { ok: false, error: dxfTooLarge(fileName, tooBig) };
  if (looksNotAscii(text)) return { ok: false, error: dxfNotAscii(fileName) }; // Req 1.8

  const lines = text.split('\n');
  // A final newline leaves one empty element that is not a line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const pairs: GroupPair[] = [];

  for (let i = 0; i < lines.length; i += 2) {
    const lineNo = i + 1;
    const codeText = stripCr(lines[i] ?? '').trim();
    if (!INTEGER_RE.test(codeText)) {
      return { ok: false, error: dxfMalformed(fileName, lineNo, `"${shorten(codeText)}" is not a group code (a whole number was expected)`) };
    }
    const code = Number(codeText);
    if (code < 0 || code > MAX_GROUP_CODE) {
      return { ok: false, error: dxfMalformed(fileName, lineNo, `group code ${shorten(codeText)} is outside the range 0 to ${MAX_GROUP_CODE}`) };
    }
    if (i + 1 >= lines.length) {
      return { ok: false, error: dxfMalformed(fileName, lineNo, 'the file ends after a group code with no value (truncated file)') };
    }
    const raw = stripCr(lines[i + 1] ?? '').trim();
    if (isNumericGroupCode(code)) {
      if (!NUMBER_RE.test(raw)) {
        return { ok: false, error: dxfMalformed(fileName, lineNo + 1, `"${shorten(raw)}" is not a number (group code ${code})`) };
      }
      pairs.push({ code, value: Number(raw), line: lineNo });
    } else {
      pairs.push({ code, value: raw, line: lineNo });
      if (code === 0 && raw === 'EOF') break; // anything after EOF is ignored
    }
  }
  return { ok: true, pairs };
}

function stripCr(s: string): string {
  return s.endsWith('\r') ? s.slice(0, -1) : s;
}

// File content is untrusted and goes into a message; keep the quoted part short.
function shorten(s: string): string {
  return s.length > 40 ? `${s.slice(0, 40)}...` : s;
}
