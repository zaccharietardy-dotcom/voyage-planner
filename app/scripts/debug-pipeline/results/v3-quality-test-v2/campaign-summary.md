# Campaign Summary — v3-quality-test-v2

- Started: 2026-02-23T13:22:22.333Z
- Finished: 2026-02-23T13:26:10.700Z
- Duration: 228.4s
- Seed: 424242
- Runs: 5 (5 success / 0 failed)

## Acceptance Criteria
- Success rate >= 90%: PASS (100.0%)
- No API key leak: PASS (0)
- No hotel boundary incoherent: PASS (0)
- Urban leg policy clean: FAIL (58)
- Average score >= 85: FAIL (84.0)
- No critical remaining: FAIL (45)
- Overall: FAIL

## Score Stats
- Average: 84.0
- Min/Max: 75.0 / 96.0
- P50/P90: 80.0 / 96.0

| Section | Avg Score |
|---|---:|
| schedule | 96.6 |
| geography | 27.4 |
| budget | 96.2 |
| links | 91.4 |
| dataQuality | 88.0 |
| rhythm | 98.6 |
| relevance | 94.0 |
| realism | 94.4 |

## Top Regressions
| Severity | Code | Count | Component | Affected Runs |
|---|---|---:|---|---:|
| critical | GEO_URBAN_HARD_LONG_LEG | 38 | pipeline/step8-validate | 4 |
| critical | GEO_IMPOSSIBLE_TRANSITION | 5 | pipeline/step8-validate | 2 |
| critical | schedule:Jour 7: "Parc Kitanomaru" planifié à 04:20 — heure impossible | 1 | unknown | 1 |
| critical | relevance:Must-see manquants (1/3): mont fuji, sanctuaire fushimi inari | 1 | unknown | 1 |
| warning | GEO_URBAN_TOO_MANY_LONG_LEGS | 20 | pipeline/step8-validate | 4 |
| warning | GEO_INTRA_DAY_ZIGZAG | 19 | pipeline/step8-validate | 5 |
| warning | GEO_DAY_ROUTE_EFFICIENCY_LOW | 15 | pipeline/step8-validate | 5 |
| warning | GEO_VERY_LONG_DAY_LEG | 5 | pipeline/geography | 2 |
| warning | budget:Pas de costBreakdown dans le trip | 5 | unknown | 5 |
| warning | data-quality:Pas de breakdown des coûts | 5 | unknown | 5 |
| warning | relevance:Activité "gastronomy" demandée mais aucune activité correspondante tro | 1 | unknown | 1 |
| warning | budget:Pas d'hébergement défini dans le voyage | 1 | unknown | 1 |
| warning | data-quality:Pas d'hébergement défini | 1 | unknown | 1 |
| warning | relevance:Must-see manquants (0/1): sagrada familia | 1 | unknown | 1 |
| warning | relevance:Activité "adventure" demandée mais aucune activité correspondante trou | 1 | unknown | 1 |
| warning | realism:Jour 1: restaurant "Teppan Baby" à 8.9km de l'activité précédente ("Sa | 1 | unknown | 1 |
| warning | realism:Jour 3: restaurant "Gyukatsu Ichinisan" à 7.2km de l'activité précéden | 1 | unknown | 1 |
| warning | realism:Jour 7: restaurant "Shinjuku Sushi Hatsume" à 17.8km de l'activité pré | 1 | unknown | 1 |
| warning | realism:Jour 11: restaurant "Teppan Baby" à 8.9km de l'activité précédente ("A | 1 | unknown | 1 |
| warning | geography:Jour 4: "Anima (André Heller Garden)" est à 30.2km du centre — trop lo | 1 | unknown | 1 |

## Stratification
- groupType: {"solo":2,"couple":2,"friends":1,"family_with_kids":0,"family_without_kids":0}
- budgetLevel: {"economic":2,"moderate":1,"comfort":1,"luxury":1}
- transport: {"optimal":3,"plane":1,"train":1,"car":0,"bus":0}
- multiCityRuns: 0

## Failed Runs
- none
