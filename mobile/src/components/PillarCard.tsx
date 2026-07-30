import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

// Each pillar keeps its own identity color (blues + browns), theme-aware —
// alternating so the six bars read as distinct rather than one solid block.
const PILLAR_TONE: Record<string, 'accent' | 'brown'> = {
  offensive_skills: 'accent',
  defensive_capabilities: 'brown',
  physical_attributes: 'accent',
  intangibles: 'brown',
  advanced_analysis: 'accent',
  strategic_fit: 'brown',
};
const PILLAR_ORDER = Object.keys(PILLAR_TONE);

function pillarColor(pillarKey: string, t: ThemeTokens) {
  let tone = PILLAR_TONE[pillarKey];
  if (!tone) {
    const idx = PILLAR_ORDER.indexOf(pillarKey);
    tone = (idx >= 0 ? idx : Math.abs(hashKey(pillarKey))) % 2 === 0 ? 'accent' : 'brown';
  }
  return tone === 'accent' ? t.accent : t.brown;
}

function hashKey(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function PillarCard({ pillarKey, grade }: { pillarKey: string; grade: number }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  // Pillar keys come from AI-parsed report text, so an unknown key is possible —
  // fall back to a readable title-cased version of the key itself.
  const label = tr(`evalReport.pillars.${pillarKey}`, {
    defaultValue: pillarKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  });
  const color = pillarColor(pillarKey, t);
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
