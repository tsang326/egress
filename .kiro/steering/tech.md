# Tech

## Stack
- TypeScript (strict), Vite, Canvas 2D for drawing, Web Workers for simulation.
- Tests: Vitest + fast-check (property-based). DOM tests with happy-dom when a spec needs them.
- Static hosting on Vercel. No backend, no database, no analytics, no network calls at runtime except loading the
  app's own files.
- Node 24 for tooling and tests.

## Layout
- `src/core/fire/` — two-zone fire model (pure functions, no DOM, no globals).
- `src/core/people/` — crowd movement (later spec).
- `src/core/plan/` — DXF import and the building model (later spec).
- `src/web/` — UI.
- `validation/cases/` — CFAST input files used as references; `validation/reference/` — CFAST outputs we generated.
- `tools/cfast/` — scripts that run a local CFAST binary to regenerate references. Never called by the app.
- `docs/refs/` — source documents (CFAST Technical Reference Guide 7.7.7).

## Conventions
- SI units everywhere inside `src/core` (m, s, kg, K, W, Pa). Convert only at the UI edge. Type names carry the unit
  when it is not obvious (`heightM`, `hrrW`, `tempK`).
- Every physics constant and correlation cites its source in a comment: `// Tech Ref eq. 4.3` or
  `// NIST FCD test016`. No unexplained magic numbers; named constants in one `constants.ts` per module.
- Deterministic: same input → bit-identical output. No `Math.random` in `src/core`; seeded PRNG passed in.
- Errors: core functions never throw on bad input; they return a result with warnings. Throw only on programmer
  errors (wrong types).
- No dependencies in `src/core` unless MIT/BSD/Apache, pinned to an exact version, and justified in the spec design.
- Keep functions small and testable; the solver, the physics terms and the I/O are separate modules.

## Testing
- `npm test` runs everything; `npm run test:validation` runs the CFAST comparison cases and writes
  `validation/REPORT.md`.
- Property tests cover invariants (conservation, bounds, determinism, monotonicity) with shrinking-friendly
  generators; validation tests compare with CFAST references within the tolerances stated in the spec.
- A failing validation case is reported, never silently loosened. Tolerance changes need a written reason in the
  spec.
