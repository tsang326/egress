// checkAgreement: the crowd PlanInput and the fire geometry must describe the same building (Req 14.1-14.6, 14.8).
// Pure and total. Returns one AGREEMENT_BROKEN error per broken agreement, naming it and up to MAX_NAMED offenders;
// an empty array means every agreement holds.
import type { Compartment, Vent } from '../fire/types';
import { CELL_DOOR, CELL_EXIT, CELL_WALL } from '../people/types';
import type { PlanInput } from '../people/types';
import { fireKindOf } from './derive/equivalentBox';
import { ventIdOf } from './derive/toFireGeometry';
import type { BuildingModel, ImportWarning } from './types';
import { agreementBroken } from './warnings';

const OUTSIDE = 'OUTSIDE';
const MAX_NAMED = 3;
// A vent may be narrower than its door only when VENT_WIDTH_CLAMPED named it (Req 13.7). Equal otherwise.
const WIDTH_TOLERANCE_M = 1e-9;

export interface FireGeometryView {
  compartments: readonly Compartment[];
  vents: readonly Vent[];
}

class Report {
  private readonly byAgreement = new Map<string, string[]>();
  add(agreement: string, offender: string): void {
    const list = this.byAgreement.get(agreement) ?? [];
    list.push(offender);
    this.byAgreement.set(agreement, list);
  }
  toWarnings(): ImportWarning[] {
    return [...this.byAgreement].map(([agreement, list]) => {
      const named = list.slice(0, MAX_NAMED).join('; ');
      return agreementBroken(`${agreement} (${list.length} case${list.length === 1 ? '' : 's'}: ${named}${list.length > MAX_NAMED ? '; ...' : ''})`);
    });
  }
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * @param fireWarnings warnings of the fire deriver; a VENT_WIDTH_CLAMPED warning that names a vent id allows that vent
 *   to be narrower than its door.
 */
export function checkAgreement(
  model: BuildingModel,
  planInput: PlanInput,
  fire: FireGeometryView,
  fireWarnings: readonly ImportWarning[] = [],
): ImportWarning[] {
  const rep = new Report();

  // 14.1 Equal compartment id sets, and 14.6 equal kind mapping.
  const planIds = new Set(planInput.compartments?.map((c) => c.id) ?? []);
  const fireIds = new Set(fire.compartments.map((c) => c.id));
  if (!sameSet(planIds, fireIds)) {
    const onlyPlan = [...planIds].filter((x) => !fireIds.has(x));
    const onlyFire = [...fireIds].filter((x) => !planIds.has(x));
    if (onlyPlan.length > 0) rep.add('compartment ids of the crowd plan and the fire model differ', `only in the crowd plan: ${onlyPlan[0]}`);
    if (onlyFire.length > 0) rep.add('compartment ids of the crowd plan and the fire model differ', `only in the fire model: ${onlyFire[0]}`);
  }
  const planKind = new Map((planInput.compartments ?? []).map((c) => [c.id, c.kind]));
  const fireKind = new Map(fire.compartments.map((c) => [c.id, c.kind]));
  for (const r of model.rooms) {
    const want = fireKindOf(r.kind).kind;
    if (planKind.has(r.id) && planKind.get(r.id) !== want) rep.add('compartment kinds differ from the room kinds in the crowd plan', r.id);
    if (fireKind.has(r.id) && fireKind.get(r.id) !== want) rep.add('compartment kinds differ from the room kinds in the fire model', r.id);
  }

  // Vents by id; an id used twice is itself a broken agreement.
  const ventsById = new Map<string, Vent[]>();
  for (const v of fire.vents) ventsById.set(v.id, [...(ventsById.get(v.id) ?? []), v]);
  const cellsOf = new Map(planInput.floors.map((f) => [f.id, f.cells]));
  const clampedText = fireWarnings.filter((w) => w.code === 'VENT_WIDTH_CLAMPED').map((w) => w.message);
  const expectedIds = new Set<string>();

  for (const d of model.doors) {
    const id = ventIdOf(d.id);
    const cells = cellsOf.get(d.floorId);
    const cellValues = cells === undefined ? [] : [...d.cells].map((c) => cells[c]);
    const label = `${d.isWindow ? 'window' : d.isExit ? 'exit' : 'door'} ${d.id}`;

    if (d.isWindow) {
      // A closed window gives no vent (Req 13.2); an open one gives one. Window cells are wall either way (Req 5.6).
      if (cellValues.some((v) => v !== CELL_WALL)) rep.add('a window is not wall in the crowd grid', label);
      if (!d.open) {
        if (ventsById.has(id)) rep.add('a closed window has a fire vent', label);
        continue;
      }
    } else if (!d.open) {
      // Req 14.4: a closed door has a vent with open fraction 0 and no door cell.
      if (cellValues.some((v) => v === CELL_DOOR || v === CELL_EXIT)) rep.add('a closed door has door cells in the crowd grid', label);
    } else {
      // Req 14.2, 14.3: an open door is passable; an exit shows exit cells.
      const want = d.isExit ? CELL_EXIT : CELL_DOOR;
      if (cellValues.some((v) => v !== want)) rep.add(d.isExit ? 'an exit has no exit cells in the crowd grid' : 'an open door has no door cells in the crowd grid', label);
    }
    expectedIds.add(id);

    const found = ventsById.get(id) ?? [];
    if (found.length !== 1) {
      rep.add(d.isExit ? 'an exit has not exactly one fire vent' : 'a door or window has not exactly one fire vent', `${label} has ${found.length}`);
      continue;
    }
    const v = found[0] as Vent;
    if (v.kind !== 'wall') {
      rep.add('a door or window vent is not a wall vent', label);
      continue;
    }
    const wantSides = [d.roomIdA, d.roomIdB].sort().join('|');
    if ([v.from, v.to].sort().join('|') !== wantSides) rep.add('a vent joins other compartments than its door', label);
    if (d.isExit && v.to !== OUTSIDE) rep.add('an exit vent does not lead to the outside', label);
    if (v.open !== (d.open ? 1 : 0)) rep.add('a vent open fraction differs from its door', label);
    const narrower = v.widthM < d.widthM - WIDTH_TOLERANCE_M;
    if (v.widthM > d.widthM + WIDTH_TOLERANCE_M || (narrower && !clampedText.some((m) => m.includes(id)))) {
      rep.add('a vent width differs from its door width', label);
    }
  }

  // 14.5 One CeilingFloorVent and one StairLinkInput per link, on the same two floors.
  const roomFloor = new Map(model.rooms.map((r) => [r.id, r.floorId]));
  for (const link of model.stairLinks) {
    const id = ventIdOf(link.id);
    expectedIds.add(id);
    const found = ventsById.get(id) ?? [];
    if (found.length !== 1 || found[0]?.kind !== 'ceilingFloor') {
      rep.add('a stair link has not exactly one ceiling vent', link.id);
    } else {
      const v = found[0];
      if (roomFloor.get(v.lower) !== link.lowerFloorId || roomFloor.get(v.upper) !== link.upperFloorId) {
        rep.add('a ceiling vent joins other floors than its stair link', link.id);
      }
    }
    const inputs = planInput.stairLinks.filter((s) => s.id === link.id);
    const s = inputs[0];
    if (inputs.length !== 1 || s === undefined) rep.add('a stair link has not exactly one crowd stair link', link.id);
    else if (s.lowerFloorId !== link.lowerFloorId || s.upperFloorId !== link.upperFloorId) rep.add('a crowd stair link joins other floors than its stair link', link.id);
  }
  if (planInput.stairLinks.length !== model.stairLinks.length) rep.add('the number of crowd stair links differs from the stair links', `${planInput.stairLinks.length} against ${model.stairLinks.length}`);

  // No vent without a door, window or stair link behind it. Roof openings (`<floor>:roof:vent`, to the outside) are the
  // only other vents.
  for (const v of fire.vents) {
    const roof = v.kind === 'ceilingFloor' && v.upper === OUTSIDE;
    if (!expectedIds.has(v.id) && !roof) rep.add('a fire vent has no door, window or stair link', v.id);
  }
  return rep.toWarnings();
}
