# Session companion (proposal, Nov 18 2026)

A proposal only: nothing is built until Noah OKs it. Four ideas from Noah's brainstorm (relayed by the Side Chat
session), plus the groundwork he asked for on caching and reusing answers.

**The short version:**
- **1, "Where was I?":** a recap card when you come back to a game. Built from what the app already stores, so it
  costs nothing.
- **2, Hint levels:** hint mode exists, but has one level. It becomes three: nudge, then the rule you're missing,
  then the full answer. They come from one AI call that is revealed step by step, so the extra cost is close to
  nothing.
- **3, Point-of-no-return warnings:** guides and the fact database already know these points. A rare, quiet card
  only when you're there and something is still open. No AI cost.
- **4, Memory:** most of it already exists. The real win is free: stop the app uploading the whole conversation, with
  every old screenshot, on every question. A small summary per game comes after that, behind a with/without test
  (stop $3).
- **Reusing answers by meaning:** not worth building yet. At about 20 questions a day, only 2-6% would match, saving
  pennies.

## What's already there (checked in the code)

| Piece | Where | What it holds |
| --- | --- | --- |
| Conversation | server.ts, the chat route | The last 6 messages as text, older answers cut to 1,500 characters, no old images |
| Progress memory | src/utils/progressMemory.ts, settings.gameDone | Up to 30 things finished: fights, quests, ticked steps, areas passed. Sent with every question |
| Playthrough memory | src/utils/playthrough.ts | Choices made and key items (20 each), plus notes, up to 1,200 characters. Settings switch; synced per game |
| Where you are | the tab's place and story point | Read from screenshots and Help me here |
| Quest log | Now, steps, "watch" list | The current goal and its steps; the guide's points of no return as things to watch (questLogView.ts) |
| Hint mode | Settings switch; quickQuestions.ts | "Just a hint, please, no spoilers" and "a hint instead", one level |
| Pop-up card | electron/answerCard.cjs | Shows over the game without taking focus; the controller's quick menu can reach it |
| Points of no return | guides (flagship steps and choices), gameRecords type `noreturn`, achievement roadmaps | Where going on locks you out, and what you lose |
| Answer caching | none | Each question is answered fresh; only spoken audio is cached |

**One waste found:**
- The app sends the tab's whole conversation with every question (`history: activeTab.messages` in App.tsx). That
  includes every earlier screenshot as an image, and now drawn pictures too.
- The server only uses the last 6 messages, as text.
- After 20 screenshot questions that's several megabytes uploaded per question, for nothing. It slows answers on
  slower connections.
- This is a free fix (step 0 below).

## 1. "Where was I?"

**What the player sees:**
- You start a game you haven't played for a day or more. The pop-up card appears over the game without taking
  focus, for about 20 seconds:
  - "Last time: Blighted Village, Act 1";
  - the quest log's Now goal and its next unticked step;
  - the last thing you asked;
  - one choice or key item from your playthrough memory, if one matters.
- The card offers "Help me here" to check where you are now.
- On the controller it's in the quick menu as "Where was I?" any time. On the Steam Deck it's a note at the top of the
  panel.

**How it's built:**
- Game detection already fires when a game starts.
- The recap is assembled from what's stored: place, story point, quest log, finished list, playthrough entries, last
  question. No AI call.
- An optional Fast call could phrase it as two friendly sentences, for about $0.001. I'd start without it.

**Cost:** $0 a use. At a few hundred game starts a month it stays $0 (or under $0.50 with the phrasing call).
**Effort:** small to medium. The desktop card, the Deck note, the quick-menu item, and a setting to turn it off.
**Risks:**
- Stale data: the quest log may be old if you played without the app. The card says when it's from ("3 days ago").
- It must never cover a menu or loading screen badly, so it uses the same corner and timing as answers.

## 2. Hint levels

**What the player sees:**
- With hint mode on, a hint answer ends with "More of a hint". It shows the rule or mechanic you're missing ("these
  doors open to the symbols shown on the walls nearby").
- A second press shows the full answer.
- On the controller: a quick-menu item "Just a hint" (already there with hint mode on), then "More of a hint" while
  the card is up. On the keyboard: the card's More button.

**How it's built:**
- One answer call returns all three levels, in a small block like the steps block.
- The app shows level 1, and reveals the next level on request.
- Asking again would mean three calls; one call revealed in steps doesn't.

