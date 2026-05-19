import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playerTrainingAPI } from '../../api/playerClient';
import { PlayerTraining } from '../../types';

export default function PlayerTrainingScreen() {
  const navigation = useNavigation<any>();
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
      <View style={styles.center}>
        <ActivityIndicator color="#16a34a" size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#16a34a" />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>My Training</Text>
        <Text style={styles.sub}>{programs.length} program{programs.length !== 1 ? 's' : ''}</Text>
      </View>

      {programs.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="barbell-outline" size={48} color="#2d4a2d" />
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
                <Ionicons name="barbell" size={18} color="#16a34a" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.cardTitle}>Training Program</Text>
                <Text style={styles.cardDate}>{new Date(pt.created_at).toLocaleDateString()}</Text>
              </View>
              {pt.coach_notes && (
                <View style={styles.notesBadge}>
                  <Ionicons name="chatbubble" size={12} color="#16a34a" />
                  <Text style={styles.notesBadgeText}>Coach Notes</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color="#4b5563" style={{ marginLeft: 8 }} />
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1a0f' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f1a0f' },
  header: { padding: 24, paddingTop: 60 },
  title: { color: '#fff', fontSize: 26, fontWeight: '900' },
  sub: { color: '#4b7a4b', fontSize: 12, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 16 },
  emptyDesc: { color: '#4b7a4b', fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  card: {
    backgroundColor: '#1a2e1a',
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2d4a2d',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  iconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#16a34a22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cardDate: { color: '#4b7a4b', fontSize: 11, marginTop: 2 },
  notesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#16a34a22',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  notesBadgeText: { color: '#16a34a', fontSize: 10, fontWeight: '600' },
  preview: { color: '#9ca3af', fontSize: 12, marginTop: 10, lineHeight: 18 },
});
