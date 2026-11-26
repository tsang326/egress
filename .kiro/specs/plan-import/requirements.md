# Requirements Document

## Introduction

The plan-import feature turns a user's CAD drawings into the inputs of both models. The user loads one DXF file per floor (or one DXF file with several floors on separate layers or blocks), assigns a role to each layer, marks exits and the stair, and obtains one Building_Model. The Building_Model is the single source from which two derived outputs are computed: the crowd `PlanInput` (`src/core/people/types.ts`: floors on the 0.25 m grid with cell types and compartment ids, stair links, compartments with kind) and the fire geometry (`src/core/fire/types.ts`: `Compartment`, `WallVent`, `CeilingFloorVent`, default surfaces). The two outputs agree: the same compartment ids, one `WallVent` of equal width for every door in the crowd grid, and one `WallVent` to the Outside for every exit.

The core lives in `src/core/plan/` as pure functions (no DOM, no globals, no `Math.random`, SI units, constants with sources in `constants.ts`). The import screen lives in `src/web/`. A sample generator lives in `tools/`. The generated sample drawings are committed under `public/samples/`.

This spec does not change the fire model (`src/core/fire/`) or the crowd model (`src/core/people/`). Where a field that the import needs does not exist in those models, this spec defines it in its own types and converts it into the model types.

The app is a reference simulation. It never states or implies that a building is safe, compliant, approved or certified (`.kiro/steering/safety.md`).

Implementation instruction: after requirements.md, design.md and tasks.md are written, every task in tasks.md is implemented in order, without stopping to ask the user for choices. Every choice that the requirements or the design do not settle is recorded as a list entry under the heading "Decisions during implementation" in design.md, with the reason. Implementation stops only when a test cannot pass without changing a requirement; the stop report names that requirement and the test. No task runs `git commit`; the user commits. No task edits files under `src/core/fire/` or `src/core/people/`.

## Glossary

- **Importer**: The module in `src/core/plan/` that converts DXF text and user settings into a Building_Model and its derived outputs.
- **DXF_Reader**: The component of the Importer that reads ASCII DXF text into Entities, with the caps of Requirement 3.
- **Entity**: One drawing object read from a DXF file: `LINE`, `LWPOLYLINE`, `POLYLINE` (2D), `ARC`, `CIRCLE` or `INSERT`. Other entity types are skipped and counted.
- **Block_Definition**: A named group of Entities in the BLOCKS section of a DXF file, instantiated by an `INSERT` with insertion point, scale, rotation and mirroring.
- **Drawing_Unit**: The length unit of the drawing coordinates, taken from `$INSUNITS`, `$MEASUREMENT` or the user's answer.
- **Layer_Role**: The meaning assigned to a DXF layer: `wall`, `door`, `window`, `stair`, `furniture` or `ignore`.
- **Layer_Map**: The assignment of one Layer_Role to each layer of one DXF file.
- **Floor_Source**: The part of a DXF file that holds one floor: a whole file, a set of layers, or one block.
- **Floor_Settings**: The elevation in metres and the ceiling height in metres of one floor, and the floor id and name.
- **Cell**: A square of 0.25 m by 0.25 m of the grid, with one of the crowd cell types `wall`, `free`, `door`, `exit` or `stair`.
- **Grid_Builder**: The component of the Importer that rasterizes Entities into Cells.
- **Door**: An opening in a wall, with a width in metres and an open or closed state, made of door Cells across the wall gap.
- **Exit**: A Door on the outer wall that leads out of the building, confirmed by the user.
- **Room**: A flood-filled region of non-wall Cells on one floor, with an id, a user-editable name and a Room_Kind.
- **Room_Kind**: One of `room`, `corridor` or `stair`.
- **Stair_Region**: A region of Cells that the user marks as stair on one floor.
- **Edit**: One user change after import: paint or erase a wall Cell, set a Door open or closed, rename a Room, or set the Room_Kind of a Room.
- **Building_Model**: The one internal model, built from the drawings, Layer_Maps, Floor_Settings, Edits, Exit marks and Stair_Regions, from which both derived outputs are computed.
- **Plan_Deriver**: The component that computes the crowd `PlanInput` from the Building_Model.
- **Fire_Deriver**: The component that computes the Fire_Geometry from the Building_Model.
- **Fire_Geometry**: The list of fire `Compartment` objects and fire `Vent` objects derived from the Building_Model, with default surfaces, without fires, ambient or duration.
- **Compartment_Mapper**: The component of the Fire_Deriver that maps a Room to a box `Compartment`.
- **Equivalent_Box**: The box compartment with the same floor area as a Room and the width-to-depth ratio of the bounding box of the Room.
- **Project_File**: The versioned JSON document that holds the whole state of an import session.
- **Import_Screen**: The screen in `src/web/` where the user performs the import.
- **Import_Warning**: A structured message with a code, a plain-language text, a severity (`error` or `warning`) and a location (file, layer, floor, room, door or cell).
- **Import_Result**: The return value of an import call: a status (`ok` or `invalid`), the Building_Model (absent when invalid) and a list of Import_Warnings.
- **Outside**: The fire vent end `"OUTSIDE"`.
- **Crowd_Limits**: The limits of the crowd model in `src/core/people/constants.ts`: 12 floors, 100 compartments, 1,000,000 Cells per floor.
- **Fire_Limits**: The limits of the fire model: 6 floors, 30 compartments, 60 vents (fire-zone requirement 1, criteria 1 and 4).
- **Estimate**: A value with no cited source. Each Estimate is labelled as an estimate in code, in the UI and in design.md.

