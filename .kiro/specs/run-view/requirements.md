# Requirements Document

## Introduction

The run-view feature is the judge-facing part of the Egress app. It covers everything after the user clicks "Use this plan" in the import screen: a Home screen, a Setup screen, a Fire Library, running both simulations, a Results screen and a Compare screen. The app is a static Vite build; all simulation runs in Web Workers in the browser. No data leaves the browser.

The app is a reference simulation for understanding risks. No screen states or implies that a building is safe, compliant, certified or that it passes any code (`.kiro/steering/safety.md`). Every results screen shows the safety notice.

## Glossary

- **Home_Screen**: The first screen the user sees. Shows what the app does, its limits and three sample buttons.
- **Setup_Screen**: The screen where the user configures a scenario: fire position, burning item, occupancy, timing and vent states.
- **Fire_Library**: A curated set of HRR curves from the NIST Fire Calorimetry Database plus t-squared fires.
- **Scenario_Config**: The user's choices on the Setup_Screen; produces a `Scenario` and a `CrowdInput`.
- **Run_Screen**: Shows progress bars for the fire run and crowd run; lets the user cancel.
- **Results_Screen**: Shows the timeline, the annotated plan, charts and the summary after both runs finish.
- **Compare_Screen**: Shows two variants side-by-side with the same timeline scrubber and a difference table.
- **UsedPlan**: The `PlanInput` and fire geometry returned by `getUsedPlan()` in `main.ts`.
- **FireItem**: One entry of the Fire_Library: a name, source, test id, PHRR and HRR table (time and W).
- **TSquaredFire**: A t-squared curve (HRR = α t²) with a user-set peak and a named growth class.
- **Safety_Notice**: The required notice from crowd Requirement 6.8: "This is a simplified simulation for understanding risks. It does not replace a fire-safety review by the authorities or an engineer."

## Requirements

### Requirement 1: Home screen

**User Story:** As a first-time visitor, I want to understand what the app does and start quickly, so that I can run a scenario in under a minute.

#### Acceptance Criteria

1. WHEN the user reaches the Home_Screen, THE Home_Screen SHALL display two sentences that describe what the app does (simulates how people leave a building during a fire) and name its honest limits (a two-zone compartment fire model and a grid-based crowd model, for comparing layouts, not a certified engineering tool).
2. THE Home_Screen SHALL display three sample buttons labelled with the building name: Café, Karaoke, and Boarding House. WHEN the user clicks a sample button, THE app SHALL load the corresponding DXF from `public/samples/`, apply a confirmed layer map, pre-mark exits and stair regions, and navigate directly to the Setup_Screen without showing the import screen.
3. THE Home_Screen SHALL display an "Import your own DXF" button. WHEN clicked, it SHALL navigate to the existing import screen (`importScreen.ts`).
4. THE Home_Screen SHALL NOT use the words "safe", "compliant", "certified", "passes" or "meets code" to describe a building or a result.

### Requirement 2: Setup screen

**User Story:** As a user, I want to configure a fire scenario on my plan, so that I can run a realistic simulation.

#### Acceptance Criteria

1. THE Setup_Screen SHALL show the plan view with floor tabs. WHEN the user clicks a room on any floor, THE Setup_Screen SHALL mark that room as the fire compartment and clear any previous fire position on any floor.
2. WHEN a fire compartment is selected, THE Setup_Screen SHALL show the Fire_Library picker so the user can choose the burning item.
3. THE Setup_Screen SHALL let the user set the number of people per room as a whole number (minimum 0) or choose a density preset (`visitors_light`, `visitors_heavy`, `visitors_plus_staff`). THE default SHALL be `visitors_plus_staff`, which places a minimum of 1 staff per room and fills the remaining area with visitors at a density of 0.1 persons/m² (labelled Estimate).
4. THE Setup_Screen SHALL let the user set the alarm time in seconds (default 30 s) and the run duration in seconds (default 600 s), both finite positive numbers.
5. THE Setup_Screen SHALL let the user toggle each door open or closed using `BuildingModel.setDoorOpen` (from plan-import edits) and each window open or closed using `BuildingModel.setWindowOpen`.
6. WHEN the user clicks "Run", THE Setup_Screen SHALL validate that a fire compartment is selected and a FireItem is chosen, and SHALL show an error message if either is missing rather than starting the run.
7. THE Setup_Screen SHALL show the Safety_Notice on the screen.

### Requirement 3: Fire library

**User Story:** As a user, I want to pick a burning item with real measured data, so that the fire matches what is in the room.

#### Acceptance Criteria

