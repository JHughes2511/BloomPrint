import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const PILLAR_LABELS: Record<string, string> = {
  offensive_skills: 'Offensive Skills',
  defensive_capabilities: 'Defensive',
  physical_attributes: 'Physical',
  intangibles: 'Intangibles',
  advanced_analysis: 'Advanced',
  strategic_fit: 'Strategic Fit',
};

function gradeColor(g: number) {
  if (g >= 8) return '#22c55e';
  if (g >= 6.5) return '#eab308';
  if (g >= 5) return '#f97316';
  return '#ef4444';
}

export function PillarCard({ pillarKey, grade }: { pillarKey: string; grade: number }) {
  const label = PILLAR_LABELS[pillarKey] ?? pillarKey;
  const color = gradeColor(grade);
  const pct = (grade / 10) * 100;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.grade, { color }]}>{grade.toFixed(1)}</Text>
      </View>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { color: '#d1d5db', fontSize: 13 },
  grade: { fontSize: 13, fontWeight: '700' },
  barBg: { height: 6, backgroundColor: '#1f2937', borderRadius: 3 },
  barFill: { height: 6, borderRadius: 3 },
});
