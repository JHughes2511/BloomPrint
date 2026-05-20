import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
  Modal, TextInput, Platform, PanResponder, Animated, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { usePlayerAuth } from '../../context/PlayerAuthContext';
import { playerNotificationsAPI, playerProfileAPI } from '../../api/playerClient';

export default function PlayerHomeScreen() {
  const { playerUser, logout } = usePlayerAuth();
  const navigation = useNavigation<any>();
  const [unreadCount, setUnreadCount] = useState(0);
  const [profile, setProfile] = useState<{
    position?: string; height?: string; wingspan?: string;
    country?: string; state?: string; city?: string; school_name?: string;
  } | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editPosition, setEditPosition] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [editWingspan, setEditWingspan] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editState, setEditState] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editSchool, setEditSchool] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    playerNotificationsAPI.list().then((notifs: any[]) => {
      setUnreadCount(notifs.filter(n => !n.read).length);
    }).catch(() => {});
    if (playerUser?.player_id) {
      playerProfileAPI.get().then((p: any) => setProfile(p)).catch(() => {});
    }
  }, [playerUser?.player_id]));

  const openEdit = () => {
    setEditPosition(profile?.position ?? '');
    setEditHeight(profile?.height ?? '');
    setEditWingspan(profile?.wingspan ?? '');
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
        country: editCountry.trim() || undefined,
        state: editState.trim() || undefined,
        city: editCity.trim() || undefined,
        school_name: editSchool.trim() || undefined,
      });
      setProfile(updated);
      setShowEditModal(false);
    } catch {
      Alert.alert('Error', 'Failed to save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

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

      {playerUser?.player_id && profile && (
        <>
          <Text style={styles.sectionLabel}>My Profile</Text>
          <View style={styles.profileCard}>
            <View style={styles.profileCardHeader}>
              <Ionicons name="person-circle-outline" size={20} color="#16a34a" />
              <Text style={styles.profileCardTitle}>Athletic Profile</Text>
              <TouchableOpacity style={styles.editBtn} onPress={openEdit}>
                <Ionicons name="pencil-outline" size={15} color="#16a34a" />
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.profileStats}>
              <View style={styles.profileStat}>
                <Text style={styles.profileStatVal}>{profile.position || '—'}</Text>
                <Text style={styles.profileStatLabel}>Position</Text>
              </View>
              <View style={styles.profileStatDivider} />
              <View style={styles.profileStat}>
                <Text style={styles.profileStatVal}>{profile.height || '—'}</Text>
                <Text style={styles.profileStatLabel}>Height</Text>
              </View>
              <View style={styles.profileStatDivider} />
              <View style={styles.profileStat}>
                <Text style={styles.profileStatVal}>{profile.wingspan || '—'}</Text>
                <Text style={styles.profileStatLabel}>Wingspan</Text>
              </View>
            </View>
            {(profile.school_name || profile.city || profile.state || profile.country) && (
              <View style={styles.profileLocation}>
                {profile.school_name && (
                  <View style={styles.profileLocationRow}>
                    <Ionicons name="school-outline" size={13} color="#4b7a4b" />
                    <Text style={styles.profileLocationText}>{profile.school_name}</Text>
                  </View>
                )}
                {(profile.city || profile.state || profile.country) && (
                  <View style={styles.profileLocationRow}>
                    <Ionicons name="location-outline" size={13} color="#4b7a4b" />
                    <Text style={styles.profileLocationText}>
                      {[profile.city, profile.state, profile.country].filter(Boolean).join(', ')}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </>
      )}

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

      <Modal visible={showEditModal} transparent animationType="none">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => { Keyboard.dismiss(); closeModal(); }}>
          <Animated.View
            style={[styles.modalBox, { transform: [{ translateY: slideY }] }]}
            {...swipePan.panHandlers}
          >
            <TouchableOpacity activeOpacity={1}>
              <View style={styles.dragHandle} />
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Edit My Profile</Text>
                <TouchableOpacity onPress={() => { Keyboard.dismiss(); closeModal(); }}>
                  <Ionicons name="close" size={22} color="#9ca3af" />
                </TouchableOpacity>
              </View>
              <ScrollView
                ref={modalScrollRef}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: KEYBOARD_HEIGHT + 40 }}
              >
                <View onLayout={e => { fieldY.current['position'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel}>Position</Text>
                  <TextInput style={styles.input} value={editPosition} onChangeText={setEditPosition}
                    placeholder="e.g. PG, SG, SF, PF, C" placeholderTextColor="#4b5563"
                    returnKeyType="next" onFocus={() => scrollToField('position')} />
                </View>
                <View onLayout={e => { fieldY.current['height'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel}>Height</Text>
                  <TextInput style={styles.input} value={editHeight} onChangeText={setEditHeight}
                    placeholder={`e.g. 6'2"`} placeholderTextColor="#4b5563"
                    returnKeyType="next" onFocus={() => scrollToField('height')} />
                </View>
                <View onLayout={e => { fieldY.current['wingspan'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel}>Wingspan</Text>
                  <TextInput style={styles.input} value={editWingspan} onChangeText={setEditWingspan}
                    placeholder={`e.g. 6'5"`} placeholderTextColor="#4b5563"
                    returnKeyType="next" onFocus={() => scrollToField('wingspan')} />
                </View>
                <View onLayout={e => { fieldY.current['school'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel}>School</Text>
                  <TextInput style={styles.input} value={editSchool} onChangeText={setEditSchool}
                    placeholder="e.g. Lincoln High School" placeholderTextColor="#4b5563"
                    returnKeyType="next" onFocus={() => scrollToField('school')} />
                </View>
                <View onLayout={e => { fieldY.current['city'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel}>City</Text>
                  <TextInput style={styles.input} value={editCity} onChangeText={setEditCity}
                    placeholder="e.g. Atlanta" placeholderTextColor="#4b5563"
                    returnKeyType="next" onFocus={() => scrollToField('city')} />
                </View>
                <View onLayout={e => { fieldY.current['state'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel}>State</Text>
                  <TextInput style={styles.input} value={editState} onChangeText={setEditState}
                    placeholder="e.g. Georgia" placeholderTextColor="#4b5563"
                    returnKeyType="next" onFocus={() => scrollToField('state')} />
                </View>
                <View onLayout={e => { fieldY.current['country'] = e.nativeEvent.layout.y; }}>
                  <Text style={styles.fieldLabel}>Country</Text>
                  <TextInput style={styles.input} value={editCountry} onChangeText={setEditCountry}
                    placeholder="e.g. USA" placeholderTextColor="#4b5563"
                    returnKeyType="done" onFocus={() => scrollToField('country')} />
                </View>
                <TouchableOpacity
                  style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                  onPress={saveProfile}
                  disabled={saving}
                >
                  <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
                </TouchableOpacity>
              </ScrollView>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Modal>
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
  profileCard: {
    backgroundColor: '#1a2e1a',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: '#2d4a2d',
  },
  profileCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  profileCardTitle: { color: '#fff', fontSize: 14, fontWeight: '700', flex: 1 },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#16a34a22',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  editBtnText: { color: '#16a34a', fontSize: 12, fontWeight: '600' },
  profileStats: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  profileStat: { flex: 1, alignItems: 'center' },
  profileStatVal: { color: '#fff', fontSize: 18, fontWeight: '800' },
  profileStatLabel: { color: '#4b7a4b', fontSize: 11, marginTop: 2 },
  profileStatDivider: { width: 1, height: 36, backgroundColor: '#2d4a2d' },
  profileLocation: { marginTop: 12, gap: 5, borderTopWidth: 1, borderTopColor: '#2d4a2d', paddingTop: 12 },
  profileLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  profileLocationText: { color: '#4b7a4b', fontSize: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: '#1a2e1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  dragHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#2d4a2d', alignSelf: 'center', marginBottom: 16,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  fieldLabel: { color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: '#0f1a0f',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2d4a2d',
    color: '#fff',
    fontSize: 15,
    padding: 12,
  },
  saveBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
