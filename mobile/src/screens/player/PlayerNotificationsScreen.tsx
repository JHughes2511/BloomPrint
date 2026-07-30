import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playerNotificationsAPI, shareApprovalsAPI } from '../../api/playerClient';
import { AppNotification } from '../../types';
import { Alert } from 'react-native';
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
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [actioning, setActioning] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const [data, appr] = await Promise.all([
        playerNotificationsAPI.list(),
        shareApprovalsAPI.list().catch(() => []),
      ]);
      setNotifications(data);
      setApprovals(appr ?? []);
      // Mark all read in background so home badge clears — but keep visual unread state in list
      const hasUnread = data.some((n: any) => !n.read);
      if (hasUnread) {
        playerNotificationsAPI.markAllRead().catch(() => {});
      }
    } catch {}
    setLoading(false);
    setRefreshing(false);
  };

  const resolveApproval = async (id: number, action: 'approve' | 'reject') => {
    setActioning(id);
    try {
      if (action === 'approve') await shareApprovalsAPI.approve(id);
      else await shareApprovalsAPI.reject(id);
      setApprovals(prev => prev.filter(a => a.id !== id));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.notifications.couldNotUpdate'));
    } finally {
      setActioning(null);
    }
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
          {/* Long translated titles scale down to one line instead of wrapping. */}
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {tr('playerApp.notifications.title')}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>{tr('playerApp.notifications.unread', { count: notifications.filter(n => !n.read).length })}</Text>
        </View>

        {/* Pending consent requests — someone wants to share YOUR report */}
        {approvals.map(a => (
          <View key={`appr-${a.id}`} style={styles.approvalCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Ionicons name="shield-checkmark-outline" size={18} color={t.accent} />
              <Text style={styles.approvalTitle} numberOfLines={1}>{tr('playerApp.notifications.approvalNeeded')}</Text>
            </View>
            <Text style={styles.approvalBody}>
              <Text style={{ fontFamily: fonts[700], color: t.ink }}>{a.coach_name}</Text> {tr('playerApp.notifications.wantsToSendYour')}{' '}
              {String(a.output_type || tr('playerApp.notifications.report')).replace(/_/g, ' ')} {tr('playerApp.notifications.reportParenAbout')} {a.subject_player_name || tr('playerApp.notifications.you')}{tr('playerApp.notifications.toRecipientClose')}{' '}
              <Text style={{ fontFamily: fonts[700], color: t.ink }}>{a.recipient_name}</Text> {tr('playerApp.notifications.notAboutPlayer')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <TouchableOpacity
                style={[styles.rejectBtn, actioning === a.id && { opacity: 0.5 }]}
                onPress={() => resolveApproval(a.id, 'reject')} disabled={actioning === a.id}>
                <Text style={styles.rejectText} numberOfLines={1}>{tr('playerApp.notifications.reject')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.approveBtn, actioning === a.id && { opacity: 0.5 }]}
                onPress={() => resolveApproval(a.id, 'approve')} disabled={actioning === a.id}>
                {actioning === a.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.approveText} numberOfLines={1}>{tr('playerApp.notifications.approve')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {notifications.length === 0 && approvals.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-outline" size={48} color={t.muted2} />
            <Text style={styles.emptyTitle} numberOfLines={2}>{tr('playerApp.notifications.noNotifications')}</Text>
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
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginLeft: 12 }}>
                <Text style={[styles.notifTitle, !n.read && styles.notifTitleUnread]} numberOfLines={1}>
                  {n.title}
                </Text>
                <Text style={styles.notifBody} numberOfLines={2}>{n.body}</Text>
                <Text style={styles.notifDate} numberOfLines={1}>{new Date(n.created_at).toLocaleDateString()}</Text>
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
  title: { color: t.ink, fontSize: 26, fontFamily: fonts[900], flexShrink: 1 },
  sub: { color: t.positive, fontSize: 12, marginTop: 4, flexShrink: 1 },
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
    flexShrink: 0,
  },
  iconBgUnread: { backgroundColor: t.positiveSoft },
  notifTitle: { color: t.muted, fontSize: 13, fontFamily: fonts[600], marginBottom: 2, flexShrink: 1 },
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
    flexShrink: 0,
  },
  approvalCard: {
    backgroundColor: t.card, borderRadius: 12, padding: 14,
    marginHorizontal: 20, marginBottom: 10, borderWidth: 1, borderColor: t.accent,
  },
  approvalTitle: { color: t.ink, fontSize: 14, fontFamily: fonts[800], flexShrink: 1 },
  approvalBody: { color: t.inkSoft, fontSize: 13, lineHeight: 19 },
  rejectBtn: { flex: 1, flexShrink: 1, minWidth: 0, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: t.chip, borderWidth: 1, borderColor: t.line },
  rejectText: { color: t.ink, fontFamily: fonts[700], fontSize: 14, flexShrink: 1 },
  approveBtn: { flex: 1, flexShrink: 1, minWidth: 0, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: t.accent },
  approveText: { color: '#fff', fontFamily: fonts[700], fontSize: 14, flexShrink: 1 },
});
