# Model comparison (answers and the guide reviewer)

Compares a candidate Gemini model with the ones we use, read-only: nothing live changes, no player's quota or the
shared Pro budget is used. First run: Gemini 4 Argon vs Gemini 3.1 Pro, Oct 14, 2026 (about $1.55 in all). Result:
switch nothing (same reviewer accuracy; more thorough answers but slower, more searches, and twice the price from
Dec 1). Rerun it when prices drop or a cheaper model comes out.

## 1. Player answers (exact production prompts)

1. Start a local server with capture on (`QC_EVAL_CAPTURE` only works on a local server and for a test account):
   `QC_EVAL_CAPTURE=scratchpad/model-compare/captured.jsonl npx tsx server.ts`
2. `npx tsx scripts/evals/model-compare/capture.ts` sends the 20 questions in `capture.ts` (6 real, anonymized; 11
   written in the same style; 3 with official IGDB screenshots). The server writes each Pro request, as a signed-in
   player's with search allowed, instead of sending it. About 8 a minute (the local rate limit).
3. `npx tsx scripts/evals/model-compare/replay.ts [ids]` answers each request with every model in `MODELS`
   (default `gemini-3.1-pro-preview,gemini-4-argon`) and records time to first text, total time, tokens, searches
   and cost to `scratchpad/model-compare/results.jsonl`. Edit `PRICE` in `replay.ts` for the models compared.
   `CAPTURED=` and `RESULTS=` point it at other files. Read the answers side by side: quality is judged by reading.

Production waits 25 s for a Pro answer (45 s with search) before Flash answers instead: compare total times with that.

## 2. The guide reviewer (evidence check)

`npx tsx scripts/evals/model-compare/review.ts submit` builds the reviewer's exact requests (claimCheck's prompt) for
10 RDR2 quest pages: 5 as published (should pass) and 5 with three false facts planted (should fail), and submits them
to the Batch API for the current reviewer and the candidate (`MODELS` in `review.ts`). `review.ts collect` waits for
both, scores them like the pipeline does and lists every claim the two judge differently.

## 3. Before switching a model

Add its price to `usage.ts` (a model without one is counted at the most expensive known rate and flagged in the
Discord summary), its knowledge cutoff to `config/searchRules`, and check `withOutputCap`, the Pro quotas
(`apiLimits`, `takePro`) and the model labels in `server.ts`.
