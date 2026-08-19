import React, { useCallback, useState, useEffect, useRef } from 'react';
import { roleLabel } from '../utils/roleLabel';
import { useTranslation } from 'react-i18next';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import { useKeyboardInset } from '../web/keyboardInset';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform, ScrollView, Alert, TextInput, RefreshControl,
} from 'react-native';
import Sheet from '../components/Sheet';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { useGoUp } from '../navigation/goUp';
import { Ionicons } from '@expo/vector-icons';
import { abandonSheetHistory } from '../web/sheetHistory';
import { staffSharingAPI, teamStaffAPI, staffMessagesAPI, coachesAPI, teamsAPI } from '../api/client';
import { renderReport } from '../utils/renderReport';
import { useReportSearch, ReportSearchBar, ReportSearchButton } from '../components/ReportSearch';
import SharedReportViewer from '../components/SharedReportViewer';
import { useTheme } from '../theme/ThemeProvider';
import { topPad } from '../responsive/screenPadding';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import { sheetCap, desktopOnly, REPORT_MODAL_WIDTH } from '../responsive/modalSizes';

// Maps staff-share report_type keys to i18n label keys.
const REPORT_TYPE_LABEL_KEYS: Record<string, string> = {
  eval: 'reportTypes.player_eval',
  game: 'reportTypes.game_report',
  // A shared game carries the whole Game Insights page — grades, leaders,
  // shooting, key stats, both box scores — so that is what it is called, on
  // the card and in the viewer. "Live Game" described the four lines it used
  // to be.
  game_session: 'teamGrade.gameInsights',
  team_training: 'reportTypes.team_training',
  team_report: 'staffHub.teamReport',
  training: 'reportTypes.training_program',
};

type TabKey = 'inbox' | 'team_games' | 'my_teams';

