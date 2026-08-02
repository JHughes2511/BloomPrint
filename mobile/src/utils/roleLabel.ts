/**
 * A role as a person should read it.
 *
 * Roles are stored as the lowercase values the API uses — "coach", "scout",
 * "trainer" — and several screens printed them straight onto the page, so a
 * staff card read "coach" mid-sentence next to properly capitalised fields.
 * Translations exist for the three known roles; anything else is title-cased so
 * an unfamiliar value still reads as a label rather than as a database column.
 */
type Translate = (key: string, opts?: Record<string, unknown>) => string;

export function roleLabel(role: string | null | undefined, tr: Translate): string {
  const raw = (role ?? '').trim();
  if (!raw) return '';
  const titled = raw.charAt(0).toUpperCase() + raw.slice(1);
  return tr(`auth.role${titled}`, { defaultValue: titled });
}
