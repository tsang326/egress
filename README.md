# Egress

**Live app: https://egress-delta.vercel.app** (runs entirely in your browser; nothing is uploaded)

Egress shows how people would get out of a small building during a fire. You pick a floor plan, click where the fire
starts and what is burning, and it runs two coupled simulations: smoke and heat filling the rooms, and people walking to
the exits they know. Then you change one thing (close a door, open a window, move the fire) and compare the two runs.

Built for Kiroween 2026, Frankenstein category. Four things that were never meant to share a body:

| Part | Where it comes from | Code |
| --- | --- | --- |
| Two-zone fire and smoke model | NIST CFAST 7.7.7, re-implemented in TypeScript from the *CFAST Technical Reference Guide* | `src/core/fire/` |
| Measured furniture fires | NIST Fire Calorimetry Database (doi:10.18434/mds2-2314), 8 real burn tests | `src/core/fire/library/`, `tools/library/fcd.ts` |
| Crowd movement | Game AI: grid flow fields and queues, with SFPE walking speeds and door flows, and ISO 13571 toxic dose | `src/core/people/` |
| Building plans | CAD drawings (DXF), read by our own parser and turned into rooms, doors, stairs and fire compartments | `src/core/plan/` |

**This is a simplified simulation for understanding risks. It does not replace a fire-safety review by the authorities
or an engineer.** It never says a building is acceptable, and it shows its own weak spots (stairs, long corridors,
positions close to the fire) as warnings next to the numbers they affect.

## Try it

1. Open the live app and pick a sample: a café, a karaoke bar, or a four-storey boarding house.
2. Click a room on the plan to start the fire there, then choose what burns (for example the two-seat sofa, NIST test
   035, peak 1.8 MW).
3. Press **Run simulation**. The fire model runs first, then the crowd model, each in a Web Worker.
4. On the results, drag the timeline or press Play. Rooms are shaded by visibility at 1.6 m (eye height); dots are
   people. Click a room to plot its hot-layer temperature and smoke height.
5. Press **Compare with one change**, close or open a door, and see the difference table.

You can also import your own DXF floor plans (one file per floor) from the home screen.

## How it was built with Kiro

Everything started from steering and specs in [`/.kiro`](.kiro):

- **Steering** (`.kiro/steering/`): `product.md` (who it is for and the one question it answers), `tech.md` (stack and
  layout), `safety.md` (banned wording, every number needs a source, publish validation as it is).
- **Specs**, each with requirements, design and tasks written by Kiro from a short brief (`docs/SPEC_BRIEFS.md`):

| Spec | Tasks done | Who wrote the code |
| --- | --- | --- |
| `fire-zone` (CFAST port + validation harness) | 55 of 63 | Kiro |
| `crowd` | 81 of 81 | Kiro |
| `plan-import` (DXF) | 75 of 75 | Kiro |
| `run-view` (the app screens) | 16 of 16 | Claude Code, from Kiro's spec, after the Kiro credits ran out |

When a spec turned out wrong during implementation, the spec was amended rather than the code drifting away from it.
Those amendments are marked in the requirements, and `run-view/design.md` ends with "Decisions during implementation".

## How close is the fire model to CFAST?

21 CFAST cases were run through NIST CFAST 7.7.7 and through our model (`validation/REPORT.md`). 15 are within
tolerance (all 9 Steckler room fires, the energy-balance checks, 2 of 4 mass-balance checks, ventilation, DelCo
Test_04). 6 are outside: DelCo Test_02, 03, 05, 06 (a few time points each) and two species mass-balance cases. The
report lists every case as it came out.

## Run it locally

```
npm ci
npm run dev        # app on http://localhost:5173
npm test           # all tests (about 25 minutes; the CFAST validation cases are slow)
npx vitest run tests/run-view tests/plan tests/people   # the fast part
```

Node 24. No backend, no network calls at runtime.

## Prior work

JuPedSim (crowd simulation with DXF geometry, no fire), Pathfinder and EvaWeb (evacuation tools), and CFAST itself (fire only, no people). Egress puts a fire model, measured fires, a crowd model and CAD
import into one browser page for the people who own small buildings.

## Licence

MIT for our code (`LICENSE`). CFAST inputs, CFAST reference outputs and NIST FCD data keep the NIST notice
(`validation/NIST-NOTICE.md`).
