import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, TextInput,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { api, teamsAPI } from '../api/client';
import { Team } from '../types';

const OUTPUT_TYPES = [
  { key: 'player_eval',         label: 'Player Eval' },
  { key: 'box_score',           label: 'Box Score' },
  { key: 'scouting_report',     label: 'Scouting Report' },
  { key: 'film_breakdown',      label: 'Film Breakdown' },
  { key: 'coaching_report',     label: 'Coaching Report' },
  { key: 'recruitment_profile', label: 'Recruitment' },
  { key: 'game_analysis',       label: 'Game Analysis' },
];

const LEVELS = ['Youth', 'MS', 'HS JV', 'HS Varsity', 'Prep School', 'JUCO', 'College', 'Pro'];

const TEMPLATE_COLUMNS = [
  { name: 'Player Name *', desc: 'Full name — required, used to match existing players' },
  { name: 'Position', desc: 'PG, SG, SF, PF, C' },
  { name: 'Competition Level', desc: 'HS Varsity, College, Pro, etc.' },
  { name: 'Overall Grade', desc: 'Number 0–10' },
  { name: 'Offensive Skills', desc: 'Pillar grade 0–10' },
  { name: 'Defense', desc: 'Pillar grade 0–10' },
  { name: 'Physical', desc: 'Pillar grade 0–10' },
  { name: 'Intangibles', desc: 'Pillar grade 0–10' },
  { name: 'Advanced', desc: 'Pillar grade 0–10' },
  { name: 'Strategic Fit', desc: 'Pillar grade 0–10' },
  { name: 'Green Flags', desc: 'Comma-separated strengths' },
  { name: 'Watch Flags', desc: 'Comma-separated concerns' },
  { name: 'Notes', desc: 'Free-text scouting notes or report' },
];

const ROSTER_COLUMNS = [
  { name: 'Player Name *', desc: 'Full name — required' },
  { name: 'Position', desc: 'PG, SG, SF, PF, C' },
  { name: 'Height', desc: "e.g. 6'2\"" },
  { name: 'Wingspan', desc: "e.g. 6'5\" (also accepted: WS)" },
  { name: 'Competition Level', desc: 'HS Varsity, College, Pro, etc.' },
];

interface ImportResult {
  players_created: number;
  players_found: number;
  evaluations_created: number;
  rows_processed: number;
  errors: string[];
}

