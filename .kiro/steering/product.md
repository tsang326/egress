# Product: Egress (working name)

## What it is
A browser app that shows how people would get out of a building during a fire. The user imports the building's
floor plans (DXF, one per floor), marks exits and stairs, places furniture with real materials and picks where a
fire starts. The app then runs two coupled simulations:
1. **Fire and smoke**: a two-zone compartment fire model re-implemented from NIST CFAST 7.7.7, fed with heat release
   curves measured by NIST (Fire Calorimetry Database) for real furniture.
2. **People**: agents that walk to the exits they know, slow down in smoke, queue at doors and stairs.

The result answers one question: *if a fire starts here, who does not get out in time, and why?* The user then
changes the layout (move a sofa away from the curtains, unlock the back door) and runs it again to compare.

## Who it is for
Owners and managers of small buildings: cafés, karaoke bars, guest houses, multi-storey mini-apartments with one
staircase. Not fire engineers; they already have Pathfinder, CFAST and FDS.

## What it is not
- Not a fire-safety assessment, certification or approval, and never presented as one.
- Not a replacement for FDS/CFAST analysis by an engineer, or for the fire authority's review.
- No AI calls, no accounts, no server. Files never leave the browser.

## Product rules
- Every number on screen has a source (a NIST test, a Tech Ref equation, a cited handbook value) or is labelled as
  an estimate.
- Known limits are shown where they apply (stairs and shafts, near-fire radiation, materials without measured data).
- Results are shown as ranges where the validation shows a bias, not as a single exact time.
- Plain language for a shop owner: "smoke reaches head height at about 2 min 10 s", not "HGT_1 = 1.6 m".
- Tone: serious and calm. Real fires killed real people; no horror styling, no jokes, no victims' names or photos.