export default function StaffInboxScreen() {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const reportTypeLabel = (rt: string): string =>
    REPORT_TYPE_LABEL_KEYS[rt] ? tr(REPORT_TYPE_LABEL_KEYS[rt]) : rt;
  const styles = makeStyles(t);
  // Pixels the phone keyboard is covering, so bottom-anchored sheets clear it.
  const kbInset = useKeyboardInset();
  const navigation = useNavigation<any>();
  // Back means up a level — see navigation/goUp.ts.
  const goUp = useGoUp();

  // Themed report-type badge colors (adapt to light/dark instead of fixed hex).
  const badgeFor = (type: string): { bg: string; text: string } => {
    if (type === 'training' || type === 'game_session') return { bg: t.positiveSoft, text: t.positive };
    if (type === 'team_report') return { bg: t.brownSoft, text: t.brown };
    return { bg: t.accentSoft, text: t.accent }; // eval / game / team_training / default
  };
  const [tab, setTab] = useState<TabKey>('inbox');

  // Inbox state
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeItem, setActiveItem] = useState<any | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [regenerateFeedback, setRegenerateFeedback] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [view, setView] = useState<'report' | 'regenerated' | 'comments' | 'regenerate' | 'notes'>('report');
  const [coachNotes, setCoachNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const route = useRoute<any>();
  // Which of the three tabs, and the shared report open over it, go in the
  // address — so a refresh comes back to the page being read rather than to
  // the top of the inbox.
  useEffect(() => {
    navigation.setParams?.({
      tab: tab === 'inbox' ? undefined : tab,
      item: activeItem ? String(activeItem.id) : undefined,
    });
  }, [tab, activeItem?.id]);

  const restoredInbox = useRef(false);
  useEffect(() => {
    if (restoredInbox.current) return;
    const t = route?.params?.tab;
    if (t && ['inbox', 'team_games', 'my_teams'].includes(t)) setTab(t as TabKey);
    const id = Number(route?.params?.item);
    if (!id) { if (t) restoredInbox.current = true; return; }
    if (items.length === 0) return;   // the inbox has not been read yet
    restoredInbox.current = true;
    const found = items.find((x: any) => x.id === id);
    if (found) setActiveItem(found);
    else navigation.setParams?.({ item: undefined });
  }, [route?.params?.tab, route?.params?.item, items.length]);

  // My Teams state
  const [myTeams, setMyTeams] = useState<any[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [inboxSearch, setInboxSearch] = useState('');
  const [gamesSearch, setGamesSearch] = useState('');
  const [joining, setJoining] = useState<number | null>(null);

  // Team Games state
  const [selectedTeam, setSelectedTeam] = useState<any | null>(null);
  const [teamGames, setTeamGames] = useState<any[]>([]);
  const [teamGamesLoading, setTeamGamesLoading] = useState(false);
  const [activeGame, setActiveGame] = useState<any | null>(null);
  // Whichever of the two the open game is showing — a shared report or the
  // scouting report on a live game.
  // Counted on exactly the text that is drawn, sign-off trimmed and all, so
  // the counter and the highlights cannot disagree.
  const find = useReportSearch(
    String(activeGame?.report_text ?? activeGame?.ai_scouting_report ?? '')
      .replace(/\s*END OF REPORT\.?\s*$/i, ''),
  );
  const [gameCommentText, setGameCommentText] = useState('');
  const [gameComments, setGameComments] = useState<any[]>([]);
  const [submittingGameComment, setSubmittingGameComment] = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  // Messaging state (merged into the inbox)
  const [conversations, setConversations] = useState<any[]>([]);
  const [showCompose, setShowCompose] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffResults, setStaffResults] = useState<any[]>([]);
  const [staffSearching, setStaffSearching] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

  // Sub-team + invite state
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState<Record<number, boolean>>({});

  const createTeam = async () => {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    try {
      await teamsAPI.create({ name: newTeamName.trim() });
      setShowCreateTeam(false); setNewTeamName('');
      await loadMyTeams();
    } catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('staffHub.createTeamError')); }
    finally { setCreatingTeam(false); }
  };

  const loadInbox = async () => {
    setLoading(true);
    try {
      const [inbox, convos] = await Promise.all([
        staffSharingAPI.inbox(),
        staffMessagesAPI.list().catch(() => []),
      ]);
      setItems(inbox);
      setConversations(convos ?? []);
    } catch {}
    setLoading(false);
  };

  const searchStaff = async () => {
    if (!staffSearch.trim()) return;
    setStaffSearching(true);
    try { setStaffResults(await coachesAPI.search(staffSearch.trim())); } catch {}
    setStaffSearching(false);
  };

  const toggleStaff = (s: any) => {
    setSelectedStaff(prev => prev.some(x => x.id === s.id) ? prev.filter(x => x.id !== s.id) : [...prev, s]);
  };

  const startConversation = async () => {
    if (selectedStaff.length === 0) return;
    setCreating(true);
    try {
      const conv = await staffMessagesAPI.create({ member_ids: selectedStaff.map(s => s.id), is_group: selectedStaff.length > 1 });
      // The sheet is closing because we are LEAVING, not because the coach
      // dismissed it. Closing it normally schedules a history.back() to spend
      // the entry it was holding, which then lands on that entry instead of on
      // the conversation we are about to push — back to Staff Hub, having
      // picked a name and gone nowhere.
      abandonSheetHistory();
      setShowCompose(false);
      setSelectedStaff([]); setStaffSearch(''); setStaffResults([]);
      navigation.push('Conversation', { conversationId: conv.id, title: conv.title });
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('staffHub.startConvError'));
    } finally { setCreating(false); }
  };

  const loadMyTeams = async () => {
    setTeamsLoading(true);
    try {
      const teams = await teamStaffAPI.myTeams();
      setMyTeams(teams);
    } catch {}
    // Only owners get any rows back, so this is a no-op for everyone else.
    try {
      setJoinRequests(await teamStaffAPI.joinRequests());
    } catch {}
    setTeamsLoading(false);
  };

  const loadTeamGames = async (team: any) => {
    setSelectedTeam(team);
    setTeamGamesLoading(true);
    setTeamGames([]);
    try {
      const data = await teamStaffAPI.teamGames(team.id);
      setTeamGames(data.items || []);
    } catch {}
    setTeamGamesLoading(false);
  };

  useFocusEffect(useCallback(() => {
    loadInbox();
    loadMyTeams();
  }, []));

  const openItem = (item: any) => setActiveItem(item);

  const submitComment = async () => {
    if (!commentText.trim() || !activeItem) return;
    setSubmittingComment(true);
    try {
      const c = await staffSharingAPI.addComment(activeItem.id, commentText.trim());
      setComments(prev => [...prev, c]);
      setCommentText('');
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('staffHub.addCommentError'));
    } finally {
      setSubmittingComment(false);
    }
  };

  const regenerate = async () => {
    if (!regenerateFeedback.trim() || !activeItem) return;
    setRegenerating(true);
    try {
      const updated = await staffSharingAPI.regenerate(activeItem.id, regenerateFeedback.trim());
      setActiveItem({ ...activeItem, regenerated_text: updated.regenerated_text });
      setRegenerateFeedback('');
      setView('regenerated');
      Alert.alert(tr('staffHub.updatedTitle'), tr('staffHub.regeneratedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('staffHub.regenerateError'));
    } finally {
      setRegenerating(false);
    }
  };

  const searchTeams = async () => {
    if (!teamSearch.trim()) return;
    setSearching(true);
    try {
      const results = await teamStaffAPI.search(teamSearch.trim());
      setSearchResults(results);
    } catch {}
    setSearching(false);
  };

  // Teams this coach has asked to join in this session: the button must not
  // still say "Join" once the request is in.
  const [requestedTeams, setRequestedTeams] = useState<number[]>([]);
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  const [actingRequest, setActingRequest] = useState<number | null>(null);

  const joinTeam = async (teamId: number) => {
    setJoining(teamId);
    try {
      // Joining is a request now, not an act. The owner decides — except when
      // they already invited this coach, which the server settles immediately.
      const res = await teamStaffAPI.join(teamId);
      await loadMyTeams();
      // The row stays put and changes state. Clearing the search emptied the
      // list instead, so asking to join looked like nothing had happened.
      setSearchResults(prev => prev.map((tm: any) =>
        tm.id === teamId ? { ...tm, join_status: res?.status === 'pending' ? 'pending' : 'member' } : tm));
      if (res?.status === 'pending') {
        setRequestedTeams(prev => [...prev, teamId]);
        Alert.alert(tr('staffHub.requestSentTitle'), tr('staffHub.requestSentMsg'));
      } else {
        Alert.alert(tr('staffHub.joinedTitle'), tr('staffHub.joinedMsg'));
      }
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('staffHub.joinTeamError'));
    } finally {
      setJoining(null);
    }
  };

  const actOnJoinRequest = async (id: number, approve: boolean) => {
    setActingRequest(id);
    try {
      if (approve) await teamStaffAPI.approveJoinRequest(id);
      else await teamStaffAPI.rejectJoinRequest(id);
      setJoinRequests(prev => prev.filter(r => r.id !== id));
      if (approve) await loadMyTeams();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('staffHub.joinTeamError'));
    } finally {
      setActingRequest(null);
    }
  };


  const renderInboxTab = () => {
    if (loading) return <View style={styles.center}><ActivityIndicator color={t.accent} size="large" /></View>;
    const q = inboxSearch.trim().toLowerCase();
    const convFiltered = !q ? conversations : conversations.filter((c: any) =>
      (c.title ?? '').toLowerCase().includes(q) || (c.last_text ?? '').toLowerCase().includes(q));
    const itemsFiltered = !q ? items : items.filter((it: any) =>
      (reportTypeLabel(it.report_type ?? '') ?? '').toLowerCase().includes(q) ||
      (it.sender_name ?? '').toLowerCase().includes(q) ||
      (it.recipient_names ?? []).join(' ').toLowerCase().includes(q));
    return (
      <FlatList
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadInbox(); setRefreshing(false); }} tintColor={t.accent} />}
        data={itemsFiltered}
        keyExtractor={i => String(i.id)}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={t.muted} />
              <TextInput
                style={styles.searchBarInput}
                placeholder={tr('staffHub.searchInboxPlaceholder')}
                placeholderTextColor={t.muted2}
                value={inboxSearch}
                onChangeText={setInboxSearch}
              />
              {inboxSearch.length > 0 && (
                <TouchableOpacity onPress={() => setInboxSearch('')}>
                  <Ionicons name="close-circle" size={16} color={t.muted2} />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionLabel, { flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }]} numberOfLines={1}>{tr('staffHub.messages')}</Text>
              <TouchableOpacity style={styles.newMsgBtn} onPress={() => setShowCompose(true)}>
                <Ionicons name="create-outline" size={15} color={t.ctaText} />
                <Text style={styles.newMsgText} numberOfLines={1}>{tr('staffHub.new')}</Text>
              </TouchableOpacity>
            </View>
            {convFiltered.length === 0 && (
              <Text style={[styles.cardSub, { paddingHorizontal: 20, marginBottom: 6 }]}>{q ? tr('staffHub.noMatchingConversations') : tr('staffHub.noConversationsYet')}</Text>
            )}
            {convFiltered.map(c => (
              <TouchableOpacity key={`conv-${c.id}`} style={styles.card} onPress={() => navigation.push('Conversation', { conversationId: c.id, title: c.title })}>
                <View style={[styles.iconBox, { backgroundColor: t.accentSoft }]}>
                  <Ionicons name={c.is_group ? 'people' : 'chatbubble-ellipses-outline'} size={18} color={t.accent} />
                </View>
                <View style={{ flex: 1, flexShrink: 1, minWidth: 0 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{c.title}</Text>
                  <Text style={styles.cardSub} numberOfLines={1}>{c.last_text || tr('staffHub.noMessagesYet')}</Text>
                </View>
                {c.unread > 0 && <View style={styles.unreadDot}><Text style={styles.unreadDotText}>{c.unread}</Text></View>}
                <Ionicons name="chevron-forward" size={14} color={t.muted2} />
              </TouchableOpacity>
            ))}
            {itemsFiltered.length > 0 && <Text style={[styles.sectionLabel, { marginTop: 14, paddingHorizontal: 20 }]}>{tr('staffHub.sharedReports')}</Text>}
          </View>
        }
        ListEmptyComponent={
          items.length === 0 ? null : (
            <View style={styles.center}>
              <Ionicons name="mail-outline" size={48} color={t.muted2} />
              <Text style={styles.emptyText}>{inboxSearch.trim() ? tr('staffHub.noMatchingReports') : tr('staffHub.noSharedReports')}</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const badgeColor = badgeFor(item.report_type);
          const iconName = item.report_type === 'training' ? 'barbell-outline' :
                           item.report_type === 'team_report' || item.report_type === 'team_training' ? 'people-outline' :
                           item.report_type === 'game' || item.report_type === 'game_session' ? 'clipboard-outline' : 'document-text-outline';
          const typeLabel = reportTypeLabel(item.report_type);
          const title = (item.subject_name && String(item.subject_name).trim()) || typeLabel;
          const chips: { icon: string; n: number; color: string }[] = [
            { icon: 'create-outline', n: item.correction_count ?? 0, color: t.accent },
            { icon: 'chatbubble-ellipses-outline', n: item.comment_count ?? 0, color: t.brown },
            { icon: 'bookmark-outline', n: item.note_count ?? 0, color: t.positive },
          ].filter(c => c.n > 0);
          return (
            <TouchableOpacity style={styles.card} onPress={() => openItem(item)}>
              <View style={[styles.iconBox, { backgroundColor: badgeColor.bg }]}>
                <Ionicons name={iconName as any} size={18} color={badgeColor.text} />
              </View>
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
                {/* A report the coach SENT reads from the other end: who it
                    went to, not who it came from. Same card, same list, same
                    place by date — it is the same conversation. */}
                <Text style={styles.cardSub} numberOfLines={1}>
                  {item.is_sender
                    ? tr('staffHub.sharedWith', {
                        type: typeLabel,
                        names: (item.recipient_names ?? []).join(', ') || item.recipient_name,
                      })
                    : tr('staffHub.fromSender', { type: typeLabel, name: item.sender_name })}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                  <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
                  {chips.map((c, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 6 }}>
                      <Ionicons name={c.icon as any} size={11} color={c.color} />
                      <Text style={{ color: c.color, fontSize: 11, fontFamily: fonts[700] }}>{c.n}</Text>
                    </View>
                  ))}
                </View>
              </View>
              {/* Take it back. Only on reports this coach sent, and only from
                  this list — the report leaves the other coach's Staff Hub,
                  and a shared game leaves their schedule with it. */}
              {item.is_sender && (
                <TouchableOpacity
                  style={{ padding: 6 }}
                  onPress={() => {
                    const names = (item.recipient_names ?? []).join(', ') || item.recipient_name;
                    Alert.alert(
                      tr('staffHub.unshareTitle'),
                      tr('staffHub.unshareMessage', { names }),
                      [
                        { text: tr('common.cancel'), style: 'cancel' },
                        {
                          text: tr('staffHub.unshare'), style: 'destructive',
                          onPress: async () => {
                            try {
                              await staffSharingAPI.unshare(item.id);
                              setItems(prev => prev.filter((x: any) => x.id !== item.id));
                            } catch { Alert.alert(tr('common.error'), tr('staffHub.couldNotUnshare')); }
                          },
                        },
                      ]);
                  }}
                >
                  <Ionicons name="close-circle-outline" size={16} color={t.muted2} />
                </TouchableOpacity>
              )}
              <Ionicons name="chevron-forward" size={14} color={t.muted2} />
            </TouchableOpacity>
          );
        }}
      />
    );
  };

  const renderTeamGamesTab = () => {
    if (myTeams.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={48} color={t.muted2} />
          <Text style={styles.emptyText}>{tr('staffHub.joinTeamPrompt')}</Text>
        </View>
      );
    }
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Team switcher */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8, alignItems: 'center', ...desktopOnly({ paddingVertical: 8 }) }}>
          {myTeams.filter((team: any) => !team.parent_team_id).map(team => (
            <TouchableOpacity
              key={team.id}
              style={[styles.teamChip, selectedTeam?.id === team.id && styles.teamChipActive]}
              onPress={() => loadTeamGames(team)}
            >
              <Text style={[styles.teamChipText, selectedTeam?.id === team.id && styles.teamChipTextActive]} numberOfLines={1}>
                {team.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {!selectedTeam && (
          <View style={styles.center}>
            <Text style={styles.emptyText}>{tr('staffHub.selectTeamPrompt')}</Text>
          </View>
        )}

        {selectedTeam && teamGamesLoading && (
          <View style={styles.center}><ActivityIndicator color={t.accent} /></View>
        )}

        {selectedTeam && !teamGamesLoading && teamGames.length > 0 && (
          <View style={[styles.searchBar, { marginTop: 0 }]}>
            <Ionicons name="search" size={16} color={t.muted} />
            <TextInput
              style={styles.searchBarInput}
              placeholder={tr('staffHub.searchGamesPlaceholder')}
              placeholderTextColor={t.muted2}
              value={gamesSearch}
              onChangeText={setGamesSearch}
            />
            {gamesSearch.length > 0 && (
              <TouchableOpacity onPress={() => setGamesSearch('')}>
                <Ionicons name="close-circle" size={16} color={t.muted2} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {selectedTeam && !teamGamesLoading && teamGames.length === 0 && (
          <View style={styles.center}>
            <Ionicons name="basketball-outline" size={48} color={t.muted2} />
            <Text style={styles.emptyText}>{tr('staffHub.noGamesYet', { team: selectedTeam.name })}</Text>
          </View>
        )}

        {selectedTeam && !teamGamesLoading && teamGames
          .filter((game: any) => {
            const q = gamesSearch.trim().toLowerCase();
            return !q || (game.title ?? '').toLowerCase().includes(q) || (game.date ?? '').toLowerCase().includes(q);
          })
          .map((game: any) => (
          <TouchableOpacity key={game.kind + game.id} style={styles.card} onPress={() => {
            setActiveGame(game);
            setGameCommentText('');
            setGameComments([]);
          }}>
            <View style={[styles.iconBox, { backgroundColor: game.kind === 'session' ? t.positiveSoft : t.accentSoft }]}>
              <Ionicons name={game.kind === 'session' ? 'stats-chart-outline' : 'clipboard-outline'} size={18} color={game.kind === 'session' ? t.positive : t.accent} />
            </View>
            <View style={{ flex: 1, flexShrink: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle} numberOfLines={1}>{game.title}</Text>
              <Text style={styles.cardSub} numberOfLines={1}>{game.kind === 'session' ? tr('staffHub.liveGameStats') : tr('reportTypes.game_report')}</Text>
              {game.date && <Text style={styles.cardDate} numberOfLines={1}>{game.date}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={14} color={t.muted2} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  };

  const renderMyTeamsTab = () => {
    const myTeamIds = new Set(myTeams.map((tm: any) => tm.id));
    return (
      <KeyboardAwareScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}>
        {/* Search to join */}
        <Text style={styles.sectionLabel}>{tr('staffHub.findTeamLabel')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder={tr('staffHub.searchTeamPlaceholder')}
            placeholderTextColor={t.muted2}
            value={teamSearch}
            onChangeText={setTeamSearch}
            onSubmitEditing={searchTeams}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchBtn} onPress={searchTeams} disabled={searching}>
            {searching ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="search" size={18} color={t.ctaText} />}
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.createTeamBtn} onPress={() => { setNewTeamName(''); setShowCreateTeam(true); }}>
          <Ionicons name="add-circle-outline" size={18} color={t.accent} />
          <Text style={styles.createTeamText} numberOfLines={1}>{tr('staffHub.createNewTeam')}</Text>
        </TouchableOpacity>

        {searchResults.map((team: any) => {
          // The server knows both states; myTeamIds and requestedTeams only
          // cover what has happened since this screen mounted.
          const isMember = myTeamIds.has(team.id) || team.join_status === 'member';
          const isPending = team.join_status === 'pending' || requestedTeams.includes(team.id);
          return (
            <View key={team.id} style={[styles.card, { marginHorizontal: 0 }]}>
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{team.name}</Text>
                {team.coach_name && <Text style={styles.cardSub} numberOfLines={1}>{tr('staffHub.headCoach', { name: team.coach_name })}</Text>}
                {team.competition_level && <Text style={styles.cardDate} numberOfLines={1}>{team.competition_level}</Text>}
              </View>
              {isMember ? (
                <View style={{ backgroundColor: t.positiveSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0, maxWidth: 120 }}>
                  <Text style={{ color: t.positive, fontSize: 12, fontFamily: fonts[700], flexShrink: 1 }} numberOfLines={1}>{tr('staffHub.joinedBadge')}</Text>
                </View>
              ) : isPending ? (
                <View style={{ backgroundColor: t.chip, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0, maxWidth: 120 }}>
                  <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[700], flexShrink: 1 }} numberOfLines={1}>{tr('staffHub.requestPending')}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={{ backgroundColor: t.ctaBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 0, maxWidth: 120 }}
                  onPress={() => joinTeam(team.id)}
                  disabled={joining === team.id}
                >
                  {joining === team.id
                    ? <ActivityIndicator color={t.ctaText} size="small" />
                    : <Text style={{ color: t.ctaText, fontSize: 13, fontFamily: fonts[700], flexShrink: 1 }} numberOfLines={1}>{tr('staffHub.requestJoin')}</Text>}
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* Coaches waiting on this owner. Sits above My Teams because it needs
            a decision, where the list below is just reference. */}
        {joinRequests.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
              {tr('staffHub.joinRequestsLabel', { count: joinRequests.length })}
            </Text>
            {joinRequests.map((r: any) => (
              <View key={r.id} style={[styles.card, { marginHorizontal: 0 }]}>
                <View style={[styles.iconBox, { backgroundColor: t.accentSoft }]}>
                  <Ionicons name="person-add-outline" size={17} color={t.accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{r.coach_name}</Text>
                  <Text style={styles.cardSub} numberOfLines={2}>
                    {tr('staffHub.wantsToJoin', { role: roleLabel(r.coach_role, tr), team: r.team_name })}
                  </Text>
                </View>
                {actingRequest === r.id ? (
                  <ActivityIndicator color={t.accent} size="small" />
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8, flexShrink: 0 }}>
                    <TouchableOpacity
                      onPress={() => actOnJoinRequest(r.id, false)}
                      style={{ backgroundColor: t.chip, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                    >
                      <Ionicons name="close" size={16} color={t.muted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => actOnJoinRequest(r.id, true)}
                      style={{ backgroundColor: t.ctaBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                    >
                      <Ionicons name="checkmark" size={16} color={t.ctaText} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
          </>
        )}

        {/* My current teams — nested sub-team breakout */}
        {myTeams.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>{tr('staffHub.myTeamsLabel')}</Text>
            {teamsLoading ? <ActivityIndicator color={t.accent} /> : (() => {
              const ids = new Set(myTeams.map((tm: any) => tm.id));
              const byParent: Record<number, any[]> = {};
              myTeams.forEach((tm: any) => { const p = tm.parent_team_id ?? 0; (byParent[p] = byParent[p] || []).push(tm); });
              const roots = myTeams.filter((tm: any) => !tm.parent_team_id || !ids.has(tm.parent_team_id));
              const renderNode = (tm: any, depth: number): any => {
                const kids = byParent[tm.id] || [];
                const isCollapsed = !!collapsedTeams[tm.id];
                return (
                <View key={tm.id}>
                  {/* The card is the way in. Staff, sub-teams and every team
                      action live on the team's own screen now — inline they
                      cost a screenful per team and left no room per person. */}
                  <TouchableOpacity
                    style={[styles.card, { marginHorizontal: 0, marginLeft: depth * 16, borderLeftWidth: depth ? 3 : 1, borderLeftColor: depth ? t.accent : t.cardBorder }]}
                    onPress={() => navigation.push('TeamDetail', { teamId: tm.id, teamName: tm.name, team: tm })}
                  >
                    <View style={[styles.iconBox, { backgroundColor: t.accentSoft }]}>
                      <Ionicons name={depth ? 'git-branch-outline' : 'people'} size={17} color={t.accent} />
                    </View>
                    <View style={{ flex: 1, flexShrink: 1, minWidth: 0 }}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{tm.name}</Text>
                      <Text style={styles.cardSub} numberOfLines={1}>{(tm.member_count ?? 1) === 1 ? tr('staffHub.memberCountOne', { count: tm.member_count ?? 1 }) : tr('staffHub.memberCountOther', { count: tm.member_count ?? 1 })}{tm.is_owner ? ` · ${tr('staffHub.ownedByYou')}` : tm.coach_name ? ` · ${tm.coach_name}` : ''}</Text>
                    </View>
                    {kids.length > 0 ? (
                      <TouchableOpacity onPress={() => setCollapsedTeams(prev => ({ ...prev, [tm.id]: !prev[tm.id] }))} style={{ padding: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                          <Text style={{ color: t.accent, fontSize: 12, fontFamily: fonts[700] }}>{kids.length}</Text>
                          <Ionicons name={isCollapsed ? 'chevron-down' : 'chevron-up'} size={16} color={t.accent} />
                        </View>
                      </TouchableOpacity>
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={t.muted2} />
                    )}
                  </TouchableOpacity>
                  {!isCollapsed && kids.map((child: any) => renderNode(child, depth + 1))}
                </View>
                );
              };
              return roots.map((r: any) => renderNode(r, 0));
            })()}
          </>
        )}

        {myTeams.length === 0 && searchResults.length === 0 && !teamsLoading && (
          <View style={styles.center}>
            <Ionicons name="people-outline" size={48} color={t.muted2} />
            <Text style={styles.emptyText}>{tr('staffHub.searchToGetStarted')}</Text>
          </View>
        )}
      </KeyboardAwareScrollView>
    );
  };

  return (
    <ScreenBackground>
    <PageContainer padded={false} maxWidth={1280}>
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goUp()} style={{ flexShrink: 0 }}>
          <Ionicons name="chevron-back" size={24} color={t.ink} />
        </TouchableOpacity>
        {/* Translated titles run 20-40% longer than English. Wrap to a second
            line rather than clipping — a truncated heading tells the coach
            less than a taller one costs them. */}
        <Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>{tr('staffHub.title')}</Text>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {([
          { key: 'inbox', label: tr('staffHub.tabInbox'), icon: 'mail-outline' },
          { key: 'team_games', label: tr('staffHub.tabTeamGames'), icon: 'basketball-outline' },
          { key: 'my_teams', label: tr('staffHub.tabMyTeams'), icon: 'people-outline' },
        ] as { key: TabKey; label: string; icon: string }[]).map(tm => (
          <TouchableOpacity
            key={tm.key}
            style={[styles.tabBtn, tab === tm.key && styles.tabBtnActive]}
            onPress={() => setTab(tm.key)}
          >
            <Ionicons name={tm.icon as any} size={16} color={tab === tm.key ? t.ctaText : t.muted2} />
            {/* German tab labels are much longer, so each label shrinks a little
                then clips instead of widening the tab and overflowing the bar. */}
            <Text
              style={[styles.tabBtnText, tab === tm.key && styles.tabBtnTextActive]}
              numberOfLines={1}
            >
              {tm.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'inbox' && renderInboxTab()}
      {tab === 'team_games' && renderTeamGamesTab()}
      {tab === 'my_teams' && renderMyTeamsTab()}

      {/* Compose / new message modal */}
      <Sheet visible={showCompose} transparent animationType="slide" onRequestClose={() => setShowCompose(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalBox, { maxHeight: '80%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={[styles.modalTitle, { flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }]} numberOfLines={1}>{tr('staffHub.newMessage')}</Text>
              <TouchableOpacity style={{ flexShrink: 0 }} onPress={() => { setShowCompose(false); setSelectedStaff([]); }}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
            </View>
            <Text style={[styles.cardSub, { marginBottom: 8 }]}>Search staff by name. Add more than one for a group message.</Text>
            {selectedStaff.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ gap: 6 }}>
                {selectedStaff.map(s => (
                  <TouchableOpacity key={s.id} style={styles.selChip} onPress={() => toggleStaff(s)}>
                    <Text style={styles.selChipText} numberOfLines={1}>{s.name}</Text>
                    <Ionicons name="close-circle" size={14} color={t.accent} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <TextInput
                style={[styles.searchInput, { flex: 1 }]}
                placeholder={tr('staffHub.searchStaffPlaceholder')}
                placeholderTextColor={t.muted2}
                value={staffSearch}
                onChangeText={setStaffSearch}
                onSubmitEditing={searchStaff}
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.searchBtn} onPress={searchStaff} disabled={staffSearching}>
                {staffSearching ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="search" size={18} color={t.ctaText} />}
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 240 }}>
              {staffResults.map((s: any) => {
                const sel = selectedStaff.some(x => x.id === s.id);
                return (
                  <TouchableOpacity key={s.id} style={[styles.staffRow, sel && { borderColor: t.accent }]} onPress={() => toggleStaff(s)}>
                    <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{s.name}</Text>
                      <Text style={styles.cardSub} numberOfLines={1}>{[roleLabel(s.role, tr), s.program_name].filter(Boolean).join(' · ')}</Text>
                    </View>
                    {sel && <Ionicons name="checkmark-circle" size={18} color={t.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={[styles.startBtn, { opacity: selectedStaff.length && !creating ? 1 : 0.5 }]}
              onPress={startConversation} disabled={!selectedStaff.length || creating}>
              {creating ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.startBtnText}>{selectedStaff.length > 1 ? 'Start Group' : 'Start Message'}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Sheet>

      {/* Create team modal */}
      <Sheet visible={showCreateTeam} transparent animationType="fade" onRequestClose={() => setShowCreateTeam(false)}>
        {/* The box is anchored to the bottom of the screen, which is where a
            phone puts its keyboard. `behavior` covers native; the inset covers
            the browser, where RN emits no keyboard events at all and the field
            you are typing the team name into ended up behind the keys. */}
        <KeyboardAvoidingView
          style={[styles.modalOverlay, { paddingBottom: kbInset }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalBox, { padding: 20 }]}>
            <Text style={styles.modalTitle}>{tr('staffHub.newTeam')}</Text>
            <Text style={[styles.cardSub, { marginTop: 4, marginBottom: 12 }]}>Create a team, then add sub-teams and invite coaches.</Text>
            <TextInput
              style={styles.searchInput}
              placeholder={tr('staffHub.teamNamePlaceholder')}
              placeholderTextColor={t.muted2}
              value={newTeamName}
              onChangeText={setNewTeamName}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={[styles.startBtn, { flex: 1, backgroundColor: t.chip }]} onPress={() => setShowCreateTeam(false)}>
                <Text style={{ color: t.ink, fontFamily: fonts[700], flexShrink: 1 }} numberOfLines={1}>{tr('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.startBtn, { flex: 1, opacity: newTeamName.trim() && !creatingTeam ? 1 : 0.5 }]} onPress={createTeam} disabled={!newTeamName.trim() || creatingTeam}>
                {creatingTeam ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.startBtnText} numberOfLines={1}>{tr('staffHub.create')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Sheet>

      {/* Create sub-team modal */}

      {/* Inbox detail — unified shared-report viewer */}
      <SharedReportViewer
        shared={activeItem}
        visible={!!activeItem}
        onClose={() => setActiveItem(null)}
        onChanged={loadInbox}
      />

      {/* Team Game detail modal */}
      <Sheet visible={!!activeGame} animationType="slide" transparent onRequestClose={() => setActiveGame(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                <Text style={styles.modalTitle} numberOfLines={1}>{activeGame?.title}</Text>
                <Text style={styles.modalSub} numberOfLines={1}>{activeGame?.kind === 'session' ? 'Live Game Stats' : 'Game Report'} · {activeGame?.date}</Text>
              </View>
              <ReportSearchButton ctl={find} />
              <TouchableOpacity style={{ flexShrink: 0, marginLeft: 10 }} onPress={() => setActiveGame(null)}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>

            {activeGame?.kind === 'session' && (
              <TouchableOpacity
                style={styles.fullDataBtn}
                onPress={() => {
                  const gid = activeGame.id;
                  // Give up the history entry this sheet is holding BEFORE
                  // leaving. Closing it normally schedules a history.back() to
                  // spend that entry, which is right when the page stays put
                  // and wrong here: the navigation pushes its own entry first,
                  // so the queued back lands on the sheet's and puts the coach
                  // straight back on the Staff Hub they just left. See
                  // abandonSheetHistory.
                  abandonSheetHistory();
                  setActiveGame(null);
                  navigation.navigate('TeamEvalTab', { screen: 'TeamEval', params: { openGameId: gid } });
                }}
              >
                <Ionicons name="stats-chart-outline" size={16} color={t.accent} />
                <Text style={styles.fullDataBtnText}>{tr('staffHub.viewFullGameData')}</Text>
                <Ionicons name="chevron-forward" size={16} color={t.accent} />
              </TouchableOpacity>
            )}

            <ReportSearchBar ctl={find} />
            <KeyboardAwareScrollView ref={find.scrollRef} contentContainerStyle={{ paddingBottom: 16 }}>
              {activeGame?.kind === 'report' && (
                activeGame.report_text
                  ? renderReport(String(activeGame.report_text).replace(/\s*END OF REPORT\.?\s*$/i, ''), { heading: t.ink, body: t.inkSoft }, find.search)
                  : <Text style={{ color: t.muted2 }}>{tr('staffHub.noReportGenerated')}</Text>
              )}
              {activeGame?.kind === 'session' && (
                activeGame.ai_scouting_report
                  ? renderReport(String(activeGame.ai_scouting_report).replace(/\s*END OF REPORT\.?\s*$/i, ''), { heading: t.ink, body: t.inkSoft }, find.search)
                  : <Text style={{ color: t.muted2 }}>No AI scouting report generated yet for this game.</Text>
              )}
            </KeyboardAwareScrollView>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <VoiceTextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder={tr('staffHub.addCommentPlaceholder')}
                placeholderTextColor={t.muted2}
                value={gameCommentText}
                onChangeText={setGameCommentText}
                multiline
              />
              <TouchableOpacity
                style={styles.sendBtn}
                onPress={async () => {
                  if (!gameCommentText.trim()) return;
                  setSubmittingGameComment(true);
                  try {
                    // Share as game_session comment via staff sharing
                    // For now just record locally as a note
                    setGameComments(prev => [...prev, { text: gameCommentText.trim(), author_name: 'You', created_at: new Date().toISOString() }]);
                    setGameCommentText('');
                  } catch {}
                  setSubmittingGameComment(false);
                }}
                disabled={submittingGameComment || !gameCommentText.trim()}
              >
                {submittingGameComment ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="arrow-up" size={20} color={t.ctaText} />}
              </TouchableOpacity>
            </View>
            {gameComments.map((c: any, i: number) => (
              <View key={i} style={[styles.commentCard, { marginTop: 8 }]}>
                <Text style={styles.commentAuthor}>{c.author_name}</Text>
                <Text style={styles.commentText}>{c.text}</Text>
              </View>
            ))}
          </View>
        </KeyboardAvoidingView>
      </Sheet>
    </View>
    </PageContainer>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', paddingTop: topPad(56) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: topPad(60), paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, marginBottom: 12, gap: 12 },
  title: { fontSize: 22, fontFamily: fonts[900], color: t.ink, flex: 1, flexShrink: 1, minWidth: 0 },
  emptyText: { color: t.muted2, marginTop: 12, fontSize: 14, textAlign: 'center' },
  tabBar: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 12,
    backgroundColor: t.card, borderRadius: 12, padding: 4,
    // Left, matching the page title and the team chips beneath it —
    // centring it left the bar floating between two left edges.
    ...desktopOnly({ width: '100%', alignSelf: 'stretch' }),
  },
  tabBtn: { flex: 1, flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 10 },
  tabBtnActive: { backgroundColor: t.ctaBg },
  tabBtnText: { color: t.muted2, fontSize: 11, fontFamily: fonts[700], flexShrink: 1, minWidth: 0 },
  tabBtnTextActive: { color: t.ctaText },
  sectionLabel: { color: t.label, fontSize: 10, fontFamily: fonts[800], letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, marginTop: 4 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: t.card, marginHorizontal: 16, marginBottom: 8,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.cardBorder,
  },
  iconBox: { width: 32, height: 32, borderRadius: 8, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: t.ink, fontSize: 15, fontFamily: fonts[700] },
  cardSub: { color: t.muted, fontSize: 12, marginTop: 2 },
  cardDate: { color: t.muted2, fontSize: 11, marginTop: 2 },
  regenBadge: { backgroundColor: t.accentSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: t.accent },
  fullDataBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.accentSoft, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: t.accent, marginBottom: 12,
  },
  fullDataBtnText: { flex: 1, flexShrink: 1, minWidth: 0, color: t.accent, fontSize: 13, fontFamily: fonts[700] },
  regenBadgeText: { color: t.accent, fontSize: 10, fontFamily: fonts[700] },
  // Matches Roster's team chips: same radius and padding, so the same
  // control does not look like two different controls on two screens.
  teamChip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, flexShrink: 1, maxWidth: 220 },
  teamChipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  teamChipText: { color: t.muted, fontSize: 13, fontFamily: fonts[600], flexShrink: 1 },
  teamChipTextActive: { color: t.ctaText },
  modalOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  modalBox: { backgroundColor: t.sheet, borderRadius: 20, padding: 20, maxHeight: '90%', margin: 8, ...sheetCap(REPORT_MODAL_WIDTH)},
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  modalTitle: { color: t.ink, fontSize: 18, fontFamily: fonts[800] },
  modalSub: { color: t.muted, fontSize: 12, marginTop: 2 },
  tabRow: { flexDirection: 'row', gap: 8 },
  tab: { borderWidth: 1, borderColor: t.line, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  tabActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  tabText: { color: t.muted, fontSize: 12, fontFamily: fonts[600] },
  tabTextActive: { color: t.ctaText },
  commentCard: { backgroundColor: t.chip, borderRadius: 8, padding: 12, marginBottom: 8 },
  commentAuthor: { color: t.accent, fontSize: 11, fontFamily: fonts[700], marginBottom: 4 },
  commentText: { color: t.inkSoft, fontSize: 13 },
  commentDate: { color: t.muted2, fontSize: 11, marginTop: 6 },
  input: {
    backgroundColor: t.card, borderRadius: 10, padding: 12, color: t.ink,
    fontSize: 14, borderWidth: 1, borderColor: t.line, marginBottom: 8,
  },
  searchBtn: { backgroundColor: t.ctaBg, borderRadius: 10, width: 44, alignItems: 'center', justifyContent: 'center' },
  sendBtn: { backgroundColor: t.ctaBg, borderRadius: 10, width: 44, alignItems: 'center', justifyContent: 'center' },
  regenBtn: { backgroundColor: t.accent, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  newMsgBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.ctaBg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 8, flexShrink: 1, maxWidth: 160 },
  newMsgText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 12.5, flexShrink: 1 },
  unreadDot: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginRight: 6 },
  unreadDotText: { color: '#fff', fontSize: 11, fontFamily: fonts[800] },
  searchInput: { backgroundColor: t.chip, borderRadius: 10, padding: 12, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.chip, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: t.line, marginHorizontal: 16, marginBottom: 12 },
  searchBarInput: { flex: 1, color: t.ink, fontSize: 14, paddingVertical: 0 },
  selChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: t.accent, flexShrink: 1, maxWidth: 200 },
  selChipText: { color: t.accent, fontSize: 13, fontFamily: fonts[600], flexShrink: 1 },
  staffRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 12, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: t.cardBorder },
  startBtn: { backgroundColor: t.ctaBg, borderRadius: 999, padding: 15, alignItems: 'center', marginTop: 10 },
  startBtnText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15, flexShrink: 1 },
  createTeamBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accentSoft, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, borderWidth: 1, borderColor: t.accent, marginBottom: 8, ...desktopOnly({ alignSelf: 'flex-start', minWidth: 240 }) },
  createTeamText: { color: t.accent, fontFamily: fonts[700], fontSize: 13.5, flexShrink: 1 },
});
