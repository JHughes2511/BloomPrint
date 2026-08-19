import React, { useState, useEffect, useCallback, useRef } from 'react';
import { roleLabel } from '../utils/roleLabel';
import { useTranslation } from 'react-i18next';
import VoiceTextInput from '../components/VoiceTextInput';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import Sheet from '../components/Sheet';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { exportHtmlPdf, printRawHtml } from '../utils/exportDoc';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

import { gameEvalAPI, teamsAPI, playersAPI, staffSharingAPI, coachesAPI, importsAPI } from '../api/client';
import type { ScoutInsightOut } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { renderReport } from '../utils/renderReport';
import { useReportSearch, ReportSearchBar, ReportSearchButton } from '../components/ReportSearch';
import ListSearchHeader from '../components/ListSearchHeader';
import { GeneratingOverlay } from '../components/GeneratingBasketball';
import { buildReportHtml, buildPdfFileName } from '../utils/buildReportPdf';
import { formatForLevel, periodLabel, weightBucket, periodForBucket, formatClock, type GameFormat } from '../utils/gameClock';
import WhiteboardModal from '../components/WhiteboardModal';
import ScoutContextPanel from '../components/ScoutContextPanel';
import GameStatsPanel, { TeamBoxScore } from '../components/GameStatsPanel';
import TeamLabelPrompt from '../components/TeamLabelPrompt';
import GameReportPanel from '../components/GameReportPanel';
import ReportCorrectionsPanel from '../components/ReportCorrectionsPanel';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { titleTopPad, bleedRow, bleedContent } from '../responsive/screenPadding';
import { useBreakpoint } from '../responsive/useBreakpoint';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import { useTeam } from '../context/TeamContext';
import { useCloseOnOutside } from '../hooks/useCloseOnOutside';
import { useStaleWhileRefreshing } from '../hooks/useStaleWhileRefreshing';
import { readPage, writePage } from '../storage/pageCache';
import DraggableWhiteboardButton from '../components/DraggableWhiteboardButton';
import { useSheetScrollHeight, sheetCap, desktopOnly, CONTENT_MAX_WIDTH, REPORT_MODAL_WIDTH } from '../responsive/modalSizes';
import { useGridColumns } from '../responsive/useGridColumns';
import { useBackStep } from '../navigation/useBackStep';
import { abandonSheetHistory } from '../web/sheetHistory';

// Highest competition level → lowest.
const COMPETITION_LEVELS = [
  'NBA', 'European Pro', 'G-League',
  'D1', 'D2', 'D3', 'JUCO',
  'International Academy', 'HS Varsity',
  '17U AAU', '16U AAU', '14U/15U AAU',
  'Youth (5-13)',
];