1. THE Fire_Library SHALL contain 6 to 10 items covering at minimum: upholstered chair, armchair, sofa, mattress, bookshelf and laptop. Each item SHALL have a name, a NIST Fire Calorimetry Database test id, a PHRR in kW, a source URL and an HRR table of (timeS, hrrW) pairs.
   *Amended during implementation:* The library has 8 measured items: stackable chair (Test016), armchair (Test022), office chair (Test046), two-seat sofa (Test035), foam mattress (Test031), spring mattress (Test026), bookshelf (Test033), four pillows (Test010). The laptop was dropped: its FCD test (Test014) peaks at 1.31 kW, too small to change a room-scale zone model result. All items live in one generated file, `src/core/fire/library/fcdItems.json`, instead of one JSON per item.
2. EVERY FireItem HRR table SHALL cite the dataset DOI 10.18434/mds2-2314 and the specific test id in the source field, stored in `src/core/fire/library/`.
3. THE Fire_Library SHALL contain t-squared fire entries for the NFPA 72 growth classes slow (α = 0.00293 W/s²), medium (α = 0.01172 W/s²), fast (α = 0.0469 W/s²) and ultra-fast (α = 0.1876 W/s²), each requiring a user-set peak HRR in kW (default 500 kW). The α values SHALL cite NFPA 72 and the SFPE Handbook.
   *Amended during implementation:* The NFPA 72 α values are in kW/s², not W/s² (fast: 1055 kW at 150 s). The code stores them as `T_SQUARED_ALPHA_KW_PER_S2` and multiplies by 1000 to get W/s².
4. THE Fire_Library SHALL provide default fuel chemistry and soot/CO yields for each FireItem, each sourced from the NIST FCD or labelled Estimate.
5. A `tools/library/downscale.ts` script SHALL document the step that maps a published FCD curve (time in s, HRR in kW, usually sampled at 1 to 5 s) to the `HrrRow` format; it SHALL cite the source file name. The script does not run at runtime.
   *Amended during implementation:* The script is `tools/library/fcd.ts`. It reads the FCD CSV files, subtracts the burner HRR, averages into 10 s bins and ends one bin after the HRR last exceeds 1 % of the peak, then writes `fcdItems.json`. Total heat stays within 6 % and the peak within 12 % of the published values (checked by `tests/run-view/library.test.ts`).
6. WHEN the user selects a FireItem, THE Setup_Screen SHALL display the PHRR, the test id and a source link.

### Requirement 4: Run screen

**User Story:** As a user, I want to see progress and be able to cancel, so that I know the run is working.

#### Acceptance Criteria

1. THE Run_Screen SHALL run the fire simulation in the fire Web Worker (`src/web/fire/fire.worker.ts`) and the crowd simulation in the crowd Web Worker (`src/core/people/worker/`), fire first, crowd after.
2. THE Run_Screen SHALL display two progress bars, one for the fire run and one for the crowd run, driven by `ProgressEvent.fraction` from each worker.
3. WHEN the fire run is complete and the crowd run starts, THE Run_Screen SHALL show a "Running crowd…" label and start the crowd progress bar.
4. THE Run_Screen SHALL display a Cancel button. WHEN clicked, THE Run_Screen SHALL terminate the active worker and return to the Setup_Screen, discarding any partial result.
5. THE fire scenario SHALL use `printIntervalS: 2` for runs from the UI.
6. WHEN the same `Scenario_Config` is submitted twice, THE Run_Screen SHALL produce bit-identical fire and crowd results (determinism from the fire model seed and crowd seed in `Scenario_Config`).

### Requirement 5: Results screen

**User Story:** As a user, I want to see who got out, who did not, and why, so that I can understand the effect of the layout.

#### Acceptance Criteria

1. THE Results_Screen SHALL show a timeline scrubber with play, pause and speed controls (0.5×, 1×, 2×, 5×). WHEN playing, THE scrubber SHALL advance at the chosen speed in real time.
   *Amended during implementation:* A 10× speed was added because a 600 s run takes 2 minutes to watch at 5×; the default is 5×.
