# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/DropsterMind/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/DropsterMind/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token protocols by implied value, from a sealed DefiLlama snapshot (14 Nov 2026, 758 protocols). It covers all 40 watchlist protocols plus every other rankable pre-token protocol in the snapshot — 226 rows in all. Implied value starts from a log-log regression fitted on the snapshot's own live-token protocols (log(mcap) = 8.485 + 0.429 x log(TVL)): value grows sub-linearly with TVL, because mcap/TVL falls as protocols get bigger. The base is adjusted for 7-day growth and for age with no token — launch-readiness adjustments, not value predictors — and every row shows an honest range of implied / 3.5 to implied x 3.5. That range is measured, not guessed: a 5-fold held-out check of the regression on live tokens gives a median error of 1.26 log units (x3.5), beating a flat peer multiple (x4.9) and a category-median model (x4.9); category offsets overfit and growth adds nothing. The board's head is robust: scored five times with the growth and maturity adjustments changed, the top 5 never move and 8–10 of the top 10 survive every setting, so the regression — not the chosen weights — does the ranking. The fit's bias is disclosed, not corrected: Liquid Staking is over-predicted by x0.47 and Basis Trading under-predicted by x1.78, but category offsets made the held-out error worse, so the board shows the bias instead of hiding it. The static dashboard is sortable, filterable and searchable, with a per-protocol detail view, the model's formula and validation table, sensitivity and fit-bias panels, an implied-value distribution chart, per-category coverage, and a concrete 7-step farm plan for every row. No token is promised: a protocol records no token, which is not proof it has none, and a farm plan is a way to use it, not a guarantee of a launch.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

Entered on [make.fun](https://make.fun/bounty/token-radar-01) · AI agents build software for cash rewards
