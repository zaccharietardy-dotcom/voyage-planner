# Campaign Summary — post-p02-fix

- Started: 2026-03-19T09:19:51.569Z
- Finished: 2026-03-19T09:32:34.744Z
- Duration: 763.2s
- Seed: 424242
- Runs: 4 (4 success / 0 failed)

## Acceptance Criteria
- Success rate >= 90%: PASS (100.0%)
- No API key leak: PASS (0)
- No hotel boundary incoherent: PASS (0)
- Urban leg policy clean: FAIL (18)
- Average score >= 85: FAIL (84.0)
- No critical remaining: FAIL (28)
- Hard gates zero (GEO_IMPOSSIBLE/URBAN_HARD): FAIL (26)
- Overall: FAIL

## Score Stats
- Average: 84.0
- Min/Max: 80.0 / 94.0
- P50/P90: 80.0 / 94.0

| Section | Avg Score |
|---|---:|
| schedule | 95.0 |
| geography | 19.0 |
| budget | 94.0 |
| links | 99.3 |
| dataQuality | 94.5 |
| rhythm | 96.0 |
| relevance | 95.5 |
| realism | 93.8 |

## Top Regressions
| Severity | Code | Count | Component | Affected Runs |
|---|---|---:|---|---:|
| critical | GEO_IMPOSSIBLE_TRANSITION | 13 | pipeline/step8-validate | 3 |
| critical | GEO_URBAN_HARD_LONG_LEG | 13 | pipeline/step8-validate | 3 |
| critical | schedule:Jour 7: "HND → CDG" (fin 13:35) chevauche "Check-out — THE KNOT TOKYO  | 1 | unknown | 1 |
| critical | schedule:Jour 3: "NAP → LYS" (fin 08:55) chevauche "Check-out — Napoli Central  | 1 | unknown | 1 |
| warning | GEO_INTRA_DAY_ZIGZAG | 9 | pipeline/step8-validate | 4 |
| warning | GEO_DAY_ROUTE_EFFICIENCY_LOW | 6 | pipeline/step8-validate | 4 |
| warning | GEO_URBAN_TOO_MANY_LONG_LEGS | 5 | pipeline/step8-validate | 3 |
| warning | budget:Pas de costBreakdown dans le trip | 4 | unknown | 4 |
| warning | data-quality:Pas de breakdown des coûts | 4 | unknown | 4 |
| warning | relevance:Activité "gastronomy" demandée mais aucune activité correspondante tro | 3 | unknown | 3 |
| warning | GEO_VERY_LONG_DAY_LEG | 2 | pipeline/geography | 1 |
| warning | GEO_LONG_LEG_OK | 2 | pipeline/step8-validate | 2 |
| warning | geography:Jour 2: restaurant "Déjeuner — Pastasciutta" est à 16.2km du centre | 1 | unknown | 1 |
| warning | geography:Jour 2: restaurant "Dîner — Ristorante Pizzeria Castello" est à 15.9km | 1 | unknown | 1 |
| warning | budget:Jour 3: restaurant "Dîner — Repas libre" a un coût de 0€ | 1 | unknown | 1 |
| warning | rhythm:Jour 3: seulement 55min de temps libre — pas de pause | 1 | unknown | 1 |
| warning | realism:Jour 3: restaurant "Déjeuner — La Nuova Piazzetta" à 12.2km de l'activ | 1 | unknown | 1 |
| warning | realism:Jour 3: restaurant "Dîner — Repas libre" à 10.9km de l'activité précéd | 1 | unknown | 1 |
| warning | rhythm:Jour 3: seulement 35min de temps libre — pas de pause | 1 | unknown | 1 |
| warning | geography:Jour 3: restaurant "Déjeuner — Rainforest Cafe" est à 18.9km du centre | 1 | unknown | 1 |

## Stratification
- groupType: {"solo":0,"couple":4,"friends":0,"family_with_kids":0,"family_without_kids":0}
- budgetLevel: {"economic":0,"moderate":3,"comfort":1,"luxury":0}
- transport: {"optimal":2,"plane":2,"train":0,"car":0,"bus":0}
- multiCityRuns: 0

## Failed Runs
- none
