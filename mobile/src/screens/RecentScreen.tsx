import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, Modal, TextInput,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { evalsAPI, playerAPI } from '../api/client';
import { GradeBadge } from '../components/GradeBadge';
import { mdToHtml, safeFileName } from '../utils/mdToHtml';

const TYPE_LABELS: Record<string, string> = {
  player_eval: 'Player Eval',
  film_breakdown: 'Film Breakdown',
  scouting_report: 'Scouting Report',
  coaching_report: 'Coaching Report',
  game_analysis: 'Game Analysis',
  training_program: 'Training Program',
  recruitment_profile: 'Recruitment',
  position_analysis: 'Position Analysis',
  box_score: 'Box Score',
};

type ReportItem = {
  id: number;
  kind: 'eval' | 'team';
  player_name?: string;
  output_type: string;
  overall_grade?: number | null;
  created_at: string;
};

type ModalReport = {
  id: number;
  kind: 'eval' | 'team';
  text: string;
  outputType: string;
  playerName?: string;
  evalId?: number;
};

const FILTER_CATS = [
  { key: 'all', label: 'All' },
  { key: 'eval', label: 'Player Evals' },
  { key: 'team', label: 'Team Reports' },
];

function cleanMarkdown(text: string): string {
  return text
    .replace(/\*\*\s*$/gm, '')
    .replace(/^\s*\*\*\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function RecentScreen() {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [activeModal, setActiveModal] = useState<ModalReport | null>(null);
  const [teamReportTexts, setTeamReportTexts] = useState<Record<number, string>>({});
  const [evalCache, setEvalCache] = useState<Record<number, any>>({});
  const [loadingEval, setLoadingEval] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Send modal
  const [showSend, setShowSend] = useState(false);
  const [sendSearch, setSendSearch] = useState('');
  const [sendResults, setSendResults] = useState<any[]>([]);
  const [sendSearchLoading, setSendSearchLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Team report correct modal
  const [showTeamCorrect, setShowTeamCorrect] = useState(false);
  const [teamCorrectText, setTeamCorrectText] = useState('');
  const [applyingCorrect, setApplyingCorrect] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [evals, teamReports] = await Promise.all([
        evalsAPI.recent(),
        evalsAPI.teamReports(),
      ]);
      const evalItems: ReportItem[] = evals.map((e: any) => ({
        id: e.id,
        kind: 'eval',
        player_name: e.player_name,
        output_type: e.output_type,
        overall_grade: e.overall_grade,
        created_at: e.created_at,
      }));
      const teamItems: ReportItem[] = teamReports.map((t: any) => ({
        id: t.id,
        kind: 'team',
        player_name: 'Team Report',
        output_type: t.output_type,
        overall_grade: null,
        created_at: t.created_at,
      }));
      const texts: Record<number, string> = {};
      teamReports.forEach((t: any) => { if (t.report_text) texts[t.id] = t.report_text; });
      setTeamReportTexts(texts);
      // Cache eval report_text for modal
      const ec: Record<number, any> = {};
      evals.forEach((e: any) => { ec[e.id] = e; });
      setEvalCache(ec);
      const combined = [...evalItems, ...teamItems].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setItems(combined);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const filtered = items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'eval') return item.kind === 'eval';
    if (filter === 'team') return item.kind === 'team';
    return true;
  });

  const handlePress = async (item: ReportItem) => {
    if (item.kind === 'team') {
      const text = teamReportTexts[item.id] ?? '';
      setActiveModal({ id: item.id, kind: 'team', text, outputType: item.output_type, playerName: item.player_name });
    } else {
      // Load eval detail if not cached with report_text
      let evalData = evalCache[item.id];
      if (!evalData?.report_text) {
        setLoadingEval(true);
        try {
          evalData = await evalsAPI.get(item.id);
          setEvalCache(prev => ({ ...prev, [item.id]: evalData }));
        } catch {}
        setLoadingEval(false);
      }
      setActiveModal({
        id: item.id,
        kind: 'eval',
        text: evalData?.report_text ?? '',
        outputType: item.output_type,
        playerName: item.player_name,
        evalId: item.id,
      });
    }
  };

  const handleDelete = (item: ReportItem) => {
    Alert.alert('Delete Report', 'Permanently delete this report?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          if (item.kind === 'eval') {
            await evalsAPI.delete(item.id);
          } else {
            await evalsAPI.deleteTeamReport(item.id);
          }
          load();
        } catch (e: any) {
          Alert.alert('Error', e?.response?.data?.detail ?? 'Could not delete');
        }
      }},
    ]);
  };

  const exportModalReport = async () => {
    if (!activeModal?.text) return;
    setExporting(true);
    try {
      const title = TYPE_LABELS[activeModal.outputType] ?? activeModal.outputType;
      const html = `<html><head><style>
        body{font-family:Georgia,serif;padding:40px;color:#111;max-width:800px;margin:auto}
        h1{font-size:22px;border-bottom:2px solid #2563eb;padding-bottom:8px}
        h2{font-size:17px;color:#1e40af;margin-top:24px}
        h3{font-size:14px;color:#374151;margin-top:16px}
        p{line-height:1.7;font-size:13px}
        li{line-height:1.7;font-size:13px}
      </style></head><body>
        <h1>BloomPrint — ${title}</h1>
        ${activeModal.playerName ? `<p>${activeModal.playerName}</p>` : ''}
        ${mdToHtml(activeModal.text)}
      </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      const fileName = `${safeFileName(title)}.pdf`;
      const dest = FileSystem.cacheDirectory + fileName;
      await FileSystem.copyAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Share Report' });
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Could not export');
    } finally {
      setExporting(false);
    }
  };

  const printModalReport = async () => {
    if (!activeModal?.text) return;
    try {
      const title = TYPE_LABELS[activeModal.outputType] ?? activeModal.outputType;
      const html = `<html><head><style>
        body{font-family:Georgia,serif;padding:40px;color:#111}
        h1{font-size:22px}h2{font-size:17px;color:#1e40af}
        p,li{line-height:1.7;font-size:13px}
      </style></head><body>
        <h1>BloomPrint — ${title}</h1>
        ${mdToHtml(activeModal.text)}
      </body></html>`;
      await Print.printAsync({ html });
    } catch (e: any) {
      Alert.alert('Print Error', e?.message ?? 'Could not print');
    }
  };

  const searchSendTargets = async () => {
    if (!sendSearch.trim()) return;
    setSendSearchLoading(true);
    try {
      const results = await playerAPI.searchPlayerUsers(sendSearch.trim());
      setSendResults(results);
    } catch {}
    setSendSearchLoading(false);
  };

  const sendReport = async (target: any) => {
    if (!activeModal) return;
    setSending(true);
    try {
      if (activeModal.kind === 'eval' && activeModal.evalId) {
        await playerAPI.share(activeModal.evalId, {
          player_user_id: target.id,
          share_report_text: true,
          share_grades: true,
          share_flags: true,
          share_questions: true,
        });
      } else {
        await playerAPI.shareTeamReport({
          output_type: activeModal.outputType,
          report_text: activeModal.text,
          target_type: 'individual',
          player_user_id: target.id,
        });
      }
      Alert.alert('Sent!', `Report sent to ${target.name}.`);
      setShowSend(false);
      setSendSearch('');
      setSendResults([]);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not send report');
    } finally {
      setSending(false);
    }
  };

  const applyTeamCorrection = async () => {
    if (!teamCorrectText.trim() || !activeModal) return;
    setApplyingCorrect(true);
    try {
      const updated = await evalsAPI.correctTeamReport(activeModal.id, teamCorrectText.trim());
      setActiveModal(prev => prev ? { ...prev, text: updated.report_text } : prev);
      setTeamReportTexts(prev => ({ ...prev, [activeModal.id]: updated.report_text }));
      setTeamCorrectText('');
      setShowTeamCorrect(false);
      Alert.alert('Updated', 'Team report updated based on your correction.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not apply correction');
    } finally {
      setApplyingCorrect(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View>;

  let lastDate = '';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Recent Reports</Text>

      {/* Category filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {FILTER_CATS.map(cat => (
          <TouchableOpacity
            key={cat.key}
            style={[styles.filterChip, filter === cat.key && styles.filterChipActive]}
            onPress={() => setFilter(cat.key)}
          >
            <Text style={[styles.filterChipText, filter === cat.key && styles.filterChipTextActive]}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={e => `${e.kind}-${e.id}`}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="document-text-outline" size={48} color="#374151" />
            <Text style={styles.emptyText}>No reports yet.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const dateStr = new Date(item.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
          const showDate = dateStr !== lastDate;
          lastDate = dateStr;
          return (
            <>
              {showDate && (
                <Text style={styles.dateHeader}>{dateStr}</Text>
              )}
              <TouchableOpacity
                style={[styles.card, item.kind === 'team' && styles.cardTeam]}
                onPress={() => handlePress(item)}
                onLongPress={() => handleDelete(item)}
              >
                <View style={styles.kindBadge}>
                  <Ionicons
                    name={item.kind === 'team' ? 'people' : 'person'}
                    size={12}
                    color={item.kind === 'team' ? '#f59e0b' : '#2563eb'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.playerName}>{item.player_name}</Text>
                  <Text style={[styles.typeName, item.kind === 'team' && { color: '#f59e0b' }]}>
                    {TYPE_LABELS[item.output_type] ?? item.output_type}
                  </Text>
                </View>
                {item.overall_grade != null && <GradeBadge grade={item.overall_grade} size="md" />}
              </TouchableOpacity>
            </>
          );
        }}
      />

      {/* Send modal */}
      <Modal visible={showSend} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Send Report</Text>
              <TouchableOpacity onPress={() => setShowSend(false)}>
                <Ionicons name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            <Text style={{ color: '#6b7280', fontSize: 12, marginBottom: 12 }}>Search for a player to send this report to.</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <TextInput
                style={sendStyles.searchInput}
                placeholder="Search by name..."
                placeholderTextColor="#4b5563"
                value={sendSearch}
                onChangeText={setSendSearch}
                onSubmitEditing={searchSendTargets}
                returnKeyType="search"
              />
              <TouchableOpacity style={sendStyles.searchBtn} onPress={searchSendTargets}>
                {sendSearchLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={18} color="#fff" />}
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 240 }}>
              {sendResults.map(r => (
                <TouchableOpacity
                  key={r.id}
                  style={sendStyles.resultRow}
                  onPress={() => sendReport(r)}
                  disabled={sending}
                >
                  <View style={sendStyles.avatar}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>{r.name?.[0] ?? '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '600' }}>{r.name}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 12 }}>{r.email}</Text>
                  </View>
                  {sending ? <ActivityIndicator color="#2563eb" size="small" /> : <Ionicons name="paper-plane-outline" size={18} color="#2563eb" />}
                </TouchableOpacity>
              ))}
              {sendResults.length === 0 && sendSearch.trim().length > 0 && !sendSearchLoading && (
                <Text style={{ color: '#4b5563', textAlign: 'center', paddingVertical: 20 }}>No players found</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Team report correct modal */}
      <Modal visible={showTeamCorrect} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Correct Report</Text>
              <TouchableOpacity onPress={() => setShowTeamCorrect(false)}>
                <Ionicons name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            <Text style={{ color: '#6b7280', fontSize: 12, marginBottom: 12 }}>Describe what needs to be corrected and AI will update the report.</Text>
            <TextInput
              style={sendStyles.correctInput}
              placeholder="What needs to be corrected in this report?"
              placeholderTextColor="#4b5563"
              value={teamCorrectText}
              onChangeText={setTeamCorrectText}
              multiline
              textAlignVertical="top"
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={sendStyles.cancelBtn} onPress={() => setShowTeamCorrect(false)}>
                <Text style={{ color: '#9ca3af', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={sendStyles.applyBtn}
                onPress={applyTeamCorrection}
                disabled={applyingCorrect || !teamCorrectText.trim()}
              >
                {applyingCorrect ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Apply</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Loading overlay while fetching eval detail */}
      {loadingEval && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#2563eb" size="large" />
        </View>
      )}

      {/* Report Detail Modal (both eval and team) */}
      <Modal visible={!!activeModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {TYPE_LABELS[activeModal?.outputType ?? ''] ?? activeModal?.outputType ?? 'Report'}
                </Text>
                {activeModal?.playerName && (
                  <Text style={styles.modalSub}>{activeModal.playerName}</Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setActiveModal(null)}>
                <Ionicons name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              {activeModal?.text
                ? <Markdown style={mdStyles}>{cleanMarkdown(activeModal.text)}</Markdown>
                : <Text style={{ color: '#6b7280' }}>No report content</Text>
              }
            </ScrollView>

            {/* Action buttons */}
            <View style={styles.actionRow}>
              {activeModal?.kind === 'eval' && activeModal.evalId != null ? (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => { setActiveModal(null); navigation.navigate('EvalReport', { evalId: activeModal!.evalId }); }}
                >
                  <Ionicons name="create-outline" size={18} color="#fff" />
                  <Text style={styles.actionText}>Correct</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.actionBtn} onPress={() => setShowTeamCorrect(true)}>
                  <Ionicons name="create-outline" size={18} color="#fff" />
                  <Text style={styles.actionText}>Correct</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.actionBtn} onPress={exportModalReport} disabled={exporting}>
                {exporting ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="download-outline" size={18} color="#fff" />}
                <Text style={styles.actionText}>Export</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={printModalReport}>
                <Ionicons name="print-outline" size={18} color="#fff" />
                <Text style={styles.actionText}>Print</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => { setSendSearch(''); setSendResults([]); setShowSend(true); }}>
                <Ionicons name="paper-plane-outline" size={18} color="#fff" />
                <Text style={styles.actionText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const sendStyles = StyleSheet.create({
  searchInput: {
    flex: 1, backgroundColor: '#1f2937', borderRadius: 10, padding: 12,
    color: '#fff', fontSize: 14, borderWidth: 1, borderColor: '#374151',
  },
  searchBtn: { backgroundColor: '#2563eb', borderRadius: 10, padding: 12, alignItems: 'center', justifyContent: 'center' },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
    borderRadius: 10, backgroundColor: '#1f2937', marginBottom: 8,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#2563eb',
    alignItems: 'center', justifyContent: 'center',
  },
  correctInput: {
    backgroundColor: '#1f2937', borderRadius: 10, padding: 12, color: '#fff',
    fontSize: 14, borderWidth: 1, borderColor: '#374151', minHeight: 100,
  },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center' },
  applyBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#2563eb', alignItems: 'center' },
});

const mdStyles = {
  body: { color: '#d1d5db', fontSize: 13, lineHeight: 22 },
  heading1: { color: '#fff', fontSize: 16, fontWeight: '800' as const, marginTop: 16, marginBottom: 4 },
  heading2: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' as const, marginTop: 12, marginBottom: 4 },
  heading3: { color: '#9ca3af', fontSize: 13, fontWeight: '700' as const, marginTop: 10, marginBottom: 2 },
  strong: { color: '#fff', fontWeight: '700' as const },
  bullet_list: { marginLeft: 8 },
  list_item: { color: '#d1d5db', fontSize: 13 },
  hr: { backgroundColor: '#1f2937', height: 1, marginVertical: 12 },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 56 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', marginHorizontal: 20, marginBottom: 12 },
  filterRow: { marginBottom: 12, flexGrow: 0 },
  filterChip: { borderWidth: 1, borderColor: '#374151', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  filterChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  filterChipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },
  dateHeader: { color: '#4b5563', fontSize: 11, fontWeight: '700', marginHorizontal: 20, marginTop: 16, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
  emptyText: { color: '#4b5563', marginTop: 12, fontSize: 14 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111827', marginHorizontal: 16, marginBottom: 8,
    borderRadius: 12, padding: 14, gap: 10,
  },
  cardTeam: { borderWidth: 1, borderColor: '#f59e0b22' },
  kindBadge: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: '#1f2937', alignItems: 'center', justifyContent: 'center',
  },
  playerName: { color: '#fff', fontSize: 15, fontWeight: '700' },
  typeName: { color: '#2563eb', fontSize: 12, fontWeight: '600', marginTop: 2 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#111827', borderRadius: 20, padding: 20, maxHeight: '90%', margin: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  modalSub: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  actionRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1f2937',
  },
  actionBtn: {
    flex: 1, minWidth: '45%', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6, backgroundColor: '#1f2937',
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
  },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
