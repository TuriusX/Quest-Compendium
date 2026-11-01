/**
 * Steam's public achievement page. Since about Oct 2026 it is a server-rendered app with no "achieveRow" markup: the list
 * and the global percentages sit in the page's data, as JSON inside a script string. The old markup is still read if a
 * page has it.
 */
export type SteamAch = { name: string; desc: string; rarity: number | null; icon: string; hidden: boolean };

const decode = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** The balanced JSON value that starts at `at` (an opening bracket), or ''. */
function jsonAt(text: string, at: number): string {
  let depth = 0, inString = false;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      if (--depth === 0) return text.slice(at, i + 1);
    }
  }
  return '';
}

function fromData(html: string, appId: number): SteamAch[] {
  // The script string: \" for a quote and \\ for a backslash.
  const text = html.replace(/\\(["\\])/g, '$1');
  const byKey = new Map<number, any>();
  const mark = '"achievements":[';
  for (let at = text.indexOf(mark); at >= 0; at = text.indexOf(mark, at + 1)) {
    try {
      for (const a of JSON.parse(jsonAt(text, at + mark.length - 1))) if (a?.name && a.internal_key != null && !a.archived) byKey.set(Number(a.internal_key), a);
    } catch {
      /* not this one */
    }
  }
  let pct: Record<string, number> = {};
  const p = text.indexOf('"percentages":{');
  if (p >= 0) try { pct = JSON.parse(jsonAt(text, p + '"percentages":'.length)); } catch { /* no rarity then */ }
  return [...byKey.entries()].map(([k, a]) => ({
    name: String(a.name).trim(),
    desc: String(a.description || '').trim(),
    rarity: Number.isFinite(pct[k]) ? Math.round(pct[k] * 10) / 10 : null,
    icon: a.icon_achieved ? `https://cdn.fastly.steamstatic.com/steamcommunity/public/images/apps/${appId}/${a.icon_achieved}` : '',
    hidden: a.hidden === true,
  }));
}

function fromMarkup(html: string): SteamAch[] {
  return html.split('class="achieveRow').slice(1)
    .map((row) => {
      const name = decode((row.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || '');
      const desc = decode((row.match(/<h5>([\s\S]*?)<\/h5>/) || [])[1] || '');
      const pct = Number(((row.match(/achievePercent">\s*([\d.]+)%/) || [])[1] || 'NaN'));
      const icon = (row.match(/<img src="([^"]+)"/) || [])[1] || '';
      return { name, desc, rarity: Number.isFinite(pct) ? pct : null, icon, hidden: !desc };
    })
    .filter((a) => a.name);
}

export function parseSteamAchievements(html: string, appId: number): SteamAch[] {
  const rows = fromMarkup(html);
  return rows.length ? rows : fromData(html, appId);
}
