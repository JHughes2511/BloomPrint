import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playerNotificationsAPI } from '../../api/playerClient';
import { AppNotification } from '../../types';

const NOTIF_ICONS: Record<string, string> = {
  report_shared: 'mail',
  link_approved: 'checkmark-circle',
  training_updated: 'barbell',
  player_commented: 'chatbubble',
  training_generated: 'barbell',
};

export default function PlayerNotificationsScreen() {
  const navigation = useNavigation<any>();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const data = await playerNotificationsAPI.list();
      setNotifications(data);
      // Mark all read in background so home badge clears — but keep visual unread state in list
      const hasUnread = data.some((n: any) => !n.read);
      if (hasUnread) {
        playerNotificationsAPI.markAllRead().catch(() => {});
      }
    } catch {}
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const handleTap = (notif: AppNotification) => {
    // Mark as read visually
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
    if (notif.type === 'report_shared' && notif.ref_id) {
      navigation.navigate('PlayerReportDetail', { reportId: notif.ref_id });
    } else if (notif.type === 'training_updated' && notif.ref_id) {
      navigation.navigate('PlayerTrainingDetail', { trainingId: notif.ref_id });
    } else if (notif.type === 'training_generated' && notif.ref_id) {
      navigation.navigate('PlayerTrainingDetail', { trainingId: notif.ref_id });
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#16a34a" size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#16a34a" />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        <Text style={styles.sub}>{notifications.filter(n => !n.read).length} unread</Text>
      </View>

      {notifications.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="notifications-outline" size={48} color="#2d4a2d" />
          <Text style={styles.emptyTitle}>No notifications</Text>
        </View>
      ) : (
        notifications.map(n => (
          <TouchableOpacity
            key={n.id}
            style={[styles.card, !n.read && styles.cardUnread]}
            onPress={() => handleTap(n)}
          >
            <View style={[styles.iconBg, !n.read && styles.iconBgUnread]}>
              <Ionicons
                name={(NOTIF_ICONS[n.type] ?? 'notifications') as any}
                size={18}
                color={n.read ? '#4b7a4b' : '#16a34a'}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.notifTitle, !n.read && styles.notifTitleUnread]}>
                {n.title}
              </Text>
              <Text style={styles.notifBody} numberOfLines={2}>{n.body}</Text>
              <Text style={styles.notifDate}>{new Date(n.created_at).toLocaleDateString()}</Text>
            </View>
            {!n.read && <View style={styles.dot} />}
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1a0f' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f1a0f' },
  header: { padding: 24, paddingTop: 60 },
  title: { color: '#fff', fontSize: 26, fontWeight: '900' },
  sub: { color: '#4b7a4b', fontSize: 12, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1a2e1a',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 20,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2d4a2d',
  },
  cardUnread: { borderColor: '#16a34a' },
  iconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#2d4a2d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBgUnread: { backgroundColor: '#16a34a22' },
  notifTitle: { color: '#9ca3af', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  notifTitleUnread: { color: '#fff' },
  notifBody: { color: '#6b7280', fontSize: 12, lineHeight: 18 },
  notifDate: { color: '#4b7a4b', fontSize: 11, marginTop: 4 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16a34a',
    marginTop: 4,
    marginLeft: 8,
  },
});
