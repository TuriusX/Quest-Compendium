/**
 * Pop-up answers over the game (owner, Nov 17-18 2026: "a brilliant change"; the design look "Pop-up answers").
 * An answer to something asked while playing (the controller's quick menu, or the keyboard's shortcuts with the panel
 * away) shows here instead of the panel sliding out: a card in a corner of the game's screen that never takes focus
 * (focusable: false, only ever shown with showInactive). The mouse goes through it except over the card itself, where
 * its buttons (More / Open / ✕) work without taking focus either. Cards never mention markers (owner, Nov 17).
 *
 *   thinking({ question, mode, place })   asked: the question and what's happening ("Got your screen", "Asking Pro"…)
 *   stage({ screen } | { sent, model })   what's happening, as the app learns it
 *   answer(payload)   the answer: title, steps, warnings in amber, one picture (or none), the text behind More
 *   update(payload)   the same answer with its picture, arrived later
 *   more()   the rest of the answer in place, then its next part (the quick menu's "More of this answer")
 *   pause() / resume()   while the quick menu is open, or the mouse is over the card
 *   setPrefs({ size, corner, speak, orb, orbStyle })   Settings: Small / Medium / Large, the corner, reading the summary aloud, the orb and its look
 *   speaking(on)   the summary is being read aloud: the card stays until it's done
 *
 * Summaries (owner, Nov 19 2026: quick information to get on with what led to the question): an answer with a summary
 * (src/utils/cardSummary.ts; its own call after the answer, so the answer never changes) shows the summary, its warnings and its picture; More shows the whole answer. The summary
 * is read aloud (opts.onSpeak) unless the card's speaker button or Settings turned that off (opts.onSpeakPref).
 *
 * The orb (owner, Nov 19 2026: "a glowing orb floating there that contorts itself into a card and then back up to the
 * orb again"; Settings → Pop-up answers, on by default): while the panel is away (setAway), this window stays over the
 * game and shows a clear glass orb in the theme's colour (nothing inside: owner, Nov 19 2026) in the card's corner, in place of the book spine and the quest log's
 * ribbon at the screen edge. Cards grow out of it and fold back into it (answerCard.html draws both, the orb in WebGL).
 * A left click brings the last card back (never read aloud; with none yet, a line on how to ask); a right click opens
 * its menu (Open Quest Compendium, Quest log, Open the wheel, Mute read-aloud, Hide until next answer: opts.onOrb). A
 * card whose time ran out leaves a dot on the orb. The state is electron/orbState.cjs.
 *   Why one window: the orb and the card are the same thing on screen (the card is the orb, opened), so the morph is
 * one page animating one shape, with nothing to line up between windows. While the orb is on, the window keeps the
 * card's full size in its corner (no resizing mid-morph: a transparent window being resized flickers). The orb off: the
 * card works as before.
 *   The mouse (both ways, Nov 19 2026): the window is click-through without forwarding, and the main process hit-tests
 * the cursor against the parts the page reports (the orb, the card, the menu) every 40 ms, letting the mouse in only
 * over them, as the quest log does (tracker.cjs). The card used to let itself in from the page's mouseenter, which on
 * Windows flips straight back (setIgnoreMouseEvents(false) fires a mouseleave): its buttons' clicks went to the game.
 */
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const orbState = require('./orbState.cjs');

const WIDTH = 520; // at Medium, on a 1080p screen
const SCALE = { s: 0.85, m: 1, l: 1.3 };
const MARGIN = 24;
const THINKING_MS = 120000; // a question that never got an answer goes after this
const HINT_MS = 7000; // the orb's how-to-ask line
const FOLD_MS = 520; // the card folding back into the orb (the page's animation, and a little more)
const MENU_LEAVE_MS = 1400; // the orb's menu closes once the mouse has been away from it this long
const DWELL_MS = 150; // the mouse resting on the orb this long opens the quick menu's fan (owner, Nov 20 2026: "near-instant"; was 480 ms; just enough that a cursor passing over doesn't)

/** How long an answer stays: reading time for what's showing (20 s + 1 s per 15 words), at most 90 s; a warning, 30 s at least. */
/**
 * What a card reads aloud (owner, Nov 20 2026: every new card is read, whichever way it was asked): its summary, or,
 * without one (no game detected, a short answer, the summary call failed), the answer's start: plain words (no
 * markdown, links or tags), whole sentences up to about 600 characters.
 */
