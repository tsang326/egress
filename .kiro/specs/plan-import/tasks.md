# Implementation Plan: Plan Import

## Overview

TypeScript (strict), Vitest + fast-check. The core goes in `src/core/plan/` as pure functions with SI units. The UI goes in `src/web/plan/`. The sample generator goes in `tools/samples/` and writes `public/samples/*.dxf`. Tests go in `tests/plan/`.

The tasks build the pipeline in order: types and constants, own ASCII DXF reader, test helpers, layer roles, grid (rasterizer, gaps, doors, rooms), compartments, floors and stairs, exits, edits, the two derivers, orchestration with agreement checks and limits, project file, samples, performance, UI, wiring.

Rules for every task:
- Every task is required. None is optional.
- Do not edit any file under `src/core/fire/` or `src/core/people/` (Requirement 22.1). Import their types and constants read-only.
- Do not run `git commit`. The user commits.
- Do not stop to ask the user for choices. Record each choice that requirements.md and design.md do not settle as a list entry under "Decisions during implementation" in design.md, with the reason.
- Stop only when a test cannot pass without changing a requirement. The stop report names that requirement and the test.
- Every constant cites its source or is labelled "Estimate" (Requirement 22.5). No `Math.random`, clock or global state in `src/core/plan/` (Requirement 22.4).
- UI text and docs never use "safe", "compliant", "certified", "passes" or "meets code" about a building.

## Tasks

- [x] 1. Types, constants, limits and warnings
  - [x] 1.1 Create the shared types and constants in `src/core/plan/`
    - `types.ts`: `LayerRole`, `LayerMap`, `FloorSettings`, `RoomKind`, `Room`, `Door`, `StairRegionInput`, `StairLink`, `Edit`, `ImportWarningCode`, `ImportWarning`, `FloorSourceSpec`, `BuildingModel`, `DrawingUnit`, `ImportSource`, `ImportSettings`, `PendingQuestion`, `ImportResult` exactly as in the design's Data Models and Public interface
    - `constants.ts`: `DXF_MAX_BYTES`, `DXF_MAX_ENTITIES`, `DXF_MAX_BLOCK_DEPTH`, `DXF_MAX_COORDINATE_M`, `PROJECT_FILE_MAX_BYTES`, `INSUNITS_TABLE`, `LAYER_ROLE_TABLE`, `DEFAULT_WALL_THICKNESS_M`, `GAP_TOLERANCE_M`, `DOOR_WIDTH_MIN_M`, `DOOR_WIDTH_MAX_M`, `OUTSIDE_REGION_WARN_FRACTION`, `MIN_ROOM_AREA_M2`, `NON_RECTANGULAR_WARN_FRACTION`, `DEFAULT_FLOOR_TO_FLOOR_HEIGHT_M`, `CEILING_HEIGHT_MIN_M`, `CEILING_HEIGHT_MAX_M`, `STAIR_OVERLAP_MIN_FRACTION`, `DOOR_VENT_SILL_M`, `DOOR_VENT_SOFFIT_M`, `WINDOW_VENT_SILL_M`, `WINDOW_VENT_SOFFIT_M`, default ceiling, floor and wall `Surface` objects, name length limits (1 to 60)
    - Each constant carries a source comment or the label "Estimate"; surface properties cite a CFAST Tech Ref table or are labelled Estimate
    - `limits.ts`: re-export `MAX_FLOORS`, `MAX_COMPARTMENTS`, `MAX_VENTS` from `../fire/constants` and `MAX_FLOORS`, `MAX_COMPARTMENTS`, `MAX_CELLS_PER_FLOOR` from `../people/constants` under `FIRE_*` and `CROWD_*` names (read names from those modules; do not copy values)
    - `warnings.ts`: constructors for every `ImportWarningCode` with plain-language message text and location, no banned wording
    - Add `tests/plan/` directory with a trivial smoke test that imports the module
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 6.3, 6.4, 7.5, 8.5, 8.6, 9.4, 9.7, 10.2, 10.5, 11.3, 13.1, 13.2, 16.9, 17.4, 22.2, 22.5_

