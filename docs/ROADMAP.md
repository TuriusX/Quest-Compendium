# Quest Compendium roadmap

Owner: Noah. Source: the project mind map (Oct 13, 2026). Keep this file in the repo at `docs/ROADMAP.md` and update the Status column as items ship.

## How to work through this roadmap

- **One item at a time, in the order below.** Don't start the next item until the current one is committed and Noah has seen it.
- **Propose before building** anything marked *(propose first)*: a short plan with the design, the files it touches, the cost (AI and searches) and any risks. Wait for Noah's go-ahead.
- **Show before/after screenshots** for every visible change, desktop and phone width where relevant, before committing.
- **Desktop app changes ship together in a release.** Note which release each item lands in (0.5.6, 0.5.7, …). Stay on 0.x.
- **Standing rules that still apply:** ask before any new AI spending outside the existing budgets; keep guide page addresses stable; never use Fandom or Fextralife as sources; never put secrets in code, logs or chat (Secret Manager only); don't add spoiler handling, warnings or blurring anywhere; check no core run is publishing before deploying the site or rebuilding the pipeline image; one Claude Code session per repo.

## Phase 1: reach players (next release, 0.5.6)

| # | Item | What it is | Status |
|---|------|-----------|--------|
| 1 | **Auto-update** | electron-updater against GitHub releases: check at startup and every 6 hours, download quietly, show a non-blocking "Version X is ready, restart to update" with a Later button, install on quit. Store builds skip it. Add `latest.yml` and the `.blockmap` to the release routine. | Done (0.5.6) |
| 2 | **Code signing** | Azure Trusted Signing via `win.azureSignOptions` in electron-builder, credentials from Secret Manager. **Blocked until Noah confirms what his $9.99/month Azure "Security" charge is.** If there's no signing account, propose the setup steps instead. | Waiting on Noah |
| 3 | **Quest log redesign** | Already specified in the Oct 13 prompt: short label plus dim detail line per objective, one progress count, quieter location row, highlight the next objective, hotkey and controller ticking, missable ⚠. | Done (0.5.6) |
| 4 | **First-run tour** | 30-second tour on first launch: the panel hotkey, screenshot hotkey, compact view, quest log, Pro/Fast. Skippable, shown once, reachable later from the ⋯ menu. Controller-navigable, all nine languages. | Built (0.5.7) |

## Phase 2: get more out of the guides (0.5.7)

| # | Item | What it is | Status |
|---|------|-----------|--------|
| 5 | **Guide-backed objectives** *(propose first)* | When the player's current quest matches a guide quest page or walkthrough step, offer to load its checked steps into the quest log. No AI question used. Ticks sync with the guide ticks on the player's account. Start with RDR2 (quest pages exist). | Done (0.5.6) |
| 6 | **Missable warnings from guide data** | Objectives and answers show a ⚠ when the guide marks something missable at the player's location. | Built (0.5.7) |
| 7 | **Guide-backed markers** *(propose first)* | Point at collectibles and missables near the player using guide data, without spending a question. Explain the accuracy limits honestly in the proposal. | Built (0.5.8) |

## Phase 3: answers that know your save (0.5.8+)

| # | Item | What it is | Status |
|---|------|-----------|--------|
| 8 | **Playthrough memory** *(propose first)* | Per game, per account: the choices the player made, where they are, what they've found, built from conversations, quest log and guide ticks. Shown to the player in a "Your playthrough" panel where they can edit or clear it. Added to answer context so answers fit their save. | Built (0.5.8) |
| 9 | **"Previously on…" recap** | When a player returns to a game after 3+ days, a three-line catch-up from playthrough memory and the quest log. Uses Fast, or no AI if it can be built from stored data. | Idea |
| 10 | **Steam progress sync** *(propose first)* | With explicit permission, read the player's unlocked Steam achievements for the running game to estimate story progress. Include privacy wording and how the Steam ID is obtained. | Idea |

## Phase 4: a second screen

| # | Item | What it is | Status |
|---|------|-----------|--------|
| 11 | **Phone companion** *(propose first)* | A mode of the web app for phones: the live quest log, objectives and the latest answer, synced with the desktop app through the player's account. Ticking on the phone updates the overlay. | Idea |

## Growth

| # | Item | What it is | Status |
|---|------|-----------|--------|
| 12 | **Shareable answer cards** | Turn an answer or a finished checklist into an image with the Quest Compendium link, for Discord and social posts. | Idea |
| 13 | **Streamer outreach** | Noah's task, not code: free Premium codes for small RPG streamers. Code side: a simple way to generate and redeem codes, if it doesn't exist. | Idea |
| 14 | **Own screenshots on top pages** | Noah's task: screenshots he takes while playing, added to the 20 most-visited guide pages. Code side: a way to attach an image to a guide page from the admin page. | Idea |
| — | Suggest an edit | Built, switched off. Don't turn on. | Paused |

## Running the business

| # | Item | What it is | Status |
|---|------|-----------|--------|
| 15 | **Cloud budget alert** | Noah's task in the Google Cloud console (Billing → Budgets & alerts, about $150/month, emails at 50/90/100%). | Noah |
| 16 | **Revenue vs. AI cost** | A monthly line in the Discord summary: Premium income (from the payment provider) against total AI spending across all ledgers. Propose the data source first. | Idea |
| 17 | **Model comparisons** | Rerun `scripts/evals/model-compare` (README there) when Gemini prices drop or a cheaper model comes out: player answers on production prompts and the guide reviewer on known pages. Gemini 4 Argon vs 3.1 Pro (Oct 14, 2026, $1.55): switch nothing. Before switching any model, add its price to usage.ts (unpriced models are counted at the top rate and flagged in the Discord summary). | Idea |
| 18 | **Flash price doubling (Jan 1, 2027)** | December: review Fast/Flash costs before the Jan 1 price doubling. Estimate the monthly cost at current usage with the new prices, and propose options (allowances, Premium price, or a cheaper model tested with scripts/evals/model-compare). The Discord summary reminds from Dec 1 (until `system/pipeline.flashCostReviewDone` is set); usage.ts applies the new rates on Jan 1 by itself. | December |

## Already built (for context)

Questions: Pro/Fast, hint mode, Immersive Mode, hold-to-talk voice, answers grounded in checked guides. Markers: screenshot hotkey, Locate me, fight help. Quest log: objectives tracker. Guides: walkthroughs, compendium (characters, places, quests), achievement roadmaps, IGDB box art, pipeline with per-game blueprints, evidence check, demand-ordered rebuilds, player corrections. Platforms: Windows overlay, Steam Deck plugin, web app, Microsoft Store. Players: guest/free/Premium, Discord. Ops: budgets and spending line, daily Discord summary, guide-miss log.
