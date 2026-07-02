import React, { useEffect, useState, useRef } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform, Modal,
  findNodeHandle,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { renderReport } from '../utils/renderReport';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { gameReportsAPI, teamsAPI, playerAPI, staffSharingAPI, coachesAPI } from '../api/client';
import ShareModal from '../components/ShareModal';
import { outputTypeLabel } from '../utils/reportType';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import { mdToHtml, safeFileName, wrapPrintDocument } from '../utils/mdToHtml';
import { useAuth } from '../context/AuthContext';

const OUTPUT_TYPES = [
  { key: 'coaching_report', label: 'Coaching Report' },
  { key: 'game_analysis', label: 'Game Analysis' },
  { key: 'scouting_report', label: 'Scouting Report' },
  { key: 'film_breakdown', label: 'Film Breakdown' },
  { key: 'box_score', label: 'Box Score' },
  { key: 'team_training', label: 'Team Training' },
  { key: 'game_situational', label: 'Game Situational' },
];

const MODES = [
  { key: 'vs_opponent', label: 'My Program vs Opponent' },
  { key: 'my_program', label: 'My Program' },
  { key: 'opponent_only', label: 'Opponent Only' },
];

/** Strip markdown for plain-text clip preview snippets */
function stripMarkdownForPreview(text: string): string {
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*[-=—─]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function GameReportBuilderScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { coach } = useAuth();
  const { t } = useTheme();
  const styles = makeStyles(t);

  const existingId: number | undefined = route.params?.reportId;

  const [report, setReport] = useState<any>(null);
  const [reportId, setReportId] = useState<number | null>(existingId ?? null);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [uploadingClip, setUploadingClip] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState<'box_score' | 'scouting_notes' | null>(null);

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

  // Correction for main report
  const [correctionText, setCorrectionText] = useState('');
  const [correcting, setCorrecting] = useState(false);

  // Clip modal
  const [clipModal, setClipModal] = useState<any | null>(null);
  const [clipCorrectionText, setClipCorrectionText] = useState('');
  const [clipCorrecting, setClipCorrecting] = useState(false);

  // Unified share modal (player / team / staff)
  const [showShareModal, setShowShareModal] = useState(false);

  // Share modal
  const [showShare, setShowShare] = useState(false);
  const [shareMode, setShareMode] = useState<'player' | 'staff'>('player');
  const [shareSearch, setShareSearch] = useState('');
  const [shareResults, setShareResults] = useState<any[]>([]);
  const [shareSearchLoading, setShareSearchLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [allowRegenerate, setAllowRegenerate] = useState(false);
  const shareDebounce = useRef<any>(null);

  const scrollRef = useRef<ScrollView>(null);
  // Y positions captured via onLayout (direct ScrollView children only)
  const boxScoreY = useRef(0);
  const scoutingY = useRef(0);
  const focusPromptY = useRef(0);

  const scrollTo = (y: number) =>
    setTimeout(() => scrollRef.current?.scrollTo({ y: y - 80, animated: true }), 200);

  useEffect(() => {
    teamsAPI.list().then(setTeams).catch(() => {});
    if (existingId) {
      gameReportsAPI.get(existingId).then(r => {
        setReport(r);
        populateFromReport(r);
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      gameReportsAPI.create({ mode: 'vs_opponent', output_type: 'coaching_report' }).then(r => {
        setReport(r);
        setReportId(r.id);
        populateFromReport(r);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, []);

  // Share search debounce
  useEffect(() => {
    if (!showShare) return;
    clearTimeout(shareDebounce.current);
    if (!shareSearch.trim()) { setShareResults([]); return; }
    setShareSearchLoading(true);
    shareDebounce.current = setTimeout(async () => {
      try {
        const results = shareMode === 'staff'
          ? await coachesAPI.search(shareSearch.trim())
          : await playerAPI.searchPlayerUsers(shareSearch.trim());
        setShareResults(results);
      } catch {}
      setShareSearchLoading(false);
    }, 400);
  }, [shareSearch, showShare, shareMode]);

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
      { text: 'My Team', onPress: () => uploadClip(asset, 'my_team') },
      { text: 'Opponent', onPress: () => uploadClip(asset, 'opponent') },
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
      await gameReportsAPI.addClip(reportId, form);
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

  const applyClipCorrection = async () => {
    if (!reportId || !clipModal || !clipCorrectionText.trim()) return;
    setClipCorrecting(true);
    try {
      const updated = await gameReportsAPI.correctClip(reportId, clipModal.id, clipCorrectionText.trim());
      setClipModal(updated);
      setClipCorrectionText('');
      // Refresh full report so clips list updates
      const refreshed = await gameReportsAPI.get(reportId);
      setReport(refreshed);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not apply correction');
    } finally {
      setClipCorrecting(false);
    }
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
      let updated;
      if (outputType === 'team_training') {
        updated = await gameReportsAPI.teamTraining(reportId, focusPrompt || undefined);
      } else {
        updated = await gameReportsAPI.generate(reportId);
      }
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

  const sendReport = async (target: any) => {
    if (!report?.report_text) return;
    setSharing(true);
    try {
      if (shareMode === 'staff' && reportId) {
        await staffSharingAPI.share({
          report_type: 'game',
          report_id: reportId,
          recipient_id: target.id,
          allow_regenerate: allowRegenerate,
        });
      } else {
        await playerAPI.shareTeamReport({
          output_type: report.output_type ?? 'coaching_report',
          report_text: report.report_text,
          target_type: 'player',
          player_user_id: target.id,
        });
      }
      setShowShare(false);
      setShareSearch('');
      setShareResults([]);
      Alert.alert('Sent!', `Report sent to ${target.name}.`);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not send report');
    } finally {
      setSharing(false);
    }
  };

  const reportTypeLabel = () =>
    report?.output_type ? outputTypeLabel(report.output_type) : 'Game Report';

  const exportPdf = async () => {
    if (!report?.report_text) return;
    try {
      const now = new Date();
      const title_label = report.title || matchupLabel();
      const html = wrapPrintDocument({
        title: title_label,
        subtitle: coach?.program_name ?? '',
        date: now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        bodyHtml: mdToHtml(report.report_text),
      });
      const { uri } = await Print.printToFileAsync({ html });
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const fileName = `${safeFileName(reportTypeLabel())} - ${safeFileName(title_label)} - ${stamp}`;
      const dest = FileSystem.cacheDirectory + fileName + '.pdf';
      await FileSystem.copyAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: fileName });
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
      <ScreenBackground>
        <View style={styles.center}>
          <ActivityIndicator color={t.accent} size="large" />
        </View>
      </ScreenBackground>
    );
  }

  const clips: any[] = report?.clips ?? [];

  return (
    <ScreenBackground>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <KeyboardAwareScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
          <VoiceTextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            onBlur={() => save({ title: title.trim() || null })}
            placeholder="Game Report Title..."
            placeholderTextColor={t.muted2}
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
              <Ionicons name={showMyTeamPicker ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted} />
            </TouchableOpacity>
            {showMyTeamPicker && (
              <View style={styles.pickerList}>
                {teams.map(t => (
                  <TouchableOpacity key={t.id} style={[styles.pickerItem, myTeamId === t.id && styles.pickerItemActive]}
                    onPress={() => { setMyTeamId(t.id); setShowMyTeamPicker(false); save({ my_team_id: t.id }); }}>
                    <Text style={[styles.pickerItemText, myTeamId === t.id && { color: t.ink }]}>{t.name}</Text>
                    {myTeamId === t.id && <Ionicons name="checkmark" size={14} color={t.accent} />}
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
              <Ionicons name={showOppTeamPicker ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted} />
            </TouchableOpacity>
            {showOppTeamPicker && (
              <View style={styles.pickerList}>
                <VoiceTextInput
                  style={styles.oppNameInput}
                  placeholder="Or type opponent name..."
                  placeholderTextColor={t.muted2}
                  value={oppName}
                  onChangeText={txt => { setOppName(txt); setOppTeamId(null); }}
                  onBlur={() => save({ opponent_name: oppName.trim() || null, opponent_team_id: null })}
                />
                {teams.map(tm => (
                  <TouchableOpacity key={tm.id} style={[styles.pickerItem, oppTeamId === tm.id && styles.pickerItemActive]}
                    onPress={() => { setOppTeamId(tm.id); setOppName(''); setShowOppTeamPicker(false); save({ opponent_team_id: tm.id, opponent_name: null }); }}>
                    <Text style={[styles.pickerItemText, oppTeamId === tm.id && { color: t.ink }]}>{tm.name}</Text>
                    {oppTeamId === tm.id && <Ionicons name="checkmark" size={14} color={t.accent} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Output type — select one or more to combine into a comprehensive report */}
        <Text style={styles.label}>Report Type</Text>
        <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8, marginLeft: 2 }}>
          Tap multiple to combine them into one comprehensive report.
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
          {OUTPUT_TYPES.map(t => {
            const selected = outputType.split(',').filter(Boolean);
            const isOn = selected.includes(t.key);
            return (
              <TouchableOpacity key={t.key}
                style={[styles.chip, isOn && styles.chipActive]}
                onPress={() => {
                  const next = isOn ? selected.filter(k => k !== t.key) : [...selected, t.key];
                  const joined = (next.length ? next : [t.key]).join(',');
                  setOutputType(joined); save({ output_type: joined });
                }}>
                <Text style={[styles.chipText, isOn && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Film clips */}
        <View style={styles.sectionHeader}>
          <Text style={styles.label}>Film</Text>
          <TouchableOpacity style={styles.addBtn} onPress={pickClip} disabled={uploadingClip}>
            {uploadingClip
              ? <ActivityIndicator color={t.ctaText} size="small" />
              : <><Ionicons name="add" size={14} color={t.ctaText} /><Text style={styles.addBtnText}>Add Film</Text></>
            }
          </TouchableOpacity>
        </View>
        {clips.length === 0 ? (
          <Text style={styles.emptyHint}>No film added yet. Tap "Add Film" to upload a clip.</Text>
        ) : (
          clips.map((clip: any) => (
            <TouchableOpacity
              key={clip.id}
              style={styles.clipCard}
              onPress={() => { setClipModal(clip); setClipCorrectionText(''); }}
              onLongPress={() => Alert.alert('Delete clip?', '', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteClip(clip.id) },
              ])}
            >
              <View style={[styles.clipLabel, clip.label === 'my_team' ? styles.clipLabelMy : styles.clipLabelOpp]}>
                <Text style={styles.clipLabelText}>{clip.label === 'my_team' ? 'My Team' : 'Opponent'}</Text>
              </View>
              <Text style={styles.clipAnalysis} numberOfLines={2}>
                {clip.analysis_text ? stripMarkdownForPreview(clip.analysis_text).slice(0, 120) + '...' : 'Analyzing...'}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={t.muted2} />
            </TouchableOpacity>
          ))
        )}

        {/* Box Score */}
        <View onLayout={e => { boxScoreY.current = e.nativeEvent.layout.y; }}>
          <View style={styles.sectionHeader}>
            <Text style={styles.label}>Box Score / Stats</Text>
            <TouchableOpacity style={styles.importBtn} onPress={() => pickDoc('box_score')} disabled={uploadingDoc === 'box_score'}>
              {uploadingDoc === 'box_score'
                ? <ActivityIndicator color={t.muted} size="small" />
                : <><Ionicons name="document-outline" size={14} color={t.muted} /><Text style={styles.importBtnText}>Import</Text></>
              }
            </TouchableOpacity>
          </View>
          <VoiceTextInput
            style={styles.textArea}
            placeholder="Paste box score, stats, or game data..."
            placeholderTextColor={t.muted2}
            value={boxScore}
            onChangeText={setBoxScore}

            onBlur={() => save({ box_score: boxScore.trim() || null })}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Scouting Notes */}
        <View onLayout={e => { scoutingY.current = e.nativeEvent.layout.y; }}>
          <View style={styles.sectionHeader}>
            <Text style={styles.label}>Scouting Notes</Text>
            <TouchableOpacity style={styles.importBtn} onPress={() => pickDoc('scouting_notes')} disabled={uploadingDoc === 'scouting_notes'}>
              {uploadingDoc === 'scouting_notes'
                ? <ActivityIndicator color={t.muted} size="small" />
                : <><Ionicons name="document-outline" size={14} color={t.muted} /><Text style={styles.importBtnText}>Import</Text></>
              }
            </TouchableOpacity>
          </View>
          <VoiceTextInput
            style={styles.textArea}
            placeholder="Add scouting notes, observations, tendencies..."
            placeholderTextColor={t.muted2}
            value={scoutingNotes}
            onChangeText={setScoutingNotes}

            onBlur={() => save({ scouting_notes: scoutingNotes.trim() || null })}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Focus */}
        <View onLayout={e => { focusPromptY.current = e.nativeEvent.layout.y; }}>
          <Text style={styles.label}>Coach Focus (optional)</Text>
          <VoiceTextInput
            style={[styles.textArea, { minHeight: 60 }]}
            placeholder="e.g. Upcoming tournament, press defense scheme..."
            placeholderTextColor={t.muted2}
            value={focusPrompt}
            onChangeText={setFocusPrompt}

            onBlur={() => save({ focus_prompt: focusPrompt.trim() || null })}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Generate */}
        <TouchableOpacity style={styles.generateBtn} onPress={generate} disabled={generating}>
          {generating
            ? <><ActivityIndicator color={t.ctaText} /><Text style={styles.generateText}>  Generating...</Text></>
            : <><Ionicons name="sparkles" size={18} color={t.ctaText} /><Text style={styles.generateText}>  Generate Report</Text></>
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
              {renderReport(report.report_text, { heading: t.ink, body: t.inkSoft })}
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={exportPdf}>
                <Ionicons name="share-outline" size={16} color={t.muted} />
                <Text style={styles.actionText}>Export PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => Print.printAsync({ html: wrapPrintDocument({ title: report.title || matchupLabel(), subtitle: coach?.program_name ?? '', date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), bodyHtml: mdToHtml(report.report_text) }) })}>
                <Ionicons name="print-outline" size={16} color={t.muted} />
                <Text style={styles.actionText}>Print</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => setShowShareModal(true)}>
                <Ionicons name="share-social-outline" size={16} color={t.muted} />
                <Text style={styles.actionText}>Share</Text>
              </TouchableOpacity>
            </View>

            {/* Correction section */}
            <View style={styles.correctionSection}>
              <Text style={styles.correctionLabel}>Make a Correction</Text>
              <VoiceTextInput
                style={styles.correctionInput}
                placeholder="e.g. The point guard is actually a better defender than scorer..."
                placeholderTextColor={t.muted2}
                value={correctionText}
                onChangeText={setCorrectionText}

                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.correctionBtn, (!correctionText.trim() || correcting) && { opacity: 0.5 }]}
                onPress={applyCorrection}
                disabled={!correctionText.trim() || correcting}
              >
                {correcting
                  ? <><ActivityIndicator color={t.ctaText} size="small" /><Text style={styles.correctionBtnText}>  Updating...</Text></>
                  : <><Ionicons name="checkmark-circle" size={16} color={t.ctaText} /><Text style={styles.correctionBtnText}>  Apply Correction</Text></>
                }
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      {/* Clip analysis modal */}
      <Modal visible={!!clipModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={[styles.clipLabel, clipModal?.label === 'my_team' ? styles.clipLabelMy : styles.clipLabelOpp]}>
                <Text style={styles.clipLabelText}>{clipModal?.label === 'my_team' ? 'My Team Film' : 'Opponent Film'}</Text>
              </View>
              <TouchableOpacity onPress={() => setClipModal(null)} style={{ marginLeft: 'auto' }}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <KeyboardAwareScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {clipModal?.analysis_text
                ? renderReport(clipModal.analysis_text, { heading: t.ink, body: t.inkSoft })
                : <Text style={{ color: t.muted }}>No analysis yet.</Text>
              }
            </KeyboardAwareScrollView>
            <Text style={[styles.correctionLabel, { marginTop: 16 }]}>Correct This Analysis</Text>
            <VoiceTextInput
              style={styles.correctionInput}
              placeholder="What needs to be updated in this film analysis?"
              placeholderTextColor={t.muted2}
              value={clipCorrectionText}
              onChangeText={setClipCorrectionText}
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.correctionBtn, (!clipCorrectionText.trim() || clipCorrecting) && { opacity: 0.5 }]}
              onPress={applyClipCorrection}
              disabled={!clipCorrectionText.trim() || clipCorrecting}
            >
              {clipCorrecting
                ? <><ActivityIndicator color={t.ctaText} size="small" /><Text style={styles.correctionBtnText}>  Updating...</Text></>
                : <><Ionicons name="checkmark-circle" size={16} color={t.ctaText} /><Text style={styles.correctionBtnText}>  Apply Correction</Text></>
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Unified Share modal — player / team / staff */}
      {report && showShareModal && (
        <ShareModal
          visible={showShareModal}
          onClose={() => setShowShareModal(false)}
          reportType="game"
          reportId={reportId ?? 0}
          outputType={report.output_type ?? 'coaching_report'}
          reportText={report.report_text ?? ''}
          title={report.title || matchupLabel()}
        />
      )}

      {/* Share modal */}
      <Modal visible={showShare} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Send Report</Text>
              <TouchableOpacity onPress={() => setShowShare(false)}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            {/* Mode selector */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <TouchableOpacity
                style={[styles.chip, shareMode === 'player' && styles.chipActive, { flex: 1 }]}
                onPress={() => { setShareMode('player'); setShareSearch(''); setShareResults([]); }}
              >
                <Text style={[styles.chipText, shareMode === 'player' && styles.chipTextActive]}>Player</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, shareMode === 'staff' && styles.chipActive, { flex: 1 }]}
                onPress={() => { setShareMode('staff'); setShareSearch(''); setShareResults([]); }}
              >
                <Text style={[styles.chipText, shareMode === 'staff' && styles.chipTextActive]}>Staff</Text>
              </TouchableOpacity>
            </View>
            {shareMode === 'staff' && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, backgroundColor: t.chip, borderRadius: 8, padding: 12 }}>
                <Text style={{ color: t.inkSoft, fontSize: 13 }}>Allow recipient to regenerate</Text>
                <TouchableOpacity
                  onPress={() => setAllowRegenerate(v => !v)}
                  style={{ width: 40, height: 22, borderRadius: 11, backgroundColor: allowRegenerate ? t.accent : t.line, justifyContent: 'center', paddingHorizontal: 2 }}
                >
                  <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: t.ink, alignSelf: allowRegenerate ? 'flex-end' : 'flex-start' }} />
                </TouchableOpacity>
              </View>
            )}
            <Text style={{ color: t.muted, fontSize: 12, marginBottom: 10 }}>
              {shareMode === 'staff' ? 'Search for a coach, trainer, or scout to share this report.' : 'Search for a player to send this report to their inbox.'}
            </Text>
            <VoiceTextInput
              style={styles.searchInput}
              placeholder="Type a name to search..."
              placeholderTextColor={t.muted}
              value={shareSearch}
              onChangeText={setShareSearch}
              autoFocus
            />
            {shareSearchLoading && <ActivityIndicator color={t.muted} size="small" style={{ marginTop: 8 }} />}
            <ScrollView style={{ maxHeight: 260, marginTop: 8 }} keyboardShouldPersistTaps="handled">
              {shareResults.map(r => (
                <TouchableOpacity key={r.id} style={styles.searchResult} onPress={() => sendReport(r)} disabled={sharing}>
                  <View style={styles.searchAvatar}>
                    <Text style={{ color: t.ink, fontWeight: '700' }}>{r.name?.[0] ?? '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontWeight: '600' }}>{r.name}</Text>
                    <Text style={{ color: t.muted, fontSize: 12 }}>{r.email}</Text>
                  </View>
                  {sharing ? <ActivityIndicator color={t.accent} size="small" /> : <Ionicons name="paper-plane-outline" size={18} color={t.accent} />}
                </TouchableOpacity>
              ))}
              {shareResults.length === 0 && shareSearch.trim().length > 0 && !shareSearchLoading && (
                <Text style={{ color: t.muted2, textAlign: 'center', paddingVertical: 20 }}>No players found.</Text>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
    </ScreenBackground>
  );
}


const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, padding: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 48, marginBottom: 24, gap: 12 },
  titleInput: { flex: 1, color: t.ink, fontSize: 18, fontFamily: fonts[800], borderBottomWidth: 1, borderBottomColor: t.line, paddingBottom: 4 },
  label: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 },
  modeRow: { gap: 8, marginBottom: 20 },
  modeChip: { borderWidth: 1, borderColor: t.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  modeChipActive: { backgroundColor: t.accentSoft, borderColor: t.accent },
  modeChipText: { color: t.muted, fontSize: 13, fontFamily: fonts[600] },
  modeChipTextActive: { color: t.accent },
  card: { backgroundColor: t.card, borderRadius: 18, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: t.cardBorder },
  cardLabel: { color: t.muted, fontSize: 11, fontFamily: fonts[700], textTransform: 'uppercase', marginBottom: 8 },
  teamPicker: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  teamPickerText: { color: t.ink, fontSize: 14 },
  pickerList: { marginTop: 12, borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 10 },
  oppNameInput: { backgroundColor: t.chip, borderRadius: 10, padding: 10, color: t.ink, fontSize: 13, borderWidth: 1, borderColor: t.line, marginBottom: 8 },
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: t.divider },
  pickerItemActive: { backgroundColor: t.accentSoft, borderRadius: 8 },
  pickerItemText: { color: t.inkSoft, fontSize: 14 },
  chip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, marginRight: 8 },
  chipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  chipText: { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  chipTextActive: { color: t.ctaText },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.ctaBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  addBtnText: { color: t.ctaText, fontSize: 12, fontFamily: fonts[700] },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: t.cta2Border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  importBtnText: { color: t.cta2Text, fontSize: 12, fontFamily: fonts[700] },
  emptyHint: { color: t.muted2, fontSize: 12, marginBottom: 14, fontStyle: 'italic' },
  clipCard: { backgroundColor: t.card, borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: t.cardBorder, flexDirection: 'row', alignItems: 'center', gap: 10 },
  clipLabel: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  clipLabelMy: { backgroundColor: t.accentSoft },
  clipLabelOpp: { backgroundColor: t.negativeSoft },
  clipLabelText: { color: t.inkSoft, fontSize: 10, fontFamily: fonts[700] },
  clipAnalysis: { flex: 1, color: t.muted, fontSize: 11, lineHeight: 16 },
  textArea: { backgroundColor: t.card, borderRadius: 14, padding: 14, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 100, marginBottom: 16 },
  generateBtn: { backgroundColor: t.ctaBg, borderRadius: 999, padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  generateText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15, marginLeft: 8 },
  hint: { color: t.muted2, fontSize: 12, textAlign: 'center', marginTop: 10 },
  reportBox: { backgroundColor: t.card, borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: t.cardBorder },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderColor: t.cta2Border },
  actionText: { color: t.cta2Text, fontFamily: fonts[700], fontSize: 12 },
  correctionSection: { backgroundColor: t.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: t.cardBorder },
  correctionLabel: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 },
  correctionInput: { backgroundColor: t.chip, borderRadius: 14, padding: 12, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 80, marginBottom: 12, textAlignVertical: 'top' },
  correctionBtn: { backgroundColor: t.ctaBg, borderRadius: 999, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  correctionBtnText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 14 },
  // Modals
  modalOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  modalBox: { backgroundColor: t.sheet, borderRadius: 20, padding: 20, maxHeight: '88%', margin: 8, borderWidth: 1, borderColor: t.cardBorder },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  modalTitle: { color: t.ink, fontSize: 18, fontFamily: fonts[800], flex: 1 },
  searchInput: { backgroundColor: t.chip, borderRadius: 14, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line },
  searchResult: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: t.chip, marginBottom: 8 },
  searchAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
});
