// Layer role suggestion and confirmation (Req 5.1 to 5.5, 5.9). Pure functions, no DOM, no globals.
// Layer names come from untrusted DXF files: lookups use Object.hasOwn / Map so a name such as "__proto__" is data.
import { LAYER_ROLE_TABLE } from './constants';
import type { ImportWarning, LayerMap, LayerRole, PendingQuestion } from './types';
import { layerUnconfirmed } from './warnings';

export const LAYER_ROLES: readonly LayerRole[] = ['wall', 'door', 'window', 'stair', 'furniture', 'ignore'];

// Characters removed after upper-casing and NFD diacritic stripping (Req 5.2): hyphen, underscore, space.
const SEPARATORS = /[-_ ]/g;
// Combining diacritical marks block (U+0300 to U+036F), left behind by NFD.
const COMBINING_MARKS = /[\u0300-\u036f]/g;

// Uppercase, strip diacritics (NFD), remove '-', '_' and space (Req 5.2). The Vietnamese letter D with stroke
// (U+0110 / U+0111) has no NFD decomposition, so it is mapped to D explicitly. Idempotent: the output is
// already upper-case, mark-free and separator-free.
export function normalizeLayerName(layerName: string): string {
  return layerName
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[\u0110\u0111]/g, 'D')
    .toUpperCase()
    .replace(SEPARATORS, '');
}

// Suggested role for a layer name; no table match gives `ignore` (Req 5.2, 5.3).
export function suggestLayerRole(layerName: string): LayerRole {
  const key = normalizeLayerName(layerName);
  return Object.hasOwn(LAYER_ROLE_TABLE, key) ? LAYER_ROLE_TABLE[key]! : 'ignore';
}

// Number of entities on each layer, in first-seen order, for the UI (Req 5.9).
export function countEntitiesPerLayer(entities: readonly { layer: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entities) counts.set(e.layer, (counts.get(e.layer) ?? 0) + 1);
  return counts;
}

// One suggested role per layer name (Req 5.2). The result is a suggestion, not a confirmed map (Req 5.4).
export function suggestLayerMap(layerNames: Iterable<string>): Map<string, LayerRole> {
  const out = new Map<string, LayerRole>();
  for (const name of layerNames) out.set(name, suggestLayerRole(name));
  return out;
}

export interface LayerConfirmation {
  confirmed: boolean; // true when every layer that holds an entity is named in the confirmed map
  unconfirmedLayers: string[]; // layers with at least one entity and no entry in the map, sorted
  pendingQuestions: PendingQuestion[]; // zero or one LAYER_ROLES question for this file (Req 5.4)
  warnings: ImportWarning[]; // one LAYER_UNCONFIRMED per unconfirmed layer
}

// A layer with at least one entity is unconfirmed until `confirmedMap` names it (Req 5.4). Empty layers need no
// confirmation. `entityCounts` is the result of `countEntitiesPerLayer`. Layers are reported in sorted order so
// the result is deterministic.
export function checkLayerConfirmation(
  fileName: string,
  entityCounts: ReadonlyMap<string, number>,
  confirmedMap: LayerMap | undefined,
): LayerConfirmation {
  const unconfirmedLayers: string[] = [];
  for (const [layer, count] of entityCounts) {
    if (count < 1) continue;
    const named = confirmedMap !== undefined && Object.hasOwn(confirmedMap, layer);
    if (!named) unconfirmedLayers.push(layer);
  }
  unconfirmedLayers.sort();
  const confirmed = unconfirmedLayers.length === 0;
  return {
    confirmed,
    unconfirmedLayers,
    pendingQuestions: confirmed ? [] : [{ kind: 'LAYER_ROLES', fileName, layerNames: unconfirmedLayers.slice() }],
    warnings: unconfirmedLayers.map((layer) => layerUnconfirmed(fileName, layer)),
  };
}
