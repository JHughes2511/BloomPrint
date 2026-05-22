import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, TextInput, KeyboardAvoidingView,
  Platform, ScrollView, Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { staffSharingAPI } from '../api/client';

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

const REPORT_TYPE_LABELS: Record<string, string> = {
  eval: 'Player Eval',
  game: 'Game Report',
  team_training: 'Team Training',
  team_report: 'Team Report',
};

export default function StaffInboxScreen() {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeItem, setActiveItem] = useState<any | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [regenerateFeedback, setRegenerateFeedback] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [view, setView] = useState<'report' | 'comments' | 'regenerate'>('report');

  const load = async () => {
    setLoading(true);
    try {
      const inbox = await staffSharingAPI.inbox();
      setItems(inbox);
    } catch {}
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const openItem = async (item: any) => {
    setActiveItem(item);
    setView('report');
    setComments([]);
    setCommentText('');
    setRegenerateFeedback('');
    try {
      const c = await staffSharingAPI.getComments(item.id);
      setComments(c);
    } catch {}
  };

  const submitComment = async () => {
    if (!commentText.trim() || !activeItem) return;
    setSubmittingComment(true);
    try {
      const c = await staffSharingAPI.addComment(activeItem.id, commentText.trim());
      setComments(prev => [...prev, c]);
      setCommentText('');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not add comment');
    } finally {
      setSubmittingComment(false);
    }
  };

  const regenerate = async () => {
    if (!regenerateFeedback.trim() || !activeItem) return;
    setRegenerating(true);
    try {
      const updated = await staffSharingAPI.regenerate(activeItem.id, regenerateFeedback.trim());
      setActiveItem({ ...activeItem, report_text: updated.report_text });
      setRegenerateFeedback('');
      setView('report');
      Alert.alert('Updated', 'Report regenerated with your feedback.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not regenerate');
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Staff Inbox</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={i => String(i.id)}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="mail-outline" size={48} color="#374151" />
            <Text style={styles.emptyText}>No reports shared with you yet.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => openItem(item)}>
            <View style={styles.iconBox}>
              <Ionicons name="document-text-outline" size={18} color="#2563eb" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{REPORT_TYPE_LABELS[item.report_type] ?? item.report_type}</Text>
              <Text style={styles.cardSub}>From: {item.sender_name}</Text>
              <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
            </View>
            {item.allow_regenerate && (
              <View style={styles.regenBadge}>
                <Text style={styles.regenBadgeText}>Can Regen</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={14} color="#4b5563" />
          </TouchableOpacity>
        )}
      />

      {/* Detail modal */}
      <Modal visible={!!activeItem} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {REPORT_TYPE_LABELS[activeItem?.report_type ?? ''] ?? activeItem?.report_type ?? 'Report'}
                </Text>
                <Text style={styles.modalSub}>From {activeItem?.sender_name}</Text>
              </View>
              <TouchableOpacity onPress={() => setActiveItem(null)}>
                <Ionicons name="close" size={22} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            {/* View switcher */}
            <View style={styles.tabRow}>
              {(['report', 'comments'] as const).map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.tab, view === t && styles.tabActive]}
                  onPress={() => setView(t)}
                >
                  <Text style={[styles.tabText, view === t && styles.tabTextActive]}>
                    {t === 'report' ? 'Report' : `Comments (${comments.length})`}
                  </Text>
                </TouchableOpacity>
              ))}
              {activeItem?.allow_regenerate && (
                <TouchableOpacity
                  style={[styles.tab, view === 'regenerate' && styles.tabActive]}
                  onPress={() => setView('regenerate')}
                >
                  <Text style={[styles.tabText, view === 'regenerate' && styles.tabTextActive]}>Regenerate</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Report view */}
            {view === 'report' && (
              <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
                {activeItem?.report_text
                  ? <Markdown style={mdStyles}>{cleanMarkdown(activeItem.report_text)}</Markdown>
                  : <Text style={{ color: '#6b7280' }}>No report content available.</Text>
                }
              </ScrollView>
            )}

            {/* Comments view */}
            {view === 'comments' && (
              <>
                <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={{ paddingBottom: 8 }}>
                  {comments.length === 0 && (
                    <Text style={{ color: '#6b7280', textAlign: 'center', paddingVertical: 20 }}>No comments yet.</Text>
                  )}
                  {comments.map((c: any) => (
                    <View key={c.id} style={styles.commentCard}>
                      <Text style={styles.commentAuthor}>{c.author_name}</Text>
                      <Text style={styles.commentText}>{c.text}</Text>
                      <Text style={styles.commentDate}>{new Date(c.created_at).toLocaleDateString()}</Text>
                    </View>
                  ))}
                </ScrollView>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Add a comment..."
                    placeholderTextColor="#4b5563"
                    value={commentText}
                    onChangeText={setCommentText}
                    multiline
                  />
                  <TouchableOpacity
                    style={styles.sendBtn}
                    onPress={submitComment}
                    disabled={submittingComment || !commentText.trim()}
                  >
                    {submittingComment
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Ionicons name="send" size={18} color="#fff" />}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Regenerate view */}
            {view === 'regenerate' && (
              <>
                <Text style={{ color: '#6b7280', fontSize: 12, marginBottom: 10 }}>
                  Provide feedback to regenerate this report with AI.
                </Text>
                <TextInput
                  style={[styles.input, { minHeight: 100 }]}
                  placeholder="What needs to be updated or corrected?"
                  placeholderTextColor="#4b5563"
                  value={regenerateFeedback}
                  onChangeText={setRegenerateFeedback}
                  multiline
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[styles.regenBtn, (!regenerateFeedback.trim() || regenerating) && { opacity: 0.5 }]}
                  onPress={regenerate}
                  disabled={!regenerateFeedback.trim() || regenerating}
                >
                  {regenerating
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ color: '#fff', fontWeight: '700' }}>Regenerate Report</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const mdStyles = {
  body: { color: '#d1d5db', fontSize: 13, lineHeight: 22 },
  heading1: { color: '#fff', fontSize: 16, fontWeight: '800' as const, marginTop: 16, marginBottom: 4 },
  heading2: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' as const, marginTop: 12, marginBottom: 4 },
  heading3: { color: '#9ca3af', fontSize: 13, fontWeight: '700' as const, marginTop: 10, marginBottom: 2 },
  strong: { color: '#fff', fontWeight: '700' as const },
  bullet_list: { marginLeft: 8 },
  list_item: { color: '#d1d5db', fontSize: 13 },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 56 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '900', color: '#fff' },
  emptyText: { color: '#4b5563', marginTop: 12, fontSize: 14 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#111827', marginHorizontal: 16, marginBottom: 8,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#1f2937',
  },
  iconBox: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#1e3a5f', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cardSub: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  cardDate: { color: '#4b5563', fontSize: 11, marginTop: 2 },
  regenBadge: { backgroundColor: '#7c3aed22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#7c3aed' },
  regenBadgeText: { color: '#7c3aed', fontSize: 10, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#111827', borderRadius: 20, padding: 20, maxHeight: '90%', margin: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  modalSub: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: { borderWidth: 1, borderColor: '#374151', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  tabActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  tabText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  commentCard: { backgroundColor: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 8 },
  commentAuthor: { color: '#2563eb', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  commentText: { color: '#d1d5db', fontSize: 13 },
  commentDate: { color: '#4b5563', fontSize: 11, marginTop: 6 },
  input: {
    backgroundColor: '#1f2937', borderRadius: 10, padding: 12, color: '#fff',
    fontSize: 14, borderWidth: 1, borderColor: '#374151', marginBottom: 8,
  },
  sendBtn: {
    backgroundColor: '#2563eb', borderRadius: 10, width: 44, alignItems: 'center', justifyContent: 'center',
  },
  regenBtn: {
    backgroundColor: '#7c3aed', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4,
  },
});
