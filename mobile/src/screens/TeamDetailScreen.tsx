/**
 * One team: who is on it, and everything you'd do to it.
 *
 * Staff Hub used to carry all of this inline — a member list, four action
 * buttons and a sub-team tree under every card — which meant the My Teams list
 * grew a screenful per team and left no room for anything per-person. The list
 * is a list again; this is the page you land on when you tap a team.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, Alert, TextInput,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { teamStaffAPI, staffMessagesAPI, coachesAPI } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { topPad } from '../responsive/screenPadding';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import { sheetCap } from '../responsive/modalSizes';

type Member = { id: number; name: string; role?: string | null; is_owner?: boolean };
type Team = {
  id: number; name: string; competition_level?: string | null; coach_name?: string | null;
  parent_team_id?: number | null; is_owner?: boolean; owner_missing?: boolean; members?: Member[];
};

export default function TeamDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { coach } = useAuth();
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const styles = makeStyles(t);

  const teamId: number = route.params?.teamId;
  const [team, setTeam] = useState<Team | null>(route.params?.team ?? null);
  const [members, setMembers] = useState<Member[]>(route.params?.team?.members ?? []);
  const [subteams, setSubteams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyMember, setBusyMember] = useState<number | null>(null);

  const [subName, setSubName] = useState('');
  const [showSub, setShowSub] = useState(false);
  const [creatingSub, setCreatingSub] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSearch, setInviteSearch] = useState('');
  const [inviteResults, setInviteResults] = useState<any[]>([]);
  const [inviteSearching, setInviteSearching] = useState(false);
  const [inviteSearchedFor, setInviteSearchedFor] = useState('');
  const [inviting, setInviting] = useState(false);

  // Which member is being placed on a sub-team, and their profile card.
  const [addingTo, setAddingTo] = useState<Member | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, subs] = await Promise.all([
        teamStaffAPI.myTeams().catch(() => []),
        teamStaffAPI.subteams(teamId).catch(() => []),
      ]);
      const found = (mine ?? []).find((x: Team) => x.id === teamId);
      if (found) { setTeam(found); setMembers(found.members ?? []); }
      else {
        // Not in my-teams (a sub-team of a team I'm staff on, say) — the member
        // list still stands on its own.
        setMembers(await teamStaffAPI.members(teamId).catch(() => []));
      }
      setSubteams(subs ?? []);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isOwner = !!team?.is_owner;

  // ── Per-member actions ────────────────────────────────────────────────────

  const messageMember = async (m: Member) => {
    setBusyMember(m.id);
    try {
      const conv = await staffMessagesAPI.create({ member_ids: [m.id], is_group: false });
      navigation.navigate('Conversation', { conversationId: conv.id, title: conv.title || m.name });
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('staffHub.startConvError'));
    } finally { setBusyMember(null); }
  };

  const openProfile = async (m: Member) => {
    setProfile({ id: m.id, name: m.name, role: m.role });
    setProfileLoading(true);
    try { setProfile(await teamStaffAPI.coachProfile(m.id)); } catch {}
    setProfileLoading(false);
  };

  const addToSubteam = async (sub: Team) => {
    if (!addingTo) return;
    const m = addingTo;
    setAddingTo(null);
    setBusyMember(m.id);
    try {
      await teamStaffAPI.addMember(sub.id, m.id);
      await load();
      Alert.alert(tr('teamDetail.addedTitle'), tr('teamDetail.addedMsg', { name: m.name, team: sub.name }));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('teamDetail.addError'));
    } finally { setBusyMember(null); }
  };

  const removeMember = (m: Member) => {
    Alert.alert(tr('teamDetail.removeTitle'), tr('teamDetail.removeMsg', { name: m.name, team: team?.name ?? '' }), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('teamDetail.remove'), style: 'destructive', onPress: async () => {
          setBusyMember(m.id);
          try { await teamStaffAPI.removeMember(teamId, m.id); await load(); }
          catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('teamDetail.removeError')); }
          finally { setBusyMember(null); }
        },
      },
    ]);
  };

  // ── Team actions ──────────────────────────────────────────────────────────

  const messageGroup = async () => {
    const others = members.filter(m => m.id !== coach?.id);
    if (others.length === 0) { Alert.alert(tr('staffHub.noOtherMembersTitle'), tr('staffHub.noOtherMembersMsg')); return; }
    try {
      const conv = await staffMessagesAPI.create({
        member_ids: others.map(m => m.id), is_group: others.length > 1, title: team?.name,
      });
      navigation.navigate('Conversation', { conversationId: conv.id, title: conv.title || team?.name });
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('staffHub.openGroupError'));
    }
  };

  const createSub = async () => {
    if (!subName.trim()) return;
    setCreatingSub(true);
    try {
      await teamStaffAPI.createSubteam(teamId, subName.trim());
      setShowSub(false); setSubName('');
      await load();
    } catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('staffHub.createSubteamError')); }
    finally { setCreatingSub(false); }
  };

  const runInviteSearch = async (term: string) => {
    if (term.length < 2) { setInviteResults([]); setInviteSearchedFor(''); return; }
    setInviteSearching(true);
    try { setInviteResults(await coachesAPI.search(term)); setInviteSearchedFor(term); }
    catch { setInviteResults([]); setInviteSearchedFor(term); }
    finally { setInviteSearching(false); }
  };

  const doInvite = async (data: { coach_id?: number; email?: string }) => {
    setInviting(true);
    try {
      const res = await teamStaffAPI.invite(teamId, data);
      if (res.status === 'invited') Alert.alert(tr('staffHub.inviteSentTitle'), tr('staffHub.inviteSentMsg', { name: res.name }));
      else Alert.alert(tr('staffHub.emailInviteTitle'), res.email_sent
        ? tr('staffHub.emailInviteSentMsg', { email: res.email })
        : tr('staffHub.emailInviteCodeMsg', { email: res.email, code: res.code }));
      setInviteOpen(false); setInviteSearch(''); setInviteResults([]); setInviteSearchedFor('');
    } catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('staffHub.inviteError')); }
    finally { setInviting(false); }
  };

  const doTransfer = async (toCoachId?: number) => {
    setTransferring(true);
    try {
      await teamStaffAPI.transferOwner(teamId, toCoachId);
      setTransferOpen(false);
      await load();
      Alert.alert(tr('staffHub.transferDoneTitle'), tr('staffHub.transferDoneMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('staffHub.transferError'));
    } finally { setTransferring(false); }
  };

  const claim = () => {
    Alert.alert(tr('staffHub.claimTitle'), tr('staffHub.claimMsg', { team: team?.name ?? '' }), [
      { text: tr('common.cancel'), style: 'cancel' },
      { text: tr('staffHub.claimConfirm'), onPress: () => doTransfer() },
    ]);
  };

  const leave = () => {
    Alert.alert(tr('staffHub.leaveTeamTitle'), tr('staffHub.leaveTeamMsg'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('staffHub.leave'), style: 'destructive', onPress: async () => {
          try { await teamStaffAPI.leave(teamId); navigation.goBack(); }
          catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('staffHub.joinTeamError')); }
        },
      },
    ]);
  };

  const roleLabel = (m: Member) => {
    if (m.is_owner) return tr('staffHub.ownerRole');
    const role = (m.role || '').trim();
    return role
      ? tr(`auth.role${role.charAt(0).toUpperCase()}${role.slice(1)}`, { defaultValue: role })
      : tr('staffHub.staffRole');
  };

  return (
    <ScreenBackground>
      <PageContainer padded={false} maxWidth={1280}>
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={{ flexShrink: 0 }}>
              <Ionicons name="chevron-back" size={24} color={t.ink} />
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={2}>{team?.name ?? route.params?.teamName ?? tr('teamDetail.title')}</Text>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
            <Text style={styles.meta} numberOfLines={2}>
              {[
                members.length === 1
                  ? tr('staffHub.memberCountOne', { count: members.length })
                  : tr('staffHub.memberCountOther', { count: members.length }),
                team?.is_owner ? tr('staffHub.ownedByYou') : team?.coach_name,
                team?.competition_level,
              ].filter(Boolean).join(' · ')}
            </Text>

            {/* Team-level actions */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actBtn} onPress={messageGroup}>
                <Ionicons name="chatbubble-ellipses-outline" size={14} color={t.accent} />
                <Text style={styles.actText} numberOfLines={1}>{tr('staffHub.message')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actBtn} onPress={() => { setSubName(''); setShowSub(true); }}>
                <Ionicons name="add" size={14} color={t.accent} />
                <Text style={styles.actText} numberOfLines={1}>{tr('staffHub.subTeam')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actBtn} onPress={() => { setInviteSearch(''); setInviteResults([]); setInviteSearchedFor(''); setInviteOpen(true); }}>
                <Ionicons name="person-add-outline" size={14} color={t.accent} />
                <Text style={styles.actText} numberOfLines={1}>{tr('staffHub.invite')}</Text>
              </TouchableOpacity>
              {isOwner && (
                <TouchableOpacity style={styles.actBtn} onPress={() => setTransferOpen(true)}>
                  <Ionicons name="swap-horizontal-outline" size={14} color={t.accent} />
                  <Text style={styles.actText} numberOfLines={1}>{tr('staffHub.transferOwner')}</Text>
                </TouchableOpacity>
              )}
              {!isOwner && team?.owner_missing && (
                <TouchableOpacity style={styles.actBtn} onPress={claim}>
                  <Ionicons name="flag-outline" size={14} color={t.accent} />
                  <Text style={styles.actText} numberOfLines={1}>{tr('staffHub.claimOwnership')}</Text>
                </TouchableOpacity>
              )}
              {!isOwner && (
                <TouchableOpacity style={[styles.actBtn, { borderColor: t.negative }]} onPress={leave}>
                  <Text style={[styles.actText, { color: t.negative }]} numberOfLines={1}>{tr('staffHub.leave')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Staff */}
            <Text style={styles.sectionLabel}>{tr('teamDetail.staffLabel')}</Text>
            {loading && members.length === 0 ? (
              <ActivityIndicator color={t.accent} style={{ marginTop: 12 }} />
            ) : (
              members.map(m => {
                const isMe = m.id === coach?.id;
                return (
                  <View key={m.id} style={styles.memberCard}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{(m.name || '?').trim().charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {m.name}{isMe ? ` · ${tr('staffHub.you')}` : ''}
                      </Text>
                      <Text style={styles.memberRole} numberOfLines={1}>{roleLabel(m)}</Text>
                    </View>
                    {busyMember === m.id ? (
                      <ActivityIndicator color={t.accent} size="small" />
                    ) : (
                      <View style={styles.iconRow}>
                        <TouchableOpacity
                          style={styles.iconBtn}
                          onPress={() => openProfile(m)}
                          accessibilityLabel={tr('teamDetail.viewProfile')}
                        >
                          <Ionicons name="person-outline" size={16} color={t.accent} />
                        </TouchableOpacity>
                        {!isMe && (
                          <TouchableOpacity
                            style={styles.iconBtn}
                            onPress={() => messageMember(m)}
                            accessibilityLabel={tr('teamDetail.messageMember')}
                          >
                            <Ionicons name="chatbubble-ellipses-outline" size={16} color={t.accent} />
                          </TouchableOpacity>
                        )}
                        {subteams.length > 0 && (
                          <TouchableOpacity
                            style={styles.iconBtn}
                            onPress={() => setAddingTo(m)}
                            accessibilityLabel={tr('teamDetail.addToSubteam')}
                          >
                            <Ionicons name="git-branch-outline" size={16} color={t.accent} />
                          </TouchableOpacity>
                        )}
                        {isOwner && !m.is_owner && (
                          <TouchableOpacity
                            style={[styles.iconBtn, { borderColor: t.negative }]}
                            onPress={() => removeMember(m)}
                            accessibilityLabel={tr('teamDetail.remove')}
                          >
                            <Ionicons name="person-remove-outline" size={16} color={t.negative} />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
            {!loading && members.length <= 1 && (
              <Text style={styles.hint} numberOfLines={2}>{tr('staffHub.onlyYouHint')}</Text>
            )}

            {/* Sub-teams */}
            {subteams.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>{tr('teamDetail.subteamsLabel')}</Text>
                {subteams.map(s => (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.subCard}
                    onPress={() => navigation.push('TeamDetail', { teamId: s.id, teamName: s.name })}
                  >
                    <View style={styles.subIcon}><Ionicons name="git-branch-outline" size={16} color={t.accent} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.memberName} numberOfLines={1}>{s.name}</Text>
                      <Text style={styles.memberRole} numberOfLines={1}>
                        {(s.members?.length ?? 1) === 1
                          ? tr('staffHub.memberCountOne', { count: s.members?.length ?? 1 })
                          : tr('staffHub.memberCountOther', { count: s.members?.length ?? 1 })}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={t.muted2} />
                  </TouchableOpacity>
                ))}
              </>
            )}
          </ScrollView>
        </View>

        {/* Create sub-team */}
        <Modal visible={showSub} transparent animationType="slide" onRequestClose={() => setShowSub(false)}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle} numberOfLines={1}>{tr('staffHub.newSubteam')}</Text>
                <TouchableOpacity onPress={() => setShowSub(false)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
              </View>
              <TextInput
                style={styles.input}
                placeholder={tr('staffHub.subteamNamePlaceholder')}
                placeholderTextColor={t.muted2}
                value={subName}
                onChangeText={setSubName}
              />
              <TouchableOpacity style={[styles.cta, (!subName.trim() || creatingSub) && { opacity: 0.5 }]} onPress={createSub} disabled={!subName.trim() || creatingSub}>
                {creatingSub ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.ctaText} numberOfLines={1}>{tr('staffHub.create')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Invite */}
        <Modal visible={inviteOpen} transparent animationType="slide" onRequestClose={() => setInviteOpen(false)}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle} numberOfLines={1}>{tr('staffHub.inviteTo', { name: team?.name ?? '' })}</Text>
                <TouchableOpacity onPress={() => setInviteOpen(false)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
              </View>
              <Text style={styles.memberRole}>{tr('staffHub.inviteSheetHint')}</Text>
              <TextInput
                style={styles.input}
                placeholder={tr('staffHub.coachNameOrEmail')}
                placeholderTextColor={t.muted2}
                value={inviteSearch}
                onChangeText={v => { setInviteSearch(v); runInviteSearch(v.trim()); }}
                autoCapitalize="none"
              />
              <KeyboardAwareScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
                {inviteResults.map((c: any) => (
                  <TouchableOpacity key={c.id} style={styles.memberCard} onPress={() => doInvite({ coach_id: c.id })} disabled={inviting}>
                    <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                      <Text style={styles.memberName} numberOfLines={1}>{c.name}</Text>
                      <Text style={styles.memberRole} numberOfLines={1}>{[c.role, c.program_name].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <Ionicons name="person-add-outline" size={18} color={t.accent} />
                  </TouchableOpacity>
                ))}
                {inviteSearch.trim().includes('@')
                  && inviteSearchedFor === inviteSearch.trim()
                  && !inviteSearching
                  && inviteResults.length === 0 && (
                  <TouchableOpacity style={styles.memberCard} onPress={() => doInvite({ email: inviteSearch.trim() })} disabled={inviting}>
                    <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                      <Text style={styles.memberName} numberOfLines={1}>{tr('staffHub.emailInviteRow', { email: inviteSearch.trim() })}</Text>
                      <Text style={styles.memberRole} numberOfLines={1}>{tr('staffHub.noAccountYet')}</Text>
                    </View>
                    <Ionicons name="mail-outline" size={18} color={t.accent} />
                  </TouchableOpacity>
                )}
              </KeyboardAwareScrollView>
            </View>
          </View>
        </Modal>

        {/* Pick a sub-team to add someone to */}
        <Modal visible={!!addingTo} transparent animationType="slide" onRequestClose={() => setAddingTo(null)}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle} numberOfLines={2}>{tr('teamDetail.addToWhich', { name: addingTo?.name ?? '' })}</Text>
                <TouchableOpacity onPress={() => setAddingTo(null)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 320 }}>
                {subteams.map(s => (
                  <TouchableOpacity key={s.id} style={styles.memberCard} onPress={() => addToSubteam(s)}>
                    <View style={styles.subIcon}><Ionicons name="git-branch-outline" size={16} color={t.accent} /></View>
                    <Text style={[styles.memberName, { flex: 1 }]} numberOfLines={1}>{s.name}</Text>
                    <Ionicons name="chevron-forward" size={18} color={t.muted2} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Hand the team over. Only its existing staff can be named — the
            server rejects anyone else — so the member list IS the choice. */}
        <Modal visible={transferOpen} transparent animationType="slide" onRequestClose={() => setTransferOpen(false)}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle} numberOfLines={2}>{tr('staffHub.transferOwner')}</Text>
                <TouchableOpacity onPress={() => setTransferOpen(false)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
              </View>
              <Text style={[styles.memberRole, { marginBottom: 10 }]}>{tr('staffHub.transferHint', { team: team?.name ?? '' })}</Text>
              {transferring && <ActivityIndicator color={t.accent} />}
              <ScrollView style={{ maxHeight: 320 }}>
                {members.filter(m => !m.is_owner).map(m => (
                  <TouchableOpacity key={m.id} style={styles.memberCard} onPress={() => doTransfer(m.id)} disabled={transferring}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{(m.name || '?').trim().charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.memberName} numberOfLines={1}>{m.name}</Text>
                      <Text style={styles.memberRole} numberOfLines={1}>{roleLabel(m)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={t.muted2} />
                  </TouchableOpacity>
                ))}
                {members.filter(m => !m.is_owner).length === 0 && (
                  <Text style={styles.hint}>{tr('staffHub.transferNoStaff')}</Text>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Member card */}
        <Modal visible={!!profile} transparent animationType="slide" onRequestClose={() => setProfile(null)}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle} numberOfLines={1}>{profile?.name ?? ''}</Text>
                <TouchableOpacity onPress={() => setProfile(null)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
              </View>
              {profileLoading && <ActivityIndicator color={t.accent} />}
              {[
                [tr('teamDetail.roleLabel'), profile?.role],
                [tr('teamDetail.programLabel'), profile?.program_name],
                [tr('teamDetail.conferenceLabel'), profile?.conference],
                [tr('teamDetail.levelLabel'), profile?.competition_level],
                [tr('teamDetail.locationLabel'), [profile?.city, profile?.country].filter(Boolean).join(', ')],
                [tr('teamDetail.sharedTeamsLabel'), (profile?.shared_teams ?? []).map((x: any) => x.name).join(', ')],
              ].filter(([, v]) => !!v).map(([label, value]) => (
                <View key={String(label)} style={styles.profileRow}>
                  <Text style={styles.profileLabel} numberOfLines={1}>{String(label)}</Text>
                  <Text style={styles.profileValue} numberOfLines={3}>{String(value)}</Text>
                </View>
              ))}
            </View>
          </View>
        </Modal>
      </PageContainer>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', paddingTop: topPad(56) },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, marginBottom: 12, gap: 12 },
  title: { fontSize: 22, fontFamily: fonts[900], color: t.ink, flex: 1, flexShrink: 1, minWidth: 0 },
  meta: { color: t.muted, fontSize: 13, marginBottom: 14 },

  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 6 },
  actBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.accentSoft,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: t.accent,
    flexShrink: 1, maxWidth: '100%',
  },
  actText: { color: t.accent, fontSize: 12, fontFamily: fonts[700], flexShrink: 1 },

  sectionLabel: {
    color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 1.6,
    textTransform: 'uppercase', marginTop: 22, marginBottom: 10,
  },
  memberCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.card,
    borderRadius: 14, padding: 12, borderWidth: 1, borderColor: t.cardBorder, marginBottom: 8,
  },
  avatar: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: t.accentSoft,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { color: t.accent, fontSize: 14, fontFamily: fonts[800] },
  memberName: { color: t.ink, fontSize: 14.5, fontFamily: fonts[700], flexShrink: 1 },
  memberRole: { color: t.muted2, fontSize: 12, marginTop: 1, flexShrink: 1 },
  iconRow: { flexDirection: 'row', gap: 6, flexShrink: 0 },
  iconBtn: {
    width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: t.accent,
    backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center',
  },
  hint: { color: t.muted2, fontSize: 12.5, lineHeight: 18, marginTop: 2 },

  subCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.card,
    borderRadius: 14, padding: 12, borderWidth: 1, borderColor: t.cardBorder, marginBottom: 8,
  },
  subIcon: {
    width: 32, height: 32, borderRadius: 9, backgroundColor: t.accentSoft,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 22, paddingBottom: 34, maxHeight: '88%', ...sheetCap(560),
  },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10 },
  sheetTitle: { color: t.ink, fontSize: 19, fontFamily: fonts[800], flex: 1, flexShrink: 1, minWidth: 0 },
  input: {
    backgroundColor: t.card, borderRadius: 12, padding: 13, color: t.ink, fontSize: 15,
    borderWidth: 1, borderColor: t.cardBorder, marginTop: 10, marginBottom: 6,
  },
  cta: { backgroundColor: t.ctaBg, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 14 },
  ctaText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15, flexShrink: 1 },

  profileRow: { flexDirection: 'row', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.divider },
  profileLabel: { color: t.muted2, fontSize: 12, fontFamily: fonts[700], width: 110, flexShrink: 0 },
  profileValue: { color: t.inkSoft, fontSize: 13.5, flex: 1, flexShrink: 1 },
});
