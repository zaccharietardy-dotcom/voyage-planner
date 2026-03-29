# Geo Campaign Summary — geo-campaign-2026-02-17T13-03-59

- Started: 2026-02-17T13:03:59.345Z
- Finished: 2026-02-17T13:17:51.189Z
- Duration: 831.8s
- Seed: 20260217
- Runs: 10 (10 success / 0 failed)

## Acceptance
- GEO_IMPOSSIBLE_TRANSITION == 0: PASS (0)
- GEO_URBAN_HARD_LONG_LEG == 0: FAIL (2)
- GEO_INTRA_DAY_ZIGZAG == 0: FAIL (16)
- routeInefficiencyRatio <= 1.75: FAIL (2, exempt=0)
- must-see coverage: PASS (0)
- campaign executed 8+2: PASS (10/10)
- overall: FAIL

## Geo Codes
| Code | Count |
|---|---:|
| GEO_IMPOSSIBLE_TRANSITION | 0 |
| GEO_URBAN_HARD_LONG_LEG | 2 |
| GEO_INTRA_DAY_ZIGZAG | 16 |
| GEO_DAY_ROUTE_EFFICIENCY_LOW | 2 |

## Runs
| Run | Type | Success | Score | GEO_IMPOSSIBLE_TRANSITION | GEO_URBAN_HARD_LONG_LEG | GEO_INTRA_DAY_ZIGZAG | GEO_DAY_ROUTE_EFFICIENCY_LOW |
|---|---|---|---:|---:|---:|---:|---:|
| geo-direct-01 | direct | yes | 99 | 0 | 0 | 1 | 0 |
| geo-direct-02 | direct | yes | 90 | 0 | 1 | 4 | 1 |
| geo-direct-03 | direct | yes | 95 | 0 | 0 | 2 | 0 |
| geo-direct-04 | direct | yes | 90 | 0 | 1 | 3 | 0 |
| geo-direct-05 | direct | yes | 94 | 0 | 0 | 1 | 0 |
| geo-direct-06 | direct | yes | 96 | 0 | 0 | 2 | 0 |
| geo-direct-07 | direct | yes | 98 | 0 | 0 | 0 | 0 |
| geo-direct-08 | direct | yes | 92 | 0 | 0 | 2 | 1 |
| geo-suggest-01 | suggestion | yes | 99 | 0 | 0 | 0 | 0 |
| geo-suggest-02 | suggestion | yes | 98 | 0 | 0 | 1 | 0 |
