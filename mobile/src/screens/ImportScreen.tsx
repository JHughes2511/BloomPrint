import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, TextInput,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { api, teamsAPI, importsAPI } from '../api/client';
import { Team } from '../types';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

// API output_type keys — labels come from the importScreen.outputTypes.* catalog.
const OUTPUT_TYPE_KEYS = [
  'player_eval',
  'box_score',
  'scouting_report',
  'film_breakdown',
  'coaching_report',
  'recruitment_profile',
  'game_analysis',
];

import { COMPETITION_LEVELS as CANON_LEVELS } from '../constants/levels';
const LEVELS = [...CANON_LEVELS];

// Catalog keys under importScreen.templateColumns.* / importScreen.rosterColumns.*
const TEMPLATE_COLUMN_KEYS = [
  'playerName', 'position', 'competitionLevel', 'overallGrade', 'offensiveSkills',
  'defense', 'physical', 'intangibles', 'advanced', 'strategicFit',
  'greenFlags', 'watchFlags', 'notes',
];

const ROSTER_COLUMN_KEYS = ['playerName', 'position', 'height', 'wingspan', 'competitionLevel'];

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
  const { t: tr } = useTranslation();
  const { coach } = useAuth();
  const styles = makeStyles(t);
  const isRosterMode = route.params?.mode === 'roster';

  const [file, setFile] = useState<{ uri: string; name: string; type?: string } | null>(null);
  const [outputType, setOutputType] = useState('player_eval');
  const [level, setLevel] = useState((coach as any)?.competition_level ?? 'HS Varsity');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  // AI preview flow: extracted players the coach confirms before committing.
  const [preview, setPreview] = useState<any[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Roster mode: create new team or pick existing
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);

  useEffect(() => {
    teamsAPI.list().then(setTeams).catch(() => {});
  }, []);

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (!res.canceled && res.assets[0]) {
      const a = res.assets[0];
      setFile({ uri: a.uri, name: a.name, type: a.mimeType ?? 'application/octet-stream' });
      setResult(null);
      setPreview(null);
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
      Alert.alert(tr('common.error'), tr('importScreen.couldNotCreateTeam'));
    } finally {
      setCreatingTeam(false);
    }
  };

  // Step 1: AI reads any file and extracts the roster for the coach to confirm.
  const analyzeFile = async () => {
    if (!file) {
      Alert.alert(tr('importScreen.selectFileTitle'), tr('importScreen.selectFileMsg'));
      return;
    }
    setAnalyzing(true);
    try {
      const res = await importsAPI.rosterPreview({ uri: file.uri, name: file.name, type: file.type ?? 'application/octet-stream' });
      const players = (res?.players ?? []).map((p: any) => ({ ...p, _include: true }));
      if (!players.length) {
        Alert.alert(tr('importScreen.nothingFoundTitle'), tr('importScreen.nothingFoundMsg'));
      }
      setPreview(players);
    } catch (e: any) {
      Alert.alert(tr('importScreen.importErrorTitle'), e?.response?.data?.detail ?? tr('importScreen.couldNotReadFile'));
    } finally {
      setAnalyzing(false);
    }
  };

  // Step 2: commit the confirmed players.
  const commitPlayers = async () => {
    if (!preview) return;
    const players = preview.filter(p => p._include).map(({ _include, ...rest }) => rest);
    if (!players.length) { Alert.alert(tr('importScreen.noPlayersSelectedTitle'), tr('importScreen.noPlayersSelectedMsg')); return; }
    if (isRosterMode && !selectedTeamId) {
      Alert.alert(tr('importScreen.teamRequiredTitle'), tr('importScreen.teamRequiredMsg'));
      return;
    }
    setUploading(true);
    try {
      const res = await importsAPI.rosterCommit({ team_id: selectedTeamId, competition_level: level, players });
      setResult({ players_created: res.created, players_found: res.updated, evaluations_created: 0, rows_processed: players.length, errors: [] });
      setPreview(null);
    } catch (e: any) {
      Alert.alert(tr('importScreen.importErrorTitle'), e?.response?.data?.detail ?? tr('importScreen.couldNotImportPlayers'));
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
            <Text style={styles.title}>{isRosterMode ? tr('importScreen.titleRoster') : tr('importScreen.titlePlayers')}</Text>
            <Text style={styles.sub}>
              {isRosterMode ? tr('importScreen.subRoster') : tr('importScreen.subPlayers')}
            </Text>
          </View>
        </View>

        {/* ── ROSTER MODE: Team selector ── */}
        {isRosterMode && (
          <View style={styles.teamSection}>
            <Text style={styles.label}>{tr('importScreen.teamRequiredLabel')}</Text>
            <Text style={styles.hint}>{tr('importScreen.teamHint')}</Text>

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
                placeholder={tr('importScreen.createTeamPlaceholder')}
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
                  : <Text style={styles.createTeamBtnText}>{tr('common.create')}</Text>
                }
              </TouchableOpacity>
            </View>

            {/* Existing team picker */}
            {teams.length > 0 && (
              <>
                <TouchableOpacity style={styles.teamPickerToggle} onPress={() => setShowTeamPicker(v => !v)}>
                  <Text style={styles.teamPickerToggleText}>{tr('importScreen.orSelectExisting')}</Text>
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

        {/* File picker — any file type */}
        <Text style={styles.label}>{tr('importScreen.fileLabel')}</Text>
        <Text style={styles.hint}>{tr('importScreen.fileHint')}</Text>
        <TouchableOpacity style={[styles.filePicker, file && styles.filePickerDone]} onPress={pickFile}>
          <Ionicons
            name={file ? 'document-text' : 'cloud-upload-outline'}
            size={28}
            color={file ? t.positive : t.muted}
          />
          <Text style={[styles.filePickerText, file && { color: t.positive }]}>
            {file ? file.name : tr('importScreen.tapToSelectFile')}
          </Text>
        </TouchableOpacity>

        {/* Default competition level — shown for both modes */}
        <Text style={styles.label}>{tr('importScreen.defaultLevelLabel')}</Text>
        <Text style={styles.hint}>{tr('importScreen.defaultLevelHint')}</Text>
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
            <Text style={styles.label}>{tr('importScreen.defaultReportType')}</Text>
            <Text style={styles.hint}>{tr('importScreen.defaultReportHint')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              {OUTPUT_TYPE_KEYS.map(key => (
                <TouchableOpacity
                  key={key}
                  style={[styles.chip, outputType === key && styles.chipActive]}
                  onPress={() => setOutputType(key)}
                >
                  <Text style={[styles.chipText, outputType === key && styles.chipTextActive]}>{tr(`importScreen.outputTypes.${key}`)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {teams.length > 0 && (
              <>
                <Text style={styles.label}>{tr('importScreen.assignToTeam')}</Text>
                <Text style={styles.hint}>{tr('importScreen.assignToTeamHint')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 24 }}>
                  <TouchableOpacity
                    style={[styles.chip, selectedTeamId == null && styles.chipActive]}
                    onPress={() => setSelectedTeamId(null)}
                  >
                    <Text style={[styles.chipText, selectedTeamId == null && styles.chipTextActive]}>{tr('importScreen.noTeamChip')}</Text>
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

        {/* Step 1 — analyze the file with AI */}
        {!preview && (
          <TouchableOpacity
            style={[styles.uploadBtn, !file && styles.uploadBtnDisabled]}
            onPress={analyzeFile}
            disabled={analyzing || !file}
            activeOpacity={0.85}
          >
            {analyzing
              ? <><ActivityIndicator color={t.ctaText} /><Text style={styles.uploadText}>  {tr('importScreen.readingFile')}</Text></>
              : <><Ionicons name="sparkles" size={18} color={t.ctaText} /><Text style={styles.uploadText}>  {tr('importScreen.analyzeFile')}</Text></>
            }
          </TouchableOpacity>
        )}

        {/* Step 2 — preview + confirm */}
        {preview && (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.label}>{tr('importScreen.previewCount', { count: preview.filter(p => p._include).length })}</Text>
            <Text style={styles.hint}>{tr('importScreen.previewHint')}</Text>
            {preview.map((p, i) => (
              <TouchableOpacity
                key={i}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.card, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: p._include ? t.positive : t.line, opacity: p._include ? 1 : 0.5 }}
                onPress={() => setPreview(prev => prev!.map((x, xi) => xi === i ? { ...x, _include: !x._include } : x))}
              >
                <Ionicons name={p._include ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={p._include ? t.positive : t.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[700] }}>
                    {p.jersey_number ? `#${p.jersey_number} ` : ''}{p.name}
                  </Text>
                  <Text style={{ color: t.muted2, fontSize: 11, marginTop: 2 }}>
                    {[p.position, p.height, p.wingspan ? tr('importScreen.wingspanShort', { value: p.wingspan }) : '', p.school_name].filter(Boolean).join(' · ') || tr('importScreen.noExtraDetails')}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TouchableOpacity style={[styles.uploadBtn, { flex: 1, backgroundColor: t.chip }]} onPress={() => setPreview(null)}>
                <Ionicons name="refresh" size={16} color={t.ink} /><Text style={[styles.uploadText, { color: t.ink }]}>  {tr('importScreen.redo')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.uploadBtn, { flex: 1.6 }, (isRosterMode && !selectedTeamId) && styles.uploadBtnDisabled]}
                onPress={commitPlayers}
                disabled={uploading}
                activeOpacity={0.85}
              >
                {uploading
                  ? <><ActivityIndicator color={t.ctaText} /><Text style={styles.uploadText}>  {tr('importScreen.importing')}</Text></>
                  : <><Ionicons name="cloud-upload" size={18} color={t.ctaText} /><Text style={styles.uploadText}>  {tr('importScreen.importCount', { count: preview.filter(p => p._include).length })}</Text></>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Result */}
        {result && (
          <View style={styles.resultBox}>
            <Text style={styles.resultTitle}>{tr('importScreen.importComplete')}</Text>
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{result.rows_processed}</Text>
                <Text style={styles.statLabel}>{tr('importScreen.rowsRead')}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statNum, { color: t.positive }]}>{result.players_created}</Text>
                <Text style={styles.statLabel}>{tr('importScreen.playersAdded')}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statNum, { color: t.accent }]}>{result.players_found}</Text>
                <Text style={styles.statLabel}>{tr('importScreen.playersMatched')}</Text>
              </View>
              {!isRosterMode && (
                <View style={styles.stat}>
                  <Text style={[styles.statNum, { color: t.accent }]}>{result.evaluations_created}</Text>
                  <Text style={styles.statLabel}>{tr('importScreen.evalsCreated')}</Text>
                </View>
              )}
            </View>
            {result.errors.length > 0 && (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>{tr('importScreen.errorsCount', { count: result.errors.length })}</Text>
                {result.errors.map((e, i) => (
                  <Text key={i} style={styles.errorText}>· {e}</Text>
                ))}
              </View>
            )}
            <TouchableOpacity style={styles.doneBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.doneBtnText}>{isRosterMode ? tr('importScreen.backToRoster') : tr('importScreen.goToRoster')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Column guide */}
        <Text style={[styles.label, { marginTop: 32 }]}>{tr('importScreen.expectedColumns')}</Text>
        <Text style={styles.hint}>{tr('importScreen.expectedColumnsHint')}</Text>
        <View style={styles.columnGuide}>
          {(isRosterMode ? ROSTER_COLUMN_KEYS : TEMPLATE_COLUMN_KEYS).map((colKey) => (
            <View key={colKey} style={styles.colRow}>
              <Text style={styles.colName}>{tr(`importScreen.${isRosterMode ? 'rosterColumns' : 'templateColumns'}.${colKey}.name`)}</Text>
              <Text style={styles.colDesc}>{tr(`importScreen.${isRosterMode ? 'rosterColumns' : 'templateColumns'}.${colKey}.desc`)}</Text>
            </View>
          ))}
        </View>

        {!isRosterMode && (
          <View style={styles.exampleBox}>
            <Text style={styles.exampleTitle}>{tr('importScreen.exampleRow')}</Text>
            <Text style={styles.exampleText}>{tr('importScreen.exampleText')}</Text>
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