function spokenText(card) {
  if (!card) return '';
  if (card.summary) return card.summary;
  const plain = String(card.text || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#+\s*(.*?)[.:]?\s*$/gm, '$1.')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[*_`~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= 600) return plain;
  const cut = plain.slice(0, 600);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 120 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}

function readingMs(text, hasWarning) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  const ms = Math.min(90000, 20000 + Math.round(words / 15) * 1000);
  return hasWarning ? Math.max(30000, ms) : ms;
}

// A drawn answer (wide: shown across the card, whole) may be a data URL of a few hundred KB; tag: "Illustration".
const pictureOf = (p) => (p && typeof p.url === 'string' && p.url
  ? {
      url: p.url, credit: String(p.credit || '').slice(0, 120), video: !!p.video,
      ...(p.wide ? { wide: true, tag: String(p.tag || '').slice(0, 40) } : {}),
      // A video plays on the card itself (Nov 20 2026): its id, where to start, its length and title.
      ...(p.video && /^[\w-]{6,20}$/.test(String(p.videoId || ''))
        ? { videoId: String(p.videoId), start: Math.max(0, Math.round(Number(p.start) || 0)), seconds: Math.max(0, Math.round(Number(p.seconds) || 0)), title: String(p.title || '').slice(0, 200) }
        : {}),
    }
  : null);

/**
 * @param {{ display: () => Electron.Display, strings: () => object, onAction: (what: string, current: object|null) => void,
 *   onSpeak?: (s: { id: string, text: string } | null) => void, onSpeakPref?: (on: boolean) => void,
 *   onOrb?: (what: 'open'|'log'|'ask'|'fan'|'busy') => void }} opts
 * onSpeak(null) stops the reading. onOrb('fan'): the mouse rested on the orb (open the quick menu's fan; Nov 19 2026);
 * onOrb('busy'): the orb was clicked or its menu opened (a fan the mouse opened makes way).
 */
