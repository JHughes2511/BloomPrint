import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function GradeBadge({ grade, size = 'md' }: { grade: number | null; size?: 'sm' | 'md' | 'lg' }) {
  if (grade === null) return null;

  const color = grade >= 8 ? '#22c55e' : grade >= 6.5 ? '#eab308' : grade >= 5 ? '#f97316' : '#ef4444';
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
