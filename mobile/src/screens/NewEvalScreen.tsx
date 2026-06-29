import React, { useState, useRef } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { evalsAPI } from '../api/client';
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
    if (!videoUri) { Alert.alert('No video', 'Please select a video clip first.'); return; }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('player_id', String(playerId));
      form.append('output_type', outputType);
      form.append('coach_notes', coachNotes);
      form.append('focus_prompt', focusPrompt);
      form.append('include_audio', 'false');
      form.append('video', { uri: videoUri, name: videoName, type: 'video/mp4' } as any);

      const ev = await evalsAPI.submit(form);
      navigation.replace('EvalReport', { evalId: ev.id });
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Evaluation failed. Check API connection.');
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

      {/* Video picker */}
      <Text style={styles.label}>Video Clip</Text>
      <TouchableOpacity style={[styles.videoPicker, videoUri && styles.videoPickerDone]} onPress={pickVideo}>
        <Ionicons name={videoUri ? 'checkmark-circle' : 'cloud-upload-outline'} size={28} color={videoUri ? t.positive : t.muted} />
        <Text style={[styles.videoPickerText, videoUri && { color: t.positive }]}>
          {videoUri ? videoName : 'Tap to select video'}
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

      {/* Focus prompt */}
      <Text style={styles.label}>Evaluation Focus (optional)</Text>
      <VoiceTextInput
        style={[styles.input, { height: 80 }]}
        placeholder="e.g. Focus on college-level translation, P&R reads, defensive film"
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
        <Text style={styles.hint}>Extracting frames and analyzing with Claude. This may take 30–60 seconds.</Text>
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
