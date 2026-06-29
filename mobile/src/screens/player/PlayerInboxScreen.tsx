import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playerReportsAPI } from '../../api/playerClient';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';
import { outputTypeLabel } from '../../utils/reportType';

const LEVEL_RE = /\b(HS Varsity|HS JV|Varsity|JUCO|NAIA|D1|D2|D3|College|Pro|AAU|Middle School|Youth|EYBL|Prep)\b/i;
const SKIP_TITLE = /^(bim\b|player\b|program\b|framework\b|overall\b|grade\b|evaluation\b|status\b|rating\b|section\b|output\b|\d+\s+frames|rating scale|status options|comparable|floor comp|ceiling comp)/i;

const cleanLine = (l: string) =>
  l.replace(/\*\*/g, '').replace(/^#{1,6}\s*/, '').replace(/[—–_=]{2,}/g, '').trim();

// A short, clean subject from the report body: the player's name (+ level) for
// player reports, or the team matchup for team reports — trailing descriptors
// like "— Comprehensive Game Plan" / "— Creator Academy" are dropped.
const cleanSubject = (reportText: string): string | null => {
  const head = reportText.split('\n').map(cleanLine).filter(Boolean).slice(0, 12);

  const playerLine = head.find(l => /^player\s*:/i.test(l));
  if (playerLine) {
    const name = playerLine.replace(/^player\s*:/i, '').split('/')[0].trim();
    if (name) {
      const lm = head.join(' ').match(LEVEL_RE);
      const level = lm ? lm[1] : '';
      return level && !name.toLowerCase().includes(level.toLowerCase()) ? `${name} · ${level}` : name;
    }
  }

  const titleLine = head.find((l, i) => i > 0 && l.length > 8 && /[a-z]/.test(l) && /[A-Z]/.test(l) && !SKIP_TITLE.test(l));
  if (titleLine) {
    const subject = titleLine.split(/\s+[—–-]\s+/)[0].replace(/\s*\|.*$/, '').trim();
    if (subject.length > 3) return subject;
  }
  return null;
};

// What the player actually received, used as a clean fallback name when the
// report body was excluded from the share.
const sharedContentLabel = (item: InboxItem): string => {
  if (item.kind === 'team') return 'Full Report';
  if (item.share_report_text) return 'Full Report';
  if (item.share_grades) return 'Pillar Grades';
  if (item.share_flags) return 'Flags & Notes';
  if (item.share_questions) return 'Key Questions';
  return 'Shared Report';
};

// Every report gets a clean sub-name: the body's subject when available, else a
// description of what was shared.
const reportSubName = (item: InboxItem): string => {
  if (item.report_text) {
    const subject = cleanSubject(item.report_text);
    if (subject) return subject;
  }
  return sharedContentLabel(item);
};

type InboxItem = {
  id: number;
  kind: 'eval' | 'team';
  output_type: string;
  created_at: string;
  shared_by_name: string;
  message?: string | null;
  report_text?: string | null;
  overall_grade?: number | null;
  share_grades?: boolean;
  share_report_text?: boolean;
  share_flags?: boolean;
  share_questions?: boolean;
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'evals', label: 'Evaluations' },
  { key: 'film', label: 'Film' },
] as const;

