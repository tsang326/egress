# Egress (working name)

Work in progress for Kiroween 2026 (Frankenstein category).

A browser app that simulates people leaving a building during a fire: a two-zone fire and smoke model re-implemented
from NIST CFAST 7.7.7, heat release curves measured by NIST for real furniture, and crowd movement through the
building's own floor plans (DXF).

**This is a reference simulation for understanding risks. It is not a fire-safety assessment and does not replace a
review by the fire authority or an engineer.**

- Specs, steering and hooks: `/.kiro`
- Spec briefs: `docs/SPEC_BRIEFS.md`
- CFAST validation cases and the NIST notice: `validation/`

## Crowd model

The crowd model (`src/core/people/`) is a reference simulation. This is a simplified simulation for understanding risks. It does not replace a fire-safety review by the authorities or an engineer.

It walks agents through the building's floor plans, slows them in smoke, queues them at doors and stairs, and adds up the
smoke dose each person receives from the fire results. It does not say that any building is acceptable, and its output
never does either. The time at which the last person is out is called the "evacuation time" in every output.

- Values in `src/core/people/constants.ts` each name their source. Values that no source supports are marked "estimate" there and are shown as estimates. The open estimates are listed in the design, section "Open items and estimates" (`.kiro/specs/crowd/design.md`).
- Details for developers: `src/core/people/README.md`.
- Run all tests: `npm test`. Run the 5-run performance benchmark (600 s case, fire then crowd): `npm run test:bench:crowd -- --silent=false`.

Licence: MIT for our code. Files from NIST keep the NIST notice (`validation/NIST-NOTICE.md`).