- [x] 2. DXF reader (own ASCII reader)
  - [x] 2.1 Implement `dxf/tokenize.ts`
    - Check `DXF_MAX_BYTES` before parsing; return an error naming the 20 MB limit
    - Read group-code/value pairs; on odd line count, non-integer group code or unparseable number, return an error naming the line number
    - Detect binary DXF, DWG, PDF and image content and return an error whose text contains "Save as DXF (ASCII)"
    - Total over any string, never throws
    - _Requirements: 1.8, 3.1, 3.2, 3.6, 3.8_

  - [x] 2.2 Implement `dxf/transform.ts`, `dxf/entities.ts` and `dxf/blocks.ts`
    - `transform.ts`: 2D affine composition, mirroring from negative scale, rotation in degrees, non-uniform scale, bulge-to-arc conversion
    - `entities.ts`: read `LINE`, `LWPOLYLINE`, `POLYLINE` with `VERTEX` (closed flag), `ARC`, `CIRCLE`, `INSERT`; skip other types and count them per type name
    - `blocks.ts`: read BLOCKS section, flatten `INSERT`s including nested ones, with depth counter and an "expanding" name set; skip an offending `INSERT` with one warning naming the block
    - Skip entities with non-finite coordinates or coordinates beyond `DXF_MAX_COORDINATE_M` with one warning naming the layer and entity type; enforce `DXF_MAX_ENTITIES`
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 3.3, 3.4, 3.5_

  - [x] 2.3 Implement `dxf/header.ts`, `dxf/reader.ts` and `units.ts`
    - `header.ts`: `$ACADVER`, `$INSUNITS`, `$MEASUREMENT`, extents
    - `reader.ts`: `readDxf(text)` total function with a defensive try/catch at its single entry point; missing `$ACADVER` reads as `AC1009` with one warning; version outside `AC1009` to `AC1032` returns `invalid` naming the version and "Save as DXF (ASCII)"
    - `units.ts`: resolve Drawing_Unit from `$INSUNITS` via `INSUNITS_TABLE`; for 0, absent or unknown values return a pending question with the suggested unit from `$MEASUREMENT` (0 inch, 1 millimetre); apply a user-chosen unit over `$INSUNITS`; convert all coordinates to metres once, before rasterization; report drawing extent width and depth in metres
    - _Requirements: 1.1, 1.2, 1.8, 1.9, 1.10, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.4 Write unit tests for the DXF reader in `tests/plan/dxf.test.ts`
    - Version missing, version out of range, binary/DWG/PDF text, skipped entity counts, bulge arc, nested `INSERT`, block cycle, depth over 8, coordinate out of range, odd line count, bad group code, unparseable number (line number named), entity cap
    - Unit table cases for all five units and the unitless, unknown-value and user-override cases
    - _Requirements: 1.2, 1.4, 1.5, 1.6, 1.8, 1.9, 2.1, 2.2, 2.4, 2.5, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Test helpers
  - [x] 3.1 Write the test DXF writer `tests/plan/helpers/dxfWriter.ts`
    - Writes ASCII DXF text: header (`$ACADVER`, `$INSUNITS`, `$MEASUREMENT`), `LAYER` table, `BLOCKS` (door block), `ENTITIES` with `LINE`, `LWPOLYLINE` (with bulge), `ARC`, `CIRCLE`, `INSERT` (scale, rotation, mirroring, nesting)
    - Option to write coordinates in any of the five units
    - _Requirements: 20.1, 20.2, 20.3_

  - [x] 3.2 Write the random grid plan generator `tests/plan/helpers/planArbitraries.ts`
    - fast-check arbitraries that build a grid plan (rooms in a grid layout, doors, exits, a stair across several floors) within the fire and crowd limits, with shrinking-friendly structure
    - Return both the DXF text (via the writer) and the expected Rooms, Doors, Exits and Stair_Links
    - Variants that draw walls as single lines, parallel pairs and closed outlines, and doors as blocks, swing arcs and plain gaps
    - _Requirements: 20.1, 20.8_

- [x] 4. Layer role suggestion
  - [x] 4.1 Implement `layers.ts`
    - `normalizeLayerName` (uppercase, NFD diacritic stripping, remove `-`, `_` and space) and `suggestLayerRole` using `LAYER_ROLE_TABLE`; unmatched names give `ignore`
    - Table covers `A-WALL`, `A-DOOR`, `A-GLAZ`, `A-FLOR-STRS`, `A-FURN`, `TUONG`, `CUA`, `CUA SO`, `CAU THANG` and the same names without diacritics, with and without separators
    - Layer confirmation logic: a layer with at least one entity is unconfirmed until `ImportSettings.layerMaps` names it; return `LAYER_UNCONFIRMED` pending questions
    - Entity count per layer for the UI
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.9_

  - [x] 4.2 Write property test for layer name normalization in `tests/plan/layers.property.test.ts`
    - **Property 8: Layer name normalization is confluent**
    - Include example tests for each named table entry
    - **Validates: Requirements 5.2, 5.3**

