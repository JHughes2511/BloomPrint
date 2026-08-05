import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceTextInput from '../../components/VoiceTextInput';
import KeyboardAwareScrollView from '../../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
  Modal, TextInput, Platform, PanResponder, Animated, Keyboard, RefreshControl,
} from 'react-native';
import Sheet from '../../components/Sheet';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { usePlayerAuth } from '../../context/PlayerAuthContext';
import { playerNotificationsAPI, playerProfileAPI, playerReportsAPI, playerLinkAPI } from '../../api/playerClient';
import { useTheme } from '../../theme/ThemeProvider';
import { topPad } from '../../responsive/screenPadding';
import { outputTypeLabel } from '../../utils/reportType';

const PILLAR_LABELS: Record<string, string> = {
  offensive_skills: 'Offensive Skills',
  defensive_capabilities: 'Defense',
  physical_attributes: 'Physical',
  intangibles: 'Intangibles',
  advanced_analysis: 'Advanced',
  strategic_fit: 'Strategic Fit',
};
const PILLAR_ORDER = ['offensive_skills', 'defensive_capabilities', 'physical_attributes', 'intangibles', 'advanced_analysis', 'strategic_fit'];
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';
import PageContainer from '../../responsive/PageContainer';
import { timeAgo } from '../../utils/timeAgo';
import { sheetCap } from '../../responsive/modalSizes';

