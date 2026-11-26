/**
 * The new web app (owner, Nov 25 2026: "It is just the desktop app stuck on the web. We need to redesign it from scratch
 * and then maybe we can use that as a pilot for a mobile app"). Phone first: pick the game you're playing (any game on
 * any platform), ask by typing, a photo of the screen or your voice, and read one clear answer at a time. Part 1: Start,
 * Ask and Answer. Behind a switch (main.tsx: ?new=1) until it replaces the old screens.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, ArrowUp, BookOpen, Camera, Gamepad2, MapPin, Mic, Search, X, LogOut, MessageCircle } from 'lucide-react';
import './web.css';
import { ask, fetchVisual, forgetGuest, searchGames, watchWho, type Game, type Place, type Turn, type Who } from './webApi';
import { gameId, loadGame, rememberGame, recentGames, saveGame } from './webStore';
import { SourceLinks } from '../components/SourceLinks';
import { VisualCard } from '../components/VisualCard';
import { GetAppCard, getAppDue } from '../components/GetAppCard';
import { useGuideIndex, type GuideIndexGame } from '../utils/guideIndex';
import { quickChips, quickLabelKey, type QuickId } from '../utils/quickQuestions';
import { LOCALES, detectLocale, useT } from '../i18n';
import { isPhone } from '../utils/source';
import { logOut, signInWithGoogle, signInWithGoogleRedirect } from '../lib/firebase';
import { markAsked } from '../utils/newVersionReload';

const SITE = 'https://questcompendium.com';
const MD_PLUGINS = [remarkGfm];
const Link = (p: any) => <a {...p} target="_blank" rel="noopener noreferrer" />;
const norm = (s: string) => s.toLowerCase().replace(/[™®©:'’.\-]/g, '').replace(/\s+/g, ' ').trim();

function useLanguage(): string {
  return useMemo(() => {
    const loc = detectLocale();
    const l = LOCALES.find((x) => x.id === loc) || LOCALES[0];
    document.documentElement.lang = l.htmlLang;
    return l.aiName;
  }, []);
}

/** A photo or screenshot, made small enough to send (longest side 1600 px), and a preview copy. */
function shrink(file: Blob): Promise<{ full: string; thumb: string } | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const draw = (max: number, q: number) => {
          const s = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * s);
          c.height = Math.round(img.height * s);
          c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
          return c.toDataURL('image/jpeg', q);
        };
        resolve({ full: draw(1600, 0.85), thumb: draw(320, 0.7) });
      };
      img.onerror = () => resolve(null);
      img.src = String(reader.result || '');
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------- account

