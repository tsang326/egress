// Known causes of cases outside tolerance (fire-zone Req 13.8, 13.10). Plain data: case path -> text.
// The report generator prints the text under the case and in the summary. A text states what has been measured about
// the difference; where the cause is not identified it says so. Nothing here changes a verdict or a tolerance.
// Numbers in a text are from the validation run named in `validation/REPORT.md`; change a text when a run changes them.

export const KNOWN_CAUSES: Readonly<Record<string, string>> = {
  'validation/cases/verification/Mass_Balance/species_mass_4.in':
    'Numerics. The model uses a fixed-order BDF2 integrator with the DASSL corrector. A two-step pressure error cycle ' +
    'can survive one scaled Newton iteration on a stale Jacobian (at 1300 s the cycle is about ±1.05 mPa on a door ' +
    'pressure difference of 2.8 mPa). A fully converged corrector matched CFAST within 0.0015 kg/s. Future item: port the ' +
    'full DASSL variable-order integrator (design.md). The case also reaches the 600 s wall-clock limit (Req 13.14), at ' +
    '7540 s of 10000 s simulated time, so no comparison was made.',
  'validation/cases/verification/Mass_Balance/species_mass_2.in':
    'Numerics. The model uses a fixed-order BDF2 integrator with the DASSL corrector. A two-step pressure error cycle ' +
    'can survive one scaled Newton iteration on a stale Jacobian (the worst vent flow is at 630 s). A fully converged ' +
    'corrector matched CFAST within 0.0015 kg/s. Future item: port the full DASSL variable-order integrator (design.md).',
  'validation/cases/delco/Test_06.in':
    'At 1230 s the three burners are re-igniting after an oxygen-limited extinction (about 1190 to 1215 s). The door\'s ' +
    'lower inflow depends on the gauge pressure in Comp 3, which is −0.034 Pa in CFAST and −0.118 Pa in the model. This ' +
    'sets the neutral plane at 0.053 m in CFAST and 0.184 m in the model, and inflow scales as height^1.5, so the flows ' +
    'are 0.0063 and about 0.040 kg/s. The pressure sits on a steep flank of a short pulse, which falls by 0.12 Pa/s in Comp 3 ' +
    'and 0.40 Pa/s in Comp 1. All three pressures, the interface heights and the layer temperatures are consistent with ' +
    'the model\'s pulse arriving about 0.65 s earlier than CFAST\'s. At 1215 s and 1245 s the pressures agree to 5 to 24 ' +
    'mPa. The door-jet heat release rate (within 3%) and the lower-layer oxygen (within 0.0003 mass fraction) agree with ' +
    'CFAST, and the Newton iteration shows no pressure error cycle at that time. The cause of the 0.65 s offset is not ' +
    'yet identified.',
  'validation/cases/delco/Test_02.in':
    'Cause not yet identified. The upper layer Rise of Comp 1 is higher in the model than in CFAST by a steady 5.4 K ' +
    '(5.0 % to 5.6 % of the Rise, growing) in the last 150 s of the run, from 1635 s to the end at 1785 s, just above the 5 % ' +
    'limit. Before 1635 s the difference is inside the tolerance. Not looked at further.',
  'validation/cases/delco/Test_03.in':
    'Cause not yet identified. The upper layer Rise of Comp 1 is higher in the model than in CFAST by 5.7 K (about ' +
    '5.1 % of the Rise) at the last three output times, 1755 s to 1785 s (end of the run), just above the 5 % limit. ' +
    'Before 1755 s the difference is inside the tolerance. Not looked at further.',
  'validation/cases/delco/Test_05.in':
    'Cause not yet identified. Two single output times are outside the tolerance: the upper outflow of the North East ' +
    'Door at 195 s and the lower outflow of the South East Door at 180 s, both early in the run and both with the ' +
    'model flow higher than CFAST. Every other point of the case, 7524 in all, is inside the tolerance. Not looked at ' +
    'further.',
};
