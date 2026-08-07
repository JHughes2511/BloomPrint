import { searchAPI } from '../api/client';
import type { SearchResults } from './searchGroups';

/**
 * Every name in the app, held in memory, so typing does not wait on a server.
 *
 * The delay in search was never the code around the request — it WAS the
 * request. Measured with a realistic hop to the API, a keystroke took ~300ms to
 * change the list, of which the debounce was ten. Tuning the delay before a
 * round trip cannot fix a delay that is the round trip.
 *
 * So names are matched here, in the browser, against a list fetched once: the
 * list changes when the coach creates something, not while they are typing. The
 * real search still runs behind every keystroke and replaces this the moment it
 * lands — it knows things this cannot, namely matches inside the text of a
 * report. What the coach sees is their roster answering instantly, then the
 * deeper matches filling in.
 *
 * Stale by construction, and safe because of it: the worst case is a report
 * created seconds ago missing from one keystroke's worth of results, corrected
 * by the response already in flight.
 */
let index: any | null = null;
let loading: Promise<any> | null = null;
let loadedAt = 0;

// Long enough that typing never triggers a reload, short enough that a session
// left open all day does not answer from this morning's roster.
const STALE_MS = 5 * 60 * 1000;

/** Fetch the index if it isn't held, or is old. Safe to call on every keystroke. */
export function ensureIndex(): Promise<any> | null {
  if (index && Date.now() - loadedAt < STALE_MS) return null;
  if (loading) return loading;
  loading = searchAPI.index()
    .then((data: any) => { index = data; loadedAt = Date.now(); return data; })
    .catch(() => null)
    .finally(() => { loading = null; });
  return loading;
}

/** Throw away what is held — after creating a report, or on sign-out. */
export function invalidateIndex(): void {
  index = null;
  loadedAt = 0;
}

const hit = (needle: string, ...fields: (string | null | undefined)[]) =>
  fields.some(f => !!f && f.toLowerCase().includes(needle));

/**
 * Matches from memory, in the same shape the server returns.
 *
 * Titles and names only — the server owns body text. `totals` are honest counts
 * of what this could see, so "see all" still offers the right number.
 */
export function matchIndex(term: string, limit = 6): SearchResults | null {
  if (!index) return null;
  const q = term.trim().toLowerCase();
  if (!q) return null;

  const take = <T,>(rows: T[], match: (r: T) => boolean) => {
    const all = rows.filter(match);
    return { rows: all.slice(0, limit), total: all.length };
  };

  const players = take(index.players ?? [], (p: any) =>
    hit(q, p.name, p.position, p.school_name, p.program_name));
  const teams = take(index.teams ?? [], (t: any) => hit(q, t.name, t.competition_level));
  const reports = take(index.reports ?? [], (r: any) =>
    hit(q, r.title, r.output_type, r.player_name));
  const training = take(index.training ?? [], (t: any) => hit(q, t.title, t.player_name));
  const teamReports = take(index.team_reports ?? [], (r: any) => hit(q, r.title, r.output_type));
  const games = take(index.games ?? [], (g: any) =>
    hit(q, g.title, g.opponent_name, g.opponent_a_name, g.output_type));
  const scouting = take(index.scouting ?? [], (s: any) => hit(q, s.opponent_name, s.location));

  return {
    players: players.rows,
    teams: teams.rows,
    reports: reports.rows,
    training: training.rows,
    team_reports: teamReports.rows,
    games: games.rows,
    scouting: scouting.rows,
    totals: {
      players: players.total, teams: teams.total, reports: reports.total,
      training: training.total, team_reports: teamReports.total,
      games: games.total, scouting: scouting.total,
    },
  };
}
