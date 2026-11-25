// Constants for the crowd model. SI units (m, s, persons) unless the name says otherwise.
//
// Every exported constant has a comment directly above it that names its source and the alternative considered,
// or says "estimate" or "numerical parameter". tests/people/constants.test.ts enforces this.
// Source key:
//   - SFPE: SFPE Handbook of Fire Protection Engineering, "Emergency Movement" (Nelson and Mowrer)
//   - Cleary: Cleary, NIST, pre-movement time data
//   - Jin: Jin 1976/1978 smoke and walking speed, fit as given in SFPE Handbook 6th ed. Ch. 70
//   - ISO 13571: ISO 13571 tenability (FED) relations, Purser
//   - Practice note: Engineers Australia fire safety practice note v2.0, Section 5.2
// "Estimate" means a value no source this project read gives. It is shown as an estimate wherever it reaches the UI.
// Molar masses and the visibility constant come from the fire model, so the gas concentrations used here match it.
export {
  K_VIS,
  MOLAR_MASS_CO_KG_PER_MOL,
  MOLAR_MASS_CO2_KG_PER_MOL,
  MOLAR_MASS_O2_KG_PER_MOL,
  MOLAR_MASS_N2_KG_PER_MOL,
} from '../fire/constants';
// ---------------------------------------------------------------------------------------------
// Grid, time and body
// ---------------------------------------------------------------------------------------------
// Requirement 1.1: Plan cell edge, m.
export const CELL_SIZE_M = 0.25;
// Requirement 2.1: time step, s.
export const TIME_STEP_S = 0.05;
// Estimate: half of the 0.457 m (18 in) Fruin body ellipse width, m. Not re-checked in a source. Alternative: Pathfinder default of 0.23 m (not verified).
export const AGENT_RADIUS_M = 0.23;
// ---------------------------------------------------------------------------------------------
// Speed and density (SFPE: S = k - a k D)
// ---------------------------------------------------------------------------------------------
// Requirement 2.6, SFPE (Nelson and Mowrer): unimpeded level speed k, m/s. Alternatives: Fruin and Predtechenskii-Milinskii relations.
export const K_LEVEL_M_PER_S = 1.4;
// SFPE (Nelson and Mowrer): slope a in S = k - a k D, m2/person. Consistent with 1.316 = 1.4 * 0.9398 * 1.88. Alternatives: Fruin and Predtechenskii-Milinskii relations.
export const SPEED_DENSITY_SLOPE = 0.266;
// Requirement 2.5: lower limit of validity of the SFPE relation, persons/m2. Below it the density is held at this value, so the speed is S(0.54).
export const D_FREE_CAP = 0.54;
// Requirement 2.6, derived as 1 / SPEED_DENSITY_SLOPE (about 3.76), persons/m2: density at which speed is zero. Alternative: none, it follows from the SFPE relation.
export const D_ZERO_SPEED = 1 / SPEED_DENSITY_SLOPE;
// SFPE relation evaluated at D_FREE_CAP (derived, not a separate constant), m/s. Equals 1.199; the design text rounds it down to 1.19, which matches the Pathfinder verification speed.
export const V_FREE_M_PER_S = K_LEVEL_M_PER_S * (1 - SPEED_DENSITY_SLOPE * D_FREE_CAP);
// SFPE Handbook stair table (verified through the Pathfinder SFPE technical reference): rise and tread in inches, k in m/s. Used as k with the same a and D_FREE_CAP as level routes. Alternative: fraction of level speed (k / 1.4) as Pathfinder applies.
export const STAIR_K_TABLE: readonly { readonly riseIn: number; readonly treadIn: number; readonly kMPerS: number }[] = [
  { riseIn: 7.5, treadIn: 10, kMPerS: 1.0 },
  { riseIn: 7, treadIn: 11, kMPerS: 1.08 },
  { riseIn: 6.5, treadIn: 12, kMPerS: 1.16 },
  { riseIn: 6.5, treadIn: 13, kMPerS: 1.23 },
];
// Pathfinder stair flow test (verified): default riser, 7 in, m. Alternative: any riser the user gives.
export const STAIR_DEFAULT_RISER_M = 0.178;
// Pathfinder stair flow test (verified): default tread, 11 in, m. Alternative: any tread the user gives.
export const STAIR_DEFAULT_TREAD_M = 0.279;
// Pathfinder SFPE mode default (verified there); estimate for this model, persons/m2. Alternative: D_ZERO_SPEED.
export const STAIR_MAX_DENSITY = 3.55;
// Inches to metres (exact, definition of the inch), for the stair table.
export const M_PER_INCH = 0.0254;
// ---------------------------------------------------------------------------------------------
// Doors and exits
// ---------------------------------------------------------------------------------------------
// Requirement 2.9, SFPE maximum specific flow 1.316 (verified in the Pathfinder door test), persons/(s m). Alternatives: NFPA 101 capacity factors, Fruin level of service.
export const DOOR_SPECIFIC_FLOW_PER_S_M = 1.3;
// SFPE effective width (verified in the Pathfinder SFPE notes): unusable boundary layer per side, m. Alternative: none.
export const DOOR_BOUNDARY_LAYER_M = 0.15;
// Estimate: one cell, m. Keeps the 10 s flow window bound at 3 or more persons. Alternative: 0 (no flow through a narrow door).
export const EFFECTIVE_WIDTH_MIN_M = 0.25;
// Requirement 2.9: window over which the door flow limit is measured, s.
export const FLOW_WINDOW_S = 10;
// ---------------------------------------------------------------------------------------------
// Pre-movement delay (lognormal)
// ---------------------------------------------------------------------------------------------
// Cleary, NIST (verified): median pre-movement time of staff, s. Residential, awake populations. Alternative: PD 7974-6 and Purser and Bensilum tables (paywalled, not read).
export const PRE_MOVEMENT_MEDIAN_STAFF_S = 16;
// Cleary, NIST (verified): median pre-movement time of visitors, s. Alternative: 55 s for elderly or impaired (same paper).
export const PRE_MOVEMENT_MEDIAN_VISITOR_S = 35;
// Cleary, NIST (verified): log standard deviation = ln 1.6 (geometric standard deviation 1.6). Alternative: none read.
export const PRE_MOVEMENT_LOG_SD = Math.log(1.6);
// ---------------------------------------------------------------------------------------------
// Walking speed in smoke
// ---------------------------------------------------------------------------------------------
// Jin 1976/1978 data, SFPE Handbook 6th ed. Ch. 70 (verified through the pyFDS-Evac notes), non-irritant smoke, factor = a + b * Ks form with a = 1.0573, b = 0.4326 (R2 = 0.27). Alternatives: Frantzich-Nilsson, Fridolf 2019, Purser.
export const SMOKE_LAW_NON_IRRITANT: { readonly a: number; readonly b: number } = { a: 1.0573, b: 0.4326 };
// Jin 1976/1978 data, SFPE Handbook 6th ed. Ch. 70 (same source as SMOKE_LAW_NON_IRRITANT), irritant smoke, a = 1.1517, b = 0.9578 (R2 = 0.035). Alternatives: as above.
export const SMOKE_LAW_IRRITANT: { readonly a: number; readonly b: number } = { a: 1.1517, b: 0.9578 };
// Jin 1978 p. 148, citing Togawa 1969 (verified as quoted): speed in darkness, m/s. Alternative: Ronchi et al. 2013 put the minimum at 0.3 to 0.4.
export const SMOKE_DARKNESS_SPEED_M_PER_S = 0.3;
// Estimate: extinction coefficient at which an agent is alerted by smoke, 1/m (visibility 30 m with K_VIS = 3). Alternative: none read.
export const K_ALERT_PER_M = 0.1;
// Requirement 4, FDS+Evac HUMAN_SMOKE_HEIGHT (verified): height at which the layer is read, m. Alternative: 2.0 m (practice note).
export const EYE_HEIGHT_M = 1.6;
// ---------------------------------------------------------------------------------------------
// Tenability: fractional effective dose (FED)
// ---------------------------------------------------------------------------------------------
// ISO 13571 form, FDS source comment (verified): CO rate coefficient, R_CO = coeff * ppm^exp * RMV / D, per minute. Alternative: none.
export const CO_FED_COEFF = 3.317e-5;
// ISO 13571 form, FDS source comment (verified): CO concentration exponent. Alternative: none.
export const CO_FED_EXP = 1.036;
// Purser, light work (verified in the FDS source comment): respiratory minute volume, L/min. Alternatives: rest 8.5, heavy work 50.
export const RMV_L_PER_MIN = 25;
// Purser, light work (verified in the FDS source comment): COHb incapacitating dose, percent. Alternatives: rest 40, heavy work 20.
export const D_COHB_PCT = 30;
// The brief for this spec, not read in a primary text (estimate): CO2 hyperventilation factor V = exp(A * pct + B) / DIV, constant A. Alternative: FDS+Evac 0.1903.
export const VCO2_A = 0.2496;
// The brief for this spec, not read in a primary text (estimate): constant B. Alternative: FDS+Evac 2.0004.
export const VCO2_B = 1.9086;
// The brief for this spec, not read in a primary text (estimate): divisor. Alternative: FDS+Evac 7.1.
export const VCO2_DIV = 6.8;
// ISO 13571 (verified in the FDS+Evac model notes): low-oxygen rate R_O2 = 1 / exp(A - B * (20.9 - pct)), constant A. Alternative: none.
export const O2_FED_A = 8.13;
// ISO 13571 (verified in the FDS+Evac model notes): constant B. Alternative: none.
export const O2_FED_B = 0.54;
// ISO 13571 relation: oxygen volume percent of ambient air, in the low-oxygen term. Alternative: none.
export const O2_AMBIENT_PCT = 20.9;
// FDS+Evac default o2_threshold_percent (verified); estimate here. At or above it the oxygen term is 0. Alternative: none.
export const O2_FED_CUTOFF_PCT = 20.0;
// ISO 13571:2012 Eq. (9), clothed (verified through the pyFDS-Evac heat notes): R_heat = T_C^exp / coeff per minute, coefficient. Alternative: Eq. (10) unclothed, 5e7 and 3.4.
export const HEAT_FED_COEFF = 4.1e8;
// ISO 13571:2012 Eq. (9), clothed: temperature exponent. Alternative: Eq. (10) unclothed, 3.4.
export const HEAT_FED_EXP = 3.61;
// Estimate for the lower threshold of the standard, which could not be read, degC. Alternative: none.
export const HEAT_FED_MIN_C = 60;
// Requirement 5.3, ISO 13571: FED of 1 is the median incapacitating dose. Alternative: none.
export const FED_LIMIT = 1.0;
// Practice note Section 5.2 (verified): visibility limit in large spaces, m. Alternative: BS 7974-6 values (not read).
export const VIS_LIMIT_LARGE_M = 10;
// Practice note Section 5.2 (verified): visibility limit in small spaces, m. Alternative: BS 7974-6 values (not read).
export const VIS_LIMIT_SMALL_M = 5;
// FEMTC 2018 slide "Visibility > 10 m (spaces > 100 m2)" (partial source), m2: area above which a space is large. Alternative: none.
export const VIS_LIMIT_AREA_M2 = 100;
// Practice note Section 5.2 (verified), 10 min tolerance, K (100 degC). Alternative: 120 degC, the fire fighter 10 min value in the same note.
export const TEMP_LIMIT_K = 373.15;
// CFAST default interior temperature 20 degC, K. Estimate for compartments outside the fire Result. Alternative: user input ambientTempK.
export const AMBIENT_TEMP_K = 293.15;
// 0 degC in K, for converting layer temperatures to degC (ISO 13571 is stated in degC). Alternative: none.
export const KELVIN_AT_0C = 273.15;
// ---------------------------------------------------------------------------------------------
// Flow_Field costs and recompute policy
// ---------------------------------------------------------------------------------------------
// Estimate: interval between Flow_Field refreshes when smoke changes route costs, s. Alternative: refresh every step (too slow).
export const FIELD_REFRESH_INTERVAL_S = 5;
// Estimate: an agent switches exit only if the new route is cheaper by this many cells (5 m). Alternative: no margin (agents oscillate).
export const SWITCH_MARGIN_CELLS = 20;
// Estimate: cost multiplier on a route cell where visibility is below the limit. Alternative: Infinity (never walk in smoke).
export const VIS_PENALTY_FACTOR = 2;
// Numerical parameter: smoke level is quantised to this step before it enters costs, so small changes do not trigger a recompute. Alternative: no quantisation.
export const SMOKE_QUANT_STEP = 0.1;
// Estimate (Requirement 2.3 asks for the label): wall-clearance cost of a cell 1 cell from a wall, in cell lengths. Alternative: none.
export const WALL_CLEARANCE_COST_1_CELL = 1.0;
// Estimate (Requirement 2.3): wall-clearance cost of a cell 2 cells from a wall, in cell lengths. Alternative: none.
export const WALL_CLEARANCE_COST_2_CELLS = 0.5;
// Estimate (Requirement 2.3): distance from a wall, in cells, within which the wall-clearance cost applies. Alternative: none.
export const WALL_CLEARANCE_RANGE_CELLS = 2;
// ---------------------------------------------------------------------------------------------
// Neighbourhood radii
// ---------------------------------------------------------------------------------------------
// Estimate (numerical): radius for the local density estimate, m. Alternative: Voronoi density.
export const DENSITY_RADIUS_M = 1.0;
// Estimate (numerical): distance within which an agent joins a gate queue, m. Alternative: none.
export const GATE_ENROL_RADIUS_M = 1.0;
// ---------------------------------------------------------------------------------------------
// Warning thresholds
// ---------------------------------------------------------------------------------------------
// Requirement 6.7, Tech Ref 1.5 (read): the point-source radiation model is less accurate within a few fire diameters, m. Alternative: none.
export const NEAR_FIRE_M = 2;
// Estimate: corridor length above which a LONG_CORRIDOR warning is issued, m. Tech Ref 1.5 says correlations were developed for rooms and gives no hard limit (read).
export const CORRIDOR_LENGTH_LIMIT_M = 20;
// Estimate: node count above which a PLAN_LARGE warning is issued. Alternative: none.
export const PLAN_LARGE_NODES = 250_000;
// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------
// Requirement 1.2, estimate: maximum number of floors. Alternative: none.
export const MAX_FLOORS = 12;
// Requirement 1.2, estimate: maximum number of compartments. Alternative: none.
export const MAX_COMPARTMENTS = 100;
// Requirement 1.2, estimate: maximum number of cells per floor. Alternative: none.
export const MAX_CELLS_PER_FLOOR = 1_000_000;
// Estimate: maximum number of agents. Alternative: none.
export const MAX_AGENTS = 2000;
// Estimate: warnings kept per code before WARNINGS_TRUNCATED. Alternative: none.
export const MAX_WARNINGS_PER_CODE = 200;
// Requirement 1.1: lowest and highest allowed floor elevation, m. Estimate for the range. Alternative: none.
export const ELEVATION_MIN_M = -10;
// Requirement 1.1: highest allowed floor elevation, m. Estimate for the range. Alternative: none.
export const ELEVATION_MAX_M = 100;
// ---------------------------------------------------------------------------------------------
// Output intervals
// ---------------------------------------------------------------------------------------------
// Requirement 7.4: simulated time between progress events, s.
export const PROGRESS_INTERVAL_S = 5;
// Requirements 6.1 and 6.4: sampling interval of series and FED history, s.
export const SERIES_INTERVAL_S = 1;
