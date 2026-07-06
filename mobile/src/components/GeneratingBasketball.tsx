import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import Svg, { Circle, Line, Path, Defs, ClipPath, Rect, G } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { fonts } from '../theme/typography';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** Derive a real 0-100 progress from a backend job progress label, or undefined
 *  for single-call generations (which then use the estimated time curve). */
export function parseGenProgress(label?: string): number | undefined {
  if (!label) return undefined;
  const m = label.match(/segment\s+(\d+)\s+of\s+(\d+)/i);
  if (m) return Math.min(92, Math.round((parseInt(m[1], 10) / parseInt(m[2], 10)) * 90));
  if (/synthesiz/i.test(label)) return 95;
  return undefined;
}

const BALL = '#E67E22';   // basketball orange
const SEAM = '#7A4326';   // seam brown

/**
 * A basketball that fills up as an AI action runs. Pass `realProgress` (0-100)
 * when you have a genuine signal (e.g. film "segment 3 of 8"); otherwise it
 * eases up a time curve toward ~92% and holds until the action completes.
 * When `done` is true it fills to 100%.
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
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const id = fill.addListener(({ value }) => setPct(Math.round(Math.min(1, Math.max(0, value)) * 100)));
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
  const rectY = fill.interpolate({ inputRange: [0, 1], outputRange: [S, 0] });
  const rectH = fill.interpolate({ inputRange: [0, 1], outputRange: [0, S] });

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Svg width={S} height={S}>
        <Defs>
          <ClipPath id="ballClip"><Circle cx={cx} cy={cy} r={R} /></ClipPath>
        </Defs>
        {/* empty ball background */}
        <Circle cx={cx} cy={cy} r={R} fill={t.chip} stroke={BALL} strokeWidth={2} />
        {/* rising orange fill, clipped to the ball */}
        <G clipPath="url(#ballClip)">
          <AnimatedRect x={0} y={rectY as any} width={S} height={rectH as any} fill={BALL} />
        </G>
        {/* seams on top */}
        <G opacity={0.9}>
          <Circle cx={cx} cy={cy} r={R} fill="none" stroke={SEAM} strokeWidth={1.5} />
          <Line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke={SEAM} strokeWidth={1.5} />
          <Line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke={SEAM} strokeWidth={1.5} />
          <Path d={`M ${cx} ${cy - R} Q ${cx - R * 0.95} ${cy} ${cx} ${cy + R}`} fill="none" stroke={SEAM} strokeWidth={1.5} />
          <Path d={`M ${cx} ${cy - R} Q ${cx + R * 0.95} ${cy} ${cx} ${cy + R}`} fill="none" stroke={SEAM} strokeWidth={1.5} />
        </G>
      </Svg>
      <Text style={{ color: t.ink, fontSize: 18, fontFamily: fonts[900] }}>{pct}%</Text>
      {!!label && <Text style={{ color: t.muted, fontSize: 12.5, textAlign: 'center', paddingHorizontal: 20 }}>{label}</Text>}
    </View>
  );
}
