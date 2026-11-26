// App shell: a small entry list. The home view keeps the original placeholder text. The plan import screen is a second
// entry. The import runs in a Web Worker loaded from the app's own files (see planWorker.ts), so no other origin is used.
import { createImportScreen, type UsedPlan } from './plan/importScreen';

/** The plan the user accepted with "Use this plan" (Req 19.8, 19.9). Later screens read it from here. */
let usedPlan: UsedPlan | null = null;
export function getUsedPlan(): UsedPlan | null {
  return usedPlan;
}

const root = document.getElementById('app')!;

function showHome(): void {
  root.textContent = '';
  const text = document.createElement('p');
  text.textContent = 'Egress: work in progress.';
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = 'Import a building plan';
  open.addEventListener('click', showImport);
  root.append(text, open);
}

function showImport(): void {
  root.textContent = '';
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Back';
  back.addEventListener('click', showHome);
  const host = document.createElement('div');
  root.append(back, host);
  createImportScreen(host, {
    onUsePlan: (plan) => {
      usedPlan = plan;
    },
  });
}

showHome();