function createAnswerCard(opts) {
  let win = null;
  let ready = false;
  let queue = [];
  let timer = null;
  let current = null; // the answer on the card (or put away), for "Open this answer"
  let last = null; // the last answer the card showed: the orb's left click (and the quick menu's "Last card") brings it back
  let thinkingNow = null;
  let shownAt = 0;
  let prefs = { size: 'm', corner: 'tr', speak: true, orb: true, orbStyle: 'orb' };
  let orb = orbState.createOrbState();
  let speakingNow = false; // the summary is being read aloud (the timer waits)
  let height = 200;
  let moreState = { more: false, part: 0, parts: 0 };
  let total = 0; // the current timer's full length
  let endsAt = 0;
  let pausedLeft = 0;
  let mouseOver = false;
  let videoOn = false; // a video plays on the card (Nov 20 2026): its time waits until it stops
  // The orb's mouse: the parts of the page the mouse may reach ({ id, x, y, w, h }, window coordinates), what it's over
  // now, whether the window takes the mouse (null: unknown, right after a show), and when it last was over the menu.
  let hits = [];
  let overId = '';
  let mouseIn = null;
  // A video made full screen in the card (owner, Nov 21 2026: "I cannot minimize it... I had to exit the app"): the
  // window takes the mouse and the keys until it leaves full screen (Esc, or the player's own button).
  let fullScreen = false;
  let watch = null;
  let menuSeenAt = 0;
  let dwellFrom = 0; // since when the mouse has rested on the orb (the fan opens after DWELL_MS)
  let dwellDone = false;
  let fanOn = false; // the quick menu's fan is out of the orb: it glows

  const scale = () => SCALE[prefs.size] || 1;
  const width = () => Math.round(WIDTH * scale());
  const maxHeight = () => {
    const d = opts.display();
    return Math.round((d.workArea || d.bounds).height * 0.6);
  };
  const alive = () => !!win && !win.isDestroyed();

  const send = (channel, payload) => {
    if (channel === 'card-show') ensure(); // the first message makes the window (it waits for the page to load)
    if (!alive()) return;
    if (!ready) queue.push([channel, payload]);
    else win.webContents.send(channel, payload);
  };

  function ensure() {
    if (alive()) return win;
    ready = false;
    win = new BrowserWindow({
      width: width(),
      height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      // Never throttled while hidden: a transparent window shown again otherwise keeps its old (empty) frame.
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'answerCardPreload.cjs') },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    // Clicks go through to the game (except over the card, the orb or its menu: see the watch); never in the app's own
    // screenshots.
    applyMouseMode();
    win.setContentProtection(true);
    const w = win;
    win.webContents.once('did-finish-load', () => {
      if (win !== w) return; // dropped meanwhile
      ready = true;
      w.webContents.send('orb-state', orbLook());
      for (const [c, p] of queue) w.webContents.send(c, p);
      queue = [];
      if (fanOn) w.webContents.send('orb-fan', true);
    });
    win.loadFile(path.join(__dirname, 'answerCard.html'));
    // Full screen: the window is click-through and never focused, so neither Esc nor the player's exit button would
    // reach it. While full screen it takes the mouse and the keys; leaving gives them back to the game.
    let watchWas = false;
    win.webContents.on('enter-html-full-screen', () => {
      if (win !== w || fullScreen) return;
      watchWas = !!watch;
      stopWatch();
      fullScreen = true;
      // The whole screen (a transparent window doesn't go full screen by itself: the player would fill the card only).
      w.setBounds(opts.display().bounds);
      w.setFocusable(true);
      w.setIgnoreMouseEvents(false);
      w.focus();
    });
    win.webContents.on('leave-html-full-screen', () => {
      if (win !== w || !fullScreen) return;
      fullScreen = false;
      // Back to the card's place (again a moment later: Chromium resizes the page as it leaves full screen).
      place();
      setTimeout(() => { if (win === w) place(); }, 150);
      w.setFocusable(false);
      w.blur();
      applyMouseMode();
      if (watchWas) startWatch();
    });
    // Electron leaves Esc to the page: it ends full screen here, as a browser does.
    win.webContents.on('before-input-event', (event, input) => {
      if (!fullScreen || input.type !== 'keyDown' || input.key !== 'Escape') return;
      event.preventDefault();
      w.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true).catch(() => {});
    });
    win.on('closed', () => {
      if (win !== w) return; // dropped on purpose (drop() has cleaned up)
      win = null;
      fullScreen = false;
      ready = false;
      stopWatch();
    });
    return win;
  }

  /**
   * Gone until it's needed again: closed, not hidden. A window hidden and shown again loses the button-down of every
   * later click (the quest log found the same: tracker.cjs), so the card's buttons and the orb would stop working; a
   * fresh window each time doesn't.
   */
  function drop() {
    if (!alive()) return;
    fullScreen = false;
    const w = win;
    win = null;
    ready = false;
    queue = [];
    hits = [];
    stopWatch();
    mouseOver = false;
    w.destroy();
  }

  /** Where the window goes: the card's corner of the game's screen, at the card's height or (the orb on) its full room. */
  function bounds() {
    const d = opts.display();
    const { x, y, width: W, height: H } = d.workArea || d.bounds;
    const right = prefs.corner === 'tr' || prefs.corner === 'br';
    const bottom = prefs.corner === 'bl' || prefs.corner === 'br';
    // The orb on (owner, Nov 19 2026: the orb closer to the corner): the window sits right on the screen's corner, the
    // orb in its corner (13 px from the edges at Medium), and the card keeps its MARGIN inside it (the morph slides it
    // from the orb out to there).
    if (orb.on) {
      const w = width() + MARGIN, h = maxHeight() + MARGIN;
      return { x: Math.round(right ? x + W - w : x), y: Math.round(bottom ? y + H - h : y), width: w, height: h };
    }
    const w = width();
    const h = Math.max(60, Math.min(maxHeight(), height));
    return { x: Math.round(right ? x + W - w - MARGIN : x + MARGIN), y: Math.round(bottom ? y + H - h - MARGIN : y + MARGIN), width: w, height: h };
  }
  function place() {
    if (!alive() || fullScreen) return; // a full-screen video keeps the whole screen until it leaves
    const next = bounds();
    const b = win.getBounds();
    if (b.x !== next.x || b.y !== next.y || b.width !== next.width || b.height !== next.height) win.setBounds(next);
  }

  // ---- The orb ----------------------------------------------------------------------------------------------------
  // home: where a card grows from and folds back to (the orb on and the panel away, even while hidden until next answer).
  const orbLook = () => ({
    ...orbState.look(orb), on: orb.on, home: orb.on && orb.away, geo: { ...orbState.orbGeometry(scale()), inset: MARGIN }, speak: prefs.speak,
    // The orb's look (owner, Nov 21 2026): the glass orb, or the app's icon floating and glowing.
    icon: prefs.orbStyle === 'icon',
    scale: scale(), right: prefs.corner === 'tr' || prefs.corner === 'br', bottom: prefs.corner === 'bl' || prefs.corner === 'br', strings: opts.strings(),
  });

  /** Click-through, without forwarding: the watch lets the mouse in over the page's parts. */
  function applyMouseMode() {
    if (!alive() || fullScreen) return;
    mouseIn = null;
    win.setIgnoreMouseEvents(true);
  }
  function setMouseIn(on) {
    if (!alive() || fullScreen || mouseIn === on) return;
    mouseIn = on;
    if (on) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true);
  }
  function startWatch() {
    if (watch || fullScreen) return;
    watch = setInterval(() => {
      if (!alive() || !win.isVisible()) return void over('');
      const p = require('electron').screen.getCursorScreenPoint();
      const b = win.getBounds();
      const x = p.x - b.x, y = p.y - b.y;
      const hit = hits.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
      over(hit ? hit.id : '');
      // The mouse resting on the orb opens the quick menu's fan (owner, Nov 19 2026), once per stay: a short dwell, so
      // a cursor passing over it doesn't. Only opens the menu; nothing in it is picked (main.cjs, wheel.cjs).
      if (overId === 'orb' && orbState.look(orb).orb && !orb.menu) {
        if (!dwellFrom) dwellFrom = Date.now();
        else if (!dwellDone && Date.now() - dwellFrom >= DWELL_MS) {
          dwellDone = true;
          if (opts.onOrb) opts.onOrb('fan');
        }
      } else {
        dwellFrom = 0;
        dwellDone = false;
      }
      // The menu has no focus to lose: it closes once the mouse has stayed away from it (and the orb) for a moment.
      if (orb.menu) {
        if (hit) menuSeenAt = Date.now();
        else if (Date.now() - menuSeenAt > MENU_LEAVE_MS) dispatch({ type: 'menu', open: false });
      }
    }, 40);
  }
  function stopWatch() {
    clearInterval(watch);
    watch = null;
    overId = '';
    mouseIn = null;
    dwellFrom = 0;
    dwellDone = false;
  }
  /** The mouse is over a part of the page (or none): the window takes it there, the page lights it, the card's time waits. */
  function over(id) {
    setMouseIn(!!id);
    if (id === overId) return;
    overId = id;
    send('orb-hover', id);
    const onCard = id === 'card';
    if (onCard !== mouseOver) {
      mouseOver = onCard;
      if (mouseOver) pause();
      else resume();
    }
  }

  /** The orb's state changed: the window shows or goes, and the page draws it. */
  function dispatch(ev) {
    const before = orbState.look(orb);
    const prev = JSON.stringify(orb);
    orb = orbState.reduce(orb, ev);
    const now = orbState.look(orb);
    if (ev.type === 'menu' && now.menu) menuSeenAt = Date.now();
    if (orb.on && now.window) {
      const w = ensure();
      place();
      if (!w.isVisible()) {
        w.showInactive();
        w.webContents.invalidate();
        mouseIn = null; // Windows' click-through state after a hide/show isn't known: the watch applies it again
      }
      startWatch();
    } else if (orb.on && before.window && !now.window && !shownAt) {
      // Nothing to show (the panel came in, or Hide until next answer): after the fold, if one is running.
      setTimeout(() => {
        if (!shownAt && !orbState.look(orb).window) drop();
      }, before.card ? FOLD_MS : 0);
    }
    if (prev !== JSON.stringify(orb) || ev.type === 'pref') send('orb-state', orbLook());
  }

  function startTimer(ms) {
    clearTimeout(timer);
    total = ms;
    endsAt = Date.now() + ms;
    pausedLeft = 0;
    timer = setTimeout(() => hide('timer'), ms);
    send('card-timer', { left: ms, total: ms, paused: false });
  }

  function showFor(ms, kind) {
    const w = ensure();
    place();
    if (!w.isVisible()) {
      w.showInactive();
      mouseIn = null;
    }
    w.webContents.invalidate(); // a fresh frame for what's just been sent
    startWatch();
    shownAt = Date.now();
    startTimer(ms);
    dispatch({ type: 'show', kind });
  }

  /** The card goes: it fades (the orb off) or folds back into the orb. reason: 'timer', 'close' or 'other'. */
  function hide(reason = 'other') {
    if (speakingNow || (current && current.summary)) stopSpeaking();
    clearTimeout(timer);
    timer = null;
    const wasShown = !!shownAt;
    shownAt = 0;
    thinkingNow = null;
    pausedLeft = 0;
    videoOn = false;
    send('card-hide', {});
    if (wasShown) dispatch({ type: 'fold', reason }); // (the orb off: only its state, nothing on screen)
    if (orb.on) {
      mouseOver = false;
      return;
    }
    // After the fade.
    setTimeout(() => {
      if (!shownAt) drop();
    }, 260);
  }

  const look = () => ({ strings: opts.strings(), scale: scale(), bottom: prefs.corner === 'bl' || prefs.corner === 'br', right: prefs.corner === 'tr' || prefs.corner === 'br', maxHeight: maxHeight(), speak: prefs.speak, orb: orb.on });

  const speak = () => {
    const text = spokenText(current);
    if (text && prefs.speak && opts.onSpeak) opts.onSpeak({ id: current.id, text });
  };
  function stopSpeaking() {
    if (opts.onSpeak) opts.onSpeak(null);
    if (speakingNow) { speakingNow = false; resume(); }
  }
  /** The card's speaker button and the orb's Mute read-aloud: reading the summary aloud off (it stops now) or on again. */
  function toggleSpeak(readNow) {
    prefs.speak = !prefs.speak;
    if (opts.onSpeakPref) opts.onSpeakPref(prefs.speak);
    if (prefs.speak) { if (readNow) speak(); }
    else stopSpeaking();
    if (current && shownAt) send('card-show', { ...current, ...look() });
    send('orb-state', orbLook());
  }

  function pause() {
    if (!shownAt || pausedLeft || thinkingNow) return;
    clearTimeout(timer);
    pausedLeft = Math.max(1000, endsAt - Date.now());
    send('card-timer', { left: pausedLeft, total, paused: true });
  }
  function resume() {
    if (!shownAt || !pausedLeft || mouseOver || speakingNow || videoOn) return;
    const left = pausedLeft;
    pausedLeft = 0;
    endsAt = Date.now() + left;
    timer = setTimeout(() => hide('timer'), left);
    send('card-timer', { left, total, paused: false });
  }

  /** The last answer back on the card (the orb's left click, the quick menu's "Last card"): never read aloud. */
  function recall() {
    if (!last) return false;
    if (speakingNow) stopSpeaking();
    thinkingNow = null;
    current = { ...last, at: Date.now() };
    moreState = { more: false, part: 0, parts: 0 };
    const warns = current.steps.filter((s) => s.kind === 'warning');
    showFor(readingMs(`${current.title} ${current.summary || current.text.split(/\s+/).slice(0, 120).join(' ')}`, warns.length > 0), 'answer');
    send('card-show', { ...current, ...look() });
    return true;
  }
  /** No answer yet: one line on how to ask (the quick menu's keys, the controller's combo). */
  function hint() {
    if (speakingNow) stopSpeaking();
    thinkingNow = null;
    showFor(HINT_MS, 'hint');
    send('card-show', { state: 'hint', ...look() });
  }

  // From the page: its height (the window follows), whether More has more, the mouse over it, its buttons.
  const fromCard = (event) => alive() && event.sender === win.webContents;
  ipcMain.on('card-size', (event, h) => {
    if (!fromCard(event)) return;
    height = Math.max(60, Math.round(Number(h) || 0) + 2);
    place();
  });
  ipcMain.on('card-state', (event, s) => {
    if (!fromCard(event)) return;
    moreState = { more: !!(s && s.more), part: Number(s && s.part) || 0, parts: Number(s && s.parts) || 0 };
  });
  ipcMain.on('card-action', (event, what) => {
    if (!fromCard(event)) return;
    if (what === 'close') return void api.hide();
    if (what === 'open') opts.onAction('open', current);
    // The speaker button: reading the summary aloud off (it stops now) or on again (it reads this one).
    if (what === 'speak') toggleSpeak(true);
    // Pin beside the game (pin.cjs): the video goes on in its own small window (the card's player has stopped).
    const p = current && current.picture;
    if (what === 'pin' && p && p.videoId) require('./pin.cjs').open({ kind: 'video', videoId: p.videoId, start: p.start, title: p.title });
    else if (what === 'pin' && p && !p.video && !p.wide && /^https:\/\//.test(p.url)) require('./pin.cjs').open({ kind: 'picture', url: p.url, title: p.credit });
  });
  // The mini player (Nov 20 2026): while a video plays the card stays (its time waits; reading aloud stops). Stopped,
  // the card has at least 15 s more.
  ipcMain.on('card-video', (event, on) => {
    if (!fromCard(event) || !shownAt) return;
    if (on && !videoOn) {
      videoOn = true;
      if (speakingNow) stopSpeaking();
      pause();
    } else if (!on && videoOn) {
      videoOn = false;
      if (pausedLeft) pausedLeft = Math.max(pausedLeft, 15000);
      resume();
    }
  });
  // The orb's parts the mouse may reach (window coordinates), as the page lays them out.
  ipcMain.on('orb-hits', (event, list) => {
    if (!fromCard(event)) return;
    hits = (Array.isArray(list) ? list : []).slice(0, 8).map((r) => ({
      id: ['orb', 'card', 'menu'].includes(r && r.id) ? r.id : 'card',
      x: Number(r.x) || 0, y: Number(r.y) || 0, w: Math.max(0, Number(r.w) || 0), h: Math.max(0, Number(r.h) || 0),
    }));
  });
  ipcMain.on('orb-action', (event, what) => {
    if (!fromCard(event) || !orb.on) return;
    const l = orbState.look(orb);
    // A click on the orb with no card to bring back (owner, Nov 20 2026): the quick menu's fan opens (or stays), instead
    // of the how-to-ask line that sat there until its time ran out.
    if (what === 'click' && l.orb && orbState.clickAction(!!last) !== 'recall') {
      dwellDone = true;
      if (opts.onOrb) opts.onOrb('fan-click');
      return;
    }
    // A click or the menu on the orb: a fan the mouse opened makes way (main.cjs).
    if ((what === 'click' && l.orb) || (what === 'menu' && !orb.menu)) {
      dwellDone = true; // (not again until the mouse has left the orb)
      if (opts.onOrb) opts.onOrb('busy');
    }
    if (what === 'click' && l.orb) {
      if (orbState.clickAction(!!last) === 'recall') recall();
      else hint();
      return;
    }
    if (what === 'menu') return void dispatch({ type: 'menu', open: !orb.menu });
    if (what === 'menu-close') return void dispatch({ type: 'menu', open: false });
    if (!l.menu) return;
    dispatch({ type: 'menu', open: false });
    if (what === 'mute') return void toggleSpeak(false);
    if (what === 'hide') return void dispatch({ type: 'hide' });
    if (['open', 'log', 'ask'].includes(what) && opts.onOrb) opts.onOrb(what);
  });

  const api = {
    /** Asked over the game: the card shows the question and what's happening. mode: 'pad' or 'keys' (its hints). */
    thinking({ question, mode, place: where } = {}) {
      current = null;
      thinkingNow = { state: 'thinking', question: String(question || ''), mode: mode === 'pad' ? 'pad' : 'keys', place: String(where || '') };
      showFor(THINKING_MS, 'thinking');
      send('card-show', { ...thinkingNow, ...look() });
    },
    /** What's happening while it thinks: the screenshot it took, the question sent (with Pro or Fast). */
    stage(s) {
      if (!thinkingNow || !s) return;
      if (typeof s.screen === 'string' && s.screen.startsWith('data:image')) thinkingNow.screen = s.screen;
      if (s.sent) {
        thinkingNow.sent = true;
        thinkingNow.model = s.model === 'Pro' || s.model === 'Fast' ? s.model : '';
      }
      if (typeof s.place === 'string' && s.place) thinkingNow.place = s.place;
      send('card-show', { ...thinkingNow, ...look() });
    },
    /** An answer (the newest while the card is up): it replaces whatever the card showed. */
    answer(a) {
      if (!a || !a.text) return;
      const mode = (thinkingNow && thinkingNow.mode) || (current && current.mode) || 'keys';
      // What was asked, as the card said it while thinking ("Screenshot & ask", a quick question), not the app's
      // stand-in text for a screenshot or a voice question.
      const asked = (thinkingNow && thinkingNow.question) || (current && current.id === String(a.id || '') && current.question) || '';
      thinkingNow = null;
      const steps = (Array.isArray(a.steps) ? a.steps : []).slice(0, 8).map((s) => ({ kind: s.kind === 'warning' ? 'warning' : 'step', label: String(s.label || '').slice(0, 160), where: String(s.where || '').slice(0, 160) }));
      current = {
        state: 'answer', mode,
        id: String(a.id || ''), question: asked || String(a.question || ''), title: String(a.title || ''), text: String(a.text || '').slice(0, 6000),
        steps, model: a.model === 'Pro' || a.model === 'Fast' ? a.model : '', place: String(a.place || ''), combat: !!a.combat,
        picture: pictureOf(a.picture),
        // What to do now, shown instead of the answer's start and read aloud (Nov 19 2026).
        summary: String(a.summary || '').slice(0, 400),
        // Immersive mode (Nov 20 2026): the card's storybook look.
        immersive: !!a.immersive,
        at: Date.now(),
      };
      last = current;
      moreState = { more: false, part: 0, parts: 0 };
      if (speakingNow) stopSpeaking();
      if (current.summary) {
        const warns = steps.filter((s) => s.kind === 'warning');
        showFor(readingMs(`${current.title} ${current.summary} ${warns.map((s) => s.label).join(' ')}`, warns.length > 0), 'answer');
        send('card-show', { ...current, ...look() });
        speak();
        return;
      }
      const shown = steps.length ? `${current.text.split(/\s+/).slice(0, 60).join(' ')} ${steps.map((s) => `${s.label} ${s.where}`).join(' ')}` : current.text.split(/\s+/).slice(0, 180).join(' ');
      showFor(readingMs(`${current.title} ${shown}`, steps.some((s) => s.kind === 'warning')), 'answer');
      send('card-show', { ...current, ...look() });
      speak();
    },
    /** The same answer, updated (its picture arrived later): the card redraws without restarting its time. */
    update(a) {
      if (!current || !a || String(a.id || '') !== current.id || !shownAt) return false;
      // The same answer with new text (it changed in the app): the card shows it, with time to read it.
      const text = String(a.text || '').slice(0, 6000);
      if (text && text !== current.text) {
        current.text = text;
        current.summary = String(a.summary || '').slice(0, 400);
        current.steps = (Array.isArray(a.steps) ? a.steps : []).slice(0, 8).map((s) => ({ kind: s.kind === 'warning' ? 'warning' : 'step', label: String(s.label || '').slice(0, 160), where: String(s.where || '').slice(0, 160) }));
        moreState = { more: false, part: 0, parts: 0 };
        last = current;
        send('card-show', { ...current, ...look() });
        startTimer(readingMs(text.split(/\s+/).slice(0, 180).join(' '), false));
        return true;
      }
      const picture = pictureOf(a.picture);
      if (JSON.stringify(picture) !== JSON.stringify(current.picture)) {
        const newDrawing = !!(picture && picture.wide && !(current.picture && current.picture.wide));
        current.picture = picture;
        last = current;
        send('card-show', { ...current, ...look() });
        // A drawing arrived (a few seconds after the answer): at least 25 s more to look at it, unless paused.
        if (newDrawing && !pausedLeft && endsAt - Date.now() < 25000) startTimer(25000);
      }
      return true;
    },
    /** More of this answer: the rest in place, then the next part. Its time starts over (reading time for a part). */
    more() {
      if (!current) return;
      if (!shownAt) {
        showFor(30000, 'answer');
        send('card-show', { ...current, ...look() });
      }
      send('card-more');
      startTimer(Math.min(90000, Math.max(25000, readingMs(current.text.split(/\s+/).slice(0, 140).join(' '), false))));
    },
    /** Whether More has more to show (the quick menu then offers it first). */
    canMore: () => !!current && !!shownAt && moreState.more,
    pause,
    resume,
    /** The summary is being read aloud (true) or the reading ended (false): the card stays a little after it ends. */
    speaking(on) {
      if (!shownAt || thinkingNow) return;
      if (on && !speakingNow) {
        speakingNow = true;
        if (!pausedLeft) {
          clearTimeout(timer);
          pausedLeft = Math.max(1000, endsAt - Date.now());
          send('card-timer', { left: pausedLeft, total, paused: true });
        }
      } else if (!on && speakingNow) {
        speakingNow = false;
        if (pausedLeft) pausedLeft = Math.max(pausedLeft, 8000);
        resume();
      }
    },
    hide() {
      current = null;
      hide('close');
    },
    /** Out of sight now; the answer stays for "Open this answer" a little longer. */
    putAway() {
      if (shownAt) hide('other');
    },
    /** Showing (thinking or an answer): answers that arrive now go on it. */
    isShowing: () => !!shownAt,
    /** A question and answer the player deleted (Nov 20 2026): never brought back as the last card; off the card if it's up. */
    forget(id) {
      if (!id) return;
      if (last && last.id === id) last = null;
      if (current && current.id === id) { current = null; if (shownAt) hide('close'); }
    },
    isThinking: () => !!thinkingNow,
    /** The answer "Open this answer" opens: the one on the card, or put away within the last 2 minutes. */
    recent() {
      return current && Date.now() - current.at < 120000 ? current : null;
    },
    /** The last answer back on the card ("Last card" in the quick menu); false with none. */
    recall,
    /** There's a last answer to bring back (and it isn't on the card now). */
    hasLast: () => !!last && !(shownAt && current && current.id === last.id),
    /** The orb is on (Settings): it stands in for the book spine and the quest log's ribbon while the panel is away. */
    orbOn: () => orb.on,
    /** The panel went away (true) or came in (false): the orb shows only while it's away. */
    setAway(away) {
      if (!!away === orb.away) return;
      dispatch({ type: 'away', away: !!away });
    },
    /**
     * Where the orb is on screen while it shows (its sphere's square, and whether it's on the right), for the quest
     * log's heads-ups beside it (in place of the spine); null otherwise.
     */
    anchor() {
      if (!alive() || !win.isVisible() || !orbState.look(orb).orb) return null;
      const b = win.getBounds();
      const g = orbState.orbGeometry(scale());
      const right = prefs.corner === 'tr' || prefs.corner === 'br';
      const bottom = prefs.corner === 'bl' || prefs.corner === 'br';
      return {
        rect: { x: right ? b.x + b.width - g.box : b.x, y: bottom ? b.y + b.height - g.box : b.y, width: g.box, height: g.box },
        right,
      };
    },
    /**
     * Where the quick menu's fan flares from (owner, Nov 19 2026), while the orb is on and the panel away: the orb's
     * centre on screen, or with a card out, the card's corner toward the screen's centre (the fan's items act on that
     * card, so it stays in view: More, the hint's next level, Open this answer). `dot`: the orb isn't showing (a card
     * is out, or Hide until next answer), so the fan draws its own hub. null otherwise (the full ring in the middle).
     */
    fanAnchor() {
      if (!orb.on || !orb.away) return null;
      const s = scale();
      const g = orbState.orbGeometry(s);
      const right = prefs.corner === 'tr' || prefs.corner === 'br';
      const bottom = prefs.corner === 'bl' || prefs.corner === 'br';
      const b = alive() ? win.getBounds() : bounds();
      const c = shownAt && hits.find((r) => r.id === 'card');
      if (c) {
        const off = Math.round(10 * s); // a little off the card's corner, toward the screen's centre
        return {
          hub: { x: Math.round(b.x + (right ? c.x - off : c.x + c.w + off)), y: Math.round(b.y + (bottom ? c.y - off : c.y + c.h + off)) },
          corner: prefs.corner, scale: s, dot: true, card: true,
        };
      }
      return {
        hub: { x: Math.round(right ? b.x + b.width - g.box / 2 : b.x + g.box / 2), y: Math.round(bottom ? b.y + b.height - g.box / 2 : b.y + g.box / 2) },
        corner: prefs.corner, scale: s, dot: !orbState.look(orb).orb, card: false,
      };
    },
    /** The fan is out of the orb (true) or gone (false): the orb glows brighter while it's out. */
    setFan(on) {
      if (fanOn === !!on) return;
      fanOn = !!on;
      send('orb-fan', fanOn);
    },
    /** The app's look changed (its theme's colour): the orb and the card redraw in it. */
    restyle() {
      send('orb-state', orbLook());
    },
    setPrefs(p) {
      const orbWas = orb.on;
      prefs = {
        size: SCALE[p && p.size] ? p.size : 'm',
        corner: ['tr', 'tl', 'br', 'bl'].includes(p && p.corner) ? p.corner : 'tr',
        speak: !(p && p.speak === false),
        orb: !(p && p.orb === false),
        orbStyle: p && p.orbStyle === 'icon' ? 'icon' : 'orb',
      };
      if (prefs.orb !== orbWas) {
        if (!prefs.orb) stopWatch();
        orb = orbState.reduce(orb, { type: 'pref', on: prefs.orb });
        applyMouseMode();
        // Turned off with nothing on the card: the window goes (the spine and the ribbon come back, main.cjs).
        if (!prefs.orb && !shownAt) drop();
        dispatch({ type: 'pref', on: prefs.orb });
      }
      if (alive()) place();
      send('orb-state', orbLook());
    },
  };
  return api;
}

module.exports = { createAnswerCard, readingMs };
