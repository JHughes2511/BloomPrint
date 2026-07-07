import React, { useEffect, useState } from 'react';
import VoiceTextInput from '../../components/VoiceTextInput';
import KeyboardAwareScrollView from '../../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { playerTrainingAPI } from '../../api/playerClient';
import { PlayerComment } from '../../types';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';
import { renderReport } from '../../utils/renderReport';
import { GeneratingOverlay } from '../../components/GeneratingBasketball';
import { parseDrills } from '../../utils/trainingDrills';
import { buildPdfFileName } from '../../utils/buildReportPdf';
import { usePlayerAuth } from '../../context/PlayerAuthContext';

interface CoachTraining {
  id: number;
  program_text: string | null;
  player_program_text: string | null;
  reformatting: boolean;
  completed_drills: string[];
  priorities: string[] | null;
  coach_name: string | null;
  created_at: string;
}

export default function PlayerCoachTrainingDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { trainingId } = route.params;
  const { playerUser } = usePlayerAuth();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const markdownStyles = makeMarkdownStyles(t);

  const [training, setTraining] = useState<CoachTraining | null>(null);
  const [comments, setComments] = useState<PlayerComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [trainingCorrections, setTrainingCorrections] = useState<any[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [showCoachNotes, setShowCoachNotes] = useState(false);

  const loadCorrections = () =>
    playerTrainingAPI.coachSentCorrections(trainingId).then(setTrainingCorrections).catch(() => setTrainingCorrections([]));

  const load = () => {
    Promise.all([
      playerTrainingAPI.getCoachSent(trainingId),
      playerTrainingAPI.getCoachSentComments(trainingId),
    ]).then(([tr, c]) => {
      setTraining(tr);
      setComments(c);
      setCompleted(new Set(tr?.completed_drills ?? []));
    }).finally(() => setLoading(false));
    loadCorrections();
  };

  useEffect(() => { load(); }, [trainingId]);

  // Poll while the AI is still reformatting so it appears without a manual refresh.
  useFocusEffect(React.useCallback(() => {
    if (!training?.reformatting) return;
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [training?.reformatting]));

  const { sections: drillSections, total: drillTotal } = parseDrills(training?.player_program_text);
  const doneCount = drillSections.reduce(
    (n, s) => n + s.drills.filter(d => completed.has(d.key)).length, 0,
  );

  const toggleDrill = (key: string) => {
    setCompleted(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      playerTrainingAPI.setCoachSentProgress(trainingId, [...next]).catch(() => {});
      return next;
    });
  };

  const exportProgram = async () => {
    if (!training?.player_program_text) return;
    setExporting(true);
    try {
      const sanitize = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const date = new Date(training.created_at).toLocaleDateString();
      const bodyLines = training.player_program_text.split('\n').map(l => {
        const trimmed = l.trim();
        if (!trimmed) return '<div style="height:6px"></div>';
        const isHead = /^[A-Z0-9][A-Z0-9\s/&\-—().,':]+$/.test(trimmed.replace(/:$/, '')) || trimmed.endsWith(':');
        const clean = sanitize(trimmed.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').replace(/^\s*[-*•·]\s+/, '• '));
        return isHead ? `<h3>${clean}</h3>` : `<p>${clean}</p>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
        @page { margin: 18mm 16mm; }
        body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1f2937; font-size: 13px; line-height: 1.6; }
        h1 { font-size: 22px; font-weight: 900; color: #0f172a; margin-bottom: 2px; }
        h3 { font-size: 15px; font-weight: 800; color: #111; margin-top: 18px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
        p { margin: 4px 0; }
      </style></head><body>
        <h1>BloomPrint — Training Program</h1>
        <p style="color:#555;margin-top:0">${date}${training.coach_name ? ` · From ${sanitize(training.coach_name)}` : ''}</p>
        ${bodyLines}
        <div style="margin-top:36px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:10px">Generated by BloomPrint</div>
      </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      const dest = FileSystem.cacheDirectory
        + buildPdfFileName('Training Program', playerUser?.name ?? 'Player', new Date(training.created_at)) + '.pdf';
      await FileSystem.copyAsync({ from: uri, to: dest });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Training Program' });
      } else {
        await Print.printAsync({ html });
      }
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Could not export program');
    } finally {
      setExporting(false);
    }
  };

  const saveCorrectionForLater = async () => {
    if (!feedbackText.trim()) return;
    setSavingCorrection(true);
    try {
      await playerTrainingAPI.addCoachSentCorrection(trainingId, feedbackText.trim());
      setFeedbackText('');
      await loadCorrections();
      Alert.alert('Saved', 'Correction saved. Apply & Regenerate when ready.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to save correction');
    } finally {
      setSavingCorrection(false);
    }
  };

  const refreshTraining = async () => {
    const pending = feedbackText.trim();
    if (!pending && trainingCorrections.filter(c => !c.applied).length === 0) {
      Alert.alert('Nothing to apply', 'Add a correction first.');
      return;
    }
    setRefreshing(true);
    try {
      if (pending) await playerTrainingAPI.addCoachSentCorrection(trainingId, pending);
      const updated = await playerTrainingAPI.applyCoachSentCorrections(trainingId);
      setTraining(updated);
      setCompleted(new Set(updated?.completed_drills ?? []));
      setFeedbackText('');
      await loadCorrections();
      Alert.alert('Updated!', 'Your training program has been updated based on your corrections.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to update training');
    } finally {
      setRefreshing(false);
    }
  };

  const addComment = async () => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    try {
      const c = await playerTrainingAPI.addCoachSentComment(trainingId, commentText.trim());
      setComments(prev => [...prev, c]);
      setCommentText('');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <ScreenBackground>
        <View style={styles.center}>
          <ActivityIndicator color={t.positive} size="large" />
        </View>
      </ScreenBackground>
    );
  }

  if (!training) {
    return (
      <ScreenBackground>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <Text style={{ color: t.ink }}>Training program not found</Text>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <KeyboardAwareScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.title}>Training Program</Text>
              <View style={styles.coachTag}><Text style={styles.coachTagText}>From Coach</Text></View>
            </View>
            <Text style={styles.sub}>
              {new Date(training.created_at).toLocaleDateString()}
              {training.coach_name ? ` · ${training.coach_name}` : ''}
            </Text>
          </View>
        </View>

        {/* Coach's original notes — collapsible */}
        {training.program_text && (
          <View style={styles.section}>
            <TouchableOpacity style={styles.coachNotesToggle} onPress={() => setShowCoachNotes(v => !v)}>
              <Ionicons name="chatbubble" size={14} color={t.positive} />
              <Text style={styles.coachNotesLabel}>Coach's Notes</Text>
              <Ionicons name={showCoachNotes ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted2} style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
            {showCoachNotes && (
              <View style={styles.coachNotesBox}>
                {renderReport(training.program_text, { heading: t.ink, body: t.inkSoft })}
              </View>
            )}
          </View>
        )}

        {training.reformatting ? (
          <View style={styles.section}>
            <View style={styles.programBox}>
              <View style={styles.generatingBox}>
                <ActivityIndicator color={t.positive} />
                <Text style={styles.generatingText}>AI is preparing your training program...</Text>
              </View>
            </View>
          </View>
        ) : (
          <>
            {/* Drill tracking */}
            {drillTotal > 0 && (
              <>
                <View style={styles.progressCard}>
                  <View style={styles.progressTop}>
                    <Text style={styles.progressLabel}>This Week's Progress</Text>
                    <Text style={styles.progressCount}>{doneCount} / {drillTotal}</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${drillTotal ? (doneCount / drillTotal) * 100 : 0}%` }]} />
                  </View>
                </View>

                {drillSections.map((sec, si) => (
                  <View key={si} style={styles.section}>
                    <Text style={styles.sectionLabel}>{sec.title || 'Drills'}</Text>
                    {sec.drills.map(d => {
                      const done = completed.has(d.key);
                      return (
                        <TouchableOpacity
                          key={d.key}
                          style={[styles.drillRow, done && styles.drillRowDone]}
                          onPress={() => toggleDrill(d.key)}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.checkbox, done ? styles.checkboxDone : styles.checkboxIdle]}>
                            {done && <Ionicons name="checkmark" size={15} color="#16201A" />}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.drillLabel, done && styles.drillLabelDone]}>{d.label}</Text>
                            {d.meta ? <Text style={styles.drillMeta}>{d.meta}</Text> : null}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Your Program</Text>
              <View style={styles.programBox}>
                {training.player_program_text
                  ? <Markdown style={markdownStyles}>{training.player_program_text}</Markdown>
                  : <Text style={{ color: t.muted, fontSize: 13 }}>Not ready yet — pull to refresh.</Text>}
              </View>
            </View>

            {/* Comments */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Comments ({comments.length})</Text>
              {comments.map(c => (
                <View key={c.id} style={styles.commentCard}>
                  <View style={styles.commentHeader}>
                    <Text style={[
                      styles.commentAuthor,
                      c.coach_id ? { color: t.accent } : { color: t.positive },
                    ]}>
                      {c.author_name || 'Unknown'}
                      {c.coach_id ? ' (Coach)' : ''}
                    </Text>
                    <Text style={styles.commentDate}>{new Date(c.created_at).toLocaleDateString()}</Text>
                  </View>
                  <Text style={styles.commentText}>{c.text}</Text>
                </View>
              ))}
              <View style={styles.commentInput}>
                <VoiceTextInput
                  style={styles.input}
                  placeholder="Add a comment..."
                  placeholderTextColor={t.muted2}
                  value={commentText}
                  onChangeText={setCommentText}
                  multiline
                />
                <TouchableOpacity
                  style={styles.sendBtn}
                  onPress={addComment}
                  disabled={submitting || !commentText.trim()}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Ionicons name="send" size={18} color="#fff" />}
                </TouchableOpacity>
              </View>
            </View>

            {/* Update Report with Feedback */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Update Training with Feedback</Text>
              <View style={styles.programBox}>
                <Text style={{ color: t.muted, fontSize: 12, marginBottom: 10, lineHeight: 18 }}>
                  Share what's working, what's not, or any changes to your schedule and the AI will update your program.
                </Text>
                <VoiceTextInput
                  style={styles.input}
                  placeholder="e.g. I want more shooting drills, reduce weight sessions, focus on ball-handling..."
                  placeholderTextColor={t.muted2}
                  value={feedbackText}
                  onChangeText={setFeedbackText}
                  multiline
                  textAlignVertical="top"
                />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <TouchableOpacity
                    style={[styles.sendBtn, { flex: 1, backgroundColor: t.chip, borderRadius: 12, paddingVertical: 14 }, (savingCorrection || !feedbackText.trim()) && { opacity: 0.5 }]}
                    onPress={saveCorrectionForLater}
                    disabled={savingCorrection || !feedbackText.trim()}
                  >
                    {savingCorrection
                      ? <ActivityIndicator color={t.ink} size="small" />
                      : <Text style={{ color: t.ink, fontFamily: fonts[700], fontSize: 14 }}>Save for Later</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.sendBtn, { flex: 1, borderRadius: 12, paddingVertical: 14, flexDirection: 'row', gap: 6, justifyContent: 'center' }, refreshing && { opacity: 0.5 }]}
                    onPress={refreshTraining}
                    disabled={refreshing}
                  >
                    {refreshing
                      ? <><ActivityIndicator color="#fff" size="small" /><Text style={{ color: '#fff', fontFamily: fonts[700], fontSize: 13 }}>Updating...</Text></>
                      : <><Ionicons name="refresh" size={15} color="#fff" /><Text style={{ color: '#fff', fontFamily: fonts[700], fontSize: 13 }}>Apply & Regenerate</Text></>
                    }
                  </TouchableOpacity>
                </View>
                <GeneratingOverlay visible={refreshing} label="Updating your program…" />

                {trainingCorrections.length > 0 && (
                  <View style={{ marginTop: 14 }}>
                    {trainingCorrections.map((c: any) => (
                      <View key={c.id} style={{ backgroundColor: t.chip, borderRadius: 10, padding: 10, marginBottom: 6, opacity: c.applied ? 0.55 : 1 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                          {c.applied
                            ? <View style={{ backgroundColor: t.positiveSoft, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ color: t.positive, fontSize: 9, fontFamily: fonts[700] }}>APPLIED</Text></View>
                            : <View style={{ backgroundColor: t.card, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ color: t.muted, fontSize: 9, fontFamily: fonts[700] }}>PENDING</Text></View>}
                          <Text style={{ color: t.muted2, fontSize: 10 }}>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</Text>
                        </View>
                        <Text style={{ color: t.inkSoft, fontSize: 12.5 }}>{c.correction}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>

            {/* Export — print or send */}
            {training.player_program_text ? (
              <View style={styles.section}>
                <TouchableOpacity style={styles.exportBtn} onPress={exportProgram} disabled={exporting}>
                  {exporting
                    ? <ActivityIndicator color={t.ink} />
                    : <><Ionicons name="share-outline" size={18} color={t.ink} /><Text style={styles.exportBtnText}>Export — Print or Send</Text></>}
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}

const makeMarkdownStyles = (t: ThemeTokens) => ({
  body: { color: t.inkSoft, fontSize: 13, lineHeight: 22 },
  heading1: { color: t.ink, fontSize: 16, fontFamily: fonts[800], marginTop: 16, marginBottom: 4 },
  heading2: { color: t.ink, fontSize: 14, fontFamily: fonts[700], marginTop: 14, marginBottom: 4 },
  heading3: { color: t.muted, fontSize: 13, fontFamily: fonts[700], marginTop: 12, marginBottom: 2 },
  strong: { color: t.ink, fontFamily: fonts[700] },
  bullet_list: { marginLeft: 8 },
  list_item: { color: t.inkSoft, fontSize: 13 },
});

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56 },
  title: { color: t.ink, fontSize: 16, fontFamily: fonts[900] },
  sub: { color: t.muted2, fontSize: 11, marginTop: 2 },
  coachTag: { backgroundColor: t.accentSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  coachTagText: { color: t.accent, fontSize: 9.5, fontFamily: fonts[700], textTransform: 'uppercase', letterSpacing: 0.5 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: {
    color: t.label, fontSize: 11, fontFamily: fonts[700], letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 12,
  },
  programBox: { backgroundColor: t.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: t.cardBorder },

  coachNotesToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coachNotesLabel: { color: t.positive, fontSize: 11, fontFamily: fonts[700], textTransform: 'uppercase' },
  coachNotesBox: {
    backgroundColor: t.positiveSoft,
    borderLeftWidth: 3,
    borderLeftColor: t.positive,
    marginTop: 10,
    padding: 14,
    borderRadius: 10,
  },

  progressCard: {
    backgroundColor: t.card, borderRadius: 20, padding: 18,
    marginHorizontal: 20, marginTop: 20, borderWidth: 1, borderColor: t.cardBorder,
  },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel: { color: t.muted2, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 1.6, textTransform: 'uppercase' },
  progressCount: { color: t.accent, fontSize: 15, fontFamily: fonts[800] },
  progressTrack: { height: 9, borderRadius: 5, backgroundColor: t.chip, marginTop: 12, overflow: 'hidden' },
  progressFill: { height: 9, borderRadius: 5, backgroundColor: t.accent },

  drillRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    backgroundColor: t.card, borderRadius: 16, padding: 15, marginBottom: 11,
    borderWidth: 1, borderColor: t.cardBorder,
  },
  drillRowDone: { borderColor: t.cardBorder },
  checkbox: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  checkboxIdle: { borderWidth: 2, borderColor: t.line },
  checkboxDone: { backgroundColor: t.pistachio },
  drillLabel: { color: t.ink, fontSize: 15.5, fontFamily: fonts[800] },
  drillLabelDone: { color: t.muted, textDecorationLine: 'line-through', fontFamily: fonts[700] },
  drillMeta: { color: t.muted2, fontSize: 12.5, marginTop: 1 },

  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.chip, borderRadius: 12, paddingVertical: 15,
    borderWidth: 1, borderColor: t.cta2Border,
  },
  exportBtnText: { color: t.ink, fontSize: 15, fontFamily: fonts[800] },
  generatingBox: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  generatingText: { color: t.muted2, fontSize: 13 },
  commentCard: {
    backgroundColor: t.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  commentAuthor: { fontSize: 12, fontFamily: fonts[700] },
  commentDate: { color: t.muted2, fontSize: 11 },
  commentText: { color: t.inkSoft, fontSize: 13 },
  commentInput: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'flex-end' },
  input: {
    flex: 1,
    backgroundColor: t.chip,
    borderRadius: 10,
    padding: 12,
    color: t.ink,
    fontSize: 14,
    borderWidth: 1,
    borderColor: t.line,
    maxHeight: 100,
    minHeight: 80,
  },
  sendBtn: {
    backgroundColor: t.positive,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
