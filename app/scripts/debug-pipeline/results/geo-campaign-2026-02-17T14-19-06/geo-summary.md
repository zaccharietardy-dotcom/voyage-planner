# Geo Campaign Summary — geo-campaign-2026-02-17T14-19-06

- Started: 2026-02-17T14:19:06.012Z
- Finished: 2026-02-17T14:24:47.605Z
- Duration: 341.6s
- Seed: 20260217
- Runs: 3 (3 success / 0 failed)

## Acceptance
- GEO_IMPOSSIBLE_TRANSITION == 0: PASS (0)
- GEO_URBAN_HARD_LONG_LEG == 0: FAIL (1)
- GEO_INTRA_DAY_ZIGZAG == 0: FAIL (2)
- routeInefficiencyRatio <= 1.75: PASS (0, exempt=0)
- must-see coverage: FAIL (2)
- campaign executed 8+2: PASS (3/3)
- overall: FAIL

## Geo Codes
| Code | Count |
|---|---:|
| GEO_IMPOSSIBLE_TRANSITION | 0 |
| GEO_URBAN_HARD_LONG_LEG | 1 |
| GEO_INTRA_DAY_ZIGZAG | 2 |
| GEO_DAY_ROUTE_EFFICIENCY_LOW | 0 |

## Runs
| Run | Type | Success | Score | GEO_IMPOSSIBLE_TRANSITION | GEO_URBAN_HARD_LONG_LEG | GEO_INTRA_DAY_ZIGZAG | GEO_DAY_ROUTE_EFFICIENCY_LOW |
|---|---|---|---:|---:|---:|---:|---:|
| geo-direct-01 | direct | yes | 99 | 0 | 0 | 0 | 0 |
| geo-direct-02 | direct | yes | 93 | 0 | 1 | 2 | 0 |
| geo-suggest-01 | suggestion | yes | 98 | 0 | 0 | 0 | 0 |
