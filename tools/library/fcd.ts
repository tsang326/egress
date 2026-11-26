// Builds src/core/fire/library/fcdItems.json from NIST Fire Calorimetry Database (FCD) CSV files (run-view spec,
// Requirement 3.5). Never imported by the app.
//
// Data: NIST Fire Calorimetry Database, https://doi.org/10.18434/mds2-2314 (public domain, NIST). Methods: Bryant and
// Bundy, NIST TN 2077 (2019), https://doi.org/10.6028/NIST.TN.2077. Each item below names its test page and CSV file.
//
// Usage: download the CSV of each test from its page (the "Download CSV data file" link) into one folder, named
// testNNN.csv, then:
//   npx esbuild tools/library/fcd.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/egress-fcd.mjs
//   node node_modules/.cache/egress-fcd.mjs <csv-folder>
//
// Mapping from a published curve to HrrRow (the "downscale" step):
// 1. Specimen HRR = "Heat Release Rate (kW)" minus "Burner HRR (kW)" (the propane ignition wand), floored at 0.
// 2. Rows with time < 0 (the baseline before ignition) are dropped; t = 0 is ignition, as in the FCD event table.
// 3. The 1 s data is averaged over BIN_S bins (time at the bin start). Averaging keeps the energy of each bin.
// 4. The curve ends one bin after the last bin above END_FRACTION of the peak, with a final row at 0 W.
// The scalar values (THR, mass loss, effective heat of combustion, CO and soot yields) are copied from Table 2 of each
// test page; they are not recomputed here.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BIN_S = 10; // layout choice: 600 s run -> at most a few hundred rows per item
const END_FRACTION = 0.01; // layout choice: the tail below 1 % of the peak adds no heat that matters

interface Meta {
  id: string;
  name: string;
  test: string; // e.g. "Test016"
  pageUrl: string;
  dataPath: string; // path in the FCD file store, as linked from the page
  // From Table 2 of the test page.
  phrrKW: number;
  thrMJ: number;
  massLossKg: number;
  heatOfCombustionMJPerKg: number; // net effective heat of combustion = THR / NM
  coYield: number; // kg/kg
  sootYield: number; // kg/kg
  // Estimates for the fire model (not measured by the FCD).
  areaM2: number;
  baseHeightM: number;
}

const PAGE = 'https://www.nist.gov/el/fcd/design-fires-residential-and-office-items/';
const DATA = 'https://www.nist.gov/fcd-s3?path=/HRR/ASSET_FILES/DesignFires_Furniture/data/';

