# Campaign Summary — smoke-campaign-v7

- Started: 2026-02-14T22:42:28.749Z
- Finished: 2026-02-14T22:44:34.064Z
- Duration: 125.3s
- Seed: 1337
- Runs: 2 (2 success / 0 failed)

## Acceptance Criteria
- Success rate >= 90%: PASS (100.0%)
- No API key leak: PASS (0)
- No hotel boundary incoherent: PASS (0)
- Urban leg policy clean: PASS (0)
- Average score >= 85: PASS (98.0)
- No critical remaining: PASS (0)
- Overall: PASS

## Score Stats
- Average: 98.0
- Min/Max: 97.0 / 99.0
- P50/P90: 97.0 / 99.0

| Section | Avg Score |
|---|---:|
| schedule | 99.0 |
| geography | 96.5 |
| budget | 97.0 |
| links | 100.0 |
| dataQuality | 98.0 |
| rhythm | 97.5 |
| relevance | 97.0 |
| realism | 98.5 |

## Top Regressions
| Severity | Code | Count | Component | Affected Runs |
|---|---|---:|---|---:|
| warning | geography:Jour 2: restaurant "Dîner — La locanda del tempio" est à 15.4km du cen | 1 | unknown | 1 |
| warning | geography:Jour 3: restaurant "Déjeuner — Benso 215" est à 16.4km du centre | 1 | unknown | 1 |
| warning | budget:Jour 4: restaurant "Petit-déjeuner à l'hôtel" a un coût de 0€ | 1 | unknown | 1 |
| warning | rhythm:Jour 3: seulement 50min de temps libre — pas de pause | 1 | unknown | 1 |
| warning | relevance:Must-see manquants (1/2): colisée | 1 | unknown | 1 |
| warning | realism:Jour 2: restaurant "Petit-déjeuner — TE cioccolateria - TE Caffè" à 14 | 1 | unknown | 1 |
| warning | budget:Hébergement "13. Grand Hotel Central" a un prix de 0€/nuit | 1 | unknown | 1 |
| warning | relevance:Must-see manquants (0/1): sagrada familia | 1 | unknown | 1 |
| info | DATA_ACTIVITY_DESCRIPTION_MISSING | 3 | pipeline/content | 1 |
| info | data-quality:Pas d'empreinte carbone calculée | 2 | unknown | 2 |
| info | schedule:Jour 4: 5h de vide entre "Check-out Annie's Home" (fin 10:00) et "Vol  | 1 | unknown | 1 |
| info | rhythm:Jour 1 (2 activités) vs jour 2 (8 activités) — déséquilibre important | 1 | unknown | 1 |
| info | rhythm:Jour 3 (6 activités) vs jour 4 (1 activités) — déséquilibre important | 1 | unknown | 1 |
| info | schedule:Jour 1: 6h de vide entre "Check-out 13. Grand Hotel Central" (fin 11:0 | 1 | unknown | 1 |

## Stratification
- groupType: {"solo":1,"couple":1,"friends":0,"family_with_kids":0,"family_without_kids":0}
- budgetLevel: {"economic":1,"moderate":1,"comfort":0,"luxury":0}
- transport: {"optimal":1,"plane":1,"train":0,"car":0,"bus":0}
- multiCityRuns: 0

## Failed Runs
- none