## Requirements

### Requirement 1: DXF reading

**User Story:** As a building owner, I want to load the DXF file my designer gave me, so that I do not redraw the plan.

#### Acceptance Criteria

1. WHEN the user supplies DXF text with a `$ACADVER` value from `AC1009` to `AC1032` inclusive, THE DXF_Reader SHALL read the ASCII text into Entities and Block_Definitions.
2. WHEN the DXF_Reader reads a file with no `$ACADVER` value, THE DXF_Reader SHALL read the file as `AC1009` and add one Import_Warning that names the missing version.
3. THE DXF_Reader SHALL read the entity types `LINE`, `LWPOLYLINE`, `POLYLINE` with `VERTEX` (2D, including the closed flag), `ARC`, `CIRCLE` and `INSERT`.
4. WHEN the DXF_Reader reads an `LWPOLYLINE` or `POLYLINE` vertex with a bulge value, THE DXF_Reader SHALL replace the segment with an arc segment of the stated bulge.
5. WHEN the DXF_Reader reads an `INSERT`, THE DXF_Reader SHALL apply the insertion point, the X scale, the Y scale, the rotation in degrees and the mirroring that follows from a negative scale to every Entity of the referenced Block_Definition, including `INSERT` entities nested inside that block.
6. WHEN the DXF_Reader meets an entity type outside the list of criterion 3, THE DXF_Reader SHALL skip the entity and add one Import_Warning per entity type that gives the type name and the count.
7. WHEN the DXF_Reader reads an `INSERT` with a non-uniform scale or a rotation that is not a multiple of 90 degrees, THE DXF_Reader SHALL apply the full transformation to the Entities of the block.
8. IF the supplied text is a binary DXF file, a DWG file, a PDF file or an image, THEN THE DXF_Reader SHALL return an Import_Result with status "invalid" and an error whose text contains the phrase "Save as DXF (ASCII)".
9. IF the supplied text has a `$ACADVER` value outside `AC1009` to `AC1032`, THEN THE DXF_Reader SHALL return an Import_Result with status "invalid" and an error that names the version and contains the phrase "Save as DXF (ASCII)".
10. WHERE the dxf-parser package, pinned to exact version 1.1.2 (MIT licence), reads every entity type and every `INSERT` feature of criteria 3 to 7 and the units of Requirement 2, THE DXF_Reader SHALL use dxf-parser as its reader. IF dxf-parser does not read one of them, THEN THE DXF_Reader SHALL use an own reader for ASCII DXF, and design.md SHALL state the test that decided the choice.

### Requirement 2: Drawing units

**User Story:** As a building owner, I want the plan to come in at the right size, so that rooms and doors have real dimensions.

#### Acceptance Criteria

1. WHEN a DXF file has a `$INSUNITS` value of 1 (inch), 2 (feet), 4 (millimetre), 5 (centimetre) or 6 (metre), THE Importer SHALL set the Drawing_Unit to that unit and convert all coordinates to metres with the factors 0.0254, 0.3048, 0.001, 0.01 and 1.
2. WHEN a DXF file has a `$INSUNITS` value of 0 or no `$INSUNITS` value, THE Importer SHALL ask the user to choose the Drawing_Unit from millimetre, centimetre, metre, inch and feet, and SHALL pre-select the unit that follows from `$MEASUREMENT` (0 English: inch, 1 metric: millimetre) and mark the pre-selection as a suggestion.
3. WHILE the user has not chosen a Drawing_Unit for a DXF file with unitless coordinates, THE Importer SHALL withhold the Building_Model for that file and show the question.
4. IF a DXF file has a `$INSUNITS` value that is not in criterion 1 or 0, THEN THE Importer SHALL treat the file as unitless and ask the user as in criterion 2.
5. WHEN the user chooses a Drawing_Unit that differs from the `$INSUNITS` value, THE Importer SHALL use the chosen unit and store it in the Project_File.
6. THE Importer SHALL show the width and depth of the drawing extent in metres next to the unit choice, so that the user can check the scale.

### Requirement 3: Untrusted input and caps

**User Story:** As a user, I want a broken or hostile file to give me a clear message, so that the app never freezes or crashes.

#### Acceptance Criteria

