import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { playerReportsAPI, playerTrainingAPI } from '../../api/playerClient';
import { SharedReport, PlayerComment } from '../../types';

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
      <View style={styles.center}>
        <ActivityIndicator color="#16a34a" size="large" />
      </View>
    );
  }

  if (!report) return null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0f1a0f' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
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
              <View style={[styles.flagBox, { borderColor: '#16a34a' }]}>
                <Text style={[styles.flagTitle, { color: '#22c55e' }]}>Green Flags</Text>
                {report.green_flags.map((f, i) => (
                  <Text key={i} style={styles.flagItem}>· {f}</Text>
                ))}
              </View>
            )}
            {report.watch_flags && report.watch_flags.length > 0 && (
              <View style={[styles.flagBox, { borderColor: '#dc2626' }]}>
                <Text style={[styles.flagTitle, { color: '#ef4444' }]}>Watch Flags</Text>
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
            <TextInput
              style={styles.input}
              placeholder="Add a comment..."
              placeholderTextColor="#4b7a4b"
              value={commentText}
              onChangeText={setCommentText}
              multiline
              onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150)}
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const markdownStyles = {
  body: { color: '#d1d5db', fontSize: 13, lineHeight: 22 },
  heading1: { color: '#ffffff', fontSize: 16, fontWeight: '800' as const, marginTop: 16, marginBottom: 4 },
  heading2: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' as const, marginTop: 14, marginBottom: 4 },
  strong: { color: '#ffffff', fontWeight: '700' as const },
  bullet_list: { marginLeft: 8 },
  list_item: { color: '#d1d5db', fontSize: 13 },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1a0f' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f1a0f' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56 },
  title: { color: '#fff', fontSize: 16, fontWeight: '900' },
  sub: { color: '#4b7a4b', fontSize: 11, marginTop: 2 },
  messageBox: {
    backgroundColor: '#16a34a22',
    borderLeftWidth: 3,
    borderLeftColor: '#16a34a',
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
  },
  messageLabel: { color: '#16a34a', fontSize: 10, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase' },
  messageText: { color: '#d1d5db', fontSize: 13 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: {
    color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 12,
  },
  grade: { fontSize: 48, fontWeight: '900', color: '#16a34a' },
  pillarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  pillarName: { color: '#d1d5db', fontSize: 12, width: 100 },
  barContainer: { flex: 1, height: 6, backgroundColor: '#2d4a2d', borderRadius: 3 },
  bar: { height: 6, backgroundColor: '#16a34a', borderRadius: 3 },
  pillarGrade: { color: '#16a34a', fontSize: 12, fontWeight: '700', width: 30, textAlign: 'right' },
  flagRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 20 },
  flagBox: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12 },
  flagTitle: { fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' },
  flagItem: { color: '#d1d5db', fontSize: 12, marginBottom: 3 },
  questionRow: { flexDirection: 'row', marginBottom: 10, gap: 10 },
  questionNum: { color: '#16a34a', fontWeight: '800', fontSize: 14, width: 20 },
  questionText: { color: '#d1d5db', fontSize: 13, flex: 1, lineHeight: 20 },
  reportBox: { backgroundColor: '#1a2e1a', borderRadius: 12, padding: 16 },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16a34a',
    borderRadius: 12,
    padding: 16,
  },
  generateBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  commentCard: {
    backgroundColor: '#1a2e1a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2d4a2d',
  },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  commentAuthor: { color: '#16a34a', fontSize: 12, fontWeight: '700' },
  commentDate: { color: '#4b7a4b', fontSize: 11 },
  commentText: { color: '#d1d5db', fontSize: 13 },
  commentInput: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'flex-end' },
  input: {
    flex: 1,
    backgroundColor: '#1a2e1a',
    borderRadius: 10,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#2d4a2d',
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
