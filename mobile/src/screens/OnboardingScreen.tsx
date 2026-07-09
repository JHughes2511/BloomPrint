import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import { useAuth } from '../context/AuthContext';
import { teamStaffAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

// Draft preset chips per field — refine later.
const FIELDS = [
  { key: 'offensive_system', label: 'Offensive System', desc: 'How your team plays on offense — pace, spacing, primary actions.',
    chips: ['Motion', 'Ball-screen heavy', 'Pace-and-space', 'Princeton', 'Dribble-drive', 'Triangle', 'Flex', 'Read-and-react', 'Transition / Run', 'Five-out', 'Horns', 'Post-centric'] },
  { key: 'defensive_system', label: 'Defensive System', desc: 'Your defensive identity and coverages.',
    chips: ['Man-to-man', 'Pack-line', 'Switch everything', 'Drop coverage', 'Hedge / Blitz', '2-3 zone', '3-2 zone', '1-3-1 zone', 'Full-court press', 'Half-court trap', 'No-middle', 'Force baseline'] },
  { key: 'archetypes', label: 'Player Archetypes You Value', desc: 'The kinds of players you recruit and develop for.',
    chips: ['3&D wings', 'Positionless bigs', 'Rim protectors', 'Secondary creators', 'Two-way guards', 'Stretch bigs', 'Point-of-attack defenders', 'High-motor connectors', 'Shot creators', 'Floor generals'] },
  { key: 'development', label: 'Development / Training Philosophy', desc: 'How you build players.',
    chips: ['Skill-first', 'Strength & conditioning', 'Film / IQ', 'Shooting mechanics', 'Individual workouts', 'Load management', 'Positionless development', 'Habits & fundamentals'] },
  { key: 'recruiting', label: 'Recruiting Lens', desc: 'Where and how you recruit, and what swings your evaluation.',
    chips: ['High school', 'AAU / club', 'JUCO', 'Transfer portal', 'International', 'Prep school', 'Local / regional', 'National', 'Character-first', 'Upside / projection', 'Immediate impact'] },
  { key: 'culture', label: 'Culture / Non-Negotiables', desc: 'The standards and intangibles you weight heavily.',
    chips: ['Accountability', 'Toughness', 'Selflessness', 'Competitiveness', 'Discipline', 'Coachability', 'Work ethic', 'Communication', 'Family / brotherhood', 'Detail-oriented'] },
];

type FieldVal = { chips: string[]; text: string };

export default function OnboardingScreen() {
  const { coach, updateProfile } = useAuth();
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const totalPages = FIELDS.length + 1; // + team step
  const [page, setPage] = useState(0);
  const [values, setValues] = useState<Record<string, FieldVal>>({});
  const [saving, setSaving] = useState(false);

  // Team step state
  const [teamSearch, setTeamSearch] = useState('');
  const [teamResults, setTeamResults] = useState<any[]>([]);
  const [teamSearching, setTeamSearching] = useState(false);
  const [joinedTeam, setJoinedTeam] = useState<any | null>(null);
  const [subteams, setSubteams] = useState<any[]>([]);
  const [joining, setJoining] = useState<number | null>(null);

  const isTeamPage = page === FIELDS.length;
  const field = !isTeamPage ? FIELDS[page] : null;
  const val = field ? (values[field.key] ?? { chips: [], text: '' }) : { chips: [], text: '' };

  const toggleChip = (key: string, chip: string) => {
    setValues(prev => {
      const cur = prev[key] ?? { chips: [], text: '' };
      const chips = cur.chips.includes(chip) ? cur.chips.filter(c => c !== chip) : [...cur.chips, chip];
      return { ...prev, [key]: { ...cur, chips } };
    });
  };
  const setText = (key: string, text: string) => {
    setValues(prev => ({ ...prev, [key]: { ...(prev[key] ?? { chips: [], text: '' }), text } }));
  };

  const searchTeams = async () => {
    if (!teamSearch.trim()) return;
    setTeamSearching(true);
    try { setTeamResults(await teamStaffAPI.search(teamSearch.trim())); } catch {}
    setTeamSearching(false);
  };
  const joinTeam = async (team: any) => {
    setJoining(team.id);
    try {
      await teamStaffAPI.join(team.id);
      setJoinedTeam(team);
      try { setSubteams(await teamStaffAPI.subteams(team.id)); } catch { setSubteams([]); }
    } catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not join.'); }
    finally { setJoining(null); }
  };
  const joinSubteam = async (sub: any) => {
    setJoining(sub.id);
    try { await teamStaffAPI.join(sub.id); Alert.alert('Joined', `You joined ${sub.name}.`); }
    catch (e: any) { Alert.alert('Error', e?.response?.data?.detail ?? 'Could not join.'); }
    finally { setJoining(null); }
  };

  const finish = async () => {
    setSaving(true);
    try {
      const sp: Record<string, string> = { ...(coach?.system_profile ?? {}) };
      FIELDS.forEach(f => {
        const v = values[f.key];
        if (!v) return;
        const parts = [v.chips.join(', '), (v.text || '').trim()].filter(Boolean);
        if (parts.length) sp[f.key] = parts.join('. ');
      });
      await updateProfile({ system_profile: sp, onboarded: true });
      // When re-run from Profile, pop back; on first-run the Root re-renders
      // into the app once onboarded flips true.
      if (navigation.canGoBack()) navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not finish setup.');
      setSaving(false);
    }
  };

  const next = () => { if (page < totalPages - 1) setPage(p => p + 1); else finish(); };
  const back = () => { if (page > 0) setPage(p => p - 1); };

  return (
    <ScreenBackground>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={styles.stepLabel}>Step {page + 1} of {totalPages}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((page + 1) / totalPages) * 100}%` }]} />
          </View>
        </View>

        <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 22, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {field ? (
            <>
              <Text style={styles.title}>{field.label}</Text>
              <Text style={styles.desc}>{field.desc}</Text>
              <Text style={styles.subLabel}>Select all that apply</Text>
              <View style={styles.chipWrap}>
                {field.chips.map(chip => {
                  const on = val.chips.includes(chip);
                  return (
                    <TouchableOpacity key={chip} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleChip(field.key, chip)}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{chip}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.subLabel}>Add your own details</Text>
              <VoiceTextInput
                style={styles.input}
                placeholder="Type or dictate anything specific to how YOU do this…"
                placeholderTextColor={t.muted2}
                value={val.text}
                onChangeText={txt => setText(field.key, txt)}
                multiline
                textAlignVertical="top"
              />
            </>
          ) : (
            <>
              <Text style={styles.title}>Join your team</Text>
              <Text style={styles.desc}>Search for your team to join its staff. You can also do this later, or continue without a team.</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                <TextInput
                  style={[styles.input, { flex: 1, minHeight: 46 }]}
                  placeholder="Search by team name..."
                  placeholderTextColor={t.muted2}
                  value={teamSearch}
                  onChangeText={setTeamSearch}
                  onSubmitEditing={searchTeams}
                  returnKeyType="search"
                />
                <TouchableOpacity style={styles.searchBtn} onPress={searchTeams} disabled={teamSearching}>
                  {teamSearching ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="search" size={18} color={t.ctaText} />}
                </TouchableOpacity>
              </View>
              {teamResults.map(team => (
                <View key={team.id} style={styles.teamRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.teamName}>{team.name}</Text>
                    {team.coach_name && <Text style={styles.teamSub}>Head Coach: {team.coach_name}</Text>}
                  </View>
                  <TouchableOpacity style={styles.joinBtn} onPress={() => joinTeam(team)} disabled={joining === team.id}>
                    {joining === team.id ? <ActivityIndicator color={t.ctaText} size="small" /> : <Text style={styles.joinText}>Join</Text>}
                  </TouchableOpacity>
                </View>
              ))}
              {joinedTeam && (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.subLabel}>Joined {joinedTeam.name}. Join a sub-team?</Text>
                  {subteams.length === 0 && <Text style={styles.teamSub}>No sub-teams available.</Text>}
                  {subteams.map(sub => (
                    <View key={sub.id} style={styles.teamRow}>
                      <Text style={[styles.teamName, { flex: 1 }]}>{sub.name}</Text>
                      <TouchableOpacity style={styles.joinBtn} onPress={() => joinSubteam(sub)} disabled={joining === sub.id}>
                        {joining === sub.id ? <ActivityIndicator color={t.ctaText} size="small" /> : <Text style={styles.joinText}>Join</Text>}
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </KeyboardAwareScrollView>

        <View style={styles.footer}>
          {page > 0 ? (
            <TouchableOpacity style={styles.backBtn} onPress={back}><Text style={styles.backText}>Back</Text></TouchableOpacity>
          ) : <View style={{ flex: 1 }} />}
          {!isTeamPage && (
            <TouchableOpacity style={styles.skipBtn} onPress={next}><Text style={styles.skipText}>Skip</Text></TouchableOpacity>
          )}
          <TouchableOpacity style={styles.nextBtn} onPress={next} disabled={saving}>
            {saving ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.nextText}>{isTeamPage ? 'Finish' : 'Next'}</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  header: { paddingHorizontal: 22, paddingTop: 60, paddingBottom: 8 },
  stepLabel: { color: t.muted, fontSize: 12, fontFamily: fonts[700], marginBottom: 8 },
  progressTrack: { height: 6, borderRadius: 999, backgroundColor: t.chip, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: t.accent, borderRadius: 999 },
  title: { color: t.ink, fontSize: 26, fontFamily: fonts[900], letterSpacing: -0.5 },
  desc: { color: t.muted, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  subLabel: { color: t.label, fontSize: 11, fontFamily: fonts[700], letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 8, marginBottom: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: t.line, backgroundColor: t.card },
  chipOn: { backgroundColor: t.accentSoft, borderColor: t.accent },
  chipText: { color: t.inkSoft, fontSize: 13.5, fontFamily: fonts[600] },
  chipTextOn: { color: t.accent, fontFamily: fonts[700] },
  input: { backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line, minHeight: 80, marginTop: 4 },
  searchBtn: { backgroundColor: t.ctaBg, borderRadius: 12, width: 48, alignItems: 'center', justifyContent: 'center' },
  teamRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 12, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: t.cardBorder },
  teamName: { color: t.ink, fontSize: 15, fontFamily: fonts[700] },
  teamSub: { color: t.muted, fontSize: 12, marginTop: 2 },
  joinBtn: { backgroundColor: t.ctaBg, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  joinText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 13 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 22, paddingVertical: 14, borderTopWidth: 1, borderTopColor: t.divider },
  backBtn: { flex: 1, paddingVertical: 14, alignItems: 'flex-start' },
  backText: { color: t.muted, fontFamily: fonts[700], fontSize: 15 },
  skipBtn: { paddingVertical: 14, paddingHorizontal: 14 },
  skipText: { color: t.muted2, fontFamily: fonts[700], fontSize: 15 },
  nextBtn: { backgroundColor: t.ctaBg, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 34, alignItems: 'center' },
  nextText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15 },
});
