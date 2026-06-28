// Typography scale from the design handoff (Hanken Grotesk).
// Font family names match the @expo-google-fonts/hanken-grotesk exports loaded
// in App.tsx. Use `font(weight)` to get the right family for a weight.

import { TextStyle } from 'react-native';

export const fonts = {
  400: 'HankenGrotesk_400Regular',
  500: 'HankenGrotesk_500Medium',
  600: 'HankenGrotesk_600SemiBold',
  700: 'HankenGrotesk_700Bold',
  800: 'HankenGrotesk_800ExtraBold',
  900: 'HankenGrotesk_900Black',
} as const;

export type FontWeightKey = keyof typeof fonts;

export const font = (weight: FontWeightKey = 400): string => fonts[weight];

// Named text styles matching the README scale (px @ 390-wide mobile).
export const type = {
  h1: { fontFamily: fonts[800], fontSize: 30, letterSpacing: -0.6 } as TextStyle,
  sectionTitle: { fontFamily: fonts[800], fontSize: 18 } as TextStyle,
  metric: { fontFamily: fonts[900], fontSize: 44, letterSpacing: -0.9 } as TextStyle,
  body: { fontFamily: fonts[500], fontSize: 14.5, lineHeight: 22 } as TextStyle,
  bodySoft: { fontFamily: fonts[400], fontSize: 14, lineHeight: 22 } as TextStyle,
  // Signature small uppercase label — colored with the `label` token by callers.
  label: {
    fontFamily: fonts[700], fontSize: 11.5, letterSpacing: 2, textTransform: 'uppercase',
  } as TextStyle,
  tab: { fontFamily: fonts[600], fontSize: 11 } as TextStyle,
  tabActive: { fontFamily: fonts[700], fontSize: 11 } as TextStyle,
};
