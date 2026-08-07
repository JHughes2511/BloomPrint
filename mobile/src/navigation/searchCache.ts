import type { SearchResults } from './searchGroups';

/**
 * The last few answers, kept for the length of a search.
 *
 * Typing is not a straight line — people overshoot and backspace, or clear the
 * box and type the same name again a minute later. Those are terms the app has
 * already answered, and re-asking the network for them is a wait with nothing
 * to learn from it.
 *
 * Cache-then-confirm, never cache-instead-of: a cached answer is shown at once
 * and the request still goes out, so a program created since the last search
 * appears as soon as the response lands. The alternative — trusting the cache —
 * would make a stale list permanent for the rest of the session, and this rail
 * mounts once and never unmounts.
 */
const MAX = 50;
const answers = new Map<string, SearchResults>();

/** Case-folded, so "Bloom" and "bloom" share one answer. */
const keyOf = (term: string, limit: number) => `${limit}:${term.trim().toLowerCase()}`;

export function cached(term: string, limit = 6): SearchResults | undefined {
  return answers.get(keyOf(term, limit));
}

export function remember(term: string, results: SearchResults, limit = 6): void {
  const key = keyOf(term, limit);
  // Re-inserting moves it to the end, so the oldest key is always the first.
  answers.delete(key);
  answers.set(key, results);
  if (answers.size > MAX) answers.delete(answers.keys().next().value as string);
}
