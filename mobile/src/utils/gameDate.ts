/**
 * Reading a date a coach typed.
 *
 * The field shows MM-DD-YY, and nobody types like a form. 3-4-26, 03/04/2026,
 * 3.4.26 and 2026-03-04 are all the same night, and rejecting four of them
 * because the fifth is the house style is the app being difficult about
 * something it can work out.
 *
 * Month first, always. 03-04-26 is March 4th — the same order the field
 * displays — so an ambiguous pair is never read two different ways depending
 * on which separator was used.
 */

/** 2026-03-04, for the API. */
export type ParsedDate = { iso: string; display: string };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Two digits into a year.
 *
 * 69 and below is this century, 70 and above the last — the same rule POSIX
 * uses, and the one that reads correctly for anything a basketball season
 * touches. A coach typing 26 means 2026 and a coach typing 98 means 1998.
 */
function fullYear(raw: number): number {
  if (raw >= 100) return raw;
  return raw <= 69 ? 2000 + raw : 1900 + raw;
}

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Round-tripped through a Date, so 02-30 is rejected rather than rolling
  // over into March and quietly linking the film to the wrong night.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * A typed date, or null when it is not a date yet.
 *
 * Null for a half-typed one too — "3-" is somebody still going, not a value,
 * and treating it as one starts suggesting games for a date they have not
 * finished entering.
 */
export function parseGameDate(input: string): ParsedDate | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  const parts = raw.split(/[^0-9]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  if (parts.some(p => p.length > 4)) return null;

  let y: number, m: number, d: number;
  if (parts[0].length === 4) {
    // Already the machine's order: 2026-03-04.
    [y, m, d] = [Number(parts[0]), Number(parts[1]), Number(parts[2])];
  } else {
    [m, d, y] = [Number(parts[0]), Number(parts[1]), fullYear(Number(parts[2]))];
  }
  if (!valid(y, m, d)) return null;
  return { iso: `${y}-${pad(m)}-${pad(d)}`, display: `${pad(m)}-${pad(d)}-${String(y).slice(2)}` };
}

/** An ISO date from the API, in the form the field shows. */
export function displayGameDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}-${m[3]}-${m[1].slice(2)}` : '';
}
