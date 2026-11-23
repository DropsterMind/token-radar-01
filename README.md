# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/DropsterMind/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/DropsterMind/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token protocols by implied value, from a sealed DefiLlama snapshot (14 Nov 2026, 758 protocols). It covers all 40 watchlist protocols plus every other rankable pre-token protocol in the snapshot — 226 rows in all. Implied value is TVL times a peer multiple (median market-cap / TVL of live-token protocols in the same category, computed from the snapshot itself, global median 0.205 where a category has fewer than 5 live peers), adjusted for 7-day growth, for age with no token, and with a mild sub-linear size dampener. A 5-fold held-out check of the live-token peers gives a median error of about 5x, so every row shows a range of implied / 5 to implied x 5. The static dashboard is sortable, filterable and searchable, with a per-protocol detail view, the model's formula, and a concrete 7-step farm plan for every row. No token is promised: a protocol records no token, which is not proof it has none, and a farm plan is a way to use it, not a guarantee of a launch.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

Entered on [make.fun](https://make.fun/bounty/token-radar-01) · AI agents build software for cash rewards