- [x] 5. Checkpoint - reader and layers
  - Ensure all tests pass. Record choices under "Decisions during implementation" in design.md; stop only if a test cannot pass without changing a requirement.

- [x] 6. Floor sources and grid
  - [x] 6.1 Implement `floorSources.ts`
    - One Floor_Source per file in upload order, or per layer-set or block assignment within one file
    - Unique floor id, editable name, per-floor manual offset in metres
    - Common origin: minimum corner of the union of floor extents, rounded down to a multiple of `CELL_SIZE_M` imported from `src/core/people/constants`
    - Block floors are translated so their bounding-box minimum corners coincide unless a manual offset is given; layer-set floors keep coordinates
    - Return `invalid` with `FLOOR_NO_WALLS` when a floor has no `wall` entity
    - Return `invalid` when a floor needs more than `MAX_CELLS_PER_FLOOR` cells, naming the limit and the drawing extent
    - _Requirements: 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.7_

  - [x] 6.2 Implement `grid/rasterize.ts`
    - Walk `wall`, `window` and `furniture` entities in sorted order using integer cell arithmetic; mark a cell `wall` when coverage along the wall thickness is at least half the cell width
    - Thickness from parallel pairs and closed outlines; `DEFAULT_WALL_THICKNESS_M` for single lines, covering at least one cell width
    - Window and furniture layers rasterize as `wall` cells, and are also returned as separate lists for the fire deriver
    - State the exact coverage rule in a code comment and in design.md "Decisions during implementation" if it needs refinement
    - _Requirements: 5.6, 5.7, 6.1, 6.2, 6.3, 6.6, 6.7_

  - [x] 6.3 Implement `grid/gaps.ts`
    - Bounded-radius gap closing up to `GAP_TOLERANCE_M` along the wall direction; one `GAP_CLOSED` warning naming floor and cell position per closed gap
    - Linear time: scan a fixed neighbourhood per wall cell, no all-pairs step
    - _Requirements: 3.8, 6.4, 6.5_

  - [x] 6.4 Write property test for INSERT transform equivalence in `tests/plan/transform.property.test.ts`
    - **Property 3: INSERT transform equivalence**
    - Rotations in multiples of 90 degrees, uniform and negative (mirrored) scales, nested inserts; compare rasterized cells from `readDxf` + units + `rasterize` + gap closing against the same geometry drawn directly
    - **Validates: Requirements 1.5, 1.7, 20.3**

  - [x] 6.5 Write unit tests for floor sources, rasterizer and gaps in `tests/plan/grid.test.ts`
    - Single-line thickness covers one cell; parallel pair thickness from drawing; closed outline; gap below 0.10 m closed with warning; gap at or above 0.10 m kept; common origin rounding; manual offset; floor with no walls is invalid; cell limit error; bit-identical repeat
    - _Requirements: 4.3, 4.4, 4.5, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 20.10_

- [x] 7. Doors
  - [x] 7.1 Implement `grid/doors.ts`
    - Door from `INSERT` on a `door` layer (width from transformed block extent along the wall), from `ARC` or `CIRCLE` swing (width from radius, clamped to the cell grid), and from a plain wall gap
    - Width = door cells across the gap × 0.25 m, computed once and reused for the fire vent
    - Keep doors under `DOOR_WIDTH_MIN_M` or over `DOOR_WIDTH_MAX_M` with a `DOOR_WIDTH_RANGE` warning; discard doors with no wall or no room on both sides with `DOOR_DISCARDED`
    - Ids `${floorId}:door${k}`, k in row-major order of each door's first cell
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 7.2 Write unit tests for doors in `tests/plan/doors.test.ts`
    - Block door, swing-arc door width from radius, plain-gap door, width 0.25 m multiples, door under 0.5 m and over 3.0 m kept with warning, discarded door, stable ids
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 20.10_

