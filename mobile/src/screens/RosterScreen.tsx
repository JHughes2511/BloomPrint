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
  const { t } = useTheme();
  const ddStyles = makeDdStyles(t);
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
                {value === lvl && <Text style={{ color: t.accent }}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const makeDdStyles = (t: ThemeTokens) => StyleSheet.create({
  trigger: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: t.chip, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 14, borderWidth: 1, borderColor: t.line,
  },
  triggerText: { color: t.ink, fontSize: 14 },
  chevron: { color: t.muted, fontSize: 14 },
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'center', paddingHorizontal: 32 },
  menu: { backgroundColor: t.sheet, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: t.cardBorder },
  menuTitle: { color: t.muted, fontSize: 11, fontFamily: fonts[700], textTransform: 'uppercase', letterSpacing: 1, padding: 14, paddingBottom: 8 },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderTopWidth: 1, borderTopColor: t.divider },
  optionActive: { backgroundColor: t.accentSoft },
  optionText: { color: t.inkSoft, fontSize: 14 },
  optionTextActive: { color: t.ink, fontFamily: fonts[700] },
});
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playersAPI, teamsAPI } from '../api/client';
import { Player, Team } from '../types';
import { GradeBadge } from '../components/GradeBadge';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

export default function RosterScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const styles = makeStyles(t);

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

  if (loading) return <ScreenBackground><View style={styles.center}><ActivityIndicator color={t.accent} size="large" /></View></ScreenBackground>;

  return (
    <ScreenBackground>
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
          <Ionicons name="cloud-upload-outline" size={16} color={t.muted} />
          <Text style={styles.importBtnText}>Import Roster</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Ionicons name="add" size={22} color={t.ctaText} />
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
        {teams.map(tm => (
          <TouchableOpacity
            key={tm.id}
            style={[styles.teamChip, selectedTeamId === tm.id && styles.teamChipActive]}
            onPress={() => setSelectedTeamId(tm.id)}
            onLongPress={() => deleteTeam(tm)}
          >
            <Text style={[styles.teamChipText, selectedTeamId === tm.id && styles.teamChipTextActive]}>{tm.name}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.newTeamChip} onPress={() => setShowNewTeam(true)}>
          <Ionicons name="add" size={14} color={t.accent} />
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
                <Ionicons name="people-outline" size={40} color={t.line} />
                <Text style={styles.emptyText}>No players in this team yet.</Text>
                <TouchableOpacity style={styles.importRosterBtn} onPress={() => navigation.navigate('Import', { mode: 'roster' })}>
                  <Ionicons name="cloud-upload-outline" size={16} color={t.ctaText} />
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
            <VoiceTextInput style={styles.input} placeholder="Full Name *" placeholderTextColor={t.muted}
              value={newName} onChangeText={setNewName} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder="Position (e.g. PG, SG, SF)" placeholderTextColor={t.muted}
                value={newPos} onChangeText={setNewPos} />
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Jersey # (e.g. 23)" placeholderTextColor={t.muted}
                keyboardType="number-pad" value={newJersey} onChangeText={setNewJersey} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={`Height (e.g. 6'2")`} placeholderTextColor={t.muted}
                value={newHeight} onChangeText={setNewHeight} />
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={`Wingspan (e.g. 6'5")`} placeholderTextColor={t.muted}
                value={newWingspan} onChangeText={setNewWingspan} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder="Weight (e.g. 185 lbs)" placeholderTextColor={t.muted}
                value={newWeight} onChangeText={setNewWeight} />
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={`Standing Reach (e.g. 8'2")`} placeholderTextColor={t.muted}
                value={newStandingReach} onChangeText={setNewStandingReach} />
            </View>
            <VoiceTextInput style={styles.input} placeholder="School name" placeholderTextColor={t.muted}
              value={newSchool} onChangeText={setNewSchool} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder="City" placeholderTextColor={t.muted}
                value={newCity} onChangeText={setNewCity} />
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder="State" placeholderTextColor={t.muted}
                value={newState} onChangeText={setNewState} />
            </View>
            <VoiceTextInput style={styles.input} placeholder="Country" placeholderTextColor={t.muted}
              value={newCountry} onChangeText={setNewCountry} />
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 4 }}>Competition Level</Text>
            <LevelDropdown value={newLevel} onChange={setNewLevel} />

            {/* Parent/Guardian permission — required for minors */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 4 }}>
              <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>Parent/Guardian Permission</Text>
              <TouchableOpacity onPress={() => setShowDisclaimer(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 6 }}>
                <Ionicons name="information-circle-outline" size={16} color={t.accent} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8 }}>
              Required for any player under 18. Tap the ⓘ for the full consent disclaimer.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
              <TouchableOpacity
                onPress={() => setParentPermission(true)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1,
                         backgroundColor: parentPermission ? t.positive : t.chip,
                         borderColor: parentPermission ? t.positive : t.line }}>
                <Text style={{ color: parentPermission ? '#16201A' : t.muted, fontWeight: '700' }}>Yes</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setParentPermission(false)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1,
                         backgroundColor: !parentPermission ? t.line : t.chip,
                         borderColor: !parentPermission ? t.muted : t.line }}>
                <Text style={{ color: !parentPermission ? t.ink : t.muted, fontWeight: '700' }}>No</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={addPlayer} disabled={saving}>
                {saving ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.saveText}>Add</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Parent/Guardian consent disclaimer */}
      <Modal visible={showDisclaimer} transparent animationType="fade" onRequestClose={() => setShowDisclaimer(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: t.card, borderRadius: 16, padding: 20, maxHeight: '80%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Ionicons name="shield-checkmark-outline" size={20} color={t.accent} />
              <Text style={{ color: t.ink, fontSize: 17, fontWeight: '800', marginLeft: 8, flex: 1 }}>Parent/Guardian Consent</Text>
              <TouchableOpacity onPress={() => setShowDisclaimer(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              <Text style={{ color: t.inkSoft, fontSize: 13, lineHeight: 20 }}>
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
              style={{ marginTop: 16, backgroundColor: t.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              onPress={() => setShowDisclaimer(false)}>
              <Text style={{ color: t.ink, fontWeight: '700' }}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Create Team Modal */}
      <Modal visible={showNewTeam} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>New Team</Text>
            <VoiceTextInput style={styles.input} placeholder="Team Name *" placeholderTextColor={t.muted}
              value={newTeamName} onChangeText={setNewTeamName} />
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>Competition Level</Text>
            <LevelDropdown value={newTeamLevel} onChange={setNewTeamLevel} />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowNewTeam(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={createTeam} disabled={creatingTeam}>
                {creatingTeam ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.saveText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, paddingTop: 56 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 },
  title: { fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6, color: t.ink },
  sub: { fontSize: 12, color: t.muted, marginTop: 2 },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: t.cta2Border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8 },
  importBtnText: { color: t.cta2Text, fontSize: 12, fontFamily: fonts[700] },
  addBtn: { backgroundColor: t.ctaBg, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  importRosterBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.ctaBg, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 13, marginTop: 16 },
  importRosterBtnText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 14 },
  importRosterHint: { color: t.muted2, fontSize: 12, marginTop: 10 },
  teamsRow: { marginBottom: 16, flexGrow: 0 },
  teamChip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  teamChipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  teamChipText: { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  teamChipTextActive: { color: t.ctaText },
  newTeamChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: t.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, borderStyle: 'dashed' },
  newTeamText: { color: t.accent, fontSize: 13, fontFamily: fonts[700] },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: t.card, marginHorizontal: 16, marginBottom: 10,
    borderRadius: 18, padding: 16, borderWidth: 1, borderColor: t.cardBorder,
  },
  cardLeft: { flex: 1 },
  playerName: { color: t.ink, fontSize: 16, fontFamily: fonts[700] },
  playerMeta: { color: t.muted, fontSize: 12, marginTop: 2 },
  emptyWrap: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: t.muted, textAlign: 'center', paddingHorizontal: 32 },
  modalOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  modal: { backgroundColor: t.sheet, borderRadius: 20, padding: 24, margin: 16, borderWidth: 1, borderColor: t.cardBorder },
  modalTitle: { color: t.ink, fontSize: 20, fontFamily: fonts[800], marginBottom: 4 },
  modalSub: { color: t.muted, fontSize: 12, marginBottom: 12 },
  input: { backgroundColor: t.chip, borderRadius: 14, padding: 14, color: t.ink, fontSize: 14, marginBottom: 10, borderWidth: 1, borderColor: t.line },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 999, borderWidth: 1, borderColor: t.cta2Border, alignItems: 'center' },
  cancelText: { color: t.cta2Text, fontFamily: fonts[700] },
  saveBtn: { flex: 1, padding: 14, borderRadius: 999, backgroundColor: t.ctaBg, alignItems: 'center' },
  saveText: { color: t.ctaText, fontFamily: fonts[700] },
});