1. THE DXF_Reader SHALL treat DXF text as data, and SHALL NOT evaluate, execute or dynamically import any content of a DXF file.
2. IF a DXF file is larger than 20 MB (20,971,520 bytes), THEN THE DXF_Reader SHALL return an Import_Result with status "invalid" and an error that names the 20 MB limit, before parsing starts.
3. IF a DXF file holds more than 200,000 entities (Estimate), THEN THE DXF_Reader SHALL return an Import_Result with status "invalid" and an error that names the entity limit and the count found.
4. IF block nesting reaches a depth of more than 8 levels (Estimate), or a block references itself directly or through other blocks, THEN THE DXF_Reader SHALL skip the offending `INSERT` and add one Import_Warning that names the block.
5. IF a coordinate after unit conversion lies more than 1,000 m from the origin (Estimate), or is not a finite number, THEN THE DXF_Reader SHALL skip the Entity and add one Import_Warning that names the layer and the entity type.
6. IF DXF text is truncated, has an odd number of lines, has a group code that is not an integer, or has a number that is not parseable, THEN THE DXF_Reader SHALL return an Import_Result with status "invalid" and an error that names the line number where reading stopped, and SHALL NOT throw.
7. IF the drawing extent after unit conversion needs more than 1,000,000 Cells on one floor, THEN THE Importer SHALL return an Import_Result with status "invalid" and an error that names the Crowd_Limits cell limit and the drawing extent.
8. THE Importer SHALL end every import call in finite time that is linear in the input size within the caps of this requirement, and SHALL NOT throw for any text input.
9. THE Import_Screen SHALL show every text taken from a DXF file (layer names, block names, text) with `textContent` and SHALL NOT insert it as HTML.
10. WHEN the user supplies a file whose name does not end in `.dxf` (case-insensitive), THE Import_Screen SHALL show the phrase "Save as DXF (ASCII)" and SHALL try to read the content as DXF text only when the name ends in `.dxf` or when the first non-empty line is `0` followed by `SECTION`.

### Requirement 4: Floor sources

**User Story:** As a user with a multi-storey building, I want to load either one file per floor or one file with all floors, so that I use the drawings I have.

#### Acceptance Criteria

1. WHEN the user loads several DXF files, THE Importer SHALL create one Floor_Source per file, in the order of upload, and let the user reorder them.
2. WHEN the user loads one DXF file, THE Importer SHALL offer to assign sets of layers, or individual blocks, to floors, and SHALL create one Floor_Source per assignment.
3. WHERE a DXF file holds several floors as separate blocks, THE Importer SHALL translate each block so that its bounding-box minimum corner lies at the same position as the minimum corner of the other floors of the building, unless the user sets a manual offset in metres.
4. WHERE a DXF file holds several floors on separate layers in one coordinate frame, THE Importer SHALL keep the coordinates of each layer set unchanged.
5. WHEN several Floor_Sources are loaded, THE Importer SHALL use one common origin for all floors, so that a Stair_Region has the same Cell coordinates on adjacent floors, and SHALL let the user enter a manual offset in metres per floor.
6. THE Importer SHALL give each Floor_Source a unique floor id, a name that the user can change, and the Layer_Map of the source layers.
7. IF a Floor_Source has no Entity with the role `wall`, THEN THE Importer SHALL add an error Import_Warning that names the floor and SHALL return an Import_Result with status "invalid".

### Requirement 5: Layer roles

**User Story:** As a user, I want the app to guess what each layer means and let me correct it, so that mapping is quick and under my control.

#### Acceptance Criteria

1. THE Importer SHALL accept the Layer_Roles `wall`, `door`, `window`, `stair`, `furniture` and `ignore` for each layer.
2. WHEN a DXF file is loaded, THE Importer SHALL suggest a Layer_Role for each layer from the layer name, case-insensitively, using a table in `constants.ts` that covers at least the names `A-WALL`, `A-DOOR`, `A-GLAZ`, `A-FLOR-STRS`, `A-FURN`, `TUONG`, `CUA`, `CUA SO`, `CAU THANG` and the same names without diacritics, with and without the separators `-`, `_` and space.
3. WHEN a layer name matches no entry of the table, THE Importer SHALL suggest the role `ignore`.
4. THE Importer SHALL treat every suggested role as unconfirmed until the user confirms the Layer_Map, and SHALL withhold the Building_Model for that file while any layer that holds Entities is unconfirmed.
5. WHEN the user changes a Layer_Role, THE Importer SHALL recompute the Building_Model from that Layer_Map.
6. THE Importer SHALL treat a `window` layer as wall Cells for the crowd output. For the fire output a window is closed by default and then produces no vent; only a window the user marks open (in the edit step) produces a vent.
7. THE Importer SHALL treat a `furniture` layer as obstacle Cells (cell type `wall`) for the crowd output and SHALL omit furniture from the fire output.
8. WHEN a Project_File is saved, THE Importer SHALL store the confirmed Layer_Map per source file in it, and WHEN the Project_File is loaded, THE Importer SHALL restore the Layer_Map without asking again.
9. WHEN a layer name or block name is shown, THE Import_Screen SHALL show it as plain text with the Entity count of the layer.

### Requirement 6: Walls to grid

**User Story:** As a user, I want walls drawn as lines or as thick outlines to become walls in the simulation, so that rooms are closed where the drawing closes them.

#### Acceptance Criteria

1. THE Grid_Builder SHALL rasterize every `wall` Entity into Cells of 0.25 m, so that each Cell that the wall touches with a coverage of at least half of the Cell width along the wall thickness becomes a `wall` Cell, with the exact rule stated in design.md.
2. WHERE a wall is drawn as a pair of parallel lines or as a closed outline, THE Grid_Builder SHALL take the wall thickness from the drawing.
3. WHERE a wall is drawn as a single line, THE Grid_Builder SHALL give the wall the default single-line thickness stated in design.md as an Estimate, and SHALL cover at least one Cell width.
4. THE Grid_Builder SHALL close gaps in the wall line that are narrower than the gap tolerance of 0.10 m (Estimate, named constant, labelled as an Estimate in design.md and in the UI), so that Rooms do not leak through drawing errors.
5. WHEN the Grid_Builder closes a gap, THE Importer SHALL add one Import_Warning that gives the floor and the position of the gap.
6. WHEN the same input is imported twice, THE Grid_Builder SHALL produce bit-identical Cell arrays.
7. THE Grid_Builder SHALL place the grid origin at the minimum corner of the common drawing extent of all floors, rounded down to a multiple of 0.25 m.

