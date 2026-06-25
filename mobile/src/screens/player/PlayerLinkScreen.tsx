import React, { useState } from 'react';
import VoiceTextInput from '../../components/VoiceTextInput';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePlayerAuth } from '../../context/PlayerAuthContext';
import { playerLinkAPI, playerApi } from '../../api/playerClient';

const ROLE_LABELS: Record<string, string> = {
  coach: 'Coach',
  scout: 'Scout',
  trainer: 'Trainer',
};

export default function PlayerLinkScreen() {
  const { playerUser, logout, refreshUser } = usePlayerAuth();
  const [inviteCode, setInviteCode] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [requestingId, setRequestingId] = useState<number | null>(null);

  const useInvite = async () => {
    if (!inviteCode.trim()) return;
    setInviteLoading(true);
    try {
      const res = await playerLinkAPI.useInvite(inviteCode.trim());
      Alert.alert('Linked!', `Your account is now linked to ${res.player_name}'s profile.`);
      await refreshUser();
      setInviteCode('');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Invalid invite code');
    } finally {
      setInviteLoading(false);
    }
  };

  const searchStaff = async () => {
    if (!searchQ.trim()) return;
    setSearchLoading(true);
    try {
      const results = await playerApi.get('/player/search-staff', { params: { q: searchQ.trim() } }).then(r => r.data);
      setSearchResults(results);
    } catch {
      Alert.alert('Error', 'Search failed. Please try again.');
    } finally {
      setSearchLoading(false);
    }
  };

  const requestLink = async (coachId: number, coachName: string) => {
    setRequestingId(coachId);
    try {
      await playerApi.post(`/player/link-request/coach/${coachId}`).then(r => r.data);
      Alert.alert('Request Sent', `A link request was sent to ${coachName}.`);
      setSearchResults([]);
      setSearchQ('');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to send request');
    } finally {
      setRequestingId(null);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60, padding: 24 }}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Link to Staff</Text>
        <TouchableOpacity onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color="#4b7a4b" />
        </TouchableOpacity>
      </View>

      {playerUser?.player_id ? (
        <View style={styles.linkedCard}>
          <Ionicons name="checkmark-circle" size={24} color="#16a34a" />
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.linkedTitle}>Profile Linked</Text>
            <Text style={styles.linkedDesc}>Your account is connected to a player profile.</Text>
          </View>
        </View>
      ) : (
        <View style={styles.notLinkedCard}>
          <Ionicons name="warning-outline" size={20} color="#f59e0b" />
          <Text style={styles.notLinkedText}>Account not yet linked to a staff member</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Enter Invite Code</Text>
        <Text style={styles.sectionDesc}>Enter a code provided by your coach to instantly link.</Text>
        <VoiceTextInput
          style={styles.input}
          placeholder="Invite code (e.g. ABC12345)"
          placeholderTextColor="#4b7a4b"
          value={inviteCode}
          onChangeText={setInviteCode}
          autoCapitalize="characters"
        />
        <TouchableOpacity style={styles.btn} onPress={useInvite} disabled={inviteLoading}>
          {inviteLoading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>Use Invite Code</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Find a Coach or Trainer</Text>
        <Text style={styles.sectionDesc}>Search for a coach, trainer, or scout by name or program and send a link request.</Text>
        <View style={styles.searchRow}>
          <VoiceTextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Search by name or program..."
            placeholderTextColor="#4b7a4b"
            value={searchQ}
            onChangeText={setSearchQ}
          />
          <TouchableOpacity
            style={styles.searchBtn}
            onPress={searchStaff}
            disabled={searchLoading}
          >
            {searchLoading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Ionicons name="search" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
        {searchResults.map((c: any) => (
          <View key={c.id} style={styles.resultCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resultName}>{c.name}</Text>
              <Text style={styles.resultSub}>
                {ROLE_LABELS[c.role] ?? c.role} · {c.program_name}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.requestBtn}
              onPress={() => requestLink(c.id, c.name)}
              disabled={requestingId === c.id}
            >
              {requestingId === c.id
                ? <ActivityIndicator color="#16a34a" size="small" />
                : <Text style={styles.requestBtnText}>Request Link</Text>}
            </TouchableOpacity>
          </View>
        ))}
        {searchResults.length === 0 && searchQ.trim().length > 0 && !searchLoading && (
          <Text style={{ color: '#4b7a4b', fontSize: 12, marginTop: 8 }}>No staff found. Try a different search.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1a0f' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 40,
    marginBottom: 20,
  },
  title: { color: '#fff', fontSize: 26, fontWeight: '900' },
  linkedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16a34a22',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  linkedTitle: { color: '#16a34a', fontSize: 14, fontWeight: '700' },
  linkedDesc: { color: '#4b7a4b', fontSize: 12, marginTop: 2 },
  notLinkedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f59e0b22',
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  notLinkedText: { color: '#f59e0b', fontSize: 13 },
  section: { marginBottom: 8 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sectionDesc: { color: '#4b7a4b', fontSize: 12, marginBottom: 12 },
  input: {
    backgroundColor: '#1a2e1a',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2d4a2d',
  },
  btn: {
    backgroundColor: '#16a34a',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  divider: { height: 1, backgroundColor: '#1a2e1a', marginVertical: 24 },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a2e1a',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2d4a2d',
  },
  resultName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  resultSub: { color: '#4b7a4b', fontSize: 12, marginTop: 2 },
  requestBtn: {
    backgroundColor: '#16a34a22',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  requestBtnText: { color: '#16a34a', fontSize: 12, fontWeight: '600' },
});
