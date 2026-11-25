# Crowd model (`src/core/people`)
This module is a reference simulation. This is a simplified simulation for understanding risks. It does not replace a fire-safety review by the authorities or an engineer.
- Public API: `buildPlan` and `runCrowd` (`index.ts`); the Worker_Wrapper logic is in `worker/handler.ts`.
- Pure functions only: no DOM, no clock, no `Math.random`. Same input and seed give the same output.
- Output calls the time of the last person out the "evacuation time". No output says or implies that a building is acceptable. All output strings are built in `outputs/text.ts` and `warnings.ts`.
- `constants.ts` lists every constant with its source in a comment. Entries marked "estimate" have no supporting source that this project read; they are labelled as estimates wherever they reach the user. The open estimates are discussed in `.kiro/specs/crowd/design.md`, section "Open items and estimates".
## Tests
- `npm test` runs the unit, property and smoke tests, including the 60 s performance smoke test.
- `npm run test:bench:crowd` runs the opt-in 5-run benchmark (600 s, fire then crowd, combined median must stay under 10 s). Add `-- --silent=false` to see the run times.