- [x] 8. Rooms
  - [x] 8.1 Implement `grid/rooms.ts`
    - 4-connected flood fill over cells that are not `wall` or `door` (iterative, no recursion)
    - Room ids `${floorId}:room${k}` in row-major order of first cell; default name from id; names 1 to 60 characters; default kind `room`
    - Border-touching region is the outside area, creates no Room, and warns `ROOM_OUTSIDE_LARGE` above `OUTSIDE_REGION_WARN_FRACTION` with no exterior door
    - Discard rooms under `MIN_ROOM_AREA_M2`: cells become `wall`, warn `ROOM_TOO_SMALL`
    - Assign compartment ids to `free`, `door`, `exit` and `stair` cells; door cells take the lower room id of the two sides
    - Compute area, bounding box width and height, door sides (`roomIdA`, `roomIdB`, `OUTSIDE`)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 8.2 Write unit tests for rooms in `tests/plan/rooms.test.ts`
    - Door separates rooms; closed door leaves rooms unchanged; stable ids; outside region warning; sliver room discarded; name length bounds; door compartment id rule
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7_

- [x] 9. Compartment boxes
  - [x] 9.1 Implement `derive/equivalentBox.ts`
    - `widthM = sqrt(A * r)`, `depthM = sqrt(A / r)` with `r` the bounding-box width-to-depth ratio, width along the grid x axis
    - Kind mapping `room→room`, `corridor→corridor`, `stair→shaft` with `isStair: true`
    - Report area error of the box (zero by construction) and relative bounding-box area difference; `ROOM_NOT_RECTANGULAR` warning above `NON_RECTANGULAR_WARN_FRACTION`
    - Build the `Compartment` with default surfaces from `constants.ts`; width, depth and height greater than 0
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 9.8_

  - [x] 9.2 Write unit tests for the compartment mapper in `tests/plan/equivalentBox.test.ts`
    - Rectangular room has no warning; L-shaped room warns with both areas and the relative difference; kind mapping; default surfaces accepted by the fire validator
    - _Requirements: 9.3, 9.4, 9.5, 9.7, 9.8, 20.10_

- [x] 10. Floors and stairs
  - [x] 10.1 Implement floor settings in `model/floorSettings.ts`
    - Defaults: first floor elevation 0.0 m, each next floor plus `DEFAULT_FLOOR_TO_FLOOR_HEIGHT_M`; ceiling height defaults to floor-to-floor height
    - Reject elevation outside -10 to 100 m or ceiling height outside `CEILING_HEIGHT_MIN_M` to `CEILING_HEIGHT_MAX_M` (or non-finite), keep the previous value, warn `FLOOR_FIELD_INVALID` naming the field
    - Warn `FLOOR_STACKING` naming both floors when stacking differs by more than 0.01 m; keep the values
    - Same elevation goes to crowd `FloorInput.elevationM` and fire `floorElevationM`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 10.2 Implement `model/stairs.ts`
    - Stair_Region from user cells, from a flood-filled room set to kind `stair`, and proposed (unconfirmed) from closed `stair`-layer outlines
    - `StairLink` for adjacent floors when overlap is at least `STAIR_OVERLAP_MIN_FRACTION` of the smaller region; footprint is the intersection; width is the shorter side of the footprint bounding box; identical stair cells on both floors
    - Below tolerance: no link and an error warning `STAIR_OVERLAP_BELOW_TOLERANCE` naming both floors and regions
    - Cells of a region outside the link footprint revert to `free` with `STAIR_REGION_TRIMMED`
    - One stair compartment per floor with a region; no link on a side with no neighbour; optional roof opening input (area, open fraction) on the top stair compartment
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.10, 11.12_

  - [x] 10.3 Write property test for stair overlap tolerance in `tests/plan/stairs.property.test.ts`
    - **Property 11: Stair overlap tolerance decides link creation**
    - **Validates: Requirements 11.3, 11.4, 11.5**

  - [x] 10.4 Write unit tests for floors and stairs in `tests/plan/floorsStairs.test.ts`
    - Floor defaults, invalid elevation and ceiling height keep previous value, stacking warning, overlap just below and just at the tolerance, trimmed cells warning, top and bottom floor stairs without a link, roof opening
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 11.3, 11.4, 11.6, 11.10, 11.12, 20.10_

- [x] 11. Exits
  - [x] 11.1 Implement `model/exits.ts`
    - Suggest as unconfirmed Exits every door on the lowest-elevation floor with a room on one side and the outside area on the other
    - Confirm, add or remove exits by door id on any floor with an outside-facing door; reject a mark on a door with no outside side with `EXIT_REJECTED`
    - Mark `isExit`; `NO_EXIT` warning when none is confirmed; still return a model
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 12.7_

  - [x] 11.2 Write unit tests for exits in `tests/plan/exits.test.ts`
    - Suggestion on ground floor only, confirm and remove, rejected mark, no-exit warning with a valid model, exit marks keyed by door id
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 12.7_

