# Notifications: answers over the game (plan, Nov 17 2026)

> **Superseded, Nov 17 2026.** Noah: this took "notifications" too literally. What he liked is answers popping up over
> the game instead of the panel sliding out. The plan is now **Pop-up answers**, a design look with mockups:
> https://claude.ai/artifact/THGgKSJBDyQYTkreEUKyg4
>
> Nothing is built until he OKs it.
>
> **His decisions on that plan:**
> 1. **Cards are not tied to markers** (markers are still a work in progress).
>    - No marker messages on cards: no "Couldn't find the markers again", and no card for markers found again.
>    - No numbered close-ups matching markers.
>    - Markers keep working on screen, separately, and the card never refers to them.
> 2. **One picture slot per card**, filled in this order:
>    - (a) the best picture from the answer's own visuals (the same pipeline as visual answers in the app, credited);
>    - (b) else a close-up from the question's screenshot, only when the check confirmed that thing is there (none if
>      unconfirmed or unsure);
>    - (c) else no picture. An empty slot beats a weak one.
>
> The note kinds, rate rules and Deck pop-ups below are set aside. The rest is kept for reference.

A plan only; nothing here is built yet except the controller's answer card (commit 5909b82b7), which becomes step 1.

**The idea.** When something the player asked for arrives while they're playing, it shows over the game as a small
card that never takes focus. The game keeps every key, click and button. The full panel opens only when the player
asks for it.

It works the same way with a controller and with a keyboard and mouse. The controller's answer card (wheel first,
docs/proposals/controller-wheel-first.md) is the first piece: one window and one set of rules, not two systems.

**The baseline (Noah, Nov 17 2026).** After trying it, Noah called the controller's pop-up answers, instead of the
panel sliding out, "a brilliant change".
- Every step below builds on that behaviour, and none may regress it.
- An answer to something asked over the game never brings the panel in by itself.
- Keyboard mode gets the same treatment (step 2).

## 1. What a notification shows

**An answer** (the main kind):
- **The question**, in one grey line, so the player knows which answer it is.
- **The short answer first.** The answer's title ("Look around the camp"), then its first 3 steps or lines. If there
  are more, it says "3 more steps". No new AI call: answers already come with a title and steps.
- **Close-ups of what's marked.** With markers on screen, up to 3 small close-ups (from markers v2, made on this
  computer), numbered to match the markers. The player can match "2 · Lantern" on the card to the 2 on screen.
- **"More".** Open this answer in the panel (how is in section 4).
- **While waiting:** "Thinking…" under the question, so the player knows it was heard (already built).

**A short note** (other kinds, section 2): one line, an icon, and no buttons. For example "You're in Stormveil Castle"
or "Couldn't find the markers again".

**Look.** The look must stay minimal, because Noah called compact mode ugly (section 3):
- a dark card with the accent border;
- the app's text size setting;
- no box art, header, tabs or counts.

Noah sees a mockup before it's built.

## 2. Where it sits, how long it stays, how it goes away

