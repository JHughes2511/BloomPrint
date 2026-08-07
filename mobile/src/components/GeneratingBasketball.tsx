import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

/** Human file size, one decimal only where it reads better ("1.4 GB", "820 MB"). */
export function formatBytes(n: number): string {
  if (!n || n < 0) return '0 MB';
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

/**
 * Encode upload progress into the same label channel the backend job codes use,
 * so a screen can hand one string to both the bar and the caption. `i`/`n` are
 * for flows that upload several films in a row.
 */
export function uploadProgressCode(sent: number, total: number, i?: number, n?: number): string {
  const pct = total ? Math.round((sent / total) * 100) : 0;
  const base = `job:upload:${pct}:${formatBytes(sent)}:${formatBytes(total)}`;
  return i && n && n > 1 ? `${base}:${i}:${n}` : base;
}

/** Derive a real 0-100 progress from a backend job progress label, or undefined
 *  for single-call generations (which then use the estimated time curve). */
export function parseGenProgress(label?: string): number | undefined {
  if (!label) return undefined;
  // The upload runs before any job exists, and on a multi-gigabyte film it is
  // the longest phase of the whole flow. Its own 0-100 is a real measurement —
  // bytes actually put on the wire — so it drives the bar directly.
  const up = label.match(/^job:upload:(\d+):/);
  if (up) return Math.min(100, parseInt(up[1], 10));
  // Current backend codes ("job:segment:3:8"), then the older English prose so
  // jobs already in flight during an update keep reporting real progress.
  // Scanning is a real, known phase and it is the FIRST one. Left to the
  // estimated curve the bar crawled to 99% within a minute and then sat there
  // for the rest of a long film — a number that says "done" while the work has
  // barely started is worse than no number. Pin it low; the segments take over.
  if (label === 'job:scanning') return 3;
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
  const up = label.match(/^job:upload:(\d+):([^:]*):([^:]*)(?::(\d+):(\d+))?$/);
  if (up) {
    const o = { pct: up[1], sent: up[2], total: up[3] };
    return up[4]
      ? tr('jobProgress.uploadingOf', { ...o, i: up[4], n: up[5] })
      : tr('jobProgress.uploading', o);
  }
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
  //
  // Keyed on whether a real signal exists rather than on mount, because a film
  // runs in two phases: the upload measures itself, the breakdown that follows
  // does not. Without this the bar would freeze at the 100% the upload left
  // behind while the caption said the analysis was under way. Losing the real
  // signal starts a fresh bar for the new phase.
  const hasReal = realProgress != null;
  useEffect(() => {
    if (hasReal || done) return;
    fill.setValue(0);
    // Paced for the work, not for the wait. The old curve reached 99% in 45
    // seconds, so anything that takes minutes — which is most film work — spent
    // almost all of it pinned at 99%. It now moves quickly through the early
    // stretch, where something usually IS finishing, and then creeps, so the
    // number keeps meaning something on a long job instead of maxing out.
    Animated.sequence([
      Animated.timing(fill, { toValue: 0.35, duration: 4000, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.timing(fill, { toValue: 0.75, duration: 90000, easing: Easing.linear, useNativeDriver: false }),
      Animated.timing(fill, { toValue: 0.95, duration: 300000, easing: Easing.linear, useNativeDriver: false }),
    ]).start();
  }, [hasReal, done]);

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