// Values copied from each test page (Table 2), read 2026-11-26.
export const ITEMS: Meta[] = [
  { id: 'stackable-chair', name: 'Stackable chair (particle board seat)', test: 'Test016', pageUrl: PAGE + 'test016', dataPath: DATA + '1701963874_Test016.csv', phrrKW: 621, thrMJ: 115.1, massLossKg: 3.241, heatOfCombustionMJPerKg: 35.5, coYield: 0.0339, sootYield: 0.061, areaM2: 0.25, baseHeightM: 0.45 },
  { id: 'armchair', name: 'Armchair (urethane and cotton)', test: 'Test022', pageUrl: PAGE + 'test022', dataPath: DATA + '1702325783_Test022.csv', phrrKW: 421, thrMJ: 49.2, massLossKg: 3.7, heatOfCombustionMJPerKg: 13.3, coYield: 0.0493, sootYield: 0.018, areaM2: 0.6, baseHeightM: 0.4 },
  { id: 'office-chair', name: 'Office chair', test: 'Test046', pageUrl: PAGE + 'test046', dataPath: DATA + '1702930602_Test046.csv', phrrKW: 563, thrMJ: 259, massLossKg: 6.992, heatOfCombustionMJPerKg: 37.1, coYield: 0.02291, sootYield: 0.044, areaM2: 0.4, baseHeightM: 0.45 },
  { id: 'sofa', name: 'Sofa, two-seat (polyurethane foam) with two pillows', test: 'Test035', pageUrl: PAGE + 'test035', dataPath: DATA + '1702565036_Test035.csv', phrrKW: 1823, thrMJ: 838, massLossKg: 48.557, heatOfCombustionMJPerKg: 17.27, coYield: 0.0356, sootYield: 0.0155, areaM2: 1.5, baseHeightM: 0.4 },
  { id: 'foam-mattress', name: 'Foam mattress on metal frame with two pillows', test: 'Test031', pageUrl: PAGE + 'test031', dataPath: DATA + '1702491667_Test031.csv', phrrKW: 897, thrMJ: 353, massLossKg: 14.914, heatOfCombustionMJPerKg: 23.7, coYield: 0.02489, sootYield: 0.0263, areaM2: 1.8, baseHeightM: 0.35 },
  { id: 'spring-mattress', name: 'Spring mattress with fire barrier, two pillows', test: 'Test026', pageUrl: PAGE + 'test026', dataPath: DATA + '1702406394_Test026.csv', phrrKW: 164, thrMJ: 82.5, massLossKg: 5.08, heatOfCombustionMJPerKg: 16.2, coYield: 0.0757, sootYield: 0.034, areaM2: 1.8, baseHeightM: 0.35 },
  { id: 'bookshelf', name: 'Bookshelf with a pillow', test: 'Test033', pageUrl: PAGE + 'test033', dataPath: DATA + '1702499287_Test033.csv', phrrKW: 79.2, thrMJ: 6.9, massLossKg: 1.164, heatOfCombustionMJPerKg: 5.9, coYield: 0.01406, sootYield: 0.0147, areaM2: 0.3, baseHeightM: 0.5 },
  { id: 'four-pillows', name: 'Four pillows (polypropylene)', test: 'Test010', pageUrl: PAGE + 'test010', dataPath: DATA + '1701880965_Test010.csv', phrrKW: 191.9, thrMJ: 40.1, massLossKg: 2.335, heatOfCombustionMJPerKg: 17.17, coYield: 0.02534, sootYield: 0.0431, areaM2: 0.5, baseHeightM: 0.4 },
];

export interface HrrPoint {
  timeS: number;
  hrrW: number;
}

/** Steps 1 to 4 of the mapping above, on the CSV text of one test. Pure. */
export function downscale(csv: string): HrrPoint[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]!.split(',');
  const iT = header.indexOf('Time (s)');
  const iH = header.indexOf('Heat Release Rate (kW)');
  const iB = header.indexOf('Burner HRR (kW)');
  if (iT < 0 || iH < 0 || iB < 0) throw new Error('unexpected FCD CSV header: ' + lines[0]);
  const sums = new Map<number, { s: number; n: number }>();
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const t = Number(c[iT]);
    if (!Number.isFinite(t) || t < 0) continue;
    const q = Math.max(0, Number(c[iH]) - Number(c[iB])) * 1000;
    if (!Number.isFinite(q)) continue;
    const bin = Math.floor(t / BIN_S) * BIN_S;
    const b = sums.get(bin) ?? { s: 0, n: 0 };
    b.s += q;
    b.n += 1;
    sums.set(bin, b);
  }
  const pts = [...sums.entries()].sort((a, b) => a[0] - b[0]).map(([timeS, b]) => ({ timeS, hrrW: Math.round(b.s / b.n) }));
  const peak = Math.max(...pts.map((p) => p.hrrW));
  let last = 0;
  pts.forEach((p, i) => {
    if (p.hrrW > END_FRACTION * peak) last = i;
  });
  const kept = pts.slice(0, last + 1);
  if (kept[0]!.timeS !== 0) kept.unshift({ timeS: 0, hrrW: 0 });
  kept.push({ timeS: kept[kept.length - 1]!.timeS + BIN_S, hrrW: 0 });
  return kept;
}

function main(csvDir: string): void {
  const out = ITEMS.map((m) => {
    const curve = downscale(readFileSync(join(csvDir, m.test.toLowerCase() + '.csv'), 'utf8'));
    return { ...m, curve };
  });
  const path = 'src/core/fire/library/fcdItems.json';
  writeFileSync(path, JSON.stringify(out, (_k, v) => (typeof v === 'number' && Number.isNaN(v) ? null : v)) + '\n', 'utf8');
  console.log(`wrote ${path}: ${out.map((o) => `${o.test} ${o.curve.length} rows`).join(', ')}`);
}

const arg = process.argv[2];
if (arg !== undefined) main(arg);