**Where.**
- **Screen:** the game's screen (the app already knows which one).
- **Position:** the top-right corner by default. Settings offers 4 corners, because games put their HUD in different
  places (Elden Ring's is top-left, many shooters keep the minimap top-right).
- **Size:** about 400 px wide, never more than a third of the screen's height.
- **See-through:** Settings has a slider for how see-through the card is.

**How long it stays.**

| What's on it | How long |
| --- | --- |
| "Thinking…" | Until the answer arrives (gives up after 2 minutes) |
| An answer | Reading time: 20 s plus 1 s for every 15 words, at most 90 s |
| A short note | 6 s |

- Fading starts again whenever the card's content changes.
- Opening the wheel, or the panel, puts the card away at once. The answer stays available as "Open this answer" for
  2 minutes.

**How it's dismissed or expanded.** Nothing ever takes focus to do it.

| | Controller | Keyboard and mouse |
| --- | --- | --- |
| Open the full answer | Wheel: **Open this answer** (built) | The show / hide shortcut (Ctrl+Space) while a card is up opens the panel *at that answer*; or click **More** on the card |
| Dismiss | Opening the wheel puts it away; or let it fade | A new **Dismiss** shortcut (default Ctrl+Shift+X, changeable); or click **✕** on the card; or let it fade |

**Clicking without taking focus.** The card would let clicks through everywhere except its two small buttons (More,
✕). Its window is made so that clicking it never activates it. So a click on More opens the panel (which the player
wanted), and a click on ✕ closes the card, with the game staying focused.
- In games with a cursor this is safe.
- In games that lock the mouse, the cursor never reaches the card, and the shortcuts are the way.
- This must be checked on a real game before it's relied on.

## 3. The old compact mode

**What it was.** A smaller version of the panel, with:
- box art and the game name;
- a questions count;
- a "Next here" line;
- a ⤢ to the full view.

You still opened it with the show / hide shortcut, and it took focus like the panel.

**Why it was dropped.** Noah, Nov 5 2026: "Scrap compact mode. It is ugly and useless." It was removed in 4016fd3e5
(released in 0.7.1), with the new header.

**Do notifications revive it?** No. They make it unnecessary.
- Compact mode was a smaller *panel*. You had to open it, it took focus, and it showed the same things every time.
- A notification is not a panel. It appears only when something the player asked for arrives, shows only that one
  thing, and never takes focus.
- The job compact mode tried to do (glance at help without leaving the game) is the job notifications do. They do it
  better, because the player never has to open anything.

**What not to bring back:** box art, a header, counts or "Next here" on the card. That's what made compact mode
cluttered.

## 4. What uses notifications, and what stays in the panel

**Uses them, with the panel away:**

| What | On the card |
| --- | --- |
| An answer asked from outside the panel: the wheel, Screenshot and ask (Ctrl+Shift+S), Speak (Ctrl+Shift+V), hold to talk | The answer (section 1) |
| Help me here | Its result: "You're in X · Now: Y", with the steps for Now when it has them |
| Locate me (the automatic one) | A note, only when the place *changes* and the quest log isn't on screen (the quest log already shows it) |
| Markers found again | Nothing when it works (the markers are the feedback); a note when a find the player asked for comes back empty |
| Limit or trial messages | Only as the answer to a question the player just asked ("You've used today's Pro questions · More" opens the panel). Never an offer to buy that nobody asked for. |

**Later, opt-in only (off by default, after feedback):**
- **Worth getting here:** once per area, only when nothing else is showing.
- **Quest log updates** ("Now: …"): only with the quest log hidden.
- **A detected game** ("Playing Elden Ring · its guide is ready").

**Stays in the panel:**
- the conversation;
- typing a question;
- the guide;
- follow-ups;
- Settings, sign-in, payments and subscriptions;
- update notices ("Version X is ready" waits for the next time the panel opens);
- anything asked *from* the panel (it's already in front of the player).

**Keyboard question (needs Noah):** today Screenshot and ask and Speak on the keyboard bring the panel in, and it
takes focus. Should those answers go on the card instead?
- I recommend yes, as the default, matching the controller behaviour Noah liked.
- A setting would let players choose: "Answers to shortcut questions: over the game / in the panel".

## 5. Where it can't show, and what happens instead

**Exclusive fullscreen games.**
- Nothing can draw over a game in exclusive fullscreen on Windows. That covers the panel, the markers and the card.
- The app already tells players to use Borderless or Windowed.
- The answer is read aloud if that's on, and waits in the panel otherwise.
- Windows' own pop-up notifications aren't a way round it: by default Windows hides them while a game is running.

**More than one monitor.**
- The card goes on the game's screen.
- A setting "Show notifications on: the game's screen / my other screen" is for players who keep the panel on a second
  monitor and don't want anything over the game.

**Steam Deck.**
- The plugin can't draw over games, but it can send a **Steam notification**: the Decky toast, which shows over the
  game like Steam's own pop-ups.
- The Deck gets a short toast with the answer's title and first line, saying "Open Quest Compendium to read it" (the
  ... button).
- A toast holds about two lines, so close-ups and markers stay in the plugin.
- Not yet checked on a real Deck: that toasts show over every game, and how long they stay.

**The web app.** None. A browser tab can't draw over a game, and players on the web site are already looking at it.

## 6. Risks and the rules against them

**Distraction.** The card only appears for something the player did (asked, Help me here, Locate me changing place).
The kinds that aren't answers are off by default.

**Covering the HUD.** It has a choice of corner, a size limit, see-through, and short times on screen.

**Too many pop-ups.** The rate rules:
- one card at a time;
- a newer answer replaces the older one;
- an answer always beats a note;
- a note never replaces an answer that's still being read;
- at most one note every 30 seconds;
- no notes during a fight (the last answer was about a fight), only answers;
- a note that can't show within 10 s is dropped, not queued.

**Accessibility.**
- The card follows the app's text size.
- The text keeps a contrast of at least 4.5:1 at every see-through setting (the background never goes below 85% dark).
- The app's reduced motion setting turns the fade into an instant change.
- A card that never takes focus can't be read by a screen reader. Players who rely on one get answers read aloud
  (the existing read-aloud setting), which works without focus.

## 7. Cost and effort

**Cost:** none. Notifications show answers that were already paid for, and close-ups are made on the player's
computer. No new AI calls, servers or storage.

**Effort:**

| Step | What | Size |
| --- | --- | --- |
| 1 | Polish the controller card that's built: the short answer (title + 3 steps), marker close-ups, reading time, corner and see-through settings | Small |
| 2 | Keyboard and mouse: shortcut questions answered on the card; Ctrl+Space with a card up opens that answer; More / ✕ that work without taking focus; the Dismiss shortcut | Medium |
| 3 | The other kinds: Help me here, Locate me, a failed find again, limit messages; the rate rules | Small to medium |
| 4 | Steam Deck toasts | Small (needs a real Deck test) |
| 5 | The opt-in kinds (worth getting here, quest log, game detection), only if players want them | Small each |

Each step is shown with screenshots before committing, and checked by Noah on a real game (focus, clicks, HUD)
before release.

## 8. Recommendation

**Worth it: build steps 1 to 4. Step 5 only after players have used the rest.**

- **Why:** help without leaving the game is the app's promise. Today a keyboard player who asks with a shortcut still
  gets pulled out of the game. Notifications fix that for everyone, at no running cost, on top of what's already
  built.
- **The step order** is 1 → 2 → 3 → 4. Step 1 finishes what the controller already has; step 2 brings the biggest
  group (keyboard and mouse players) the same benefit.
- **Decisions for Noah before step 2:**
  1. Should keyboard shortcut answers go on the card by default (recommended), or stay in the panel?
  2. Should the card's More / ✕ be clickable (needs a check on a real game)?
  3. Which corner is the default (top-right is proposed)?