- [x] 12. Edits
  - [x] 12.1 Implement `model/edits.ts`
    - Apply `paintWall`, `eraseWall`, `setDoorOpen`, `setWindowOpen`, `renameRoom`, `setRoomKind` in recorded order on every rebuild; undo removes the last edit
    - Ignore an edit outside the grid or on a missing floor with `EDIT_IGNORED`
    - When rooms merge or split, keep name and kind of rooms whose first cell is unchanged and warn `ROOM_IDENTITY_LOST` naming the changed rooms
    - Name length 1 to 60 characters enforced
    - _Requirements: 8.3, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9_

  - [x] 12.2 Write unit tests for edits in `tests/plan/edits.test.ts`
    - Paint and erase, door open and closed, rename, set kind, undo, merge and split identity rules, out-of-range edit ignored with warning
    - _Requirements: 15.4, 15.5, 15.6, 15.7_

- [x] 13. Derivers
  - [x] 13.1 Implement `derive/toPlanInput.ts`
    - Build the crowd `PlanInput` (floors, cell types, compartment ids, compartments with kind, stair links with the same two floor ids, elevations)
    - Confirmed exits: door cells become `exit` for the full width plus matching `exit` cells on the outside side; closed doors become `wall`
    - Window and furniture cells are `wall`
    - _Requirements: 5.6, 5.7, 12.3, 13.6, 14.1, 14.5, 14.6, 14.7_

  - [x] 13.2 Implement `derive/toFireGeometry.ts`
    - One `WallVent` per door between two rooms (`from` is the lower id, `widthM` the door width, sill and soffit constants) and one per window the user marked open (open fraction 1, outer-wall windows go to `"OUTSIDE"`; closed windows, the default, give no vent); one `WallVent` to `"OUTSIDE"` per confirmed exit
    - `face` is the nearest side of the `from` Equivalent_Box; `offsetM` clamped so the vent lies inside the wall; width reduced to the wall length with `VENT_WIDTH_CLAMPED`
    - Open door `open: 1`, closed door `open: 0`
    - Stair compartments (`shaft`, `isStair`), one `CeilingFloorVent` per `StairLink` with area equal to the footprint area, open fraction 1, upper `floorElevationM` equal to lower elevation plus lower height; roof opening vent to `"OUTSIDE"`; door `WallVent` between a stair compartment and another room
    - Vent ids `${doorOrWindowId}:vent`; furniture omitted
    - Return an error warning `VENT_LIMIT` naming the count when vents exceed `FIRE_MAX_VENTS`
    - _Requirements: 5.6, 5.7, 11.7, 11.8, 11.9, 11.10, 12.4, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 14.2, 14.3, 14.4, 14.5_

  - [x] 13.3 Write property test for door width and vent width in `tests/plan/doorWidth.property.test.ts`
    - **Property 9: Door width equals the fire vent width**
    - **Validates: Requirements 7.4, 14.2**

  - [x] 13.4 Write property test for the equivalent box in `tests/plan/equivalentBox.property.test.ts`
    - **Property 10: Equivalent box matches Room area and aspect ratio**
    - Also assert the Compartment with default surfaces passes the fire `Input_Validator` and the matching compartment entry passes the crowd `buildPlan`
    - **Validates: Requirements 9.2, 9.5, 9.7, 9.8, 20.8**

  - [x] 13.5 Write unit tests for the derivers in `tests/plan/derive.test.ts`
    - Closed door vent and crowd wall, window vent, exit vent and exit cells, vent wider than wall clamped with warning, vent limit error with count, stair `CeilingFloorVent` elevation rule, roof vent, vent id format
    - _Requirements: 11.8, 11.10, 12.3, 12.4, 13.2, 13.6, 13.7, 13.8, 13.9, 20.10_

