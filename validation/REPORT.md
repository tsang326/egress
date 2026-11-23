# Validation report: Fire_Model compared with CFAST 7.7.7

> This model is a reference simulation. Its results do not show that any building is safe or compliant.

CFAST is software of the National Institute of Standards and Technology (NIST). The input files under `validation/cases/` come from the NIST CFAST repository and the reference outputs under `validation/reference/` were produced by running NIST CFAST 7.7.7 on them. NIST is the source of all CFAST values in this report. The NIST software notice is kept in `validation/NIST-NOTICE.md`.

All cases are listed as they came out, including cases where the model differs from CFAST and cases where CFAST differs from the measurements. Nothing is left out or changed.

## Summary

| Within tolerance | Outside tolerance | Unsupported | Total |
| --- | --- | --- | --- |
| 15 | 6 | 0 | 21 |

| Case | Result | Points checked | Points outside | Reason |
| --- | --- | --- | --- | --- |
| validation/cases/delco/Test_02.in | outside tolerance | 4176 | 11 | 11 time points outside tolerance |
| validation/cases/delco/Test_03.in | outside tolerance | 4176 | 3 | 3 time points outside tolerance |
| validation/cases/delco/Test_04.in | within tolerance | 4176 | 0 |  |
| validation/cases/delco/Test_05.in | outside tolerance | 7524 | 2 | 2 time points outside tolerance |
| validation/cases/delco/Test_06.in | outside tolerance | 3888 | 19 | 19 time points outside tolerance |
| validation/cases/steckler/Steckler_010.in | within tolerance | 1218 | 0 |  |
| validation/cases/steckler/Steckler_012.in | within tolerance | 1218 | 0 |  |
| validation/cases/steckler/Steckler_014.in | within tolerance | 1218 | 0 |  |
| validation/cases/steckler/Steckler_017.in | within tolerance | 1218 | 0 |  |
| validation/cases/steckler/Steckler_114.in | within tolerance | 1218 | 0 |  |
| validation/cases/steckler/Steckler_116.in | within tolerance | 1218 | 0 |  |
| validation/cases/steckler/Steckler_212.in | within tolerance | 1218 | 0 |  |
| validation/cases/steckler/Steckler_514.in | within tolerance | 1218 | 0 |  |
| validation/cases/steckler/Steckler_517.in | within tolerance | 1218 | 0 |  |
| validation/cases/verification/Energy_Balance/sealed_test.in | within tolerance | 84 | 0 |  |
| validation/cases/verification/Energy_Balance/sealed_test_2_layers.in | within tolerance | 252 | 0 |  |
| validation/cases/verification/Mass_Balance/species_mass_1.in | within tolerance | 195 | 0 |  |
| validation/cases/verification/Mass_Balance/species_mass_2.in | outside tolerance | 650 | 100 | 100 time points outside tolerance |
| validation/cases/verification/Mass_Balance/species_mass_3.in | within tolerance | 650 | 0 |  |
| validation/cases/verification/Mass_Balance/species_mass_4.in | outside tolerance | n/a | n/a | The CFAST-order run (verdict run) was stopped at the 600 s wall-clock limit (Req 13.14). Simulated time reached: 7540 s of 10000 s (time of the last sample). Wall-clock time: 600 s. |
| validation/cases/verification/Ventilation/ventilation_4.in | within tolerance | 686 | 0 |  |

## Known causes

Cases outside tolerance and what is known about each difference.

- `validation/cases/delco/Test_02.in`: Worst: Comp 1, upper layer Rise (K) at 1785 s, CFAST 97.455, model 102.91, ratio 1.1198. Cause not yet identified. The upper layer Rise of Comp 1 is higher in the model than in CFAST by a steady 5.4 K (5.0 % to 5.6 % of the Rise, growing) in the last 150 s of the run, from 1635 s to the end at 1785 s, just above the 5 % limit. Before 1635 s the difference is inside the tolerance. Not looked at further.
- `validation/cases/delco/Test_03.in`: Worst: Comp 1, upper layer Rise (K) at 1785 s, CFAST 111.39, model 117.09, ratio 1.0236. Cause not yet identified. The upper layer Rise of Comp 1 is higher in the model than in CFAST by 5.7 K (about 5.1 % of the Rise) at the last three output times, 1755 s to 1785 s (end of the run), just above the 5 % limit. Before 1755 s the difference is inside the tolerance. Not looked at further.
- `validation/cases/delco/Test_05.in`: Worst: South East Door, vent flow, lower outflow (kg/s) at 180 s, CFAST 0.028178, model 0.038077, ratio 1.9797. Cause not yet identified. Two single output times are outside the tolerance: the upper outflow of the North East Door at 195 s and the lower outflow of the South East Door at 180 s, both early in the run and both with the model flow higher than CFAST. Every other point of the case, 7524 in all, is inside the tolerance. Not looked at further.
- `validation/cases/delco/Test_06.in`: Worst: West Double Door, vent flow, lower inflow (kg/s) at 1230 s, CFAST 0.0062891, model 0.040082, ratio 6.7586. At 1230 s the three burners are re-igniting after an oxygen-limited extinction (about 1190 to 1215 s). The door's lower inflow depends on the gauge pressure in Comp 3, which is −0.034 Pa in CFAST and −0.118 Pa in the model. This sets the neutral plane at 0.053 m in CFAST and 0.184 m in the model, and inflow scales as height^1.5, so the flows are 0.0063 and 0.0401 kg/s. The pressure sits on a steep flank of a short pulse, which falls by 0.12 Pa/s in Comp 3 and 0.40 Pa/s in Comp 1. All three pressures, the interface heights and the layer temperatures are consistent with the model's pulse arriving about 0.65 s earlier than CFAST's. At 1215 s and 1245 s the pressures agree to 5 to 24 mPa. The door-jet heat release rate (within 3%) and the lower-layer oxygen (within 0.0003 mass fraction) agree with CFAST, and the Newton iteration shows no pressure error cycle at that time. The cause of the 0.65 s offset is not yet identified.
- `validation/cases/verification/Mass_Balance/species_mass_2.in`: Worst: WallVent_1, vent flow, lower outflow (kg/s) at 630 s, CFAST 0.049075, model 0.036588, ratio 2.4973. Numerics. The model uses a fixed-order BDF2 integrator with the DASSL corrector. A two-step pressure error cycle can survive one scaled Newton iteration on a stale Jacobian (the worst vent flow is at 630 s). A fully converged corrector matched CFAST within 0.0015 kg/s. Future item: port the full DASSL variable-order integrator (design.md).
- `validation/cases/verification/Mass_Balance/species_mass_4.in`: Numerics. The model uses a fixed-order BDF2 integrator with the DASSL corrector. A two-step pressure error cycle can survive one scaled Newton iteration on a stale Jacobian (at 1300 s the cycle is about ±1.05 mPa on a door pressure difference of 2.8 mPa). A fully converged corrector matched CFAST within 0.0015 kg/s. Future item: port the full DASSL variable-order integrator (design.md). The case also reaches the 600 s wall-clock limit (Req 13.14), at 7540 s of 10000 s simulated time, so no comparison was made.

## Method

- Time matching: a reference row is matched to the model sample within 1e-3 s of its time. Reason: CFAST writes some rows up to 8.6e-5 s before the nominal output time when an event falls on it (for example 839.9999 s for 840 s in DelCo Test_02, and 999.99992 s in species_mass_4). Model samples are at least 10 s apart, so the window cannot pick the wrong sample. This is time matching only, not a tolerance on any value.
- Leakage vents are compared on their single net-flow column. Reason: CFAST writes only the net flow (`L_` column) for a leakage vent and no layer flows.
- Ceiling and floor vents are compared as the net flow into each layer of the bottom compartment, split by sign into inflow and outflow. Reason: that is what CFAST writes (outputspreadsheet.f90 writes max(0, mflow) and max(0, -mflow), and flowvertical.f90 accumulates in mflow the net flow per layer of the bottom compartment).
- One-zone compartments (Req 13.13): where the reference has no lower layer temperature and no layer height column, only the columns it has are compared; the quantities not compared are listed under each case with the reason. This is not a failure by itself.
- Verdict run: CFAST upper plume argument order (Req 6.13), CFAST roof-vent outside density (Req 5.10) and the door-jet setting of the CFAST input (Req 6.14; on unless the input says `DOOR_JET_FIRE_SUB_MODEL = 'OFF'`). Each case is also run with each of the first two options off, and the difference is shown under the case. A case with a fire and a wall vent between two compartments is also run with the opposite door-jet setting; other cases cannot differ.

## Cases

### validation/cases/delco/Test_02.in

Result: **outside tolerance**

Reason: 11 time points outside tolerance

