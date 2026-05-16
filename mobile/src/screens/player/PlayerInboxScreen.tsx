import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { playerReportsAPI } from '../../api/playerClient';
import { SharedReport } from '../../types';

export default function PlayerInboxScreen() {
  const navigation = useNavigation<any>();
  const [reports, setReports] = useState<SharedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const data = await playerReportsAPI.list();
      setReports(data);
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
        <Text style={styles.title}>My Reports</Text>
        <Text style={styles.sub}>{reports.length} report{reports.length !== 1 ? 's' : ''} shared with you</Text>
      </View>

      {reports.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="mail-outline" size={48} color="#2d4a2d" />
          <Text style={styles.emptyTitle}>No reports yet</Text>
          <Text style={styles.emptyDesc}>When a coach shares a report with you, it will appear here.</Text>
        </View>
      ) : (
        reports.map(report => (
          <TouchableOpacity
            key={report.id}
            style={styles.card}
            onPress={() => navigation.navigate('PlayerReportDetail', { reportId: report.id })}
          >
            <View style={styles.cardTop}>
              <View style={styles.typeBadge}>
                <Text style={styles.typeText}>
                  {report.output_type.replace(/_/g, ' ').toUpperCase()}
                </Text>
              </View>
              <Text style={styles.date}>
                {new Date(report.created_at).toLocaleDateString()}
              </Text>
            </View>
            <Text style={styles.cardTitle}>
              Report from {report.shared_by_name || 'Coach'}
            </Text>
            {report.message && (
              <Text style={styles.message} numberOfLines={2}>{report.message}</Text>
            )}
            <View style={styles.cardFooter}>
              <View style={styles.sharedItems}>
                {report.share_grades && (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>Grades</Text>
                  </View>
                )}
                {report.share_report_text && (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>Report</Text>
                  </View>
                )}
                {report.share_flags && (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>Flags</Text>
                  </View>
                )}
                {report.share_questions && (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>Questions</Text>
                  </View>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color="#4b5563" />
            </View>
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
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  typeBadge: {
    backgroundColor: '#16a34a22',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  typeText: { color: '#16a34a', fontSize: 10, fontWeight: '700' },
  date: { color: '#4b7a4b', fontSize: 11 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  message: { color: '#9ca3af', fontSize: 12, marginBottom: 8, lineHeight: 18 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  sharedItems: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    backgroundColor: '#2d4a2d',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: { color: '#9ca3af', fontSize: 10 },
});
