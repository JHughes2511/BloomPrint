import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert, Modal,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { evalsAPI } from '../api/client';
import { Evaluation, Correction } from '../types';
import { GradeBadge } from '../components/GradeBadge';
import { PillarCard } from '../components/PillarCard';

const PILLARS = [
  'offensive_skills', 'defensive_capabilities', 'physical_attributes',
  'intangibles', 'advanced_analysis', 'strategic_fit',
];

export default function EvalReportScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { evalId } = route.params;

  const [ev, setEv] = useState<Evaluation | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCorrect, setShowCorrect] = useState(false);
  const [selectedPillar, setSelectedPillar] = useState('');
  const [correctionText, setCorrectionText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([evalsAPI.get(evalId), evalsAPI.corrections(evalId)])
      .then(([e, c]) => { setEv(e); setCorrections(c); })
      .finally(() => setLoading(false));
  }, [evalId]);

  const submitCorrection = async () => {
    if (!correctionText.trim()) return;
    setSaving(true);
    try {
      const c = await evalsAPI.addCorrection(evalId, {
        pillar: selectedPillar || undefined,
        correction: correctionText,
      });
      setCorrections(prev => [...prev, c]);
      setShowCorrect(false);
      setCorrectionText(''); setSelectedPillar('');
      Alert.alert('Correction saved', 'This will be used to sharpen the model.');
    } catch {
      Alert.alert('Error', 'Could not save correction');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View>;
  if (!ev) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>{ev.output_type.replace(/_/g, ' ').toUpperCase()}</Text>
          <Text style={styles.sub}>{new Date(ev.created_at).toLocaleDateString()} · weight {ev.coach_weight}</Text>
        </View>
        <GradeBadge grade={ev.overall_grade} size="lg" />
      </View>

      {/* Pillar grades */}
      {ev.pillar_grades && Object.keys(ev.pillar_grades).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Pillar Grades</Text>
          {PILLARS.filter(k => ev.pillar_grades![k] !== undefined).map(k => (
            <PillarCard key={k} pillarKey={k} grade={ev.pillar_grades![k]} />
          ))}
        </View>
      )}

      {/* Flags */}
      <View style={styles.flagRow}>
        {ev.green_flags && ev.green_flags.length > 0 && (
          <View style={[styles.flagBox, { borderColor: '#16a34a' }]}>
            <Text style={[styles.flagTitle, { color: '#22c55e' }]}>Green Flags</Text>
            {ev.green_flags.map((f, i) => <Text key={i} style={styles.flagItem}>· {f}</Text>)}
          </View>
        )}
        {ev.watch_flags && ev.watch_flags.length > 0 && (
          <View style={[styles.flagBox, { borderColor: '#dc2626' }]}>
            <Text style={[styles.flagTitle, { color: '#ef4444' }]}>Watch Flags</Text>
            {ev.watch_flags.map((f, i) => <Text key={i} style={styles.flagItem}>· {f}</Text>)}
          </View>
        )}
      </View>

      {/* Key questions */}
      {ev.key_questions && ev.key_questions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Key Questions</Text>
          {ev.key_questions.map((q, i) => (
            <View key={i} style={styles.questionRow}>
              <Text style={styles.questionNum}>{i + 1}</Text>
              <Text style={styles.questionText}>{q}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Full report */}
      {ev.report_text && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Full Report</Text>
          <Text style={styles.reportText}>{ev.report_text}</Text>
        </View>
      )}

      {/* Corrections submitted */}
      {corrections.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Coach Corrections ({corrections.length})</Text>
          {corrections.map(c => (
            <View key={c.id} style={styles.correctionCard}>
              {c.pillar && <Text style={styles.correctionPillar}>{c.pillar.replace(/_/g, ' ').toUpperCase()}</Text>}
              <Text style={styles.correctionText}>{c.correction}</Text>
              <Text style={styles.correctionMeta}>Weight {c.coach_weight} · {new Date(c.created_at).toLocaleDateString()}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Add correction button */}
      <TouchableOpacity style={styles.correctBtn} onPress={() => setShowCorrect(true)}>
        <Ionicons name="create-outline" size={18} color="#fff" />
        <Text style={styles.correctBtnText}>Add Correction / Coach Note</Text>
      </TouchableOpacity>

      {/* Correction modal */}
      <Modal visible={showCorrect} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Add Correction</Text>
            <Text style={styles.modalSub}>This feeds back into the model to sharpen future evaluations.</Text>

            <Text style={styles.label}>Pillar (optional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {['', ...PILLARS].map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.pillarChip, selectedPillar === p && styles.pillarChipActive]}
                  onPress={() => setSelectedPillar(p)}
                >
                  <Text style={[styles.pillarChipText, selectedPillar === p && { color: '#fff' }]}>
                    {p ? p.replace(/_/g, ' ') : 'General'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Your Correction</Text>
            <TextInput
              style={[styles.input, { height: 100 }]}
              placeholder="What does the model have wrong or missing?"
              placeholderTextColor="#4b5563"
              value={correctionText}
              onChangeText={setCorrectionText}
              multiline
              textAlignVertical="top"
              autoFocus
            />

            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCorrect(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={submitCorrection} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56 },
  title: { color: '#fff', fontSize: 18, fontWeight: '900' },
  sub: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  flagRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 20 },
  flagBox: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12 },
  flagTitle: { fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' },
  flagItem: { color: '#d1d5db', fontSize: 12, marginBottom: 3 },
  questionRow: { flexDirection: 'row', marginBottom: 10, gap: 10 },
  questionNum: { color: '#2563eb', fontWeight: '800', fontSize: 14, width: 20 },
  questionText: { color: '#d1d5db', fontSize: 13, flex: 1, lineHeight: 20 },
  reportText: { color: '#9ca3af', fontSize: 12, lineHeight: 20 },
  correctionCard: { backgroundColor: '#111827', borderRadius: 10, padding: 14, marginBottom: 8 },
  correctionPillar: { color: '#2563eb', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  correctionText: { color: '#fff', fontSize: 13 },
  correctionMeta: { color: '#4b5563', fontSize: 11, marginTop: 6 },
  correctBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    margin: 20, padding: 16, borderRadius: 12,
    borderWidth: 1, borderColor: '#374151',
  },
  correctBtnText: { color: '#9ca3af', fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#111827', borderRadius: 20, padding: 24, margin: 12 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalSub: { color: '#6b7280', fontSize: 12, marginBottom: 16 },
  label: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  pillarChip: { borderWidth: 1, borderColor: '#374151', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6 },
  pillarChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  pillarChipText: { color: '#9ca3af', fontSize: 12 },
  input: { backgroundColor: '#1f2937', borderRadius: 10, padding: 14, color: '#fff', fontSize: 14, marginBottom: 12 },
  modalRow: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center' },
  cancelText: { color: '#9ca3af', fontWeight: '600' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#2563eb', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700' },
});
