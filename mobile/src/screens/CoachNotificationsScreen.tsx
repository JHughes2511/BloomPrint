import React, { useCallback, useState } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, TextInput,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useGoUp } from '../navigation/goUp';
import { useTranslation } from 'react-i18next';
import { notificationTitle, notificationBody } from '../utils/notificationText';
import { Ionicons } from '@expo/vector-icons';
import { playerAPI, trainingAPI, teamStaffAPI, staffSharingAPI } from '../api/client';
import CommentThread from '../components/CommentThread';
import SharedReportViewer from '../components/SharedReportViewer';
import { useAuth } from '../context/AuthContext';
import { AppNotification } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { topPad } from '../responsive/screenPadding';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';

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
  // Back means up a level — see navigation/goUp.ts.
  const goUp = useGoUp();
  const { coach } = useAuth();
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const styles = makeStyles(t);

  // Notifications are created server-side and render in the reader's language.
  // See utils/notificationText for the key/fallback contract.
  const notifTitle = (n: any) => notificationTitle(n, tr);
  const notifBody = (n: any) => notificationBody(n, tr);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});
  const [replying, setReplying] = useState<number | null>(null);
  const [threads, setThreads] = useState<Record<number, any[]>>({});
  const [viewerShared, setViewerShared] = useState<any | null>(null);
  // shared_id -> report_type, so notification buttons can say "…Training"/"…Report".
  const [sharedMeta, setSharedMeta] = useState<Record<number, string>>({});
  // shared_id -> the share itself. The list is already fetched to build the
  // labels above, so keeping the rows means tapping View opens the report
  // straight away instead of fetching the same two lists again first.
  const [sharedById, setSharedById] = useState<Record<number, any>>({});
  // shared_id -> how I responded to a request (keyed by share so ALL request
  // notifications for the same report update, not just the one I tapped).
  const [requestResponses, setRequestResponses] = useState<Record<number, 'approved' | 'denied'>>({});
  // Same idea for link requests: instant feedback before the refetch lands.
  const [linkResponses, setLinkResponses] = useState<Record<number, 'approved' | 'rejected'>>({});
  // shared_ids where I've sent a request (button becomes disabled "Requested")
  const [requestedIds, setRequestedIds] = useState<Record<number, boolean>>({});

  const TYPE_WORD: Record<string, string> = {
    training: tr('coachNotifs.typeTraining'), eval: tr('coachNotifs.typeEval'), team_report: tr('coachNotifs.typeTeamReport'),
    team_training: tr('coachNotifs.typeTeamReport'), game: tr('coachNotifs.typeGameReport'),
    // A shared game is the Game Insights page — grades, leaders, shooting,
    // key stats and both box scores. It was labelled a scout report, which is
    // a different document entirely.
    game_session: tr('teamGrade.gameInsights'),
  };
  const typeWord = (sharedId?: number | null) =>
    TYPE_WORD[(sharedId != null ? sharedMeta[sharedId] : '') ?? ''] ?? tr('coachNotifs.typeReport');

  /**
   * Open what a finished job produced.
   *
   * The kind travels on the notification because the server put it there for
   * translation; it is the same answer to "where does this live" that the
   * banner uses at the moment the job ends.
   */
  const openFinishedJob = (n: any) => {
    const kind = n?.i18n_params?.kind;
    const id = n?.ref_id;
    if (kind === 'packet' && id) {
      navigation.navigate('TeamTab' as never,
                          { screen: 'GameReportBuilder', params: { reportId: id } } as never);
    } else if ((kind === 'eval' || kind === 'eval_text') && id) {
      navigation.navigate('RecentTab' as never,
                          { screen: 'EvalReport', params: { evalId: id } } as never);
    } else if (kind === 'training' && id) {
      navigation.navigate('CoachTrainingDetail' as never, { trainingId: id } as never);
    } else {
      // A film breakdown, a scouting report, a team report: Recent is where
      // every one of them is listed, and it is never the wrong answer.
      navigation.navigate('RecentTab' as never, { screen: 'Recent' } as never);
    }
  };

  const openSharedReport = async (sharedId: number) => {
    try {
      // The share is almost always already here — the same two lists were read
      // when this screen loaded. Tapping View used to fetch both again and sit
      // on a blank screen for as long as that took, for a report the app was
      // already holding.
      let found = sharedById[sharedId];
      if (!found) {
        const [inbox, sent] = await Promise.all([
          staffSharingAPI.inbox().catch(() => []),
          staffSharingAPI.sent().catch(() => []),
        ]);
        found = [...(inbox ?? []), ...(sent ?? [])].find((s: any) => s.id === sharedId);
      }
      if (!found) { Alert.alert(tr('coachNotifs.unavailableTitle'), tr('coachNotifs.unavailableMsg')); return; }
      const amRecipient = found.recipient_id === coach?.id;
      // As the sharer, I can view the original + comments/notes freely. But if
      // the recipient made an updated version, that's private until they approve
      // — offer to request it.
      if (!amRecipient && found.has_update) {
        Alert.alert(
          tr('coachNotifs.updatedVersionTitle'),
          tr('coachNotifs.updatedVersionMsg'),
          [
            { text: tr('coachNotifs.requestApproval'), onPress: () => requestUpdated(sharedId) },
            { text: tr('coachNotifs.viewOriginal'), onPress: () => setViewerShared(found) },
            { text: tr('common.cancel'), style: 'cancel' },
          ],
        );
      } else {
        setViewerShared(found);
      }
    } catch {
      Alert.alert(tr('common.error'), tr('coachNotifs.openReportError'));
    }
  };

  const requestUpdated = async (sharedId: number) => {
    try {
      await staffSharingAPI.requestUpdated(sharedId);
      setRequestedIds(prev => ({ ...prev, [sharedId]: true }));
      Alert.alert(tr('coachNotifs.requested'), tr('coachNotifs.requestedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('coachNotifs.requestError'));
    }
  };

  const respondRequest = async (n: any, approve: boolean) => {
    try {
      await staffSharingAPI.respondRequest(n.ref_id, approve);
      // Mark every request notification for this same share as read + resolved.
      setRequestResponses(prev => ({ ...prev, [n.ref_id]: approve ? 'approved' : 'denied' }));
      const sameShare = notifications.filter(x => x.type === 'staff_report_request' && x.ref_id === n.ref_id && !x.read);
      await Promise.all(sameShare.map(x => playerAPI.coachMarkRead(x.id).catch(() => {})));
      setNotifications(prev => prev.map(x => (x.type === 'staff_report_request' && x.ref_id === n.ref_id) ? { ...x, read: true } : x));
      Alert.alert(approve ? tr('coachNotifs.sharedTitle') : tr('coachNotifs.declinedTitle'), approve ? tr('coachNotifs.sharedMsg') : tr('coachNotifs.declinedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('coachNotifs.respondError'));
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
      // Build shared_id -> report_type for type-aware button labels.
      const [inbox, sent] = await Promise.all([
        staffSharingAPI.inbox().catch(() => []),
        staffSharingAPI.sent().catch(() => []),
      ]);
      const meta: Record<number, string> = {};
      const rows: Record<number, any> = {};
      [...(inbox ?? []), ...(sent ?? [])].forEach((s: any) => {
        meta[s.id] = s.report_type;
        rows[s.id] = s;
      });
      setSharedMeta(meta);
      setSharedById(rows);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  /**
   * The settled state of a request, spanning the row where its buttons were.
   *
   * Not a disabled button: there is nothing left to press, and a greyed button
   * invites a tap that would ask the server to redo a decision it has already
   * recorded.
   */
  const outcomePill = (outcome: string) => (
    <View style={[styles.approveBtn, { backgroundColor: t.ctaBg, alignItems: 'center', opacity: 0.7 }]}>
      <Text style={[styles.approveBtnText, { color: t.ctaText }]} numberOfLines={1}>
        {outcome === 'rejected' || outcome === 'declined'
          ? tr('coachNotifs.denied')
          : tr('coachNotifs.approvedTitle')}
      </Text>
    </View>
  );

  const approveLink = async (requestId: number, notifId: number) => {
    try {
      await playerAPI.approveLink(requestId);
      setLinkResponses(prev => ({ ...prev, [requestId]: 'approved' }));
      await playerAPI.coachMarkRead(notifId);
      setNotifications(prev =>
        prev.map(n => n.id === notifId ? { ...n, read: true } : n)
      );
      setExpandedId(null);
      Alert.alert(tr('coachNotifs.approvedTitle'), tr('coachNotifs.approvedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('coachNotifs.approveError'));
    }
  };

  const rejectLink = async (requestId: number, notifId: number) => {
    try {
      await playerAPI.rejectLink(requestId);
      setLinkResponses(prev => ({ ...prev, [requestId]: 'rejected' }));
      await playerAPI.coachMarkRead(notifId);
      setNotifications(prev =>
        prev.map(n => n.id === notifId ? { ...n, read: true } : n)
      );
      setExpandedId(null);
      Alert.alert(tr('coachNotifs.rejectedTitle'), tr('coachNotifs.rejectedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('coachNotifs.rejectError'));
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
    <PageContainer padded={false} maxWidth={1600}>
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={t.accent} />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goUp()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={t.ink} />
        </TouchableOpacity>
        {/* Translated titles run 20-40% longer than English. Wrap to a second
            line rather than clipping — a truncated heading tells the coach
            less than a taller one costs them. */}
        <Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
          {tr('coachNotifs.title')}
        </Text>
      </View>

      {notifications.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="notifications-outline" size={48} color={t.muted2} />
          <Text style={styles.emptyTitle}>{tr('coachNotifs.noNotifications')}</Text>
        </View>
      ) : (
        notifications.map(n => (
          <TouchableOpacity
            key={n.id}
            style={[styles.card, !n.read && styles.cardUnread]}
            onPress={async () => {
              if (n.type === 'staff_message' && n.ref_id) {
                if (!n.read) { try { await playerAPI.coachMarkRead(n.id); } catch {} }
                navigation.push('Conversation', { conversationId: n.ref_id });
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
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginLeft: 12 }}>
                <Text style={[styles.notifTitle, !n.read && styles.notifTitleUnread]} numberOfLines={2}>
                  {notifTitle(n)}
                </Text>
                <Text style={styles.notifBody}>{notifBody(n)}</Text>
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
                      placeholder={tr('coachNotifs.replyPlaceholder')}
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
                          Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('coachNotifs.sendReplyError'));
                        } finally {
                          setReplying(null);
                        }
                      }}
                    >
                      {replying === n.id ? <ActivityIndicator color={t.ctaText} size="small" /> : <Text style={styles.replyBtnText} numberOfLines={1}>{tr('coachNotifs.sendReply')}</Text>}
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
                      <Text style={{ color: t.ink, fontFamily: fonts[700], flexShrink: 1 }} numberOfLines={1}>{tr('coachNotifs.noUpdateNeeded')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.approveBtn, { backgroundColor: t.ctaBg, flex: 1, alignItems: 'center' }]}
                      onPress={async () => {
                        try { await playerAPI.coachMarkRead(n.id); } catch {}
                        setNotifications(prev => prev.filter(x => x.id !== n.id));
                        navigation.navigate('Onboarding');
                      }}>
                      <Text style={{ color: t.ctaText, fontFamily: fonts[700], flexShrink: 1 }} numberOfLines={1}>{tr('coachNotifs.reviewUpdate')}</Text>
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
                      <Text style={{ color: t.ink, fontFamily: fonts[700], flexShrink: 1 }} numberOfLines={1}>{tr('coachNotifs.reject')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.approveBtn, { backgroundColor: t.ctaBg, flex: 1, alignItems: 'center' }]}
                      onPress={async () => {
                        try { await teamStaffAPI.approveInvite(n.ref_id!); } catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('coachNotifs.acceptError')); return; }
                        await playerAPI.coachMarkRead(n.id);
                        setNotifications(prev => prev.filter(x => x.id !== n.id));
                        Alert.alert(tr('coachNotifs.joinedTitle'), tr('coachNotifs.joinedMsg'));
                      }}>
                      <Text style={{ color: t.ctaText, fontFamily: fonts[700], flexShrink: 1 }} numberOfLines={1}>{tr('coachNotifs.accept')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : n.type === 'roster_player_proposed' && n.ref_id ? (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.approveBtn, { backgroundColor: t.chip, flex: 1, alignItems: 'center' }]}
                      onPress={async () => {
                        try { await teamStaffAPI.rejectRosterProposal(n.ref_id!); } catch {}
                        await playerAPI.coachMarkRead(n.id);
                        setNotifications(prev => prev.filter(x => x.id !== n.id));
                      }}>
                      <Text style={{ color: t.ink, fontFamily: fonts[700], flexShrink: 1 }} numberOfLines={1}>{tr('coachNotifs.reject')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.approveBtn, { backgroundColor: t.ctaBg, flex: 1, alignItems: 'center' }]}
                      onPress={async () => {
                        try { await teamStaffAPI.approveRosterProposal(n.ref_id!); }
                        catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('coachNotifs.acceptError')); return; }
                        await playerAPI.coachMarkRead(n.id);
                        setNotifications(prev => prev.filter(x => x.id !== n.id));
                        Alert.alert(tr('coachNotifs.rosterAddedTitle'), tr('coachNotifs.rosterAddedMsg'));
                      }}>
                      <Text style={{ color: t.ctaText, fontFamily: fonts[700], flexShrink: 1 }} numberOfLines={1}>{tr('coachNotifs.addToRoster')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (n.type === 'training_generated' || n.type === 'training_refreshed') && n.ref_id ? (
                  <View>
                    <Text style={{ color: t.muted, fontSize: 12, marginBottom: 8 }}>
                      {n.type === 'training_refreshed' ? tr('coachNotifs.trainingRefreshedMsg') : tr('coachNotifs.trainingGeneratedMsg')}
                    </Text>
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={[styles.approveBtn, { backgroundColor: t.ctaBg, flex: 1, alignItems: 'center' }]}
                        onPress={async () => {
                          await playerAPI.coachMarkRead(n.id);
                          setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                          setExpandedId(null);
                          navigation.push('CoachTrainingDetail', { trainingId: n.ref_id });
                        }}
                      >
                        <Text style={[styles.approveBtnText, { color: t.ctaText }]} numberOfLines={1}>{tr('coachNotifs.viewTraining')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : n.type === 'link_requested' && n.ref_id ? (
                  // The server's own record first, so the decision survives a
                  // reload; local state only covers the moment before the list
                  // is refetched.
                  (linkResponses[n.ref_id] ?? (n.outcome && n.outcome !== 'pending' ? n.outcome : null)) ? (
                    outcomePill(linkResponses[n.ref_id] ?? n.outcome)
                  ) : (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.approveBtn} onPress={() => approveLink(n.ref_id!, n.id)}>
                      <Text style={styles.approveBtnText} numberOfLines={1}>{tr('coachNotifs.approve')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.rejectBtn} onPress={() => rejectLink(n.ref_id!, n.id)}>
                      <Text style={styles.rejectBtnText} numberOfLines={1}>{tr('coachNotifs.reject')}</Text>
                    </TouchableOpacity>
                  </View>
                  )
                ) : n.type === 'staff_report_regenerated' && n.ref_id ? (
                  // I'm the original sharer: their updated copy is private — ask for it.
                  requestedIds[n.ref_id] ? (
                    <View style={[styles.approveBtn, { backgroundColor: t.ctaBg, alignItems: 'center', opacity: 0.7 }]}>
                      <Text style={[styles.approveBtnText, { color: t.ctaText }]} numberOfLines={1}>{tr('coachNotifs.requested')}</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.approveBtn, { backgroundColor: t.ctaBg, alignItems: 'center' }]}
                      onPress={() => requestUpdated(n.ref_id!)}
                    >
                      <Text style={[styles.approveBtnText, { color: t.ctaText }]} numberOfLines={1}>{tr('coachNotifs.requestType', { type: typeWord(n.ref_id) })}</Text>
                    </TouchableOpacity>
                  )
                ) : n.type === 'staff_report_request' && n.ref_id ? (
                  (requestResponses[n.ref_id] ?? (n.outcome && n.outcome !== 'pending' ? n.outcome : null)) ? (
                    outcomePill(requestResponses[n.ref_id] ?? n.outcome)
                  ) : (
                    <View style={styles.actionRow}>
                      <TouchableOpacity style={styles.approveBtn} onPress={() => respondRequest(n, true)}>
                        <Text style={styles.approveBtnText} numberOfLines={1}>{tr('coachNotifs.approve')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.rejectBtn} onPress={() => respondRequest(n, false)}>
                        <Text style={styles.rejectBtnText} numberOfLines={1}>{tr('coachNotifs.reject')}</Text>
                      </TouchableOpacity>
                    </View>
                  )
                ) : n.type === 'job_done' ? (
                  /* A finished job. The banner that announced it is long gone
                     by the time a coach reads this list, and until now the row
                     said a report was ready without offering to open it —
                     leaving them to go and find it themselves. */
                  <TouchableOpacity
                    style={[styles.approveBtn, { backgroundColor: t.ctaBg, alignItems: 'center' }]}
                    onPress={() => openFinishedJob(n)}
                  >
                    <Text style={[styles.approveBtnText, { color: t.ctaText }]} numberOfLines={1}>
                      {tr('coachNotifs.viewReport')}
                    </Text>
                  </TouchableOpacity>
                ) : (n.type === 'staff_report_shared' || n.type === 'staff_share' || n.type === 'staff_report_comment') && n.ref_id ? (
                  <TouchableOpacity
                    style={[styles.approveBtn, { backgroundColor: t.ctaBg, alignItems: 'center' }]}
                    onPress={() => openSharedReport(n.ref_id!)}
                  >
                    <Text style={[styles.approveBtnText, { color: t.ctaText }]} numberOfLines={1}>{tr('coachNotifs.viewType', { type: typeWord(n.ref_id) })}</Text>
                  </TouchableOpacity>
                ) : !n.read ? (
                  <TouchableOpacity
                    style={styles.markReadBtn}
                    onPress={() => {
                      // Marked read on screen first, then on the server. The
                      // row is the coach's own action and cannot fail in a way
                      // they'd act on, so waiting for the round-trip only made
                      // the button feel unresponsive.
                      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                      setExpandedId(null);
                      playerAPI.coachMarkRead(n.id).catch(() => {});
                    }}
                  >
                    <Text style={styles.markReadText} numberOfLines={1}>{tr('coachNotifs.markAsRead')}</Text>
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
      onChanged={load}
    />
    </PageContainer>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingTop: topPad(56) },
  backBtn: { flexShrink: 0 },
  title: { color: t.ink, fontSize: 20, fontFamily: fonts[800], flex: 1, flexShrink: 1, minWidth: 0 },
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
    flexShrink: 0,
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
    flexShrink: 0,
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
    flexShrink: 1,
  },
  approveBtnText: { color: t.brownInk, fontFamily: fonts[700], fontSize: 12, flexShrink: 1 },
  rejectBtn: {
    backgroundColor: t.negativeSoft,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: t.negative,
    flexShrink: 1,
  },
  rejectBtnText: { color: t.negative, fontFamily: fonts[700], fontSize: 12, flexShrink: 1 },
  markReadBtn: { padding: 8, alignItems: 'center', borderWidth: 1, borderColor: t.line, borderRadius: 8 },
  markReadText: { color: t.muted, fontSize: 12, fontFamily: fonts[600] },
});
