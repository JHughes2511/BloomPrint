import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, Modal, StyleSheet } from 'react-native';
import Svg, {
  Circle, Line, Path, Defs, ClipPath, G,
  RadialGradient, LinearGradient, Stop, Ellipse,
} from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

/** Derive a real 0-100 progress from a backend job progress label, or undefined
 *  for single-call generations (which then use the estimated time curve). */
export function parseGenProgress(label?: string): number | undefined {
  if (!label) return undefined;
  const m = label.match(/segment\s+(\d+)\s+of\s+(\d+)/i);
  if (m) return Math.min(92, Math.round((parseInt(m[1], 10) / parseInt(m[2], 10)) * 90));
  if (/synthesiz/i.test(label)) return 95;
  return undefined;
}

// Real-basketball palette (theme-independent — a basketball is orange everywhere).
const SEAM      = '#1C1109';  // near-black seam
const LIQ_TOP   = '#F0A050';  // filled: highlight
const LIQ_MID   = '#D66E1D';  // filled: mid
const LIQ_BOT   = '#A94A11';  // filled: deep
const EMPTY_TOP = '#B07C52';  // unfilled: muted upper
const EMPTY_BOT = '#8A5C38';  // unfilled: muted lower

/**
 * A realistic basketball that fills with liquid as an AI action runs. Pass
 * `realProgress` (0-100) when you have a genuine signal (e.g. film "segment 3
 * of 8"); otherwise it eases up a time curve and keeps creeping toward 99%
 * (never stalling) until the action completes. When `done` is true it fills
 * to 100%.
 */
