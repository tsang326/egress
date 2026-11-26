// Fire library picker (run-view spec, Requirements 3, 3.6): measured NIST FCD items and the t-squared design fires.
import { FIRE_LIBRARY, T_SQUARED_ALPHA_KW_PER_S2, fireChoiceLabel, type FireChoice, type TSquaredClass } from '../../core/fire/library';
import { el, labelled, numberInput } from '../ui';

export const DEFAULT_T_SQUARED_PEAK_KW = 500; // Requirement 3.3
const CLASSES: TSquaredClass[] = ['slow', 'medium', 'fast', 'ultraFast'];
const CLASS_NAME: Record<TSquaredClass, string> = { slow: 'slow', medium: 'medium', fast: 'fast', ultraFast: 'ultra-fast' };

export function createLibraryPicker(current: FireChoice | null, onChange: (c: FireChoice) => void): HTMLElement {
  const box = el('div', 'rv-picker');
  const select = el('select');
  select.setAttribute('aria-label', 'What is burning');
  const groupA = el('optgroup');
  groupA.label = 'Measured furniture fires (NIST Fire Calorimetry Database)';
  for (const item of FIRE_LIBRARY) {
    const o = el('option', undefined, `${item.name} – peak ${Math.round(item.phrrKW)} kW`);
    o.value = `m:${item.id}`;
    groupA.appendChild(o);
  }
  const groupB = el('optgroup');
  groupB.label = 't-squared design fires (NFPA 72)';
  for (const c of CLASSES) {
    const o = el('option', undefined, `t-squared, ${CLASS_NAME[c]} growth`);
    o.value = `t:${c}`;
    groupB.appendChild(o);
  }
  const none = el('option', undefined, 'Choose…');
  none.value = '';
  select.append(none, groupA, groupB);
  const detail = el('div', 'rv-picker-detail');
  let peakKW = current?.kind === 'tSquared' ? current.peakKW : DEFAULT_T_SQUARED_PEAK_KW;

  const choiceOf = (v: string): FireChoice | null => {
    if (v.startsWith('m:')) return FIRE_LIBRARY.find((i) => i.id === v.slice(2)) ?? null;
    if (v.startsWith('t:')) return { kind: 'tSquared', growth: v.slice(2) as TSquaredClass, peakKW };
    return null;
  };
  const showDetail = (c: FireChoice | null): void => {
    detail.replaceChildren();
    if (c === null) return;
    if (c.kind === 'measured') {
      detail.appendChild(el('p', undefined, `Peak heat release ${Math.round(c.phrrKW)} kW, total heat ${c.thrMJ} MJ, measured in NIST FCD ${c.testId}.`));
      const a = el('a', undefined, `Test page (${c.testId})`);
      a.href = c.sourceUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const p = el('p', 'rv-small');
      p.append(a, document.createTextNode(` · dataset doi:10.18434/mds2-2314 · item footprint and height are estimates`));
      detail.appendChild(p);
    } else {
      const alpha = T_SQUARED_ALPHA_KW_PER_S2[c.growth];
      detail.appendChild(el('p', undefined, `Heat release grows as α t² with α = ${alpha} kW/s² (NFPA 72 Annex B), then stays at the peak.`));
      detail.appendChild(
        labelled(
          'Peak heat release (kW)',
          numberInput(peakKW, 1, 50, (v) => {
            if (!(Number.isFinite(v) && v > 0)) return;
            peakKW = v;
            onChange({ kind: 'tSquared', growth: c.growth, peakKW });
          }),
        ),
      );
    }
  };
  if (current) select.value = current.kind === 'measured' ? `m:${current.id}` : `t:${current.growth}`;
  showDetail(current);
  select.addEventListener('change', () => {
    const c = choiceOf(select.value);
    showDetail(c);
    if (c) onChange(c);
  });
  box.append(select, detail);
  return box;
}

export { fireChoiceLabel };
