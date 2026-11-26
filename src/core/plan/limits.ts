// Model limits of the two models the importer feeds (Req 17.4). Values are read from those modules, never copied,
// so a change of a limit there is a change here. Read-only imports (Req 22.1).
export {
  MAX_FLOORS as FIRE_MAX_FLOORS,
  MAX_COMPARTMENTS as FIRE_MAX_COMPARTMENTS,
  MAX_VENTS as FIRE_MAX_VENTS,
} from '../fire/validate/checks';
export {
  MAX_FLOORS as CROWD_MAX_FLOORS,
  MAX_COMPARTMENTS as CROWD_MAX_COMPARTMENTS,
  MAX_CELLS_PER_FLOOR as CROWD_MAX_CELLS_PER_FLOOR,
} from '../people/constants';
