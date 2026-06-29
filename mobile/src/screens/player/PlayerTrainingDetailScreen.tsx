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
import { playerTrainingAPI } from '../../api/playerClient';
import { PlayerTraining, PlayerComment } from '../../types';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';

export default function PlayerTrainingDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { trainingId } = route.params;
  const { t } = useTheme();
  const styles = makeStyles(t);
  const markdownStyles = makeMarkdownStyles(t);

  const [training, setTraining] = useState<PlayerTraining | null>(null);
  const [comments, setComments] = useState<PlayerComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    Promise.all([
      playerTrainingAPI.list().then((list: PlayerTraining[]) =>
        list.find(item => item.id === trainingId) ?? null
      ),
      playerTrainingAPI.getComments(trainingId),
    ]).then(([tr, c]) => {
      setTraining(tr);
      setComments(c);
    }).finally(() => setLoading(false));
  }, [trainingId]);

  const refreshTraining = async () => {
    if (!feedbackText.trim()) return;
    setRefreshing(true);
    try {
      const updated = await playerTrainingAPI.refresh(trainingId, feedbackText.trim());
      setTraining(updated);
      setFeedbackText('');
      Alert.alert('Updated!', 'Your training program has been updated based on your feedback.');
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
      const c = await playerTrainingAPI.addComment(trainingId, commentText.trim());
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
        <View style={styles.center}>
          <Text style={{ color: t.ink }}>Training not found</Text>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <KeyboardAwareScrollView ref={scrollRef} style={styles.container} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.title}>Training Program</Text>
            <Text style={styles.sub}>{new Date(training.created_at).toLocaleDateString()}</Text>
          </View>
        </View>

        {training.coach_notes && (
          <View style={styles.coachNotesBox}>
            <View style={styles.coachNotesHeader}>
              <Ionicons name="chatbubble" size={14} color={t.positive} />
              <Text style={styles.coachNotesLabel}>Coach Notes</Text>
            </View>
            <Text style={styles.coachNotesText}>{training.coach_notes}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Your Program</Text>
          <View style={styles.programBox}>
            {training.program_text ? (
              <Markdown style={markdownStyles}>{training.program_text}</Markdown>
            ) : (
              <View style={styles.generatingBox}>
                <ActivityIndicator color={t.positive} />
                <Text style={styles.generatingText}>Generating your program...</Text>
              </View>
            )}
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
            <TouchableOpacity
              style={[styles.sendBtn, { width: '100%', borderRadius: 12, paddingVertical: 14, marginTop: 8, flexDirection: 'row', gap: 8, justifyContent: 'center' }]}
              onPress={refreshTraining}
              disabled={refreshing || !feedbackText.trim()}
            >
              {refreshing
                ? <><ActivityIndicator color="#fff" size="small" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Updating...</Text></>
                : <><Ionicons name="refresh" size={16} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Update Report</Text></>
              }
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
  heading3: { color: t.muted, fontSize: 13, fontWeight: '700' as const, marginTop: 12, marginBottom: 2 },
  strong: { color: t.ink, fontWeight: '700' as const },
  bullet_list: { marginLeft: 8 },
  list_item: { color: t.inkSoft, fontSize: 13 },
});

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56 },
  title: { color: t.ink, fontSize: 16, fontWeight: '900' },
  sub: { color: t.muted2, fontSize: 11, marginTop: 2 },
  coachNotesBox: {
    backgroundColor: t.positiveSoft,
    borderLeftWidth: 3,
    borderLeftColor: t.positive,
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 14,
    borderRadius: 10,
  },
  coachNotesHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  coachNotesLabel: { color: t.positive, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  coachNotesText: { color: t.inkSoft, fontSize: 13, lineHeight: 20 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: {
    color: t.label, fontSize: 11, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 12,
  },
  programBox: { backgroundColor: t.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: t.cardBorder },
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
  commentAuthor: { fontSize: 12, fontWeight: '700' },
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
