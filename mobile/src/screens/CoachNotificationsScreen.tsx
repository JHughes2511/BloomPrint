import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
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

  const load = async () => {
    try {
      const data = await playerAPI.coachNotifications();
      setNotifications(data);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const markRead = async (notif: AppNotification) => {
    if (!notif.read) {
      await playerAPI.coachMarkRead(notif.id);
      setNotifications(prev =>
        prev.map(n => n.id === notif.id ? { ...n, read: true } : n)
      );
    }
  };

  const approveLink = async (requestId: number, notifId: number) => {
    try {
      await playerAPI.approveLink(requestId);
      await playerAPI.coachMarkRead(notifId);
      setNotifications(prev =>
        prev.map(n => n.id === notifId ? { ...n, read: true } : n)
      );
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
            onPress={() => markRead(n)}
          >
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

              {n.type === 'link_requested' && n.ref_id && (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.approveBtn}
                    onPress={() => approveLink(n.ref_id!, n.id)}
                  >
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.rejectBtn}
                    onPress={() => rejectLink(n.ref_id!, n.id)}
                  >
                    <Text style={styles.rejectBtnText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
            {!n.read && <View style={styles.dot} />}
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 20,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
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
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
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
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563eb',
    marginTop: 4,
    marginLeft: 8,
  },
});