function AccountSheet({ who, onClose }: { who: Who; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const signIn = async () => {
    setBusy(true);
    setErr('');
    try {
      await signInWithGoogle();
      forgetGuest();
      onClose();
    } catch (e: any) {
      // A blocked pop-up (phones, some browsers): the same sign-in on its own page.
      if (/popup/i.test(String(e?.code || e?.message || ''))) {
        await signInWithGoogleRedirect().catch(() => setErr('Sign-in didn’t open. Try again.'));
      } else if (!/cancelled|closed/i.test(String(e?.code || ''))) setErr('Sign-in didn’t work. Try again.');
    }
    setBusy(false);
  };
  return (
    <div className="w-sheet-back" onClick={onClose}>
      <div className="w-sheet" role="dialog" aria-label="Account" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="w-head" style={{ fontSize: 18 }}>{who.user ? 'Your account' : 'Sign in'}</div>
          <button className="w-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {who.user ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <p style={{ margin: 0, color: 'var(--w-dim)' }}>Signed in as <b style={{ color: 'var(--w-ink)' }}>{who.user.displayName || who.user.email || 'you'}</b>.</p>
            <button className="w-btn ghost" onClick={() => void logOut().then(onClose)}><LogOut size={16} /> Sign out</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            <p style={{ margin: 0, color: 'var(--w-dim)' }}>More questions every day, and your games kept on all your devices, including the Windows app and Steam Deck.</p>
            <button className="w-btn primary" disabled={busy} onClick={signIn}>Continue with Google</button>
            {err && <p style={{ margin: 0, color: 'var(--w-bad)', fontSize: 13.5 }}>{err}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function AccountButton({ who, onOpen }: { who: Who; onOpen: () => void }) {
  const initial = (who.user?.displayName || who.user?.email || '?').trim().charAt(0).toUpperCase();
  return who.user ? (
    <button className="w-icon-btn" onClick={onOpen} aria-label="Your account" style={{ borderRadius: 999, background: 'var(--w-acc-dim)', color: 'var(--w-acc)', fontWeight: 700 }}>{initial}</button>
  ) : (
    <button className="w-chip" onClick={onOpen} style={{ padding: '6px 12px', fontSize: 13 }}>Sign in</button>
  );
}

// ---------------------------------------------------------------- start

function Cover({ src, w, h }: { src?: string; w: number; h: number }) {
  const [bad, setBad] = useState(false);
  return src && !bad ? <img className="w-cover" src={src} alt="" width={w} height={h} style={{ width: w, height: h }} onError={() => setBad(true)} loading="lazy" /> : <div className="w-cover" style={{ width: w, height: h, display: 'grid', placeItems: 'center', color: 'var(--w-faint)' }}><Gamepad2 size={Math.min(w, h) / 2.4} /></div>;
}

function Start({ who, onPick, onAccount }: { who: Who; onPick: (g: Game) => void; onAccount: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Game[] | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef('');
  const { games: guides } = useGuideIndex() as { games: GuideIndexGame[] | null };
  const recent = useMemo(() => recentGames(), []);
  const popular = useMemo(() => (guides || []).slice().sort((a, b) => (b.players || 0) - (a.players || 0) || (b.checked || 0) - (a.checked || 0)).slice(0, 8), [guides]);

  useEffect(() => {
    const term = q.trim();
    latest.current = term;
    if (term.length < 2) { setHits(null); setBusy(false); return; }
    setBusy(true);
    const id = setTimeout(async () => {
      const r = await searchGames(who, term);
      if (latest.current !== term) return;
      setHits(r);
      setBusy(false);
    }, 300);
    return () => clearTimeout(id);
  }, [q, who]);

  const fromGuide = (g: GuideIndexGame): Game => ({ name: g.game.replace(/[™®]/g, ''), appId: 0, art: g.art, guide: true });

  return (
    <div className="w-col" style={{ paddingTop: 18, paddingBottom: 48, display: 'grid', gap: 26 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="w-head" style={{ fontSize: 15, color: 'var(--w-dim)' }}>Quest Compendium</div>
        <AccountButton who={who} onOpen={onAccount} />
      </header>
      <section style={{ display: 'grid', gap: 14 }}>
        <h1 className="w-head" style={{ fontSize: 'clamp(26px, 7vw, 34px)', margin: 0 }}>What are you playing?</h1>
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--w-faint)' }} />
          <input id="qcw-game-search" className="w-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any game" autoComplete="off" enterKeyHint="search" />
        </div>
        {q.trim().length >= 2 && (
          <div className="w-card" style={{ padding: 6 }}>
            {busy && !hits && <div style={{ padding: 12, color: 'var(--w-dim)', fontSize: 14 }}>Searching…</div>}
            {(hits || []).slice(0, 8).map((g) => (
              <button key={`${g.appId}-${g.name}`} className="w-row" onClick={() => onPick(g)}>
                <Cover src={g.art} w={42} h={56} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--w-dim)' }}>{g.platforms}</div>
                </div>
                {g.guide && <span className="w-guide">✓ guide</span>}
              </button>
            ))}
            {hits && !hits.some((g) => norm(g.name) === norm(q)) && (
              <button className="w-row" onClick={() => onPick({ name: q.trim(), appId: 0 })}>
                <div className="w-cover" style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', color: 'var(--w-acc)' }}><MessageCircle size={18} /></div>
                <div style={{ fontSize: 14 }}>{hits.length ? 'Not listed?' : 'Nothing found.'} <span style={{ color: 'var(--w-acc)', fontWeight: 600 }}>Ask about “{q.trim()}” anyway</span></div>
              </button>
            )}
          </div>
        )}
      </section>
      {q.trim().length < 2 && recent.length > 0 && (
        <section style={{ display: 'grid', gap: 10 }}>
          <div className="w-label">Your games</div>
          <div style={{ display: 'grid', gap: 2 }}>
            {recent.slice(0, 5).map((g) => (
              <button key={gameId(g)} className="w-row" style={{ padding: 8 }} onClick={() => onPick(g)}>
                <Cover src={g.art} w={36} h={48} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                  {loadGame(g).place?.name && <div style={{ fontSize: 12.5, color: 'var(--w-dim)' }}>{String(loadGame(g).place?.name)}</div>}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
      {q.trim().length < 2 && popular.length > 0 && (
        <section style={{ display: 'grid', gap: 10 }}>
          <div className="w-label">Games with a full guide</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {popular.map((g) => (
              <button key={g.key} onClick={() => onPick(fromGuide(g))} style={{ display: 'grid', gap: 6, textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                {g.art ? <img src={g.art} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 10, background: 'var(--w-panel)' }} /> : <div style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 10, background: 'var(--w-panel)' }} />}
                <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{g.game.replace(/[™®]/g, '')}</span>
              </button>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--w-faint)' }}>Any game works. These also have a checked guide on questcompendium.com.</p>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- one question and its answer

function Waiting() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const id = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(id); }, []);
  return (
    <div className="w-card" style={{ padding: 16, display: 'grid', gap: 8 }} aria-live="polite">
      <div className="w-dots" aria-label="Looking it up"><span /><span /><span /></div>
      <div style={{ fontSize: 13.5, color: 'var(--w-dim)' }}>{slow ? 'Checking it against sources. Good answers take up to half a minute.' : 'Looking it up…'}</div>
    </div>
  );
}

function TurnView({ turn, busy, onSignIn }: { turn: Turn; busy: boolean; onSignIn: () => void }) {
  return (
    <article id={turn.id} style={{ display: 'grid', gap: 10, scrollMarginTop: 80 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {turn.thumb && <img src={turn.thumb} alt="Your screenshot" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 8, flex: 'none' }} />}
        <h2 className="w-head" style={{ fontSize: 18, margin: 0, paddingTop: 2 }}>{turn.voice ? 'Your voice question' : turn.q}</h2>
      </div>
      {busy && !turn.answer && !turn.problem && <Waiting />}
      {turn.problem && (
        <div className="w-card" style={{ padding: 16, display: 'grid', gap: 12, borderColor: 'var(--w-acc-line)' }}>
          <div style={{ fontSize: 14.5 }}>{turn.problem.text}</div>
          {turn.problem.signIn && <div><button className="w-btn primary" onClick={onSignIn}>Sign in for more questions</button></div>}
        </div>
      )}
      {turn.answer && (
        <div className="w-card w-answer" style={{ padding: '14px 16px' }}>
          <ReactMarkdown remarkPlugins={MD_PLUGINS} components={{ a: Link }}>{turn.answer}</ReactMarkdown>
        </div>
      )}
      {turn.visual && <VisualCard visual={turn.visual} />}
      {(turn.guideRefs?.length || 0) > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {turn.guideRefs!.map((r) => (
            <a key={`${r.key}/${r.slug}/${r.name}`} className="w-chip" style={{ fontSize: 12.5, padding: '5px 11px', textDecoration: 'none' }} href={`${SITE}/guides/${r.key}/${r.slug}/`} target="_blank" rel="noopener noreferrer">
              <BookOpen size={13} /> {r.name}
            </a>
          ))}
        </div>
      )}
      {turn.sources?.length ? <SourceLinks links={turn.sources} skip={(turn.visual as any)?.page?.url} /> : null}
      {turn.getApp && <GetAppCard />}
    </article>
  );
}

// ---------------------------------------------------------------- the game: ask and answers

function GameView({ who, game, language, onBack, onAccount }: { who: Who; game: Game; language: string; onBack: () => void; onAccount: () => void }) {
  const t = useT();
  const [state, setState] = useState(() => loadGame(game));
  const [text, setText] = useState('');
  const [shot, setShot] = useState<{ full: string; thumb: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const rec = useRef<{ r: MediaRecorder; chunks: Blob[]; stream: MediaStream; cancel?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const { games: guides } = useGuideIndex() as { games: GuideIndexGame[] | null };
  const guide = useMemo(() => (guides || []).find((g) => norm(g.game) === norm(game.name)), [guides, game.name]);

  useEffect(() => saveGame(game, state), [game, state]);
  // A new question (and the last one on opening the game): its heading at the top, so the answer reads from its start.
  const lastId = state.turns[state.turns.length - 1]?.id;
  useEffect(() => { if (lastId) document.getElementById(lastId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [lastId]);

  // A screenshot pasted anywhere on the page (PC): attached to the next question.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (!f) return;
      e.preventDefault();
      setShot(await shrink(f));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const update = (id: string, patch: Partial<Turn>) => setState((s) => ({ ...s, turns: s.turns.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  const send = async (o: { question: string; quick?: QuickId; audio?: string }) => {
    if (busy) return;
    const image = shot?.full;
    const typed = !o.audio && !!o.question.trim();
    const question = o.question.trim() || (image ? t('chat.defaultShotQ') : '');
    if (!question && !o.audio) return;
    markAsked();
    // A screenshot asked about without words: the heading says so; the server still gets the full instruction.
    const turn: Turn = { id: `t${Date.now()}`, q: typed ? question : image ? 'About your screenshot' : question, at: Date.now(), ...(shot ? { thumb: shot.thumb } : {}), ...(o.audio ? { voice: true } : {}) };
    const history = state.turns;
    setState((s) => ({ ...s, turns: [...s.turns, turn] }));
    setText('');
    setShot(null);
    setBusy(true);
    const r = await ask(who, { game, question: o.audio ? t('chat.voiceMessage') : question, image, audio: o.audio, quick: o.quick, history, place: state.place, language });
    setBusy(false);
    if (r.problem) { update(turn.id, { problem: r.problem }); return; }
    update(turn.id, { answer: r.answer, sources: r.sources, guideRefs: r.guideRefs, ...(getAppDue() ? { getApp: true } : {}) });
    if (r.place) setState((s) => ({ ...s, place: r.place as Place }));
    const visual = await fetchVisual(who, { game, question, answer: r.answer || '', shotOnly: !typed });
    if (visual) update(turn.id, { visual });
  };

  const startVoice = async () => {
    if (recording) { rec.current?.r.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.current = { r, chunks, stream };
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((x) => x.stop());
        setRecording(false);
        const cancelled = rec.current?.cancel;
        rec.current = null;
        if (cancelled || !chunks.length) return;
        const reader = new FileReader();
        reader.onloadend = () => void send({ question: '', audio: String(reader.result || '') });
        reader.readAsDataURL(new Blob(chunks, { type: r.mimeType || 'audio/webm' }));
      };
      r.start();
      setRecording(true);
    } catch {
      alertOnce('The microphone isn’t available. Check that this site may use it.');
    }
  };
  const cancelVoice = () => { if (rec.current) { rec.current.cancel = true; rec.current.r.stop(); } };

  const asked = state.turns.length > 0;
  const chips = quickChips({ asked }).shown;
  const canSend = !busy && (!!text.trim() || !!shot);

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 15, background: 'rgba(12,13,20,0.94)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--w-line)' }}>
        <div className="w-col" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 10, paddingBottom: 10 }}>
          <button className="w-icon-btn" onClick={onBack} aria-label="Your games" style={{ background: 'none' }}><ArrowLeft size={20} /></button>
          <Cover src={game.art} w={30} h={40} />
          <div style={{ minWidth: 0, flex: 1, display: 'grid', gap: 3 }}>
            <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{game.name}</div>
            {state.place?.name ? <div style={{ minWidth: 0, overflow: 'hidden' }}><span className="w-place"><MapPin size={12} /><span>{String(state.place.name)}</span></span></div> : null}
          </div>
          <AccountButton who={who} onOpen={onAccount} />
        </div>
      </header>

      <main className="w-col" style={{ flex: 1, display: 'grid', alignContent: 'start', gap: 28, paddingTop: 20, paddingBottom: 190 }}>
        {!asked && (
          <section style={{ display: 'grid', gap: 16, paddingTop: 12 }}>
            <h1 className="w-head" style={{ fontSize: 'clamp(24px, 6.5vw, 30px)', margin: 0 }}>Ask anything about {game.name}</h1>
            <p style={{ margin: 0, color: 'var(--w-dim)' }}>{isPhone() ? 'Type it, say it, or snap a photo of your screen.' : 'Type it, say it, or paste a screenshot (Ctrl+V).'}</p>
            {guide && (
              <a className="w-card" href={`${SITE}/guides/${guide.key}/`} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, textDecoration: 'none', color: 'inherit' }}>
                <BookOpen size={20} style={{ color: 'var(--w-acc)', flex: 'none' }} />
                <span style={{ fontSize: 14 }}><b>The {guide.game.replace(/[™®]/g, '')} guide</b><br /><span style={{ color: 'var(--w-dim)' }}>Checked against sources, and answers use it too.</span></span>
              </a>
            )}
          </section>
        )}
        {state.turns.map((turn, i) => (
          <TurnView key={turn.id} turn={turn} busy={busy && i === state.turns.length - 1} onSignIn={onAccount} />
        ))}
        {!busy && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {chips.map((id) => (
              <button key={id} className="w-chip" onClick={() => void send({ question: t(quickLabelKey(id)), quick: id })}>{t(quickLabelKey(id))}</button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </main>

      {/* The ask box, at the thumb, above the tab bar. */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(58px + env(safe-area-inset-bottom, 0px))', zIndex: 18, background: 'linear-gradient(to top, var(--w-bg) 70%, transparent)', paddingTop: 14, pointerEvents: 'none' }}>
        <div className="w-col" style={{ pointerEvents: 'auto' }}>
          {shot && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8, background: 'var(--w-panel)', border: '1px solid var(--w-line)', borderRadius: 12, padding: 6 }}>
              <img src={shot.thumb} alt="Attached screenshot" style={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 7 }} />
              <span style={{ fontSize: 13, color: 'var(--w-dim)' }}>Screenshot attached</span>
              <button className="w-icon-btn" style={{ width: 30, height: 30, background: 'none' }} onClick={() => setShot(null)} aria-label="Remove the screenshot"><X size={16} /></button>
            </div>
          )}
          {recording ? (
            <div className="w-card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderColor: 'var(--w-bad)' }}>
              <button className="w-icon-btn" onClick={cancelVoice} aria-label="Cancel"><X size={18} /></button>
              <div style={{ flex: 1, fontSize: 14.5 }}>Listening… tap send when you’re done</div>
              <button className="w-icon-btn w-send" onClick={() => rec.current?.r.stop()} aria-label="Send the voice question"><ArrowUp size={20} /></button>
            </div>
          ) : (
            <div className="w-card" style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: 6 }}>
              <button className="w-icon-btn" onClick={() => fileRef.current?.click()} aria-label={isPhone() ? 'Take a photo of your screen' : 'Add a screenshot'} style={{ background: 'none' }}><Camera size={20} /></button>
              <input ref={fileRef} type="file" accept="image/*" {...(isPhone() ? { capture: 'environment' as any } : {})} hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setShot(await shrink(f)); }} />
              <textarea
                id="qcw-question"
                ref={boxRef}
                rows={1}
                value={text}
                onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`; }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isPhone()) { e.preventDefault(); if (canSend) void send({ question: text }); } }}
                placeholder={shot ? 'Ask about this screenshot' : game.name.length <= 16 ? `Ask about ${game.name}` : 'Ask anything'}
                style={{ flex: 1, minWidth: 0, resize: 'none', border: 0, outline: 'none', background: 'transparent', color: 'var(--w-ink)', font: 'inherit', fontSize: 16, padding: '9px 4px', maxHeight: 140 }}
              />
              {!text.trim() && !shot ? (
                <button className="w-icon-btn" onClick={startVoice} disabled={busy} aria-label="Ask out loud" style={{ background: 'none' }}><Mic size={20} /></button>
              ) : (
                <button className="w-icon-btn w-send" disabled={!canSend} onClick={() => void send({ question: text })} aria-label="Ask"><ArrowUp size={20} /></button>
              )}
            </div>
          )}
        </div>
      </div>

      <nav className="w-tabs" aria-label="Sections">
        <div className="w-col" style={{ display: 'flex', paddingLeft: 0, paddingRight: 0 }}>
          <button className="w-tab on" aria-current="page"><MessageCircle size={20} />Ask</button>
          {guide ? (
            <a className="w-tab" href={`${SITE}/guides/${guide.key}/`} target="_blank" rel="noopener noreferrer"><BookOpen size={20} />Guide</a>
          ) : (
            <button className="w-tab" disabled style={{ opacity: 0.45, cursor: 'default' }} title="No guide for this game yet"><BookOpen size={20} />Guide</button>
          )}
          <button className="w-tab" onClick={onBack}><Gamepad2 size={20} />Games</button>
        </div>
      </nav>
    </div>
  );
}

let alerted = false;
function alertOnce(msg: string) {
  if (alerted) return;
  alerted = true;
  window.alert(msg);
}

// ---------------------------------------------------------------- root

export default function WebApp() {
  const language = useLanguage();
  const [who, setWho] = useState<Who | null>(null);
  const [game, setGame] = useState<Game | null>(() => {
    try {
      const last = sessionStorage.getItem('qcw_open');
      return last ? (JSON.parse(last) as Game) : null;
    } catch {
      return null;
    }
  });
  const [account, setAccount] = useState(false);

  useEffect(() => {
    const prev = document.documentElement.dataset.ui;
    document.documentElement.dataset.ui = 'web';
    document.body.style.background = '#0c0d14';
    // index.html's <body> has overflow-hidden for the old full-screen app: with it the page only moved by code (jump to
    // the newest answer) and the player couldn't scroll back up through an answer (owner, Nov 25 2026).
    const hidden = document.body.classList.contains('overflow-hidden');
    document.body.classList.remove('overflow-hidden');
    return () => {
      if (prev) document.documentElement.dataset.ui = prev;
      if (hidden) document.body.classList.add('overflow-hidden');
    };
  }, []);
  useEffect(() => watchWho(setWho), []);
  useEffect(() => {
    try {
      if (game) sessionStorage.setItem('qcw_open', JSON.stringify(game));
      else sessionStorage.removeItem('qcw_open');
    } catch {
      /* fine */
    }
  }, [game]);
  // The phone's back button leaves the game for the game list rather than the site.
  useEffect(() => {
    if (!game) return;
    history.pushState({ qcw: 1 }, '');
    const onPop = () => setGame(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [game]);

  const pick = (g: Game) => {
    rememberGame(g);
    setGame(g);
  };
  // Back to the game list: through the browser's history when the game added a step to it (so it doesn't pile up).
  const back = () => {
    if ((history.state as any)?.qcw) history.back();
    else setGame(null);
  };

  return (
    <div className="qcw">
      {!who ? (
        <div style={{ minHeight: '100dvh' }} />
      ) : game ? (
        <GameView key={gameId(game)} who={who} game={game} language={language} onBack={back} onAccount={() => setAccount(true)} />
      ) : (
        <Start who={who} onPick={pick} onAccount={() => setAccount(true)} />
      )}
      {account && who && <AccountSheet who={who} onClose={() => setAccount(false)} />}
    </div>
  );
}
