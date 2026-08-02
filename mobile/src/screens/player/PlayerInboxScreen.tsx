import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, TextInput,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playerReportsAPI } from '../../api/playerClient';
import { useTheme } from '../../theme/ThemeProvider';
import { topPad } from '../../responsive/screenPadding';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';
import PageContainer from '../../responsive/PageContainer';
import { outputTypeLabel } from '../../utils/reportType';
import { timeAgo } from '../../utils/timeAgo';
import { useGridColumns } from '../../responsive/useGridColumns';
import { desktopOnly } from '../../responsive/modalSizes';

const LEVEL_RE = /\b(HS Varsity|HS JV|Varsity|JUCO|NAIA|D1|D2|D3|College|Pro|AAU|Middle School|Youth|EYBL|Prep)\b/i;
const SKIP_TITLE = /^(bim\b|player\b|program\b|framework\b|overall\b|grade\b|evaluation\b|status\b|rating\b|section\b|output\b|\d+\s+frames|rating scale|status options|comparable|floor comp|ceiling comp)/i;

const cleanLine = (l: string) =>
  l.replace(/\*\*/g, '').replace(/^#{1,6}\s*/, '').replace(/[—–_=]{2,}/g, '').trim();

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// A short, clean subject from the report body: the player's name (+ level) for
// player reports, or the best descriptive title (team matchup / scheme) for team
// reports. Trailing descriptors are dropped, and any line that just repeats the
// report type (e.g. "FILM BREAKDOWN") is rejected.
const cleanSubject = (reportText: string, outputType: string): string | null => {
  const typeNorm = norm(outputTypeLabel(outputType) || '');
  const head = reportText.split('\n').map(cleanLine).filter(Boolean).slice(0, 18);

  const playerLine = head.find(l => /^player\s*:/i.test(l));
  if (playerLine) {
    const name = playerLine.replace(/^player\s*:/i, '').split('/')[0].trim();
    if (name) {
      const lm = head.join(' ').match(LEVEL_RE);
      const level = lm ? lm[1] : '';
      return level && !name.toLowerCase().includes(level.toLowerCase()) ? `${name} · ${level}` : name;
    }
  }

  // Build candidate descriptive titles, rejecting headers, metadata lines, and
  // anything that just echoes the report type.
  const candidates = head
    .filter((l, i) =>
      i > 0 &&
      l.length >= 6 && l.length <= 80 &&
      /[a-z]/.test(l) &&                       // must have lowercase (not an ALL-CAPS header)
      !SKIP_TITLE.test(l) &&
      !/:/.test(l.slice(0, 26)) &&             // skip "Program:", "Coach Focus:", etc.
      norm(l) !== typeNorm && !norm(l).includes(typeNorm),
    )
    .map(l => l.split(/\s+[—–-]\s+/)[0].replace(/\s*\|.*$/, '').trim())
    .filter(s => s.length >= 4 && norm(s) !== typeNorm && !norm(s).includes(typeNorm));

  // Prefer a matchup ("X vs Y"); otherwise the first solid descriptive line.
  return candidates.find(s => /\bvs?\.?\b/i.test(s)) || candidates[0] || null;
};

// What the player actually received, used as a clean fallback name when the
// report body was excluded from the share.
const sharedContentLabel = (item: InboxItem): string => {
  if (item.kind === 'team') return i18n.t('playerApp.inbox.fullReport');
  if (item.share_report_text) return i18n.t('playerApp.inbox.fullReport');
  if (item.share_grades) return i18n.t('playerApp.inbox.pillarGrades');
  if (item.share_flags) return i18n.t('playerApp.inbox.flagsNotes');
  if (item.share_questions) return i18n.t('playerApp.inbox.keyQuestions');
  return i18n.t('playerApp.inbox.sharedReport');
};

// Every report gets a clean sub-name: the body's subject when available, else a
// description of what was shared.
const reportSubName = (item: InboxItem): string => {
  if (item.report_text) {
    const subject = cleanSubject(item.report_text, item.output_type);
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
  { key: 'all' },
  { key: 'evals' },
  { key: 'film' },
] as const;


export default function PlayerInboxScreen() {
  const reportGrid = useGridColumns({ columns: 3, inset: 32 });
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<typeof FILTERS[number]['key']>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');

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

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter(item => {
      const haystack = [
        reportSubName(item),
        item.shared_by_name,
        outputTypeLabel(item.output_type),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [filtered, search]);

  const handleTap = (item: InboxItem) => {
    if (item.kind === 'eval') {
      navigation.push('PlayerReportDetail', { reportId: item.id });
    } else {
      navigation.push('PlayerTeamReportDetail', { reportId: item.id });
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
    <PageContainer padded={false} maxWidth={1600}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={t.positive} />}
    >
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {/* Long translations shrink and clip instead of shoving the search button out. */}
          <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
            <Text style={styles.title} numberOfLines={1}>
              {tr('playerApp.inbox.title')}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.searchButton}
            onPress={() => {
              setSearchOpen(open => {
                if (open) setSearch('');
                return !open;
              });
            }}
          >
            <Ionicons name={searchOpen ? 'close' : 'search'} size={20} color={t.ink} />
          </TouchableOpacity>
        </View>
        <Text style={styles.sub} numberOfLines={1}>{tr('playerApp.inbox.sub')}</Text>
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
              <Text style={active ? styles.filterTextActive : styles.filterTextIdle} numberOfLines={1}>{tr(`playerApp.inbox.filter.${f.key}`)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {searchOpen && (
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={17} color={t.muted2} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={tr('playerApp.inbox.searchReports')}
            placeholderTextColor={t.muted2}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
      )}

      {searched.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="mail-outline" size={48} color={t.muted2} />
          <Text style={styles.emptyTitle} numberOfLines={2}>{search.trim() ? tr('playerApp.inbox.noMatches') : tr('playerApp.inbox.noReportsYet')}</Text>
          <Text style={styles.emptyDesc}>
            {search.trim()
              ? tr('playerApp.inbox.noMatchDesc')
              : filter === 'all'
                ? tr('playerApp.inbox.emptyAllDesc')
                : tr('playerApp.inbox.emptyCategoryDesc')}
          </Text>
        </View>
      ) : (
        <View style={desktopOnly({ flexDirection: 'row', flexWrap: 'wrap', gap: reportGrid.gap, paddingHorizontal: 16 })}
              onLayout={reportGrid.onLayout}>
        {searched.map(item => {
          const isFilm = (item.output_type || '').includes('film');
          return (
            <TouchableOpacity
              key={`${item.kind}-${item.id}`}
              style={[styles.card, reportGrid.cardWidth ? { width: reportGrid.cardWidth, marginHorizontal: 0 } : null]}
              onPress={() => handleTap(item)}
            >
              <View style={styles.cardTop}>
                <View style={[styles.typeBadge, isFilm ? styles.typeBadgeFilm : styles.typeBadgeEval]}>
                  <Text style={[styles.typeText, { color: isFilm ? t.brown : t.accent }]} numberOfLines={1}>
                    {item.kind === 'team' ? tr('playerApp.inbox.teamPrefix') : ''}{(outputTypeLabel(item.output_type) || tr('reportTypes.report')).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.date} numberOfLines={1}>{timeAgo(item.created_at)}</Text>
              </View>

              <Text style={styles.cardTitle} numberOfLines={2}>{reportSubName(item)}</Text>

              <View style={styles.cardFooter}>
                <View style={styles.sharedItems}>
                  {item.kind === 'eval' && item.share_grades && (
                    <View style={styles.chip}><Text style={styles.chipText} numberOfLines={1}>{tr('playerApp.inbox.chipGrades')}</Text></View>
                  )}
                  {item.kind === 'eval' && item.share_report_text && (
                    <View style={styles.chip}><Text style={styles.chipText} numberOfLines={1}>{tr('reportTypes.report')}</Text></View>
                  )}
                  {item.kind === 'eval' && item.share_flags && (
                    <View style={styles.chip}><Text style={styles.chipText} numberOfLines={1}>{tr('playerApp.inbox.chipFlags')}</Text></View>
                  )}
                  {item.kind === 'eval' && item.share_questions && (
                    <View style={styles.chip}><Text style={styles.chipText} numberOfLines={1}>{tr('playerApp.inbox.chipQuestions')}</Text></View>
                  )}
                  {item.kind === 'team' && (
                    <View style={styles.chip}><Text style={styles.chipText} numberOfLines={1}>{tr('playerApp.inbox.fullReport')}</Text></View>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={16} color={t.muted2} />
              </View>
            </TouchableOpacity>
          );
        })}
        </View>
      )}
    </ScrollView>
    </PageContainer>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  header: { paddingHorizontal: 22, paddingTop: topPad(60) },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: t.ink, fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6 },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.line,
    flexShrink: 0,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 22,
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.line,
    backgroundColor: t.card,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    color: t.ink,
    fontSize: 15,
    fontFamily: fonts[600],
    paddingVertical: 12,
  },
  sub: { color: t.muted, fontSize: 13.5, marginTop: 5 },
  filterRow: { flexDirection: 'row', gap: 9, paddingHorizontal: 22, marginTop: 20, marginBottom: 8, flexWrap: 'wrap' },
  filterPill: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, flexShrink: 1 },
  filterPillActive: { backgroundColor: t.ctaBg },
  filterPillIdle: { borderWidth: 1, borderColor: t.line },
  filterTextActive: { color: t.ctaText, fontSize: 13.5, fontFamily: fonts[800], flexShrink: 1 },
  filterTextIdle: { color: t.ink, fontSize: 13.5, fontFamily: fonts[700], flexShrink: 1 },
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
  typeBadge: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, flexShrink: 1, marginRight: 8 },
  typeBadgeEval: { backgroundColor: t.accentSoft },
  typeBadgeFilm: { backgroundColor: t.brownSoft },
  typeText: { fontSize: 10.5, fontFamily: fonts[800], letterSpacing: 0.4, flexShrink: 1 },
  date: { color: t.muted2, fontSize: 12.5, flexShrink: 0 },
  cardTitle: { color: t.ink, fontSize: 17.5, fontFamily: fonts[800], marginTop: 12 },
  cardMeta: { color: t.muted, fontSize: 13.5, marginTop: 3 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  sharedItems: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 },
  chip: {
    backgroundColor: t.chip,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
    flexShrink: 1,
    maxWidth: '100%',
  },
  chipText: { color: t.muted, fontSize: 10.5, fontFamily: fonts[600], flexShrink: 1 },
});
