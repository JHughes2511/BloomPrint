import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Modal, TextInput, ActivityIndicator } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { playerAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ScreenBackground, SectionLabel, Card, IconTile, Txt } from '../theme/components';
import { Icon, IconName } from '../theme/icons';
import { fonts, type as typeScale } from '../theme/typography';

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
  const { coach, logout, updateProfile } = useAuth();
  const navigation = useNavigation<any>();
  const { t, mode, toggle } = useTheme();
  const [unreadCount, setUnreadCount] = useState(0);

  // Profile edit modal
  const [showProfile, setShowProfile] = useState(false);
  const [pName, setPName] = useState('');
  const [pProgram, setPProgram] = useState('');
  const [pRole, setPRole] = useState('coach');
  const [savingProfile, setSavingProfile] = useState(false);

  const openProfile = () => {
    setPName(coach?.name ?? '');
    setPProgram(coach?.program_name ?? '');
    setPRole(coach?.role ?? 'coach');
    setShowProfile(true);
  };

  const saveProfile = async () => {
    if (!pName.trim()) { Alert.alert('Name required', 'Please enter your name.'); return; }
    setSavingProfile(true);
    try {
      await updateProfile({ name: pName.trim(), program_name: pProgram.trim(), role: pRole });
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
              <CircleBtn icon="log-out" onPress={handleSignOut} label="Sign out" />
              <CircleBtn icon="mail" onPress={() => navigation.navigate('StaffInbox')} label="Staff inbox" />
              <CircleBtn icon="bell" onPress={() => navigation.navigate('CoachNotifications')} badge={unreadCount} label="Notifications" />
            </View>
          </View>
          {coach && (
            <TouchableOpacity onPress={openProfile} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <Text style={[typeScale.bodySoft, { color: t.muted }]}>
                {coach.name} · {coach.role ? coach.role.charAt(0).toUpperCase() + coach.role.slice(1) : 'Coach'} · {coach.program_name}
              </Text>
              <Icon name="pencil" size={13} color={t.muted2} strokeWidth={2} />
            </TouchableOpacity>
          )}
        </View>

        {/* Report Types */}
        <View style={{ paddingHorizontal: 22, marginTop: 22 }}>
          <SectionLabel>Report Types</SectionLabel>
          <View style={styles.grid}>
            {REPORT_TYPES.map(rt => (
              <Card key={rt.key} style={{ width: '48%' }} padding={16}>
                <IconTile name={rt.icon} variant="accent" size={44} />
                <Text style={[typeScale.sectionTitle, { color: t.ink, fontSize: 15.5, marginTop: 12 }]}>{rt.label}</Text>
                <Text style={[typeScale.bodySoft, { color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 4 }]}>{rt.desc}</Text>
              </Card>
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

            <TouchableOpacity
              style={{ backgroundColor: t.ctaBg, borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 24 }}
              onPress={saveProfile} disabled={savingProfile}
            >
              {savingProfile
                ? <ActivityIndicator color={t.ctaText} />
                : <Text style={{ color: t.ctaText, fontFamily: fonts[800], fontSize: 15 }}>Save Changes</Text>}
            </TouchableOpacity>
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
