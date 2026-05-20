import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { gameReportsAPI, teamsAPI, playerAPI } from '../api/client';
import { mdToHtml, safeFileName } from '../utils/mdToHtml';
import { useAuth } from '../context/AuthContext';

const OUTPUT_TYPES = [
  { key: 'coaching_report', label: 'Coaching Report' },
  { key: 'game_analysis', label: 'Game Analysis' },
  { key: 'scouting_report', label: 'Scouting Report' },
  { key: 'film_breakdown', label: 'Film Breakdown' },
  { key: 'box_score', label: 'Box Score' },
];

const MODES = [
  { key: 'vs_opponent', label: 'My Program vs Opponent' },
  { key: 'my_program', label: 'My Program' },
  { key: 'opponent_only', label: 'Opponent Only' },
];

function cleanMarkdown(text: string): string {
  return text
    .split('\n')
    .map(line => {
      if (/^\s*\*{1,2}\s*$/.test(line)) return '';
      return line.replace(/\*\*\s*$/, '').replace(/^\s*\*\*\s*/, '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function GameReportBuilderScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { coach } = useAuth();

  const existingId: number | undefined = route.params?.reportId;

  const [report, setReport] = useState<any>(null);
  const [reportId, setReportId] = useState<number | null>(existingId ?? null);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [uploadingClip, setUploadingClip] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState<'box_score' | 'scouting_notes' | null>(null);

  // Local editable fields (auto-save on blur)
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState('vs_opponent');
  const [myTeamId, setMyTeamId] = useState<number | null>(null);
  const [oppTeamId, setOppTeamId] = useState<number | null>(null);
  const [oppName, setOppName] = useState('');
  const [outputType, setOutputType] = useState('coaching_report');
  const [focusPrompt, setFocusPrompt] = useState('');
  const [boxScore, setBoxScore] = useState('');
  const [scoutingNotes, setScoutingNotes] = useState('');

  const [showMyTeamPicker, setShowMyTeamPicker] = useState(false);
  const [showOppTeamPicker, setShowOppTeamPicker] = useState(false);
  const [correctionText, setCorrectionText] = useState('');
  const [correcting, setCorrecting] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const boxScoreY = useRef(0);
  const scoutingY = useRef(0);
  const focusPromptY = useRef(0);
  const correctionY = useRef(0);

  // Load or create on mount
  useEffect(() => {
    teamsAPI.list().then(setTeams).catch(() => {});
    if (existingId) {
      gameReportsAPI.get(existingId).then(r => {
        setReport(r);
        populateFromReport(r);
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      // Create new
      gameReportsAPI.create({ mode: 'vs_opponent', output_type: 'coaching_report' }).then(r => {
        setReport(r);
        setReportId(r.id);
        populateFromReport(r);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, []);

  const populateFromReport = (r: any) => {
    setTitle(r.title ?? '');
    setMode(r.mode ?? 'vs_opponent');
    setMyTeamId(r.my_team_id ?? null);
    setOppTeamId(r.opponent_team_id ?? null);
    setOppName(r.opponent_name ?? '');
    setOutputType(r.output_type ?? 'coaching_report');
    setFocusPrompt(r.focus_prompt ?? '');
    setBoxScore(r.box_score ?? '');
    setScoutingNotes(r.scouting_notes ?? '');
  };

  const save = async (patch: any) => {
    if (!reportId) return;
    try {
      const updated = await gameReportsAPI.update(reportId, patch);
      setReport(updated);
    } catch {}
  };

  const pickClip = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    Alert.alert('Whose film is this?', '', [
      {
        text: 'My Team',
        onPress: () => uploadClip(asset, 'my_team'),
      },
      {
        text: 'Opponent',
        onPress: () => uploadClip(asset, 'opponent'),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const uploadClip = async (asset: any, label: string) => {
    if (!reportId) return;
    setUploadingClip(true);
    try {
      const name = asset.fileName ?? asset.uri.split('/').pop() ?? 'clip.mp4';
      const form = new FormData();
      form.append('video', { uri: asset.uri, name, type: 'video/mp4' } as any);
      form.append('label', label);
      const updated = await gameReportsAPI.addClip(reportId, form);
      // Refresh full report to get clips
      const refreshed = await gameReportsAPI.get(reportId);
      setReport(refreshed);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not upload clip');
    } finally {
      setUploadingClip(false);
    }
  };

  const deleteClip = async (clipId: number) => {
    if (!reportId) return;
    try {
      await gameReportsAPI.deleteClip(reportId, clipId);
      const refreshed = await gameReportsAPI.get(reportId);
      setReport(refreshed);
    } catch {}
  };

  const pickDoc = async (docType: 'box_score' | 'scouting_notes') => {
    const res = await DocumentPicker.getDocumentAsync({
      type: [
        'text/plain',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets[0]) return;
    const file = res.assets[0];
    if (!reportId) return;
    setUploadingDoc(docType);
    try {
      const form = new FormData();
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'text/plain' } as any);
      form.append('doc_type', docType);
      const updated = await gameReportsAPI.uploadDoc(reportId, form);
      setReport(updated);
      if (docType === 'box_score') setBoxScore(updated.box_score ?? '');
      else setScoutingNotes(updated.scouting_notes ?? '');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not read document');
    } finally {
      setUploadingDoc(null);
    }
  };

  const generate = async () => {
    if (!reportId) return;
    setGenerating(true);
    try {
      const updated = await gameReportsAPI.generate(reportId);
      setReport(updated);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not generate report');
    } finally {
      setGenerating(false);
    }
  };

  const applyCorrection = async () => {
    if (!reportId || !correctionText.trim()) return;
    setCorrecting(true);
    try {
      const updated = await gameReportsAPI.correct(reportId, correctionText.trim());
      setReport(updated);
      setCorrectionText('');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not apply correction');
    } finally {
      setCorrecting(false);
    }
  };

  const exportPdf = async () => {
    if (!report?.report_text) return;
    try {
      const title_label = report.title || matchupLabel();
      const html = `<html><head><meta charset="utf-8"/><style>
        body{font-family:-apple-system,Helvetica,sans-serif;padding:32px;color:#111}
        h1{font-size:20px}p.meta{font-size:13px;color:#555}
      </style></head><body>
        <h1>${title_label}</h1>
        <p class="meta">${coach?.program_name ?? ''} · ${new Date().toLocaleDateString()}</p>
        ${mdToHtml(report.report_text)}
      </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      const dest = FileSystem.cacheDirectory + safeFileName(title_label) + '.pdf';
      await FileSystem.copyAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf' });
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Could not export');
    }
  };

  const matchupLabel = () => {
    const myName = teams.find(t => t.id === myTeamId)?.name ?? coach?.program_name ?? 'My Program';
    const oppLabel = (teams.find(t => t.id === oppTeamId)?.name ?? oppName) || 'Opponent';
    if (mode === 'vs_opponent') return `${myName} vs ${oppLabel}`;
    if (mode === 'my_program') return myName;
    return oppLabel;
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#2563eb" size="large" />
      </View>
    );
  }

  const clips: any[] = report?.clips ?? [];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#0a0a0a' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            onBlur={() => save({ title: title.trim() || null })}
            placeholder="Game Report Title..."
            placeholderTextColor="#4b5563"
          />
        </View>

        {/* Mode selector */}
        <Text style={styles.label}>Report Context</Text>
        <View style={styles.modeRow}>
          {MODES.map(m => (
            <TouchableOpacity
              key={m.key}
              style={[styles.modeChip, mode === m.key && styles.modeChipActive]}
              onPress={() => { setMode(m.key); save({ mode: m.key }); }}
            >
              <Text style={[styles.modeChipText, mode === m.key && styles.modeChipTextActive]}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Team selectors */}
        {mode !== 'opponent_only' && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>My Team</Text>
            <TouchableOpacity style={styles.teamPicker} onPress={() => { setShowMyTeamPicker(v => !v); setShowOppTeamPicker(false); }}>
              <Text style={styles.teamPickerText}>
                {teams.find(t => t.id === myTeamId)?.name ?? 'Select a team...'}
              </Text>
              <Ionicons name={showMyTeamPicker ? 'chevron-up' : 'chevron-down'} size={14} color="#9ca3af" />
            </TouchableOpacity>
            {showMyTeamPicker && (
              <View style={styles.pickerList}>
                {teams.map(t => (
                  <TouchableOpacity key={t.id} style={[styles.pickerItem, myTeamId === t.id && styles.pickerItemActive]}
                    onPress={() => { setMyTeamId(t.id); setShowMyTeamPicker(false); save({ my_team_id: t.id }); }}>
                    <Text style={[styles.pickerItemText, myTeamId === t.id && { color: '#fff' }]}>{t.name}</Text>
                    {myTeamId === t.id && <Ionicons name="checkmark" size={14} color="#2563eb" />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {mode !== 'my_program' && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Opponent</Text>
            <TouchableOpacity style={styles.teamPicker} onPress={() => { setShowOppTeamPicker(v => !v); setShowMyTeamPicker(false); }}>
              <Text style={styles.teamPickerText}>
                {teams.find(t => t.id === oppTeamId)?.name ?? (oppName || 'Select or type opponent...')}
              </Text>
              <Ionicons name={showOppTeamPicker ? 'chevron-up' : 'chevron-down'} size={14} color="#9ca3af" />
            </TouchableOpacity>
            {showOppTeamPicker && (
              <View style={styles.pickerList}>
                <TextInput
                  style={styles.oppNameInput}
                  placeholder="Or type opponent name..."
                  placeholderTextColor="#4b5563"
                  value={oppName}
                  onChangeText={t => { setOppName(t); setOppTeamId(null); }}
                  onBlur={() => save({ opponent_name: oppName.trim() || null, opponent_team_id: null })}
                />
                {teams.map(t => (
                  <TouchableOpacity key={t.id} style={[styles.pickerItem, oppTeamId === t.id && styles.pickerItemActive]}
                    onPress={() => { setOppTeamId(t.id); setOppName(''); setShowOppTeamPicker(false); save({ opponent_team_id: t.id, opponent_name: null }); }}>
                    <Text style={[styles.pickerItemText, oppTeamId === t.id && { color: '#fff' }]}>{t.name}</Text>
                    {oppTeamId === t.id && <Ionicons name="checkmark" size={14} color="#2563eb" />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Output type */}
        <Text style={styles.label}>Report Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
          {OUTPUT_TYPES.map(t => (
            <TouchableOpacity key={t.key}
              style={[styles.chip, outputType === t.key && styles.chipActive]}
              onPress={() => { setOutputType(t.key); save({ output_type: t.key }); }}>
              <Text style={[styles.chipText, outputType === t.key && styles.chipTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Film clips */}
        <View style={styles.sectionHeader}>
          <Text style={styles.label}>Film</Text>
          <TouchableOpacity style={styles.addBtn} onPress={pickClip} disabled={uploadingClip}>
            {uploadingClip
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Ionicons name="add" size={14} color="#fff" /><Text style={styles.addBtnText}>Add Film</Text></>
            }
          </TouchableOpacity>
        </View>
        {clips.length === 0 ? (
          <Text style={styles.emptyHint}>No film added yet. Tap "Add Film" to upload a clip.</Text>
        ) : (
          clips.map((clip: any) => (
            <View key={clip.id} style={styles.clipCard}>
              <View style={[styles.clipLabel, clip.label === 'my_team' ? styles.clipLabelMy : styles.clipLabelOpp]}>
                <Text style={styles.clipLabelText}>{clip.label === 'my_team' ? 'My Team' : 'Opponent'}</Text>
              </View>
              <Text style={styles.clipAnalysis} numberOfLines={3}>
                {clip.analysis_text ? clip.analysis_text.slice(0, 160) + '...' : 'Analyzing...'}
              </Text>
              <TouchableOpacity onPress={() => deleteClip(clip.id)} style={styles.clipDelete}>
                <Ionicons name="trash-outline" size={14} color="#6b7280" />
              </TouchableOpacity>
            </View>
          ))
        )}

        {/* Box Score */}
        <View
          onLayout={e => { boxScoreY.current = e.nativeEvent.layout.y; }}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.label}>Box Score / Stats</Text>
            <TouchableOpacity style={styles.importBtn} onPress={() => pickDoc('box_score')} disabled={uploadingDoc === 'box_score'}>
              {uploadingDoc === 'box_score'
                ? <ActivityIndicator color="#9ca3af" size="small" />
                : <><Ionicons name="document-outline" size={14} color="#9ca3af" /><Text style={styles.importBtnText}>Import</Text></>
              }
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.textArea}
            placeholder="Paste box score, stats, or game data..."
            placeholderTextColor="#4b5563"
            value={boxScore}
            onChangeText={setBoxScore}
            onFocus={() => scrollRef.current?.scrollTo({ y: boxScoreY.current - 80, animated: true })}
            onBlur={() => save({ box_score: boxScore.trim() || null })}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Scouting Notes */}
        <View
          onLayout={e => { scoutingY.current = e.nativeEvent.layout.y; }}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.label}>Scouting Notes</Text>
            <TouchableOpacity style={styles.importBtn} onPress={() => pickDoc('scouting_notes')} disabled={uploadingDoc === 'scouting_notes'}>
              {uploadingDoc === 'scouting_notes'
                ? <ActivityIndicator color="#9ca3af" size="small" />
                : <><Ionicons name="document-outline" size={14} color="#9ca3af" /><Text style={styles.importBtnText}>Import</Text></>
              }
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.textArea}
            placeholder="Add scouting notes, observations, tendencies..."
            placeholderTextColor="#4b5563"
            value={scoutingNotes}
            onChangeText={setScoutingNotes}
            onFocus={() => scrollRef.current?.scrollTo({ y: scoutingY.current - 80, animated: true })}
            onBlur={() => save({ scouting_notes: scoutingNotes.trim() || null })}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Focus */}
        <View onLayout={e => { focusPromptY.current = e.nativeEvent.layout.y; }}>
          <Text style={styles.label}>Coach Focus (optional)</Text>
          <TextInput
            style={[styles.textArea, { minHeight: 60 }]}
            placeholder="e.g. Upcoming tournament, press defense scheme..."
            placeholderTextColor="#4b5563"
            value={focusPrompt}
            onChangeText={setFocusPrompt}
            onFocus={() => scrollRef.current?.scrollTo({ y: focusPromptY.current - 80, animated: true })}
            onBlur={() => save({ focus_prompt: focusPrompt.trim() || null })}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Generate */}
        <TouchableOpacity style={styles.generateBtn} onPress={generate} disabled={generating}>
          {generating
            ? <><ActivityIndicator color="#fff" /><Text style={styles.generateText}>  Generating...</Text></>
            : <><Ionicons name="sparkles" size={18} color="#fff" /><Text style={styles.generateText}>  Generate Report</Text></>
          }
        </TouchableOpacity>
        {generating && (
          <Text style={styles.hint}>Analyzing all sources. This may take 30–60 seconds.</Text>
        )}

        {/* Report output */}
        {report?.report_text ? (
          <View style={{ marginTop: 28 }}>
            <Text style={styles.label}>Generated Report</Text>
            <View style={styles.reportBox}>
              <Markdown style={markdownStyles}>{cleanMarkdown(report.report_text)}</Markdown>
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={exportPdf}>
                <Ionicons name="share-outline" size={18} color="#9ca3af" />
                <Text style={styles.actionText}>Export PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => Print.printAsync({ html: `<html><body>${mdToHtml(report.report_text)}</body></html>` })}>
                <Ionicons name="print-outline" size={18} color="#9ca3af" />
                <Text style={styles.actionText}>Print</Text>
              </TouchableOpacity>
            </View>

            {/* Correction section */}
            <View
              style={styles.correctionSection}
              onLayout={e => { correctionY.current = e.nativeEvent.layout.y; }}
            >
              <Text style={styles.correctionLabel}>Make a Correction</Text>
              <TextInput
                style={styles.correctionInput}
                placeholder="e.g. The point guard is actually a better defender than scorer..."
                placeholderTextColor="#4b5563"
                value={correctionText}
                onChangeText={setCorrectionText}
                onFocus={() => scrollRef.current?.scrollTo({ y: correctionY.current - 80, animated: true })}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.correctionBtn, (!correctionText.trim() || correcting) && { opacity: 0.5 }]}
                onPress={applyCorrection}
                disabled={!correctionText.trim() || correcting}
              >
                {correcting
                  ? <><ActivityIndicator color="#fff" size="small" /><Text style={styles.correctionBtnText}>  Updating...</Text></>
                  : <><Ionicons name="checkmark-circle" size={16} color="#fff" /><Text style={styles.correctionBtnText}>  Apply Correction</Text></>
                }
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const markdownStyles = {
  body: { color: '#d1d5db', fontSize: 13, lineHeight: 22 },
  heading1: { color: '#ffffff', fontSize: 16, fontWeight: '800' as const, marginTop: 16, marginBottom: 4 },
  heading2: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' as const, marginTop: 14, marginBottom: 4 },
  heading3: { color: '#9ca3af', fontSize: 13, fontWeight: '700' as const, marginTop: 12, marginBottom: 2 },
  strong: { color: '#ffffff', fontWeight: '700' as const },
  bullet_list: { marginLeft: 8 },
  list_item: { color: '#d1d5db', fontSize: 13 },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 48, marginBottom: 24, gap: 12 },
  titleInput: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '800', borderBottomWidth: 1, borderBottomColor: '#374151', paddingBottom: 4 },
  label: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  modeRow: { gap: 8, marginBottom: 20 },
  modeChip: { borderWidth: 1, borderColor: '#374151', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  modeChipActive: { backgroundColor: '#1e3a5f', borderColor: '#2563eb' },
  modeChipText: { color: '#6b7280', fontSize: 13, fontWeight: '600' },
  modeChipTextActive: { color: '#fff' },
  card: { backgroundColor: '#111827', borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#1f2937' },
  cardLabel: { color: '#6b7280', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
  teamPicker: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  teamPickerText: { color: '#fff', fontSize: 14 },
  pickerList: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#1f2937', paddingTop: 10 },
  oppNameInput: { backgroundColor: '#0a0a0a', borderRadius: 8, padding: 10, color: '#fff', fontSize: 13, borderWidth: 1, borderColor: '#374151', marginBottom: 8 },
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  pickerItemActive: { backgroundColor: '#1e3a5f22' },
  pickerItemText: { color: '#9ca3af', fontSize: 14 },
  chip: { borderWidth: 1, borderColor: '#374151', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8 },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#374151', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  importBtnText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  emptyHint: { color: '#4b5563', fontSize: 12, marginBottom: 14, fontStyle: 'italic' },
  clipCard: { backgroundColor: '#111827', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#1f2937', flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  clipLabel: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  clipLabelMy: { backgroundColor: '#1e3a5f' },
  clipLabelOpp: { backgroundColor: '#3b1515' },
  clipLabelText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  clipAnalysis: { flex: 1, color: '#6b7280', fontSize: 11, lineHeight: 16 },
  clipDelete: { padding: 4 },
  textArea: { backgroundColor: '#111827', borderRadius: 10, padding: 14, color: '#fff', fontSize: 14, borderWidth: 1, borderColor: '#1f2937', minHeight: 100, marginBottom: 16 },
  generateBtn: { backgroundColor: '#2563eb', borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  generateText: { color: '#fff', fontWeight: '700', fontSize: 16, marginLeft: 8 },
  hint: { color: '#4b5563', fontSize: 12, textAlign: 'center', marginTop: 10 },
  reportBox: { backgroundColor: '#111827', borderRadius: 12, padding: 16, marginBottom: 12 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#374151' },
  actionText: { color: '#9ca3af', fontWeight: '600', fontSize: 14 },
  correctionSection: {
    marginTop: 20, backgroundColor: '#111827', borderRadius: 12,
    padding: 16, borderWidth: 1, borderColor: '#374151',
  },
  correctionLabel: {
    color: '#9ca3af', fontSize: 11, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10,
  },
  correctionInput: {
    backgroundColor: '#0a0a0a', borderRadius: 10, padding: 12,
    color: '#fff', fontSize: 14, borderWidth: 1, borderColor: '#374151',
    minHeight: 80, marginBottom: 12, textAlignVertical: 'top',
  },
  correctionBtn: {
    backgroundColor: '#16a34a', borderRadius: 10, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  correctionBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
