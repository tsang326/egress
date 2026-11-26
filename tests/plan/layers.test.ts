import { describe, expect, it } from 'vitest';
import {
  checkLayerConfirmation,
  countEntitiesPerLayer,
  normalizeLayerName,
  suggestLayerMap,
  suggestLayerRole,
} from '../../src/core/plan/layers';

describe('layer role suggestion', () => {
  it.each([
    ['A-WALL', 'wall'], ['a_wall', 'wall'], ['AWALL', 'wall'], ['TUONG', 'wall'], ['Tường', 'wall'],
    ['A-DOOR', 'door'], ['CUA', 'door'], ['Cửa', 'door'],
    ['A-GLAZ', 'window'], ['CUA SO', 'window'], ['Cửa sổ', 'window'], ['cua_so', 'window'], ['CUASO', 'window'],
    ['A-FLOR-STRS', 'stair'], ['CAU THANG', 'stair'], ['Cầu Thang', 'stair'], ['CAU-THANG', 'stair'],
    ['A-FURN', 'furniture'],
  ])('%s -> %s', (name, role) => {
    expect(suggestLayerRole(name)).toBe(role);
  });

  it('unmatched names, including prototype-like names, give ignore', () => {
    for (const n of ['', 'Defpoints', '0', '__proto__', 'constructor', 'toString']) {
      expect(suggestLayerRole(n)).toBe('ignore');
    }
  });

  it('normalization is idempotent and maps D with stroke to D', () => {
    expect(normalizeLayerName('Đ-oor_ x')).toBe('DOORX');
    const once = normalizeLayerName('Cầu Thang');
    expect(normalizeLayerName(once)).toBe(once);
  });

  it('counts entities per layer and suggests a map', () => {
    const counts = countEntitiesPerLayer([{ layer: 'A-WALL' }, { layer: 'X' }, { layer: 'A-WALL' }]);
    expect([...counts]).toEqual([['A-WALL', 2], ['X', 1]]);
    expect([...suggestLayerMap(counts.keys())]).toEqual([['A-WALL', 'wall'], ['X', 'ignore']]);
  });
});

describe('layer confirmation', () => {
  const counts = new Map([['A-WALL', 3], ['Empty', 0], ['__proto__', 1]]);

  it('asks about layers with entities that the map does not name', () => {
    const r = checkLayerConfirmation('a.dxf', counts, { 'A-WALL': 'wall' });
    expect(r.confirmed).toBe(false);
    expect(r.unconfirmedLayers).toEqual(['__proto__']);
    expect(r.pendingQuestions).toEqual([{ kind: 'LAYER_ROLES', fileName: 'a.dxf', layerNames: ['__proto__'] }]);
    expect(r.warnings.map((w) => w.code)).toEqual(['LAYER_UNCONFIRMED']);
  });

  it('is unconfirmed without a map and confirmed once every used layer is named', () => {
    expect(checkLayerConfirmation('a.dxf', counts, undefined).unconfirmedLayers).toEqual(['A-WALL', '__proto__']);
    const map = Object.fromEntries([['A-WALL', 'wall'], ['__proto__', 'ignore']]);
    Object.defineProperty(map, '__proto__', { value: 'ignore', enumerable: true });
    const r = checkLayerConfirmation('a.dxf', counts, map as never);
    expect(r.confirmed).toBe(true);
    expect(r.pendingQuestions).toEqual([]);
  });
});
