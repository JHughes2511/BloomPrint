import React, { useEffect, useState } from 'react';
import VoiceTextInput from '../../components/VoiceTextInput';
import KeyboardAwareScrollView from '../../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useGoUp } from '../../navigation/goUp';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { exportHtmlPdf, printRawHtml } from '../../utils/exportDoc';
import { playerTrainingAPI } from '../../api/playerClient';
import { PlayerComment } from '../../types';
import { useTheme } from '../../theme/ThemeProvider';
import { topPad } from '../../responsive/screenPadding';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';
import PageContainer, { REPORT_MAX_WIDTH } from '../../responsive/PageContainer';
import { renderReport } from '../../utils/renderReport';
import { useReportSearch, ReportSearchBar, ReportSearchButton } from '../../components/ReportSearch';
import { GeneratingOverlay } from '../../components/GeneratingBasketball';
import CommentThread from '../../components/CommentThread';
import { parseDrills } from '../../utils/trainingDrills';
import DrillRow from '../../components/DrillRow';
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
  // Back means up a level — see navigation/goUp.ts.
  const goUp = useGoUp();
  const { trainingId } = route.params;
  const { playerUser } = usePlayerAuth();
  const { t: tr } = useTranslation();
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
  // The coach's programme, searchable the same way it is everywhere else.
  const find = useReportSearch(training?.program_text ?? '');

  const loadCorrections = () =>
    playerTrainingAPI.coachSentCorrections(trainingId).then(setTrainingCorrections).catch(() => setTrainingCorrections([]));

  const load = () => {
    Promise.all([
      playerTrainingAPI.getCoachSent(trainingId),
      playerTrainingAPI.getCoachSentComments(trainingId),
    ]).then(([item, c]) => {
      setTraining(item);
      setComments(c);
      setCompleted(new Set(item?.completed_drills ?? []));
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
      await exportHtmlPdf(html, buildPdfFileName('Training Program', playerUser?.name ?? 'Player', new Date(training.created_at)));
    } catch (e: any) {
      Alert.alert(tr('playerApp.coachTrainingDetail.exportErrorTitle'), e?.message ?? tr('playerApp.coachTrainingDetail.exportErrorMsg'));
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
      Alert.alert(tr('playerApp.coachTrainingDetail.savedTitle'), tr('playerApp.coachTrainingDetail.savedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.coachTrainingDetail.failedSaveCorrection'));
    } finally {
      setSavingCorrection(false);
    }
  };

  const refreshTraining = async () => {
    const pending = feedbackText.trim();
    if (!pending && trainingCorrections.filter(c => !c.applied).length === 0) {
      Alert.alert(tr('playerApp.coachTrainingDetail.nothingToApplyTitle'), tr('playerApp.coachTrainingDetail.nothingToApplyMsg'));
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
      Alert.alert(tr('playerApp.coachTrainingDetail.updatedTitle'), tr('playerApp.coachTrainingDetail.updatedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.coachTrainingDetail.failedUpdateTraining'));
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
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.coachTrainingDetail.failedAddComment'));
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
          <TouchableOpacity onPress={() => goUp()}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <Text style={{ color: t.ink }}>{tr('playerApp.coachTrainingDetail.notFound')}</Text>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
    <PageContainer maxWidth={REPORT_MAX_WIDTH}>
      <KeyboardAwareScrollView ref={find.scrollRef} style={styles.container} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => goUp()} style={{ flexShrink: 0 }}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
          {/* Long translated titles and the coach tag both shrink instead of overflowing. */}
          <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginLeft: 12, marginRight: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.title} numberOfLines={1}>{tr('reportTypes.training_program')}</Text>
              <View style={styles.coachTag}><Text style={styles.coachTagText} numberOfLines={1}>{tr('playerApp.coachTrainingDetail.fromCoach')}</Text></View>
            </View>
            <Text style={styles.sub} numberOfLines={1}>
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
              <Text style={styles.coachNotesLabel} numberOfLines={1}>{tr('playerApp.coachTrainingDetail.coachNotes')}</Text>
              <Ionicons name={showCoachNotes ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted2} style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
            {/* Searching notes that are folded away is searching nothing, so
                opening the search opens them. */}
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              <ReportSearchButton ctl={find} onOpen={() => setShowCoachNotes(true)} />
            </View>
            <ReportSearchBar ctl={find} />
            {showCoachNotes && (
              <View style={styles.coachNotesBox}>
                {renderReport(training.program_text, { heading: t.ink, body: t.inkSoft }, find.search)}
              </View>
            )}
          </View>
        )}

        {training.reformatting ? (
          <View style={styles.section}>
            <View style={styles.programBox}>
              <View style={styles.generatingBox}>
                <ActivityIndicator color={t.positive} />
                <Text style={styles.generatingText}>{tr('playerApp.coachTrainingDetail.preparingProgram')}</Text>
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
                    <Text style={styles.progressLabel} numberOfLines={1}>{tr('playerApp.coachTrainingDetail.weeklyProgress')}</Text>
                    <Text style={styles.progressCount} numberOfLines={1}>{doneCount} / {drillTotal}</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${drillTotal ? (doneCount / drillTotal) * 100 : 0}%` }]} />
                  </View>
                </View>

                {drillSections.map((sec, si) => (
                  <View key={si} style={styles.section}>
                    <Text style={styles.sectionLabel} numberOfLines={1}>{sec.title || tr('playerApp.coachTrainingDetail.drills')}</Text>
                    {sec.drills.map(d => {
                      const done = completed.has(d.key);
                      return (
                        <DrillRow
                          key={d.key}
                          drill={d}
                          done={done}
                          onToggle={() => toggleDrill(d.key)}
                          expandLabel={tr('playerApp.coachTrainingDetail.showDetail')}
                          collapseLabel={tr('playerApp.coachTrainingDetail.hideDetail')}
                        />
                      );
                    })}
                  </View>
                ))}
              </>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.coachTrainingDetail.yourProgram')}</Text>
              <View style={styles.programBox}>
                {training.player_program_text
                  ? <Markdown style={markdownStyles}>{training.player_program_text}</Markdown>
                  : <Text style={{ color: t.muted, fontSize: 13 }}>{tr('playerApp.coachTrainingDetail.notReady')}</Text>}
              </View>
            </View>

            {/* Comments */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.coachTrainingDetail.commentsCount', { count: comments.length })}</Text>
              <CommentThread
                comments={comments as any}
                accent={t.positive}
                onReply={async (parentId, text) => {
                  const c = await playerTrainingAPI.addCoachSentComment(trainingId, text, parentId);
                  setComments(prev => [...prev, c]);
                }}
                mine={(c: any) => !!c.player_user_id && c.player_user_id === playerUser?.id}
                onEdit={async (id, text) => {
                  const c = await playerTrainingAPI.editComment(id, text);
                  setComments(prev => prev.map(x => (x.id === id ? c : x)));
                }}
                onDelete={async (id) => {
                  const c = await playerTrainingAPI.deleteComment(id);
                  setComments(prev => prev.map(x => (x.id === id ? c : x)));
                }}
              />
              <View style={styles.commentInput}>
                <VoiceTextInput
                  style={styles.input}
                  placeholder={tr('playerApp.coachTrainingDetail.addCommentPlaceholder')}
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
              <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.coachTrainingDetail.updateWithFeedback')}</Text>
              <View style={styles.programBox}>
                <Text style={{ color: t.muted, fontSize: 12, marginBottom: 10, lineHeight: 18 }}>
                  {tr('playerApp.coachTrainingDetail.feedbackHint')}
                </Text>
                <VoiceTextInput
                  style={styles.input}
                  placeholder={tr('playerApp.coachTrainingDetail.feedbackPlaceholder')}
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
                      : <Text numberOfLines={1} style={{ color: t.ink, fontFamily: fonts[700], fontSize: 14 }}>{tr('playerApp.coachTrainingDetail.saveForLater')}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.sendBtn, { flex: 1, borderRadius: 12, paddingVertical: 14, flexDirection: 'row', gap: 6, justifyContent: 'center' }, refreshing && { opacity: 0.5 }]}
                    onPress={refreshTraining}
                    disabled={refreshing}
                  >
                    {refreshing
                      ? <><ActivityIndicator color="#fff" size="small" /><Text numberOfLines={1} style={{ color: '#fff', fontFamily: fonts[700], fontSize: 13, flexShrink: 1 }}>{tr('playerApp.coachTrainingDetail.updating')}</Text></>
                      : <><Ionicons name="refresh" size={15} color="#fff" /><Text numberOfLines={1} style={{ color: '#fff', fontFamily: fonts[700], fontSize: 13, flexShrink: 1 }}>{tr('playerApp.coachTrainingDetail.applyRegenerate')}</Text></>
                    }
                  </TouchableOpacity>
                </View>
                <GeneratingOverlay visible={refreshing} label={tr('playerApp.coachTrainingDetail.updatingOverlay')} />

                {trainingCorrections.length > 0 && (
                  <View style={{ marginTop: 14 }}>
                    {trainingCorrections.map((c: any) => (
                      <View key={c.id} style={{ backgroundColor: t.chip, borderRadius: 10, padding: 10, marginBottom: 6, opacity: c.applied ? 0.55 : 1 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                          {c.applied
                            ? <View style={{ backgroundColor: t.positiveSoft, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}><Text numberOfLines={1} style={{ color: t.positive, fontSize: 9, fontFamily: fonts[700] }}>{tr('playerApp.coachTrainingDetail.applied')}</Text></View>
                            : <View style={{ backgroundColor: t.card, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}><Text numberOfLines={1} style={{ color: t.muted, fontSize: 9, fontFamily: fonts[700] }}>{tr('playerApp.coachTrainingDetail.pending')}</Text></View>}
                          <Text numberOfLines={1} style={{ color: t.muted2, fontSize: 10, flexShrink: 0, marginLeft: 8 }}>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</Text>
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
                    : <><Ionicons name="share-outline" size={18} color={t.ink} /><Text style={styles.exportBtnText} numberOfLines={1}>{tr('playerApp.coachTrainingDetail.exportBtn')}</Text></>}
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
      </KeyboardAwareScrollView>
    </PageContainer>
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingTop: topPad(56) },
  title: { color: t.ink, fontSize: 16, fontFamily: fonts[900], flexShrink: 1, minWidth: 0 },
  sub: { color: t.muted2, fontSize: 11, marginTop: 2, flexShrink: 1 },
  coachTag: { backgroundColor: t.accentSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, flexShrink: 1, maxWidth: 120 },
  coachTagText: { color: t.accent, fontSize: 9.5, fontFamily: fonts[700], textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 1 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: {
    color: t.label, fontSize: 11, fontFamily: fonts[700], letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 12,
  },
  programBox: { backgroundColor: t.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: t.cardBorder },

  coachNotesToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coachNotesLabel: { color: t.positive, fontSize: 11, fontFamily: fonts[700], textTransform: 'uppercase', flexShrink: 1 },
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
  progressLabel: { color: t.muted2, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 1.6, textTransform: 'uppercase', flexShrink: 1, marginRight: 8 },
  progressCount: { color: t.accent, fontSize: 15, fontFamily: fonts[800], flexShrink: 0 },
  progressTrack: { height: 9, borderRadius: 5, backgroundColor: t.chip, marginTop: 12, overflow: 'hidden' },
  progressFill: { height: 9, borderRadius: 5, backgroundColor: t.accent },

  drillRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    backgroundColor: t.card, borderRadius: 16, padding: 15, marginBottom: 11,
    borderWidth: 1, borderColor: t.cardBorder,
  },
  drillRowDone: { borderColor: t.cardBorder },
  checkbox: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  checkboxIdle: { borderWidth: 2, borderColor: t.line },
  checkboxDone: { backgroundColor: t.pistachio },
  drillLabel: { color: t.ink, fontSize: 15.5, fontFamily: fonts[800], flexShrink: 1 },
  drillLabelDone: { color: t.muted, textDecorationLine: 'line-through', fontFamily: fonts[700] },
  drillMeta: { color: t.muted2, fontSize: 12.5, marginTop: 1, flexShrink: 1 },

  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.chip, borderRadius: 12, paddingVertical: 15,
    borderWidth: 1, borderColor: t.cta2Border,
  },
  exportBtnText: { color: t.ink, fontSize: 15, fontFamily: fonts[800], flexShrink: 1 },
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
  // One control in two pieces: the field and Send share a height rather than
  // each arriving at one through its own padding. Padding alone made the button
  // grow with the multiline field beside it — on web that field is a textarea
  // whose height comes from its row count — so it stood up as a tall block next
  // to the box instead of sitting on its bottom edge.
  sendBtn: {
    backgroundColor: t.positive,
    borderRadius: 10,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    flexShrink: 0,
  },
});
