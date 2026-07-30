import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

/** Derive a real 0-100 progress from a backend job progress label, or undefined
 *  for single-call generations (which then use the estimated time curve). */
export function parseGenProgress(label?: string): number | undefined {
  if (!label) return undefined;
  // Current backend codes ("job:segment:3:8"), then the older English prose so
  // jobs already in flight during an update keep reporting real progress.
  const c = label.match(/^job:segment:(\d+):(\d+)$/);
  if (c) return Math.min(92, Math.round((parseInt(c[1], 10) / parseInt(c[2], 10)) * 90));
  if (label === 'job:synthesizing') return 95;
  const m = label.match(/segment\s+(\d+)\s+of\s+(\d+)/i);
  if (m) return Math.min(92, Math.round((parseInt(m[1], 10) / parseInt(m[2], 10)) * 90));
  if (/synthesiz/i.test(label)) return 95;
  return undefined;
}

/** Render a backend job-progress code in the coach's language.
 *  Anything that isn't a known code is passed through unchanged. */
export function jobProgressLabel(label: string | undefined, tr: (k: string, o?: any) => string): string {
  if (!label) return '';
  if (label === 'job:scanning') return tr('jobProgress.scanning');
  if (label === 'job:synthesizing') return tr('jobProgress.synthesizing');
  const c = label.match(/^job:segment:(\d+):(\d+)$/);
  if (c) return tr('jobProgress.segment', { i: c[1], n: c[2] });
  return label;
}

/**
 * A simple inline progress bar for AI-generation actions. Pass `realProgress`
 * (0-100) when there's a genuine signal (e.g. film "segment 3 of 8"); otherwise
 * it eases quickly to ~55% then keeps crawling toward 99% so the number always
 * moves. When `done` is true it fills to 100%.
 *
 * Renders nothing unless `visible` is true. Drop it in-place under a button:
 *   <GeneratingOverlay visible={generating} label="…" />
 */
export function GeneratingOverlay({
  visible,
  label,
  realProgress,
  done = false,
}: {
  visible: boolean;
  label?: string;
  realProgress?: number;
  done?: boolean;
  size?: number; // accepted for backwards-compat; unused
}) {
  if (!visible) return null;
  return <GeneratingBar label={label} realProgress={realProgress} done={done} />;
}

function GeneratingBar({
  label,
  realProgress,
  done = false,
}: {
  label?: string;
  realProgress?: number;
  done?: boolean;
}) {
  const { t } = useTheme();
  const styles = makeStyles(t);
  const fill = useRef(new Animated.Value(0)).current;
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const id = fill.addListener(({ value }) => setPct(Math.round(Math.min(1, Math.max(0, value)) * 100)));
    return () => fill.removeListener(id);
  }, [fill]);

  // Estimated curve when there's no real signal: quick to ~55%, then a steady
  // crawl toward 99% (faster than before) so the number never appears frozen.
  useEffect(() => {
    if (realProgress == null && !done) {
      Animated.sequence([
        Animated.timing(fill, { toValue: 0.55, duration: 3500, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.timing(fill, { toValue: 0.99, duration: 42000, easing: Easing.linear, useNativeDriver: false }),
      ]).start();
    }
  }, []);

  // Real progress wins.
  useEffect(() => {
    if (realProgress != null) {
      Animated.timing(fill, { toValue: Math.min(1, Math.max(0, realProgress / 100)), duration: 500, useNativeDriver: false }).start();
    }
  }, [realProgress]);

  useEffect(() => {
    if (done) Animated.timing(fill, { toValue: 1, duration: 300, useNativeDriver: false }).start();
  }, [done]);

  const width = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.pct}>{pct}%</Text>
        {!!label && <Text style={styles.label} numberOfLines={2}>{label}</Text>}
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width }]} />
      </View>
    </View>
  );
}

// Legacy default export (kept so any older import still resolves).
export default GeneratingOverlay;

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  wrap: { marginTop: 16, width: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  pct: { color: t.ink, fontSize: 15, fontFamily: fonts[900], minWidth: 44 },
  label: { color: t.muted, fontSize: 12.5, flex: 1 },
  track: {
    height: 10,
    borderRadius: 999,
    backgroundColor: t.chip,
    borderWidth: 1,
    borderColor: t.line,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: t.accent,
  },
});
