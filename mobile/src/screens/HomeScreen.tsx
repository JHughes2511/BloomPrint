import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '../context/AuthContext';
import { playerAPI, feedbackAPI } from '../api/client';
// Read straight from app.json rather than pulling in expo-application just to
// stamp a version on a feedback row.
const APP_VERSION: string | undefined = require('../../app.json')?.expo?.version;
import { useTheme } from '../theme/ThemeProvider';
import { ScreenBackground, SectionLabel, Card, IconTile, Txt } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import { useBreakpoint } from '../responsive/useBreakpoint';
import { Icon, IconName } from '../theme/icons';
import { fonts, type as typeScale } from '../theme/typography';
import { GeneratingOverlay } from '../components/GeneratingBasketball';
import { COMPETITION_LEVELS as CANON_LEVELS } from '../constants/levels';
import CommandBar from '../components/CommandBar';
import CountryField from '../components/CountryField';
import LanguagePicker from '../components/LanguagePicker';
import VoiceTextInput from '../components/VoiceTextInput';

// Which bottom tab each report type routes to when tapped on the Home page.
//   RosterTab   = Roster      TeamTab = Team Eval      TeamEvalTab = Team Grade
const REPORT_TYPE_TAB: Record<string, string> = {
  player_eval: 'RosterTab',
  training_program: 'RosterTab',
  position_analysis: 'RosterTab',
  scouting_report: 'RosterTab',
  recruitment_profile: 'RosterTab',
  film_breakdown: 'TeamTab',
  coaching_report: 'TeamTab',
  game_analysis: 'TeamTab',
  box_score: 'TeamEvalTab',
};

// Program system & philosophy — matches the backend coach_context field keys.
// Labels/placeholders come from the `home.systemFields.*` translation keys.
const SYSTEM_FIELDS: { key: string }[] = [
  { key: 'offensive_system' },
  { key: 'defensive_system' },
  { key: 'archetypes' },
  { key: 'development' },
  { key: 'recruiting' },
  { key: 'culture' },
];

// Labels/descs come from the `home.reportTypes.*` translation keys.
const REPORT_TYPES: { key: string; icon: IconName }[] = [
  { key: 'player_eval', icon: 'user' },
  { key: 'film_breakdown', icon: 'film' },
  { key: 'scouting_report', icon: 'search' },
  { key: 'coaching_report', icon: 'clipboard' },
  { key: 'game_analysis', icon: 'bar-chart-3' },
  { key: 'training_program', icon: 'dumbbell' },
  { key: 'recruitment_profile', icon: 'award' },
  { key: 'position_analysis', icon: 'map-pin' },
  { key: 'box_score', icon: 'list' },
];

// Labels/descs come from the `home.pillars.*` translation keys.
const PILLARS: { key: string; icon: IconName }[] = [
  { key: 'offensive_skills', icon: 'target' },
  { key: 'defensive_capabilities', icon: 'shield' },
  { key: 'physical_attributes', icon: 'dumbbell' },
  { key: 'intangibles', icon: 'brain' },
  { key: 'advanced_analysis', icon: 'activity' },
  { key: 'strategic_fit', icon: 'crosshair' },
];

const ROLES = ['coach', 'scout', 'trainer'];