### Requirement 7: Doors

**User Story:** As a user, I want doors in the drawing to become openings in the walls, so that people and smoke pass where doors are.

#### Acceptance Criteria

1. WHEN an `INSERT` lies on a `door` layer, THE Grid_Builder SHALL create door Cells across the wall gap at the position of the `INSERT`, with the width taken from the extent of the transformed block geometry along the wall.
2. WHEN an `ARC` or `CIRCLE` lies on a `door` layer with no `INSERT`, THE Grid_Builder SHALL take the door width from the radius of the swing arc (door leaf length), and SHALL place the door Cells across the wall gap that the arc touches.
3. WHEN a `door` layer holds a gap in the wall line with no block and no arc, THE Grid_Builder SHALL create door Cells across the gap with the gap width.
4. THE Grid_Builder SHALL compute the width of each Door as the number of door Cells across the gap multiplied by 0.25 m, and SHALL give the same width to the matching fire vent.
5. IF a door has a computed width of less than 0.5 m (Estimate) or more than 3.0 m (Estimate), THEN THE Importer SHALL keep the Door and add one Import_Warning that names the door, its floor, position and width.
6. IF a door position lies in no wall and has no room on both sides, THEN THE Importer SHALL discard the door and add one Import_Warning that names its floor and position.
7. THE Importer SHALL give each Door a stable id derived from its floor id and its order by position (row-major of the first Cell), and SHALL use that id for the crowd gate label and the fire vent id.

### Requirement 8: Rooms

**User Story:** As a user, I want the app to find the rooms and let me name them, so that results are reported by room.

#### Acceptance Criteria

1. THE Importer SHALL compute Rooms as 4-connected flood-filled regions of Cells that are neither `wall` nor `door`, so that door Cells separate Rooms and a closed Door does not change the Rooms.
2. THE Importer SHALL give each Room a unique id that is stable for the same input, derived from the floor id and the order of the first Cell of the Room in row-major order.
3. THE Importer SHALL give each Room a default name from its id and let the user rename it with any text of 1 to 60 characters.
4. THE Importer SHALL give each Room the Room_Kind `room`, and SHALL let the user set the Room_Kind to `room`, `corridor` or `stair`.
5. IF a flood-filled region touches the border of the grid, THEN THE Importer SHALL mark it as the outside area, SHALL NOT create a Room from it, and SHALL add one Import_Warning that names the floor when the region is larger than 25 percent of the grid area (Estimate) and no exterior door leads to it.
6. IF a Room has an area of less than 1.0 m² (Estimate), THEN THE Importer SHALL discard the Room, make its Cells `wall`, and add one Import_Warning that names the floor and position.
7. THE Importer SHALL assign every `free`, `door`, `exit` and `stair` Cell of a Room's region a compartment id equal to the Room id, and SHALL assign each door Cell the compartment id of the Room on the side with the lower Room id.

### Requirement 9: Rooms as CFAST compartments

**User Story:** As a user, I want each room to become a fire compartment of the same size, so that the fire result describes my room.

#### Acceptance Criteria

1. THE Compartment_Mapper SHALL map each Room to one fire `Compartment` whose id equals the Room id, whose `widthM` and `depthM` are those of the Equivalent_Box, whose `heightM` equals the ceiling height of the floor, and whose `floorElevationM` equals the floor elevation.
2. THE Compartment_Mapper SHALL compute the Equivalent_Box with `widthM × depthM` equal to the Room area in square metres and `widthM / depthM` equal to the width-to-depth ratio of the bounding box of the Room, where the width runs along the x axis of the grid.
3. THE Compartment_Mapper SHALL map the Room_Kind `room` to the fire kind `room`, `corridor` to `corridor`, and `stair` to `shaft` with `isStair` set to true.
4. WHEN the area of the Room differs from the area of its bounding box by more than 5 percent (Estimate), THE Compartment_Mapper SHALL add one Import_Warning that names the Room, the Room area, the bounding-box area and the relative difference, and states that the Room is not rectangular.
5. THE Compartment_Mapper SHALL report for each Room the relative area error between the Equivalent_Box and the Room, which is zero by construction, and SHALL report the relative error of the bounding-box area.
6. WHERE design.md describes how CFAST users model non-rectangular rooms, THE design SHALL cite the CFAST User's Guide in `docs/refs/cfast-users-guide/Input_File_Chapter.tex` (compartments as equivalent floor area parallelepipeds, or a cross-sectional area that varies with height) and SHALL state why this spec uses the equivalent floor area box.
7. THE Compartment_Mapper SHALL give every Compartment default ceiling, floor and wall surfaces, defined once in `constants.ts` with the source of each material property or an Estimate label, and SHALL use `Surface` objects that the fire validator accepts.
8. THE Compartment_Mapper SHALL give each Compartment a width, depth and height greater than 0, so that the fire input validator accepts the Compartment.

### Requirement 10: Floors

**User Story:** As a user, I want to set the height of each floor, so that the vertical geometry is right.

#### Acceptance Criteria

