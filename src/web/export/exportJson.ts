// "Download JSON" (run-view spec, Requirement 7.1): the setup, the fire Scenario and Result, the crowd result.
// Typed arrays become plain arrays; Infinity (visibility with no soot) becomes null, as JSON.stringify does.
import type { RunResult } from '../run/pipeline';
import { SAFETY_NOTICE } from '../plan/importScreen';

export function runToJson(run: RunResult): string {
  const body = {
    app: 'Egress',
    notice: SAFETY_NOTICE,
    building: run.session.title,
    setup: run.config,
    fireScenario: run.built.scenario,
    fireResult: run.fire,
    crowdResult: run.crowd,
  };
  return JSON.stringify(body, (_k, v: unknown) => (ArrayBuffer.isView(v) && !(v instanceof DataView) ? Array.from(v as unknown as ArrayLike<number>) : v));
}

/** Starts a browser download of `text` (or a data URL when `dataUrl` is set). */
export function download(fileName: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run';
}
