/**
 * The reader's time zone, sent with every request as X-Timezone.
 *
 * Dates the app draws itself are already in the reader's time. Dates the
 * server writes into text (the Game Insights a staff member is sent, the box
 * score, a player's game history, Ask BloomPrint's lists) were printed on UTC's
 * calendar, so a game tipping off at 8:30pm in Chicago was dated the next day.
 * The server uses this to print them on the reader's calendar instead. See
 * api/localtime.py.
 *
 * Read once: it only changes if the device changes zone, and a reload picks
 * that up. Left out entirely where the platform cannot say, and the server
 * falls back to UTC, which is what it did before.
 */
let cached: string | null | undefined;

export function readerTimezone(): string | null {
  if (cached !== undefined) return cached;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    cached = typeof zone === 'string' && zone.length > 0 && zone.length <= 64 ? zone : null;
  } catch {
    cached = null;
  }
  return cached;
}