Closest to the limit: Comp 1, upper layer Rise (K) at 1785 s. CFAST 97.455, model 102.91, ratio of difference to allowed difference 1.1198 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Comp 1 | upper layer Rise (K) | 1785 | 97.455 | 102.91 | 5.4563 | 116 | 11 | outside tolerance |
| Comp 1 | lower layer Rise (K) | 435 | 114.4 | 112.8 | -1.6013 | 116 | 0 | within tolerance |
| Comp 1 | interface height (m) | 435 | 0.62639 | 0.63034 | 0.0039511 | 116 | 0 | within tolerance |
| Comp 2 | upper layer Rise (K) | 435 | 158.78 | 156.45 | -2.3278 | 116 | 0 | within tolerance |
| Comp 2 | lower layer Rise (K) | 450 | 43.067 | 42.703 | -0.36325 | 116 | 0 | within tolerance |
| Comp 2 | interface height (m) | 1005 | 1.603 | 1.6117 | 0.0087146 | 116 | 0 | within tolerance |
| Comp 3 | upper layer Rise (K) | 450 | 100.11 | 99.166 | -0.94258 | 116 | 0 | within tolerance |
| Comp 3 | lower layer Rise (K) | 435 | 16.747 | 16.569 | -0.1781 | 116 | 0 | within tolerance |
| Comp 3 | interface height (m) | 510 | 1.035 | 1.0317 | -0.0032903 | 116 | 0 | within tolerance |
| West Double Door | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| West Double Door | vent flow, upper outflow (kg/s) | 1005 | 0.1249 | 0.12313 | -0.0017648 | 116 | 0 | within tolerance |
| West Double Door | vent flow, lower inflow (kg/s) | 450 | 0.75341 | 0.74176 | -0.01165 | 116 | 0 | within tolerance |
| West Double Door | vent flow, lower outflow (kg/s) | 1380 | 0.04973 | 0.050562 | 0.00083196 | 116 | 0 | within tolerance |
| East Double Door | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| East Double Door | vent flow, upper outflow (kg/s) | 1005 | 0.1249 | 0.12313 | -0.0017648 | 116 | 0 | within tolerance |
| East Double Door | vent flow, lower inflow (kg/s) | 540 | 0.85745 | 0.85912 | 0.0016659 | 116 | 0 | within tolerance |
| East Double Door | vent flow, lower outflow (kg/s) | 1380 | 0.04973 | 0.050562 | 0.00083196 | 116 | 0 | within tolerance |
| South Door | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| South Door | vent flow, upper outflow (kg/s) | 330 | 0.18759 | 0.18577 | -0.0018214 | 116 | 0 | within tolerance |
| South Door | vent flow, lower inflow (kg/s) | 450 | 0.17071 | 0.16855 | -0.0021643 | 116 | 0 | within tolerance |
| South Door | vent flow, lower outflow (kg/s) | 765 | 0.027328 | 0.027156 | -0.00017134 | 116 | 0 | within tolerance |
| North East Door | vent flow, upper inflow (kg/s) | 450 | 0.0097379 | 0.009403 | -0.00033481 | 116 | 0 | within tolerance |
| North East Door | vent flow, upper outflow (kg/s) | 1005 | 0.29449 | 0.28838 | -0.0061082 | 116 | 0 | within tolerance |
| North East Door | vent flow, lower inflow (kg/s) | 450 | 0.56432 | 0.55719 | -0.0071277 | 116 | 0 | within tolerance |
| North East Door | vent flow, lower outflow (kg/s) | 1020 | 0.087838 | 0.090531 | 0.0026933 | 116 | 0 | within tolerance |
| South East Door | vent flow, upper inflow (kg/s) | 405 | 0.012286 | 0.012613 | 0.00032708 | 116 | 0 | within tolerance |
| South East Door | vent flow, upper outflow (kg/s) | 450 | 0.75745 | 0.76293 | 0.0054822 | 116 | 0 | within tolerance |
| South East Door | vent flow, lower inflow (kg/s) | 435 | 0.47744 | 0.4728 | -0.0046322 | 116 | 0 | within tolerance |
| South East Door | vent flow, lower outflow (kg/s) | 615 | 0.028216 | 0.027997 | -0.00021976 | 116 | 0 | within tolerance |
| Roof Vent | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| Roof Vent | vent flow, upper outflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| Roof Vent | vent flow, lower inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| Roof Vent | vent flow, lower outflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| Floor Leak Comp 1 | leakage vent net flow out of the compartment (kg/s) | 450 | -0.022699 | -0.022547 | 0.00015207 | 116 | 0 | within tolerance |
| Floor Leak Comp 2 | leakage vent net flow out of the compartment (kg/s) | 330 | -0.0088418 | -0.0089102 | -0.000068318 | 116 | 0 | within tolerance |
| Floor Leak Comp 3 | leakage vent net flow out of the compartment (kg/s) | 330 | -0.016399 | -0.016591 | -0.0001921 | 116 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

<details>
<summary>All 11 time points outside tolerance</summary>

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) |
| --- | --- | --- | --- | --- | --- |
| Comp 1 | upper layer Rise (K) | 1635 | 107.56 | 112.95 | 5.3926 |
| Comp 1 | upper layer Rise (K) | 1650 | 106.44 | 111.84 | 5.4017 |
| Comp 1 | upper layer Rise (K) | 1665 | 105.35 | 110.76 | 5.4102 |
| Comp 1 | upper layer Rise (K) | 1680 | 104.28 | 109.7 | 5.418 |
| Comp 1 | upper layer Rise (K) | 1695 | 103.24 | 108.66 | 5.4252 |
| Comp 1 | upper layer Rise (K) | 1710 | 102.22 | 107.65 | 5.4317 |
| Comp 1 | upper layer Rise (K) | 1725 | 101.23 | 106.66 | 5.4377 |
| Comp 1 | upper layer Rise (K) | 1740 | 100.25 | 105.7 | 5.4432 |
| Comp 1 | upper layer Rise (K) | 1755 | 99.3 | 104.75 | 5.4481 |
| Comp 1 | upper layer Rise (K) | 1770 | 98.368 | 103.82 | 5.4525 |
| Comp 1 | upper layer Rise (K) | 1785 | 97.455 | 102.91 | 5.4563 |

</details>

**Known cause**

Cause not yet identified. The upper layer Rise of Comp 1 is higher in the model than in CFAST by a steady 5.4 K (5.0 % to 5.6 % of the Rise, growing) in the last 150 s of the run, from 1635 s to the end at 1785 s, just above the 5 % limit. Before 1635 s the difference is inside the tolerance. Not looked at further.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.0022869 | 10.045 |
| co2 | 0.11165 | 2.0116 |
| co | 0.000912 | 0.016431 |
| h2o | 0.070827 | 1.9298 |
| soot | 0.00018992 | 0.0034233 |
| n2 | 0.45053 | 41.884 |
| uhc | 0.051912 | 0.091943 |

### validation/cases/delco/Test_03.in

Result: **outside tolerance**

Reason: 3 time points outside tolerance

Closest to the limit: Comp 1, upper layer Rise (K) at 1785 s. CFAST 111.39, model 117.09, ratio of difference to allowed difference 1.0236 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Comp 1 | upper layer Rise (K) | 1785 | 111.39 | 117.09 | 5.7007 | 116 | 3 | outside tolerance |
| Comp 1 | lower layer Rise (K) | 435 | 109.44 | 107.75 | -1.6861 | 116 | 0 | within tolerance |
| Comp 1 | interface height (m) | 435 | 0.60355 | 0.60883 | 0.0052802 | 116 | 0 | within tolerance |
| Comp 2 | upper layer Rise (K) | 435 | 152.1 | 149.43 | -2.6682 | 116 | 0 | within tolerance |
| Comp 2 | lower layer Rise (K) | 450 | 40.444 | 40.004 | -0.43975 | 116 | 0 | within tolerance |
| Comp 2 | interface height (m) | 1560 | 1.1715 | 1.1787 | 0.0071478 | 116 | 0 | within tolerance |
| Comp 3 | upper layer Rise (K) | 450 | 99.671 | 98.626 | -1.0448 | 116 | 0 | within tolerance |
| Comp 3 | lower layer Rise (K) | 345 | 18.115 | 17.505 | -0.6107 | 116 | 0 | within tolerance |
| Comp 3 | interface height (m) | 465 | 0.78788 | 0.78417 | -0.0037092 | 116 | 0 | within tolerance |
| West Double Door | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| West Double Door | vent flow, upper outflow (kg/s) | 1065 | 0.16779 | 0.16602 | -0.0017692 | 116 | 0 | within tolerance |
| West Double Door | vent flow, lower inflow (kg/s) | 450 | 0.74773 | 0.7353 | -0.012431 | 116 | 0 | within tolerance |
| West Double Door | vent flow, lower outflow (kg/s) | 1590 | 0.05065 | 0.05145 | 0.0008 | 116 | 0 | within tolerance |
| East Double Door | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| East Double Door | vent flow, upper outflow (kg/s) | 1065 | 0.16779 | 0.16602 | -0.0017692 | 116 | 0 | within tolerance |
| East Double Door | vent flow, lower inflow (kg/s) | 1020 | 0.49203 | 0.48956 | -0.0024638 | 116 | 0 | within tolerance |
| East Double Door | vent flow, lower outflow (kg/s) | 1590 | 0.05065 | 0.05145 | 0.0008 | 116 | 0 | within tolerance |
| South Door | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| South Door | vent flow, upper outflow (kg/s) | 300 | 0.20019 | 0.19548 | -0.0047058 | 116 | 0 | within tolerance |
| South Door | vent flow, lower inflow (kg/s) | 300 | 0.16609 | 0.17226 | 0.0061712 | 116 | 0 | within tolerance |
| South Door | vent flow, lower outflow (kg/s) | 1020 | 0.23891 | 0.24106 | 0.0021547 | 116 | 0 | within tolerance |
| North East Door | vent flow, upper inflow (kg/s) | 465 | 0.0051956 | 0.0055047 | 0.00030913 | 116 | 0 | within tolerance |
| North East Door | vent flow, upper outflow (kg/s) | 1050 | 0.2034 | 0.19873 | -0.0046715 | 116 | 0 | within tolerance |
| North East Door | vent flow, lower inflow (kg/s) | 450 | 0.58426 | 0.57724 | -0.0070224 | 116 | 0 | within tolerance |
| North East Door | vent flow, lower outflow (kg/s) | 1080 | 0.047107 | 0.048401 | 0.0012944 | 116 | 0 | within tolerance |
| South East Door | vent flow, upper inflow (kg/s) | 420 | 0.0090423 | 0.0093416 | 0.00029932 | 116 | 0 | within tolerance |
| South East Door | vent flow, upper outflow (kg/s) | 420 | 0.57364 | 0.56828 | -0.0053584 | 116 | 0 | within tolerance |
| South East Door | vent flow, lower inflow (kg/s) | 450 | 0.55987 | 0.55608 | -0.0037899 | 116 | 0 | within tolerance |
| South East Door | vent flow, lower outflow (kg/s) | 1020 | 0.23256 | 0.2338 | 0.0012421 | 116 | 0 | within tolerance |
| Roof Vent | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| Roof Vent | vent flow, upper outflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| Roof Vent | vent flow, lower inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| Roof Vent | vent flow, lower outflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| Floor Leak Comp 1 | leakage vent net flow out of the compartment (kg/s) | 300 | -0.022884 | -0.023193 | -0.00030979 | 116 | 0 | within tolerance |
| Floor Leak Comp 2 | leakage vent net flow out of the compartment (kg/s) | 300 | -0.0081728 | -0.0083762 | -0.00020341 | 116 | 0 | within tolerance |
| Floor Leak Comp 3 | leakage vent net flow out of the compartment (kg/s) | 300 | -0.014621 | -0.015157 | -0.00053517 | 116 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

