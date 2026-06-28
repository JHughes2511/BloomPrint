import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
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

export default function HomeScreen() {
  const { coach, logout } = useAuth();
  const navigation = useNavigation<any>();
  const { t, mode, toggle } = useTheme();
  const [unreadCount, setUnreadCount] = useState(0);

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
            <Text style={[typeScale.bodySoft, { color: t.muted, marginTop: 8 }]}>
              {coach.name} · {coach.role ? coach.role.charAt(0).toUpperCase() + coach.role.slice(1) : 'Coach'} · {coach.program_name}
            </Text>
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
  notifBadgeText: { color: '#fff', fontSize: 8, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  pillarRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 12 },
});
