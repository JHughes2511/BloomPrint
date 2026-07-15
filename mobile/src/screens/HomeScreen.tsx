import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Modal, TextInput, ActivityIndicator } from 'react-native';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '../context/AuthContext';
import { playerAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ScreenBackground, SectionLabel, Card, IconTile, Txt } from '../theme/components';
import { Icon, IconName } from '../theme/icons';
import { fonts, type as typeScale } from '../theme/typography';
import { GeneratingOverlay } from '../components/GeneratingBasketball';
import { COMPETITION_LEVELS as CANON_LEVELS } from '../constants/levels';
import CommandBar from '../components/CommandBar';
import CountryField from '../components/CountryField';

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
const SYSTEM_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'offensive_system', label: 'Offensive System', placeholder: 'Pace, spacing, primary actions (motion, ball-screen heavy, Princeton…), who initiates.' },
  { key: 'defensive_system', label: 'Defensive System', placeholder: 'Man / zone / switch-everything / drop / press, physicality, rotations.' },
  { key: 'archetypes', label: 'Player Archetypes You Value', placeholder: 'What you recruit/develop for — 3&D wings, positionless bigs, rim protection, secondary creators…' },
  { key: 'development', label: 'Development / Training Philosophy', placeholder: 'Skill priorities, how you build players, load approach.' },
  { key: 'recruiting', label: 'Recruiting Lens', placeholder: 'Level, timeline, the swing skills that change your evaluation.' },
  { key: 'culture', label: 'Culture / Non-Negotiables', placeholder: 'The intangibles and standards you weight heavily.' },
];

const REPORT_TYPES: { key: string; label: string; icon: IconName; desc: string }[] = [
  { key: 'player_eval', label: 'Player Eval', icon: 'user', desc: 'Individual BIM evaluation scored across all 6 pillars' },
  { key: 'film_breakdown', label: 'Film Breakdown', icon: 'film', desc: 'Frame-by-frame film analysis of technique and decisions' },
  { key: 'scouting_report', label: 'Scouting Report', icon: 'search', desc: 'Recruitment-grade scouting report for a target player' },
  { key: 'coaching_report', label: 'Coaching Report', icon: 'clipboard', desc: 'Coach-facing breakdown with practice and scheme focus' },
  { key: 'game_analysis', label: 'Game Analysis', icon: 'bar-chart-3', desc: 'Full game film analysis covering both sides of the ball' },
  { key: 'training_program', label: 'Training Program', icon: 'dumbbell', desc: 'Personalized skill development program from eval data' },
  { key: 'recruitment_profile', label: 'Recruitment', icon: 'award', desc: 'Next-level recruitment profile and college projection' },
  { key: 'position_analysis', label: 'Position Analysis', icon: 'map-pin', desc: 'Position-specific role fit and skill translation analysis' },
  { key: 'box_score', label: 'Box Score', icon: 'list', desc: 'Game and season box score stats imported and analyzed by BIM' },
];

const PILLARS: { key: string; label: string; icon: IconName; desc: string }[] = [
  { key: 'offensive_skills', label: 'Offensive Skills', icon: 'target', desc: 'Scoring, creation, shooting mechanics, footwork, P&R' },
  { key: 'defensive_capabilities', label: 'Defense', icon: 'shield', desc: 'On-ball defense, help-side, IQ, communication, rotations' },
  { key: 'physical_attributes', label: 'Physical', icon: 'dumbbell', desc: 'Athleticism, size, length, speed, strength, explosiveness' },
  { key: 'intangibles', label: 'Intangibles', icon: 'brain', desc: 'IQ, coachability, leadership, motor, competitive drive' },
  { key: 'advanced_analysis', label: 'Advanced', icon: 'activity', desc: 'Shot selection, efficiency metrics, tendencies, adjustments' },
  { key: 'strategic_fit', label: 'Strategic Fit', icon: 'crosshair', desc: 'System fit, positional versatility, lineup compatibility' },
];

const ROLES = ['coach', 'scout', 'trainer'];

