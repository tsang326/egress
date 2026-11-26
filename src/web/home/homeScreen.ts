// Home screen (run-view spec, Requirement 1). Wording follows the safety rules: no word that judges a building.
import { SAFETY_NOTICE } from '../plan/importScreen';
import { button, el } from '../ui';
import { SAMPLE_INFO, type SampleId } from './sampleConfigs';

export const HOME_LINES = [
  'Egress simulates how people leave a building while a fire grows in one room: smoke and heat spread room by room, and every person walks, queues at doors and takes the stairs on their own.',
  'It couples a two-zone compartment fire model (a TypeScript port of NIST CFAST) with a grid-based crowd model, so you can compare layouts and door choices. It helps you understand risk; it cannot approve a building.',
];

export interface HomeOptions {
  onSample: (id: SampleId) => void;
  onImport: () => void;
}

export function createHomeScreen(container: HTMLElement, opts: HomeOptions): void {
  container.replaceChildren();
  const box = el('section', 'rv-home');
  box.appendChild(el('h1', 'rv-title', 'Egress'));
  box.appendChild(el('p', 'rv-tagline', 'Fire and evacuation, side by side, in your browser.'));
  for (const line of HOME_LINES) box.appendChild(el('p', 'rv-lead', line));
  box.appendChild(el('h2', undefined, 'Start with a sample building'));
  const cards = el('div', 'rv-cards');
  for (const s of SAMPLE_INFO) {
    const b = button('', () => opts.onSample(s.id), 'rv-card');
    b.setAttribute('data-sample', s.id);
    b.append(el('strong', undefined, s.title), el('span', 'rv-small', s.blurb));
    cards.appendChild(b);
  }
  box.appendChild(cards);
  box.appendChild(el('h2', undefined, 'Or use your own drawing'));
  const imp = button('Import your own DXF', opts.onImport, 'rv-btn rv-btn-secondary');
  imp.setAttribute('data-action', 'import');
  box.appendChild(imp);
  box.appendChild(el('p', 'rv-small', 'Everything runs on this device. The drawing and the results never leave the browser.'));
  box.appendChild(el('p', 'rv-notice', SAFETY_NOTICE));
  container.appendChild(box);
}
