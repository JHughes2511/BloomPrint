import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, TextInput,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { playerTrainingAPI } from '../../api/playerClient';
import { PlayerTraining } from '../../types';
import { useTheme } from '../../theme/ThemeProvider';
import { topPad } from '../../responsive/screenPadding';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';
import PageContainer from '../../responsive/PageContainer';
import { parseDrills } from '../../utils/trainingDrills';
import { timeAgo } from '../../utils/timeAgo';
import { useGridColumns } from '../../responsive/useGridColumns';
import { desktopOnly } from '../../responsive/modalSizes';


const cleanPreview = (s: string) =>
  s.replace(/#{1,6}\s?/g, '').replace(/\*\*/g, '').replace(/\*/g, '')
   .replace(/__/g, '').replace(/_([^_]+)_/g, '$1').replace(/^\s*[-•]\s/gm, '').trim();

interface UnifiedProgram {
  id: number;
  created_at: string;
  origin: 'self' | 'coach';
  program_text: string | null;
  completed_drills: string[];
  coach_notes?: string | null;
  reformatting?: boolean;
}

export default function PlayerTrainingScreen() {
  const trainGrid = useGridColumns({ columns: 3, inset: 32 });
  const navigation = useNavigation<any>();
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const [programs, setPrograms] = useState<PlayerTraining[]>([]);
  const [coachSent, setCoachSent] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const load = async () => {
    try {
      const [data, coach] = await Promise.all([
        playerTrainingAPI.list(),
        playerTrainingAPI.listCoachSent().catch(() => []),
      ]);
      setPrograms(data);
      setCoachSent(Array.isArray(coach) ? coach : []);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const unified: UnifiedProgram[] = [
    ...programs.map(pt => ({
      id: pt.id, created_at: pt.created_at, origin: 'self' as const,
      program_text: pt.program_text, completed_drills: pt.completed_drills ?? [], coach_notes: pt.coach_notes,
    })),
    ...coachSent.map(cs => ({
      id: cs.id, created_at: cs.created_at, origin: 'coach' as const,
      program_text: cs.player_program_text, completed_drills: cs.completed_drills ?? [], reformatting: cs.reformatting,
    })),
  ];

  const sorted = unified.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sorted.filter((pt, idx) => {
        const title = idx === 0 ? tr('playerApp.training.latestProgram') : tr('reportTypes.training_program');
        const preview = pt.program_text ? cleanPreview(pt.program_text) : '';
        const date = tr('playerApp.training.sentTime', { time: timeAgo(pt.created_at) });
        return [title, preview, date].some((s) => s.toLowerCase().includes(q));
      })
    : sorted;

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
          {/* Long translations shrink and clip rather than pushing the search button out. */}
          <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
            <Text style={styles.title} numberOfLines={1}>
              {tr('playerApp.training.title')}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.searchBtn}
            onPress={() => {
              setSearchOpen((o) => {
                if (o) setQuery('');
                return !o;
              });
            }}
          >
            <Ionicons name={searchOpen ? 'close' : 'search'} size={20} color={t.ink} />
          </TouchableOpacity>
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {unified.length > 0 ? tr('playerApp.training.subtitleHasPrograms') : tr('playerApp.training.subtitleEmpty')}
        </Text>
        {searchOpen ? (
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color={t.muted2} />
            <TextInput
              style={styles.searchInput}
              placeholder={tr('playerApp.training.searchPlaceholder')}
              placeholderTextColor={t.muted2}
              value={query}
              onChangeText={setQuery}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
        ) : null}
      </View>

      {unified.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="barbell-outline" size={48} color={t.muted2} />
          <Text style={styles.emptyTitle} numberOfLines={2}>{tr('playerApp.training.emptyTitle')}</Text>
          <Text style={styles.emptyDesc}>
            {tr('playerApp.training.emptyDesc')}
          </Text>
        </View>
      ) : (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 22 }]} numberOfLines={1}>{tr('playerApp.training.sentToYou')}</Text>

          {filtered.length === 0 ? (
            <Text style={styles.noResults}>{tr('playerApp.training.noMatch', { query: query.trim() })}</Text>
          ) : null}

          <View style={desktopOnly({ flexDirection: 'row', flexWrap: 'wrap', gap: trainGrid.gap, paddingHorizontal: 16 })}
                ref={trainGrid.ref} onLayout={trainGrid.onLayout}>
          {filtered.map((pt, idx) => (
            <TouchableOpacity
              key={`${pt.origin}-${pt.id}`}
              style={[styles.card, trainGrid.cardWidth ? { width: trainGrid.cardWidth, marginHorizontal: 0 } : null]}
              onPress={() => navigation.navigate(
                pt.origin === 'coach' ? 'PlayerCoachTrainingDetail' : 'PlayerTrainingDetail',
                { trainingId: pt.id },
              )}
            >
              <View style={styles.cardTop}>
                <View style={styles.iconBg}>
                  <Ionicons name="barbell" size={20} color="#16201A" />
                </View>
                <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginLeft: 13, marginRight: 8 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{idx === 0 ? tr('playerApp.training.latestProgram') : tr('reportTypes.training_program')}</Text>
                  <Text style={styles.cardDate} numberOfLines={1}>{tr('playerApp.training.sentTime', { time: timeAgo(pt.created_at) })}</Text>
                </View>
                {pt.origin === 'coach' ? (
                  <View style={styles.coachBadge}>
                    <Text style={styles.coachBadgeText} numberOfLines={1}>{tr('playerApp.training.fromCoach')}</Text>
                  </View>
                ) : pt.coach_notes ? (
                  <View style={styles.notesBadge}>
                    <Ionicons name="chatbubble-ellipses-outline" size={12} color={t.positive} />
                    <Text style={styles.notesBadgeText} numberOfLines={1}>{tr('playerApp.training.coachNotes')}</Text>
                  </View>
                ) : null}
                <Ionicons name="chevron-forward" size={16} color={t.muted2} style={{ marginLeft: 8 }} />
              </View>
              {pt.reformatting ? (
                <Text style={styles.preview}>{tr('playerApp.training.preparingProgram')}</Text>
              ) : pt.program_text ? (
                <Text style={styles.preview} numberOfLines={2}>{cleanPreview(pt.program_text)}</Text>
              ) : null}
              {(() => {
                const total = parseDrills(pt.program_text).total;
                if (!total) return null;
                const done = (pt.completed_drills ?? []).length;
                return (
                  <View style={styles.progressWrap}>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${Math.min(100, (done / total) * 100)}%` }]} />
                    </View>
                    <Text style={styles.progressLabel} numberOfLines={1}>{done}/{total}</Text>
                  </View>
                );
              })()}
            </TouchableOpacity>
          ))}
          </View>
        </>
      )}
    </ScrollView>
    </PageContainer>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 22, paddingTop: topPad(60) },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: t.ink, fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6 },
  searchBtn: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: t.card,
    borderWidth: 1, borderColor: t.cardBorder, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.cardBorder,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 14,
  },
  searchInput: { flex: 1, color: t.ink, fontSize: 14, fontFamily: fonts[600], padding: 0 },
  noResults: { color: t.muted, fontSize: 13, marginHorizontal: 22, marginTop: 4, marginBottom: 8 },
  sub: { color: t.muted, fontSize: 13.5, marginTop: 5 },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: 40 },
  emptyTitle: { color: t.ink, fontSize: 16, fontFamily: fonts[700], marginTop: 16 },
  emptyDesc: { color: t.muted, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 20 },

  summaryCard: {
    backgroundColor: t.card, borderRadius: 20, padding: 18,
    marginHorizontal: 20, marginTop: 20, borderWidth: 1, borderColor: t.cardBorder,
  },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { color: t.muted2, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 1.6, textTransform: 'uppercase' },
  countPill: { backgroundColor: t.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  countPillText: { color: t.accent, fontSize: 15, fontFamily: fonts[800] },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  summaryMeta: { color: t.muted, fontSize: 13, fontFamily: fonts[600] },

  sectionLabel: {
    color: t.label, fontSize: 12, fontFamily: fonts[700], letterSpacing: 1.6,
    textTransform: 'uppercase', marginHorizontal: 22, marginTop: 24, marginBottom: 13,
  },
  card: {
    backgroundColor: t.card, borderRadius: 16, padding: 15,
    marginHorizontal: 20, marginBottom: 11, borderWidth: 1, borderColor: t.cardBorder,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  iconBg: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: t.pistachio,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardTitle: { color: t.ink, fontSize: 15.5, fontFamily: fonts[800], flexShrink: 1 },
  cardDate: { color: t.muted, fontSize: 12.5, marginTop: 1, flexShrink: 1 },
  notesBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: t.positiveSoft, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
    flexShrink: 1, maxWidth: 130,
  },
  notesBadgeText: { color: t.positive, fontSize: 10.5, fontFamily: fonts[700], flexShrink: 1 },
  coachBadge: { backgroundColor: t.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 1, maxWidth: 130 },
  coachBadgeText: { color: t.accent, fontSize: 10.5, fontFamily: fonts[700], flexShrink: 1 },
  preview: { color: t.muted, fontSize: 12.5, marginTop: 11, lineHeight: 18 },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  progressTrack: { flex: 1, flexShrink: 1, minWidth: 0, height: 7, borderRadius: 4, backgroundColor: t.chip, overflow: 'hidden' },
  progressFill: { height: 7, borderRadius: 4, backgroundColor: t.accent },
  progressLabel: { color: t.muted, fontSize: 11.5, fontFamily: fonts[700], flexShrink: 0 },
});
