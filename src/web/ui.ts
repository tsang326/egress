// Small DOM helpers shared by the run-view screens. Text always goes in through textContent, never as markup.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(text: string, onClick: () => void, cls = 'rv-btn'): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export function numberInput(value: number, min: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const i = el('input');
  i.type = 'number';
  i.min = String(min);
  i.step = String(step);
  i.value = String(value);
  i.addEventListener('change', () => onChange(Number(i.value)));
  return i;
}

export function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const l = el('label', 'rv-field');
  l.append(el('span', 'rv-field-label', text), control);
  return l;
}

export function fmtTime(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '–';
  const r = Math.round(s);
  return r < 60 ? `${r} s` : `${Math.floor(r / 60)} min ${String(r % 60).padStart(2, '0')} s`;
}