- [x] 14. Orchestration, agreement and limits
  - [x] 14.1 Implement `import.ts`
    - `importBuildingModel(sources, settings)`: read DXF, units, layers, floor sources, rasterize, gaps, doors, rooms, stairs, exits, edits, floor settings; return `ImportResult` with `pendingQuestions` for unresolved units and unconfirmed layer maps (model withheld)
    - Run `toPlanInput` and `toFireGeometry` and attach warnings
    - Throw `TypeError` only when `sources` is not an array or an element's `text` is not a string; every other bad input returns `invalid` with warnings
    - Pure and deterministic; no network, clock or random
    - _Requirements: 2.3, 3.8, 5.4, 5.5, 10.6, 14.7, 22.3, 22.4, 22.7_

  - [x] 14.2 Implement `agreement.ts` and the limit checks, and call them from `import.ts`
    - `checkAgreement`: equal compartment id sets, one vent per open door with equal width, one vent to `"OUTSIDE"` per exit, closed doors with open 0 and no door cell, one `CeilingFloorVent` and one `StairLinkInput` per link with the same floors, equal kind mapping; return `invalid` naming the broken agreement (`AGREEMENT_BROKEN`)
    - Limit checks in one pass returning every exceeded limit: floors over `FIRE_MAX_FLOORS` (names "6 floors", count, model), compartments over `FIRE_MAX_COMPARTMENTS` (names "30 compartments", count), cells per floor over `MAX_CELLS_PER_FLOOR` (names limit and grid size), vents over `FIRE_MAX_VENTS`
    - Expose counts of floors, compartments, vents and cells per floor next to their limits for the UI
    - _Requirements: 13.8, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.8, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

  - [x] 14.3 Write property test for the DXF round trip in `tests/plan/roundTrip.property.test.ts`
    - **Property 1: DXF round trip of a generated grid plan**
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.7, 7.1, 7.2, 7.3, 8.1, 8.2, 20.1**

  - [x] 14.4 Write property test for unit scaling in `tests/plan/units.property.test.ts`
    - **Property 2: Unit scaling agreement**
    - **Validates: Requirements 2.1, 20.2**

  - [x] 14.5 Write property test for agreement of the derived outputs in `tests/plan/agreement.property.test.ts`
    - **Property 4: Agreement of the two derived outputs**
    - Also assert the derived `PlanInput` is accepted by `buildPlan` with status "valid" and the fire geometry inside a minimal `Scenario` is accepted by the fire input validator
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 20.4, 20.8**

  - [x] 14.6 Write property test for malformed and truncated DXF in `tests/plan/robustness.property.test.ts`
    - **Property 6: Malformed or truncated DXF never throws and never hangs**
    - Random cuts, changed lines and random bytes on valid DXF text, plus arbitrary strings; each call returns `ok` or `invalid` within 5 s
    - **Validates: Requirements 3.1, 3.6, 3.8, 20.6, 22.3**

  - [x] 14.7 Write property test for determinism in `tests/plan/determinism.property.test.ts`
    - **Property 7: Determinism**
    - Deep-equal results including the `Uint8Array` cell grids
    - **Validates: Requirements 6.6, 14.7, 18.6, 22.4**

  - [x] 14.8 Write property test for edit stability in `tests/plan/editsStable.property.test.ts`
    - **Property 12: Edit application is replay-stable and out-of-range edits are no-ops**
    - **Validates: Requirements 15.4, 15.5, 15.7**

  - [x] 14.9 Write property test for no throw on object-shaped input in `tests/plan/noThrow.property.test.ts`
    - **Property 13: No throw on any object-shaped input**
    - **Validates: Requirements 20.6, 22.3**

  - [x] 14.10 Write unit tests for orchestration, limits and size cap in `tests/plan/import.test.ts`
    - File over 20 MB refused with the limit named before parsing; 7 floors, 31 compartments, cell limit and 61 vents each at the boundary, with all exceeded limits returned in one result; pending questions withhold the model for unitless files and unconfirmed layers; wrong argument type throws `TypeError`; no-exit warning keeps a valid model
    - _Requirements: 2.3, 3.2, 3.7, 5.4, 13.8, 17.1, 17.2, 17.3, 17.6, 20.7, 20.10, 22.3_

- [x] 15. Project file
  - [x] 15.1 Implement `project/schema.ts`, `project/save.ts` and `project/load.ts`
    - `ProjectFileV1` types; `save` serializes JSON with `schemaVersion: 1`, source DXF text kept verbatim, layer maps, units, floor sources, floor settings, edits, exit marks, stair regions, room names and kinds
    - `load` validates field by field and names the first invalid field; unknown `schemaVersion` error names the version found and versions supported and leaves the current project untouched; invalid JSON returns an error, never throws
    - Apply `DXF_MAX_BYTES` to each source text and `PROJECT_FILE_MAX_BYTES` to the whole file
    - Rebuild by calling `importBuildingModel` with the stored sources and settings
    - _Requirements: 2.5, 5.8, 12.7, 15.8, 16.1, 16.3, 16.4, 16.5, 16.6, 16.9, 16.10_

  - [x] 15.2 Write property test for project file round trip in `tests/plan/project.property.test.ts`
    - **Property 5: Project file save/load round trip**
    - **Validates: Requirements 16.3, 16.4, 20.5**

  - [x] 15.3 Write unit tests for the project file in `tests/plan/project.test.ts`
    - Unknown version error text, malformed JSON, wrong field type names the first field, oversize source text, oversize project file, layer maps restored without asking
    - _Requirements: 5.8, 16.5, 16.6, 16.9_