export default function ImportScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isRosterMode = route.params?.mode === 'roster';

  const [file, setFile] = useState<{ uri: string; name: string } | null>(null);
  const [outputType, setOutputType] = useState('player_eval');
  const [level, setLevel] = useState('HS Varsity');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  // Roster mode: create new team or pick existing
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);

  useEffect(() => {
    teamsAPI.list().then(setTeams).catch(() => {});
  }, []);

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ],
      copyToCacheDirectory: true,
    });
    if (!res.canceled && res.assets[0]) {
      setFile({ uri: res.assets[0].uri, name: res.assets[0].name });
      setResult(null);
    }
  };

  const createAndSelectTeam = async () => {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    try {
      const team = await teamsAPI.create({ name: newTeamName.trim(), competition_level: level });
      setTeams(prev => [...prev, team]);
      setSelectedTeamId(team.id);
      setNewTeamName('');
    } catch {
      Alert.alert('Error', 'Could not create team');
    } finally {
      setCreatingTeam(false);
    }
  };

  const upload = async () => {
    if (!file) return;
    if (isRosterMode && !selectedTeamId) {
      Alert.alert('Team Required', 'Please select or create a team before importing the roster.');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', { uri: file.uri, name: file.name, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as any);
      form.append('output_type', outputType);
      form.append('competition_level', level);
      if (selectedTeamId != null) form.append('team_id', String(selectedTeamId));
      if (isRosterMode) form.append('roster_only', 'true');

      const res = await api.post('/uploads/excel', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data);
    } catch (e: any) {
      Alert.alert('Import Error', e?.response?.data?.detail ?? 'Could not process file');
    } finally {
      setUploading(false);
    }
  };

  const selectedTeam = teams.find(t => t.id === selectedTeamId);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0a0a0a' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.title}>{isRosterMode ? 'Import Roster' : 'Import Excel'}</Text>
            <Text style={styles.sub}>
              {isRosterMode
                ? 'Add players to a team from a spreadsheet'
                : 'Upload a player or team evaluation spreadsheet'}
            </Text>
          </View>
        </View>

        {/* ── ROSTER MODE: Team selector ── */}
        {isRosterMode && (
          <View style={styles.teamSection}>
            <Text style={styles.label}>Team *</Text>
            <Text style={styles.hint}>Select a team or create a new one. Players will be added to this team.</Text>

            {/* Selected team badge */}
            {selectedTeam && (
              <View style={styles.selectedTeamBadge}>
                <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                <Text style={styles.selectedTeamText}>{selectedTeam.name}</Text>
                <TouchableOpacity onPress={() => setSelectedTeamId(null)}>
                  <Ionicons name="close-circle" size={16} color="#6b7280" />
                </TouchableOpacity>
              </View>
            )}

            {/* Create new team */}
            <View style={styles.createTeamRow}>
              <TextInput
                style={styles.createTeamInput}
                placeholder="Create new team name..."
                placeholderTextColor="#4b5563"
                value={newTeamName}
                onChangeText={setNewTeamName}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[styles.createTeamBtn, !newTeamName.trim() && { opacity: 0.4 }]}
                onPress={createAndSelectTeam}
                disabled={!newTeamName.trim() || creatingTeam}
              >
                {creatingTeam
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.createTeamBtnText}>Create</Text>
                }
              </TouchableOpacity>
            </View>

            {/* Existing team picker */}
            {teams.length > 0 && (
              <>
                <TouchableOpacity style={styles.teamPickerToggle} onPress={() => setShowTeamPicker(v => !v)}>
                  <Text style={styles.teamPickerToggleText}>Or select existing team</Text>
                  <Ionicons name={showTeamPicker ? 'chevron-up' : 'chevron-down'} size={14} color="#9ca3af" />
                </TouchableOpacity>
                {showTeamPicker && (
                  <View style={styles.teamPickerList}>
                    {teams.map(t => (
                      <TouchableOpacity
                        key={t.id}
                        style={[styles.teamPickerItem, selectedTeamId === t.id && styles.teamPickerItemActive]}
                        onPress={() => { setSelectedTeamId(t.id); setShowTeamPicker(false); }}
                      >
                        <Text style={[styles.teamPickerItemText, selectedTeamId === t.id && { color: '#fff' }]}>{t.name}</Text>
                        {selectedTeamId === t.id && <Ionicons name="checkmark" size={14} color="#22c55e" />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* File picker */}
        <Text style={styles.label}>Excel File</Text>
        <TouchableOpacity style={[styles.filePicker, file && styles.filePickerDone]} onPress={pickFile}>
          <Ionicons
            name={file ? 'document-text' : 'cloud-upload-outline'}
            size={28}
            color={file ? '#22c55e' : '#6b7280'}
          />
          <Text style={[styles.filePickerText, file && { color: '#22c55e' }]}>
            {file ? file.name : 'Tap to select .xlsx file'}
          </Text>
        </TouchableOpacity>

        {/* Default competition level — shown for both modes */}
        <Text style={styles.label}>Default Competition Level</Text>
        <Text style={styles.hint}>Used for rows that don't have a "Competition Level" column.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 24 }}>
          {LEVELS.map(l => (
            <TouchableOpacity
              key={l}
              style={[styles.chip, level === l && styles.chipActive]}
              onPress={() => setLevel(l)}
            >
              <Text style={[styles.chipText, level === l && styles.chipTextActive]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Eval mode only: report type + team assignment */}
        {!isRosterMode && (
          <>
            <Text style={styles.label}>Default Report Type</Text>
            <Text style={styles.hint}>Used for rows that don't have an "Output Type" column.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              {OUTPUT_TYPES.map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.chip, outputType === t.key && styles.chipActive]}
                  onPress={() => setOutputType(t.key)}
                >
                  <Text style={[styles.chipText, outputType === t.key && styles.chipTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {teams.length > 0 && (
              <>
                <Text style={styles.label}>Assign to Team (optional)</Text>
                <Text style={styles.hint}>Imported players will be added to this team.</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 24 }}>
                  <TouchableOpacity
                    style={[styles.chip, selectedTeamId == null && styles.chipActive]}
                    onPress={() => setSelectedTeamId(null)}
                  >
                    <Text style={[styles.chipText, selectedTeamId == null && styles.chipTextActive]}>No Team</Text>
                  </TouchableOpacity>
                  {teams.map(t => (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.chip, selectedTeamId === t.id && styles.chipActive]}
                      onPress={() => setSelectedTeamId(t.id)}
                    >
                      <Text style={[styles.chipText, selectedTeamId === t.id && styles.chipTextActive]}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
          </>
        )}

        {/* Upload button */}
        <TouchableOpacity
          style={[styles.uploadBtn, (!file || (isRosterMode && !selectedTeamId)) && styles.uploadBtnDisabled]}
          onPress={upload}
          disabled={!file || uploading || (isRosterMode && !selectedTeamId)}
        >
          {uploading
            ? <><ActivityIndicator color="#fff" /><Text style={styles.uploadText}>  Importing...</Text></>
            : <><Ionicons name="cloud-upload" size={18} color="#fff" /><Text style={styles.uploadText}>  {isRosterMode ? 'Import Roster' : 'Import File'}</Text></>
          }
        </TouchableOpacity>

        {/* Result */}
        {result && (
          <View style={styles.resultBox}>
            <Text style={styles.resultTitle}>Import Complete</Text>
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{result.rows_processed}</Text>
                <Text style={styles.statLabel}>Rows Read</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statNum, { color: '#22c55e' }]}>{result.players_created}</Text>
                <Text style={styles.statLabel}>Players Added</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statNum, { color: '#60a5fa' }]}>{result.players_found}</Text>
                <Text style={styles.statLabel}>Players Matched</Text>
              </View>
              {!isRosterMode && (
                <View style={styles.stat}>
                  <Text style={[styles.statNum, { color: '#a78bfa' }]}>{result.evaluations_created}</Text>
                  <Text style={styles.statLabel}>Evals Created</Text>
                </View>
              )}
            </View>
            {result.errors.length > 0 && (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>Errors ({result.errors.length})</Text>
                {result.errors.map((e, i) => (
                  <Text key={i} style={styles.errorText}>· {e}</Text>
                ))}
              </View>
            )}
            <TouchableOpacity style={styles.doneBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.doneBtnText}>{isRosterMode ? 'Back to Roster' : 'Go to Roster'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Column guide */}
        <Text style={[styles.label, { marginTop: 32 }]}>Expected Columns</Text>
        <Text style={styles.hint}>
          Row 1 must be a header row. Column names are flexible — the system recognises common variations.
          Only "Player Name" is required.
        </Text>
        <View style={styles.columnGuide}>
          {(isRosterMode ? ROSTER_COLUMNS : TEMPLATE_COLUMNS).map((col, i) => (
            <View key={i} style={styles.colRow}>
              <Text style={styles.colName}>{col.name}</Text>
              <Text style={styles.colDesc}>{col.desc}</Text>
            </View>
          ))}
        </View>

        {!isRosterMode && (
          <View style={styles.exampleBox}>
            <Text style={styles.exampleTitle}>Example row</Text>
            <Text style={styles.exampleText}>
              John Doe | PG | HS Varsity | 8.5 | 9.0 | 7.5 | 8.0 | 8.5 | 7.0 | 9.0 |
              Elite shooter, High IQ | Needs off-dribble work | Great court vision and leadership
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 20, paddingTop: 56 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  title: { color: '#fff', fontSize: 22, fontWeight: '900' },
  sub: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  label: {
    color: '#9ca3af', fontSize: 11, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6,
  },
  hint: { color: '#4b5563', fontSize: 12, marginBottom: 10, lineHeight: 17 },
  teamSection: {
    backgroundColor: '#111827', borderRadius: 14, padding: 16,
    marginBottom: 24, borderWidth: 1, borderColor: '#1f2937',
  },
  selectedTeamBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#052e16', borderRadius: 8, padding: 10, marginBottom: 12,
  },
  selectedTeamText: { color: '#22c55e', fontWeight: '700', flex: 1, fontSize: 14 },
  createTeamRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  createTeamInput: {
    flex: 1, backgroundColor: '#0a0a0a', borderRadius: 10, padding: 12,
    color: '#fff', fontSize: 14, borderWidth: 1, borderColor: '#374151',
  },
  createTeamBtn: {
    backgroundColor: '#2563eb', borderRadius: 10, paddingHorizontal: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  createTeamBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  teamPickerToggle: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#1f2937',
  },
  teamPickerToggleText: { color: '#6b7280', fontSize: 13 },
  teamPickerList: { marginTop: 6 },
  teamPickerItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#1f2937',
  },
  teamPickerItemActive: { backgroundColor: '#052e16' },
  teamPickerItemText: { color: '#9ca3af', fontSize: 14 },
  filePicker: {
    borderWidth: 2, borderColor: '#374151', borderStyle: 'dashed',
    borderRadius: 12, padding: 24, alignItems: 'center', marginBottom: 24, gap: 8,
  },
  filePickerDone: { borderColor: '#16a34a', borderStyle: 'solid' },
  filePickerText: { color: '#6b7280', fontSize: 14 },
  chip: {
    borderWidth: 1, borderColor: '#374151', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, marginRight: 8,
  },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  uploadBtn: {
    backgroundColor: '#2563eb', borderRadius: 12, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  uploadBtnDisabled: { backgroundColor: '#1e3a8a' },
  uploadText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  resultBox: {
    backgroundColor: '#111827', borderRadius: 14, padding: 20, marginTop: 24,
  },
  resultTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 16 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  stat: { alignItems: 'center', flex: 1 },
  statNum: { color: '#fff', fontSize: 28, fontWeight: '900' },
  statLabel: { color: '#6b7280', fontSize: 10, marginTop: 2, textAlign: 'center' },
  errorBox: { backgroundColor: '#1f0000', borderRadius: 8, padding: 12, marginBottom: 14 },
  errorTitle: { color: '#ef4444', fontWeight: '700', fontSize: 12, marginBottom: 6 },
  errorText: { color: '#fca5a5', fontSize: 12, marginBottom: 2 },
  doneBtn: {
    backgroundColor: '#166534', borderRadius: 10, padding: 14, alignItems: 'center',
  },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  columnGuide: { backgroundColor: '#111827', borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
  colRow: {
    padding: 12, borderBottomWidth: 1, borderBottomColor: '#1f2937',
  },
  colName: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  colDesc: { color: '#6b7280', fontSize: 12 },
  exampleBox: { backgroundColor: '#1e3a8a22', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#1d4ed8' },
  exampleTitle: { color: '#60a5fa', fontSize: 11, fontWeight: '700', marginBottom: 6 },
  exampleText: { color: '#93c5fd', fontSize: 11, lineHeight: 18 },
});