<details>
<summary>All 3 time points outside tolerance</summary>

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) |
| --- | --- | --- | --- | --- | --- |
| Comp 1 | upper layer Rise (K) | 1755 | 113.58 | 119.27 | 5.6834 |
| Comp 1 | upper layer Rise (K) | 1770 | 112.47 | 118.16 | 5.6923 |
| Comp 1 | upper layer Rise (K) | 1785 | 111.39 | 117.09 | 5.7007 |

</details>

**Known cause**

Cause not yet identified. The upper layer Rise of Comp 1 is higher in the model than in CFAST by 5.7 K (about 5.1 % of the Rise) at the last three output times, 1755 s to 1785 s (end of the run), just above the 5 % limit. Before 1755 s the difference is inside the tolerance. Not looked at further.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | 0.073592 | 9.6529 |
| co2 | 0.067384 | 1.9928 |
| co | 0.0005504 | 0.016278 |
| h2o | 0.047604 | 1.8924 |
| soot | 0.0001146 | 0.0033913 |
| n2 | 0.52289 | 40.494 |
| uhc | 0.068528 | 0.12479 |

### validation/cases/delco/Test_04.in

Result: **within tolerance**

Closest to the limit: Comp 1, upper layer Rise (K) at 1560 s. CFAST 130.86, model 135.02, ratio of difference to allowed difference 0.63612 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Comp 1 | upper layer Rise (K) | 1560 | 130.86 | 135.02 | 4.162 | 116 | 0 | within tolerance |
| Comp 1 | lower layer Rise (K) | 435 | 108.21 | 106.47 | -1.7413 | 116 | 0 | within tolerance |
| Comp 1 | interface height (m) | 435 | 0.58861 | 0.59376 | 0.0051543 | 116 | 0 | within tolerance |
| Comp 2 | upper layer Rise (K) | 435 | 151 | 148.15 | -2.8523 | 116 | 0 | within tolerance |
| Comp 2 | lower layer Rise (K) | 450 | 39.561 | 39.081 | -0.48064 | 116 | 0 | within tolerance |
| Comp 2 | interface height (m) | 1605 | 1.1763 | 1.1834 | 0.0071364 | 116 | 0 | within tolerance |
| Comp 3 | upper layer Rise (K) | 435 | 81.311 | 80.391 | -0.9195 | 116 | 0 | within tolerance |
| Comp 3 | lower layer Rise (K) | 435 | 15.839 | 15.624 | -0.21468 | 116 | 0 | within tolerance |
| Comp 3 | interface height (m) | 465 | 0.78608 | 0.78221 | -0.0038738 | 116 | 0 | within tolerance |
| West Double Door | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| West Double Door | vent flow, upper outflow (kg/s) | 1065 | 0.17575 | 0.17401 | -0.0017426 | 116 | 0 | within tolerance |
| West Double Door | vent flow, lower inflow (kg/s) | 450 | 0.75108 | 0.73879 | -0.012295 | 116 | 0 | within tolerance |
| West Double Door | vent flow, lower outflow (kg/s) | 1590 | 0.052108 | 0.052915 | 0.0008075 | 116 | 0 | within tolerance |
| East Double Door | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| East Double Door | vent flow, upper outflow (kg/s) | 1065 | 0.17575 | 0.17401 | -0.0017426 | 116 | 0 | within tolerance |
| East Double Door | vent flow, lower inflow (kg/s) | 540 | 0.76499 | 0.76674 | 0.0017494 | 116 | 0 | within tolerance |
| East Double Door | vent flow, lower outflow (kg/s) | 1590 | 0.052108 | 0.052915 | 0.0008075 | 116 | 0 | within tolerance |
| South Door | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| South Door | vent flow, upper outflow (kg/s) | 300 | 0.17704 | 0.17523 | -0.0018051 | 116 | 0 | within tolerance |
| South Door | vent flow, lower inflow (kg/s) | 450 | 0.17507 | 0.17293 | -0.0021323 | 116 | 0 | within tolerance |
| South Door | vent flow, lower outflow (kg/s) | 900 | 0.037347 | 0.037189 | -0.00015771 | 116 | 0 | within tolerance |
| North East Door | vent flow, upper inflow (kg/s) | 465 | 0.0052744 | 0.0056031 | 0.00032872 | 116 | 0 | within tolerance |
| North East Door | vent flow, upper outflow (kg/s) | 1050 | 0.21838 | 0.21357 | -0.0048126 | 116 | 0 | within tolerance |
| North East Door | vent flow, lower inflow (kg/s) | 435 | 0.37946 | 0.37373 | -0.005724 | 116 | 0 | within tolerance |
| North East Door | vent flow, lower outflow (kg/s) | 1065 | 0.1336 | 0.13683 | 0.0032258 | 116 | 0 | within tolerance |
| South East Door | vent flow, upper inflow (kg/s) | 420 | 0.0075367 | 0.0078633 | 0.00032662 | 116 | 0 | within tolerance |
| South East Door | vent flow, upper outflow (kg/s) | 420 | 0.59161 | 0.58442 | -0.0071835 | 116 | 0 | within tolerance |
| South East Door | vent flow, lower inflow (kg/s) | 435 | 0.41031 | 0.40582 | -0.0044927 | 116 | 0 | within tolerance |
| South East Door | vent flow, lower outflow (kg/s) | 615 | 0.020681 | 0.02051 | -0.00017087 | 116 | 0 | within tolerance |
| Roof Vent | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| Roof Vent | vent flow, upper outflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| Roof Vent | vent flow, lower inflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| Roof Vent | vent flow, lower outflow (kg/s) | 60 | 0 | 0 | 0 | 116 | 0 | within tolerance |
| Floor Leak Comp 1 | leakage vent net flow out of the compartment (kg/s) | 435 | -0.019846 | -0.019681 | 0.00016525 | 116 | 0 | within tolerance |
| Floor Leak Comp 2 | leakage vent net flow out of the compartment (kg/s) | 300 | -0.0091642 | -0.0092281 | -0.000063918 | 116 | 0 | within tolerance |
| Floor Leak Comp 3 | leakage vent net flow out of the compartment (kg/s) | 300 | -0.017352 | -0.017532 | -0.00017931 | 116 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | 0.11612 | 9.5257 |
| co2 | 0.044877 | 1.9895 |
| co | 0.00036656 | 0.016251 |
| h2o | 0.036054 | 1.8821 |
| soot | 0.000076285 | 0.0033857 |
| n2 | 0.5729 | 40.055 |
| uhc | 0.081892 | 0.15379 |

### validation/cases/delco/Test_05.in

Result: **outside tolerance**

Reason: 2 time points outside tolerance

Closest to the limit: South East Door, vent flow, lower outflow (kg/s) at 180 s. CFAST 0.028178, model 0.038077, ratio of difference to allowed difference 1.9797 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Comp 1 | upper layer Rise (K) | 195 | 193.14 | 199.31 | 6.1656 | 209 | 0 | within tolerance |
| Comp 1 | lower layer Rise (K) | 195 | 97.173 | 98.16 | 0.98662 | 209 | 0 | within tolerance |
| Comp 1 | interface height (m) | 195 | 0.99466 | 0.95339 | -0.04127 | 209 | 0 | within tolerance |
| Comp 2 | upper layer Rise (K) | 195 | 117.57 | 119.41 | 1.8399 | 209 | 0 | within tolerance |
| Comp 2 | lower layer Rise (K) | 225 | 41.037 | 40.588 | -0.44875 | 209 | 0 | within tolerance |
| Comp 2 | interface height (m) | 195 | 1.4304 | 1.4133 | -0.017066 | 209 | 0 | within tolerance |
| Comp 3 | upper layer Rise (K) | 210 | 101.15 | 101.39 | 0.24673 | 209 | 0 | within tolerance |
| Comp 3 | lower layer Rise (K) | 2550 | 23.814 | 23.701 | -0.11263 | 209 | 0 | within tolerance |
| Comp 3 | interface height (m) | 195 | 1.2112 | 1.2055 | -0.0056448 | 209 | 0 | within tolerance |
| West Double Door | vent flow, upper inflow (kg/s) | 75 | 0 | 0 | 0 | 209 | 0 | within tolerance |
| West Double Door | vent flow, upper outflow (kg/s) | 195 | 0.28546 | 0.3049 | 0.019434 | 209 | 0 | within tolerance |
| West Double Door | vent flow, lower inflow (kg/s) | 195 | 1.1261 | 1.0864 | -0.039682 | 209 | 0 | within tolerance |
| West Double Door | vent flow, lower outflow (kg/s) | 1860 | 0.043346 | 0.043412 | 0.000065913 | 209 | 0 | within tolerance |
| East Double Door | vent flow, upper inflow (kg/s) | 75 | 0 | 0 | 0 | 209 | 0 | within tolerance |
| East Double Door | vent flow, upper outflow (kg/s) | 2745 | 0.096486 | 0.096541 | 0.000055197 | 209 | 0 | within tolerance |
| East Double Door | vent flow, lower inflow (kg/s) | 1140 | 0.64346 | 0.64379 | 0.00032779 | 209 | 0 | within tolerance |
| East Double Door | vent flow, lower outflow (kg/s) | 1860 | 0.043346 | 0.043412 | 0.000065913 | 209 | 0 | within tolerance |
| South Door | vent flow, upper inflow (kg/s) | 75 | 0 | 0 | 0 | 209 | 0 | within tolerance |
| South Door | vent flow, upper outflow (kg/s) | 75 | 0 | 0 | 0 | 209 | 0 | within tolerance |
| South Door | vent flow, lower inflow (kg/s) | 75 | 0 | 0 | 0 | 209 | 0 | within tolerance |
| South Door | vent flow, lower outflow (kg/s) | 75 | 0 | 0 | 0 | 209 | 0 | within tolerance |
| North East Door | vent flow, upper inflow (kg/s) | 180 | 0.16519 | 0.17722 | 0.012032 | 209 | 0 | within tolerance |
| North East Door | vent flow, upper outflow (kg/s) | 195 | 0.14823 | 0.17016 | 0.021934 | 209 | 1 | outside tolerance |
| North East Door | vent flow, lower inflow (kg/s) | 195 | 0.87701 | 0.85256 | -0.024448 | 209 | 0 | within tolerance |
| North East Door | vent flow, lower outflow (kg/s) | 195 | 0.00066657 | 0.0018723 | 0.0012057 | 209 | 0 | within tolerance |
| South East Door | vent flow, upper inflow (kg/s) | 150 | 0.014896 | 0.015145 | 0.00024982 | 209 | 0 | within tolerance |
| South East Door | vent flow, upper outflow (kg/s) | 195 | 1.104 | 1.1652 | 0.061218 | 209 | 0 | within tolerance |
| South East Door | vent flow, lower inflow (kg/s) | 195 | 0.20152 | 0.18351 | -0.018003 | 209 | 0 | within tolerance |
| South East Door | vent flow, lower outflow (kg/s) | 180 | 0.028178 | 0.038077 | 0.0098987 | 209 | 1 | outside tolerance |
| Roof Vent | vent flow, upper inflow (kg/s) | 75 | 0 | 0 | 0 | 209 | 0 | within tolerance |
| Roof Vent | vent flow, upper outflow (kg/s) | 195 | 1.2792 | 1.3385 | 0.05928 | 209 | 0 | within tolerance |
| Roof Vent | vent flow, lower inflow (kg/s) | 2580 | 0.055137 | 0.053598 | -0.0015399 | 209 | 0 | within tolerance |
| Roof Vent | vent flow, lower outflow (kg/s) | 195 | 0.79455 | 0.77384 | -0.020711 | 209 | 0 | within tolerance |
| Floor Leak Comp 1 | leakage vent net flow out of the compartment (kg/s) | 2535 | -0.07535 | -0.076741 | -0.0013902 | 209 | 0 | within tolerance |
| Floor Leak Comp 2 | leakage vent net flow out of the compartment (kg/s) | 2535 | -0.033734 | -0.034389 | -0.000655 | 209 | 0 | within tolerance |
| Floor Leak Comp 3 | leakage vent net flow out of the compartment (kg/s) | 2535 | -0.072542 | -0.073984 | -0.0014423 | 209 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

