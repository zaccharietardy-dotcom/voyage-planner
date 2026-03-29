# Geo Campaign Summary — geo-campaign-2026-02-18T23-16-05

- Started: 2026-02-18T23:16:05.334Z
- Finished: 2026-02-18T23:19:38.324Z
- Duration: 213.0s
- Seed: 20260219
- Runs: 3 (3 success / 0 failed)

## Acceptance
- GEO_IMPOSSIBLE_TRANSITION == 0: PASS (0)
- GEO_URBAN_HARD_LONG_LEG == 0: FAIL (4)
- GEO_INTRA_DAY_ZIGZAG <= 2 and no day >= 3: FAIL (2, highDays=1)
- routeInefficiencyRatio <= 1.75: FAIL (2, exempt=0)
- must-see coverage: FAIL (2)
- campaign executed target mix: PASS (3/3)
- overall: FAIL

## Geo Codes
| Code | Count |
|---|---:|
| GEO_IMPOSSIBLE_TRANSITION | 0 |
| GEO_URBAN_HARD_LONG_LEG | 4 |
| GEO_INTRA_DAY_ZIGZAG | 2 |
| GEO_DAY_ROUTE_EFFICIENCY_LOW | 2 |

## Runs
| Run | Type | Success | Score | GEO_IMPOSSIBLE_TRANSITION | GEO_URBAN_HARD_LONG_LEG | GEO_INTRA_DAY_ZIGZAG | GEO_DAY_ROUTE_EFFICIENCY_LOW |
|---|---|---|---:|---:|---:|---:|---:|
| geo-direct-01 | direct | yes | 78 | 0 | 4 | 1 | 1 |
| geo-suggest-01 | suggestion | yes | 87 | 0 | 0 | 1 | 1 |
| geo-suggest-02 | suggestion | yes | 99 | 0 | 0 | 0 | 0 |
