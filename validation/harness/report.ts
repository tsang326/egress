// Report_Generator (fire-zone Req 13.8, 13.10 to 13.12, 6.13). Node and test use only.
// `renderReport` is a pure function: same input, same string. The verdicts come from the harness; this module
// never reads tolerances and never changes a case result.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaseComparison, QuantitySummary, RunDifference } from './compare';
import { KNOWN_CAUSES } from './knownCauses';
import { PUBLISHED_STECKLER, type PublishedSteckerRecord } from './published/steckler';

/** Verdict words used in the report. They describe a comparison with CFAST, never a building. */
export type CaseVerdict = 'within tolerance' | 'outside tolerance' | 'unsupported';

/** One case as the Validation_Suite hands it over. */
export interface CaseResult {
  /** Path of the `.in` file relative to the repository root, with `/` separators. */
  readonly path: string;
  readonly verdict: CaseVerdict;
  /** Why the case is outside tolerance or unsupported when there is no comparison (missing reference, parser error, ...). */
  readonly reason?: string;
  /** Comparison of the CFAST-order run. Absent when the case never reached the comparison. */
  readonly comparison?: CaseComparison;
  /** CFAST-order run versus intended-order run. Absent when the second run did not happen. */
  readonly runDifference?: RunDifference;
  /** Req 5.10: run with the CFAST roof-vent outside density versus the run with the real ambient density. */
  readonly roofVentDifference?: RunDifference;
  /** Req 13.14: why a difference block has no data because its run was stopped (or not started) at the wall-clock limit. */
  readonly runDifferenceUnavailable?: string;
  readonly roofVentDifferenceUnavailable?: string;
  /** Req 6.14: door-jet setting used by the verdict run (the CFAST input's setting). There is no comparison run. */
  readonly doorJetSetting?: 'on' | 'off';
  /** Req 8.10: species mass changed by the synchronisation over the verdict run, per species, kg. */
  readonly speciesSync?: { readonly netKg: Readonly<Record<string, number>>; readonly absKg: Readonly<Record<string, number>> };
}

/** Mandatory statement (Req 13.12). */
export const REFERENCE_STATEMENT =
  'This model is a reference simulation. Its results do not show that any building is safe or compliant.';

const NIST_STATEMENT =
  'CFAST is software of the National Institute of Standards and Technology (NIST). The input files under ' +
  '`validation/cases/` come from the NIST CFAST repository and the reference outputs under `validation/reference/` ' +
  'were produced by running NIST CFAST 7.7.7 on them. NIST is the source of all CFAST values in this report. ' +
  'The NIST software notice is kept in `validation/NIST-NOTICE.md`.';

const DIGITISED_NOTE =
  'The CFAST and measured values in the Steckler tables are digitised from the vector plots of the CFAST Validation ' +
  'Guide (Appendix C.17) by `tools/steckler/digitise.ts`. They are not printed in the Guide, carry a reading ' +
  'uncertainty of about 0.1 °C and 0.01 m, and are not a criterion for any verdict. Temperatures are absolute values ' +
  'in °C. The Guide does not state the time or averaging period of the profiles.';