1. THE Importer SHALL let the user set for each floor an elevation in metres and a ceiling height in metres.
2. THE Importer SHALL default the elevation of the first floor to 0.0 m, and the elevation of each following floor to the elevation of the floor below plus 3.0 m (Estimate: floor-to-floor height).
3. THE Importer SHALL default the ceiling height of a floor to its floor-to-floor height, so that the compartments of adjacent floors stack to within 0.01 m, as the fire model checks.
4. IF the user sets a ceiling height that makes the upper floor elevation differ from the lower floor elevation plus the lower ceiling height by more than 0.01 m, THEN THE Importer SHALL keep the values and add one Import_Warning that names both floors.
5. IF an elevation is not a finite number from -10 to 100 m inclusive, or a ceiling height is not a finite number from 1.5 m to 10 m inclusive, THEN THE Importer SHALL reject the value, keep the previous value and add one Import_Warning that names the field.
6. WHEN the user changes a Floor_Setting, THE Importer SHALL recompute the derived outputs.
7. THE Importer SHALL write the same elevation into the crowd floor `elevationM` and into the fire `floorElevationM` of the compartments of that floor.

### Requirement 11: Stairs

**User Story:** As a user, I want to mark the stair on each floor, so that people and smoke can move between floors.

#### Acceptance Criteria

1. THE Importer SHALL let the user mark a Stair_Region on each floor by clicking Cells, by painting, or by selecting a flood-filled Room and setting its Room_Kind to `stair`.
2. WHEN a `stair` layer holds closed outlines, THE Importer SHALL propose each outline as a Stair_Region, and SHALL treat the proposal as unconfirmed until the user confirms it.
3. WHEN Stair_Regions on two adjacent floors overlap in plan by at least 50 percent of the smaller region (Estimate, named constant), THE Importer SHALL create one Stair_Link between them, with the footprint equal to the intersection of the two regions, so that the `stair` Cells are identical on both floors as the crowd Plan_Builder requires.
4. IF Stair_Regions on adjacent floors overlap by less than the tolerance of criterion 3, THEN THE Importer SHALL create no Stair_Link and add one error Import_Warning that names both floors and both regions.
5. WHEN a Stair_Link is created, THE Importer SHALL set the Stair_Link width to the shorter side of the footprint bounding box (`widthM` of `StairLinkInput`), and SHALL leave the riser and tread at the crowd defaults.
6. WHEN the Cells of a Stair_Region lie outside the footprint of the Stair_Link, THE Importer SHALL make those Cells `free` and add one Import_Warning that names the floor and the Cell count.
7. THE Importer SHALL create one stair compartment per floor that holds a Stair_Region, with kind `shaft` and `isStair` true, as fire-zone requirement 5, criterion 6 states.
8. WHEN a Stair_Link joins two stair compartments, THE Fire_Deriver SHALL create one `CeilingFloorVent` from the lower stair compartment to the upper stair compartment, with the area equal to the footprint area, open fraction 1, and the upper compartment floor elevation equal to the lower elevation plus the lower height.
9. WHEN a stair compartment has a door between it and another Room, THE Fire_Deriver SHALL create a `WallVent` for that door, as for every other door.
10. WHERE the top stair compartment of a stair has a roof opening that the user marks, THE Fire_Deriver SHALL create one `CeilingFloorVent` from the top stair compartment to the Outside, with the area and open fraction that the user enters.
11. WHEN the Building_Model holds a stair, THE Import_Screen SHALL show one visible warning at the stair that states the fire model handles stairs and vertical shafts poorly (fire-zone requirement 5, criterion 7; Tech Ref section 1.5).
12. IF a Stair_Region lies on the top or bottom floor with no region on the adjacent floor, THEN THE Importer SHALL create the stair compartment and add no Stair_Link for that side.

### Requirement 12: Exits

**User Story:** As a user, I want the app to suggest the exits and let me correct them, so that evacuation ends where I say.

#### Acceptance Criteria

1. WHEN the Building_Model is built, THE Importer SHALL suggest as an Exit each Door on the ground floor (the floor with the lowest elevation) whose one side is a Room and whose other side is the outside area, and SHALL mark the suggestion as unconfirmed.
2. THE Importer SHALL let the user confirm, add or remove an Exit by clicking a Door in the plan, on every floor that has a door to the outside area.
3. WHEN an Exit is confirmed, THE Plan_Deriver SHALL change the Door Cells of that Exit to cell type `exit`, and SHALL add `exit` Cells on the outside area side for the full width of the Door, so that the crowd Plan_Builder finds an exit group.
4. WHEN an Exit is confirmed, THE Fire_Deriver SHALL create a `WallVent` from the Room to the Outside with the width of the Door.
5. IF no Exit is confirmed, THEN THE Importer SHALL add one Import_Warning that states that no exit is marked and SHALL still produce the Building_Model.
6. IF a Door is marked as Exit and has no outside area on either side, THEN THE Importer SHALL reject the mark and add one Import_Warning that names the door.
7. THE Importer SHALL store the Exit marks in the Project_File by Door id.

### Requirement 13: Fire geometry and vents

**User Story:** As a user, I want each door and window to become a vent in the fire model, so that smoke moves through them.

#### Acceptance Criteria

