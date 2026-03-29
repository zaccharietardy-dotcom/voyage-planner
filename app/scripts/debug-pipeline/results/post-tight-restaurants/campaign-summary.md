# Campaign Summary — post-tight-restaurants

- Started: 2026-03-19T23:19:03.195Z
- Finished: 2026-03-19T23:19:09.101Z
- Duration: 5.9s
- Seed: 424242
- Runs: 4 (4 success / 0 failed)

## Acceptance Criteria
- Success rate >= 90%: PASS (100.0%)
- No API key leak: PASS (0)
- No hotel boundary incoherent: PASS (0)
- Urban leg policy clean: FAIL (2)
- Average score >= 85: PASS (93.5)
- No critical remaining: FAIL (3)
- Hard gates zero (GEO_IMPOSSIBLE/URBAN_HARD): FAIL (1)
- Overall: FAIL

## Score Stats
- Average: 93.5
- Min/Max: 92.0 / 95.0
- P50/P90: 92.0 / 95.0

| Section | Avg Score |
|---|---:|
| schedule | 97.5 |
| geography | 75.5 |
| budget | 95.0 |
| links | 99.5 |
| dataQuality | 92.8 |
| rhythm | 99.0 |
| relevance | 94.8 |
| realism | 98.5 |

## Top Regressions
| Severity | Code | Count | Component | Affected Runs |
|---|---|---:|---|---:|
| critical | GEO_IMPOSSIBLE_TRANSITION | 1 | pipeline/step8-validate | 1 |
| critical | schedule:Jour 5: "basilique Saint-Pierre" (fin 17:05) chevauche "Rome → Paris"  | 1 | unknown | 1 |
| critical | relevance:Must-see manquants (0/2): pompei, spaccanapoli | 1 | unknown | 1 |
| warning | GEO_INTRA_DAY_ZIGZAG | 8 | pipeline/step8-validate | 4 |
| warning | budget:Pas de costBreakdown dans le trip | 4 | unknown | 4 |
| warning | data-quality:Pas de breakdown des coûts | 4 | unknown | 4 |
| warning | GEO_DAY_ROUTE_EFFICIENCY_LOW | 3 | pipeline/step8-validate | 3 |
| warning | GEO_URBAN_TOO_MANY_LONG_LEGS | 2 | pipeline/step8-validate | 2 |
| warning | budget:Pas d'hébergement défini dans le voyage | 2 | unknown | 2 |
| warning | data-quality:Pas d'hébergement défini | 2 | unknown | 2 |
| warning | relevance:Activité "gastronomy" demandée mais aucune activité correspondante tro | 2 | unknown | 2 |
| warning | rhythm:Jour 3: seulement 55min de temps libre — pas de pause | 1 | unknown | 1 |
| warning | relevance:Must-see manquants (1/2): mont fuji | 1 | unknown | 1 |
| warning | realism:Dernier jour: dernière activité (16:20) à seulement 40min avant le vol | 1 | unknown | 1 |
| warning | realism:Jour 2: restaurant "Déjeuner — Zi Teresa" à 5.6km de l'activité précéd | 1 | unknown | 1 |
| info | data-quality:Pas d'empreinte carbone calculée | 4 | unknown | 4 |
| info | data-quality:Pas de conseils de voyage | 4 | unknown | 4 |
| info | data-quality:Pas de vol aller défini (transport optimal/avion) | 3 | unknown | 3 |
| info | LINK_RESTAURANT_MAPS_MISSING | 2 | pipeline/restaurants | 2 |
| info | relevance:Tous les must-see présents (2/2) | 1 | unknown | 1 |

## Stratification
- groupType: {"solo":0,"couple":4,"friends":0,"family_with_kids":0,"family_without_kids":0}
- budgetLevel: {"economic":0,"moderate":3,"comfort":1,"luxury":0}
- transport: {"optimal":2,"plane":2,"train":0,"car":0,"bus":0}
- multiCityRuns: 0

## Failed Runs
- none