export default function HomeScreen() {
  const { coach, logout, updateProfile, importPhilosophy } = useAuth();
  const navigation = useNavigation<any>();
  const { t, mode, toggle } = useTheme();
  const { t: tr } = useTranslation();
  const [unreadCount, setUnreadCount] = useState(0);
  // On desktop these same four controls live in the sidebar, permanently. Two
  // copies of the theme toggle on one screen is worse than none.
  const { isDesktop } = useBreakpoint();

  // Profile edit modal
  const [showProfile, setShowProfile] = useState(false);
  const [pName, setPName] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pProgram, setPProgram] = useState('');
  const [pLevel, setPLevel] = useState('HS Varsity');
  const [showLevelDD, setShowLevelDD] = useState(false);
  const [pRole, setPRole] = useState('coach');
  const [pCountry, setPCountry] = useState('');
  const [pCity, setPCity] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // System & philosophy profile
  const [showSystem, setShowSystem] = useState(false);
  const [sys, setSys] = useState<Record<string, string>>({});
  const [savingSystem, setSavingSystem] = useState(false);
  const [importingPhilosophy, setImportingPhilosophy] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const submitFeedback = async () => {
    const text = feedbackText.trim();
    if (!text) return;
    setSubmittingFeedback(true);
    try {
      await feedbackAPI.submit({
        text,
        screen: 'Home',
        platform: Platform.OS,
        app_version: APP_VERSION,
      });
      Alert.alert(tr('home.feedbackThanksTitle'), tr('home.feedbackThanksMsg'));
      setFeedbackText('');
      setShowFeedback(false);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('home.feedbackSubmitError'));
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const importPhilosophyDoc = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const form = new FormData();
      form.append('file', {
        uri: a.uri,
        name: a.name ?? 'philosophy',
        type: a.mimeType ?? 'application/octet-stream',
      } as any);
      setImportingPhilosophy(true);
      const updated = await importPhilosophy(form);
      setSys({ ...(updated.system_profile ?? {}) });
      Alert.alert(tr('home.importedTitle'), tr('home.importedMsg'));
    } catch (e: any) {
      Alert.alert(tr('home.importFailedTitle'), e?.response?.data?.detail ?? tr('home.importFailedMsg'));
    } finally {
      setImportingPhilosophy(false);
    }
  };

  const openProfile = () => {
    setPName(coach?.name ?? '');
    setPEmail(coach?.email ?? '');
    setPProgram(coach?.program_name ?? '');
    setPLevel((coach as any)?.competition_level ?? 'HS Varsity');
    setPRole(coach?.role ?? 'coach');
    setPCountry(coach?.country ?? '');
    setPCity(coach?.city ?? '');
    setShowProfile(true);
  };

  const openSystem = () => {
    setSys({ ...(coach?.system_profile ?? {}) });
    setShowProfile(false);
    setShowSystem(true);
  };

  // Deep link from Ask BloomPrint: open the exact modal it promised.
  const route = useRoute<any>();
  useFocusEffect(useCallback(() => {
    const p = route?.params ?? {};
    if (!p.openEditProfile && !p.openFeedback) return;
    if (p.openEditProfile) openProfile();
    if (p.openFeedback) setShowFeedback(true);
    navigation?.setParams?.({ openEditProfile: undefined, openFeedback: undefined });
  }, [route?.params?.openEditProfile, route?.params?.openFeedback]));

  const saveSystem = async () => {
    setSavingSystem(true);
    try {
      await updateProfile({ system_profile: sys });
      setShowSystem(false);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('home.saveSystemError'));
    } finally {
      setSavingSystem(false);
    }
  };

  const saveProfile = async () => {
    if (!pName.trim()) { Alert.alert(tr('home.nameRequiredTitle'), tr('home.nameRequiredMsg')); return; }
    const email = pEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert(tr('home.invalidEmailTitle'), tr('home.invalidEmailMsg')); return;
    }
    setSavingProfile(true);
    try {
      await updateProfile({ name: pName.trim(), email: email || undefined, program_name: pProgram.trim(), competition_level: pLevel, role: pRole, country: pCountry || undefined, city: pCity.trim() || undefined });
      setShowProfile(false);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('home.updateProfileError'));
    } finally {
      setSavingProfile(false);
    }
  };

  useFocusEffect(useCallback(() => {
    playerAPI.coachNotifications().then((notifs: any[]) => {
      setUnreadCount(notifs.filter((n: any) => !n.read).length);
    }).catch(() => {});
  }, []));

  const handleSignOut = () => {
    Alert.alert(tr('home.signOut'), tr('home.signOutConfirm'), [
      { text: tr('common.cancel'), style: 'cancel' },
      { text: tr('home.signOut'), style: 'destructive', onPress: logout },
    ]);
  };

  // Display label for a role key ('coach' | 'scout' | 'trainer').
  const roleLabel = (r?: string | null) =>
    r === 'scout' ? tr('auth.roleScout') : r === 'trainer' ? tr('auth.roleTrainer') : tr('auth.roleCoach');

  const CircleBtn = ({ icon, onPress, badge, label }: { icon: IconName; onPress: () => void; badge?: number; label: string }) => (
    <TouchableOpacity
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
        backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, flexShrink: 0,
      }}
    >
      <Icon name={icon} size={18} color={t.inkSoft} strokeWidth={2} />
      {badge ? (
        <View style={[styles.notifBadge, { backgroundColor: t.negative }]}>
          <Text style={styles.notifBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <ScreenBackground>
    <PageContainer>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            {/* Translated labels run 20-40% longer than English. Keep the SAME
                type size as English and let the text wrap onto a second line —
                shrinking the font made translated screens look inconsistent. */}
            <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
              <Text style={[typeScale.label, { color: t.label, marginBottom: 4 }]} numberOfLines={2}>{tr('home.intelligenceModel')}</Text>
              <Text style={[typeScale.h1, { color: t.ink }]} numberOfLines={1}>BloomPrint</Text>
            </View>
            {!isDesktop && (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <CircleBtn icon={mode === 'dark' ? 'sun' : 'moon'} onPress={toggle} label={tr('home.toggleTheme')} />
                <CircleBtn icon="user" onPress={openProfile} label={tr('home.editProfileLabel')} />
                <CircleBtn icon="mail" onPress={() => navigation.navigate('StaffInbox')} label={tr('home.staffInboxLabel')} />
                <CircleBtn icon="bell" onPress={() => navigation.navigate('CoachNotifications')} badge={unreadCount} label={tr('home.notificationsLabel')} />
              </View>
            )}
          </View>
          {/* Coach line + AI command pill on one row */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
            {/* Coach · role · program: keep English's type size and allow a
                second line, rather than shrinking the text to fit one. */}
            <Text
              style={[typeScale.bodySoft, { color: t.muted, flex: 1, flexShrink: 1, minWidth: 0 }]}
              numberOfLines={2}
            >
              {coach ? `${coach.name} · ${roleLabel(coach.role)} · ${coach.program_name}` : ''}
            </Text>
            {!isDesktop && <CommandBar />}
          </View>
        </View>

        {/* Report Types */}
        <View style={{ paddingHorizontal: 22, marginTop: 22 }}>
          <SectionLabel>{tr('home.reportTypesHeader')}</SectionLabel>
          <View style={styles.grid}>
            {REPORT_TYPES.map(rt => (
              <TouchableOpacity
                key={rt.key}
                style={{ width: '48%' }}
                activeOpacity={0.7}
                onPress={() => {
                  const tab = REPORT_TYPE_TAB[rt.key];
                  if (tab) navigation.navigate(tab as never);
                }}
              >
                <Card padding={16} style={{ flex: 1 }}>
                  <IconTile name={rt.icon} variant="accent" size={44} />
                  <Text style={[typeScale.sectionTitle, { color: t.ink, fontSize: 15.5, marginTop: 12 }]}>{tr(`home.reportTypes.${rt.key}.label`)}</Text>
                  <Text style={[typeScale.bodySoft, { color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 4 }]}>{tr(`home.reportTypes.${rt.key}.desc`)}</Text>
                </Card>
              </TouchableOpacity>
            ))}
            {/* Feedback — styled to stand out from the report tiles (accent tint
                + border), while still fitting light/dark themes. */}
            <TouchableOpacity
              key="feedback"
              style={{ width: '48%' }}
              activeOpacity={0.7}
              onPress={() => setShowFeedback(true)}
            >
              <View style={{ flex: 1, borderRadius: 18, borderWidth: 1.5, borderColor: t.accent, backgroundColor: t.accentSoft, padding: 16 }}>
                <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="message-square" size={22} color={t.ctaText} strokeWidth={2} />
                </View>
                <Text style={[typeScale.sectionTitle, { color: t.ink, fontSize: 15.5, marginTop: 12 }]}>{tr('home.feedbackTitle')}</Text>
                <Text style={[typeScale.bodySoft, { color: t.inkSoft, fontSize: 12, lineHeight: 17, marginTop: 4 }]}>{tr('home.feedbackTileDesc')}</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* 6 Pillars */}
        <View style={{ paddingHorizontal: 22, marginTop: 26 }}>
          <SectionLabel>{tr('home.sixPillarsHeader')}</SectionLabel>
          <Card padding={6}>
            {PILLARS.map((p, i) => (
              <View key={p.key}>
                <View style={styles.pillarRow}>
                  <IconTile name={p.icon} variant="accent" size={44} />
                  <View style={{ flex: 1, flexShrink: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: fonts[700], fontSize: 14.5, color: t.ink }} numberOfLines={1}>{tr(`home.pillars.${p.key}.label`)}</Text>
                    <Text style={[typeScale.bodySoft, { color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 2 }]}>{tr(`home.pillars.${p.key}.desc`)}</Text>
                  </View>
                </View>
                {i < PILLARS.length - 1 && <View style={{ height: 1, backgroundColor: t.divider, marginLeft: 12 }} />}
              </View>
            ))}
          </Card>
        </View>
      </ScrollView>

      {/* Feedback modal */}
      <Modal visible={showFeedback} transparent animationType="slide" onRequestClose={() => setShowFeedback(false)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: t.cardBorder, padding: 24, paddingBottom: 36, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={[typeScale.sectionTitle, { color: t.ink, fontSize: 20, flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }]} numberOfLines={1}>{tr('home.feedbackTitle')}</Text>
              <TouchableOpacity onPress={() => setShowFeedback(false)} style={{ flexShrink: 0 }}>
                <Icon name="x" size={22} color={t.muted} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
              {tr('home.feedbackIntro')}
            </Text>
            <VoiceTextInput
              style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line, minHeight: 120 }}
              value={feedbackText} onChangeText={setFeedbackText}
              placeholder={tr('home.feedbackPlaceholder')} placeholderTextColor={t.muted2}
              multiline textAlignVertical="top"
            />
            <TouchableOpacity
              style={{ marginTop: 16, backgroundColor: t.ctaBg, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: (!feedbackText.trim() || submittingFeedback) ? 0.5 : 1 }}
              onPress={submitFeedback}
              disabled={!feedbackText.trim() || submittingFeedback}
            >
              {submittingFeedback
                ? <ActivityIndicator color={t.ctaText} size="small" />
                : <><Icon name="send" size={16} color={t.ctaText} strokeWidth={2} /><Text style={{ color: t.ctaText, fontFamily: fonts[700], fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{tr('home.submit')}</Text></>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Profile edit modal */}
      <Modal visible={showProfile} transparent animationType="slide" onRequestClose={() => setShowProfile(false)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: t.cardBorder, maxHeight: '90%', width: '100%', maxWidth: 560, alignSelf: 'center' }}>
            <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 36 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <Text style={[typeScale.sectionTitle, { color: t.ink, fontSize: 20, flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }]} numberOfLines={1}>{tr('home.editProfileTitle')}</Text>
              <TouchableOpacity onPress={() => setShowProfile(false)} style={{ flexShrink: 0 }}>
                <Icon name="x" size={22} color={t.muted} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8 }]}>{tr('home.name')}</Text>
            <TextInput
              style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line }}
              value={pName} onChangeText={setPName}
              placeholder={tr('home.namePlaceholder')} placeholderTextColor={t.muted2}
            />

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8, marginTop: 16 }]}>{tr('auth.email')}</Text>
            <TextInput
              style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line }}
              value={pEmail} onChangeText={setPEmail}
              placeholder={tr('home.emailPlaceholder')} placeholderTextColor={t.muted2}
              autoCapitalize="none" keyboardType="email-address"
            />
            <Text style={{ color: t.muted2, fontSize: 11, marginTop: 4 }}>{tr('home.emailHint')}</Text>

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8, marginTop: 16 }]}>{tr('home.role')}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {ROLES.map(r => (
                <TouchableOpacity
                  key={r}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, alignItems: 'center', borderColor: pRole === r ? t.ctaBg : t.line, backgroundColor: pRole === r ? t.ctaBg : 'transparent' }}
                  onPress={() => setPRole(r)}
                >
                  <Text
                    style={{ color: pRole === r ? t.ctaText : t.muted, fontFamily: fonts[700], fontSize: 14, flexShrink: 1 }}
                    numberOfLines={1}
                  >
                    {roleLabel(r)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8, marginTop: 16 }]}>{tr('home.appLanguage')}</Text>
            <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 8 }}>
              {tr('home.appLanguageHint')}
            </Text>
            <View style={{ alignItems: 'flex-start' }}>
              <LanguagePicker onChanged={(code) => { updateProfile({ preferred_language: code } as any).catch(() => {}); }} />
            </View>

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8, marginTop: 16 }]}>{tr('home.programOrganization')}</Text>
            <TextInput
              style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line }}
              value={pProgram} onChangeText={setPProgram}
              placeholder={tr('home.programNamePlaceholder')} placeholderTextColor={t.muted2}
            />

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8, marginTop: 16 }]}>{tr('auth.competitionLevel')}</Text>
            <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 8 }}>
              {tr('home.competitionLevelHint')}
            </Text>
            <TouchableOpacity
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: t.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.line }}
              onPress={() => setShowLevelDD(v => !v)}
              activeOpacity={0.7}
            >
              <Text style={{ color: t.ink, fontSize: 15, flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }} numberOfLines={1}>{pLevel}</Text>
              <Icon name={showLevelDD ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} strokeWidth={2} />
            </TouchableOpacity>
            {showLevelDD && (
              <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, marginTop: 6, overflow: 'hidden' }}>
                {CANON_LEVELS.map((lvl, i) => (
                  <TouchableOpacity
                    key={lvl}
                    onPress={() => { setPLevel(lvl); setShowLevelDD(false); }}
                    style={{ padding: 13, backgroundColor: pLevel === lvl ? t.accentSoft : 'transparent',
                      borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.chip }}
                  >
                    <Text style={{ color: pLevel === lvl ? t.accent : t.inkSoft, fontSize: 14, fontFamily: pLevel === lvl ? fonts[700] : fonts[400] }}>{lvl}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8, marginTop: 16 }]}>{tr('auth.location')}</Text>
            <CountryField value={pCountry} onChange={setPCountry} />
            <TextInput
              style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line }}
              value={pCity} onChangeText={setPCity}
              placeholder={tr('auth.cityRegionOptional')} placeholderTextColor={t.muted2}
            />

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.card, borderRadius: 12, padding: 14, marginTop: 16, borderWidth: 1, borderColor: t.line }}
              onPress={openSystem}
            >
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                <Text style={{ color: t.ink, fontFamily: fonts[700], fontSize: 14 }} numberOfLines={1}>{tr('home.systemPhilosophyRowTitle')}</Text>
                <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{tr('home.systemPhilosophyRowDesc')}</Text>
              </View>
              <Icon name="chevron-right" size={18} color={t.muted} strokeWidth={2} />
            </TouchableOpacity>

            <TouchableOpacity
              style={{ backgroundColor: t.ctaBg, borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 20 }}
              onPress={saveProfile} disabled={savingProfile}
            >
              {savingProfile
                ? <ActivityIndicator color={t.ctaText} />
                : <Text style={{ color: t.ctaText, fontFamily: fonts[800], fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{tr('home.saveChanges')}</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: t.negative }}
              onPress={() => { setShowProfile(false); handleSignOut(); }}
            >
              <Icon name="log-out" size={16} color={t.negative} strokeWidth={2} />
              <Text style={{ color: t.negative, fontFamily: fonts[700], fontSize: 14, flexShrink: 1 }} numberOfLines={1}>{tr('home.signOut')}</Text>
            </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Program System & Philosophy modal */}
      <Modal visible={showSystem} transparent animationType="slide" onRequestClose={() => setShowSystem(false)}>
        <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, flex: 1, marginTop: 50, borderWidth: 1, borderColor: t.cardBorder, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 8 }}>
              <Text style={[typeScale.sectionTitle, { color: t.ink, fontSize: 19, flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }]} numberOfLines={1}>{tr('home.systemModalTitle')}</Text>
              <TouchableOpacity onPress={() => setShowSystem(false)} style={{ flexShrink: 0 }}>
                <Icon name="x" size={22} color={t.muted} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
                {tr('home.systemIntro')}
              </Text>

              {/* Import philosophy document */}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.accentSoft, borderRadius: 12, padding: 13, marginBottom: 8 }}
                onPress={importPhilosophyDoc}
                disabled={importingPhilosophy}
              >
                <Icon name="upload" size={16} color={t.accent} strokeWidth={2} />
                <Text style={{ color: t.accent, fontFamily: fonts[700], fontSize: 12.5, flex: 1 }}>
                  {tr('home.importPhilosophyBtn')}
                </Text>
              </TouchableOpacity>
              <Text style={{ color: t.muted2, fontSize: 11.5, lineHeight: 16, marginBottom: 10 }}>
                {tr('home.importPhilosophyHint')}
              </Text>
              {!!coach?.philosophy_reference && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                  <Icon name="check-circle" size={14} color={t.positive} strokeWidth={2} />
                  <Text style={{ color: t.positive, fontSize: 12, fontFamily: fonts[600] }}>
                    {tr('home.referenceOnFile')}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.chip, borderRadius: 12, padding: 13, marginBottom: 14, borderWidth: 1, borderColor: t.line }}
                onPress={() => { setShowSystem(false); navigation.navigate('Onboarding'); }}
              >
                <Icon name="list" size={16} color={t.ink} strokeWidth={2} />
                <Text style={{ color: t.ink, fontFamily: fonts[700], fontSize: 12.5, flex: 1, flexShrink: 1, minWidth: 0 }} numberOfLines={2}>
                  {tr('home.rerunGuidedSetup')}
                </Text>
                <Icon name="chevron-right" size={16} color={t.muted} strokeWidth={2} />
              </TouchableOpacity>
              <GeneratingOverlay visible={importingPhilosophy} label={tr('home.readingPhilosophy')} />

              {SYSTEM_FIELDS.map(f => (
                <View key={f.key} style={{ marginBottom: 16 }}>
                  <Text style={[typeScale.label, { color: t.label, marginBottom: 6 }]}>{tr(`home.systemFields.${f.key}.label`)}</Text>
                  <TextInput
                    style={{ backgroundColor: t.card, borderRadius: 12, padding: 13, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 76, textAlignVertical: 'top' }}
                    value={sys[f.key] ?? ''}
                    onChangeText={txt => setSys(prev => ({ ...prev, [f.key]: txt }))}
                    placeholder={tr(`home.systemFields.${f.key}.placeholder`)} placeholderTextColor={t.muted2}
                    multiline
                  />
                </View>
              ))}
              <TouchableOpacity
                style={{ backgroundColor: t.ctaBg, borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 4 }}
                onPress={saveSystem} disabled={savingSystem}
              >
                {savingSystem
                  ? <ActivityIndicator color={t.ctaText} />
                  : <Text style={{ color: t.ctaText, fontFamily: fonts[800], fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{tr('home.savePhilosophy')}</Text>}
              </TouchableOpacity>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>
    </PageContainer>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 22, paddingTop: 64 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  notifBadge: {
    position: 'absolute', top: 2, right: 2, borderRadius: 7, minWidth: 14, height: 14,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2,
  },
  notifBadgeText: { color: '#fff', fontSize: 8, fontFamily: fonts[800] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  pillarRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 12 },
});
