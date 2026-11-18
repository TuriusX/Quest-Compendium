# Guide tab as a browser (proposal, Nov 17 2026)

**Approved by Noah, Nov 17 2026, with these changes:**
- **The tab is renamed "Guides".**
- **The ad blocker stays on** for the web pages.
- **The browser has real tabs:** "The browser should have tabs as well. Should be a good browser."
  - 📖 Guide is pinned first, then web tabs, with + for a new tab.
  - Middle-click or Ctrl+click on a link opens it in a new tab.
  - Ctrl+T / W / L / F / Tab work, and right-click menus.
  - It has find in page, zoom, and a new-tab page with favourites and suggestions.
  - Each game keeps its own tabs.
  - At most 6 tabs keep a live page; older ones sleep and reload when picked.

Step 1 (desktop) and step 4 (web app) are built. The sections below are the original proposal; where they say "no
tab strip" or "no ad blocking", the decisions above replace them.

A proposal only; nothing is built until Noah OKs it.

**The idea.** The Guide tab keeps opening on Quest Compendium's guide for the game you're playing, and also lets you go
to your own favourite guide sites in the same tab. It has back, forward, reload, an address / search bar,
favourites, and suggested sites for the game (its wiki, Steam guides, GameFAQs…).

## What's there today (found while planning)

**The Guide tab** shows our own guides (QcGuidesView), drawn by the app, not as a web page.

**An older browser** (GameGuidesBrowser.tsx, from Sep 2026) is still reachable from the game menu's "Browse all
guides". It has:
- web tabs in a `<webview>` inside the panel's own window;
- Google as the start page, a Steam Community tab, and a bookmark list (GameFAQs, Fextralife, MapGenie, IGN,
  PCPartPicker);
- **an ad blocker** on its pages (Ghostery, electron/main.cjs). That goes against the no-ad-blocking decision.
- no checks on what its pages can do. The panel's window also has web security off and grants every permission on its
  main session.

**Steam Deck** already has a real guide browser (Quest-Compendium-Decky src/guideBrowser.ts). It uses Steam's own
browser view, kept alive while you play, with favourite sites (GameFAQs, Neoseeker, Fandom, IGN, Reddit, YouTube) and
"Resume guide".

So this proposal **replaces** the old desktop browser rather than adding a second one, and brings the desktop in line
with the Deck.

## 1. How it looks (desktop)

A slim bar at the top of the Guide tab:

`[📖 Guide] [◀] [▶] [⟳] [ address or search… ] [☆] [⋯]`

**📖 Guide** is home: Quest Compendium's guide for the current game, at the place you are, as today.
- It stays the app's own reader (checklists, ticks, the quest log link), not our website in a frame.
- "Open on questcompendium.com" sits in ⋯, using today's guide URLs.

**The address bar:**
- an address goes there;
- anything else is searched with Google, with the game's name added when it isn't in the words ("ornstein smough" →
  "Dark Souls ornstein smough").

**☆** saves the page to your favourites.

**⋯ has:**
- Favourites;
- Suggested for this game;
- Open in my browser;
- Copy link.

**The page:** with a web page open, it fills the tab under the bar. Clicking 📖 brings the guide back, and the web
page stays where you left it.

**No tab strip.** One web page at a time keeps the panel tidy and works with a controller. Favourites and history do
the job tabs did.

**Remembered per game.** The last web page you had open for each game. "Resume" in 📖 takes you back to it.

**Suggested for this game.** These are worked out on the computer, with no cost and no AI:
- Steam Community guides (from the game's Steam id);
- the game's Fandom wiki and GameFAQs (as searches for the game);
- YouTube walkthroughs (a search);
- a map site search.

The same list as the Deck's favourites, so both apps match.

**Favourites:** the defaults are the Deck's six sites. You can add your own and remove any (stored on this computer,
with sync later).

**With no Quest Compendium guide for the game** (guide-free first): 📖 shows the suggested sites and a search box for
the game instead of an empty page. The browser works fully without our guide.

## 2. How it's built (desktop)

- **A separate view, not `<webview>`.** The page lives in its own WebContentsView owned by the main process and
  placed over the Guide tab's area. The app sends its position as the panel resizes, docks or changes scale. It hides
  with the panel and for screenshots.
