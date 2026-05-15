import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert, Modal, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import Markdown from 'react-native-markdown-display';
import { evalsAPI, playersAPI } from '../api/client';
import { Evaluation, Correction, Player } from '../types';
import { GradeBadge } from '../components/GradeBadge';
import { PillarCard } from '../components/PillarCard';
import { mdToHtml, safeFileName } from '../utils/mdToHtml';

const PILLARS = [
  'offensive_skills', 'defensive_capabilities', 'physical_attributes',
  'intangibles', 'advanced_analysis', 'strategic_fit',
];

const PILLAR_LABELS: Record<string, string> = {
  offensive_skills: 'Offensive Skills',
  defensive_capabilities: 'Defense',
  physical_attributes: 'Physical',
  intangibles: 'Intangibles',
  advanced_analysis: 'Advanced',
  strategic_fit: 'Strategic Fit',
};

const EXPORT_CATEGORIES = [
  { key: 'grades',     label: 'Overall Grade + Pillar Grades' },
  { key: 'flags',      label: 'Green Flags & Watch Flags' },
  { key: 'questions',  label: 'Key Questions' },
  { key: 'report',     label: 'Full Report' },
  { key: 'corrections', label: 'Coach Corrections' },
];

export default function EvalReportScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { evalId } = route.params;

  const [ev, setEv] = useState<Evaluation | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);

  // Correction modal
  const [showCorrect, setShowCorrect] = useState(false);
  const [selectedPillar, setSelectedPillar] = useState('');
  const [correctionText, setCorrectionText] = useState('');
  const [saving, setSaving] = useState(false);

  // Export modal
  const [showExport, setShowExport] = useState(false);
  const [exportCats, setExportCats] = useState<Record<string, boolean>>({
    grades: true, flags: true, questions: true, report: true, corrections: false,
  });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    Promise.all([evalsAPI.get(evalId), evalsAPI.corrections(evalId)])
      .then(async ([e, c]) => {
        setEv(e);
        setCorrections(c);
        try { setPlayer(await playersAPI.get(e.player_id)); } catch {}
      })
      .finally(() => setLoading(false));
  }, [evalId]);

  const buildFileName = () => {
    if (!ev) return 'Evaluation Report';
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9 \-]/g, '').trim();
    const type = ev.output_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const name = sanitize(player?.name ?? 'Player');
    const team = sanitize(player?.team_name ?? player?.program_name ?? '');
    const pos  = sanitize(player?.position ?? '');
    return ['Evaluation Report', name, team, pos, type].filter(Boolean).join(' - ');
  };

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
      Alert.alert('Saved', 'Correction recorded — will sharpen future evaluations.');
    } catch {
      Alert.alert('Error', 'Could not save correction');
    } finally {
      setSaving(false);
    }
  };

  const buildHtml = () => {
    if (!ev) return '<html><body><p>No data</p></body></html>';
    const date = new Date(ev.created_at).toLocaleDateString();
    const type = ev.output_type.replace(/_/g, ' ').toUpperCase();
    const sanitize = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let body = `<h1>BloomPrint &mdash; ${type}</h1>
      <p style="color:#555;margin-top:0">${ev.competition_level ?? ''} &bull; ${date} &bull; Coach weight ${ev.coach_weight}</p>`;

    if (exportCats.grades && ev.overall_grade != null) {
      body += `<h3>Overall Grade</h3><div class="grade">${ev.overall_grade.toFixed(1)} / 10</div>`;
      if (ev.pillar_grades) {
        body += `<h3>Pillar Grades</h3>`;
        PILLARS.filter(k => ev.pillar_grades![k] != null).forEach(k => {
          const g = ev.pillar_grades![k];
          const pct = Math.round((g / 10) * 100);
          body += `<table width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0">
            <tr><td style="font-size:13px">${PILLAR_LABELS[k]}</td><td align="right" style="font-size:13px"><strong>${g.toFixed(1)}</strong></td></tr>
            <tr><td colspan="2"><div style="background:#eee;border-radius:4px;height:8px;margin-top:3px">
              <div style="background:#2563eb;border-radius:4px;height:8px;width:${pct}%"></div></div></td></tr>
          </table>`;
        });
      }
    }

    if (exportCats.flags) {
      if (ev.green_flags?.length) {
        body += `<h3>Green Flags</h3>`;
        ev.green_flags.forEach(f => { body += `<p style="color:#16a34a;margin:3px 0">&#10003; ${sanitize(f)}</p>`; });
      }
      if (ev.watch_flags?.length) {
        body += `<h3>Watch Flags</h3>`;
        ev.watch_flags.forEach(f => { body += `<p style="color:#dc2626;margin:3px 0">&#9888; ${sanitize(f)}</p>`; });
      }
    }

    if (exportCats.questions && ev.key_questions?.length) {
      body += `<h3>Key Questions</h3><ol>`;
      ev.key_questions.forEach(q => { body += `<li style="font-size:13px;margin:4px 0">${sanitize(q)}</li>`; });
      body += `</ol>`;
    }

    if (exportCats.report && ev.report_text) {
      body += `<h3>Full Report</h3><div style="margin-top:8px">${mdToHtml(ev.report_text)}</div>`;
    }

    if (exportCats.corrections && corrections.length) {
      body += `<h3>Coach Corrections</h3>`;
      corrections.forEach(c => {
        const pillarLabel = c.pillar ? `<strong>${c.pillar.replace(/_/g, ' ').toUpperCase()}</strong><br/>` : '';
        body += `<div style="background:#f9fafb;border-left:3px solid #2563eb;padding:8px 12px;margin:6px 0;font-size:12px">${pillarLabel}${sanitize(c.correction)}</div>`;
      });
    }

    return `<html><head><meta charset="utf-8"/><style>
      body { font-family: -apple-system, Helvetica, sans-serif; padding: 32px; color: #111; }
      h1 { font-size: 22px; margin-bottom: 4px; }
      h3 { font-size: 14px; border-bottom: 1px solid #eee; padding-bottom: 4px; margin-top: 24px; color: #333; }
      .grade { font-size: 48px; font-weight: 900; color: #2563eb; }
      p { margin: 6px 0; }
    </style></head><body>${body}
      <div style="margin-top:40px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px">
        Generated by BloomPrint Basketball Intelligence Model
      </div>
    </body></html>`;
  };

  const exportReport = async () => {
    setExporting(true);
    try {
      const html = buildHtml();
      const { uri } = await Print.printToFileAsync({ html });
      const dest = FileSystem.cacheDirectory + safeFileName(buildFileName()) + '.pdf';
      await FileSystem.copyAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Share BIM Report' });
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Could not generate report');
    } finally {
      setExporting(false);
      setShowExport(false);
    }
  };

  const printReport = async () => {
    try {
      await Print.printAsync({ html: buildHtml() });
    } catch (e: any) {
      Alert.alert('Print Error', e?.message ?? 'Could not print report');
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View>;
  if (!ev) return null;

  const hasPillars = ev.pillar_grades && Object.keys(ev.pillar_grades).length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>{ev.output_type.replace(/_/g, ' ').toUpperCase()}</Text>
          <Text style={styles.sub}>{new Date(ev.created_at).toLocaleDateString()} · Weight {ev.coach_weight}</Text>
        </View>
        <GradeBadge grade={ev.overall_grade} size="lg" />
      </View>

      {/* Pillar grades */}
      {hasPillars && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Pillar Grades</Text>
          {PILLARS.filter(k => ev.pillar_grades![k] !== undefined).map(k => (
            <PillarCard key={k} pillarKey={k} grade={ev.pillar_grades![k]} />
          ))}
        </View>
      )}

      {/* Flags */}
      {(ev.green_flags?.length || ev.watch_flags?.length) ? (
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
      ) : null}

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

      {/* Full report — rendered markdown */}
      {ev.report_text && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Full Report</Text>
          <View style={styles.reportBox}>
            <Markdown style={markdownStyles}>{ev.report_text}</Markdown>
          </View>
        </View>
      )}

      {/* Corrections */}
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

      {/* Action buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowCorrect(true)}>
          <Ionicons name="create-outline" size={18} color="#9ca3af" />
          <Text style={styles.actionText}>Correct</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowExport(true)}>
          <Ionicons name="share-outline" size={18} color="#9ca3af" />
          <Text style={styles.actionText}>Export</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={printReport}>
          <Ionicons name="print-outline" size={18} color="#9ca3af" />
          <Text style={styles.actionText}>Print</Text>
        </TouchableOpacity>
      </View>

      {/* Export modal */}
      <Modal visible={showExport} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Export Report</Text>
            <Text style={styles.modalSub}>Choose what to include:</Text>
            {EXPORT_CATEGORIES.map(cat => (
              <View key={cat.key} style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>{cat.label}</Text>
                <Switch
                  value={exportCats[cat.key]}
                  onValueChange={v => setExportCats(prev => ({ ...prev, [cat.key]: v }))}
                  trackColor={{ true: '#2563eb' }}
                  thumbColor="#fff"
                />
              </View>
            ))}
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowExport(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={exportReport} disabled={exporting}>
                {exporting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveText}>Share PDF</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Correction modal */}
      <Modal visible={showCorrect} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
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
                    {p ? PILLAR_LABELS[p] : 'General'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.label}>Your Correction</Text>
            <TextInput
              style={[styles.input, { height: 100 }]}
              placeholder="What did the model get wrong or miss?"
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
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const markdownStyles = {
  body: { color: '#d1d5db', fontSize: 13, lineHeight: 22 },
  heading1: { color: '#ffffff', fontSize: 16, fontWeight: '800' as const, marginTop: 16, marginBottom: 4 },
  heading2: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' as const, marginTop: 14, marginBottom: 4 },
  heading3: { color: '#9ca3af', fontSize: 13, fontWeight: '700' as const, marginTop: 12, marginBottom: 2 },
  strong: { color: '#ffffff', fontWeight: '700' as const },
  em: { color: '#93c5fd' },
  bullet_list: { marginLeft: 8 },
  list_item: { color: '#d1d5db', fontSize: 13 },
  hr: { backgroundColor: '#1f2937', height: 1, marginVertical: 12 },
  blockquote: { backgroundColor: '#1f2937', borderLeftColor: '#2563eb', paddingLeft: 12 },
  code_inline: { backgroundColor: '#1f2937', color: '#93c5fd', borderRadius: 4, paddingHorizontal: 4 },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56 },
  title: { color: '#fff', fontSize: 16, fontWeight: '900' },
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
  reportBox: { backgroundColor: '#111827', borderRadius: 12, padding: 16 },
  correctionCard: { backgroundColor: '#111827', borderRadius: 10, padding: 14, marginBottom: 8 },
  correctionPillar: { color: '#2563eb', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  correctionText: { color: '#fff', fontSize: 13 },
  correctionMeta: { color: '#4b5563', fontSize: 11, marginTop: 6 },
  actionRow: { flexDirection: 'row', margin: 20, gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#374151',
  },
  actionText: { color: '#9ca3af', fontWeight: '600', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#111827', borderRadius: 20, padding: 24, margin: 12 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalSub: { color: '#6b7280', fontSize: 12, marginBottom: 16 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  toggleLabel: { color: '#d1d5db', fontSize: 14 },
  label: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  pillarChip: { borderWidth: 1, borderColor: '#374151', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6 },
  pillarChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  pillarChipText: { color: '#9ca3af', fontSize: 12 },
  input: { backgroundColor: '#1f2937', borderRadius: 10, padding: 14, color: '#fff', fontSize: 14, marginBottom: 12 },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center' },
  cancelText: { color: '#9ca3af', fontWeight: '600' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#2563eb', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700' },
});
