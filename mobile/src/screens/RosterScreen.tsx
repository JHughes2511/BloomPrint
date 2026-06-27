import React, { useCallback, useState } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Modal, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';

const COMPETITION_LEVELS = ['Middle School', 'HS JV', 'HS Varsity', 'AAU', 'College', 'Pro'];

function LevelDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        style={ddStyles.trigger}
        onPress={() => setOpen(true)}
      >
        <Text style={ddStyles.triggerText}>{value}</Text>
        <Text style={ddStyles.chevron}>▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade">
        <TouchableOpacity style={ddStyles.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={ddStyles.menu}>
            <Text style={ddStyles.menuTitle}>Competition Level</Text>
            {COMPETITION_LEVELS.map(lvl => (
              <TouchableOpacity
                key={lvl}
                style={[ddStyles.option, value === lvl && ddStyles.optionActive]}
                onPress={() => { onChange(lvl); setOpen(false); }}
              >
                <Text style={[ddStyles.optionText, value === lvl && ddStyles.optionTextActive]}>{lvl}</Text>
                {value === lvl && <Text style={{ color: '#2563eb' }}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const ddStyles = StyleSheet.create({
  trigger: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1f2937', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 14, borderWidth: 1, borderColor: '#374151',
  },
  triggerText: { color: '#fff', fontSize: 14 },
  chevron: { color: '#9ca3af', fontSize: 14 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 32 },
  menu: { backgroundColor: '#1f2937', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#374151' },
  menuTitle: { color: '#6b7280', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, padding: 14, paddingBottom: 8 },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderTopWidth: 1, borderTopColor: '#374151' },
  optionActive: { backgroundColor: '#1e3a5f' },
  optionText: { color: '#d1d5db', fontSize: 14 },
  optionTextActive: { color: '#fff', fontWeight: '700' },
});
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playersAPI, teamsAPI } from '../api/client';
import { Player, Team } from '../types';
import { GradeBadge } from '../components/GradeBadge';

export default function RosterScreen() {
  const navigation = useNavigation<any>();

  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Add player modal
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPos, setNewPos] = useState('');
  const [newJersey, setNewJersey] = useState('');
  const [newHeight, setNewHeight] = useState('');
  const [newWingspan, setNewWingspan] = useState('');
  const [newWeight, setNewWeight] = useState('');
  const [newStandingReach, setNewStandingReach] = useState('');
  const [newSchool, setNewSchool] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newState, setNewState] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [newLevel, setNewLevel] = useState('Middle School');
  const [parentPermission, setParentPermission] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [saving, setSaving] = useState(false);

  // Create team modal
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamLevel, setNewTeamLevel] = useState('Middle School');
  const [creatingTeam, setCreatingTeam] = useState(false);

  const load = async () => {
    try {
      const [t, p] = await Promise.all([teamsAPI.list(), playersAPI.list()]);
      setTeams(t);
      setPlayers(p);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const visiblePlayers = selectedTeamId == null
    ? players
    : players.filter(p => p.team_id === selectedTeamId);

  const addPlayer = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await playersAPI.create({
        name: newName,
        position: newPos || undefined,
        jersey_number: newJersey || undefined,
        height: newHeight || undefined,
        wingspan: newWingspan || undefined,
        weight: newWeight || undefined,
        standing_reach: newStandingReach || undefined,
        school_name: newSchool || undefined,
        city: newCity || undefined,
        state: newState || undefined,
        country: newCountry || undefined,
        competition_level: newLevel,
        parent_permission: parentPermission,
        team_id: selectedTeamId ?? undefined,
      });
      setShowAdd(false);
      setNewName(''); setNewPos(''); setNewJersey(''); setNewHeight(''); setNewWingspan('');
      setNewWeight(''); setNewStandingReach('');
      setNewSchool(''); setNewCity(''); setNewState(''); setNewCountry('');
      setParentPermission(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not add player');
    } finally {
      setSaving(false);
    }
  };

  const createTeam = async () => {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    try {
      const team = await teamsAPI.create({ name: newTeamName, competition_level: newTeamLevel });
      setShowNewTeam(false);
      setNewTeamName(''); setNewTeamLevel('Middle School');
      // Optimistically add team to list immediately, then refresh
      setTeams(prev => [...prev, team]);
      setSelectedTeamId(team.id);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not create team');
    } finally {
      setCreatingTeam(false);
    }
  };

  const deleteTeam = (team: Team) => {
    Alert.alert('Delete Team', `Delete "${team.name}"? Players will remain but lose their team assignment.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await teamsAPI.delete(team.id);
            if (selectedTeamId === team.id) setSelectedTeamId(null);
            load();
          } catch (e: any) {
            Alert.alert('Error', e?.response?.data?.detail ?? 'Could not delete team');
          }
        },
      },
    ]);
  };

  const currentTeamName = teams.find(t => t.id === selectedTeamId)?.name;

  if (loading) return <View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View>;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Roster</Text>
          <Text style={styles.sub}>
            {currentTeamName ?? 'All Teams'} · {visiblePlayers.length} players
          </Text>
        </View>
        <TouchableOpacity style={styles.importBtn} onPress={() => navigation.navigate('Import', { mode: 'roster' })}>
          <Ionicons name="cloud-upload-outline" size={16} color="#9ca3af" />
          <Text style={styles.importBtnText}>Import Roster</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Team filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.teamsRow} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}>
        <TouchableOpacity
          style={[styles.teamChip, selectedTeamId == null && styles.teamChipActive]}
          onPress={() => setSelectedTeamId(null)}
        >
          <Text style={[styles.teamChipText, selectedTeamId == null && styles.teamChipTextActive]}>All</Text>
        </TouchableOpacity>
        {teams.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[styles.teamChip, selectedTeamId === t.id && styles.teamChipActive]}
            onPress={() => setSelectedTeamId(t.id)}
            onLongPress={() => deleteTeam(t)}
          >
            <Text style={[styles.teamChipText, selectedTeamId === t.id && styles.teamChipTextActive]}>{t.name}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.newTeamChip} onPress={() => setShowNewTeam(true)}>
          <Ionicons name="add" size={14} color="#2563eb" />
          <Text style={styles.newTeamText}>New Team</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Player list */}
      <FlatList
        data={visiblePlayers}
        keyExtractor={p => String(p.id)}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('PlayerProfile', { playerId: item.id })}
            onLongPress={() => {
              Alert.alert('Delete Player', `Remove ${item.name} from the roster?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: async () => {
                  try {
                    await playersAPI.delete(item.id);
                    load();
                  } catch (e: any) {
                    Alert.alert('Error', e?.response?.data?.detail ?? 'Could not delete player');
                  }
                }},
              ]);
            }}
          >
            <View style={styles.cardLeft}>
              <Text style={styles.playerName}>{item.name}</Text>
              <Text style={styles.playerMeta}>
                {[item.position, item.team_name ?? item.competition_level].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <GradeBadge grade={item.latest_grade} size="md" />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            {teams.length === 0 ? (
              <Text style={styles.emptyText}>Create a team first, then add players.</Text>
            ) : selectedTeamId != null ? (
              <>
                <Ionicons name="people-outline" size={40} color="#374151" />
                <Text style={styles.emptyText}>No players in this team yet.</Text>
                <TouchableOpacity style={styles.importRosterBtn} onPress={() => navigation.navigate('Import', { mode: 'roster' })}>
                  <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
                  <Text style={styles.importRosterBtnText}>Import Roster from Excel</Text>
                </TouchableOpacity>
                <Text style={styles.importRosterHint}>or tap + to add players one by one</Text>
              </>
            ) : (
              <Text style={styles.emptyText}>No players yet. Create a team and add players.</Text>
            )}
          </View>
        }
      />

      {/* Add Player Modal */}
      <Modal visible={showAdd} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modal, { maxHeight: '90%', flex: 0 }]}>
          <KeyboardAwareScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true} contentContainerStyle={{ paddingBottom: 16 }}>
            <Text style={styles.modalTitle}>Add Player</Text>
            {currentTeamName && (
              <Text style={styles.modalSub}>Adding to {currentTeamName}</Text>
            )}
            <VoiceTextInput style={styles.input} placeholder="Full Name *" placeholderTextColor="#6b7280"
              value={newName} onChangeText={setNewName} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder="Position (e.g. PG, SG, SF)" placeholderTextColor="#6b7280"
                value={newPos} onChangeText={setNewPos} />
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Jersey # (e.g. 23)" placeholderTextColor="#6b7280"
                keyboardType="number-pad" value={newJersey} onChangeText={setNewJersey} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={`Height (e.g. 6'2")`} placeholderTextColor="#6b7280"
                value={newHeight} onChangeText={setNewHeight} />
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={`Wingspan (e.g. 6'5")`} placeholderTextColor="#6b7280"
                value={newWingspan} onChangeText={setNewWingspan} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder="Weight (e.g. 185 lbs)" placeholderTextColor="#6b7280"
                value={newWeight} onChangeText={setNewWeight} />
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={`Standing Reach (e.g. 8'2")`} placeholderTextColor="#6b7280"
                value={newStandingReach} onChangeText={setNewStandingReach} />
            </View>
            <VoiceTextInput style={styles.input} placeholder="School name" placeholderTextColor="#6b7280"
              value={newSchool} onChangeText={setNewSchool} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder="City" placeholderTextColor="#6b7280"
                value={newCity} onChangeText={setNewCity} />
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder="State" placeholderTextColor="#6b7280"
                value={newState} onChangeText={setNewState} />
            </View>
            <VoiceTextInput style={styles.input} placeholder="Country" placeholderTextColor="#6b7280"
              value={newCountry} onChangeText={setNewCountry} />
            <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 4 }}>Competition Level</Text>
            <LevelDropdown value={newLevel} onChange={setNewLevel} />

            {/* Parent/Guardian permission — required for minors */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 4 }}>
              <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '600' }}>Parent/Guardian Permission</Text>
              <TouchableOpacity onPress={() => setShowDisclaimer(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 6 }}>
                <Ionicons name="information-circle-outline" size={16} color="#7c3aed" />
              </TouchableOpacity>
            </View>
            <Text style={{ color: '#6b7280', fontSize: 11, marginBottom: 8 }}>
              Required for any player under 18. Tap the ⓘ for the full consent disclaimer.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
              <TouchableOpacity
                onPress={() => setParentPermission(true)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1,
                         backgroundColor: parentPermission ? '#16a34a' : '#1f2937',
                         borderColor: parentPermission ? '#16a34a' : '#374151' }}>
                <Text style={{ color: parentPermission ? '#fff' : '#9ca3af', fontWeight: '700' }}>Yes</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setParentPermission(false)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1,
                         backgroundColor: !parentPermission ? '#374151' : '#1f2937',
                         borderColor: !parentPermission ? '#6b7280' : '#374151' }}>
                <Text style={{ color: !parentPermission ? '#fff' : '#9ca3af', fontWeight: '700' }}>No</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={addPlayer} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Add</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Parent/Guardian consent disclaimer */}
      <Modal visible={showDisclaimer} transparent animationType="fade" onRequestClose={() => setShowDisclaimer(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#111827', borderRadius: 16, padding: 20, maxHeight: '80%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#7c3aed" />
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800', marginLeft: 8, flex: 1 }}>Parent/Guardian Consent</Text>
              <TouchableOpacity onPress={() => setShowDisclaimer(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              <Text style={{ color: '#d1d5db', fontSize: 13, lineHeight: 20 }}>
                For any athlete under the age of 18, a parent or legal guardian must grant permission before their
                information, evaluations, and film are collected, analyzed, or shared within BloomPrint.{'\n\n'}
                By selecting “Yes,” you confirm that you have obtained verifiable consent from the player’s parent or
                legal guardian to create and maintain this profile — including the storage of biometric and performance
                data and the generation of AI scouting and development reports.{'\n\n'}
                If the player is 18 or older, parental permission is not required and you may select “No.”{'\n\n'}
                You are responsible for ensuring this consent complies with all applicable privacy laws, including
                COPPA and any local regulations governing minors’ data.
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={{ marginTop: 16, backgroundColor: '#7c3aed', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              onPress={() => setShowDisclaimer(false)}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Create Team Modal */}
      <Modal visible={showNewTeam} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>New Team</Text>
            <VoiceTextInput style={styles.input} placeholder="Team Name *" placeholderTextColor="#6b7280"
              value={newTeamName} onChangeText={setNewTeamName} />
            <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 6 }}>Competition Level</Text>
            <LevelDropdown value={newTeamLevel} onChange={setNewTeamLevel} />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowNewTeam(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={createTeam} disabled={creatingTeam}>
                {creatingTeam ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 56 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '900', color: '#fff' },
  sub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#374151', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginRight: 8 },
  importBtnText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  addBtn: { backgroundColor: '#2563eb', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  importRosterBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2563eb', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 16 },
  importRosterBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  importRosterHint: { color: '#4b5563', fontSize: 12, marginTop: 10 },
  teamsRow: { marginBottom: 16, flexGrow: 0 },
  teamChip: { borderWidth: 1, borderColor: '#374151', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  teamChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  teamChipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  teamChipTextActive: { color: '#fff' },
  newTeamChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#2563eb', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderStyle: 'dashed' },
  newTeamText: { color: '#2563eb', fontSize: 13, fontWeight: '600' },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#111827', marginHorizontal: 16, marginBottom: 10,
    borderRadius: 12, padding: 16,
  },
  cardLeft: { flex: 1 },
  playerName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  playerMeta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  emptyWrap: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#6b7280', textAlign: 'center', paddingHorizontal: 32 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#111827', borderRadius: 20, padding: 24, margin: 16 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalSub: { color: '#6b7280', fontSize: 12, marginBottom: 12 },
  input: { backgroundColor: '#1f2937', borderRadius: 10, padding: 14, color: '#fff', fontSize: 14, marginBottom: 10 },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center' },
  cancelText: { color: '#9ca3af', fontWeight: '600' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#2563eb', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700' },
});
