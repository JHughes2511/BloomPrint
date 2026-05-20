import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { usePlayerAuth } from '../../context/PlayerAuthContext';
import { playerNotificationsAPI } from '../../api/playerClient';

export default function PlayerHomeScreen() {
  const { playerUser, logout } = usePlayerAuth();
  const navigation = useNavigation<any>();
  const [unreadCount, setUnreadCount] = useState(0);

  useFocusEffect(useCallback(() => {
    playerNotificationsAPI.list().then((notifs: any[]) => {
      setUnreadCount(notifs.filter(n => !n.read).length);
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
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.logo}>BloomPrint</Text>
            <Text style={styles.sub}>Player Portal</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.notifBtn}
              onPress={() => navigation.navigate('PlayerNotifsTab' as any)}
            >
              <Ionicons name="notifications-outline" size={22} color="#16a34a" />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
              <Ionicons name="log-out-outline" size={18} color="#6b7280" />
            </TouchableOpacity>
          </View>
        </View>
        {playerUser && (
          <View>
            <View style={styles.playerBadge}>
              <Ionicons name="person-circle-outline" size={16} color="#16a34a" />
              <Text style={styles.playerText}>{playerUser.name}</Text>
              {playerUser.player_id && (
                <View style={styles.linkedBadge}>
                  <Ionicons name="checkmark-circle" size={12} color="#16a34a" />
                  <Text style={styles.linkedText}>Linked</Text>
                </View>
              )}
            </View>
            {playerUser.player_id && (playerUser as any).linked_program_name && (
              <View style={styles.programBadge}>
                <Ionicons name="shield-checkmark-outline" size={13} color="#4b7a4b" />
                <Text style={styles.programText}>
                  {(playerUser as any).linked_player_name} · {(playerUser as any).linked_program_name}
                  {(playerUser as any).linked_team_name ? ` · ${(playerUser as any).linked_team_name}` : ''}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      <Text style={styles.sectionLabel}>Your Dashboard</Text>

      <View style={styles.cardGrid}>
        <TouchableOpacity
          style={[styles.actionCard, { borderColor: '#16a34a' }]}
          onPress={() => navigation.navigate('InboxTab' as any)}
        >
          <View style={[styles.cardIcon, { backgroundColor: '#16a34a22' }]}>
            <Ionicons name="mail" size={28} color="#16a34a" />
          </View>
          <Text style={styles.cardTitle}>My Reports</Text>
          <Text style={styles.cardDesc}>View reports shared by your coaches</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionCard, { borderColor: '#22c55e' }]}
          onPress={() => navigation.navigate('TrainingTab' as any)}
        >
          <View style={[styles.cardIcon, { backgroundColor: '#22c55e22' }]}>
            <Ionicons name="barbell" size={28} color="#22c55e" />
          </View>
          <Text style={styles.cardTitle}>My Training</Text>
          <Text style={styles.cardDesc}>View and generate training programs</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>Account</Text>

      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => navigation.navigate('ProfileTab' as any)}
      >
        <Ionicons name="link-outline" size={20} color="#16a34a" />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.linkTitle}>Link Profile</Text>
          <Text style={styles.linkDesc}>
            {playerUser?.player_id
              ? 'Your account is linked to a player profile'
              : 'Connect your account to your player profile'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#4b5563" />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1a0f' },
  header: { padding: 24, paddingTop: 60, marginBottom: 4 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  sub: { fontSize: 13, color: '#16a34a', marginTop: 2, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  notifBtn: { position: 'relative', padding: 4 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#dc2626',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  signOutBtn: { padding: 4 },
  playerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  playerText: { color: '#d1d5db', fontSize: 13 },
  linkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#16a34a22',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 6,
  },
  linkedText: { color: '#16a34a', fontSize: 11, fontWeight: '600' },
  programBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  programText: { color: '#4b7a4b', fontSize: 12 },
  sectionLabel: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 12,
  },
  cardGrid: { flexDirection: 'row', gap: 12, paddingHorizontal: 20 },
  actionCard: {
    flex: 1,
    backgroundColor: '#1a2e1a',
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
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  cardDesc: { color: '#4b7a4b', fontSize: 11, lineHeight: 16 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a2e1a',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: '#2d4a2d',
  },
  linkTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  linkDesc: { color: '#4b7a4b', fontSize: 12, marginTop: 2 },
});