export default function GeneratingBasketball({
  size = 96,
  label,
  realProgress,
  done = false,
}: {
  size?: number;
  label?: string;
  realProgress?: number;
  done?: boolean;
}) {
  const { t } = useTheme();
  const fill = useRef(new Animated.Value(0)).current;
  const [level, setLevel] = useState(0); // 0..1

  useEffect(() => {
    const id = fill.addListener(({ value }) => setLevel(Math.min(1, Math.max(0, value))));
    return () => fill.removeListener(id);
  }, [fill]);

  // Estimated curve when there's no real signal: quick to ~55%, then a slow
  // continuous crawl toward 99% so it never appears frozen at one number.
  useEffect(() => {
    if (realProgress == null && !done) {
      Animated.sequence([
        Animated.timing(fill, { toValue: 0.55, duration: 5000, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.timing(fill, { toValue: 0.99, duration: 90000, easing: Easing.linear, useNativeDriver: false }),
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
    if (done) Animated.timing(fill, { toValue: 1, duration: 400, useNativeDriver: false }).start();
  }, [done]);

  const S = size;
  const cx = S / 2, cy = S / 2, R = S / 2 - 3;
  const sw = Math.max(2, S / 26); // seam stroke scales with size
  const pct = Math.round(level * 100);

  // Liquid surface Y: bottom (cy+R) at 0, top (cy-R) at 1.
  const surfaceY = (cy + R) - 2 * R * level;
  const amp = Math.max(2, S / 34); // wave amplitude
  const w = S;
  const liquidPath =
    `M ${-w * 0.1} ${surfaceY} ` +
    `Q ${w * 0.2} ${surfaceY - amp} ${w * 0.45} ${surfaceY} ` +
    `T ${w * 0.95} ${surfaceY} ` +
    `T ${w * 1.1} ${surfaceY} ` +
    `L ${w * 1.1} ${S + 2} L ${-w * 0.1} ${S + 2} Z`;

  // Classic basketball seams: vertical meridian, horizontal meridian, and two
  // curved side seams — drawn thick and dark like a real ball.
  const vSeam = `M ${cx} ${cy - R} L ${cx} ${cy + R}`;
  const hSeam = `M ${cx - R} ${cy} L ${cx + R} ${cy}`;
  const leftSeam  = `M ${cx} ${cy - R} Q ${cx - R * 1.05} ${cy} ${cx} ${cy + R}`;
  const rightSeam = `M ${cx} ${cy - R} Q ${cx + R * 1.05} ${cy} ${cx} ${cy + R}`;

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Svg width={S} height={S * 1.06}>
        <Defs>
          <ClipPath id="ballClip"><Circle cx={cx} cy={cy} r={R} /></ClipPath>
          <RadialGradient id="emptyGrad" cx="42%" cy="36%" r="75%">
            <Stop offset="0" stopColor={EMPTY_TOP} />
            <Stop offset="1" stopColor={EMPTY_BOT} />
          </RadialGradient>
          <LinearGradient id="liquidGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={LIQ_TOP} />
            <Stop offset="0.5" stopColor={LIQ_MID} />
            <Stop offset="1" stopColor={LIQ_BOT} />
          </LinearGradient>
          {/* edge vignette gives the round, spherical look of a real ball */}
          <RadialGradient id="vign" cx="42%" cy="36%" r="65%">
            <Stop offset="0" stopColor="#000000" stopOpacity={0} />
            <Stop offset="0.72" stopColor="#000000" stopOpacity={0} />
            <Stop offset="1" stopColor="#3A1704" stopOpacity={0.55} />
          </RadialGradient>
          {/* subtle matte highlight, top-left */}
          <RadialGradient id="sheen" cx="36%" cy="26%" r="42%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* soft contact shadow */}
        <Ellipse cx={cx} cy={S + 1} rx={R * 0.72} ry={Math.max(2, S / 26)} fill="#000000" opacity={0.16} />

        {/* empty ball body */}
        <Circle cx={cx} cy={cy} r={R} fill="url(#emptyGrad)" />

        {/* rising liquid, clipped to the ball */}
        <G clipPath="url(#ballClip)">
          <Path d={liquidPath} fill="url(#liquidGrad)" />
          {level > 0.02 && level < 0.99 && (
            <Path
              d={`M ${-w * 0.1} ${surfaceY} Q ${w * 0.2} ${surfaceY - amp} ${w * 0.45} ${surfaceY} T ${w * 0.95} ${surfaceY} T ${w * 1.1} ${surfaceY}`}
              fill="none" stroke={LIQ_TOP} strokeWidth={sw * 0.8} opacity={0.85}
            />
          )}
        </G>

        {/* spherical shading + subtle highlight */}
        <Circle cx={cx} cy={cy} r={R} fill="url(#vign)" />
        <Circle cx={cx} cy={cy} r={R} fill="url(#sheen)" />

        {/* seams on top */}
        <G clipPath="url(#ballClip)">
          <Path d={vSeam} fill="none" stroke={SEAM} strokeWidth={sw} strokeLinecap="round" />
          <Path d={hSeam} fill="none" stroke={SEAM} strokeWidth={sw} strokeLinecap="round" />
          <Path d={leftSeam} fill="none" stroke={SEAM} strokeWidth={sw} strokeLinecap="round" />
          <Path d={rightSeam} fill="none" stroke={SEAM} strokeWidth={sw} strokeLinecap="round" />
        </G>

        {/* crisp outline */}
        <Circle cx={cx} cy={cy} r={R} fill="none" stroke={SEAM} strokeWidth={sw * 0.9} />
      </Svg>
      <Text style={{ color: t.ink, fontSize: Math.max(16, S * 0.19), fontFamily: fonts[900] }}>{pct}%</Text>
      {!!label && <Text style={{ color: t.muted, fontSize: 12.5, textAlign: 'center', paddingHorizontal: 20 }}>{label}</Text>}
    </View>
  );
}

/**
 * Full-screen overlay that floats the filling basketball above everything with
 * a dimmed backdrop and blocks interaction. Drive it from any screen's
 * generation boolean(s): <GeneratingOverlay visible={generating} label="…" />.
 */
export function GeneratingOverlay({
  visible,
  label,
  realProgress,
  done = false,
  size = 150,
}: {
  visible: boolean;
  label?: string;
  realProgress?: number;
  done?: boolean;
  size?: number;
}) {
  const { t } = useTheme();
  const styles = overlayStyles(t);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Remount on each open so the fill animation restarts from 0. */}
          {visible && (
            <GeneratingBasketball size={size} label={label} realProgress={realProgress} done={done} />
          )}
        </View>
      </View>
    </Modal>
  );
}

const overlayStyles = (t: ThemeTokens) => StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: t.card,
    borderRadius: 24,
    paddingVertical: 30,
    paddingHorizontal: 34,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
    minWidth: 220,
  },
});