1. THE Fire_Deriver SHALL create one `WallVent` for each Door between two Rooms, with `from` the Room with the lower id and `to` the other Room, `widthM` equal to the Door width, and the default sill and soffit stated in design.md as Estimates (door sill 0 m, soffit 2.0 m).
2. THE Fire_Deriver SHALL create one `WallVent` for each window the user has marked open, with `widthM` equal to the window length, the default sill and soffit stated in design.md as Estimates, and open fraction 1. A closed window (the default) SHALL produce no vent, so closed windows never count toward the 60-vent limit. (Amended by the user: closed vents with open fraction 0 carry no flow and would only use up the vent limit.)
3. WHEN a window lies on the outer wall, THE Fire_Deriver SHALL set the other end of the vent to the Outside.
4. THE Fire_Deriver SHALL set `face` to the side of the Equivalent_Box of the `from` Compartment nearest to the vent position, and `offsetM` to the distance along that wall from the corner, clamped so that the vent lies inside the wall.
5. WHEN the Door is open, THE Fire_Deriver SHALL set the vent `open` fraction to 1.
6. WHEN the Door is closed, THE Fire_Deriver SHALL set the vent `open` fraction to 0, and THE Plan_Deriver SHALL set the Door Cells to `wall`.
7. IF a vent width exceeds the width or depth of the Equivalent_Box wall that holds it, THEN THE Fire_Deriver SHALL reduce the width to the wall length and add one Import_Warning that names the vent.
8. IF the Fire_Geometry would hold more than 60 vents, THEN THE Importer SHALL return an Import_Result with status "invalid" and an error that names the Fire_Limits vent limit and the count.
9. THE Fire_Deriver SHALL give each vent a unique id derived from the id of its Door or window.

### Requirement 14: Agreement of the two outputs

**User Story:** As a developer, I want the crowd plan and the fire geometry to describe the same building, so that the crowd model can read the fire result for every cell.

#### Acceptance Criteria

1. THE Importer SHALL derive the compartment ids of the crowd `PlanInput` (`compartmentIds` and `compartments`) and the ids of the fire `Compartment` objects from the same Room ids, so that the two sets of ids are equal.
2. THE Importer SHALL produce, for every open Door of the crowd grid, exactly one fire `WallVent` between the same two compartments with `widthM` equal to the gate width in metres.
3. THE Importer SHALL produce, for every Exit, exactly one fire `WallVent` to the Outside with `widthM` equal to the exit width in metres.
4. THE Importer SHALL produce, for every closed Door, one fire `WallVent` with open fraction 0 and no door Cell in the crowd grid.
5. THE Importer SHALL produce, for every Stair_Link, one fire `CeilingFloorVent` between the two stair compartments of the linked floors, and one `StairLinkInput` with the same two floors.
6. THE Importer SHALL map the Room_Kind `stair` to the crowd compartment kind `shaft`, the Room_Kind `corridor` to `corridor` and the Room_Kind `room` to `room`.
7. WHEN the same Building_Model is derived twice, THE Plan_Deriver and THE Fire_Deriver SHALL produce deep-equal outputs, with identical numeric values bit for bit.
8. IF the Plan_Deriver or the Fire_Deriver finds that an agreement of criteria 1 to 5 does not hold, THEN THE Importer SHALL return an Import_Result with status "invalid" and an error that names the broken agreement.

### Requirement 15: Light editing

**User Story:** As a user, I want to fix small things on the grid after import, so that I do not go back to the CAD program for a missing wall.

#### Acceptance Criteria

1. THE Import_Screen SHALL let the user paint a `wall` Cell and erase a `wall` Cell in the grid view, one Cell or a dragged line of Cells at a time.
2. THE Import_Screen SHALL let the user set a Door to open or closed in the grid view.
3. THE Import_Screen SHALL let the user rename a Room and set its Room_Kind in the grid view.
4. WHEN the user makes an Edit, THE Importer SHALL append the Edit to the Edit list of the Building_Model, recompute Rooms and derived outputs, and apply the Edits in the order recorded.
5. WHEN the user undoes the last Edit, THE Importer SHALL remove the last Edit from the list and recompute the derived outputs.
6. WHEN an Edit makes two Rooms merge or splits a Room, THE Importer SHALL keep the names and kinds of the Rooms whose first Cell is unchanged and add one Import_Warning that names the changed Rooms.
7. IF an Edit lies outside the grid or on a floor that does not exist, THEN THE Importer SHALL ignore the Edit and add one Import_Warning that names the Edit.
8. THE Importer SHALL store Edits in the Project_File by floor id and Cell coordinates, so that a loaded project reproduces the edited grid.
9. THE Importer SHALL let the user mark a window open or closed (Edit `setWindowOpen`, default closed); an open window produces a fire vent (Requirement 13.2) and stays wall Cells for the crowd.

### Requirement 16: Project file

**User Story:** As a user, I want to save my work and reload it, so that I do not map the layers again.

#### Acceptance Criteria