2. THE Results_Screen SHALL show the plan per floor, with each agent drawn as a circle coloured by state: moving (green), queued (yellow), out (grey), incapacitated (red). The fire room SHALL be marked with a flame icon.
3. THE Results_Screen SHALL shade each room by its upper-layer smoke conditions at the current scrubber time: clear (white), light smoke (light orange), dense smoke (orange), untenable (dark red), using the same visibility thresholds as the crowd model's Tenability_Limit.
   *Amended during implementation:* The shade uses the layer at eye height (1.6 m, the crowd model's EYE_HEIGHT_M): the upper layer once the interface drops below 1.6 m, the lower layer before that. Shading by the upper layer alone turned rooms red while people below the smoke could still see. A light grey fill shows that a smoke layer has formed above head height.
4. THE Results_Screen SHALL show, beside the plan, a summary panel with: people out count, incapacitated count, still inside count, and evacuation time (the word "evacuation time" is required by crowd Requirement 6.9) or "Nobody got out" when the count is zero.
5. THE Results_Screen SHALL show a "people out over time" chart and a room temperature and interface height chart for the fire room and the currently selected room (click a room to select it).
6. THE Results_Screen SHALL list incapacitated agents with the agent id, time of incapacitation and cause.
7. THE Results_Screen SHALL collapse repeated warnings by code, showing the code, the first message and a count in parentheses. Warnings with the same code SHALL be collapsed into one line.
8. THE Results_Screen SHALL show the Safety_Notice prominently.
9. WHERE a result value comes from a stair compartment or ceiling-floor vent, THE Results_Screen SHALL show the stair-limit warning text from the fire result flag attached to that value.

### Requirement 6: Compare screen

**User Story:** As a user, I want to run two variants and see the difference, so that I can compare the effect of a layout change.

#### Acceptance Criteria

1. THE Compare_Screen SHALL let the user duplicate the current Scenario_Config as variant B and change exactly one thing: open or close a door, open or close a window, or move the fire to a different room.
2. THE Compare_Screen SHALL run both variants and show the two plan views side by side with a single shared timeline scrubber.
3. THE Compare_Screen SHALL show a difference table with: people out (A and B), incapacitated (A and B), evacuation time (A and B), and time until the fire room becomes untenable (A and B).
4. THE Compare_Screen SHALL be limited to exactly two variants (A and B). Adding a third variant is out of scope.
5. THE Compare_Screen SHALL show the Safety_Notice.

### Requirement 7: Export

**User Story:** As a user, I want to save and share my results, so that I can review them later.

#### Acceptance Criteria

1. THE Results_Screen SHALL provide a "Download JSON" button that saves the full run as JSON: the `Scenario_Config`, the fire `Result` (times and compartment series) and the `CrowdResult` (summary, agents, gates).
2. THE Results_Screen SHALL provide a "Download summary" button that saves the summary panel as a PNG image (using Canvas 2D `toDataURL`) or as plain text.
3. Share by URL is out of scope.

### Requirement 8: UNREACHABLE_REGION warnings in the boarding house

**User Story:** As a developer, I want the boarding-house sample to build cleanly, so that the first visitor does not see confusing warnings.

#### Acceptance Criteria

1. WHEN `buildPlan` is called on the boarding-house sample with its standard confirmed layer map, THE result SHALL contain exactly 9 `UNREACHABLE_REGION` warnings. Each warning SHALL identify its floor and bounding box.
   *Amended during implementation:* The cause was not the sample: `toPlanInput` left free cells outside every room (the strips around the upper floors) open, so the crowd plan saw them as unreachable regions. `src/core/plan/derive/toPlanInput.ts` now marks free cells that belong to no room as wall, keeping exit cells. A second cause in the café sample was a 4-table group placed too tightly for a body to pass; the tables were moved to leave 1 m aisles. All three samples now build with zero `buildPlan` warnings.
2. A developer task SHALL investigate each of the 9 regions, classify them as: (a) closets or small rooms that need an exit or stair cell, (b) exterior area gaps (cells outside all walls that are not the main exterior), (c) drawing artefacts (slivers from double wall lines or unmatched stair cells), or (d) other.
3. WHERE the investigation shows that the regions are exterior-area gaps or drawing artefacts that the importer should discard, THE sample generator (`tools/samples/boardingHouse.ts`) SHALL be fixed so that `buildPlan` produces zero `UNREACHABLE_REGION` warnings.
4. WHERE the investigation shows that the regions are closets or rooms, THE fix SHALL add stair or exit cells to the sample, not hide the warning.
5. The fix chosen SHALL be recorded as a decision in `design.md` under "Decisions during implementation".

### Requirement 9: Tests

**User Story:** As a developer, I want automated tests covering the critical paths, so that regressions are caught.

#### Acceptance Criteria

1. THE test suite SHALL include a property test (fast-check) that the scrubber index for a given time `t` always lies in `[0, nSamples - 1]` and that `times[index] <= t < times[index + 1]` (or `index === nSamples - 1` when `t` equals the last sample time).
2. THE test suite SHALL include a property test that two runs of the same `Scenario_Config` with the same seeds produce bit-identical fire and crowd results.
3. THE test suite SHALL include a property test that the compare difference table values equal the numeric difference between the two independent results (not a re-run).
4. THE test suite SHALL include DOM tests (happy-dom) that: (a) clicking a sample button reaches the Setup_Screen, (b) clicking "Run" without selecting a fire room shows an error, (c) the Safety_Notice is present on the Results_Screen.
5. THE test suite SHALL include one end-to-end test per sample (café, karaoke, boarding house) that imports the sample, runs fire + crowd for 60 s and renders the Results_Screen without throwing; the test SHALL assert `status === "ok"` for both results.
6. THE test suite SHALL run as part of `npm test` without any environment variable flags.