export default function HomeScreen() {
  const { coach, logout, updateProfile, importPhilosophy } = useAuth();
  const navigation = useNavigation<any>();
  const { t, mode, toggle } = useTheme();
  const [unreadCount, setUnreadCount] = useState(0);

  // Profile edit modal
  const [showProfile, setShowProfile] = useState(false);
  const [pName, setPName] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pProgram, setPProgram] = useState('');
  const [pLevel, setPLevel] = useState('HS Varsity');
  const [pRole, setPRole] = useState('coach');
  const [pCountry, setPCountry] = useState('');
  const [pCity, setPCity] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // System & philosophy profile
  const [showSystem, setShowSystem] = useState(false);
  const [sys, setSys] = useState<Record<string, string>>({});
  const [savingSystem, setSavingSystem] = useState(false);
  const [importingPhilosophy, setImportingPhilosophy] = useState(false);

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
      Alert.alert('Imported', 'Your philosophy fields were updated and the document is now kept as a standing reference for the AI. Review below, then Save.');
    } catch (e: any) {
      Alert.alert('Import failed', e?.response?.data?.detail ?? 'Could not import that document.');
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

  const saveSystem = async () => {
    setSavingSystem(true);
    try {
      await updateProfile({ system_profile: sys });
      setShowSystem(false);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not save system profile');
    } finally {
      setSavingSystem(false);
    }
  };

  const saveProfile = async () => {
    if (!pName.trim()) { Alert.alert('Name required', 'Please enter your name.'); return; }
    const email = pEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.'); return;
    }
    setSavingProfile(true);
    try {
      await updateProfile({ name: pName.trim(), email: email || undefined, program_name: pProgram.trim(), competition_level: pLevel, role: pRole, country: pCountry || undefined, city: pCity.trim() || undefined });
      setShowProfile(false);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not update profile');
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
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  const CircleBtn = ({ icon, onPress, badge, label }: { icon: IconName; onPress: () => void; badge?: number; label: string }) => (
    <TouchableOpacity
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
        backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder,
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={[typeScale.label, { color: t.label, marginBottom: 4 }]}>Intelligence Model</Text>
              <Text style={[typeScale.h1, { color: t.ink }]}>BloomPrint</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <CircleBtn icon={mode === 'dark' ? 'sun' : 'moon'} onPress={toggle} label="Toggle theme" />
              <CircleBtn icon="user" onPress={openProfile} label="Edit profile" />
              <CircleBtn icon="mail" onPress={() => navigation.navigate('StaffInbox')} label="Staff inbox" />
              <CircleBtn icon="bell" onPress={() => navigation.navigate('CoachNotifications')} badge={unreadCount} label="Notifications" />
            </View>
          </View>
          {coach && (
            <View style={{ marginTop: 8 }}>
              <Text style={[typeScale.bodySoft, { color: t.muted }]}>
                {coach.name} · {coach.role ? coach.role.charAt(0).toUpperCase() + coach.role.slice(1) : 'Coach'} · {coach.program_name}
              </Text>
            </View>
          )}
        </View>

        {/* AI command bar */}
        <View style={{ marginBottom: 20 }}>
          <CommandBar />
        </View>

        {/* Report Types */}
        <View style={{ paddingHorizontal: 22, marginTop: 22 }}>
          <SectionLabel>Report Types</SectionLabel>
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
                  <Text style={[typeScale.sectionTitle, { color: t.ink, fontSize: 15.5, marginTop: 12 }]}>{rt.label}</Text>
                  <Text style={[typeScale.bodySoft, { color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 4 }]}>{rt.desc}</Text>
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 6 Pillars */}
        <View style={{ paddingHorizontal: 22, marginTop: 26 }}>
          <SectionLabel>The 6 Pillars</SectionLabel>
          <Card padding={6}>
            {PILLARS.map((p, i) => (
              <View key={p.key}>
                <View style={styles.pillarRow}>
                  <IconTile name={p.icon} variant="accent" size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts[700], fontSize: 14.5, color: t.ink }}>{p.label}</Text>
                    <Text style={[typeScale.bodySoft, { color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 2 }]}>{p.desc}</Text>
                  </View>
                </View>
                {i < PILLARS.length - 1 && <View style={{ height: 1, backgroundColor: t.divider, marginLeft: 12 }} />}
              </View>
            ))}
          </Card>
        </View>
      </ScrollView>

      {/* Profile edit modal */}
      <Modal visible={showProfile} transparent animationType="slide" onRequestClose={() => setShowProfile(false)}>
        <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36, borderWidth: 1, borderColor: t.cardBorder }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <Text style={[typeScale.sectionTitle, { color: t.ink, fontSize: 20 }]}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setShowProfile(false)}>
                <Icon name="x" size={22} color={t.muted} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8 }]}>Name</Text>
            <TextInput
              style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line }}
              value={pName} onChangeText={setPName}
              placeholder="Your name" placeholderTextColor={t.muted2}
            />

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8, marginTop: 16 }]}>Email</Text>
            <TextInput
              style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line }}
              value={pEmail} onChangeText={setPEmail}
              placeholder="you@email.com" placeholderTextColor={t.muted2}
              autoCapitalize="none" keyboardType="email-address"
            />
            <Text style={{ color: t.muted2, fontSize: 11, marginTop: 4 }}>This is the email you sign in with.</Text>

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8, marginTop: 16 }]}>Role</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {ROLES.map(r => (
                <TouchableOpacity
                  key={r}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, alignItems: 'center', borderColor: pRole === r ? t.ctaBg : t.line, backgroundColor: pRole === r ? t.ctaBg : 'transparent' }}
                  onPress={() => setPRole(r)}
                >
                  <Text style={{ color: pRole === r ? t.ctaText : t.muted, fontFamily: fonts[700], fontSize: 14 }}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8, marginTop: 16 }]}>Program / Organization</Text>
            <TextInput
              style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line }}
              value={pProgram} onChangeText={setPProgram}
              placeholder="Program name" placeholderTextColor={t.muted2}
            />

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8, marginTop: 16 }]}>Competition Level</Text>
            <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 8 }}>
              Every eval, report, and training program is calibrated to this level. Changing it updates the default everywhere.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CANON_LEVELS.map(lvl => (
                <TouchableOpacity
                  key={lvl}
                  onPress={() => setPLevel(lvl)}
                  style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1,
                    backgroundColor: pLevel === lvl ? t.ctaBg : t.card,
                    borderColor: pLevel === lvl ? t.ctaBg : t.line }}
                >
                  <Text style={{ color: pLevel === lvl ? t.ctaText : t.muted, fontSize: 13, fontFamily: fonts[700] }}>{lvl}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[typeScale.label, { color: t.label, marginBottom: 8, marginTop: 16 }]}>Location</Text>
            <CountryField value={pCountry} onChange={setPCountry} />
            <TextInput
              style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line }}
              value={pCity} onChangeText={setPCity}
              placeholder="City / Region (optional)" placeholderTextColor={t.muted2}
            />

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.card, borderRadius: 12, padding: 14, marginTop: 16, borderWidth: 1, borderColor: t.line }}
              onPress={openSystem}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontFamily: fonts[700], fontSize: 14 }}>Program System & Philosophy</Text>
                <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>How the AI should read the game for you</Text>
              </View>
              <Icon name="chevron-right" size={18} color={t.muted} strokeWidth={2} />
            </TouchableOpacity>

            <TouchableOpacity
              style={{ backgroundColor: t.ctaBg, borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 20 }}
              onPress={saveProfile} disabled={savingProfile}
            >
              {savingProfile
                ? <ActivityIndicator color={t.ctaText} />
                : <Text style={{ color: t.ctaText, fontFamily: fonts[800], fontSize: 15 }}>Save Changes</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: t.negative }}
              onPress={() => { setShowProfile(false); handleSignOut(); }}
            >
              <Icon name="log-out" size={16} color={t.negative} strokeWidth={2} />
              <Text style={{ color: t.negative, fontFamily: fonts[700], fontSize: 14 }}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Program System & Philosophy modal */}
      <Modal visible={showSystem} transparent animationType="slide" onRequestClose={() => setShowSystem(false)}>
        <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, flex: 1, marginTop: 50, borderWidth: 1, borderColor: t.cardBorder }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 8 }}>
              <Text style={[typeScale.sectionTitle, { color: t.ink, fontSize: 19 }]}>System & Philosophy</Text>
              <TouchableOpacity onPress={() => setShowSystem(false)}>
                <Icon name="x" size={22} color={t.muted} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
                Describe your program's system and what you value. The AI keeps this in mind on every report,
                framing players as fit for the way YOU play. Fill in what's relevant — leave the rest blank.
              </Text>

              {/* Import philosophy document */}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.accentSoft, borderRadius: 12, padding: 13, marginBottom: 8 }}
                onPress={importPhilosophyDoc}
                disabled={importingPhilosophy}
              >
                <Icon name="upload" size={16} color={t.accent} strokeWidth={2} />
                <Text style={{ color: t.accent, fontFamily: fonts[700], fontSize: 12.5, flex: 1 }}>
                  Import philosophy document (PDF, Word, image, text)
                </Text>
              </TouchableOpacity>
              <Text style={{ color: t.muted2, fontSize: 11.5, lineHeight: 16, marginBottom: 10 }}>
                The AI reads it, adds the details to the fields below, and keeps the document as a standing
                reference on every future report.
              </Text>
              {!!coach?.philosophy_reference && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                  <Icon name="check-circle" size={14} color={t.positive} strokeWidth={2} />
                  <Text style={{ color: t.positive, fontSize: 12, fontFamily: fonts[600] }}>
                    Reference document on file for the AI
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.chip, borderRadius: 12, padding: 13, marginBottom: 14, borderWidth: 1, borderColor: t.line }}
                onPress={() => { setShowSystem(false); navigation.navigate('Onboarding'); }}
              >
                <Icon name="list" size={16} color={t.ink} strokeWidth={2} />
                <Text style={{ color: t.ink, fontFamily: fonts[700], fontSize: 12.5, flex: 1 }}>
                  Re-run the guided setup (chips + questions)
                </Text>
                <Icon name="chevron-right" size={16} color={t.muted} strokeWidth={2} />
              </TouchableOpacity>
              <GeneratingOverlay visible={importingPhilosophy} label="Reading your philosophy document…" />

              {SYSTEM_FIELDS.map(f => (
                <View key={f.key} style={{ marginBottom: 16 }}>
                  <Text style={[typeScale.label, { color: t.label, marginBottom: 6 }]}>{f.label}</Text>
                  <TextInput
                    style={{ backgroundColor: t.card, borderRadius: 12, padding: 13, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 76, textAlignVertical: 'top' }}
                    value={sys[f.key] ?? ''}
                    onChangeText={txt => setSys(prev => ({ ...prev, [f.key]: txt }))}
                    placeholder={f.placeholder} placeholderTextColor={t.muted2}
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
                  : <Text style={{ color: t.ctaText, fontFamily: fonts[800], fontSize: 15 }}>Save Philosophy</Text>}
              </TouchableOpacity>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>
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
