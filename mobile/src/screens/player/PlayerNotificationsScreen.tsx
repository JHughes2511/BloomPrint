import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playerNotificationsAPI } from '../../api/playerClient';
import { AppNotification } from '../../types';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';

const NOTIF_ICONS: Record<string, string> = {
  report_shared: 'mail',
  link_approved: 'checkmark-circle',
  training_updated: 'barbell',
  player_commented: 'chatbubble',
  training_generated: 'barbell',
  training_shared: 'barbell',
};

export default function PlayerNotificationsScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const styles = makeStyles(t);
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
    } else if (notif.type === 'training_shared' && notif.ref_id) {
      navigation.navigate('PlayerCoachTrainingDetail', { trainingId: notif.ref_id });
    } else if (notif.type === 'team_report_shared' && notif.ref_id) {
      navigation.navigate('PlayerTeamReportDetail', { reportId: notif.ref_id });
    }
  };

  if (loading) {
    return (
      <ScreenBackground style={styles.center}>
        <ActivityIndicator color={t.positive} size="large" />
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={t.positive} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.sub}>{notifications.filter(n => !n.read).length} unread</Text>
        </View>

        {notifications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-outline" size={48} color={t.muted2} />
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
                  color={n.read ? t.muted : t.positive}
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
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { padding: 24, paddingTop: 60 },
  title: { color: t.ink, fontSize: 26, fontFamily: fonts[900] },
  sub: { color: t.positive, fontSize: 12, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { color: t.ink, fontSize: 16, fontFamily: fonts[700], marginTop: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 20,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  cardUnread: { borderColor: t.positive },
  iconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: t.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBgUnread: { backgroundColor: t.positiveSoft },
  notifTitle: { color: t.muted, fontSize: 13, fontFamily: fonts[600], marginBottom: 2 },
  notifTitleUnread: { color: t.ink },
  notifBody: { color: t.muted2, fontSize: 12, lineHeight: 18 },
  notifDate: { color: t.muted, fontSize: 11, marginTop: 4 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.positive,
    marginTop: 4,
    marginLeft: 8,
  },
});
