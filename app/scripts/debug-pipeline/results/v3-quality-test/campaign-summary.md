# Campaign Summary — v3-quality-test

- Started: 2026-02-23T11:55:16.866Z
- Finished: 2026-02-23T12:00:42.958Z
- Duration: 326.1s
- Seed: 424242
- Runs: 5 (5 success / 0 failed)

## Acceptance Criteria
- Success rate >= 90%: PASS (100.0%)
- No API key leak: PASS (0)
- No hotel boundary incoherent: PASS (0)
- Urban leg policy clean: FAIL (15)
- Average score >= 85: PASS (86.0)
- No critical remaining: FAIL (17)
- Overall: FAIL

## Score Stats
- Average: 86.0
- Min/Max: 74.0 / 97.0
- P50/P90: 91.0 / 97.0

| Section | Avg Score |
|---|---:|
| schedule | 89.2 |
| geography | 48.2 |
| budget | 96.2 |
| links | 89.8 |
| dataQuality | 86.2 |
| rhythm | 97.0 |
| relevance | 93.2 |
| realism | 99.4 |

## Top Regressions
| Severity | Code | Count | Component | Affected Runs |
|---|---|---:|---|---:|
| critical | GEO_URBAN_HARD_LONG_LEG | 9 | pipeline/step8-validate | 2 |
| critical | GEO_IMPOSSIBLE_TRANSITION | 2 | pipeline/step8-validate | 2 |
| critical | schedule:Jour 4: "Fushimi Sanpō Inari-jinja" (fin 21:35) chevauche "GYOPAO Gyoz | 1 | unknown | 1 |
| critical | schedule:Jour 7: "Tokyo Disneyland" (fin 17:25) chevauche "Sayama Nature Park"  | 1 | unknown | 1 |
| critical | relevance:Must-see manquants (1/3): mont fuji, sanctuaire fushimi inari | 1 | unknown | 1 |
| critical | schedule:Jour 1: "Musée Dar El Bacha" (fin 11:30) chevauche "Palais de la Bahia | 1 | unknown | 1 |
| critical | schedule:Jour 1: "Le Jardin Secret Médina Marrakech" (fin 13:10) chevauche "Med | 1 | unknown | 1 |
| critical | schedule:Jour 6: "La fontaine des épices" (fin 09:15) chevauche "Bab Aghmat" (d | 1 | unknown | 1 |
| warning | GEO_INTRA_DAY_ZIGZAG | 17 | pipeline/step8-validate | 4 |
| warning | GEO_DAY_ROUTE_EFFICIENCY_LOW | 8 | pipeline/step8-validate | 4 |
| warning | GEO_URBAN_TOO_MANY_LONG_LEGS | 6 | pipeline/step8-validate | 3 |
| warning | budget:Pas de costBreakdown dans le trip | 5 | unknown | 5 |
| warning | data-quality:Pas de breakdown des coûts | 5 | unknown | 5 |
| warning | GEO_VERY_LONG_DAY_LEG | 4 | pipeline/geography | 2 |
| warning | relevance:Activité "gastronomy" demandée mais aucune activité correspondante tro | 3 | unknown | 3 |
| warning | rhythm:Jour 2: 10 activités/restaurants — journée surchargée | 1 | unknown | 1 |
| warning | budget:Pas d'hébergement défini dans le voyage | 1 | unknown | 1 |
| warning | data-quality:Pas d'hébergement défini | 1 | unknown | 1 |
| warning | relevance:Must-see manquants (0/1): sagrada familia | 1 | unknown | 1 |
| warning | geography:Jour 7: "Splash Tokyo" est à 52.3km du centre — trop loin ? | 1 | unknown | 1 |

## Stratification
- groupType: {"solo":2,"couple":2,"friends":1,"family_with_kids":0,"family_without_kids":0}
- budgetLevel: {"economic":2,"moderate":1,"comfort":1,"luxury":1}
- transport: {"optimal":3,"plane":1,"train":1,"car":0,"bus":0}
- multiCityRuns: 0

## Failed Runs
- none
