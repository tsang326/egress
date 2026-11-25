# Requirements Document

## Introduction

The crowd feature simulates how people move out of a multi-floor building while a fire develops. It lives in `src/core/people/` as pure functions with no DOM access, runs in Node and in its own Web Worker (following `src/core/fire/worker/`), and is deterministic for a given seed.

The Plan is a set of floors, each a grid of 0.25 m cells. The Fire_Model runs to completion first. The Crowd_Model then reads the `CompartmentSeries` of the fire `Result` (`src/core/fire/types.ts`) for the Compartment that each cell maps to. People do not affect the fire.

Every constant lives in `src/core/people/constants.ts` with its source. Where the literature disagrees, the Crowd_Model uses one cited value and the comment names the alternative. A value with no source is labelled as an estimate.

The Crowd_Model is a reference simulation. It does not approve a building and no output states or implies that a building meets any code. Out of scope: DXF import, any UI, plan editing, MCP integration, feedback from people to the fire, and fire spread.

## Glossary

- **Crowd_Model**: The module in `src/core/people/` that simulates Agents leaving a Plan.
- **Plan**: The building geometry: a list of Floors and the stair links between them.
- **Floor**: One level of the Plan: a grid of Cells, an elevation in metres, and a mapping from Cells to fire Compartment ids.
- **Cell**: A 0.25 m by 0.25 m grid square with one type: `wall`, `free`, `door`, `exit` or `stair`.
- **Compartment**: The fire-model room type in `src/core/fire/types.ts`, identified by its `id`.
- **Plan_Builder**: The typed API that constructs a Plan in code and checks it.
- **Stair_Link**: A link between the same Cell region of `stair` Cells on two adjacent Floors.
- **Door**: A connected run of `door` Cells. Its clear width is the number of Cells across the flow direction times 0.25 m.
- **Exit**: A connected run of `exit` Cells that leads out of the building.
- **Agent**: A simulated person with a type, a position, a speed, a Pre_Movement_Delay and a FED state.
- **Agent_Type**: `visitor` (knows only the Exit it entered by, then follows signs or staff) or `staff` (knows every Exit).
- **Alert**: The first moment an Agent sees smoke, or the alarm time given in the input.
- **Pre_Movement_Delay**: The time from the start of the run to the moment an Agent starts to move toward an Exit.
- **Flow_Field**: A per-Exit map of walking cost to that Exit over all walkable Cells, computed by Dijkstra or fast marching with 8-neighbour moves and a wall-clearance cost.
- **Eye_Height**: 1.6 m above the Floor, the height at which layer conditions are read for an Agent (ISO 13571 practice).
- **Layer_State**: For one Compartment and time: interface height, layer temperatures, CO, CO2 and O2 concentrations, and visibility, from the fire Result.
- **Smoke_Speed_Factor**: The ratio of walking speed in smoke to walking speed without smoke.
- **Tenability_Limit**: A visibility or temperature value beyond which a Cell is blocked or costed in the Flow_Field.
- **FED**: Fractional Effective Dose (ISO 13571, Purser): asphyxiant FED (CO, CO2 hyperventilation, low O2) and heat FED (convective).
- **Agent_Radius**: The body radius of an Agent used for separation from other Agents and from `wall` Cells, defined in `constants.ts`.
- **Blocked**: A flag on an Agent that has no descending path to its chosen Exit. It is not a final state.
- **Out**: Final state of an Agent that reached an Exit.
- **Incapacitated**: Final state of an Agent whose FED reached 1 or whose head-height temperature exceeded the temperature limit.
- **Still_Inside**: Final state of an Agent that is neither Out nor Incapacitated at the end of the run.
- **RSET**: The time the last Agent goes Out. Output text calls it "evacuation time".
- **Crowd_Result**: The output of a run: per-Agent records, per-scenario summary, per-Door series, congestion map and Warnings.
- **Warning**: A structured message with a code, a message, a location and a time.
- **Time_Step**: The fixed simulation step of 0.05 s.
- **Seeded_PRNG**: The generator in `src/core/fire/prng.ts`, initialised from the seed in the input.
- **Worker_Wrapper**: The code that runs the Crowd_Model in a Web Worker and posts Progress_Events and the Crowd_Result.
- **Progress_Event**: A message with the simulated time reached and the fraction complete.

