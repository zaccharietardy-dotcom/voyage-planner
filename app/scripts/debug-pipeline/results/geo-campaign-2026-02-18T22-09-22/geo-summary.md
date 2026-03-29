# Geo Campaign Summary — geo-campaign-2026-02-18T22-09-22

- Started: 2026-02-18T22:09:22.969Z
- Finished: 2026-02-18T22:13:42.980Z
- Duration: 260.0s
- Seed: 20260218
- Runs: 3 (3 success / 0 failed)

## Acceptance
- GEO_IMPOSSIBLE_TRANSITION == 0: FAIL (1)
- GEO_URBAN_HARD_LONG_LEG == 0: FAIL (5)
- GEO_INTRA_DAY_ZIGZAG <= 2 and no day >= 3: FAIL (3, highDays=2)
- routeInefficiencyRatio <= 1.75: FAIL (2, exempt=1)
- must-see coverage: FAIL (2)
- campaign executed target mix: PASS (3/3)
- overall: FAIL

## Geo Codes
| Code | Count |
|---|---:|
| GEO_IMPOSSIBLE_TRANSITION | 1 |
| GEO_URBAN_HARD_LONG_LEG | 5 |
| GEO_INTRA_DAY_ZIGZAG | 3 |
| GEO_DAY_ROUTE_EFFICIENCY_LOW | 2 |

## Runs
| Run | Type | Success | Score | GEO_IMPOSSIBLE_TRANSITION | GEO_URBAN_HARD_LONG_LEG | GEO_INTRA_DAY_ZIGZAG | GEO_DAY_ROUTE_EFFICIENCY_LOW |
|---|---|---|---:|---:|---:|---:|---:|
| geo-direct-01 | direct | yes | 83 | 0 | 3 | 1 | 1 |
| geo-suggest-01 | suggestion | yes | 75 | 1 | 2 | 2 | 1 |
| geo-suggest-02 | suggestion | yes | 92 | 0 | 0 | 0 | 0 |