export default function PlayerHomeScreen() {
  const { t: tr } = useTranslation();
  const { t, mode, toggle } = useTheme();
  const styles = makeStyles(t);
  const { playerUser, logout, refreshUser } = usePlayerAuth();
  const navigation = useNavigation<any>();
  const isLinked = !!playerUser?.player_id;
  const [unreadCount, setUnreadCount] = useState(0);
  const [reports, setReports] = useState<any[]>([]);
  const [showBim, setShowBim] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [linking, setLinking] = useState(false);
  const [profile, setProfile] = useState<{
    position?: string; height?: string; wingspan?: string;
    weight?: string; standing_reach?: string;
    country?: string; state?: string; city?: string; school_name?: string;
    latest_grade?: number | null; program_name?: string;
  } | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editPosition, setEditPosition] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [editWingspan, setEditWingspan] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editStandingReach, setEditStandingReach] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editState, setEditState] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editSchool, setEditSchool] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadHome = useCallback(() => {
    playerNotificationsAPI.list().then((notifs: any[]) => {
      setUnreadCount(notifs.filter(n => !n.read).length);
    }).catch(() => {});
    playerReportsAPI.list().then((r: any[]) => setReports(Array.isArray(r) ? r : [])).catch(() => {});
    if (playerUser?.player_id) {
      playerProfileAPI.get().then((p: any) => setProfile(p)).catch(() => {});
    }
  }, [playerUser?.player_id]);

  useFocusEffect(useCallback(() => { loadHome(); }, [loadHome]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshUser().catch(() => {});
    loadHome();
    setRefreshing(false);
  }, [loadHome, refreshUser]);

  // ── Derived data for the reference-style header + BIM score card ──
  const firstName = (playerUser?.name ?? '').trim().split(/\s+/)[0] || tr('playerApp.home.playerFallback');
  const initials = (playerUser?.name ?? '')
    .trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || 'P';
  const programName = (playerUser as any)?.linked_program_name ?? profile?.program_name ?? '';
  const subtitleBits = [profile?.position, programName].filter(Boolean);

  const gradedReports = reports
    .filter(r => r.overall_grade != null)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  // The player's true BIM score = the same recency-weighted composite the coach
  // sees (from all evals). Report content stays gated to what the coach shared.
  const bimScore = (profile as any)?.bim_grade ?? profile?.latest_grade ?? gradedReports[0]?.overall_grade ?? null;
  const trend = gradedReports.length >= 2
    ? (gradedReports[0].overall_grade - gradedReports[1].overall_grade)
    : null;
  const pillarSource = ((profile as any)?.bim_pillars && Object.keys((profile as any).bim_pillars).length)
    ? (profile as any).bim_pillars
    : (reports.find(r => r.pillar_grades && Object.keys(r.pillar_grades).length)?.pillar_grades ?? null);
  const PILLAR_BAR = [
    { key: 'offensive_skills', label: tr('playerApp.home.pillarShort.offense'), color: t.accent },
    { key: 'defensive_capabilities', label: tr('playerApp.home.pillarShort.defense'), color: t.pistachio },
    { key: 'physical_attributes', label: tr('playerApp.home.pillarShort.physical'), color: t.brown },
    { key: 'intangibles', label: tr('playerApp.home.pillarShort.iq'), color: t.chip },
  ];

  const coachFeed = [...reports]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3);
  const flagSource = reports.find(r => (r.green_flags?.length || r.watch_flags?.length)) ?? null;

  const openReport = (r: any) =>
    navigation.push('PlayerReportDetail' as any, { reportId: r.id });

  const linkWithInvite = async () => {
    if (!inviteCode.trim()) return;
    setLinking(true);
    try {
      const res = await playerLinkAPI.useInvite(inviteCode.trim());
      await refreshUser();
      setInviteCode('');
      Alert.alert(tr('playerApp.home.linkedTitle'), tr('playerApp.home.linkedMsg', { name: res?.player_name ?? tr('playerApp.home.yourPlayerProfile') }));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerApp.home.invalidInviteCode'));
    } finally {
      setLinking(false);
    }
  };

  const openEdit = () => {
    setEditPosition(profile?.position ?? '');
    setEditHeight(profile?.height ?? '');
    setEditWingspan(profile?.wingspan ?? '');
    setEditWeight(profile?.weight ?? '');
    setEditStandingReach(profile?.standing_reach ?? '');
    setEditCountry(profile?.country ?? '');
    setEditState(profile?.state ?? '');
    setEditCity(profile?.city ?? '');
    setEditSchool(profile?.school_name ?? '');
    openModal();
  };

  const modalScrollRef = useRef<ScrollView>(null);
  const fieldY = useRef<Record<string, number>>({});
  const KEYBOARD_HEIGHT = Platform.OS === 'ios' ? 336 : 280;

  const scrollToField = (key: string) => {
    const y = fieldY.current[key] ?? 0;
    setTimeout(() => modalScrollRef.current?.scrollTo({ y: Math.max(0, y - 20), animated: true }), 60);
  };

  const slideY = useRef(new Animated.Value(600)).current;

  const openModal = () => {
    setShowEditModal(true);
    Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
  };

  const closeModal = () => {
    Animated.timing(slideY, { toValue: 600, duration: 220, useNativeDriver: true }).start(() => {
      setShowEditModal(false);
    });
  };

  const swipePan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, { dy, dx }) => dy > 10 && Math.abs(dy) > Math.abs(dx),
    onPanResponderMove: (_, { dy }) => { if (dy > 0) slideY.setValue(dy); },
    onPanResponderRelease: (_, { dy }) => {
      if (dy > 80) {
        closeModal();
      } else {
        Animated.spring(slideY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  const saveProfile = async () => {
    setSaving(true);
    try {
      const updated = await playerProfileAPI.update({
        position: editPosition.trim() || undefined,
        height: editHeight.trim() || undefined,
        wingspan: editWingspan.trim() || undefined,
        weight: editWeight.trim() || undefined,
        standing_reach: editStandingReach.trim() || undefined,
        country: editCountry.trim() || undefined,
        state: editState.trim() || undefined,
        city: editCity.trim() || undefined,
        school_name: editSchool.trim() || undefined,
      });
      setProfile(updated);
      setShowEditModal(false);
    } catch {
      Alert.alert(tr('common.error'), tr('playerApp.home.failedToSaveProfile'));
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(tr('playerApp.home.signOut'), tr('playerApp.home.signOutConfirm'), [
      { text: tr('common.cancel'), style: 'cancel' },
      { text: tr('playerApp.home.signOut'), style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <ScreenBackground>
    <PageContainer>
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.positive} />}
    >
      <View style={styles.header}>
        <View style={styles.headerTop}>
          {/* Translated headers run 20-40% longer than English, so the text block
              shrinks and clips rather than pushing the action buttons off-screen. */}
          <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 10 }}>
            <Text style={styles.eyebrow} numberOfLines={1}>{tr('playerApp.home.playerPortal')}</Text>
            <Text style={styles.greeting} numberOfLines={1}>
              {tr('playerApp.home.greeting', { name: firstName })}
            </Text>
            {subtitleBits.length > 0 && (
              <Text style={styles.greetingSub} numberOfLines={1}>{subtitleBits.join(' · ')}</Text>
            )}
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.circleBtn} onPress={toggle} accessibilityLabel={tr('playerApp.home.toggleTheme')}>
              <Ionicons name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'} size={18} color={t.inkSoft} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.circleBtn} onPress={() => navigation.navigate('PlayerNotifsTab' as any)} accessibilityLabel={tr('playerApp.home.notifications')}>
              <Ionicons name="notifications-outline" size={18} color={t.inkSoft} />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.circleBtn} onPress={handleSignOut} accessibilityLabel={tr('playerApp.home.signOut')}>
              <Ionicons name="log-out-outline" size={18} color={t.muted2} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.statusRow}>
          {isLinked ? (
            <View style={styles.linkedBadge}>
              <Ionicons name="checkmark-circle" size={12} color={t.positive} />
              <Text style={styles.linkedText} numberOfLines={1}>
                {tr('playerApp.home.linked')}{(playerUser as any).linked_program_name ? ` · ${(playerUser as any).linked_program_name}` : ''}
              </Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.notLinkedBadge} onPress={openEdit}>
              <Ionicons name="link-outline" size={12} color={t.muted} />
              <Text style={styles.notLinkedText} numberOfLines={1}>{tr('playerApp.home.notLinkedTapToLink')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Current BIM Score */}
      {bimScore != null && (
        <TouchableOpacity style={styles.bimCard} activeOpacity={0.85} onPress={() => setShowBim(true)}>
          <View style={styles.bimTop}>
            <Text style={styles.bimCardLabel} numberOfLines={1}>{tr('playerApp.home.currentBimScore')}</Text>
            {trend != null && Math.abs(trend) >= 0.05 && (
              <View style={[styles.trendPill, { backgroundColor: trend >= 0 ? t.positiveSoft : t.negativeSoft }]}>
                <Text style={[styles.trendText, { color: trend >= 0 ? t.positive : t.negative }]} numberOfLines={1}>
                  {trend >= 0 ? '▲ +' : '▼ '}{Math.abs(trend).toFixed(1)}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.bimScoreRow}>
            <Text style={styles.bimScore}>{bimScore.toFixed(1)}</Text>
            <Text style={styles.bimOf} numberOfLines={1}>
              {tr('playerApp.home.ofTen')}{trend != null && Math.abs(trend) >= 0.05 ? (trend >= 0 ? ` · ${tr('playerApp.home.trendingUp')}` : ` · ${tr('playerApp.home.trendingDown')}`) : ''}
            </Text>
          </View>
          {pillarSource && (
            <>
              <View style={styles.pillarBar}>
                {PILLAR_BAR.map(p => {
                  const g = Number(pillarSource[p.key]) || 1;
                  return <View key={p.key} style={{ flex: Math.max(0.6, g), backgroundColor: p.color, borderRadius: 4 }} />;
                })}
              </View>
              <View style={styles.pillarLabels}>
                {PILLAR_BAR.map(p => (
                  <Text key={p.key} style={styles.pillarLabelText} numberOfLines={1}>{p.label}</Text>
                ))}
              </View>
            </>
          )}
          <View style={styles.bimHint}>
            <Text style={styles.bimHintText} numberOfLines={1}>{tr('playerApp.home.tapForBreakdown')}</Text>
            <Ionicons name="chevron-forward" size={13} color={t.muted2} />
          </View>
        </TouchableOpacity>
      )}

      {/* From Your Coach */}
      {coachFeed.length > 0 && (
        <>
          <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.home.fromYourCoach')}</Text>
          {coachFeed.map(r => (
            <TouchableOpacity key={r.id} style={styles.feedCard} onPress={() => openReport(r)}>
              <View style={[styles.feedIcon, { backgroundColor: t.accentSoft }]}>
                <Ionicons name="document-text-outline" size={22} color={t.accent} />
              </View>
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0 }}>
                <Text style={styles.feedTitle} numberOfLines={1}>{outputTypeLabel(r.output_type) || tr('playerApp.home.newReport')}</Text>
                <Text style={styles.feedSub} numberOfLines={1}>{tr('playerApp.home.sharedTapToRead', { time: timeAgo(r.created_at) })}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.muted2} />
            </TouchableOpacity>
          ))}
        </>
      )}

      <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.home.yourDashboard')}</Text>

      <View style={styles.cardGrid}>
        <TouchableOpacity
          style={[styles.actionCard, { borderColor: t.positive }]}
          onPress={() => navigation.navigate('InboxTab' as any)}
        >
          <View style={[styles.cardIcon, { backgroundColor: t.positiveSoft }]}>
            <Ionicons name="mail" size={28} color={t.positive} />
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>{tr('playerApp.home.myReports')}</Text>
          <Text style={styles.cardDesc}>{tr('playerApp.home.myReportsDesc')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionCard, { borderColor: t.positive }]}
          onPress={() => navigation.navigate('TrainingTab' as any)}
        >
          <View style={[styles.cardIcon, { backgroundColor: t.positiveSoft }]}>
            <Ionicons name="barbell" size={28} color={t.positive} />
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>{tr('playerApp.home.myTraining')}</Text>
          <Text style={styles.cardDesc}>{tr('playerApp.home.myTrainingDesc')}</Text>
        </TouchableOpacity>
      </View>

      {playerUser?.player_id && profile && (
        <>
          <Text style={styles.sectionLabel} numberOfLines={1}>{tr('playerApp.home.myProfile')}</Text>
          <View style={styles.profileCard}>
            <View style={styles.profileCardHeader}>
              <Ionicons name="person-circle-outline" size={20} color={t.positive} />
              <Text style={styles.profileCardTitle} numberOfLines={1}>{tr('playerApp.home.athleticProfile')}</Text>
              <TouchableOpacity style={styles.editBtn} onPress={openEdit}>
                <Ionicons name="pencil-outline" size={15} color={t.positive} />
                <Text style={styles.editBtnText} numberOfLines={1}>{tr('playerApp.home.edit')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.profileStats}>
              <View style={styles.profileStat}>
                <Text style={styles.profileStatVal} numberOfLines={1}>{profile.position || '—'}</Text>
                <Text style={styles.profileStatLabel} numberOfLines={1}>{tr('playerApp.home.position')}</Text>
              </View>
              <View style={styles.profileStatDivider} />
              <View style={styles.profileStat}>
                <Text style={styles.profileStatVal} numberOfLines={1}>{profile.height || '—'}</Text>
                <Text style={styles.profileStatLabel} numberOfLines={1}>{tr('playerApp.home.height')}</Text>
              </View>
              <View style={styles.profileStatDivider} />
              <View style={styles.profileStat}>
                <Text style={styles.profileStatVal} numberOfLines={1}>{profile.wingspan || '—'}</Text>
                <Text style={styles.profileStatLabel} numberOfLines={1}>{tr('playerApp.home.wingspan')}</Text>
              </View>
            </View>
            <View style={[styles.profileStats, { marginTop: 10 }]}>
              <View style={styles.profileStat}>
                <Text style={styles.profileStatVal} numberOfLines={1}>{profile.weight || '—'}</Text>
                <Text style={styles.profileStatLabel} numberOfLines={1}>{tr('playerApp.home.weight')}</Text>
              </View>
              <View style={styles.profileStatDivider} />
              <View style={styles.profileStat}>
                <Text style={styles.profileStatVal} numberOfLines={1}>{profile.standing_reach || '—'}</Text>
                <Text style={styles.profileStatLabel} numberOfLines={1}>{tr('playerApp.home.standingReach')}</Text>
              </View>
            </View>
            {(profile.school_name || profile.city || profile.state || profile.country) && (
              <View style={styles.profileLocation}>
                {profile.school_name && (
                  <View style={styles.profileLocationRow}>
                    <Ionicons name="school-outline" size={13} color={t.muted} />
                    <Text style={styles.profileLocationText} numberOfLines={1}>{profile.school_name}</Text>
                  </View>
                )}
                {(profile.city || profile.state || profile.country) && (
                  <View style={styles.profileLocationRow}>
                    <Ionicons name="location-outline" size={13} color={t.muted} />
                    <Text style={styles.profileLocationText} numberOfLines={1}>
                      {[profile.city, profile.state, profile.country].filter(Boolean).join(', ')}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </>
      )}

      {/* BIM Score breakdown modal */}
      <Sheet visible={showBim} transparent animationType="slide" onRequestClose={() => setShowBim(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxHeight: '85%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>{tr('playerApp.home.bimScoreTitle', { score: bimScore != null ? bimScore.toFixed(1) : '' })}</Text>
              <TouchableOpacity onPress={() => setShowBim(false)}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.bimModalSub}>{tr('playerApp.home.bimModalSub')}</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              {pillarSource ? (
                PILLAR_ORDER.filter(k => pillarSource[k] != null).map(k => {
                  const g = Number(pillarSource[k]) || 0;
                  return (
                    <View key={k} style={styles.pbRow}>
                      <View style={styles.pbHead}>
                        <Text style={styles.pbLabel} numberOfLines={1}>{tr(`playerApp.home.pillars.${k}`, PILLAR_LABELS[k] ?? k)}</Text>
                        <Text style={styles.pbVal} numberOfLines={1}>{g.toFixed(1)}</Text>
                      </View>
                      <View style={styles.pbTrack}>
                        <View style={[styles.pbFill, { width: `${Math.min(100, (g / 10) * 100)}%` }]} />
                      </View>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.bimModalSub}>{tr('playerApp.home.noPillarBreakdown')}</Text>
              )}

              {flagSource?.green_flags?.length ? (
                <View style={{ marginTop: 18 }}>
                  <Text style={[styles.bimGroupLabel, { color: t.positive }]}>{tr('playerApp.home.strengths')}</Text>
                  {flagSource.green_flags.map((f: string, i: number) => (
                    <View key={i} style={styles.flagItem}>
                      <View style={[styles.flagDot, { backgroundColor: t.positive }]} />
                      <Text style={styles.flagText}>{f.replace(/\*\*/g, '').trim()}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {flagSource?.watch_flags?.length ? (
                <View style={{ marginTop: 16 }}>
                  <Text style={[styles.bimGroupLabel, { color: t.brown }]}>{tr('playerApp.home.watchAreas')}</Text>
                  {flagSource.watch_flags.map((f: string, i: number) => (
                    <View key={i} style={styles.flagItem}>
                      <View style={[styles.flagDot, { backgroundColor: t.brown }]} />
                      <Text style={styles.flagText}>{f.replace(/\*\*/g, '').trim()}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Sheet>

      <Sheet visible={showEditModal} transparent animationType="none" onRequestClose={() => setShowEditModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => { Keyboard.dismiss(); closeModal(); }}>
          <Animated.View
            style={[styles.modalBox, { transform: [{ translateY: slideY }] }]}
            {...swipePan.panHandlers}
          >
            <TouchableOpacity activeOpacity={1}>
              <View style={styles.dragHandle} />
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle} numberOfLines={1}>{tr('playerApp.home.editMyProfile')}</Text>
                <TouchableOpacity onPress={() => { Keyboard.dismiss(); closeModal(); }}>
                  <Ionicons name="close" size={22} color={t.muted} />
                </TouchableOpacity>
              </View>
              <KeyboardAwareScrollView
                ref={modalScrollRef}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 48 }}
              >
                {/* Link to Coach */}
                <Text style={styles.linkSectionLabel} numberOfLines={1}>{tr('playerApp.home.linkToCoach')}</Text>
                {isLinked ? (
                  <View style={styles.linkedRow}>
                    <Ionicons name="checkmark-circle" size={18} color={t.positive} />
                    <Text style={styles.linkedRowText} numberOfLines={1}>
                      {(playerUser as any)?.linked_program_name
                        ? tr('playerApp.home.linkedTo', { program: (playerUser as any).linked_program_name })
                        : tr('playerApp.home.linked')}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.linkHint}>{tr('playerApp.home.enterInviteCodeHint')}</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <VoiceTextInput
                        style={[styles.input, { flex: 1 }]}
                        value={inviteCode}
                        onChangeText={setInviteCode}
                        placeholder={tr('playerApp.home.inviteCodePlaceholder')}
                        placeholderTextColor={t.muted2}
                        autoCapitalize="characters"
                      />
                      <TouchableOpacity
                        style={[styles.linkBtn, (!inviteCode.trim() || linking) && { opacity: 0.5 }]}
                        onPress={linkWithInvite}
                        disabled={!inviteCode.trim() || linking}
                      >
                        <Text style={styles.linkBtnText} numberOfLines={1}>{linking ? '…' : tr('playerApp.home.link')}</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={() => { closeModal(); navigation.navigate('ProfileTab' as any); }}>
                      <Text style={styles.findCoachText}>{tr('playerApp.home.findYourCoachInstead')}</Text>
                    </TouchableOpacity>
                  </>
                )}
                <View style={styles.linkDivider} />

                <View onLayout={e => { fieldY.current['position'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.home.position')}</Text>
                  <VoiceTextInput style={styles.input} value={editPosition} onChangeText={setEditPosition}
                    placeholder={tr('playerApp.home.phPosition')} placeholderTextColor={t.muted2}
                    returnKeyType="next" />
                </View>
                <View onLayout={e => { fieldY.current['height'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.home.height')}</Text>
                  <VoiceTextInput style={styles.input} value={editHeight} onChangeText={setEditHeight}
                    placeholder={tr('playerApp.home.phHeight')} placeholderTextColor={t.muted2}
                    returnKeyType="next" />
                </View>
                <View onLayout={e => { fieldY.current['wingspan'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.home.wingspan')}</Text>
                  <VoiceTextInput style={styles.input} value={editWingspan} onChangeText={setEditWingspan}
                    placeholder={tr('playerApp.home.phWingspan')} placeholderTextColor={t.muted2}
                    returnKeyType="next" />
                </View>
                <View onLayout={e => { fieldY.current['weight'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.home.weight')}</Text>
                  <VoiceTextInput style={styles.input} value={editWeight} onChangeText={setEditWeight}
                    placeholder={tr('playerApp.home.phWeight')} placeholderTextColor={t.muted2}
                    returnKeyType="next" />
                </View>
                <View onLayout={e => { fieldY.current['standing_reach'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.home.standingReach')}</Text>
                  <VoiceTextInput style={styles.input} value={editStandingReach} onChangeText={setEditStandingReach}
                    placeholder={tr('playerApp.home.phStandingReach')} placeholderTextColor={t.muted2}
                    returnKeyType="next" />
                </View>
                <View onLayout={e => { fieldY.current['school'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.home.school')}</Text>
                  <VoiceTextInput style={styles.input} value={editSchool} onChangeText={setEditSchool}
                    placeholder={tr('playerApp.home.phSchool')} placeholderTextColor={t.muted2}
                    returnKeyType="next" />
                </View>
                <View onLayout={e => { fieldY.current['city'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.home.city')}</Text>
                  <VoiceTextInput style={styles.input} value={editCity} onChangeText={setEditCity}
                    placeholder={tr('playerApp.home.phCity')} placeholderTextColor={t.muted2}
                    returnKeyType="next" />
                </View>
                <View onLayout={e => { fieldY.current['state'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.home.state')}</Text>
                  <VoiceTextInput style={styles.input} value={editState} onChangeText={setEditState}
                    placeholder={tr('playerApp.home.phState')} placeholderTextColor={t.muted2}
                    returnKeyType="next" />
                </View>
                <View onLayout={e => { fieldY.current['country'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel} numberOfLines={1}>{tr('playerApp.home.country')}</Text>
                  <VoiceTextInput style={styles.input} value={editCountry} onChangeText={setEditCountry}
                    placeholder={tr('playerApp.home.phCountry')} placeholderTextColor={t.muted2}
                    returnKeyType="done" />
                </View>
                <TouchableOpacity
                  style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                  onPress={saveProfile}
                  disabled={saving}
                >
                  <Text style={styles.saveBtnText} numberOfLines={1}>{saving ? tr('playerApp.home.saving') : tr('playerApp.home.saveChanges')}</Text>
                </TouchableOpacity>
              </KeyboardAwareScrollView>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Sheet>
    </ScrollView>
    </PageContainer>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  header: { padding: 24, paddingTop: topPad(60), marginBottom: 4 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { fontSize: 32, fontFamily: fonts[900], color: t.ink, letterSpacing: 0.5 },
  sub: { fontSize: 13, color: t.positive, marginTop: 2, fontFamily: fonts[600] },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, flexShrink: 0 },
  notifBtn: { position: 'relative', padding: 4 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: t.negative,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontFamily: fonts[800] },
  signOutBtn: { padding: 4 },
  playerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  playerText: { color: t.inkSoft, fontSize: 13 },
  linkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.positiveSoft,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 6,
    flexShrink: 1,
    maxWidth: '100%',
  },
  linkedText: { color: t.positive, fontSize: 11, fontFamily: fonts[600], flexShrink: 1 },
  programBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  programText: { color: t.muted, fontSize: 12 },
  eyebrow: { color: t.label, fontSize: 12, fontFamily: fonts[600], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 },
  greeting: { color: t.ink, fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6, lineHeight: 32 },
  greetingSub: { color: t.muted, fontSize: 14, marginTop: 8 },
  circleBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, position: 'relative', flexShrink: 0,
  },
  bimCard: {
    backgroundColor: t.card, borderRadius: 22, padding: 20, marginHorizontal: 20, marginTop: 22,
    borderWidth: 1, borderColor: t.cardBorder,
  },
  bimTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bimCardLabel: { color: t.muted2, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 1.6, textTransform: 'uppercase', flexShrink: 1, marginRight: 8 },
  trendPill: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, flexShrink: 0 },
  trendText: { fontSize: 11, fontFamily: fonts[800] },
  bimScoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 8 },
  bimScore: { color: t.ink, fontSize: 46, fontFamily: fonts[900], letterSpacing: -1, lineHeight: 48, flexShrink: 0 },
  bimOf: { color: t.muted, fontSize: 15, fontFamily: fonts[600], flexShrink: 1 },
  pillarBar: { flexDirection: 'row', gap: 5, marginTop: 18, height: 7 },
  pillarLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  pillarLabelText: { color: t.muted, fontSize: 11, fontFamily: fonts[600], flexShrink: 1, marginRight: 4 },
  feedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    backgroundColor: t.card, borderRadius: 18, padding: 16, marginHorizontal: 20, marginBottom: 11,
    borderWidth: 1, borderColor: t.cardBorder,
  },
  feedIcon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  feedTitle: { color: t.ink, fontSize: 16.5, fontFamily: fonts[800] },
  feedSub: { color: t.muted, fontSize: 13, marginTop: 2 },
  sectionLabel: {
    color: t.label,
    fontSize: 11,
    fontFamily: fonts[700],
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 12,
  },
  cardGrid: { flexDirection: 'row', gap: 12, paddingHorizontal: 20 },
  actionCard: {
    flex: 1,
    backgroundColor: t.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  cardTitle: { color: t.ink, fontSize: 15, fontFamily: fonts[800], marginBottom: 4, flexShrink: 1 },
  cardDesc: { color: t.muted, fontSize: 11, lineHeight: 16 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  linkTitle: { color: t.ink, fontSize: 14, fontFamily: fonts[600] },
  linkDesc: { color: t.muted, fontSize: 12, marginTop: 2 },
  profileCard: {
    backgroundColor: t.card,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  profileCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  profileCardTitle: { color: t.ink, fontSize: 14, fontFamily: fonts[700], flex: 1, flexShrink: 1, minWidth: 0 },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.positiveSoft,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexShrink: 0,
  },
  editBtnText: { color: t.positive, fontSize: 12, fontFamily: fonts[600] },
  profileStats: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  profileStat: { flex: 1, flexShrink: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 4 },
  profileStatVal: { color: t.ink, fontSize: 18, fontFamily: fonts[800] },
  profileStatLabel: { color: t.muted, fontSize: 11, marginTop: 2 },
  profileStatDivider: { width: 1, height: 36, backgroundColor: t.divider, flexShrink: 0 },
  profileLocation: { marginTop: 12, gap: 5, borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 12 },
  profileLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  profileLocationText: { color: t.muted, fontSize: 12, flexShrink: 1 },
  modalOverlay: {
    flex: 1,
    backgroundColor: t.scrim,
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: t.sheet,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '85%', ...sheetCap(560)},
  dragHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: t.line, alignSelf: 'center', marginBottom: 16,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { color: t.ink, fontSize: 17, fontFamily: fonts[800], flexShrink: 1, minWidth: 0, marginRight: 10 },
  fieldLabel: { color: t.muted, fontSize: 12, fontFamily: fonts[600], marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: t.chip,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.line,
    color: t.ink,
    fontSize: 15,
    padding: 12,
  },
  saveBtn: {
    backgroundColor: t.positive,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontFamily: fonts[800] },

  statusRow: { flexDirection: 'row', marginTop: 12 },
  notLinkedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: t.chip, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, flexShrink: 1,
  },
  notLinkedText: { color: t.muted, fontSize: 11.5, fontFamily: fonts[600], flexShrink: 1 },
  bimHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginTop: 16 },
  bimHintText: { color: t.muted2, fontSize: 12, fontFamily: fonts[600] },

  bimModalSub: { color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  pbRow: { marginBottom: 14 },
  pbHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  pbLabel: { color: t.ink, fontSize: 14, fontFamily: fonts[700], flexShrink: 1, minWidth: 0, marginRight: 10 },
  pbVal: { color: t.inkSoft, fontSize: 14, fontFamily: fonts[800], flexShrink: 0 },
  pbTrack: { height: 8, borderRadius: 4, backgroundColor: t.chip, overflow: 'hidden' },
  pbFill: { height: 8, borderRadius: 4, backgroundColor: t.accent },
  bimGroupLabel: { fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 },
  flagItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  flagDot: { width: 9, height: 9, borderRadius: 5, marginTop: 5, flexShrink: 0 },
  flagText: { color: t.inkSoft, fontSize: 13.5, lineHeight: 20, flex: 1 },

  linkSectionLabel: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 },
  linkHint: { color: t.muted, fontSize: 12.5, lineHeight: 18, marginBottom: 10 },
  linkedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.positiveSoft, borderRadius: 10, padding: 12 },
  linkedRowText: { color: t.positive, fontSize: 14, fontFamily: fonts[700], flexShrink: 1 },
  linkBtn: { backgroundColor: t.positive, borderRadius: 10, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  linkBtnText: { color: '#fff', fontSize: 14, fontFamily: fonts[800] },
  findCoachText: { color: t.label, fontSize: 13, fontFamily: fonts[700], marginTop: 12 },
  linkDivider: { height: 1, backgroundColor: t.divider, marginVertical: 18 },
});
