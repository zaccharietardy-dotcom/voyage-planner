# Campaign Summary — v3-quality-test-v4

- Started: 2026-02-23T14:28:53.870Z
- Finished: 2026-02-23T14:34:30.171Z
- Duration: 336.3s
- Seed: 424242
- Runs: 5 (5 success / 0 failed)

## Acceptance Criteria
- Success rate >= 90%: PASS (100.0%)
- No API key leak: PASS (0)
- No hotel boundary incoherent: PASS (0)
- Urban leg policy clean: FAIL (22)
- Average score >= 85: PASS (86.8)
- No critical remaining: FAIL (14)
- Overall: FAIL

## Score Stats
- Average: 86.8
- Min/Max: 74.0 / 96.0
- P50/P90: 87.0 / 96.0

| Section | Avg Score |
|---|---:|
| schedule | 98.2 |
| geography | 46.8 |
| budget | 96.2 |
| links | 91.8 |
| dataQuality | 87.4 |
| rhythm | 97.6 |
| relevance | 94.6 |
| realism | 93.6 |

## Top Regressions
| Severity | Code | Count | Component | Affected Runs |
|---|---|---:|---|---:|
| critical | GEO_IMPOSSIBLE_TRANSITION | 7 | pipeline/step8-validate | 1 |
| critical | GEO_URBAN_HARD_LONG_LEG | 7 | pipeline/step8-validate | 1 |
| warning | GEO_INTRA_DAY_ZIGZAG | 19 | pipeline/step8-validate | 5 |
| warning | GEO_URBAN_TOO_MANY_LONG_LEGS | 15 | pipeline/step8-validate | 4 |
| warning | GEO_DAY_ROUTE_EFFICIENCY_LOW | 14 | pipeline/step8-validate | 5 |
| warning | GEO_VERY_LONG_DAY_LEG | 7 | pipeline/geography | 2 |
| warning | budget:Pas de costBreakdown dans le trip | 5 | unknown | 5 |
| warning | data-quality:Pas de breakdown des coûts | 5 | unknown | 5 |
| warning | GEO_LONG_LEG_OK | 4 | pipeline/step8-validate | 2 |
| warning | relevance:Activité "gastronomy" demandée mais aucune activité correspondante tro | 3 | unknown | 3 |
| warning | rhythm:Jour 2: 9 activités/restaurants — journée surchargée | 2 | unknown | 2 |
| warning | budget:Pas d'hébergement défini dans le voyage | 1 | unknown | 1 |
| warning | data-quality:Pas d'hébergement défini | 1 | unknown | 1 |
| warning | relevance:Must-see manquants (0/1): sagrada familia | 1 | unknown | 1 |
| warning | geography:Jour 2: "Mont Fuji" est à 96.1km du centre — trop loin ? | 1 | unknown | 1 |
| warning | geography:Jour 7: "Splash Tokyo" est à 52.3km du centre — trop loin ? | 1 | unknown | 1 |
| warning | rhythm:Jour 11: 9 activités/restaurants — journée surchargée | 1 | unknown | 1 |
| warning | relevance:Must-see manquants (2/3): sanctuaire fushimi inari | 1 | unknown | 1 |
| warning | relevance:Activité "adventure" demandée mais aucune activité correspondante trou | 1 | unknown | 1 |
| warning | realism:Jour 1: restaurant "Fūunji Shinjuku" à 17.7km de l'activité précédente | 1 | unknown | 1 |

## Stratification
- groupType: {"solo":2,"couple":2,"friends":1,"family_with_kids":0,"family_without_kids":0}
- budgetLevel: {"economic":2,"moderate":1,"comfort":1,"luxury":1}
- transport: {"optimal":3,"plane":1,"train":1,"car":0,"bus":0}
- multiCityRuns: 0

## Failed Runs
- none
