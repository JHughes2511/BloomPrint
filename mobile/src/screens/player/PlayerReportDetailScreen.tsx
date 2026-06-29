import React, { useEffect, useState, useRef } from 'react';
import VoiceTextInput from '../../components/VoiceTextInput';
import KeyboardAwareScrollView from '../../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { playerReportsAPI, playerTrainingAPI } from '../../api/playerClient';
import { SharedReport, PlayerComment } from '../../types';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';

const PILLARS = [
  'offensive_skills', 'defensive_capabilities', 'physical_attributes',
  'intangibles', 'advanced_analysis', 'strategic_fit',
];

const PILLAR_LABELS: Record<string, string> = {
  offensive_skills: 'Offensive Skills',
  defensive_capabilities: 'Defense',
  physical_attributes: 'Physical',
  intangibles: 'Intangibles',
  advanced_analysis: 'Advanced',
  strategic_fit: 'Strategic Fit',
};

export default function PlayerReportDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { reportId } = route.params;
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
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  const generateTraining = async () => {
    setGenerating(true);
    try {
      const pt = await playerTrainingAPI.generate(reportId);
      Alert.alert('Training Generated!', 'Your personalized training program is ready.', [
        { text: 'View Training', onPress: () => navigation.navigate('TrainingTab') },
        { text: 'OK' },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to generate training');
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
      <KeyboardAwareScrollView ref={scrollRef} style={styles.container} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.title}>
              {report.output_type.replace(/_/g, ' ').toUpperCase()}
            </Text>
            <Text style={styles.sub}>
              From {report.shared_by_name} · {new Date(report.created_at).toLocaleDateString()}
            </Text>
          </View>
        </View>

        {report.message && (
          <View style={styles.messageBox}>
            <Text style={styles.messageLabel}>Coach Message</Text>
            <Text style={styles.messageText}>{report.message}</Text>
          </View>
        )}

        {report.overall_grade != null && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Overall Grade</Text>
            <Text style={styles.grade}>{report.overall_grade.toFixed(1)} / 10</Text>
          </View>
        )}

        {report.pillar_grades && Object.keys(report.pillar_grades).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Pillar Grades</Text>
            {PILLARS.filter(k => report.pillar_grades![k] != null).map(k => {
              const g = report.pillar_grades![k];
              const pct = Math.round((g / 10) * 100);
              return (
                <View key={k} style={styles.pillarRow}>
                  <Text style={styles.pillarName}>{PILLAR_LABELS[k]}</Text>
                  <View style={styles.barContainer}>
                    <View style={[styles.bar, { width: `${pct}%` as any }]} />
                  </View>
                  <Text style={styles.pillarGrade}>{g.toFixed(1)}</Text>
                </View>
              );
            })}
          </View>
        )}

        {(report.green_flags?.length || report.watch_flags?.length) ? (
          <View style={styles.flagRow}>
            {report.green_flags && report.green_flags.length > 0 && (
              <View style={[styles.flagBox, { borderColor: t.positive }]}>
                <Text style={[styles.flagTitle, { color: t.positive }]}>Green Flags</Text>
                {report.green_flags.map((f, i) => (
                  <Text key={i} style={styles.flagItem}>· {f}</Text>
                ))}
              </View>
            )}
            {report.watch_flags && report.watch_flags.length > 0 && (
              <View style={[styles.flagBox, { borderColor: t.negative }]}>
                <Text style={[styles.flagTitle, { color: t.negative }]}>Watch Flags</Text>
                {report.watch_flags.map((f, i) => (
                  <Text key={i} style={styles.flagItem}>· {f}</Text>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {report.key_questions && report.key_questions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Key Questions</Text>
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
            <Text style={styles.sectionLabel}>Full Report</Text>
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
                <Text style={styles.generateBtnText}>Generating Training...</Text>
              </>
            ) : (
              <>
                <Ionicons name="barbell" size={18} color="#fff" />
                <Text style={styles.generateBtnText}>Generate Training Program</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Comments */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Comments ({comments.length})</Text>
          {comments.map(c => (
            <View key={c.id} style={styles.commentCard}>
              <View style={styles.commentHeader}>
                <Text style={styles.commentAuthor}>{c.author_name || 'Unknown'}</Text>
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
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}

const makeMarkdownStyles = (t: ThemeTokens) => ({
  body: { color: t.inkSoft, fontSize: 13, lineHeight: 22 },
  heading1: { color: t.ink, fontSize: 16, fontWeight: '800' as const, marginTop: 16, marginBottom: 4 },
  heading2: { color: t.ink, fontSize: 14, fontWeight: '700' as const, marginTop: 14, marginBottom: 4 },
  strong: { color: t.ink, fontWeight: '700' as const },
  bullet_list: { marginLeft: 8 },
  list_item: { color: t.inkSoft, fontSize: 13 },
});

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56 },
  title: { color: t.ink, fontSize: 16, fontFamily: fonts[900] },
  sub: { color: t.muted, fontSize: 11, marginTop: 2 },
  messageBox: {
    backgroundColor: t.positiveSoft,
    borderLeftWidth: 3,
    borderLeftColor: t.positive,
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
  },
  messageLabel: { color: t.positive, fontSize: 10, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase' },
  messageText: { color: t.inkSoft, fontSize: 13 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: {
    color: t.label, fontSize: 11, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 12,
  },
  grade: { fontSize: 48, fontWeight: '900', color: t.positive },
  pillarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  pillarName: { color: t.inkSoft, fontSize: 12, width: 100 },
  barContainer: { flex: 1, height: 6, backgroundColor: t.chip, borderRadius: 3 },
  bar: { height: 6, backgroundColor: t.positive, borderRadius: 3 },
  pillarGrade: { color: t.positive, fontSize: 12, fontWeight: '700', width: 30, textAlign: 'right' },
  flagRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 20 },
  flagBox: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12 },
  flagTitle: { fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' },
  flagItem: { color: t.inkSoft, fontSize: 12, marginBottom: 3 },
  questionRow: { flexDirection: 'row', marginBottom: 10, gap: 10 },
  questionNum: { color: t.positive, fontWeight: '800', fontSize: 14, width: 20 },
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
  generateBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  commentCard: {
    backgroundColor: t.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  commentAuthor: { color: t.positive, fontSize: 12, fontWeight: '700' },
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
  sendBtn: {
    backgroundColor: t.positive,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
