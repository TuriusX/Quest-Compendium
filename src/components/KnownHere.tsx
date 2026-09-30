import React, { useEffect, useState } from 'react';
import { BookOpen, ChevronDown, Gem, MapPin, Skull, Sparkles, TriangleAlert, User } from './icons';
import { auth } from '../lib/firebase';
import { getApiBaseUrl } from '../utils/api';
import { useT } from '../i18n';

type KnownFact = { subject: string; fact: string; kind: string; story: string; confirmations: number; disputed: boolean };

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  item: Gem,
  secret: Sparkles,
  missable: TriangleAlert,
  npc: User,
  place: MapPin,
  enemy: Skull,
  boss: Skull,
};

/**
 * "Known here": what the Compendium already knows about the player's confirmed place, from the shared game knowledge
 * base. No AI call, so it's free. A small bar above the question box, shown as soon as the place is confirmed (with
 * "nothing yet" until something is learned); open it to see the list. Refreshes when the place changes and after
 * each answer (answers can teach it new facts).
 */
export function KnownHere({ game, place, story, refreshKey }: { game?: string; place?: string; story?: string; refreshKey: number }) {
  const t = useT();
  const [facts, setFacts] = useState<KnownFact[]>([]);
  // The guide page for this place (if the game has a guide), shown as its own list below the verified facts.
  const [guide, setGuide] = useState<{ kind: string; subject: string; fact: string }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!game || !place) {
      setFacts([]);
      setGuide([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const user = auth.currentUser;
        if (!user) return; // signed-in players only
        const token = await user.getIdToken();
        const res = await fetch(`${getApiBaseUrl()}/api/facts/here`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ game, place }),
        });
        const data = res.ok ? await res.json() : { facts: [] };
        if (!cancelled) {
          setFacts(Array.isArray(data.facts) ? data.facts : []);
          setGuide(Array.isArray(data.guide) ? data.guide : []);
        }
      } catch {
        /* the panel just stays as it was */
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [game, place, refreshKey]);

  if (!place) return null;
  const sameStory = (s: string) => !s || !story || s.toLowerCase() === story.toLowerCase();

  return (
    <div className="px-3 sm:px-4 pt-2 bg-[#0a0b10]/90 border-t border-white/[0.08]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 text-[12px] text-zinc-300 transition-colors cursor-pointer"
      >
        <BookOpen className="w-3.5 h-3.5 flex-shrink-0 text-[var(--accent-color)]" aria-hidden="true" />
        <span className="font-semibold text-zinc-100">{t('here.title')}</span>
        <span className="truncate text-zinc-400">· {place}</span>
        <span className="ml-auto flex items-center gap-1.5 text-zinc-400">
          {facts.length + guide.length ? facts.length + guide.length : t('here.nothingYet')}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div className="mt-2 mb-1 max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-2.5">
          {!facts.length && !guide.length && <p className="text-[12px] leading-snug text-zinc-400">{t('here.empty')}</p>}
          <ul className="space-y-2">
            {facts.map((f, i) => {
              const Icon = KIND_ICONS[f.kind] || BookOpen;
              return (
                <li key={i} className="flex items-start gap-2 text-[12px] leading-snug">
                  <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--accent-color)]" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="font-semibold text-zinc-100">{f.subject}</span>
                    <span className="text-zinc-400">: {f.fact}</span>
                    {!sameStory(f.story) && <span className="text-zinc-500"> ({f.story})</span>}
                    {f.disputed && <span className="text-amber-400/90"> · {t('here.disputed')}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {guide.length > 0 && (
            <>
              <div className={`${facts.length ? 'mt-3 pt-2 border-t border-white/5' : ''} mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500`}>{t('here.fromGuide')}</div>
              <ul className="space-y-2">
                {guide.map((g, i) => {
                  const Icon = KIND_ICONS[g.kind] || BookOpen;
                  return (
                    <li key={i} className="flex items-start gap-2 text-[12px] leading-snug">
                      <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-zinc-500" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="font-semibold text-zinc-200">{g.subject}</span>
                        {g.fact && g.fact !== g.subject && <span className="text-zinc-400">: {g.fact}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {facts.length + guide.length > 0 && <div className="mt-2 pt-2 border-t border-white/5 text-[11px] text-zinc-500">{t('here.free')}</div>}
        </div>
      )}
    </div>
  );
}
