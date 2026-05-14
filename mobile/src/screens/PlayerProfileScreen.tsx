import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playersAPI } from '../api/client';
import { Player, Evaluation } from '../types';
import { GradeBadge } from '../components/GradeBadge';
import { PillarCard } from '../components/PillarCard';

const OUTPUT_TYPES = [
  { key: 'player_eval', label: 'Player Eval' },
  { key: 'film_breakdown', label: 'Film Breakdown' },
  { key: 'scouting_report', label: 'Scouting Report' },
  { key: 'coaching_report', label: 'Coaching Report' },
  { key: 'recruitment_profile', label: 'Recruitment' },
  { key: 'position_analysis', label: 'Position Analysis' },
];

export default function PlayerProfileScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { playerId } = route.params;

  const [player, setPlayer] = useState<Player | null>(null);
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);

  // Summary state
  const [showSummary, setShowSummary] = useState(false);
  const [summaryType, setSummaryType] = useState('player_eval');
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    Promise.all([playersAPI.get(playerId), playersAPI.evaluations(playerId)])
      .then(([p, e]) => { setPlayer(p); setEvals(e); })
      .finally(() => setLoading(false));
  }, [playerId]);

  const generateSummary = async () => {
    if (!player) return;
    setSummaryLoading(true);
    try {
      const result = await playersAPI.summary(playerId, { output_type: summaryType });
      setShowSummary(false);
      const typeLabel = summaryType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const sanitize = (s: string) => (s ?? '').replace(/[^a-zA-Z0-9 \-]/g, '').trim();
      navigation.navigate('Summary', {
        title: `${player.name} — ${typeLabel} Summary`,
        reportText: result.report_text,
        fileName: [
          'Player Summary',
          sanitize(player.name),
          sanitize(player.program_name),
          sanitize(player.position ?? ''),
          typeLabel,
        ].filter(Boolean).join(' - '),
      });
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not generate summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View>;
  if (!player) return null;

  const latest = evals[evals.length - 1] ?? null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.name}>{player.name}</Text>
          <Text style={styles.meta}>{[player.position, player.competition_level].filter(Boolean).join(' · ')}</Text>
        </View>
        <GradeBadge grade={player.latest_grade} size="lg" />
      </View>

      {/* Latest pillar grades */}
      {latest?.pillar_grades && Object.keys(latest.pillar_grades).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Latest Evaluation</Text>
          {Object.entries(latest.pillar_grades).map(([key, grade]) => (
            <PillarCard key={key} pillarKey={key} grade={grade} />
          ))}
        </View>
      )}

      {/* Flags */}
      {latest && (
        <View style={styles.row}>
          {latest.green_flags && latest.green_flags.length > 0 && (
            <View style={[styles.flagBox, { borderColor: '#16a34a' }]}>
              <Text style={[styles.flagTitle, { color: '#22c55e' }]}>Green Flags</Text>
              {latest.green_flags.map((f, i) => <Text key={i} style={styles.flagItem}>· {f}</Text>)}
            </View>
          )}
          {latest.watch_flags && latest.watch_flags.length > 0 && (
            <View style={[styles.flagBox, { borderColor: '#dc2626' }]}>
              <Text style={[styles.flagTitle, { color: '#ef4444' }]}>Watch Flags</Text>
              {latest.watch_flags.map((f, i) => <Text key={i} style={styles.flagItem}>· {f}</Text>)}
            </View>
          )}
        </View>
      )}

      {/* Eval history */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Evaluation History</Text>
          <TouchableOpacity
            style={styles.newEvalBtn}
            onPress={() => navigation.navigate('NewEval', { playerId: player.id, playerName: player.name })}
          >
            <Ionicons name="videocam" size={14} color="#fff" />
            <Text style={styles.newEvalText}>New Eval</Text>
          </TouchableOpacity>
        </View>

        {evals.length === 0 && <Text style={styles.emptyText}>No evaluations yet.</Text>}
        {[...evals].reverse().map(ev => (
          <TouchableOpacity
            key={ev.id}
            style={styles.evalCard}
            onPress={() => navigation.navigate('EvalReport', { evalId: ev.id })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.evalType}>{ev.output_type.replace(/_/g, ' ').toUpperCase()}</Text>
              <Text style={styles.evalDate}>{new Date(ev.created_at).toLocaleDateString()}</Text>
            </View>
            <GradeBadge grade={ev.overall_grade} size="sm" />
          </TouchableOpacity>
        ))}
      </View>

      {/* Summarize history */}
      {evals.length > 0 && (
        <TouchableOpacity style={styles.summaryBtn} onPress={() => setShowSummary(true)}>
          <Ionicons name="bar-chart" size={18} color="#fff" />
          <Text style={styles.summaryText}>Summarize Evaluation History</Text>
        </TouchableOpacity>
      )}

      {/* Training */}
      <TouchableOpacity
        style={styles.trainingBtn}
        onPress={() => navigation.navigate('Training', { playerId: player.id, evalId: latest?.id })}
      >
        <Ionicons name="barbell" size={18} color="#fff" />
        <Text style={styles.trainingText}>Generate Training Program</Text>
      </TouchableOpacity>

      {/* Summary modal */}
      <Modal visible={showSummary} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Summarize History</Text>
            <Text style={styles.modalSub}>Choose a report type to generate a summary across all {evals.length} evaluations.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              {OUTPUT_TYPES.map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.chip, summaryType === t.key && styles.chipActive]}
                  onPress={() => setSummaryType(t.key)}
                >
                  <Text style={[styles.chipText, summaryType === t.key && { color: '#fff' }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowSummary(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={generateSummary} disabled={summaryLoading}>
                {summaryLoading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveText}>Generate</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56, gap: 12 },
  headerCenter: { flex: 1 },
  name: { color: '#fff', fontSize: 22, fontWeight: '900' },
  meta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: '#9ca3af', fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 20 },
  flagBox: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12 },
  flagTitle: { fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' },
  flagItem: { color: '#d1d5db', fontSize: 12, marginBottom: 3 },
  evalCard: {
    backgroundColor: '#111827', borderRadius: 10, padding: 14,
    flexDirection: 'row', alignItems: 'center', marginBottom: 8,
  },
  evalType: { color: '#fff', fontSize: 13, fontWeight: '700' },
  evalDate: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  emptyText: { color: '#4b5563', fontSize: 13 },
  newEvalBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#2563eb', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
  newEvalText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  summaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1d4ed8', margin: 20, marginBottom: 8, padding: 16, borderRadius: 12,
  },
  summaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  trainingBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1f2937', marginHorizontal: 20, marginTop: 0, marginBottom: 0, padding: 16, borderRadius: 12,
  },
  trainingText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#111827', borderRadius: 20, padding: 24, margin: 12 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalSub: { color: '#6b7280', fontSize: 12, marginBottom: 16 },
  chip: { borderWidth: 1, borderColor: '#374151', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8 },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center' },
  cancelText: { color: '#9ca3af', fontWeight: '600' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#2563eb', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700' },
});
