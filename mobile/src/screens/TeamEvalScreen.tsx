import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { gameEvalAPI, teamsAPI, playersAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { renderReport } from '../utils/renderReport';
import { buildReportHtml, buildPdfFileName } from '../utils/buildReportPdf';

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

type View = 'dashboard' | 'games' | 'live' | 'detail' | 'scout';

export default function TeamEvalScreen() {
  const { coach } = useAuth();
  const [activeView, setActiveView] = useState<View>('dashboard');
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
  const [teams, setTeams] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

  // Live entry state
  const [activeGame, setActiveGame] = useState<any | null>(null);
  const [activeQuarter, setActiveQuarter] = useState(1);
  const [entryMode, setEntryMode] = useState<'our' | 'opponent'>('our');
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [roster, setRoster] = useState<any[]>([]);
  const [opponentPlayers, setOpponentPlayers] = useState<string[]>([]);
  const [newOppPlayer, setNewOppPlayer] = useState('');
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
  const [detailTab, setDetailTab] = useState<'our' | 'opponent'>('our');
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [showScoutingReport, setShowScoutingReport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [gameStats, setGameStats] = useState<any[]>([]);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [statsModalPlayer, setStatsModalPlayer] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailModalPlayer, setDetailModalPlayer] = useState<string | null>(null);
  const [gameLineup, setGameLineup] = useState<any[]>([]);
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
      const g = await gameEvalAPI.createSession({
        opponent_name: newGameOpponent.trim(),
        location: newGameLocation.trim() || undefined,
        season_phase: newGamePhase,
        season_year: newGameYear.trim() || undefined,
        team_id: newGameTeamId ?? undefined,
      });
      setSessions(prev => [g, ...prev]);
      setShowNewGame(false);
      setNewGameOpponent('');
      setNewGameLocation('');
      setNewGameYear('');
      setNewGameTeamId(null);
      // Open live entry
      openLiveEntry(g);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not create game');
    }
    setCreating(false);
  };

  // ── Live entry ───────────────────────────────────────────────────────────────

  const openLiveEntry = async (game: any) => {
    setActiveGame(game);
    setOurScore(game.our_score ?? 0);
    setOppScore(game.opponent_score ?? 0);
    setActiveQuarter(1);
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
  };

  const SCORE_DELTA: Record<string, number> = {
    '2 FG Made': 2, '3 FG Made': 3, 'FT Made': 1,
  };

  const logStat = async (statName: string) => {
    if (!activeGame || !selectedPlayer) {
      Alert.alert('Select Player', 'Tap a player first, then select a stat.');
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
      setStatToast(`✓  ${selectedPlayer} — ${statName}`);
      setTimeout(() => { setFlashStat(null); setStatToast(null); }, 1200);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not log stat');
    }
  };

  const updateScore = async (team: 'our' | 'opp', delta: number) => {
    const newOur = team === 'our' ? ourScore + delta : ourScore;
    const newOpp = team === 'opp' ? oppScore + delta : oppScore;
    setOurScore(newOur);
    setOppScore(newOpp);
    if (activeGame) {
      try {
        await gameEvalAPI.updateSession(activeGame.id, {
          our_score: newOur,
          opponent_score: newOpp,
        });
      } catch {}
    }
  };

  const endGame = async () => {
    if (!activeGame) return;
    Alert.alert('End Game', 'Mark this game as completed?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End Game', style: 'default', onPress: async () => {
          try {
            const updated = await gameEvalAPI.updateSession(activeGame.id, { status: 'completed' });
            setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
            // Refresh dashboard so new game shows immediately
            gameEvalAPI.getSeasonDashboard().then(setDashboard).catch(() => {});
            openDetail(updated);
          } catch (e: any) {
            Alert.alert('Error', e?.response?.data?.detail ?? 'Could not end game');
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
      Alert.alert('Error', 'Could not delete stat');
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
      Alert.alert('Error', 'Could not add stat');
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
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not generate report');
    }
    setGeneratingReport(false);
  };

  const exportDetailPdf = async () => {
    if (!summary || !detailGame) return;
    setExporting(true);
    try {
      const gameDate = new Date(detailGame.date);
      const dateStr = gameDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const programName = coach?.program_name ?? 'Team';
      const result = detailGame.our_score != null
        ? `${detailGame.our_score > detailGame.opponent_score ? 'WIN' : 'LOSS'} ${detailGame.our_score}-${detailGame.opponent_score}`
        : 'Score N/A';
      const phase = detailGame.season_phase ? ` · ${detailGame.season_phase.charAt(0).toUpperCase() + detailGame.season_phase.slice(1)}` : '';
      const year = detailGame.season_year ? ` ${detailGame.season_year}` : '';

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

      const html = buildReportHtml({
        title: `Game Report — ${programName} vs ${detailGame.opponent_name}`,
        subject: `${result}${phase}${year}`,
        date: dateStr,
        body,
      });

      const fileName = buildPdfFileName(
        `Game Report - ${programName} vs ${detailGame.opponent_name}`,
        result,
        gameDate,
      );
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fileName });
      }
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Could not export');
    }
    setExporting(false);
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
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not load scout data');
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
      Alert.alert('Error', 'Could not save note');
    }
    setSavingNote(false);
  };

  const deleteOpponentNote = async (noteId: number) => {
    try {
      await gameEvalAPI.deleteOpponentNote(noteId);
      setScoutNotes(prev => prev.filter(n => n.id !== noteId));
    } catch {
      Alert.alert('Error', 'Could not delete note');
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
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not regenerate');
    }
    setRegeneratingScout(false);
  };

  // ── Unique opponents ──────────────────────────────────────────────────────────

  const uniqueOpponents = [...new Set(sessions.map((s: any) => s.opponent_name))];

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <View style={s.root}>
      {/* Top nav */}
      <View style={s.topNav}>
        <Text style={s.screenTitle}>Team Eval</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {(['dashboard', 'games', 'scout'] as const).map(v => (
            <TouchableOpacity
              key={v}
              style={[s.navBtn, activeView === v && s.navBtnActive]}
              onPress={() => setActiveView(v)}
            >
              <Text style={[s.navBtnText, activeView === v && s.navBtnTextActive]}>
                {v === 'dashboard' ? 'Dashboard' : v === 'games' ? 'Games' : 'Scout'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Dashboard */}
      {activeView === 'dashboard' && (
        <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 60 }}>
          {/* Phase filter */}
          <View style={{ marginBottom: 16 }}>
            <Text style={[s.cardLabel, { marginBottom: 8 }]}>GRADE VIEW</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {['preseason', 'regular', 'playoff', 'tournament'].map(phase => {
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
                        {phase.charAt(0).toUpperCase() + phase.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {dashPhases.length > 0 && (
                  <TouchableOpacity
                    style={[s.chip, { borderColor: '#dc2626' }]}
                    onPress={() => { setDashPhases([]); loadDashboard([]); }}
                  >
                    <Text style={[s.chipText, { color: '#dc2626' }]}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
            {dashPhases.length > 0 && (
              <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 6 }}>
                Showing: {dashPhases.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' + ')}
              </Text>
            )}
          </View>
          {loadingDash ? (
            <ActivityIndicator color="#7c3aed" style={{ marginTop: 40 }} />
          ) : dashboard ? (
            <>
              {/* Record card */}
              <View style={s.card}>
                <Text style={s.cardLabel}>SEASON RECORD</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 8 }}>
                  <Text style={s.bigStat}>{dashboard.record.wins}W - {dashboard.record.losses}L</Text>
                  <Text style={{ color: '#9ca3af', fontSize: 14 }}>
                    {(dashboard.record.win_pct * 100).toFixed(1)}%
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                  <Text style={s.cardLabel}>SEASON AVG GRADE</Text>
                  <Text style={[s.bigStat, { fontSize: 28, color: '#7c3aed' }]}>
                    {dashboard.season_avg_team_grade.toFixed(2)}
                  </Text>
                </View>
              </View>

              {/* Team grade trend */}
              {dashboard.team_grade_trend.length > 0 && (
                <View style={s.card}>
                  <Text style={s.cardLabel}>GRADE TREND</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
                    {dashboard.team_grade_trend.map((t: any, i: number) => {
                      const maxGrade = Math.max(...dashboard.team_grade_trend.map((x: any) => x.team_grade), 1);
                      const pct = Math.max(t.team_grade / maxGrade, 0.05);
                      const won = t.our_score != null && t.opponent_score != null && t.our_score > t.opponent_score;
                      return (
                        <TouchableOpacity
                          key={t.game_id}
                          style={{ alignItems: 'center', marginRight: 12, width: 56 }}
                          onPress={() => {
                            const game = sessions.find(x => x.id === t.game_id);
                            if (game) openDetail(game);
                          }}
                        >
                          <Text style={{ color: '#9ca3af', fontSize: 9, marginBottom: 4 }}>
                            {t.team_grade.toFixed(1)}
                          </Text>
                          <View
                            style={{
                              width: 32, height: Math.round(pct * 80) + 10,
                              backgroundColor: won ? '#7c3aed' : '#374151',
                              borderRadius: 4, marginBottom: 6,
                            }}
                          />
                          <Text style={{ color: '#6b7280', fontSize: 9, textAlign: 'center' }} numberOfLines={2}>
                            {t.opponent.slice(0, 8)}
                          </Text>
                          <View style={{
                            backgroundColor: won ? '#16a34a22' : '#dc262622',
                            borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, marginTop: 2,
                          }}>
                            <Text style={{ color: won ? '#16a34a' : '#dc2626', fontSize: 8, fontWeight: '700' }}>
                              {won ? 'W' : 'L'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Player leaderboard */}
              {dashboard.player_leaderboard.length > 0 && (
                <View style={s.card}>
                  <Text style={s.cardLabel}>PLAYER LEADERBOARD</Text>
                  {dashboard.player_leaderboard.slice(0, 8).map((p: any, i: number) => (
                    <View key={p.player_name} style={s.leaderRow}>
                      <Text style={s.leaderRank}>{i + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={s.leaderName}>{p.player_name}</Text>
                        <Text style={{ color: '#6b7280', fontSize: 11 }}>
                          {p.games_played}G · OFF {p.avg_offensive.toFixed(1)} · DEF {p.avg_defensive.toFixed(1)}
                        </Text>
                      </View>
                      <View style={s.gradeBadge}>
                        <Text style={s.gradeBadgeText}>{p.avg_game_grade.toFixed(2)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {dashboard.team_grade_trend.length === 0 && (
                <View style={[s.card, { alignItems: 'center', paddingVertical: 32 }]}>
                  <Ionicons name="stats-chart-outline" size={36} color="#374151" />
                  <Text style={{ color: '#6b7280', fontSize: 13, marginTop: 10 }}>
                    No completed games yet. Log a game to see your season stats.
                  </Text>
                </View>
              )}
            </>
          ) : null}
        </ScrollView>
      )}

      {/* Games list */}
      {activeView === 'games' && (
        <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 60 }}>
          {/* Phase filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            {['all', 'preseason', 'regular', 'playoff', 'tournament'].map(p => (
              <TouchableOpacity
                key={p}
                style={[s.chip, phaseFilter === p && s.chipActive]}
                onPress={() => setPhaseFilter(p)}
              >
                <Text style={[s.chipText, phaseFilter === p && s.chipTextActive]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* New game button */}
          <TouchableOpacity style={s.newGameBtn} onPress={() => setShowNewGame(true)}>
            <Ionicons name="add-circle-outline" size={18} color="#fff" />
            <Text style={s.newGameBtnText}>New Game</Text>
          </TouchableOpacity>

          {loading ? (
            <ActivityIndicator color="#7c3aed" style={{ marginTop: 24 }} />
          ) : filteredSessions.length === 0 ? (
            <View style={[s.card, { alignItems: 'center', paddingVertical: 32 }]}>
              <Ionicons name="basketball-outline" size={36} color="#374151" />
              <Text style={{ color: '#6b7280', fontSize: 13, marginTop: 10 }}>No games found. Create your first game.</Text>
            </View>
          ) : (
            filteredSessions.map((game: any) => {
              const won = game.our_score != null && game.opponent_score != null && game.our_score > game.opponent_score;
              const hasScore = game.our_score != null;
              return (
                <TouchableOpacity
                  key={game.id}
                  style={s.gameCard}
                  onPress={() => game.status === 'in_progress' ? openLiveEntry(game) : openDetail(game)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.gameCardOpponent}>{game.opponent_name}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>
                      {new Date(game.date).toLocaleDateString()} · {game.season_phase}
                      {game.location ? ` · ${game.location}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {hasScore ? (
                      <>
                        <View style={[s.wlBadge, { backgroundColor: won ? '#16a34a22' : '#dc262622' }]}>
                          <Text style={[s.wlText, { color: won ? '#16a34a' : '#dc2626' }]}>
                            {won ? 'W' : 'L'} {game.our_score}-{game.opponent_score}
                          </Text>
                        </View>
                      </>
                    ) : null}
                    <View style={[s.statusBadge, game.status === 'in_progress' && { backgroundColor: '#1e3a5f' }]}>
                      <Text style={[s.statusText, game.status === 'in_progress' && { color: '#60a5fa' }]}>
                        {game.status === 'in_progress' ? 'IN PROGRESS' : 'DONE'}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={{ padding: 4 }}
                    onPress={() => {
                      Alert.alert('Delete Game', `Delete game vs ${game.opponent_name}?`, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete', style: 'destructive', onPress: async () => {
                            try {
                              await gameEvalAPI.deleteSession(game.id);
                              setSessions(prev => prev.filter(x => x.id !== game.id));
                            } catch { Alert.alert('Error', 'Could not delete'); }
                          },
                        },
                      ]);
                    }}
                  >
                    <Ionicons name="trash-outline" size={15} color="#4b5563" />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Live Entry */}
      {activeView === 'live' && activeGame && (
        <View style={{ flex: 1 }}>
          {/* Score bar */}
          <View style={s.scoreBar}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#9ca3af', fontSize: 10, fontWeight: '700' }}>US</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity onPress={() => updateScore('our', -1)}>
                  <Ionicons name="remove-circle-outline" size={20} color="#6b7280" />
                </TouchableOpacity>
                <Text style={s.scoreNum}>{ourScore}</Text>
                <TouchableOpacity onPress={() => updateScore('our', 1)}>
                  <Ionicons name="add-circle-outline" size={20} color="#7c3aed" />
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }} numberOfLines={1}>
                vs {activeGame.opponent_name}
              </Text>
              <Text style={{ color: '#6b7280', fontSize: 11 }}>Q{activeQuarter}</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#9ca3af', fontSize: 10, fontWeight: '700' }}>THEM</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity onPress={() => updateScore('opp', -1)}>
                  <Ionicons name="remove-circle-outline" size={20} color="#6b7280" />
                </TouchableOpacity>
                <Text style={s.scoreNum}>{oppScore}</Text>
                <TouchableOpacity onPress={() => updateScore('opp', 1)}>
                  <Ionicons name="add-circle-outline" size={20} color="#7c3aed" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Stat recorded toast */}
          {statToast && (
            <View style={{ backgroundColor: '#16a34a', paddingVertical: 6, paddingHorizontal: 16 }}>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', textAlign: 'center' }}>{statToast}</Text>
            </View>
          )}

          {/* Quarter selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.quarterRow} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
            {[1, 2, 3, 4, 5].map(q => (
              <TouchableOpacity
                key={q}
                style={[s.quarterBtn, activeQuarter === q && s.quarterBtnActive]}
                onPress={() => setActiveQuarter(q)}
              >
                <Text style={[s.quarterBtnText, activeQuarter === q && s.quarterBtnTextActive]}>
                  {q === 5 ? 'OT' : `Q${q}`}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Team toggle */}
          <View style={s.teamToggle}>
            <TouchableOpacity
              style={[s.teamToggleBtn, entryMode === 'our' && s.teamToggleBtnActive]}
              onPress={() => { setEntryMode('our'); setSelectedPlayer(null); }}
            >
              <Text style={[s.teamToggleText, entryMode === 'our' && s.teamToggleTextActive]}>Our Team</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.teamToggleBtn, entryMode === 'opponent' && s.teamToggleBtnActive]}
              onPress={() => { setEntryMode('opponent'); setSelectedPlayer(null); }}
            >
              <Text style={[s.teamToggleText, entryMode === 'opponent' && s.teamToggleTextActive]}>Opponent</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
            {/* Player grid */}
            <Text style={s.sectionLabel}>SELECT PLAYER</Text>
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
                  <Text style={{ color: '#6b7280', fontSize: 12, padding: 8 }}>No roster loaded. Add players to the team first.</Text>
                )
              ) : (
                <>
                  {opponentPlayers.map(name => (
                    <TouchableOpacity
                      key={name}
                      style={[s.playerBtn, selectedPlayer === name && s.playerBtnActive]}
                      onPress={() => setSelectedPlayer(name)}
                    >
                      <Text style={[s.playerBtnText, selectedPlayer === name && s.playerBtnTextActive]} numberOfLines={1}>
                        {name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    <TextInput
                      style={[s.smallInput, { flex: 1 }]}
                      placeholder="Add opponent player..."
                      placeholderTextColor="#4b5563"
                      value={newOppPlayer}
                      onChangeText={setNewOppPlayer}
                    />
                    <TouchableOpacity
                      style={{ backgroundColor: '#374151', borderRadius: 8, padding: 8, justifyContent: 'center' }}
                      onPress={() => {
                        if (newOppPlayer.trim()) {
                          setOpponentPlayers(prev => [...prev, newOppPlayer.trim()]);
                          setSelectedPlayer(newOppPlayer.trim());
                          setNewOppPlayer('');
                        }
                      }}
                    >
                      <Ionicons name="add" size={16} color="#9ca3af" />
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>

            {/* Stat buttons */}
            <Text style={[s.sectionLabel, { marginTop: 20 }]}>OFFENSE</Text>
            <View style={s.statGrid}>
              {OFFENSE_STATS.map(stat => (
                <TouchableOpacity
                  key={stat}
                  style={[s.statBtn, flashStat === stat && s.statBtnFlash]}
                  onPress={() => logStat(stat)}
                  disabled={!selectedPlayer}
                >
                  <Text style={s.statBtnText}>{stat}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.sectionLabel, { marginTop: 16 }]}>DEFENSE</Text>
            <View style={s.statGrid}>
              {DEFENSE_STATS.map(stat => (
                <TouchableOpacity
                  key={stat}
                  style={[s.statBtn, flashStat === stat && s.statBtnFlash]}
                  onPress={() => logStat(stat)}
                  disabled={!selectedPlayer}
                >
                  <Text style={s.statBtnText}>{stat}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
              <TouchableOpacity
                style={[s.actionBtnLive, { flex: 1, borderColor: '#374151' }]}
                onPress={() => setShowLineupModal(true)}
              >
                <Ionicons name="people-outline" size={16} color="#9ca3af" />
                <Text style={{ color: '#9ca3af', fontWeight: '600', fontSize: 13 }}>Lineup</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.actionBtnLive, { flex: 1, borderColor: '#dc2626' }]}
                onPress={endGame}
              >
                <Ionicons name="stop-circle-outline" size={16} color="#dc2626" />
                <Text style={{ color: '#dc2626', fontWeight: '600', fontSize: 13 }}>End Game</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      )}

      {/* Game Detail */}
      {activeView === 'detail' && detailGame && (
        <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 80 }}>
          {/* Header */}
          <View style={s.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>vs {detailGame.opponent_name}</Text>
                <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>
                  {new Date(detailGame.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  {detailGame.location ? ` · ${detailGame.location}` : ''}
                  {' · '}{detailGame.season_phase}
                </Text>
              </View>
              {detailGame.our_score != null && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: '#fff', fontSize: 28, fontWeight: '900' }}>
                    {detailGame.our_score} - {detailGame.opponent_score}
                  </Text>
                  <View style={[s.wlBadge, {
                    backgroundColor: detailGame.our_score > detailGame.opponent_score ? '#16a34a22' : '#dc262622'
                  }]}>
                    <Text style={[s.wlText, { color: detailGame.our_score > detailGame.opponent_score ? '#16a34a' : '#dc2626' }]}>
                      {detailGame.our_score > detailGame.opponent_score ? 'WIN' : 'LOSS'}
                    </Text>
                  </View>
                </View>
              )}
            </View>
            {summary && (
              <View style={{ marginTop: 16, alignItems: 'center' }}>
                <Text style={s.cardLabel}>TEAM GRADE</Text>
                <Text style={{ color: '#7c3aed', fontSize: 40, fontWeight: '900', marginTop: 4 }}>
                  {summary.team_grade.toFixed(2)}
                </Text>
              </View>
            )}
          </View>

          {/* Detail tabs */}
          <View style={s.teamToggle}>
            <TouchableOpacity
              style={[s.teamToggleBtn, detailTab === 'our' && s.teamToggleBtnActive]}
              onPress={() => setDetailTab('our')}
            >
              <Text style={[s.teamToggleText, detailTab === 'our' && s.teamToggleTextActive]}>Our Team</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.teamToggleBtn, detailTab === 'opponent' && s.teamToggleBtnActive]}
              onPress={() => setDetailTab('opponent')}
            >
              <Text style={[s.teamToggleText, detailTab === 'opponent' && s.teamToggleTextActive]}>Opponent</Text>
            </TouchableOpacity>
          </View>

          {loadingSummary ? (
            <ActivityIndicator color="#7c3aed" style={{ marginTop: 24 }} />
          ) : summary ? (
            <View style={s.card}>
              <Text style={s.cardLabel}>PLAYER GRADES</Text>
              {(detailTab === 'our' ? summary.player_grades : summary.opponent_grades).map((g: any) => (
                <View key={g.player_name}>
                  <TouchableOpacity
                    style={s.playerGradeRow}
                    onPress={() => setExpandedPlayer(expandedPlayer === g.player_name ? null : g.player_name)}
                  >
                    <Text style={s.playerGradeName} numberOfLines={1}>{g.player_name}</Text>
                    <Text style={{ color: '#9ca3af', fontSize: 11 }}>OFF {g.offensive_grade.toFixed(1)}</Text>
                    <Text style={{ color: '#9ca3af', fontSize: 11 }}>DEF {g.defensive_grade.toFixed(1)}</Text>
                    <Text style={{ color: '#9ca3af', fontSize: 11 }}>{g.minutes_played.toFixed(0)}m</Text>
                    <View style={s.gradeBadge}>
                      <Text style={s.gradeBadgeText}>{g.game_grade.toFixed(2)}</Text>
                    </View>
                    <Ionicons
                      name={expandedPlayer === g.player_name ? 'chevron-up' : 'chevron-down'}
                      size={14} color="#4b5563"
                    />
                  </TouchableOpacity>
                  {expandedPlayer === g.player_name && (
                    <View style={s.expandedBox}>
                      {Object.entries(g.per_quarter).map(([q, data]: [string, any]) => (
                        <View key={q} style={{ flexDirection: 'row', gap: 12, marginBottom: 4 }}>
                          <Text style={{ color: '#6b7280', fontSize: 12, width: 30 }}>
                            {parseInt(q) === 5 ? 'OT' : `Q${q}`}
                          </Text>
                          <Text style={{ color: '#9ca3af', fontSize: 12 }}>
                            OFF: {(data.offense ?? 0).toFixed(1)} · DEF: {(data.defense ?? 0).toFixed(1)}
                          </Text>
                        </View>
                      ))}
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                        <TouchableOpacity
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                                   backgroundColor: '#1e1b4b', borderRadius: 8, paddingVertical: 8, borderWidth: 1, borderColor: '#4c1d95' }}
                          onPress={() => { setDetailModalPlayer(g.player_name); setShowDetailModal(true); }}
                        >
                          <Ionicons name="eye-outline" size={13} color="#a78bfa" />
                          <Text style={{ color: '#a78bfa', fontSize: 12, fontWeight: '700' }}>View Details</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                                   backgroundColor: '#1f2937', borderRadius: 8, paddingVertical: 8, borderWidth: 1, borderColor: '#374151' }}
                          onPress={() => { setStatsModalPlayer(g.player_name); setShowStatsModal(true); setAddStatName(''); setAddingStatDropdownOpen(false); }}
                        >
                          <Ionicons name="create-outline" size={13} color="#9ca3af" />
                          <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '700' }}>Edit Stats</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              ))}
              {(detailTab === 'our' ? summary.player_grades : summary.opponent_grades).length === 0 && (
                <Text style={{ color: '#4b5563', fontSize: 13, textAlign: 'center', paddingVertical: 12 }}>No stats logged yet.</Text>
              )}
            </View>
          ) : null}

          {/* Action buttons */}
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 16 }}>
            <TouchableOpacity
              style={[s.detailAction, { flex: 1 }]}
              onPress={() => openScout(detailGame.opponent_name)}
            >
              <Ionicons name="search-outline" size={15} color="#9ca3af" />
              <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '600' }}>Scout</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.detailAction, { flex: 1 }]}
              onPress={exportDetailPdf}
              disabled={exporting}
            >
              {exporting
                ? <ActivityIndicator size="small" color="#9ca3af" />
                : <><Ionicons name="share-outline" size={15} color="#9ca3af" />
                  <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '600' }}>Export PDF</Text></>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.detailAction, { flex: 1, borderColor: '#7c3aed' }]}
              onPress={generateScoutingReport}
              disabled={generatingReport}
            >
              {generatingReport
                ? <ActivityIndicator size="small" color="#7c3aed" />
                : <><Ionicons name="sparkles-outline" size={15} color="#7c3aed" />
                  <Text style={{ color: '#7c3aed', fontSize: 12, fontWeight: '600' }}>AI Report</Text></>}
            </TouchableOpacity>
          </View>

          {/* Live entry shortcut if in_progress */}
          {detailGame.status === 'in_progress' && (
            <TouchableOpacity
              style={[s.newGameBtn, { marginHorizontal: 16, marginBottom: 16 }]}
              onPress={() => openLiveEntry(detailGame)}
            >
              <Ionicons name="radio-button-on-outline" size={16} color="#fff" />
              <Text style={s.newGameBtnText}>Continue Live Entry</Text>
            </TouchableOpacity>
          )}

          {/* AI scouting report */}
          {(showScoutingReport || detailGame.ai_scouting_report) && (
            <View style={s.card}>
              <Text style={s.cardLabel}>AI SCOUTING REPORT</Text>
              <View style={{ marginTop: 8 }}>
                {renderReport(detailGame.ai_scouting_report ?? '')}
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* Opponent Scout */}
      {activeView === 'scout' && (
        <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 80, paddingTop: 8 }}>
          {/* Opponent selector */}
          {!scoutOpponent ? (
            <>
              <Text style={[s.cardLabel, { marginBottom: 10 }]}>SELECT OPPONENT</Text>
              {uniqueOpponents.length === 0 ? (
                <View style={[s.card, { alignItems: 'center', paddingVertical: 32 }]}>
                  <Text style={{ color: '#6b7280', fontSize: 13 }}>No opponents yet. Log games first.</Text>
                </View>
              ) : (
                uniqueOpponents.map(opp => (
                  <TouchableOpacity key={opp} style={s.gameCard} onPress={() => openScout(opp)}>
                    <Text style={s.gameCardOpponent}>{opp}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 12 }}>
                      {sessions.filter((x: any) => x.opponent_name === opp).length} game(s)
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color="#374151" />
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
                <Ionicons name="arrow-back" size={18} color="#9ca3af" />
                <Text style={{ color: '#9ca3af', fontSize: 14 }}>All Opponents</Text>
              </TouchableOpacity>

              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 4 }}>{scoutOpponent}</Text>

              {loadingScout ? (
                <ActivityIndicator color="#7c3aed" style={{ marginTop: 24 }} />
              ) : scoutData ? (
                <>
                  {/* Record vs this opponent */}
                  <View style={s.card}>
                    <Text style={s.cardLabel}>GAMES AGAINST</Text>
                    {scoutData.games_played_against.map((g: any) => {
                      const won = g.our_score != null && g.opponent_score != null && g.our_score > g.opponent_score;
                      return (
                        <View key={g.id} style={s.leaderRow}>
                          <Text style={{ color: '#6b7280', fontSize: 12, width: 80 }}>
                            {g.date ? new Date(g.date).toLocaleDateString() : 'N/A'}
                          </Text>
                          <Text style={{ flex: 1, color: '#d1d5db', fontSize: 13 }}>
                            {g.our_score != null ? `${g.our_score} - ${g.opponent_score}` : 'No score'}
                          </Text>
                          {g.our_score != null && (
                            <View style={[s.wlBadge, { backgroundColor: won ? '#16a34a22' : '#dc262622' }]}>
                              <Text style={[s.wlText, { color: won ? '#16a34a' : '#dc2626' }]}>{won ? 'W' : 'L'}</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>

                  {/* Best players */}
                  {scoutData.best_players.length > 0 && (
                    <View style={s.card}>
                      <Text style={s.cardLabel}>THEIR TOP PLAYERS</Text>
                      {scoutData.best_players.map((p: any) => (
                        <View key={p.player_name} style={s.leaderRow}>
                          <Text style={{ flex: 1, color: '#d1d5db', fontSize: 13 }}>{p.player_name}</Text>
                          <Text style={{ color: '#6b7280', fontSize: 11 }}>{p.games}G</Text>
                          <View style={s.gradeBadge}>
                            <Text style={s.gradeBadgeText}>{p.avg_grade.toFixed(2)}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Tendencies */}
                  <View style={s.card}>
                    <Text style={s.cardLabel}>OFFENSIVE TENDENCIES</Text>
                    {scoutData.offensive_tendencies.map((t: any) => (
                      <Text key={t.stat} style={{ color: '#d1d5db', fontSize: 13, marginBottom: 4 }}>
                        • {t.stat} ({t.count}x)
                      </Text>
                    ))}
                    <Text style={[s.cardLabel, { marginTop: 12 }]}>DEFENSIVE TENDENCIES</Text>
                    {scoutData.defensive_tendencies.map((t: any) => (
                      <Text key={t.stat} style={{ color: '#d1d5db', fontSize: 13, marginBottom: 4 }}>
                        • {t.stat} ({t.count}x)
                      </Text>
                    ))}
                    <Text style={[s.cardLabel, { marginTop: 12 }]}>WEAK SPOTS</Text>
                    {scoutData.weak_spots.map((t: any) => (
                      <Text key={t.stat} style={{ color: '#d1d5db', fontSize: 13, marginBottom: 4 }}>
                        • {t.stat} (grade: {t.score.toFixed(1)})
                      </Text>
                    ))}
                  </View>

                  {/* Coach Notes */}
                  <View style={s.card}>
                    <Text style={s.cardLabel}>COACH NOTES</Text>
                    <Text style={{ color: '#4b5563', fontSize: 11, marginBottom: 12, marginTop: 4 }}>
                      Notes are included in the AI scouting report.
                    </Text>

                    {/* Existing notes */}
                    {scoutNotes.map(note => (
                      <View key={note.id} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8,
                                                     borderBottomWidth: 1, borderBottomColor: '#1f2937', gap: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#d1d5db', fontSize: 13, lineHeight: 18 }}>{note.note_text}</Text>
                          <Text style={{ color: '#4b5563', fontSize: 10, marginTop: 3 }}>
                            {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={{ padding: 4 }}
                          onPress={() => Alert.alert('Delete Note', 'Remove this note?', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => deleteOpponentNote(note.id) },
                          ])}
                        >
                          <Ionicons name="trash-outline" size={16} color="#4b5563" />
                        </TouchableOpacity>
                      </View>
                    ))}

                    {scoutNotes.length === 0 && !loadingNotes && (
                      <Text style={{ color: '#4b5563', fontSize: 13, marginBottom: 8 }}>No notes yet. Add your first observation below.</Text>
                    )}

                    {/* Add note */}
                    <TextInput
                      style={[s.input, { marginTop: 10, marginBottom: 8, minHeight: 72, textAlignVertical: 'top' }]}
                      placeholder="Add a scouting note or observation..."
                      placeholderTextColor="#4b5563"
                      value={newNoteText}
                      onChangeText={setNewNoteText}
                      multiline
                      numberOfLines={3}
                    />
                    <TouchableOpacity
                      style={{ backgroundColor: newNoteText.trim() ? '#7c3aed' : '#374151', borderRadius: 10,
                               paddingVertical: 10, alignItems: 'center', opacity: savingNote ? 0.6 : 1 }}
                      onPress={saveOpponentNote}
                      disabled={!newNoteText.trim() || savingNote}
                    >
                      {savingNote
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={{ color: '#fff', fontWeight: '700' }}>Save Note</Text>}
                    </TouchableOpacity>
                  </View>

                  {/* AI report */}
                  <TouchableOpacity
                    style={[s.newGameBtn, { marginBottom: 12 }]}
                    onPress={regenerateScoutingReport}
                    disabled={regeneratingScout}
                  >
                    {regeneratingScout
                      ? <ActivityIndicator color="#fff" />
                      : <><Ionicons name="sparkles-outline" size={16} color="#fff" />
                        <Text style={s.newGameBtnText}>
                          {scoutData.ai_scouting_report ? 'Regenerate AI Report' : 'Generate AI Report'}
                        </Text></>}
                  </TouchableOpacity>

                  {scoutData.ai_scouting_report && (
                    <View style={s.card}>
                      <Text style={s.cardLabel}>AI SCOUTING REPORT</Text>
                      <View style={{ marginTop: 8 }}>
                        {renderReport(scoutData.ai_scouting_report)}
                      </View>
                    </View>
                  )}
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      )}

      {/* New Game Modal */}
      <Modal visible={showNewGame} transparent animationType="slide">
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[s.modalBox, { maxHeight: '85%' }]}>
            <Text style={s.modalTitle}>New Game</Text>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <>
                <Text style={s.fieldLabel}>TEAM (optional)</Text>
                <TouchableOpacity
                  style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: showTeamDropdown ? 0 : 16 }]}
                  onPress={() => { setShowTeamDropdown(v => !v); setShowCreateTeam(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: newGameTeamId === null ? '#4b5563' : '#fff', fontSize: 15 }}>
                    {newGameTeamId === null ? 'None (no team)' : teams.find((t: any) => t.id === newGameTeamId)?.name ?? 'Select team'}
                  </Text>
                  <Text style={{ color: '#6b7280', fontSize: 12 }}>{showTeamDropdown ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {showTeamDropdown && (
                  <View style={{ borderWidth: 1, borderColor: '#374151', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 200 }}>
                      <TouchableOpacity
                        style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#374151', backgroundColor: newGameTeamId === null ? '#1e1b4b' : 'transparent' }}
                        onPress={() => { setNewGameTeamId(null); setShowTeamDropdown(false); }}
                      >
                        <Text style={{ color: newGameTeamId === null ? '#a78bfa' : '#d1d5db', fontSize: 14 }}>None</Text>
                      </TouchableOpacity>
                      {teams.map((t: any) => (
                        <TouchableOpacity
                          key={t.id}
                          style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#374151', backgroundColor: newGameTeamId === t.id ? '#1e1b4b' : 'transparent' }}
                          onPress={() => { setNewGameTeamId(t.id); setShowTeamDropdown(false); }}
                        >
                          <Text style={{ color: newGameTeamId === t.id ? '#a78bfa' : '#d1d5db', fontSize: 14 }}>{t.name}</Text>
                        </TouchableOpacity>
                      ))}
                      {/* Create new team row */}
                      {!showCreateTeam ? (
                        <TouchableOpacity
                          style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                          onPress={() => setShowCreateTeam(true)}
                        >
                          <Text style={{ color: '#7c3aed', fontSize: 14, fontWeight: '700' }}>+ Create New Team</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={{ padding: 12, gap: 8 }}>
                          <TextInput
                            style={[s.input, { marginBottom: 0 }]}
                            placeholder="Team name"
                            placeholderTextColor="#4b5563"
                            value={newTeamName}
                            onChangeText={setNewTeamName}
                            autoFocus
                          />
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <TouchableOpacity
                              style={[s.modalBtn, { flex: 1, backgroundColor: '#1f2937', paddingVertical: 8 }]}
                              onPress={() => { setShowCreateTeam(false); setNewTeamName(''); }}
                            >
                              <Text style={{ color: '#9ca3af', fontWeight: '700', fontSize: 13 }}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[s.modalBtn, { flex: 1, backgroundColor: '#7c3aed', paddingVertical: 8, opacity: newTeamName.trim() ? 1 : 0.4 }]}
                              onPress={createTeam}
                              disabled={creatingTeam || !newTeamName.trim()}
                            >
                              {creatingTeam
                                ? <ActivityIndicator color="#fff" size="small" />
                                : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Create</Text>}
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </ScrollView>
                  </View>
                )}
              </>
              <Text style={s.fieldLabel}>OPPONENT NAME</Text>
              <TextInput
                style={s.input}
                placeholder="e.g. City High School"
                placeholderTextColor="#4b5563"
                value={newGameOpponent}
                onChangeText={setNewGameOpponent}
              />
              <Text style={s.fieldLabel}>LOCATION (optional)</Text>
              <TextInput
                style={s.input}
                placeholder="e.g. Home / Away / Neutral"
                placeholderTextColor="#4b5563"
                value={newGameLocation}
                onChangeText={setNewGameLocation}
              />
              <Text style={s.fieldLabel}>SEASON YEAR (optional)</Text>
              <TextInput
                style={s.input}
                placeholder="e.g. 2025-2026"
                placeholderTextColor="#4b5563"
                value={newGameYear}
                onChangeText={setNewGameYear}
              />
              <Text style={s.fieldLabel}>SEASON PHASE</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 16 }}>
                {['preseason', 'regular', 'playoff', 'tournament'].map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[s.chip, newGamePhase === p && s.chipActive, { flex: 1, paddingHorizontal: 6 }]}
                    onPress={() => setNewGamePhase(p)}
                  >
                    <Text
                      style={[s.chipText, newGamePhase === p && s.chipTextActive, { textAlign: 'center', fontSize: 11 }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={[s.modalBtn, { flex: 1, backgroundColor: '#1f2937' }]}
                onPress={() => { setShowNewGame(false); setShowTeamDropdown(false); setShowCreateTeam(false); setNewTeamName(''); }}
              >
                <Text style={{ color: '#9ca3af', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, { flex: 1, backgroundColor: '#7c3aed', opacity: newGameOpponent.trim() ? 1 : 0.4 }]}
                onPress={createGame}
                disabled={creating || !newGameOpponent.trim()}
              >
                {creating
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>Start Game</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Lineup Modal */}
      <Modal visible={showLineupModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxHeight: '80%' }]}>
            <Text style={s.modalTitle}>{subOutPlayer ? 'Who came in?' : 'Manage Lineup'}</Text>
            {subOutPlayer ? (
              <>
                <Text style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
                  Select the player who substituted in for <Text style={{ color: '#fff', fontWeight: '700' }}>{subOutPlayer}</Text>:
                </Text>
                <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
                  {(entryMode === 'our' ? roster.map((p: any) => p.name) : opponentPlayers)
                    .filter(n => n !== subOutPlayer)
                    .map(name => (
                      <TouchableOpacity
                        key={name}
                        style={{ padding: 13, borderRadius: 10, backgroundColor: '#1f2937', marginBottom: 8, borderWidth: 1, borderColor: '#374151' }}
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
                        <Text style={{ color: '#d1d5db', fontSize: 14, fontWeight: '600' }}>{name}</Text>
                      </TouchableOpacity>
                    ))
                  }
                </ScrollView>
                <TouchableOpacity
                  style={[s.modalBtn, { backgroundColor: '#1f2937', marginTop: 8 }]}
                  onPress={() => setSubOutPlayer(null)}
                >
                  <Text style={{ color: '#9ca3af', fontWeight: '700' }}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={{ color: '#6b7280', fontSize: 13, marginBottom: 16, lineHeight: 18 }}>
                  Tap OUT to sub a player out (you'll pick who came in). Tap IN to log a standalone sub-in.
                </Text>
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  {(entryMode === 'our' ? roster.map((p: any) => p.name) : opponentPlayers).map(name => (
                    <View key={name} style={{ flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                      <TouchableOpacity
                        style={[s.modalBtn, { flex: 1, backgroundColor: '#16a34a22', borderWidth: 1, borderColor: '#16a34a' }]}
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
                        <Text style={{ color: '#16a34a', fontWeight: '600' }}>IN</Text>
                      </TouchableOpacity>
                      <Text style={{ color: '#fff', fontSize: 13, flex: 2, textAlign: 'center' }}>{name}</Text>
                      <TouchableOpacity
                        style={[s.modalBtn, { flex: 1, backgroundColor: '#dc262622', borderWidth: 1, borderColor: '#dc2626' }]}
                        onPress={() => setSubOutPlayer(name)}
                      >
                        <Text style={{ color: '#dc2626', fontWeight: '600' }}>OUT</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
                <TouchableOpacity
                  style={[s.modalBtn, { backgroundColor: '#374151', marginTop: 8 }]}
                  onPress={() => { setShowLineupModal(false); setSubOutPlayer(null); }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Done</Text>
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
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>{detailModalPlayer}</Text>
                {summary && (() => {
                  const grades = detailTab === 'our' ? summary.player_grades : summary.opponent_grades;
                  const pg = grades.find((g: any) => g.player_name === detailModalPlayer);
                  if (!pg) return null;
                  return (
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                      <Text style={{ color: '#6b7280', fontSize: 12 }}>OFF <Text style={{ color: '#a78bfa', fontWeight: '700' }}>{pg.offensive_grade.toFixed(2)}</Text></Text>
                      <Text style={{ color: '#6b7280', fontSize: 12 }}>DEF <Text style={{ color: '#a78bfa', fontWeight: '700' }}>{pg.defensive_grade.toFixed(2)}</Text></Text>
                      <Text style={{ color: '#6b7280', fontSize: 12 }}>{pg.minutes_played.toFixed(0)} min</Text>
                    </View>
                  );
                })()}
              </View>
              {summary && (() => {
                const grades = detailTab === 'our' ? summary.player_grades : summary.opponent_grades;
                const pg = grades.find((g: any) => g.player_name === detailModalPlayer);
                if (!pg) return null;
                return (
                  <View style={{ backgroundColor: '#7c3aed', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 }}>
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>{pg.game_grade.toFixed(2)}</Text>
                    <Text style={{ color: '#c4b5fd', fontSize: 9, textAlign: 'center' }}>GRADE</Text>
                  </View>
                );
              })()}
            </View>

            <View style={{ height: 1, backgroundColor: '#1f2937', marginBottom: 14 }} />

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Substitution events */}
              {gameLineup.filter(e => e.player_name === detailModalPlayer && e.is_opponent === (detailTab === 'opponent')).length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>SUBSTITUTIONS</Text>
                  {gameLineup
                    .filter(e => e.player_name === detailModalPlayer && e.is_opponent === (detailTab === 'opponent'))
                    .map((e, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7,
                                             borderBottomWidth: 1, borderBottomColor: '#1f2937' }}>
                        <View style={{ width: 28, height: 28, borderRadius: 14,
                                        backgroundColor: e.event_type === 'in' ? '#16a34a22' : '#dc262622',
                                        alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name={e.event_type === 'in' ? 'log-in-outline' : 'log-out-outline'}
                                    size={14} color={e.event_type === 'in' ? '#16a34a' : '#dc2626'} />
                        </View>
                        <Text style={{ color: e.event_type === 'in' ? '#16a34a' : '#dc2626', fontWeight: '700', fontSize: 12, width: 28 }}>
                          {e.event_type === 'in' ? 'IN' : 'OUT'}
                        </Text>
                        <Text style={{ color: '#9ca3af', fontSize: 12 }}>{e.quarter === 5 ? 'OT' : `Q${e.quarter}`}</Text>
                        {e.timestamp_seconds != null && (
                          <Text style={{ color: '#4b5563', fontSize: 11 }}>
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
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>
                        {q === 5 ? 'OVERTIME' : `QUARTER ${q}`}
                      </Text>
                      <Text style={{ color: '#6b7280', fontSize: 11 }}>
                        OFF {offTotal > 0 ? '+' : ''}{offTotal.toFixed(1)}  ·  DEF {defTotal > 0 ? '+' : ''}{defTotal.toFixed(1)}
                      </Text>
                    </View>
                    {qStats.map(st => (
                      <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6,
                                                  borderBottomWidth: 1, borderBottomColor: '#1f293780' }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3,
                                        backgroundColor: st.stat_category === 'offense' ? '#7c3aed' : '#0ea5e9',
                                        marginRight: 10 }} />
                        <Text style={{ flex: 1, color: '#d1d5db', fontSize: 13 }}>{st.stat_name}</Text>
                        <Text style={{ color: '#6b7280', fontSize: 11, marginRight: 8 }}>
                          {st.stat_category === 'offense' ? 'OFF' : 'DEF'}
                        </Text>
                        <Text style={{ color: st.weighted_points >= 0 ? '#a78bfa' : '#f87171',
                                        fontSize: 13, fontWeight: '700', width: 44, textAlign: 'right' }}>
                          {st.weighted_points >= 0 ? '+' : ''}{st.weighted_points.toFixed(1)}
                        </Text>
                      </View>
                    ))}
                  </View>
                );
              })}

              {gameStats.filter(st => st.player_name === detailModalPlayer && st.is_opponent === (detailTab === 'opponent')).length === 0 && (
                <Text style={{ color: '#4b5563', fontSize: 13, textAlign: 'center', paddingVertical: 24 }}>No stats logged yet.</Text>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[s.modalBtn, { backgroundColor: '#1f2937', marginTop: 14 }]}
              onPress={() => setShowDetailModal(false)}
            >
              <Text style={{ color: '#9ca3af', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Player Stats Edit Modal */}
      <Modal visible={showStatsModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxHeight: '90%' }]}>
            <Text style={s.modalTitle}>Edit Stats — {statsModalPlayer}</Text>

            {/* ADD STAT SECTION */}
            <View style={{ backgroundColor: '#1a1a2e', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#2d2d5e' }}>
              <Text style={{ color: '#a78bfa', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>ADD MISSING STAT</Text>

              {/* Quarter selector */}
              <Text style={{ color: '#6b7280', fontSize: 11, marginBottom: 6 }}>QUARTER</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
                {[1, 2, 3, 4, 5].map(q => (
                  <TouchableOpacity
                    key={q}
                    style={{ flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center',
                              backgroundColor: addStatQuarter === q ? '#7c3aed' : '#1f2937',
                              borderWidth: 1, borderColor: addStatQuarter === q ? '#7c3aed' : '#374151' }}
                    onPress={() => setAddStatQuarter(q)}
                  >
                    <Text style={{ color: addStatQuarter === q ? '#fff' : '#6b7280', fontSize: 12, fontWeight: '700' }}>
                      {q === 5 ? 'OT' : `Q${q}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Stat picker */}
              <Text style={{ color: '#6b7280', fontSize: 11, marginBottom: 6 }}>STAT</Text>
              <TouchableOpacity
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                         backgroundColor: '#1f2937', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#374151',
                         marginBottom: addingStatDropdownOpen ? 0 : 10 }}
                onPress={() => setAddingStatDropdownOpen(v => !v)}
              >
                <Text style={{ color: addStatName ? '#fff' : '#4b5563', fontSize: 14 }}>
                  {addStatName || 'Select a stat...'}
                </Text>
                <Ionicons name={addingStatDropdownOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#6b7280" />
              </TouchableOpacity>
              {addingStatDropdownOpen && (
                <View style={{ borderWidth: 1, borderColor: '#374151', borderRadius: 8, marginBottom: 10, maxHeight: 160, overflow: 'hidden' }}>
                  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    <Text style={{ color: '#6b7280', fontSize: 10, fontWeight: '700', padding: 8, letterSpacing: 1 }}>OFFENSE</Text>
                    {OFFENSE_STATS.map(stat => (
                      <TouchableOpacity key={stat} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: '#1f2937',
                                                             backgroundColor: addStatName === stat ? '#1e1b4b' : 'transparent' }}
                        onPress={() => { setAddStatName(stat); setAddingStatDropdownOpen(false); }}>
                        <Text style={{ color: addStatName === stat ? '#a78bfa' : '#d1d5db', fontSize: 13 }}>{stat}</Text>
                      </TouchableOpacity>
                    ))}
                    <Text style={{ color: '#6b7280', fontSize: 10, fontWeight: '700', padding: 8, letterSpacing: 1 }}>DEFENSE</Text>
                    {DEFENSE_STATS.map(stat => (
                      <TouchableOpacity key={stat} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: '#1f2937',
                                                             backgroundColor: addStatName === stat ? '#1e1b4b' : 'transparent' }}
                        onPress={() => { setAddStatName(stat); setAddingStatDropdownOpen(false); }}>
                        <Text style={{ color: addStatName === stat ? '#a78bfa' : '#d1d5db', fontSize: 13 }}>{stat}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <TouchableOpacity
                style={{ backgroundColor: addStatName ? '#7c3aed' : '#374151', borderRadius: 8, paddingVertical: 10,
                         alignItems: 'center', opacity: addingStat ? 0.6 : 1 }}
                onPress={() => addStatName && addStatEntry(addStatName, addStatQuarter)}
                disabled={!addStatName || addingStat}
              >
                {addingStat
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>+ Add Stat</Text>}
              </TouchableOpacity>
            </View>

            {/* EXISTING STATS */}
            <Text style={{ color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>LOGGED STATS — TAP TRASH TO REMOVE</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 260 }}>
              {gameStats
                .filter(st => st.player_name === statsModalPlayer && st.is_opponent === (detailTab === 'opponent'))
                .length === 0 ? (
                <Text style={{ color: '#4b5563', fontSize: 13, textAlign: 'center', paddingVertical: 20 }}>No stats logged yet.</Text>
              ) : (
                gameStats
                  .filter(st => st.player_name === statsModalPlayer && st.is_opponent === (detailTab === 'opponent'))
                  .map(st => (
                    <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                                                borderBottomWidth: 1, borderBottomColor: '#1f2937' }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3,
                                      backgroundColor: st.stat_category === 'offense' ? '#7c3aed' : '#0ea5e9', marginRight: 8 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{st.stat_name}</Text>
                        <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 1 }}>
                          {st.quarter === 5 ? 'OT' : `Q${st.quarter}`}  ·  {st.weighted_points >= 0 ? '+' : ''}{st.weighted_points.toFixed(1)} pts
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={{ padding: 8 }}
                        onPress={() =>
                          Alert.alert('Delete Stat', `Remove "${st.stat_name}" entry?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => deleteStatEntry(st.id) },
                          ])
                        }
                      >
                        <Ionicons name="trash-outline" size={18} color="#dc2626" />
                      </TouchableOpacity>
                    </View>
                  ))
              )}
            </ScrollView>

            <TouchableOpacity
              style={[s.modalBtn, { backgroundColor: '#374151', marginTop: 12 }]}
              onPress={() => setShowStatsModal(false)}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827' },
  scroll: { flex: 1, padding: 16 },
  topNav: {
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1f2937',
  },
  screenTitle: { color: '#fff', fontSize: 26, fontWeight: '900', marginBottom: 12 },
  navBtn: {
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: '#374151', marginRight: 8,
  },
  navBtnActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  navBtnText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  navBtnTextActive: { color: '#fff' },
  card: {
    backgroundColor: '#1f2937', borderRadius: 14, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: '#374151',
  },
  cardLabel: {
    color: '#9ca3af', fontSize: 10, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase',
  },
  bigStat: { color: '#fff', fontSize: 36, fontWeight: '900' },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#374151',
  },
  leaderRank: { color: '#6b7280', fontSize: 13, width: 20, textAlign: 'center' },
  leaderName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  gradeBadge: {
    backgroundColor: '#7c3aed22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#7c3aed66',
  },
  gradeBadgeText: { color: '#a78bfa', fontSize: 12, fontWeight: '700' },
  chip: {
    borderWidth: 1, borderColor: '#374151', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7, marginRight: 8,
  },
  chipActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  chipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  newGameBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#7c3aed', borderRadius: 12, paddingVertical: 14, marginBottom: 16,
  },
  newGameBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  gameCard: {
    backgroundColor: '#1f2937', borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#374151',
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  gameCardOpponent: { color: '#fff', fontSize: 15, fontWeight: '700' },
  wlBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  wlText: { fontSize: 11, fontWeight: '700' },
  statusBadge: { backgroundColor: '#1f2937', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  statusText: { color: '#6b7280', fontSize: 9, fontWeight: '700' },
  scoreBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1f2937', paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#374151',
  },
  scoreNum: { color: '#fff', fontSize: 28, fontWeight: '900', minWidth: 40, textAlign: 'center' },
  quarterRow: { backgroundColor: '#111827', flexGrow: 0 },
  quarterBtn: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: '#374151',
  },
  quarterBtnActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  quarterBtnText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  quarterBtnTextActive: { color: '#fff' },
  teamToggle: {
    flexDirection: 'row', padding: 12, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#1f2937',
  },
  teamToggleBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: '#374151', alignItems: 'center',
  },
  teamToggleBtnActive: { backgroundColor: '#7c3aed22', borderColor: '#7c3aed' },
  teamToggleText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  teamToggleTextActive: { color: '#7c3aed', fontWeight: '700' },
  sectionLabel: {
    color: '#9ca3af', fontSize: 10, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8,
  },
  playerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  playerBtn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: '#374151', backgroundColor: '#1f2937',
  },
  playerBtnActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  playerBtnText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  playerBtnTextActive: { color: '#fff' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statBtn: {
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: '#374151', backgroundColor: '#1f2937',
  },
  statBtnFlash: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  statBtnText: { color: '#d1d5db', fontSize: 12, fontWeight: '600' },
  smallInput: {
    backgroundColor: '#1f2937', borderRadius: 8, padding: 8,
    color: '#fff', fontSize: 13, borderWidth: 1, borderColor: '#374151',
  },
  actionBtnLive: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10, borderWidth: 1,
  },
  playerGradeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#374151',
  },
  playerGradeName: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  expandedBox: {
    backgroundColor: '#111827', borderRadius: 8, padding: 12, marginBottom: 4,
  },
  detailAction: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#374151',
    backgroundColor: '#1f2937',
  },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: '#1f2937', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, maxHeight: '85%',
  },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 20 },
  fieldLabel: {
    color: '#9ca3af', fontSize: 10, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6,
  },
  input: {
    backgroundColor: '#111827', borderRadius: 10, padding: 12,
    color: '#fff', fontSize: 14, marginBottom: 16,
    borderWidth: 1, borderColor: '#374151',
  },
  modalBtn: {
    paddingVertical: 13, borderRadius: 10, alignItems: 'center',
  },
});
