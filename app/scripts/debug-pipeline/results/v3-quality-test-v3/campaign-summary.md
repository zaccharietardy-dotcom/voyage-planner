# Campaign Summary — v3-quality-test-v3

- Started: 2026-02-23T14:08:47.624Z
- Finished: 2026-02-23T14:11:44.687Z
- Duration: 177.1s
- Seed: 424242
- Runs: 5 (5 success / 0 failed)

## Acceptance Criteria
- Success rate >= 90%: PASS (100.0%)
- No API key leak: PASS (0)
- No hotel boundary incoherent: PASS (0)
- Urban leg policy clean: FAIL (54)
- Average score >= 85: FAIL (84.6)
- No critical remaining: FAIL (41)
- Overall: FAIL

## Score Stats
- Average: 84.6
- Min/Max: 76.0 / 96.0
- P50/P90: 82.0 / 96.0

| Section | Avg Score |
|---|---:|
| schedule | 98.0 |
| geography | 29.2 |
| budget | 96.2 |
| links | 91.2 |
| dataQuality | 88.6 |
| rhythm | 99.0 |
| relevance | 95.2 |
| realism | 95.0 |

## Top Regressions
| Severity | Code | Count | Component | Affected Runs |
|---|---|---:|---|---:|
| critical | GEO_URBAN_HARD_LONG_LEG | 35 | pipeline/step8-validate | 4 |
| critical | GEO_IMPOSSIBLE_TRANSITION | 6 | pipeline/step8-validate | 2 |
| warning | GEO_INTRA_DAY_ZIGZAG | 22 | pipeline/step8-validate | 5 |
| warning | GEO_URBAN_TOO_MANY_LONG_LEGS | 19 | pipeline/step8-validate | 4 |
| warning | GEO_DAY_ROUTE_EFFICIENCY_LOW | 17 | pipeline/step8-validate | 5 |
| warning | GEO_VERY_LONG_DAY_LEG | 6 | pipeline/geography | 2 |
| warning | budget:Pas de costBreakdown dans le trip | 5 | unknown | 5 |
| warning | data-quality:Pas de breakdown des coûts | 5 | unknown | 5 |
| warning | relevance:Activité "gastronomy" demandée mais aucune activité correspondante tro | 2 | unknown | 2 |
| warning | budget:Pas d'hébergement défini dans le voyage | 1 | unknown | 1 |
| warning | data-quality:Pas d'hébergement défini | 1 | unknown | 1 |
| warning | relevance:Must-see manquants (0/1): sagrada familia | 1 | unknown | 1 |
| warning | geography:Jour 7: "Splash Tokyo" est à 52.5km du centre — trop loin ? | 1 | unknown | 1 |
| warning | geography:Jour 7: "Mont Fuji" est à 99.2km du centre — trop loin ? | 1 | unknown | 1 |
| warning | relevance:Must-see manquants (2/3): sanctuaire fushimi inari | 1 | unknown | 1 |
| warning | relevance:Activité "adventure" demandée mais aucune activité correspondante trou | 1 | unknown | 1 |
| warning | realism:Jour 1: restaurant "Fūunji Shinjuku" à 9.0km de l'activité précédente  | 1 | unknown | 1 |
| warning | realism:Jour 2: restaurant "Gyukatsu Ichinisan" à 13.3km de l'activité précéde | 1 | unknown | 1 |
| warning | realism:Jour 4: restaurant "GYOPAO Gyoza Roppongi" à 5.4km de l'activité précé | 1 | unknown | 1 |
| warning | realism:Jour 7: restaurant "Shinjuku Sushi Hatsume" à 17.8km de l'activité pré | 1 | unknown | 1 |

## Stratification
- groupType: {"solo":2,"couple":2,"friends":1,"family_with_kids":0,"family_without_kids":0}
- budgetLevel: {"economic":2,"moderate":1,"comfort":1,"luxury":1}
- transport: {"optimal":3,"plane":1,"train":1,"car":0,"bus":0}
- multiCityRuns: 0

## Failed Runs
- none