<details>
<summary>All 2 time points outside tolerance</summary>

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) |
| --- | --- | --- | --- | --- | --- |
| North East Door | vent flow, upper outflow (kg/s) | 195 | 0.14823 | 0.17016 | 0.021934 |
| South East Door | vent flow, lower outflow (kg/s) | 180 | 0.028178 | 0.038077 | 0.0098987 |

</details>

**Known cause**

Cause not yet identified. Two single output times are outside the tolerance: the upper outflow of the North East Door at 195 s and the lower outflow of the South East Door at 180 s, both early in the run and both with the model flow higher than CFAST. Every other point of the case, 7524 in all, is inside the tolerance. Not looked at further.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

Largest absolute difference: 0.060339 in upper layer Rise (K) of Comp 1 at 2460 s (CFAST-order run 471.14, intended-order run 471.08).

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

Largest absolute difference: 429.3 in upper layer Rise (K) of Comp 2 at 2670 s (CFAST density run 150.7, ambient density run 580.01).

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -2.8742 | 34.525 |
| co2 | 1.9341 | 4.4563 |
| co | 0.015798 | 0.0364 |
| h2o | 1.0432 | 5.0705 |
| soot | 0.0032912 | 0.0075833 |
| n2 | -1.6856 | 133.87 |
| uhc | 0.24175 | 0.33721 |

### validation/cases/delco/Test_06.in

Result: **outside tolerance**

Reason: 19 time points outside tolerance

Closest to the limit: West Double Door, vent flow, lower inflow (kg/s) at 1230 s. CFAST 0.0062891, model 0.040082, ratio of difference to allowed difference 6.7586 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Comp 1 | upper layer Rise (K) | 720 | 310.53 | 322.26 | 11.729 | 108 | 0 | within tolerance |
| Comp 1 | lower layer Rise (K) | 720 | 186.5 | 189.02 | 2.5209 | 108 | 0 | within tolerance |
| Comp 1 | interface height (m) | 720 | 1.0648 | 0.98221 | -0.08258 | 108 | 0 | within tolerance |
| Comp 2 | upper layer Rise (K) | 1230 | 222.85 | 228.12 | 5.2689 | 108 | 0 | within tolerance |
| Comp 2 | lower layer Rise (K) | 720 | 42.24 | 43.269 | 1.0294 | 108 | 0 | within tolerance |
| Comp 2 | interface height (m) | 720 | 0.73825 | 0.71479 | -0.023457 | 108 | 0 | within tolerance |
| Comp 3 | upper layer Rise (K) | 1230 | 139.52 | 142.34 | 2.8208 | 108 | 0 | within tolerance |
| Comp 3 | lower layer Rise (K) | 720 | 14.989 | 15.325 | 0.33636 | 108 | 0 | within tolerance |
| Comp 3 | interface height (m) | 1230 | 0.84299 | 0.82857 | -0.014412 | 108 | 0 | within tolerance |
| West Double Door | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 108 | 0 | within tolerance |
| West Double Door | vent flow, upper outflow (kg/s) | 135 | 0.65919 | 0.80445 | 0.14526 | 108 | 1 | outside tolerance |
| West Double Door | vent flow, lower inflow (kg/s) | 1230 | 0.0062891 | 0.040082 | 0.033793 | 108 | 2 | outside tolerance |
| West Double Door | vent flow, lower outflow (kg/s) | 1230 | 0.34448 | 0.25632 | -0.088165 | 108 | 2 | outside tolerance |
| East Double Door | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 108 | 0 | within tolerance |
| East Double Door | vent flow, upper outflow (kg/s) | 915 | 0.037007 | 0.037094 | 0.000087893 | 108 | 0 | within tolerance |
| East Double Door | vent flow, lower inflow (kg/s) | 495 | 0.12917 | 0.12901 | -0.00016287 | 108 | 0 | within tolerance |
| East Double Door | vent flow, lower outflow (kg/s) | 510 | 0.07133 | 0.071265 | -0.000065251 | 108 | 0 | within tolerance |
| South Door | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 108 | 0 | within tolerance |
| South Door | vent flow, upper outflow (kg/s) | 60 | 0 | 0 | 0 | 108 | 0 | within tolerance |
| South Door | vent flow, lower inflow (kg/s) | 60 | 0 | 0 | 0 | 108 | 0 | within tolerance |
| South Door | vent flow, lower outflow (kg/s) | 60 | 0 | 0 | 0 | 108 | 0 | within tolerance |
| North East Door | vent flow, upper inflow (kg/s) | 135 | 0.021906 | 0.0024878 | -0.019418 | 108 | 1 | outside tolerance |
| North East Door | vent flow, upper outflow (kg/s) | 135 | 0.46545 | 0.59695 | 0.1315 | 108 | 1 | outside tolerance |
| North East Door | vent flow, lower inflow (kg/s) | 1230 | 0.11117 | 0.15035 | 0.039181 | 108 | 3 | outside tolerance |
| North East Door | vent flow, lower outflow (kg/s) | 1230 | 0.11219 | 0.073486 | -0.038708 | 108 | 2 | outside tolerance |
| South East Door | vent flow, upper inflow (kg/s) | 120 | 0.009383 | 0.009542 | 0.00015907 | 108 | 0 | within tolerance |
| South East Door | vent flow, upper outflow (kg/s) | 135 | 0.34417 | 0.44932 | 0.10514 | 108 | 1 | outside tolerance |
| South East Door | vent flow, lower inflow (kg/s) | 135 | 0.61006 | 0.50384 | -0.10623 | 108 | 3 | outside tolerance |
| South East Door | vent flow, lower outflow (kg/s) | 135 | 0.13075 | 0.20913 | 0.078384 | 108 | 3 | outside tolerance |
| Roof Vent | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 108 | 0 | within tolerance |
| Roof Vent | vent flow, upper outflow (kg/s) | 495 | 0.00015537 | 0 | -0.00015537 | 108 | 0 | within tolerance |
| Roof Vent | vent flow, lower inflow (kg/s) | 60 | 0 | 0 | 0 | 108 | 0 | within tolerance |
| Roof Vent | vent flow, lower outflow (kg/s) | 1290 | 0.068518 | 0.069 | 0.0004815 | 108 | 0 | within tolerance |
| Floor Leak Comp 1 | leakage vent net flow out of the compartment (kg/s) | 135 | -0.023238 | -0.021119 | 0.0021191 | 108 | 0 | within tolerance |
| Floor Leak Comp 2 | leakage vent net flow out of the compartment (kg/s) | 720 | 0.0016919 | -0.00091457 | -0.0026065 | 108 | 0 | within tolerance |
| Floor Leak Comp 3 | leakage vent net flow out of the compartment (kg/s) | 1230 | -0.0021184 | -0.003981 | -0.0018626 | 108 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

<details>
<summary>All 19 time points outside tolerance</summary>

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) |
| --- | --- | --- | --- | --- | --- |
| West Double Door | vent flow, upper outflow (kg/s) | 135 | 0.65919 | 0.80445 | 0.14526 |
| West Double Door | vent flow, lower inflow (kg/s) | 135 | 1.0563 | 0.8275 | -0.22875 |
| West Double Door | vent flow, lower inflow (kg/s) | 1230 | 0.0062891 | 0.040082 | 0.033793 |
| West Double Door | vent flow, lower outflow (kg/s) | 720 | 0.49029 | 0.42894 | -0.061355 |
| West Double Door | vent flow, lower outflow (kg/s) | 1230 | 0.34448 | 0.25632 | -0.088165 |
| North East Door | vent flow, upper inflow (kg/s) | 135 | 0.021906 | 0.0024878 | -0.019418 |
| North East Door | vent flow, upper outflow (kg/s) | 135 | 0.46545 | 0.59695 | 0.1315 |
| North East Door | vent flow, lower inflow (kg/s) | 135 | 0.69568 | 0.52421 | -0.17147 |
| North East Door | vent flow, lower inflow (kg/s) | 720 | 0 | 0.012922 | 0.012922 |
| North East Door | vent flow, lower inflow (kg/s) | 1230 | 0.11117 | 0.15035 | 0.039181 |
| North East Door | vent flow, lower outflow (kg/s) | 720 | 0.35248 | 0.2797 | -0.072784 |
| North East Door | vent flow, lower outflow (kg/s) | 1230 | 0.11219 | 0.073486 | -0.038708 |
| South East Door | vent flow, upper outflow (kg/s) | 135 | 0.34417 | 0.44932 | 0.10514 |
| South East Door | vent flow, lower inflow (kg/s) | 135 | 0.61006 | 0.50384 | -0.10623 |
| South East Door | vent flow, lower inflow (kg/s) | 720 | 0.14272 | 0.16479 | 0.022069 |
| South East Door | vent flow, lower inflow (kg/s) | 1230 | 0.25883 | 0.28612 | 0.027297 |
| South East Door | vent flow, lower outflow (kg/s) | 135 | 0.13075 | 0.20913 | 0.078384 |
| South East Door | vent flow, lower outflow (kg/s) | 720 | 0.56076 | 0.45149 | -0.10927 |
| South East Door | vent flow, lower outflow (kg/s) | 1230 | 0.22863 | 0.16613 | -0.062508 |

