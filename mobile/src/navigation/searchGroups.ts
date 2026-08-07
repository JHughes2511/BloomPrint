/**
 * One search payload, turned into rows something can render.
 *
 * Shared by the sidebar dropdown and the full-results screen so the two can
 * never disagree about what a hit is called or where tapping it goes — the
 * dropdown showing six of something the results screen routes elsewhere is
 * exactly the kind of drift that makes search feel unreliable.
 */
export type SearchRow = {
  key: string;
  title: string;
  meta: string;
  /** The line the match was found on, when it came from the body of a report. */
  snippet?: string;
  onPress: () => void;
};

export type SearchGroup = {
  key: string;
  label: string;
  rows: SearchRow[];
  /** How many exist in total — the shown rows may be the first few of many. */
  total: number;
};

export type SearchResults = {
  players?: { id: number; name: string; position?: string; team_name?: string }[];
  teams?: { id: number; name: string; competition_level?: string }[];
  reports?: { id: number; title: string; output_type?: string; player_name?: string; snippet?: string }[];
  training?: { id: number; title: string; player_name?: string; snippet?: string }[];
  team_reports?: { id: number; title: string; output_type?: string; snippet?: string }[];
  games?: { id: number; title?: string; opponent_name?: string; output_type?: string; snippet?: string }[];
  scouting?: { id: number; opponent_name?: string; location?: string; snippet?: string }[];
  totals?: Record<string, number>;
};

type Go = (tab: string, screen: string, params: Record<string, unknown>) => void;

export function buildSearchGroups(
  results: SearchResults | null,
  tr: (k: string, o?: any) => string,
  go: Go,
  pickTeam: (id: number) => void,
): SearchGroup[] {
  if (!results) return [];
  const n = results.totals ?? {};
  const groups: SearchGroup[] = [
    {
      key: 'players',
      label: tr('common.tabs.roster'),
      total: n.players ?? (results.players ?? []).length,
      rows: (results.players ?? []).map(p => ({
        key: `players-${p.id}`,
        title: p.name,
        meta: [p.position, p.team_name].filter(Boolean).join(' · '),
        onPress: () => go('RosterTab', 'PlayerProfile', { playerId: p.id }),
      })),
    },
    {
      key: 'reports',
      label: tr('recent.filters.eval'),
      total: n.reports ?? (results.reports ?? []).length,
      rows: (results.reports ?? []).map(r => ({
        key: `reports-${r.id}`,
        title: r.title,
        meta: [r.player_name, r.output_type].filter(Boolean).join(' · '),
        snippet: r.snippet,
        onPress: () => go('RecentTab', 'EvalReport', { evalId: r.id }),
      })),
    },
    {
      key: 'training',
      label: tr('recent.filters.training'),
      total: n.training ?? (results.training ?? []).length,
      rows: (results.training ?? []).map(t => ({
        key: `training-${t.id}`,
        title: t.title,
        meta: t.player_name ?? '',
        snippet: t.snippet,
        // NOT CoachTrainingDetail — that screen shows a PlayerTraining, the
        // copy sent to a player, which is a different table with its own ids.
        // A coach's own program opens in Recent, so that is where a hit goes.
        onPress: () => go('RecentTab', 'Recent', { openKind: 'training', openId: t.id }),
      })),
    },
    {
      key: 'team_reports',
      label: tr('recent.filters.team'),
      total: n.team_reports ?? (results.team_reports ?? []).length,
      rows: (results.team_reports ?? []).map(r => ({
        key: `team_reports-${r.id}`,
        title: r.title,
        meta: '',
        snippet: r.snippet,
        // Team reports have no screen of their own — they open in Recent, so
        // that is where a hit goes, with the row already open.
        onPress: () => go('RecentTab', 'Recent', { openKind: 'team', openId: r.id }),
      })),
    },
    {
      key: 'games',
      label: tr('recent.filters.game'),
      total: n.games ?? (results.games ?? []).length,
      rows: (results.games ?? []).map(g => ({
        key: `games-${g.id}`,
        title: g.title || g.opponent_name || '—',
        meta: g.opponent_name ?? '',
        snippet: g.snippet,
        onPress: () => go('TeamTab', 'GameReportBuilder', { reportId: g.id }),
      })),
    },
    {
      key: 'scouting',
      label: tr('recent.filters.scout'),
      total: n.scouting ?? (results.scouting ?? []).length,
      rows: (results.scouting ?? []).map(s => ({
        key: `scouting-${s.id}`,
        title: s.opponent_name ?? '—',
        meta: s.location ?? '',
        snippet: s.snippet,
        onPress: () => go('RecentTab', 'Recent', { openKind: 'scout', openId: s.id }),
      })),
    },
    {
      key: 'teams',
      label: tr('roster.teams', { defaultValue: 'Teams' }),
      total: n.teams ?? (results.teams ?? []).length,
      rows: (results.teams ?? []).map(tm => ({
        key: `teams-${tm.id}`,
        title: tm.name,
        meta: tm.competition_level ?? '',
        // Selecting a team from search sets the app-wide scope, which is what
        // picking a team means everywhere else.
        onPress: () => { pickTeam(tm.id); go('RosterTab', 'Roster', {}); },
      })),
    },
  ];
  return groups.filter(g => g.rows.length > 0);
}

/** True when any group is showing fewer rows than exist. */
export function hasMore(groups: SearchGroup[]): boolean {
  return groups.some(g => g.total > g.rows.length);
}

/** Everything found, across groups — what "see all 23" counts. */
export function totalFound(groups: SearchGroup[]): number {
  return groups.reduce((sum, g) => sum + g.total, 0);
}
