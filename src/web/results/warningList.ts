// Warnings grouped by code (run-view spec, Requirement 5.7): one line per code with the first message and a count;
// the other messages open under it.
export interface AnyWarning {
  code: string;
  severity?: string;
  message: string;
}

export interface WarningGroup {
  code: string;
  severity: string;
  count: number;
  first: string;
  messages: string[];
}

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };
const SHOWN_PER_GROUP = 50; // layout choice; the count always shows the total

export function groupWarnings(list: readonly AnyWarning[]): WarningGroup[] {
  const by = new Map<string, WarningGroup>();
  for (const w of list) {
    const g = by.get(w.code);
    if (g) {
      g.count++;
      g.messages.push(w.message);
    } else by.set(w.code, { code: w.code, severity: w.severity ?? 'warning', count: 1, first: w.message, messages: [w.message] });
  }
  return [...by.values()].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) || b.count - a.count);
}

export function renderWarningList(list: readonly AnyWarning[]): HTMLElement {
  const box = document.createElement('div');
  box.className = 'rv-warnings';
  const groups = groupWarnings(list);
  if (groups.length === 0) {
    const p = document.createElement('p');
    p.className = 'rv-small';
    p.textContent = 'No warnings.';
    box.appendChild(p);
    return box;
  }
  for (const g of groups) {
    const d = document.createElement('details');
    d.setAttribute('data-code', g.code);
    const s = document.createElement('summary');
    const sev = document.createElement('span');
    sev.className = `rv-sev rv-sev-${g.severity}`;
    sev.textContent = g.code;
    const msg = document.createElement('span');
    msg.textContent = ` ${g.first}${g.count > 1 ? ` (${g.count})` : ''}`;
    s.append(sev, msg);
    d.appendChild(s);
    if (g.count > 1) {
      const ul = document.createElement('ul');
      for (const m of g.messages.slice(1, SHOWN_PER_GROUP + 1)) {
        const li = document.createElement('li');
        li.textContent = m;
        ul.appendChild(li);
      }
      if (g.count - 1 > SHOWN_PER_GROUP) {
        const li = document.createElement('li');
        li.textContent = `and ${g.count - 1 - SHOWN_PER_GROUP} more`;
        ul.appendChild(li);
      }
      d.appendChild(ul);
    }
    box.appendChild(d);
  }
  return box;
}
