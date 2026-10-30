import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2, MapPin, Flag, Gem, CheckSquare, FileText, Target } from './icons';
import { useT } from '../i18n';
import type { Playthrough, PlayKind } from '../utils/playthrough';
import type { DoneItem } from '../utils/progressMemory';

/**
 * "Your playthrough" (roadmap item 8): everything Quest Compendium noted about the player's playthrough of this game,
 * the same things answers get: where they are, choices made, what's done, key items found, and (if they want) their
 * Notes. Every line can be edited or deleted; "Clear this game" removes it all, here and on the account.
 */
type Props = {
  open: boolean;
  onClose: () => void;
  game: string;
  memoryOn: boolean;
  place: string;
  story: string;
  onPlace: (place: string, story: string) => void;
  play: Playthrough;
  done: DoneItem[];
  onAdd: (kind: PlayKind, text: string) => void;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onEditDone: (index: number, text: string) => void;
  onRemoveDone: (index: number) => void;
  notesInAnswers: boolean;
  onNotesInAnswers: (on: boolean) => void;
  onOpenNotes: () => void;
  onClear: () => void;
  onOpenSettings: () => void;
  /** The quest log's current objective (owner, Oct 30 2026): kept with the playthrough; × stops following it. */
  objective?: { goal: string; done: number; total: number } | null;
  onClearObjective?: () => void;
};

