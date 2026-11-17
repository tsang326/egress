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

Licence: MIT for our code. Files from NIST keep the NIST notice (`validation/NIST-NOTICE.md`).
