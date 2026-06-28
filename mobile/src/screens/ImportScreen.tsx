import React, { useEffect, useState } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, TextInput,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { api, teamsAPI } from '../api/client';
import { Team } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

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
  const { t } = useTheme();
  const styles = makeStyles(t);
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
    <ScreenBackground>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={undefined}
    >
      <KeyboardAwareScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
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
                <Ionicons name="checkmark-circle" size={16} color={t.positive} />
                <Text style={styles.selectedTeamText}>{selectedTeam.name}</Text>
                <TouchableOpacity onPress={() => setSelectedTeamId(null)}>
                  <Ionicons name="close-circle" size={16} color={t.muted} />
                </TouchableOpacity>
              </View>
            )}

            {/* Create new team */}
            <View style={styles.createTeamRow}>
              <VoiceTextInput
                style={styles.createTeamInput}
                placeholder="Create new team name..."
                placeholderTextColor={t.muted2}
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
                  ? <ActivityIndicator color={t.ctaText} size="small" />
                  : <Text style={styles.createTeamBtnText}>Create</Text>
                }
              </TouchableOpacity>
            </View>

            {/* Existing team picker */}
            {teams.length > 0 && (
              <>
                <TouchableOpacity style={styles.teamPickerToggle} onPress={() => setShowTeamPicker(v => !v)}>
                  <Text style={styles.teamPickerToggleText}>Or select existing team</Text>
                  <Ionicons name={showTeamPicker ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted} />
                </TouchableOpacity>
                {showTeamPicker && (
                  <View style={styles.teamPickerList}>
                    {teams.map(tm => (
                      <TouchableOpacity
                        key={tm.id}
                        style={[styles.teamPickerItem, selectedTeamId === tm.id && styles.teamPickerItemActive]}
                        onPress={() => { setSelectedTeamId(tm.id); setShowTeamPicker(false); }}
                      >
                        <Text style={[styles.teamPickerItemText, selectedTeamId === tm.id && { color: t.ink }]}>{tm.name}</Text>
                        {selectedTeamId === tm.id && <Ionicons name="checkmark" size={14} color={t.positive} />}
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
            color={file ? t.positive : t.muted}
          />
          <Text style={[styles.filePickerText, file && { color: t.positive }]}>
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
            ? <><ActivityIndicator color={t.ctaText} /><Text style={styles.uploadText}>  Importing...</Text></>
            : <><Ionicons name="cloud-upload" size={18} color={t.ctaText} /><Text style={styles.uploadText}>  {isRosterMode ? 'Import Roster' : 'Import File'}</Text></>
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
                <Text style={[styles.statNum, { color: t.positive }]}>{result.players_created}</Text>
                <Text style={styles.statLabel}>Players Added</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statNum, { color: t.accent }]}>{result.players_found}</Text>
                <Text style={styles.statLabel}>Players Matched</Text>
              </View>
              {!isRosterMode && (
                <View style={styles.stat}>
                  <Text style={[styles.statNum, { color: t.accent }]}>{result.evaluations_created}</Text>
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
      </KeyboardAwareScrollView>
    </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 56 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  title: { color: t.ink, fontSize: 22, fontFamily: fonts[800] },
  sub: { color: t.muted, fontSize: 12, marginTop: 2 },
  label: {
    color: t.label, fontSize: 11.5, fontFamily: fonts[700],
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6,
  },
  hint: { color: t.muted2, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  teamSection: {
    backgroundColor: t.card, borderRadius: 18, padding: 16,
    marginBottom: 24, borderWidth: 1, borderColor: t.cardBorder,
  },
  selectedTeamBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.positiveSoft, borderRadius: 10, padding: 10, marginBottom: 12,
  },
  selectedTeamText: { color: t.positive, fontFamily: fonts[700], flex: 1, fontSize: 14 },
  createTeamRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  createTeamInput: {
    flex: 1, backgroundColor: t.chip, borderRadius: 12, padding: 12,
    color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line,
  },
  createTeamBtn: {
    backgroundColor: t.ctaBg, borderRadius: 999, paddingHorizontal: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  createTeamBtnText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 14 },
  teamPickerToggle: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.divider,
  },
  teamPickerToggleText: { color: t.muted, fontSize: 13 },
  teamPickerList: { marginTop: 6 },
  teamPickerItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  teamPickerItemActive: { backgroundColor: t.accentSoft, borderRadius: 8 },
  teamPickerItemText: { color: t.inkSoft, fontSize: 14 },
  filePicker: {
    borderWidth: 2, borderColor: t.line, borderStyle: 'dashed',
    borderRadius: 14, padding: 24, alignItems: 'center', marginBottom: 24, gap: 8,
  },
  filePickerDone: { borderColor: t.positive, borderStyle: 'solid' },
  filePickerText: { color: t.muted, fontSize: 14 },
  chip: {
    borderWidth: 1, borderColor: t.line, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 9, marginRight: 8,
  },
  chipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  chipText: { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  chipTextActive: { color: t.ctaText },
  uploadBtn: {
    backgroundColor: t.ctaBg, borderRadius: 999, padding: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  uploadBtnDisabled: { opacity: 0.5 },
  uploadText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15 },
  resultBox: {
    backgroundColor: t.card, borderRadius: 18, padding: 20, marginTop: 24, borderWidth: 1, borderColor: t.cardBorder,
  },
  resultTitle: { color: t.ink, fontSize: 18, fontFamily: fonts[800], marginBottom: 16 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  stat: { alignItems: 'center', flex: 1 },
  statNum: { color: t.ink, fontSize: 28, fontFamily: fonts[900] },
  statLabel: { color: t.muted, fontSize: 10, marginTop: 2, textAlign: 'center' },
  errorBox: { backgroundColor: t.negativeSoft, borderRadius: 10, padding: 12, marginBottom: 14 },
  errorTitle: { color: t.negative, fontFamily: fonts[700], fontSize: 12, marginBottom: 6 },
  errorText: { color: t.negative, fontSize: 12, marginBottom: 2 },
  doneBtn: {
    backgroundColor: t.ctaBg, borderRadius: 999, padding: 14, alignItems: 'center',
  },
  doneBtnText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 14 },
  columnGuide: { backgroundColor: t.card, borderRadius: 14, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: t.cardBorder },
  colRow: {
    padding: 12, borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  colName: { color: t.ink, fontSize: 13, fontFamily: fonts[700], marginBottom: 2 },
  colDesc: { color: t.muted, fontSize: 12 },
  exampleBox: { backgroundColor: t.accentSoft, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.accent },
  exampleTitle: { color: t.accent, fontSize: 11, fontFamily: fonts[700], marginBottom: 6 },
  exampleText: { color: t.inkSoft, fontSize: 11, lineHeight: 18 },
});