1. WHEN the user chooses "Save project", THE Importer SHALL create a Project_File as JSON text with a `schemaVersion` field, holding the source DXF text of each file, the file names, the Layer_Maps, the Drawing_Units, the Floor_Sources and the Floor_Settings, the Edits, the Exit marks, the Stair_Regions, and the Room names and kinds.
2. WHEN the user chooses "Save project", THE Import_Screen SHALL offer the Project_File as a download.
3. WHEN the user chooses a Project_File to load, THE Importer SHALL validate the `schemaVersion` and the structure and SHALL rebuild the Building_Model from the stored data.
4. WHEN a Project_File is loaded, THE Importer SHALL reproduce the same `PlanInput` and the same Fire_Geometry as before saving, deep-equal and bit for bit.
5. IF a Project_File has a `schemaVersion` that the Importer does not know, THEN THE Importer SHALL return an error that names the version found and the versions supported, and SHALL NOT change the current project.
6. IF a Project_File is not valid JSON or has missing or wrongly typed fields, THEN THE Importer SHALL return an error that names the first invalid field, and SHALL NOT throw.
7. WHEN the project changes, THE Import_Screen SHALL write the Project_File to localStorage under one key for the last project, and WHEN the Import_Screen opens, THE Import_Screen SHALL offer to restore that project.
8. IF writing to localStorage fails (quota or access denied), THEN THE Import_Screen SHALL show a message that states the project was not stored in the browser and that the download still works, and SHALL continue.
9. THE Importer SHALL apply the file-size limit of Requirement 3 to every source DXF text inside a loaded Project_File, and SHALL cap the Project_File at 100 MB (Estimate).
10. THE Importer SHALL keep the DXF text as given and SHALL NOT send any file or Project_File to a network.

### Requirement 17: Limits

**User Story:** As a user, I want a plain message when my building is too big for the models, so that I know what to change.

#### Acceptance Criteria

1. IF the Building_Model has more floors than the Fire_Limits (6 floors), THEN THE Importer SHALL return an Import_Result with status "invalid" and an error that names the limit "6 floors", the count found and the model that sets the limit.
2. IF the Building_Model has more compartments than the Fire_Limits (30 compartments, stair compartments included), THEN THE Importer SHALL return an Import_Result with status "invalid" and an error that names the limit "30 compartments" and the count found.
3. IF a floor needs more Cells than the Crowd_Limits (1,000,000 per floor), THEN THE Importer SHALL return an Import_Result with status "invalid" and an error that names the limit and the grid size found.
4. THE Importer SHALL take the limits from the exported constants of the fire model and the crowd model where they exist, and SHALL otherwise define them in `src/core/plan/constants.ts` with the source named, so that the values are not copied by hand.
5. WHEN the Building_Model is within the limits, THE Import_Screen SHALL show the counts of floors, compartments, vents and Cells per floor next to the limits.
6. THE Importer SHALL check the vent limit of Requirement 13, criterion 8, together with the limits of this requirement and return every exceeded limit in one Import_Result.

### Requirement 18: Sample drawings

**User Story:** As a first-time user, I want sample drawings that load in one click, so that I can try the app without my own plan.

#### Acceptance Criteria

1. THE sample generator in `tools/` SHALL write three ASCII DXF files that the project owns (MIT licence, not copies of real buildings): a small café, a karaoke bar and a four-storey boarding house.
2. THE café sample SHALL hold one floor of about 120 m² and two exits.
3. THE karaoke bar sample SHALL hold one floor with at least six small rooms off one corridor and one exit.
4. THE boarding house sample SHALL hold four floors on a narrow lot with one stair and one ground-floor exit.
5. THE sample generator SHALL draw walls, door blocks, door swing arcs and named layers (`A-WALL`, `A-DOOR`, `A-GLAZ`, `A-FLOR-STRS`, `A-FURN`), and SHALL set `$INSUNITS` to 6.
6. THE sample generator SHALL write identical bytes for identical inputs, with no random values.
7. THE sample generator SHALL add a header comment (DXF group code 999) that states the drawing is invented and not a real building.
8. THE project SHALL commit the generated `.dxf` files under `public/samples/`, and SHALL NOT place them under `public/fonts/`.
9. THE Import_Screen SHALL offer each sample as a one-click action and SHALL label each sample as invented.
10. THE project SHALL provide an npm script that regenerates the samples, and a test that fails when the committed files differ from the regenerated files.

### Requirement 19: Import screen

**User Story:** As a building owner, I want one screen where I load, check and confirm my plan, so that I know what the simulation will use.

#### Acceptance Criteria

1. THE Import_Screen SHALL let the user drop DXF files on the screen or pick them with a file chooser.
2. THE Import_Screen SHALL show a layer-role table with, for each layer, the name, the Entity count, the suggested role and a selector for the role.
3. THE Import_Screen SHALL show a plan preview on a Canvas 2D element with each layer drawn in a colour that follows its Layer_Role, and a legend of the colours.
4. THE Import_Screen SHALL show a grid view per floor with Rooms in distinct colours, each labelled with its name, and with Doors, Exits and stair Cells marked.
5. THE Import_Screen SHALL let the user mark and unmark Exits and Stair_Regions in the grid view.
6. THE Import_Screen SHALL show the floor settings (floor name, elevation, ceiling height, offset) per floor and the Drawing_Unit question of Requirement 2.
7. THE Import_Screen SHALL show a list of Import_Warnings with a severity, a text and, where the warning has a location, a control that selects that location in the grid view.
8. THE Import_Screen SHALL provide the action "Use this plan" that hands the `PlanInput` and the Fire_Geometry to the run setup, and SHALL enable it only when the Import_Result has status "ok".
9. WHILE the run setup screen does not exist, THE Import_Screen SHALL show after "Use this plan" a summary of the derived compartments (id, name, kind, width, depth, height, area error), the derived vents (id, from, to, width, open fraction) and the crowd plan (floors, grid size, door, exit and stair-link counts).
10. THE Import_Screen SHALL fit a window of 1280 by 800 pixels without horizontal scrolling of the page, and SHALL remain usable on a laptop screen.
11. THE Import_Screen SHALL use no UI framework and SHALL follow `.kiro/steering/tech.md`.
12. THE Import_Screen SHALL show on every screen that holds results of the import this notice: "This is a simplified simulation for understanding risks. It does not replace a fire-safety review by the authorities or an engineer."
13. THE Import_Screen SHALL label every Estimate that the user sees (default wall thickness, gap tolerance, default heights, default sill and soffit) as an estimate.
14. THE Import_Screen SHALL use plain language, such as "2 doors are narrower than 0.5 m", and SHALL NOT use the words "safe", "compliant", "certified", "passes" or "meets code" about a building.
15. THE Import_Screen SHALL use a calm, neutral visual style without horror or alarm styling.

