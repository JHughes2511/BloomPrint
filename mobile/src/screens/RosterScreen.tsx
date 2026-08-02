import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Modal, Alert, KeyboardAvoidingView, Platform, ScrollView, RefreshControl,
} from 'react-native';

import { COMPETITION_LEVELS as CANON_LEVELS } from '../constants/levels';
const COMPETITION_LEVELS = [...CANON_LEVELS];

function LevelDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const { t } = useTheme();
  const { t: tr } = useTranslation();
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
            <Text style={ddStyles.menuTitle}>{tr('roster.competitionLevel')}</Text>
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
  menu: { backgroundColor: t.sheet, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(560)},
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
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { titleTopPad } from '../responsive/screenPadding';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import { useBreakpoint } from '../responsive/useBreakpoint';
import { useTeam } from '../context/TeamContext';
import PageContainer from '../responsive/PageContainer';
import { sheetCap, desktopOnly, useSheetScrollHeight } from '../responsive/modalSizes';

export default function RosterScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  // Definite height for the sheet body on web; ignored on native.
  const sheetBody = useSheetScrollHeight(420);
  const { t: tr } = useTranslation();
  const { coach } = useAuth();
  const defaultLevel = (coach as any)?.competition_level ?? 'HS Varsity';
  const styles = makeStyles(t);
  const { isPhone } = useBreakpoint();
  // Team scope is app-wide now: picking a team in the sidebar filters here too,
  // and picking one here is remembered when the coach moves to another screen.
  const { teams, currentTeamId, setCurrentTeamId, reloadTeams } = useTeam();

  // Columns are fitted to the measured width rather than to a breakpoint, so
  // an in-between window never leaves a stretched card or a cramped one. The
  // grid is the only thing that knows how much room it actually got — the
  // sidebar takes a fixed slice out of the window, so window width alone
  // would over-count on desktop.
  const [gridWidth, setGridWidth] = useState(0);

  // Column count and card width are solved together, from the space the grid
  // actually has. Fitting the count first and sizing cards with a percentage
  // afterwards does not work: five columns at 20% each plus four 12px gaps is
  // wider than the row, so the last card ran off the right edge. Subtracting
  // the gutters before dividing gives cards that are exactly equal and always
  // fit — and it settles the 4-vs-5 question by measurement rather than taste.
  const GRID_GAP = 12;
  const GRID_PAD = 8;            // columnWrapperStyle paddingHorizontal, both sides
  const TARGET_CARD = 300;
  const usable = Math.max(0, gridWidth - GRID_PAD);
  const gridColumns = usable === 0
    ? 1
    : Math.max(1, Math.min(6, Math.floor((usable + GRID_GAP) / (TARGET_CARD + GRID_GAP))));
  const cardWidth = usable === 0
    ? undefined
    : Math.floor((usable - GRID_GAP * (gridColumns - 1)) / gridColumns);

  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

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
  const [newLevel, setNewLevel] = useState(defaultLevel);
  const [parentPermission, setParentPermission] = useState(false);
  const [newTeamId, setNewTeamId] = useState<number | null>(null);
  const [showAddTeamPicker, setShowAddTeamPicker] = useState(false);
  const [editTeam, setEditTeam] = useState<Team | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [saving, setSaving] = useState(false);

  // Create team modal
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamLevel, setNewTeamLevel] = useState(defaultLevel);
  const [creatingTeam, setCreatingTeam] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const load = async () => {
    try {
      const [, p] = await Promise.all([reloadTeams(), playersAPI.list()]);
      setPlayers(p);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const teamFilteredPlayers = currentTeamId == null
    ? players
    : players.filter(p => p.team_id === currentTeamId);

  const q = query.trim().toLowerCase();
  const visiblePlayers = q === ''
    ? teamFilteredPlayers
    : teamFilteredPlayers.filter(p =>
        [p.name, p.position, p.team_name, p.competition_level]
          .some(field => (field ?? '').toLowerCase().includes(q))
      );

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
        team_id: newTeamId ?? undefined,
      });
      setShowAdd(false);
      setNewName(''); setNewPos(''); setNewJersey(''); setNewHeight(''); setNewWingspan('');
      setNewWeight(''); setNewStandingReach('');
      setNewSchool(''); setNewCity(''); setNewState(''); setNewCountry('');
      setParentPermission(false);
      load();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('roster.couldNotAddPlayer'));
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
      setNewTeamName(''); setNewTeamLevel(defaultLevel);
      // Optimistically add team to list immediately, then refresh
      await reloadTeams();
      setCurrentTeamId(team.id);
      load();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('roster.couldNotCreateTeam'));
    } finally {
      setCreatingTeam(false);
    }
  };

  const deleteTeam = (team: Team) => {
    Alert.alert(tr('roster.deleteTeamTitle'), tr('roster.deleteTeamMsg', { name: team.name }), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('common.delete'), style: 'destructive',
        onPress: async () => {
          try {
            await teamsAPI.delete(team.id);
            await reloadTeams();
            if (currentTeamId === team.id) setCurrentTeamId(null);
            load();
          } catch (e: any) {
            Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('roster.couldNotDeleteTeam'));
          }
        },
      },
    ]);
  };

  const manageTeam = (team: Team) => {
    Alert.alert(team.name, tr('roster.manageTeam'), [
      { text: tr('common.rename'), onPress: () => { setEditTeam(team); setEditTeamName(team.name); } },
      { text: tr('common.delete'), style: 'destructive', onPress: () => deleteTeam(team) },
      { text: tr('common.cancel'), style: 'cancel' },
    ]);
  };

  const saveTeamName = async () => {
    if (!editTeam || !editTeamName.trim()) return;
    setSavingTeam(true);
    try {
      await teamsAPI.update(editTeam.id, { name: editTeamName.trim() });
      await reloadTeams();
      setEditTeam(null);
      setEditTeamName('');
      load();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('roster.couldNotRenameTeam'));
    } finally {
      setSavingTeam(false);
    }
  };

  const currentTeamName = teams.find(t => t.id === currentTeamId)?.name;

  if (loading) return <ScreenBackground><View style={styles.center}><ActivityIndicator color={t.accent} size="large" /></View></ScreenBackground>;

  return (
    <ScreenBackground>
    <PageContainer padded={false} maxWidth={1600}>
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {/* Translated titles run 20-40% longer than English. Wrap to a second
            line rather than clipping — a truncated heading tells the coach
            less than a taller one costs them. */}
        <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
          <Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
            {tr('roster.title')}
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {currentTeamName ?? tr('roster.allTeams')} · {tr('roster.playersCount', { count: visiblePlayers.length })}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.searchBtn}
            onPress={() => setSearchOpen(o => {
              const next = !o;
              if (!next) setQuery('');
              return next;
            })}
          >
            <Ionicons name={searchOpen ? 'search' : 'search-outline'} size={18} color={searchOpen ? t.accent : t.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.importBtn} onPress={() => navigation.navigate('Import', { mode: 'roster' })}>
            <Ionicons name="cloud-upload-outline" size={16} color={t.muted} />
            <Text style={styles.importBtnText} numberOfLines={1}>{tr('roster.importRoster')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addBtn} onPress={() => {
            setNewTeamId(currentTeamId);
            const selTeam = teams.find(tm => tm.id === currentTeamId);
            setNewLevel(selTeam?.competition_level || defaultLevel);
            setShowAddTeamPicker(false); setShowAdd(true);
          }}>
            <Ionicons name="add" size={22} color={t.ctaText} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search bar */}
      {searchOpen && (
        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={t.muted} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder={tr('roster.searchPlaceholder')}
            placeholderTextColor={t.muted2}
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={18} color={t.muted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Team filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.teamsRow} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}>
        <TouchableOpacity
          style={[styles.teamChip, currentTeamId == null && styles.teamChipActive]}
          onPress={() => setCurrentTeamId(null)}
        >
          <Text style={[styles.teamChipText, currentTeamId == null && styles.teamChipTextActive]}>{tr('roster.all')}</Text>
        </TouchableOpacity>
        {teams.filter((tm: any) => !tm.parent_team_id).map(tm => (
          <TouchableOpacity
            key={tm.id}
            style={[styles.teamChip, currentTeamId === tm.id && styles.teamChipActive]}
            onPress={() => setCurrentTeamId(tm.id)}
            onLongPress={() => manageTeam(tm)}
          >
            <Text style={[styles.teamChipText, currentTeamId === tm.id && styles.teamChipTextActive]}>{tm.name}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.newTeamChip} onPress={() => setShowNewTeam(true)}>
          <Ionicons name="add" size={14} color={t.accent} />
          <Text style={styles.newTeamText}>{tr('roster.newTeam')}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Player list. One column on a phone, a grid once there's room — a
          single column of cards on a wide screen wastes most of it and makes
          a 40-player roster far longer to scan than it needs to be. `key`
          changes with the column count because FlatList cannot change
          numColumns on an existing list. */}
      {/* Measured here, not from window width: the sidebar takes a fixed slice
          out of the window, so only the grid knows how much room it really got. */}
      <View style={{ flex: 1 }} onLayout={e => setGridWidth(e.nativeEvent.layout.width)}>
      <FlatList
        key={`roster-${gridColumns}`}
        numColumns={gridColumns}
        columnWrapperStyle={gridColumns > 1 ? { gap: 12, paddingHorizontal: 4 } : undefined}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={t.accent} />}
        data={visiblePlayers}
        keyExtractor={p => String(p.id)}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, gridColumns > 1 && styles.cardInGrid,
                    gridColumns > 1 && cardWidth ? { width: cardWidth, maxWidth: cardWidth } : null]}
            onPress={() => navigation.navigate('PlayerProfile', { playerId: item.id })}
            onLongPress={() => {
              Alert.alert(tr('roster.deletePlayerTitle'), tr('roster.deletePlayerMsg', { name: item.name }), [
                { text: tr('common.cancel'), style: 'cancel' },
                { text: tr('common.delete'), style: 'destructive', onPress: async () => {
                  try {
                    await playersAPI.delete(item.id);
                    load();
                  } catch (e: any) {
                    Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('roster.couldNotDeletePlayer'));
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
            <GradeBadge grade={item.bim_grade ?? item.latest_grade} size="md" />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            {teams.length === 0 ? (
              <Text style={styles.emptyText}>{tr('roster.emptyCreateTeamFirst')}</Text>
            ) : currentTeamId != null ? (
              <>
                <Ionicons name="people-outline" size={40} color={t.line} />
                <Text style={styles.emptyText}>{tr('roster.emptyNoPlayersInTeam')}</Text>
                <TouchableOpacity style={styles.importRosterBtn} onPress={() => navigation.navigate('Import', { mode: 'roster' })}>
                  <Ionicons name="cloud-upload-outline" size={16} color={t.ctaText} />
                  <Text style={styles.importRosterBtnText}>{tr('roster.importFromExcel')}</Text>
                </TouchableOpacity>
                <Text style={styles.importRosterHint}>{tr('roster.importOneByOneHint')}</Text>
              </>
            ) : (
              <Text style={styles.emptyText}>{tr('roster.emptyNoPlayers')}</Text>
            )}
          </View>
        }
      />
      </View>

      {/* Add Player Modal */}
      <Modal visible={showAdd} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'web' ? undefined : (Platform.OS === 'ios' ? 'padding' : 'height')}>
          <View style={[styles.modal, { maxHeight: '90%', flex: 0 },
                       // flex: 0 compiles to flex-basis: 0%, and in a column that wins
                       // over height — which is why the sheet collapsed to ~50px no
                       // matter what height it was given. Restoring an auto basis on
                       // web lets the height apply.
                       desktopOnly({ flexBasis: 'auto', height: sheetBody + 96 })]}>
          <KeyboardAwareScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true} style={desktopOnly({ height: sheetBody })} contentContainerStyle={{ paddingBottom: 16 }}>
            <Text style={styles.modalTitle}>{tr('roster.addPlayer')}</Text>
            <VoiceTextInput style={styles.input} placeholder={tr('roster.fullNamePlaceholder')} placeholderTextColor={t.muted}
              value={newName} onChangeText={setNewName} />

            {/* Team assignment */}
            <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[600], marginBottom: 6, marginTop: 4 }}>{tr('roster.teamLabel')}</Text>
            <TouchableOpacity
              style={[styles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: showAddTeamPicker ? 0 : 12 }]}
              onPress={() => setShowAddTeamPicker(v => !v)}
              activeOpacity={0.7}
            >
              <Text style={{ color: newTeamId == null ? t.muted : t.ink, fontSize: 15 }}>
                {newTeamId == null ? tr('roster.noTeam') : (teams.find(tm => tm.id === newTeamId)?.name ?? tr('roster.selectTeam'))}
              </Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{showAddTeamPicker ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {showAddTeamPicker && (
              <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
                <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 180 }}>
                  <TouchableOpacity
                    style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.line, backgroundColor: newTeamId == null ? t.accentSoft : 'transparent' }}
                    onPress={() => { setNewTeamId(null); setShowAddTeamPicker(false); }}
                  >
                    <Text style={{ color: newTeamId == null ? t.accent : t.inkSoft, fontSize: 14 }}>{tr('roster.noTeam')}</Text>
                  </TouchableOpacity>
                  {teams.filter((tm: any) => !tm.parent_team_id).map(tm => (
                    <TouchableOpacity
                      key={tm.id}
                      style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.line, backgroundColor: newTeamId === tm.id ? t.accentSoft : 'transparent' }}
                      onPress={() => { setNewTeamId(tm.id); if (tm.competition_level) setNewLevel(tm.competition_level); setShowAddTeamPicker(false); }}
                    >
                      <Text style={{ color: newTeamId === tm.id ? t.accent : t.inkSoft, fontSize: 14 }}>{tm.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={tr('roster.positionPlaceholder')} placeholderTextColor={t.muted}
                value={newPos} onChangeText={setNewPos} />
              <TextInput style={[styles.input, { flex: 1 }]} placeholder={tr('roster.jerseyPlaceholder')} placeholderTextColor={t.muted}
                keyboardType="number-pad" value={newJersey} onChangeText={setNewJersey} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={tr('roster.heightPlaceholder')} placeholderTextColor={t.muted}
                value={newHeight} onChangeText={setNewHeight} />
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={tr('roster.wingspanPlaceholder')} placeholderTextColor={t.muted}
                value={newWingspan} onChangeText={setNewWingspan} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={tr('roster.weightPlaceholder')} placeholderTextColor={t.muted}
                value={newWeight} onChangeText={setNewWeight} />
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={tr('roster.standingReachPlaceholder')} placeholderTextColor={t.muted}
                value={newStandingReach} onChangeText={setNewStandingReach} />
            </View>
            <VoiceTextInput style={styles.input} placeholder={tr('roster.schoolPlaceholder')} placeholderTextColor={t.muted}
              value={newSchool} onChangeText={setNewSchool} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={tr('roster.cityPlaceholder')} placeholderTextColor={t.muted}
                value={newCity} onChangeText={setNewCity} />
              <VoiceTextInput style={[styles.input, { flex: 1 }]} placeholder={tr('roster.statePlaceholder')} placeholderTextColor={t.muted}
                value={newState} onChangeText={setNewState} />
            </View>
            <VoiceTextInput style={styles.input} placeholder={tr('roster.countryPlaceholder')} placeholderTextColor={t.muted}
              value={newCountry} onChangeText={setNewCountry} />
            <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[600], marginBottom: 6, marginTop: 4 }}>{tr('roster.competitionLevel')}</Text>
            <LevelDropdown value={newLevel} onChange={setNewLevel} />

            {/* Parent/Guardian permission — required for minors */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 4 }}>
              <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[600] }}>{tr('roster.parentPermission')}</Text>
              <TouchableOpacity onPress={() => setShowDisclaimer(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 6 }}>
                <Ionicons name="information-circle-outline" size={16} color={t.accent} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8 }}>
              {tr('roster.parentPermissionHint')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
              <TouchableOpacity
                onPress={() => setParentPermission(true)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1,
                         backgroundColor: parentPermission ? t.positive : t.chip,
                         borderColor: parentPermission ? t.positive : t.line }}>
                <Text style={{ color: parentPermission ? '#16201A' : t.muted, fontFamily: fonts[700] }}>{tr('common.yes')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setParentPermission(false)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1,
                         backgroundColor: !parentPermission ? t.line : t.chip,
                         borderColor: !parentPermission ? t.muted : t.line }}>
                <Text style={{ color: !parentPermission ? t.ink : t.muted, fontFamily: fonts[700] }}>{tr('common.no')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={styles.cancelText}>{tr('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={addPlayer} disabled={saving}>
                {saving ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.saveText}>{tr('common.add')}</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
          </View>

          {/* Parent/Guardian consent disclaimer — an in-modal overlay, because a
              nested <Modal> won't present over an already-open Modal on iOS. */}
          {showDisclaimer && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.scrim, justifyContent: 'center', padding: 20 }}>
              <View style={{ backgroundColor: t.sheet, borderRadius: 16, padding: 20, maxHeight: '80%', borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(560) }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={t.accent} />
                  <Text style={{ color: t.ink, fontSize: 17, fontFamily: fonts[800], marginLeft: 8, flex: 1 }}>{tr('roster.consentTitle')}</Text>
                  <TouchableOpacity onPress={() => setShowDisclaimer(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={22} color={t.muted} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                  <Text style={{ color: t.inkSoft, fontSize: 13, lineHeight: 20 }}>
                    {tr('roster.consentBody')}
                  </Text>
                </ScrollView>
                <TouchableOpacity
                  style={{ marginTop: 16, backgroundColor: t.ctaBg, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
                  onPress={() => setShowDisclaimer(false)}>
                  <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>{tr('common.gotIt')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* Create Team Modal */}
      <Modal visible={showNewTeam} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'web' ? undefined : (Platform.OS === 'ios' ? 'padding' : 'height')}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{tr('roster.newTeam')}</Text>
            <VoiceTextInput style={styles.input} placeholder={tr('roster.teamNamePlaceholder')} placeholderTextColor={t.muted}
              value={newTeamName} onChangeText={setNewTeamName} />
            <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[600], marginBottom: 6 }}>{tr('roster.competitionLevel')}</Text>
            <LevelDropdown value={newTeamLevel} onChange={setNewTeamLevel} />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowNewTeam(false)}>
                <Text style={styles.cancelText}>{tr('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={createTeam} disabled={creatingTeam}>
                {creatingTeam ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.saveText}>{tr('common.create')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Rename Team Modal */}
      <Modal visible={!!editTeam} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'web' ? undefined : (Platform.OS === 'ios' ? 'padding' : 'height')}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{tr('roster.renameTeam')}</Text>
            <VoiceTextInput style={styles.input} placeholder={tr('roster.teamNamePlaceholder')} placeholderTextColor={t.muted}
              value={editTeamName} onChangeText={setEditTeamName} autoFocus />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setEditTeam(null); setEditTeamName(''); }}>
                <Text style={styles.cancelText}>{tr('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveTeamName} disabled={savingTeam || !editTeamName.trim()}>
                {savingTeam ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.saveText}>{tr('common.save')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    </PageContainer>
    </ScreenBackground>
  );
}

// One height for every pill in the teams row, so an icon in one of them
// cannot make it taller than the rest.
const CHIP_H = 34;

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, paddingTop: titleTopPad(56) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, marginBottom: 12 },
  // The row top-aligns so the title sits high, which pushed these against the
  // status bar and clipped them on the taller iPhones. Nudged down to clear it.
  headerActions: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0, marginTop: 6 },
  title: { fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6, color: t.ink },
  sub: { fontSize: 12, color: t.muted, marginTop: 2 },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: t.cta2Border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, flexShrink: 1, maxWidth: 150 },
  importBtnText: { color: t.cta2Text, fontSize: 12, fontFamily: fonts[700], flexShrink: 1 },
  searchBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center', marginRight: 8, flexShrink: 0 },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.chip, borderRadius: 14, borderWidth: 1, borderColor: t.line, paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 20, marginBottom: 12 },
  searchInput: { flex: 1, color: t.ink, fontSize: 14, padding: 0 },
  addBtn: { backgroundColor: t.ctaBg, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  importRosterBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.ctaBg, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 13, marginTop: 16 },
  importRosterBtnText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 14 },
  importRosterHint: { color: t.muted2, fontSize: 12, marginTop: 10 },
  teamsRow: { marginBottom: 16, flexGrow: 0 },
  // Both pills state a height rather than deriving one from padding. The New
  // Team pill carries an icon, and an icon glyph brings its own line box —
  // taller than the text's, so it drove the row height and the pill grew
  // beside its neighbours despite identical padding. A stated height cannot
  // be pushed around by what happens to be inside it.
  teamChip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 16, height: CHIP_H, justifyContent: 'center' },
  teamChipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  teamChipText: { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  teamChipTextActive: { color: t.ctaText },
  // Sits directly beside teamChip in the same row, so it matches its padding;
  // at 14 it was 2px narrower than its neighbours for no reason.
  newTeamChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: t.accent, borderRadius: 999, paddingHorizontal: 16, height: CHIP_H, borderStyle: 'dashed' },
  newTeamText: { color: t.accent, fontSize: 13, fontFamily: fonts[700] },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: t.card, marginHorizontal: 16, marginBottom: 10,
    borderRadius: 18, padding: 16, borderWidth: 1, borderColor: t.cardBorder,
  },
  // In a grid the row gap comes from columnWrapperStyle, so the card drops its
  // own horizontal margin and takes an equal share of the row instead.
  //
  // maxWidth matters on the LAST row: with flex alone, a row holding one
  // leftover player stretches that card across the full width and it stops
  // looking like part of the grid. The cap only binds when a row is short —
  // a full row is already narrower than its share once the gaps are removed.
  cardInGrid: { marginHorizontal: 0 },
  cardLeft: { flex: 1 },
  playerName: { color: t.ink, fontSize: 16, fontFamily: fonts[700] },
  playerMeta: { color: t.muted, fontSize: 12, marginTop: 2 },
  emptyWrap: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: t.muted, textAlign: 'center', paddingHorizontal: 32 },
  modalOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  // Native keeps exactly the margin it always had. The cap is web-only:
  // alignSelf: 'center' collapsed this sheet to a 14px sliver in a browser,
  // and marginHorizontal: 'auto' — the fix for that — is a CSS behaviour that
  // Yoga reads differently, where an auto cross-axis margin cancels stretch.
  // Neither belongs in a style a phone renders.
  modal: {
    backgroundColor: t.sheet, borderRadius: 20, padding: 24, margin: 16,
    borderWidth: 1, borderColor: t.cardBorder,
    ...sheetCap(560),
  },
  modalTitle: { color: t.ink, fontSize: 20, fontFamily: fonts[800], marginBottom: 4 },
  modalSub: { color: t.muted, fontSize: 12, marginBottom: 12 },
  input: { backgroundColor: t.chip, borderRadius: 14, padding: 14, color: t.ink, fontSize: 14, marginBottom: 10, borderWidth: 1, borderColor: t.line },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 999, borderWidth: 1, borderColor: t.cta2Border, alignItems: 'center' },
  cancelText: { color: t.cta2Text, fontFamily: fonts[700] },
  saveBtn: { flex: 1, padding: 14, borderRadius: 999, backgroundColor: t.ctaBg, alignItems: 'center' },
  saveText: { color: t.ctaText, fontFamily: fonts[700] },
});