**Cost:** about 150-300 more output tokens on a hint answer: about $0.001 on Fast, $0.004 on Pro. Only hint mode uses
it, so a few cents a month.
**Effort:** small. The answer format, the card and panel reveal, the quick-menu item, and the Deck.
**Risks:**
- The model may leak the solution in level 1. A rule in the prompt and a check in tests ("level 1 never names the
  answer"). Noah tries it before release.

## 3. Point-of-no-return warnings

**What the player sees (rarely):**
- Only when all three hold:
  1. the app knows where you are;
  2. that place is just before a point of no return, by the guide or the fact database;
  3. something there is still open for you (not ticked, not in your finished list).
- Then a quiet card: "Before you go on: past the Shadow-Cursed Lands gate you can't come back. Still open here: the
  Spidersilk Lute." With Dismiss, and "Don't warn me in this game".
- Never more than once per point. It's off with the existing "Missables" setting, if there is one, otherwise with its
  own switch.
- Not shown when nothing is open: Noah doesn't want missables over-emphasised.

**How it's built:** the place comes from screenshots and Help me here; the points come from guide data and
gameRecords; the open items come from the quest log, ticks and the finished list. No AI call.
**Cost:** $0.
**Effort:** medium. Matching the place to the point needs care (names differ between guide and screen), so it only
fires on a confident match.
**Risks:**
- A wrong warning is worse than none: a confident place match only, and only guide-checked points.
- Games without a guide get nothing at first. Later, an answer could flag a point of no return itself, the way it
  flags missables now.

## 4. Memory across the session and past sessions

**What it is now:** the last 6 messages (text) plus progress and playthrough memory, every question. That covers most
"remember what I said" cases within a session. Across sessions, progress and playthrough memory carry over; the
conversation only does if you stay in the same tab.

**Step 0 (free, do first):**
- The app sends only what the server uses: the last 6 messages, text only, no images or drawn pictures.
- Expected effect: a smaller upload, faster answers with a long conversation, no change to answers.
- Checked by comparing an answer's server input before and after (identical) and timing the upload.

**Step 1, a small summary per game (only if the test says so):**
- At the end of a session (the game closes, or 30 minutes without a question), one Flash-Lite call turns that
  session's questions and answers into a summary of at most 120 words: what you were doing, what you learned,
  what's unresolved.
- It's kept with the playthrough memory: the last 3 sessions, about 400 tokens in all, editable and cleared like the
  rest.
- It's attached only when relevant: the first question of a new session, or questions that point back ("again",
  "earlier", "last time", "that boss"). Never on every question.
- Cost: about $0.0005 a summary, about $0.002 more on an answer that gets it. Under $1 a month at today's volume.
  Hard cap: $3 a month in config, after which summaries stop until next month.
- Latency: about 400 more input tokens, about 50-100 ms. Measured in the test.

**The with/without test (like the Pro facts test):**
- 30 real follow-up situations: the owner's captures plus anonymised questions from logs, each a question that
  depends on an earlier session.
- Each is answered twice, without and with the summary, side by side. The checks:
  - fact checks (wrong claims counted, not a judge's score);
  - "used the earlier context correctly" (yes / no);
  - added tokens and time.
- Go only if it's better on the context questions and no worse on facts.
- Cost about $2, hard stop $3.

## Reusing answers by meaning (groundwork, counted free)

**Caching today:**
- No answer is reused. Screenshot questions are always answered fresh.
- Gemini may apply its own automatic prompt caching to the shared start of every request (the rules text). We don't
  log it (`cachedContentTokenCount`), so I can't say how much.
- Logging it is a free one-line change worth making, so we know.

**The count (free, from the server's per-answer log lines since Nov 14):**
- 81 logged answers in 5 days, across desktop 40, Deck 24, web 11, site 6. That matches the daily stats: about 15-35
  questions a day.
- 23 of 81 repeat an earlier question's wording for the same game. Nearly all are quick questions ("What's next?",
  "Best gear for where I am", "Show me where on screen"), whose answers depend on what's on screen. Never reusable.
- 14 of 81 share the game and subject with an earlier one. The fact-type ones (where / how / what is) are about 2-5,
  for example the Nagakiba asked 3 ways, and those are mostly the owner's own tests.

**Verdict:**
- The real reuse rate for fact questions is about 2-6% today.
- At about 20 questions a day and $0.025 each, that saves about $0.01-0.03 a day.
- Not worth the risk of a wrong reused answer yet.
- Revisit at about 500 questions a day. Strict match (game + place + subject + intent), fact questions only, a fresh
  answer when unsure.

## Order and size

| Step | What | Cost | Effort |
| --- | --- | --- | --- |
| 0 | Send only the last 6 messages, text only; log Gemini's cached tokens | $0 | Small |
| 1 | "Where was I?" card (desktop, controller, Deck) | $0 | Small-medium |
| 2 | Hint levels (one call, revealed in steps) | ~$0.001-0.004 a hint | Small |
| 3 | Point-of-no-return card (narrow, rare) | $0 | Medium |
| 4 | Session summary: test first ($3 stop), then build if it wins | <$1 a month, $3 cap | Medium |
| - | Answer reuse by meaning | not now | - |

Each step is shown to Noah (screenshots) before the next, and released together as he decides.
