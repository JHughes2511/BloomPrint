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

  const [outputType, setOutputType] = useState<OutputType>('player_eval');
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
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0a0a0a' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>New Evaluation</Text>
          <Text style={styles.sub}>{playerName}</Text>
        </View>
      </View>

      {/* Output type selector */}
      <Text style={styles.label}>Report Type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        {OUTPUT_TYPES.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.typeChip, outputType === t.key && styles.typeChipActive]}
            onPress={() => setOutputType(t.key)}
          >
            <Text style={[styles.typeLabel, outputType === t.key && styles.typeLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Video picker */}
      <Text style={styles.label}>Video Clip</Text>
      <TouchableOpacity style={[styles.videoPicker, videoUri && styles.videoPickerDone]} onPress={pickVideo}>
        <Ionicons name={videoUri ? 'checkmark-circle' : 'cloud-upload-outline'} size={28} color={videoUri ? '#22c55e' : '#6b7280'} />
        <Text style={[styles.videoPickerText, videoUri && { color: '#22c55e' }]}>
          {videoUri ? videoName : 'Tap to select video'}
        </Text>
      </TouchableOpacity>

      {/* Coach notes */}
      <Text style={styles.label}>Coach Notes</Text>
      <VoiceTextInput
        style={[styles.input, { height: 100 }]}
        placeholder="e.g. Elite catch and shoot, plays at one pace, need to see more P&R midrange..."
        placeholderTextColor="#4b5563"
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
        placeholderTextColor="#4b5563"
        value={focusPrompt}
        onChangeText={setFocusPrompt}
        multiline
        textAlignVertical="top"
        onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)}
      />

      <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
        {submitting
          ? <><ActivityIndicator color="#fff" /><Text style={styles.submitText}>  Analyzing...</Text></>
          : <><Ionicons name="analytics" size={18} color="#fff" /><Text style={styles.submitText}>  Run BIM Analysis</Text></>
        }
      </TouchableOpacity>

      {submitting && (
        <Text style={styles.hint}>Extracting frames and analyzing with Claude. This may take 30–60 seconds.</Text>
      )}
    </KeyboardAwareScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 20, paddingTop: 56 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  title: { color: '#fff', fontSize: 22, fontWeight: '900' },
  sub: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  label: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  typeChip: {
    borderWidth: 1, borderColor: '#374151', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7, marginRight: 8,
  },
  typeChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  typeLabel: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  typeLabelActive: { color: '#fff' },
  videoPicker: {
    borderWidth: 2, borderColor: '#374151', borderStyle: 'dashed', borderRadius: 12,
    padding: 24, alignItems: 'center', marginBottom: 20, gap: 8,
  },
  videoPickerDone: { borderColor: '#16a34a', borderStyle: 'solid' },
  videoPickerText: { color: '#6b7280', fontSize: 14 },
  input: {
    backgroundColor: '#111827', borderRadius: 10, padding: 14,
    color: '#fff', fontSize: 14, marginBottom: 16, borderWidth: 1, borderColor: '#1f2937',
  },
  submitBtn: {
    backgroundColor: '#2563eb', borderRadius: 12, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hint: { color: '#4b5563', fontSize: 12, textAlign: 'center', marginTop: 12 },
});
