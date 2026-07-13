import React, { useEffect, useState } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { trainingAPI } from '../api/client';
import { TrainingSession } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import { GeneratingOverlay } from '../components/GeneratingBasketball';
import { renderReport } from '../utils/renderReport';

export default function TrainingScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { playerId, evalId } = route.params;
  const { t } = useTheme();
  const styles = makeStyles(t);

  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [current, setCurrent] = useState<TrainingSession | null>(null);
  const [focusPrompt, setFocusPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [reference, setReference] = useState<{ uri: string; name: string; type: string } | null>(null);

  useEffect(() => {
    trainingAPI.forPlayer(playerId)
      .then(s => { setSessions(s); if (s.length) setCurrent(s[s.length - 1]); })
      .finally(() => setLoading(false));
  }, [playerId]);

  const pickReference = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (!res.canceled && res.assets?.[0]) {
        const a = res.assets[0];
        setReference({ uri: a.uri, name: a.name ?? 'reference', type: a.mimeType ?? 'application/octet-stream' });
      }
    } catch {
      Alert.alert('Error', 'Could not open file picker.');
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const s = await trainingAPI.generate({ player_id: playerId, evaluation_id: evalId, focus_prompt: focusPrompt, reference: reference ?? undefined });
      setSessions(prev => [...prev, s]);
      setCurrent(s);
      setFocusPrompt('');
      setReference(null);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not generate program');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <ScreenBackground><View style={styles.center}><ActivityIndicator color={t.accent} size="large" /></View></ScreenBackground>;

  return (
    <ScreenBackground>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={undefined}
    >
    <KeyboardAwareScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={t.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Training Program</Text>
      </View>

      {/* Focus input */}
      <View style={styles.section}>
        <Text style={styles.label}>Additional Focus (optional)</Text>
        <VoiceTextInput
          style={styles.input}
          placeholder="e.g. Focus on P&R pace variation this week..."
          placeholderTextColor={t.muted2}
          value={focusPrompt}
          onChangeText={setFocusPrompt}
          multiline
        />

        {/* Import reference content */}
        {reference ? (
          <View style={styles.refChip}>
            <Ionicons name="document-attach" size={16} color={t.accent} />
            <Text style={styles.refChipText} numberOfLines={1}>{reference.name}</Text>
            <TouchableOpacity onPress={() => setReference(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color={t.muted} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.importBtn} onPress={pickReference}>
            <Ionicons name="cloud-upload-outline" size={16} color={t.accent} />
            <Text style={styles.importBtnText}>Import reference content (PDF, Word, Excel, image)</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.generateBtn} onPress={generate} disabled={generating}>
          {generating
            ? <><ActivityIndicator color={t.ctaText} /><Text style={styles.generateText}>  Generating...</Text></>
            : <><Ionicons name="barbell" size={16} color={t.ctaText} /><Text style={styles.generateText}>  Generate Program</Text></>
          }
        </TouchableOpacity>
        <GeneratingOverlay visible={generating} label="Building the training program…" />
      </View>

      {/* Priority stack */}
      {current?.priorities && current.priorities.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Priority Stack</Text>
          {current.priorities
            .filter(p => p && p.replace(/[^A-Za-z0-9]/g, '').length >= 3)
            .map((p, i) => (
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
          {renderReport(current.program_text, { heading: t.ink, body: t.inkSoft })}
        </View>
      )}

      {/* History */}
      {sessions.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.label}>Previous Programs</Text>
          {[...sessions].reverse().slice(1).map((s, i, arr) => {
            const focus = (s.priorities ?? []).find(p => p && p.replace(/[^A-Za-z0-9]/g, '').length >= 3);
            return (
              <TouchableOpacity key={s.id} style={styles.historyCard} onPress={() => setCurrent(s)}>
                <Text style={styles.historyPriority}>Training Program #{arr.length - i}</Text>
                <Text style={styles.historyDate}>
                  {new Date(s.created_at).toLocaleDateString()}{focus ? ` · ${focus}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {!current && !generating && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No training program yet. Generate one based on the latest evaluation.</Text>
        </View>
      )}
    </KeyboardAwareScrollView>
    </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56, gap: 12 },
  title: { color: t.ink, fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  label: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 },
  input: {
    backgroundColor: t.card, borderRadius: 14, padding: 14,
    color: t.ink, fontSize: 14, marginBottom: 12, borderWidth: 1, borderColor: t.line, minHeight: 70,
  },
  generateBtn: {
    backgroundColor: t.ctaBg, borderRadius: 999, padding: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  generateText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15 },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12,
    backgroundColor: t.accentSoft, borderRadius: 12, padding: 13,
  },
  importBtnText: { color: t.accent, fontFamily: fonts[600], fontSize: 12.5, flex: 1 },
  refChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12,
    backgroundColor: t.card, borderRadius: 12, padding: 13, borderWidth: 1, borderColor: t.cardBorder,
  },
  refChipText: { color: t.ink, fontFamily: fonts[600], fontSize: 13, flex: 1 },
  priorityRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 12 },
  priorityNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: t.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  priorityNumText: { color: t.ctaText, fontSize: 13, fontFamily: fonts[800] },
  priorityText: { color: t.inkSoft, fontSize: 14, flex: 1, lineHeight: 20, paddingTop: 4 },
  programText: { color: t.inkSoft, fontSize: 12, lineHeight: 20 },
  historyCard: { backgroundColor: t.card, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: t.cardBorder },
  historyDate: { color: t.muted, fontSize: 11 },
  historyPriority: { color: t.inkSoft, fontSize: 13, marginTop: 2 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: t.muted2, fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
