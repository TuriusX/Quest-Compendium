/**
 * Steam Deck plugin update note: the plugin sends its version in its User-Agent ("QuestCompendiumDeck/0.13.0").
 * Plugins older than the minimum get one short line at the end of an answer, at most once a day per player, in the
 * player's answer language. Plugins from 0.14.0 on show their own update notice, so this is for the older ones.
 *
 * The minimum is config/deck.minPluginVersion in Firestore (default 0.14.0): raise it there for a later release,
 * no deploy needed. Once a day: deckNotice/{player} { day } (server only), guests in memory.
 */
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_MIN = '0.14.0';

/** The plugin's version from its User-Agent, or null for anything that isn't the Deck plugin. */
export function deckVersion(ua: unknown): string | null {
  const m = String(ua || '').match(/QuestCompendiumDeck\/(\d+(?:\.\d+){0,3})/i);
  return m ? m[1] : null;
}

/** Is version a older than b? ("0.13.0" < "0.14.0"; missing parts count as 0.) */
export function olderThan(a: string, b: string): boolean {
  const x = a.split('.').map((n) => Number(n) || 0), y = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  }
  return false;
}

/** The note in each answer language the apps offer (the server's language names). */
export const DECK_UPDATE_NOTE: Record<string, string> = {
  English: 'A new version of Quest Compendium for Steam Deck is out. Reinstall from the same link to update.',
  Spanish: 'Hay una nueva versión de Quest Compendium para Steam Deck. Vuelve a instalarla desde el mismo enlace para actualizar.',
  'Brazilian Portuguese': 'Saiu uma nova versão do Quest Compendium para Steam Deck. Reinstale pelo mesmo link para atualizar.',
  German: 'Eine neue Version von Quest Compendium für Steam Deck ist da. Installiere sie über denselben Link neu, um zu aktualisieren.',
  French: 'Une nouvelle version de Quest Compendium pour Steam Deck est disponible. Réinstallez-la depuis le même lien pour la mettre à jour.',
  Russian: 'Вышла новая версия Quest Compendium для Steam Deck. Чтобы обновиться, переустановите её по той же ссылке.',
  Japanese: 'Steam Deck版Quest Compendiumの新しいバージョンが出ました。同じリンクから再インストールして更新してください。',
  Korean: 'Steam Deck용 Quest Compendium 새 버전이 나왔습니다. 같은 링크에서 다시 설치해 업데이트하세요.',
  'Simplified Chinese': 'Steam Deck 版 Quest Compendium 已推出新版本。请从同一链接重新安装以更新。',
};

let minCache = { at: 0, value: DEFAULT_MIN };
async function minVersion(): Promise<string> {
  if (Date.now() - minCache.at < 5 * 60_000) return minCache.value;
  try {
    const d: any = (await getFirestore().collection('config').doc('deck').get()).data() || {};
    const v = String(d.minPluginVersion || '').trim();
    minCache = { at: Date.now(), value: /^\d+(\.\d+){0,3}$/.test(v) ? v : DEFAULT_MIN };
  } catch {
    minCache = { at: Date.now(), value: minCache.value };
  }
  return minCache.value;
}

const guestDays = new Map<string, string>();

/**
 * The note to add to this answer, or '' (not the Deck plugin, a current one, or already shown today). Marks it shown.
 */
export async function deckUpdateNote(ua: unknown, player: string, isGuest: boolean, language: string): Promise<string> {
  const v = deckVersion(ua);
  if (!v || !player) return '';
  if (!olderThan(v, await minVersion())) return '';
  const day = new Date().toISOString().slice(0, 10);
  try {
    if (isGuest) {
      if (guestDays.get(player) === day) return '';
      guestDays.set(player, day);
    } else {
      const ref = getFirestore().collection('deckNotice').doc(player);
      const seen = await getFirestore().runTransaction(async (tx) => {
        const d: any = (await tx.get(ref)).data() || {};
        if (d.day === day) return true;
        tx.set(ref, { day, version: v });
        return false;
      });
      if (seen) return '';
    }
  } catch {
    return '';
  }
  return DECK_UPDATE_NOTE[language] || DECK_UPDATE_NOTE.English;
}
