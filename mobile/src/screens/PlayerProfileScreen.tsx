import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, Alert, KeyboardAvoidingView, Platform, TextInput,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playersAPI, teamsAPI, playerAPI } from '../api/client';
import { Player, Evaluation, Team } from '../types';
import { GradeBadge } from '../components/GradeBadge';
import { PillarCard } from '../components/PillarCard';

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

  const [player, setPlayer] = useState<Player | null>(null);
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPos, setEditPos] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [editWingspan, setEditWingspan] = useState('');
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

  // Summary state
  const [showSummary, setShowSummary] = useState(false);
  const [summaryType, setSummaryType] = useState('player_eval');
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    Promise.all([playersAPI.get(playerId), playersAPI.evaluations(playerId), teamsAPI.list()])
      .then(([p, e, t]) => { setPlayer(p); setEvals(e); setTeams(t); })
      .finally(() => setLoading(false));
  }, [playerId]);

  const openEdit = () => {
    if (!player) return;
    setEditName(player.name);
    setEditPos(player.position ?? '');
    setEditHeight((player as any).height ?? '');
    setEditWingspan((player as any).wingspan ?? '');
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

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);

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
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.name}>{player.name}</Text>
          <Text style={styles.meta}>{[player.position, player.team_name ?? player.competition_level].filter(Boolean).join(' · ')}</Text>
        </View>
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

      {/* Edit Player Modal — compact floating card */}
      <Modal visible={showEdit} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView style={[styles.modal, { maxHeight: '75%' }]} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Edit Player</Text>
            <TextInput
              style={styles.input}
              placeholder="Full Name *"
              placeholderTextColor="#6b7280"
              value={editName}
              onChangeText={setEditName}
            />
            <TextInput
              style={styles.input}
              placeholder="Position (e.g. PG, SG, SF)"
              placeholderTextColor="#6b7280"
              value={editPos}
              onChangeText={setEditPos}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={`Height (e.g. 6'2")`}
                placeholderTextColor="#6b7280"
                value={editHeight}
                onChangeText={setEditHeight}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={`Wingspan (e.g. 6'5")`}
                placeholderTextColor="#6b7280"
                value={editWingspan}
                onChangeText={setEditWingspan}
              />
            </View>
            <TextInput
              style={styles.input}
              placeholder="School name"
              placeholderTextColor="#6b7280"
              value={editSchool}
              onChangeText={setEditSchool}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="City"
                placeholderTextColor="#6b7280"
                value={editCity}
                onChangeText={setEditCity}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="State"
                placeholderTextColor="#6b7280"
                value={editState}
                onChangeText={setEditState}
              />
            </View>
            <TextInput
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
                    <TextInput
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
  modalSub: { color: '#6b7280', fontSize: 12, marginBottom: 16 },
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
});
