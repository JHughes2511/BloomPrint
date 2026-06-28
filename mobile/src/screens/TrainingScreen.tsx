import React, { useEffect, useState } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { trainingAPI } from '../api/client';
import { TrainingSession } from '../types';

export default function TrainingScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { playerId, evalId } = route.params;

  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [current, setCurrent] = useState<TrainingSession | null>(null);
  const [focusPrompt, setFocusPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    trainingAPI.forPlayer(playerId)
      .then(s => { setSessions(s); if (s.length) setCurrent(s[s.length - 1]); })
      .finally(() => setLoading(false));
  }, [playerId]);

  const generate = async () => {
    setGenerating(true);
    try {
      const s = await trainingAPI.generate({ player_id: playerId, evaluation_id: evalId, focus_prompt: focusPrompt });
      setSessions(prev => [...prev, s]);
      setCurrent(s);
      setFocusPrompt('');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not generate program');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View>;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0a0a0a' }}
      behavior={undefined}
    >
    <KeyboardAwareScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Training Program</Text>
      </View>

      {/* Focus input */}
      <View style={styles.section}>
        <Text style={styles.label}>Additional Focus (optional)</Text>
        <VoiceTextInput
          style={styles.input}
          placeholder="e.g. Focus on P&R pace variation this week..."
          placeholderTextColor="#4b5563"
          value={focusPrompt}
          onChangeText={setFocusPrompt}
          multiline
        />
        <TouchableOpacity style={styles.generateBtn} onPress={generate} disabled={generating}>
          {generating
            ? <><ActivityIndicator color="#fff" /><Text style={styles.generateText}>  Generating...</Text></>
            : <><Ionicons name="barbell" size={16} color="#fff" /><Text style={styles.generateText}>  Generate Program</Text></>
          }
        </TouchableOpacity>
      </View>

      {/* Priority stack */}
      {current?.priorities && current.priorities.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Priority Stack</Text>
          {current.priorities.map((p, i) => (
            <View key={i} style={styles.priorityRow}>
              <View style={styles.priorityNum}>
                <Text style={styles.priorityNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.priorityText}>{p}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Program text */}
      {current?.program_text && (
        <View style={styles.section}>
          <Text style={styles.label}>Full Program</Text>
          <Text style={styles.programText}>{current.program_text}</Text>
        </View>
      )}

      {/* History */}
      {sessions.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.label}>Previous Programs</Text>
          {[...sessions].reverse().slice(1).map(s => (
            <TouchableOpacity key={s.id} style={styles.historyCard} onPress={() => setCurrent(s)}>
              <Text style={styles.historyDate}>{new Date(s.created_at).toLocaleDateString()}</Text>
              <Text style={styles.historyPriority}>{s.priorities?.[0] ?? 'Program'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!current && !generating && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No training program yet. Generate one based on the latest evaluation.</Text>
        </View>
      )}
    </KeyboardAwareScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56, gap: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '900' },
  section: { paddingHorizontal: 20, marginTop: 24 },
  label: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  input: {
    backgroundColor: '#111827', borderRadius: 10, padding: 14,
    color: '#fff', fontSize: 14, marginBottom: 12, borderWidth: 1, borderColor: '#1f2937', minHeight: 70,
  },
  generateBtn: {
    backgroundColor: '#2563eb', borderRadius: 10, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  generateText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  priorityRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 12 },
  priorityNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#2563eb',
    alignItems: 'center', justifyContent: 'center',
  },
  priorityNumText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  priorityText: { color: '#d1d5db', fontSize: 14, flex: 1, lineHeight: 20, paddingTop: 4 },
  programText: { color: '#9ca3af', fontSize: 12, lineHeight: 20 },
  historyCard: { backgroundColor: '#111827', borderRadius: 10, padding: 14, marginBottom: 8 },
  historyDate: { color: '#6b7280', fontSize: 11 },
  historyPriority: { color: '#d1d5db', fontSize: 13, marginTop: 2 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#4b5563', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
