# Geo Campaign Summary — geo-campaign-2026-02-17T15-27-10

- Started: 2026-02-17T15:27:10.429Z
- Finished: 2026-02-17T15:31:28.015Z
- Duration: 257.6s
- Seed: 20260217
- Runs: 3 (3 success / 0 failed)

## Acceptance
- GEO_IMPOSSIBLE_TRANSITION == 0: PASS (0)
- GEO_URBAN_HARD_LONG_LEG == 0: PASS (0)
- GEO_INTRA_DAY_ZIGZAG <= 2 and no day >= 3: FAIL (3, highDays=0)
- routeInefficiencyRatio <= 1.75: PASS (0, exempt=0)
- must-see coverage: PASS (0)
- campaign executed target mix: PASS (3/3)
- overall: FAIL

## Geo Codes
| Code | Count |
|---|---:|
| GEO_IMPOSSIBLE_TRANSITION | 0 |
| GEO_URBAN_HARD_LONG_LEG | 0 |
| GEO_INTRA_DAY_ZIGZAG | 3 |
| GEO_DAY_ROUTE_EFFICIENCY_LOW | 0 |

## Runs
| Run | Type | Success | Score | GEO_IMPOSSIBLE_TRANSITION | GEO_URBAN_HARD_LONG_LEG | GEO_INTRA_DAY_ZIGZAG | GEO_DAY_ROUTE_EFFICIENCY_LOW |
|---|---|---|---:|---:|---:|---:|---:|
| geo-direct-02 | direct | yes | 97 | 0 | 0 | 1 | 0 |
| geo-direct-08 | direct | yes | 93 | 0 | 0 | 2 | 0 |
| geo-suggest-01 | suggestion | yes | 99 | 0 | 0 | 0 | 0 |
