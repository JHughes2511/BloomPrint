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
        <Text style={styles.sub}>{programs.length} program{programs.length !== 1 ? 's' : ''}</Text>
      </View>

      {programs.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="barbell-outline" size={48} color={t.positiveSoft} />
          <Text style={styles.emptyTitle}>No training programs yet</Text>
          <Text style={styles.emptyDesc}>
            Open a shared report and tap "Generate Training Program" to create one.
          </Text>
        </View>
      ) : (
        programs.map(pt => (
          <TouchableOpacity
            key={pt.id}
            style={styles.card}
            onPress={() => navigation.navigate('PlayerTrainingDetail', { trainingId: pt.id })}
          >
            <View style={styles.cardTop}>
              <View style={styles.iconBg}>
                <Ionicons name="barbell" size={18} color={t.positive} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.cardTitle}>Training Program</Text>
                <Text style={styles.cardDate}>{new Date(pt.created_at).toLocaleDateString()}</Text>
              </View>
              {pt.coach_notes && (
                <View style={styles.notesBadge}>
                  <Ionicons name="chatbubble" size={12} color={t.positive} />
                  <Text style={styles.notesBadgeText}>Coach Notes</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={t.muted2} style={{ marginLeft: 8 }} />
            </View>
            {pt.program_text && (
              <Text style={styles.preview} numberOfLines={2}>
                {pt.program_text.replace(/#{1,6}\s?/g, '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/__/g, '').replace(/_([^_]+)_/g, '$1').replace(/^\s*[-•]\s/gm, '').trim()}
              </Text>
            )}
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { padding: 24, paddingTop: 60 },
  title: { color: t.ink, fontSize: 26, fontWeight: '900' },
  sub: { color: t.positive, fontSize: 12, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyTitle: { color: t.ink, fontSize: 16, fontWeight: '700', marginTop: 16 },
  emptyDesc: { color: t.positive, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  card: {
    backgroundColor: t.card,
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.cardBorder,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  iconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: t.positiveSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: t.ink, fontSize: 14, fontWeight: '700' },
  cardDate: { color: t.positive, fontSize: 11, marginTop: 2 },
  notesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.positiveSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: t.positive,
  },
  notesBadgeText: { color: t.positive, fontSize: 10, fontWeight: '600' },
  preview: { color: t.muted, fontSize: 12, marginTop: 10, lineHeight: 18 },
});
