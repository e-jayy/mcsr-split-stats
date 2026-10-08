# MCSR Split Stats

Search an MCSR Ranked player and see the average of each split of their runs,
broken down by overworld structure type and bastion type. Built on the
[MCSR Ranked API](https://docs.mcsrranked.com/). No dependencies, no build step.

**Live site:** https://e-jayy.github.io/mcsr-split-stats/

The site covers **Season 12** only. To switch seasons, change `SEASON` in `src/app.js` and rebuild the data files for that season.

## Run it

```
node serve.js
```

Then open http://localhost:5173 (or `http://localhost:5173/?player=Feinberg` to jump straight to a player).

`npm test` runs the split-calculation tests.

## What it shows

- **Split Performance**: a radar of all seven splits, each ranked against everyone else's ranked
  runs and given a Minecraft material tier:

  | Tier | Percentile |
  | --- | --- |
  | Netherite | top 5% |
  | Diamond | top 20% |
  | Emerald | top 40% |
  | Gold | top 60% |
  | Iron | bottom 40% |
  | Coal | bottom 20% |

  The comparison data is `data/baseline.json`, a sample of recent ranked matches from all players.
  Refresh it whenever you like (takes ~8 minutes because of the rate limit):

  ```
  node scripts/build-baseline.js 350
  ```
- **Splits**: Overworld → Terrain to Bastion → Bastion → Fortress → Blind travel → Stronghold → End, each with
  average, best, "Avg End of Split" (the average point in the run when that split ends), and the sample size.
  Click a split to see its sub-splits (e.g. obtain iron / iron pick in the overworld,
  loot chest / crying obsidian in the bastion, first blaze rod in the fortress).
- **By overworld type**: Village, Buried Treasure, Shipwreck, Desert Temple, Ruined Portal.
- **By bastion type**: Bridge, Housing, Stables, Treasure.
- Filter chips (or click a table row) to combine filters, e.g. Shipwreck + Housing only.

## How it works

1. `GET /users/{name}` resolves the player.
2. `GET /users/{uuid}/matches` lists recent matches (paged by `before`, 100 at a time; decayed matches skipped).
3. `GET /matches/{id}` gets each match's `timelines` (advancement events with timestamps).
4. `src/splits.js` turns each player's timeline into splits. A **reset** event restarts the seed, so each
   attempt is timed from its own start (post-reset attempts are opt-in). Nether/Bastion/Fortress splits only count
   bastion-first runs.

Match details are cached in `localStorage`, so repeat lookups only fetch new matches. The API allows
500 requests per 10 minutes; the app backs off automatically if it hits the limit.

## Files

- `index.html`: page layout
- `src/app.js`: search, filters, rendering
- `src/api.js`: API client + cache
- `src/splits.js`: split definitions and statistics (pure, tested in `test/`)
- `src/rank.js`: percentiles, tiers and the pixel-art tier icons
- `scripts/build-baseline.js`: builds `data/baseline.json`
- Font: [typeface-minecraft](https://www.npmjs.com/package/typeface-minecraft) (MIT), loaded from jsDelivr
- `serve.js`: tiny static server (ES modules don't load from `file://`)