## Requirements

### Requirement 1: Plan grid, floors and typed builder

**User Story:** As a developer, I want to write Plans in code on a grid, so that tests and sample buildings are easy to build and check.

#### Acceptance Criteria

1. WHEN a caller passes Floors to the Plan_Builder, THE Plan_Builder SHALL construct a Plan in which each Floor has a grid of 0.25 m Cells, each Cell typed exactly one of `wall`, `free`, `door`, `exit` or `stair`, an elevation in metres (finite number, -10 to 100 m), and a mapping from each Cell to one Compartment id or to no Compartment.
2. THE Plan_Builder SHALL accept Plans of up to 12 Floors, up to 100 Compartments and up to 1,000,000 Cells per Floor, and these maximums SHALL be named constants in `constants.ts` labelled as estimates.
3. IF a Plan exceeds a limit in `constants.ts`, a Cell has a type outside the five allowed values, or an elevation is not a finite number, THEN THE Plan_Builder SHALL return a Plan result with status "invalid" and a Warning that names the limit, Floor or Cell, and SHALL NOT throw.
4. WHEN a caller adds a Stair_Link between two adjacent Floors, THE Plan_Builder SHALL accept the Stair_Link only if both Floors have `stair` Cells at identical Cell coordinates for the linked region, and SHALL otherwise reject the Stair_Link with a Warning that names both Floors and the unmatched Cell coordinates.
5. IF a Cell has the type `free`, `door` or `stair` and its Compartment id is not present in the fire Result, THEN THE Plan_Builder SHALL add one Warning that names the Cell and the id, and THE Crowd_Model SHALL treat the Cell as ambient conditions (no smoke, ambient temperature).
6. IF a Plan has no `exit` Cell, THEN THE Crowd_Model SHALL return a Crowd_Result with status "invalid" and a Warning that names the missing exit as the cause.
7. IF an Agent start position is on a `wall` Cell or outside the grid of its Floor, THEN THE Crowd_Model SHALL return a Crowd_Result with status "invalid" and a Warning that names the Agent and the position.
8. IF a walkable Cell (`free`, `door`, `exit` or `stair`) has no path to any `exit` Cell, THEN THE Plan_Builder SHALL add one Warning per connected region of such Cells that names the Floor and the region's bounding Cell coordinates.
9. WHEN a Plan has status "valid", THE Plan_Builder SHALL compute exactly one Flow_Field per `exit` Cell group, where an Exit is a set of edge-adjacent `exit` Cells, and the same Plan SHALL always produce bit-identical Flow_Fields.

### Requirement 2: Movement and steering

**User Story:** As a developer, I want Agents to follow realistic routes without overlapping, so that queues appear where the geometry causes them.

#### Acceptance Criteria

