# Geo Campaign Summary — geo-campaign-2026-02-17T14-28-18

- Started: 2026-02-17T14:28:18.654Z
- Finished: 2026-02-17T14:33:14.592Z
- Duration: 295.9s
- Seed: 20260217
- Runs: 3 (3 success / 0 failed)

## Acceptance
- GEO_IMPOSSIBLE_TRANSITION == 0: PASS (0)
- GEO_URBAN_HARD_LONG_LEG == 0: FAIL (2)
- GEO_INTRA_DAY_ZIGZAG <= 2 and no day >= 3: FAIL (4, highDays=1)
- routeInefficiencyRatio <= 1.75: FAIL (1, exempt=0)
- must-see coverage: FAIL (1)
- campaign executed target mix: PASS (3/3)
- overall: FAIL

## Geo Codes
| Code | Count |
|---|---:|
| GEO_IMPOSSIBLE_TRANSITION | 0 |
| GEO_URBAN_HARD_LONG_LEG | 2 |
| GEO_INTRA_DAY_ZIGZAG | 4 |
| GEO_DAY_ROUTE_EFFICIENCY_LOW | 1 |

## Runs
| Run | Type | Success | Score | GEO_IMPOSSIBLE_TRANSITION | GEO_URBAN_HARD_LONG_LEG | GEO_INTRA_DAY_ZIGZAG | GEO_DAY_ROUTE_EFFICIENCY_LOW |
|---|---|---|---:|---:|---:|---:|---:|
| geo-direct-02 | direct | yes | 93 | 0 | 0 | 2 | 1 |
| geo-direct-08 | direct | yes | 87 | 0 | 2 | 1 | 0 |
| geo-suggest-01 | suggestion | yes | 96 | 0 | 0 | 1 | 0 |