</details>

**Known cause**

At 1230 s the three burners are re-igniting after an oxygen-limited extinction (about 1190 to 1215 s). The door's lower inflow depends on the gauge pressure in Comp 3, which is −0.034 Pa in CFAST and −0.118 Pa in the model. This sets the neutral plane at 0.053 m in CFAST and 0.184 m in the model, and inflow scales as height^1.5, so the flows are 0.0063 and 0.0401 kg/s. The pressure sits on a steep flank of a short pulse, which falls by 0.12 Pa/s in Comp 3 and 0.40 Pa/s in Comp 1. All three pressures, the interface heights and the layer temperatures are consistent with the model's pulse arriving about 0.65 s earlier than CFAST's. At 1215 s and 1245 s the pressures agree to 5 to 24 mPa. The door-jet heat release rate (within 3%) and the lower-layer oxygen (within 0.0003 mass fraction) agree with CFAST, and the Newton iteration shows no pressure error cycle at that time. The cause of the 0.65 s offset is not yet identified.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

Largest absolute difference: 15.553 in upper layer Rise (K) of Comp 1 at 1230 s (CFAST density run 395.94, ambient density run 411.49).

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -1.1733 | 25.28 |
| co2 | 0.91056 | 3.5393 |
| co | 0.0074376 | 0.028909 |
| h2o | 0.50277 | 3.8884 |
| soot | 0.0015477 | 0.0060306 |
| n2 | -0.19157 | 99.158 |
| uhc | 0.014978 | 0.055698 |

### validation/cases/steckler/Steckler_010.in

Result: **within tolerance**

Closest to the limit: Compartment 1, lower layer Rise (K) at 130 s. CFAST 15.992, model 15.99, ratio of difference to allowed difference 0.0014806 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Compartment 1 | upper layer Rise (K) | 80 | 101.55 | 101.55 | 0.0057993 | 174 | 0 | within tolerance |
| Compartment 1 | lower layer Rise (K) | 130 | 15.992 | 15.99 | -0.0029613 | 174 | 0 | within tolerance |
| Compartment 1 | interface height (m) | 60 | 0.73301 | 0.73298 | -0.000032967 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper outflow (kg/s) | 70 | 0.20665 | 0.20665 | 0.0000026677 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower inflow (kg/s) | 60 | 0.1876 | 0.18761 | 0.000013506 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower outflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.0073007 | 0.067171 |
| co2 | 0.00074263 | 0.000939 |
| co | 0 | 0 |
| h2o | 0.00032359 | 0.0039023 |
| soot | 0 | 0 |
| n2 | -0.020826 | 0.22945 |
| uhc | 0 | 0 |

**Published Steckler values**

| Test | Quantity | CFAST (Validation Guide, digitised) | Measured (Validation Guide, digitised) |
| --- | --- | --- | --- |
| 10 | upper-layer temperature (measured: maximum of the profile) (°C) | 156.3 °C, layer height 0.8 m (printed p. 335, PDF p. 359) | 193.1 °C at 1.88 m (printed p. 335, PDF p. 359) |

Note: The CFAST and measured values in the Steckler tables are digitised from the vector plots of the CFAST Validation Guide (Appendix C.17) by `tools/steckler/digitise.ts`. They are not printed in the Guide, carry a reading uncertainty of about 0.1 °C and 0.01 m, and are not a criterion for any verdict. Temperatures are absolute values in °C. The Guide does not state the time or averaging period of the profiles.

### validation/cases/steckler/Steckler_012.in

Result: **within tolerance**

Closest to the limit: Compartment 1, upper layer Rise (K) at 60 s. CFAST 83.375, model 83.386, ratio of difference to allowed difference 0.0026375 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Compartment 1 | upper layer Rise (K) | 60 | 83.375 | 83.386 | 0.010995 | 174 | 0 | within tolerance |
| Compartment 1 | lower layer Rise (K) | 100 | 8.641 | 8.6404 | -0.00059956 | 174 | 0 | within tolerance |
| Compartment 1 | interface height (m) | 80 | 1.0384 | 1.0384 | 0.000012974 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper outflow (kg/s) | 60 | 0.31451 | 0.31452 | 0.000010394 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower inflow (kg/s) | 60 | 0.30737 | 0.30739 | 0.000023156 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower outflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.0084444 | 0.082357 |
| co2 | 0.00085039 | 0.0010095 |
| co | 0 | 0 |
| h2o | 0.00043753 | 0.0038352 |
| soot | 0 | 0 |
| n2 | -0.02413 | 0.28063 |
| uhc | 0 | 0 |

**Published Steckler values**

| Test | Quantity | CFAST (Validation Guide, digitised) | Measured (Validation Guide, digitised) |
| --- | --- | --- | --- |
| 12 | upper-layer temperature (measured: maximum of the profile) (°C) | 124 °C, layer height 1.08 m (printed p. 335, PDF p. 359) | 142 °C at 1.77 m (printed p. 335, PDF p. 359) |

Note: The CFAST and measured values in the Steckler tables are digitised from the vector plots of the CFAST Validation Guide (Appendix C.17) by `tools/steckler/digitise.ts`. They are not printed in the Guide, carry a reading uncertainty of about 0.1 °C and 0.01 m, and are not a criterion for any verdict. Temperatures are absolute values in °C. The Guide does not state the time or averaging period of the profiles.

### validation/cases/steckler/Steckler_014.in

Result: **within tolerance**

Closest to the limit: Compartment 1, upper layer Rise (K) at 60 s. CFAST 77.454, model 77.462, ratio of difference to allowed difference 0.0020283 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Compartment 1 | upper layer Rise (K) | 60 | 77.454 | 77.462 | 0.0078551 | 174 | 0 | within tolerance |
| Compartment 1 | lower layer Rise (K) | 1720 | 12.645 | 12.644 | -0.0005631 | 174 | 0 | within tolerance |
| Compartment 1 | interface height (m) | 70 | 1.1729 | 1.1729 | 0.000011997 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper outflow (kg/s) | 60 | 0.36859 | 0.3686 | 0.0000021874 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower inflow (kg/s) | 60 | 0.36403 | 0.36404 | 0.0000091554 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower outflow (kg/s) | 1450 | 0.014559 | 0.014556 | -0.0000027709 | 174 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.0078269 | 0.079869 |
| co2 | 0.00080915 | 0.00094642 |
| co | 0 | 0 |
| h2o | 0.00029971 | 0.0052066 |
| soot | 0 | 0 |
| n2 | -0.022264 | 0.27199 |
| uhc | 0 | 0 |

**Published Steckler values**

| Test | Quantity | CFAST (Validation Guide, digitised) | Measured (Validation Guide, digitised) |
| --- | --- | --- | --- |
| 14 | upper-layer temperature (measured: maximum of the profile) (°C) | 120.3 °C, layer height 1.2 m (printed p. 335, PDF p. 359) | 129.6 °C at 1.77 m (printed p. 335, PDF p. 359) |

Note: The CFAST and measured values in the Steckler tables are digitised from the vector plots of the CFAST Validation Guide (Appendix C.17) by `tools/steckler/digitise.ts`. They are not printed in the Guide, carry a reading uncertainty of about 0.1 °C and 0.01 m, and are not a criterion for any verdict. Temperatures are absolute values in °C. The Guide does not state the time or averaging period of the profiles.

### validation/cases/steckler/Steckler_017.in

Result: **within tolerance**

Closest to the limit: Compartment 1, upper layer Rise (K) at 60 s. CFAST 71.785, model 71.79, ratio of difference to allowed difference 0.0014439 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Compartment 1 | upper layer Rise (K) | 60 | 71.785 | 71.79 | 0.0051824 | 174 | 0 | within tolerance |
| Compartment 1 | lower layer Rise (K) | 1790 | 10.493 | 10.493 | -0.00034047 | 174 | 0 | within tolerance |
| Compartment 1 | interface height (m) | 60 | 1.2533 | 1.2533 | 0.000012105 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper outflow (kg/s) | 60 | 0.41931 | 0.41931 | -0.0000032138 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower inflow (kg/s) | 1790 | 0.48559 | 0.48559 | -0.0000036411 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower outflow (kg/s) | 1790 | 0.050624 | 0.050621 | -0.000003027 | 174 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.007247 | 0.075206 |
| co2 | 0.00072251 | 0.00083968 |
| co | 0 | 0 |
| h2o | 0.00036913 | 0.0034306 |
| soot | 0 | 0 |
| n2 | -0.020744 | 0.25587 |
| uhc | 0 | 0 |

**Published Steckler values**

| Test | Quantity | CFAST (Validation Guide, digitised) | Measured (Validation Guide, digitised) |
| --- | --- | --- | --- |
| 17 | upper-layer temperature (measured: maximum of the profile) (°C) | 105 °C, layer height 1.29 m (printed p. 336, PDF p. 360) | 109.7 °C at 1.77 m (printed p. 336, PDF p. 360) |

Note: The CFAST and measured values in the Steckler tables are digitised from the vector plots of the CFAST Validation Guide (Appendix C.17) by `tools/steckler/digitise.ts`. They are not printed in the Guide, carry a reading uncertainty of about 0.1 °C and 0.01 m, and are not a criterion for any verdict. Temperatures are absolute values in °C. The Guide does not state the time or averaging period of the profiles.

### validation/cases/steckler/Steckler_114.in

Result: **within tolerance**

