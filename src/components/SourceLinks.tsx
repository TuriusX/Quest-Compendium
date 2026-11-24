import React from 'react';
import { ExternalLink } from './icons';
import { useT } from '../i18n';

export type SourceLink = { url: string; title: string; site: string };

/**
 * Sources under an answer (owner, Nov 16 2026: link the wikis and guides that are best for players, not our own guide):
 * the pages the answer read, or the wiki pages of what it's about (server: sourceLinks.ts). A page the answer's picture
 * card already links isn't repeated. Opens in the browser.
 */
export function SourceLinks({ links, skip }: { links: SourceLink[]; skip?: string }) {
  const t = useT();
  const shown = links.filter((l) => l.url !== skip).slice(0, 3);
  if (!shown.length) return null;
  const open = (e: React.MouseEvent, url: string) => {
    const api = (window as any).electronAPI;
    if (api?.openExternal) { e.preventDefault(); api.openExternal(url); }
  };
  return (
    <div data-qc-sources="" className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="qc-label !text-[10.5px] text-zinc-400">{t('answer.sources')}</span>
      {shown.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer" onClick={(e) => open(e, l.url)} title={l.url}
          className="inline-flex items-center gap-1 max-w-[16rem] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-[11px] text-zinc-300 hover:text-white hover:border-[var(--accent-border)] hover:bg-white/[0.06]">
          <span className="truncate">{l.title}</span>
          <span className="shrink-0 text-zinc-400">· {l.site}</span>
          <ExternalLink className="w-3 h-3 shrink-0 text-zinc-500" />
        </a>
      ))}
    </div>
  );
}
