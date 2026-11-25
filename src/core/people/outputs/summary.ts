// Scenario summary (Design, "Outputs"; Requirements 6.2, 6.3, 6.6). Counts come from the agent records, so they add up.
import type { AgentRecord, CrowdSummary } from '../types';
import { summaryText } from './text';
export function buildSummary(records: readonly AgentRecord[]): CrowdSummary {
  let out = 0;
  let incapacitated = 0;
  let stillInside = 0;
  let evacuationTimeS: number | null = null;
  for (const r of records) {
    if (r.finalState === 'out') {
      out++;
      if (r.exitTimeS !== null && (evacuationTimeS === null || r.exitTimeS > evacuationTimeS)) evacuationTimeS = r.exitTimeS;
    } else if (r.finalState === 'incapacitated') incapacitated++;
    else stillInside++;
  }
  const counts = { total: records.length, out, incapacitated, stillInside, evacuationTimeS };
  return { ...counts, text: summaryText(counts) };
}