/** One line: edited in place (saved when it loses focus or on Enter), deleted with the ×. */
function Row({ text, onSave, onDelete, label }: { text: string; onSave: (t: string) => void; onDelete: () => void; label: string }) {
  const [v, setV] = useState(text);
  useEffect(() => setV(text), [text]);
  return (
    <li className="group flex items-center gap-1.5">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v.trim() !== text && onSave(v)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label={label}
        maxLength={160}
        className="flex-1 min-w-0 h-8 px-2 rounded-md bg-transparent border border-transparent hover:border-white/10 focus:border-[var(--accent-border)] focus:bg-black/30 text-[13px] text-zinc-200 outline-none"
      />
      <button type="button" onClick={onDelete} aria-label={`${label}: ×`} className="h-7 w-7 flex-shrink-0 rounded-md text-zinc-500 hover:text-red-300 hover:bg-white/10 flex items-center justify-center cursor-pointer opacity-60 group-hover:opacity-100 focus:opacity-100">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (t: string) => void }) {
  const [v, setV] = useState('');
  const add = () => {
    if (v.trim().length >= 3) onAdd(v);
    setV('');
  };
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        placeholder={placeholder}
        maxLength={160}
        className="flex-1 min-w-0 h-8 px-2 rounded-md bg-black/20 border border-white/10 focus:border-[var(--accent-border)] text-[13px] text-zinc-200 placeholder:text-zinc-500 outline-none"
      />
      <button type="button" onClick={add} aria-label={placeholder} className="h-8 w-8 flex-shrink-0 rounded-md border border-white/10 text-zinc-300 hover:text-white hover:bg-white/10 flex items-center justify-center cursor-pointer">
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

export function PlaythroughPanel(p: Props) {
  const t = useT();
  const [place, setPlace] = useState(p.place);
  const [story, setStory] = useState(p.story);
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => { setPlace(p.place); setStory(p.story); }, [p.place, p.story, p.open]);
  useEffect(() => { if (!p.open) setConfirmClear(false); }, [p.open]);
  if (!p.open) return null;
  const choices = p.play.entries.filter((e) => e.kind === 'choice');
  const found = p.play.entries.filter((e) => e.kind === 'found');
  const savePlace = () => (place.trim() !== p.place || story.trim() !== p.story) && p.onPlace(place.trim(), story.trim());
  const section = (icon: React.ReactNode, title: string, hint: string, body: React.ReactNode) => (
    <section className="py-3 border-t border-white/[0.06] first:border-t-0">
      <h3 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-zinc-300">{icon}{title}</h3>
      <p className="mt-0.5 mb-1.5 text-[11.5px] text-zinc-500">{hint}</p>
      {body}
    </section>
  );
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={t('play.title')}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); } }}>
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl border border-[var(--accent-border)] bg-[#0d0e15] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.08]">
          <div className="min-w-0">
            <h2 className="font-fantasy font-bold text-sm text-white truncate">{t('play.title')}</h2>
            <p className="text-[11px] text-zinc-500 truncate">{p.game}</p>
          </div>
          <button type="button" onClick={p.onClose} aria-label={t('play.close')} className="ml-auto h-8 w-8 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 flex items-center justify-center cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-2">
          <p className="pt-3 text-[12px] leading-relaxed text-zinc-400">{t('play.intro')}</p>
          {!p.memoryOn && (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-[12px] text-amber-100">
              {t('play.off')}{' '}
              <button type="button" onClick={p.onOpenSettings} className="font-semibold underline cursor-pointer">{t('play.openSettings')}</button>
            </div>
          )}
          {section(<MapPin className="w-3.5 h-3.5 text-[var(--accent-color)]" />, t('play.where'), t('play.whereHint'),
            <div className="grid gap-1.5">
              <input value={place} onChange={(e) => setPlace(e.target.value)} onBlur={savePlace} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} placeholder={t('play.placePh')} aria-label={t('play.placePh')} maxLength={80}
                className="h-8 px-2 rounded-md bg-black/20 border border-white/10 focus:border-[var(--accent-border)] text-[13px] text-zinc-200 placeholder:text-zinc-500 outline-none" />
              <input value={story} onChange={(e) => setStory(e.target.value)} onBlur={savePlace} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} placeholder={t('play.storyPh')} aria-label={t('play.storyPh')} maxLength={100}
                className="h-8 px-2 rounded-md bg-black/20 border border-white/10 focus:border-[var(--accent-border)] text-[13px] text-zinc-200 placeholder:text-zinc-500 outline-none" />
            </div>)}
          {p.objective && section(<Target className="w-3.5 h-3.5 text-[var(--accent-color)]" />, t('play.objective'), t('play.objectiveHint'),
            <div className="flex items-center gap-2 text-[13px] text-zinc-200">
              <span className="flex-1 min-w-0 truncate">{p.objective.goal}</span>
              <span className="font-mono text-[11px] text-zinc-500">{t('tracker.logProgress', { n: p.objective.done, total: p.objective.total })}</span>
              {p.onClearObjective && <button type="button" onClick={p.onClearObjective} aria-label={t('tracker.logClearNow')} title={t('tracker.logClearNow')} className="text-zinc-500 hover:text-white cursor-pointer"><X className="w-3.5 h-3.5" /></button>}
            </div>)}
          {section(<Flag className="w-3.5 h-3.5 text-[var(--accent-color)]" />, t('play.choices'), t('play.choicesHint'),
            <>
              <ul className="space-y-0.5">{choices.map((e) => <Row key={e.id} text={e.text} label={t('play.choices')} onSave={(v) => p.onEdit(e.id, v)} onDelete={() => p.onRemove(e.id)} />)}</ul>
              <AddRow placeholder={t('play.addChoice')} onAdd={(v) => p.onAdd('choice', v)} />
            </>)}
          {section(<CheckSquare className="w-3.5 h-3.5 text-[var(--accent-color)]" />, t('play.done'), t('play.doneHint'),
            p.done.length ? <ul className="space-y-0.5">{p.done.map((d, i) => <Row key={`${d.at}:${i}`} text={d.text} label={t('play.done')} onSave={(v) => p.onEditDone(i, v)} onDelete={() => p.onRemoveDone(i)} />)}</ul>
              : <p className="text-[12px] text-zinc-500">{t('play.nothingYet')}</p>)}
          {section(<Gem className="w-3.5 h-3.5 text-[var(--accent-color)]" />, t('play.found'), t('play.foundHint'),
            <>
              <ul className="space-y-0.5">{found.map((e) => <Row key={e.id} text={e.text} label={t('play.found')} onSave={(v) => p.onEdit(e.id, v)} onDelete={() => p.onRemove(e.id)} />)}</ul>
              <AddRow placeholder={t('play.addFound')} onAdd={(v) => p.onAdd('found', v)} />
            </>)}
          {section(<FileText className="w-3.5 h-3.5 text-[var(--accent-color)]" />, t('play.notes'), t('play.notesHint'),
            <div className="flex items-center gap-3">
              <button type="button" role="switch" aria-checked={p.notesInAnswers} aria-label={t('play.notesUse')} onClick={() => p.onNotesInAnswers(!p.notesInAnswers)}
                className={`w-11 h-6 flex-shrink-0 rounded-full p-0.5 flex transition-colors cursor-pointer ${p.notesInAnswers ? 'bg-[var(--accent-color)] justify-end' : 'bg-white/15 justify-start'}`}>
                <span className="w-5 h-5 rounded-full bg-[#16101f]" />
              </button>
              <span className="text-[12.5px] text-zinc-300 flex-1">{t('play.notesUse')}</span>
              <button type="button" onClick={p.onOpenNotes} className="text-[12px] font-semibold text-[var(--accent-color)] hover:brightness-125 cursor-pointer">{t('play.openNotes')} →</button>
            </div>)}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.08]">
          {confirmClear ? (
            <>
              <span className="text-[12px] text-zinc-300 flex-1">{t('play.clearSure')}</span>
              <button type="button" onClick={() => setConfirmClear(false)} className="h-8 px-3 rounded-lg text-xs font-semibold text-zinc-400 hover:text-white cursor-pointer">{t('play.cancel')}</button>
              <button type="button" onClick={() => { p.onClear(); setConfirmClear(false); }} className="h-8 px-3 rounded-lg bg-red-500/20 border border-red-400/40 text-xs font-bold text-red-100 hover:bg-red-500/30 cursor-pointer">{t('play.clearYes')}</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setConfirmClear(true)} className="h-8 px-3 rounded-lg border border-white/10 text-xs font-semibold text-zinc-300 hover:text-red-200 hover:border-red-400/40 cursor-pointer">{t('play.clear')}</button>
              <span className="ml-auto text-[11px] text-zinc-500">{t('play.privacy')}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
