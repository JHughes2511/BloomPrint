import React, { useEffect, useState, useRef } from 'react';
import VoiceTextInput from '../../components/VoiceTextInput';
import KeyboardAwareScrollView from '../../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { playerReportsAPI, playerTrainingAPI } from '../../api/playerClient';
import { SharedReport, PlayerComment } from '../../types';
import CommentThread from '../../components/CommentThread';
import { useTheme } from '../../theme/ThemeProvider';
import { topPad } from '../../responsive/screenPadding';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';
import PageContainer, { REPORT_MAX_WIDTH } from '../../responsive/PageContainer';

const PILLARS = [
  'offensive_skills', 'defensive_capabilities', 'physical_attributes',
  'intangibles', 'advanced_analysis', 'strategic_fit',
];

export default function PlayerReportDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { reportId } = route.params;
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const markdownStyles = makeMarkdownStyles(t);

  const [report, setReport] = useState<SharedReport | null>(null);
  const [comments, setComments] = useState<PlayerComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    Promise.all([
      playerReportsAPI.get(reportId),
      playerReportsAPI.getComments(reportId),
    ]).then(([r, c]) => {
      setReport(r);
      setComments(c);
    }).finally(() => setLoading(false));
  }, [reportId]);

  const addComment = async () => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    try {
      const c = await playerReportsAPI.addComment(reportId, commentText.trim());
      setComments(prev => [...prev, c]);
      setCommentText('');
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.reportDetail.failedAddComment'));
    } finally {
      setSubmitting(false);
    }
  };

  const generateTraining = async () => {
    setGenerating(true);
    try {
      const pt = await playerTrainingAPI.generate(reportId);
      Alert.alert(tr('playerApp.reportDetail.trainingGeneratedTitle'), tr('playerApp.reportDetail.trainingGeneratedMsg'), [
        { text: tr('playerApp.reportDetail.viewTraining'), onPress: () => navigation.navigate('TrainingTab') },
        { text: tr('common.ok') },
      ]);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.reportDetail.failedGenerateTraining'));
    } finally {
      setGenerating(false);
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

  if (!report) return null;

  return (
    <ScreenBackground>
    <PageContainer maxWidth={REPORT_MAX_WIDTH}>
      <KeyboardAwareScrollView ref={scrollRef} style={styles.container} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ flexShrink: 0 }}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
          {/* Long translated report types clip instead of wrapping the header. */}
          <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginLeft: 12, marginRight: 8 }}>
            <Text style={styles.title} numberOfLines={1}>
              {report.output_type.replace(/_/g, ' ').toUpperCase()}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {tr('playerApp.reportDetail.sharedBy', { name: report.shared_by_name, date: new Date(report.created_at).toLocaleDateString() })}
            </Text>
          </View>
        </View>

        {report.message && (
          <View style={styles.messageBox}>
            <Text style={styles.messageLabel} numberOfLines={1}>{tr('playerApp.reportDetail.coachMessage')}</Text>
            <Text style={styles.messageText}>{report.message}</Text>
          </View>
        )}

        {report.overall_grade != null && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.reportDetail.overallGrade')}</Text>
            <Text style={styles.grade} numberOfLines={1}>{tr('playerApp.reportDetail.gradeOutOf', { grade: report.overall_grade.toFixed(1) })}</Text>
          </View>
        )}

        {report.pillar_grades && Object.keys(report.pillar_grades).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.reportDetail.pillarGrades')}</Text>
            {PILLARS.filter(k => report.pillar_grades![k] != null).map(k => {
              const g = report.pillar_grades![k];
              const pct = Math.round((g / 10) * 100);
              return (
                <View key={k} style={styles.pillarRow}>
                  <Text style={styles.pillarName} numberOfLines={1}>{tr(`playerApp.reportDetail.pillars.${k}`)}</Text>
                  <View style={styles.barContainer}>
                    <View style={[styles.bar, { width: `${pct}%` as any }]} />
                  </View>
                  <Text style={styles.pillarGrade} numberOfLines={1}>{g.toFixed(1)}</Text>
                </View>
              );
            })}
          </View>
        )}

        {(report.green_flags?.length || report.watch_flags?.length) ? (
          <View style={styles.flagRow}>
            {report.green_flags && report.green_flags.length > 0 && (
              <View style={[styles.flagBox, { borderColor: t.positive }]}>
                <Text style={[styles.flagTitle, { color: t.positive }]} numberOfLines={1}>{tr('playerApp.reportDetail.greenFlags')}</Text>
                {report.green_flags.map((f, i) => (
                  <Text key={i} style={styles.flagItem}>· {f}</Text>
                ))}
              </View>
            )}
            {report.watch_flags && report.watch_flags.length > 0 && (
              <View style={[styles.flagBox, { borderColor: t.negative }]}>
                <Text style={[styles.flagTitle, { color: t.negative }]} numberOfLines={1}>{tr('playerApp.reportDetail.watchFlags')}</Text>
                {report.watch_flags.map((f, i) => (
                  <Text key={i} style={styles.flagItem}>· {f}</Text>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {report.key_questions && report.key_questions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.reportDetail.keyQuestions')}</Text>
            {report.key_questions.map((q, i) => (
              <View key={i} style={styles.questionRow}>
                <Text style={styles.questionNum}>{i + 1}</Text>
                <Text style={styles.questionText}>{q}</Text>
              </View>
            ))}
          </View>
        )}

        {report.report_text && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.reportDetail.fullReport')}</Text>
            <View style={styles.reportBox}>
              <Markdown style={markdownStyles}>{report.report_text}</Markdown>
            </View>
          </View>
        )}

        {/* Generate Training */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.generateBtn}
            onPress={generateTraining}
            disabled={generating}
          >
            {generating ? (
              <>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.generateBtnText} numberOfLines={1}>{tr('playerApp.reportDetail.generatingTraining')}</Text>
              </>
            ) : (
              <>
                <Ionicons name="barbell" size={18} color="#fff" />
                <Text style={styles.generateBtnText} numberOfLines={1}>{tr('playerApp.reportDetail.generateTraining')}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Comments */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.reportDetail.commentsCount', { count: comments.length })}</Text>
          <CommentThread
            comments={comments as any}
            accent={t.positive}
            onReply={async (parentId, text) => {
              const c = await playerReportsAPI.addComment(reportId, text, parentId);
              setComments(prev => [...prev, c]);
            }}
          />
          <View style={styles.commentInput}>
            <VoiceTextInput
              style={styles.input}
              placeholder={tr('playerApp.reportDetail.addCommentPlaceholder')}
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
      </KeyboardAwareScrollView>
    </PageContainer>
    </ScreenBackground>
  );
}

const makeMarkdownStyles = (t: ThemeTokens) => ({
  body: { color: t.inkSoft, fontSize: 13, lineHeight: 22 },
  heading1: { color: t.ink, fontSize: 16, fontFamily: fonts[800], marginTop: 16, marginBottom: 4 },
  heading2: { color: t.ink, fontSize: 14, fontFamily: fonts[700], marginTop: 14, marginBottom: 4 },
  strong: { color: t.ink, fontFamily: fonts[700] },
  bullet_list: { marginLeft: 8 },
  list_item: { color: t.inkSoft, fontSize: 13 },
});

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingTop: topPad(56) },
  title: { color: t.ink, fontSize: 16, fontFamily: fonts[900], flexShrink: 1 },
  sub: { color: t.muted, fontSize: 11, marginTop: 2, flexShrink: 1 },
  messageBox: {
    backgroundColor: t.positiveSoft,
    borderLeftWidth: 3,
    borderLeftColor: t.positive,
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
  },
  messageLabel: { color: t.positive, fontSize: 10, fontFamily: fonts[700], marginBottom: 4, textTransform: 'uppercase', flexShrink: 1 },
  messageText: { color: t.inkSoft, fontSize: 13 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: {
    color: t.label, fontSize: 11, fontFamily: fonts[700], letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 12,
  },
  grade: { fontSize: 48, fontFamily: fonts[900], color: t.positive },
  pillarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  pillarName: { color: t.inkSoft, fontSize: 12, width: 100, flexShrink: 0 },
  barContainer: { flex: 1, flexShrink: 1, minWidth: 0, height: 6, backgroundColor: t.chip, borderRadius: 3 },
  bar: { height: 6, backgroundColor: t.positive, borderRadius: 3 },
  pillarGrade: { color: t.positive, fontSize: 12, fontFamily: fonts[700], width: 30, textAlign: 'right', flexShrink: 0 },
  flagRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 20 },
  flagBox: { flex: 1, flexShrink: 1, minWidth: 0, borderWidth: 1, borderRadius: 10, padding: 12 },
  flagTitle: { fontSize: 11, fontFamily: fonts[700], marginBottom: 6, textTransform: 'uppercase', flexShrink: 1 },
  flagItem: { color: t.inkSoft, fontSize: 12, marginBottom: 3 },
  questionRow: { flexDirection: 'row', marginBottom: 10, gap: 10 },
  questionNum: { color: t.positive, fontFamily: fonts[800], fontSize: 14, width: 20 },
  questionText: { color: t.inkSoft, fontSize: 13, flex: 1, lineHeight: 20 },
  reportBox: { backgroundColor: t.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: t.cardBorder },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.positive,
    borderRadius: 12,
    padding: 16,
  },
  generateBtnText: { color: '#fff', fontFamily: fonts[700], fontSize: 15, flexShrink: 1 },
  commentCard: {
    backgroundColor: t.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  commentAuthor: { color: t.positive, fontSize: 12, fontFamily: fonts[700] },
  commentDate: { color: t.muted, fontSize: 11 },
  commentText: { color: t.inkSoft, fontSize: 13 },
  commentInput: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'flex-end' },
  input: {
    flex: 1,
    backgroundColor: t.card,
    borderRadius: 10,
    padding: 12,
    color: t.ink,
    fontSize: 14,
    borderWidth: 1,
    borderColor: t.cardBorder,
    maxHeight: 100,
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
