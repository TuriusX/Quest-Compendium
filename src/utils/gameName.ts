/**
 * A game's name as the app shows it, the same everywhere (header, input box, conversation header): store names mix
 * " - ", " – " and " — " between a title and its edition, so all of them become " - ".
 */
export function displayGameName(name: string | null | undefined): string {
  return String(name || '').replace(/\s+[–—]\s+/g, ' - ').replace(/\s+/g, ' ').trim();
}
