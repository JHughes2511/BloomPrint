import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

const PILLAR_LABELS: Record<string, string> = {
  offensive_skills: 'Offensive Skills',
  defensive_capabilities: 'Defensive',
  physical_attributes: 'Physical',
  intangibles: 'Intangibles',
  advanced_analysis: 'Advanced',
  strategic_fit: 'Strategic Fit',
};

function gradeColor(g: number, t: ThemeTokens) {
  if (g >= 8) return t.positive;
  if (g >= 6.5) return t.accent;
  if (g >= 5) return t.brown;
  return t.negative;
}

export function PillarCard({ pillarKey, grade }: { pillarKey: string; grade: number }) {
  const { t } = useTheme();
  const label = PILLAR_LABELS[pillarKey] ?? pillarKey;
  const color = gradeColor(grade, t);
  const pct = (grade / 10) * 100;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={[styles.label, { color: t.inkSoft }]}>{label}</Text>
        <Text style={[styles.grade, { color }]}>{grade.toFixed(1)}</Text>
      </View>
      <View style={[styles.barBg, { backgroundColor: t.chip }]}>
        <View style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: 13 },
  grade: { fontSize: 13, fontFamily: fonts[700] },
  barBg: { height: 6, borderRadius: 3 },
  barFill: { height: 6, borderRadius: 3 },
});
