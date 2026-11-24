/**
 * The orb's state (owner, Nov 19 2026: "a glowing orb floating there that contorts itself into a card and then back up
 * to the orb again"). Pure logic, shared by answerCard.cjs and its tests (tests/orbState.test.cjs).
 *
 * With the orb on (Settings → Pop-up answers), the pop-up card's window stays over the game while the panel is away,
 * showing a glass orb in the card's corner instead of the book spine / the quest log's ribbon at the screen edge. Pop-up
 * answers grow out of it and fold back into it.
 *
 *   on      the setting (off: the card as before, and the spine / ribbon at the edge)
 *   away    the panel is away (the orb only shows then; the panel has its own ways back)
 *   view    'orb' (resting), 'card' (the card is out: thinking, an answer, or the how-to-ask hint), 'hidden' (Hide until
 *           next answer: the next card brings it back)
 *   kind    what the card shows or last showed: 'thinking', 'answer' or 'hint'
 *   menu    its right-click menu is open
 *   dot     a card went back in by itself (its time ran out) before the player was done with it: a dot and a soft pulse
 *           until it's brought back (a left click) or another card comes
 */

const KINDS = ['thinking', 'answer', 'hint'];

function createOrbState() {
  return { on: true, away: false, view: 'orb', kind: '', menu: false, dot: false };
}

/** The next state for an event. Never changes the one it's given. */
function reduce(s, ev) {
  const t = ev && ev.type;
  const n = { ...s };
  switch (t) {
    case 'pref':
      n.on = !!ev.on;
      if (!n.on) { n.menu = false; n.dot = false; if (n.view === 'hidden') n.view = 'orb'; }
      return n;
    case 'away':
      n.away = !!ev.away;
      if (!n.away) n.menu = false;
      return n;
    case 'show': // a card comes out of the orb (thinking, an answer, a brought-back answer, the hint)
      n.view = 'card';
      n.kind = KINDS.includes(ev.kind) ? ev.kind : 'answer';
      n.menu = false;
      n.dot = false;
      return n;
    case 'fold': { // the card goes back in: its time ran out ('timer'), ✕ or Open ('close'), or put away ('other')
      if (n.view !== 'card') return n;
      n.view = 'orb';
      // (No dot any more for an answer whose time ran out: owner, Nov 23 2026, "get rid of the dot notification that
      // can sometimes be on the floating orb. It's pointless.")
      return n;
    }
    case 'menu':
      n.menu = !!ev.open && n.on && n.away && n.view === 'orb';
      return n;
    case 'hide': // Hide until next answer
      if (n.view === 'card') return n;
      n.view = 'hidden';
      n.menu = false;
      return n;
    default:
      return n;
  }
}

/** What's on screen: the window, the orb, its dot, its menu. The card shows in both modes; the orb only with it on. */
function look(s) {
  const orb = s.on && s.away && s.view === 'orb';
  return { window: s.view === 'card' || orb, orb, card: s.view === 'card', dot: orb && s.dot, menu: orb && s.menu };
}

/** A left click on the orb: the last answer back (never read aloud), or, with none yet, how to ask. */
const clickAction = (hasLast) => (hasLast ? 'recall' : 'hint');

/**
 * The orb's size at a card size's scale (Small 0.85 / Medium 1 / Large 1.3): its sphere's diameter, and the square it's
 * drawn in (room for the glow), with the sphere's offset from the window's corner. Smaller and closer to the corner
 * (owner, Nov 19 2026, after the first screenshots): a 40 px sphere at Medium (was 60) in a 66 px square (was 104); the
 * window sits on the screen's corner with the orb in it, so the sphere is 13 px from the edges (was 46).
 */
function orbGeometry(scale) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  const d = Math.round(40 * s);
  const box = Math.round(66 * s);
  return { d, box, pad: Math.round((box - d) / 2) };
}

module.exports = { createOrbState, reduce, look, clickAction, orbGeometry };