Closest to the limit: Compartment 1, lower layer Rise (K) at 130 s. CFAST 16.044, model 16.042, ratio of difference to allowed difference 0.0012445 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Compartment 1 | upper layer Rise (K) | 100 | 121.7 | 121.71 | 0.0055877 | 174 | 0 | within tolerance |
| Compartment 1 | lower layer Rise (K) | 130 | 16.044 | 16.042 | -0.0024889 | 174 | 0 | within tolerance |
| Compartment 1 | interface height (m) | 60 | 1.0084 | 1.0084 | -0.000033774 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper outflow (kg/s) | 60 | 0.16687 | 0.16687 | 0.000003954 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower inflow (kg/s) | 60 | 0.15263 | 0.15264 | 0.000014971 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower outflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.0086522 | 0.050515 |
| co2 | 0.0010829 | 0.0011917 |
| co | 0 | 0 |
| h2o | 0.0004279 | 0.0043622 |
| soot | 0 | 0 |
| n2 | -0.023694 | 0.17492 |
| uhc | 0 | 0 |

**Published Steckler values**

| Test | Quantity | CFAST (Validation Guide, digitised) | Measured (Validation Guide, digitised) |
| --- | --- | --- | --- |
| 114 | upper-layer temperature (measured: maximum of the profile) (°C) | 179.2 °C, layer height 1.05 m (printed p. 337, PDF p. 361) | 250.8 °C at 1.88 m (printed p. 337, PDF p. 361) |

Note: The CFAST and measured values in the Steckler tables are digitised from the vector plots of the CFAST Validation Guide (Appendix C.17) by `tools/steckler/digitise.ts`. They are not printed in the Guide, carry a reading uncertainty of about 0.1 °C and 0.01 m, and are not a criterion for any verdict. Temperatures are absolute values in °C. The Guide does not state the time or averaging period of the profiles.

### validation/cases/steckler/Steckler_116.in

Result: **within tolerance**

Closest to the limit: Compartment 1, upper layer Rise (K) at 60 s. CFAST 103.43, model 103.43, ratio of difference to allowed difference 0.0016897 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Compartment 1 | upper layer Rise (K) | 60 | 103.43 | 103.43 | 0.0087379 | 174 | 0 | within tolerance |
| Compartment 1 | lower layer Rise (K) | 1790 | 13.296 | 13.295 | -0.00047147 | 174 | 0 | within tolerance |
| Compartment 1 | interface height (m) | 70 | 1.4483 | 1.4483 | 0.0000059297 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper outflow (kg/s) | 60 | 0.26455 | 0.26455 | 0.0000019992 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower inflow (kg/s) | 60 | 0.32313 | 0.32314 | 0.0000082312 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower outflow (kg/s) | 80 | 0.08132 | 0.081327 | 0.0000067056 | 174 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.0087723 | 0.05296 |
| co2 | 0.0010296 | 0.0010925 |
| co | 0 | 0 |
| h2o | 0.00044612 | 0.00387 |
| soot | 0 | 0 |
| n2 | -0.024355 | 0.18262 |
| uhc | 0 | 0 |

**Published Steckler values**

| Test | Quantity | CFAST (Validation Guide, digitised) | Measured (Validation Guide, digitised) |
| --- | --- | --- | --- |
| 116 | upper-layer temperature (measured: maximum of the profile) (°C) | 148.7 °C, layer height 1.49 m (printed p. 338, PDF p. 362) | 172.1 °C at 1.88 m (printed p. 338, PDF p. 362) |

Note: The CFAST and measured values in the Steckler tables are digitised from the vector plots of the CFAST Validation Guide (Appendix C.17) by `tools/steckler/digitise.ts`. They are not printed in the Guide, carry a reading uncertainty of about 0.1 °C and 0.01 m, and are not a criterion for any verdict. Temperatures are absolute values in °C. The Guide does not state the time or averaging period of the profiles.

### validation/cases/steckler/Steckler_212.in

Result: **within tolerance**

Closest to the limit: Compartment 1, upper layer Rise (K) at 60 s. CFAST 107.42, model 107.43, ratio of difference to allowed difference 0.0017567 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Compartment 1 | upper layer Rise (K) | 60 | 107.42 | 107.43 | 0.0094353 | 174 | 0 | within tolerance |
| Compartment 1 | lower layer Rise (K) | 90 | 7.2769 | 7.2759 | -0.0010611 | 174 | 0 | within tolerance |
| Compartment 1 | interface height (m) | 60 | 1.2531 | 1.2531 | -0.000032281 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper outflow (kg/s) | 60 | 0.23104 | 0.23106 | 0.000014867 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower inflow (kg/s) | 60 | 0.22453 | 0.22457 | 0.000036087 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower outflow (kg/s) | 70 | 0.00092603 | 0.00092068 | -0.0000053457 | 174 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.0094819 | 0.056287 |
| co2 | 0.001124 | 0.0011905 |
| co | 0 | 0 |
| h2o | 0.00060202 | 0.0033272 |
| soot | 0 | 0 |
| n2 | -0.026272 | 0.19424 |
| uhc | 0 | 0 |

**Published Steckler values**

| Test | Quantity | CFAST (Validation Guide, digitised) | Measured (Validation Guide, digitised) |
| --- | --- | --- | --- |
| 212 | upper-layer temperature (measured: maximum of the profile) (°C) | 155.2 °C, layer height 1.31 m (printed p. 337, PDF p. 361) | 195.6 °C at 1.77 m (printed p. 337, PDF p. 361) |

Note: The CFAST and measured values in the Steckler tables are digitised from the vector plots of the CFAST Validation Guide (Appendix C.17) by `tools/steckler/digitise.ts`. They are not printed in the Guide, carry a reading uncertainty of about 0.1 °C and 0.01 m, and are not a criterion for any verdict. Temperatures are absolute values in °C. The Guide does not state the time or averaging period of the profiles.

### validation/cases/steckler/Steckler_514.in

Result: **within tolerance**

Closest to the limit: Compartment 1, lower layer Rise (K) at 130 s. CFAST 14.535, model 14.531, ratio of difference to allowed difference 0.0021336 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Compartment 1 | upper layer Rise (K) | 90 | 101.08 | 101.09 | 0.0050357 | 174 | 0 | within tolerance |
| Compartment 1 | lower layer Rise (K) | 130 | 14.535 | 14.531 | -0.0042672 | 174 | 0 | within tolerance |
| Compartment 1 | interface height (m) | 60 | 0.73318 | 0.73315 | -0.000030401 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper outflow (kg/s) | 150 | 0.22415 | 0.22415 | -0.0000029769 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower inflow (kg/s) | 60 | 0.19935 | 0.19936 | 0.000011741 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower outflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.0068748 | 0.065093 |
| co2 | 0.00064424 | 0.00085098 |
| co | 0 | 0 |
| h2o | 0.00043574 | 0.0017213 |
| soot | 0 | 0 |
| n2 | -0.019879 | 0.22206 |
| uhc | 0 | 0 |

**Published Steckler values**

| Test | Quantity | CFAST (Validation Guide, digitised) | Measured (Validation Guide, digitised) |
| --- | --- | --- | --- |
| 514 | upper-layer temperature (measured: maximum of the profile) (°C) | 136.2 °C, layer height 0.8 m (printed p. 339, PDF p. 363) | 211 °C at 1.88 m (printed p. 339, PDF p. 363) |

Note: The CFAST and measured values in the Steckler tables are digitised from the vector plots of the CFAST Validation Guide (Appendix C.17) by `tools/steckler/digitise.ts`. They are not printed in the Guide, carry a reading uncertainty of about 0.1 °C and 0.01 m, and are not a criterion for any verdict. Temperatures are absolute values in °C. The Guide does not state the time or averaging period of the profiles.

### validation/cases/steckler/Steckler_517.in

Result: **within tolerance**

Closest to the limit: Compartment 1, upper layer Rise (K) at 60 s. CFAST 70.245, model 70.251, ratio of difference to allowed difference 0.0015384 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Compartment 1 | upper layer Rise (K) | 60 | 70.245 | 70.251 | 0.0054031 | 174 | 0 | within tolerance |
| Compartment 1 | lower layer Rise (K) | 1790 | 10.31 | 10.31 | -0.00017769 | 174 | 0 | within tolerance |
| Compartment 1 | interface height (m) | 60 | 1.2531 | 1.2531 | 0.000012338 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, upper outflow (kg/s) | 70 | 0.42967 | 0.42967 | -0.0000028919 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower inflow (kg/s) | 60 | 0.42471 | 0.42471 | 0.0000030144 | 174 | 0 | within tolerance |
| WallVent_1 | vent flow, lower outflow (kg/s) | 1790 | 0.052469 | 0.052468 | -0.0000016577 | 174 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.007416 | 0.077374 |
| co2 | 0.00072616 | 0.00084263 |
| co | 0 | 0 |
| h2o | 0.00044791 | 0.0025018 |
| soot | 0 | 0 |
| n2 | -0.021292 | 0.26314 |
| uhc | 0 | 0 |

**Published Steckler values**

| Test | Quantity | CFAST (Validation Guide, digitised) | Measured (Validation Guide, digitised) |
| --- | --- | --- | --- |
| 517 | upper-layer temperature (measured: maximum of the profile) (°C) | 96.1 °C, layer height 1.29 m (printed p. 339, PDF p. 363) | 134.7 °C at 1.77 m (printed p. 339, PDF p. 363) |

Note: The CFAST and measured values in the Steckler tables are digitised from the vector plots of the CFAST Validation Guide (Appendix C.17) by `tools/steckler/digitise.ts`. They are not printed in the Guide, carry a reading uncertainty of about 0.1 °C and 0.01 m, and are not a criterion for any verdict. Temperatures are absolute values in °C. The Guide does not state the time or averaging period of the profiles.

### validation/cases/verification/Energy_Balance/sealed_test.in

Result: **within tolerance**

Closest to the limit: Compartment 1, upper layer Rise (K) at 60 s. CFAST 55.677, model 55.677, ratio of difference to allowed difference 0.000015991 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Compartment 1 | upper layer Rise (K) | 60 | 55.677 | 55.677 | -0.000044517 | 84 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

Quantities not compared (Req 13.13, not a failure by itself):

