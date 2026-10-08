import React from 'react';
import { useT } from '../i18n';
import type { AnswerModel } from '../utils/answerModel';

/**
 * Pro / Fast next to the send button, each with the questions left today ("Pro 7 · Fast 24"). A radio group: click
 * either side, or Left / Right (and Up / Down) when it has focus; a controller's R3 switches too (ControllerLayer).
 */
export function ModelToggle({ value, onChange, pro, fast, disabled }: { value: AnswerModel; onChange: (m: AnswerModel) => void; pro: number; fast: number; disabled?: boolean }) {
  const t = useT();
  const opts: { id: AnswerModel; label: string; left: number; hint: string }[] = [
    { id: 'pro', label: t('model.pro'), left: pro, hint: t('model.proHint', { n: pro }) },
    { id: 'fast', label: t('model.fast'), left: fast, hint: t('model.fastHint', { n: fast }) },
  ];
  const onKey = (e: React.KeyboardEvent) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      onChange(value === 'pro' ? 'fast' : 'pro');
    }
  };
  return (
    <div
      role="radiogroup"
      aria-label={t('model.label')}
      onKeyDown={onKey}
      className="qc-px-frame flex items-center rounded-xl border border-white/10 bg-black/30 p-0.5 text-[11px] font-semibold leading-none"
    >
      {opts.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            title={o.hint}
            onClick={() => onChange(o.id)}
            className={`px-2 py-1.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 disabled:cursor-not-allowed ${
              on ? 'bg-[var(--accent-dim)] text-white shadow-[inset_0_0_0_1px_var(--accent-border)]' : 'text-zinc-400 hover:text-zinc-100'
            } ${o.left === 0 ? 'opacity-60' : ''}`}
          >
            <span>{o.label}</span>
            <span className={`tabular-nums ${on ? 'text-[var(--accent-color)]' : ''}`}>{o.left}</span>
          </button>
        );
      })}
    </div>
  );
}
