# Campaign Summary — capture-fixtures

- Started: 2026-03-19T10:06:53.120Z
- Finished: 2026-03-19T10:19:47.451Z
- Duration: 774.3s
- Seed: 424242
- Runs: 4 (4 success / 0 failed)

## Acceptance Criteria
- Success rate >= 90%: PASS (100.0%)
- No API key leak: PASS (0)
- No hotel boundary incoherent: PASS (0)
- Urban leg policy clean: FAIL (4)
- Average score >= 85: PASS (89.5)
- No critical remaining: FAIL (6)
- Hard gates zero (GEO_IMPOSSIBLE/URBAN_HARD): FAIL (5)
- Overall: FAIL

## Score Stats
- Average: 89.5
- Min/Max: 84.0 / 96.0
- P50/P90: 86.0 / 96.0

| Section | Avg Score |
|---|---:|
| schedule | 100.0 |
| geography | 48.8 |
| budget | 96.0 |
| links | 99.3 |
| dataQuality | 94.3 |
| rhythm | 96.8 |
| relevance | 93.8 |
| realism | 96.0 |

## Top Regressions
| Severity | Code | Count | Component | Affected Runs |
|---|---|---:|---|---:|
| critical | GEO_IMPOSSIBLE_TRANSITION | 5 | pipeline/step8-validate | 2 |
| critical | relevance:Must-see manquants (0/2): mont fuji, sanctuaire meiji | 1 | unknown | 1 |
| warning | GEO_INTRA_DAY_ZIGZAG | 6 | pipeline/step8-validate | 4 |
| warning | GEO_DAY_ROUTE_EFFICIENCY_LOW | 5 | pipeline/step8-validate | 4 |
| warning | GEO_VERY_LONG_DAY_LEG | 4 | pipeline/geography | 2 |
| warning | GEO_URBAN_TOO_MANY_LONG_LEGS | 4 | pipeline/step8-validate | 3 |
| warning | budget:Pas de costBreakdown dans le trip | 4 | unknown | 4 |
| warning | data-quality:Pas de breakdown des coûts | 4 | unknown | 4 |
| warning | relevance:Activité "gastronomy" demandée mais aucune activité correspondante tro | 3 | unknown | 3 |
| warning | GEO_LONG_LEG_OK | 1 | pipeline/step8-validate | 1 |
| warning | realism:Jour 1: restaurant "Dîner — Alla Rampa" à 24.5km de l'activité précéde | 1 | unknown | 1 |
| warning | budget:Pas d'hébergement défini dans le voyage | 1 | unknown | 1 |
| warning | data-quality:Pas d'hébergement défini | 1 | unknown | 1 |
| warning | rhythm:Jour 3: seulement 55min de temps libre — pas de pause | 1 | unknown | 1 |
| warning | rhythm:Jour 6: seulement 55min de temps libre — pas de pause | 1 | unknown | 1 |
| warning | realism:Jour 6: 12h d'activités continues sans pause ≥30min | 1 | unknown | 1 |
| warning | rhythm:Jour 2: seulement 50min de temps libre — pas de pause | 1 | unknown | 1 |
| warning | relevance:Must-see manquants (1/2): spaccanapoli | 1 | unknown | 1 |
| warning | realism:Jour 1: restaurant "Dîner — Gino e Toto Sorbillo" à 6.8km de l'activit | 1 | unknown | 1 |
| warning | realism:Jour 2: restaurant "Déjeuner — L'Antica Pizzeria da Michele" à 23.2km  | 1 | unknown | 1 |

## Stratification
- groupType: {"solo":0,"couple":4,"friends":0,"family_with_kids":0,"family_without_kids":0}
- budgetLevel: {"economic":0,"moderate":3,"comfort":1,"luxury":0}
- transport: {"optimal":2,"plane":2,"train":0,"car":0,"bus":0}
- multiCityRuns: 0

## Failed Runs
- none