- Compartment 1: lower layer Rise (K). Reason: one-zone CFAST compartment (SHAFT): CFAST 7.7.7 writes only the upper layer for it (outputspreadsheet.f90, "if (.not. roomptr%shaft)" around LLT_ and HGT_), so the reference has no column to compare with.
- Compartment 1: interface height (m). Reason: one-zone CFAST compartment (SHAFT): CFAST 7.7.7 writes only the upper layer for it (outputspreadsheet.f90, "if (.not. roomptr%shaft)" around LLT_ and HGT_), so the reference has no column to compare with.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.59942 | 1.9575 |
| co2 | -0.037863 | 0.037891 |
| co | 0 | 0 |
| h2o | -0.051752 | 0.094839 |
| soot | 0 | 0 |
| n2 | -2.1911 | 6.7379 |
| uhc | 0 | 0 |

### validation/cases/verification/Energy_Balance/sealed_test_2_layers.in

Result: **within tolerance**

Closest to the limit: Compartment 1, lower layer Rise (K) at 320 s. CFAST 285.14, model 285.41, ratio of difference to allowed difference 0.018699 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Compartment 1 | upper layer Rise (K) | 60 | 64.516 | 64.529 | 0.012636 | 84 | 0 | within tolerance |
| Compartment 1 | lower layer Rise (K) | 320 | 285.14 | 285.41 | 0.26659 | 84 | 0 | within tolerance |
| Compartment 1 | interface height (m) | 60 | 1.3908 | 1.3906 | -0.00025619 | 84 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | 0.92945 | 13.323 |
| co2 | -0.57642 | 0.58465 |
| co | 0 | 0 |
| h2o | -0.46904 | 0.92809 |
| soot | 0 | 0 |
| n2 | 0.30534 | 47.45 |
| uhc | 0 | 0 |

### validation/cases/verification/Mass_Balance/species_mass_1.in

Result: **within tolerance**

Closest to the limit: Comp 1, interface height (m) at 360 s. CFAST 0.54806, model 0.54821, ratio of difference to allowed difference 0.0014628 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Comp 1 | upper layer Rise (K) | 360 | 4.5195 | 4.5196 | 0.000081936 | 65 | 0 | within tolerance |
| Comp 1 | lower layer Rise (K) | 1980 | 2.2407 | 2.2407 | 0.0000073302 | 65 | 0 | within tolerance |
| Comp 1 | interface height (m) | 360 | 0.54806 | 0.54821 | 0.00014628 | 65 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.000022486 | 0.42028 |
| co2 | 0.000015735 | 0.00006383 |
| co | 0 | 0 |
| h2o | 0.000012883 | 0.000052259 |
| soot | 0 | 0 |
| n2 | 0.0000013255 | 1.4073 |
| uhc | 0 | 0 |

### validation/cases/verification/Mass_Balance/species_mass_2.in

Result: **outside tolerance**

Reason: 100 time points outside tolerance

Closest to the limit: WallVent_1, vent flow, lower outflow (kg/s) at 630 s. CFAST 0.049075, model 0.036588, ratio of difference to allowed difference 2.4973 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Comp 1 | upper layer Rise (K) | 90 | 1.4519 | 1.4556 | 0.0036509 | 65 | 0 | within tolerance |
| Comp 1 | lower layer Rise (K) | 1770 | 1.8208 | 1.8325 | 0.011694 | 65 | 0 | within tolerance |
| Comp 1 | interface height (m) | 1980 | 2.0385 | 2.2173 | 0.17873 | 65 | 19 | outside tolerance |
| Comp 2 | upper layer Rise (K) | 240 | 1.4225 | 1.424 | 0.0015066 | 65 | 0 | within tolerance |
| Comp 2 | lower layer Rise (K) | 1710 | 1.774 | 1.7893 | 0.015326 | 65 | 0 | within tolerance |
| Comp 2 | interface height (m) | 1980 | 1.6171 | 1.7698 | 0.15276 | 65 | 16 | outside tolerance |
| WallVent_1 | vent flow, upper inflow (kg/s) | 630 | 0.085542 | 0.10451 | 0.018973 | 65 | 12 | outside tolerance |
| WallVent_1 | vent flow, upper outflow (kg/s) | 630 | 0.11372 | 0.09231 | -0.021406 | 65 | 33 | outside tolerance |
| WallVent_1 | vent flow, lower inflow (kg/s) | 630 | 0.077303 | 0.095128 | 0.017825 | 65 | 12 | outside tolerance |
| WallVent_1 | vent flow, lower outflow (kg/s) | 630 | 0.049075 | 0.036588 | -0.012487 | 65 | 8 | outside tolerance |

Each row shows the time of the largest deviation from the allowed difference.

<details>
<summary>All 100 time points outside tolerance</summary>

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) |
| --- | --- | --- | --- | --- | --- |
| Comp 1 | interface height (m) | 1440 | 2.0862 | 2.1904 | 0.10426 |
| Comp 1 | interface height (m) | 1470 | 2.0837 | 2.1938 | 0.11016 |
| Comp 1 | interface height (m) | 1500 | 2.0811 | 2.197 | 0.11583 |
| Comp 1 | interface height (m) | 1530 | 2.0786 | 2.1999 | 0.12127 |
| Comp 1 | interface height (m) | 1560 | 2.076 | 2.2025 | 0.12648 |
| Comp 1 | interface height (m) | 1590 | 2.0735 | 2.2049 | 0.13146 |
| Comp 1 | interface height (m) | 1620 | 2.0709 | 2.2071 | 0.13623 |
| Comp 1 | interface height (m) | 1650 | 2.0683 | 2.2091 | 0.14078 |
| Comp 1 | interface height (m) | 1680 | 2.0657 | 2.2108 | 0.14513 |
| Comp 1 | interface height (m) | 1710 | 2.063 | 2.2123 | 0.14928 |
| Comp 1 | interface height (m) | 1740 | 2.0604 | 2.2136 | 0.15324 |
| Comp 1 | interface height (m) | 1770 | 2.0577 | 2.2147 | 0.15701 |
| Comp 1 | interface height (m) | 1800 | 2.055 | 2.2156 | 0.1606 |
| Comp 1 | interface height (m) | 1830 | 2.0523 | 2.2163 | 0.16402 |
| Comp 1 | interface height (m) | 1860 | 2.0495 | 2.2168 | 0.16727 |
| Comp 1 | interface height (m) | 1890 | 2.0468 | 2.2172 | 0.17036 |
| Comp 1 | interface height (m) | 1920 | 2.0441 | 2.2174 | 0.1733 |
| Comp 1 | interface height (m) | 1950 | 2.0413 | 2.2174 | 0.17609 |
| Comp 1 | interface height (m) | 1980 | 2.0385 | 2.2173 | 0.17873 |
| Comp 2 | interface height (m) | 1530 | 1.5797 | 1.6827 | 0.10301 |
| Comp 2 | interface height (m) | 1560 | 1.5839 | 1.6914 | 0.10745 |
| Comp 2 | interface height (m) | 1590 | 1.5878 | 1.6995 | 0.11171 |
| Comp 2 | interface height (m) | 1620 | 1.5915 | 1.7073 | 0.1158 |
| Comp 2 | interface height (m) | 1650 | 1.5948 | 1.7145 | 0.11971 |
| Comp 2 | interface height (m) | 1680 | 1.5979 | 1.7214 | 0.12346 |
| Comp 2 | interface height (m) | 1710 | 1.6007 | 1.7278 | 0.12704 |
| Comp 2 | interface height (m) | 1740 | 1.6034 | 1.7338 | 0.13047 |
| Comp 2 | interface height (m) | 1770 | 1.6057 | 1.7395 | 0.13374 |
| Comp 2 | interface height (m) | 1800 | 1.6079 | 1.7448 | 0.13686 |
| Comp 2 | interface height (m) | 1830 | 1.6099 | 1.7497 | 0.13984 |
| Comp 2 | interface height (m) | 1860 | 1.6117 | 1.7544 | 0.14268 |
| Comp 2 | interface height (m) | 1890 | 1.6133 | 1.7587 | 0.14539 |
| Comp 2 | interface height (m) | 1920 | 1.6147 | 1.7627 | 0.14797 |
| Comp 2 | interface height (m) | 1950 | 1.616 | 1.7664 | 0.15043 |
| Comp 2 | interface height (m) | 1980 | 1.6171 | 1.7698 | 0.15276 |
| WallVent_1 | vent flow, upper inflow (kg/s) | 510 | 0.12018 | 0.13221 | 0.012027 |
| WallVent_1 | vent flow, upper inflow (kg/s) | 630 | 0.085542 | 0.10451 | 0.018973 |
| WallVent_1 | vent flow, upper inflow (kg/s) | 660 | 0.078747 | 0.089811 | 0.011064 |
| WallVent_1 | vent flow, upper inflow (kg/s) | 690 | 0.07264 | 0.086181 | 0.013541 |
| WallVent_1 | vent flow, upper inflow (kg/s) | 720 | 0.06701 | 0.078744 | 0.011735 |
| WallVent_1 | vent flow, upper inflow (kg/s) | 750 | 0.062232 | 0.07451 | 0.012278 |
| WallVent_1 | vent flow, upper inflow (kg/s) | 990 | 0.036542 | 0.031324 | -0.0052178 |
| WallVent_1 | vent flow, upper inflow (kg/s) | 1050 | 0.032572 | 0.038558 | 0.0059865 |
| WallVent_1 | vent flow, upper inflow (kg/s) | 1080 | 0.03082 | 0.036611 | 0.0057913 |
| WallVent_1 | vent flow, upper inflow (kg/s) | 1110 | 0.029202 | 0.034774 | 0.0055714 |
| WallVent_1 | vent flow, upper inflow (kg/s) | 1140 | 0.027706 | 0.032711 | 0.0050051 |
| WallVent_1 | vent flow, upper inflow (kg/s) | 1170 | 0.026319 | 0.031476 | 0.0051573 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 630 | 0.11372 | 0.09231 | -0.021406 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 660 | 0.10447 | 0.091373 | -0.013096 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 690 | 0.096252 | 0.080309 | -0.015943 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 720 | 0.089107 | 0.074982 | -0.014124 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 750 | 0.082366 | 0.06753 | -0.014836 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 990 | 0.048001 | 0.054758 | 0.0067572 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1050 | 0.042614 | 0.034545 | -0.008069 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1080 | 0.040228 | 0.032017 | -0.0082107 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1110 | 0.03802 | 0.029729 | -0.0082914 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1140 | 0.035973 | 0.028179 | -0.0077947 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1170 | 0.034073 | 0.025846 | -0.0082268 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1200 | 0.032305 | 0.024118 | -0.0081872 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1230 | 0.030658 | 0.02254 | -0.008118 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1260 | 0.029121 | 0.021096 | -0.0080249 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1290 | 0.027686 | 0.019773 | -0.0079129 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1320 | 0.026342 | 0.018557 | -0.0077856 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1350 | 0.025083 | 0.017437 | -0.0076463 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1380 | 0.023903 | 0.016405 | -0.0074979 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1410 | 0.022794 | 0.015451 | -0.0073427 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1440 | 0.021751 | 0.014569 | -0.0071825 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1470 | 0.02077 | 0.013751 | -0.007019 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1500 | 0.019845 | 0.012991 | -0.0068535 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1530 | 0.018972 | 0.012285 | -0.0066871 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1560 | 0.018148 | 0.011628 | -0.0065207 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1590 | 0.01737 | 0.011015 | -0.006355 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1620 | 0.016633 | 0.010443 | -0.0061907 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1650 | 0.015936 | 0.009908 | -0.0060283 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1680 | 0.015276 | 0.0094075 | -0.0058681 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1710 | 0.014649 | 0.0089385 | -0.0057105 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1740 | 0.014054 | 0.0084987 | -0.0055558 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1770 | 0.01349 | 0.0080857 | -0.005404 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1800 | 0.012953 | 0.0076975 | -0.0052554 |
| WallVent_1 | vent flow, upper outflow (kg/s) | 1830 | 0.012442 | 0.0073323 | -0.0051101 |
| WallVent_1 | vent flow, lower inflow (kg/s) | 510 | 0.10784 | 0.12011 | 0.012273 |
| WallVent_1 | vent flow, lower inflow (kg/s) | 630 | 0.077303 | 0.095128 | 0.017825 |
| WallVent_1 | vent flow, lower inflow (kg/s) | 660 | 0.071885 | 0.082088 | 0.010203 |
| WallVent_1 | vent flow, lower inflow (kg/s) | 690 | 0.067033 | 0.079637 | 0.012604 |
| WallVent_1 | vent flow, lower inflow (kg/s) | 720 | 0.062523 | 0.073483 | 0.010961 |
| WallVent_1 | vent flow, lower inflow (kg/s) | 750 | 0.058696 | 0.070198 | 0.011502 |
| WallVent_1 | vent flow, lower inflow (kg/s) | 1050 | 0.033294 | 0.039071 | 0.0057773 |
| WallVent_1 | vent flow, lower inflow (kg/s) | 1080 | 0.031677 | 0.037392 | 0.0057145 |
| WallVent_1 | vent flow, lower inflow (kg/s) | 1110 | 0.030171 | 0.035779 | 0.0056081 |
| WallVent_1 | vent flow, lower inflow (kg/s) | 1140 | 0.028764 | 0.033894 | 0.0051294 |
| WallVent_1 | vent flow, lower inflow (kg/s) | 1170 | 0.02745 | 0.032792 | 0.0053425 |
| WallVent_1 | vent flow, lower inflow (kg/s) | 1200 | 0.026219 | 0.03139 | 0.0051707 |
| WallVent_1 | vent flow, lower outflow (kg/s) | 390 | 0.054359 | 0.047475 | -0.0068833 |
| WallVent_1 | vent flow, lower outflow (kg/s) | 480 | 0.066763 | 0.058933 | -0.0078303 |
| WallVent_1 | vent flow, lower outflow (kg/s) | 510 | 0.063032 | 0.053396 | -0.0096366 |
| WallVent_1 | vent flow, lower outflow (kg/s) | 630 | 0.049075 | 0.036588 | -0.012487 |
| WallVent_1 | vent flow, lower outflow (kg/s) | 660 | 0.046118 | 0.038778 | -0.0073395 |
| WallVent_1 | vent flow, lower outflow (kg/s) | 690 | 0.043382 | 0.034528 | -0.0088536 |
| WallVent_1 | vent flow, lower outflow (kg/s) | 720 | 0.040958 | 0.033235 | -0.0077235 |
| WallVent_1 | vent flow, lower outflow (kg/s) | 750 | 0.038532 | 0.030576 | -0.007956 |

