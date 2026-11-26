// Every constant of the plan-import module. Each cites its source or is labelled "Estimate" (Req 22.5).
// SI units (m, s, kg, K, W, Pa) throughout.
import type { Surface } from '../fire/types';
import type { DrawingUnit } from './types';

// ---- Untrusted input caps (Req 3, 16.9) -------------------------------------------------------------------------

export const DXF_MAX_BYTES = 20 * 1024 * 1024; // Req 3.2: 20 MB, a stated requirement value.
export const DXF_MAX_ENTITIES = 200_000; // Estimate, Req 3.3.
export const DXF_MAX_BLOCK_DEPTH = 8; // Estimate, Req 3.4.
export const DXF_MAX_COORDINATE_M = 1000; // Estimate, Req 3.5 (after unit conversion).
export const PROJECT_FILE_MAX_BYTES = 100 * 1024 * 1024; // Estimate, Req 16.9.

// ---- Drawing units (Req 2.1) ------------------------------------------------------------------------------------

// $INSUNITS code -> unit and metres per unit. Code values are from the Autodesk DXF reference ($INSUNITS);
// the factors are exact definitions (inch 0.0254 m, foot 0.3048 m, SI prefixes). 0 (unitless) and other codes are
// absent on purpose: the importer asks the user (Req 2.2, 2.4).
export const INSUNITS_TABLE: Readonly<Record<number, { unit: DrawingUnit; metersPerUnit: number }>> = {
  1: { unit: 'in', metersPerUnit: 0.0254 },
  2: { unit: 'ft', metersPerUnit: 0.3048 },
  4: { unit: 'mm', metersPerUnit: 0.001 },
  5: { unit: 'cm', metersPerUnit: 0.01 },
  6: { unit: 'm', metersPerUnit: 1 },
};

// Metres per unit for a user-chosen unit (Req 2.3). Same exact definitions as above.
export const METERS_PER_UNIT: Readonly<Record<DrawingUnit, number>> = {
  in: 0.0254,
  ft: 0.3048,
  mm: 0.001,
  cm: 0.01,
  m: 1,
};

// $MEASUREMENT suggestion for a unitless file (Req 2.2): 0 = English (inch), 1 = metric (millimetre). DXF reference.
export const MEASUREMENT_SUGGESTED_UNIT: Readonly<Record<number, DrawingUnit>> = {
  0: 'in',
  1: 'mm',
};

// ---- Layer roles (Req 5.2) --------------------------------------------------------------------------------------

// Keys are normalized layer names (uppercase, diacritics stripped, '-', '_' and space removed).
// A-WALL, A-DOOR, A-GLAZ, A-FLOR-STRS, A-FURN: AIA CAD Layer Guidelines names (US National CAD Standard).
// TUONG, CUA, CUA SO, CAU THANG: Vietnamese words wall, door, window, staircase (the app's target users).
export const LAYER_ROLE_TABLE: Readonly<Record<string, 'wall' | 'door' | 'window' | 'stair' | 'furniture'>> = {
  AWALL: 'wall',
  TUONG: 'wall',
  ADOOR: 'door',
  CUA: 'door',
  AGLAZ: 'window',
  CUASO: 'window',
  AFLORSTRS: 'stair',
  CAUTHANG: 'stair',
  AFURN: 'furniture',
};

// ---- Rasterizer, doors, rooms (Req 6, 7, 8, 9) -------------------------------------------------------------------

// Estimate: a light interior partition. No source gives a default thickness for a single drawn wall line (Req 6.3).
export const DEFAULT_WALL_THICKNESS_M = 0.1;
// Estimate: closes drafting gaps but stays below the narrowest door (DOOR_WIDTH_MIN_M) (Req 6.4).
export const GAP_TOLERANCE_M = 0.1;
// Estimate: narrower than a typical single leaf, 0.7 to 0.9 m (Req 7.5).
export const DOOR_WIDTH_MIN_M = 0.5;
// Estimate: wider than a typical double leaf with frame (Req 7.5).
export const DOOR_WIDTH_MAX_M = 3.0;
// Estimate: an outside region larger than this share of the grid with no exterior door hints at an open outline (Req 8.5).
export const OUTSIDE_REGION_WARN_FRACTION = 0.25;
// Estimate: smaller regions are drafting noise, not rooms (Req 8.6).
export const MIN_ROOM_AREA_M2 = 1.0;
// Estimate: relative difference between room area and bounding-box area that triggers a warning (Req 9.4).
export const NON_RECTANGULAR_WARN_FRACTION = 0.05;

