import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import LanguagePicker from '../components/LanguagePicker';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import { useAuth } from '../context/AuthContext';
import { teamStaffAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

// Wizard fields — labels/descs/chips come from the `onboarding.fields.*`
// translation keys. Keys match the backend coach_context field keys.
const FIELD_KEYS = [
  'offensive_system',
  'defensive_system',
  'archetypes',
  'development',
  'recruiting',
  'culture',
];

type FieldVal = { chips: string[]; text: string };

export default function OnboardingScreen() {
  const { coach, updateProfile } = useAuth();
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const styles = makeStyles(t);
  const totalPages = FIELD_KEYS.length + 1; // + team step
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

  const isTeamPage = page === FIELD_KEYS.length;
  const fieldKey = !isTeamPage ? FIELD_KEYS[page] : null;
  const fieldChips = fieldKey ? (tr(`onboarding.fields.${fieldKey}.chips`, { returnObjects: true }) as string[]) : [];
  const val = fieldKey ? (values[fieldKey] ?? { chips: [], text: '' }) : { chips: [], text: '' };

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
    } catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('onboarding.couldNotJoin')); }
    finally { setJoining(null); }
  };
  const joinSubteam = async (sub: any) => {
    setJoining(sub.id);
    try { await teamStaffAPI.join(sub.id); Alert.alert(tr('onboarding.joinedTitle'), tr('onboarding.joinedMsg', { name: sub.name })); }
    catch (e: any) { Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('onboarding.couldNotJoin')); }
    finally { setJoining(null); }
  };

  const finish = async () => {
    setSaving(true);
    try {
      const sp: Record<string, string> = { ...(coach?.system_profile ?? {}) };
      FIELD_KEYS.forEach(k => {
        const v = values[k];
        if (!v) return;
        const parts = [v.chips.join(', '), (v.text || '').trim()].filter(Boolean);
        if (parts.length) sp[k] = parts.join('. ');
      });
      await updateProfile({ system_profile: sp, onboarded: true });
      // When re-run from Profile, pop back; on first-run the Root re-renders
      // into the app once onboarded flips true.
      if (navigation.canGoBack()) navigation.goBack();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('onboarding.couldNotFinish'));
      setSaving(false);
    }
  };

  const next = () => { if (page < totalPages - 1) setPage(p => p + 1); else finish(); };
  const back = () => { if (page > 0) setPage(p => p - 1); };

  return (
    <ScreenBackground>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            {/* Long translations must shrink beside the language picker, not push it off-screen. */}
            <Text style={styles.stepLabel} numberOfLines={1}>{tr('onboarding.step', { current: page + 1, total: totalPages })}</Text>
            <LanguagePicker compact onChanged={(code) => { updateProfile({ preferred_language: code } as any).catch(() => {}); }} />
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((page + 1) / totalPages) * 100}%` }]} />
          </View>
        </View>

        <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 22, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {fieldKey ? (
            <>
              <Text style={styles.title} numberOfLines={1}>{tr(`onboarding.fields.${fieldKey}.label`)}</Text>
              <Text style={styles.desc}>{tr(`onboarding.fields.${fieldKey}.desc`)}</Text>
              <Text style={styles.subLabel} numberOfLines={1}>{tr('onboarding.selectAllThatApply')}</Text>
              <View style={styles.chipWrap}>
                {fieldChips.map(chip => {
                  const on = val.chips.includes(chip);
                  return (
                    <TouchableOpacity key={chip} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleChip(fieldKey, chip)}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{chip}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.subLabel} numberOfLines={1}>{tr('onboarding.addYourOwnDetails')}</Text>
              <VoiceTextInput
                style={styles.input}
                placeholder={tr('onboarding.detailsPlaceholder')}
                placeholderTextColor={t.muted2}
                value={val.text}
                onChangeText={txt => setText(fieldKey, txt)}
                multiline
                textAlignVertical="top"
              />
            </>
          ) : (
            <>
              <Text style={styles.title} numberOfLines={1}>{tr('onboarding.joinTeamTitle')}</Text>
              <Text style={styles.desc}>{tr('onboarding.joinTeamDesc')}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                <TextInput
                  style={[styles.input, { flex: 1, minHeight: 46 }]}
                  placeholder={tr('onboarding.teamSearchPlaceholder')}
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
                  <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                    <Text style={styles.teamName} numberOfLines={1}>{team.name}</Text>
                    {team.coach_name && <Text style={styles.teamSub} numberOfLines={1}>{tr('onboarding.headCoach', { name: team.coach_name })}</Text>}
                  </View>
                  <TouchableOpacity style={styles.joinBtn} onPress={() => joinTeam(team)} disabled={joining === team.id}>
                    {joining === team.id ? <ActivityIndicator color={t.ctaText} size="small" /> : <Text style={styles.joinText} numberOfLines={1}>{tr('onboarding.join')}</Text>}
                  </TouchableOpacity>
                </View>
              ))}
              {joinedTeam && (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.subLabel}>{tr('onboarding.joinedSubteamPrompt', { name: joinedTeam.name })}</Text>
                  {subteams.length === 0 && <Text style={styles.teamSub}>{tr('onboarding.noSubteams')}</Text>}
                  {subteams.map(sub => (
                    <View key={sub.id} style={styles.teamRow}>
                      <Text style={[styles.teamName, { flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }]} numberOfLines={1}>{sub.name}</Text>
                      <TouchableOpacity style={styles.joinBtn} onPress={() => joinSubteam(sub)} disabled={joining === sub.id}>
                        {joining === sub.id ? <ActivityIndicator color={t.ctaText} size="small" /> : <Text style={styles.joinText} numberOfLines={1}>{tr('onboarding.join')}</Text>}
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
            <TouchableOpacity style={styles.backBtn} onPress={back}><Text style={styles.backText} numberOfLines={1}>{tr('common.back')}</Text></TouchableOpacity>
          ) : <View style={{ flex: 1 }} />}
          {!isTeamPage && (
            <TouchableOpacity style={styles.skipBtn} onPress={next}><Text style={styles.skipText} numberOfLines={1}>{tr('common.skip')}</Text></TouchableOpacity>
          )}
          <TouchableOpacity style={styles.nextBtn} onPress={next} disabled={saving}>
            {saving ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.nextText} numberOfLines={1}>{isTeamPage ? tr('onboarding.finish') : tr('common.next')}</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  header: { paddingHorizontal: 22, paddingTop: 60, paddingBottom: 8 },
  stepLabel: { color: t.muted, fontSize: 12, fontFamily: fonts[700], marginBottom: 8, flexShrink: 1, minWidth: 0, marginRight: 8 },
  progressTrack: { height: 6, borderRadius: 999, backgroundColor: t.chip, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: t.accent, borderRadius: 999 },
  title: { color: t.ink, fontSize: 26, fontFamily: fonts[900], letterSpacing: -0.5 },
  desc: { color: t.muted, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  subLabel: { color: t.label, fontSize: 11, fontFamily: fonts[700], letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 8, marginBottom: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: t.line, backgroundColor: t.card, flexShrink: 1, maxWidth: '100%' },
  chipOn: { backgroundColor: t.accentSoft, borderColor: t.accent },
  chipText: { color: t.inkSoft, fontSize: 13.5, fontFamily: fonts[600], flexShrink: 1 },
  chipTextOn: { color: t.accent, fontFamily: fonts[700] },
  input: { backgroundColor: t.card, borderRadius: 12, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line, minHeight: 80, marginTop: 4 },
  searchBtn: { backgroundColor: t.ctaBg, borderRadius: 12, width: 48, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  teamRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 12, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: t.cardBorder },
  teamName: { color: t.ink, fontSize: 15, fontFamily: fonts[700] },
  teamSub: { color: t.muted, fontSize: 12, marginTop: 2 },
  joinBtn: { backgroundColor: t.ctaBg, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, flexShrink: 0 },
  joinText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 13 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 22, paddingVertical: 14, borderTopWidth: 1, borderTopColor: t.divider },
  backBtn: { flex: 1, flexShrink: 1, minWidth: 0, paddingVertical: 14, alignItems: 'flex-start' },
  backText: { color: t.muted, fontFamily: fonts[700], fontSize: 15 },
  skipBtn: { paddingVertical: 14, paddingHorizontal: 14, flexShrink: 1 },
  skipText: { color: t.muted2, fontFamily: fonts[700], fontSize: 15 },
  nextBtn: { backgroundColor: t.ctaBg, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 34, alignItems: 'center', flexShrink: 1 },
  nextText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15, flexShrink: 1 },
});
