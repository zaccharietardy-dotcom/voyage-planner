# Campaign Summary — smoke-s01-v5

- Started: 2026-02-14T22:36:47.212Z
- Finished: 2026-02-14T22:37:47.940Z
- Duration: 60.7s
- Seed: 1337
- Runs: 1 (1 success / 0 failed)

## Acceptance Criteria
- Success rate >= 90%: PASS (100.0%)
- No API key leak: PASS (0)
- No hotel boundary incoherent: PASS (0)
- Urban leg policy clean: PASS (0)
- Average score >= 85: PASS (93.0)
- No critical remaining: FAIL (3)
- Overall: FAIL

## Score Stats
- Average: 93.0
- Min/Max: 93.0 / 93.0
- P50/P90: 93.0 / 93.0

| Section | Avg Score |
|---|---:|
| schedule | 99.0 |
| geography | 73.0 |
| budget | 97.0 |
| links | 100.0 |
| dataQuality | 98.0 |
| rhythm | 99.0 |
| relevance | 90.0 |
| realism | 93.0 |

## Top Regressions
| Severity | Code | Count | Component | Affected Runs |
|---|---|---:|---|---:|
| critical | geography:Jour 1: "Vol U2 4813" a des coordonnées (0, 0) — non géocodé | 1 | unknown | 1 |
| critical | geography:Jour 4: "Vol U2 4816" a des coordonnées (0, 0) — non géocodé | 1 | unknown | 1 |
| critical | relevance:Must-see manquants (1/2): colisée | 1 | unknown | 1 |
| warning | geography:Jour 1: restaurant "Déjeuner — ADESSO Osteria Moderna" est à 15.4km du | 1 | unknown | 1 |
| warning | geography:Jour 1: restaurant "Dîner — La locanda del tempio" est à 15.4km du cen | 1 | unknown | 1 |
| warning | budget:Jour 4: restaurant "Petit-déjeuner à l'hôtel" a un coût de 0€ | 1 | unknown | 1 |
| warning | realism:Jour 1: restaurant "Déjeuner — ADESSO Osteria Moderna" à 15.4km de l'a | 1 | unknown | 1 |
| warning | realism:Jour 2: restaurant "Petit-déjeuner — TE cioccolateria - TE Caffè" à 14 | 1 | unknown | 1 |
| info | DATA_ACTIVITY_DESCRIPTION_MISSING | 2 | pipeline/content | 1 |
| info | schedule:Jour 4: 5h de vide entre "Check-out Annie's Home" (fin 10:00) et "Vol  | 1 | unknown | 1 |
| info | data-quality:Pas d'empreinte carbone calculée | 1 | unknown | 1 |
| info | rhythm:Jour 3 (5 activités) vs jour 4 (1 activités) — déséquilibre important | 1 | unknown | 1 |

## Stratification
- groupType: {"solo":0,"couple":1,"friends":0,"family_with_kids":0,"family_without_kids":0}
- budgetLevel: {"economic":0,"moderate":1,"comfort":0,"luxury":0}
- transport: {"optimal":1,"plane":0,"train":0,"car":0,"bus":0}
- multiCityRuns: 0

## Failed Runs
- none
