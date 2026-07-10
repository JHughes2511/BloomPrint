import React, { useCallback, useState } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform, ScrollView, Alert, TextInput, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { staffSharingAPI, teamStaffAPI, staffMessagesAPI, coachesAPI, teamsAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { renderReport } from '../utils/renderReport';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

const REPORT_TYPE_LABELS: Record<string, string> = {
  eval: 'Player Eval',
  game: 'Game Report',
  game_session: 'Live Game',
  team_training: 'Team Training',
  team_report: 'Team Report',
  training: 'Training Program',
};

type TabKey = 'inbox' | 'team_games' | 'my_teams';

export default function StaffInboxScreen() {
  const { t } = useTheme();
  const { coach: me } = useAuth();
  const coachId = me?.id;
  const styles = makeStyles(t);
  const navigation = useNavigation<any>();

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

  // My Teams state
  const [myTeams, setMyTeams] = useState<any[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [joining, setJoining] = useState<number | null>(null);
  const [leaving, setLeaving] = useState<number | null>(null);

  // Team Games state
  const [selectedTeam, setSelectedTeam] = useState<any | null>(null);
  const [teamGames, setTeamGames] = useState<any[]>([]);
  const [teamGamesLoading, setTeamGamesLoading] = useState(false);
  const [activeGame, setActiveGame] = useState<any | null>(null);
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
  const [subFor, setSubFor] = useState<any | null>(null);
  const [subName, setSubName] = useState('');
  const [creatingSub, setCreatingSub] = useState(false);
  const [inviteFor, setInviteFor] = useState<any | null>(null);
  const [inviteSearch, setInviteSearch] = useState('');
  const [inviteResults, setInviteResults] = useState<any[]>([]);
  const [inviteSearching, setInviteSearching] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState<Record<number, boolean>>({});
  const [messagingTeam, setMessagingTeam] = useState<number | null>(null);

  const createTeam = async () => {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    try {
      await teamsAPI.create({ name: newTeamName.trim() });
      setShowCreateTeam(false); setNewTeamName('');
      await loadMyTeams();
    } catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not create the team.'); }
    finally { setCreatingTeam(false); }
  };

  const messageGroup = async (team: any) => {
    setMessagingTeam(team.id);
    try {
      const members = await teamStaffAPI.members(team.id);
      const others = (members ?? []).filter((m: any) => m.id !== coachId);
      if (others.length === 0) { Alert.alert('No other members', 'This group has no other staff to message yet — invite someone first.'); return; }
      const conv = await staffMessagesAPI.create({ member_ids: others.map((m: any) => m.id), is_group: others.length > 1, title: team.name });
      navigation.navigate('Conversation', { conversationId: conv.id, title: conv.title || team.name });
    } catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not open the group message.'); }
    finally { setMessagingTeam(null); }
  };

  const createSubteam = async () => {
    if (!subFor || !subName.trim()) return;
    setCreatingSub(true);
    try {
      await teamStaffAPI.createSubteam(subFor.id, subName.trim());
      setSubFor(null); setSubName('');
      await loadMyTeams();
    } catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not create the sub-team.'); }
    finally { setCreatingSub(false); }
  };

  const searchInvite = async () => {
    if (!inviteSearch.trim()) return;
    setInviteSearching(true);
    try { setInviteResults(await coachesAPI.search(inviteSearch.trim())); } catch {}
    setInviteSearching(false);
  };

  const doInvite = async (data: { coach_id?: number; email?: string }) => {
    if (!inviteFor) return;
    setInviting(true);
    try {
      const res = await teamStaffAPI.invite(inviteFor.id, data);
      if (res.status === 'invited') Alert.alert('Invite sent', `${res.name} was invited and will approve or reject it.`);
      else Alert.alert('Email invite', res.email_sent
        ? `We emailed ${res.email} an invite to sign up and join.`
        : `No account for ${res.email} yet. Share this invite code so they can sign up: ${res.code}`);
      setInviteFor(null); setInviteSearch(''); setInviteResults([]);
    } catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not invite.'); }
    finally { setInviting(false); }
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
      setShowCompose(false);
      setSelectedStaff([]); setStaffSearch(''); setStaffResults([]);
      navigation.navigate('Conversation', { conversationId: conv.id, title: conv.title });
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not start the conversation.');
    } finally { setCreating(false); }
  };

  const loadMyTeams = async () => {
    setTeamsLoading(true);
    try {
      const teams = await teamStaffAPI.myTeams();
      setMyTeams(teams);
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

  const openItem = async (item: any) => {
    setActiveItem(item);
    setView('report');
    setComments([]);
    setCommentText('');
    setRegenerateFeedback('');
    setCoachNotes('');
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
      setActiveItem({ ...activeItem, regenerated_text: updated.regenerated_text });
      setRegenerateFeedback('');
      setView('regenerated');
      Alert.alert('Updated', 'Report regenerated with your feedback.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not regenerate');
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

  const joinTeam = async (teamId: number) => {
    setJoining(teamId);
    try {
      await teamStaffAPI.join(teamId);
      await loadMyTeams();
      setSearchResults([]);
      setTeamSearch('');
      Alert.alert('Joined', 'You are now linked to this team. All their games are visible to you.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not join team');
    } finally {
      setJoining(null);
    }
  };

  const leaveTeam = async (teamId: number) => {
    Alert.alert('Leave Team', 'You will no longer see this team\'s games or receive their notifications.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          setLeaving(teamId);
          try {
            await teamStaffAPI.leave(teamId);
            await loadMyTeams();
            if (selectedTeam?.id === teamId) {
              setSelectedTeam(null);
              setTeamGames([]);
            }
          } catch (e: any) {
            Alert.alert('Error', e?.response?.data?.detail ?? 'Could not leave team');
          } finally {
            setLeaving(null);
          }
        },
      },
    ]);
  };

  const renderInboxTab = () => {
    if (loading) return <View style={styles.center}><ActivityIndicator color={t.accent} size="large" /></View>;
    return (
      <FlatList
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadInbox(); setRefreshing(false); }} tintColor={t.accent} />}
        data={items}
        keyExtractor={i => String(i.id)}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}
        ListHeaderComponent={
          <View>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>Messages</Text>
              <TouchableOpacity style={styles.newMsgBtn} onPress={() => setShowCompose(true)}>
                <Ionicons name="create-outline" size={15} color={t.ctaText} />
                <Text style={styles.newMsgText}>New</Text>
              </TouchableOpacity>
            </View>
            {conversations.length === 0 && (
              <Text style={[styles.cardSub, { paddingHorizontal: 20, marginBottom: 6 }]}>No conversations yet — tap New to message a staff member.</Text>
            )}
            {conversations.map(c => (
              <TouchableOpacity key={`conv-${c.id}`} style={styles.card} onPress={() => navigation.navigate('Conversation', { conversationId: c.id, title: c.title })}>
                <View style={[styles.iconBox, { backgroundColor: t.accentSoft }]}>
                  <Ionicons name={c.is_group ? 'people' : 'chatbubble-ellipses-outline'} size={18} color={t.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{c.title}</Text>
                  <Text style={styles.cardSub} numberOfLines={1}>{c.last_text || 'No messages yet'}</Text>
                </View>
                {c.unread > 0 && <View style={styles.unreadDot}><Text style={styles.unreadDotText}>{c.unread}</Text></View>}
                <Ionicons name="chevron-forward" size={14} color={t.muted2} />
              </TouchableOpacity>
            ))}
            {items.length > 0 && <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Shared Reports</Text>}
          </View>
        }
        ListEmptyComponent={
          items.length === 0 ? null : (
            <View style={styles.center}>
              <Ionicons name="mail-outline" size={48} color={t.muted2} />
              <Text style={styles.emptyText}>No reports shared with you yet.</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const badgeColor = badgeFor(item.report_type);
          const iconName = item.report_type === 'training' ? 'barbell-outline' :
                           item.report_type === 'team_report' || item.report_type === 'team_training' ? 'people-outline' :
                           item.report_type === 'game' || item.report_type === 'game_session' ? 'clipboard-outline' : 'document-text-outline';
          return (
            <TouchableOpacity style={styles.card} onPress={() => openItem(item)}>
              <View style={[styles.iconBox, { backgroundColor: badgeColor.bg }]}>
                <Ionicons name={iconName as any} size={18} color={badgeColor.text} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <Text style={styles.cardTitle}>{REPORT_TYPE_LABELS[item.report_type] ?? item.report_type}</Text>
                </View>
                <Text style={styles.cardSub}>From: {item.sender_name}</Text>
                <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
              </View>
              {item.allow_regenerate && (
                <View style={styles.regenBadge}><Text style={styles.regenBadgeText}>Can Regen</Text></View>
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
          <Text style={styles.emptyText}>Join a team in the My Teams tab to see their games.</Text>
        </View>
      );
    }
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Team switcher */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
          {myTeams.map(team => (
            <TouchableOpacity
              key={team.id}
              style={[styles.teamChip, selectedTeam?.id === team.id && styles.teamChipActive]}
              onPress={() => loadTeamGames(team)}
            >
              <Text style={[styles.teamChipText, selectedTeam?.id === team.id && styles.teamChipTextActive]}>
                {team.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {!selectedTeam && (
          <View style={styles.center}>
            <Text style={styles.emptyText}>Select a team above to see their games.</Text>
          </View>
        )}

        {selectedTeam && teamGamesLoading && (
          <View style={styles.center}><ActivityIndicator color={t.accent} /></View>
        )}

        {selectedTeam && !teamGamesLoading && teamGames.length === 0 && (
          <View style={styles.center}>
            <Ionicons name="basketball-outline" size={48} color={t.muted2} />
            <Text style={styles.emptyText}>No games yet for {selectedTeam.name}.</Text>
          </View>
        )}

        {selectedTeam && !teamGamesLoading && teamGames.map((game: any) => (
          <TouchableOpacity key={game.kind + game.id} style={styles.card} onPress={() => {
            setActiveGame(game);
            setGameCommentText('');
            setGameComments([]);
          }}>
            <View style={[styles.iconBox, { backgroundColor: game.kind === 'session' ? t.positiveSoft : t.accentSoft }]}>
              <Ionicons name={game.kind === 'session' ? 'stats-chart-outline' : 'clipboard-outline'} size={18} color={game.kind === 'session' ? t.positive : t.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{game.title}</Text>
              <Text style={styles.cardSub}>{game.kind === 'session' ? 'Live Game Stats' : 'Game Report'}</Text>
              {game.date && <Text style={styles.cardDate}>{game.date}</Text>}
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
        <Text style={styles.sectionLabel}>FIND A TEAM TO JOIN</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Search by team name..."
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
          <Text style={styles.createTeamText}>Create a new team</Text>
        </TouchableOpacity>

        {searchResults.map((team: any) => {
          const isMember = myTeamIds.has(team.id);
          return (
            <View key={team.id} style={[styles.card, { marginHorizontal: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{team.name}</Text>
                {team.coach_name && <Text style={styles.cardSub}>Head Coach: {team.coach_name}</Text>}
                {team.competition_level && <Text style={styles.cardDate}>{team.competition_level}</Text>}
              </View>
              {isMember ? (
                <View style={{ backgroundColor: t.positiveSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Text style={{ color: t.positive, fontSize: 12, fontFamily: fonts[700] }}>Joined</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={{ backgroundColor: t.ctaBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
                  onPress={() => joinTeam(team.id)}
                  disabled={joining === team.id}
                >
                  {joining === team.id
                    ? <ActivityIndicator color={t.ctaText} size="small" />
                    : <Text style={{ color: t.ctaText, fontSize: 13, fontFamily: fonts[700] }}>Join</Text>}
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* My current teams — nested sub-team breakout */}
        {myTeams.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>MY TEAMS</Text>
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
                  <View style={[styles.card, { marginHorizontal: 0, marginLeft: depth * 16, borderLeftWidth: depth ? 3 : 1, borderLeftColor: depth ? t.accent : t.cardBorder }]}>
                    <View style={[styles.iconBox, { backgroundColor: t.accentSoft }]}>
                      <Ionicons name={depth ? 'git-branch-outline' : 'people'} size={17} color={t.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{tm.name}</Text>
                      <Text style={styles.cardSub}>{tm.member_count ?? 1} member{(tm.member_count ?? 1) === 1 ? '' : 's'}{tm.is_owner ? ' · You own this' : tm.coach_name ? ` · ${tm.coach_name}` : ''}</Text>
                    </View>
                    {kids.length > 0 && (
                      <TouchableOpacity onPress={() => setCollapsedTeams(prev => ({ ...prev, [tm.id]: !prev[tm.id] }))} style={{ padding: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                          <Text style={{ color: t.accent, fontSize: 12, fontFamily: fonts[700] }}>{kids.length}</Text>
                          <Ionicons name={isCollapsed ? 'chevron-down' : 'chevron-up'} size={16} color={t.accent} />
                        </View>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginLeft: depth * 16, marginBottom: 8, flexWrap: 'wrap' }}>
                    <TouchableOpacity style={styles.teamActBtn} onPress={() => messageGroup(tm)} disabled={messagingTeam === tm.id}>
                      {messagingTeam === tm.id ? <ActivityIndicator color={t.accent} size="small" /> : <><Ionicons name="chatbubble-ellipses-outline" size={14} color={t.accent} /><Text style={styles.teamActText}>Message</Text></>}
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.teamActBtn} onPress={() => { setSubFor(tm); setSubName(''); }}>
                      <Ionicons name="add" size={14} color={t.accent} /><Text style={styles.teamActText}>Sub-team</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.teamActBtn} onPress={() => { setInviteFor(tm); setInviteSearch(''); setInviteResults([]); }}>
                      <Ionicons name="person-add-outline" size={14} color={t.accent} /><Text style={styles.teamActText}>Invite</Text>
                    </TouchableOpacity>
                    {!tm.is_owner && (
                      <TouchableOpacity style={[styles.teamActBtn, { borderColor: t.negative }]} onPress={() => leaveTeam(tm.id)} disabled={leaving === tm.id}>
                        {leaving === tm.id ? <ActivityIndicator color={t.negative} size="small" /> : <Text style={[styles.teamActText, { color: t.negative }]}>Leave</Text>}
                      </TouchableOpacity>
                    )}
                  </View>
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
            <Text style={styles.emptyText}>Search for a team above to get started.</Text>
          </View>
        )}
      </KeyboardAwareScrollView>
    );
  };

  return (
    <ScreenBackground>
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={t.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Staff Hub</Text>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {([
          { key: 'inbox', label: 'Inbox', icon: 'mail-outline' },
          { key: 'team_games', label: 'Team Games', icon: 'basketball-outline' },
          { key: 'my_teams', label: 'My Teams', icon: 'people-outline' },
        ] as { key: TabKey; label: string; icon: string }[]).map(tm => (
          <TouchableOpacity
            key={tm.key}
            style={[styles.tabBtn, tab === tm.key && styles.tabBtnActive]}
            onPress={() => setTab(tm.key)}
          >
            <Ionicons name={tm.icon as any} size={16} color={tab === tm.key ? t.ctaText : t.muted2} />
            <Text style={[styles.tabBtnText, tab === tm.key && styles.tabBtnTextActive]}>{tm.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'inbox' && renderInboxTab()}
      {tab === 'team_games' && renderTeamGamesTab()}
      {tab === 'my_teams' && renderMyTeamsTab()}

      {/* Compose / new message modal */}
      <Modal visible={showCompose} transparent animationType="slide" onRequestClose={() => setShowCompose(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalBox, { maxHeight: '80%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={styles.modalTitle}>New Message</Text>
              <TouchableOpacity onPress={() => { setShowCompose(false); setSelectedStaff([]); }}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
            </View>
            <Text style={[styles.cardSub, { marginBottom: 8 }]}>Search staff by name. Add more than one for a group message.</Text>
            {selectedStaff.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ gap: 6 }}>
                {selectedStaff.map(s => (
                  <TouchableOpacity key={s.id} style={styles.selChip} onPress={() => toggleStaff(s)}>
                    <Text style={styles.selChipText}>{s.name}</Text>
                    <Ionicons name="close-circle" size={14} color={t.accent} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <TextInput
                style={[styles.searchInput, { flex: 1 }]}
                placeholder="Search staff name..."
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
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{s.name}</Text>
                      <Text style={styles.cardSub}>{[s.role, s.program_name].filter(Boolean).join(' · ')}</Text>
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
      </Modal>

      {/* Create team modal */}
      <Modal visible={showCreateTeam} transparent animationType="fade" onRequestClose={() => setShowCreateTeam(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalBox, { padding: 20 }]}>
            <Text style={styles.modalTitle}>New Team</Text>
            <Text style={[styles.cardSub, { marginTop: 4, marginBottom: 12 }]}>Create a team, then add sub-teams and invite coaches.</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Team name..."
              placeholderTextColor={t.muted2}
              value={newTeamName}
              onChangeText={setNewTeamName}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={[styles.startBtn, { flex: 1, backgroundColor: t.chip }]} onPress={() => setShowCreateTeam(false)}>
                <Text style={{ color: t.ink, fontFamily: fonts[700] }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.startBtn, { flex: 1, opacity: newTeamName.trim() && !creatingTeam ? 1 : 0.5 }]} onPress={createTeam} disabled={!newTeamName.trim() || creatingTeam}>
                {creatingTeam ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.startBtnText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Create sub-team modal */}
      <Modal visible={!!subFor} transparent animationType="fade" onRequestClose={() => setSubFor(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalBox, { padding: 20 }]}>
            <Text style={styles.modalTitle}>New Sub-team</Text>
            <Text style={[styles.cardSub, { marginTop: 4, marginBottom: 12 }]}>Under {subFor?.name}</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Sub-team name (e.g. Offense, Guards)..."
              placeholderTextColor={t.muted2}
              value={subName}
              onChangeText={setSubName}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={[styles.startBtn, { flex: 1, backgroundColor: t.chip }]} onPress={() => setSubFor(null)}>
                <Text style={{ color: t.ink, fontFamily: fonts[700] }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.startBtn, { flex: 1, opacity: subName.trim() && !creatingSub ? 1 : 0.5 }]} onPress={createSubteam} disabled={!subName.trim() || creatingSub}>
                {creatingSub ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.startBtnText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Invite modal */}
      <Modal visible={!!inviteFor} transparent animationType="slide" onRequestClose={() => setInviteFor(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalBox, { maxHeight: '80%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.modalTitle}>Invite to {inviteFor?.name}</Text>
              <TouchableOpacity onPress={() => setInviteFor(null)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
            </View>
            <Text style={[styles.cardSub, { marginBottom: 8 }]}>Search a coach by name, or enter an email to invite someone new. Coach accounts only.</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <TextInput
                style={[styles.searchInput, { flex: 1 }]}
                placeholder="Coach name or email..."
                placeholderTextColor={t.muted2}
                value={inviteSearch}
                onChangeText={setInviteSearch}
                onSubmitEditing={searchInvite}
                autoCapitalize="none"
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.searchBtn} onPress={searchInvite} disabled={inviteSearching}>
                {inviteSearching ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="search" size={18} color={t.ctaText} />}
              </TouchableOpacity>
            </View>
            {inviteSearch.includes('@') && (
              <TouchableOpacity style={[styles.staffRow, { justifyContent: 'space-between' }]} onPress={() => doInvite({ email: inviteSearch.trim() })} disabled={inviting}>
                <Text style={styles.cardTitle}>Email invite: {inviteSearch.trim()}</Text>
                <Ionicons name="mail-outline" size={18} color={t.accent} />
              </TouchableOpacity>
            )}
            <ScrollView style={{ maxHeight: 260 }}>
              {inviteResults.map((c: any) => (
                <TouchableOpacity key={c.id} style={styles.staffRow} onPress={() => doInvite({ coach_id: c.id })} disabled={inviting}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{c.name}</Text>
                    <Text style={styles.cardSub}>{[c.role, c.program_name].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Ionicons name="person-add-outline" size={18} color={t.accent} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Inbox detail modal */}
      <Modal visible={!!activeItem} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {REPORT_TYPE_LABELS[activeItem?.report_type ?? ''] ?? activeItem?.report_type ?? 'Report'}
                </Text>
                <Text style={styles.modalSub}>From {activeItem?.sender_name}</Text>
              </View>
              <TouchableOpacity onPress={() => setActiveItem(null)}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              <View style={styles.tabRow}>
                {(['report', 'comments'] as const).map(v => (
                  <TouchableOpacity key={v} style={[styles.tab, view === v && styles.tabActive]} onPress={() => setView(v)}>
                    <Text style={[styles.tabText, view === v && styles.tabTextActive]}>
                      {v === 'report' ? 'Original' : `Comments (${comments.length})`}
                    </Text>
                  </TouchableOpacity>
                ))}
                {activeItem?.regenerated_text && (
                  <TouchableOpacity style={[styles.tab, view === 'regenerated' && styles.tabActive]} onPress={() => setView('regenerated')}>
                    <Text style={[styles.tabText, view === 'regenerated' && styles.tabTextActive]}>Regenerated</Text>
                  </TouchableOpacity>
                )}
                {activeItem?.allow_regenerate && (
                  <TouchableOpacity style={[styles.tab, view === 'regenerate' && styles.tabActive]} onPress={() => setView('regenerate')}>
                    <Text style={[styles.tabText, view === 'regenerate' && styles.tabTextActive]}>Regenerate</Text>
                  </TouchableOpacity>
                )}
                {activeItem?.report_type === 'training' && (
                  <TouchableOpacity style={[styles.tab, view === 'notes' && styles.tabActive]} onPress={() => setView('notes')}>
                    <Text style={[styles.tabText, view === 'notes' && styles.tabTextActive]}>Notes</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>

            {view === 'report' && (
              <KeyboardAwareScrollView contentContainerStyle={{ paddingBottom: 16 }}>
                {activeItem?.report_text
                  ? renderReport(activeItem.report_text, { heading: t.ink, body: t.inkSoft })
                  : <Text style={{ color: t.muted2 }}>No report content available.</Text>}
              </KeyboardAwareScrollView>
            )}
            {view === 'regenerated' && (
              <KeyboardAwareScrollView contentContainerStyle={{ paddingBottom: 16 }}>
                <View style={{ backgroundColor: t.accentSoft, borderRadius: 8, padding: 10, marginBottom: 10 }}>
                  <Text style={{ color: t.accent, fontSize: 11, fontFamily: fonts[700], letterSpacing: 1 }}>REGENERATED VERSION</Text>
                </View>
                {activeItem?.regenerated_text ? renderReport(activeItem.regenerated_text, { heading: t.ink, body: t.inkSoft }) : <Text style={{ color: t.muted2 }}>No regenerated version yet.</Text>}
              </KeyboardAwareScrollView>
            )}
            {view === 'comments' && (
              <>
                <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={{ paddingBottom: 8 }}>
                  {comments.length === 0 && <Text style={{ color: t.muted2, textAlign: 'center', paddingVertical: 20 }}>No comments yet.</Text>}
                  {comments.map((c: any) => (
                    <View key={c.id} style={styles.commentCard}>
                      <Text style={styles.commentAuthor}>{c.author_name}</Text>
                      <Text style={styles.commentText}>{c.text}</Text>
                      <Text style={styles.commentDate}>{new Date(c.created_at).toLocaleDateString()}</Text>
                    </View>
                  ))}
                </ScrollView>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <VoiceTextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Add a comment..."
                    placeholderTextColor={t.muted2}
                    value={commentText}
                    onChangeText={setCommentText}
                    multiline
                  />
                  <TouchableOpacity style={styles.sendBtn} onPress={submitComment} disabled={submittingComment || !commentText.trim()}>
                    {submittingComment ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="send" size={18} color={t.ctaText} />}
                  </TouchableOpacity>
                </View>
              </>
            )}
            {view === 'regenerate' && (
              <>
                <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 10 }}>Provide feedback to regenerate this report with AI.</Text>
                <VoiceTextInput
                  style={[styles.input, { minHeight: 100 }]}
                  placeholder="What needs to be updated or corrected?"
                  placeholderTextColor={t.muted2}
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
                  {regenerating ? <ActivityIndicator color={t.ctaText} size="small" /> : <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>Regenerate Report</Text>}
                </TouchableOpacity>
              </>
            )}
            {view === 'notes' && (
              <>
                <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 10 }}>Add your notes about this training program.</Text>
                <VoiceTextInput
                  style={[styles.input, { minHeight: 120 }]}
                  placeholder="Add your coaching notes here..."
                  placeholderTextColor={t.muted2}
                  value={coachNotes}
                  onChangeText={setCoachNotes}
                  multiline
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[styles.regenBtn, { backgroundColor: t.positive }, (!coachNotes.trim() || savingNotes) && { opacity: 0.5 }]}
                  onPress={async () => {
                    if (!coachNotes.trim() || !activeItem) return;
                    setSavingNotes(true);
                    try {
                      await staffSharingAPI.addComment(activeItem.id, `[Coach Note] ${coachNotes.trim()}`);
                      const c = await staffSharingAPI.getComments(activeItem.id);
                      setComments(c);
                      setCoachNotes('');
                      Alert.alert('Saved', 'Note saved.');
                    } catch (e: any) {
                      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not save note');
                    } finally {
                      setSavingNotes(false);
                    }
                  }}
                  disabled={!coachNotes.trim() || savingNotes}
                >
                  {savingNotes ? <ActivityIndicator color={t.ctaText} size="small" /> : <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>Save Note</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Team Game detail modal */}
      <Modal visible={!!activeGame} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{activeGame?.title}</Text>
                <Text style={styles.modalSub}>{activeGame?.kind === 'session' ? 'Live Game Stats' : 'Game Report'} · {activeGame?.date}</Text>
              </View>
              <TouchableOpacity onPress={() => setActiveGame(null)}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>

            {activeGame?.kind === 'session' && (
              <TouchableOpacity
                style={styles.fullDataBtn}
                onPress={() => {
                  const gid = activeGame.id;
                  setActiveGame(null);
                  navigation.navigate('TeamEvalTab', { screen: 'TeamEval', params: { openGameId: gid } });
                }}
              >
                <Ionicons name="stats-chart-outline" size={16} color={t.accent} />
                <Text style={styles.fullDataBtnText}>View full game data (stats & grades)</Text>
                <Ionicons name="chevron-forward" size={16} color={t.accent} />
              </TouchableOpacity>
            )}

            <KeyboardAwareScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              {activeGame?.kind === 'report' && (
                activeGame.report_text
                  ? renderReport(String(activeGame.report_text).replace(/\s*END OF REPORT\.?\s*$/i, ''), { heading: t.ink, body: t.inkSoft })
                  : <Text style={{ color: t.muted2 }}>No report generated yet.</Text>
              )}
              {activeGame?.kind === 'session' && (
                activeGame.ai_scouting_report
                  ? renderReport(String(activeGame.ai_scouting_report).replace(/\s*END OF REPORT\.?\s*$/i, ''), { heading: t.ink, body: t.inkSoft })
                  : <Text style={{ color: t.muted2 }}>No AI scouting report generated yet for this game.</Text>
              )}
            </KeyboardAwareScrollView>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <VoiceTextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="Add a comment..."
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
                {submittingGameComment ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="send" size={18} color={t.ctaText} />}
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
      </Modal>
    </View>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', paddingTop: 56 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, marginBottom: 12, gap: 12 },
  title: { fontSize: 22, fontFamily: fonts[900], color: t.ink },
  emptyText: { color: t.muted2, marginTop: 12, fontSize: 14, textAlign: 'center' },
  tabBar: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, backgroundColor: t.card, borderRadius: 12, padding: 4 },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 10 },
  tabBtnActive: { backgroundColor: t.ctaBg },
  tabBtnText: { color: t.muted2, fontSize: 11, fontFamily: fonts[700] },
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
  fullDataBtnText: { flex: 1, color: t.accent, fontSize: 13, fontFamily: fonts[700] },
  regenBadgeText: { color: t.accent, fontSize: 10, fontFamily: fonts[700] },
  teamChip: { borderWidth: 1, borderColor: t.line, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  teamChipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  teamChipText: { color: t.muted, fontSize: 13, fontFamily: fonts[600] },
  teamChipTextActive: { color: t.ctaText },
  modalOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  modalBox: { backgroundColor: t.sheet, borderRadius: 20, padding: 20, maxHeight: '90%', margin: 8 },
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
  newMsgBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.ctaBg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 8 },
  newMsgText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 12.5 },
  unreadDot: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginRight: 6 },
  unreadDotText: { color: '#fff', fontSize: 11, fontFamily: fonts[800] },
  searchInput: { backgroundColor: t.chip, borderRadius: 10, padding: 12, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line },
  selChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: t.accent },
  selChipText: { color: t.accent, fontSize: 13, fontFamily: fonts[600] },
  staffRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 12, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: t.cardBorder },
  startBtn: { backgroundColor: t.ctaBg, borderRadius: 999, padding: 15, alignItems: 'center', marginTop: 10 },
  startBtnText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15 },
  teamActBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.accentSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: t.accent },
  teamActText: { color: t.accent, fontSize: 12, fontFamily: fonts[700] },
  createTeamBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accentSoft, borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: t.accent, marginBottom: 8 },
  createTeamText: { color: t.accent, fontFamily: fonts[700], fontSize: 13.5 },
});