1. THE Crowd_Model SHALL advance the simulation with a fixed Time_Step of 0.05 s, and the same input and seed SHALL produce bit-identical Agent positions at every Time_Step.
2. WHILE an Agent is moving, THE Crowd_Model SHALL direct the Agent along the descent of the Flow_Field of the Agent's chosen Exit, so that the distance in the Flow_Field from the Agent to that Exit never increases between two consecutive Time_Steps except while the Agent is avoiding another Agent or a `wall` Cell.
3. THE Flow_Field SHALL use 8-neighbour moves with step costs of 1 for orthogonal moves and √2 for diagonal moves, and SHALL add a wall-clearance cost to every Cell within 2 Cells (0.5 m) of a `wall` Cell, with the cost value and its source or estimate label in `constants.ts`.
4. WHILE an Agent is moving, THE Crowd_Model SHALL keep the centre-to-centre distance between any two Agents at or above twice the Agent radius where space allows, and SHALL keep every Agent's centre at least one Agent radius from every `wall` Cell, with the radius value and its source or estimate label in `constants.ts`.
5. WHERE an Agent is on a level Cell and the local density D is below 0.54 persons/m², THE Crowd_Model SHALL set the walking speed to the unimpeded speed S(0.54) = k(1 − a × 0.54), which is about 1.19 m/s for k = 1.40 m/s and a = 0.266, and this unimpeded speed SHALL be derived from the relation in criterion 6 and SHALL NOT be a separate constant (Nelson and Mowrer, SFPE Handbook, "Emergency Movement"; also Gwynne and Rosenbaum in later editions).
6. WHILE the local density D around an Agent on a level Cell is at or above 0.54 persons/m², THE Crowd_Model SHALL set the walking speed to S = k − a × k × D with k = 1.40 m/s for level routes, a = 0.266 and D in persons/m², SHALL set the speed to 0 m/s for D at or above 1/a (about 3.76 persons/m²), and `constants.ts` SHALL give the source of k and a and name the alternative relations considered (Fruin, Predtechenskii and Milinskii).
7. WHILE an Agent is on a `stair` Cell, THE Crowd_Model SHALL set the walking speed with the same structure as criteria 5 and 6, using the cited SFPE Handbook stair k value for the riser and tread of the stair (riser/tread table), the same a = 0.266, and the same cap at D = 0.54 persons/m², with the table, values and source in `constants.ts`.
8. WHEN an Agent on a `stair` Cell reaches the end of the Stair_Link, THE Crowd_Model SHALL move the Agent, within the same Time_Step, to the Cell at the same grid position on the adjacent Floor.
9. THE Crowd_Model SHALL limit the flow through a Door and an Exit to at most 1.3 persons per metre of clear width per second (SFPE Handbook and NFPA egress literature, value and source in `constants.ts`), measured over any 10 s window.
10. WHEN the flow limit of a Door or Exit is reached, THE Crowd_Model SHALL hold the remaining Agents in a queue and release them through that Door or Exit in the order they arrived at it.
11. WHEN an Agent reaches an `exit` Cell, THE Crowd_Model SHALL mark the Agent Out, record the time in seconds and the Exit, and remove the Agent from density, separation and queue calculations from the next Time_Step.
12. IF an Agent has no descending path in the Flow_Field to its chosen Exit, THEN THE Crowd_Model SHALL hold the Agent in place, set a Blocked flag on the Agent, and add a Warning naming the Agent and Exit without throwing, where the Blocked flag is not a final state and the final states remain exactly out, incapacitated and still inside.

### Requirement 3: Agent types, knowledge and pre-movement delay

**User Story:** As a developer, I want visitors and staff to know different exits and start at different times, so that results show the effect of familiarity and reaction.

#### Acceptance Criteria

1. THE Crowd_Model SHALL accept Agents of type `visitor` and `staff`.
2. IF an Agent in the input has a type other than `visitor` or `staff`, THEN THE Crowd_Model SHALL exclude that Agent from the run, add a Warning that names the Agent and the rejected type, and continue the run with the remaining Agents.
3. THE Crowd_Model SHALL give each visitor knowledge of the one Exit it came in by, as given in the input.
4. IF a visitor has no entry Exit in the input, or the given Exit is not an Exit in the Plan, THEN THE Crowd_Model SHALL give that visitor knowledge of the Exit nearest to its start position by straight-line distance, and add a Warning that names the visitor and says the entry Exit was estimated.
5. WHEN a visitor has an Alert, THE Crowd_Model SHALL add to the visitor's known Exits, at that Time_Step, the Exits that staff Agents lead to and the Exits that exit signs point to within the Plan, as given in the input, without removing any Exit the visitor already knows.
6. THE Crowd_Model SHALL give each staff Agent knowledge of every Exit in the Plan.
7. WHEN the run starts, THE Crowd_Model SHALL draw one Pre_Movement_Delay for each Agent from a log-normal distribution selected by that Agent's Agent_Type, using the Seeded_PRNG, with the parameters (in seconds) and their source stated in `constants.ts`.
8. THE Crowd_Model SHALL return identical Pre_Movement_Delay values for each Agent when run twice with the same input and the same seed.
9. WHILE the simulation time is less than the Agent's Pre_Movement_Delay, THE Crowd_Model SHALL keep the Agent at its start position.
10. WHERE the input sets delay parameters for an Agent_Type, THE Crowd_Model SHALL use the input values for that Agent_Type in place of the defaults, provided the median is greater than 0 s and the log-standard-deviation is 0 or greater.
11. IF the input delay parameters for an Agent_Type are not finite, the median is 0 s or less, or the log-standard-deviation is less than 0, THEN THE Crowd_Model SHALL use the default parameters for that Agent_Type and add a Warning that names the Agent_Type and the rejected values.

