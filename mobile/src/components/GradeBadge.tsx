import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function GradeBadge({ grade, size = 'md' }: { grade: number | null; size?: 'sm' | 'md' | 'lg' }) {
  const { t } = useTheme();
  if (grade === null) return null;

  // Grade scale folded into the brand palette (no bright red/green/yellow).
  const color = grade >= 8 ? t.positive : grade >= 6.5 ? t.accent : grade >= 5 ? t.brown : t.negative;
  const sz = size === 'lg' ? 56 : size === 'md' ? 44 : 32;
  const fs = size === 'lg' ? 20 : size === 'md' ? 15 : 12;

  return (
    <View style={[styles.badge, { width: sz, height: sz, borderRadius: sz / 2, borderColor: color }]}>
      <Text style={[styles.text, { color, fontSize: fs }]}>{grade.toFixed(1)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '800' },
});
