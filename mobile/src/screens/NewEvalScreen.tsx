import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { evalsAPI, gameEvalAPI, playersAPI, uploadFileStreamed } from '../api/client';
import { OutputType } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import { GeneratingOverlay, parseGenProgress } from '../components/GeneratingBasketball';

// API output_type keys — labels are resolved at render via i18n.
const OUTPUT_TYPES: OutputType[] = [
  'player_eval', 'film_breakdown', 'scouting_report', 'coaching_report',
  'game_analysis', 'box_score', 'training_program', 'recruitment_profile',
  'position_analysis', 'matchup',
];

export default function NewEvalScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { playerId, playerName } = route.params;
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const styles = makeStyles(t);

  // comma-separated when multiple types are combined into one comprehensive eval
  const [outputType, setOutputType] = useState<string>('player_eval');
  const [coachNotes, setCoachNotes] = useState('');
  const [focusPrompt, setFocusPrompt] = useState('');
  const [videos, setVideos] = useState<{ uri: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState('');
  const [importingNotes, setImportingNotes] = useState(false);
  const [importingFocus, setImportingFocus] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Box-score tracked games (loaded when Box Score is selected)
  const wantsBoxScore = outputType.split(',').includes('box_score');
  const [games, setGames] = useState<any[]>([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const [seasonYear, setSeasonYear] = useState<string>('all');
  const [seasonPhase, setSeasonPhase] = useState<string>('all');
  const [selectedGameIds, setSelectedGameIds] = useState<number[]>([]);

  // Match Up: pick players to compare THIS player against (unlimited).
  const wantsMatchup = outputType.split(',').includes('matchup');
  const [rosterPlayers, setRosterPlayers] = useState<any[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [matchupIds, setMatchupIds] = useState<number[]>([]);
  const [matchupSearch, setMatchupSearch] = useState('');
  useEffect(() => {
    if (wantsMatchup && !rosterLoaded) {
      playersAPI.list()
        .then((p: any[]) => setRosterPlayers(Array.isArray(p) ? p.filter(x => x.id !== playerId) : []))
        .catch(() => setRosterPlayers([]))
        .finally(() => setRosterLoaded(true));
    }
  }, [wantsMatchup, rosterLoaded, playerId]);
  const matchupFiltered = rosterPlayers.filter(p =>
    !matchupSearch.trim() || (p.name || '').toLowerCase().includes(matchupSearch.trim().toLowerCase()));

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
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (!res.canceled && res.assets?.length) {
      const picked = res.assets.map((a, i) => ({ uri: a.uri, name: a.fileName ?? `film_${Date.now()}_${i}.mp4` }));
      setVideos(prev => [...prev, ...picked]);
    }
  };

  const importDoc = async (
    target: 'notes' | 'focus',
    setBusy: (v: boolean) => void,
    setValue: (fn: (prev: string) => string) => void,
  ) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setBusy(true);
      const { text } = await evalsAPI.extractDoc({
        uri: a.uri,
        name: a.name ?? 'document',
        type: a.mimeType ?? 'application/octet-stream',
      });
      const clean = (text ?? '').trim();
      if (!clean) {
        Alert.alert(tr('newEval.nothingToImportTitle'), tr('newEval.nothingToImportMsg'));
        return;
      }
      setValue(prev => (prev.trim() ? `${prev.trim()}\n\n${clean}` : clean));
    } catch (e: any) {
      Alert.alert(tr('newEval.importFailedTitle'), e?.response?.data?.detail ?? tr('newEval.importFailedMsg'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const fields: Record<string, string> = {
        player_id: String(playerId),
        output_type: outputType,
        coach_notes: coachNotes,
        focus_prompt: focusPrompt,
        include_audio: 'false',
      };
      if (wantsBoxScore && selectedGameIds.length) fields.game_ids = selectedGameIds.join(',');
      if (wantsMatchup && matchupIds.length) fields.matchup_player_ids = matchupIds.join(',');

      // Stream each film from disk (native) so large/multiple film doesn't OOM
      // the JS multipart buffer, collecting upload tokens.
      const tokens: string[] = [];
      for (let i = 0; i < videos.length; i++) {
        setProgress(tr('newEval.uploadingFilm', { current: i + 1, total: videos.length }));
        const up = await uploadFileStreamed('/evaluations/upload-video', videos[i].uri, {});
        if (up?.token) tokens.push(up.token);
      }
      if (tokens.length) fields.video_tokens = tokens.join(',');
      setProgress(videos.length ? tr('newEval.analyzingFilm') : '');

      const form = new FormData();
      Object.entries(fields).forEach(([k, v]) => form.append(k, v));
      const res: any = await evalsAPI.submit(form);
      // Video jobs return a job id; poll for it.
      const ev = res?.job_id ? await evalsAPI.awaitJob(res.job_id, setProgress) : res;
      if (!ev?.id) throw new Error('No evaluation returned');
      navigation.replace('EvalReport', { evalId: ev.id });
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? e?.message ?? tr('newEval.evalFailedMsg'));
    } finally {
      setSubmitting(false);
      setProgress('');
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
          <Text style={styles.title}>{tr('newEval.title')}</Text>
          <Text style={styles.sub}>{playerName}</Text>
        </View>
      </View>

      {/* Output type selector — combine multiple for a comprehensive eval */}
      <Text style={styles.label}>{tr('newEval.reportType')}</Text>
      <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8, marginLeft: 2 }}>
        {tr('newEval.reportTypeHint')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        {OUTPUT_TYPES.map(key => {
          const selected = outputType.split(',').filter(Boolean);
          const isOn = selected.includes(key);
          return (
          <TouchableOpacity
            key={key}
            style={[styles.typeChip, isOn && styles.typeChipActive]}
            onPress={() => {
              const next = isOn ? selected.filter(k => k !== key) : [...selected, key];
              setOutputType((next.length ? next : [key]).join(','));
            }}
          >
            <Text style={[styles.typeLabel, isOn && styles.typeLabelActive]}>
              {key === 'recruitment_profile' ? tr('newEval.recruitmentShort') : tr(`reportTypes.${key}`)}
            </Text>
          </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Box Score — tracked game selection */}
      {wantsBoxScore && (
        <View style={{ marginBottom: 20 }}>
          <Text style={styles.label}>{tr('newEval.trackedGamesLabel')}</Text>
          <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8, marginLeft: 2 }}>
            {tr('newEval.trackedGamesHint')}
          </Text>
          {!gamesLoaded ? (
            <ActivityIndicator color={t.accent} style={{ marginVertical: 12 }} />
          ) : games.length === 0 ? (
            <Text style={{ color: t.muted2, fontSize: 12, paddingVertical: 8 }}>
              {tr('newEval.noTrackedGames', { name: playerName })}
            </Text>
          ) : (
            <>
              {/* Season filter */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {seasonYears.map(y => (
                  <TouchableOpacity key={y} style={[styles.typeChip, seasonYear === y && styles.typeChipActive]} onPress={() => setSeasonYear(y)}>
                    <Text style={[styles.typeLabel, seasonYear === y && styles.typeLabelActive]}>{y === 'all' ? tr('newEval.allSeasons') : y}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {/* Season type filter */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {seasonPhases.map(p => (
                  <TouchableOpacity key={p} style={[styles.typeChip, seasonPhase === p && styles.typeChipActive]} onPress={() => setSeasonPhase(p)}>
                    <Text style={[styles.typeLabel, seasonPhase === p && styles.typeLabelActive]}>{p === 'all' ? tr('newEval.allTypes') : p.charAt(0).toUpperCase() + p.slice(1)}</Text>
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
                  <Text style={{ color: t.inkSoft, fontSize: 13, fontFamily: fonts[700] }}>{tr('newEval.selectAllShown', { count: filteredGames.length })}</Text>
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
                      <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[600] }}>{tr('newEval.vsOpponent', { opponent: g.opponent_name })}</Text>
                      <Text style={{ color: t.muted2, fontSize: 11 }}>
                        {g.date ?? ''}{g.season_phase ? ` · ${g.season_phase}` : ''}{g.game_grade != null ? ` · ${tr('newEval.gradeShort', { grade: g.game_grade })}` : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              {selectedGameIds.length > 0 && (
                <Text style={{ color: t.accent, fontSize: 12, marginTop: 8, fontFamily: fonts[700] }}>{tr('newEval.gamesSelected', { count: selectedGameIds.length })}</Text>
              )}
            </>
          )}
        </View>
      )}

      {wantsMatchup && (
        <View style={{ marginBottom: 20 }}>
          <Text style={styles.label}>{tr('newEval.matchupLabel')}</Text>
          <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8, marginLeft: 2 }}>
            {tr('newEval.matchupHint', { name: playerName || tr('newEval.thisPlayer') })}
          </Text>
          <TextInput
            style={{ backgroundColor: t.card, borderRadius: 12, padding: 12, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line, marginBottom: 8 }}
            value={matchupSearch} onChangeText={setMatchupSearch}
            placeholder={tr('newEval.searchPlayersPlaceholder')} placeholderTextColor={t.muted2}
          />
          {!rosterLoaded ? (
            <ActivityIndicator color={t.accent} style={{ marginVertical: 12 }} />
          ) : matchupFiltered.length === 0 ? (
            <Text style={{ color: t.muted2, fontSize: 12, paddingVertical: 8 }}>
              {rosterPlayers.length === 0 ? tr('newEval.noOtherPlayers') : tr('newEval.noPlayersMatch')}
            </Text>
          ) : (
            matchupFiltered.slice(0, 40).map(p => {
              const on = matchupIds.includes(p.id);
              return (
                <TouchableOpacity key={p.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.divider }}
                  onPress={() => setMatchupIds(prev => on ? prev.filter(id => id !== p.id) : [...prev, p.id])}
                >
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? t.accent : t.muted2} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[600] }}>{p.name}</Text>
                    <Text style={{ color: t.muted2, fontSize: 11 }}>
                      {[p.position, p.competition_level, p.program_name].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
          {matchupIds.length > 0 && (
            <Text style={{ color: t.accent, fontSize: 12, marginTop: 8, fontFamily: fonts[700] }}>
              {tr('newEval.comparingPlayers', { total: matchupIds.length + 1, name: playerName || tr('newEval.thisPlayer'), count: matchupIds.length })}
            </Text>
          )}
        </View>
      )}

      {/* Video picker — multiple films allowed */}
      <Text style={styles.label}>{tr('newEval.filmLabel')}</Text>
      {videos.map((v, i) => (
        <View key={`${v.uri}-${i}`} style={[styles.videoPicker, styles.videoPickerDone, { justifyContent: 'space-between', marginBottom: 8 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <Ionicons name="checkmark-circle" size={22} color={t.positive} />
            <Text style={[styles.videoPickerText, { color: t.positive, flex: 1 }]} numberOfLines={1}>{v.name}</Text>
          </View>
          <TouchableOpacity onPress={() => setVideos(prev => prev.filter((_, j) => j !== i))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={20} color={t.muted2} />
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={styles.videoPicker} onPress={pickVideo}>
        <Ionicons name="cloud-upload-outline" size={28} color={t.muted} />
        <Text style={styles.videoPickerText}>
          {videos.length ? tr('newEval.addMoreFilm') : tr('newEval.tapToSelectFilm')}
        </Text>
      </TouchableOpacity>

      {/* Notes */}
      <View style={styles.labelRow}>
        <Text style={styles.label}>{tr('newEval.notesLabel')}</Text>
        <TouchableOpacity
          style={styles.importBtn}
          onPress={() => importDoc('notes', setImportingNotes, setCoachNotes)}
          disabled={importingNotes}
        >
          {importingNotes
            ? <ActivityIndicator size="small" color={t.accent} />
            : <><Ionicons name="document-attach-outline" size={13} color={t.accent} />
              <Text style={styles.importBtnText}>{tr('newEval.import')}</Text></>}
        </TouchableOpacity>
      </View>
      <VoiceTextInput
        style={[styles.input, { height: 100 }]}
        placeholder={tr('newEval.notesPlaceholder')}
        placeholderTextColor={t.muted2}
        value={coachNotes}
        onChangeText={setCoachNotes}
        multiline
        textAlignVertical="top"
      />

      {/* Focus */}
      <View style={styles.labelRow}>
        <Text style={styles.label}>{tr('newEval.focusLabel')}</Text>
        <TouchableOpacity
          style={styles.importBtn}
          onPress={() => importDoc('focus', setImportingFocus, setFocusPrompt)}
          disabled={importingFocus}
        >
          {importingFocus
            ? <ActivityIndicator size="small" color={t.accent} />
            : <><Ionicons name="document-attach-outline" size={13} color={t.accent} />
              <Text style={styles.importBtnText}>{tr('newEval.import')}</Text></>}
        </TouchableOpacity>
      </View>
      <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8, marginLeft: 2 }}>
        {tr('newEval.focusHint')}
      </Text>
      <VoiceTextInput
        style={[styles.input, { height: 80 }]}
        placeholder={tr('newEval.focusPlaceholder')}
        placeholderTextColor={t.muted2}
        value={focusPrompt}
        onChangeText={setFocusPrompt}
        multiline
        textAlignVertical="top"

      />

      <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
        {submitting
          ? <><ActivityIndicator color={t.ctaText} /><Text style={styles.submitText}>{'  ' + tr('newEval.analyzing')}</Text></>
          : <><Ionicons name="analytics" size={18} color={t.ctaText} /><Text style={styles.submitText}>{'  ' + tr('newEval.runBimAnalysis')}</Text></>
        }
      </TouchableOpacity>

      <GeneratingOverlay
        visible={submitting}
        realProgress={parseGenProgress(progress)}
        label={progress || tr('newEval.overlayLabel')}
      />
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
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: t.accent, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 5, marginBottom: 8, minHeight: 28,
  },
  importBtnText: { color: t.accent, fontSize: 12, fontFamily: fonts[600] },
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