### Requirement 4: Fire coupling

**User Story:** As a developer, I want Agents to react to the fire Result, so that smoke slows and redirects people.

#### Acceptance Criteria

1. IF the fire Result has a status other than "ok", THEN THE Crowd_Model SHALL return a Crowd_Result with status "invalid" and a Warning naming the received status, and SHALL NOT run any Time_Step.
2. WHEN a Time_Step starts, THE Crowd_Model SHALL read for each Agent, from the Compartment of the Agent's Cell, the Layer_State by linear interpolation in time between the two fire samples that bracket the current time.
3. IF the Agent's Cell belongs to no Compartment in the fire Result, THEN THE Crowd_Model SHALL treat the Agent's conditions as ambient (no smoke, ambient temperature) and add one Warning per such Cell naming the Cell.
4. WHILE the interface height is at or above Eye_Height in the Agent's Compartment, THE Crowd_Model SHALL use the lower-layer conditions for the Agent, and WHILE it is below Eye_Height, THE Crowd_Model SHALL use the upper-layer conditions.
5. WHILE an Agent is in a layer with an extinction coefficient above 0 1/m, THE Crowd_Model SHALL multiply the Agent's walking speed by a Smoke_Speed_Factor computed from the cited relation (Jin 1978, as summarised by Fridolf 2013), and `constants.ts` SHALL name the alternative relation considered and the reason it was not used.
6. WHEN the visibility or temperature at Eye_Height in a Cell passes a Tenability_Limit, THE Crowd_Model SHALL block the Cell or add a cost to it in the Flow_Fields, and SHALL recompute the Flow_Fields within the same Time_Step. The Tenability_Limit values, each with its source or an "estimate" label, SHALL be named in `constants.ts`.
7. WHEN a Flow_Field is recomputed, THE Crowd_Model SHALL switch an Agent to another known Exit if and only if that Exit's cost is lower than the cost of the Agent's current Exit by more than the margin stated in `constants.ts`.
8. IF the fire Result ends before the crowd run ends, THEN THE Crowd_Model SHALL hold the last fire sample for the remaining time and add exactly one Warning stating the time at which the fire Result ended.

### Requirement 5: Tenability

**User Story:** As a developer, I want accumulated exposure per Agent, so that results show who is incapacitated and why.

#### Acceptance Criteria

1. WHILE an Agent is not Out and not Incapacitated, THE Crowd_Model SHALL add to the Agent's asphyxiant FED at each Time_Step an increment computed from the CO, CO2 (hyperventilation factor) and O2 concentrations of the layer containing the Agent's head height, following ISO 13571 and Purser, with the increment never negative.
2. WHILE an Agent is not Out and not Incapacitated, THE Crowd_Model SHALL add to the Agent's convective heat FED at each Time_Step an increment computed from the temperature of the layer containing the Agent's head height, following ISO 13571, with the increment equal to 0 when that temperature is at or below the ISO 13571 lower threshold.
3. WHEN the sum of the Agent's asphyxiant FED and heat FED becomes 1.0 or greater, THE Crowd_Model SHALL mark the Agent Incapacitated, set the Agent's speed to 0 m/s from that Time_Step onward, and record the simulation time of that Time_Step in seconds.
4. WHEN the temperature of the upper layer at the Agent's head height exceeds the temperature limit defined in `constants.ts`, THE Crowd_Model SHALL mark the Agent Incapacitated, set the Agent's speed to 0 m/s from that Time_Step onward, and record the simulation time of that Time_Step in seconds.
5. WHEN an Agent is marked Incapacitated, THE Crowd_Model SHALL record the cause as one or more of: asphyxiant FED, heat FED, temperature limit.
6. IF a layer input for an Agent (temperature, CO, CO2 or O2) is missing, negative or not a finite number, THEN THE Crowd_Model SHALL keep the Agent's FED unchanged for that Time_Step and add a Warning naming the Agent and the invalid input.
7. THE Crowd_Model SHALL cite the source (standard, table or equation) of every FED and limit constant in `constants.ts`.
8. WHERE a FED or limit constant is an estimate, THE Crowd_Model SHALL label it as an estimate in `constants.ts`.

