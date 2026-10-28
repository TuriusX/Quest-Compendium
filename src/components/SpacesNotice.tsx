import React, { useState } from 'react';
import { useT } from '../i18n';
import { playBlipSound } from '../utils/audio';
import type { SpacesState } from '../utils/spacesStore';
import type { CatalogGame } from '../utils/gameSpaces';
import { looseName } from '../utils/gameSpaces';

/**
 * Games-not-tabs (flag on): under the header,
 *   - once, after this account's compendiums became games: what was merged (each with "Keep separate") and which
 *     need a game; dismissed for good
 *   - on a space with no recognized game: "Which game is this?" with the suggestion from its conversation (or a
 *     collection's games), a name to type (the guide list as suggestions), or "Keep as Other notes"
 * Never blocks: the conversation works meanwhile.
 */
export function SpacesNotice({ spaces, activeId, catalog, soundEnabled, onDismiss, onKeepSeparate, onAssign, onKeepOther }: {
  spaces: SpacesState;
  activeId: string;
  catalog: CatalogGame[];
  soundEnabled: boolean;
  onDismiss: () => void;
  onKeepSeparate: (gameId: string) => void;
  onAssign: (spaceId: string, game: { id: string; name: string }) => void;
  onKeepOther: (spaceId: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const active = spaces.games.find((g) => g.id === activeId);
  const asking = active?.kind === 'unsorted' ? spaces.notice?.needsGame.find((n) => n.spaceId === active.id) || { spaceId: active.id, tabName: active.name } : null;
  const btn = 'h-6 px-2.5 rounded-md text-[11.5px] font-bold cursor-pointer whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';
  const click = (fn: () => void) => () => { playBlipSound(soundEnabled); fn(); };
  const pick = (typed: string) => {
    const want = looseName(typed);
    const hit = catalog.find((c) => looseName(c.name) === want);
    onAssign(asking!.spaceId, hit || { id: `name:${want}`, name: typed.trim() });
  };
  return (
    <div className="flex-shrink-0 flex flex-col gap-1.5 px-3 py-2 border-b border-white/[0.06] bg-[var(--accent-dim)]/40 text-[12px] text-zinc-200" style={{ WebkitAppRegion: 'no-drag' } as any}>
      {spaces.notice && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white">{t('spaces.noticeTitle')}</span>
            <span className="text-zinc-400 min-w-0 line-clamp-2">{t('spaces.noticeKept')}</span>
            <button type="button" onClick={click(onDismiss)} className={`${btn} ml-auto bg-[var(--accent-color)] text-black`}>{t('spaces.ok')}</button>
          </div>
          {spaces.notice.merges.map((m) => (
            <div key={m.gameId} className="flex items-center gap-2 min-w-0">
              <span className="min-w-0 line-clamp-2">{t('spaces.merged', { game: m.name, n: m.tabs.length, tabs: m.tabs.map((x) => `"${x}"`).join(', ') })}</span>
              <button type="button" onClick={click(() => onKeepSeparate(m.gameId))} className={`${btn} ml-auto border border-white/20 text-zinc-100`}>{t('spaces.keepSeparate')}</button>
            </div>
          ))}
        </div>
      )}
      {asking && (
        <form className="flex items-center gap-1.5 min-w-0 flex-wrap" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { playBlipSound(soundEnabled); pick(name); } }}>
          <span className="font-bold text-white flex-shrink-0">{t('spaces.whichGame')}</span>
          {asking.suggestion && (
            <button type="button" onClick={click(() => onAssign(asking.spaceId, asking.suggestion!))} className={`${btn} bg-[var(--accent-color)] text-black`}>{asking.suggestion.name}</button>
          )}
          {(asking.options || []).map((o) => (
            <button key={o.id} type="button" onClick={click(() => onAssign(asking.spaceId, o))} className={`${btn} border border-white/20 text-zinc-100`}>{o.name}</button>
          ))}
          <input list="qc-spaces-games" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('spaces.typeGame')} aria-label={t('spaces.whichGame')} className="flex-1 min-w-[8rem] h-6 px-2 rounded bg-black/40 border border-white/15 text-[11.5px] text-white outline-none focus:border-[var(--accent-color)]" />
          <datalist id="qc-spaces-games">{catalog.slice(0, 400).map((c) => <option key={c.id} value={c.name} />)}</datalist>
          <button type="submit" disabled={!name.trim()} className={`${btn} border border-white/20 text-zinc-100 disabled:opacity-40`}>{t('spaces.save')}</button>
          <button type="button" onClick={click(() => onKeepOther(asking.spaceId))} className={`${btn} text-zinc-400 hover:text-white`}>{t('spaces.keepOther')}</button>
        </form>
      )}
    </div>
  );
}
