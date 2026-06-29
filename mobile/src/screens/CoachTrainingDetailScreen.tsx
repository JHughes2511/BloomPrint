import React, { useEffect, useState, useRef } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { playerAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

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

export default function CoachTrainingDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { trainingId } = route.params;
  const { t } = useTheme();
  const styles = makeStyles(t);
  const markdownStyles = makeMarkdownStyles(t);

  const [training, setTraining] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [feedbackText, setFeedbackText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Layout Y positions for each input section
  const commentY = useRef(0);
  const notesY = useRef(0);
  const feedbackY = useRef(0);

  const loadDetail = () =>
    playerAPI.getTrainingDetail(trainingId).then(setTraining).finally(() => setLoading(false));

  useEffect(() => { loadDetail(); }, [trainingId]);

  const scrollToY = (y: number) => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 100), animated: true });
    }, 150);
  };

  const addComment = async () => {
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    try {
      await playerAPI.addCoachComment(trainingId, { text: commentText.trim() });
      setCommentText('');
      const updated = await playerAPI.getTrainingDetail(trainingId);
      setTraining(updated);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to add comment');
    } finally {
      setSubmittingComment(false);
    }
  };

  const saveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await playerAPI.updateTraining(trainingId, { coach_notes: noteText.trim() });
      setTraining((prev: any) => ({ ...prev, coach_notes: noteText.trim() }));
      setNoteText('');
    } catch {
      Alert.alert('Error', 'Failed to save notes');
    } finally {
      setSavingNote(false);
    }
  };

  const refreshTraining = async () => {
    if (!feedbackText.trim()) return;
    setRefreshing(true);
    try {
      const updated = await playerAPI.coachRefreshTraining(trainingId, feedbackText.trim());
      setTraining((prev: any) => ({ ...prev, program_text: updated.program_text }));
      setFeedbackText('');
      Alert.alert('Updated!', 'Training program has been updated.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to update training');
    } finally {
      setRefreshing(false);
    }
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
      <KeyboardAwareScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
       
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.title}>{training.player_name}'s Training</Text>
            <Text style={styles.sub}>{new Date(training.created_at).toLocaleDateString()}</Text>
          </View>
        </View>

        {training.coach_notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Coach Notes</Text>
            <Text style={styles.notesText}>{training.coach_notes}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Training Program</Text>
          <View style={styles.programBox}>
            {training.program_text
              ? <Markdown style={markdownStyles}>{cleanMarkdown(training.program_text)}</Markdown>
              : <Text style={{ color: t.muted2 }}>No program text</Text>}
          </View>
        </View>

        {/* Comments thread */}
        <View
          style={styles.section}
          onLayout={e => { commentY.current = e.nativeEvent.layout.y; }}
        >
          <Text style={styles.sectionLabel}>Comments ({training.comments?.length ?? 0})</Text>
          {(training.comments ?? []).map((c: any) => (
            <View key={c.id} style={styles.commentCard}>
              <View style={styles.commentHeader}>
                <Text style={[styles.commentAuthor, c.coach_id ? { color: t.accent } : { color: t.positive }]}>
                  {c.author_name}{c.coach_id ? ' (Coach)' : ''}
                </Text>
                <Text style={styles.commentDate}>{new Date(c.created_at).toLocaleDateString()}</Text>
              </View>
              <Text style={styles.commentText}>{c.text}</Text>
            </View>
          ))}
          <View style={styles.commentInput}>
            <VoiceTextInput
              style={styles.input}
              placeholder="Leave a comment for the player..."
              placeholderTextColor={t.muted2}
              value={commentText}
              onChangeText={setCommentText}
              multiline

            />
            <TouchableOpacity
              style={styles.sendBtn}
              onPress={addComment}
              disabled={submittingComment || !commentText.trim()}
            >
              {submittingComment
                ? <ActivityIndicator color={t.ctaText} size="small" />
                : <Ionicons name="send" size={18} color={t.ctaText} />}
            </TouchableOpacity>
          </View>
        </View>

        {/* Coach Notes */}
        <View
          style={styles.section}
          onLayout={e => { notesY.current = e.nativeEvent.layout.y; }}
        >
          <Text style={styles.sectionLabel}>Add Coach Notes</Text>
          <View style={styles.programBox}>
            <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 10, lineHeight: 18 }}>
              Notes are saved to the training record and visible to the player.
            </Text>
            <VoiceTextInput
              style={styles.noteInput}
              placeholder="Add notes for the player..."
              placeholderTextColor={t.muted2}
              value={noteText}
              onChangeText={setNoteText}
              multiline
              textAlignVertical="top"

            />
            <TouchableOpacity
              style={[styles.btn, { marginTop: 8 }]}
              onPress={saveNote}
              disabled={savingNote || !noteText.trim()}
            >
              {savingNote ? <ActivityIndicator color={t.ctaText} size="small" /> : <Text style={styles.btnText}>Save Notes</Text>}
            </TouchableOpacity>
          </View>
        </View>

        {/* Update Program with Feedback */}
        <View
          style={styles.section}
          onLayout={e => { feedbackY.current = e.nativeEvent.layout.y; }}
        >
          <Text style={styles.sectionLabel}>Update Program with Feedback</Text>
          <View style={styles.programBox}>
            <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 10, lineHeight: 18 }}>
              Provide coaching feedback to regenerate the player's training program with AI.
            </Text>
            <VoiceTextInput
              style={styles.noteInput}
              placeholder="e.g. Focus more on defensive footwork, increase conditioning..."
              placeholderTextColor={t.muted2}
              value={feedbackText}
              onChangeText={setFeedbackText}
              multiline
              textAlignVertical="top"

            />
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: t.positive, marginTop: 8, flexDirection: 'row', gap: 8, justifyContent: 'center' }]}
              onPress={refreshTraining}
              disabled={refreshing || !feedbackText.trim()}
            >
              {refreshing
                ? <><ActivityIndicator color={t.ctaText} size="small" /><Text style={styles.btnText}>Updating...</Text></>
                : <><Ionicons name="refresh" size={16} color={t.ctaText} /><Text style={styles.btnText}>Update Report</Text></>
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
  strong: { color: t.ink, fontWeight: '700' as const },
  bullet_list: { marginLeft: 8 },
  list_item: { color: t.inkSoft, fontSize: 13 },
  hr: { backgroundColor: t.divider, height: 1, marginVertical: 12 },
});

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56 },
  title: { color: t.ink, fontSize: 16, fontWeight: '900' },
  sub: { color: t.muted2, fontSize: 11, marginTop: 2 },
  notesBox: {
    backgroundColor: t.positiveSoft, borderLeftWidth: 3, borderLeftColor: t.positive,
    marginHorizontal: 20, marginBottom: 8, padding: 14, borderRadius: 10,
  },
  notesLabel: { color: t.positive, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  notesText: { color: t.inkSoft, fontSize: 13, lineHeight: 20 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: { color: t.label, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  programBox: { backgroundColor: t.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: t.cardBorder },
  commentCard: { backgroundColor: t.card, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: t.cardBorder },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  commentAuthor: { fontSize: 12, fontWeight: '700' },
  commentDate: { color: t.muted2, fontSize: 11 },
  commentText: { color: t.inkSoft, fontSize: 13 },
  commentInput: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'flex-end' },
  input: {
    flex: 1, backgroundColor: t.chip, borderRadius: 10, padding: 12, color: t.ink,
    fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 60,
  },
  noteInput: {
    backgroundColor: t.chip, borderRadius: 10, padding: 12, color: t.ink,
    fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 80,
  },
  sendBtn: { backgroundColor: t.ctaBg, borderRadius: 10, padding: 12, alignItems: 'center', justifyContent: 'center' },
  btn: { backgroundColor: t.ctaBg, borderRadius: 10, padding: 12, alignItems: 'center' },
  btnText: { color: t.ctaText, fontWeight: '700', fontSize: 14 },
});
