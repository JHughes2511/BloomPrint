import React, { useEffect, useState, useRef } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, Alert, KeyboardAvoidingView, Platform, TextInput,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { playersAPI, teamsAPI, playerAPI, trainingAPI, staffSharingAPI, coachesAPI, gameEvalAPI } from '../api/client';
import { Player, Evaluation, Team } from '../types';
import { GradeBadge } from '../components/GradeBadge';
import { PillarCard } from '../components/PillarCard';
import { renderReport } from '../utils/renderReport';
import { buildReportHtml, buildPdfFileName } from '../utils/buildReportPdf';

const COMPETITION_LEVELS = ['Middle School', 'HS JV', 'HS Varsity', 'AAU', 'College', 'Pro'];

const OUTPUT_TYPES = [
  { key: 'player_eval', label: 'Player Eval' },
  { key: 'film_breakdown', label: 'Film Breakdown' },
  { key: 'scouting_report', label: 'Scouting Report' },
  { key: 'coaching_report', label: 'Coaching Report' },
  { key: 'recruitment_profile', label: 'Recruitment' },
  { key: 'position_analysis', label: 'Position Analysis' },
  { key: 'box_score', label: 'Box Score' },
];

export default function PlayerProfileScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { playerId } = route.params;

  const scrollRef = useRef<ScrollView>(null);
  const trainingFeedbackY = useRef(0);
  const modalScrollRef = useRef<ScrollView>(null);
  const correctionInputY = useRef(0);

  const [player, setPlayer] = useState<Player | null>(null);
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [latestTraining, setLatestTraining] = useState<any | null>(null);
  const [allTraining, setAllTraining] = useState<any[]>([]);
  const [trainingModalItem, setTrainingModalItem] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingTraining, setSendingTraining] = useState(false);
  // Training picker for send flows
  const [showTrainingPicker, setShowTrainingPicker] = useState(false);
  const [trainingPickerAction, setTrainingPickerAction] = useState<'player' | 'staff' | 'regen' | null>(null);

  // Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPos, setEditPos] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [editWingspan, setEditWingspan] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editStandingReach, setEditStandingReach] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editState, setEditState] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editSchool, setEditSchool] = useState('');
  const [editLevel, setEditLevel] = useState('');
  const [editTeamId, setEditTeamId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);

  // Game history state
  const [gameHistory, setGameHistory] = useState<any[]>([]);
  const [gameHistoryLoading, setGameHistoryLoading] = useState(false);
  const [expandedGame, setExpandedGame] = useState<number | null>(null);

  // Summary state
  const [showSummary, setShowSummary] = useState(false);
  const [summaryType, setSummaryType] = useState('player_eval');
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      playersAPI.get(playerId),
      playersAPI.evaluations(playerId),
      teamsAPI.list(),
      trainingAPI.forPlayer(playerId).catch(() => []),
    ])
      .then(([p, e, t, tr]) => {
        setPlayer(p);
        setEvals(e);
        setTeams(t);
        if (Array.isArray(tr) && tr.length > 0) {
          setLatestTraining(tr[tr.length - 1]);
          setAllTraining(tr);
        }
        // Load game history by player name once we have the player
        if (p?.name) {
          setGameHistoryLoading(true);
          gameEvalAPI.playerGameHistory(p.name)
            .then(setGameHistory)
            .catch(() => {})
            .finally(() => setGameHistoryLoading(false));
        }
      })
      .finally(() => setLoading(false));
  }, [playerId]);

  const openEdit = () => {
    if (!player) return;
    setEditName(player.name);
    setEditPos(player.position ?? '');
    setEditHeight((player as any).height ?? '');
    setEditWingspan((player as any).wingspan ?? '');
    setEditWeight((player as any).weight ?? '');
    setEditStandingReach((player as any).standing_reach ?? '');
    setEditCountry((player as any).country ?? '');
    setEditState((player as any).state ?? '');
    setEditCity((player as any).city ?? '');
    setEditSchool((player as any).school_name ?? '');
    setEditLevel(player.competition_level ?? 'HS Varsity');
    setEditTeamId(player.team_id ?? null);
    setShowEdit(true);
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const updated = await playersAPI.update(playerId, {
        name: editName.trim(),
        position: editPos.trim() || undefined,
        height: editHeight.trim() || undefined,
        wingspan: editWingspan.trim() || undefined,
        weight: editWeight.trim() || undefined,
        standing_reach: editStandingReach.trim() || undefined,
        country: editCountry.trim() || undefined,
        state: editState.trim() || undefined,
        city: editCity.trim() || undefined,
        school_name: editSchool.trim() || undefined,
        competition_level: editLevel,
        team_id: editTeamId ?? 0,
      });
      setPlayer(updated);
      setShowEdit(false);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not save changes');
    } finally {
      setSaving(false);
    }
  };

  const generateSummary = async () => {
    if (!player) return;
    setSummaryLoading(true);
    try {
      const result = await playersAPI.summary(playerId, { output_type: summaryType });
      setShowSummary(false);
      const typeLabel = summaryType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const sanitize = (s: string) => (s ?? '').replace(/[^a-zA-Z0-9 \-]/g, '').trim();
      navigation.navigate('Summary', {
        title: `${player.name} — ${typeLabel} Summary`,
        reportText: result.report_text,
        fileName: [
          'Player Summary',
          sanitize(player.name),
          sanitize(player.team_name ?? player.program_name),
          sanitize(player.position ?? ''),
          typeLabel,
        ].filter(Boolean).join(' - '),
      });
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? e?.message ?? 'Could not generate summary';
      Alert.alert('Error', String(msg));
    } finally {
      setSummaryLoading(false);
    }
  };

  const [showProfileDetail, setShowProfileDetail] = useState(false);

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);

  // Training regenerate state (main profile section)
  const [trainingFeedback, setTrainingFeedback] = useState('');
  const [regeneratingTraining, setRegeneratingTraining] = useState(false);

  // Training modal corrections + print/export
  const [modalCorrection, setModalCorrection] = useState('');
  const [regeneratingModal, setRegeneratingModal] = useState(false);
  const [exportingTraining, setExportingTraining] = useState(false);

  // Share with staff
  const [showStaffShare, setShowStaffShare] = useState(false);
  const [staffShareType, setStaffShareType] = useState<'training' | null>(null);
  const [staffShareId, setStaffShareId] = useState<number | null>(null);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffResults, setStaffResults] = useState<any[]>([]);
  const [staffSearchLoading, setStaffSearchLoading] = useState(false);
  const [allowRegen, setAllowRegen] = useState(false);
  const [sendingStaff, setSendingStaff] = useState(false);

  const createTeamFromEdit = async () => {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    try {
      const team = await teamsAPI.create({ name: newTeamName.trim(), competition_level: editLevel });
      setTeams(prev => [...prev, team]);
      setEditTeamId(team.id);
      setNewTeamName('');
      setShowCreateTeam(false);
      setShowTeamPicker(false);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not create team');
    } finally {
      setCreatingTeam(false);
    }
  };

  const openTrainingPicker = (action: 'player' | 'staff' | 'regen') => {
    if (allTraining.length === 0) {
      Alert.alert('No Training', 'Generate a training program first.');
      return;
    }
    setTrainingPickerAction(action);
    setShowTrainingPicker(true);
  };

  const sendTrainingToPlayer = async (trainingId?: number) => {
    const id = trainingId ?? latestTraining?.id;
    if (!id) {
      Alert.alert('No Training', 'Generate a training program first.');
      return;
    }
    setSendingTraining(true);
    try {
      const result = await trainingAPI.sendToPlayer(id);
      Alert.alert('Sent!', `Training program sent to ${result.player_name ?? 'the player'}.`);
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? 'Could not send training';
      if (msg.includes('not linked')) {
        Alert.alert('Not Linked', 'This player has not linked a player account yet. Generate an invite code for them first.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setSendingTraining(false);
    }
  };

  const regenerateTraining = async () => {
    if (!trainingFeedback.trim()) return;
    setRegeneratingTraining(true);
    try {
      const newSession = await trainingAPI.regenerate(player!.id, trainingFeedback.trim());
      setTrainingFeedback('');
      // Refresh the full training list so the new entry appears in the Training Programs section
      const updated = await trainingAPI.forPlayer(player!.id).catch(() => null);
      if (updated && Array.isArray(updated) && updated.length > 0) {
        setAllTraining(updated);
        setLatestTraining(updated[updated.length - 1]);
      } else if (newSession) {
        setAllTraining(prev => [...prev, newSession]);
        setLatestTraining(newSession);
      }
      Alert.alert('Training Updated', 'A new training program has been generated with your feedback.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not regenerate training');
    } finally {
      setRegeneratingTraining(false);
    }
  };

  const regenerateTrainingFromModal = async () => {
    if (!modalCorrection.trim() || !player) return;
    setRegeneratingModal(true);
    try {
      const updated = await trainingAPI.regenerate(player.id, modalCorrection.trim());
      setModalCorrection('');
      // refresh the full training list and update the open modal
      const refreshed = await trainingAPI.forPlayer(player.id).catch(() => [] as any[]);
      if (Array.isArray(refreshed) && refreshed.length > 0) {
        setLatestTraining(refreshed[refreshed.length - 1]);
        setAllTraining(refreshed);
        setTrainingModalItem(refreshed[refreshed.length - 1]);
      }
      Alert.alert('Regenerated', 'Training program updated with your corrections.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not regenerate training');
    } finally {
      setRegeneratingModal(false);
    }
  };

  const printTraining = async () => {
    if (!trainingModalItem?.program_text) return;
    const html = buildReportHtml({
      title: 'Training Program',
      subject: player?.name ?? '',
      date: new Date(trainingModalItem.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      body: trainingModalItem.program_text,
    });
    try { await Print.printAsync({ html }); } catch {}
  };

  const exportTraining = async () => {
    if (!trainingModalItem?.program_text) return;
    setExportingTraining(true);
    try {
      const reportDate = new Date(trainingModalItem.created_at);
      const html = buildReportHtml({
        title: 'Training Program',
        subject: player?.name ?? '',
        date: reportDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        body: trainingModalItem.program_text,
      });
      const fileName = buildPdfFileName('Training Program', player?.name ?? 'Player', reportDate);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fileName });
      }
    } catch {
      Alert.alert('Error', 'Could not export training program');
    } finally {
      setExportingTraining(false);
    }
  };

  const searchStaff = async () => {
    if (!staffSearch.trim()) return;
    setStaffSearchLoading(true);
    try {
      const results = await coachesAPI.search(staffSearch.trim());
      setStaffResults(results);
    } catch {}
    setStaffSearchLoading(false);
  };

  const sendToStaff = async (target: any) => {
    if (!staffShareId) return;
    setSendingStaff(true);
    try {
      await staffSharingAPI.share({
        report_type: 'training',
        report_id: staffShareId,
        recipient_id: target.id,
        allow_regenerate: allowRegen,
      });
      Alert.alert('Shared!', `Training program shared with ${target.name}.`);
      setShowStaffShare(false);
      setStaffSearch('');
      setStaffResults([]);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not share');
    } finally {
      setSendingStaff(false);
    }
  };

  const generateInvite = async () => {
    setGeneratingInvite(true);
    try {
      const result = await playerAPI.generateInvite(player!.id);
      setInviteCode(result.code);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not generate invite code');
    } finally {
      setGeneratingInvite(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View>;
  if (!player) return null;

  const latest = evals[evals.length - 1] ?? null;

  return (
    <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={{ paddingBottom: 100 }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerCenter} onPress={() => setShowProfileDetail(true)} activeOpacity={0.75}>
          <Text style={styles.name}>{player.name}</Text>
          <Text style={styles.meta}>{[player.position, player.team_name ?? player.competition_level].filter(Boolean).join(' · ')}</Text>
          <Text style={{ color: '#6b7280', fontSize: 10, marginTop: 1 }}>tap to view profile</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={openEdit} style={styles.editBtn}>
          <Ionicons name="create-outline" size={20} color="#9ca3af" />
        </TouchableOpacity>
        <GradeBadge grade={player.latest_grade} size="lg" />
      </View>

      {/* Latest pillar grades */}
      {latest?.pillar_grades && Object.keys(latest.pillar_grades).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Latest Evaluation</Text>
          {Object.entries(latest.pillar_grades).map(([key, grade]) => (
            <PillarCard key={key} pillarKey={key} grade={grade} />
          ))}
        </View>
      )}

      {/* Flags */}
      {latest && (
        <View style={styles.row}>
          {latest.green_flags && latest.green_flags.length > 0 && (
            <View style={[styles.flagBox, { borderColor: '#16a34a' }]}>
              <Text style={[styles.flagTitle, { color: '#22c55e' }]}>Green Flags</Text>
              {latest.green_flags.map((f, i) => <Text key={i} style={styles.flagItem}>· {f}</Text>)}
            </View>
          )}
          {latest.watch_flags && latest.watch_flags.length > 0 && (
            <View style={[styles.flagBox, { borderColor: '#dc2626' }]}>
              <Text style={[styles.flagTitle, { color: '#ef4444' }]}>Watch Flags</Text>
              {latest.watch_flags.map((f, i) => <Text key={i} style={styles.flagItem}>· {f}</Text>)}
            </View>
          )}
        </View>
      )}

      {/* Eval history */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Evaluation History</Text>
          <TouchableOpacity
            style={styles.newEvalBtn}
            onPress={() => navigation.navigate('NewEval', { playerId: player.id, playerName: player.name })}
          >
            <Ionicons name="videocam" size={14} color="#fff" />
            <Text style={styles.newEvalText}>New Eval</Text>
          </TouchableOpacity>
        </View>

        {evals.length === 0 && <Text style={styles.emptyText}>No evaluations yet.</Text>}
        {[...evals].reverse().map(ev => (
          <TouchableOpacity
            key={ev.id}
            style={styles.evalCard}
            onPress={() => navigation.navigate('EvalReport', { evalId: ev.id })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.evalType}>{ev.output_type.replace(/_/g, ' ').toUpperCase()}</Text>
              <Text style={styles.evalDate}>{new Date(ev.created_at).toLocaleDateString()}</Text>
            </View>
            <GradeBadge grade={ev.overall_grade} size="sm" />
          </TouchableOpacity>
        ))}
      </View>

      {/* Training Programs History */}
      {allTraining.length > 0 && (
        <View style={[styles.section, { marginTop: 20 }]}>
          <Text style={styles.sectionTitle}>Training Programs</Text>
          {[...allTraining].reverse().map((ts: any) => (
            <TouchableOpacity
              key={ts.id}
              style={styles.evalCard}
              onPress={() => setTrainingModalItem(ts)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.evalType}>Training Program</Text>
                <Text style={styles.evalDate}>{new Date(ts.created_at).toLocaleDateString()}</Text>
                {ts.program_text ? (
                  <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }} numberOfLines={2}>
                    {ts.program_text.replace(/\*\*/g, '').trim().slice(0, 120)}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color="#374151" />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Summarize history */}
      {evals.length > 0 && (
        <TouchableOpacity style={styles.summaryBtn} onPress={() => setShowSummary(true)}>
          <Ionicons name="bar-chart" size={18} color="#fff" />
          <Text style={styles.summaryText}>Summarize Evaluation History</Text>
        </TouchableOpacity>
      )}

      {/* Training */}
      <TouchableOpacity
        style={styles.trainingBtn}
        onPress={() => navigation.navigate('Training', { playerId: player.id, evalId: latest?.id })}
      >
        <Ionicons name="barbell" size={18} color="#fff" />
        <Text style={styles.trainingText}>Generate Training Program</Text>
      </TouchableOpacity>

      {/* Send training to player */}
      <TouchableOpacity
        style={[styles.trainingBtn, { backgroundColor: '#16a34a', marginTop: 8 }]}
        onPress={() => openTrainingPicker('player')}
        disabled={sendingTraining}
      >
        {sendingTraining
          ? <ActivityIndicator color="#fff" size="small" />
          : <><Ionicons name="paper-plane" size={18} color="#fff" /><Text style={styles.trainingText}>Send Training to Player</Text></>}
      </TouchableOpacity>

      {/* Share training with staff */}
      {allTraining.length > 0 && (
        <TouchableOpacity
          style={[styles.trainingBtn, { backgroundColor: '#7c3aed', marginTop: 8 }]}
          onPress={() => openTrainingPicker('staff')}
        >
          <Ionicons name="people-outline" size={18} color="#fff" />
          <Text style={styles.trainingText}>Share Training with Staff</Text>
        </TouchableOpacity>
      )}

      {/* Training feedback / regenerate */}
      <View
        style={styles.trainingFeedbackBox}
        onLayout={e => { trainingFeedbackY.current = e.nativeEvent.layout.y; }}
      >
        <Text style={styles.trainingFeedbackLabel}>Regenerate Training with Feedback</Text>
        <VoiceTextInput
          style={styles.trainingFeedbackInput}
          placeholder="e.g. Focus more on 3-point shooting and off-ball movement..."
          placeholderTextColor="#4b5563"
          value={trainingFeedback}
          onChangeText={setTrainingFeedback}
          multiline
          textAlignVertical="top"
          onFocus={() => setTimeout(() => scrollRef.current?.scrollTo({ y: trainingFeedbackY.current - 20, animated: true }), 60)}
        />
        <TouchableOpacity
          style={[styles.regenBtn, (!trainingFeedback.trim() || regeneratingTraining) && { opacity: 0.5 }]}
          onPress={() => {
            if (!trainingFeedback.trim()) return;
            if (allTraining.length > 1) {
              openTrainingPicker('regen');
            } else {
              regenerateTraining();
            }
          }}
          disabled={!trainingFeedback.trim() || regeneratingTraining}
        >
          {regeneratingTraining
            ? <ActivityIndicator color="#fff" size="small" />
            : <><Ionicons name="refresh" size={16} color="#fff" /><Text style={styles.regenBtnText}> Regenerate</Text></>}
        </TouchableOpacity>
      </View>

      {/* Invite Code */}
      <TouchableOpacity style={styles.inviteBtn} onPress={generateInvite} disabled={generatingInvite}>
        {generatingInvite
          ? <ActivityIndicator color="#fff" size="small" />
          : <Ionicons name="link" size={18} color="#fff" />}
        <Text style={styles.inviteText}>Generate Player Invite Code</Text>
      </TouchableOpacity>

      {inviteCode && (
        <View style={styles.inviteCodeBox}>
          <Text style={styles.inviteCodeLabel}>INVITE CODE</Text>
          <Text style={styles.inviteCode}>{inviteCode}</Text>
          <Text style={styles.inviteCodeHint}>Share this code with the player so they can link their account</Text>
        </View>
      )}

      {/* Game History */}
      <View style={[styles.section, { marginTop: 8 }]}>
        <Text style={styles.sectionTitle}>GAME HISTORY</Text>
        {gameHistoryLoading && <ActivityIndicator color="#7c3aed" style={{ marginVertical: 12 }} />}
        {!gameHistoryLoading && gameHistory.length === 0 && (
          <Text style={{ color: '#4b5563', fontSize: 13, textAlign: 'center', paddingVertical: 12 }}>
            No game stats recorded for this player yet.
          </Text>
        )}
        {gameHistory.map((game: any) => {
          const isExpanded = expandedGame === game.game_id;
          const won = game.our_score != null && game.our_score > game.opponent_score;
          const lost = game.our_score != null && game.our_score < game.opponent_score;
          const counts: Record<string, number> = {};
          for (const [statName, data] of Object.entries(game.stat_breakdown as Record<string, any>)) {
            counts[statName] = data.count;
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
            <TouchableOpacity
              key={game.game_id}
              style={{ backgroundColor: '#111827', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#1f2937' }}
              onPress={() => setExpandedGame(isExpanded ? null : game.game_id)}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>vs {game.opponent_name}</Text>
                  <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>
                    {game.date}{game.season_phase ? ` · ${game.season_phase}` : ''}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {game.our_score != null && (
                    <View style={{ backgroundColor: won ? '#16a34a22' : lost ? '#dc262622' : '#1f2937', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: won ? '#4ade80' : lost ? '#f87171' : '#9ca3af', fontSize: 11, fontWeight: '700' }}>
                        {won ? 'W' : lost ? 'L' : 'T'} {game.our_score}-{game.opponent_score}
                      </Text>
                    </View>
                  )}
                  <View style={{ backgroundColor: '#1e1b4b', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#4c1d95' }}>
                    <Text style={{ color: '#a78bfa', fontSize: 12, fontWeight: '800' }}>{game.game_grade.toFixed(2)}</Text>
                  </View>
                  <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} color="#4b5563" />
                </View>
              </View>
              {isExpanded && (
                <View style={{ marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', gap: 14, marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1f2937' }}>
                    {[['PTS', pts], ['REB', reb], ['AST', ast], ['STL', stl], ['BLK', blk], ['TO', to], ['FG', fga > 0 ? `${fgm}/${fga}` : '—']].map(([label, val]) => (
                      <View key={label as string} style={{ alignItems: 'center' }}>
                        <Text style={{ color: '#9ca3af', fontSize: 10, fontWeight: '700' }}>{label}</Text>
                        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '900' }}>{val}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={{ color: '#4b5563', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>GRADING STATS</Text>
                  <View style={{ gap: 3 }}>
                    {Object.entries(game.stat_breakdown as Record<string, any>).map(([statName, data]: [string, any]) => (
                      <View key={statName} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: '#9ca3af', fontSize: 12 }}>{statName}{data.count > 1 ? ` ×${data.count}` : ''}</Text>
                        <Text style={{ color: data.weighted_points >= 0 ? '#4ade80' : '#f87171', fontSize: 12, fontWeight: '600' }}>
                          {data.weighted_points >= 0 ? '+' : ''}{data.weighted_points.toFixed(1)}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1f2937', flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: '#6b7280', fontSize: 12 }}>OFF {game.offensive_weighted.toFixed(1)} · DEF {game.defensive_weighted.toFixed(1)} · {game.minutes.toFixed(0)}min</Text>
                  </View>
                  {Object.keys(game.per_quarter).length > 0 && (
                    <View style={{ marginTop: 10 }}>
                      <Text style={{ color: '#4b5563', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>PER QUARTER</Text>
                      {Object.entries(game.per_quarter as Record<string, any>).sort(([a], [b]) => Number(a) - Number(b)).map(([q, data]: [string, any]) => (
                        <View key={q} style={{ flexDirection: 'row', gap: 12, marginBottom: 3 }}>
                          <Text style={{ color: '#6b7280', fontSize: 11, width: 28 }}>{Number(q) === 5 ? 'OT' : `Q${q}`}</Text>
                          <Text style={{ color: '#9ca3af', fontSize: 11 }}>OFF {data.offense.toFixed(1)} · DEF {data.defense.toFixed(1)}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Training picker modal — choose which training to send */}
      <Modal visible={showTrainingPicker} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1f2937' }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>
                {trainingPickerAction === 'player' ? 'Send Training to Player' :
                 trainingPickerAction === 'regen' ? 'Choose Training to Regenerate' :
                 'Share Training with Staff'}
              </Text>
              <TouchableOpacity onPress={() => setShowTrainingPicker(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            <Text style={{ color: '#6b7280', fontSize: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>
              {trainingPickerAction === 'regen'
                ? 'Select which training program to regenerate with your feedback:'
                : 'Select which training program to send:'}
            </Text>
            <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
              {[...allTraining].reverse().map((ts: any, idx: number) => (
                <TouchableOpacity
                  key={ts.id}
                  style={{ backgroundColor: '#1f2937', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#374151' }}
                  onPress={() => {
                    setShowTrainingPicker(false);
                    if (trainingPickerAction === 'player') {
                      sendTrainingToPlayer(ts.id);
                    } else if (trainingPickerAction === 'regen') {
                      regenerateTraining(ts.id);
                    } else {
                      setStaffShareId(ts.id);
                      setStaffShareType('training');
                      setShowStaffShare(true);
                      setStaffSearch('');
                      setStaffResults([]);
                    }
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                      {idx === allTraining.length - 1 ? 'Latest — ' : ''}{new Date(ts.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                    {idx === allTraining.length - 1 && (
                      <View style={{ backgroundColor: '#7c3aed', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>LATEST</Text>
                      </View>
                    )}
                  </View>
                  {ts.program_text ? (
                    <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                      {ts.program_text.replace(/[#*_\-=]/g, '').trim().slice(0, 100)}...
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Player profile detail modal */}
      <Modal visible={showProfileDetail} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1f2937' }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>Player Profile</Text>
              <TouchableOpacity onPress={() => setShowProfileDetail(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
              {/* Name + grade */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>{player.name}</Text>
                  {player.position ? <Text style={{ color: '#9ca3af', fontSize: 14, marginTop: 2 }}>{player.position}</Text> : null}
                </View>
                <GradeBadge grade={player.latest_grade} size="lg" />
              </View>

              {/* Info rows */}
              {[
                { label: 'Age', value: player.age ? `${player.age} yrs` : null },
                { label: 'Height', value: (player as any).height },
                { label: 'Wingspan', value: (player as any).wingspan },
                { label: 'Weight', value: (player as any).weight },
                { label: 'Standing Reach', value: (player as any).standing_reach },
                { label: 'School', value: (player as any).school_name },
                { label: 'Program', value: (player as any).program_name },
                { label: 'Team', value: player.team_name },
                { label: 'Level', value: player.competition_level },
                { label: 'City', value: (player as any).city },
                { label: 'State', value: (player as any).state },
                { label: 'Country', value: (player as any).country },
              ].filter(r => r.value).map(r => (
                <View key={r.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1f2937' }}>
                  <Text style={{ color: '#6b7280', fontSize: 14, fontWeight: '600' }}>{r.label}</Text>
                  <Text style={{ color: '#f9fafb', fontSize: 14, fontWeight: '500', flexShrink: 1, textAlign: 'right', marginLeft: 12 }}>{r.value}</Text>
                </View>
              ))}

              {/* Notes */}
              {player.notes ? (
                <View style={{ marginTop: 16 }}>
                  <Text style={{ color: '#6b7280', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>NOTES</Text>
                  <Text style={{ color: '#d1d5db', fontSize: 14, lineHeight: 20 }}>{player.notes}</Text>
                </View>
              ) : null}

              {/* Stats summary */}
              <View style={{ marginTop: 20, backgroundColor: '#1f2937', borderRadius: 12, padding: 14 }}>
                <Text style={{ color: '#6b7280', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>EVALUATION SUMMARY</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>{evals.length}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 11 }}>Evaluations</Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>{allTraining.length}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 11 }}>Training Plans</Text>
                  </View>
                  {player.latest_grade != null && (
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>{player.latest_grade.toFixed(1)}</Text>
                      <Text style={{ color: '#6b7280', fontSize: 11 }}>Latest Grade</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Member since */}
              <Text style={{ color: '#4b5563', fontSize: 12, textAlign: 'center', marginTop: 16 }}>
                Member since {new Date(player.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Training detail modal — full-screen so all text is readable */}
      <Modal visible={!!trainingModalItem} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20, flex: 1, marginTop: 60 }}>
            {/* Compact header — max ~50px tall */}
            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 16, paddingVertical: 10,
              borderBottomWidth: 1, borderBottomColor: '#1f2937',
              minHeight: 50, maxHeight: 50,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Training Program</Text>
                {trainingModalItem && (
                  <Text style={{ color: '#6b7280', fontSize: 10 }}>
                    {new Date(trainingModalItem.created_at).toLocaleDateString()}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setTrainingModalItem(null)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView
                ref={modalScrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
              >
                {trainingModalItem?.program_text
                  ? renderReport(trainingModalItem.program_text)
                  : <Text style={{ color: '#6b7280' }}>No training content.</Text>
                }

                {/* Corrections section */}
                <View
                  style={{ marginTop: 24, borderTopWidth: 1, borderTopColor: '#1f2937', paddingTop: 16 }}
                  onLayout={e => { correctionInputY.current = e.nativeEvent.layout.y; }}
                >
                  <Text style={{ color: '#d1d5db', fontWeight: '700', fontSize: 13, marginBottom: 8 }}>CORRECTIONS</Text>
                  <VoiceTextInput
                    style={{
                      backgroundColor: '#1f2937', color: '#f9fafb', borderRadius: 10,
                      padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: 'top',
                      borderWidth: 1, borderColor: '#374151',
                    }}
                    placeholder="Enter corrections or feedback for a new training program..."
                    placeholderTextColor="#4b5563"
                    value={modalCorrection}
                    onChangeText={setModalCorrection}
                    multiline
                    onFocus={() => setTimeout(() => modalScrollRef.current?.scrollTo({ y: correctionInputY.current, animated: true }), 100)}
                  />
                  <TouchableOpacity
                    style={{
                      marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      gap: 6, backgroundColor: '#7c3aed', borderRadius: 10, paddingVertical: 12,
                      opacity: (!modalCorrection.trim() || regeneratingModal) ? 0.5 : 1,
                    }}
                    onPress={regenerateTrainingFromModal}
                    disabled={!modalCorrection.trim() || regeneratingModal}
                  >
                    {regeneratingModal
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <><Ionicons name="refresh" size={15} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Apply & Regenerate</Text></>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </KeyboardAvoidingView>

            {/* Action row: Send to Player, Send to Staff, Print, Export */}
            <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#1f2937', gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#16a34a', borderRadius: 10, paddingVertical: 12 }}
                  onPress={() => { setTrainingModalItem(null); sendTrainingToPlayer(); }}
                  disabled={sendingTraining}
                >
                  {sendingTraining
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Ionicons name="person-outline" size={15} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Send to Player</Text></>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#7c3aed', borderRadius: 10, paddingVertical: 12 }}
                  onPress={() => {
                    if (!trainingModalItem) return;
                    setStaffShareId(trainingModalItem.id);
                    setStaffShareType('training');
                    setShowStaffShare(true);
                    setStaffSearch('');
                    setStaffResults([]);
                    setTrainingModalItem(null);
                  }}
                >
                  <Ionicons name="people-outline" size={15} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Send to Staff</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#1f2937', borderRadius: 10, paddingVertical: 12, borderWidth: 1, borderColor: '#374151' }}
                  onPress={printTraining}
                >
                  <Ionicons name="print-outline" size={15} color="#d1d5db" />
                  <Text style={{ color: '#d1d5db', fontWeight: '700', fontSize: 13 }}>Print</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#1f2937', borderRadius: 10, paddingVertical: 12, borderWidth: 1, borderColor: '#374151' }}
                  onPress={exportTraining}
                  disabled={exportingTraining}
                >
                  {exportingTraining
                    ? <ActivityIndicator color="#d1d5db" size="small" />
                    : <><Ionicons name="share-outline" size={15} color="#d1d5db" /><Text style={{ color: '#d1d5db', fontWeight: '700', fontSize: 13 }}>Export PDF</Text></>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Player Modal — compact floating card */}
      <Modal visible={showEdit} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modal, { maxHeight: '90%', flex: 0 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true} contentContainerStyle={{ paddingBottom: 16 }}>
            <Text style={styles.modalTitle}>Edit Player</Text>
            <VoiceTextInput
              style={styles.input}
              placeholder="Full Name *"
              placeholderTextColor="#6b7280"
              value={editName}
              onChangeText={setEditName}
            />
            <VoiceTextInput
              style={styles.input}
              placeholder="Position (e.g. PG, SG, SF)"
              placeholderTextColor="#6b7280"
              value={editPos}
              onChangeText={setEditPos}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={`Height (e.g. 6'2")`}
                placeholderTextColor="#6b7280"
                value={editHeight}
                onChangeText={setEditHeight}
              />
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={`Wingspan (e.g. 6'5")`}
                placeholderTextColor="#6b7280"
                value={editWingspan}
                onChangeText={setEditWingspan}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Weight (e.g. 185 lbs)"
                placeholderTextColor="#6b7280"
                value={editWeight}
                onChangeText={setEditWeight}
              />
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={`Standing Reach (e.g. 8'2")`}
                placeholderTextColor="#6b7280"
                value={editStandingReach}
                onChangeText={setEditStandingReach}
              />
            </View>
            <VoiceTextInput
              style={styles.input}
              placeholder="School name"
              placeholderTextColor="#6b7280"
              value={editSchool}
              onChangeText={setEditSchool}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="City"
                placeholderTextColor="#6b7280"
                value={editCity}
                onChangeText={setEditCity}
              />
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="State"
                placeholderTextColor="#6b7280"
                value={editState}
                onChangeText={setEditState}
              />
            </View>
            <VoiceTextInput
              style={styles.input}
              placeholder="Country"
              placeholderTextColor="#6b7280"
              value={editCountry}
              onChangeText={setEditCountry}
            />

            {/* Inline level picker */}
            <Text style={styles.inputLabel}>Competition Level</Text>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() => { setShowLevelPicker(v => !v); setShowTeamPicker(false); setShowCreateTeam(false); }}
            >
              <Text style={styles.dropdownText}>{editLevel}</Text>
              <Text style={{ color: '#9ca3af' }}>{showLevelPicker ? '▴' : '▾'}</Text>
            </TouchableOpacity>
            {showLevelPicker && (
              <View style={styles.inlineList}>
                {COMPETITION_LEVELS.map(lvl => (
                  <TouchableOpacity
                    key={lvl}
                    style={[styles.inlineOption, editLevel === lvl && styles.inlineOptionActive]}
                    onPress={() => { setEditLevel(lvl); setShowLevelPicker(false); }}
                  >
                    <Text style={[styles.inlineOptionText, editLevel === lvl && { color: '#fff', fontWeight: '700' }]}>{lvl}</Text>
                    {editLevel === lvl && <Ionicons name="checkmark" size={16} color="#2563eb" />}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Inline team picker */}
            <Text style={[styles.inputLabel, { marginTop: 8 }]}>Team</Text>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() => { setShowTeamPicker(v => !v); setShowLevelPicker(false); setShowCreateTeam(false); }}
            >
              <Text style={styles.dropdownText}>
                {editTeamId ? (teams.find(t => t.id === editTeamId)?.name ?? 'Unknown') : 'No Team'}
              </Text>
              <Text style={{ color: '#9ca3af' }}>{showTeamPicker ? '▴' : '▾'}</Text>
            </TouchableOpacity>
            {showTeamPicker && (
              <View style={styles.inlineList}>
                <TouchableOpacity
                  style={[styles.inlineOption, !editTeamId && styles.inlineOptionActive]}
                  onPress={() => { setEditTeamId(null); setShowTeamPicker(false); }}
                >
                  <Text style={[styles.inlineOptionText, !editTeamId && { color: '#fff', fontWeight: '700' }]}>No Team</Text>
                  {!editTeamId && <Ionicons name="checkmark" size={16} color="#2563eb" />}
                </TouchableOpacity>
                {teams.map(t => (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.inlineOption, editTeamId === t.id && styles.inlineOptionActive]}
                    onPress={() => { setEditTeamId(t.id); setShowTeamPicker(false); }}
                  >
                    <Text style={[styles.inlineOptionText, editTeamId === t.id && { color: '#fff', fontWeight: '700' }]}>{t.name}</Text>
                    {editTeamId === t.id && <Ionicons name="checkmark" size={16} color="#2563eb" />}
                  </TouchableOpacity>
                ))}
                {/* Create new team inline */}
                <TouchableOpacity
                  style={[styles.inlineOption, { borderTopColor: '#2563eb33' }]}
                  onPress={() => { setShowCreateTeam(v => !v); }}
                >
                  <Ionicons name="add-circle-outline" size={16} color="#2563eb" />
                  <Text style={[styles.inlineOptionText, { color: '#2563eb', marginLeft: 8 }]}>Create New Team</Text>
                </TouchableOpacity>
                {showCreateTeam && (
                  <View style={{ padding: 8, gap: 8 }}>
                    <VoiceTextInput
                      style={styles.input}
                      placeholder="Team name..."
                      placeholderTextColor="#6b7280"
                      value={newTeamName}
                      onChangeText={setNewTeamName}
                      autoFocus
                    />
                    <TouchableOpacity
                      style={[styles.saveBtn, { marginTop: 0 }]}
                      onPress={createTeamFromEdit}
                      disabled={creatingTeam || !newTeamName.trim()}
                    >
                      {creatingTeam ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Create & Assign</Text>}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            <View style={[styles.modalRow, { marginTop: 16 }]}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowEdit(false); setShowLevelPicker(false); setShowTeamPicker(false); setShowCreateTeam(false); }}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveEdit} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Share with Staff modal */}
      <Modal visible={showStaffShare} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Share with Staff</Text>
            <Text style={styles.modalSub}>Search for a coach, scout, or trainer to share this training program.</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, backgroundColor: '#1f2937', borderRadius: 8, padding: 12 }}>
              <Text style={{ color: '#d1d5db', fontSize: 13 }}>Allow recipient to regenerate</Text>
              <TouchableOpacity
                onPress={() => setAllowRegen(v => !v)}
                style={{ width: 40, height: 22, borderRadius: 11, backgroundColor: allowRegen ? '#7c3aed' : '#374151', justifyContent: 'center', paddingHorizontal: 2 }}
              >
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: allowRegen ? 'flex-end' : 'flex-start' }} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Search coach/program name..."
                placeholderTextColor="#6b7280"
                value={staffSearch}
                onChangeText={setStaffSearch}
              />
              <TouchableOpacity
                style={{ backgroundColor: '#7c3aed', borderRadius: 10, padding: 12, alignItems: 'center', justifyContent: 'center' }}
                onPress={searchStaff}
                disabled={staffSearchLoading}
              >
                {staffSearchLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={18} color="#fff" />}
              </TouchableOpacity>
            </View>
            {staffResults.map((r: any) => (
              <TouchableOpacity
                key={r.id}
                style={{ backgroundColor: '#1f2937', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#374151' }}
                onPress={() => sendToStaff(r)}
                disabled={sendingStaff}
              >
                {sendingStaff ? <ActivityIndicator color="#7c3aed" /> : <>
                  <Text style={{ color: '#fff', fontWeight: '600' }}>{r.name}</Text>
                  <Text style={{ color: '#6b7280', fontSize: 11 }}>{r.role} · {r.program_name}</Text>
                </>}
              </TouchableOpacity>
            ))}
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowStaffShare(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Summary modal */}
      <Modal visible={showSummary} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Summarize History</Text>
            <Text style={styles.modalSub}>Choose a report type to generate a summary across all {evals.length} evaluations.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              {OUTPUT_TYPES.map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.chip, summaryType === t.key && styles.chipActive]}
                  onPress={() => setSummaryType(t.key)}
                >
                  <Text style={[styles.chipText, summaryType === t.key && { color: '#fff' }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowSummary(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={generateSummary} disabled={summaryLoading}>
                {summaryLoading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveText}>Generate</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56, gap: 12 },
  headerCenter: { flex: 1 },
  name: { color: '#fff', fontSize: 22, fontWeight: '900' },
  meta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: '#9ca3af', fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 20 },
  flagBox: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12 },
  flagTitle: { fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' },
  flagItem: { color: '#d1d5db', fontSize: 12, marginBottom: 3 },
  evalCard: {
    backgroundColor: '#111827', borderRadius: 10, padding: 14,
    flexDirection: 'row', alignItems: 'center', marginBottom: 8,
  },
  evalType: { color: '#fff', fontSize: 13, fontWeight: '700' },
  evalDate: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  emptyText: { color: '#4b5563', fontSize: 13 },
  newEvalBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#2563eb', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
  newEvalText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  summaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1d4ed8', margin: 20, marginBottom: 8, padding: 16, borderRadius: 12,
  },
  summaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  trainingBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1f2937', marginHorizontal: 20, marginTop: 0, marginBottom: 0, padding: 16, borderRadius: 12,
  },
  trainingText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#111827', borderRadius: 20, padding: 24, margin: 12 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalSub: { color: '#6b7280', fontSize: 12, marginBottom: 16, lineHeight: 18 },
  chip: { borderWidth: 1, borderColor: '#374151', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8 },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center' },
  cancelText: { color: '#9ca3af', fontWeight: '600' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#2563eb', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700' },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#374151', marginHorizontal: 20, marginTop: 10, padding: 14, borderRadius: 12,
  },
  inviteText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  inviteCodeBox: {
    backgroundColor: '#111827', marginHorizontal: 20, marginTop: 10, padding: 16,
    borderRadius: 12, borderWidth: 1, borderColor: '#2563eb', alignItems: 'center',
  },
  inviteCodeLabel: { color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 8 },
  inviteCode: { color: '#2563eb', fontSize: 28, fontWeight: '900', letterSpacing: 4, marginBottom: 8 },
  editBtn: { padding: 4 },
  input: {
    backgroundColor: '#1f2937', borderRadius: 10, padding: 12, color: '#fff',
    fontSize: 14, borderWidth: 1, borderColor: '#374151', marginBottom: 12,
  },
  inputLabel: { color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  dropdownTrigger: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1f2937', borderRadius: 10, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: '#374151',
  },
  dropdownText: { color: '#fff', fontSize: 14 },
  pickerOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 13, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: '#1f2937',
  },
  pickerOptionActive: { backgroundColor: '#1e3a5f', marginHorizontal: -4, paddingHorizontal: 4, borderRadius: 8 },
  pickerOptionText: { color: '#d1d5db', fontSize: 14 },
  inlineList: { backgroundColor: '#0a0a0a', borderRadius: 10, marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#374151' },
  inlineOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#1f2937' },
  inlineOptionActive: { backgroundColor: '#1e3a5f' },
  inlineOptionText: { color: '#d1d5db', fontSize: 14 },
  inviteCodeHint: { color: '#6b7280', fontSize: 11, textAlign: 'center' },
  trainingFeedbackBox: {
    backgroundColor: '#111827', marginHorizontal: 20, marginTop: 10,
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#374151',
  },
  trainingFeedbackLabel: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  trainingFeedbackInput: {
    backgroundColor: '#1f2937', borderRadius: 8, padding: 10, color: '#fff',
    fontSize: 13, borderWidth: 1, borderColor: '#374151', minHeight: 70, marginBottom: 10,
  },
  regenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#7c3aed', borderRadius: 8, padding: 12,
  },
  regenBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