### Requirement 6: Outputs

**User Story:** As a developer, I want complete outputs per Agent and per scenario, so that a later UI can show who did not get out, when and why.

#### Acceptance Criteria

1. WHEN a simulation run ends, THE Crowd_Result SHALL contain for each Agent: the final state (exactly one of "out", "incapacitated" or "still inside"), the exit time in seconds (null unless the state is "out"), the Exit used (null unless the state is "out"), the incapacitated time in seconds (null unless the state is "incapacitated"), and the FED history as a series of (time in seconds, FED value) pairs sampled at least once every 1 s of simulated time from time 0 until the Agent's final state is reached or the run ends.
2. WHEN a simulation run ends, THE Crowd_Result SHALL contain a scenario summary with the counts of Agents out, incapacitated and still inside, and the RSET in seconds, where the three counts sum to the total number of Agents and the RSET equals the exit time of the last Agent to go out.
3. IF no Agent is "out" at the end of a run, THEN THE Crowd_Result SHALL set the RSET to null and SHALL state in the summary text that no Agent got out.
4. WHEN a simulation run ends, THE Crowd_Result SHALL contain for each Door and each Exit a time series of flow in persons per second and of queue length in persons, sampled at least once every 1 s of simulated time over the full run.
5. WHEN a simulation run ends, THE Crowd_Result SHALL contain for each Floor a congestion heat map giving, for each Cell, the accumulated person-seconds, where the sum over all Cells and Floors equals the sum over all Agents of the time each spent inside the model before reaching a final state or the run end, within 1e-6 relative error.
6. IF at least one Agent is "incapacitated" or "still inside", THEN THE Crowd_Result SHALL state in the summary text the number of "incapacitated" Agents and the number of "still inside" Agents as separate integers.
7. WHERE a result depends on a stair, a corridor longer than the corridor length limit in constants.ts (cited or labelled an estimate), a position within 2 m of the fire, or a material without measured data, THE Crowd_Result SHALL attach a Warning stating the cause and the location (Floor and x, y position in metres, or the Door, Exit or stair identifier).
8. THE Crowd_Result SHALL include a notice stating that the output is a simplified simulation for understanding risks and does not replace a fire-safety review by the authorities or an engineer.
9. THE Crowd_Model SHALL label the RSET in every output string with the words "evacuation time", and SHALL NOT use the terms "safe", "compliant", "certified", "passes" or "meets code" in any output string about a building, except that the notice in criterion 8 SHALL contain the phrase "fire-safety review", which refers to a review and not to a building.

### Requirement 7: Determinism, worker and robustness

**User Story:** As a developer, I want identical results for identical input and a run that does not block the UI.

#### Acceptance Criteria

1. WHEN the Crowd_Model is run twice with the same Plan, Agents, fire Result, seed and duration, THE Crowd_Model SHALL return two Crowd_Results that are bit-identical in every numeric field, every Agent position and every Warning, in the same order.
2. THE Crowd_Model SHALL take all randomness from the Seeded_PRNG and SHALL NOT call `Math.random` or read the system clock.
3. THE Crowd_Model SHALL run to completion in Node without any browser global (such as `window`, `document` or `Worker`) being defined.
4. WHEN the Worker_Wrapper receives a run request, THE Worker_Wrapper SHALL run the Crowd_Model, post a Progress_Event for every 5 simulated seconds or less of progress (the first at or before simulated time 5 s, the last at the end of the run), and then post exactly one Crowd_Result as the final message.
5. IF the input has a wrong type, a missing required field, or a duration that is not a finite number greater than zero, THEN THE Crowd_Model SHALL return, without throwing, a Crowd_Result with status "invalid" and at least one Warning that names the offending field.
6. IF the Worker_Wrapper receives a run request that is malformed, THEN THE Worker_Wrapper SHALL post a Crowd_Result with status "invalid" and a Warning, and SHALL post no Progress_Event.
7. THE Crowd_Model SHALL have zero runtime dependencies and SHALL import nothing from outside `src/core`.