// Team names are typed twice — once on the team, once as an opponent — so they
// are matched on letters and digits alone: "SEED Academy" and "seed academy".
const norm = (x: string) => (x || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// A basketball season spans Aug–Jul, so a game's season year is derived from
// its calendar date: Aug–Dec → "YYYY-YY+1", Jan–Jul → "YYYY-1-YY".
const seasonForDate = (d: Date): string => {
  const start = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

// ── Stat definitions ──────────────────────────────────────────────────────────

const OFFENSE_STATS = [
  '2 FG Made', '2 FG Missed', '3 FG Made', '3 FG Missed',
  'Off. Reb', 'Draw PF', 'Assists', 'Turnover',
  'Hockey Assist', 'FT Made', 'FT Missed',
];

const DEFENSE_STATS = [
  'Def. Reb', 'Steal', 'Deflection', 'Def. Stop', 'Charge',
  'Bluff', 'Blocked Shot', 'Jog Back', 'No Ball Pressure',
  'Defensive Mistake', 'No Contest', 'No Block Out', 'Foul Against',
];

// Live-tracker event semantics: bad plays = red, made baskets + positive plays =
// green, everything else = blue (accent).
const NEGATIVE_STATS = new Set([
  '2 FG Missed', '3 FG Missed', 'FT Missed', 'Turnover', 'Foul Against',
  'Defensive Mistake', 'No Contest', 'No Block Out', 'No Ball Pressure',
  'Jog Back', 'Bluff',
]);
const POSITIVE_STATS = new Set([
  '2 FG Made', '3 FG Made', 'FT Made', 'Off. Reb', 'Def. Reb', 'Assists',
  'Hockey Assist', 'Steal', 'Blocked Shot', 'Deflection', 'Def. Stop',
  'Charge', 'Draw PF',
]);
function statKind(stat: string): 'positive' | 'negative' | 'neutral' {
  if (NEGATIVE_STATS.has(stat)) return 'negative';
  if (POSITIVE_STATS.has(stat)) return 'positive';
  return 'neutral';
}

const STAT_POINTS: Record<string, { base_low: number; base_high: number; threshold: number }> = {
  '2 FG Made':          { base_low: 2,  base_high: 3,  threshold: 4 },
  '2 FG Missed':        { base_low: -1, base_high: -2, threshold: 4 },
  '3 FG Made':          { base_low: 3,  base_high: 4,  threshold: 4 },
  '3 FG Missed':        { base_low: -1, base_high: -2, threshold: 4 },
  'Off. Reb':           { base_low: 3,  base_high: 4,  threshold: 4 },
  'Draw PF':            { base_low: 1,  base_high: 1,  threshold: 4 },
  'Assists':            { base_low: 3,  base_high: 4,  threshold: 4 },
  'Turnover':           { base_low: -2, base_high: -2, threshold: 4 },
  'Hockey Assist':      { base_low: 2,  base_high: 2,  threshold: 4 },
  'FT Made':            { base_low: 2,  base_high: 3,  threshold: 4 },
  'FT Missed':          { base_low: -1, base_high: -2, threshold: 4 },
  'Def. Reb':           { base_low: 3,  base_high: 4,  threshold: 4 },
  'Steal':              { base_low: 3,  base_high: 4,  threshold: 4 },
  'Deflection':         { base_low: 3,  base_high: 4,  threshold: 4 },
  'Def. Stop':          { base_low: 3,  base_high: 3,  threshold: 4 },
  'Charge':             { base_low: 5,  base_high: 7,  threshold: 4 },
  'Bluff':              { base_low: 1,  base_high: 1,  threshold: 4 },
  'Blocked Shot':       { base_low: 2,  base_high: 2,  threshold: 4 },
  'Jog Back':           { base_low: -3, base_high: -3, threshold: 4 },
  'No Ball Pressure':   { base_low: -1, base_high: -1, threshold: 4 },
  'Defensive Mistake':  { base_low: -1, base_high: -1, threshold: 4 },
  'No Contest':         { base_low: -1, base_high: -1, threshold: 4 },
  'No Block Out':       { base_low: -1, base_high: -1, threshold: 4 },
  'Foul Against':       { base_low: -1, base_high: -1, threshold: 4 },
};

function computeRawPoints(statName: string, count: number): number {
  const cfg = STAT_POINTS[statName];
  if (!cfg) return 0;
  const pv = count >= cfg.threshold ? cfg.base_high : cfg.base_low;
  return pv * count;
}

function quarterMultiplier(q: number): number {
  if (q <= 2) return 1.0;
  if (q === 3) return 1.25;
  return 1.5;
}

// ── Main Screen ───────────────────────────────────────────────────────────────

type ViewKey = 'dashboard' | 'games' | 'live' | 'detail' | 'scout' | 'gamereport';

/**
 * Minutes as a coach reads them, or a dash.
 *
 * Null means the sheet never said. It used to be twenty for everybody, which
 * is why an exported grade sheet claimed every player on the roster played
 * exactly twenty minutes.
 */
const minsLabel = (m: number | null | undefined): string =>
  m === null || m === undefined ? '-' : m.toFixed(0);

export default function TeamEvalScreen({ route, navigation }: any) {
  // Tablet and up. Not Platform: a phone browser is web too, and gating the
  // desktop layout on platform put it on every phone that opened the site.
  const { isWide } = useBreakpoint();
  // How wide the phase chips actually are, so the team picker can tell whether
  // it fits beside them.
  const [chipRowWidth, setChipRowWidth] = useState(0);
  const { coach } = useAuth();
  const { currentTeamId } = useTeam();
  const { t, mode } = useTheme();
  // Scales with the window on desktop; unchanged on phones.
  const sheetScroll300 = useSheetScrollHeight(300);
  const { t: tr } = useTranslation();
  const s = makeS(t);
  // Closed-enum display helpers (keys never touch the API values).
  const phaseLabel = (p: string) => tr(`teamGrade.phases.${p}`, { defaultValue: p ? p.charAt(0).toUpperCase() + p.slice(1) : p });
  const statLabelMap = tr('teamGrade.stats', { returnObjects: true }) as Record<string, string>;
  const statLabel = (k: string) => (statLabelMap && (statLabelMap as any)[k]) || k;
  const qLabel = (q: number) => (q === 5 ? tr('teamGrade.otShort') : tr('teamGrade.quarterShort', { q }));
  const scoutScrollRef = useRef<any>(null);
  const noteInputY = useRef(0);
  const [whiteboardGameId, setWhiteboardGameId] = useState<number | null>(null);
  const [whiteboardPlaybook, setWhiteboardPlaybook] = useState(false);
  const [activeView, setActiveView] = useState<ViewKey>('dashboard');
  const [sessions, setSessions] = useState<any[]>([]);

  const [phaseFilter, setPhaseFilter] = useState<string>('all');
  const [dashboard, setDashboard] = useState<any>(null);
  const [loadingDash, setLoadingDash] = useState(true);
  const [dashPhases, setDashPhases] = useState<string[]>([]);  // empty = all phases

  // Games list + new game modal
  const [showNewGame, setShowNewGame] = useState(false);
  const [showTeamDropdown, setShowTeamDropdown] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [newGameOpponent, setNewGameOpponent] = useState('');
  const [newGameLocation, setNewGameLocation] = useState('');
  const [newGamePhase, setNewGamePhase] = useState('regular');
  const [newGameYear, setNewGameYear] = useState('');
  const [newGameTeamId, setNewGameTeamId] = useState<number | null>(null);
  const [showOpponentDropdown, setShowOpponentDropdown] = useState(false);
  const [finalOurs, setFinalOurs] = useState('');
  const [finalTheirs, setFinalTheirs] = useState('');
  const [savingScore, setSavingScore] = useState(false);
  // Only opened from the dash where a score would be. A game whose box
  // score is in already knows its result; this is for the ones that cannot.
  const [showScoreEdit, setShowScoreEdit] = useState(false);
  // Said inside the sheet, not through Alert: an alert raised while a
  // sheet is open is drawn behind it, so the coach is refused with no
  // visible reason.
  const [scoreError, setScoreError] = useState('');
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [importedExtras, setImportedExtras] = useState<{ events: any[]; shots: any[]; team_stats: any[] }>(
    { events: [], shots: [], team_stats: [] });
  // Team labels the imported file used that match neither team in this game — a
  // chart with a red column and a blue one. Asked before anything is saved.
  const [askLabels, setAskLabels] = useState<any[]>([]);
  const [labelSides, setLabelSides] = useState<Record<string, boolean>>({});
  /**
   * Whose team each team in the file is, keyed by the name the file used.
   *
   * Asked here because it cannot be worked out: a coach imports their own box
   * score as readily as an opponent's, so neither the side of the sheet nor
   * the fact that a team arrived by import tells you whose it is. A team the
   * roster already holds starts on whatever it is already set to; a team this
   * import is about to create starts as NOT the coach's, which keeps a scouted
   * fixture out of their own win-loss record until they say otherwise.
   */
  const [teamMine, setTeamMine] = useState<Record<string, boolean>>({});
  // Bumped when an import lands, so the stats panel re-reads the game.
  const [statsVersion, setStatsVersion] = useState(0);
  const opponentOutside = useCloseOnOutside(showOpponentDropdown, () => setShowOpponentDropdown(false));
  const newTeamOutside = useCloseOnOutside(showTeamDropdown, () => setShowTeamDropdown(false));
  /**
   * Which teams this page is about. Empty means all of them.
   *
   * Team Grade never read the team picker at all — every game on every team a
   * coach could reach went into one season record and one leaderboard, so
   * selecting SEED at the top of the app left another team's players on the
   * board with nothing on the row to say so. It starts from the app-wide
   * selection and can be widened here without changing the rest of the app.
   */
  const [gradeTeamIds, setGradeTeamIds] = useState<number[]>([]);
  const [showGradeTeams, setShowGradeTeams] = useState(false);
  const [newGameDate, setNewGameDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Default the Season Year from the game date when the New Game modal opens.
  useEffect(() => {
    if (showNewGame && !newGameYear.trim()) setNewGameYear(seasonForDate(newGameDate));
  }, [showNewGame]);
  const [trackMode, setTrackMode] = useState<'live' | 'post'>('live');
  const [newGameLevel, setNewGameLevel] = useState<string>((coach as any)?.competition_level ?? 'HS Varsity');
  const [showLevelDD, setShowLevelDD] = useState(false);
  const [showPhaseDD, setShowPhaseDD] = useState(false);
  // The canonical game types, ordered by how much this coach actually tracks each
  // (most → least). Used everywhere: New Game, Dashboard grade view, Games filter.
  const orderedPhases = React.useMemo(() => {
    const counts: Record<string, number> = {};
    (sessions || []).forEach((sn: any) => { const p = sn.season_phase; if (p) counts[p] = (counts[p] || 0) + 1; });
    const base = ['regular', 'tournament', 'playoff', 'preseason', 'scrimmage', 'exhibition'];
    return [...base].sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
  }, [sessions]);
  const [importing, setImporting] = useState(false);
  const [statPreview, setStatPreview] = useState<any[] | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

  // Live entry state
  const [activeGame, setActiveGame] = useState<any | null>(null);
  const [activeQuarter, setActiveQuarter] = useState(1);
  // ── Live game clock ──
  const [periodIndex, setPeriodIndex] = useState(1);        // 1-based; > numPeriods = OT
  const [clockRemaining, setClockRemaining] = useState(480);
  const [clockRunning, setClockRunning] = useState(false);
  const [showClockEdit, setShowClockEdit] = useState(false);
  const [editMin, setEditMin] = useState('0');
  const [editSec, setEditSec] = useState('0');
  const gameFmt: GameFormat = activeGame
    ? { format: activeGame.period_format ?? 'quarters', numPeriods: activeGame.num_periods ?? 4, periodSeconds: activeGame.period_seconds ?? 480 }
    : { format: 'quarters', numPeriods: 4, periodSeconds: 480 };
  const [entryMode, setEntryMode] = useState<'our' | 'opponent'>('our');
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [roster, setRoster] = useState<any[]>([]);
  const [opponentPlayers, setOpponentPlayers] = useState<string[]>([]);
  const [opponentRoster, setOpponentRoster] = useState<any[]>([]);
  const [newOppPlayer, setNewOppPlayer] = useState('');
  const [newOppJersey, setNewOppJersey] = useState('');
  const [newOppPosition, setNewOppPosition] = useState('');
  const [showLineupModal, setShowLineupModal] = useState(false);
  const [flashStat, setFlashStat] = useState<string | null>(null);
  const [statToast, setStatToast] = useState<string | null>(null);
  const [subOutPlayer, setSubOutPlayer] = useState<string | null>(null);
  const [ourScore, setOurScore] = useState(0);
  const [oppScore, setOppScore] = useState(0);

  // Game detail
  const [detailGame, setDetailGame] = useState<any | null>(null);
  const [summary, setSummary] = useState<any | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [detailTab, setDetailTab] = useState<'insights' | 'our' | 'opponent' | 'byquarter'>('insights');
  // Tabs the coach has opened on this game. What has been drawn once stays
  // drawn, so going back to it is not another round trip.
  const [seenTabs, setSeenTabs] = useState<Set<string>>(new Set(['insights']));

  /**
   * Everyone this game could be against: the teams on file, and everyone
   * already played. De-duplicated case-insensitively, because "Duke" and "duke"
   * are the same opponent and every note and scouting report on them is keyed
   * by that string.
   */
  /**
   * Who played whom — "SEED Academy vs Senegal Lions", not "vs Senegal Lions".
   *
   * A coach with several teams reading a list of games could see the opponent
   * and not which of their own sides played them. The game already records the
   * team; only the label was leaving it out.
   */
  const matchupLabel = React.useCallback((game: any) => {
    // The game's own team name first: on a game another coach shared, the
    // team row is theirs and is not among mine, and falling straight through
    // to my program printed "SEED vs Mali" for a game SEED never played.
    const ours = game?.team_name
      ?? (teams as any[]).find(tm => tm.id === game?.team_id)?.name
      ?? coach?.program_name;
    return ours
      ? tr('teamGrade.matchup', { us: ours, them: game?.opponent_name })
      : tr('teamGrade.vsOpponent', { opponent: game?.opponent_name });
  }, [teams, coach, tr]);

  const opponentChoices = React.useMemo(() => {
    const out: { name: string; kind: 'team' | 'played' }[] = [];
    const seen = new Set<string>();
    const add = (name: string, kind: 'team' | 'played') => {
      const clean = (name ?? '').trim();
      if (!clean || seen.has(clean.toLowerCase())) return;
      seen.add(clean.toLowerCase());
      out.push({ name: clean, kind });
    };
    for (const tm of teams as any[]) if (!tm.parent_team_id) add(tm.name, 'team');
    for (const g of [...(sessions as any[])].sort((a, b) =>
      new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())) add(g.opponent_name, 'played');
    return out;
  }, [teams, sessions]);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [expandedQuarterPlayer, setExpandedQuarterPlayer] = useState<string | null>(null);
  // Team Grade player-grades list search
  const [showGradeSearch, setShowGradeSearch] = useState(false);
  const [gradeSearch, setGradeSearch] = useState('');
  const [generatingReport, setGeneratingReport] = useState(false);
  const [showScoutingReport, setShowScoutingReport] = useState(false);
  const [gameReportGame, setGameReportGame] = useState<any>(null);
  const [gameReportSearch, setGameReportSearch] = useState('');
  const [scoutSearch, setScoutSearch] = useState('');
  const [loadingGameReport, setLoadingGameReport] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [gameStats, setGameStats] = useState<any[]>([]);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [statsModalPlayer, setStatsModalPlayer] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailModalPlayer, setDetailModalPlayer] = useState<string | null>(null);
  const [gameLineup, setGameLineup] = useState<any[]>([]);
  // Player grade-detail modal (from leaderboard)
  const [gradeDetailPlayer, setGradeDetailPlayer] = useState<string | null>(null);
  // Web card grids. Targets land on 4 games across and 3 of the roomier scout
  // and game-report cards at ~1900px; narrower windows drop a column on their
  // own. Native always reports a single column.
  // A game card carries a matchup, a date, a venue, a status pill and a bin.
  // An iPad in landscape is past the desktop breakpoint, so it was laying out
  // three of them at about 342px each and every one was squeezed: "Duke vs
  // Westview ..." lost the opponent and "83-72" broke across two lines. There
  // is no tablet to detect here — the only honest question is how much room a
  // card needs, and 380 is it. An iPad drops to two across; a desktop, with
  // more than 1500px of content, still fits its four.
  const gamesGrid  = useGridColumns({ columns: 4, inset: 32, min: 380 });
  const scoutGrid  = useGridColumns({ columns: 3, inset: 32 });
  const reportGrid = useGridColumns({ columns: 3, inset: 32 });
  const [gradeDetailData, setGradeDetailData] = useState<any[]>([]);
  const [gradeDetailLoading, setGradeDetailLoading] = useState(false);
  // for edit modal — add stat
  const [addStatQuarter, setAddStatQuarter] = useState(1);
  const [addStatName, setAddStatName] = useState('');
  const [addingStatDropdownOpen, setAddingStatDropdownOpen] = useState(false);
  const [addingStat, setAddingStat] = useState(false);

  // Opponent scout
  const [scoutOpponent, setScoutOpponent] = useState<string | null>(null);
  const [scoutData, setScoutData] = useState<any | null>(null);
  // The three places this screen draws a report: the scouting report under a
  // game, the one on an opponent's scout page, and a generated game report.
  // Three scroll views, so three searches.
  const findScouting = useReportSearch(detailGame?.ai_scouting_report ?? '');
  const findScout = useReportSearch(scoutData?.ai_scouting_report ?? '', scoutScrollRef);
  const findGameReport = useReportSearch(gameReportGame?.ai_game_report ?? '');
  // Written sentences by subject: 'offense' | 'defense' | 'weak' | a player's name.
  const [insights, setInsights] = useState<Record<string, ScoutInsightOut>>({});
  // Keyed, not a single value: the three team sections are written at the
  // same time, and one flag meant two of the three spinners went missing.
  const [insightBusy, setInsightBusy] = useState<Record<string, boolean>>({});
  const [scoutPlayer, setScoutPlayer] = useState<string | null>(null);
  const [loadingScout, setLoadingScout] = useState(false);
  const [regeneratingScout, setRegeneratingScout] = useState(false);
  const [scoutNotes, setScoutNotes] = useState<any[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Share with staff
  const [shareGameModalVisible, setShareGameModalVisible] = useState(false);
  const [shareGameId, setShareGameId] = useState<number | null>(null);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffResults, setStaffResults] = useState<any[]>([]);
  const [sharingStaff, setSharingStaff] = useState(false);
  const [staffSearching, setStaffSearching] = useState(false);

  const [gamesRefreshing, setGamesRefreshing] = useState(false);
  // The screen reloads on every focus. Blanking it each time meant stepping
  // back from a game redrew the same list from scratch behind a spinner — so
  // the last data stays up and a quiet line says it is checking.
  const { firstLoad, refreshing, run } = useStaleWhileRefreshing();

  const cacheKey = `teamgrade.${coach?.id ?? 0}.${gradeTeamIds.join('-') || 'all'}`;

  const loadData = useCallback(async () => {
    await run(async () => {
      const teamParam = gradeTeamIds.length ? { team_ids: gradeTeamIds.join(',') } : {};
      // Each request lands on its own rather than behind Promise.all. The games
      // list answers in a fraction of the time the dashboard takes, and waiting
      // for the slower one held back a section that was already in hand.
      const games = gameEvalAPI.listSessions(teamParam).then(x => { setSessions(x); return x; });
      const dash = gameEvalAPI.getSeasonDashboard(teamParam)
        .then(x => { setDashboard(x); setLoadingDash(false); return x; });
      const tms = teamsAPI.list().then(x => { setTeams(x); return x; });
      const [s, d, t] = await Promise.all([games, dash, tms]);
      // Kept for the next cold open. Written after everything is in, so a
      // half-finished load never becomes what the app starts with.
      void writePage(cacheKey, { sessions: s, dashboard: d, teams: t });
    });
  }, [gradeTeamIds, run, cacheKey]);

  /**
   * Last session's answer, on screen before the first request returns.
   *
   * Only ever fills EMPTY state: if the live data has already arrived it is
   * not overwritten by something older, which is the whole risk with a cache
   * that races the network.
   */
  useEffect(() => {
    let live = true;
    readPage<any>(cacheKey).then(kept => {
      if (!live || !kept) return;
      setSessions(prev => (prev.length ? prev : kept.sessions ?? []));
      setDashboard((prev: any) => prev ?? kept.dashboard ?? null);
      setTeams(prev => (prev.length ? prev : kept.teams ?? []));
    });
    return () => { live = false; };
  }, [cacheKey]);

  const loadDashboard = useCallback(async (phases: string[]) => {
    setLoadingDash(true);
    try {
      const params: any = {};
      if (phases.length > 0) params.phases = phases.join(',');
      if (gradeTeamIds.length) params.team_ids = gradeTeamIds.join(',');
      const d = await gameEvalAPI.getSeasonDashboard(params);
      setDashboard(d);
    } catch {}
    setLoadingDash(false);
  }, [gradeTeamIds]);

  // Follow the app-wide picker when it moves; still free to widen here.
  useEffect(() => {
    setGradeTeamIds(currentTeamId ? [currentTeamId] : []);
  }, [currentTeamId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const filteredSessions = sessions.filter(
    s => phaseFilter === 'all' || s.season_phase === phaseFilter,
  );

  // ── Create team ──────────────────────────────────────────────────────────────

  const createTeam = async () => {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    try {
      const t = await teamsAPI.create({ name: newTeamName.trim() });
      setTeams(prev => [...prev, t]);
      setNewGameTeamId(t.id);
      setNewTeamName('');
      setShowCreateTeam(false);
      setShowTeamDropdown(false);
    } catch {}
    setCreatingTeam(false);
  };

  // ── Create game ──────────────────────────────────────────────────────────────

  const createGame = async () => {
    if (!newGameOpponent.trim()) return;
    setCreating(true);
    try {
      const fmt = formatForLevel(newGameLevel);
      const g = await gameEvalAPI.createSession({
        opponent_name: newGameOpponent.trim(),
        location: newGameLocation.trim() || undefined,
        season_phase: newGamePhase,
        season_year: newGameYear.trim() || undefined,
        team_id: newGameTeamId ?? undefined,
        date: newGameDate.toISOString(),
        tracking_mode: trackMode,
        competition_level: newGameLevel,
        period_format: fmt.format,
        num_periods: fmt.numPeriods,
        period_seconds: fmt.periodSeconds,
      });
      setSessions(prev => [g, ...prev]);
      setShowNewGame(false);
      setNewGameOpponent('');
      setNewGameLocation('');
      setNewGameYear('');
      setNewGameTeamId(null);
      setNewGameDate(new Date());
      setTrackMode('live');
      // Both modes open the same entry screen; post-game just also offers import.
      openLiveEntry(g);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('teamGrade.couldNotCreateGame'));
    }
    setCreating(false);
  };

  // ── Post-game import ─────────────────────────────────────────────────────────

  /**
   * Save a file that carried no box score — a play-by-play export, a shot
   * chart, a team-totals panel. There is nothing to tick row by row, so there
   * is nothing to stop for; refusing these meant a coach could only ever add
   * stats in one shape.
   */
  const commitExtrasOnly = async (extras: any, sides: Record<string, boolean>) => {
    if (!activeGame) return;
    const rows = (extras.events?.length ?? 0) + (extras.shots?.length ?? 0)
               + (extras.team_stats?.length ?? 0);
    setImporting(true);
    try {
      await importsAPI.gameStatsCommit({ game_id: activeGame.id, ...extras, label_sides: sides });
      setImportedExtras({ events: [], shots: [], team_stats: [] });
      setStatsVersion(v => v + 1);
      setActiveGame(await gameEvalAPI.getSession(activeGame.id));
      Alert.alert(tr('teamGrade.importedTitle'), tr('teamGrade.importedMsg', { count: rows }));
    } catch (e: any) {
      Alert.alert(tr('teamGrade.importErrorTitle'),
                  e?.response?.data?.detail ?? tr('teamGrade.couldNotImportStats'));
    } finally {
      setImporting(false);
    }
  };

  /** The coach has said which team each unnamed label is. */
  const applyLabelSides = async (sides: Record<string, boolean>) => {
    setLabelSides(sides);
    setAskLabels([]);
    if (statPreview) {
      // The answer decides the side for the players under that heading too, so
      // the review list opens with them already on the right team.
      setStatPreview(rows => (rows ?? []).map((p: any) => {
        const answer = sides[String(p.team_name ?? '').trim()];
        return answer === undefined ? p : { ...p, is_opponent: answer };
      }));
      return;
    }
    await commitExtrasOnly(importedExtras, sides);
  };

  // AI stat import: any file → preview → confirm → commit.
  const importGameStats = async () => {
    if (!activeGame) return;
    try {
      // Any type, any number: a game's numbers arrive as a stat sheet plus a
      // shooting breakdown, or two photos of one page, or a PDF for us and a
      // screenshot for them.
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*', copyToCacheDirectory: true, multiple: true,
      });
      if (res.canceled || !res.assets?.length) return;
      setImporting(true);
      setImportProgress({ done: 0, total: res.assets.length });
      const result = await importsAPI.gameStatsPreview(
        res.assets.map(f => ({
          uri: f.uri,
          name: f.name ?? 'boxscore',
          type: f.mimeType ?? 'application/octet-stream',
        })),
        activeGame.id,
        (done, total) => setImportProgress({ done, total }),
      );
      const extras = { events: result.events ?? [], shots: result.shots ?? [],
                       team_stats: result.team_stats ?? [] };
      setImportedExtras(extras);
      const players = (result?.players ?? []).map((p: any) => ({ ...p, _include: true }));
      if (result.unresolved?.length) {
        // The file did not name the teams. Hold everything and ask — a guess at
        // which column is which reads as knowledge once it is a bar on a chart,
        // and it files a whole team's totals under the other team's name.
        setLabelSides({});
      setTeamMine({});
        setAskLabels(result.unresolved);
        setStatPreview(players.length ? players : null);
        return;
      }
      if (!players.length) {
        const extraRows = extras.events.length + extras.shots.length + extras.team_stats.length;
        if (!extraRows) {
          Alert.alert(tr('teamGrade.nothingFoundTitle'), tr('teamGrade.nothingFoundMsg'));
          return;
        }
        await commitExtrasOnly(extras, {});
        return;
      }
      setLabelSides({});
      setTeamMine({});
      setStatPreview(players);
    } catch (e: any) {
      Alert.alert(tr('teamGrade.importErrorTitle'), e?.response?.data?.detail ?? tr('teamGrade.couldNotReadFile'));
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const commitGameStats = async () => {
    if (!activeGame || !statPreview) return;
    const players = statPreview.filter((p: any) => p._include).map(({ _include, ...rest }: any) => rest);
    if (!players.length) { Alert.alert(tr('teamGrade.nothingSelectedTitle'), tr('teamGrade.nothingSelectedMsg')); return; }
    setImporting(true);
    try {
      // Every team the file named, with the answer showing on screen — the
      // effective value, not just the ones toggled, so a team left alone is
      // sent as what the coach was looking at rather than as no answer.
      const team_mine: Record<string, boolean> = {};
      for (const g of previewGroups) if (g.name) team_mine[g.name] = mineFor(g.name);
      const result = await importsAPI.gameStatsCommit({
        game_id: activeGame.id, players, ...importedExtras, label_sides: labelSides, team_mine,
      });
      const stats = await gameEvalAPI.listStats(activeGame.id);
      setGameStats(stats);
      setStatPreview(null);
      setImportedExtras({ events: [], shots: [], team_stats: [] });
      // The panel below reads its own data, so it has to be told the game
      // changed — an import you cannot see the result of is an import you have
      // to take on trust.
      setStatsVersion(v => v + 1);
      const fresh = await gameEvalAPI.getSession(activeGame.id);
      setActiveGame(fresh);
      Alert.alert(tr('teamGrade.importedTitle'), tr('teamGrade.importedMsg', { count: result?.imported ?? 0 }));
    } catch (e: any) {
      Alert.alert(tr('teamGrade.importErrorTitle'), e?.response?.data?.detail ?? tr('teamGrade.couldNotImportStats'));
    } finally {
      setImporting(false);
    }
  };

  // ── Live entry ───────────────────────────────────────────────────────────────

  const openLiveEntry = async (game: any) => {
    setActiveGame(game);
    // The game's score, which is the derived one when nobody typed a score in
    // — so a game whose box score is imported shows its result rather than 0-0.
    setOurScore(game.our_score ?? 0);
    setOppScore(game.opponent_score ?? 0);
    setActiveQuarter(1);
    setPeriodIndex(1);
    setClockRemaining(game.period_seconds ?? 480);
    setClockRunning(false);
    setSelectedPlayer(null);
    setActiveView('live');
    if (game.team_id) {
      try {
        const players = await playersAPI.list(game.team_id);
        setRoster(players);
      } catch {
        setRoster([]);
      }
    } else {
      setRoster([]);
    }
    await loadOpponentRoster(game);
  };

  /**
   * Everyone it is possible to tap on the opponent's side.
   *
   * Two places hold opponent players and only one of them was being read. Names
   * typed into this pad during a game are saved against the opponent's name; a
   * team the coach has actually built in Roster — with numbers and positions
   * already entered — lives with the rest of their teams. So a coach who had
   * set Duke up properly still opened the pad to an empty list and a text box,
   * and ended up typing the same twelve names in again mid-game.
   *
   * Both are shown. Where the same player is in both, the one saved against
   * this opponent wins: it is the more recently corrected of the two.
   */
  /**
   * The team in this coach's system that IS the opponent, if they built one.
   *
   * Opening a game straight from a link can beat the team list to the screen,
   * and a roster missing because of a race is indistinguishable from one that
   * was never built — so the list is fetched rather than assumed.
   */
  const findOpponentTeam = async (game: any) => {
    let known = teams;
    if (!known.length) {
      try { known = await teamsAPI.list(); } catch { known = []; }
    }
    return known.find((tm: any) => norm(tm.name) === norm(game.opponent_name)
                                && tm.id !== game.team_id);
  };

  const loadOpponentRoster = async (game: any) => {
    const merged: any[] = [];
    const seen = new Set<string>();
    const push = (p: any) => {
      const key = String(p.player_name ?? '').trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(p);
    };
    try {
      (await gameEvalAPI.listOpponentPlayers(game.opponent_name)).forEach(push);
    } catch { /* an opponent with nothing saved is not an error */ }
    const theirTeam = await findOpponentTeam(game);
    if (theirTeam) {
      try {
        (await playersAPI.list(theirTeam.id)).forEach((p: any) => push({
          id: `team-${p.id}`, player_name: p.name,
          jersey_number: p.jersey_number, position: p.position,
        }));
      } catch { /* as above */ }
    }
    setOpponentRoster(merged);
    setOpponentPlayers(merged.map((p: any) => p.player_name));
  };

  // Game clock tick — decrement once per second while running.
  useEffect(() => {
    if (!clockRunning) return;
    const iv = setInterval(() => {
      setClockRemaining(prev => {
        if (prev <= 1) {
          // Period ended: auto-stop and auto-advance to the next period.
          setClockRunning(false);
          setPeriodIndex(pi => pi + 1);
          return gameFmt.periodSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [clockRunning, gameFmt.periodSeconds]);

  // The clock drives the weight bucket: whenever the derived bucket changes,
  // update activeQuarter (still tappable as a manual override between crossings).
  const derivedBucket = weightBucket(gameFmt, periodIndex, clockRemaining);
  useEffect(() => {
    if (activeView === 'live') setActiveQuarter(derivedBucket);
  }, [derivedBucket, activeView]);

  /**
   * Move the whole game to a period — clock, header and stat tagging together.
   *
   * These used to be two controls that looked like one. The row below the clock
   * set only which bucket a stat was filed under, so tapping Q3 left the header
   * and the clock in Q2 — and because the bucket re-derives from the clock, the
   * next boundary crossing silently undid the tap. A coach who moved to Q3 and
   * kept tapping stats was filing them under a quarter they thought they had
   * left, which is the one thing a tracker must not do quietly.
   */
  const goToBucket = (bucket: number) => {
    const { periodIndex: pi, remaining } = periodForBucket(gameFmt, bucket);
    setPeriodIndex(pi);
    setClockRemaining(remaining);
    setClockRunning(false);
    setActiveQuarter(bucket);
  };

  const advancePeriod = () => {
    setPeriodIndex(pi => pi + 1);
    setClockRemaining(gameFmt.periodSeconds);
    setClockRunning(false);
  };
  const applyClockEdit = () => {
    const m = Math.max(0, parseInt(editMin, 10) || 0);
    const sc = Math.min(59, Math.max(0, parseInt(editSec, 10) || 0));
    setClockRemaining(m * 60 + sc);
    setShowClockEdit(false);
  };

  const addOpponentPlayer = async () => {
    const name = newOppPlayer.trim();
    if (!name || !activeGame) return;
    try {
      const saved = await gameEvalAPI.addOpponentPlayer(activeGame.opponent_name, {
        player_name: name,
        jersey_number: newOppJersey.trim() || undefined,
        position: newOppPosition.trim() || undefined,
      });
      setOpponentRoster(prev => prev.some(p => p.player_name === saved.player_name)
        ? prev.map(p => (p.player_name === saved.player_name ? saved : p))
        : [...prev, saved]);
      setOpponentPlayers(prev => prev.includes(saved.player_name) ? prev : [...prev, saved.player_name]);
      setSelectedPlayer(saved.player_name);
      // The player belongs on the opponent's team, and if that team does not
      // exist yet it is made — the same rule the box-score import follows.
      // Someone added during a game was previously known only to that game, so
      // the same names had to be typed in again next time they played.
      try {
        let theirTeam = await findOpponentTeam(activeGame);
        if (!theirTeam && activeGame.opponent_name) {
          theirTeam = await teamsAPI.create({ name: activeGame.opponent_name });
          setTeams(prev => [...prev, theirTeam]);
        }
        if (theirTeam) {
          const existing = await playersAPI.list(theirTeam.id);
          if (!existing.some((p: any) => norm(p.name) === norm(name))) {
            await playersAPI.create({
              name, team_id: theirTeam.id,
              jersey_number: newOppJersey.trim() || undefined,
              position: newOppPosition.trim() || undefined,
            });
          }
        }
      } catch {
        // The game is what matters here. A roster that did not take can be
        // fixed on the Roster page; a stat that cannot be tapped cannot.
      }
    } catch {
      // Don't block stat entry if the save fails — keep the name locally.
      setOpponentPlayers(prev => prev.includes(name) ? prev : [...prev, name]);
      setSelectedPlayer(name);
    }
    setNewOppPlayer('');
    setNewOppJersey('');
    setNewOppPosition('');
  };

  /**
   * Add someone to our own bench mid-game.
   *
   * A walk-on, a call-up, a player whose name never made it onto the roster —
   * they were tappable on the opponent's side and nowhere on ours, so the only
   * way to record what our own twelfth player did was to leave the game, go to
   * Roster, add them, and come back. This puts them on the team properly, so
   * they are there next game too.
   */
  const addOurPlayer = async () => {
    const name = newOppPlayer.trim();
    if (!name || !activeGame?.team_id) return;
    try {
      const saved = await playersAPI.create({
        name, team_id: activeGame.team_id,
        jersey_number: newOppJersey.trim() || undefined,
        position: newOppPosition.trim() || undefined,
      });
      setRoster(prev => prev.some((p: any) => norm(p.name) === norm(saved.name))
        ? prev : [...prev, saved]);
      setSelectedPlayer(saved.name);
    } catch (e: any) {
      Alert.alert(tr('common.error'),
                  e?.response?.data?.detail ?? tr('teamGrade.couldNotAddPlayer'));
      return;
    }
    setNewOppPlayer('');
    setNewOppJersey('');
    setNewOppPosition('');
  };

  const openGradeDetail = async (playerName: string) => {
    setGradeDetailPlayer(playerName);
    setGradeDetailData([]);
    setGradeDetailLoading(true);
    try {
      const data = await gameEvalAPI.playerGameHistory(playerName);
      setGradeDetailData(data);
    } catch {
      setGradeDetailData([]);
    }
    setGradeDetailLoading(false);
  };

  const SCORE_DELTA: Record<string, number> = {
    '2 FG Made': 2, '3 FG Made': 3, 'FT Made': 1,
  };

  const logStat = async (statName: string) => {
    if (!activeGame || !selectedPlayer) {
      Alert.alert(tr('teamGrade.selectPlayerAlertTitle'), tr('teamGrade.selectPlayerAlertMsg'));
      return;
    }
    const category = OFFENSE_STATS.includes(statName) ? 'offense' : 'defense';
    const count = 1;
    const rawPoints = computeRawPoints(statName, count);
    try {
      await gameEvalAPI.logStat(activeGame.id, {
        player_name: selectedPlayer,
        is_opponent: entryMode === 'opponent',
        quarter: activeQuarter,
        stat_name: statName,
        stat_category: category,
        raw_points: rawPoints,
        count,
      });
      // Auto-update scoreboard for scoring plays
      const scoreDelta = SCORE_DELTA[statName];
      if (scoreDelta) {
        if (entryMode === 'our') updateScore('our', scoreDelta);
        else updateScore('opp', scoreDelta);
      }
      // Flash the button and show toast
      setFlashStat(statName);
      setStatToast(tr('teamGrade.statLoggedToast', { player: selectedPlayer, stat: statLabel(statName) }));
      setTimeout(() => { setFlashStat(null); setStatToast(null); }, 1200);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('teamGrade.couldNotLogStat'));
    }
  };

  const updateScore = (team: 'our' | 'opp', delta: number) => {
    // Functional updates so rapid taps (and the auto-score from logStat) always
    // accumulate off the latest value, never a stale closure.
    let nextOur = ourScore;
    let nextOpp = oppScore;
    if (team === 'our') {
      setOurScore(prev => (nextOur = Math.max(0, prev + delta)));
    } else {
      setOppScore(prev => (nextOpp = Math.max(0, prev + delta)));
    }
    if (activeGame) {
      // ONLY the side that was tapped. Sending both wrote an explicit 0 for the
      // team nobody had touched — and an explicit score always beats the one
      // worked out from the box score, so a single tap on a live game replaced
      // a real result with 0-0 permanently. The untouched side stays as it was,
      // which for an unscored game means "still unknown".
      setTimeout(() => {
        gameEvalAPI.updateSession(activeGame.id,
          team === 'our' ? { our_score: nextOur } : { opponent_score: nextOpp },
        ).catch(() => {});
      }, 0);
    }
  };

  const endGame = async () => {
    if (!activeGame) return;
    Alert.alert(tr('teamGrade.endGame'), tr('teamGrade.endGameConfirm'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('teamGrade.endGame'), style: 'default', onPress: async () => {
          try {
            const updated = await gameEvalAPI.updateSession(activeGame.id, { status: 'completed' });
            setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
            // Refresh dashboard so new game shows immediately
            gameEvalAPI.getSeasonDashboard().then(setDashboard).catch(() => {});
            openDetail(updated);
          } catch (e: any) {
            Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('teamGrade.couldNotEndGame'));
          }
        },
      },
    ]);
  };

  // ── Game detail ──────────────────────────────────────────────────────────────

  /** Switch tab, and remember it has been drawn. */
  const openTab = (tab: 'insights' | 'our' | 'opponent' | 'byquarter') => {
    setDetailTab(tab);
    setSeenTabs(prev => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  };

  const openDetail = async (game: any) => {
    setDetailGame(game);
    setActiveView('detail');
    setExpandedPlayer(null);
    setShowScoutingReport(false);
    setSummary(null);
    setGameStats([]);
    setGameLineup([]);
    setLoadingSummary(true);
    const detailKey = `game.${coach?.id ?? 0}.${game.id}`;
    readPage<any>(detailKey).then(kept => {
      if (!kept?.summary) return;
      setSummary((prev: any) => prev ?? kept.summary);
      setLoadingSummary(false);
    });
    try {
      const [s, stats, lineup, fresh] = await Promise.all([
        gameEvalAPI.getGameSummary(game.id),
        gameEvalAPI.listStats(game.id),
        gameEvalAPI.getLineup(game.id),
        // The game as the server sees it, which is where the score worked out
        // from the box score comes from. Whichever list this game was tapped
        // from may predate the import that gave it a result.
        gameEvalAPI.getSession(game.id).catch(() => null),
      ]);
      setSummary(s);
      setGameStats(stats);
      setGameLineup(lineup);
      if (fresh) setDetailGame(fresh);
      void writePage(detailKey, { summary: s });
    } catch {}
    setLoadingSummary(false);
  };

  // Deep link from the Staff Hub: open a team game straight into its detail view
  // so staff can see the full game data (stats, grades, scouting).
  const handledOpenGameId = useRef<number | null>(null);
  useFocusEffect(useCallback(() => {
    const gid = route?.params?.openGameId;
    if (gid && handledOpenGameId.current !== gid) {
      handledOpenGameId.current = gid;
      (async () => {
        try {
          const game = await gameEvalAPI.getSession(gid);
          await openDetail(game);
        } catch {
          Alert.alert(tr('teamGrade.unavailableTitle'), tr('teamGrade.couldNotOpenGame'));
        }
      })();
      navigation?.setParams?.({ openGameId: undefined });
    }
  }, [route?.params?.openGameId]));

  // The game the address bar is holding, reopened on a fresh load. A coach who
  // refreshes inside a game was put back on the dashboard, having lost the page
  // they were reading — the open game only ever existed in this screen's state.
  // The address bar follows the screen: which of the four tabs is open, the
  // game inside it, and the tab within that game. Done in one place rather than
  // in every button that moves — a press that set one param while another
  // cleared it left the address describing a page nobody was on.
  useEffect(() => {
    const inGame = activeView === 'detail' && !!detailGame;
    navigation.setParams?.({
      view: activeView === 'live' ? undefined : activeView,
      game: inGame ? String(detailGame.id) : undefined,
      tab: inGame ? detailTab : undefined,
      // A scouted team and a game's written report are the same shape of
      // thing as an open game: you got there from a list, and a refresh was
      // sending you back to that list. Each of those pages is one scroll with
      // no tabs of its own, so the selection is the whole of what to keep.
      scout: activeView === 'scout' && scoutOpponent ? scoutOpponent : undefined,
      report: activeView === 'gamereport' && gameReportGame
        ? String(gameReportGame.id) : undefined,
    });
  }, [activeView, detailGame?.id, detailTab, scoutOpponent, gameReportGame?.id]);

  const restoredScout = useRef(false);
  useEffect(() => {
    const name = route?.params?.scout;
    if (!name || restoredScout.current || scoutOpponent) return;
    restoredScout.current = true;
    void openScout(String(name));
  }, [route?.params?.scout]);

  const restoredReport = useRef(false);
  useEffect(() => {
    const rid = Number(route?.params?.report);
    if (!rid || restoredReport.current || gameReportGame) return;
    restoredReport.current = true;
    (async () => {
      try {
        openGameReport(await gameEvalAPI.getSession(rid));
      } catch {
        // Gone, or somebody else's. Stay on the list rather than on a page
        // that cannot load.
        navigation?.setParams?.({ report: undefined });
      }
    })();
  }, [route?.params?.report]);

  // And the tab it was holding, restored on a fresh load.
  const restoredView = useRef(false);
  useEffect(() => {
    const v = route?.params?.view;
    if (!v || restoredView.current) return;
    restoredView.current = true;
    if (['dashboard', 'games', 'scout', 'gamereport'].includes(v)) setActiveView(v as ViewKey);
  }, [route?.params?.view]);

  const restoredGame = useRef(false);
  useEffect(() => {
    const gid = Number(route?.params?.game);
    if (!gid || restoredGame.current || detailGame) return;
    restoredGame.current = true;
    (async () => {
      try {
        const game = await gameEvalAPI.getSession(gid);
        await openDetail(game);
        const tab = route?.params?.tab;
        if (tab && ['insights', 'our', 'opponent', 'byquarter'].includes(tab)) {
          openTab(tab);
        }
      } catch {
        // The game is gone, or belongs to somebody else. Leave the address
        // alone and stay where the app landed.
        navigation?.setParams?.({ game: undefined, tab: undefined });
      }
    })();
  }, [route?.params?.game]);

  // Deep link from Ask BloomPrint: land on the exact view/modal it promised —
  // openView ('dashboard'|'games'|'scout'|'gamereport'), openNewGame (Games +
  // the New Game form), openPlaybook (the whiteboard playbook).
  useFocusEffect(useCallback(() => {
    const p = route?.params ?? {};
    if (!p.openView && !p.openNewGame && !p.openPlaybook) return;
    if (p.openView && ['dashboard', 'games', 'scout', 'gamereport'].includes(p.openView)) {
      setActiveView(p.openView as ViewKey);
    }
    if (p.openNewGame) {
      setActiveView('games');
      setShowNewGame(true);
    }
    if (p.openPlaybook) setWhiteboardPlaybook(true);
    navigation?.setParams?.({ openView: undefined, openNewGame: undefined, openPlaybook: undefined });
  }, [route?.params?.openView, route?.params?.openNewGame, route?.params?.openPlaybook]));

  // A frozen game is filed in my account but is a record of somebody else's
  // night: it is read-only, so every edit affordance is off for it too.
  const isOwnedGame = (game: any) => !game || (game.coach_id === coach?.id && !game.frozen_from);

  const openPlayerStats = (playerName: string) => {
    setStatsModalPlayer(playerName);
    setShowStatsModal(true);
  };

  const deleteStatEntry = async (statId: number) => {
    if (!detailGame) return;
    try {
      await gameEvalAPI.deleteStat(statId);
      setGameStats(prev => prev.filter(s => s.id !== statId));
      // Refresh summary grades
      const s = await gameEvalAPI.getGameSummary(detailGame.id);
      setSummary(s);
    } catch (e: any) {
      Alert.alert(tr('common.error'), tr('teamGrade.couldNotDeleteStat'));
    }
  };

  const addStatEntry = async (statName: string, quarter: number) => {
    if (!detailGame || !statsModalPlayer) return;
    setAddingStat(true);
    try {
      const isOff = OFFENSE_STATS.includes(statName);
      const category = isOff ? 'offense' : 'defense';
      // compute raw points using same logic as STAT_POINTS in the file
      const STAT_POINTS_LOCAL: Record<string, { base_low: number; base_high: number; threshold: number }> = {
        '2 FG Made':          { base_low: 2,  base_high: 3,  threshold: 4 },
        '2 FG Missed':        { base_low: -1, base_high: -2, threshold: 4 },
        '3 FG Made':          { base_low: 3,  base_high: 4,  threshold: 4 },
        '3 FG Missed':        { base_low: -1, base_high: -2, threshold: 4 },
        'Off. Reb':           { base_low: 3,  base_high: 4,  threshold: 4 },
        'Draw PF':            { base_low: 1,  base_high: 1,  threshold: 4 },
        'Assists':            { base_low: 3,  base_high: 4,  threshold: 4 },
        'Turnover':           { base_low: -2, base_high: -2, threshold: 4 },
        'Hockey Assist':      { base_low: 2,  base_high: 2,  threshold: 4 },
        'FT Made':            { base_low: 2,  base_high: 3,  threshold: 4 },
        'FT Missed':          { base_low: -1, base_high: -2, threshold: 4 },
        'Def. Reb':           { base_low: 3,  base_high: 4,  threshold: 4 },
        'Steal':              { base_low: 3,  base_high: 4,  threshold: 4 },
        'Deflection':         { base_low: 3,  base_high: 4,  threshold: 4 },
        'Def. Stop':          { base_low: 3,  base_high: 3,  threshold: 4 },
        'Charge':             { base_low: 5,  base_high: 7,  threshold: 4 },
        'Bluff':              { base_low: 1,  base_high: 1,  threshold: 4 },
        'Blocked Shot':       { base_low: 2,  base_high: 2,  threshold: 4 },
        'Jog Back':           { base_low: -3, base_high: -3, threshold: 4 },
        'No Ball Pressure':   { base_low: -1, base_high: -1, threshold: 4 },
        'Defensive Mistake':  { base_low: -1, base_high: -1, threshold: 4 },
        'No Contest':         { base_low: -1, base_high: -1, threshold: 4 },
        'No Block Out':       { base_low: -1, base_high: -1, threshold: 4 },
        'Foul Against':       { base_low: -1, base_high: -1, threshold: 4 },
      };
      const cfg = STAT_POINTS_LOCAL[statName];
      const rawPoints = cfg ? cfg.base_low : 0;
      const result = await gameEvalAPI.logStat(detailGame.id, {
        player_name: statsModalPlayer,
        is_opponent: detailTab === 'opponent',
        quarter,
        stat_name: statName,
        stat_category: category,
        raw_points: rawPoints,
        count: 1,
      });
      // refresh stats and summary
      const [newStats, newSummary] = await Promise.all([
        gameEvalAPI.listStats(detailGame.id),
        gameEvalAPI.getGameSummary(detailGame.id),
      ]);
      setGameStats(newStats);
      setSummary(newSummary);
      setAddStatName('');
      setAddingStatDropdownOpen(false);
    } catch (e: any) {
      Alert.alert(tr('common.error'), tr('teamGrade.couldNotAddStat'));
    }
    setAddingStat(false);
  };

  const generateScoutingReport = async () => {
    if (!detailGame) return;
    setGeneratingReport(true);
    try {
      const result = await gameEvalAPI.getScoutingReport(detailGame.id);
      setDetailGame((prev: any) => ({ ...prev, ai_scouting_report: result.ai_scouting_report }));
      setShowScoutingReport(true);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? e?.message ?? tr('teamGrade.couldNotGenerateReport'));
    }
    setGeneratingReport(false);
  };

  const openGameReport = async (game: any) => {
    if (!game) return;
    setGameReportGame(game);
    setActiveView('gamereport');
    setLoadingGameReport(true);
    try {
      // Pull the freshest session so we have this coach's persisted game report.
      const fresh = await gameEvalAPI.getSession(game.id);
      setGameReportGame(fresh);
    } catch {
      // keep the game we already have
    }
    setLoadingGameReport(false);
  };

  /**
   * HOME / AWAY for the two scores, decided by where the game was played.
   *
   * "US" and "THEM" told the coach what they already knew. Location is on the
   * game and is the only thing that says which side of a printed box score our
   * team is; on a neutral court neither label is true, so the names stand in.
   */
  const sideLabels = React.useMemo(() => {
    const where = String(activeGame?.location ?? '').trim().toLowerCase();
    const ourName = activeGame?.team_name
      ?? (teams as any[]).find(tm => tm.id === activeGame?.team_id)?.name
      ?? coach?.program_name ?? tr('teamGrade.ourTeam');
    if (where.startsWith('home')) return { ours: tr('teamGrade.home'), theirs: tr('teamGrade.away') };
    if (where.startsWith('away')) return { ours: tr('teamGrade.away'), theirs: tr('teamGrade.home') };
    return { ours: ourName, theirs: activeGame?.opponent_name ?? tr('teamGrade.opponent') };
  }, [activeGame, teams, coach, tr]);

  const saveFinalScore = async () => {
    if (!detailGame) return;
    // `parseInt('') || 0` is how a game ended up 0-0: opening the sheet and
    // saving without typing wrote two zeros over a score the box score already
    // knew. An empty box means "I did not say", so nothing is saved.
    const ours = parseInt(finalOurs, 10);
    const theirs = parseInt(finalTheirs, 10);
    if (!Number.isFinite(ours) || !Number.isFinite(theirs)) {
      setScoreError(tr('teamGrade.scoreNeededMsg'));
      return;
    }
    setScoreError('');
    setSavingScore(true);
    try {
      const updated = await gameEvalAPI.updateSession(detailGame.id, {
        our_score: ours,
        opponent_score: theirs,
      });
      setDetailGame(updated);
      setFinalOurs(''); setFinalTheirs('');
      setShowScoreEdit(false);
      loadData();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? e?.message ?? tr('teamGrade.couldNotSaveScore'));
    } finally {
      setSavingScore(false);
    }
  };

  const exportDetailPdf = async () => {
    // Game Insights is composed from the game itself, so it exports even when
    // the grade summary did not load — the other tabs are the grades, and
    // without them there is nothing to put in the file.
    if (!detailGame || (!summary && detailTab !== 'insights')) return;
    setExportingPdf(true);
    try {
      const gameDate = new Date(detailGame.date);
      const dateStr = gameDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const programName = coach?.program_name ?? 'Team';
      // The team that played this game, which is not always the account's
      // program name: a coach whose program is "SEED" running a team called
      // Angola exported "SEED vs Egypt" over a report about Angola.
      const ourName = detailGame.team_name
        || (teams as any[]).find(tm => tm.id === detailGame.team_id)?.name || programName;
      // The score, without a verdict word. "WIN 83-72" above a report that
      // already says "FINAL: Angola 83 — Egypt 72 (WIN)" reads as a second,
      // competing claim about the same game.
      const result = detailGame.our_score != null
        ? `${detailGame.our_score}-${detailGame.opponent_score}`
        : 'Score N/A';
      const phase = detailGame.season_phase ? ` · ${detailGame.season_phase.charAt(0).toUpperCase() + detailGame.season_phase.slice(1)}` : '';
      const year = detailGame.season_year ? ` ${detailGame.season_year}` : '';

      let html: string;

      if (detailTab === 'insights') {
        // The Game Insights tab is tables — team grade, leaders, shooting, key
        // stats and both box scores. Exporting it used to hand back a list of
        // player grades as running text, which was neither the page nor a
        // table. The server composes that page already, for sharing, so the
        // export asks for the same document rather than a second one built
        // here that could drift from what the tab draws.
        const { text } = await gameEvalAPI.insightsText(detailGame.id);
        // Its first line is the title and its second is the date, both of
        // which the cover above it already says.
        const lines = text.split('\n').slice(1);
        if ((lines[0] ?? '').trim() === dateStr) lines.shift();
        const body = lines.join('\n').trim();
        // Named by the team that played, which is what the page and the box
        // scores below it say. The program name is the account's — a coach
        // running "SEED" with a team called Angola exported "SEED vs Egypt"
        // over a report about Angola.
        const heading = (text.split('\n')[0] ?? '').trim();
        html = buildReportHtml({
          title: heading || `${ourName} vs ${detailGame.opponent_name}`,
          subject: `${result}${phase}${year}`,
          date: dateStr,
          body,
        });
      } else if (detailTab === 'byquarter') {
        // Build quarter comparison HTML with table + per-player breakdown
        const ourStats = gameStats.filter((st: any) => !st.is_opponent);
        const qSet = new Set<number>();
        type QData = { weighted: number; counts: Record<string, number>; breakdown: Record<string, { count: number; wp: number }> };
        const players: Record<string, { total: number; quarters: Record<number, QData> }> = {};
        for (const st of ourStats) {
          qSet.add(st.quarter);
          if (!players[st.player_name]) players[st.player_name] = { total: 0, quarters: {} };
          const P = players[st.player_name];
          if (!P.quarters[st.quarter]) P.quarters[st.quarter] = { weighted: 0, counts: {}, breakdown: {} };
          const Q = P.quarters[st.quarter];
          Q.weighted += st.weighted_points;
          Q.counts[st.stat_name] = (Q.counts[st.stat_name] || 0) + (st.count || 1);
          if (!Q.breakdown[st.stat_name]) Q.breakdown[st.stat_name] = { count: 0, wp: 0 };
          Q.breakdown[st.stat_name].count += st.count || 1;
          Q.breakdown[st.stat_name].wp += st.weighted_points;
          P.total += st.weighted_points;
        }
        const qNums = Array.from(qSet).sort((a, b) => a - b);
        const qLabel = (q: number) => (q === 5 ? 'OT' : `Q${q}`);
        const playerNames = Object.keys(players).sort((a, b) => players[b].total - players[a].total);
        const teamQ: Record<number, number> = {};
        for (const q of qNums) teamQ[q] = playerNames.reduce((s, n) => s + (players[n].quarters[q]?.weighted || 0), 0);
        const teamTotal = playerNames.reduce((s, n) => s + players[n].total, 0);
        const fmt = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1);
        const fmtColor = (v: number) => v > 0 ? t.positive : v < 0 ? t.negative : t.muted;
        const trad = (c: Record<string, number>) => {
          const fgm = (c['2 FG Made'] || 0) + (c['3 FG Made'] || 0);
          const fga = fgm + (c['2 FG Missed'] || 0) + (c['3 FG Missed'] || 0);
          return {
            pts: (c['2 FG Made'] || 0) * 2 + (c['3 FG Made'] || 0) * 3 + (c['FT Made'] || 0),
            reb: (c['Off. Reb'] || 0) + (c['Def. Reb'] || 0),
            ast: c['Assists'] || 0,
            stl: c['Steal'] || 0,
            blk: c['Blocked Shot'] || 0,
            to: c['Turnover'] || 0,
            fg: fga > 0 ? `${fgm}/${fga}` : '—',
          };
        };

        const thStyle = `padding:6px 8px;background:#1e1b4b;color:#fff;font-size:10px;font-weight:800;text-align:center;`;
        const tdStyle = `padding:5px 8px;font-size:10px;text-align:center;border-bottom:1px solid #e5e7eb;`;
        const nameTd = `padding:5px 8px;font-size:10px;font-weight:700;border-bottom:1px solid #e5e7eb;`;

        // Matrix table
        let matrixRows = '';
        for (const name of playerNames) {
          const P = players[name];
          const cells = qNums.map(q => {
            const w = P.quarters[q]?.weighted;
            const col = w == null ? t.muted : fmtColor(w);
            return `<td style="${tdStyle}color:${col};font-weight:700">${w == null ? '–' : fmt(w)}</td>`;
          }).join('');
          matrixRows += `<tr>
            <td style="${nameTd}">${name}</td>
            ${cells}
            <td style="${tdStyle}color:#6d28d9;font-weight:800">${fmt(P.total)}</td>
          </tr>`;
        }
        const teamCells = qNums.map(q => {
          const col = fmtColor(teamQ[q] || 0);
          return `<td style="${tdStyle}color:${col};font-weight:800">${fmt(teamQ[q] || 0)}</td>`;
        }).join('');

        // Per-player detail sections
        let playerSections = '';
        for (const name of playerNames) {
          const P = players[name];
          let qRows = '';
          for (const q of qNums.filter(q => P.quarters[q])) {
            const Q = P.quarters[q];
            const tr = trad(Q.counts);
            const breakdownRows = Object.entries(Q.breakdown).map(([sn, d]) =>
              `<tr>
                <td style="padding:3px 6px;font-size:9px;color:#374151">${sn}${d.count > 1 ? ` ×${d.count}` : ''}</td>
                <td style="padding:3px 6px;font-size:9px;font-weight:700;text-align:right;color:${d.wp >= 0 ? '#6F8B45' : '#B0654C'}">${d.wp >= 0 ? '+' : ''}${d.wp.toFixed(1)}</td>
              </tr>`
            ).join('');
            qRows += `
              <tr style="background:#f9fafb">
                <td colspan="9" style="padding:8px 10px 2px;font-size:10px;font-weight:800;color:#6d28d9">${qLabel(q)}
                  <span style="color:#6b7280;font-weight:400;margin-left:10px">${fmt(Q.weighted)} grade pts</span>
                </td>
              </tr>
              <tr>
                <td style="padding:3px 10px 8px" colspan="9">
                  <table style="width:100%;border-collapse:collapse">
                    <tr style="background:#f3f4f6">
                      ${['PTS','REB','AST','STL','BLK','TO','FG'].map(l => `<th style="padding:4px 6px;font-size:9px;color:#6b7280;text-align:center">${l}</th>`).join('')}
                    </tr>
                    <tr>
                      ${[tr.pts, tr.reb, tr.ast, tr.stl, tr.blk, tr.to, tr.fg].map(v => `<td style="padding:4px 6px;font-size:11px;font-weight:800;text-align:center">${v}</td>`).join('')}
                    </tr>
                    <tr><td colspan="7" style="padding-top:6px">
                      <table style="width:100%;border-collapse:collapse">${breakdownRows}</table>
                    </td></tr>
                  </table>
                </td>
              </tr>`;
          }
          playerSections += `
            <div style="page-break-inside:avoid;margin-top:20px">
              <h3 style="font-size:12px;font-weight:800;color:#111;text-transform:uppercase;
                         border-bottom:1.5px solid #ddd;padding-bottom:4px;margin:0 0 6px">${name}
                <span style="color:#6d28d9;margin-left:10px">${fmt(P.total)} total</span>
              </h3>
              <table style="width:100%;border-collapse:collapse">${qRows}</table>
            </div>`;
        }

        html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
          <style>
            @page { margin: 18mm 16mm; }
            body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size:11px; color:#111; }
            .cover { margin-bottom:16px; border-bottom:2px solid #111; padding-bottom:10px; }
            .cover h1 { font-size:18px; font-weight:900; margin:0 0 4px; }
            .cover .meta { font-size:11px; color:#555; }
            table { border-collapse:collapse; width:100%; }
            .footer { position:fixed;bottom:0;left:0;right:0;text-align:center;font-size:9px;color:#aaa;padding:6px 0;border-top:1px solid #eee; }
          </style></head><body>
          <div class="cover">
            <h1>Quarter Comparison — ${ourName} vs ${detailGame.opponent_name}</h1>
            <div class="meta">${result} &nbsp;·&nbsp; ${dateStr}${phase}${year} &nbsp;·&nbsp; Team Grade: ${summary.team_grade.toFixed(2)}</div>
          </div>
          <div style="page-break-inside:avoid;margin-bottom:24px">
            <h3 style="font-size:12px;font-weight:800;text-transform:uppercase;border-bottom:1.5px solid #ddd;padding-bottom:4px;margin:0 0 8px">Quarter Comparison Matrix</h3>
            <table>
              <thead><tr>
                <th style="${thStyle}text-align:left">PLAYER</th>
                ${qNums.map(q => `<th style="${thStyle}">${qLabel(q)}</th>`).join('')}
                <th style="${thStyle}color:#c4b5fd">TOTAL</th>
              </tr></thead>
              <tbody>
                <tr style="background:#f3f4f6;font-weight:800">
                  <td style="${nameTd}color:#6d28d9">TEAM</td>
                  ${teamCells}
                  <td style="${tdStyle}color:#6d28d9;font-weight:800">${fmt(teamTotal)}</td>
                </tr>
                ${matrixRows}
              </tbody>
            </table>
          </div>
          <h3 style="font-size:12px;font-weight:800;text-transform:uppercase;border-bottom:1.5px solid #ddd;padding-bottom:4px;margin:0 0 4px">Player Detail By Quarter</h3>
          ${playerSections}
          <div class="footer">Generated by BloomPrint · ${dateStr}</div>
        </body></html>`;
      } else {
        // Asked as "is this the opponent tab", not "is this the our tab". With a
      // third and fourth tab in the row, "anything that isn't ours" quietly
      // meant the opponent — so exporting from Game Insights would have handed
      // over the other team's grades under our team's heading.
      const grades = detailTab === 'opponent' ? summary.opponent_grades : summary.player_grades;
        const gradeText = grades.map((g: any) =>
          `${g.player_name}\nOFF ${g.offensive_grade.toFixed(2)}  ·  DEF ${g.defensive_grade.toFixed(2)}  ·  ${minsLabel(g.minutes_played)} min  ·  Grade ${g.game_grade.toFixed(2)}`
        ).join('\n\n');

        const body = [
          `GAME SUMMARY`,
          `${ourName} vs ${detailGame.opponent_name}`,
          `${dateStr}${phase}${year}  ·  ${result}`,
          `Team Grade: ${summary.team_grade.toFixed(2)}`,
          ``,
          `PLAYER GRADES`,
          gradeText,
        ].join('\n');

        html = buildReportHtml({
          title: `Game Report — ${ourName} vs ${detailGame.opponent_name}`,
          subject: `${result}${phase}${year}`,
          date: dateStr,
          body,
        });
      }

      const fileName = buildPdfFileName(
        detailTab === 'byquarter' ? 'Quarter Report'
          : detailTab === 'insights' ? 'Game Insights' : 'Game Report',
        `${ourName} vs ${detailGame.opponent_name}${phase}`,
        gameDate,
      );
      const dest = (FileSystem.cacheDirectory ?? '') + fileName + '.pdf';
      await exportHtmlPdf(html, fileName);
    } catch (e: any) {
      Alert.alert(tr('teamGrade.exportErrorTitle'), e?.message ?? tr('teamGrade.couldNotExport'));
    }
    setExportingPdf(false);
  };

  const exportDetailCsv = async () => {
    if (!summary || !detailGame) return;
    setExportingCsv(true);
    try {
      const gameDate = new Date(detailGame.date);
      const dateStr = `${gameDate.getFullYear()}-${String(gameDate.getMonth() + 1).padStart(2, '0')}-${String(gameDate.getDate()).padStart(2, '0')}`;
      const programName = coach?.program_name ?? 'Team';
      // The team that played, same as the PDF.
      const ourName = detailGame.team_name
        || (teams as any[]).find(tm => tm.id === detailGame.team_id)?.name || programName;
      const phase = detailGame.season_phase ?? '';
      const result = detailGame.our_score != null
        ? `${detailGame.our_score > detailGame.opponent_score ? 'WIN' : 'LOSS'} ${detailGame.our_score}-${detailGame.opponent_score}`
        : '';

      const meta = `"Game","${ourName} vs ${detailGame.opponent_name}"\n"Date","${dateStr}"\n"Phase","${phase}"\n"Result","${result}"\n"Team Grade","${summary.team_grade.toFixed(2)}"\n\n`;

      let csv: string;

      if (detailTab === 'byquarter') {
        // One row per player per quarter, with traditional stats + grade points
        const ourStats = gameStats.filter((st: any) => !st.is_opponent);
        const qSet = new Set<number>();
        const players: Record<string, Record<number, { weighted: number; counts: Record<string, number> }>> = {};
        for (const st of ourStats) {
          qSet.add(st.quarter);
          if (!players[st.player_name]) players[st.player_name] = {};
          if (!players[st.player_name][st.quarter]) players[st.player_name][st.quarter] = { weighted: 0, counts: {} };
          const Q = players[st.player_name][st.quarter];
          Q.weighted += st.weighted_points;
          Q.counts[st.stat_name] = (Q.counts[st.stat_name] || 0) + (st.count || 1);
        }
        const qNums = Array.from(qSet).sort((a, b) => a - b);
        const qLabel = (q: number) => (q === 5 ? 'OT' : `Q${q}`);
        const playerNames = Object.keys(players).sort();
        const trad = (c: Record<string, number>) => {
          const fgm = (c['2 FG Made'] || 0) + (c['3 FG Made'] || 0);
          const fga = fgm + (c['2 FG Missed'] || 0) + (c['3 FG Missed'] || 0);
          return {
            pts: (c['2 FG Made'] || 0) * 2 + (c['3 FG Made'] || 0) * 3 + (c['FT Made'] || 0),
            reb: (c['Off. Reb'] || 0) + (c['Def. Reb'] || 0),
            ast: c['Assists'] || 0,
            stl: c['Steal'] || 0,
            blk: c['Blocked Shot'] || 0,
            to: c['Turnover'] || 0,
            fgm, fga,
          };
        };
        const header = 'Player,Quarter,PTS,REB,AST,STL,BLK,TO,FGM,FGA,Grade Points\n';
        const lines: string[] = [];
        for (const name of playerNames) {
          let pTotal = 0;
          for (const q of qNums) {
            const Q = players[name][q];
            if (!Q) continue;
            const tr = trad(Q.counts);
            pTotal += Q.weighted;
            lines.push(`"${name}",${qLabel(q)},${tr.pts},${tr.reb},${tr.ast},${tr.stl},${tr.blk},${tr.to},${tr.fgm},${tr.fga},${Q.weighted.toFixed(1)}`);
          }
          // Player total row
          const allCounts: Record<string, number> = {};
          for (const q of qNums) {
            const Q = players[name][q];
            if (!Q) continue;
            for (const [k, v] of Object.entries(Q.counts)) allCounts[k] = (allCounts[k] || 0) + v;
          }
          const tt = trad(allCounts);
          lines.push(`"${name}",TOTAL,${tt.pts},${tt.reb},${tt.ast},${tt.stl},${tt.blk},${tt.to},${tt.fgm},${tt.fga},${pTotal.toFixed(1)}`);
        }
        csv = meta + header + lines.join('\n');
      } else {
        const grades = detailTab === 'opponent' ? summary.opponent_grades : summary.player_grades;
        const header = 'Player,Offensive Grade,Defensive Grade,Minutes,Game Grade\n';
        const rows = grades.map((g: any) =>
          `"${g.player_name}",${g.offensive_grade.toFixed(2)},${g.defensive_grade.toFixed(2)},${minsLabel(g.minutes_played)},${g.game_grade.toFixed(2)}`
        ).join('\n');
        csv = meta + header + rows;
      }

      const reportLabel = detailTab === 'byquarter' ? 'Quarter Report' : 'Game Report';
      const fileName = `${reportLabel} - ${ourName} vs ${detailGame.opponent_name} - ${dateStr}.csv`.replace(/[^a-zA-Z0-9 \-_.]/g, '');
      const dest = (FileSystem.cacheDirectory ?? '') + fileName;
      await FileSystem.writeAsStringAsync(dest, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest, { mimeType: 'text/csv', dialogTitle: fileName });
      }
    } catch (e: any) {
      Alert.alert(tr('teamGrade.exportErrorTitle'), e?.message ?? tr('teamGrade.couldNotExportCsv'));
    }
    setExportingCsv(false);
  };

  // ── Opponent scout ────────────────────────────────────────────────────────────

  /**
   * One written sentence, fetched once and kept.
   *
   * Nothing here is written speculatively: the three team sections are asked
   * for when the page opens, and a player's only when that player is tapped.
   * Anything already stored comes back from /insights for free, so opening the
   * same page twice costs nothing.
   */
  const loadInsight = async (team: string, subject: string, refresh = false) => {
    setInsightBusy(prev => ({ ...prev, [subject]: true }));
    try {
      const res = await gameEvalAPI.scoutInsight(team, subject, refresh);
      setInsights(prev => ({ ...prev, [subject]: res }));
    } catch {
      // A sentence that could not be written must not take the numbers with it.
    } finally {
      setInsightBusy(prev => ({ ...prev, [subject]: false }));
    }
  };

  /**
   * Read the team's page again, without taking it off the screen.
   *
   * The coach leaves Scout to build a packet about the team and comes back;
   * the page they return to was drawn before any of that existed. Nothing is
   * cleared and no spinner appears — what is there stays until better data
   * replaces it, so a refresh that finds nothing new is invisible.
   */
  const refreshScout = useCallback(async (name: string) => {
    try {
      const [data, notes, kept] = await Promise.all([
        gameEvalAPI.getOpponentProfile(name),
        gameEvalAPI.getOpponentNotes(name).catch(() => []),
        gameEvalAPI.scoutInsights(name).catch(() => ({})),
      ]);
      setScoutData(data);
      setScoutNotes(notes ?? []);
      // Merged, not replaced: a sentence written seconds ago in this session
      // is not in the stored set yet and must not vanish.
      setInsights(prev => ({ ...prev, ...(kept as any) }));
      void writePage(`scout.${coach?.id ?? 0}.${name}`, { data, insights: kept });
    } catch {
      // Offline, or the team was renamed. What is on screen is still true.
    }
  }, [coach?.id]);

  // Every time this screen comes back into view with a team open.
  useFocusEffect(
    useCallback(() => {
      if (activeView === 'scout' && scoutOpponent) void refreshScout(scoutOpponent);
    }, [activeView, scoutOpponent, refreshScout]),
  );

  /**
   * Says a sentence predates material it should have been written from, and
   * offers to rewrite it.
   *
   * Marked rather than rewritten on sight: each rewrite is a call per subject,
   * and spending a page's worth of them because the coach opened a team is not
   * something to do on their behalf.
   */
  const StaleInsight = ({ subject }: { subject: string }) => {
    // Rewriting says so HERE, beside the sentence, which stays on screen. The
    // old line is still true and still worth reading; replacing it with a
    // spinner spends the wait showing the coach nothing.
    if (insightBusy[subject]) {
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <ActivityIndicator color={t.brown} size="small" />
          <Text style={{ color: t.brown, fontSize: 11.5, fontFamily: fonts[700] }}>
            {tr('teamGrade.insightRewriting')}
          </Text>
        </View>
      );
    }
    if (!insights[subject]?.stale) return null;
    return (
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}
        onPress={() => scoutOpponent && loadInsight(scoutOpponent, subject, true)}
      >
        <Ionicons name="refresh" size={13} color={t.brown} />
        <Text style={{ color: t.brown, fontSize: 11.5, fontFamily: fonts[700] }}>
          {tr('teamGrade.insightStale')}
        </Text>
      </TouchableOpacity>
    );
  };

  /** Tapping a player opens their line, and writes the sentence if there is none. */
  const openScoutPlayer = async (name: string) => {
    if (scoutPlayer === name) { setScoutPlayer(null); return; }
    setScoutPlayer(name);
    if (!insights[name] && scoutOpponent) await loadInsight(scoutOpponent, name);
  };

  const openScout = async (opponentName: string) => {
    setScoutOpponent(opponentName);
    setActiveView('scout');
    setScoutData(null);
    setScoutNotes([]);
    setNewNoteText('');
    setScoutPlayer(null);
    setInsights({});
    setInsightBusy({});
    setLoadingScout(true);
    setLoadingNotes(true);
    // Last time's page for this team, so the wait is spent looking at their
    // numbers rather than at a spinner. Overwritten the moment the live
    // profile lands a few lines below.
    const scoutKey = `scout.${coach?.id ?? 0}.${opponentName}`;
    readPage<any>(scoutKey).then(kept => {
      if (!kept) return;
      setScoutData((prev: any) => prev ?? kept.data ?? null);
      setInsights(prev => (Object.keys(prev).length ? prev : kept.insights ?? {}));
      setLoadingScout(false);
    });
    try {
      const [data, notes, kept] = await Promise.all([
        gameEvalAPI.getOpponentProfile(opponentName),
        gameEvalAPI.getOpponentNotes(opponentName),
        gameEvalAPI.scoutInsights(opponentName).catch(() => ({})),
      ]);
      setScoutData(data);
      setScoutNotes(notes);
      setInsights(kept as any);
      setLoadingScout(false);
      void writePage(scoutKey, { data, insights: kept });
      // Written sentences are NOT awaited. Three of them are three calls to
      // the model, and awaiting them here held the whole page on a spinner for
      // as long as they took — the games, the players and the numbers were all
      // sitting in `data`, ready, behind a wait for prose. They fill in where
      // they belong instead, and only when missing or written from fewer games
      // than the page is now showing.
      const n = data?.games_count ?? 0;
      for (const key of ['offense', 'defense', 'weak']) {
        const at = (kept as any)[key];
        if (!at || at.games !== n) void loadInsight(opponentName, key, true);
      }
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('teamGrade.couldNotLoadScout'));
    }
    setLoadingScout(false);
    setLoadingNotes(false);
  };

  const saveOpponentNote = async () => {
    if (!scoutOpponent || !newNoteText.trim()) return;
    setSavingNote(true);
    try {
      const note = await gameEvalAPI.addOpponentNote(scoutOpponent, newNoteText.trim());
      setScoutNotes(prev => [...prev, note]);
      setNewNoteText('');
    } catch {
      Alert.alert(tr('common.error'), tr('teamGrade.couldNotSaveNote'));
    }
    setSavingNote(false);
  };

  const deleteOpponentNote = async (noteId: number) => {
    try {
      await gameEvalAPI.deleteOpponentNote(noteId);
      setScoutNotes(prev => prev.filter(n => n.id !== noteId));
    } catch {
      Alert.alert(tr('common.error'), tr('teamGrade.couldNotDeleteNote'));
    }
  };

  const regenerateScoutingReport = async () => {
    if (!scoutOpponent) return;
    // Find the most recent game against this opponent
    const game = sessions.find(s => s.opponent_name === scoutOpponent);
    if (!game) return;
    setRegeneratingScout(true);
    try {
      await gameEvalAPI.getScoutingReport(game.id);
      const data = await gameEvalAPI.getOpponentProfile(scoutOpponent);
      setScoutData(data);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? e?.message ?? tr('teamGrade.couldNotRegenerate'));
    }
    setRegeneratingScout(false);
  };

  // ── Every team on file ───────────────────────────────────────────────────────

  /**
   * Everyone there is to scout: both sides of every game, plus every team.
   *
   * This read only `opponent_name`, so a team was scoutable only if it had been
   * somebody's opponent. Angola could have three games on file and not appear
   * here, because Angola was always the side stored as the game's own team —
   * and "the side stored as the game's own team" is not a thing a coach thinks
   * about. A game has two teams and either can be the one you want to read.
   */
  const scoutableTeams = React.useMemo(() => {
    const names = new Map<string, string>();   // normalised → as first written
    const add = (n?: string | null) => {
      const name = String(n ?? '').trim();
      if (name && !names.has(norm(name))) names.set(norm(name), name);
    };
    for (const g of sessions as any[]) {
      add(g.opponent_name);
      add(g.team_name);
      add((teams as any[]).find(tm => tm.id === g.team_id)?.name);
    }
    for (const tm of teams as any[]) add(tm.name);
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [sessions, teams]);

  /** The teams the Scout picker shows, narrowed by what was typed. */
  const scoutTeamsShown = React.useMemo(() => {
    const q = norm(scoutSearch);
    return q ? scoutableTeams.filter(n => norm(n).includes(q)) : scoutableTeams;
  }, [scoutableTeams, scoutSearch]);

  /**
   * Which nav chip is lit.
   *
   * A game's detail, a live game, and a scouted team are all CHILDREN of a nav
   * chip rather than views beside them — you got to them from Games or Scout
   * and that is still where you are. Reading activeView directly lit nothing at
   * all on those screens, so the row of chips said the coach was nowhere.
   */
  const NAV_PARENT: Record<string, string> = { detail: 'games', live: 'games' };
  const navView = NAV_PARENT[activeView] ?? activeView;

  /**
   * Leave a step by pressing the link on the page, rather than by going back.
   *
   * The step is holding a history entry so that BACK closes it. Closing it any
   * other way spends that entry with a history.back(), which is right when the
   * entry sits above the page — and wrong after a refresh, where the page was
   * loaded AT the step's own address. There the entry underneath is that same
   * address, so the back landed on it, the screen read the team out of it, and
   * pressing All teams left the coach exactly where they were.
   *
   * Forgetting the entry instead leaves the address the one this screen just
   * wrote, which is the list.
   */
  const leaveStep = (close: () => void) => {
    abandonSheetHistory();
    close();
  };

  // Back walks the steps taken inside this screen before it leaves it. Order
  // matters and is inner-first: a player opened inside a scouted team closes
  // before the team does. See useBackStep.
  useBackStep(activeView === 'detail' || activeView === 'live', () => setActiveView('games'));
  useBackStep(!!scoutOpponent, () => { setScoutOpponent(null); setScoutData(null); });
  useBackStep(!!scoutPlayer, () => setScoutPlayer(null));
  useBackStep(!!gameReportGame, () => setGameReportGame(null));

  /**
   * The games the Game Report picker shows, narrowed by what was typed.
   *
   * Either side of the scoreboard: a team is a team whichever bench it was on,
   * so "Angola" finds Angola vs Mali and Duke vs Angola alike — the same rule
   * Scout reads by.
   */
  const gameReportGames = React.useMemo(() => {
    const q = norm(gameReportSearch);
    if (!q) return sessions as any[];
    const nameOf = (g: any) => g.team_name
      ?? (teams as any[]).find(tm => tm.id === g.team_id)?.name
      ?? coach?.program_name ?? '';
    return (sessions as any[]).filter((g: any) =>
      norm(nameOf(g)).includes(q) || norm(g.opponent_name ?? '').includes(q));
  }, [sessions, teams, coach, gameReportSearch]);

  /** Games this team played, on either side of the scoreboard. */
  const gamesInvolving = (name: string) => (sessions as any[]).filter((g: any) =>
    norm(g.opponent_name) === norm(name)
    || norm(g.team_name ?? '') === norm(name)
    || norm((teams as any[]).find(tm => tm.id === g.team_id)?.name ?? '') === norm(name));

  /**
   * The imported players, grouped by the team heading their file used.
   *
   * The side is a property of the GROUP, not of each player: a file's roster
   * belongs to one team, and asking per player would be a dozen questions where
   * one will do.
   */
  const previewGroups = React.useMemo(() => {
    const out: { key: string; name: string; side: boolean; rows: { p: any; i: number }[] }[] = [];
    const byName = new Map<string, number>();
    (statPreview ?? []).forEach((p: any, i: number) => {
      const name = (p.team_name ?? '').trim();
      const key = name.toLowerCase();
      let at = byName.get(key);
      if (at === undefined) {
        at = out.length;
        byName.set(key, at);
        out.push({ key: key || `g${at}`, name, side: !!p.is_opponent, rows: [] });
      }
      out[at].rows.push({ p, i });
      // The buttons show one state for the group, so it follows the rows.
      out[at].side = !!p.is_opponent;
    });
    return out;
  }, [statPreview]);

  /**
   * Back to the list of games.
   *
   * The same link Scout puts above a team, deliberately: both are a page that
   * opened from a chip in the row above, and the coach has been shown one way
   * of getting back out. Two different-looking ways would be two things to
   * learn for one idea.
   */
  const BackToGames = () => (
    <TouchableOpacity
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}
      onPress={() => leaveStep(() => setActiveView('games'))}
    >
      <Ionicons name="arrow-back" size={18} color={t.muted} />
      <Text style={{ color: t.muted, fontSize: 14 }}>{tr('teamGrade.allGames')}</Text>
    </TouchableOpacity>
  );

  /**
   * Whether a team named in an import file is one of the coach's.
   *
   * The coach's answer wins. Failing that, a team the roster already holds
   * keeps what it is already set to — an import is not the place to demote a
   * team that has been the coach's own all season — and a team about to be
   * created starts as not theirs.
   */
  const mineFor = (name: string) => {
    const answered = teamMine[name];
    if (answered !== undefined) return answered;
    const existing = (teams as any[]).find(tm => norm(tm.name) === norm(name));
    return existing ? existing.is_mine !== false : false;
  };

  /**
   * Which teams Team Grade is showing. Ticking none means all of them, which is
   * what this page did unconditionally before it had a picker.
   */
  const TeamFilterBar = ({ inline = false }: { inline?: boolean } = {}) => {
    const outside = useCloseOnOutside(showGradeTeams, () => setShowGradeTeams(false));
    const picked = (teams as any[]).filter(tm => gradeTeamIds.includes(tm.id));
    const label = picked.length === 0 ? tr('teamGrade.allTeams')
      : picked.length === 1 ? picked[0].name
      : tr('teamGrade.nTeams', { count: picked.length });
    return (
      // Inline it sits at the end of the view-chip row, so the filter and the
      // thing it filters read as one control rather than two stacked bars. Its
      // menu is absolute there: pushing the page down every time the picker
      // opened would move the content the coach is looking at.
      <View
        ref={outside}
        style={inline
          // 260 fixed was more than a tablet has to spare beside seven view
          // chips: the row ran out of room and cut the last chip off exactly
          // where this box started, which reads as the two colliding.
          //
          // So it asks for less and grows back into whatever the chips do not
          // need — 260 on a desktop, narrower on an iPad. If even the smaller
          // width leaves the chips short, the row wraps and this takes the
          // line below rather than squeezing them.
          ? { flexBasis: 200, flexGrow: 1, minWidth: 200, maxWidth: 260,
              marginLeft: 'auto', position: 'relative', zIndex: 20 }
          : { paddingHorizontal: 16, marginBottom: 12 }}
      >
        <TouchableOpacity
          style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }]}
          onPress={() => setShowGradeTeams(v => !v)}
          activeOpacity={0.7}
        >
          <Text style={{ color: t.ink, fontSize: 14 }} numberOfLines={1}>{label}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>{showGradeTeams ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {showGradeTeams && (
          <View style={[{ borderWidth: 1, borderColor: t.line, borderRadius: 10, marginTop: 6, overflow: 'hidden', backgroundColor: t.sheet },
                        inline && { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30 }]}>
            <TouchableOpacity
              style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.line,
                       backgroundColor: gradeTeamIds.length === 0 ? t.accentSoft : 'transparent' }}
              onPress={() => setGradeTeamIds([])}
            >
              <Text style={{ color: gradeTeamIds.length === 0 ? t.accent : t.inkSoft, fontSize: 14 }}>
                {tr('teamGrade.allTeams')}
              </Text>
            </TouchableOpacity>
            {(teams as any[]).filter(tm => !tm.parent_team_id).map(tm => {
              const on = gradeTeamIds.includes(tm.id);
              return (
                <TouchableOpacity
                  key={tm.id}
                  style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.line,
                           flexDirection: 'row', alignItems: 'center', gap: 8,
                           backgroundColor: on ? t.accentSoft : 'transparent' }}
                  onPress={() => setGradeTeamIds(prev =>
                    prev.includes(tm.id) ? prev.filter(x => x !== tm.id) : [...prev, tm.id])}
                >
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={16} color={on ? t.accent : t.muted2} />
                  <Text style={{ color: on ? t.accent : t.inkSoft, fontSize: 14, flex: 1 }} numberOfLines={1}>{tm.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <ScreenBackground>
    {/* padded={false} and a 20 inset of our own, the same as Roster and
        Recent. With the container's gutter on top of this screen's 16, the
        title sat 28px further right than theirs — the "more space on the
        side" that made these two look like a different width of page. */}
    <PageContainer padded={false} maxWidth={isWide ? 1600 : undefined}>
    <View style={s.root}>
      {/* Top nav */}
      <View style={s.topNav}>
        {/* Title and view chips are one column, with New Game beside them and
            aligned to the bottom of it — so on a wide window the button sits
            level with the chip row rather than up against the title. On a
            phone desktopOnly returns nothing, these are plain blocks, and the
            button isn't rendered at all. */}
        <View style={desktopOnly({ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', width: '100%' })}>
          <View style={desktopOnly({ flex: 1, minWidth: 0 })}>
            <Text style={s.screenTitle}>{tr('common.tabs.teamGrade')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ ...bleedRow(20) }} contentContainerStyle={bleedContent(20, 8)}>
              {(['dashboard', 'games', 'scout', 'gamereport'] as const).map(v => (
                <TouchableOpacity
                  key={v}
                  style={[s.navBtn, navView === v && s.navBtnActive]}
                  onPress={() => { if (v === 'gamereport') setGameReportGame(null); setActiveView(v); }}
                >
                  <Text style={[s.navBtnText, navView === v && s.navBtnTextActive]}>
                    {v === 'dashboard' ? tr('teamGrade.views.dashboard') : v === 'games' ? tr('teamGrade.views.games') : v === 'scout' ? tr('teamGrade.views.scout') : tr('reportTypes.game_report')}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          {isWide && activeView === 'games' && (
            <TouchableOpacity
              style={[
                s.newGameBtn,
                // alignSelf beats the row's alignItems, and the shared style
                // sets flex-start for the other two places this button is
                // used — which pinned it to the top of the header, level with
                // the title, however the row was aligned. Stated here so it
                // sits on the chip row's line.
                { marginBottom: 0, marginLeft: 16, alignSelf: 'flex-end' },
              ]}
              onPress={() => setShowNewGame(true)}
            >
              <Ionicons name="add-circle-outline" size={18} color={t.ctaText} />
              <Text style={s.newGameBtnText}>{tr('teamGrade.newGame')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Dashboard */}
      {activeView === 'dashboard' && (
        <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 100 }}>
          {/* Phone keeps the picker on its own line above; there is no room
              beside the chips, and a 260px control in a 342px row is not a row. */}
          {!isWide && <TeamFilterBar />}
          {/* Phase filter */}
          <View style={{ marginBottom: 16, zIndex: 20 }}>
            <View style={desktopOnly({ flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingRight: 16 })}>
              <View style={desktopOnly({ flex: 1, minWidth: 0 })}>
            <Text style={[s.cardLabel, { marginBottom: 8 }]}>{tr('teamGrade.gradeView')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ ...bleedRow(20) }} contentContainerStyle={bleedContent(20, 0)}>
              {/* No gap here: s.chip carries marginRight: 8, and adding a gap
                  put these chips 16 apart while every other row sat at 8. */}
              <View style={{ flexDirection: 'row' }}>
                {orderedPhases.map(phase => {
                  const selected = dashPhases.includes(phase);
                  return (
                    <TouchableOpacity
                      key={phase}
                      style={[s.chip, selected && s.chipActive]}
                      onPress={() => {
                        const next = selected
                          ? dashPhases.filter(p => p !== phase)
                          : [...dashPhases, phase];
                        setDashPhases(next);
                        loadDashboard(next);
                      }}
                    >
                      <Text style={[s.chipText, selected && s.chipTextActive]}>
                        {phaseLabel(phase)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {dashPhases.length > 0 && (
                  <TouchableOpacity
                    style={[s.chip, { borderColor: t.negative }]}
                    onPress={() => { setDashPhases([]); loadDashboard([]); }}
                  >
                    <Text style={[s.chipText, { color: t.negative }]}>{tr('teamGrade.clear')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
            {dashPhases.length > 0 && (
              <Text style={{ color: t.muted, fontSize: 11, marginTop: 6 }}>
                {tr('teamGrade.showing', { phases: dashPhases.map(phaseLabel).join(' + ') })}
              </Text>
            )}
              </View>
              {isWide && <TeamFilterBar inline />}
            </View>
          </View>
          {loadingDash ? (
            <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />
          ) : dashboard ? (
            <>
              {/* Record card */}
              <View style={s.card}>
                <Text style={s.cardLabel}>{tr('teamGrade.seasonRecord')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 8 }}>
                  <Text style={s.bigStat}>{tr('teamGrade.record', { wins: dashboard.record.wins, losses: dashboard.record.losses })}</Text>
                  <Text style={{ color: t.muted, fontSize: 14 }}>
                    {(dashboard.record.win_pct * 100).toFixed(1)}%
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                  <Text style={s.cardLabel}>{tr('teamGrade.seasonAvgGrade')}</Text>
                  <Text style={[s.bigStat, { fontSize: 28, color: t.accent }]}>
                    {dashboard.season_avg_team_grade.toFixed(2)}
                  </Text>
                </View>
              </View>

              {/* Team grade trend */}
              {dashboard.team_grade_trend.length > 0 && (() => {
                const data = dashboard.team_grade_trend;
                const maxGrade = Math.max(...data.map((x: any) => x.team_grade), 1);
                const barW = 30, gap = 24, chartH = 130, topPad = 18;
                const chartW = gap + data.length * (barW + gap);
                return (
                  <View style={s.card}>
                    <Text style={s.cardLabel}>{tr('teamGrade.gradeTrend')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14, ...bleedRow(20) }} contentContainerStyle={bleedContent(20, 0)}>
                      <Svg width={chartW} height={chartH + 48}>
                        <Line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke={t.divider} strokeWidth={1} />
                        {data.map((pt: any, i: number) => {
                          const x = gap + i * (barW + gap);
                          const h = Math.max((pt.team_grade / maxGrade) * (chartH - topPad), 6);
                          const y = chartH - h;
                          const known = pt.our_score != null && pt.opponent_score != null;
                          const won = known && pt.our_score > pt.opponent_score;
                          // Loss bars: fixed soft clay red (identical in light + dark),
                          // clearly visible but a notch less intense than the win green.
                          // A game with no score is neither — it used to be drawn
                          // as a loss, because "we don't know" and "we lost" look
                          // the same to `our_score > opponent_score`.
                          const barColor = !known ? t.muted2 : won ? t.pistachio : '#D9987F';
                          const onTap = () => { const game = sessions.find(x => x.id === pt.game_id); if (game) openDetail(game); };
                          return (
                            <React.Fragment key={pt.game_id}>
                              <SvgText x={x + barW / 2} y={y - 6} fill={t.inkSoft} fontSize={10} fontWeight="800" textAnchor="middle">{pt.team_grade.toFixed(1)}</SvgText>
                              {/* onPress (release), not onPressIn — onPressIn fired on touch-down
                                  and hijacked every attempt to scroll the chart. */}
                              <Rect x={x} y={y} width={barW} height={h} rx={6} fill={barColor} onPress={onTap} />
                              <SvgText x={x + barW / 2} y={chartH + 16} fill={t.muted} fontSize={9} textAnchor="middle">{(pt.opponent ?? '').slice(0, 7)}</SvgText>
                              {/* No letter when the score is unknown. The bar
                                  went neutral for those games but this still
                                  said L, so a game nobody had scored was
                                  labelled a loss in the one place a coach reads
                                  fastest. */}
                              {known && (
                                <SvgText x={x + barW / 2} y={chartH + 32} fill={won ? t.positive : t.negative} fontSize={10} fontWeight="800" textAnchor="middle">{won ? tr('teamGrade.winShort') : tr('teamGrade.lossShort')}</SvgText>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </Svg>
                    </ScrollView>
                  </View>
                );
              })()}

              {/* Player leaderboard */}
              {dashboard.player_leaderboard.length > 0 && (
                <View style={s.card}>
                  <Text style={s.cardLabel}>{tr('teamGrade.playerLeaderboard')}</Text>
                  {dashboard.player_leaderboard.slice(0, 15).map((p: any, i: number) => (
                    <TouchableOpacity key={`${p.team_id ?? 0}-${p.player_name}`} style={s.leaderRow} onPress={() => openGradeDetail(p.player_name)}>
                      <Text style={s.leaderRank}>{i + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={s.leaderName}>{p.player_name}</Text>
                        {/* With several teams on one board, a row that doesn't
                            say whose player it is cannot be read. */}
                        <Text style={{ color: t.muted, fontSize: 11 }}>
                          {(p.team_name ? `${p.team_name} · ` : '')}
                          {tr('teamGrade.leaderboardMeta', { games: p.games_played, off: p.avg_offensive.toFixed(1), def: p.avg_defensive.toFixed(1) })}
                        </Text>
                      </View>
                      <View style={s.gradeBadge}>
                        <Text style={s.gradeBadgeText}>{p.avg_game_grade.toFixed(2)}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={t.muted2} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {dashboard.team_grade_trend.length === 0 && (
                <View style={[s.card, { alignItems: 'center' }]}>
                  <Ionicons name="stats-chart-outline" size={36} color={t.line} />
                  <Text style={{ color: t.muted, fontSize: 13, marginTop: 10 }}>
                    {tr('teamGrade.noCompletedGames')}
                  </Text>
                </View>
              )}
            </>
          ) : null}
        </ScrollView>
      )}

      {/* Games list */}
      {activeView === 'games' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={gamesRefreshing} onRefresh={async () => { setGamesRefreshing(true); await loadData(); setGamesRefreshing(false); }} tintColor={t.accent} />}
        >
          {/* Phase filter. Same shape as the dashboard's: a label, then the row.
              Without the label the chips sat tight under the divider while the
              dashboard's started lower, so switching tabs shifted everything. */}
          <View style={{ marginBottom: 16, zIndex: 20 }}>
          <View style={desktopOnly({ flexDirection: 'row', alignItems: 'flex-end',
                                     flexWrap: 'wrap', gap: 12, paddingRight: 16 })}>
          {/* The chips ask for the width they actually need, measured rather
              than assumed — seven of them are much wider in German than in
              English, and a number picked here would be wrong in most of the
              25 languages. */}
          <View style={desktopOnly({ flexGrow: 1, flexShrink: 0, maxWidth: '100%',
                                     flexBasis: chipRowWidth || 'auto' })}>
          <Text style={[s.cardLabel, { marginBottom: 8 }]}>{tr('teamGrade.gameView')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // The bleed lets the chips run to the glass on a phone, where the
            // row has the line to itself. Next to the team picker it only
            // pushes the row under it, so it stops at its own edge there.
            style={isWide ? { marginLeft: -20 } : { ...bleedRow(20) }}
            contentContainerStyle={bleedContent(20, 0)}
            onContentSizeChange={(w) => setChipRowWidth(Math.ceil(w))}
          >
            {['all', ...orderedPhases].map(p => (
              <TouchableOpacity
                key={p}
                style={[s.chip, phaseFilter === p && s.chipActive]}
                onPress={() => setPhaseFilter(p)}
              >
                <Text style={[s.chipText, phaseFilter === p && s.chipTextActive]}>
                  {phaseLabel(p)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          </View>
          {isWide && <TeamFilterBar inline />}
          </View>
          </View>

          {/* New game button */}
          <TouchableOpacity style={[s.newGameBtn, desktopOnly({ display: 'none' })]} onPress={() => setShowNewGame(true)}>
            <Ionicons name="add-circle-outline" size={18} color={t.ctaText} />
            <Text style={s.newGameBtnText}>{tr('teamGrade.newGame')}</Text>
          </TouchableOpacity>

          {!isWide && <TeamFilterBar />}

          {/* What is on screen is the last answer, and this says so while a new
              one is on its way. Silence would be a page claiming to be current
              when it is a few seconds old. */}
          {refreshing && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
                           paddingHorizontal: 16, paddingBottom: 6 }}>
              <ActivityIndicator color={t.muted2} size="small" />
              <Text style={{ color: t.muted2, fontSize: 11 }}>{tr('common.checking')}</Text>
            </View>
          )}

          {/* Cached games count as having something to show — otherwise the
              page would hydrate from disk and still sit behind a spinner. */}
          {firstLoad && sessions.length === 0 ? (
            <ActivityIndicator color={t.accent} style={{ marginTop: 24 }} />
          ) : filteredSessions.length === 0 ? (
            <View style={[s.card, { alignItems: 'center' }]}>
              <Ionicons name="basketball-outline" size={36} color={t.line} />
              <Text style={{ color: t.muted, fontSize: 13, marginTop: 10 }}>{tr('teamGrade.noGames')}</Text>
            </View>
          ) : (
            <View style={desktopOnly({ flexDirection: 'row', flexWrap: 'wrap', gap: gamesGrid.gap, paddingHorizontal: 16 })}
                  ref={gamesGrid.ref} onLayout={gamesGrid.onLayout}>
            {filteredSessions.map((game: any) => {
              const hasScore = game.our_score != null;
              return (
                <TouchableOpacity
                  key={game.id}
                  style={[s.gameCard, gamesGrid.cardWidth ? { width: gamesGrid.cardWidth } : null]}
                  onPress={() => (game.status === 'in_progress' && isOwnedGame(game)) ? openLiveEntry(game) : openDetail(game)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.gameCardOpponent} numberOfLines={1}>{matchupLabel(game)}</Text>
                    {/* The score, plainly. It used to sit inside a green or red
                        W/L pill, which restated what the two numbers already
                        say — and with the matchup written as "Angola vs Egypt",
                        a bare W left it open whose W it was. */}
                    <Text style={{ color: t.muted, fontSize: 11, marginTop: 2 }}>
                      {new Date(game.date).toLocaleDateString()} · {phaseLabel(game.season_phase)}
                      {game.location ? ` · ${game.location}` : ''}
                      {hasScore ? ` · ${game.our_score}-${game.opponent_score}` : ''}
                    </Text>
                    {/* Whose game this is. It counts in the season record like
                        any other, so where it came from has to be said. */}
                    {!!(game.shared_by || game.frozen_from) && (
                      <Text style={{ color: t.accent, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                        {game.frozen_from
                          ? tr('teamGrade.frozenFromCoach', { name: game.frozen_from })
                          : tr('teamGrade.sharedByCoach', { name: game.shared_by })}
                      </Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <View style={[s.statusBadge, game.status === 'in_progress' && { backgroundColor: t.accentSoft }]}>
                      <Text style={[s.statusText, game.status === 'in_progress' && { color: t.accent }]}>
                        {game.status === 'in_progress' ? tr('teamGrade.statusInProgress') : tr('teamGrade.statusDone')}
                      </Text>
                    </View>
                  </View>
                  {isOwnedGame(game) && !game.frozen_from ? (
                    <TouchableOpacity
                      style={{ padding: 4 }}
                      onPress={() => {
                        Alert.alert(tr('teamGrade.deleteGameTitle'), tr('teamGrade.deleteGameMessage', { opponent: game.opponent_name }), [
                          { text: tr('common.cancel'), style: 'cancel' },
                          {
                            text: tr('common.delete'), style: 'destructive', onPress: async () => {
                              try {
                                await gameEvalAPI.deleteSession(game.id);
                                setSessions(prev => prev.filter(x => x.id !== game.id));
                              } catch { Alert.alert(tr('common.error'), tr('teamGrade.couldNotDelete')); }
                            },
                          },
                        ]);
                      }}
                    >
                      <Ionicons name="trash-outline" size={15} color={t.muted2} />
                    </TouchableOpacity>
                  ) : (game.shared_by || game.frozen_from) ? (
                    /* A shared game isn't mine to delete — this takes it off
                       my list and out of my season record, and leaves the
                       coach who shared it untouched. */
                    <TouchableOpacity
                      style={{ padding: 4 }}
                      onPress={() => {
                        Alert.alert(
                          tr('teamGrade.removeSharedGameTitle'),
                          tr('teamGrade.removeSharedGameMessage', { name: game.shared_by || game.frozen_from }),
                          [
                            { text: tr('common.cancel'), style: 'cancel' },
                            {
                              text: tr('teamGrade.removeFromMyGames'), style: 'destructive',
                              onPress: async () => {
                                try {
                                  await gameEvalAPI.deleteSession(game.id);
                                  setSessions(prev => prev.filter(x => x.id !== game.id));
                                } catch { Alert.alert(tr('common.error'), tr('teamGrade.couldNotDelete')); }
                              },
                            },
                          ]);
                      }}
                    >
                      <Ionicons name="close-circle-outline" size={15} color={t.muted2} />
                    </TouchableOpacity>
                  ) : (
                    <View style={{ padding: 4 }}>
                      <Ionicons name="people-outline" size={15} color={t.muted2} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
            </View>
          )}
        </ScrollView>
      )}

      {/* Draggable floating whiteboard button on Games tab — opens the persistent
          playbook (plays saved here stay until deleted, independent of games). */}
      {activeView === 'games' && (
        <DraggableWhiteboardButton onPress={() => setWhiteboardPlaybook(true)} />
      )}

      {/* Draggable floating whiteboard button on Game Detail tab */}
      {activeView === 'detail' && detailGame && (
        <DraggableWhiteboardButton onPress={() => setWhiteboardGameId(detailGame.id)} />
      )}

      {/* Draggable floating whiteboard button while taking stats in a live/in-progress game */}
      {activeView === 'live' && activeGame && (
        <DraggableWhiteboardButton onPress={() => setWhiteboardGameId(activeGame.id)} />
      )}


      {/* Live Entry */}
      {activeView === 'live' && activeGame && (
        <View style={{ flex: 1 }}>
          {/* A game in progress is still a page under Games, and leaving it
              does not end it — the clock and everything logged are on the
              game, not on this screen. */}
          {/* 20 and 16 to match the scroller every other view sits in: this
              one is a plain View, so without them the link sat hard against
              the divider above it while Scout's had room to breathe. */}
          <View style={{ paddingHorizontal: 20, paddingTop: 16 }}><BackToGames /></View>
          {/* Score bar */}
          <View style={s.scoreBar}>
            <View style={{ alignItems: 'center' }}>
              {/* HOME / AWAY, from the Location already set on the game — an
                  "Away" game means our score belongs under AWAY. On a neutral
                  court neither label is true, so the team names stand in. */}
              <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700] }} numberOfLines={1}>{sideLabels.ours}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity onPress={() => updateScore('our', -1)}>
                  <Ionicons name="remove-circle-outline" size={20} color={t.muted} />
                </TouchableOpacity>
                <Text style={s.scoreNum}>{ourScore}</Text>
                <TouchableOpacity onPress={() => updateScore('our', 1)}>
                  <Ionicons name="add-circle-outline" size={20} color={t.accent} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: t.ink, fontSize: 13, fontFamily: fonts[700] }} numberOfLines={1}>
                {matchupLabel(activeGame)}
              </Text>
              {/* A game tracked after the fact is over. "Q1" under the
                  matchup said a game that had already been played was about to
                  tip off. */}
              <Text style={{ color: t.muted, fontSize: 11 }}>
                {activeGame.tracking_mode === 'post' || activeGame.status === 'completed'
                  ? tr('teamGrade.finalLabel')
                  : periodLabel(gameFmt, periodIndex)}
              </Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700] }} numberOfLines={1}>{sideLabels.theirs}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity onPress={() => updateScore('opp', -1)}>
                  <Ionicons name="remove-circle-outline" size={20} color={t.muted} />
                </TouchableOpacity>
                <Text style={s.scoreNum}>{oppScore}</Text>
                <TouchableOpacity onPress={() => updateScore('opp', 1)}>
                  <Ionicons name="add-circle-outline" size={20} color={t.accent} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Stat recorded toast */}
          {statToast && (
            <View style={{ backgroundColor: t.positive, paddingVertical: 6, paddingHorizontal: 16 }}>
              <Text style={{ color: t.ink, fontSize: 12, fontFamily: fonts[700], textAlign: 'center' }}>{statToast}</Text>
            </View>
          )}

          {/* Game clock + period controls. A game tracked after the fact has no
              clock to run and no quarter to be in — the events already happened
              and carry their own. */}
          {activeGame.tracking_mode !== 'post' && (
          <View style={s.clockBar}>
            <TouchableOpacity style={s.clockPeriodBtn} onPress={advancePeriod}>
              <Text style={s.clockPeriodLabel}>{periodLabel(gameFmt, periodIndex)}</Text>
              <Ionicons name="play-skip-forward" size={13} color={t.muted} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setEditMin(String(Math.floor(clockRemaining / 60))); setEditSec(String(clockRemaining % 60)); setShowClockEdit(true); }}>
              <Text style={s.clockDisplay}>{formatClock(clockRemaining)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.clockRunBtn, { backgroundColor: clockRunning ? t.negativeSoft : t.positiveSoft }]}
              onPress={() => setClockRunning(r => !r)}
            >
              <Ionicons name={clockRunning ? 'pause' : 'play'} size={16} color={clockRunning ? t.negative : t.positive} />
              <Text style={{ color: clockRunning ? t.negative : t.positive, fontFamily: fonts[700], fontSize: 12 }}>
                {clockRunning ? tr('teamGrade.stop') : tr('teamGrade.start')}
              </Text>
            </TouchableOpacity>
          </View>
          )}

          {/* Period bucket — auto-follows the clock; tap to override */}
          {activeGame.tracking_mode !== 'post' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.quarterRow} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 6, gap: 8, alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map(q => (
              <TouchableOpacity
                key={q}
                style={[s.quarterBtn, activeQuarter === q && s.quarterBtnActive]}
                onPress={() => goToBucket(q)}
              >
                <Text style={[s.quarterBtnText, activeQuarter === q && s.quarterBtnTextActive]}>
                  {qLabel(q)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          )}

          {/* Clock edit modal */}
          <Sheet visible={showClockEdit} transparent animationType="fade" onRequestClose={() => setShowClockEdit(false)}>
            <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'center', padding: 32 }}>
              <View style={{ backgroundColor: t.sheet, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(560) }}>
                <Text style={{ color: t.ink, fontSize: 16, fontFamily: fonts[800], marginBottom: 14 }}>{tr('teamGrade.setClock')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <TextInput
                    style={{ backgroundColor: t.chip, color: t.ink, borderRadius: 10, padding: 12, fontSize: 22, fontFamily: fonts[800], textAlign: 'center', width: 74, borderWidth: 1, borderColor: t.line }}
                    keyboardType="number-pad" value={editMin} onChangeText={setEditMin} maxLength={2} placeholder="0" placeholderTextColor={t.muted2}
                  />
                  <Text style={{ color: t.ink, fontSize: 24, fontFamily: fonts[800] }}>:</Text>
                  <TextInput
                    style={{ backgroundColor: t.chip, color: t.ink, borderRadius: 10, padding: 12, fontSize: 22, fontFamily: fonts[800], textAlign: 'center', width: 74, borderWidth: 1, borderColor: t.line }}
                    keyboardType="number-pad" value={editSec} onChangeText={setEditSec} maxLength={2} placeholder="00" placeholderTextColor={t.muted2}
                  />
                </View>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                  <TouchableOpacity style={{ flex: 1, padding: 13, borderRadius: 10, borderWidth: 1, borderColor: t.line, alignItems: 'center' }} onPress={() => setShowClockEdit(false)}>
                    <Text style={{ color: t.muted, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ flex: 1, padding: 13, borderRadius: 10, backgroundColor: t.ctaBg, alignItems: 'center' }} onPress={applyClockEdit}>
                    <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>{tr('teamGrade.set')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Sheet>

          {/* Team toggle — for tapping stats in live. A game tracked after the
              fact has nothing to tap, and a selected team sitting above the
              Import button read as though it scoped the import, which it has
              not done since importing stopped being per-side. */}
          {activeGame.tracking_mode !== 'post' && (
          <View style={s.teamToggle}>
            <TouchableOpacity
              style={[s.teamToggleBtn, entryMode === 'our' && s.teamToggleBtnActive]}
              onPress={() => { setEntryMode('our'); setSelectedPlayer(null); }}
            >
              {/* The team's name, not "Our Team". The coach knows which side is
                  theirs; what they need on a stat pad is which of their teams
                  this is and who it is against. */}
              <Text style={[s.teamToggleText, entryMode === 'our' && s.teamToggleTextActive]} numberOfLines={1}>
                {(teams as any[]).find(tm => tm.id === activeGame.team_id)?.name
                  ?? coach?.program_name ?? tr('teamGrade.ourTeam')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.teamToggleBtn, entryMode === 'opponent' && s.teamToggleBtnActive]}
              onPress={() => { setEntryMode('opponent'); setSelectedPlayer(null); }}
            >
              <Text style={[s.teamToggleText, entryMode === 'opponent' && s.teamToggleTextActive]} numberOfLines={1}>
                {activeGame.opponent_name || tr('teamGrade.opponent')}
              </Text>
            </TouchableOpacity>
          </View>
          )}

          <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
            {/* An import from before attempts were read: makes only, so no
                shooting percentage, and points inflated by every three. Said
                out loud — the numbers look fine and are quietly wrong. */}
            {activeGame.stats_need_reimport && (
              <View style={{ backgroundColor: t.negativeSoft, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <Text style={{ color: t.negative, fontSize: 12, lineHeight: 18 }}>
                  {tr('teamGrade.reimportNeeded')}
                </Text>
              </View>
            )}

            {/* One import for the game, not one per side. The label used to
                follow the Our Team / Opponent toggle, which asked the coach to
                declare a side before anything had been read — and a stat sheet
                usually carries both. Which side each set belongs to is settled
                afterwards, from the team names the files actually used. */}
            {activeGame.tracking_mode === 'post' && (
              <View style={{ marginBottom: 16 }}>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accentSoft, borderWidth: 1, borderColor: t.accent, borderRadius: 12, paddingVertical: 13 }}
                  onPress={importGameStats}
                  disabled={importing}
                >
                  {importing
                    ? <ActivityIndicator color={t.accent} />
                    : <><Ionicons name="cloud-upload-outline" size={18} color={t.accent} /><Text style={{ color: t.accent, fontFamily: fonts[800], fontSize: 14 }}>{tr('teamGrade.importStatsBtn')}</Text></>}
                </TouchableOpacity>
                {importProgress && importProgress.total > 0 && (
                  <View style={{ marginTop: 10 }}>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: t.chip, overflow: 'hidden' }}>
                      <View style={{ height: '100%', backgroundColor: t.accent,
                                     width: `${(importProgress.done / importProgress.total) * 100}%` }} />
                    </View>
                    <Text style={{ color: t.muted2, fontSize: 11, marginTop: 6 }}>
                      {tr('teamGrade.readingFiles', { done: Math.min(importProgress.done + 1, importProgress.total), total: importProgress.total })}
                    </Text>
                  </View>
                )}
                {/* What is worth going to find, and what each one buys — said
                    before the upload rather than discovered by its absence. */}
                <View style={{ marginTop: 10, gap: 4 }}>
                  <Text style={{ color: t.muted2, fontSize: 11, lineHeight: 17 }}>{tr('teamGrade.importAny')}</Text>
                  <Text style={{ color: t.muted2, fontSize: 11, lineHeight: 17 }}>{tr('teamGrade.unlockBox')}</Text>
                  <Text style={{ color: t.muted2, fontSize: 11, lineHeight: 17 }}>{tr('teamGrade.unlockPbp')}</Text>
                  <Text style={{ color: t.muted2, fontSize: 11, lineHeight: 17 }}>{tr('teamGrade.unlockShots')}</Text>
                </View>
              </View>
            )}

            {/* A game tracked after the fact has nothing to tap: no clock is
                running and the events already happened. It shows what was
                imported instead of a stat pad that would file everything under
                whatever quarter the picker happened to be on. */}
            {activeGame.tracking_mode === 'post' ? (
              <GameStatsPanel gameId={activeGame.id} refreshKey={statsVersion} />
            ) : (
            <>
            {/* Player grid */}
            <Text style={s.sectionLabel}>{tr('teamGrade.selectPlayer')}</Text>
            <View style={s.playerGrid}>
              {/* Both sides read the same way: everyone already known, then a
                  row to add whoever is not. Adding used to exist on the
                  opponent's side only, so our own late addition meant leaving
                  the game for the Roster page and coming back. */}
              {entryMode === 'our'
                ? roster.map((p: any) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[s.playerBtn, selectedPlayer === p.name && s.playerBtnActive]}
                    onPress={() => setSelectedPlayer(p.name)}
                  >
                    <Text style={[s.playerBtnText, selectedPlayer === p.name && s.playerBtnTextActive]} numberOfLines={1}>
                      {p.jersey_number ? `#${p.jersey_number} ` : ''}{p.name}{p.position ? ` · ${p.position}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))
                : opponentRoster.map((p: any) => (
                  <TouchableOpacity
                    key={p.id ?? p.player_name}
                    style={[s.playerBtn, selectedPlayer === p.player_name && s.playerBtnActive]}
                    onPress={() => setSelectedPlayer(p.player_name)}
                  >
                    <Text style={[s.playerBtnText, selectedPlayer === p.player_name && s.playerBtnTextActive]} numberOfLines={1}>
                      {p.jersey_number ? `#${p.jersey_number} ` : ''}{p.player_name}{p.position ? ` · ${p.position}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              {entryMode === 'our' && !roster.length && !activeGame.team_id && (
                <Text style={{ color: t.muted, fontSize: 12, padding: 8 }}>{tr('teamGrade.noRoster')}</Text>
              )}
              {(entryMode === 'opponent' || !!activeGame.team_id) && (
                <View style={{ width: '100%', flexDirection: 'row', gap: 6, marginTop: 4 }}>
                  <VoiceTextInput
                    style={[s.smallInput, { flex: 1 }]}
                    placeholder={entryMode === 'our'
                      ? tr('teamGrade.ourPlayerNamePlaceholder')
                      : tr('teamGrade.opponentPlayerNamePlaceholder')}
                    placeholderTextColor={t.muted2}
                    value={newOppPlayer}
                    onChangeText={setNewOppPlayer}
                  />
                  <TextInput
                    style={[s.smallInput, { width: 48, textAlign: 'center' }]}
                    placeholder="#"
                    placeholderTextColor={t.muted2}
                    value={newOppJersey}
                    onChangeText={setNewOppJersey}
                    keyboardType="number-pad"
                  />
                  <TextInput
                    style={[s.smallInput, { width: 56, textAlign: 'center' }]}
                    placeholder={tr('teamGrade.posPlaceholder')}
                    placeholderTextColor={t.muted2}
                    value={newOppPosition}
                    onChangeText={setNewOppPosition}
                    autoCapitalize="characters"
                  />
                  <TouchableOpacity
                    style={{ backgroundColor: t.line, borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center' }}
                    onPress={entryMode === 'our' ? addOurPlayer : addOpponentPlayer}
                  >
                    <Ionicons name="add" size={16} color={t.muted} />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Stat buttons */}
            <Text style={[s.sectionLabel, { marginTop: 20 }]}>{tr('teamGrade.offense')}</Text>
            <View style={s.statGrid}>
              {OFFENSE_STATS.map(stat => {
                const kind = statKind(stat);
                const c = kind === 'positive' ? t.positive : kind === 'negative' ? t.negative : t.accent;
                const soft = kind === 'positive' ? t.positiveSoft : kind === 'negative' ? t.negativeSoft : t.accentSoft;
                return (
                <TouchableOpacity
                  key={stat}
                  style={[s.statBtn, { borderColor: c, backgroundColor: soft }, flashStat === stat && { backgroundColor: c }]}
                  onPress={() => logStat(stat)}
                  disabled={!selectedPlayer}
                >
                  <Text style={[s.statBtnText, { color: flashStat === stat ? t.ctaText : c }]}>{statLabel(stat)}</Text>
                </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[s.sectionLabel, { marginTop: 16 }]}>{tr('teamGrade.defense')}</Text>
            <View style={s.statGrid}>
              {DEFENSE_STATS.map(stat => {
                const kind = statKind(stat);
                const c = kind === 'positive' ? t.positive : kind === 'negative' ? t.negative : t.accent;
                const soft = kind === 'positive' ? t.positiveSoft : kind === 'negative' ? t.negativeSoft : t.accentSoft;
                return (
                <TouchableOpacity
                  key={stat}
                  style={[s.statBtn, { borderColor: c, backgroundColor: soft }, flashStat === stat && { backgroundColor: c }]}
                  onPress={() => logStat(stat)}
                  disabled={!selectedPlayer}
                >
                  <Text style={[s.statBtnText, { color: flashStat === stat ? t.ctaText : c }]}>{statLabel(stat)}</Text>
                </TouchableOpacity>
                );
              })}
            </View>

            </>
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
              {activeGame.tracking_mode !== 'post' && (
                <TouchableOpacity
                  style={[s.actionBtnLive, { flex: 1, borderColor: t.line }]}
                  onPress={() => setShowLineupModal(true)}
                >
                  <Ionicons name="people-outline" size={16} color={t.muted} />
                  <Text style={{ color: t.muted, fontFamily: fonts[600], fontSize: 13 }}>{tr('teamGrade.lineup')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[s.actionBtnLive, { flex: 1, borderColor: t.negative }]}
                onPress={endGame}
              >
                <Ionicons name="stop-circle-outline" size={16} color={t.negative} />
                <Text style={{ color: t.negative, fontFamily: fonts[600], fontSize: 13 }}>{tr('teamGrade.endGame')}</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
        </View>
      )}

      {/* Game Detail */}
      {activeView === 'detail' && detailGame && (
        <ScrollView ref={findScouting.scrollRef} style={s.scroll} contentContainerStyle={{ paddingBottom: 100 }}>
          {/* The way back to the list, said on the page rather than left to a
              swipe. Same link Scout uses above its team, for the same reason:
              a game opened from Games is a page under Games, and nothing else
              on the screen says how to get back up. */}
          <BackToGames />
          {/* Header */}
          <View style={s.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 22, fontFamily: fonts[900] }}>{matchupLabel(detailGame)}</Text>
                <TouchableOpacity
                  style={{ backgroundColor: t.chip, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}
                  onPress={() => { setShareGameId(detailGame?.id); setShareGameModalVisible(true); setStaffSearch(''); setStaffResults([]); }}
                >
                  <Ionicons name="share-outline" size={14} color={t.muted} />
                  <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[600] }}>{tr('teamGrade.shareWithStaff')}</Text>
                </TouchableOpacity>
                <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>
                  {new Date(detailGame.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  {detailGame.location ? ` · ${detailGame.location}` : ''}
                  {' · '}{phaseLabel(detailGame.season_phase)}
                </Text>
                {/* Where this game came from, said on the page you read it on
                    and not only on the card you opened. A frozen game stopped
                    following its sender, and a coach comparing it against
                    theirs has no other way to know that. */}
                {!!(detailGame.frozen_from || detailGame.shared_by) && (
                  <Text style={{ color: t.accent, fontSize: 12, marginTop: 4 }}>
                    {detailGame.frozen_from
                      ? tr('teamGrade.frozenFromCoach', { name: detailGame.frozen_from })
                      : tr('teamGrade.sharedByCoach', { name: detailGame.shared_by })}
                  </Text>
                )}
              </View>
              {/* The result, where a result belongs. It is worked out from the
                  box score, so an imported game already knows it and asking the
                  coach to type it in was asking them to copy a number the app
                  had. When both sides' numbers are not in there is genuinely no
                  way to know it — that reads as a dash, and tapping the dash
                  takes it, so a game with a real result is never stuck without
                  one in the season record. */}
              {detailGame.our_score != null ? (
                // Tapping a score that is already there opens the same sheet
                // with the numbers in it. A box score can be read wrong, and a
                // score the coach could see was wrong but could not touch is
                // worse than no score at all.
                <TouchableOpacity
                  style={{ alignItems: 'flex-end' }}
                  onPress={() => {
                    setFinalOurs(String(detailGame.our_score ?? ''));
                    setFinalTheirs(String(detailGame.opponent_score ?? ''));
                    setScoreError(''); setShowScoreEdit(true);
                  }}
                >
                  <Text style={{ color: t.ink, fontSize: 28, fontFamily: fonts[900] }}>
                    {detailGame.our_score} - {detailGame.opponent_score}
                  </Text>
                  <Text style={{ color: t.accent, fontSize: 11, fontFamily: fonts[700] }}>
                    {tr('teamGrade.editScore')}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={{ alignItems: 'flex-end' }}
                                  onPress={() => { setFinalOurs(''); setFinalTheirs(''); setScoreError(''); setShowScoreEdit(true); }}>
                  <Text style={{ color: t.muted2, fontSize: 28, fontFamily: fonts[900] }}>–</Text>
                  <Text style={{ color: t.accent, fontSize: 11, fontFamily: fonts[700] }}>
                    {tr('teamGrade.setScore')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {/* Both teams' grades when both teams' stats are in. One grade on a
                page about two teams read as though the other side had not
                played — and the opponent's number is the thing a scouting
                report is arguing with. */}
            {summary && (
              summary.opponent_team_grade == null ? (
                <View style={{ marginTop: 16, alignItems: 'center' }}>
                  <Text style={s.cardLabel}>{tr('teamGrade.teamGradeLabel')}</Text>
                  <Text style={{ color: t.accent, fontSize: 40, fontFamily: fonts[900], marginTop: 4 }}>
                    {summary.team_grade.toFixed(2)}
                  </Text>
                </View>
              ) : (
                <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'flex-start' }}>
                  {([
                    [detailGame.team_name
                      ?? (teams as any[]).find(tm => tm.id === detailGame.team_id)?.name
                      ?? coach?.program_name ?? tr('teamGrade.ourTeam'), summary.team_grade, t.accent],
                    [detailGame.opponent_name || tr('teamGrade.opponent'),
                      summary.opponent_team_grade, t.negative],
                  ] as [string, number, string][]).map(([name, grade, color]) => (
                    <View key={name} style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={[s.cardLabel, { marginBottom: 4 }]} numberOfLines={1}>{name}</Text>
                      <Text style={{ color, fontSize: 34, fontFamily: fonts[900] }}>
                        {grade.toFixed(2)}
                      </Text>
                    </View>
                  ))}
                </View>
              )
            )}
          </View>

          {/* Detail tabs.

              Game Insights leads because everything under it compares the two
              teams — shooting, key stats, the lead tracker, advanced stats, the
              shot chart and the box score are all about the game, and filing
              them under one side made them look like that side's numbers.

              The other two carry the teams' names rather than "Our Team" and
              "Opponent": the coach knows which side is theirs, and with several
              teams in the app what they need is which one this is. */}
          <View style={[s.teamToggle, { borderBottomWidth: 0 }]}>
            <TouchableOpacity
              style={[s.teamToggleBtn, detailTab === 'insights' && s.teamToggleBtnActive]}
              onPress={() => openTab('insights')}
            >
              <Text style={[s.teamToggleText, detailTab === 'insights' && s.teamToggleTextActive]} numberOfLines={1}>{tr('teamGrade.gameInsights')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.teamToggleBtn, detailTab === 'our' && s.teamToggleBtnActive]}
              onPress={() => openTab('our')}
            >
              <Text style={[s.teamToggleText, detailTab === 'our' && s.teamToggleTextActive]} numberOfLines={1}>
                {detailGame.team_name
                  ?? (teams as any[]).find(tm => tm.id === detailGame.team_id)?.name
                  ?? coach?.program_name ?? tr('teamGrade.ourTeam')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.teamToggleBtn, detailTab === 'opponent' && s.teamToggleBtnActive]}
              onPress={() => openTab('opponent')}
            >
              <Text style={[s.teamToggleText, detailTab === 'opponent' && s.teamToggleTextActive]} numberOfLines={1}>
                {detailGame.opponent_name || tr('teamGrade.opponent')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.teamToggleBtn, detailTab === 'byquarter' && s.teamToggleBtnActive]}
              onPress={() => openTab('byquarter')}
            >
              <Text style={[s.teamToggleText, detailTab === 'byquarter' && s.teamToggleTextActive]}>{tr('teamGrade.byQuarter')}</Text>
            </TouchableOpacity>
          </View>

          {detailTab !== 'insights' && detailTab === 'byquarter' && (() => {
            const ourStats = gameStats.filter((st: any) => !st.is_opponent);
            if (ourStats.length === 0) return (
              <View style={s.card}>
                <Text style={{ color: t.muted, textAlign: 'center', fontSize: 13 }}>{tr('teamGrade.noStatsLogged')}</Text>
              </View>
            );
            // Build player -> quarter -> { weighted, counts, list }
            const qSet = new Set<number>();
            const players: Record<string, { total: number; jersey?: string | null; quarters: Record<number, { weighted: number; counts: Record<string, number>; list: any[] }> }> = {};
            for (const st of ourStats) {
              qSet.add(st.quarter);
              if (!players[st.player_name]) players[st.player_name] = { total: 0, quarters: {} };
              const P = players[st.player_name];
              // Whichever row carries it — they all came off the same sheet.
              P.jersey = P.jersey ?? st.jersey_number ?? null;
              if (!P.quarters[st.quarter]) P.quarters[st.quarter] = { weighted: 0, counts: {}, list: [] };
              const Q = P.quarters[st.quarter];
              Q.weighted += st.weighted_points;
              Q.counts[st.stat_name] = (Q.counts[st.stat_name] || 0) + (st.count || 1);
              Q.list.push(st);
              P.total += st.weighted_points;
            }
            const qNums = Array.from(qSet).sort((a, b) => a - b);
            // A box score read off a sheet is whole-game totals filed under one
            // period. Calling that column "Q1" tells the coach the game had a
            // first quarter and nothing else, which is not what the sheet said.
            const wholeGame = qNums.length === 1
              && ourStats.every((st: any) => st.source === 'import');
            const periodLabel = (q: number) => (wholeGame ? tr('teamGrade.fullGame') : qLabel(q));
            const playerNames = Object.keys(players).sort((a, b) => players[b].total - players[a].total);
            const teamQ: Record<number, number> = {};
            for (const q of qNums) teamQ[q] = playerNames.reduce((sum, n) => sum + (players[n].quarters[q]?.weighted || 0), 0);
            const teamTotal = playerNames.reduce((sum, n) => sum + players[n].total, 0);
            const cellColor = (v: number) => (v > 0 ? t.positive : v < 0 ? t.negative : t.muted);
            const fmt = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1);

            return (
              <View style={s.card}>
                <Text style={s.cardLabel}>{tr('teamGrade.quarterComparison')}</Text>
                <Text style={{ color: t.muted, fontSize: 11, marginTop: 2, marginBottom: 12 }}>
                  {wholeGame ? tr('teamGrade.noPeriodBreakdown') : tr('teamGrade.quarterComparisonHint')}
                </Text>

                {/* Header */}
                <View style={s.qHeaderRow}>
                  <Text style={s.qPlayerHead}>{tr('teamGrade.playerHead')}</Text>
                  {qNums.map(q => <Text key={q} style={s.qColHead}>{periodLabel(q)}</Text>)}
                  <Text style={[s.qColHead, { color: t.accent }]}>{tr('teamGrade.tot')}</Text>
                </View>

                {/* Team totals */}
                <View style={[s.qRow, { backgroundColor: t.chip, borderRadius: 8 }]}>
                  <Text style={[s.qPlayerName, { color: t.accent, fontFamily: fonts[800] }]}>{tr('teamGrade.teamRow')}</Text>
                  {qNums.map(q => (
                    <Text key={q} style={[s.qCell, { color: cellColor(teamQ[q]), fontFamily: fonts[800] }]}>{fmt(teamQ[q])}</Text>
                  ))}
                  <Text style={[s.qCell, { color: t.accent, fontFamily: fonts[800] }]}>{fmt(teamTotal)}</Text>
                </View>

                {/* Player rows */}
                {playerNames.map(name => {
                  const P = players[name];
                  const isOpen = expandedQuarterPlayer === name;
                  return (
                    <View key={name}>
                      <TouchableOpacity
                        style={[s.qRow, isOpen && { backgroundColor: t.chip, borderRadius: 8 }]}
                        onPress={() => setExpandedQuarterPlayer(isOpen ? null : name)}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 4 }}>
                          <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={12} color={t.muted2} />
                          <Text style={s.qPlayerName} numberOfLines={1}>
                            {P.jersey ? `#${P.jersey} ` : ''}{name}
                          </Text>
                        </View>
                        {qNums.map(q => {
                          const w = P.quarters[q]?.weighted;
                          return (
                            <Text key={q} style={[s.qCell, { color: w == null ? t.line : cellColor(w) }]}>
                              {w == null ? '–' : fmt(w)}
                            </Text>
                          );
                        })}
                        <Text style={[s.qCell, { color: t.accent, fontFamily: fonts[800] }]}>{fmt(P.total)}</Text>
                      </TouchableOpacity>

                      {isOpen && (
                        <View style={s.qExpand}>
                          {qNums.filter(q => P.quarters[q]).map(q => {
                            const Q = P.quarters[q];
                            const c = Q.counts;
                            const pts = (c['2 FG Made'] || 0) * 2 + (c['3 FG Made'] || 0) * 3 + (c['FT Made'] || 0);
                            const reb = (c['Off. Reb'] || 0) + (c['Def. Reb'] || 0);
                            const ast = c['Assists'] || 0;
                            const stl = c['Steal'] || 0;
                            const blk = c['Blocked Shot'] || 0;
                            const to = c['Turnover'] || 0;
                            return (
                              <View key={q} style={{ marginBottom: 10 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                                  <Text style={{ color: t.accent, fontSize: 11, fontFamily: fonts[800], letterSpacing: 0.5 }}>{periodLabel(q)}</Text>
                                  <Text style={{ color: cellColor(Q.weighted), fontSize: 11, fontFamily: fonts[700] }}>{fmt(Q.weighted)} {tr('teamGrade.ptsAbbr')}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 6 }}>
                                  {[['PTS', pts], ['REB', reb], ['AST', ast], ['STL', stl], ['BLK', blk], ['TO', to]].map(([label, val]) => (
                                    <View key={label as string} style={{ alignItems: 'center' }}>
                                      <Text style={{ color: t.muted, fontSize: 9, fontFamily: fonts[700] }}>{label}</Text>
                                      <Text style={{ color: t.ink, fontSize: 13, fontFamily: fonts[800] }}>{val}</Text>
                                    </View>
                                  ))}
                                </View>
                                <View style={{ gap: 2 }}>
                                  {Q.list.map((st: any, i: number) => (
                                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                      <Text style={{ color: t.muted, fontSize: 11 }}>{st.stat_name}{st.count > 1 ? ` ×${st.count}` : ''}</Text>
                                      <Text style={{ color: st.weighted_points >= 0 ? t.positive : t.negative, fontSize: 11, fontFamily: fonts[600] }}>
                                        {st.weighted_points >= 0 ? '+' : ''}{st.weighted_points.toFixed(1)}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })()}
          {detailTab === 'insights' ? null : detailTab !== 'byquarter' && loadingSummary ? (
            <ActivityIndicator color={t.accent} style={{ marginTop: 24 }} />
          ) : detailTab !== 'byquarter' && summary ? (
            <View style={s.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={s.cardLabel}>{tr('teamGrade.playerGrades')}</Text>
                <TouchableOpacity
                  onPress={() => {
                    setShowGradeSearch(prev => {
                      if (prev) setGradeSearch('');
                      return !prev;
                    });
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="search-outline" size={16} color={showGradeSearch ? t.accent : t.muted2} />
                </TouchableOpacity>
              </View>
              {showGradeSearch && (
                <TextInput
                  style={[s.smallInput, { marginTop: 8, marginBottom: 4 }]}
                  placeholder={tr('teamGrade.searchPlayersPlaceholder')}
                  placeholderTextColor={t.muted2}
                  value={gradeSearch}
                  onChangeText={setGradeSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              )}
              {(detailTab === 'opponent' ? summary.opponent_grades : summary.player_grades)
                .filter((g: any) => {
                  const q = gradeSearch.trim().toLowerCase();
                  if (!q) return true;
                  const name = String(g.player_name ?? '').toLowerCase();
                  const pos = String(g.position ?? '').toLowerCase();
                  return name.includes(q) || pos.includes(q);
                })
                .map((g: any) => (
                <View key={g.player_name}>
                  <TouchableOpacity
                    style={[s.playerGradeRow, expandedPlayer === g.player_name && { borderBottomWidth: 0 }]}
                    onPress={() => setExpandedPlayer(expandedPlayer === g.player_name ? null : g.player_name)}
                  >
                    {/* The squad number leads, as it does on the box score and
                        the scouting page — it is how a coach knows who this is
                        on the floor. */}
                    <Text style={s.playerGradeName} numberOfLines={1}>
                      {g.jersey_number ? `#${g.jersey_number}  ` : ''}{g.player_name}
                    </Text>
                    <Text style={{ color: t.muted, fontSize: 11 }}>{tr('teamGrade.offLabel')} {g.offensive_grade.toFixed(1)}</Text>
                    <Text style={{ color: t.muted, fontSize: 11 }}>{tr('teamGrade.defLabel')} {g.defensive_grade.toFixed(1)}</Text>
                    <Text style={{ color: t.muted, fontSize: 11 }}>{minsLabel(g.minutes_played)}{tr('teamGrade.mAbbr')}</Text>
                    <View style={s.gradeBadge}>
                      <Text style={s.gradeBadgeText}>{g.game_grade.toFixed(2)}</Text>
                    </View>
                    <Ionicons
                      name={expandedPlayer === g.player_name ? 'chevron-up' : 'chevron-down'}
                      size={14} color={t.muted2}
                    />
                  </TouchableOpacity>
                  {expandedPlayer === g.player_name && (() => {
                    // Derive traditional stats from raw gameStats for this player
                    // (respect the active tab so opponent rows resolve to opponent stats)
                    const pStats = gameStats.filter((st: any) => st.is_opponent === (detailTab === 'opponent') && st.player_name === g.player_name);
                    const counts: Record<string, number> = {};
                    const breakdown: Record<string, { count: number; weighted_points: number }> = {};
                    for (const st of pStats) {
                      counts[st.stat_name] = (counts[st.stat_name] || 0) + (st.count || 1);
                      if (!breakdown[st.stat_name]) breakdown[st.stat_name] = { count: 0, weighted_points: 0 };
                      breakdown[st.stat_name].count += st.count || 1;
                      breakdown[st.stat_name].weighted_points += st.weighted_points;
                    }
                    const pts = (counts['2 FG Made'] || 0) * 2 + (counts['3 FG Made'] || 0) * 3 + (counts['FT Made'] || 0);
                    const reb = (counts['Off. Reb'] || 0) + (counts['Def. Reb'] || 0);
                    const ast = counts['Assists'] || 0;
                    const stl = counts['Steal'] || 0;
                    const blk = counts['Blocked Shot'] || 0;
                    const to = counts['Turnover'] || 0;
                    const fgm = (counts['2 FG Made'] || 0) + (counts['3 FG Made'] || 0);
                    const fga = fgm + (counts['2 FG Missed'] || 0) + (counts['3 FG Missed'] || 0);
                    return (
                      <View style={s.expandedBox}>
                        {/* Traditional stats row */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: t.chip }}>
                          {([['PTS', pts], ['REB', reb], ['AST', ast], ['STL', stl], ['BLK', blk], ['TO', to], ['FG', fga > 0 ? `${fgm}/${fga}` : '—']] as [string, string | number][]).map(([label, val]) => (
                            <View key={label} style={{ alignItems: 'center', flex: 1 }}>
                              <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700] }}>{label}</Text>
                              <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[900] }}>{val}</Text>
                            </View>
                          ))}
                        </View>

                        {/* OFF / DEF / minutes */}
                        <Text style={{ color: t.muted, fontSize: 11, marginBottom: 10 }}>
                          {tr('teamGrade.offDefMin', { off: g.offensive_grade.toFixed(1), def: g.defensive_grade.toFixed(1), min: minsLabel(g.minutes_played) })}
                        </Text>

                        {/* Grading stats */}
                        <Text style={{ color: t.muted2, fontSize: 10, fontFamily: fonts[700], letterSpacing: 1, marginBottom: 6 }}>{tr('teamGrade.gradingStats')}</Text>
                        <View style={{ gap: 3, marginBottom: 12 }}>
                          {Object.entries(breakdown).map(([statName, data]) => (
                            <View key={statName} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ color: t.muted, fontSize: 12 }}>{statName}{data.count > 1 ? ` ×${data.count}` : ''}</Text>
                              <Text style={{ color: data.weighted_points >= 0 ? t.positive : t.negative, fontSize: 12, fontFamily: fonts[600] }}>
                                {data.weighted_points >= 0 ? '+' : ''}{data.weighted_points.toFixed(1)}
                              </Text>
                            </View>
                          ))}
                        </View>

                        {/* Per quarter */}
                        {Object.keys(g.per_quarter).length > 0 && (
                          <>
                            <Text style={{ color: t.muted2, fontSize: 10, fontFamily: fonts[700], letterSpacing: 1, marginBottom: 6 }}>{tr('teamGrade.perQuarter')}</Text>
                            {Object.entries(g.per_quarter as Record<string, any>).sort(([a], [b]) => Number(a) - Number(b)).map(([q, data]: [string, any]) => (
                              <View key={q} style={{ flexDirection: 'row', gap: 12, marginBottom: 3 }}>
                                <Text style={{ color: t.muted, fontSize: 11, width: 28 }}>{qLabel(Number(q))}</Text>
                                <Text style={{ color: t.muted, fontSize: 11 }}>{tr('teamGrade.offDef', { off: (data.offense ?? 0).toFixed(1), def: (data.defense ?? 0).toFixed(1) })}</Text>
                              </View>
                            ))}
                          </>
                        )}

                        {/* Action buttons */}
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                          <TouchableOpacity
                            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                                     backgroundColor: t.accentSoft, borderRadius: 8, paddingVertical: 8, borderWidth: 1, borderColor: t.accent }}
                            onPress={() => { setDetailModalPlayer(g.player_name); setShowDetailModal(true); }}
                          >
                            <Ionicons name="eye-outline" size={13} color={t.accent} />
                            <Text style={{ color: t.accent, fontSize: 12, fontFamily: fonts[700] }}>{tr('teamGrade.viewDetails')}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                                     backgroundColor: t.chip, borderRadius: 8, paddingVertical: 8, borderWidth: 1, borderColor: t.line }}
                            onPress={() => { setStatsModalPlayer(g.player_name); setShowStatsModal(true); setAddStatName(''); setAddingStatDropdownOpen(false); }}
                          >
                            <Ionicons name="create-outline" size={13} color={t.muted} />
                            <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[700] }}>{tr('teamGrade.editStats')}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })()}
                </View>
              ))}
              {(detailTab === 'opponent' ? summary.opponent_grades : summary.player_grades).length === 0 && (
                <Text style={{ color: t.muted2, fontSize: 13, textAlign: 'center', paddingVertical: 12 }}>{tr('teamGrade.noStatsLogged')}</Text>
              )}
              {(detailTab === 'opponent' ? summary.opponent_grades : summary.player_grades).length > 0 &&
                gradeSearch.trim() !== '' &&
                (detailTab === 'opponent' ? summary.opponent_grades : summary.player_grades)
                  .filter((g: any) => {
                    const q = gradeSearch.trim().toLowerCase();
                    const name = String(g.player_name ?? '').toLowerCase();
                    const pos = String(g.position ?? '').toLowerCase();
                    return name.includes(q) || pos.includes(q);
                  }).length === 0 && (
                  <Text style={{ color: t.muted2, fontSize: 13, textAlign: 'center', paddingVertical: 12 }}>{tr('teamGrade.noPlayersMatch', { query: gradeSearch.trim() })}</Text>
                )}
            </View>
          ) : null}

          {/* The game's numbers, under the grades. Everything here is derived
              from what was actually recorded; the panels that need a file we
              don't have say which one rather than drawing an empty chart. */}
          {/* Kept mounted once opened, and hidden rather than thrown away.
              Switching to By Quarter and back used to unmount this panel, which
              read the whole game again on the way in — a wait for numbers that
              were on screen a second earlier. A tab that has never been opened
              is still not mounted, so opening a game costs one read. */}
          {seenTabs.has('insights') && (
            <View style={detailTab === 'insights' ? undefined : { display: 'none' }}>
              <GameStatsPanel gameId={detailGame.id} refreshKey={statsVersion} />
            </View>
          )}

          {/* This team's box score, under this team's grades. A grade is an
              argument about a player; the line beside their name is the
              evidence for it, and it was a tab away. */}
          {/* No wrapper padding: the card sits at the same width as the player
              grades above it and the Game Insights panels, rather than inset by
              sixteen pixels from everything else on the page. */}
          {(['our', 'opponent'] as const).map(side => (
            seenTabs.has(side) ? (
              <View key={side} style={detailTab === side ? undefined : { display: 'none' }}>
                <TeamBoxScore gameId={detailGame.id} isOpponent={side === 'opponent'}
                              refreshKey={statsVersion} />
              </View>
            ) : null
          ))}

          {/* Action buttons */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 16 }}>
            <TouchableOpacity
              style={[s.detailAction, { flex: 1, minWidth: '45%' }]}
              onPress={() => openScout(detailGame.opponent_name)}
            >
              <Ionicons name="search-outline" size={14} color={t.muted} />
              <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11, fontFamily: fonts[600] }}>{tr('teamGrade.scoutOpponentBtn')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.detailAction, { flex: 1, minWidth: '45%' }]}
              onPress={exportDetailPdf}
              disabled={exportingPdf}
            >
              {exportingPdf
                ? <ActivityIndicator size="small" color={t.muted} />
                : <><Ionicons name="document-outline" size={14} color={t.muted} />
                  <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11, fontFamily: fonts[600] }}>{tr('teamGrade.exportPdf')}</Text></>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.detailAction, { flex: 1, minWidth: '45%' }]}
              onPress={exportDetailCsv}
              disabled={exportingCsv}
            >
              {exportingCsv
                ? <ActivityIndicator size="small" color={t.muted} />
                : <><Ionicons name="grid-outline" size={14} color={t.muted} />
                  <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11, fontFamily: fonts[600] }}>{tr('teamGrade.exportCsv')}</Text></>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.detailAction, { flex: 1, minWidth: '45%', borderColor: t.accent }]}
              onPress={() => openGameReport(detailGame)}
            >
              <Ionicons name="sparkles-outline" size={14} color={t.accent} />
              <Text numberOfLines={1} style={{ color: t.accent, fontSize: 11, fontFamily: fonts[600] }}>{tr('teamGrade.generateGameReport')}</Text>
            </TouchableOpacity>
          </View>

          {/* Live entry shortcut if in_progress — owner only */}
          {detailGame.status === 'in_progress' && isOwnedGame(detailGame) && (
            <TouchableOpacity
              style={[s.newGameBtn, { marginHorizontal: 16, marginBottom: 16 }]}
              onPress={() => openLiveEntry(detailGame)}
            >
              <Ionicons name="radio-button-on-outline" size={16} color={t.ctaText} />
              <Text style={s.newGameBtnText}>{tr('teamGrade.continueLiveEntry')}</Text>
            </TouchableOpacity>
          )}

          {/* AI scouting report */}
          {(showScoutingReport || detailGame.ai_scouting_report) && (
            <View style={s.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Text style={[s.cardLabel, { flex: 1, marginBottom: 0 }]}>{tr('teamGrade.scoutingReport')}</Text>
                <ReportSearchButton ctl={findScouting} />
              </View>
              <View style={{ marginTop: 8 }}>
                <ReportSearchBar ctl={findScouting} />
                {renderReport(detailGame.ai_scouting_report ?? '', { heading: t.ink, body: t.inkSoft }, findScouting.search)}
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* Opponent Scout */}
      {activeView === 'scout' && (
        <KeyboardAwareScrollView ref={scoutScrollRef} style={s.scroll} contentContainerStyle={{ paddingBottom: 100 }}>
          {/* Opponent selector */}
          {!scoutOpponent ? (
            <>
              <ListSearchHeader
                title={tr('teamGrade.selectTeam')}
                titleStyle={s.cardLabel}
                value={scoutSearch}
                onChange={setScoutSearch}
                placeholder={tr('teamGrade.searchTeamsPlaceholder')}
              />
              <View style={{ height: 10 }} />
              {scoutTeamsShown.length === 0 ? (
            <View style={[s.card, { alignItems: 'center' }]}>
                  <Text style={{ color: t.muted, fontSize: 13 }}>{tr('teamGrade.noOpponents')}</Text>
                </View>
              ) : (
                <View style={desktopOnly({ flexDirection: 'row', flexWrap: 'wrap', gap: scoutGrid.gap, paddingHorizontal: 16 })}
                      ref={scoutGrid.ref} onLayout={scoutGrid.onLayout}>
                {scoutTeamsShown.map(opp => (
                  <TouchableOpacity key={opp} style={[s.gameCard, scoutGrid.cardWidth ? { width: scoutGrid.cardWidth } : null]} onPress={() => openScout(opp)}>
                    <Text style={s.gameCardOpponent}>{opp}</Text>
                    <Text style={{ color: t.muted, fontSize: 12 }}>
                      {tr('teamGrade.gamesCount', { count: gamesInvolving(opp).length })}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={t.line} />
                  </TouchableOpacity>
                ))}
                </View>
              )}
            </>
          ) : (
            <>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}
                onPress={() => leaveStep(() => { setScoutOpponent(null); setScoutData(null); })}
              >
                <Ionicons name="arrow-back" size={18} color={t.muted} />
                <Text style={{ color: t.muted, fontSize: 14 }}>{tr('teamGrade.allOpponents')}</Text>
              </TouchableOpacity>

              {/* Sits closer to the back link and further from the first card,
                  so the name reads as this page's title rather than as a label
                  attached to the box under it. */}
              <Text style={{ color: t.ink, fontSize: 22, fontFamily: fonts[900], marginBottom: 14 }}>{scoutOpponent}</Text>

              {loadingScout ? (
                <ActivityIndicator color={t.accent} style={{ marginTop: 24 }} />
              ) : scoutData ? (
                <>
                  {/* Record vs this opponent */}
                  <View style={s.card}>
                    <Text style={s.cardLabel}>{tr('teamGrade.gamesAgainst')}</Text>
                    {/* Who they played, and how it went. Everything reads from
                        THIS team's bench, so the first score and the W/L tag
                        always agree — which is the only reason a W/L tag is
                        safe here and nowhere else: the page names whose it is. */}
                    {scoutData.games_played_against.map((g: any) => {
                      const known = g.our_score != null && g.opponent_score != null;
                      const won = known && g.our_score > g.opponent_score;
                      return (
                        <TouchableOpacity
                          key={g.id} style={s.leaderRow}
                          onPress={() => { const game = sessions.find((x: any) => x.id === g.id); if (game) openDetail(game); }}
                        >
                          <Text style={{ color: t.muted, fontSize: 12, width: 80 }}>
                            {g.date ? new Date(g.date).toLocaleDateString() : tr('teamGrade.na')}
                          </Text>
                          <Text style={{ flex: 1, color: t.inkSoft, fontSize: 13 }} numberOfLines={1}>
                            {tr('teamGrade.vsOpponent', { opponent: g.opponent ?? tr('teamGrade.opponent') })}
                          </Text>
                          <Text style={{ color: t.ink, fontSize: 13, fontFamily: fonts[700] }}>
                            {known ? `${g.our_score} - ${g.opponent_score}` : tr('teamGrade.noScore')}
                          </Text>
                          {known && (
                            <View style={[s.wlBadge, { backgroundColor: won ? t.positiveSoft : t.negativeSoft }]}>
                              <Text style={[s.wlText, { color: won ? t.positive : t.negative }]}>
                                {won ? tr('teamGrade.winShort') : tr('teamGrade.lossShort')}
                              </Text>
                            </View>
                          )}
                          <Ionicons name="chevron-forward" size={14} color={t.line} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Their players: the averages a coach would quote, the same
                      0-5 grade every other screen uses, and — on tap — one
                      sentence on what to do about them. The badge used to be a
                      raw weighted-points total, which grows with minutes and
                      matched no other number in the app. */}
                  {scoutData.best_players.length > 0 && (
                    <View style={s.card}>
                      <Text style={s.cardLabel}>{tr('teamGrade.theirTopPlayers')}</Text>
                      {scoutData.best_players.map((p: any) => {
                        const a = p.averages ?? {};
                        const open = scoutPlayer === p.player_name;
                        return (
                          <View key={p.player_name}>
                            <TouchableOpacity style={s.leaderRow}
                                              onPress={() => openScoutPlayer(p.player_name)}>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: t.inkSoft, fontSize: 13, fontFamily: fonts[700] }}>
                                  {p.jersey_number ? `#${p.jersey_number}  ` : ''}{p.player_name}
                                </Text>
                                <Text style={{ color: t.muted2, fontSize: 11, marginTop: 2 }}>
                                  {tr('teamGrade.perGameLine', {
                                    pts: a.PTS ?? 0, reb: a.REB ?? 0, ast: a.AST ?? 0,
                                    stl: a.STL ?? 0, blk: a.BLK ?? 0, to: a.TO ?? 0,
                                  })}
                                  {a.FG_PCT != null ? `  ·  FG ${a.FG_PCT}%` : ''}
                                  {a.THREE_PCT != null ? `  ·  3PT ${a.THREE_PCT}%` : ''}
                                </Text>
                              </View>
                              <Text style={{ color: t.muted, fontSize: 11 }}>{tr('teamGrade.gamesG', { count: p.games })}</Text>
                              <View style={s.gradeBadge}>
                                <Text style={s.gradeBadgeText}>{p.avg_grade.toFixed(2)}</Text>
                              </View>
                              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={t.line} />
                            </TouchableOpacity>
                            {open && (
                              <View style={{ paddingBottom: 10, paddingRight: 8 }}>
                                {!insights[p.player_name] && insightBusy[p.player_name]
                                  ? <ActivityIndicator color={t.accent} size="small" style={{ alignSelf: 'flex-start' }} />
                                  : <>
                                      <Text style={{ color: t.inkSoft, fontSize: 13, lineHeight: 19, marginBottom: 6 }}>
                                        {insights[p.player_name]?.insight ?? tr('teamGrade.noInsight')}
                                      </Text>
                                      <StaleInsight subject={p.player_name} />
                                    </>}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Tendencies, as a read rather than a tally. A list of raw
                      counts ("2 FG Missed 24x") is arithmetic a coach has to do
                      in their head — over how many games, and so what? The
                      sentence leads; the per-game figures it rests on sit under
                      it so the claim can be checked and quoted. */}
                  <View style={s.card}>
                    {([['offense', tr('teamGrade.offensiveTendencies'), scoutData.offensive_tendencies],
                       ['defense', tr('teamGrade.defensiveTendencies'), scoutData.defensive_tendencies],
                       ['weak', tr('teamGrade.weakSpots'), scoutData.weak_spots]] as const)
                      .map(([key, label, rows], i) => (
                        <View key={key} style={{ marginTop: i === 0 ? 0 : 16 }}>
                          <Text style={s.cardLabel}>{label}</Text>
                          {!insights[key] && insightBusy[key]
                            ? <ActivityIndicator color={t.accent} size="small" style={{ alignSelf: 'flex-start', marginBottom: 6 }} />
                            : !!insights[key] && (
                                <>
                                  <Text style={{ color: t.ink, fontSize: 14, lineHeight: 20, marginBottom: 8 }}>
                                    {insights[key].insight}
                                  </Text>
                                  <StaleInsight subject={key} />
                                </>
                              )}
                          {(rows ?? []).map((td: any) => (
                            <Text key={td.stat} style={{ color: t.muted2, fontSize: 12, marginBottom: 3 }}>
                              {tr('teamGrade.perGameStat', { stat: td.stat, n: td.per_game ?? 0 })}
                            </Text>
                          ))}
                        </View>
                      ))}
                  </View>

                  {/* Scouting context — add context + generate/regenerate */}
                  <View style={s.card} onLayout={e => { noteInputY.current = e.nativeEvent.layout.y; }}>
                    <Text style={s.cardLabel}>{tr('teamGrade.scoutingContext')}</Text>
                    {(() => {
                      // Either bench, same as the list this page was opened
                      // from. Matching opponent_name alone meant a team with
                      // three games on file was told to "track a game against
                      // this opponent" — because in all three it was stored as
                      // the game's own team.
                      const scoutGameId = gamesInvolving(scoutOpponent ?? '')[0]?.id;
                      return scoutGameId ? (
                        <ScoutContextPanel
                          gameId={scoutGameId}
                          opponentName={scoutOpponent ?? undefined}
                          hasReport={!!scoutData?.ai_scouting_report}
                          onRegenerated={(text) => setScoutData((prev: any) => ({ ...prev, ai_scouting_report: text }))}
                        />
                      ) : (
                        <Text style={{ color: t.muted2, fontSize: 13, marginTop: 6 }}>
                          {tr('teamGrade.scoutTrackHint')}
                        </Text>
                      );
                    })()}
                  </View>

                  {scoutData.ai_scouting_report && (
                    <>
                      <View style={s.card}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                          <Text style={[s.cardLabel, { flex: 1, marginBottom: 0 }]}>{tr('teamGrade.scoutingReport')}</Text>
                          <ReportSearchButton ctl={findScout} />
                        </View>
                        <View style={{ marginTop: 8 }}>
                          <ReportSearchBar ctl={findScout} />
                          {renderReport(scoutData.ai_scouting_report, { heading: t.ink, body: t.inkSoft }, findScout.search)}
                        </View>
                      </View>

                      {/* Corrections — a separate pass to fix things in the finished report. */}
                      {(() => {
                        const scoutGameId = gamesInvolving(scoutOpponent ?? '')[0]?.id;
                        return scoutGameId ? (
                          <View style={s.card}>
                            <Text style={s.cardLabel}>{tr('teamGrade.corrections')}</Text>
                            <View style={{ marginTop: 8 }}>
                              <ReportCorrectionsPanel
                                list={() => gameEvalAPI.scoutingCorrections(scoutGameId)}
                                add={(text) => gameEvalAPI.addScoutingCorrection(scoutGameId, text)}
                                remove={(id) => gameEvalAPI.deleteScoutingCorrection(id)}
                                apply={() => gameEvalAPI.applyScoutingCorrections(scoutGameId)}
                                resultKey="ai_scouting_report"
                                onApplied={(text) => setScoutData((prev: any) => ({ ...prev, ai_scouting_report: text }))}
                              />
                            </View>
                          </View>
                        ) : null;
                      })()}
                    </>
                  )}
                </>
              ) : null}
            </>
          )}
        </KeyboardAwareScrollView>
      )}

      {/* Full Game Report — our team + opponent, with add-context (like Scout) */}
      {activeView === 'gamereport' && (
        <KeyboardAwareScrollView ref={findGameReport.scrollRef} style={s.scroll} contentContainerStyle={{ paddingBottom: 100 }}>
          {!gameReportGame ? (
            <>
              <ListSearchHeader
                title={tr('reportTypes.game_report')}
                titleStyle={{ color: t.ink, fontSize: 22, fontFamily: fonts[900] }}
                value={gameReportSearch}
                onChange={setGameReportSearch}
                placeholder={tr('staffHub.searchGamesPlaceholder')}
                subtitle={(
                  <Text style={{ color: t.muted2, fontSize: 13, marginTop: 4 }}>
                    {tr('teamGrade.gameReportPickHint')}
                  </Text>
                )}
              />
              <View style={{ height: 12 }} />
              {sessions.length === 0 && (
                <Text style={{ color: t.muted2, fontSize: 13 }}>{tr('teamGrade.noGamesYet')}</Text>
              )}
              {sessions.length > 0 && gameReportGames.length === 0 && (
                <Text style={{ color: t.muted2, fontSize: 13 }}>{tr('teamGrade.noOpponents')}</Text>
              )}
              <View style={desktopOnly({ flexDirection: 'row', flexWrap: 'wrap', gap: reportGrid.gap, paddingHorizontal: 16 })}
                    ref={reportGrid.ref} onLayout={reportGrid.onLayout}>
              {/* No W/L badge. The card already carries "Angola vs Egypt" and
                  "83-72"; a bare W beside them says nothing the two numbers do
                  not, and without a team on it there was no way to tell whose
                  W it was. */}
              {gameReportGames.map((g: any) => (
                <TouchableOpacity key={g.id} style={[s.gameCard, reportGrid.cardWidth ? { width: reportGrid.cardWidth } : null]} onPress={() => openGameReport(g)}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontSize: 15, fontFamily: fonts[700] }}>{matchupLabel(g)}</Text>
                    <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>
                      {g.date ? new Date(g.date).toLocaleDateString() : ''}
                      {g.our_score != null ? `  ·  ${g.our_score}-${g.opponent_score}` : ''}
                      {g.ai_game_report ? `  ·  ${tr('teamGrade.reportReady')}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={t.muted} />
                </TouchableOpacity>
              ))}
              </View>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}
                onPress={() => leaveStep(() => setGameReportGame(null))}
              >
                <Ionicons name="arrow-back" size={18} color={t.muted} />
                <Text style={{ color: t.muted, fontSize: 14 }}>{tr('teamGrade.allGames')}</Text>
              </TouchableOpacity>

              {/* Both teams. A game report is about the two of them and this
                  page named one, so it read as a report on the opponent. */}
              <Text style={{ color: t.ink, fontSize: 22, fontFamily: fonts[900], marginBottom: 2 }}>
                {matchupLabel(gameReportGame)}
              </Text>
              <Text style={{ color: t.muted2, fontSize: 13, marginBottom: 12 }}>
                {gameReportGame.date ? new Date(gameReportGame.date).toLocaleDateString() : ''}
                {gameReportGame.our_score != null ? `  ·  ${gameReportGame.our_score}-${gameReportGame.opponent_score}` : ''}
              </Text>

              {loadingGameReport ? (
                <ActivityIndicator color={t.accent} style={{ marginTop: 24 }} />
              ) : (
                <>
                  {/* Add context + generate / regenerate */}
                  <View style={s.card}>
                    <Text style={s.cardLabel}>{tr('teamGrade.gameReportContext')}</Text>
                    <View style={{ marginTop: 8 }}>
                      <GameReportPanel
                        gameId={gameReportGame.id}
                        opponentName={gameReportGame.opponent_name}
                        ourTeamName={gameReportGame.team_name
                          ?? (teams as any[]).find(tm => tm.id === gameReportGame.team_id)?.name
                                     ?? coach?.program_name}
                        hasReport={!!gameReportGame.ai_game_report}
                        onRegenerated={(text) => setGameReportGame((prev: any) => ({ ...prev, ai_game_report: text }))}
                      />
                    </View>
                  </View>

                  {gameReportGame.ai_game_report ? (
                    <>
                      <View style={s.card}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                          <Text style={[s.cardLabel, { flex: 1, marginBottom: 0 }]}>{tr('teamGrade.gameReportLabel')}</Text>
                          <ReportSearchButton ctl={findGameReport} />
                        </View>
                        <View style={{ marginTop: 8 }}>
                          <ReportSearchBar ctl={findGameReport} />
                          {renderReport(gameReportGame.ai_game_report, { heading: t.ink, body: t.inkSoft }, findGameReport.search)}
                        </View>
                      </View>

                      {/* Corrections — a separate pass to fix things in the finished report. */}
                      <View style={s.card}>
                        <Text style={s.cardLabel}>{tr('teamGrade.corrections')}</Text>
                        <View style={{ marginTop: 8 }}>
                          <ReportCorrectionsPanel
                            list={() => gameEvalAPI.gameReportCorrections(gameReportGame.id)}
                            add={(text) => gameEvalAPI.addGameReportCorrection(gameReportGame.id, text)}
                            remove={(id) => gameEvalAPI.deleteGameReportCorrection(id)}
                            apply={() => gameEvalAPI.applyGameReportCorrections(gameReportGame.id)}
                            resultKey="ai_game_report"
                            onApplied={(text) => setGameReportGame((prev: any) => ({ ...prev, ai_game_report: text }))}
                          />
                        </View>
                      </View>
                    </>
                  ) : (
                    <Text style={{ color: t.muted2, fontSize: 13 }}>
                      {tr('teamGrade.noReportYet')}
                    </Text>
                  )}
                </>
              )}
            </>
          )}
        </KeyboardAwareScrollView>
      )}

      {/* The two numbers, only when they are asked for. */}
      <Sheet visible={showScoreEdit} transparent animationType="fade"
             onRequestClose={() => setShowScoreEdit(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxWidth: 420 }]}>
            <Text style={s.modalTitle}>{tr('teamGrade.finalScore')}</Text>
            {!!scoreError && (
              <Text style={{ color: t.negative, fontSize: 13, fontFamily: fonts[600], marginTop: 6 }}>
                {scoreError}
              </Text>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
              {/* minWidth: 0 on every flex child. A text input carries an
                  intrinsic width on web — roughly twenty characters — and
                  without this it refuses to shrink below it, so two of them
                  plus the dash ran off the side of a phone. */}
              <TextInput
                style={[s.input, { flex: 1, minWidth: 0, marginBottom: 0, textAlign: 'center' }]}
                keyboardType="number-pad" placeholder="0" placeholderTextColor={t.muted2}
                value={finalOurs} onChangeText={setFinalOurs}
              />
              <Text style={{ color: t.muted, fontSize: 16, fontFamily: fonts[800] }}>–</Text>
              <TextInput
                style={[s.input, { flex: 1, minWidth: 0, marginBottom: 0, textAlign: 'center' }]}
                keyboardType="number-pad" placeholder="0" placeholderTextColor={t.muted2}
                value={finalTheirs} onChangeText={setFinalTheirs}
              />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
              <TouchableOpacity
                style={[s.modalBtn, { flexGrow: 1, flexBasis: 110, borderWidth: 1, borderColor: t.line }]}
                onPress={() => setShowScoreEdit(false)}
              >
                <Text style={{ color: t.muted, fontFamily: fonts[700], fontSize: 13 }}>{tr('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: t.ctaBg, flexGrow: 1, flexBasis: 140 }]}
                onPress={saveFinalScore}
                disabled={savingScore || !finalOurs.trim() || !finalTheirs.trim()}
              >
                {savingScore
                  ? <ActivityIndicator color={t.ctaText} size="small" />
                  : <Text style={{ color: t.ctaText, fontFamily: fonts[700], fontSize: 13 }}>{tr('common.save')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Sheet>

      {/* Asked before the review list, because the answer decides which side
          every row from that heading belongs to.

          The team is named the way the rest of this screen names it. A game
          session carries team_id, not team_name, so asking for the field that
          does not exist meant this question always read "Our Team" — and "Our
          Team" is no help at all when the point of the question is to tell two
          unlabelled columns apart. */}
      {askLabels.length > 0 && !!activeGame && (
        <TeamLabelPrompt
          labels={askLabels}
          ourName={(teams as any[]).find(tm => tm.id === activeGame.team_id)?.name
                   ?? coach?.program_name ?? tr('teamGrade.ourTeam')}
          theirName={activeGame.opponent_name || tr('teamGrade.opponent')}
          busy={importing}
          onCancel={() => { setAskLabels([]); setStatPreview(null);
                            setImportedExtras({ events: [], shots: [], team_stats: [] }); }}
          onDone={applyLabelSides}
        />
      )}

      {/* Imported stats preview — confirm before committing */}
      <Sheet visible={!!statPreview && askLabels.length === 0} transparent animationType="slide" onRequestClose={() => setStatPreview(null)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxHeight: '85%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={s.modalTitle}>{tr('teamGrade.reviewImportedStats')}</Text>
              <TouchableOpacity onPress={() => setStatPreview(null)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
            </View>
            <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 10 }}>
              {tr('teamGrade.importPreviewHint')}
            </Text>
            {/* Which side each group belongs to, asked once per team the files
                named rather than assumed before the upload. A sheet usually
                carries both teams, so choosing a side first was a guess made
                before anything had been read. */}
            <ScrollView style={{ maxHeight: 380 }}>
              {previewGroups.map(group => (
                <View key={group.key} style={{ marginBottom: 10 }}>
                  <View style={{ backgroundColor: t.chip, borderRadius: 10, padding: 10, marginBottom: 6 }}>
                    <Text style={{ color: t.ink, fontSize: 13, fontFamily: fonts[800] }} numberOfLines={1}>
                      {group.name || tr('teamGrade.unnamedTeam')}
                    </Text>
                    <Text style={{ color: t.muted2, fontSize: 11, marginTop: 2, marginBottom: 8 }}>
                      {tr('teamGrade.playersFound', { count: group.rows.length })}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {[false, true].map(side => {
                        const on = group.side === side;
                        const label = side
                          ? (activeGame?.opponent_name || tr('teamGrade.opponent'))
                          : ((teams as any[]).find(tm => tm.id === activeGame?.team_id)?.name
                             ?? coach?.program_name ?? tr('teamGrade.ourTeam'));
                        return (
                          <TouchableOpacity
                            key={String(side)}
                            style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center',
                                     borderWidth: 1,
                                     borderColor: on ? t.accent : t.line,
                                     backgroundColor: on ? t.accentSoft : 'transparent' }}
                            onPress={() => setStatPreview(prev => prev!.map(x =>
                              (x.team_name ?? '') === group.name ? { ...x, is_opponent: side } : x))}
                          >
                            <Text style={{ color: on ? t.accent : t.muted, fontSize: 12, fontFamily: fonts[700] }} numberOfLines={1}>
                              {label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {/* Whose team this is, asked once here rather than worked
                        out. A coach imports their own box score as readily as
                        an opponent's, so nothing about the file answers it —
                        and a team wrongly kept as the coach's own walks a
                        fixture they were only scouting into their record. */}
                    {!!group.name && (
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}
                        onPress={() => setTeamMine(prev => ({ ...prev, [group.name]: !mineFor(group.name) }))}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={mineFor(group.name) ? 'checkbox' : 'square-outline'}
                          size={18}
                          color={mineFor(group.name) ? t.accent : t.muted}
                        />
                        <Text style={{ color: t.muted, fontSize: 12, flex: 1 }} numberOfLines={2}>
                          {tr('teamGrade.isMyTeam', { name: group.name })}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {group.rows.map(({ p, i }: any) => (
                <TouchableOpacity
                  key={i}
                  style={{ backgroundColor: t.card, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: p._include ? t.accent : t.line, opacity: p._include ? 1 : 0.5 }}
                  onPress={() => setStatPreview(prev => prev!.map((x, xi) => xi === i ? { ...x, _include: !x._include } : x))}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name={p._include ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={p._include ? t.accent : t.muted} />
                    <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[700], flex: 1 }}>{p.player_name}</Text>

                  </View>
                  <Text style={{ color: t.muted2, fontSize: 11, marginTop: 4 }}>
                    {Object.entries(p.stats ?? {}).map(([k, v]) => `${k}: ${v}`).join('  ·  ') || tr('teamGrade.noStatsRead')}
                  </Text>
                </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={[s.modalBtn, { flex: 1, backgroundColor: t.chip }]} onPress={() => setStatPreview(null)}>
                <Text style={{ color: t.muted, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, { flex: 1.5, backgroundColor: t.ctaBg }]} onPress={commitGameStats} disabled={importing}>
                {importing ? <ActivityIndicator color={t.ctaText} /> : <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>{tr('teamGrade.importStats')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Sheet>

      {/* New Game Modal */}
      <Sheet visible={showNewGame} transparent animationType="slide" onRequestClose={() => setShowNewGame(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[s.modalBox, { maxHeight: '85%' }]}>
            <Text style={s.modalTitle}>{tr('teamGrade.newGame')}</Text>
            <KeyboardAwareScrollView>
              <>
                <Text style={s.fieldLabel}>{tr('teamGrade.teamOptional')}</Text>
                <View ref={newTeamOutside}>
                <TouchableOpacity
                  style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: showTeamDropdown ? 0 : 16 }]}
                  onPress={() => { setShowTeamDropdown(v => !v); setShowCreateTeam(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: newGameTeamId === null ? t.muted2 : t.ink, fontSize: 15 }}>
                    {newGameTeamId === null ? tr('teamGrade.noneNoTeam') : teams.find((tm: any) => tm.id === newGameTeamId)?.name ?? tr('teamGrade.selectTeam')}
                  </Text>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{showTeamDropdown ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {showTeamDropdown && (
                  <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 200 }}>
                      <TouchableOpacity
                        style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.line, backgroundColor: newGameTeamId === null ? t.accentSoft : 'transparent' }}
                        onPress={() => { setNewGameTeamId(null); setShowTeamDropdown(false); }}
                      >
                        <Text style={{ color: newGameTeamId === null ? t.accent : t.inkSoft, fontSize: 14 }}>{tr('teamGrade.none')}</Text>
                      </TouchableOpacity>
                      {teams.filter((tm: any) => !tm.parent_team_id).map((tm: any) => (
                        <TouchableOpacity
                          key={tm.id}
                          style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.line, backgroundColor: newGameTeamId === tm.id ? t.accentSoft : 'transparent' }}
                          onPress={() => { setNewGameTeamId(tm.id); if (tm.competition_level) setNewGameLevel(tm.competition_level); setShowTeamDropdown(false); }}
                        >
                          <Text style={{ color: newGameTeamId === tm.id ? t.accent : t.inkSoft, fontSize: 14 }}>{tm.name}</Text>
                        </TouchableOpacity>
                      ))}
                      {/* Create new team row */}
                      {!showCreateTeam ? (
                        <TouchableOpacity
                          style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                          onPress={() => setShowCreateTeam(true)}
                        >
                          <Text style={{ color: t.accent, fontSize: 14, fontFamily: fonts[700] }}>{tr('teamGrade.createNewTeam')}</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={{ padding: 12, gap: 8 }}>
                          <VoiceTextInput
                            style={[s.input, { marginBottom: 0 }]}
                            placeholder={tr('teamGrade.teamNamePlaceholder')}
                            placeholderTextColor={t.muted2}
                            value={newTeamName}
                            onChangeText={setNewTeamName}
                            autoFocus
                          />
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <TouchableOpacity
                              style={[s.modalBtn, { flex: 1, backgroundColor: t.chip, paddingVertical: 8 }]}
                              onPress={() => { setShowCreateTeam(false); setNewTeamName(''); }}
                            >
                              <Text style={{ color: t.muted, fontFamily: fonts[700], fontSize: 13 }}>{tr('common.cancel')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[s.modalBtn, { flex: 1, backgroundColor: t.accent, paddingVertical: 8, opacity: newTeamName.trim() ? 1 : 0.4 }]}
                              onPress={createTeam}
                              disabled={creatingTeam || !newTeamName.trim()}
                            >
                              {creatingTeam
                                ? <ActivityIndicator color={t.ctaText} size="small" />
                                : <Text style={{ color: t.ink, fontFamily: fonts[700], fontSize: 13 }}>{tr('teamGrade.create')}</Text>}
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </ScrollView>
                  </View>
                )}
                </View>
              </>
              {/* Opponent: pick one, or type one.
                  This was a bare text box, so the same opponent arrived as
                  "Duke", "duke" and "Duke University" across three games — and
                  opponent notes, scouting reports and the knowledge base are
                  all keyed on that name, so each spelling started its own empty
                  history. The list holds both the teams on file and everyone
                  already played; typing is still there for the first meeting. */}
              <Text style={s.fieldLabel}>{tr('teamGrade.opponentName')}</Text>
              <View ref={opponentOutside} style={{ marginBottom: 16 }}>
                <TouchableOpacity
                  style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }]}
                  onPress={() => setShowOpponentDropdown(v => !v)}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: newGameOpponent ? t.ink : t.muted2, fontSize: 15 }} numberOfLines={1}>
                    {newGameOpponent || tr('teamGrade.opponentPlaceholder')}
                  </Text>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{showOpponentDropdown ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {showOpponentDropdown && (
                  <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, marginTop: 6, overflow: 'hidden' }}>
                    {/* Known opponents first — the list is the point of the
                        control. Typing a new one sits underneath it, past a
                        divider and under its own heading: as a box at the top it
                        crowded the field's label and read like a second copy of
                        the thing just tapped. */}
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 200 }}>
                      {opponentChoices.map(o => (
                        <TouchableOpacity
                          key={`${o.kind}-${o.name}`}
                          style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.line,
                                   backgroundColor: newGameOpponent === o.name ? t.accentSoft : 'transparent',
                                   flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
                          onPress={() => { setNewGameOpponent(o.name); setShowOpponentDropdown(false); }}
                        >
                          <Text style={{ color: newGameOpponent === o.name ? t.accent : t.inkSoft, fontSize: 14, flex: 1 }} numberOfLines={1}>
                            {o.name}
                          </Text>
                          <Text style={{ color: t.muted2, fontSize: 10, fontFamily: fonts[700] }}>
                            {o.kind === 'team' ? tr('teamGrade.opponentFromTeams') : tr('teamGrade.opponentPlayedBefore')}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.chip }}>
                      <Text style={{ color: t.muted2, fontSize: 10, fontFamily: fonts[800], letterSpacing: 0.8 }}>
                        {tr('teamGrade.opponentNewHeading')}
                      </Text>
                      <VoiceTextInput
                        style={[s.input, { marginBottom: 0 }]}
                        placeholder={tr('teamGrade.opponentPlaceholder')}
                        placeholderTextColor={t.muted2}
                        value={newGameOpponent}
                        onChangeText={setNewGameOpponent}
                      />
                    </View>
                  </View>
                )}
              </View>
              <Text style={s.fieldLabel}>{tr('teamGrade.locationOptional')}</Text>
              <VoiceTextInput
                style={s.input}
                placeholder={tr('teamGrade.locationPlaceholder')}
                placeholderTextColor={t.muted2}
                value={newGameLocation}
                onChangeText={setNewGameLocation}
              />
              <Text style={s.fieldLabel}>{tr('teamGrade.seasonYearOptional')}</Text>
              <VoiceTextInput
                style={s.input}
                placeholder={tr('teamGrade.seasonYearPlaceholder')}
                placeholderTextColor={t.muted2}
                value={newGameYear}
                onChangeText={setNewGameYear}
              />

              <Text style={s.fieldLabel}>{tr('teamGrade.date')}</Text>
              <TouchableOpacity
                style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }]}
                onPress={() => setShowDatePicker(v => !v)}
                activeOpacity={0.7}
              >
                <Text style={{ color: t.ink, fontSize: 15 }}>
                  {newGameDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
                <Ionicons name="calendar-outline" size={17} color={t.muted} />
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker
                  value={newGameDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  themeVariant={mode === 'dark' ? 'dark' : 'light'}
                  onChange={(_, d) => {
                    if (Platform.OS === 'android') setShowDatePicker(false);
                    if (d) {
                      // Keep the season year in sync unless the coach typed their own.
                      if (!newGameYear.trim() || newGameYear === seasonForDate(newGameDate)) {
                        setNewGameYear(seasonForDate(d));
                      }
                      setNewGameDate(d);
                    }
                  }}
                />
              )}

              <Text style={s.fieldLabel}>{tr('teamGrade.competitionLevel')}</Text>
              <TouchableOpacity
                style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: showLevelDD ? 0 : 6 }]}
                onPress={() => { setShowLevelDD(v => !v); setShowPhaseDD(false); }}
                activeOpacity={0.7}
              >
                <Text style={{ color: t.ink, fontSize: 15 }}>{newGameLevel}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>{showLevelDD ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {showLevelDD && (
                <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, marginBottom: 6, overflow: 'hidden' }}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 220 }}>
                    {COMPETITION_LEVELS.map((lv, i) => (
                      <TouchableOpacity
                        key={lv}
                        style={{ padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.line, backgroundColor: newGameLevel === lv ? t.accentSoft : 'transparent' }}
                        onPress={() => { setNewGameLevel(lv); setShowLevelDD(false); }}
                      >
                        <Text style={{ color: newGameLevel === lv ? t.accent : t.inkSoft, fontSize: 14 }}>{lv}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
              {(() => {
                const f = formatForLevel(newGameLevel);
                return (
                  <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 16 }}>
                    {tr('teamGrade.periodsFormat', { count: f.numPeriods, unit: f.format === 'halves' ? tr('teamGrade.halves') : tr('teamGrade.quarters'), clock: formatClock(f.periodSeconds) })}
                  </Text>
                );
              })()}

              <Text style={s.fieldLabel}>{tr('teamGrade.typeLabel')}</Text>
              <TouchableOpacity
                style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: showPhaseDD ? 0 : 16 }]}
                onPress={() => { setShowPhaseDD(v => !v); setShowLevelDD(false); }}
                activeOpacity={0.7}
              >
                <Text style={{ color: t.ink, fontSize: 15 }}>{phaseLabel(newGamePhase)}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>{showPhaseDD ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {showPhaseDD && (
                <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
                  {orderedPhases.map((p, i) => (
                    <TouchableOpacity
                      key={p}
                      style={{ padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.line, backgroundColor: newGamePhase === p ? t.accentSoft : 'transparent' }}
                      onPress={() => { setNewGamePhase(p); setShowPhaseDD(false); }}
                    >
                      <Text style={{ color: newGamePhase === p ? t.accent : t.inkSoft, fontSize: 14 }}>{phaseLabel(p)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={s.fieldLabel}>{tr('teamGrade.trackingMode')}</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 4 }}>
                {([
                  { key: 'live', icon: 'pulse-outline', title: tr('teamGrade.trackLiveTitle'), desc: tr('teamGrade.trackLiveDesc') },
                  { key: 'post', icon: 'create-outline', title: tr('teamGrade.trackPostTitle'), desc: tr('teamGrade.trackPostDesc') },
                ] as const).map(m => {
                  const on = trackMode === m.key;
                  return (
                    <TouchableOpacity
                      key={m.key}
                      style={{ flex: 1, padding: 14, borderRadius: 14, alignItems: 'center', borderWidth: on ? 1.5 : 1,
                               backgroundColor: on ? t.accentSoft : 'transparent', borderColor: on ? t.accent : t.line }}
                      onPress={() => setTrackMode(m.key)}
                    >
                      <Ionicons name={m.icon as any} size={22} color={on ? t.accent : t.muted} />
                      <Text style={{ color: t.ink, fontSize: 14, fontFamily: on ? fonts[800] : fonts[700], marginTop: 7 }}>{m.title}</Text>
                      <Text style={{ color: t.muted, fontSize: 11, marginTop: 2, textAlign: 'center' }}>{m.desc}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </KeyboardAwareScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={[s.modalBtn, { flex: 1, backgroundColor: t.chip }]}
                onPress={() => { setShowNewGame(false); setShowTeamDropdown(false); setShowCreateTeam(false); setNewTeamName(''); }}
              >
                <Text style={{ color: t.muted, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, { flex: 1, backgroundColor: t.accent, opacity: newGameOpponent.trim() ? 1 : 0.4 }]}
                onPress={createGame}
                disabled={creating || !newGameOpponent.trim()}
              >
                {creating
                  ? <ActivityIndicator color={t.ctaText} />
                  : <Text style={{ color: t.ink, fontFamily: fonts[700] }}>{tr('teamGrade.startGame')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Sheet>

      {/* Lineup Modal */}
      <Sheet visible={showLineupModal} transparent animationType="slide" onRequestClose={() => setShowLineupModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxHeight: '80%' }]}>
            <Text style={s.modalTitle}>{subOutPlayer ? tr('teamGrade.whoCameIn') : tr('teamGrade.manageLineup')}</Text>
            {subOutPlayer ? (
              <>
                <Text style={{ color: t.muted, fontSize: 13, marginBottom: 16 }}>
                  {tr('teamGrade.subInPromptPre')}<Text style={{ color: t.ink, fontFamily: fonts[700] }}>{subOutPlayer}</Text>{tr('teamGrade.subInPromptSuffix')}
                </Text>
                <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
                  {(entryMode === 'our' ? roster.map((p: any) => p.name) : opponentPlayers)
                    .filter(n => n !== subOutPlayer)
                    .map(name => (
                      <TouchableOpacity
                        key={name}
                        style={{ padding: 13, borderRadius: 10, backgroundColor: t.chip, marginBottom: 8, borderWidth: 1, borderColor: t.line }}
                        onPress={async () => {
                          if (activeGame) {
                            await gameEvalAPI.logLineup(activeGame.id, {
                              player_name: subOutPlayer,
                              is_opponent: entryMode === 'opponent',
                              event_type: 'out',
                              quarter: activeQuarter,
                            });
                            await gameEvalAPI.logLineup(activeGame.id, {
                              player_name: name,
                              is_opponent: entryMode === 'opponent',
                              event_type: 'in',
                              quarter: activeQuarter,
                            });
                          }
                          setSubOutPlayer(null);
                        }}
                      >
                        <Text style={{ color: t.inkSoft, fontSize: 14, fontFamily: fonts[600] }}>{name}</Text>
                      </TouchableOpacity>
                    ))
                  }
                </ScrollView>
                <TouchableOpacity
                  style={[s.modalBtn, { backgroundColor: t.chip, marginTop: 8 }]}
                  onPress={() => setSubOutPlayer(null)}
                >
                  <Text style={{ color: t.muted, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={{ color: t.muted, fontSize: 13, marginBottom: 16, lineHeight: 18 }}>
                  {tr('teamGrade.lineupHint')}
                </Text>
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  {(entryMode === 'our' ? roster.map((p: any) => p.name) : opponentPlayers).map(name => (
                    <View key={name} style={{ flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                      <TouchableOpacity
                        style={[s.modalBtn, { flex: 1, backgroundColor: t.positiveSoft, borderWidth: 1, borderColor: t.positive }]}
                        onPress={async () => {
                          if (activeGame) {
                            await gameEvalAPI.logLineup(activeGame.id, {
                              player_name: name,
                              is_opponent: entryMode === 'opponent',
                              event_type: 'in',
                              quarter: activeQuarter,
                            });
                          }
                        }}
                      >
                        <Text style={{ color: t.positive, fontFamily: fonts[600] }}>{tr('teamGrade.inShort')}</Text>
                      </TouchableOpacity>
                      <Text style={{ color: t.ink, fontSize: 13, flex: 2, textAlign: 'center' }}>{name}</Text>
                      <TouchableOpacity
                        style={[s.modalBtn, { flex: 1, backgroundColor: t.negativeSoft, borderWidth: 1, borderColor: t.negative }]}
                        onPress={() => setSubOutPlayer(name)}
                      >
                        <Text style={{ color: t.negative, fontFamily: fonts[600] }}>{tr('teamGrade.outShort')}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
                <TouchableOpacity
                  style={[s.modalBtn, { backgroundColor: t.line, marginTop: 8 }]}
                  onPress={() => { setShowLineupModal(false); setSubOutPlayer(null); }}
                >
                  <Text style={{ color: t.ink, fontFamily: fonts[700] }}>{tr('common.done')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Sheet>

      {/* Player Detail Modal */}
      <Sheet visible={showDetailModal} transparent animationType="slide" onRequestClose={() => setShowDetailModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxHeight: '90%' }]}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 18, fontFamily: fonts[900] }}>{detailModalPlayer}</Text>
                {summary && (() => {
                  const grades = detailTab === 'opponent' ? summary.opponent_grades : summary.player_grades;
                  const pg = grades.find((g: any) => g.player_name === detailModalPlayer);
                  if (!pg) return null;
                  return (
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                      <Text style={{ color: t.muted, fontSize: 12 }}>{tr('teamGrade.offLabel')} <Text style={{ color: t.accent, fontFamily: fonts[700] }}>{pg.offensive_grade.toFixed(2)}</Text></Text>
                      <Text style={{ color: t.muted, fontSize: 12 }}>{tr('teamGrade.defLabel')} <Text style={{ color: t.accent, fontFamily: fonts[700] }}>{pg.defensive_grade.toFixed(2)}</Text></Text>
                      <Text style={{ color: t.muted, fontSize: 12 }}>{minsLabel(pg.minutes_played)} {tr('teamGrade.minAbbr')}</Text>
                    </View>
                  );
                })()}
              </View>
              {summary && (() => {
                const grades = detailTab === 'opponent' ? summary.opponent_grades : summary.player_grades;
                const pg = grades.find((g: any) => g.player_name === detailModalPlayer);
                if (!pg) return null;
                return (
                  <View style={{ backgroundColor: t.accent, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center', minWidth: 58 }}>
                    <Text style={{ color: t.ctaText, fontSize: 18, fontFamily: fonts[900], letterSpacing: -0.5 }}>{pg.game_grade.toFixed(2)}</Text>
                    <Text style={{ color: t.ctaText, fontSize: 8, letterSpacing: 1.5, fontFamily: fonts[700], opacity: 0.75 }}>{tr('teamGrade.gradeLabel')}</Text>
                  </View>
                );
              })()}
            </View>

            <View style={{ height: 1, backgroundColor: t.chip, marginBottom: 14 }} />

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Substitution events */}
              {gameLineup.filter(e => e.player_name === detailModalPlayer && e.is_opponent === (detailTab === 'opponent')).length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700], letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{tr('teamGrade.substitutions')}</Text>
                  {gameLineup
                    .filter(e => e.player_name === detailModalPlayer && e.is_opponent === (detailTab === 'opponent'))
                    .map((e, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7,
                                             borderBottomWidth: 1, borderBottomColor: t.chip }}>
                        <View style={{ width: 28, height: 28, borderRadius: 14,
                                        backgroundColor: e.event_type === 'in' ? t.positiveSoft : t.negativeSoft,
                                        alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name={e.event_type === 'in' ? 'log-in-outline' : 'log-out-outline'}
                                    size={14} color={e.event_type === 'in' ? t.positive : t.negative} />
                        </View>
                        <Text style={{ color: e.event_type === 'in' ? t.positive : t.negative, fontFamily: fonts[700], fontSize: 12, width: 28 }}>
                          {e.event_type === 'in' ? tr('teamGrade.inShort') : tr('teamGrade.outShort')}
                        </Text>
                        <Text style={{ color: t.muted, fontSize: 12 }}>{qLabel(e.quarter)}</Text>
                        {e.timestamp_seconds != null && (
                          <Text style={{ color: t.muted2, fontSize: 11 }}>
                            {Math.floor(e.timestamp_seconds / 60)}:{String(e.timestamp_seconds % 60).padStart(2, '0')}
                          </Text>
                        )}
                      </View>
                    ))
                  }
                </View>
              )}

              {/* Stats by quarter */}
              {[1, 2, 3, 4, 5].map(q => {
                const qStats = gameStats.filter(st =>
                  st.player_name === detailModalPlayer &&
                  st.is_opponent === (detailTab === 'opponent') &&
                  st.quarter === q
                );
                if (qStats.length === 0) return null;
                const offTotal = qStats.filter(s => s.stat_category === 'offense').reduce((a, s) => a + s.weighted_points, 0);
                const defTotal = qStats.filter(s => s.stat_category === 'defense').reduce((a, s) => a + s.weighted_points, 0);
                return (
                  <View key={q} style={{ marginBottom: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ color: t.ink, fontSize: 13, fontFamily: fonts[800] }}>
                        {q === 5 ? tr('teamGrade.overtime') : tr('teamGrade.quarterN', { q })}
                      </Text>
                      <Text style={{ color: t.muted, fontSize: 11 }}>
                        {tr('teamGrade.offDef', { off: `${offTotal > 0 ? '+' : ''}${offTotal.toFixed(1)}`, def: `${defTotal > 0 ? '+' : ''}${defTotal.toFixed(1)}` })}
                      </Text>
                    </View>
                    {qStats.map(st => (
                      <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6,
                                                  borderBottomWidth: 1, borderBottomColor: t.chip }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3,
                                        backgroundColor: st.stat_category === 'offense' ? t.accent : t.accent,
                                        marginRight: 10 }} />
                        <Text style={{ flex: 1, color: t.inkSoft, fontSize: 13 }}>{st.stat_name}</Text>
                        <Text style={{ color: t.muted, fontSize: 11, marginRight: 8 }}>
                          {st.stat_category === 'offense' ? tr('teamGrade.offLabel') : tr('teamGrade.defLabel')}
                        </Text>
                        <Text style={{ color: st.weighted_points >= 0 ? t.accent : t.negative,
                                        fontSize: 13, fontFamily: fonts[700], width: 44, textAlign: 'right' }}>
                          {st.weighted_points >= 0 ? '+' : ''}{st.weighted_points.toFixed(1)}
                        </Text>
                      </View>
                    ))}
                  </View>
                );
              })}

              {gameStats.filter(st => st.player_name === detailModalPlayer && st.is_opponent === (detailTab === 'opponent')).length === 0 && (
                <Text style={{ color: t.muted2, fontSize: 13, textAlign: 'center', paddingVertical: 24 }}>{tr('teamGrade.noStatsLogged')}</Text>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[s.modalBtn, { backgroundColor: t.chip, marginTop: 14 }]}
              onPress={() => setShowDetailModal(false)}
            >
              <Text style={{ color: t.muted, fontFamily: fonts[700] }}>{tr('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Sheet>

      {/* Player Stats Edit Modal */}
      <Sheet visible={showStatsModal} transparent animationType="slide" onRequestClose={() => setShowStatsModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxHeight: '90%' }]}>
            <Text style={s.modalTitle}>{isOwnedGame(detailGame) ? tr('teamGrade.editStats') : tr('teamGrade.statsTitle')} — {statsModalPlayer}</Text>

            {/* ADD STAT SECTION — owner only */}
            {isOwnedGame(detailGame) && (
            <View style={{ backgroundColor: t.chip, borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: t.chip }}>
              <Text style={{ color: t.accent, fontSize: 11, fontFamily: fonts[700], letterSpacing: 1, marginBottom: 10 }}>{tr('teamGrade.addMissingStat')}</Text>

              {/* Quarter selector */}
              <Text style={{ color: t.muted, fontSize: 11, marginBottom: 6 }}>{tr('teamGrade.quarterLabel')}</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
                {[1, 2, 3, 4, 5].map(q => (
                  <TouchableOpacity
                    key={q}
                    style={{ flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center',
                              backgroundColor: addStatQuarter === q ? t.accent : t.chip,
                              borderWidth: 1, borderColor: addStatQuarter === q ? t.accent : t.line }}
                    onPress={() => setAddStatQuarter(q)}
                  >
                    <Text style={{ color: addStatQuarter === q ? t.ink : t.muted, fontSize: 12, fontFamily: fonts[700] }}>
                      {qLabel(q)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Stat picker */}
              <Text style={{ color: t.muted, fontSize: 11, marginBottom: 6 }}>{tr('teamGrade.statLabelCaps')}</Text>
              <TouchableOpacity
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                         backgroundColor: t.chip, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: t.line,
                         marginBottom: addingStatDropdownOpen ? 0 : 10 }}
                onPress={() => setAddingStatDropdownOpen(v => !v)}
              >
                <Text style={{ color: addStatName ? t.ink : t.muted2, fontSize: 14 }}>
                  {addStatName ? statLabel(addStatName) : tr('teamGrade.selectStatPlaceholder')}
                </Text>
                <Ionicons name={addingStatDropdownOpen ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted} />
              </TouchableOpacity>
              {addingStatDropdownOpen && (
                <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 8, marginBottom: 10, maxHeight: 160, overflow: 'hidden' }}>
                  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700], padding: 8, letterSpacing: 1 }}>{tr('teamGrade.offense')}</Text>
                    {OFFENSE_STATS.map(stat => (
                      <TouchableOpacity key={stat} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: t.chip,
                                                             backgroundColor: addStatName === stat ? t.accentSoft : 'transparent' }}
                        onPress={() => { setAddStatName(stat); setAddingStatDropdownOpen(false); }}>
                        <Text style={{ color: addStatName === stat ? t.accent : t.inkSoft, fontSize: 13 }}>{statLabel(stat)}</Text>
                      </TouchableOpacity>
                    ))}
                    <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700], padding: 8, letterSpacing: 1 }}>{tr('teamGrade.defense')}</Text>
                    {DEFENSE_STATS.map(stat => (
                      <TouchableOpacity key={stat} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: t.chip,
                                                             backgroundColor: addStatName === stat ? t.accentSoft : 'transparent' }}
                        onPress={() => { setAddStatName(stat); setAddingStatDropdownOpen(false); }}>
                        <Text style={{ color: addStatName === stat ? t.accent : t.inkSoft, fontSize: 13 }}>{statLabel(stat)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <TouchableOpacity
                style={{ backgroundColor: addStatName ? t.accent : t.line, borderRadius: 8, paddingVertical: 10,
                         alignItems: 'center', opacity: addingStat ? 0.6 : 1 }}
                onPress={() => addStatName && addStatEntry(addStatName, addStatQuarter)}
                disabled={!addStatName || addingStat}
              >
                {addingStat
                  ? <ActivityIndicator color={t.ctaText} size="small" />
                  : <Text style={{ color: t.ink, fontFamily: fonts[700], fontSize: 14 }}>{tr('teamGrade.addStat')}</Text>}
              </TouchableOpacity>
            </View>
            )}

            {/* EXISTING STATS */}
            <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700], letterSpacing: 1, marginBottom: 8 }}>{isOwnedGame(detailGame) ? tr('teamGrade.loggedStatsRemovable') : tr('teamGrade.loggedStats')}</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 260 }}>
              {gameStats
                .filter(st => st.player_name === statsModalPlayer && st.is_opponent === (detailTab === 'opponent'))
                .length === 0 ? (
                <Text style={{ color: t.muted2, fontSize: 13, textAlign: 'center', paddingVertical: 20 }}>{tr('teamGrade.noStatsLogged')}</Text>
              ) : (
                gameStats
                  .filter(st => st.player_name === statsModalPlayer && st.is_opponent === (detailTab === 'opponent'))
                  .map(st => (
                    <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                                                borderBottomWidth: 1, borderBottomColor: t.chip }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3,
                                      backgroundColor: st.stat_category === 'offense' ? t.accent : t.accent, marginRight: 8 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: t.ink, fontSize: 13, fontFamily: fonts[600] }}>{st.stat_name}</Text>
                        <Text style={{ color: t.muted, fontSize: 11, marginTop: 1 }}>
                          {qLabel(st.quarter)}  ·  {st.weighted_points >= 0 ? '+' : ''}{st.weighted_points.toFixed(1)} {tr('teamGrade.ptsAbbr')}
                        </Text>
                      </View>
                      {isOwnedGame(detailGame) && (
                        <TouchableOpacity
                          style={{ padding: 8 }}
                          onPress={() =>
                            Alert.alert(tr('teamGrade.deleteStatTitle'), tr('teamGrade.deleteStatMsg', { stat: st.stat_name }), [
                              { text: tr('common.cancel'), style: 'cancel' },
                              { text: tr('common.delete'), style: 'destructive', onPress: () => deleteStatEntry(st.id) },
                            ])
                          }
                        >
                          <Ionicons name="trash-outline" size={18} color={t.negative} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))
              )}
            </ScrollView>

            <TouchableOpacity
              style={[s.modalBtn, { backgroundColor: t.line, marginTop: 12 }]}
              onPress={() => setShowStatsModal(false)}
            >
              <Text style={{ color: t.ink, fontFamily: fonts[700] }}>{tr('common.done')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Sheet>

      {/* Player grade detail (from leaderboard) */}
      <Sheet visible={gradeDetailPlayer !== null} transparent animationType="slide" onRequestClose={() => setGradeDetailPlayer(null)}>
        <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', paddingBottom: 24, borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(560) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: t.chip }}>
              <View>
                <Text style={{ color: t.ink, fontSize: 18, fontFamily: fonts[800] }}>{gradeDetailPlayer}</Text>
                <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{tr('teamGrade.gradeEarnedSub')}</Text>
              </View>
              <TouchableOpacity onPress={() => setGradeDetailPlayer(null)} style={{ padding: 4 }}>
                <Ionicons name="close" size={24} color={t.muted} />
              </TouchableOpacity>
            </View>

            {gradeDetailLoading ? (
              <ActivityIndicator color={t.accent} style={{ marginVertical: 32 }} />
            ) : gradeDetailData.length === 0 ? (
              <Text style={{ color: t.muted, textAlign: 'center', paddingVertical: 32, fontSize: 13 }}>{tr('teamGrade.noGameStatsPlayer')}</Text>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
                {/* Season average */}
                {(() => {
                  const avg = gradeDetailData.reduce((sum: number, g: any) => sum + (g.game_grade || 0), 0) / gradeDetailData.length;
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.chip, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.line }}>
                      <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[700] }}>{tr('teamGrade.seasonAvgGames', { count: gradeDetailData.length })}</Text>
                      <View style={s.gradeBadge}><Text style={s.gradeBadgeText}>{avg.toFixed(2)}</Text></View>
                    </View>
                  );
                })()}

                {gradeDetailData.map((g: any) => {
                  const won = g.our_score != null && g.our_score > g.opponent_score;
                  const lost = g.our_score != null && g.our_score < g.opponent_score;
                  const c: Record<string, number> = {};
                  for (const [name, d] of Object.entries(g.stat_breakdown as Record<string, any>)) c[name] = d.count;
                  const pts = (c['2 FG Made'] || 0) * 2 + (c['3 FG Made'] || 0) * 3 + (c['FT Made'] || 0);
                  const reb = (c['Off. Reb'] || 0) + (c['Def. Reb'] || 0);
                  const ast = c['Assists'] || 0, stl = c['Steal'] || 0, blk = c['Blocked Shot'] || 0, to = c['Turnover'] || 0;
                  const fgm = (c['2 FG Made'] || 0) + (c['3 FG Made'] || 0);
                  const fga = fgm + (c['2 FG Missed'] || 0) + (c['3 FG Missed'] || 0);
                  const entries = Object.entries(g.stat_breakdown as Record<string, any>);
                  return (
                    <View key={g.game_id} style={{ backgroundColor: t.chip, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.line }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: t.ink, fontSize: 15, fontFamily: fonts[700] }}>{matchupLabel(g)}</Text>
                          <Text style={{ color: t.muted, fontSize: 11, marginTop: 1 }}>
                            {g.date ?? ''}{g.our_score != null ? `  ·  ${won ? tr('teamGrade.winShort') : lost ? tr('teamGrade.lossShort') : tr('teamGrade.tieShort')} ${g.our_score}-${g.opponent_score}` : ''}  ·  {g.minutes}{tr('teamGrade.mAbbr')}
                          </Text>
                        </View>
                        <View style={s.gradeBadge}><Text style={s.gradeBadgeText}>{g.game_grade.toFixed(2)}</Text></View>
                      </View>

                      {/* Traditional stat line */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                        {[['PTS', pts], ['REB', reb], ['AST', ast], ['STL', stl], ['BLK', blk], ['TO', to], ['FG', fga > 0 ? `${fgm}/${fga}` : '—']].map(([label, val]) => (
                          <View key={label as string} style={{ alignItems: 'center', flex: 1 }}>
                            <Text style={{ color: t.muted, fontSize: 9, fontFamily: fonts[700] }}>{label}</Text>
                            <Text style={{ color: t.ink, fontSize: 13, fontFamily: fonts[800] }}>{val}</Text>
                          </View>
                        ))}
                      </View>

                      {/* Offense / Defense weighted contribution */}
                      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                        <View style={{ flex: 1, backgroundColor: t.chip, borderRadius: 8, padding: 8 }}>
                          <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700] }}>{tr('teamGrade.offensePts')}</Text>
                          <Text style={{ color: g.offensive_weighted >= 0 ? t.positive : t.negative, fontSize: 15, fontFamily: fonts[800] }}>
                            {g.offensive_weighted >= 0 ? '+' : ''}{g.offensive_weighted.toFixed(1)}
                          </Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: t.chip, borderRadius: 8, padding: 8 }}>
                          <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700] }}>{tr('teamGrade.defensePts')}</Text>
                          <Text style={{ color: g.defensive_weighted >= 0 ? t.positive : t.negative, fontSize: 15, fontFamily: fonts[800] }}>
                            {g.defensive_weighted >= 0 ? '+' : ''}{g.defensive_weighted.toFixed(1)}
                          </Text>
                        </View>
                      </View>

                      {/* Full stat breakdown — how the grade was built */}
                      <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700], marginBottom: 4, letterSpacing: 0.5 }}>{tr('teamGrade.statBreakdown')}</Text>
                      <View style={{ gap: 3 }}>
                        {entries.map(([name, d]: [string, any]) => (
                          <View key={name} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: t.muted, fontSize: 12 }}>{name}{d.count > 1 ? ` ×${d.count}` : ''}</Text>
                            <Text style={{ color: d.weighted_points >= 0 ? t.positive : t.negative, fontSize: 12, fontFamily: fonts[600] }}>
                              {d.weighted_points >= 0 ? '+' : ''}{d.weighted_points.toFixed(1)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Sheet>

      {/* Whiteboard */}
      <WhiteboardModal
        visible={whiteboardGameId !== null || whiteboardPlaybook}
        gameId={whiteboardGameId ?? 0}
        playbook={whiteboardPlaybook}
        onClose={() => { setWhiteboardGameId(null); setWhiteboardPlaybook(false); }}
      />

      {/* Share game with staff modal */}
      <Sheet visible={shareGameModalVisible} animationType="slide" transparent onRequestClose={() => setShareGameModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ backgroundColor: t.sheet, borderRadius: 20, padding: 20, maxHeight: '88%', margin: 8, borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(REPORT_MODAL_WIDTH) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: t.ink, fontSize: 18, fontFamily: fonts[800] }}>{tr('teamGrade.shareWithStaff')}</Text>
              <TouchableOpacity onPress={() => setShareGameModalVisible(false)}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: t.muted, fontSize: 12, marginBottom: 10 }}>{tr('teamGrade.shareGameHint')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <TextInput
                style={{ flex: 1, backgroundColor: t.chip, borderRadius: 10, padding: 12, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line }}
                placeholder={tr('teamGrade.searchStaffPlaceholder')}
                placeholderTextColor={t.muted2}
                value={staffSearch}
                onChangeText={setStaffSearch}
                onSubmitEditing={async () => {
                  if (!staffSearch.trim()) return;
                  setStaffSearching(true);
                  try {
                    const r = await staffSharingAPI.searchTargets(staffSearch.trim());
                    setStaffResults(r);
                  } catch {}
                  setStaffSearching(false);
                }}
                returnKeyType="search"
              />
              <TouchableOpacity
                style={{ backgroundColor: t.accent, borderRadius: 10, width: 44, alignItems: 'center', justifyContent: 'center' }}
                onPress={async () => {
                  if (!staffSearch.trim()) return;
                  setStaffSearching(true);
                  try {
                    const r = await staffSharingAPI.searchTargets(staffSearch.trim());
                    setStaffResults(r);
                  } catch {}
                  setStaffSearching(false);
                }}
                disabled={staffSearching}
              >
                {staffSearching ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="search" size={18} color={t.ctaText} />}
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: sheetScroll300 }}>
              {staffResults.map((staff: any, idx: number) => (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.chip, borderRadius: 10, padding: 12, marginBottom: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[700] }}>{staff.label ?? staff.name}</Text>
                    <Text style={{ color: t.muted, fontSize: 12 }}>{staff.sublabel ?? `${roleLabel(staff.role, tr)} · ${staff.program_name}`}</Text>
                  </View>
                  {staff.kind && staff.kind !== 'coach' && (
                    <Ionicons name="people" size={16} color={t.accent} style={{ marginRight: 8 }} />
                  )}
                  <TouchableOpacity
                    style={{ backgroundColor: t.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}
                    onPress={async () => {
                      if (!shareGameId) return;
                      setSharingStaff(true);
                      try {
                        const res = await staffSharingAPI.shareGroup({
                          report_type: 'game_session',
                          report_id: shareGameId,
                          kind: staff.kind ?? 'coach',
                          coach_id: staff.coach_id ?? undefined,
                          team_id: staff.team_id ?? undefined,
                          program_name: staff.program_name ?? undefined,
                          allow_regenerate: false,
                        });
                        setShareGameModalVisible(false);
                        Alert.alert(tr('teamGrade.sharedTitle'), tr('teamGrade.sharedGameMsg', { count: res.shared_count ?? 1 }));
                      } catch (e: any) {
                        Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('teamGrade.couldNotShare'));
                      } finally {
                        setSharingStaff(false);
                      }
                    }}
                    disabled={sharingStaff}
                  >
                    {sharingStaff ? <ActivityIndicator color={t.ctaText} size="small" /> : <Text style={{ color: t.ink, fontSize: 13, fontFamily: fonts[700] }}>{tr('common.share')}</Text>}
                  </TouchableOpacity>
                </View>
              ))}
              {staffResults.length === 0 && staffSearch.length > 0 && !staffSearching && (
                <Text style={{ color: t.muted2, textAlign: 'center', paddingVertical: 20 }}>{tr('teamGrade.noStaffFound')}</Text>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Sheet>
    </View>
    </PageContainer>
    </ScreenBackground>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeS = (t: ThemeTokens) => StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1, paddingHorizontal: 20, paddingVertical: 16 },
  topNav: {
    paddingTop: titleTopPad(56), paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  screenTitle: { color: t.ink, fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6, marginBottom: 12 },
  navBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: t.line,
    // Spacing comes from the row's gap, not a trailing margin on every chip.
    // With marginRight the LAST tab carried one too, so the row ended 24 from
    // the edge while it started at 16 — the four tabs looked pushed left for a
    // reason nothing on screen explained.
  },
  navBtnActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  navBtnText: { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  navBtnTextActive: { color: t.ctaText },
  card: {
    backgroundColor: t.card, borderRadius: 18, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: t.cardBorder,
  },
  cardLabel: {
    color: t.label, fontSize: 11, fontFamily: fonts[700],
    letterSpacing: 2, textTransform: 'uppercase',
  },
  bigStat: { color: t.ink, fontSize: 42, fontFamily: fonts[900], letterSpacing: -0.9 },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  leaderRank: { color: t.muted, fontSize: 13, width: 20, textAlign: 'center' },
  leaderName: { color: t.ink, fontSize: 14, fontFamily: fonts[600] },
  gradeBadge: {
    backgroundColor: t.accentSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: t.accent,
  },
  gradeBadgeText: { color: t.accent, fontSize: 12, fontFamily: fonts[700] },
  qHeaderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: 8, marginBottom: 2, borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  qPlayerHead: { flex: 1, color: t.muted, fontSize: 10, fontFamily: fonts[700], letterSpacing: 0.5 },
  qColHead: { width: 42, textAlign: 'center', color: t.muted, fontSize: 10, fontFamily: fonts[700] },
  qRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4 },
  qPlayerName: { flex: 1, color: t.ink, fontSize: 13, fontFamily: fonts[600] },
  qCell: { width: 42, textAlign: 'center', fontSize: 12, fontFamily: fonts[700] },
  qExpand: { backgroundColor: t.chip, borderRadius: 10, padding: 12, marginTop: 2, marginBottom: 6 },
  chip: {
    borderWidth: 1, borderColor: t.line, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 8, marginRight: 8,
  },
  chipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  chipText: { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  chipTextActive: { color: t.ctaText },
  // Sized to its action rather than to the page. Full-bleed, "New Game" became
  // a 1460px pill for two words and read as a banner instead of a button.
  newGameBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.ctaBg, borderRadius: 999, paddingVertical: 14, marginBottom: 16,
    ...desktopOnly({ paddingHorizontal: 28, alignSelf: 'flex-start', minWidth: 200 }),
  },
  newGameBtnText: { color: t.ctaText, fontSize: 15, fontFamily: fonts[700] },
  gameCard: {
    backgroundColor: t.card, borderRadius: 18, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: t.cardBorder,
    // Common floor so a card with a score badge is not taller than one
    // without, which left the rows ragged.
    ...desktopOnly({ minHeight: 88, marginBottom: 0 }),
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  gameCardOpponent: { color: t.ink, fontSize: 15, fontFamily: fonts[700] },
  wlBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  wlText: { fontSize: 11, fontFamily: fonts[700] },
  statusBadge: { backgroundColor: t.chip, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { color: t.muted, fontSize: 9, fontFamily: fonts[700] },
  scoreBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: t.card, paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  scoreNum: { color: t.ink, fontSize: 28, fontFamily: fonts[900], minWidth: 40, textAlign: 'center' },
  quarterRow: { flexGrow: 0 },
  clockBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8, gap: 10,
    borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  clockPeriodBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: t.chip, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
  },
  clockPeriodLabel: { color: t.ink, fontSize: 14, fontFamily: fonts[800] },
  clockDisplay: { color: t.ink, fontSize: 30, fontFamily: fonts[900], letterSpacing: 1, fontVariant: ['tabular-nums'] },
  clockRunBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
  },
  quarterBtn: {
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: t.line,
  },
  quarterBtnActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  quarterBtnText: { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  quarterBtnTextActive: { color: t.ctaText },
  // Wraps rather than squeezes. Four chips split across a phone leave about
  // 78px each, which is not enough for "Game Insights" or a team called Senegal
  // Lions — the labels came out as "Game Insig…" and the row stopped saying
  // what any of the tabs were.
  teamToggle: {
    flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  teamToggleBtn: {
    flexGrow: 1, flexBasis: 130, minWidth: 130,
    paddingVertical: 9, paddingHorizontal: 10, borderRadius: 999,
    borderWidth: 1, borderColor: t.line, alignItems: 'center',
  },
  teamToggleBtnActive: { backgroundColor: t.accentSoft, borderColor: t.accent },
  teamToggleText: { color: t.muted, fontSize: 13, fontFamily: fonts[600] },
  teamToggleTextActive: { color: t.accent, fontFamily: fonts[700] },
  sectionLabel: {
    color: t.label, fontSize: 11, fontFamily: fonts[700],
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8,
  },
  playerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  playerBtn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: t.line, backgroundColor: t.chip,
  },
  playerBtnActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  playerBtnText: { color: t.muted, fontSize: 12, fontFamily: fonts[600] },
  playerBtnTextActive: { color: t.ctaText },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statBtn: {
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: t.line, backgroundColor: t.chip,
  },
  statBtnFlash: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  statBtnText: { color: t.inkSoft, fontSize: 12, fontFamily: fonts[600] },
  smallInput: {
    backgroundColor: t.chip, borderRadius: 12, padding: 8,
    color: t.ink, fontSize: 13, borderWidth: 1, borderColor: t.line,
  },
  actionBtnLive: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 999, borderWidth: 1,
  },
  playerGradeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  playerGradeName: { color: t.ink, fontSize: 13, fontFamily: fonts[600], flex: 1 },
  expandedBox: {
    backgroundColor: t.chip, borderRadius: 12, padding: 12, marginBottom: 4,
  },
  detailAction: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: t.line,
    backgroundColor: t.chip,
  },
  modalOverlay: {
    flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, maxHeight: '85%', borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(560)},
  modalTitle: { color: t.ink, fontSize: 20, fontFamily: fonts[800], marginBottom: 20 },
  fieldLabel: {
    color: t.label, fontSize: 11, fontFamily: fonts[700],
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6,
  },
  input: {
    backgroundColor: t.chip, borderRadius: 14, padding: 12,
    color: t.ink, fontSize: 14, marginBottom: 16,
    borderWidth: 1, borderColor: t.line,
  },
  modalBtn: {
    paddingVertical: 13, borderRadius: 999, alignItems: 'center',
  },
});
