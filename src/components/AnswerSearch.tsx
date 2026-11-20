import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Search, X } from './icons';
import type { GameTab } from '../types';
import { useT } from '../i18n';
import { recentAnswers, savedAnswers, searchAnswers, type FoundAnswer } from '../utils/answerFind';

/**
 * Find an answer again (owner, Nov 20 2026, idea #1): a search line at the top of the conversation (the magnifier, or
 * Ctrl+F). Typing lists matching questions and answers as you type, this game's by default or All games; with nothing
 * typed, the Saved answers and then the latest. Picking one opens its game and scrolls to it. Everything is on this
 * computer: no AI call, nothing sent.
 */
export function AnswerSearch({ tabs, activeTabId, onPick, onClose }: {
  tabs: GameTab[];
  activeTabId: string;
  onPick: (tabId: string, answerId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const scope = all ? {} : { tabId: activeTabId };
  const typed = query.trim().length > 0;
  const results = useMemo(() => (typed ? searchAnswers(tabs, query, scope) : []), [tabs, query, all, activeTabId]);
  const saved = useMemo(() => (typed ? [] : savedAnswers(tabs, scope)), [tabs, typed, all, activeTabId]);
  const recent = useMemo(() => (typed ? [] : recentAnswers(tabs, scope)), [tabs, typed, all, activeTabId]);
  const first = results[0] || saved[0] || recent[0];
  const when = (at: number) => {
    if (!at) return '';
    const d = new Date(at);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const row = (f: FoundAnswer) => (
    <li key={`${f.tabId}:${f.answerId}`}>
      <button type="button" data-qc-found={f.answerId} onClick={() => onPick(f.tabId, f.answerId)}
        className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[0.06] focus-visible:bg-white/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] cursor-pointer flex flex-col gap-0.5 min-w-0">
        <span className="flex items-center gap-2 min-w-0">
          {f.saved && <Bookmark className="w-3.5 h-3.5 flex-shrink-0 text-[var(--accent-color)]" fill="currentColor" aria-label={t('search.saved')} />}
          <span className="text-[13.5px] font-semibold text-zinc-100 truncate">{f.title || f.question}</span>
          <span className="ml-auto flex-shrink-0 text-[11px] text-zinc-500 font-mono">{all && f.game ? `${f.game} · ` : ''}{when(f.at)}</span>
        </span>
        {f.question && f.title && <span className="text-[12px] text-zinc-400 truncate">“{f.question}”</span>}
        {f.snippet && <span className="text-[12px] text-zinc-500 line-clamp-2">{f.snippet}</span>}
      </button>
    </li>
  );
  const section = (label: string, list: FoundAnswer[]) => list.length > 0 && (
    <div>
      <div className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
      <ul className="flex flex-col">{list.map(row)}</ul>
    </div>
  );

  return (
    <div data-qc-search="" className="flex-shrink-0 border-b border-white/[0.08] bg-[#0b0c12]/95 backdrop-blur-xl flex flex-col max-h-[60%] min-h-0"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="flex items-center gap-2 px-3 py-2">
        <Search className="w-4 h-4 flex-shrink-0 text-zinc-400" aria-hidden="true" />
        <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && first) { e.preventDefault(); onPick(first.tabId, first.answerId); } }}
          placeholder={t('search.placeholder')} aria-label={t('search.placeholder')}
          className="flex-1 min-w-0 bg-transparent text-[14px] text-zinc-100 placeholder:text-zinc-500 outline-none" />
        <div role="radiogroup" aria-label={t('search.scope')} className="flex-shrink-0 flex rounded-md border border-white/10 overflow-hidden text-[11.5px] font-semibold">
          {([false, true] as const).map((v) => (
            <button key={String(v)} type="button" role="radio" aria-checked={all === v} onClick={() => setAll(v)}
              className={`px-2 py-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white ${all === v ? 'bg-[var(--accent-dim)] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
              {t(v ? 'search.allGames' : 'search.thisGame')}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} title={t('search.close')} aria-label={t('search.close')}
          className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto min-h-0 pb-2 px-1">
        {typed
          ? results.length ? <ul className="flex flex-col">{results.map(row)}</ul> : <div className="px-3 py-3 text-[12.5px] text-zinc-500">{t('search.none')}</div>
          : saved.length || recent.length
            ? <>{section(t('search.saved'), saved)}{section(t('search.recent'), recent)}</>
            : <div className="px-3 py-3 text-[12.5px] text-zinc-500">{t('search.noneYet')}</div>}
      </div>
    </div>
  );
}
