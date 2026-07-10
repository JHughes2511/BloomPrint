import React, { useCallback, useState } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, TextInput,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playerAPI, trainingAPI, teamStaffAPI, staffSharingAPI } from '../api/client';
import CommentThread from '../components/CommentThread';
import SharedReportViewer from '../components/SharedReportViewer';
import { AppNotification } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

const NOTIF_ICONS: Record<string, string> = {
  link_requested: 'link',
  player_commented: 'chatbubble',
  player_commented_training: 'chatbubble',
  player_commented_coach_training: 'chatbubble',
  training_generated: 'barbell',
  training_feedback: 'barbell',
  staff_message: 'chatbubble-ellipses',
  team_invite: 'people-circle-outline',
  team_invite_approved: 'checkmark-circle',
  team_invite_rejected: 'close-circle',
  philosophy_update: 'sparkles-outline',
};

export default function CoachNotificationsScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});
  const [replying, setReplying] = useState<number | null>(null);
  const [threads, setThreads] = useState<Record<number, any[]>>({});
  const [viewerShared, setViewerShared] = useState<any | null>(null);

  const openSharedReport = async (sharedId: number) => {
    try {
      const inbox = await staffSharingAPI.inbox();
      const found = (inbox ?? []).find((s: any) => s.id === sharedId);
      if (found) setViewerShared(found);
      else Alert.alert('Unavailable', 'This shared report is no longer available.');
    } catch {
      Alert.alert('Error', 'Could not open the report.');
    }
  };

  const loadThread = async (notifId: number, sharedId: number) => {
    try {
      const res = await playerAPI.coachViewSharedReport(sharedId);
      setThreads(prev => ({ ...prev, [notifId]: res?.comments ?? [] }));
    } catch {
      setThreads(prev => ({ ...prev, [notifId]: [] }));
    }
  };

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
      <ScreenBackground>
        <View style={styles.center}>
          <ActivityIndicator color={t.accent} size="large" />
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={t.accent} />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={t.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
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
            onPress={async () => {
              if (n.type === 'staff_message' && n.ref_id) {
                if (!n.read) { try { await playerAPI.coachMarkRead(n.id); } catch {} }
                navigation.navigate('Conversation', { conversationId: n.ref_id });
                return;
              }
              const willExpand = expandedId !== n.id;
              setExpandedId(prev => prev === n.id ? null : n.id);
              if (willExpand && n.type === 'player_commented' && n.ref_id) {
                loadThread(n.id, n.ref_id);
              }
              if (!n.read) {
                try { await playerAPI.coachMarkRead(n.id); } catch {}
                setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
              }
            }}
            activeOpacity={0.8}
          >
            <View style={styles.cardMain}>
              <View style={styles.iconBg}>
                <Ionicons
                  name={(NOTIF_ICONS[n.type] ?? 'notifications') as any}
                  size={18}
                  color={n.read ? t.muted2 : t.accent}
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
                color={t.muted2}
                style={{ marginLeft: 4 }}
              />
            </View>

            {expandedId === n.id && (
              <View style={styles.expandedContent}>
                {(n.type === 'player_commented' || n.type === 'player_commented_training'
                  || n.type === 'player_commented_coach_training' || n.type === 'training_feedback') && n.ref_id ? (
                  <>
                    {n.type === 'player_commented' && (threads[n.id]?.length ?? 0) > 0 && (
                      <View style={{ marginBottom: 10 }}>
                        <CommentThread
                          comments={threads[n.id] as any}
                          accent={t.accent}
                          onReply={async (parentId, text) => {
                            await playerAPI.coachReplyToReport(n.ref_id!, text, parentId);
                            await loadThread(n.id, n.ref_id!);
                          }}
                        />
                      </View>
                    )}
                    <VoiceTextInput
                      style={styles.replyInput}
                      placeholder="Reply to player..."
                      placeholderTextColor={t.muted2}
                      value={replyTexts[n.id] ?? ''}
                      onChangeText={text => setReplyTexts(prev => ({ ...prev, [n.id]: text }))}
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
                          if (n.type === 'player_commented_training') {
                            await playerAPI.addCoachComment(n.ref_id!, { text });
                          } else if (n.type === 'player_commented_coach_training' || n.type === 'training_feedback') {
                            await trainingAPI.addComment(n.ref_id!, text);
                          } else {
                            await playerAPI.coachReplyToReport(n.ref_id!, text);
                          }
                          await playerAPI.coachMarkRead(n.id);
                          setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                          setReplyTexts(prev => ({ ...prev, [n.id]: '' }));
                          setExpandedId(null);
                        } catch (e: any) {
                          Alert.alert('Error', e?.response?.data?.detail ?? 'Could not send reply');
                        } finally {
                          setReplying(null);
                        }
                      }}
                    >
                      {replying === n.id ? <ActivityIndicator color={t.ctaText} size="small" /> : <Text style={styles.replyBtnText}>Send Reply</Text>}
                    </TouchableOpacity>
                  </>
                ) : n.type === 'philosophy_update' ? (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.approveBtn, { backgroundColor: t.chip, flex: 1, alignItems: 'center' }]}
                      onPress={async () => {
                        try { await playerAPI.coachMarkRead(n.id); } catch {}
                        setNotifications(prev => prev.filter(x => x.id !== n.id));
                      }}>
                      <Text style={{ color: t.ink, fontFamily: fonts[700] }}>No update needed</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.approveBtn, { backgroundColor: t.ctaBg, flex: 1, alignItems: 'center' }]}
                      onPress={async () => {
                        try { await playerAPI.coachMarkRead(n.id); } catch {}
                        setNotifications(prev => prev.filter(x => x.id !== n.id));
                        navigation.navigate('Onboarding');
                      }}>
                      <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>Review & update</Text>
                    </TouchableOpacity>
                  </View>
                ) : n.type === 'team_invite' && n.ref_id ? (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.approveBtn, { backgroundColor: t.chip, flex: 1, alignItems: 'center' }]}
                      onPress={async () => {
                        try { await teamStaffAPI.rejectInvite(n.ref_id!); } catch {}
                        await playerAPI.coachMarkRead(n.id);
                        setNotifications(prev => prev.filter(x => x.id !== n.id));
                      }}>
                      <Text style={{ color: t.ink, fontFamily: fonts[700] }}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.approveBtn, { backgroundColor: t.ctaBg, flex: 1, alignItems: 'center' }]}
                      onPress={async () => {
                        try { await teamStaffAPI.approveInvite(n.ref_id!); } catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not accept.'); return; }
                        await playerAPI.coachMarkRead(n.id);
                        setNotifications(prev => prev.filter(x => x.id !== n.id));
                        Alert.alert('Joined', 'You joined the team.');
                      }}>
                      <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>Accept</Text>
                    </TouchableOpacity>
                  </View>
                ) : (n.type === 'training_generated' || n.type === 'training_refreshed') && n.ref_id ? (
                  <View>
                    <Text style={{ color: t.muted, fontSize: 12, marginBottom: 8 }}>
                      {n.type === 'training_refreshed' ? 'Player updated their training with feedback.' : 'Player generated a new training program.'}
                    </Text>
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={[styles.approveBtn, { backgroundColor: t.ctaBg, flex: 1, alignItems: 'center' }]}
                        onPress={async () => {
                          await playerAPI.coachMarkRead(n.id);
                          setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                          setExpandedId(null);
                          navigation.navigate('CoachTrainingDetail', { trainingId: n.ref_id });
                        }}
                      >
                        <Text style={[styles.approveBtnText, { color: t.ctaText }]}>View Training</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : n.type === 'link_requested' && n.ref_id ? (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.approveBtn} onPress={() => approveLink(n.ref_id!, n.id)}>
                      <Text style={styles.approveBtnText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.rejectBtn} onPress={() => rejectLink(n.ref_id!, n.id)}>
                      <Text style={styles.rejectBtnText}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                ) : (n.type === 'staff_report_shared' || n.type === 'staff_share' || n.type === 'staff_report_regenerated' || n.type === 'staff_report_comment') && n.ref_id ? (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.approveBtn} onPress={() => openSharedReport(n.ref_id!)}>
                      <Text style={styles.approveBtnText}>View Report</Text>
                    </TouchableOpacity>
                    {!n.read && (
                      <TouchableOpacity
                        style={styles.rejectBtn}
                        onPress={async () => {
                          await playerAPI.coachMarkRead(n.id);
                          setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                        }}
                      >
                        <Text style={styles.rejectBtnText}>Mark as Read</Text>
                      </TouchableOpacity>
                    )}
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
    </KeyboardAwareScrollView>
    <SharedReportViewer
      shared={viewerShared}
      visible={!!viewerShared}
      onClose={() => setViewerShared(null)}
    />
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingTop: 56 },
  title: { color: t.ink, fontSize: 20, fontFamily: fonts[800] },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { color: t.ink, fontSize: 16, fontFamily: fonts[700], marginTop: 16 },
  card: {
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 20,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  cardMain: { flexDirection: 'row', alignItems: 'flex-start' },
  cardUnread: { borderColor: t.accent },
  iconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: t.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifTitle: { color: t.muted, fontSize: 13, fontFamily: fonts[600], marginBottom: 2 },
  notifTitleUnread: { color: t.ink },
  notifBody: { color: t.muted2, fontSize: 12, lineHeight: 18 },
  notifDate: { color: t.muted2, fontSize: 11, marginTop: 4 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.accent,
    marginTop: 4,
    marginLeft: 8,
  },
  expandedContent: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.line },
  replyInput: {
    backgroundColor: t.chip,
    borderRadius: 8,
    padding: 10,
    color: t.ink,
    fontSize: 13,
    borderWidth: 1,
    borderColor: t.line,
    marginBottom: 8,
    minHeight: 60,
  },
  replyBtn: { backgroundColor: t.ctaBg, borderRadius: 8, padding: 10, alignItems: 'center' },
  replyBtnText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 13 },
  actionRow: { flexDirection: 'row', gap: 8 },
  approveBtn: {
    backgroundColor: t.positive,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  approveBtnText: { color: t.brownInk, fontFamily: fonts[700], fontSize: 12 },
  rejectBtn: {
    backgroundColor: t.negativeSoft,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: t.negative,
  },
  rejectBtnText: { color: t.negative, fontFamily: fonts[700], fontSize: 12 },
  markReadBtn: { padding: 8, alignItems: 'center', borderWidth: 1, borderColor: t.line, borderRadius: 8 },
  markReadText: { color: t.muted, fontSize: 12, fontFamily: fonts[600] },
});