- **Locked down:**
  - no Node, no preload, and no bridge to the app (the app's `electronAPI` is never visible to a web page);
  - sandboxed, with context isolation;
  - its own storage (partition `persist:qc-guides`), so site sign-ins stay apart from the app's;
  - every permission refused: camera, microphone, location, notifications, clipboard reading, USB / HID, and so on;
  - only http and https pages. Other links (`steam://`, `mailto:` …) go to the system;
  - pop-ups open in the same view (or in the system browser when they're sign-in windows);
  - downloads are off: a download link says "Open in your browser?" and hands it to the system browser.
- **No ad blocking.** The ad blocker is removed (it's only used by the old browser). Sites see a normal Chrome
  browser.
- **The old browser goes:** GameGuidesBrowser.tsx, its `<webview>`, `webviewTag`, and the "Browse all guides" menu
  item (the Guide tab is where it lives now).
- **A separate fix:** the panel window's web-security-off setting and its grant-everything permissions are worth
  closing in the same step, once nothing needs them.
- **Light on the game:**
  - one page at a time;
  - throttled when the panel is away (sound keeps playing, so a video walkthrough can play while you play);
  - the page is closed after 20 minutes away, and "Resume" reloads it.

## 3. Controller

Inside the Guide tab with a web page open, the page is its own view, so the controller layer drives it through the
main process.

| Button | Does |
| --- | --- |
| D-pad / left stick up, down | Scroll |
| D-pad / left stick left, right | Move between links on screen. The one picked gets the app's focus ring, drawn into the page by a small script in its own isolated world, so the page's scripts can't see it. |
| A | Open the picked link |
| B | Back (and, on the first page, back to 📖 Guide) |
| X | Picks the address bar. The on-screen keyboard opens, with the game's names suggested (padWords). |
| Y | The bar's Actions: Home, Forward, Reload, ☆, Favourites, Suggested, Open in my browser |
| LT, RT | A page at a time |
| Right stick | Scroll (as everywhere) |
| LB, RB | Still switch Quest log ◂ Ask ▸ Guide |

- **Prompt bar** names these while a web page is on screen.
- **Focus:** the browser is inside the panel, so it only has focus when the player opened the panel. It never opens
  or takes focus by itself, which fits the notifications plan. The wheel could get a **Guide** item that opens the
  panel at this tab.

## 4. Steam Deck

The Deck already has the browser, so it's aligned rather than rebuilt:
- **📖 home first:** our guide for the game when there is one (already on the Guides tab), favourites and suggested
  sites under it.
- **The same suggested list** as the desktop (section 1).
- **Remembered per game:** the last page for each game, not one last page overall (`qc-guide-last-url` becomes one
  per game).
- **No controller work:** Steam's browser handles the pad.

## 5. Web app

Other sites can't be shown inside a web page; most refuse to be framed.
- The web app's Guide tab stays our guide.
- Favourites and suggested sites are links that open in a new browser tab.
- The old browser's `<iframe>` path goes.

## 6. Optional, a separate step: "Ask about this page"

A button (and a Y action with the controller): "Ask about this page".
- **What it sends:** the part of the page on screen, as text (at most about 6,000 characters), with its address and
  title, as context for your question.
- **Terms and robots:**
  - It's the player's own view of a page they opened, like copying a paragraph into the question box.
  - No crawling and no fetching by our server.
  - Robots rules are for crawlers, and this isn't one.
  - The page text isn't stored on our server.
  - It's never added to the games database.
  - The answer names the page as its source, with a link.
- **Cost:** no fixed cost. Each such question counts as a normal question, plus up to about 2,000 tokens of page text:
  about $0.0005 more per question on Fast, about $0.005 on Pro.
- **Effort:** small to medium. It needs a server change, so a server deploy.
- **When:** after the browser itself, and only if Noah wants it.

## 7. Risks

- **Sites that dislike embedded browsers:**
  - Google sign-in refuses embedded browsers, so "sign in with Google" on a site goes to the system browser.
  - Cloudflare checks are solved by the player like in any browser.
- **Ads and bad pages (no ad blocker):**
  - pages are sandboxed with no permissions and no downloads;
  - the app's bridge is never exposed;
  - nothing a page does can reach the app or the computer beyond what Chrome allows any page.
- **Performance while gaming:**
  - one page at a time;
  - throttled when the panel is away;
  - closed after 20 minutes away.
- **Our own site:** links use today's guide URLs (stable URLs), and nothing on the site changes.
- **Clutter in the panel:** one slim bar, no tab strip. Mockups go to Noah before building.

## 8. Effort, order, and the release

| Step | What | Size |
| --- | --- | --- |
| 1 | Desktop browser in the Guide tab: the view and its lockdown, the bar, 📖 home, favourites, suggested sites, last page per game; the old browser and the ad blocker removed | Medium to large |
| 2 | Controller: scroll, link focus, address bar with the on-screen keyboard, Y actions, the prompt bar | Medium |
| 3 | Steam Deck alignment (📖 home first, same suggestions, last page per game) | Small |
| 4 | Web app: favourites and suggestions open in new tabs; iframe path removed | Small |
| 5 | Ask about this page (optional, server deploy) | Small to medium |

**Order:** 1 → 2 → 4 → 3 → 5. Each step is shown with screenshots before committing.

**Before the next release?**
- Steps 1, 2 and 4 fit if the release can wait for them; they're the release-worthy part.
- Step 3 is a separate Deck release and can go at the same time or right after.
- Step 5 belongs in the release after.
- If the release can't wait, a smaller cut fits: step 1 with the controller limited to scrolling and B for back.

**Recommendation:** yes. It turns a hidden, rough feature into a proper one, removes an ad blocker the rules don't
allow, closes real security gaps in the old browser, and costs nothing to run.
