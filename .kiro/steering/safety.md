# Safety, honesty and licences

## Life-safety wording (most important)
- The app is a **reference simulation**. It must never say or imply that a building is safe, compliant, approved or
  certified. Banned in UI text and docs: "safe", "compliant", "certified", "passes", "meets code" about a building.
- Every results screen shows a short notice: this is a simplified simulation for understanding risks; it does not
  replace a fire-safety review by the authorities or an engineer.
- When a result depends on something the model handles poorly (stairs and vertical shafts, long corridors, positions
  close to the fire, materials without measured data), the result carries a visible warning at that spot.
- Never hide or round away a bad outcome. If agents are trapped, the app says so plainly.

## Numbers and sources
- No invented coefficients. A value comes from the CFAST Technical Reference Guide, a NIST measurement, a cited
  handbook value, or the user's input. If a value is an estimate, it is labelled as an estimate in code and UI.
- Validation results are published as they are, including where we differ from CFAST and where CFAST differs from
  measurements.

## Licences and attribution
- CFAST is NIST software. We do not bundle or call it at runtime. Files taken from the CFAST repository (input files
  in `validation/cases/`) keep the NIST software notice (`validation/NIST-NOTICE.md`) intact, state that they were
  changed if they were, and acknowledge NIST as the source.
- NIST Fire Calorimetry Database data: cite the dataset DOI 10.18434/mds2-2314 and the test ID for every curve.
- Experimental data from repositories without a stated licence is not committed; only cited.
- Our own code and content: MIT.

## Untrusted input
- DXF files are untrusted. Parse as data only; cap file size, entity count, coordinate range and nesting depth;
  return warnings, never crash or hang. Text from a DXF is displayed with `textContent`, never as HTML.
- No `eval`, no `new Function`, no dynamic import of user data.
- Files never leave the browser. CSP allows only the app's own origin.

## Content
- No real victims, names or photos of real fires. Sample buildings are invented by us and say so.
- No horror or spooky styling for the fire simulation.
