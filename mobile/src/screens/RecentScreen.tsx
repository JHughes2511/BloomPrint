import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, Modal,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { evalsAPI } from '../api/client';
import { GradeBadge } from '../components/GradeBadge';

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

const FILTER_CATS = [
  { key: 'all', label: 'All' },
  { key: 'eval', label: 'Player Evals' },
  { key: 'team', label: 'Team Reports' },
];

export default function RecentScreen() {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [teamReportModal, setTeamReportModal] = useState<{ text: string; outputType: string } | null>(null);
  const [teamReportTexts, setTeamReportTexts] = useState<Record<number, string>>({});

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

  const handlePress = (item: ReportItem) => {
    if (item.kind === 'eval') {
      navigation.navigate('EvalReport', { evalId: item.id });
    } else {
      const text = teamReportTexts[item.id] ?? '';
      setTeamReportModal({ text, outputType: item.output_type });
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

      {/* Team Report Detail Modal */}
      <Modal visible={!!teamReportModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {TYPE_LABELS[teamReportModal?.outputType ?? ''] ?? teamReportModal?.outputType ?? 'Team Report'}
              </Text>
              <TouchableOpacity onPress={() => setTeamReportModal(null)}>
                <Ionicons name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <Markdown style={mdStyles}>{teamReportModal?.text ?? ''}</Markdown>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const mdStyles = {
  body: { color: '#d1d5db', fontSize: 13, lineHeight: 22 },
  heading1: { color: '#fff', fontSize: 16, fontWeight: '800' as const, marginTop: 16, marginBottom: 4 },
  heading2: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' as const, marginTop: 12, marginBottom: 4 },
  heading3: { color: '#9ca3af', fontSize: 13, fontWeight: '700' as const, marginTop: 10, marginBottom: 2 },
  strong: { color: '#fff', fontWeight: '700' as const },
  bullet_list: { marginLeft: 8 },
  list_item: { color: '#d1d5db', fontSize: 13 },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#111827', borderRadius: 20, padding: 20, maxHeight: '85%', margin: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800', flex: 1 },
});
