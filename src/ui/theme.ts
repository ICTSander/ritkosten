import { useColorScheme } from 'react-native';

import { useApp } from '../state/store';

/**
 * Design tokens. One accent — Dutch road-sign blue — used sparingly.
 * Contrast: textSecondary ≥ 4.5:1 on bg/surface in both schemes.
 */
const light = {
  bg: '#F3F4F6',
  surface: '#FFFFFF',
  surfaceMuted: '#ECEEF1',
  surfaceRaised: '#FFFFFF',
  text: '#0F1216',
  textSecondary: '#545C66',
  textTertiary: '#7A828C',
  separator: '#E1E4E8',
  accent: '#0A5BB0',
  accentPressed: '#084A90',
  onAccent: '#FFFFFF',
  accentSoft: '#E4EEF9',
  warning: '#8F4B00',
  warningSoft: '#FFF3E0',
  error: '#B3261E',
  errorSoft: '#FDECEA',
  success: '#1E7A46',
  plate: '#F4C400',
  plateInk: '#111111',
  plateBlue: '#1D4DA8',
  scrim: 'rgba(15,18,22,0.35)',
};

const dark: typeof light = {
  bg: '#0B0D10',
  surface: '#15181C',
  surfaceMuted: '#1D2126',
  surfaceRaised: '#343A42',
  text: '#F1F3F5',
  textSecondary: '#A2AAB3',
  textTertiary: '#7C848E',
  separator: 'rgba(255,255,255,0.09)',
  accent: '#7AB0FF',
  accentPressed: '#5E9BF5',
  onAccent: '#06182E',
  accentSoft: 'rgba(122,176,255,0.14)',
  warning: '#F2A93B',
  warningSoft: 'rgba(242,169,59,0.12)',
  error: '#FF7A70',
  errorSoft: 'rgba(255,122,112,0.12)',
  success: '#5FD08F',
  plate: '#F4C400',
  plateInk: '#111111',
  plateBlue: '#1D4DA8',
  scrim: 'rgba(0,0,0,0.55)',
};

export type Palette = typeof light;

/**
 * Transit mode colours (badge fill + timeline line). Every badge also carries an icon and text,
 * so colour is never the only cue. All ≥ 4.5:1 against white (light) / ≥ 4.1:1 on our greys.
 */
export const modeColors = {
  light: {
    walk: { line: '#6B737D', badge: '#6B737D', text: '#FFFFFF' },
    train: { line: '#8A6400', badge: '#F4C400', text: '#111111' },
    bus: { line: '#0E7466', badge: '#0E7466', text: '#FFFFFF' },
    tram: { line: '#B02A5B', badge: '#B02A5B', text: '#FFFFFF' },
    metro: { line: '#6A44C4', badge: '#6A44C4', text: '#FFFFFF' },
    ferry: { line: '#2F6A8F', badge: '#2F6A8F', text: '#FFFFFF' },
    other: { line: '#545C66', badge: '#545C66', text: '#FFFFFF' },
  },
  dark: {
    walk: { line: '#8C949E', badge: '#8C949E', text: '#0B0D10' },
    train: { line: '#F4C400', badge: '#F4C400', text: '#111111' },
    bus: { line: '#45C9B3', badge: '#45C9B3', text: '#0B0D10' },
    tram: { line: '#FF8AB4', badge: '#FF8AB4', text: '#0B0D10' },
    metro: { line: '#B8A4FF', badge: '#B8A4FF', text: '#0B0D10' },
    ferry: { line: '#7FC4E8', badge: '#7FC4E8', text: '#0B0D10' },
    other: { line: '#A2AAB3', badge: '#A2AAB3', text: '#0B0D10' },
  },
} as const;

export type ModeColorKey = keyof typeof modeColors.light;

export function useModeColors() {
  return useIsDark() ? modeColors.dark : modeColors.light;
}

export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  mono: 'GeistMono_500Medium',
  monoBold: 'GeistMono_600SemiBold',
} as const;

export const type = {
  price: { fontFamily: fonts.monoBold, fontSize: 64, lineHeight: 72, letterSpacing: -2 },
  largeTitle: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  headline: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 24 },
  callout: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
  numeric: { fontFamily: fonts.mono, fontSize: 15, lineHeight: 20 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;
export const radius = { input: 14, card: 18, sheet: 24, pill: 999, plate: 8 } as const;
export const GUTTER = 20;
export const MAX_WIDTH = 560;

/** Dark mode: the user's choice in "Weergave", or the system setting. */
export function useIsDark(): boolean {
  const system = useColorScheme();
  const appearance = useApp((s) => s.appearance);
  return appearance === 'system' ? system === 'dark' : appearance === 'dark';
}

export function usePalette(): Palette {
  return useIsDark() ? dark : light;
}

export const palettes = { light, dark };