### Requirement 8: Performance

**User Story:** As a developer, I want a known time budget, so that a run fits an interactive session.

#### Acceptance Criteria

1. WHEN a scenario with 300 Agents on a Plan of 6 Floors and 30 rooms is simulated for 600 s of simulated time, with the fire run completed first on the same scenario, THE Crowd_Model SHALL finish the combined fire run and crowd run in a median wall-clock time of under 10 s over 5 consecutive runs on the same machine.
2. THE test suite SHALL include a performance test that runs the case in 5 consecutive runs, discards no runs, and reports the median wall-clock time of the combined run, the median wall-clock time of the fire run alone, and the fire-run share as a percentage of the combined median.
3. WHERE the environment variable CROWD_BENCH is set to 1 (as done by the dedicated script `npm run test:bench:crowd`, which runs `CROWD_BENCH=1 vitest run tests/people/bench` and leaves the existing fire `test:bench` unchanged), THE performance test SHALL execute the Worker_Wrapper logic in-process (not in a browser Worker) and SHALL fail if the combined median is 10 s or more.
4. IF any of the 5 runs does not complete or throws, THEN THE performance test SHALL fail and report which run failed and the error, without reporting a median.
5. WHEN the default `npm test` run executes without CROWD_BENCH set to 1, THE test suite SHALL skip the 5-run performance test and SHALL run a reduced smoke version of the case, using the same Plan and a shorter simulated duration than 600 s, that fails unless the case builds and the combined fire run and crowd run completes with status "ok".

### Requirement 9: Tests

**User Story:** As a developer, I want invariants checked by property tests, so that regressions come with shrunk counterexamples.

#### Acceptance Criteria

1. THE test suite SHALL include a fast-check property that, at every simulation step and for every generated Plan with status other than "invalid", the count of Agents that are out plus the count that are incapacitated plus the count that are inside equals the total number of Agents.
2. THE test suite SHALL include a fast-check property that, at every simulation step, no Agent position lies in a `wall` Cell and no Agent movement between consecutive steps crosses a wall segment.
3. THE test suite SHALL include a fast-check property that two runs with the same Plan, the same inputs and the same seed produce bit-identical Crowd_Results.
4. THE test suite SHALL include a fast-check property that, for generated Plans containing exit Cells that no Agent can reach, the Crowd_Result reports zero Agents Out at every step, and for generated Plans with no exit Cell, the Crowd_Result has status "invalid" (Requirement 1.6) and reports zero Agents Out.
5. THE test suite SHALL include a fast-check property that, along the path chosen from any reachable Cell to the nearest Exit, each successive Flow_Field value is strictly smaller than the previous one.
6. THE test suite SHALL include a fast-check property that, for every Door and every window of 10 s of simulated time, the number of Agents passing through the Door does not exceed the limit defined in Requirement 2.9.
7. THE test suite SHALL include a fast-check property that, for runs with no fire input, the FED of every Agent equals 0 at every step.
8. THE test suite SHALL include a fast-check property that, for generated multi-Floor Plans, no Agent uses a stair to reach a Floor without Exits unless every path to an Exit on the Agent's current Floor or on another Floor with Exits is unavailable.
9. THE test suite SHALL include unit tests for each of the following: the Plan_Builder, the Flow_Field, the speed-density relation, the Door flow limit, the Pre_Movement_Delay distribution, the Smoke_Speed_Factor, the FED formulas, the Flow_Field recompute, and the Worker_Wrapper.
10. THE test suite SHALL include a test that collects every user-visible output string produced by the crowd module and fails if any string contains a word banned by Requirement 6.9, reporting each offending string and the banned word.
11. IF any test required by criteria 1 to 10 fails or is skipped, THEN THE test suite SHALL report the run as failed, and each failing fast-check property SHALL report the shrunk counterexample and the seed that reproduces it.
12. THE test suite SHALL run each fast-check property with at least 100 generated cases.
