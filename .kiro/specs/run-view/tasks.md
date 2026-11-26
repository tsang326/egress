# Implementation Plan: Run View

## Overview

16 tasks build the run-view feature from the inside out: data first (fire library, boarding-house fix), then navigation, workers, screens and tests. All tasks are required. No task modifies `src/core/fire/`, `src/core/people/` or `src/core/plan/`.

*Implementation status:* all 16 tasks done by Claude after Kiro's credits ran out. Task 1 changed `src/core/plan/derive/toPlanInput.ts` (see design.md, "Decisions during implementation"). Tests live in `tests/run-view/`: library, scrubber, compare, trajectory, screens (home/setup/results/compare DOM), determinism, e2e.

## Tasks

- [x] 1. Investigate boarding-house UNREACHABLE_REGION warnings
  - Run `buildPlan` on the boarding-house sample and log each warning's floor id and bounding box
  - Classify each of the 9 regions (exterior gap, closet, drawing artefact, or other)
  - Fix `tools/samples/boardingHouse.ts` so `buildPlan` produces zero `UNREACHABLE_REGION` warnings
  - Run `npm run samples` to regenerate `public/samples/boarding-house.dxf`
  - Record the fix in design.md under "Decisions during implementation"
  - **Verification**: `buildPlan` on the regenerated sample returns 0 `UNREACHABLE_REGION` warnings

- [x] 2. Fire library data files and t-squared constants
  - Create `src/core/fire/library/tSquaredAlpha.ts` with the four NFPA 72 alpha values and citations
  - Create `src/core/fire/library/items/` with one JSON per measured item (chair, armchair, sofa, mattress, bookshelf, laptop), each with HRR table, testId, source DOI and fuel fields
  - Create `src/core/fire/library/index.ts` exporting `FIRE_LIBRARY: FireItem[]`
  - Create `tools/library/downscale.ts` documenting the FCD → HrrRow mapping with citation
  - **Verification**: `tsc --noEmit` passes; each item has `testId` with "FCD" and `source` with the DOI; alpha values match the NFPA 72 table

- [x] 3. Home screen and navigation state machine
  - Rewrite `src/web/main.ts` with the `AppState` state machine (home, import, setup, run, results, compare)
  - Create `src/web/home/sampleConfigs.ts` with confirmed layer maps, floor settings, exits and stair regions for each of the three samples
  - Create `src/web/home/homeScreen.ts` rendering the two description sentences, three sample buttons and the import button; no banned words
  - **Verification**: DOM test `home.test.ts` passes; clicking a sample button transitions to `view: 'setup'`; `tsc --noEmit` passes

- [x] 4. Crowd worker client
  - Create `src/web/run/crowdWorkerClient.ts` mirroring `fireClient.ts`: `WorkerLike`, `WorkerFactory`, `defaultWorkerFactory` pointing to the crowd worker, `runCrowdInWorker` returning `Promise<CrowdResult>`
  - **Verification**: TypeScript compiles; existing crowd worker handler is not changed

- [x] 5. Setup screen
  - Create `src/web/setup/densityPresets.ts` implementing the three density presets (Requirement 2.3)
  - Create `src/web/setup/scenarioBuilder.ts` converting `SetupState + UsedPlan` to `Scenario + CrowdInput` with `printIntervalS: 2`
  - Create `src/web/setup/setupScreen.ts` with floor tabs, plan canvas (room click → fire position), library picker, occupancy inputs, timing inputs, door/window toggles and Run button with validation
  - **Verification**: DOM test `setup.test.ts` passes; clicking Run without a fire room shows an error; clicking Run with all fields set transitions to `view: 'run'`

- [x] 6. Fire library picker widget
  - Create `src/web/library/libraryPicker.ts` rendering a `<select>` from `FIRE_LIBRARY` plus the four t-squared entries; selecting a t-squared entry shows a peak HRR input; selecting a measured item shows PHRR and source link
  - **Verification**: picker renders all items; measured item shows the test id; t-squared item accepts a numeric peak

- [x] 7. Run screen
  - Create `src/web/run/runScreen.ts` that starts the fire worker, then on completion starts the crowd worker, drives two `<progress>` bars from `ProgressEvent.fraction`, shows Cancel, and transitions to `view: 'results'` on completion
  - **Verification**: cancel terminates the active worker and returns to setup; completion transitions to results; progress fraction drives the bar

- [x] 8. Scrubber widget and property test
  - Create `src/web/results/scrubber.ts` with play/pause/speed controls (0.5×, 1×, 2×, 5×) and a range input; play uses `requestAnimationFrame`
  - Create `tests/run-view/scrubber.property.test.ts` with the index-in-bounds property (fast-check, ≥ 100 cases)
  - **Verification**: property test passes; play advances time at the correct rate

