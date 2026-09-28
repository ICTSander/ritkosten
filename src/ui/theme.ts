import { type TextStyle, useColorScheme } from 'react-native';

import { useApp } from '../state/store';

/**
 * Design tokens. Layout of iOS grouped lists (grey page, white blocks) with a friendly,
 * chunky touch: rounded Nunito, one green accent and buttons with a pressable bottom edge.
 * Contrast: textSecondary ≥ 4.5:1 on bg/surface; white on accent ≥ 4.5:1.
 */
const light = {
  bg: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceMuted: '#EBEBF0',
  surfaceRaised: '#FFFFFF',
  text: '#1C1C1E',
  textSecondary: '#5B5B60',
  textTertiary: '#86868B',
  separator: '#E3E3E8',
  accent: '#15803D',
  accentPressed: '#126E34',
  /** Darker bottom edge that makes primary buttons look pressable. */
  accentEdge: '#0E5E2C',
  onAccent: '#FFFFFF',
  accentSoft: '#DCF3E4',
  /** Edge under white (secondary) buttons and the search field. */
  edge: '#D8D8DE',
  highlight: '#FFF4D6',
  highlightEdge: '#F5C542',
  onHighlight: '#6B5200',
  warning: '#8F4B00',
  warningSoft: '#FFF3E0',
  error: '#B3261E',
  errorSoft: '#FDECEA',
  success: '#2BB673',
  plate: '#F4C400',
  plateInk: '#111111',
  plateBlue: '#1D4DA8',
  scrim: 'rgba(15,18,22,0.35)',
};

const dark: typeof light = {
  bg: '#000000',
  surface: '#1C1C1E',
  surfaceMuted: '#2C2C2E',
  surfaceRaised: '#3A3A3C',
  text: '#F2F2F7',
  textSecondary: '#AEAEB2',
  textTertiary: '#8E8E93',
  separator: 'rgba(255,255,255,0.1)',
  accent: '#3DD068',
  accentPressed: '#34B95B',
  accentEdge: '#23863F',
  onAccent: '#052E12',
  accentSoft: 'rgba(61,208,104,0.16)',
  edge: '#0A0A0B',
  highlight: '#2E2710',
  highlightEdge: '#8A6D12',
  onHighlight: '#F5D77A',
  warning: '#F2A93B',
  warningSoft: 'rgba(242,169,59,0.12)',
  error: '#FF7A70',
  errorSoft: 'rgba(255,122,112,0.12)',
  success: '#3DD068',
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
  regular: 'Nunito_500Medium',
  medium: 'Nunito_600SemiBold',
  semibold: 'Nunito_700Bold',
  bold: 'Nunito_800ExtraBold',
  black: 'Nunito_900Black',
  /** Numbers: same family, heavy; tabular figures are set where digits must not jump. */
  mono: 'Nunito_700Bold',
  monoBold: 'Nunito_900Black',
} as const;

const TABULAR: TextStyle['fontVariant'] = ['tabular-nums'];

export const type = {
  price: { fontFamily: fonts.monoBold, fontSize: 60, lineHeight: 70, letterSpacing: -1.5, fontVariant: TABULAR },
  largeTitle: { fontFamily: fonts.black, fontSize: 34, lineHeight: 40, letterSpacing: -0.5 },
  title: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
  headline: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 24 },
  callout: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.3 },
  numeric: { fontFamily: fonts.mono, fontSize: 15, lineHeight: 20, fontVariant: TABULAR },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;
export const radius = { input: 14, card: 16, button: 16, sheet: 24, pill: 999, plate: 8 } as const;
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
