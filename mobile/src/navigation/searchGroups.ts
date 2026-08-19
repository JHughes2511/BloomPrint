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
  film?: { id: number; report_id: number; title?: string; output_type?: string; snippet?: string }[];
  game_reports?: { id: number; game_id: number; opponent_name?: string; date?: string; snippet?: string }[];
  opponents?: { id: number; player_name: string; opponent_name?: string; jersey_number?: string; position?: string; snippet?: string }[];
  insights?: { id: number; team_name: string; subject?: string; snippet?: string }[];
  messages?: { id: number; conversation_id: number; sender_name?: string; title?: string; snippet?: string }[];
  staff_comments?: { id: number; shared_report_id: number; sender_name?: string; snippet?: string }[];
  comments?: { id: number; eval_id?: number | null; training_id?: number | null; snippet?: string }[];
  totals?: Record<string, number>;
};

type Go = (tab: string, screen: string, params: Record<string, unknown>) => void;

/**
 * The places in the app, so search can take you to one.
 *
 * A coach who types "leaderboard" wants the leaderboard, not the reports that
 * mention it — and until now got nothing at all, because search only ever knew
 * about things stored in a table.
 *
 * Each destination matches on its own name in the coach's language AND on a
 * short list of English words, because these are the terms people say out loud
 * regardless of what the interface is set to, and because one screen goes by
 * several names ("playbook", "whiteboard", "plays" are one place).
 *
 * Note `openView` rather than `view`. They reach the same screens, but `view`
 * is the one Team Grade WRITES back as the coach moves around, so it mirrors
 * where they are — asking for a view through it means the screen reads its own
 * output as a fresh instruction. Measured: the page died with React's
 * maximum-update-depth error before the navigation committed. `openView` is an
 * instruction, cleared the moment it is carried out, so it cannot echo.
 */
function screenDestinations(tr: (k: string, o?: any) => string, go: Go) {
  const teamEval = (params: Record<string, unknown>) => () => go('TeamEvalTab', 'TeamEval', params);
  return [
    { label: tr('common.tabs.home'), words: ['home'],
      onPress: () => go('HomeTab', 'Home', {}) },
    { label: tr('roster.title'), words: ['roster', 'players', 'squad'],
      onPress: () => go('RosterTab', 'Roster', {}) },
    { label: tr('recent.title'), words: ['recent', 'reports', 'history'],
      onPress: () => go('RecentTab', 'Recent', {}) },
    { label: tr('teamGrade.views.dashboard'),
      words: ['dashboard', 'season', 'record', 'leaderboard', 'standings', 'stats'],
      onPress: teamEval({ openView: 'dashboard' }) },
    { label: tr('teamGrade.views.games'), words: ['games', 'schedule', 'track game'],
      onPress: teamEval({ openView: 'games' }) },
    { label: tr('teamGrade.views.scout'), words: ['scout', 'scouting', 'opponents'],
      onPress: teamEval({ openView: 'scout' }) },
    { label: tr('coachNotifs.typeGameReport'), words: ['game report'],
      onPress: teamEval({ openView: 'gamereport' }) },
    { label: tr('whiteboard.title'), words: ['whiteboard', 'playbook', 'plays', 'board'],
      onPress: teamEval({ openPlaybook: true }) },
    { label: tr('common.tabs.teamEval'), words: ['packets', 'film', 'team eval', 'video'],
      onPress: () => go('TeamTab', 'Team', {}) },
    { label: tr('staffHub.title'), words: ['staff', 'inbox', 'messages', 'hub'],
      onPress: () => go('HomeTab', 'StaffInbox', {}) },
    { label: tr('coachNotifs.title'), words: ['notifications', 'alerts'],
      onPress: () => go('HomeTab', 'CoachNotifications', {}) },
    { label: tr('home.editProfileTitle'),
      words: ['settings', 'profile', 'account', 'preferences', 'language'],
      onPress: () => go('HomeTab', 'Home', { openEditProfile: true }) },
  ];
}