const timeAgo = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const d = ms / 86400000;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 7) return `${Math.floor(d)} days ago`;
  if (d < 14) return '1 week ago';
  if (d < 30) return `${Math.floor(d / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString();
};

export default function PlayerInboxScreen() {
  const { t } = useTheme();
  const styles = makeStyles(t);
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<typeof FILTERS[number]['key']>('all');

  const load = async () => {
    try {
      const [evalReports, teamReports] = await Promise.all([
        playerReportsAPI.list(),
        playerReportsAPI.listTeam(),
      ]);
      const combined: InboxItem[] = [
        ...evalReports.map((r: any) => ({ ...r, kind: 'eval' as const })),
        ...teamReports.map((r: any) => ({ ...r, kind: 'team' as const })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setItems(combined);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'film') return items.filter(i => (i.output_type || '').includes('film'));
    // Evaluations: eval-kind reports that aren't pure film breakdowns
    return items.filter(i => i.kind === 'eval' && !(i.output_type || '').includes('film'));
  }, [items, filter]);

  const handleTap = (item: InboxItem) => {
    if (item.kind === 'eval') {
      navigation.navigate('PlayerReportDetail', { reportId: item.id });
    } else {
      navigation.navigate('PlayerTeamReportDetail', { reportId: item.id });
    }
  };

  if (loading) {
    return (
      <ScreenBackground>
        <View style={styles.center}>
          <ActivityIndicator color={t.positive} size="large" />
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={t.positive} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>My Reports</Text>
        <Text style={styles.sub}>Shared with you by your coaching staff</Text>
      </View>

      {/* Filter pills */}
      <View style={styles.filterRow}>
        {FILTERS.map(f => {
          const active = filter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterPill, active ? styles.filterPillActive : styles.filterPillIdle]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={active ? styles.filterTextActive : styles.filterTextIdle}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="mail-outline" size={48} color={t.muted2} />
          <Text style={styles.emptyTitle}>No reports yet</Text>
          <Text style={styles.emptyDesc}>
            {filter === 'all'
              ? 'When a coach shares a report with you, it will appear here.'
              : 'No reports in this category yet.'}
          </Text>
        </View>
      ) : (
        filtered.map(item => {
          const isFilm = (item.output_type || '').includes('film');
          const grade = item.kind === 'eval' && item.share_grades && item.overall_grade != null
            ? item.overall_grade : null;
          return (
            <TouchableOpacity
              key={`${item.kind}-${item.id}`}
              style={styles.card}
              onPress={() => handleTap(item)}
            >
              <View style={styles.cardTop}>
                <View style={[styles.typeBadge, isFilm ? styles.typeBadgeFilm : styles.typeBadgeEval]}>
                  <Text style={[styles.typeText, { color: isFilm ? t.brown : t.accent }]}>
                    {item.kind === 'team' ? 'TEAM · ' : ''}{(outputTypeLabel(item.output_type) || 'Report').toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.date}>{timeAgo(item.created_at)}</Text>
              </View>

              {(() => {
                const sub = reportSubName(item);
                return sub ? <Text style={styles.cardTitle} numberOfLines={2}>{sub}</Text> : null;
              })()}
              {grade != null ? <Text style={styles.cardMeta}>BIM {grade.toFixed(1)}</Text> : null}

              <View style={styles.cardFooter}>
                <View style={styles.sharedItems}>
                  {item.kind === 'eval' && item.share_grades && (
                    <View style={styles.chip}><Text style={styles.chipText}>Grades</Text></View>
                  )}
                  {item.kind === 'eval' && item.share_report_text && (
                    <View style={styles.chip}><Text style={styles.chipText}>Report</Text></View>
                  )}
                  {item.kind === 'eval' && item.share_flags && (
                    <View style={styles.chip}><Text style={styles.chipText}>Flags</Text></View>
                  )}
                  {item.kind === 'eval' && item.share_questions && (
                    <View style={styles.chip}><Text style={styles.chipText}>Questions</Text></View>
                  )}
                  {item.kind === 'team' && (
                    <View style={styles.chip}><Text style={styles.chipText}>Full Report</Text></View>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={16} color={t.muted2} />
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  header: { paddingHorizontal: 22, paddingTop: 60 },
  title: { color: t.ink, fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6 },
  sub: { color: t.muted, fontSize: 13.5, marginTop: 5 },
  filterRow: { flexDirection: 'row', gap: 9, paddingHorizontal: 22, marginTop: 20, marginBottom: 8 },
  filterPill: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999 },
  filterPillActive: { backgroundColor: t.ctaBg },
  filterPillIdle: { borderWidth: 1, borderColor: t.line },
  filterTextActive: { color: t.ctaText, fontSize: 13.5, fontFamily: fonts[800] },
  filterTextIdle: { color: t.ink, fontSize: 13.5, fontFamily: fonts[700] },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: 40 },
  emptyTitle: { color: t.ink, fontSize: 16, fontFamily: fonts[700], marginTop: 16 },
  emptyDesc: { color: t.muted, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  card: {
    backgroundColor: t.card,
    borderRadius: 18,
    padding: 17,
    marginHorizontal: 20,
    marginTop: 13,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typeBadge: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  typeBadgeEval: { backgroundColor: t.accentSoft },
  typeBadgeFilm: { backgroundColor: t.brownSoft },
  typeText: { fontSize: 10.5, fontFamily: fonts[800], letterSpacing: 0.4 },
  date: { color: t.muted2, fontSize: 12.5 },
  cardTitle: { color: t.ink, fontSize: 17.5, fontFamily: fonts[800], marginTop: 12 },
  cardMeta: { color: t.muted, fontSize: 13.5, marginTop: 3 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  sharedItems: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 },
  chip: {
    backgroundColor: t.chip,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  chipText: { color: t.muted, fontSize: 10.5, fontFamily: fonts[600] },
});
