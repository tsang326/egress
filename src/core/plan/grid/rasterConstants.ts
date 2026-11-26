// Constants of the rasterizer (grid/rasterize.ts). Kept next to it so this task does not edit the shared constants.ts.
// Each value cites its source or is labelled "Estimate" (Req 22.5).

// Req 6.1: a cell is a wall when the wall covers at least this share of the cell's width along the wall thickness.
export const RASTER_COVERAGE_FRACTION = 0.5;

// Estimate: widest cross-section that still reads as one wall. Two parallel lines closer than this are one wall
// drawn as a pair; a closed outline thinner than this is a solid wall. Thick masonry exterior walls are about 0.4 m.
export const WALL_PAIR_MAX_THICKNESS_M = 0.6;

// Estimate: sine of the angle below which two segments count as parallel (about 0.00006 degrees).
export const PARALLEL_ANGLE_TOLERANCE = 1e-6;

// Estimate: two parallel lines closer than this are the same line drawn twice, not a wall pair.
export const PAIR_MIN_OFFSET_M = 1e-6;

// Estimate: the shared run of a pair must be at least this share of the shorter line, so two lines that only touch
// end to end are not paired.
export const PAIR_MIN_OVERLAP_FRACTION = 0.5;

// Estimate: length tolerance of geometric comparisons, far below any drawing precision and far above double rounding
// at plan coordinates (up to 1000 m, Req 3.5).
export const RASTER_EPS_M = 1e-9;

// Estimate: relative tolerance when deciding that a closed 4-vertex outline is a rectangle.
export const RECTANGLE_TOLERANCE = 1e-6;