</details>

**Known cause**

Numerics. The model uses a fixed-order BDF2 integrator with the DASSL corrector. A two-step pressure error cycle can survive one scaled Newton iteration on a stale Jacobian (the worst vent flow is at 630 s). A fully converged corrector matched CFAST within 0.0015 kg/s. Future item: port the full DASSL variable-order integrator (design.md).

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | 0.00014502 | 13.483 |
| co2 | -0.00011423 | 0.0040735 |
| co | 0 | 0 |
| h2o | -0.000093519 | 0.003335 |
| soot | 0 | 0 |
| n2 | -0.000070594 | 45.159 |
| uhc | 0 | 0 |

### validation/cases/verification/Mass_Balance/species_mass_3.in

Result: **within tolerance**

Closest to the limit: CeilFloorVent_1, vent flow, lower inflow (kg/s) at 90 s. CFAST 0.085602, model 0.084901, ratio of difference to allowed difference 0.081854 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Comp 1 | upper layer Rise (K) | 120 | 1.7045 | 1.7105 | 0.006054 | 65 | 0 | within tolerance |
| Comp 1 | lower layer Rise (K) | 720 | 1.0609 | 1.0612 | 0.00023534 | 65 | 0 | within tolerance |
| Comp 1 | interface height (m) | 150 | 2.9704 | 2.9742 | 0.0038284 | 65 | 0 | within tolerance |
| Comp 2 | upper layer Rise (K) | 60 | 0.05714 | 0.14387 | 0.086731 | 65 | 0 | within tolerance |
| Comp 2 | lower layer Rise (K) | 780 | 0.88524 | 0.88795 | 0.0027047 | 65 | 0 | within tolerance |
| Comp 2 | interface height (m) | 780 | 0.66093 | 0.6624 | 0.0014704 | 65 | 0 | within tolerance |
| CeilFloorVent_1 | vent flow, upper inflow (kg/s) | 60 | 0 | 0 | 0 | 65 | 0 | within tolerance |
| CeilFloorVent_1 | vent flow, upper outflow (kg/s) | 90 | 0.086276 | 0.085572 | -0.00070351 | 65 | 0 | within tolerance |
| CeilFloorVent_1 | vent flow, lower inflow (kg/s) | 90 | 0.085602 | 0.084901 | -0.00070069 | 65 | 0 | within tolerance |
| CeilFloorVent_1 | vent flow, lower outflow (kg/s) | 1920 | 2.7042e-22 | 2.4892e-15 | 2.4892e-15 | 65 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.000041871 | 0.37598 |
| co2 | 0.000016144 | 0.000097756 |
| co | 0 | 0 |
| h2o | 0.000013218 | 0.000080035 |
| soot | 0 | 0 |
| n2 | -0.000061578 | 1.2592 |
| uhc | 0 | 0 |

### validation/cases/verification/Mass_Balance/species_mass_4.in

Result: **outside tolerance**

Reason: The CFAST-order run (verdict run) was stopped at the 600 s wall-clock limit (Req 13.14). Simulated time reached: 7540 s of 10000 s (time of the last sample). Wall-clock time: 600 s.

No comparison with CFAST was made for this case.

**Known cause**

Numerics. The model uses a fixed-order BDF2 integrator with the DASSL corrector. A two-step pressure error cycle can survive one scaled Newton iteration on a stale Jacobian (at 1300 s the cycle is about ±1.05 mPa on a door pressure difference of 2.8 mPa). A fully converged corrector matched CFAST within 0.0015 kg/s. Future item: port the full DASSL variable-order integrator (design.md). The case also reaches the 600 s wall-clock limit (Req 13.14), at 7540 s of 10000 s simulated time, so no comparison was made.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

Not available: the verdict run was stopped at the wall-clock limit, so this comparison run was not started.

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

Not available: the verdict run was stopped at the wall-clock limit, so this comparison run was not started.

### validation/cases/verification/Ventilation/ventilation_4.in

Result: **within tolerance**

Closest to the limit: Comp 1, upper layer Rise (K) at 200 s. CFAST 247.07, model 246.89, ratio of difference to allowed difference 0.014495 (above 1 is outside tolerance).

| Entity | Quantity | Time (s) | CFAST value | Model value | Difference (model - CFAST) | Points checked | Points outside | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Comp 1 | upper layer Rise (K) | 200 | 247.07 | 246.89 | -0.17907 | 98 | 0 | within tolerance |
| Comp 1 | lower layer Rise (K) | 100 | 8.2863 | 8.3 | 0.013637 | 98 | 0 | within tolerance |
| Comp 1 | interface height (m) | 200 | 3.5928 | 3.5926 | -0.00018268 | 98 | 0 | within tolerance |
| WallVent_1 | vent flow, upper inflow (kg/s) | 100 | 0 | 0 | 0 | 98 | 0 | within tolerance |
| WallVent_1 | vent flow, upper outflow (kg/s) | 200 | 0.66066 | 0.66113 | 0.00047136 | 98 | 0 | within tolerance |
| WallVent_1 | vent flow, lower inflow (kg/s) | 100 | 1.9816 | 1.9828 | 0.0011564 | 98 | 0 | within tolerance |
| WallVent_1 | vent flow, lower outflow (kg/s) | 100 | 0.59317 | 0.59381 | 0.00063924 | 98 | 0 | within tolerance |

Each row shows the time of the largest deviation from the allowed difference.

**CFAST-order run versus intended-order run** (Req 6.13; the verdict above is for the CFAST-order run)

no difference

**CFAST roof-vent outside density versus real ambient density** (Req 5.10; the verdict above is for the CFAST density)

no difference

**Door-jet fires on** (Req 6.14; setting of the CFAST input, used by the verdict run)

**Species synchronisation** (Req 8.10; verdict run): species mass added (+) or removed (-) by rescaling each layer to its gas mass and setting negative masses to 0 after each accepted step (CFAST 7.7.7 compartments.f90, synchronize_species_mass), summed over the run

| Species | Net change (kg) | Sum of absolute changes (kg) |
| --- | --- | --- |
| o2 | -0.018149 | 0.52025 |
| co2 | -0.00039006 | 0.004031 |
| co | 0 | 0 |
| h2o | -0.00031935 | 0.0033003 |
| soot | 0 | 0 |
| n2 | -0.062657 | 1.7613 |
| uhc | 0 | 0 |
