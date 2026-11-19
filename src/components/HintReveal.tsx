/**
 * Hint levels under a hint answer (session companion step 2, owner Nov 18 2026): the answer is the nudge; "More of a
 * hint" opens the rule or mechanic the player is missing, then "Show the answer" the full answer. Both came with the
 * hint (one AI call), so opening them is instant and free.
 */
import { Eye, Lightbulb } from 'lucide-react';
import type { HintLevels } from '../utils/hintLevels';
import { nextHintLevel } from '../utils/hintLevels';
import type { ReactNode } from 'react';

export function HintReveal({ hints, shown, onShow, t, renderText }: {
  hints: HintLevels;
  shown: number;
  onShow: (level: number) => void;
  t: (k: string) => string;
  /** The answer's own markdown, so the levels read like the answer. */
  renderText: (text: string) => ReactNode;
}) {
  const next = nextHintLevel(hints, shown);
  return (
    <div className="mt-3 space-y-2">
      {shown >= 2 && hints.rule && (
        <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200/90">
            <Lightbulb className="h-3.5 w-3.5" />
            {t('hint.rule')}
          </div>
          <div className="qc-md text-sm leading-relaxed text-zinc-200">{renderText(hints.rule)}</div>
        </div>
      )}
      {shown >= 3 && hints.answer && (
        <div className="rounded-lg border border-[var(--accent-color)]/30 bg-[var(--accent-color)]/[0.07] px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent-color)]">
            <Eye className="h-3.5 w-3.5" />
            {t('hint.answer')}
          </div>
          <div className="qc-md text-sm leading-relaxed text-zinc-200">{renderText(hints.answer)}</div>
        </div>
      )}
      {next > 0 && (
        <button
          type="button"
          onClick={() => onShow(next)}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-[var(--accent-color)]/50 hover:bg-white/[0.09]"
        >
          {next === 2 ? <Lightbulb className="h-3.5 w-3.5 text-amber-200" /> : <Eye className="h-3.5 w-3.5 text-[var(--accent-color)]" />}
          {next === 2 ? t('hint.more') : t('hint.show')}
        </button>
      )}
    </div>
  );
}