// Name length limits, in characters (Req 8.3 room names, Req 10.1 floor names). Requirement values.
export const NAME_LENGTH_MIN = 1;
export const NAME_LENGTH_MAX = 60;

// ---- Floors and stairs (Req 10, 11) -----------------------------------------------------------------------------

// Estimate: typical storey height of small residential and commercial buildings (Req 10.2).
export const DEFAULT_FLOOR_TO_FLOOR_HEIGHT_M = 3.0;
// Estimate, Req 10.5.
export const CEILING_HEIGHT_MIN_M = 1.5;
export const CEILING_HEIGHT_MAX_M = 10;
// Same range as the crowd model's floor elevation limits (src/core/people/constants.ts), read-only (Req 10.5).
export { ELEVATION_MIN_M as FLOOR_ELEVATION_MIN_M, ELEVATION_MAX_M as FLOOR_ELEVATION_MAX_M } from '../people/constants';
// Estimate: share of the smaller stair region that must overlap the adjacent floor's region (Req 11.3).
export const STAIR_OVERLAP_MIN_FRACTION = 0.5;

// ---- Vent heights (Req 13.1, 13.2) ------------------------------------------------------------------------------

export const DOOR_VENT_SILL_M = 0; // Estimate: a door opening starts at the floor.
export const DOOR_VENT_SOFFIT_M = 2.0; // Estimate: standard door-leaf height.
export const WINDOW_VENT_SILL_M = 0.9; // Estimate: typical window sill height.
export const WINDOW_VENT_SOFFIT_M = 2.1; // Estimate: typical window head height.

// ---- Default surfaces (Req 9.7) ---------------------------------------------------------------------------------

// Floor: concrete, 0.15 m. Conductivity, density and specific heat are the concrete in the CFAST validation case
// validation/cases/delco/Test_05.in (NBSIR 88-3752: 1.8 W/m/K, 2280 kg/m3, 1.04 kJ/kg/K, emissivity 0.9).
// The 0.15 m thickness is an Estimate.
export const DEFAULT_FLOOR_SURFACE: Surface = {
  layers: [
    {
      name: 'concrete (NBSIR 88-3752)',
      conductivityWPerMK: 1.8,
      densityKgPerM3: 2280,
      specificHeatJPerKgK: 1040,
      thicknessM: 0.15, // Estimate
      emissivity: 0.9,
    },
  ],
};

// Ceiling and walls: gypsum board, 0.0125 m. Estimate: generic gypsum board values, not measured data for a specific
// product. The Gypsum entry of the CFAST case above (1.8 W/m/K) is not reused because its conductivity equals the
// concrete value there and looks like an input slip.
const GYPSUM_BOARD_ESTIMATE = {
  name: 'gypsum board (Estimate)',
  conductivityWPerMK: 0.16, // Estimate
  densityKgPerM3: 800, // Estimate
  specificHeatJPerKgK: 1090, // Estimate
  thicknessM: 0.0125, // Estimate
  emissivity: 0.9, // Estimate
};
export const DEFAULT_CEILING_SURFACE: Surface = { layers: [{ ...GYPSUM_BOARD_ESTIMATE }] };
export const DEFAULT_WALL_SURFACE: Surface = { layers: [{ ...GYPSUM_BOARD_ESTIMATE }] };

// ---- DXF geometry (Req 1.4, 1.7) --------------------------------------------------------------------------------

// Estimate: angular step when an arc must be drawn as straight pieces (an arc under a non-uniform INSERT scale is an
// ellipse arc, which the reader does not keep as an arc). pi/32 = 5.6 degrees gives a sagitta error of about
// 0.12 percent of the radius, far below the 0.25 m grid cell for any plan-sized radius.
export const ARC_TESSELLATION_STEP_RAD = Math.PI / 32;

// Estimate: relative tolerance for deciding that a 2D transform keeps circles round (rotation, uniform scale,
// mirroring). Matrices built from exact rotations and scales are well inside this; 1e-9 is far above double rounding.
export const SIMILARITY_TOLERANCE = 1e-9;

// Estimate: a bulge with a smaller magnitude is a straight segment (its arc would be flatter than double precision).
export const BULGE_STRAIGHT_EPSILON = 1e-12;

// DXF reference, group 210/220/230 (extrusion direction): a Z component below this marks the (0,0,-1) normal,
// whose object coordinate system mirrors X.
export const EXTRUSION_MIRROR_Z = -0.5;
