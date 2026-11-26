import { describe, expect, it } from 'vitest';
import * as constants from '../../src/core/plan/constants';
import * as limits from '../../src/core/plan/limits';
import * as w from '../../src/core/plan/warnings';
import type { ImportWarningCode } from '../../src/core/plan/types';
import { MAX_FLOORS as CROWD_FLOORS } from '../../src/core/people/constants';
import { MAX_VENTS } from '../../src/core/fire/validate/checks';

const BANNED = /\b(safe|safely|compliant|certified|passes|meets code)\b/i;

describe('plan shared module', () => {
  it('re-exports the model limits without copying values', () => {
    expect(limits.FIRE_MAX_VENTS).toBe(MAX_VENTS);
    expect(limits.CROWD_MAX_FLOORS).toBe(CROWD_FLOORS);
  });

  it('default surfaces and caps have the stated values', () => {
    expect(constants.DXF_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(constants.INSUNITS_TABLE[4]).toEqual({ unit: 'mm', metersPerUnit: 0.001 });
    expect(constants.LAYER_ROLE_TABLE.AWALL).toBe('wall');
    expect('layers' in constants.DEFAULT_FLOOR_SURFACE).toBe(true);
  });

  it('every warning constructor sets its code and avoids banned wording', () => {
    const all: [ImportWarningCode, ReturnType<typeof w.noExit>][] = [
      ['DXF_VERSION_MISSING', w.dxfVersionMissing('a.dxf')],
      ['DXF_VERSION_UNSUPPORTED', w.dxfVersionUnsupported('a.dxf', 'AC9999')],
      ['DXF_NOT_ASCII', w.dxfNotAscii('a.dxf')],
      ['DXF_ENTITY_SKIPPED', w.dxfEntitySkipped('a.dxf', 'SPLINE', 2)],
      ['DXF_BLOCK_CYCLE_OR_DEPTH', w.dxfBlockCycleOrDepth('a.dxf', 'B')],
      ['DXF_COORDINATE_OUT_OF_RANGE', w.dxfCoordinateOutOfRange('a.dxf', 'L', 'LINE')],
      ['DXF_MALFORMED', w.dxfMalformed('a.dxf', 7, 'odd line count')],
      ['DXF_TOO_LARGE', w.dxfTooLarge('a.dxf', 30 * 1024 * 1024)],
      ['DXF_TOO_MANY_ENTITIES', w.dxfTooManyEntities('a.dxf', 300000)],
      ['UNIT_UNKNOWN', w.unitUnknown('a.dxf')],
      ['FLOOR_NO_WALLS', w.floorNoWalls('f1')],
      ['LAYER_UNCONFIRMED', w.layerUnconfirmed('a.dxf', 'L')],
      ['GAP_CLOSED', w.gapClosed('f1', 1, 2)],
      ['DOOR_WIDTH_RANGE', w.doorWidthRange('f1:door0', 'f1', 0.25)],
      ['DOOR_DISCARDED', w.doorDiscarded('f1', 1, 2)],
      ['ROOM_OUTSIDE_LARGE', w.roomOutsideLarge('f1', 0.4)],
      ['ROOM_TOO_SMALL', w.roomTooSmall('f1:room0', 'f1', 0.5)],
      ['ROOM_NOT_RECTANGULAR', w.roomNotRectangular('f1:room0', 'f1', 10, 14)],
      ['FLOOR_STACKING', w.floorStacking('f1', 'f2', 0.2)],
      ['FLOOR_FIELD_INVALID', w.floorFieldInvalid('f1', 'ceilingHeightM', 'out of range')],
      ['STAIR_OVERLAP_BELOW_TOLERANCE', w.stairOverlapBelowTolerance('f1', 'f2')],
      ['STAIR_REGION_TRIMMED', w.stairRegionTrimmed('f1', 3)],
      ['VENT_WIDTH_CLAMPED', w.ventWidthClamped('v1', 'f1', 1)],
      ['VENT_LIMIT', w.ventLimit(70, 60)],
      ['NO_EXIT', w.noExit()],
      ['EXIT_REJECTED', w.exitRejected('f1:door0', 'f1')],
      ['LIMIT_FLOORS', w.limitFloors(7, 6)],
      ['LIMIT_COMPARTMENTS', w.limitCompartments(31, 30)],
      ['LIMIT_CELLS', w.limitCells('f1', 2_000_000, 1_000_000)],
      ['EDIT_IGNORED', w.editIgnored('unknown door')],
      ['ROOM_IDENTITY_LOST', w.roomIdentityLost('f1:room0')],
      ['PROJECT_SCHEMA_VERSION', w.projectSchemaVersion(2)],
      ['PROJECT_FIELD_INVALID', w.projectFieldInvalid('edits', 'not a list')],
      ['AGREEMENT_BROKEN', w.agreementBroken('door count differs')],
      ['INPUT_INVALID', w.inputInvalid('sources is not a list')],
    ];
    expect(new Set(all.map(([c]) => c)).size).toBe(35);
    for (const [code, warning] of all) {
      expect(warning.code).toBe(code);
      expect(warning.message).not.toMatch(BANNED);
    }
    expect(w.dxfNotAscii('a.dxf').message).toContain('Save as DXF (ASCII)');
  });
});
