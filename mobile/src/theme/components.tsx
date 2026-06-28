import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ViewStyle, TextStyle,
  StyleProp, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from './ThemeProvider';
import { type as typeScale, fonts } from './typography';
import { Icon, IconName } from './icons';

// ── Screen background (gradient canvas, both modes) ──────────────────────────
export function ScreenBackground({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { t } = useTheme();
  return (
    <LinearGradient
      colors={t.canvas.colors}
      locations={t.canvas.locations as any}
      start={t.canvas.start}
      end={t.canvas.end}
      style={[{ flex: 1 }, style]}
    >
      {children}
    </LinearGradient>
  );
}

// ── Themed text ──────────────────────────────────────────────────────────────
type TxtProps = {
  children: React.ReactNode;
  variant?: keyof typeof typeScale;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};
export function Txt({ children, variant = 'body', color, style, numberOfLines }: TxtProps) {
  const { t } = useTheme();
  const base = typeScale[variant];
  const c = color ?? (variant === 'label' ? t.label : t.ink);
  return <Text numberOfLines={numberOfLines} style={[base, { color: c }, style]}>{children}</Text>;
}

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const { t } = useTheme();
  return <Text style={[typeScale.label, { color: t.label, marginBottom: 12 }, style]}>{children}</Text>;
}

// ── Card (frosted + translucent in dark, solid white in light) ───────────────
type CardProps = {
  children: React.ReactNode;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  padding?: number;
};
export function Card({ children, selected, style, padding = 18 }: CardProps) {
  const { t } = useTheme();
  const borderColor = selected ? t.accent : t.cardBorder;
  const borderWidth = selected ? 1.5 : 1;
  const radius = 20;

  if (t.isDark) {
    return (
      <BlurView
        intensity={28}
        tint="dark"
        style={[{ borderRadius: radius, overflow: 'hidden', borderWidth, borderColor }, style]}
      >
        <View style={{ backgroundColor: t.card, padding }}>{children}</View>
      </BlurView>
    );
  }
  return (
    <View style={[{
      backgroundColor: t.card, borderRadius: radius, borderWidth, borderColor, padding,
      shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
    }, style]}>
      {children}
    </View>
  );
}

// ── Icon tile (rounded square leading icon) ──────────────────────────────────
type IconTileVariant = 'accent' | 'brown' | 'positive' | 'negative' | 'neutral';
export function IconTile({ name, variant = 'accent', size = 46 }: { name: IconName; variant?: IconTileVariant; size?: number }) {
  const { t } = useTheme();
  const map: Record<IconTileVariant, { bg: string; fg: string }> = {
    accent: { bg: t.tile, fg: t.tileIcon },
    brown: { bg: t.brownSoft, fg: t.brown },
    positive: { bg: t.positiveSoft, fg: t.positive },
    negative: { bg: t.negativeSoft, fg: t.negative },
    neutral: { bg: t.chip, fg: t.muted },
  };
  const { bg, fg } = map[variant];
  return (
    <View style={{ width: size, height: size, borderRadius: 13, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={Math.round(size * 0.44)} color={fg} strokeWidth={2} />
    </View>
  );
}

// ── Pills ────────────────────────────────────────────────────────────────────
export function Pill({
  label, active, onPress, style,
}: { label: string; active?: boolean; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const { t } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[{
        paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999,
        backgroundColor: active ? t.ctaBg : 'transparent',
        borderWidth: active ? 0 : 1, borderColor: t.line,
      }, style]}
    >
      <Text style={{ fontFamily: fonts[700], fontSize: 13, color: active ? t.ctaText : t.muted }}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Dark pill badge (report-type tags) ───────────────────────────────────────
export function DarkBadge({ label }: { label: string }) {
  const { t } = useTheme();
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: t.badgeBg, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
      <Text style={{ fontFamily: fonts[700], fontSize: 11, color: t.badgeText }}>{label}</Text>
    </View>
  );
}

// ── Status badge (soft fill + solid token text) ──────────────────────────────
type StatusKind = 'accent' | 'positive' | 'negative' | 'neutral';
export function StatusBadge({ label, kind = 'accent' }: { label: string; kind?: StatusKind }) {
  const { t } = useTheme();
  const map: Record<StatusKind, { bg: string; fg: string }> = {
    accent: { bg: t.accentSoft, fg: t.accent },
    positive: { bg: t.positiveSoft, fg: t.positive },
    negative: { bg: t.negativeSoft, fg: t.negative },
    neutral: { bg: t.chip, fg: t.muted },
  };
  const { bg, fg } = map[kind];
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ fontFamily: fonts[700], fontSize: 11.5, color: fg }}>{label}</Text>
    </View>
  );
}

// ── Action button family (semantic, muted) ───────────────────────────────────
type ActionVariant = 'primary' | 'secondary' | 'positive' | 'brown' | 'neutral' | 'destructive';
export function ActionButton({
  label, onPress, variant = 'primary', icon, loading, disabled, style, full,
}: {
  label: string; onPress?: () => void; variant?: ActionVariant; icon?: IconName;
  loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; full?: boolean;
}) {
  const { t } = useTheme();
  let bg = t.ctaBg, fg = t.ctaText, borderColor = 'transparent', borderWidth = 0;
  switch (variant) {
    case 'secondary': bg = 'transparent'; fg = t.cta2Text; borderColor = t.cta2Border; borderWidth = 1; break;
    case 'positive': bg = t.pistachio; fg = '#16201A'; break;
    case 'brown': bg = t.brown; fg = t.brownInk; break;
    case 'neutral': bg = t.chip; fg = t.ink; break;
    case 'destructive': bg = 'transparent'; fg = t.negative; borderColor = t.negative; borderWidth = 1.5; break;
  }
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: bg, borderColor, borderWidth, borderRadius: 999,
        paddingVertical: 13, paddingHorizontal: 19, opacity: disabled ? 0.5 : 1,
        flex: full ? 1 : undefined,
      }, style]}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : (
        <>
          {icon ? <Icon name={icon} size={17} color={fg} strokeWidth={2.2} /> : null}
          <Text style={{ fontFamily: fonts[800], fontSize: 14, color: fg }}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export const themeStyles = StyleSheet.create({
  screenPad: { paddingHorizontal: 22 },
});
