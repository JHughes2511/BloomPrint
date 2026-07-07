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
const RIM_DARK   = '#8A3B12';  // outer edge / deepest tone
const BALL_DARK  = '#C25311';  // liquid bottom
const BALL_MID   = '#E2721E';  // liquid mid
const BALL_LIGHT = '#F6A24A';  // liquid top / highlight
const EMPTY_TOP  = '#F0D9C6';  // unfilled upper tint
const EMPTY_BOT  = '#E4C1A6';  // unfilled lower tint
const SEAM       = '#5E3016';  // seam brown

/**
 * A realistic basketball that fills with liquid as an AI action runs. Pass
 * `realProgress` (0-100) when you have a genuine signal (e.g. film "segment 3
 * of 8"); otherwise it eases up a time curve toward ~92% and holds until the
 * action completes. When `done` is true it fills to 100%.
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

  // Slow ease toward 92% while running (only when there's no real signal).
  useEffect(() => {
    if (realProgress == null && !done) {
      Animated.timing(fill, { toValue: 0.92, duration: 22000, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
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
  const sw = Math.max(1.4, S / 60); // seam stroke scales with size
  const pct = Math.round(level * 100);

  // Liquid surface Y: bottom (cy+R) at 0, top (cy-R) at 1.
  const surfaceY = (cy + R) - 2 * R * level;
  const amp = Math.max(2, S / 34); // wave amplitude
  const w = S;
  // Wavy meniscus + body down to the bottom of the ball.
  const liquidPath =
    `M ${-w * 0.1} ${surfaceY} ` +
    `Q ${w * 0.2} ${surfaceY - amp} ${w * 0.45} ${surfaceY} ` +
    `T ${w * 0.95} ${surfaceY} ` +
    `T ${w * 1.1} ${surfaceY} ` +
    `L ${w * 1.1} ${S + 2} L ${-w * 0.1} ${S + 2} Z`;

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Svg width={S} height={S * 1.06}>
        <Defs>
          <ClipPath id="ballClip"><Circle cx={cx} cy={cy} r={R} /></ClipPath>
          <RadialGradient id="emptyGrad" cx="38%" cy="32%" r="80%">
            <Stop offset="0" stopColor={EMPTY_TOP} />
            <Stop offset="1" stopColor={EMPTY_BOT} />
          </RadialGradient>
          <LinearGradient id="liquidGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={BALL_LIGHT} />
            <Stop offset="0.55" stopColor={BALL_MID} />
            <Stop offset="1" stopColor={BALL_DARK} />
          </LinearGradient>
          <RadialGradient id="sheen" cx="35%" cy="28%" r="55%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* soft contact shadow */}
        <Ellipse cx={cx} cy={S + 1} rx={R * 0.72} ry={Math.max(2, S / 26)} fill="#000000" opacity={0.14} />

        {/* empty ball body */}
        <Circle cx={cx} cy={cy} r={R} fill="url(#emptyGrad)" />

        {/* rising liquid, clipped to the ball */}
        <G clipPath="url(#ballClip)">
          <Path d={liquidPath} fill="url(#liquidGrad)" />
          {/* bright meniscus line on the liquid surface */}
          {level > 0.02 && level < 0.99 && (
            <Path
              d={`M ${-w * 0.1} ${surfaceY} Q ${w * 0.2} ${surfaceY - amp} ${w * 0.45} ${surfaceY} T ${w * 0.95} ${surfaceY} T ${w * 1.1} ${surfaceY}`}
              fill="none" stroke={BALL_LIGHT} strokeWidth={sw} opacity={0.9}
            />
          )}
        </G>

        {/* specular sheen over the whole ball */}
        <Circle cx={cx} cy={cy} r={R} fill="url(#sheen)" />

        {/* seams on top */}
        <G>
          <Circle cx={cx} cy={cy} r={R} fill="none" stroke={SEAM} strokeWidth={sw} />
          <Line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke={SEAM} strokeWidth={sw} />
          <Line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke={SEAM} strokeWidth={sw} />
          <Path d={`M ${cx} ${cy - R} Q ${cx - R * 0.95} ${cy} ${cx} ${cy + R}`} fill="none" stroke={SEAM} strokeWidth={sw} />
          <Path d={`M ${cx} ${cy - R} Q ${cx + R * 0.95} ${cy} ${cx} ${cy + R}`} fill="none" stroke={SEAM} strokeWidth={sw} />
        </G>

        {/* thin dark rim for depth */}
        <Circle cx={cx} cy={cy} r={R} fill="none" stroke={RIM_DARK} strokeWidth={sw * 0.7} opacity={0.5} />
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
