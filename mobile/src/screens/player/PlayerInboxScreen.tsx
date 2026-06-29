import React, { useCallback, useState } from 'react';
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

type InboxItem = {
  id: number;
  kind: 'eval' | 'team';
  output_type: string;
  created_at: string;
  shared_by_name: string;
  message?: string | null;
  share_grades?: boolean;
  share_report_text?: boolean;
  share_flags?: boolean;
  share_questions?: boolean;
};

export default function PlayerInboxScreen() {
  const { t } = useTheme();
  const styles = makeStyles(t);
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
        <Text style={styles.sub}>{items.length} report{items.length !== 1 ? 's' : ''} shared with you</Text>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="mail-outline" size={48} color={t.muted2} />
          <Text style={styles.emptyTitle}>No reports yet</Text>
          <Text style={styles.emptyDesc}>When a coach shares a report with you, it will appear here.</Text>
        </View>
      ) : (
        items.map(item => (
          <TouchableOpacity
            key={`${item.kind}-${item.id}`}
            style={styles.card}
            onPress={() => handleTap(item)}
          >
            <View style={styles.cardTop}>
              <View style={styles.typeBadge}>
                <Text style={styles.typeText}>
                  {item.kind === 'team' ? 'TEAM · ' : ''}{item.output_type.replace(/_/g, ' ').toUpperCase()}
                </Text>
              </View>
              <Text style={styles.date}>
                {new Date(item.created_at).toLocaleDateString()}
              </Text>
            </View>
            <Text style={styles.cardTitle}>
              Report from {item.shared_by_name || 'Coach'}
            </Text>
            {item.message ? (
              <Text style={styles.message} numberOfLines={2}>{item.message}</Text>
            ) : null}
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
              <Ionicons name="chevron-forward" size={16} color={t.muted} />
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  header: { padding: 24, paddingTop: 60 },
  title: { color: t.ink, fontSize: 26, fontWeight: '900' },
  sub: { color: t.muted, fontSize: 12, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyTitle: { color: t.ink, fontSize: 16, fontWeight: '700', marginTop: 16 },
  emptyDesc: { color: t.muted, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  card: {
    backgroundColor: t.card,
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  typeBadge: {
    backgroundColor: t.positiveSoft,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: t.positive,
  },
  typeText: { color: t.positive, fontSize: 10, fontWeight: '700' },
  date: { color: t.muted, fontSize: 11 },
  cardTitle: { color: t.ink, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  message: { color: t.muted, fontSize: 12, marginBottom: 8, lineHeight: 18 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  sharedItems: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    backgroundColor: t.chip,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: { color: t.muted, fontSize: 10 },
});
