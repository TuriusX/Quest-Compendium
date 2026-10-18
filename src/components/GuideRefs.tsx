import React from 'react';
import { BookOpen } from './icons';
import { useT } from '../i18n';
import { ENTRY_ICON_PATHS, ENTRY_COLORS, type EntryKind } from '../utils/entryKind';
import { answerPicture, useGuidePictures } from '../utils/guidePictures';

type Ref = { key: string; slug: string; area: string; entry?: string; name: string; kind?: string };

const open = (r: Ref) => window.dispatchEvent(new CustomEvent('qc-open-guide', { detail: { slug: r.slug, entry: r.entry } }));

/**
 * "From the guide" under an answer: the checked guide entries it used, each opening the guide there. An entry (or its
 * page) with an approved picture whose "App answer" switch is on gets a small card with it (72×48, the name, where,
 * "Guide →"), at most two; the rest stay chips. The picture loads after the answer, never holding it up.
 */
export function GuideRefs({ refs }: { refs: Ref[] }) {
  const t = useT();
  const pics = useGuidePictures(refs[0]?.key);
  const withPic = refs.map((r) => ({ r, pic: answerPicture(pics, r.slug, r.entry) }));
  // One card per picture (an entry without its own falls back to its page's: that page's card already shows it).
  const seen = new Set<string>();
  const cards = withPic.filter((x) => x.pic && !seen.has(x.pic.big) && seen.add(x.pic.big)).slice(0, 2);
  const chips = withPic.filter((x) => !cards.includes(x)).map((x) => x.r);
  return (
    <>
      {cards.map(({ r, pic }) => (
        <button
          key={`card:${r.slug}:${r.entry || ''}`}
          type="button"
          onClick={() => open(r)}
          title={t('guideBadge.open', { name: r.name, area: r.area })}
          className="mt-2 w-full max-w-[360px] flex items-center gap-2.5 p-1.5 pr-2.5 rounded-[10px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-[var(--accent-border)] text-left cursor-pointer"
        >
          <img src={pic!.w300} alt={pic!.alt} width={72} height={48} loading="lazy" decoding="async" className="w-[72px] h-12 object-cover rounded-md flex-shrink-0 bg-black/30" />
          <span className="min-w-0 flex-1 flex flex-col leading-tight">
            <span className="text-[12.5px] font-semibold text-white truncate">{r.name}</span>
            {r.area && r.area !== r.name && <span className="text-[11.5px] text-zinc-400 truncate">{r.area}</span>}
            {pic!.credit && <span className="text-[10px] text-zinc-500 truncate">{pic!.credit}</span>}
          </span>
          <span className="flex-shrink-0 text-[12px] font-semibold text-[var(--accent-color)]">{t('main.guide')} →</span>
        </button>
      ))}
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((r, i) => (
            <button
              key={`${r.slug}:${r.entry || i}`}
              type="button"
              onClick={() => open(r)}
              title={t('guideBadge.open', { name: r.name, area: r.area })}
              className="qc-px-frame inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/30 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/20 cursor-pointer"
            >
              {/* The entry's kind icon (chest, secret, boss...) when it has one, as on the guide site; else the book */}
              {r.kind && r.kind in ENTRY_ICON_PATHS ? (
                <svg className="w-3 h-3 shrink-0" style={{ color: ENTRY_COLORS[r.kind as EntryKind] }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ENTRY_ICON_PATHS[r.kind as EntryKind] }} />
              ) : (
                <BookOpen className="w-3 h-3" />
              )}
              {i === 0 && !cards.length ? t('guideBadge.label') : ''}
              <span className="font-normal text-emerald-100/80 max-w-[14rem] truncate">{i === 0 && !cards.length ? `· ${r.name}` : r.name}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