/** Fixed number format: 5 significant digits, no locale. */
export function formatNumber(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (x === 0) return '0';
  return String(Number(x.toPrecision(5)));
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function row(cells: readonly string[]): string {
  return `| ${cells.map(cell).join(' | ')} |`;
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [row(header), row(header.map(() => '---')), ...rows.map(row)];
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0; // code-unit order, independent of locale
}

function steckerTestOf(path: string): number | undefined {
  const m = /(?:^|\/)Steckler_(\d+)\.in$/i.exec(path);
  return m ? Number(m[1]) : undefined;
}

function pageText(r: PublishedSteckerRecord): string {
  return `printed p. ${r.printedPage}, PDF p. ${r.pdfPage}`;
}

function steckerSection(test: number): string[] {
  const rec = PUBLISHED_STECKLER.find((r) => r.test === test);
  const header = [
    'Test',
    'Quantity',
    'CFAST (Validation Guide, digitised)',
    'Measured (Validation Guide, digitised)',
  ];
  const rows = rec
    ? [
        [
          String(test),
          `${rec.quantity} (${rec.unit})`,
          `${formatNumber(rec.cfast)} ${rec.unit}, layer height ${formatNumber(rec.cfastLayerHeightM)} m (${pageText(rec)})`,
          `${formatNumber(rec.measured)} ${rec.unit} at ${formatNumber(rec.measuredMaxHeightM)} m (${pageText(rec)})`,
        ],
      ]
    : [[String(test), 'n/a', 'n/a', 'n/a']];
  return ['**Published Steckler values**', '', ...table(header, rows), '', `Note: ${DIGITISED_NOTE}`, ''];
}

function differenceSection(
  d: RunDifference | undefined,
  head: string,
  gateLabel: string,
  otherLabel: string,
  unavailable?: string,
): string[] {
  if (!d && unavailable) return [head, '', `Not available: ${unavailable}`, ''];
  if (!d) return [head, '', 'Not available: the second run did not take place or did not end with status "ok".', ''];
  if (!d.differs) return [head, '', 'no difference', ''];
  return [
    head,
    '',
    `Largest absolute difference: ${formatNumber(d.largestAbsDifference)} in ${d.quantity} of ${d.entity} at ${formatNumber(d.timeS)} s ` +
      `(${gateLabel} ${formatNumber(d.cfastOrderValue)}, ${otherLabel} ${formatNumber(d.intendedOrderValue)}).`,
    '',
  ];
}

function runDifferenceSection(d: RunDifference | undefined, unavailable?: string): string[] {
  return differenceSection(
    d,
    '**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)',
    'CFAST-order run',
    'intended-order run',
    unavailable,
  );
}

function roofVentSection(d: RunDifference | undefined, unavailable?: string): string[] {
  return differenceSection(
    d,
    '**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)',
    'CFAST density run',
    'ambient density run',
    unavailable,
  );
}

function doorJetSection(r: CaseResult): string[] {
  if (r.doorJetSetting === undefined) return [];
  return [`**Door-jet fires ${r.doorJetSetting}** (Req 6.14; setting of the CFAST input, used by the verdict run)`, ''];
}

const SYNC_SPECIES = ['o2', 'co2', 'co', 'h2o', 'soot', 'n2', 'uhc'] as const;

function speciesSyncSection(s: CaseResult['speciesSync']): string[] {
  if (!s) return [];
  return [
    '**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to ' +
      'its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run',
    '',
    ...table(
      ['Species', 'Net change (kg)', 'Sum of absolute changes (kg)'],
      SYNC_SPECIES.map((k) => [k, formatNumber(s.netKg[k] ?? Number.NaN), formatNumber(s.absKg[k] ?? Number.NaN)]),
    ),
    '',
  ];
}

const METHOD_LINES: readonly string[] = [
  '## Method',
  '',
  '- Time matching: a reference row is matched to the model sample within 1e-3 s of its time. Reason: CFAST writes some ' +
    'rows up to 8.6e-5 s before the nominal output time when an event falls on it (for example 839.9999 s for 840 s in ' +
    'DelCo Test_02, and 999.99992 s in species_mass_4). Model samples are at least 10 s apart, so the window cannot pick ' +
    'the wrong sample. This is time matching only, not a tolerance on any value.',
  '- Leakage vents are compared on their single net-flow column. Reason: CFAST writes only the net flow (`L_` column) ' +
    'for a leakage vent and no layer flows.',
  '- Ceiling and floor vents are compared as the net flow into each layer of the bottom compartment, split by sign into ' +
    'inflow and outflow. Reason: that is what CFAST writes (outputspreadsheet.f90 writes max(0, mflow) and max(0, -mflow), ' +
    'and flowvertical.f90 accumulates in mflow the net flow per layer of the bottom compartment).',
  '- One-zone compartments (Req 13.13): where the reference has no lower layer temperature and no layer height column, ' +
    'only the columns it has are compared; the quantities not compared are listed under each case with the reason. This ' +
    'is not a failure by itself.',
  '- Verdict run: CFAST upper plume argument order (Req 6.13), CFAST roof-vent outside density (Req 5.10) and the ' +
    'door-jet setting of the CFAST input (Req 6.14; on unless the input says `DOOR_JET_FIRE_SUB_MODEL = \'OFF\'`). Each case ' +
    'is also run with each of the first two options off, and the difference is shown under the case. A case with a fire ' +
    'and a wall vent between two compartments is also run with the opposite door-jet setting; other cases cannot differ.',
  '',
];

function comparisonSection(c: CaseComparison): string[] {
  const out: string[] = [];
  const rows = c.summaries.map((s) => [
    s.entity,
    s.quantity,
    formatNumber(s.worstTimeS),
    formatNumber(s.worstCfastValue),
    formatNumber(s.worstModelValue),
    formatNumber(s.worstModelValue - s.worstCfastValue),
    String(s.pointsChecked),
    String(s.failures),
    s.failures === 0 ? 'within tolerance' : 'outside tolerance',
  ]);
  out.push(
    ...table(
      ['Entity', 'Quantity', 'Time (s)', 'CFAST value', 'Model value', 'Difference (model - CFAST)', 'Points checked', 'Points outside', 'Result'],
      rows,
    ),
    '',
    'Each row shows the time of the largest deviation from the allowed difference.',
    '',
  );
  if (c.missingModelTimesS.length > 0) {
    out.push(`Reference times with no model sample (s): ${c.missingModelTimesS.map(formatNumber).join(', ')}`, '');
  }
  if (c.missingReference.length > 0) {
    out.push('Model quantities with no reference column:', '', ...c.missingReference.map((m) => `- ${m}`), '');
  }
  if (c.notCompared.length > 0) {
    out.push(
      'Quantities not compared (Req 13.13, not a failure by itself):',
      '',
      ...c.notCompared.map((n) => `- ${n.entity}: ${n.quantity}. Reason: ${n.reason}.`),
      '',
    );
  }
  if (c.failures.length > 0) {
    out.push(
      '<details>',
      `<summary>All ${c.failures.length} time points outside tolerance</summary>`,
      '',
      ...table(
        ['Entity', 'Quantity', 'Time (s)', 'CFAST value', 'Model value', 'Difference (model - CFAST)'],
        c.failures.map((f) => [f.entity, f.quantity, formatNumber(f.timeS), formatNumber(f.cfastValue), formatNumber(f.modelValue), formatNumber(f.difference)]),
      ),
      '',
      '</details>',
      '',
    );
  }
  return out;
}

/** The summary row with the largest ratio of difference to allowed difference (first one on a tie). */
function worstSummary(c: CaseComparison): QuantitySummary | undefined {
  let best: QuantitySummary | undefined;
  for (const s of c.summaries) if (!best || s.worstRatio > best.worstRatio) best = s;
  return best;
}

function worstLine(c: CaseComparison): string[] {
  const w = worstSummary(c);
  if (!w) return [];
  return [
    `Closest to the limit: ${w.entity}, ${w.quantity} at ${formatNumber(w.worstTimeS)} s. CFAST ${formatNumber(w.worstCfastValue)}, ` +
      `model ${formatNumber(w.worstModelValue)}, ratio of difference to allowed difference ${formatNumber(w.worstRatio)} ` +
      '(above 1 is outside tolerance).',
    '',
  ];
}

function knownCauseSection(r: CaseResult, causes: Readonly<Record<string, string>>): string[] {
  const text = causes[r.path];
  return text === undefined ? [] : ['**Known cause**', '', text, ''];
}

function caseSection(r: CaseResult, causes: Readonly<Record<string, string>>): string[] {
  const out = [`### ${r.path}`, '', `Result: **${r.verdict}**`, ''];
  if (r.reason) out.push(`Reason: ${r.reason}`, '');
  if (r.comparison) out.push(...worstLine(r.comparison), ...comparisonSection(r.comparison));
  else out.push('No comparison with CFAST was made for this case.', '');
  out.push(...knownCauseSection(r, causes));
  out.push(...runDifferenceSection(r.runDifference, r.runDifferenceUnavailable));
  out.push(...roofVentSection(r.roofVentDifference, r.roofVentDifferenceUnavailable));
  out.push(...doorJetSection(r));
  out.push(...speciesSyncSection(r.speciesSync));
  const test = steckerTestOf(r.path);
  if (test !== undefined) out.push(...steckerSection(test));
  return out;
}

/** Renders the whole report. Pure and deterministic; cases are sorted by path. */
export function renderReport(
  caseResults: readonly CaseResult[],
  causes: Readonly<Record<string, string>> = KNOWN_CAUSES,
): string {
  const cases = [...caseResults].sort((a, b) => comparePaths(a.path, b.path));
  const count = (v: CaseVerdict): number => cases.filter((c) => c.verdict === v).length;

  const lines: string[] = [
    '# Validation report: Fire_Model compared with CFAST 7.7.7',
    '',
    `> ${REFERENCE_STATEMENT}`,
    '',
    NIST_STATEMENT,
    '',
    'All cases are listed as they came out, including cases where the model differs from CFAST and cases where CFAST ' +
      'differs from the measurements. Nothing is left out or changed.',
    '',
    '## Summary',
    '',
    ...table(
      ['Within tolerance', 'Outside tolerance', 'Unsupported', 'Total'],
      [[String(count('within tolerance')), String(count('outside tolerance')), String(count('unsupported')), String(cases.length)]],
    ),
    '',
    ...table(
      ['Case', 'Result', 'Points checked', 'Points outside', 'Reason'],
      cases.map((c) => [
        c.path,
        c.verdict,
        c.comparison ? String(c.comparison.pointsChecked) : 'n/a',
        c.comparison ? String(c.comparison.failures.length) : 'n/a',
        c.reason ?? '',
      ]),
    ),
    '',
  ];
  const outside = cases.filter((c) => c.verdict === 'outside tolerance');
  if (outside.length > 0) {
    lines.push('## Known causes', '', 'Cases outside tolerance and what is known about each difference.', '');
    for (const c of outside) {
      const w = c.comparison ? worstSummary(c.comparison) : undefined;
      const numbers = w
        ? `Worst: ${w.entity}, ${w.quantity} at ${formatNumber(w.worstTimeS)} s, CFAST ${formatNumber(w.worstCfastValue)}, ` +
          `model ${formatNumber(w.worstModelValue)}, ratio ${formatNumber(w.worstRatio)}. `
        : '';
      lines.push(`- \`${c.path}\`: ${numbers}${causes[c.path] ?? 'Cause not yet identified.'}`);
    }
    lines.push('');
  }
  lines.push(...METHOD_LINES, '## Cases', '');
  for (const c of cases) lines.push(...caseSection(c, causes));
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}

/** Default output: `validation/REPORT.md` next to the harness directory. */
export const DEFAULT_REPORT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'REPORT.md');

/** Writes the report and returns its text. */
export function writeReport(caseResults: readonly CaseResult[], outPath: string = DEFAULT_REPORT_PATH): string {
  const text = renderReport(caseResults);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text, 'utf8');
  return text;
}