### Requirement 20: Tests

**User Story:** As a developer, I want property and unit tests for the import, so that changes to the importer do not break the agreement with the models.

#### Acceptance Criteria

1. THE test suite SHALL include a test helper that writes a random grid plan (walls, doors, exits, a stair on several floors) as ASCII DXF text, and a fast-check property that imports the text back and finds the same Rooms, Doors, Exits and Stair_Links.
2. THE test suite SHALL include a fast-check property that a plan written in millimetre, centimetre, metre, inch and feet units, with the matching `$INSUNITS`, imports to the same grid.
3. THE test suite SHALL include a fast-check property that an `INSERT` with rotation in multiples of 90 degrees and with mirroring imports to the same Cells as the same geometry written without the `INSERT`.
4. THE test suite SHALL include a fast-check property for the agreement of Requirement 14: equal compartment ids, one `WallVent` of equal width for every open Door, one `WallVent` to the Outside for every Exit, closed Doors with open fraction 0, one `CeilingFloorVent` per Stair_Link.
5. THE test suite SHALL include a fast-check property that saving and loading a Project_File reproduces a deep-equal `PlanInput` and Fire_Geometry.
6. THE test suite SHALL include a fast-check property that a malformed or truncated DXF text (random cuts, random line changes, random bytes) returns an Import_Result with status "invalid" or "ok" and never throws and never exceeds a time limit of 5 s per call.
7. THE test suite SHALL include a test that a file larger than 20 MB is refused with the limit named, before parsing.
8. THE test suite SHALL include a fast-check property that the derived `PlanInput` is accepted by the crowd `buildPlan` with status "valid", and that the Fire_Geometry inside a minimal `Scenario` is accepted by the fire input validator, for every generated plan within the limits.
9. THE test suite SHALL include unit tests on the three samples that assert the room count, the door count, the exit count and the floor count of each sample, and that the derived outputs are accepted by both models.
10. THE test suite SHALL include unit tests for the Estimate cases: gap closing below 0.10 m, single-line wall thickness, door width from a swing arc, non-rectangular room warning, stair overlap below the tolerance, and each limit error of Requirement 17.
11. THE test suite SHALL include a test that the Import_Screen code writes DXF-derived text with `textContent` only.
12. THE test suite SHALL run with `npm test` in Node 24 without network access.

### Requirement 21: Performance

**User Story:** As a user, I want the import to finish quickly, so that editing feels immediate.

#### Acceptance Criteria

1. WHEN the boarding house sample is imported in Node 24 (parse, rasterize, rooms, both derivations), THE Importer SHALL finish in less than 1 s, measured as the median of 5 runs after one warm-up run.
2. WHEN the user makes an Edit on the boarding house sample, THE Importer SHALL recompute the derived outputs in less than 200 ms (Estimate), measured in Node 24.
3. THE Importer SHALL run the import of a file in a Web Worker, so that the Import_Screen stays responsive during the import.

### Requirement 22: Scope guards and wording

**User Story:** As a project owner, I want the import to stay within its scope and keep the safety wording, so that the models stay as validated and the app makes no claim about a building.

#### Acceptance Criteria

1. THE Importer SHALL NOT change any file under `src/core/fire/` or `src/core/people/`.
2. WHERE a field that the import needs is missing from a fire or crowd type, THE Importer SHALL define the field in its own types in `src/core/plan/` and convert it into the model type.
3. THE Importer SHALL return an Import_Result with a status and Import_Warnings for every bad input, and SHALL throw only for programmer errors (wrong argument types).
4. THE Importer SHALL produce the same output for the same input on every run, with no `Math.random`, no clock and no global state in `src/core/plan/`.
5. THE Importer SHALL cite, for each constant in `src/core/plan/constants.ts`, its source (a CFAST Technical Reference Guide equation, a NIST measurement, a handbook value, a fire or crowd constant) or label it as an Estimate.
6. WHERE the Importer adds a dependency, THE dependency SHALL have an MIT, BSD or Apache licence, a pinned exact version and a justification in design.md.
7. THE Importer SHALL NOT make any network call at runtime.
8. WHEN a result depends on a stair, a long corridor, a position close to the fire or a material without measured data, THE Import_Screen SHALL show a visible warning at that location, as `.kiro/steering/safety.md` requires.
