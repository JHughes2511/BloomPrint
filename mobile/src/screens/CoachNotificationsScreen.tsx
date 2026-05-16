import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, TextInput,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playerAPI } from '../api/client';
import { AppNotification } from '../types';

const NOTIF_ICONS: Record<string, string> = {
  link_requested: 'link',
  player_commented: 'chatbubble',
  training_generated: 'barbell',
};

export default function CoachNotificationsScreen() {
  const navigation = useNavigation<any>();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});
  const [replying, setReplying] = useState<number | null>(null);

  const load = async () => {
    try {
      const data = await playerAPI.coachNotifications();
      setNotifications(data);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const approveLink = async (requestId: number, notifId: number) => {
    try {
      await playerAPI.approveLink(requestId);
      await playerAPI.coachMarkRead(notifId);
      setNotifications(prev =>
        prev.map(n => n.id === notifId ? { ...n, read: true } : n)
      );
      setExpandedId(null);
      Alert.alert('Approved', 'Player profile has been linked.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to approve');
    }
  };

  const rejectLink = async (requestId: number, notifId: number) => {
    try {
      await playerAPI.rejectLink(requestId);
      await playerAPI.coachMarkRead(notifId);
      setNotifications(prev =>
        prev.map(n => n.id === notifId ? { ...n, read: true } : n)
      );
      setExpandedId(null);
      Alert.alert('Rejected', 'Link request rejected.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to reject');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#2563eb" size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#2563eb" />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
      </View>

      {notifications.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="notifications-outline" size={48} color="#374151" />
          <Text style={styles.emptyTitle}>No notifications</Text>
        </View>
      ) : (
        notifications.map(n => (
          <TouchableOpacity
            key={n.id}
            style={[styles.card, !n.read && styles.cardUnread]}
            onPress={() => setExpandedId(prev => prev === n.id ? null : n.id)}
            activeOpacity={0.8}
          >
            <View style={styles.cardMain}>
              <View style={styles.iconBg}>
                <Ionicons
                  name={(NOTIF_ICONS[n.type] ?? 'notifications') as any}
                  size={18}
                  color={n.read ? '#6b7280' : '#2563eb'}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.notifTitle, !n.read && styles.notifTitleUnread]}>
                  {n.title}
                </Text>
                <Text style={styles.notifBody}>{n.body}</Text>
                <Text style={styles.notifDate}>{new Date(n.created_at).toLocaleDateString()}</Text>
              </View>
              {!n.read && <View style={styles.dot} />}
              <Ionicons
                name={expandedId === n.id ? 'chevron-up' : 'chevron-down'}
                size={14}
                color="#4b5563"
                style={{ marginLeft: 4 }}
              />
            </View>

            {expandedId === n.id && (
              <View style={styles.expandedContent}>
                {n.type === 'player_commented' && n.ref_id ? (
                  <>
                    <TextInput
                      style={styles.replyInput}
                      placeholder="Reply to player..."
                      placeholderTextColor="#4b5563"
                      value={replyTexts[n.id] ?? ''}
                      onChangeText={t => setReplyTexts(prev => ({ ...prev, [n.id]: t }))}
                      multiline
                    />
                    <TouchableOpacity
                      style={styles.replyBtn}
                      disabled={replying === n.id || !replyTexts[n.id]?.trim()}
                      onPress={async () => {
                        const text = replyTexts[n.id]?.trim();
                        if (!text) return;
                        setReplying(n.id);
                        try {
                          await playerAPI.coachReplyToReport(n.ref_id!, text);
                          await playerAPI.coachMarkRead(n.id);
                          setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                          setReplyTexts(prev => ({ ...prev, [n.id]: '' }));
                          setExpandedId(null);
                        } catch (e: any) {
                          Alert.alert('Error', 'Could not send reply');
                        } finally {
                          setReplying(null);
                        }
                      }}
                    >
                      {replying === n.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.replyBtnText}>Send Reply</Text>}
                    </TouchableOpacity>
                  </>
                ) : n.type === 'link_requested' && n.ref_id ? (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.approveBtn} onPress={() => approveLink(n.ref_id!, n.id)}>
                      <Text style={styles.approveBtnText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.rejectBtn} onPress={() => rejectLink(n.ref_id!, n.id)}>
                      <Text style={styles.rejectBtnText}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                ) : !n.read ? (
                  <TouchableOpacity
                    style={styles.markReadBtn}
                    onPress={async () => {
                      await playerAPI.coachMarkRead(n.id);
                      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                      setExpandedId(null);
                    }}
                  >
                    <Text style={styles.markReadText}>Mark as Read</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingTop: 56 },
  title: { color: '#fff', fontSize: 20, fontWeight: '800' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 16 },
  card: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 20,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  cardMain: { flexDirection: 'row', alignItems: 'flex-start' },
  cardUnread: { borderColor: '#2563eb' },
  iconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifTitle: { color: '#9ca3af', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  notifTitleUnread: { color: '#fff' },
  notifBody: { color: '#6b7280', fontSize: 12, lineHeight: 18 },
  notifDate: { color: '#374151', fontSize: 11, marginTop: 4 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563eb',
    marginTop: 4,
    marginLeft: 8,
  },
  expandedContent: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1f2937' },
  replyInput: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 10,
    color: '#fff',
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#374151',
    marginBottom: 8,
    minHeight: 60,
  },
  replyBtn: { backgroundColor: '#2563eb', borderRadius: 8, padding: 10, alignItems: 'center' },
  replyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  actionRow: { flexDirection: 'row', gap: 8 },
  approveBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  rejectBtn: {
    backgroundColor: '#dc262622',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#dc2626',
  },
  rejectBtnText: { color: '#dc2626', fontWeight: '700', fontSize: 12 },
  markReadBtn: { padding: 8, alignItems: 'center', borderWidth: 1, borderColor: '#374151', borderRadius: 8 },
  markReadText: { color: '#6b7280', fontSize: 12, fontWeight: '600' },
});
