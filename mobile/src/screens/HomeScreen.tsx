import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { playerAPI } from '../api/client';

const REPORT_TYPES = [
  { key: 'player_eval', label: 'Player Eval', icon: 'person', desc: 'Individual BIM evaluation scored across all 6 pillars' },
  { key: 'film_breakdown', label: 'Film Breakdown', icon: 'film', desc: 'Frame-by-frame film analysis of technique and decisions' },
  { key: 'scouting_report', label: 'Scouting Report', icon: 'search', desc: 'Recruitment-grade scouting report for a target player' },
  { key: 'coaching_report', label: 'Coaching Report', icon: 'clipboard', desc: 'Coach-facing breakdown with practice and scheme focus' },
  { key: 'game_analysis', label: 'Game Analysis', icon: 'stats-chart', desc: 'Full game film analysis covering both sides of the ball' },
  { key: 'training_program', label: 'Training Program', icon: 'barbell', desc: 'Personalized skill development program from eval data' },
  { key: 'recruitment_profile', label: 'Recruitment', icon: 'school', desc: 'Next-level recruitment profile and college projection' },
  { key: 'position_analysis', label: 'Position Analysis', icon: 'location', desc: 'Position-specific role fit and skill translation analysis' },
  { key: 'box_score', label: 'Box Score', icon: 'stats-chart', desc: 'Game and season box score stats imported and analyzed by BIM' },
];

const PILLARS = [
  { key: 'offensive_skills', label: 'Offensive Skills', icon: 'basketball', color: '#f59e0b', desc: 'Scoring, creation, shooting mechanics, footwork, P&R' },
  { key: 'defensive_capabilities', label: 'Defense', icon: 'shield', color: '#3b82f6', desc: 'On-ball defense, help-side, IQ, communication, rotations' },
  { key: 'physical_attributes', label: 'Physical', icon: 'body', color: '#22c55e', desc: 'Athleticism, size, length, speed, strength, explosiveness' },
  { key: 'intangibles', label: 'Intangibles', icon: 'heart', color: '#ec4899', desc: 'IQ, coachability, leadership, motor, competitive drive' },
  { key: 'advanced_analysis', label: 'Advanced', icon: 'analytics', color: '#a78bfa', desc: 'Shot selection, efficiency metrics, tendencies, adjustments' },
  { key: 'strategic_fit', label: 'Strategic Fit', icon: 'git-network', color: '#fb923c', desc: 'System fit, positional versatility, lineup compatibility' },
];

export default function HomeScreen() {
  const { coach, logout } = useAuth();
  const navigation = useNavigation<any>();
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.logo}>BloomPrint</Text>
            <Text style={styles.sub}>Basketball Intelligence Model</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              style={styles.signOutBtn}
              onPress={() => navigation.navigate('StaffInbox')}
            >
              <Ionicons name="mail-outline" size={18} color="#9ca3af" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.signOutBtn, { position: 'relative' }]}
              onPress={() => navigation.navigate('CoachNotifications')}
            >
              <Ionicons name="notifications-outline" size={18} color="#9ca3af" />
              {unreadCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>{unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
              <Ionicons name="log-out-outline" size={18} color="#6b7280" />
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </View>
        {coach && (
          <View style={styles.coachBadge}>
            <Ionicons name="person-circle-outline" size={16} color="#6b7280" />
            <Text style={styles.coachText}>
              {coach.name} · {coach.role ? coach.role.charAt(0).toUpperCase() + coach.role.slice(1) : 'Coach'} · {coach.program_name}
            </Text>
          </View>
        )}
      </View>

      {/* Report Types */}
      <Text style={styles.sectionLabel}>Report Types</Text>
      <View style={styles.grid}>
        {REPORT_TYPES.map(rt => (
          <View key={rt.key} style={styles.card}>
            <View style={styles.cardIcon}>
              <Ionicons name={rt.icon as any} size={20} color="#2563eb" />
            </View>
            <Text style={styles.cardTitle}>{rt.label}</Text>
            <Text style={styles.cardDesc}>{rt.desc}</Text>
          </View>
        ))}
      </View>

      {/* 6 Pillars */}
      <Text style={styles.sectionLabel}>The 6 Pillars</Text>
      {PILLARS.map(p => (
        <View key={p.key} style={styles.pillarRow}>
          <View style={[styles.pillarIcon, { backgroundColor: p.color + '22' }]}>
            <Ionicons name={p.icon as any} size={18} color={p.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.pillarLabel}>{p.label}</Text>
            <Text style={styles.pillarDesc}>{p.desc}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { padding: 24, paddingTop: 60, marginBottom: 4 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  sub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: '#374151', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 6,
  },
  signOutText: { color: '#6b7280', fontSize: 12, fontWeight: '600' },
  notifBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#dc2626',
    borderRadius: 7,
    minWidth: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  notifBadgeText: { color: '#fff', fontSize: 8, fontWeight: '800' },
  coachBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  coachText: { color: '#6b7280', fontSize: 12 },
  sectionLabel: {
    color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', marginHorizontal: 20, marginTop: 24, marginBottom: 12,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10 },
  card: {
    width: '47%', backgroundColor: '#111827', borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: '#1f2937',
  },
  cardIcon: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: '#1e3a8a22',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  cardTitle: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  cardDesc: { color: '#6b7280', fontSize: 11, lineHeight: 16 },
  pillarRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginHorizontal: 20, minHeight: 52,
  },
  pillarIcon: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  pillarLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  pillarDesc: { color: '#6b7280', fontSize: 12, marginTop: 2, lineHeight: 17 },
});
