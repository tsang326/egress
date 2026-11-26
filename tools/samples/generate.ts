// Writes the three invented sample drawings to public/samples/ (plan-import spec, Requirements 18.1, 18.6, 18.8, 18.10).
//
// Never imported by the app. Run with `npm run samples` (bundled with esbuild, then run by node). The tests import
// `generateSamples` to compare the committed files byte for byte; importing does not write anything, only
// running with `--write` does.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBoardingHouse } from './boardingHouse';
import { buildCafe } from './cafe';
import { buildKaraoke } from './karaoke';

/** Output directory relative to the repository root. Not under public/fonts/ (Requirement 18.8). */
export const SAMPLES_DIR = 'public/samples';

/** File name to DXF text. Same text on every call (Requirement 18.6). */
export function generateSamples(): Record<string, string> {
  return {
    'cafe.dxf': buildCafe(),
    'karaoke.dxf': buildKaraoke(),
    'boarding-house.dxf': buildBoardingHouse(),
  };
}

function writeSamples(rootDir: string): void {
  const dir = join(rootDir, SAMPLES_DIR);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(generateSamples())) {
    writeFileSync(join(dir, name), text, 'utf8');
    console.log(`wrote ${join(SAMPLES_DIR, name)} (${text.length} characters)`);
  }
}

if (process.argv.includes('--write')) writeSamples(process.cwd());
