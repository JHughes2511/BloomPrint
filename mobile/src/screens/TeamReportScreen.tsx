import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { evalsAPI } from '../api/client';

const OUTPUT_TYPES = [
  { key: 'coaching_report', label: 'Coaching Report' },
  { key: 'game_analysis', label: 'Game Analysis' },
  { key: 'film_breakdown', label: 'Film Breakdown' },
  { key: 'scouting_report', label: 'Scouting Report' },
  { key: 'training_program', label: 'Training Program' },
];

export default function TeamReportScreen() {
  const [outputType, setOutputType] = useState('coaching_report');
  const [focusPrompt, setFocusPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [reportText, setReportText] = useState<string | null>(null);
  const scrollRef = React.useRef<ScrollView>(null);

  const generate = async () => {
    setGenerating(true);
    setReportText(null);
    try {
      const result = await evalsAPI.teamReport({ output_type: outputType, focus_prompt: focusPrompt });
      setReportText(result.report_text);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not generate team report');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0a0a0a' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.title}>Team Report</Text>
        <Text style={styles.sub}>Generate a BIM analysis across your entire roster</Text>

        <Text style={styles.label}>Report Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
          {OUTPUT_TYPES.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[styles.chip, outputType === t.key && styles.chipActive]}
              onPress={() => setOutputType(t.key)}
            >
              <Text style={[styles.chipText, outputType === t.key && styles.chipTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.label}>Coach Focus (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Upcoming tournament, defensive scheme, recruiting eval..."
          placeholderTextColor="#4b5563"
          value={focusPrompt}
          onChangeText={setFocusPrompt}
          multiline
          textAlignVertical="top"
          onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)}
        />

        <TouchableOpacity style={styles.generateBtn} onPress={generate} disabled={generating}>
          {generating
            ? <><ActivityIndicator color="#fff" /><Text style={styles.generateText}>  Generating...</Text></>
            : <><Ionicons name="people" size={18} color="#fff" /><Text style={styles.generateText}>  Generate Team Report</Text></>
          }
        </TouchableOpacity>

        {generating && (
          <Text style={styles.hint}>Analyzing roster and generating report. This may take 20–40 seconds.</Text>
        )}

        {reportText && (
          <View style={styles.reportSection}>
            <Text style={styles.label}>Team Report</Text>
            <View style={styles.reportBox}>
              <Markdown style={markdownStyles}>{reportText}</Markdown>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const markdownStyles = {
  body: { color: '#d1d5db', fontSize: 13, lineHeight: 22 },
  heading1: { color: '#ffffff', fontSize: 16, fontWeight: '800' as const, marginTop: 16, marginBottom: 4 },
  heading2: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' as const, marginTop: 14, marginBottom: 4 },
  heading3: { color: '#9ca3af', fontSize: 13, fontWeight: '700' as const, marginTop: 12, marginBottom: 2 },
  strong: { color: '#ffffff', fontWeight: '700' as const },
  bullet_list: { marginLeft: 8 },
  list_item: { color: '#d1d5db', fontSize: 13 },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 20, paddingTop: 56 },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', marginBottom: 4 },
  sub: { color: '#6b7280', fontSize: 13, marginBottom: 28 },
  label: {
    color: '#9ca3af', fontSize: 11, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10,
  },
  chip: {
    borderWidth: 1, borderColor: '#374151', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, marginRight: 8,
  },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  input: {
    backgroundColor: '#111827', borderRadius: 10, padding: 14,
    color: '#fff', fontSize: 14, marginBottom: 16,
    borderWidth: 1, borderColor: '#1f2937', minHeight: 80,
  },
  generateBtn: {
    backgroundColor: '#2563eb', borderRadius: 12, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  generateText: { color: '#fff', fontWeight: '700', fontSize: 16, marginLeft: 8 },
  hint: { color: '#4b5563', fontSize: 12, textAlign: 'center', marginTop: 12 },
  reportSection: { marginTop: 28 },
  reportBox: { backgroundColor: '#111827', borderRadius: 12, padding: 16 },
});
