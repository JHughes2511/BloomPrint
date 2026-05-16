import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { playerTrainingAPI } from '../../api/playerClient';
import { PlayerTraining, PlayerComment } from '../../types';

export default function PlayerTrainingDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { trainingId } = route.params;

  const [training, setTraining] = useState<PlayerTraining | null>(null);
  const [comments, setComments] = useState<PlayerComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    Promise.all([
      playerTrainingAPI.list().then((list: PlayerTraining[]) =>
        list.find(t => t.id === trainingId) ?? null
      ),
      playerTrainingAPI.getComments(trainingId),
    ]).then(([t, c]) => {
      setTraining(t);
      setComments(c);
    }).finally(() => setLoading(false));
  }, [trainingId]);

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
      <View style={styles.center}>
        <ActivityIndicator color="#16a34a" size="large" />
      </View>
    );
  }

  if (!training) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#fff' }}>Training not found</Text>
      </View>
    );
  }

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
            <Text style={styles.title}>Training Program</Text>
            <Text style={styles.sub}>{new Date(training.created_at).toLocaleDateString()}</Text>
          </View>
        </View>

        {training.coach_notes && (
          <View style={styles.coachNotesBox}>
            <View style={styles.coachNotesHeader}>
              <Ionicons name="chatbubble" size={14} color="#16a34a" />
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
                <ActivityIndicator color="#16a34a" />
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
                  c.coach_id ? { color: '#2563eb' } : { color: '#16a34a' },
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
  heading3: { color: '#9ca3af', fontSize: 13, fontWeight: '700' as const, marginTop: 12, marginBottom: 2 },
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
  coachNotesBox: {
    backgroundColor: '#16a34a22',
    borderLeftWidth: 3,
    borderLeftColor: '#16a34a',
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 14,
    borderRadius: 10,
  },
  coachNotesHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  coachNotesLabel: { color: '#16a34a', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  coachNotesText: { color: '#d1d5db', fontSize: 13, lineHeight: 20 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: {
    color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 12,
  },
  programBox: { backgroundColor: '#1a2e1a', borderRadius: 12, padding: 16 },
  generatingBox: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  generatingText: { color: '#4b7a4b', fontSize: 13 },
  commentCard: {
    backgroundColor: '#1a2e1a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2d4a2d',
  },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  commentAuthor: { fontSize: 12, fontWeight: '700' },
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