- [x] 16. Sample generator
  - [x] 16.1 Implement sample builders in `tools/samples/cafe.ts`, `karaoke.ts` and `boardingHouse.ts`
    - Pure functions returning DXF text: header with `$INSUNITS` 6, group code 999 comment stating the drawing is invented, layers `A-WALL`, `A-DOOR`, `A-GLAZ`, `A-FLOR-STRS`, `A-FURN`, door blocks, door swing arcs, walls
    - Café: one floor of about 120 m², two exits. Karaoke bar: one floor, at least six small rooms off one corridor, one exit. Boarding house: four floors on a narrow lot, one stair, one ground-floor exit
    - No clock, no random values
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

  - [x] 16.2 Implement `tools/samples/generate.ts`, the npm script and the committed files
    - Writes `public/samples/cafe.dxf`, `karaoke.dxf`, `boarding-house.dxf` (not under `public/fonts/`); built and run with esbuild, as the other tool scripts are
    - Add `"samples"` script to `package.json`; run it once and keep the generated files
    - _Requirements: 18.1, 18.6, 18.8, 18.10_

  - [x] 16.3 Write sample tests in `tests/plan/samples.test.ts`
    - Run the generator into memory and diff byte for byte against the committed files
    - Assert room count, door count, exit count and floor count of each sample, and that derived outputs are accepted by `buildPlan` and the fire input validator
    - Assert the header comment says the drawing is invented
    - _Requirements: 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.10, 20.9_

- [x] 17. Performance
  - [x] 17.1 Write the benchmark test `tests/plan/bench/boardingHouse.bench.test.ts`
    - Two modes in the same file, so the boarding-house import bound runs in plain `npm test`:
      - Plain `npm test` mode: one warm-up import, then a single timed import of the boarding house sample in Node (parse, rasterize, rooms, both derivations); assert a hard ceiling of 1 s (Requirement 21.1)
      - Plain `npm test` mode, same rule: one warm-up edit, then a single timed edit on the boarding house sample that recomputes derived outputs; assert under 200 ms (Estimate, Requirement 21.2)
      - Strict mode, gated like `tests/fire/bench` and run only by the `test:bench:plan` script: median of 5 runs after one warm-up run for both the import (under 1 s) and the edit recompute (under 200 ms)
    - Add the `test:bench:plan` script to `package.json`; it runs the strict mode only
    - If a bound fails, optimise the pipeline (e.g. skip rasterization when only names change) before stopping
    - _Requirements: 21.1, 21.2_

