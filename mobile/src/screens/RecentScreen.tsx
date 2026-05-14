import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { evalsAPI } from '../api/client';
import { EvalWithPlayer } from '../types';
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
};

export default function RecentScreen() {
  const navigation = useNavigation<any>();
  const [evals, setEvals] = useState<EvalWithPlayer[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setEvals(await evalsAPI.recent());
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  if (loading) return <View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Recent Reports</Text>
      <FlatList
        data={evals}
        keyExtractor={e => String(e.id)}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="document-text-outline" size={48} color="#374151" />
            <Text style={styles.emptyText}>No reports yet.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('RosterTab', {
              screen: 'EvalReport',
              params: { evalId: item.id },
            })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.playerName}>{item.player_name}</Text>
              <Text style={styles.typeName}>{TYPE_LABELS[item.output_type] ?? item.output_type}</Text>
              <Text style={styles.date}>{new Date(item.created_at).toLocaleDateString()}</Text>
            </View>
            <GradeBadge grade={item.overall_grade} size="md" />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 56 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', marginHorizontal: 20, marginBottom: 16 },
  emptyText: { color: '#4b5563', marginTop: 12, fontSize: 14 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111827', marginHorizontal: 16, marginBottom: 10,
    borderRadius: 12, padding: 16,
  },
  playerName: { color: '#fff', fontSize: 15, fontWeight: '700' },
  typeName: { color: '#2563eb', fontSize: 12, fontWeight: '600', marginTop: 2 },
  date: { color: '#6b7280', fontSize: 11, marginTop: 2 },
});
