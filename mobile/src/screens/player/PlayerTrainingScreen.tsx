import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playerTrainingAPI } from '../../api/playerClient';
import { PlayerTraining } from '../../types';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemeTokens } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { ScreenBackground } from '../../theme/components';
import { parseDrills } from '../../utils/trainingDrills';

const timeAgo = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 7) return `${Math.floor(d)} days ago`;
  if (d < 14) return '1 week ago';
  if (d < 30) return `${Math.floor(d / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString();
};

const cleanPreview = (s: string) =>
  s.replace(/#{1,6}\s?/g, '').replace(/\*\*/g, '').replace(/\*/g, '')
   .replace(/__/g, '').replace(/_([^_]+)_/g, '$1').replace(/^\s*[-•]\s/gm, '').trim();

export default function PlayerTrainingScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const [programs, setPrograms] = useState<PlayerTraining[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const data = await playerTrainingAPI.list();
      setPrograms(data);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const sorted = [...programs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const mostRecent = sorted[0];

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
        <Text style={styles.title}>My Training</Text>
        <Text style={styles.sub}>
          {programs.length > 0 ? 'Programs your coach built for you' : 'Training from your coach'}
        </Text>
      </View>

      {programs.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="barbell-outline" size={48} color={t.muted2} />
          <Text style={styles.emptyTitle}>No training programs yet</Text>
          <Text style={styles.emptyDesc}>
            Open a shared report and tap "Generate Training Program" to create one.
          </Text>
        </View>
      ) : (
        <>
          {/* Tracking summary */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryTop}>
              <Text style={styles.summaryLabel}>Your Training</Text>
              <View style={styles.countPill}><Text style={styles.countPillText}>{programs.length}</Text></View>
            </View>
            <View style={styles.summaryRow}>
              <Ionicons name="time-outline" size={15} color={t.muted} />
              <Text style={styles.summaryMeta}>
                {mostRecent ? `Most recent ${timeAgo(mostRecent.created_at)}` : 'No programs yet'}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Sent to You</Text>

          {sorted.map((pt, idx) => (
            <TouchableOpacity
              key={pt.id}
              style={styles.card}
              onPress={() => navigation.navigate('PlayerTrainingDetail', { trainingId: pt.id })}
            >
              <View style={styles.cardTop}>
                <View style={styles.iconBg}>
                  <Ionicons name="barbell" size={20} color="#16201A" />
                </View>
                <View style={{ flex: 1, marginLeft: 13 }}>
                  <Text style={styles.cardTitle}>{idx === 0 ? 'Latest Program' : 'Training Program'}</Text>
                  <Text style={styles.cardDate}>Sent {timeAgo(pt.created_at)}</Text>
                </View>
                {pt.coach_notes ? (
                  <View style={styles.notesBadge}>
                    <Ionicons name="chatbubble-ellipses-outline" size={12} color={t.positive} />
                    <Text style={styles.notesBadgeText}>Coach Notes</Text>
                  </View>
                ) : null}
                <Ionicons name="chevron-forward" size={16} color={t.muted2} style={{ marginLeft: 8 }} />
              </View>
              {pt.program_text ? (
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
                    <Text style={styles.progressLabel}>{done}/{total}</Text>
                  </View>
                );
              })()}
            </TouchableOpacity>
          ))}
        </>
      )}
    </ScrollView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 22, paddingTop: 60 },
  title: { color: t.ink, fontSize: 30, fontFamily: fonts[800], letterSpacing: -0.6 },
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
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { color: t.ink, fontSize: 15.5, fontFamily: fonts[800] },
  cardDate: { color: t.muted, fontSize: 12.5, marginTop: 1 },
  notesBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: t.positiveSoft, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  notesBadgeText: { color: t.positive, fontSize: 10.5, fontFamily: fonts[700] },
  preview: { color: t.muted, fontSize: 12.5, marginTop: 11, lineHeight: 18 },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  progressTrack: { flex: 1, height: 7, borderRadius: 4, backgroundColor: t.chip, overflow: 'hidden' },
  progressFill: { height: 7, borderRadius: 4, backgroundColor: t.accent },
  progressLabel: { color: t.muted, fontSize: 11.5, fontFamily: fonts[700] },
});