export function buildSearchGroups(
  results: SearchResults | null,
  tr: (k: string, o?: any) => string,
  go: Go,
  pickTeam: (id: number) => void,
  /** What was typed, for matching the app's own screens. */
  term?: string,
): SearchGroup[] {
  const q = (term ?? '').trim().toLowerCase();
  // A place matches on what was typed alone, so it can be offered before any
  // answer about content has come back — which is the whole point of naming a
  // screen: you already know where you want to go.
  if (!results && !q) return [];
  const n = results?.totals ?? {};
  const places = !q ? [] : screenDestinations(tr, go).filter(
    d => d.label.toLowerCase().includes(q) || d.words.some(w => w.includes(q)));
  const groups: SearchGroup[] = [
    {
      // First, because a coach who typed the name of a place wants the place,
      // and one row of it beats scrolling past the reports that mention it.
      key: 'places',
      label: tr('search.groups.goTo'),
      total: places.length,
      rows: places.map(d => ({
        key: `places-${d.label}`, title: d.label, meta: '', onPress: d.onPress,
      })),
    },
    {
      key: 'players',
      label: tr('common.tabs.roster'),
      total: n.players ?? (results?.players ?? []).length,
      rows: (results?.players ?? []).map(p => ({
        key: `players-${p.id}`,
        title: p.name,
        meta: [p.position, p.team_name].filter(Boolean).join(' · '),
        onPress: () => go('RosterTab', 'PlayerProfile', { playerId: p.id }),
      })),
    },
    {
      key: 'reports',
      label: tr('recent.filters.eval'),
      total: n.reports ?? (results?.reports ?? []).length,
      rows: (results?.reports ?? []).map(r => ({
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
      total: n.training ?? (results?.training ?? []).length,
      rows: (results?.training ?? []).map(t => ({
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
      total: n.team_reports ?? (results?.team_reports ?? []).length,
      rows: (results?.team_reports ?? []).map(r => ({
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
      // "Game Reports" is what the OTHER thing is called — the report written
      // off a tracked game, below. This one is the packet you build, and the
      // builder calls it a packet on every screen it appears on.
      label: tr('search.groups.packets'),
      total: n.games ?? (results?.games ?? []).length,
      rows: (results?.games ?? []).map(g => ({
        key: `games-${g.id}`,
        title: g.title || g.opponent_name || '—',
        meta: g.opponent_name ?? '',
        snippet: g.snippet,
        onPress: () => go('TeamTab', 'GameReportBuilder', { reportId: g.id, find: q }),
      })),
    },
    {
      key: 'game_reports',
      label: tr('search.groups.gameReports'),
      total: n.game_reports ?? (results?.game_reports ?? []).length,
      rows: (results?.game_reports ?? []).map(r => ({
        key: `game_reports-${r.id}`,
        title: r.opponent_name ?? '—',
        meta: '',
        snippet: r.snippet,
        onPress: () => go('TeamEvalTab', 'TeamEval',
                          { openView: 'gamereport', report: String(r.game_id), find: q }),
      })),
    },
    {
      key: 'film',
      label: tr('search.groups.film'),
      total: n.film ?? (results?.film ?? []).length,
      rows: (results?.film ?? []).map(f => ({
        key: `film-${f.id}`,
        title: f.title || '—',
        meta: '',
        snippet: f.snippet,
        // The breakdown lives inside a packet, so opening one means opening
        // the packet with that clip named.
        onPress: () => go('TeamTab', 'GameReportBuilder',
                          { reportId: f.report_id, openClipId: f.id, find: q }),
      })),
    },
    {
      key: 'opponents',
      label: tr('search.groups.opponents'),
      total: n.opponents ?? (results?.opponents ?? []).length,
      rows: (results?.opponents ?? []).map(o => ({
        key: `opponents-${o.id}`,
        title: o.player_name,
        meta: [o.jersey_number ? `#${o.jersey_number}` : null, o.position, o.opponent_name]
          .filter(Boolean).join(' · '),
        snippet: o.snippet,
        onPress: () => go('TeamEvalTab', 'TeamEval',
                          { openView: 'scout', openScoutTeam: o.opponent_name }),
      })),
    },
    {
      key: 'insights',
      label: tr('search.groups.insights'),
      total: n.insights ?? (results?.insights ?? []).length,
      rows: (results?.insights ?? []).map(i => ({
        key: `insights-${i.id}`,
        title: i.team_name,
        meta: i.subject ?? '',
        snippet: i.snippet,
        onPress: () => go('TeamEvalTab', 'TeamEval',
                          { openView: 'scout', openScoutTeam: i.team_name }),
      })),
    },
    {
      key: 'messages',
      label: tr('search.groups.messages'),
      total: (n.messages ?? 0) + (n.staff_comments ?? 0)
        || (results?.messages ?? []).length + (results?.staff_comments ?? []).length,
      rows: [
        ...(results?.messages ?? []).map(m => ({
          key: `messages-${m.id}`,
          title: m.title || m.sender_name || '—',
          meta: m.sender_name ?? '',
          snippet: m.snippet,
          onPress: () => go('HomeTab', 'Conversation', { conversationId: m.conversation_id }),
        })),
        // A comment on a shared report is read in the Staff Hub, on the report
        // it was left against — which is the hub's own list, not a screen of
        // its own, so that is where it goes.
        ...(results?.staff_comments ?? []).map(sc => ({
          key: `staff_comments-${sc.id}`,
          title: sc.sender_name || '—',
          meta: '',
          snippet: sc.snippet,
          onPress: () => go('HomeTab', 'StaffInbox', { openSharedId: sc.shared_report_id }),
        })),
      ],
    },
    {
      key: 'comments',
      label: tr('search.groups.comments'),
      total: n.comments ?? (results?.comments ?? []).length,
      rows: (results?.comments ?? []).flatMap(pc => {
        // A comment with nothing behind it would open the wrong screen or no
        // screen; drop it rather than offer a row that goes nowhere.
        if (pc.eval_id) {
          return [{
            key: `comments-${pc.id}`, title: pc.snippet ?? '—', meta: '',
            onPress: () => go('RecentTab', 'EvalReport', { evalId: pc.eval_id }),
          }];
        }
        if (pc.training_id) {
          return [{
            key: `comments-${pc.id}`, title: pc.snippet ?? '—', meta: '',
            onPress: () => go('RecentTab', 'Recent',
                              { openKind: 'training', openId: pc.training_id }),
          }];
        }
        return [];
      }),
    },
    {
      key: 'scouting',
      label: tr('recent.filters.scout'),
      total: n.scouting ?? (results?.scouting ?? []).length,
      rows: (results?.scouting ?? []).map(s => ({
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
      total: n.teams ?? (results?.teams ?? []).length,
      rows: (results?.teams ?? []).map(tm => ({
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