- [x] 9. Plan renderer
  - Create `src/web/results/planRenderer.ts` drawing rooms (smoke colour from visibility thresholds), agents (colour by state), and the fire marker at each `timeIndex`
  - **Verification**: renders without throwing on a canned result; untenable room (visibility < 1 m) uses the dark-red colour

- [x] 10. Charts
  - Create `src/web/results/charts.ts` with people-out chart and room temperature/interface height chart; both re-draw on scrubber change and on room selection
  - **Verification**: charts render without throwing; selecting a different room redraws the room chart

- [x] 11. Warning list
  - Create `src/web/results/warningList.ts` grouping warnings by code into one `<details>` per code with count
  - **Verification**: 80 `ENTRY_EXIT_ESTIMATED` + 37 `AGENT_BLOCKED` collapse to two lines; counts are correct

- [x] 12. Results screen
  - Create `src/web/results/resultsScreen.ts` assembling scrubber, plan renderer, charts, warning list, summary panel (counts + evacuation time + incapacitated list) and Safety_Notice
  - **Verification**: DOM test `results.test.ts` passes; Safety_Notice is present; stair badge appears when stair cells exist

- [x] 13. Compare screen and property test
  - Create `src/web/compare/diffTable.ts` computing the four-row difference table from two `RunResult` objects
  - Create `src/web/compare/compareScreen.ts` with two-column layout, shared scrubber, Change panel (one allowed change) and difference table; show Safety_Notice
  - Create `tests/run-view/compare.property.test.ts` asserting diff values equal numeric difference of independent results (fast-check, ≥ 100 cases)
  - **Verification**: property test passes; diff values match manual arithmetic; Safety_Notice is present

- [x] 14. Export
  - Create `src/web/export/exportJson.ts` downloading the run as JSON (Float64Arrays serialised as arrays)
  - Create `src/web/export/exportSummary.ts` downloading the summary as PNG via `canvas.toDataURL('image/png')`
  - **Verification**: downloaded JSON parses back without error; PNG download triggers in a happy-dom test

- [x] 15. Determinism property test
  - Create `tests/run-view/determinism.property.test.ts` running the same `Scenario_Config` twice with the same seed, calling `runFire` and `runCrowd` directly, asserting bit-identical results (fast-check, ≥ 100 cases)
  - **Verification**: property test passes; `npm test` does not require an environment variable

- [x] 16. End-to-end sample tests
  - Create `tests/run-view/e2e.test.ts` with one test per sample (café, karaoke, boarding house): imports in-process, runs fire + crowd for 60 s with `printIntervalS: 2`, renders Results_Screen with an injected canvas, asserts `fire.status === 'ok'` and `crowd.status === 'ok'`
  - **Verification**: all three tests pass; `npm test` exits 0

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2", "4", "15"] },
    { "id": 1, "tasks": ["3", "6"] },
    { "id": 2, "tasks": ["5"] },
    { "id": 3, "tasks": ["7", "8", "9", "10", "11"] },
    { "id": 4, "tasks": ["12"] },
    { "id": 5, "tasks": ["13", "14", "16"] }
  ]
}
```

Wave justification:
- Wave 0: task 1 (boarding house fix), task 2 (fire library data), task 4 (crowd worker client) and task 15 (determinism property test, uses runFire/runCrowd directly) have no interdependencies.
- Wave 1: task 3 (navigation and home screen) and task 6 (library picker widget) need the fire library data and the fixed boarding-house sample.
- Wave 2: task 5 (setup screen) needs navigation (task 3) and the library picker (task 6).
- Wave 3: task 7 (run screen) needs the setup screen and the crowd worker client; tasks 8–11 (scrubber, plan renderer, charts, warning list) are independent results-screen components.
- Wave 4: task 12 (results screen) needs tasks 7–11.
- Wave 5: tasks 13 (compare), 14 (export) and 16 (e2e tests) need the results screen.

## Notes

- Task 1 is marked done as a placeholder; the actual investigation and fix is the first real task.
- The boarding-house DXF is regenerated by `npm run samples` after fixing `boardingHouse.ts`.
- All property tests run as part of `npm test` without flags (Requirement 9.6).
- The fire library JSON files carry measured data from the NIST FCD (DOI 10.18434/mds2-2314); each file cites the specific test id.
- `printIntervalS: 2` is set in `scenarioBuilder.ts` for all UI-initiated runs (Requirement 4.5); validation tests use their own value.
