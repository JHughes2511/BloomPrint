import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { playerReportsAPI } from '../../api/playerClient';

function cleanMarkdown(text: string): string {
  return text
    .split('\n')
    .map(line => {
      if (/^\s*\*{1,2}\s*$/.test(line)) return '';
      return line.replace(/\*\*\s*$/, '').replace(/^\s*\*\*\s*/, '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function PlayerTeamReportDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { reportId } = route.params;
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    playerReportsAPI.listTeam()
      .then(list => {
        const found = list.find((r: any) => r.id === reportId);
        setReport(found ?? null);
      })
      .finally(() => setLoading(false));
  }, [reportId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#16a34a" size="large" />
      </View>
    );
  }

  if (!report) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#fff' }}>Report not found</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0f1a0f' }}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.title}>
              {report.output_type.replace(/_/g, ' ').toUpperCase()}
            </Text>
            <Text style={styles.sub}>
              From {report.shared_by_name || 'Coach'} · {new Date(report.created_at).toLocaleDateString()}
            </Text>
          </View>
        </View>

        {report.message ? (
          <View style={styles.messageBox}>
            <Text style={styles.messageLabel}>Coach Message</Text>
            <Text style={styles.messageText}>{report.message}</Text>
          </View>
        ) : null}

        {report.report_text ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Team Report</Text>
            <View style={styles.reportBox}>
              <Markdown style={markdownStyles}>{cleanMarkdown(report.report_text)}</Markdown>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const markdownStyles = {
  body: { color: '#d1d5db', fontSize: 13, lineHeight: 22 },
  heading1: { color: '#ffffff', fontSize: 16, fontWeight: '800' as const, marginTop: 16, marginBottom: 4 },
  heading2: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' as const, marginTop: 14, marginBottom: 4 },
  strong: { color: '#ffffff', fontWeight: '700' as const },
  bullet_list: { marginLeft: 8 },
  list_item: { color: '#d1d5db', fontSize: 13 },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1a0f' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f1a0f' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56 },
  title: { color: '#fff', fontSize: 16, fontWeight: '900' },
  sub: { color: '#4b7a4b', fontSize: 11, marginTop: 2 },
  messageBox: {
    backgroundColor: '#16a34a22',
    borderLeftWidth: 3,
    borderLeftColor: '#16a34a',
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
  },
  messageLabel: { color: '#16a34a', fontSize: 10, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase' },
  messageText: { color: '#d1d5db', fontSize: 13 },
  section: { paddingHorizontal: 20, marginTop: 20 },
  sectionLabel: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  reportBox: { backgroundColor: '#1a2e1a', borderRadius: 12, padding: 16 },
});
