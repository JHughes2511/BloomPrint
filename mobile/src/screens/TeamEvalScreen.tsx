import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceTextInput from '../components/VoiceTextInput';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

import { gameEvalAPI, teamsAPI, playersAPI, staffSharingAPI, coachesAPI, importsAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { renderReport } from '../utils/renderReport';
import { GeneratingOverlay } from '../components/GeneratingBasketball';
import { buildReportHtml, buildPdfFileName } from '../utils/buildReportPdf';
import { formatForLevel, periodLabel, weightBucket, formatClock, type GameFormat } from '../utils/gameClock';
import WhiteboardModal from '../components/WhiteboardModal';
import ScoutContextPanel from '../components/ScoutContextPanel';
import GameReportPanel from '../components/GameReportPanel';
import ReportCorrectionsPanel from '../components/ReportCorrectionsPanel';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import DraggableWhiteboardButton from '../components/DraggableWhiteboardButton';
import { useSheetScrollHeight } from '../responsive/modalSizes';
import { CONTENT_MAX_WIDTH } from '../responsive/modalSizes';

// Highest competition level → lowest.
const COMPETITION_LEVELS = [
  'NBA', 'European Pro', 'G-League',
  'D1', 'D2', 'D3', 'JUCO',
  'International Academy', 'HS Varsity',
  '17U AAU', '16U AAU', '14U/15U AAU',
  'Youth (5-13)',
];

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

export default function TeamEvalScreen({ route, navigation }: any) {
  const { coach } = useAuth();
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
  const [loading, setLoading] = useState(true);
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
  const [detailTab, setDetailTab] = useState<'our' | 'opponent' | 'byquarter'>('our');
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [expandedQuarterPlayer, setExpandedQuarterPlayer] = useState<string | null>(null);
  // Team Grade player-grades list search
  const [showGradeSearch, setShowGradeSearch] = useState(false);
  const [gradeSearch, setGradeSearch] = useState('');
  const [generatingReport, setGeneratingReport] = useState(false);
  const [showScoutingReport, setShowScoutingReport] = useState(false);
  const [gameReportGame, setGameReportGame] = useState<any>(null);
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
  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadingDash(true);
    try {
      const [s, d, t] = await Promise.all([
        gameEvalAPI.listSessions(),
        gameEvalAPI.getSeasonDashboard(),
        teamsAPI.list(),
      ]);
      setSessions(s);
      setDashboard(d);
      setTeams(t);
    } catch {}
    setLoading(false);
    setLoadingDash(false);
  }, []);

  const loadDashboard = useCallback(async (phases: string[]) => {
    setLoadingDash(true);
    try {
      const params = phases.length > 0 ? { phases: phases.join(',') } : {};
      const d = await gameEvalAPI.getSeasonDashboard(params);
      setDashboard(d);
    } catch {}
    setLoadingDash(false);
  }, []);

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

  // AI stat import: any file → preview → confirm → commit.
  const importGameStats = async () => {
    if (!activeGame) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const f = res.assets[0];
      setImporting(true);
      const result = await importsAPI.gameStatsPreview(
        { uri: f.uri, name: f.name ?? 'boxscore', type: f.mimeType ?? 'application/octet-stream' },
      );
      const players = (result?.players ?? []).map((p: any) => ({ ...p, _include: true }));
      if (!players.length) {
        Alert.alert(tr('teamGrade.nothingFoundTitle'), tr('teamGrade.nothingFoundMsg'));
        return;
      }
      setStatPreview(players);
    } catch (e: any) {
      Alert.alert(tr('teamGrade.importErrorTitle'), e?.response?.data?.detail ?? tr('teamGrade.couldNotReadFile'));
    } finally {
      setImporting(false);
    }
  };

  const commitGameStats = async () => {
    if (!activeGame || !statPreview) return;
    const players = statPreview.filter((p: any) => p._include).map(({ _include, ...rest }: any) => rest);
    if (!players.length) { Alert.alert(tr('teamGrade.nothingSelectedTitle'), tr('teamGrade.nothingSelectedMsg')); return; }
    setImporting(true);
    try {
      const result = await importsAPI.gameStatsCommit({ game_id: activeGame.id, players });
      const stats = await gameEvalAPI.listStats(activeGame.id);
      setGameStats(stats);
      setStatPreview(null);
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
    // Load this opponent's saved roster (persisted by opponent name)
    try {
      const saved = await gameEvalAPI.listOpponentPlayers(game.opponent_name);
      setOpponentRoster(saved);
      setOpponentPlayers(saved.map((p: any) => p.player_name));
    } catch {
      setOpponentRoster([]);
      setOpponentPlayers([]);
    }
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
    } catch {
      // Don't block stat entry if the save fails — keep the name locally.
      setOpponentPlayers(prev => prev.includes(name) ? prev : [...prev, name]);
      setSelectedPlayer(name);
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
      // Persist after the state settles.
      setTimeout(() => {
        gameEvalAPI.updateSession(activeGame.id, {
          our_score: team === 'our' ? nextOur : ourScore,
          opponent_score: team === 'opp' ? nextOpp : oppScore,
        }).catch(() => {});
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

  const openDetail = async (game: any) => {
    setDetailGame(game);
    setActiveView('detail');
    setExpandedPlayer(null);
    setShowScoutingReport(false);
    setSummary(null);
    setGameStats([]);
    setGameLineup([]);
    setLoadingSummary(true);
    try {
      const [s, stats, lineup] = await Promise.all([
        gameEvalAPI.getGameSummary(game.id),
        gameEvalAPI.listStats(game.id),
        gameEvalAPI.getLineup(game.id),
      ]);
      setSummary(s);
      setGameStats(stats);
      setGameLineup(lineup);
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

  const isOwnedGame = (game: any) => !game || game.coach_id === coach?.id;

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
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('teamGrade.couldNotGenerateReport'));
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

  const exportDetailPdf = async () => {
    if (!summary || !detailGame) return;
    setExportingPdf(true);
    try {
      const gameDate = new Date(detailGame.date);
      const dateStr = gameDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const programName = coach?.program_name ?? 'Team';
      const result = detailGame.our_score != null
        ? `${detailGame.our_score > detailGame.opponent_score ? 'WIN' : 'LOSS'} ${detailGame.our_score}-${detailGame.opponent_score}`
        : 'Score N/A';
      const phase = detailGame.season_phase ? ` · ${detailGame.season_phase.charAt(0).toUpperCase() + detailGame.season_phase.slice(1)}` : '';
      const year = detailGame.season_year ? ` ${detailGame.season_year}` : '';

      let html: string;

      if (detailTab === 'byquarter') {
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
            <h1>Quarter Comparison — ${programName} vs ${detailGame.opponent_name}</h1>
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
        const grades = detailTab === 'our' ? summary.player_grades : summary.opponent_grades;
        const gradeText = grades.map((g: any) =>
          `${g.player_name}\nOFF ${g.offensive_grade.toFixed(2)}  ·  DEF ${g.defensive_grade.toFixed(2)}  ·  ${g.minutes_played.toFixed(0)} min  ·  Grade ${g.game_grade.toFixed(2)}`
        ).join('\n\n');

        const body = [
          `GAME SUMMARY`,
          `${programName} vs ${detailGame.opponent_name}`,
          `${dateStr}${phase}${year}  ·  ${result}`,
          `Team Grade: ${summary.team_grade.toFixed(2)}`,
          ``,
          `PLAYER GRADES`,
          gradeText,
        ].join('\n');

        html = buildReportHtml({
          title: `Game Report — ${programName} vs ${detailGame.opponent_name}`,
          subject: `${result}${phase}${year}`,
          date: dateStr,
          body,
        });
      }

      const fileName = buildPdfFileName(
        detailTab === 'byquarter' ? 'Quarter Report' : 'Game Report',
        `${programName} vs ${detailGame.opponent_name}${phase}`,
        gameDate,
      );
      const dest = (FileSystem.cacheDirectory ?? '') + fileName + '.pdf';
      const { uri } = await Print.printToFileAsync({ html });
      await FileSystem.copyAsync({ from: uri, to: dest });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: fileName });
      }
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
      const phase = detailGame.season_phase ?? '';
      const result = detailGame.our_score != null
        ? `${detailGame.our_score > detailGame.opponent_score ? 'WIN' : 'LOSS'} ${detailGame.our_score}-${detailGame.opponent_score}`
        : '';

      const meta = `"Game","${programName} vs ${detailGame.opponent_name}"\n"Date","${dateStr}"\n"Phase","${phase}"\n"Result","${result}"\n"Team Grade","${summary.team_grade.toFixed(2)}"\n\n`;

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
        const grades = detailTab === 'our' ? summary.player_grades : summary.opponent_grades;
        const header = 'Player,Offensive Grade,Defensive Grade,Minutes,Game Grade\n';
        const rows = grades.map((g: any) =>
          `"${g.player_name}",${g.offensive_grade.toFixed(2)},${g.defensive_grade.toFixed(2)},${g.minutes_played.toFixed(0)},${g.game_grade.toFixed(2)}`
        ).join('\n');
        csv = meta + header + rows;
      }

      const reportLabel = detailTab === 'byquarter' ? 'Quarter Report' : 'Game Report';
      const fileName = `${reportLabel} - ${programName} vs ${detailGame.opponent_name} - ${dateStr}.csv`.replace(/[^a-zA-Z0-9 \-_.]/g, '');
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

  const openScout = async (opponentName: string) => {
    setScoutOpponent(opponentName);
    setActiveView('scout');
    setScoutData(null);
    setScoutNotes([]);
    setNewNoteText('');
    setLoadingScout(true);
    setLoadingNotes(true);
    try {
      const [data, notes] = await Promise.all([
        gameEvalAPI.getOpponentProfile(opponentName),
        gameEvalAPI.getOpponentNotes(opponentName),
      ]);
      setScoutData(data);
      setScoutNotes(notes);
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
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('teamGrade.couldNotRegenerate'));
    }
    setRegeneratingScout(false);
  };

  // ── Unique opponents ──────────────────────────────────────────────────────────

  const uniqueOpponents = [...new Set(sessions.map((s: any) => s.opponent_name))];

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <ScreenBackground>
    <PageContainer>
    <View style={s.root}>
      {/* Top nav */}
      <View style={s.topNav}>
        <Text style={s.screenTitle}>{tr('common.tabs.teamGrade')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {(['dashboard', 'games', 'scout', 'gamereport'] as const).map(v => (
            <TouchableOpacity
              key={v}
              style={[s.navBtn, activeView === v && s.navBtnActive]}
              onPress={() => { if (v === 'gamereport') setGameReportGame(null); setActiveView(v); }}
            >
              <Text style={[s.navBtnText, activeView === v && s.navBtnTextActive]}>
                {v === 'dashboard' ? tr('teamGrade.views.dashboard') : v === 'games' ? tr('teamGrade.views.games') : v === 'scout' ? tr('teamGrade.views.scout') : tr('reportTypes.game_report')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Dashboard */}
      {activeView === 'dashboard' && (
        <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 100 }}>
          {/* Phase filter */}
          <View style={{ marginBottom: 16 }}>
            <Text style={[s.cardLabel, { marginBottom: 8 }]}>{tr('teamGrade.gradeView')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
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
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14 }}>
                      <Svg width={chartW} height={chartH + 48}>
                        <Line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke={t.divider} strokeWidth={1} />
                        {data.map((pt: any, i: number) => {
                          const x = gap + i * (barW + gap);
                          const h = Math.max((pt.team_grade / maxGrade) * (chartH - topPad), 6);
                          const y = chartH - h;
                          const won = pt.our_score != null && pt.opponent_score != null && pt.our_score > pt.opponent_score;
                          // Loss bars: fixed soft clay red (identical in light + dark),
                          // clearly visible but a notch less intense than the win green.
                          const barColor = won ? t.pistachio : '#D9987F';
                          const onTap = () => { const game = sessions.find(x => x.id === pt.game_id); if (game) openDetail(game); };
                          return (
                            <React.Fragment key={pt.game_id}>
                              <SvgText x={x + barW / 2} y={y - 6} fill={t.inkSoft} fontSize={10} fontWeight="800" textAnchor="middle">{pt.team_grade.toFixed(1)}</SvgText>
                              {/* onPress (release), not onPressIn — onPressIn fired on touch-down
                                  and hijacked every attempt to scroll the chart. */}
                              <Rect x={x} y={y} width={barW} height={h} rx={6} fill={barColor} onPress={onTap} />
                              <SvgText x={x + barW / 2} y={chartH + 16} fill={t.muted} fontSize={9} textAnchor="middle">{(pt.opponent ?? '').slice(0, 7)}</SvgText>
                              <SvgText x={x + barW / 2} y={chartH + 32} fill={won ? t.positive : t.negative} fontSize={10} fontWeight="800" textAnchor="middle">{won ? tr('teamGrade.winShort') : tr('teamGrade.lossShort')}</SvgText>
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
                  {dashboard.player_leaderboard.slice(0, 8).map((p: any, i: number) => (
                    <TouchableOpacity key={p.player_name} style={s.leaderRow} onPress={() => openGradeDetail(p.player_name)}>
                      <Text style={s.leaderRank}>{i + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={s.leaderName}>{p.player_name}</Text>
                        <Text style={{ color: t.muted, fontSize: 11 }}>
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
                <View style={[s.card, { alignItems: 'center', paddingVertical: 32 }]}>
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
          style={s.scroll}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={gamesRefreshing} onRefresh={async () => { setGamesRefreshing(true); await loadData(); setGamesRefreshing(false); }} tintColor={t.accent} />}
        >
          {/* Phase filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
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

          {/* New game button */}
          <TouchableOpacity style={s.newGameBtn} onPress={() => setShowNewGame(true)}>
            <Ionicons name="add-circle-outline" size={18} color={t.ctaText} />
            <Text style={s.newGameBtnText}>{tr('teamGrade.newGame')}</Text>
          </TouchableOpacity>

          {loading ? (
            <ActivityIndicator color={t.accent} style={{ marginTop: 24 }} />
          ) : filteredSessions.length === 0 ? (
            <View style={[s.card, { alignItems: 'center', paddingVertical: 32 }]}>
              <Ionicons name="basketball-outline" size={36} color={t.line} />
              <Text style={{ color: t.muted, fontSize: 13, marginTop: 10 }}>{tr('teamGrade.noGames')}</Text>
            </View>
          ) : (
            filteredSessions.map((game: any) => {
              const won = game.our_score != null && game.opponent_score != null && game.our_score > game.opponent_score;
              const hasScore = game.our_score != null;
              return (
                <TouchableOpacity
                  key={game.id}
                  style={s.gameCard}
                  onPress={() => (game.status === 'in_progress' && isOwnedGame(game)) ? openLiveEntry(game) : openDetail(game)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.gameCardOpponent}>{game.opponent_name}</Text>
                    <Text style={{ color: t.muted, fontSize: 11, marginTop: 2 }}>
                      {new Date(game.date).toLocaleDateString()} · {phaseLabel(game.season_phase)}
                      {game.location ? ` · ${game.location}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {hasScore ? (
                      <>
                        <View style={[s.wlBadge, { backgroundColor: won ? t.positiveSoft : t.negativeSoft }]}>
                          <Text style={[s.wlText, { color: won ? t.positive : t.negative }]}>
                            {won ? tr('teamGrade.winShort') : tr('teamGrade.lossShort')} {game.our_score}-{game.opponent_score}
                          </Text>
                        </View>
                      </>
                    ) : null}
                    <View style={[s.statusBadge, game.status === 'in_progress' && { backgroundColor: t.accentSoft }]}>
                      <Text style={[s.statusText, game.status === 'in_progress' && { color: t.accent }]}>
                        {game.status === 'in_progress' ? tr('teamGrade.statusInProgress') : tr('teamGrade.statusDone')}
                      </Text>
                    </View>
                  </View>
                  {isOwnedGame(game) ? (
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
                  ) : (
                    <View style={{ padding: 4 }}>
                      <Ionicons name="people-outline" size={15} color={t.muted2} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })
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
          {/* Score bar */}
          <View style={s.scoreBar}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700] }}>{tr('teamGrade.us')}</Text>
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
                {tr('teamGrade.vsOpponent', { opponent: activeGame.opponent_name })}
              </Text>
              <Text style={{ color: t.muted, fontSize: 11 }}>{periodLabel(gameFmt, periodIndex)}</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700] }}>{tr('teamGrade.them')}</Text>
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

          {/* Game clock + period controls */}
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

          {/* Period bucket — auto-follows the clock; tap to override */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.quarterRow} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 6, gap: 8, alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map(q => (
              <TouchableOpacity
                key={q}
                style={[s.quarterBtn, activeQuarter === q && s.quarterBtnActive]}
                onPress={() => setActiveQuarter(q)}
              >
                <Text style={[s.quarterBtnText, activeQuarter === q && s.quarterBtnTextActive]}>
                  {qLabel(q)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Clock edit modal */}
          <Modal visible={showClockEdit} transparent animationType="fade" onRequestClose={() => setShowClockEdit(false)}>
            <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'center', padding: 32 }}>
              <View style={{ backgroundColor: t.sheet, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: t.cardBorder, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
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
          </Modal>

          {/* Team toggle */}
          <View style={s.teamToggle}>
            <TouchableOpacity
              style={[s.teamToggleBtn, entryMode === 'our' && s.teamToggleBtnActive]}
              onPress={() => { setEntryMode('our'); setSelectedPlayer(null); }}
            >
              <Text style={[s.teamToggleText, entryMode === 'our' && s.teamToggleTextActive]}>{tr('teamGrade.ourTeam')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.teamToggleBtn, entryMode === 'opponent' && s.teamToggleBtnActive]}
              onPress={() => { setEntryMode('opponent'); setSelectedPlayer(null); }}
            >
              <Text style={[s.teamToggleText, entryMode === 'opponent' && s.teamToggleTextActive]}>{tr('teamGrade.opponent')}</Text>
            </TouchableOpacity>
          </View>

          <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
            {/* Post-game import */}
            {activeGame.tracking_mode === 'post' && (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accentSoft, borderWidth: 1, borderColor: t.accent, borderRadius: 12, paddingVertical: 13, marginBottom: 16 }}
                onPress={importGameStats}
                disabled={importing}
              >
                {importing
                  ? <ActivityIndicator color={t.accent} />
                  : <><Ionicons name="cloud-upload-outline" size={18} color={t.accent} /><Text style={{ color: t.accent, fontFamily: fonts[800], fontSize: 14 }}>{entryMode === 'opponent' ? tr('teamGrade.importOpponentBoxScore') : tr('teamGrade.importBoxScore')}</Text></>}
              </TouchableOpacity>
            )}

            {/* Player grid */}
            <Text style={s.sectionLabel}>{tr('teamGrade.selectPlayer')}</Text>
            <View style={s.playerGrid}>
              {entryMode === 'our' ? (
                roster.length > 0 ? roster.map((p: any) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[s.playerBtn, selectedPlayer === p.name && s.playerBtnActive]}
                    onPress={() => setSelectedPlayer(p.name)}
                  >
                    <Text style={[s.playerBtnText, selectedPlayer === p.name && s.playerBtnTextActive]} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                )) : (
                  <Text style={{ color: t.muted, fontSize: 12, padding: 8 }}>{tr('teamGrade.noRoster')}</Text>
                )
              ) : (
                <>
                  {opponentRoster.map((p: any) => (
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
                  <View style={{ width: '100%', flexDirection: 'row', gap: 6, marginTop: 4 }}>
                    <VoiceTextInput
                      style={[s.smallInput, { flex: 1 }]}
                      placeholder={tr('teamGrade.opponentPlayerNamePlaceholder')}
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
                      onPress={addOpponentPlayer}
                    >
                      <Ionicons name="add" size={16} color={t.muted} />
                    </TouchableOpacity>
                  </View>
                </>
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

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
              <TouchableOpacity
                style={[s.actionBtnLive, { flex: 1, borderColor: t.line }]}
                onPress={() => setShowLineupModal(true)}
              >
                <Ionicons name="people-outline" size={16} color={t.muted} />
                <Text style={{ color: t.muted, fontFamily: fonts[600], fontSize: 13 }}>{tr('teamGrade.lineup')}</Text>
              </TouchableOpacity>
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
        <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 100 }}>
          {/* Header */}
          <View style={s.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 22, fontFamily: fonts[900] }}>{tr('teamGrade.vsOpponent', { opponent: detailGame.opponent_name })}</Text>
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
              </View>
              {detailGame.our_score != null && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: t.ink, fontSize: 28, fontFamily: fonts[900] }}>
                    {detailGame.our_score} - {detailGame.opponent_score}
                  </Text>
                  <View style={[s.wlBadge, {
                    backgroundColor: detailGame.our_score > detailGame.opponent_score ? t.positiveSoft : t.negativeSoft
                  }]}>
                    <Text style={[s.wlText, { color: detailGame.our_score > detailGame.opponent_score ? t.positive : t.negative }]}>
                      {detailGame.our_score > detailGame.opponent_score ? tr('teamGrade.win') : tr('teamGrade.loss')}
                    </Text>
                  </View>
                </View>
              )}
            </View>
            {summary && (
              <View style={{ marginTop: 16, alignItems: 'center' }}>
                <Text style={s.cardLabel}>{tr('teamGrade.teamGradeLabel')}</Text>
                <Text style={{ color: t.accent, fontSize: 40, fontFamily: fonts[900], marginTop: 4 }}>
                  {summary.team_grade.toFixed(2)}
                </Text>
              </View>
            )}
          </View>

          {/* Detail tabs */}
          <View style={[s.teamToggle, { borderBottomWidth: 0 }]}>
            <TouchableOpacity
              style={[s.teamToggleBtn, detailTab === 'our' && s.teamToggleBtnActive]}
              onPress={() => setDetailTab('our')}
            >
              <Text style={[s.teamToggleText, detailTab === 'our' && s.teamToggleTextActive]}>{tr('teamGrade.ourTeam')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.teamToggleBtn, detailTab === 'opponent' && s.teamToggleBtnActive]}
              onPress={() => setDetailTab('opponent')}
            >
              <Text style={[s.teamToggleText, detailTab === 'opponent' && s.teamToggleTextActive]}>{tr('teamGrade.opponent')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.teamToggleBtn, detailTab === 'byquarter' && s.teamToggleBtnActive]}
              onPress={() => setDetailTab('byquarter')}
            >
              <Text style={[s.teamToggleText, detailTab === 'byquarter' && s.teamToggleTextActive]}>{tr('teamGrade.byQuarter')}</Text>
            </TouchableOpacity>
          </View>

          {detailTab === 'byquarter' && (() => {
            const ourStats = gameStats.filter((st: any) => !st.is_opponent);
            if (ourStats.length === 0) return (
              <View style={s.card}>
                <Text style={{ color: t.muted, textAlign: 'center', fontSize: 13 }}>{tr('teamGrade.noStatsLogged')}</Text>
              </View>
            );
            // Build player -> quarter -> { weighted, counts, list }
            const qSet = new Set<number>();
            const players: Record<string, { total: number; quarters: Record<number, { weighted: number; counts: Record<string, number>; list: any[] }> }> = {};
            for (const st of ourStats) {
              qSet.add(st.quarter);
              if (!players[st.player_name]) players[st.player_name] = { total: 0, quarters: {} };
              const P = players[st.player_name];
              if (!P.quarters[st.quarter]) P.quarters[st.quarter] = { weighted: 0, counts: {}, list: [] };
              const Q = P.quarters[st.quarter];
              Q.weighted += st.weighted_points;
              Q.counts[st.stat_name] = (Q.counts[st.stat_name] || 0) + (st.count || 1);
              Q.list.push(st);
              P.total += st.weighted_points;
            }
            const qNums = Array.from(qSet).sort((a, b) => a - b);
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
                  {tr('teamGrade.quarterComparisonHint')}
                </Text>

                {/* Header */}
                <View style={s.qHeaderRow}>
                  <Text style={s.qPlayerHead}>{tr('teamGrade.playerHead')}</Text>
                  {qNums.map(q => <Text key={q} style={s.qColHead}>{qLabel(q)}</Text>)}
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
                          <Text style={s.qPlayerName} numberOfLines={1}>{name}</Text>
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
                                  <Text style={{ color: t.accent, fontSize: 11, fontFamily: fonts[800], letterSpacing: 0.5 }}>{qLabel(q)}</Text>
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
          {detailTab !== 'byquarter' && loadingSummary ? (
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
              {(detailTab === 'our' ? summary.player_grades : summary.opponent_grades)
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
                    <Text style={s.playerGradeName} numberOfLines={1}>{g.player_name}</Text>
                    <Text style={{ color: t.muted, fontSize: 11 }}>{tr('teamGrade.offLabel')} {g.offensive_grade.toFixed(1)}</Text>
                    <Text style={{ color: t.muted, fontSize: 11 }}>{tr('teamGrade.defLabel')} {g.defensive_grade.toFixed(1)}</Text>
                    <Text style={{ color: t.muted, fontSize: 11 }}>{g.minutes_played.toFixed(0)}{tr('teamGrade.mAbbr')}</Text>
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
                          {tr('teamGrade.offDefMin', { off: g.offensive_grade.toFixed(1), def: g.defensive_grade.toFixed(1), min: g.minutes_played.toFixed(0) })}
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
              {(detailTab === 'our' ? summary.player_grades : summary.opponent_grades).length === 0 && (
                <Text style={{ color: t.muted2, fontSize: 13, textAlign: 'center', paddingVertical: 12 }}>{tr('teamGrade.noStatsLogged')}</Text>
              )}
              {(detailTab === 'our' ? summary.player_grades : summary.opponent_grades).length > 0 &&
                gradeSearch.trim() !== '' &&
                (detailTab === 'our' ? summary.player_grades : summary.opponent_grades)
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
              <Text style={s.cardLabel}>{tr('teamGrade.scoutingReport')}</Text>
              <View style={{ marginTop: 8 }}>
                {renderReport(detailGame.ai_scouting_report ?? '', { heading: t.ink, body: t.inkSoft })}
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* Opponent Scout */}
      {activeView === 'scout' && (
        <KeyboardAwareScrollView ref={scoutScrollRef} style={s.scroll} contentContainerStyle={{ paddingBottom: 100, paddingTop: 8 }}>
          {/* Opponent selector */}
          {!scoutOpponent ? (
            <>
              <Text style={[s.cardLabel, { marginBottom: 10 }]}>{tr('teamGrade.selectOpponent')}</Text>
              {uniqueOpponents.length === 0 ? (
                <View style={[s.card, { alignItems: 'center', paddingVertical: 32 }]}>
                  <Text style={{ color: t.muted, fontSize: 13 }}>{tr('teamGrade.noOpponents')}</Text>
                </View>
              ) : (
                uniqueOpponents.map(opp => (
                  <TouchableOpacity key={opp} style={s.gameCard} onPress={() => openScout(opp)}>
                    <Text style={s.gameCardOpponent}>{opp}</Text>
                    <Text style={{ color: t.muted, fontSize: 12 }}>
                      {tr('teamGrade.gamesCount', { count: sessions.filter((x: any) => x.opponent_name === opp).length })}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={t.line} />
                  </TouchableOpacity>
                ))
              )}
            </>
          ) : (
            <>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}
                onPress={() => { setScoutOpponent(null); setScoutData(null); }}
              >
                <Ionicons name="arrow-back" size={18} color={t.muted} />
                <Text style={{ color: t.muted, fontSize: 14 }}>{tr('teamGrade.allOpponents')}</Text>
              </TouchableOpacity>

              <Text style={{ color: t.ink, fontSize: 22, fontFamily: fonts[900], marginBottom: 4 }}>{scoutOpponent}</Text>

              {loadingScout ? (
                <ActivityIndicator color={t.accent} style={{ marginTop: 24 }} />
              ) : scoutData ? (
                <>
                  {/* Record vs this opponent */}
                  <View style={s.card}>
                    <Text style={s.cardLabel}>{tr('teamGrade.gamesAgainst')}</Text>
                    {scoutData.games_played_against.map((g: any) => {
                      const won = g.our_score != null && g.opponent_score != null && g.our_score > g.opponent_score;
                      return (
                        <View key={g.id} style={s.leaderRow}>
                          <Text style={{ color: t.muted, fontSize: 12, width: 80 }}>
                            {g.date ? new Date(g.date).toLocaleDateString() : tr('teamGrade.na')}
                          </Text>
                          <Text style={{ flex: 1, color: t.inkSoft, fontSize: 13 }}>
                            {g.our_score != null ? `${g.our_score} - ${g.opponent_score}` : tr('teamGrade.noScore')}
                          </Text>
                          {g.our_score != null && (
                            <View style={[s.wlBadge, { backgroundColor: won ? t.positiveSoft : t.negativeSoft }]}>
                              <Text style={[s.wlText, { color: won ? t.positive : t.negative }]}>{won ? tr('teamGrade.winShort') : tr('teamGrade.lossShort')}</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>

                  {/* Best players */}
                  {scoutData.best_players.length > 0 && (
                    <View style={s.card}>
                      <Text style={s.cardLabel}>{tr('teamGrade.theirTopPlayers')}</Text>
                      {scoutData.best_players.map((p: any) => (
                        <View key={p.player_name} style={s.leaderRow}>
                          <Text style={{ flex: 1, color: t.inkSoft, fontSize: 13 }}>{p.player_name}</Text>
                          <Text style={{ color: t.muted, fontSize: 11 }}>{tr('teamGrade.gamesG', { count: p.games })}</Text>
                          <View style={s.gradeBadge}>
                            <Text style={s.gradeBadgeText}>{p.avg_grade.toFixed(2)}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Tendencies */}
                  <View style={s.card}>
                    <Text style={s.cardLabel}>{tr('teamGrade.offensiveTendencies')}</Text>
                    {scoutData.offensive_tendencies.map((td: any) => (
                      <Text key={td.stat} style={{ color: t.inkSoft, fontSize: 13, marginBottom: 4 }}>
                        {tr('teamGrade.tendencyItem', { stat: td.stat, count: td.count })}
                      </Text>
                    ))}
                    <Text style={[s.cardLabel, { marginTop: 12 }]}>{tr('teamGrade.defensiveTendencies')}</Text>
                    {scoutData.defensive_tendencies.map((td: any) => (
                      <Text key={td.stat} style={{ color: t.inkSoft, fontSize: 13, marginBottom: 4 }}>
                        {tr('teamGrade.tendencyItem', { stat: td.stat, count: td.count })}
                      </Text>
                    ))}
                    <Text style={[s.cardLabel, { marginTop: 12 }]}>{tr('teamGrade.weakSpots')}</Text>
                    {scoutData.weak_spots.map((td: any) => (
                      <Text key={td.stat} style={{ color: t.inkSoft, fontSize: 13, marginBottom: 4 }}>
                        {tr('teamGrade.weakSpotItem', { stat: td.stat, score: td.score.toFixed(1) })}
                      </Text>
                    ))}
                  </View>

                  {/* Scouting context — add context + generate/regenerate */}
                  <View style={s.card} onLayout={e => { noteInputY.current = e.nativeEvent.layout.y; }}>
                    <Text style={s.cardLabel}>{tr('teamGrade.scoutingContext')}</Text>
                    {(() => {
                      const scoutGameId = sessions.find((x: any) => x.opponent_name === scoutOpponent)?.id;
                      return scoutGameId ? (
                        <ScoutContextPanel
                          gameId={scoutGameId}
                          opponentName={scoutOpponent ?? undefined}
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
                        <Text style={s.cardLabel}>{tr('teamGrade.scoutingReport')}</Text>
                        <View style={{ marginTop: 8 }}>
                          {renderReport(scoutData.ai_scouting_report, { heading: t.ink, body: t.inkSoft })}
                        </View>
                      </View>

                      {/* Corrections — a separate pass to fix things in the finished report. */}
                      {(() => {
                        const scoutGameId = sessions.find((x: any) => x.opponent_name === scoutOpponent)?.id;
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
        <KeyboardAwareScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 100, paddingTop: 8 }}>
          {!gameReportGame ? (
            <>
              <Text style={{ color: t.ink, fontSize: 22, fontFamily: fonts[900], marginHorizontal: 16, marginBottom: 4 }}>{tr('reportTypes.game_report')}</Text>
              <Text style={{ color: t.muted2, fontSize: 13, marginHorizontal: 16, marginBottom: 12 }}>
                {tr('teamGrade.gameReportPickHint')}
              </Text>
              {sessions.length === 0 && (
                <Text style={{ color: t.muted2, fontSize: 13, marginHorizontal: 16 }}>{tr('teamGrade.noGamesYet')}</Text>
              )}
              {sessions.map((g: any) => {
                const won = g.our_score != null && g.opponent_score != null && g.our_score > g.opponent_score;
                return (
                  <TouchableOpacity key={g.id} style={s.gameCard} onPress={() => openGameReport(g)}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.ink, fontSize: 15, fontFamily: fonts[700] }}>{tr('teamGrade.vsOpponent', { opponent: g.opponent_name })}</Text>
                      <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>
                        {g.date ? new Date(g.date).toLocaleDateString() : ''}
                        {g.our_score != null ? `  ·  ${g.our_score}-${g.opponent_score}` : ''}
                        {g.ai_game_report ? `  ·  ${tr('teamGrade.reportReady')}` : ''}
                      </Text>
                    </View>
                    {g.our_score != null && (
                      <View style={[s.wlBadge, { backgroundColor: won ? t.positiveSoft : t.negativeSoft }]}>
                        <Text style={[s.wlText, { color: won ? t.positive : t.negative }]}>{won ? 'W' : 'L'}</Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={18} color={t.muted} />
                  </TouchableOpacity>
                );
              })}
            </>
          ) : (
            <>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16, marginBottom: 8 }}
                onPress={() => setGameReportGame(null)}
              >
                <Ionicons name="arrow-back" size={18} color={t.muted} />
                <Text style={{ color: t.muted, fontSize: 14 }}>{tr('teamGrade.allGames')}</Text>
              </TouchableOpacity>

              <Text style={{ color: t.ink, fontSize: 22, fontFamily: fonts[900], marginHorizontal: 16, marginBottom: 2 }}>
                {tr('teamGrade.vsOpponent', { opponent: gameReportGame.opponent_name })}
              </Text>
              <Text style={{ color: t.muted2, fontSize: 13, marginHorizontal: 16, marginBottom: 12 }}>
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
                        hasReport={!!gameReportGame.ai_game_report}
                        onRegenerated={(text) => setGameReportGame((prev: any) => ({ ...prev, ai_game_report: text }))}
                      />
                    </View>
                  </View>

                  {gameReportGame.ai_game_report ? (
                    <>
                      <View style={s.card}>
                        <Text style={s.cardLabel}>{tr('teamGrade.gameReportLabel')}</Text>
                        <View style={{ marginTop: 8 }}>
                          {renderReport(gameReportGame.ai_game_report, { heading: t.ink, body: t.inkSoft })}
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
                    <Text style={{ color: t.muted2, fontSize: 13, marginHorizontal: 16 }}>
                      {tr('teamGrade.noReportYet')}
                    </Text>
                  )}
                </>
              )}
            </>
          )}
        </KeyboardAwareScrollView>
      )}

      {/* Imported stats preview — confirm before committing */}
      <Modal visible={!!statPreview} transparent animationType="slide" onRequestClose={() => setStatPreview(null)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxHeight: '85%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={s.modalTitle}>{tr('teamGrade.reviewImportedStats')}</Text>
              <TouchableOpacity onPress={() => setStatPreview(null)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
            </View>
            <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 10 }}>
              {tr('teamGrade.importPreviewHint')}
            </Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {(statPreview ?? []).map((p: any, i: number) => (
                <TouchableOpacity
                  key={i}
                  style={{ backgroundColor: t.card, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: p._include ? t.accent : t.line, opacity: p._include ? 1 : 0.5 }}
                  onPress={() => setStatPreview(prev => prev!.map((x, xi) => xi === i ? { ...x, _include: !x._include } : x))}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name={p._include ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={p._include ? t.accent : t.muted} />
                    <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[700], flex: 1 }}>{p.player_name}</Text>
                    {p.is_opponent && <Text style={{ color: t.negative, fontSize: 10, fontFamily: fonts[700] }}>{tr('teamGrade.opp')}</Text>}
                  </View>
                  <Text style={{ color: t.muted2, fontSize: 11, marginTop: 4 }}>
                    {Object.entries(p.stats ?? {}).map(([k, v]) => `${k}: ${v}`).join('  ·  ') || tr('teamGrade.noStatsRead')}
                  </Text>
                </TouchableOpacity>
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
      </Modal>

      {/* New Game Modal */}
      <Modal visible={showNewGame} transparent animationType="slide">
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[s.modalBox, { maxHeight: '85%' }]}>
            <Text style={s.modalTitle}>{tr('teamGrade.newGame')}</Text>
            <KeyboardAwareScrollView>
              <>
                <Text style={s.fieldLabel}>{tr('teamGrade.teamOptional')}</Text>
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
              </>
              <Text style={s.fieldLabel}>{tr('teamGrade.opponentName')}</Text>
              <VoiceTextInput
                style={s.input}
                placeholder={tr('teamGrade.opponentPlaceholder')}
                placeholderTextColor={t.muted2}
                value={newGameOpponent}
                onChangeText={setNewGameOpponent}
              />
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
      </Modal>

      {/* Lineup Modal */}
      <Modal visible={showLineupModal} transparent animationType="slide">
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
      </Modal>

      {/* Player Detail Modal */}
      <Modal visible={showDetailModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxHeight: '90%' }]}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 18, fontFamily: fonts[900] }}>{detailModalPlayer}</Text>
                {summary && (() => {
                  const grades = detailTab === 'our' ? summary.player_grades : summary.opponent_grades;
                  const pg = grades.find((g: any) => g.player_name === detailModalPlayer);
                  if (!pg) return null;
                  return (
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                      <Text style={{ color: t.muted, fontSize: 12 }}>{tr('teamGrade.offLabel')} <Text style={{ color: t.accent, fontFamily: fonts[700] }}>{pg.offensive_grade.toFixed(2)}</Text></Text>
                      <Text style={{ color: t.muted, fontSize: 12 }}>{tr('teamGrade.defLabel')} <Text style={{ color: t.accent, fontFamily: fonts[700] }}>{pg.defensive_grade.toFixed(2)}</Text></Text>
                      <Text style={{ color: t.muted, fontSize: 12 }}>{pg.minutes_played.toFixed(0)} {tr('teamGrade.minAbbr')}</Text>
                    </View>
                  );
                })()}
              </View>
              {summary && (() => {
                const grades = detailTab === 'our' ? summary.player_grades : summary.opponent_grades;
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
      </Modal>

      {/* Player Stats Edit Modal */}
      <Modal visible={showStatsModal} transparent animationType="slide">
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
      </Modal>

      {/* Player grade detail (from leaderboard) */}
      <Modal visible={gradeDetailPlayer !== null} transparent animationType="slide" onRequestClose={() => setGradeDetailPlayer(null)}>
        <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', paddingBottom: 24, borderWidth: 1, borderColor: t.cardBorder, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
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
                          <Text style={{ color: t.ink, fontSize: 15, fontFamily: fonts[700] }}>{tr('teamGrade.vsOpponent', { opponent: g.opponent_name })}</Text>
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
      </Modal>

      {/* Whiteboard */}
      <WhiteboardModal
        visible={whiteboardGameId !== null || whiteboardPlaybook}
        gameId={whiteboardGameId ?? 0}
        playbook={whiteboardPlaybook}
        onClose={() => { setWhiteboardGameId(null); setWhiteboardPlaybook(false); }}
      />

      {/* Share game with staff modal */}
      <Modal visible={shareGameModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ backgroundColor: t.sheet, borderRadius: 20, padding: 20, maxHeight: '88%', margin: 8, borderWidth: 1, borderColor: t.cardBorder, width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' }}>
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
                    <Text style={{ color: t.muted, fontSize: 12 }}>{staff.sublabel ?? `${staff.role} · ${staff.program_name}`}</Text>
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
      </Modal>
    </View>
    </PageContainer>
    </ScreenBackground>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeS = (t: ThemeTokens) => StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1, padding: 16 },
  topNav: {
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  screenTitle: { color: t.ink, fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6, marginBottom: 12 },
  navBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: t.line, marginRight: 8,
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
    paddingHorizontal: 28, alignSelf: 'flex-start', minWidth: 200,
  },
  newGameBtnText: { color: t.ctaText, fontSize: 15, fontFamily: fonts[700] },
  gameCard: {
    backgroundColor: t.card, borderRadius: 18, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: t.cardBorder,
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
  teamToggle: {
    flexDirection: 'row', padding: 12, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  teamToggleBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 999,
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
    padding: 24, maxHeight: '85%', borderWidth: 1, borderColor: t.cardBorder, width: '100%', maxWidth: 560, alignSelf: 'center'},
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
