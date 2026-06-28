// Luxury recolor design tokens — one shared token set, themed twice.
// Light = "Beige Luxury", Dark = "Blue Luxury". Components reference tokens,
// never raw hex. Source: design_handoff_bloomprint_luxury_recolor/README.md.

import { ColorValue } from 'react-native';

export type Gradient = {
  colors: [ColorValue, ColorValue, ...ColorValue[]];
  locations?: number[];
  start: { x: number; y: number };
  end: { x: number; y: number };
};

export type ThemeTokens = {
  mode: 'light' | 'dark';
  isDark: boolean;

  // Canvas is a gradient in BOTH modes (not a flat fill).
  canvas: Gradient;

  // Text
  ink: string;
  inkSoft: string;
  muted: string;
  muted2: string;
  label: string;

  // Accent
  accent: string;
  accentSoft: string;

  // Surfaces
  card: string;
  cardBorder: string;
  cardBlurIntensity: number; // 0 = no blur (light); dark uses ~14
  divider: string;
  line: string;
  chip: string;

  // Dark pill badge (report-type tags)
  badgeBg: string;
  badgeText: string;

  // Buttons
  ctaBg: string;
  ctaText: string;
  cta2Text: string;
  cta2Border: string;

  // Semantic (muted into palette)
  pistachio: string;          // positive / "Send to Player"
  positive: string;
  positiveSoft: string;
  negative: string;           // destructive / clay
  negativeSoft: string;
  brown: string;              // secondary / "Share w/ Staff"
  brownSoft: string;
  brownInk: string;           // text on a brown fill

  // Icon tiles
  tile: string;
  tileIcon: string;

  // Chrome
  navbar: string;
  scrim: string;              // dimmed backdrop behind bottom-sheet modals
};

export const light: ThemeTokens = {
  mode: 'light',
  isDark: false,

  canvas: {
    colors: ['#F7F2EA', '#EFE7DA'],
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
  },

  ink: '#16242E',
  inkSoft: '#34424B',
  muted: '#8A8174',
  muted2: '#ABA192',
  label: '#1F6F9B',

  accent: '#1F6F9B',
  accentSoft: 'rgba(31,111,155,0.10)',

  card: '#FFFFFF',
  cardBorder: '#E7DFD0',
  cardBlurIntensity: 0,
  divider: '#EAE2D5',
  line: '#E1D9CA',
  chip: '#EFE8DC',

  badgeBg: '#171513',
  badgeText: '#F5F0E8',

  ctaBg: '#1F6F9B',
  ctaText: '#FFFFFF',
  cta2Text: '#16242E',
  cta2Border: '#D9D2C7',

  pistachio: '#B8C98A',
  positive: '#6F8B45',
  positiveSoft: 'rgba(111,139,69,0.16)',
  negative: '#B0654C',
  negativeSoft: 'rgba(176,101,76,0.14)',
  brown: '#8A624A',
  brownSoft: 'rgba(138,98,74,0.12)',
  brownInk: '#FFFFFF',

  tile: 'rgba(31,111,155,0.10)',
  tileIcon: '#1F6F9B',

  navbar: 'rgba(245,240,232,0.72)',
  scrim: 'rgba(16,40,58,0.45)',
};

export const dark: ThemeTokens = {
  mode: 'dark',
  isDark: true,

  canvas: {
    colors: ['#0C2331', '#1A4258', '#0D2636'],
    locations: [0, 0.48, 1],
    start: { x: 0.12, y: 0 },
    end: { x: -0.05, y: 1 },
  },

  ink: '#FFFFFF',
  inkSoft: 'rgba(255,255,255,0.82)',
  muted: 'rgba(255,255,255,0.62)',
  muted2: 'rgba(255,255,255,0.45)',
  label: '#41B8E8',

  accent: '#41B8E8',
  accentSoft: 'rgba(65,184,232,0.16)',

  card: 'rgba(255,255,255,0.07)',
  cardBorder: 'rgba(255,255,255,0.13)',
  cardBlurIntensity: 14,
  divider: 'rgba(255,255,255,0.12)',
  line: 'rgba(255,255,255,0.16)',
  chip: 'rgba(255,255,255,0.10)',

  badgeBg: '#0C1318',
  badgeText: '#FFFFFF',

  ctaBg: '#FFFFFF',
  ctaText: '#0E2230',
  cta2Text: '#FFFFFF',
  cta2Border: 'rgba(255,255,255,0.32)',

  pistachio: '#C6D89E',
  positive: '#C6D89E',
  positiveSoft: 'rgba(184,201,138,0.20)',
  negative: '#E6A98F',
  negativeSoft: 'rgba(230,169,143,0.18)',
  brown: '#CDA079',
  brownSoft: 'rgba(205,160,121,0.20)',
  brownInk: '#241608',

  tile: 'rgba(65,184,232,0.16)',
  tileIcon: '#5CC4EE',

  navbar: 'rgba(11,30,42,0.55)',
  scrim: 'rgba(6,18,26,0.62)',
};

export const themes = { light, dark };
