/**
 * Playthrough: what Quest Compendium knows about this save, out of the menu and in its own place (owner-approved
 * redesign, Nov 25 2026). Where the player is, who they are, the party, the story so far, what's still open, choices
 * made and key items. Every line can be changed or removed; answers use it. The same record as the desktop app's.
 */
import React, { useState } from 'react';
import { MapPin, Pencil, Trash2, Check, X, BookOpen } from 'lucide-react';
import type { Place } from './webApi';
import { clearPlaythrough, editState, removeEntry, type Playthrough } from './webPlay';

function Line({ label, value, onSave, placeholder }: { label: string; value: string; onSave: (v: string) => void; placeholder: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div className="w-label">{label}</div>
      {editing ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <textarea value={v} onChange={(e) => setV(e.target.value)} rows={2} autoFocus
            style={{ flex: 1, minWidth: 0, resize: 'vertical', background: 'var(--w-panel-2)', border: '1px solid var(--w-acc-line)', borderRadius: 10, color: 'var(--w-ink)', font: 'inherit', fontSize: 15, padding: '8px 10px' }} />
          <button className="w-icon-btn w-send" aria-label="Save" onClick={() => { onSave(v.trim()); setEditing(false); }}><Check size={18} /></button>
          <button className="w-icon-btn" aria-label="Cancel" onClick={() => { setV(value); setEditing(false); }}><X size={18} /></button>
        </div>
      ) : (
        <button onClick={() => { setV(value); setEditing(true); }} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: value ? 'var(--w-ink)' : 'var(--w-faint)' }}>
          <span style={{ flex: 1, fontSize: 15 }}>{value || placeholder}</span>
          <Pencil size={14} style={{ marginTop: 4, color: 'var(--w-faint)', flex: 'none' }} />
        </button>
      )}
    </div>
  );
}

export function PlayView({ game, place, play, onChange, onOpenGuide, hasGuide }: {
  game: string;
  place: Place | null;
  play: Playthrough;
  onChange: (p: Playthrough) => void;
  onOpenGuide: () => void;
  hasGuide: boolean;
}) {
  const st = play.state;
  const choices = play.entries.filter((e) => e.kind === 'choice');
  const found = play.entries.filter((e) => e.kind === 'found');
  const [confirmClear, setConfirmClear] = useState(false);
  const empty = !place?.name && !st && !play.entries.length;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 className="w-head" style={{ fontSize: 24, margin: '6px 0 4px' }}>Your playthrough</h1>
        <p style={{ margin: 0, color: 'var(--w-dim)', fontSize: 14 }}>What Quest Compendium knows about your {game} save, so answers fit it. Change or remove anything that's wrong.</p>
      </div>

      {empty ? (
        <div className="w-card" style={{ padding: 16, color: 'var(--w-dim)', fontSize: 14.5 }}>Nothing yet. Ask a question about where you are, and this fills in by itself.</div>
      ) : (
        <>
          <section className="w-card" style={{ padding: 16, display: 'grid', gap: 8 }}>
            <div className="w-label">You are here</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <MapPin size={16} style={{ color: 'var(--w-acc)', flex: 'none' }} />
              <span style={{ fontWeight: 700, fontSize: 16 }}>{place?.name ? String(place.name) : 'Not known yet'}</span>
            </div>
            {place?.story ? <div style={{ color: 'var(--w-dim)', fontSize: 14 }}>{String(place.story)}</div> : null}
            {hasGuide && place?.name ? <button className="w-chip" style={{ justifySelf: 'start', marginTop: 4 }} onClick={onOpenGuide}><BookOpen size={14} /> This place in the guide</button> : null}
          </section>

          <section className="w-card" style={{ padding: 16, display: 'grid', gap: 14 }}>
            <Line label="You" value={st?.who || ''} placeholder="Your character, class, difficulty…" onSave={(v) => onChange(editState(play, { who: v }))} />
            <Line label="Party" value={st?.party || ''} placeholder="Who travels with you" onSave={(v) => onChange(editState(play, { party: v }))} />
            <Line label="Story so far" value={st?.story || ''} placeholder="Where you are in the story" onSave={(v) => onChange(editState(play, { story: v }))} />
          </section>

          {st?.open?.length ? (
            <section className="w-card" style={{ padding: 16, display: 'grid', gap: 8 }}>
              <div className="w-label">Still open</div>
              {st.open.map((o, i) => (
                <div key={`${i}-${o}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ flex: 1, fontSize: 15 }}>{o}</span>
                  <button className="w-icon-btn" style={{ width: 32, height: 32, background: 'none' }} aria-label={`Remove: ${o}`} onClick={() => onChange(editState(play, { open: st.open.filter((_, j) => j !== i) }))}><Trash2 size={15} /></button>
                </div>
              ))}
            </section>
          ) : null}

          {[{ label: 'Choices you made', list: choices }, { label: 'Key items', list: found }].map(({ label, list }) => list.length ? (
            <section key={label} className="w-card" style={{ padding: 16, display: 'grid', gap: 8 }}>
              <div className="w-label">{label}</div>
              {list.map((e) => (
                <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ flex: 1, fontSize: 15 }}>{e.text}</span>
                  <button className="w-icon-btn" style={{ width: 32, height: 32, background: 'none' }} aria-label={`Remove: ${e.text}`} onClick={() => onChange(removeEntry(play, e.id))}><Trash2 size={15} /></button>
                </div>
              ))}
            </section>
          ) : null)}

          <div>
            {confirmClear ? (
              <div className="w-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
                <div style={{ fontSize: 14.5 }}>Clear everything noted about this game? It's cleared on all your devices.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="w-btn primary" onClick={() => { onChange(clearPlaythrough(play)); setConfirmClear(false); }}>Clear this game</button>
                  <button className="w-btn ghost" onClick={() => setConfirmClear(false)}>Keep it</button>
                </div>
              </div>
            ) : (
              <button className="w-chip" onClick={() => setConfirmClear(true)}><Trash2 size={14} /> Clear this game</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