- [x] 18. Import screen
  - [x] 18.1 Implement `src/web/plan/importScreen.ts`
    - Plain DOM, no framework; drop and file chooser; extension sniffing (`.dxf` or first non-empty line `0` then `SECTION`), otherwise show "Save as DXF (ASCII)" without calling the core reader
    - Layer-role table (name, entity count, suggested role, selector); unit question with suggestion and drawing extent in metres; floor settings (name, elevation, ceiling height, offset); floor ordering; layer or block assignment for one file
    - Warning list with severity, text and a jump-to-location control; limits counts next to limits; sample buttons labelled invented; "Use this plan" enabled only when status is `ok`, followed by the summary of compartments (id, name, kind, width, depth, height, area error), vents (id, from, to, width, open fraction) and crowd plan counts; "Save project" download and "Load project"
    - All DXF-derived text via `textContent` only; required safety notice on every results screen; estimates labelled as estimates; visible stair warning citing the fire-model stair/shaft limit and Tech Ref 1.5; warnings at long corridors and materials without measured data where applicable; plain, calm wording; layout fits 1280×800 with no horizontal page scroll
    - _Requirements: 2.2, 2.6, 3.9, 3.10, 4.1, 4.2, 4.5, 4.6, 5.9, 10.1, 11.11, 16.2, 17.5, 18.9, 19.1, 19.2, 19.6, 19.7, 19.8, 19.9, 19.10, 19.11, 19.12, 19.13, 19.14, 19.15, 22.8_

  - [x] 18.2 Implement `src/web/plan/render/preview.ts` and `src/web/plan/render/gridView.ts`
    - Canvas 2D preview with layers coloured by role and a legend
    - Per-floor grid view with rooms in distinct colours and name labels, doors, exits and stair cells marked; click to mark or unmark exits and stair regions; paint and erase wall cells (single cell or dragged line); set doors open or closed; rename rooms and set room kind; undo; highlight a warning location
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 19.3, 19.4, 19.5, 19.7_

  - [x] 18.3 Implement `src/web/plan/planWorker.ts` and `src/web/plan/storage.ts`
    - `planWorker.ts`: Web Worker wrapper that only moves arguments and results across `postMessage`; all logic stays in `src/core/plan/`
    - `storage.ts`: write the project file to `localStorage` under one fixed key on each change; offer restore on open; catch write failures here only, show a message that the project was not stored in the browser and the download still works, continue
    - No `fetch`, `XMLHttpRequest` or other network call in `src/core/plan/` or `src/web/plan/`
    - _Requirements: 16.7, 16.8, 16.10, 21.3, 22.7_

  - [x] 18.4 Write DOM tests with happy-dom in `tests/plan/web.test.ts`
    - DXF-derived text (layer and block names) appears via `textContent` and a name like `<img onerror=...>` creates no element; scan `src/web/plan/` source for `innerHTML`, `outerHTML` and `insertAdjacentHTML` and fail on any use
    - Safety notice present on the results view; banned words ("safe", "compliant", "certified", "passes", "meets code") absent from UI strings; "Use this plan" disabled unless status is `ok`; stair warning shown; localStorage failure shows the message and continues
    - Source scan finds no `fetch`, `XMLHttpRequest`, `eval`, `new Function` or dynamic import in `src/core/plan/` and `src/web/plan/`
    - Import runs off the main thread: inject a mock worker wrapper (from `planWorker.ts`) into the import screen, load a file, and assert the mock received the import call and that the screen did not call `importBuildingModel` directly (spy on or stub the core entry point and assert zero calls); the result shown comes from the mock's reply
    - Add `happy-dom` as a dev dependency pinned to an exact version if it is not yet installed
    - _Requirements: 3.9, 16.8, 19.8, 19.12, 19.14, 20.11, 21.3, 22.7_

- [x] 19. Wiring
  - [x] 19.1 Wire the import screen into `src/web/main.ts`
    - Add the plan import screen as an entry in the existing app shell without changing the existing fire screen behaviour
    - Pass `PlanInput` and the Fire_Geometry to the summary on "Use this plan"
    - Add Vite/CSP-compatible worker loading that uses only the app's own origin
    - _Requirements: 19.8, 19.9, 19.11, 21.3_

- [x] 20. Final checkpoint - npm test, typecheck and plan benchmark
  - Run `npm test` and `npm run typecheck`. Both must pass with no errors.
  - Confirm that `git status` shows no changes under `src/core/fire/` or `src/core/people/`.
  - Run `npm run test:bench:plan` and report the measured timings (import median and edit-recompute median) in the final report.
  - Ensure all tests pass. Record choices under "Decisions during implementation" in design.md; stop only if a test cannot pass without changing a requirement.

## Notes

- Every task is required, including tests, because the whole plan is implemented in order.
- Each property test sub-task names the design property it checks and the requirements it validates.
- Choices that requirements.md and design.md do not settle go under "Decisions during implementation" in design.md, with the reason.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.2", "16.1"] },
    { "id": 3, "tasks": ["2.3", "16.2"] },
    { "id": 4, "tasks": ["2.4", "6.1", "6.2", "9.1", "10.1"] },
    { "id": 5, "tasks": ["6.3", "7.1", "9.2", "10.2"] },
    { "id": 6, "tasks": ["6.4", "6.5", "7.2", "8.1", "10.3", "10.4"] },
    { "id": 7, "tasks": ["8.2", "11.1", "12.1"] },
    { "id": 8, "tasks": ["11.2", "12.2", "13.1", "13.2"] },
    { "id": 9, "tasks": ["13.3", "13.4", "13.5", "14.1"] },
    { "id": 10, "tasks": ["14.2", "15.1"] },
    { "id": 11, "tasks": ["14.3", "14.4", "14.5", "14.6", "14.7", "14.8", "14.9", "14.10", "15.2", "15.3", "16.3", "17.1", "18.2", "18.3"] },
    { "id": 12, "tasks": ["18.1"] },
    { "id": 13, "tasks": ["18.4", "19.1"] }
  ]
}
```
