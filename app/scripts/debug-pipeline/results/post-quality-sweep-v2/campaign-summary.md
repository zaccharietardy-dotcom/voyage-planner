# Campaign Summary — post-quality-sweep-v2

- Started: 2026-03-19T16:20:12.882Z
- Finished: 2026-03-19T16:20:24.971Z
- Duration: 12.1s
- Seed: 424242
- Runs: 4 (4 success / 0 failed)

## Acceptance Criteria
- Success rate >= 90%: PASS (100.0%)
- No API key leak: PASS (0)
- No hotel boundary incoherent: PASS (0)
- Urban leg policy clean: FAIL (2)
- Average score >= 85: PASS (92.5)
- No critical remaining: FAIL (4)
- Hard gates zero (GEO_IMPOSSIBLE/URBAN_HARD): FAIL (1)
- Overall: FAIL

## Score Stats
- Average: 92.5
- Min/Max: 91.0 / 94.0
- P50/P90: 92.0 / 94.0

| Section | Avg Score |
|---|---:|
| schedule | 95.0 |
| geography | 72.5 |
| budget | 95.0 |
| links | 99.8 |
| dataQuality | 92.8 |
| rhythm | 97.5 |
| relevance | 94.8 |
| realism | 98.5 |

## Top Regressions
| Severity | Code | Count | Component | Affected Runs |
|---|---|---:|---|---:|
| critical | GEO_IMPOSSIBLE_TRANSITION | 1 | pipeline/step8-validate | 1 |
| critical | schedule:Jour 4: "musées du Vatican" (fin 17:20) chevauche "Rome → Paris" (débu | 1 | unknown | 1 |
| critical | schedule:Jour 5: "basilique Saint-Pierre" (fin 17:50) chevauche "Rome → Paris"  | 1 | unknown | 1 |
| critical | relevance:Must-see manquants (0/2): pompei, spaccanapoli | 1 | unknown | 1 |
| warning | GEO_INTRA_DAY_ZIGZAG | 10 | pipeline/step8-validate | 4 |
| warning | budget:Pas de costBreakdown dans le trip | 4 | unknown | 4 |
| warning | data-quality:Pas de breakdown des coûts | 4 | unknown | 4 |
| warning | GEO_DAY_ROUTE_EFFICIENCY_LOW | 3 | pipeline/step8-validate | 2 |
| warning | GEO_URBAN_TOO_MANY_LONG_LEGS | 2 | pipeline/step8-validate | 2 |
| warning | budget:Pas d'hébergement défini dans le voyage | 2 | unknown | 2 |
| warning | data-quality:Pas d'hébergement défini | 2 | unknown | 2 |
| warning | relevance:Activité "gastronomy" demandée mais aucune activité correspondante tro | 2 | unknown | 2 |
| warning | rhythm:Jour 4: seulement 30min de temps libre — pas de pause | 1 | unknown | 1 |
| warning | rhythm:Jour 1: seulement 55min de temps libre — pas de pause | 1 | unknown | 1 |
| warning | rhythm:Jour 3: seulement 55min de temps libre — pas de pause | 1 | unknown | 1 |
| warning | relevance:Must-see manquants (1/2): mont fuji | 1 | unknown | 1 |
| warning | realism:Dernier jour: dernière activité (16:20) à seulement 40min avant le vol | 1 | unknown | 1 |
| warning | realism:Jour 2: restaurant "Déjeuner — Rosolino Ristorante" à 5.8km de l'activ | 1 | unknown | 1 |
| info | data-quality:Pas d'empreinte carbone calculée | 4 | unknown | 4 |
| info | data-quality:Pas de conseils de voyage | 4 | unknown | 4 |

## Stratification
- groupType: {"solo":0,"couple":4,"friends":0,"family_with_kids":0,"family_without_kids":0}
- budgetLevel: {"economic":0,"moderate":3,"comfort":1,"luxury":0}
- transport: {"optimal":2,"plane":2,"train":0,"car":0,"bus":0}
- multiCityRuns: 0

## Failed Runs
- none
