import React, { useState, useRef, useEffect } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { evalsAPI, gameEvalAPI } from '../api/client';
import { OutputType } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

const OUTPUT_TYPES: { key: OutputType; label: string }[] = [
  { key: 'player_eval',        label: 'Player Eval' },
  { key: 'film_breakdown',     label: 'Film Breakdown' },
  { key: 'scouting_report',    label: 'Scouting Report' },
  { key: 'coaching_report',    label: 'Coaching Report' },
  { key: 'game_analysis',      label: 'Game Analysis' },
  { key: 'box_score',          label: 'Box Score' },
  { key: 'training_program',   label: 'Training Program' },
  { key: 'recruitment_profile', label: 'Recruitment' },
  { key: 'position_analysis',  label: 'Position Analysis' },
];

export default function NewEvalScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { playerId, playerName } = route.params;
  const { t } = useTheme();
  const styles = makeStyles(t);

  // comma-separated when multiple types are combined into one comprehensive eval
  const [outputType, setOutputType] = useState<string>('player_eval');
  const [coachNotes, setCoachNotes] = useState('');
  const [focusPrompt, setFocusPrompt] = useState('');
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Box-score tracked games (loaded when Box Score is selected)
  const wantsBoxScore = outputType.split(',').includes('box_score');
  const [games, setGames] = useState<any[]>([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const [seasonYear, setSeasonYear] = useState<string>('all');
  const [seasonPhase, setSeasonPhase] = useState<string>('all');
  const [selectedGameIds, setSelectedGameIds] = useState<number[]>([]);

  useEffect(() => {
    if (wantsBoxScore && !gamesLoaded && playerName) {
      gameEvalAPI.playerGameHistory(playerName)
        .then((g: any[]) => setGames(Array.isArray(g) ? g : []))
        .catch(() => setGames([]))
        .finally(() => setGamesLoaded(true));
    }
  }, [wantsBoxScore, gamesLoaded, playerName]);

  // Season = coach's Season Year field, falling back to the game-date year.
  const gameSeason = (g: any) => (g.season_year || (g.year != null ? String(g.year) : '')) || '';
  const seasonYears = ['all', ...Array.from(new Set(games.map(gameSeason).filter(Boolean)))];
  const seasonPhases = ['all', ...Array.from(new Set(games.map(g => g.season_phase).filter(Boolean)))];
  const filteredGames = games.filter(g =>
    (seasonYear === 'all' || gameSeason(g) === seasonYear) &&
    (seasonPhase === 'all' || g.season_phase === seasonPhase),
  );
  const allFilteredSelected = filteredGames.length > 0 && filteredGames.every(g => selectedGameIds.includes(g.game_id));

  const pickVideo = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 1,
    });
    if (!res.canceled && res.assets[0]) {
      setVideoUri(res.assets[0].uri);
      setVideoName(res.assets[0].fileName ?? 'video.mp4');
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('player_id', String(playerId));
      form.append('output_type', outputType);
      form.append('coach_notes', coachNotes);
      form.append('focus_prompt', focusPrompt);
      form.append('include_audio', 'false');
      if (wantsBoxScore && selectedGameIds.length) form.append('game_ids', selectedGameIds.join(','));
      if (videoUri) form.append('video', { uri: videoUri, name: videoName, type: 'video/mp4' } as any);

      const res = await evalsAPI.submit(form);
      // Video uploads process in the background and return a job id; poll for it.
      const ev = res?.job_id ? await evalsAPI.awaitJob(res.job_id) : res;
      if (!ev?.id) throw new Error('No evaluation returned');
      navigation.replace('EvalReport', { evalId: ev.id });
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? e?.message ?? 'Evaluation failed. Check API connection.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenBackground>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={undefined}
    >
    <KeyboardAwareScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 100 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={t.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>New Evaluation</Text>
          <Text style={styles.sub}>{playerName}</Text>
        </View>
      </View>

      {/* Output type selector — combine multiple for a comprehensive eval */}
      <Text style={styles.label}>Report Type</Text>
      <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8, marginLeft: 2 }}>
        Tap multiple to combine them into one comprehensive report.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        {OUTPUT_TYPES.map(t => {
          const selected = outputType.split(',').filter(Boolean);
          const isOn = selected.includes(t.key);
          return (
          <TouchableOpacity
            key={t.key}
            style={[styles.typeChip, isOn && styles.typeChipActive]}
            onPress={() => {
              const next = isOn ? selected.filter(k => k !== t.key) : [...selected, t.key];
              setOutputType((next.length ? next : [t.key]).join(','));
            }}
          >
            <Text style={[styles.typeLabel, isOn && styles.typeLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Box Score — tracked game selection */}
      {wantsBoxScore && (
        <View style={{ marginBottom: 20 }}>
          <Text style={styles.label}>Tracked Games (Box Score)</Text>
          <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8, marginLeft: 2 }}>
            Pick a season/type and select one or more tracked games — their real stats are attached to the report.
          </Text>
          {!gamesLoaded ? (
            <ActivityIndicator color={t.accent} style={{ marginVertical: 12 }} />
          ) : games.length === 0 ? (
            <Text style={{ color: t.muted2, fontSize: 12, paddingVertical: 8 }}>
              No tracked games for {playerName} yet. Track games in Team Grade first.
            </Text>
          ) : (
            <>
              {/* Season filter */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {seasonYears.map(y => (
                  <TouchableOpacity key={y} style={[styles.typeChip, seasonYear === y && styles.typeChipActive]} onPress={() => setSeasonYear(y)}>
                    <Text style={[styles.typeLabel, seasonYear === y && styles.typeLabelActive]}>{y === 'all' ? 'All Seasons' : y}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {/* Season type filter */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {seasonPhases.map(p => (
                  <TouchableOpacity key={p} style={[styles.typeChip, seasonPhase === p && styles.typeChipActive]} onPress={() => setSeasonPhase(p)}>
                    <Text style={[styles.typeLabel, seasonPhase === p && styles.typeLabelActive]}>{p === 'all' ? 'All Types' : p.charAt(0).toUpperCase() + p.slice(1)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {/* Select all in filter */}
              {filteredGames.length > 0 && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}
                  onPress={() => {
                    const ids = filteredGames.map(g => g.game_id);
                    setSelectedGameIds(prev => allFilteredSelected
                      ? prev.filter(id => !ids.includes(id))
                      : Array.from(new Set([...prev, ...ids])));
                  }}
                >
                  <Ionicons name={allFilteredSelected ? 'checkbox' : 'square-outline'} size={20} color={allFilteredSelected ? t.accent : t.muted2} />
                  <Text style={{ color: t.inkSoft, fontSize: 13, fontFamily: fonts[700] }}>Select all shown ({filteredGames.length})</Text>
                </TouchableOpacity>
              )}
              {filteredGames.map(g => {
                const on = selectedGameIds.includes(g.game_id);
                return (
                  <TouchableOpacity key={g.game_id}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.divider }}
                    onPress={() => setSelectedGameIds(prev => on ? prev.filter(id => id !== g.game_id) : [...prev, g.game_id])}
                  >
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? t.accent : t.muted2} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[600] }}>vs {g.opponent_name}</Text>
                      <Text style={{ color: t.muted2, fontSize: 11 }}>
                        {g.date ?? ''}{g.season_phase ? ` · ${g.season_phase}` : ''}{g.game_grade != null ? ` · Grade ${g.game_grade}` : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              {selectedGameIds.length > 0 && (
                <Text style={{ color: t.accent, fontSize: 12, marginTop: 8, fontFamily: fonts[700] }}>{selectedGameIds.length} game{selectedGameIds.length > 1 ? 's' : ''} selected</Text>
              )}
            </>
          )}
        </View>
      )}

      {/* Video picker */}
      <Text style={styles.label}>Video Clip (optional)</Text>
      <TouchableOpacity style={[styles.videoPicker, videoUri && styles.videoPickerDone]} onPress={pickVideo}>
        <Ionicons name={videoUri ? 'checkmark-circle' : 'cloud-upload-outline'} size={28} color={videoUri ? t.positive : t.muted} />
        <Text style={[styles.videoPickerText, videoUri && { color: t.positive }]}>
          {videoUri ? videoName : 'Tap to select video (optional)'}
        </Text>
      </TouchableOpacity>

      {/* Coach notes */}
      <Text style={styles.label}>Coach Notes</Text>
      <VoiceTextInput
        style={[styles.input, { height: 100 }]}
        placeholder="e.g. Elite catch and shoot, plays at one pace, need to see more P&R midrange..."
        placeholderTextColor={t.muted2}
        value={coachNotes}
        onChangeText={setCoachNotes}
        multiline
        textAlignVertical="top"
      />

      {/* Focus */}
      <Text style={styles.label}>Focus (optional)</Text>
      <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8, marginLeft: 2 }}>
        Center the report on a person, matchup, action, or situation.
      </Text>
      <VoiceTextInput
        style={[styles.input, { height: 80 }]}
        placeholder="e.g. Focus on the two guards' P&R defense; grade the 4's spacing on the weak side"
        placeholderTextColor={t.muted2}
        value={focusPrompt}
        onChangeText={setFocusPrompt}
        multiline
        textAlignVertical="top"

      />

      <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
        {submitting
          ? <><ActivityIndicator color={t.ctaText} /><Text style={styles.submitText}>  Analyzing...</Text></>
          : <><Ionicons name="analytics" size={18} color={t.ctaText} /><Text style={styles.submitText}>  Run BIM Analysis</Text></>
        }
      </TouchableOpacity>

      {submitting && (
        <Text style={styles.hint}>Uploading and analyzing with Claude. Long films are processed in the background — keep this screen open; it may take several minutes.</Text>
      )}
    </KeyboardAwareScrollView>
    </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 56 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  title: { color: t.ink, fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6 },
  sub: { color: t.muted, fontSize: 12, marginTop: 2 },
  label: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 },
  typeChip: {
    borderWidth: 1, borderColor: t.line, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 9, marginRight: 8,
  },
  typeChipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  typeLabel: { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  typeLabelActive: { color: t.ctaText },
  videoPicker: {
    borderWidth: 2, borderColor: t.line, borderStyle: 'dashed', borderRadius: 16,
    padding: 24, alignItems: 'center', marginBottom: 20, gap: 8,
  },
  videoPickerDone: { borderColor: t.positive, borderStyle: 'solid' },
  videoPickerText: { color: t.muted, fontSize: 14 },
  input: {
    backgroundColor: t.card, borderRadius: 14, padding: 14,
    color: t.ink, fontSize: 14, marginBottom: 16, borderWidth: 1, borderColor: t.line,
  },
  submitBtn: {
    backgroundColor: t.ctaBg, borderRadius: 999, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 16 },
  hint: { color: t.muted2, fontSize: 12, textAlign: 'center', marginTop: 12 },
});
